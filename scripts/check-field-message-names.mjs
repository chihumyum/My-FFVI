// Real source instructions in an explicitly controlled private field variant.
// No source plot, character acquisition, rename or original runtime is claimed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"),
  module = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = bytes => createHash("sha256").update(bytes).digest("hex"),
  output = resolve(root, "build/reports/field-message-names-check.json");
const report = { kind: "field-message-names-check-v1", result: "failed", lane: "source-backed controlled GameSession/Flow",
  checks: [], stages: [], nativeVerified: false, semanticsVerified: false, browserVerified: false,
  originalGameExecuted: false, sourceGameplayVerified: false, sourceStoryReachabilityVerified: false };
await mkdir(resolve(root, "build/reports"), { recursive: true });

try {
  const { loadSystemSource } = await module("compiler/system-source"), { loadCorpus } = await module("compiler/corpus"),
    { compileManualMessageInstruction } = await module("compiler/message"), { hash } = await module("compiler/content"),
    { fieldMessageNameReferences, resolveFieldMessageTemplate } = await module("core/field-message-template"),
    { GameSession } = await module("core/game-session"), { GameFlow } = await module("core/game-flow"),
    { contentDigest, verifyContent } = await module("core/content-integrity");
  const check = (name, details = {}) => report.checks.push({ name, passed: true, ...details });
  const corpus = await loadCorpus(root), plan = JSON.parse(await readFile(resolve(root, "build/reports/corpus-plan.json"), "utf8")),
    system = await loadSystemSource(root, corpus.manifest.parentSourceSetHash);
  assert.equal(plan.sourceSetHash, corpus.sourceSetHash); assert.equal(system.sourceSetHash, corpus.sourceSetHash);
  const nameRows = corpus.tables["character_default_name.csv"];
  assert.equal(nameRows.length, 14);
  const bound = ref => {
    const row = system.reader.row("character_default_name.csv", ref.rowId);
    assert.equal(row.values.tag_name, ref.tag); assert.equal(Number(row.values.character_id), ref.sourceId);
    assert.match(row.source.objectId, /^-?(?:0|[1-9]\d*)$/);
    return { ...ref, source: row.source };
  };
  report.sourceSetHash = corpus.sourceSetHash; report.parentSourceSetHash = corpus.manifest.parentSourceSetHash;

  // Reuse complete existing method receipts; bind the small CT predicate and
  // constant body directly to this DLL. This performs no native export/run.
  const symbolsBytes = await readFile(resolve(root, "build/native/il2cpp/script.json")), symbols = JSON.parse(symbolsBytes),
    methods = [], evidenceFiles = [];
  for (const [batch, rvas] of [["v21-treasure-task", ["31cae0", "31ddb0", "31e680"]],
    ["v18-owned-character-finalizers", ["338890"]], ["v31-source-message", ["31f3d0"]]]) {
    const bytes = await readFile(resolve(root, `build/native/${batch}/complete.json`)), receipt = JSON.parse(bytes);
    assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
    assert.equal(receipt.symbolsSha256, sha(symbolsBytes));
    assert.equal(receipt.nativeSha256, corpus.manifest.sources.find(source => source.file === "GameAssembly.dll")?.sha256);
    evidenceFiles.push({ file: `build/native/${batch}/complete.json`, sha256: sha(bytes) });
    for (const hex of rvas) {
      const method = receipt.methods.find(row => row.rva === "0x" + hex); assert.ok(method);
      const code = await readFile(resolve(root, `build/native/${batch}/${hex}.c`));
      assert.equal(sha(code), method.decompiledSha256);
      if (hex === "31ddb0") assert.match(code.toString(), /TryGetValue[\s\S]*if \(bVar6\)[\s\S]*System_String__Replace/);
      if (hex === "338890") assert.match(code.toString(), /OwnedCharacterData__get_Name[\s\S]*MessageManager__SetValue/);
      if (hex === "31f3d0") {
        assert.match(code.toString(), /GetMessage[\s\S]*true,[\s\S]*MessageParser__Parse/);
        assert.match(code.toString(), /_DAT_181fff7c0[\s\S]*Any_BattlePlayerData_[\s\S]*textAnchor = 4[\s\S]*SetTextAnchor/);
      }
      methods.push({ batch, ...method });
    }
  }
  assert.ok(symbols.ScriptMethod.some(row => row.Name === "Last.Management.MessageWindowClient.<>c$$<Play>b__9_3" && row.Address === 0x33b070));
  assert.ok(symbols.ScriptMethod.some(row => row.Name === "Last.Systems.Message.CenterContent$$get_Type" && row.Address === 0x4a4c50));
  const predicateBinding = symbols.ScriptMetadataMethod.find(row => row.Address === 0x1fff7c0);
  assert.equal(predicateBinding?.MethodAddress, 0x33b070);
  assert.equal(predicateBinding?.Name, "Method$Last.Management.MessageWindowClient.<>c.<Play>b__9_3()");
  const ranges = [...methods.map(method => ({ rva: method.rva, size: Number(method.nextSymbolRva) - Number(method.rva) })),
    { rva: "0x33b070", size: 48 }, { rva: "0x4a4c50", size: 6 }];
  const native = JSON.parse(execFileSync(resolve(root, ".venv/bin/python"), ["-c", String.raw`import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1]); from tools.native.inspect_pe import PEImage
data=(Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes(); p=PEImage(data)
out=[]
for r in json.load(sys.stdin):
 section,offset,b=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(b).hexdigest(),hex=b.hex() if r['rva'] in ['0x33b070','0x4a4c50'] else None))
print(json.dumps(dict(nativeSha256=hashlib.sha256(data).hexdigest(),ranges=out)))`, root],
  { input: JSON.stringify(ranges), encoding: "utf8" }));
  assert.equal(native.nativeSha256, corpus.manifest.sources.find(source => source.file === "GameAssembly.dll")?.sha256);
  methods.forEach((method, index) => assert.equal(native.ranges[index].sha256, method.nativeRangeSha256));
  assert.equal(native.ranges.at(-2).hex, "4883ec284c8bc24885d2741e488b02498bc8488b9078010000ff907001000083f8050f94c04883c428c3e8d125e6ffcc");
  assert.equal(native.ranges.at(-1).hex, "b805000000c3");
  report.nativeEvidence = { nativeSha256: native.nativeSha256, symbolsSha256: sha(symbolsBytes), evidenceFiles,
    methods: methods.map(({ batch, rva, name, nativeRangeSha256, decompiledSha256 }) =>
      ({ batch, rva, name, nativeRangeSha256, decompiledSha256 })), rawRanges: native.ranges,
    ctPredicateBinding: predicateBinding, ctAlignmentScope: "whole content list, selected once before SetContent/pages",
    missingDictionaryReplacement: "no replacement; prior global default initialization remains unverified",
    semanticsVerified: false };
  check("source-and-static-native-bindings", { nameRows: nameRows.length, methods: methods.length, ctRawRanges: 2 });

  const field = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/narshe.json"), "utf8"))),
    catalog = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/opening-playable.json"), "utf8")));
  assert.equal(field.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  assert.equal(field.sourceSetHash, catalog.common.fieldSourceSetHash);
  report.packages = { field: field.contentHash, catalog: catalog.contentHash };
  const initial = new GameSession(field, catalog, 1), owned = initial.state.snapshot(),
    tina = owned.roster.find(member => member.sourceId === 1), nameRow = nameRows.find(row => row.tag_name === "TINA");
  assert.ok(tina); assert.equal(Number(nameRow.character_id), 1);
  const tinaRef = { tag: nameRow.tag_name, sourceId: Number(nameRow.character_id), rowId: Number(nameRow.id) },
    view = initial.state.fieldMessageNames.prepare([tinaRef]); view.validate();
  assert.equal(hash(view.names[0]), hash(tina.name));
  check("actual-source1-held-name-ready", { ref: bound(tinaRef), nameHash: hash(view.names[0]) });

  const fieldIds = new Set(plan.scripts.filter(script => script.domain === "field").map(script => script.id)), samples = [];
  for (const asset of corpus.assets.filter(asset => asset.kind === "script" && fieldIds.has(asset.id))) {
    const instructions = asset.data.Mnemonics ?? [];
    for (const [index, raw] of instructions.entries()) {
      if (raw.mnemonic !== "Msg") continue;
      let op;
      const context = { nextMnemonic: instructions[index + 1]?.mnemonic ?? null },
        site = { script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
      try { op = compileManualMessageInstruction(raw, corpus.messages, context, nameRows); } catch { continue; }
      if (op.template) samples.push({ op: { ...site, ...op }, site, raw, context, refs: fieldMessageNameReferences(op.template) });
    }
  }
  const only = (sample, sourceId) => sample.refs.length && sample.refs.every(ref => ref.sourceId === sourceId),
    first = samples.find(sample => only(sample, 1) && sample.op.manual.after === "message" && sample.op.template.speaker.some(part => part.kind === "character-name")),
    body = samples.find(sample => only(sample, 1) && sample.op.manual.after === "close" && sample.op.template.pages.flat().some(part => part.kind === "character-name")),
    next = samples.find(sample => only(sample, 1) && sample.op.manual.after === "close" && sample.op.template.speaker.some(part => part.kind === "character-name")),
    missing = samples.find(sample => only(sample, 2) && sample.op.manual.after === "close");
  assert.ok(first && body && next && missing, "Source TINA body/speaker and unheld source2 samples are required");
  const sampleRecord = sample => ({ ...sample.site, rawOperands: sample.raw.operands, instructionHash: hash(sample.raw),
    nextMnemonic: sample.context.nextMnemonic, key: sample.op.key, templateHash: hash(sample.op.template),
    refs: sample.refs.map(bound), pageHashes: sample.op.manual.pages.map(hash), speakerHash: hash(sample.op.speaker) });
  report.sourceSamples = [first, body, next, missing].map(sampleRecord);
  const labels = { first: "controlled_v62_source_names_first", next: "controlled_v62_source_names_next",
    missing: "controlled_v62_source_names_missing", mismatch: "controlled_v62_source_names_mismatch" }, controlled = structuredClone(field),
    synthetic = { file: "controlled-field-message-names", assetPath: "Fixtures/FieldMessageNames/control" },
    exit = script => ({ kind: "exit", script, index: 0, source: synthetic });
  const otherHeld = owned.roster.find(member => member.sourceId !== 1 &&
    catalog.gameState.characterInitializations[member.id]?.nameTag === null); assert.ok(otherHeld);
  const mismatched = structuredClone(next.op);
  for (const part of [...mismatched.template.pages.flat(), ...mismatched.template.speaker])
    if (part.kind === "character-name") part.ref.sourceId = otherHeld.sourceId;
  for (const [script, ops] of [[labels.first, [first.op, body.op, exit(labels.first)]],
    [labels.next, [next.op, exit(labels.next)]], [labels.missing, [first.op, missing.op, exit(labels.missing)]],
    [labels.mismatch, [first.op, mismatched, exit(labels.mismatch)]]]) {
    assert.equal(controlled.scripts[script], undefined);
    controlled.scripts[script] = structuredClone(ops); controlled.scriptLocals[script] = null;
    controlled.scriptTransitionMetadata[script] = { customAnimations: "none" };
  }
  const { contentHash: discarded, ...payload } = controlled;
  controlled.contentHash = await contentDigest(payload); await verifyContent(controlled);
  report.controlledField = { contentHash: controlled.contentHash, originalFieldHash: field.contentHash,
    addedScripts: Object.values(labels), newStoryFlags: 0, assignedCharacterNames: 0,
    originalInstructionsUnmodifiedExceptDeclaredMismatchProbe: true, origin: "development-checkpoint" };
  const ready = { visible: true, mediaReady: true, overlayOpen: false }, make = () => {
    const game = new GameSession(controlled, catalog, 1), flow = new GameFlow(game); flow.start(); flow.advance(0, ready);
    assert.equal(flow.phase, "exploration"); return { game, flow };
  };
  const stage = (name, game, flow) => report.stages.push({ name, phase: flow.phase, mask: game.field.updateAttributeMask,
    ownedHash: hash(game.state.snapshot()), eventsHash: hash(game.field.eventState.snapshot()),
    projectionHash: hash(game.field.messageWindow), checkpointReady: game.checkpointReady });
  const projected = (game, sample) => {
    const names = game.state.fieldMessageNames.prepare(sample.refs); names.validate();
    const expected = resolveFieldMessageTemplate(sample.op.template, names.names), window = game.field.messageWindow;
    assert.ok(window); assert.equal(hash(window.text), hash(expected.pages[window.manual.page]));
    assert.equal(hash(window.speaker), hash(expected.speaker)); assert.equal(hash(window.manual.pages), hash(expected.pages));
    assert.equal(Object.hasOwn(window, "template"), false);
    assert.equal(window.text.includes("(TINA)"), false); assert.equal(window.speaker.includes("(TINA)"), false);
  };
  const confirm = (flow) => { flow.advance(10, ready); flow.confirm(); };
  const { game, flow } = make(), beforeOwned = hash(game.state.snapshot()), beforeEvents = hash(game.field.eventState.snapshot());
  assert.equal(game.field.startEvent(labels.first), true); projected(game, first); stage("source-speaker-resolved", game, flow);
  assert.throws(() => game.checkpoint(), /save/); const beforeWindow = hash(game.field.messageWindow);
  flow.confirm(); assert.equal(hash(game.field.messageWindow), beforeWindow);
  for (let page = 0; page < first.op.manual.pages.length; page++) confirm(flow);
  projected(game, body); stage("next-source-body-resolved", game, flow);
  assert.equal(game.field.updateAttributeMask, 9);
  for (let page = 0; page < body.op.manual.pages.length; page++) confirm(flow);
  assert.equal(game.field.stop, null); assert.equal(flow.phase, "exploration");
  assert.equal(game.field.messageWindow, null); assert.equal(game.field.updateAttributeMask, 3);
  assert.equal(hash(game.state.snapshot()), beforeOwned); assert.equal(hash(game.field.eventState.snapshot()), beforeEvents);
  stage("confirmed-and-stable", game, flow); check("real-owned-body-speaker-and-confirmation", { sourceInstructions: 2 });
  const saved = JSON.parse(JSON.stringify(game.checkpoint())), restored = GameSession.restore(saved, controlled, catalog),
    again = new GameFlow(restored); again.start(); again.advance(0, ready);
  assert.equal(hash(restored.state.snapshot()), beforeOwned); assert.equal(hash(restored.checkpoint().origin), hash(saved.origin));
  assert.equal(restored.field.startEvent(labels.next), true); projected(restored, next); stage("restored-next-source-message", restored, again);
  for (let page = 0; page < next.op.manual.pages.length; page++) confirm(again);
  assert.equal(again.phase, "exploration"); assert.equal(restored.checkpointReady, true);
  assert.equal(hash(restored.state.snapshot()), beforeOwned); check("same-owner-save-restore-and-next-message");

  for (const [name, script, reason] of [["missing-held-owner", labels.missing, /Missing owned message character/],
    ["mismatched-name-reference", labels.mismatch, /source\/tag mismatch/]]) {
    const { game: failed, flow: failedFlow } = make(); assert.equal(failed.field.startEvent(script), true); projected(failed, first);
    const heldWindow = hash(failed.field.messageWindow), ownedBefore = hash(failed.state.snapshot()), eventsBefore = hash(failed.field.eventState.snapshot());
    for (let page = 0; page < first.op.manual.pages.length; page++) confirm(failedFlow);
    assert.equal(failed.field.stop?.kind, "unsupported"); assert.match(failed.field.stop.message, reason);
    assert.equal(hash(failed.field.messageWindow), heldWindow); assert.equal(failed.field.updateAttributeMask, 9);
    assert.equal(hash(failed.state.snapshot()), ownedBefore); assert.equal(hash(failed.field.eventState.snapshot()), eventsBefore);
    assert.equal(failed.checkpointReady, false); stage(name + "-no-partial-publication", failed, failedFlow); check(name + "-no-partial-publication");
  }
  report.compiledModules = await Promise.all(["compiler/message", "compiler/message-template", "core/field-message-template",
    "core/owned-message-names", "core/game-state", "core/field", "core/game-session", "core/game-flow"].map(async name =>
    ({ module: name, sha256: sha(await readFile(resolve(compiled, "src", name + ".js"))) })));
  report.limitations = ["Source-backed instructions with controlled surrounding scripts; no original plot is played",
    "Actual opening owned source1 is used without new names, flags or character acquisition",
    "Unheld default-name initialization, rename workflow, general message parameters and timed/automatic pages remain unresolved",
    "Headless confirmation and projection checks establish neither original font/frame parity nor browser acceptance"];
  report.result = "passed";
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: "build/reports/field-message-names-check.json", result: report.result,
  checks: report.checks.length, stages: report.stages.length, nativeVerified: false, browserVerified: false }));
