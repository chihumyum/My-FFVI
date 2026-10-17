// Real source camera instructions and factory data with controlled live owners.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"));
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { bindMapPackages } = await module("compiler/map-package");
const { tableId } = await module("compiler/table-id");
const { verifyContent } = await module("core/content-integrity");
const { compileFieldCameraHostDefinition } = await module("compiler/field-camera-host");
const { compileFieldCameraInstruction, compileFieldCameraMotionInstruction, fieldCameraSelectors } = await module("compiler/field-camera");
const { FieldCameraHost } = await module("core/field-camera-host");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const output = root + "build/reports/field-camera-host-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-camera-host-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-camera-host-native-check.json");
const native = JSON.parse(nativeBytes), corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const asset = (id) => {
  const matches = corpus.assets.filter((a) => a.id === id); assert.equal(matches.length, 1, id);
  return matches[0];
};
const bindings = bindMapPackages(corpus.assets, corpus.tables).filter((map) => map.id === "609");
assert.equal(bindings.length, 1); const binding = bindings[0];
assert.equal(binding.name, "Map_40037"); assert.deepEqual(binding.issues, []);
const mapRows = corpus.tables["map.csv"].filter((row) => tableId(row.id) === 609);
assert.equal(mapRows.length, 1); const mapRow = mapRows[0];
const tiles = asset(binding.tilemap), defaults = asset(binding.groups.entity_default);
// This definition grants the explicitly named normal lifecycle only. The
// actual entry host must separately prove mapViewType/transport/actor admission.
const context = { mapViewType: 0, loopType: tableId(mapRow.loop_type) };
const definition = compileFieldCameraHostDefinition(corpus.manifest.sources, tiles.data, defaults.data,
  context);
assert.deepEqual(definition.mapRange, { x: 0, y: 0, width: 42, height: 32 });
assert.deepEqual(definition.playerVisualOffset, { x: 0, y: -6 });
const viewport = { aspect: 16 / 9, orthographicSize: 108, isClamp: true, effectOffset: { x: 0, y: 0 } };
let player = { cell: { x: 26, y: 7 }, logicalLayer: 0, direction: "right" }, scroll = { x: 0, y: 0 };
const ports = { readPlayer: () => player, readScrollOffset: () => scroll };
const selectors = [];
for (const source of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of source.data.Mnemonics.entries()) {
    if (raw.mnemonic !== "SysCall" || !fieldCameraSelectors.includes(raw.operands?.sValues?.[0])) continue;
    const op = compileFieldCameraInstruction(raw), host = new FieldCameraHost(definition, ports);
    host.prepareSelect({ target: "player" }).commit();
    const before = host.snapshot(), plan = host.prepareSelect(op.command);
    assert.deepEqual(host.snapshot(), before); assert.equal(plan.refresh, true); plan.commit();
    assert.equal(host.snapshot().target, op.command.target);
    const restored = new FieldCameraHost(definition, ports, JSON.parse(JSON.stringify(host.snapshot())));
    assert.deepEqual(restored.projection(viewport), host.projection(viewport));
    selectors.push({ script: source.data.Name, index, source: { ...source.source, pointer: `/Mnemonics/${index}` },
      target: op.command.target, prepareAtomic: true, checkpointRoundTrip: true });
  }
}
assert.equal(selectors.length, 34);
const scripts = corpus.assets.filter((a) => a.kind === "script" && a.data.Name === "sc_e_0001");
assert.equal(scripts.length, 1); const script = scripts[0];
const set = compileFieldCameraMotionInstruction(script.data.Mnemonics[26]).command;
const lerp = compileFieldCameraMotionInstruction(script.data.Mnemonics[33]).command;
assert.deepEqual(set, { kind: "set-position", x: 29, y: 5, layer: 0 });
assert.deepEqual(lerp, { kind: "lerp", x: 29, y: 24, layer: 0, duration: 11, arcHeight: 0 });
const host = new FieldCameraHost(definition, ports), initial = host.snapshot();
const draft = host.fork(definition, ports);
draft.prepareInitializeDummy().commit(); draft.prepareSelect({ target: "dummy" }).commit();
const admission = host.prepareState(draft.snapshot());
assert.deepEqual(host.snapshot(), initial); admission.commit();
assert.deepEqual(host.snapshot().dummy.visibility, { activeSelf: null, fadeAlpha: 0, currentFadeStatus: 0 });
// Source PuppetCore.Ready invokes Show(0), independently of target selection.
const beforeReady = host.snapshot(), show = host.prepareVisibility(true);
assert.deepEqual(host.snapshot(), beforeReady); show.commit();
assert.deepEqual(host.snapshot().dummy.visibility, { activeSelf: true, fadeAlpha: 1, currentFadeStatus: 0 });
host.prepareSetPosition(set).commit();
const first = host.prepareLerp(lerp, null, 2); assert.equal(first.flow, "wait"); first.commit();
const samples = [];
for (const elapsed of [0, 0.01, 5.5, 10.99, 11, 12]) {
  const state = host.snapshot(), step = host.prepareLerp(lerp, first.progress, 2 + elapsed);
  assert.deepEqual(host.snapshot(), state); step.commit();
  const p = host.projection({ ...viewport, isClamp: false });
  assert.equal(step.flow, elapsed >= 11 ? "next" : "wait");
  samples.push({ elapsed, flow: step.flow, cameraCell: p.cameraCell, renderCell: p.renderCell });
}
assert.deepEqual(samples[2].cameraCell, { x: 29, y: 14.5 });
assert.deepEqual(samples[4].cameraCell, { x: 29, y: 24 });
assert.deepEqual(samples[4].renderCell, { x: 29, y: 24.375 });
assert.deepEqual(host.snapshot().dummy.visibility, { activeSelf: true, fadeAlpha: 1, currentFadeStatus: 0 });
host.prepareVisibility(false).commit();
assert.deepEqual(host.snapshot().dummy.visibility, { activeSelf: false, fadeAlpha: 0, currentFadeStatus: 0 });
const finished = host.snapshot(), restored = new FieldCameraHost(definition, ports, JSON.parse(JSON.stringify(finished)));
assert.deepEqual(restored.projection(viewport), host.projection(viewport));
player = { ...player, cell: { x: 5.25, y: 8.5 } }; scroll = { x: 8, y: 16 };
assert.deepEqual(restored.snapshot(), finished); // live player does not pull dummy along
restored.prepareSelect({ target: "player" }).commit();
assert.deepEqual(restored.projection({ ...viewport, isClamp: false }).cameraCell, { x: 5.75, y: 7.5 });
assert.deepEqual(restored.projection({ ...viewport, isClamp: false }).renderCell, { x: 5.75, y: 7.875 });

