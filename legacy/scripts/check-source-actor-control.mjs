// Original operand/provenance checks and controlled native-owner execution.
// This does not replay a source story or authorize delayed Hide/Orient/Route.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(!options.has(key), "Duplicate checker option");
  if (key === "--require-current-ir") options.set(key, true);
  else {
    assert.ok(["--compiled-dir", "--content-dir", "--report"].includes(key) && process.argv[i + 1] &&
      !process.argv[i + 1].startsWith("--"), "Use --compiled-dir/--content-dir/--report <path> or --require-current-ir");
    options.set(key, process.argv[++i]);
  }
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist"),
  contentDir = resolve(root, options.get("--content-dir") ?? "build/content-packages"),
  output = resolve(root, options.get("--report") ?? "build/reports/source-actor-control-check.json"),
  load = name => import(pathToFileURL(resolve(compiled, name + ".js"))),
  sha = bytes => createHash("sha256").update(bytes).digest("hex"),
  read = async path => JSON.parse(await readFile(path, "utf8"));
const report = { kind: "source-actor-control-check-v1", result: "running", areaId: 8,
  sourceStory: "unassessed", originalGameExecuted: false, browserVerified: false, semanticsVerified: false,
  cases: [], limitations: [
    "The static scope follows the whole-area manifest's references, not story conditions or branch reachability",
    "Repeated script attachments are map references, not additional physical instruction sites",
    "Native receipts and PE ranges are static evidence; the original DLL is not executed",
    "Controlled sessions use the existing synthetic source initializer, map, media and NPC factory; only nominated operands come from original scripts",
    "Delayed Hide, Orient and Route remain blocked; RelayInteraction, inn and leader-dependent shops are outside this increment",
    "Actor-control provider requirements remain conditional without a real host; compilation is not runtime admission",
  ] };
await mkdir(dirname(output), { recursive: true });