// Mandatory content binding: an old world without the compiled host fails this
// checker. Neither a changed header nor a guessed maps/<id>.json path suffices.
const world = await verifyContent(JSON.parse(await readFile(root + "build/world/catalog.json", "utf8")));
assert.equal(world.sourceSetHash, corpus.sourceSetHash);
assert.equal(world.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const indexed = world.maps[binding.id]; assert.ok(indexed);
assert.equal(indexed.name, binding.name);
assert.match(indexed.url, /^\/world\/maps\/[0-9]+\.json$/);
const published = await verifyContent(JSON.parse(await readFile(root + "build" + indexed.url, "utf8")), indexed.contentHash);
assert.equal(published.mapId, 609); assert.equal(published.name, binding.name);
assert.equal(published.sourceSetHash, corpus.sourceSetHash);
assert.equal(published.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
assert.deepEqual(published.cameraHost, definition);
assert.deepEqual(published.cameraHostBlockers, []);
const boundHost = new FieldCameraHost(published.cameraHost, ports, JSON.parse(JSON.stringify(finished)));
assert.deepEqual(boundHost.projection(viewport), host.projection(viewport));
const publishedBinding = { catalogHash: world.contentHash, mapHash: published.contentHash,
  url: indexed.url, mapId: published.mapId, geometryReady: indexed.geometryReady,
  defaultGroupReady: indexed.defaultGroupReady, generalBlockers: published.blockers.length,
  definitionVerified: true, cameraHostBlockers: published.cameraHostBlockers,
  interpretation: "Conditional normal-lifecycle capability; does not itself admit this map entry." };
const report = { lane: "source-field-camera-host-controlled-runtime", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeReportSha256: sha(nativeBytes), definition,
  sourceMap: { mapId: 609, name: binding.name, context,
    row: { table: "map.csv", id: mapRow.id, loop_type: mapRow.loop_type },
    package: asset(binding.packageId).source, tilemap: tiles.source, defaultEntities: defaults.source }, selectors,
  publishedBinding,
  motion: { script: script.data.Name, source: script.source, setIndex: 26, lerpIndex: 33, set, lerp, samples },
  checks: { selectors: selectors.length, sourceMotionInstructions: 2, motionSamples: samples.length,
    forkAtomicPublish: true, stableCheckpoint: true, livePlayer: true, visualOffset: true,
    zeroDurationVisibilityTransitions: 2, publishedWorldBinding: true },
  originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["native-dynamic-parity", "full-prelude-playthrough", "arbitrary-camera-callback-host",
    "ordinary-map-entry-admission", "browser-viewport-acceptance"] };
const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
console.log(JSON.stringify({ ...report.checks, reportSha256: sha(bytes), originalGameExecuted: false, semanticsVerified: false }));