try {
  const [{ loadCorpus }, { analyzeContentDependencies }, { decodeFieldOp }, integrity, admission, fixtureModule, { GameFlow }] =
    await Promise.all([load("src/compiler/corpus"), load("src/compiler/content-dependencies"), load("src/compiler/field"),
      load("src/core/content-integrity"), load("src/core/field-content-admission"),
      load("tests/fixtures/field-move-to-session"), load("src/core/game-flow")]);
  const { contentDigest, verifyContent } = integrity;
  const runtimeHash = await runtimeDigest(root, compiled);
  report.runtimeHash = runtimeHash;
  const refs = await read(resolve(contentDir, "south-figaro-area.json")),
    manifestBytes = await readFile(resolve(contentDir, "south-figaro-area/manifest.json")),
    manifest = JSON.parse(manifestBytes),
    buildReportBytes = await readFile(resolve(contentDir, "south-figaro-area/build-report.json")),
    buildReport = JSON.parse(buildReportBytes);
  assert.deepEqual(manifest.contentRefs, refs);
  assert.deepEqual(buildReport.refs, refs);
  const world = await verifyContent(await read(resolve(contentDir, "south-figaro-area/world.json")), refs.world.contentHash);
  assert.equal(manifest.mapIds.length, 56);
  const maps = await Promise.all(manifest.mapIds.map(async id => {
    const map = await verifyContent(await read(resolve(contentDir, `south-figaro-area/maps/${id}.json`)), world.maps[id].contentHash);
    assert.equal(map.mapId, id); assert.equal(map.areaId, 8);
    return map;
  }));
  const corpus = await loadCorpus(root), graph = analyzeContentDependencies({ catalog: world, maps,
    roots: manifest.roots, mapIds: manifest.mapIds });
  assert.equal(world.sourceSetHash, corpus.sourceSetHash);
  assert.equal(world.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  report.sourceSetHash = corpus.sourceSetHash; report.parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  report.content = { worldHash: world.contentHash, manifestSha256: sha(manifestBytes),
    buildReportSha256: sha(buildReportBytes), diagnosticCount: buildReport.diagnostics.length,
    diagnosticCodes: histogram(buildReport.diagnostics, x => x.code),
    maps: maps.map(map => ({ mapId: map.mapId, contentHash: map.contentHash })) };
  try {
    const bytes = await readFile(resolve(root, "build/reports/v88-source-actor-control-plan.json")), baseline = JSON.parse(bytes);
    assert.equal(baseline.kind, "source-actor-control-plan-v1"); assert.equal(baseline.baseline.diagnosticCount, 475);
    assert.equal(baseline.baseline.diagnostics.length, 475); assert.equal(baseline.sourceSetHash, corpus.sourceSetHash);
    assert.deepEqual(baseline.baseline.mapIds, manifest.mapIds);
    report.baseline = { path: "build/reports/v88-source-actor-control-plan.json", sha256: sha(bytes),
      diagnosticCount: 475, worldHash: baseline.baseline.worldCatalogHash };
  } catch (error) { if (error.code !== "ENOENT") throw error; report.baseline = null; }

  const sourceKey = source => JSON.stringify([source.file, source.assetPath, source.objectId, source.serializedFile, source.sha256]);
  const assets = new Map();
  for (const asset of corpus.assets.filter(asset => asset.kind === "script")) {
    assert.ok(!assets.has(sourceKey(asset.source)), "Ambiguous physical script identity");
    assets.set(sourceKey(asset.source), asset);
  }
  const byMap = new Map(maps.map(map => [map.mapId, map])), scripts = new Map(), sites = new Map();
  for (const edge of graph.edges) if (edge.kind === "script" && edge.resolution === "resolved") {
    const match = /^map:(\d+)\/script:(.*)$/.exec(edge.target); assert.ok(match);
    scripts.set(edge.target, { mapId: Number(match[1]), script: decodeURIComponent(match[2]) });
  }
  for (const entry of manifest.roots) if (entry.kind === "script")
    scripts.set(`map:${entry.mapId}/script:${encodeURIComponent(entry.script)}`, entry);
  const mismatches = [];
  for (const { mapId, script } of scripts.values()) for (const ir of byMap.get(mapId).scripts[script]) {
    const asset = assets.get(sourceKey(ir.source)); assert.ok(asset, "IR references an unbound script asset");
    const raw = asset.data.Mnemonics[ir.index]; assert.ok(raw, "IR references an absent instruction");
    assert.deepEqual(ir.source, { ...asset.source, pointer: `/Mnemonics/${ir.index}` });
    const family = classify(raw); if (!family) continue;
    const site = { script, index: ir.index, source: ir.source }, decoded = decodeFieldOp(raw, site, corpus.messages, corpus.tables),
      siteId = await contentDigest(ir.source);
    let record = sites.get(siteId);
    if (!record) {
      record = { siteId, family, assetId: asset.id, script: asset.data.Name, index: ir.index, source: ir.source,
        raw, instructionHash: await contentDigest(raw), decoded, references: [] };
      sites.set(siteId, record);
    }
    if (family === "relativeSetPos") {
      const [x, y, layer, mode, referenceEntityId] = raw.operands.iValues, animation = raw.operands.sValues[0];
      assert.deepEqual(decoded, { ...site, kind: "position", x, y, animation,
        nativeCommand: { x, y, layer, animation, mode, referenceEntityId } });
    } else if (family === "zeroShow") assert.deepEqual(decoded, { ...site, kind: "actor-visibility", visible: true });
    else assert.equal(decoded.kind, "blocked", `${family} must retain its unresolved contract`);
    const requirements = admission.fieldInstructionRequirements(decoded);
    if (["relativeSetPos", "zeroShow"].includes(family)) {
      assert.ok(requirements.some(item => item.capability === "actorControl" && item.code === "FIELD_ACTOR_CONTROL_PROVIDER"));
      assert.equal(admission.assessFieldRequirements(requirements, { providers: {}, actorKind: "unknown" }).status, "conditional");
      assert.equal(admission.assessFieldRequirements(requirements,
        { providers: { actorControl: "missing" }, actorKind: "actor" }).status, "blocked");
    }
    const current = JSON.stringify(ir) === JSON.stringify(decoded) || await contentDigest(ir) === await contentDigest(decoded);
    if (!current) mismatches.push({ siteId, mapId, script, index: ir.index, actual: ir.kind, expected: decoded.kind });
    if (!record.references.some(ref => ref.mapId === mapId && ref.script === script))
      record.references.push({ mapId, script, mapContentHash: byMap.get(mapId).contentHash, irKind: ir.kind,
        current, requirements });
  }
  const ordered = [...sites.values()].sort((a, b) => a.family.localeCompare(b.family) || a.assetId.localeCompare(b.assetId) || a.index - b.index);
  const counts = histogram(ordered, site => site.family);
  assert.deepEqual(counts, { delayedHide: 4, orient: 3, relativeSetPos: 21, route: 14, zeroShow: 18 });
  assert.ok(ordered.filter(site => site.family === "delayedHide").every(site =>
    site.raw.operands.rValues[0] === 0 && site.raw.operands.rValues[1] === .1));
  report.inventory = { roots: manifest.roots.length, referencedScriptCopies: scripts.size,
    physicalSites: ordered.length, counts, sites: ordered };
  const nominatedControlSites = new Set(ordered.filter(site => ["relativeSetPos", "zeroShow"].includes(site.family))
    .flatMap(site => site.references.map(ref => JSON.stringify([ref.mapId, ref.script, site.index]))));
  const actorControls = graph.providerRequirements.filter(item => item.capability === "actorControl"),
    nominatedRequirements = actorControls.filter(item => nominatedControlSites.has(
      JSON.stringify([item.mapId, item.site.script, item.site.index])));
  report.currentIR = { status: mismatches.length ? "stale" : "current", required: !!options.get("--require-current-ir"), mismatches,
    actorControlRequirements: actorControls.length, nominatedActorControlRequirements: nominatedRequirements.length };
  if (options.get("--require-current-ir")) {
    assert.equal(mismatches.length, 0, "Rebuild the single content candidate before requiring current whole-area IR");
    assert.equal(nominatedControlSites.size, 39);
    assert.equal(nominatedRequirements.length, nominatedControlSites.size);
  }
  report.cases.push({ name: "whole-area-physical-sites-and-source-parameter-bindings", result: "passed", sites: 60 });
  report.cases.push({ name: "actor-control-requirements-do-not-grant-an-unknown-host", result: "passed", sites: 39 });
  report.native = await nativeEvidence();
  report.cases.push({ name: "existing-native-receipts-and-exact-original-byte-ranges", result: "passed",
    methods: report.native.methods.length, rawRanges: report.native.rawRanges.length });

  const positionSite = ordered.find(site => site.family === "relativeSetPos" && site.raw.operands.sValues[0] === "Default"),
    showSite = ordered.find(site => site.family === "zeroShow"),
    missingMediaSite = ordered.find(site => site.family === "relativeSetPos" && site.raw.operands.sValues[0] === "WalkB_00");
  assert.ok(positionSite && showSite && missingMediaSite);
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const seal = async value => { const { contentHash: _, ...body } = structuredClone(value);
    return { ...body, contentHash: await contentDigest(body) }; };
  async function session(position, invalidReference = false) {
    const f = await fixtureModule.fieldMoveToSessionFixture(), map = structuredClone(f.map), name = "controlled-source-actor-control";
    const raw = structuredClone(position.raw);
    if (invalidReference) raw.operands.iValues[4] = 999; // Deliberate negative input; never relabelled original.
    const control = decodeFieldOp(raw, { script: name, index: 8, source: invalidReference
      ? { file: "controlled-negative", assetPath: "missing-selector" } : position.source }, corpus.messages, corpus.tables);
    assert.equal(control.kind, "position");
    const show = decodeFieldOp(showSite.raw, { script: name, index: 10, source: showSite.source }, corpus.messages, corpus.tables);
    const authored = { file: "controlled-source-actor-control", assetPath: "authored-wrapper" };
    const operations = [
      { kind: "puppet", slot: 0, actor: String(f.actors.npc.selector), target: 5 },
      { kind: "exec-puppets", asynchronous: false },
      { kind: "calc", left: { category: "MapLocalVariable", index: 0 }, operator: "＋", right: { kind: "immediate", value: 1 } },
      { kind: "exit" }, { kind: "nop" }, { kind: "nop" },
      { kind: "actor-visibility", visible: false }, { kind: "wait", seconds: .03 },
      control, { kind: "wait", seconds: .04 }, show, { kind: "wait", seconds: .04 }, { kind: "exit" },
    ].map((op, index) => ({ ...op, script: name, index, source: op.source ?? authored }));
    map.scripts[name] = operations;
    map.scriptPuppetContexts[name] = { ...map.scriptPuppetContexts.reserved, scriptHash: "7".repeat(64) };
    map.scriptLocals[name] = null;
    const sealedMap = await seal(map), world = structuredClone(f.world);
    world.maps[map.mapId].contentHash = sealedMap.contentHash;
    const catalog = await seal(world), content = await seal({ ...f.content,
      worldCatalogHash: catalog.contentHash, mapContentHash: sealedMap.contentHash });
    const game = fixtureModule.launchFieldMoveToSession({ ...f, map: sealedMap, world: catalog, content });
    const flow = new GameFlow(game); flow.start(); flow.advance(10, host);
    assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
    assert.equal(game.field.startEvent(name), true);
    return { game, flow, npc: game.field.actors[f.actors.npc.id], name };
  }
  function until(t, predicate, label, allowStop = false) {
    for (let i = 0; i < 100; i++) {
      if (!allowStop) assert.equal(t.game.field.stop, null, t.game.field.stop?.message ?? label);
      if (predicate()) return;
      t.flow.advance(10, host);
    }
    assert.fail(label + " did not complete");
  }
  const positive = await session(positionSite), field = positive.game.field, npc = positive.npc,
    actors = field.actors, native = npc.native, entity = native.entity, owned = positive.game.state.snapshot();
  until(positive, () => !field.isEntityVisible(npc.id), "controlled Hide");
  const beforeCell = { x: npc.x, y: npc.y };
  assert.deepEqual(beforeCell, { x: 5, y: 5 });
  until(positive, () => npc.x === field.player.x && npc.y === field.player.y, "source relative SetPos");
  assert.equal(field.actors, actors); assert.equal(field.actors[npc.id], npc);
  assert.equal(npc.native, native); assert.equal(npc.native.entity, entity);
  assert.equal(field.isEntityVisible(npc.id), false, "SetPos cannot implicitly Show the destination");
  assert.equal(entity.fadeAlpha, 0); assert.equal(field.hiddenEntities.has(npc.id), false);
  assert.deepEqual(positive.game.state.snapshot(), owned);
  report.cases.push({ name: "original-mode1-operands-copy-the-bound-reference-on-the-same-native-owner", result: "passed",
    siteId: positionSite.siteId, before: beforeCell, after: { x: npc.x, y: npc.y }, sourceStory: "unassessed" });
  until(positive, () => field.isEntityVisible(npc.id), "source zero Show");
  assert.equal(entity.fadeAlpha, 1); assert.equal(npc.motion, null); assert.equal(field.hiddenEntities.has(npc.id), false);
  until(positive, () => positive.game.checkpointReady, "event completion");
  assert.equal(field.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  assert.deepEqual(positive.game.state.snapshot(), owned);
  report.cases.push({ name: "original-zero-show-uses-native-visibility-and-continues-the-owning-task", result: "passed",
    siteId: showSite.siteId, actorIdentityPreserved: field.actors[npc.id] === npc });
  for (const [name, position, invalidReference, expected] of [
    ["unresolved-selector-rejects-before-publication", positionSite, true, /reference entity is unavailable/],
    ["original-animation-without-fixture-media-rejects-before-publication", missingMediaSite, false, /Missing actor animation|尚未支持角色动画/],
  ]) {
    const t = await session(position, invalidReference), current = t.game.field, actor = t.npc;
    until(t, () => !current.isEntityVisible(actor.id), "negative preparation");
    const before = capture(actor), ownedBefore = t.game.state.snapshot();
    until(t, () => current.stop !== null, "explicit rejection", true);
    assert.equal(current.stop.kind, "unsupported"); assert.match(current.stop.message, expected);
    const after = capture(current.actors[actor.id]);
    for (const key of ["actor", "native", "entityOwner", "animationOwner", "motionOwner"])
      assert.equal(after[key], before[key], `${key} must keep the original owner on failure`);
    assert.deepEqual(after.value, before.value); assert.deepEqual(t.game.state.snapshot(), ownedBefore);
    assert.equal(current.eventState.read({ category: "MapLocalVariable", index: 0 }), 0);
    assert.equal(t.game.checkpointReady, false);
    report.cases.push({ name, result: "passed", siteId: position.siteId, controlledNegative: invalidReference,
      reason: current.stop.message });
  }
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed during this check");
  assert.equal(sha(await readFile(resolve(contentDir, "south-figaro-area/build-report.json"))), sha(buildReportBytes),
    "A content publication overlapped this check");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length,
    physicalSites: report.inventory?.physicalSites, currentIR: report.currentIR?.status, report: output, error: report.error }));
}

function histogram(values, key) {
  const counts = {};
  for (const value of values) { const name = key(value); counts[name] = (counts[name] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
function classify(raw) {
  if (raw.type !== 2) return null;
  const { iValues: i, rValues: r, sValues: s } = raw.operands;
  if (raw.mnemonic === "SetPos" && i[3] === 1) return "relativeSetPos";
  if (raw.mnemonic === "Show" && [i, r, s].every(array => array.length === 8) &&
      i.every(value => value === 0) && r.every(value => value === 0) && s.every(value => value === "")) return "zeroShow";
  if (raw.mnemonic === "Hide" && r[1] !== 0) return "delayedHide";
  return raw.mnemonic === "Orient" ? "orient" : raw.mnemonic === "Route" ? "route" : null;
}
function capture(actor) {
  const { animation: _, ...entity } = actor.native.entity;
  return { actor, native: actor.native, entityOwner: actor.native.entity, animationOwner: actor.animation,
    motionOwner: actor.motion, value: structuredClone({ entity, animation: actor.animation?.snapshot(),
      motion: actor.motion, x: actor.x, y: actor.y, layer: actor.layer, steps: actor.steps }) };
}
async function nativeEvidence() {
  const fingerprints = {
    nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  };
  for (const [path, key] of [["build/runtime/game/GameAssembly.dll", "nativeSha256"],
    ["build/native/il2cpp/script.json", "symbolsSha256"], ["build/native/il2cpp/il2cpp_ghidra.h", "headerSha256"]])
    assert.equal(sha(await readFile(resolve(root, path))), fingerprints[key]);
  const methods = [];
  for (const [batch, rva] of [["actor-position", "2c6a30"], ["v29-camera-coordinates-complete", "2c26f0"],
    ["v33-field-host-details", "2c0040"], ["actor-position-cue", "2ca950"], ["v76-npc-route", "2c6130"]]) {
    const receipt = await read(resolve(root, `build/native/${batch}/complete.json`));
    assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
    for (const key of Object.keys(fingerprints)) assert.equal(receipt[key], fingerprints[key]);
    const found = receipt.methods.filter(method => method.rva === "0x" + rva); assert.equal(found.length, 1);
    const method = found[0]; assert.equal(sha(await readFile(resolve(root, `build/native/${batch}/${rva}.c`))), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
  const rawRanges = [
    { rva: "0x2c7f70", size: 544, sha256: "c29a744f2a46e92ca4fb8228d93c8e3d7b414b54edecdfc4a0f711b5611dc2bd",
      role: "ShowHideCommon reads duration r0 and delay r1" },
    { rva: "0x2c1060", size: 96, sha256: "2c9581f244bf554d03e7f87d95fb95907bbf9b0278621bb37b5685581bc92fc0",
      role: "Hide delegates ShowHideCommon(false)" },
  ];
  const requests = [...methods.map(method => ({ rva: method.rva,
    size: Number(method.nextSymbolRva) - Number(method.rva), sha256: method.nativeRangeSha256 })), ...rawRanges];
  const checked = JSON.parse(execFileSync(resolve(root, ".venv/bin/python"), ["-c", `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([hashlib.sha256(p.read(int(r['rva'],0),r['size'])[2]).hexdigest() for r in json.load(sys.stdin)]))`, root],
  { input: JSON.stringify(requests), encoding: "utf8" }));
  requests.forEach((request, index) => assert.equal(checked[index], request.sha256, request.rva));
  return { ...fingerprints, methods, rawRanges, semanticsVerified: false, originalGameExecuted: false };
}
