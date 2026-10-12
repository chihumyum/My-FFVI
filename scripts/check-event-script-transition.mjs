// All source ChangeScript forms plus unchanged source programs in a controlled
// field. The fixture supplies event inputs, not story-reachability evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"),
  module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { loadCorpus } = await module("compiler/corpus"),
  { loadSystemMessages } = await module("compiler/system-messages"),
  { bindMapPackages, resolveMapScript } = await module("compiler/map-package"),
  { hash } = await module("compiler/content"),
  { compileEventScriptTransitionInstruction, compileEventScriptTransitionMetadata } = await module("compiler/event-script-transition"),
  { decodeFieldOp, decodeScriptLocals } = await module("compiler/field"),
  { FieldGame } = await module("core/field"),
  { EventState } = await module("core/event-state");
const output = root + "build/reports/event-script-transition-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-event-script-transition-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/event-script-transition-native-check.json"),
  native = JSON.parse(nativeBytes), corpus = await loadCorpus(root),
  system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources),
  messages = { ...corpus.messages, system_zhc: system.messages },
  scripts = corpus.assets.filter((a) => a.kind === "script"),
  assets = new Map(scripts.map((a) => [a.id, a]));
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
assert.equal(native.semanticsVerified, false);
const site = (asset, index) => ({ script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } }),
  calls = [], blocked = [], metadata = [], metadataBlocked = [];
for (const asset of scripts) {
  try {
    const result = compileEventScriptTransitionMetadata(asset.data);
    assert.deepEqual(result, { customAnimations: "none" });
    metadata.push({ assetId: asset.id, source: asset.source, metadata: result });
  } catch (error) {
    metadataBlocked.push({ assetId: asset.id, source: asset.source, reason: error.message });
  }
  for (const [index, instruction] of (asset.data.Mnemonics ?? []).entries()) {
    if (instruction.mnemonic !== "ChangeScript") continue;
    let op;
    try { op = compileEventScriptTransitionInstruction(instruction); }
    catch (error) { blocked.push({ ...site(asset, index), reason: error.message }); continue; }
    assert.equal(op.targetScript, instruction.operands.sValues[0]);
    assert.equal(op.returnToCaller, instruction.operands.iValues[0] !== 0);
    const decoded = decodeFieldOp(instruction, site(asset, index), messages, corpus.tables);
    assert.deepEqual(decoded, { ...site(asset, index), ...op });
    assert.equal(decoded.script, asset.data.Name, "target must not overwrite instruction provenance");
    calls.push({ ...site(asset, index), assetId: asset.id, instructionHash: hash(instruction), opHash: hash(op),
      targetScript: op.targetScript, returnToCaller: op.returnToCaller });
  }
}
assert.equal(calls.length + blocked.length, 358);
assert.equal(blocked.length, 0);
assert.equal(new Set(calls.map((call) => call.assetId)).size, 302);
assert.equal(calls.filter((call) => call.returnToCaller).length, 135);
assert.equal(calls.filter((call) => !call.returnToCaller).length, 223);
assert.equal(metadata.length, 2615);
assert.equal(metadata.length + metadataBlocked.length, scripts.length);

// Only these source-bound controlled journeys need map alias resolution. This
// does not compute a world traversal or infer which story can reach a script.
const bindings = bindMapPackages(corpus.assets, corpus.tables);
function fixture(mapId, callerName) {
  const binding = bindings.find((map) => map.id === String(mapId));
  assert.ok(binding);
  const callerId = resolveMapScript(binding, callerName), caller = assets.get(callerId);
  assert.ok(caller, callerName);
  const sourceCall = caller.data.Mnemonics.find((raw) => raw.mnemonic === "ChangeScript");
  assert.ok(sourceCall);
  const targetName = sourceCall.operands.sValues[0], targetId = resolveMapScript(binding, targetName), target = assets.get(targetId);
  assert.ok(target, targetName);
  const named = [[callerName, caller], [targetName, target]], ops = {};
  for (const [name, asset] of named) {
    assert.equal(asset.data.Mnemonics[0].mnemonic, "Nop");
    assert.deepEqual(asset.data.Segments, [{ Count: asset.data.Mnemonics.length, EntryPoint: 0, Label: "Main" }]);
    ops[name] = asset.data.Mnemonics.map((raw, index) => decodeFieldOp(raw, site(asset, index), messages, corpus.tables, {
      nextMnemonic: asset.data.Mnemonics[index + 1]?.mnemonic ?? null,
    }));
  }
  const content = {
    formatVersion: 1, kind: "field-development", sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    contentHash: hash({ kind: "controlled-source-script-transition", caller: caller.id, target: target.id, ops }),
    map: { id: "controlled-source-script-transition", width: 1, height: 1, tileSize: 16,
      layers: [], tilesets: [], textures: {}, collisions: { 1: [0] }, entities: [], source: caller.source },
    characters: {}, scripts: ops,
    scriptLocals: Object.fromEntries(named.map(([name, asset]) => [name, decodeScriptLocals(asset.data)])),
    scriptTransitionMetadata: Object.fromEntries(named.map(([name, asset]) => [name, compileEventScriptTransitionMetadata(asset.data)])),
    entry: { player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description: "Controlled geometry and event values; full bound source programs are unchanged",
      evidence: named.map(([, asset]) => asset.source) },
    limitations: ["controlled-geometry", "controlled-event-state", "no-native-host", "no-original-oracle"],
  };
  return { content, callerName, targetName, named };
}
function run(f, state, answer) {
  const field = new FieldGame(f.content, state), shown = [], chosen = [];
  assert.equal(field.startEvent(f.callerName), true);
  for (let step = 0; step < 2000 && field.busy && !field.stop; step++) {
    if (field.choice) {
      assert.equal(typeof answer, "number", "unexpected choice in controlled journey");
      chosen.push({ script: field.choice.script ?? f.targetName, answer });
      assert.equal(field.choose(field.choice.id, answer), true);
    } else if (field.dialogue) {
      if (field.dialogue.manual) field.advance(10);
      shown.push(field.dialogue.key); field.confirm();
    }
    else field.advance(10);
  }
  assert.ok(!field.busy || field.stop, "controlled source journey exceeded its clock budget");
  return { field, shown, chosen };
}
const journeys = [];
{
  const f = fixture(539, "sc_e_0946_0"), state = EventState.initialized(),
    { field, shown } = run(f, state);
  assert.equal(state.read({ category: "ScenarioFlag4", index: 200 }), 1, "callee SetFlag must be published before return");
  assert.equal(field.stop?.kind, "unsupported");
  assert.equal(field.stop?.site?.script, f.callerName);
  assert.equal(field.stop?.site?.index, 2, "hook must resume immediately after ChangeScript");
  assert.equal(field.stop?.site?.mnemonic, "SysCall");
  assert.equal(field.checkpointReady, false);
  journeys.push({ mapId: 539, caller: f.callerName, target: f.targetName, mode: "return", outcome: field.stop,
    changedFlag: { category: "ScenarioFlag4", index: 200, value: 1 }, shown,
    evidence: f.named.map(([, a]) => ({ source: a.source, scriptHash: hash(a.data) })) });
}
for (const answer of [0, 1]) {
  const f = fixture(121, "sc_e_0414"), state = EventState.initialized();
  state.write({ category: "ScenarioFlag1", index: 225 }, 1);
  const { field, shown, chosen } = run(f, state, answer);
  assert.equal(chosen.length, 1);
  assert.ok(shown.includes("E0462_00_120_a_01"), "replacement must start the target source program");
  assert.ok(!shown.includes("E0414_00_120_a_01"), "old caller's other branch must not resume");
  assert.equal(state.read({ category: "MessageSelection", index: 0 }), answer);
  let checkpointRestored = false;
  if (answer === 0) {
    assert.equal(field.stop?.kind, "unsupported");
    assert.equal(field.stop?.site?.script, f.targetName);
    assert.equal(field.stop?.site?.index, 8, "unknown recovery host stays blocked in the callee");
    assert.equal(field.checkpointReady, false);
  } else {
    assert.equal(field.stop, null);
    assert.equal(field.checkpointReady, true);
    const restored = FieldGame.restore(f.content, JSON.parse(JSON.stringify(field.checkpoint())));
    assert.equal(restored.eventState.read({ category: "MessageSelection", index: 0 }), 1);
    assert.equal(restored.busy, false);
    checkpointRestored = true;
  }
  journeys.push({ mapId: 121, caller: f.callerName, target: f.targetName, mode: "replace", answer, shown,
    outcome: field.stop ?? { kind: "finished" }, checkpointRestored,
    evidence: f.named.map(([, a]) => ({ source: a.source, scriptHash: hash(a.data) })) });
}
const failedPreflights = [];
for (const missing of ["target", "target-metadata", "caller-metadata"]) {
  const f = fixture(539, "sc_e_0946_0"), state = EventState.initialized();
  if (missing === "target") delete f.content.scripts[f.targetName];
  else delete f.content.scriptTransitionMetadata[missing === "caller-metadata" ? f.callerName : f.targetName];
  const { field } = run(f, state);
  assert.equal(field.stop?.kind, "unsupported");
  assert.equal(field.stop?.site?.index, 1);
  assert.equal(state.read({ category: "ScenarioFlag4", index: 200 }), 0, "failed switch must not run the target");
  assert.equal(field.checkpointReady, false);
  failedPreflights.push({ missing, reason: field.stop.reason });
}
const report = {
  kind: "source-event-script-transition", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeReportSha256: sha(nativeBytes),
  nativeSha256: native.nativeSha256, systemMessageSource: system.source,
  admitted: { sites: calls.length, scriptAssets: 302, replace: 223, returnToCaller: 135 },
  calls, blocked, customAnimationMetadata: { admitted: metadata.length, blocked: metadataBlocked.length,
    scripts: metadata, blockers: metadataBlocked }, journeys, failedPreflights,
  semanticsVerified: false, originalGameExecuted: false,
  limits: ["Decoding and controlled source execution do not establish story reachability or playable-map coverage",
    "The fixture has controlled geometry/event values and no native actor lifecycle host",
    "Nonempty or missing custom animation metadata remains blocked",
    "Source provider gaps after the transition remain explicit stops; no source instruction is removed"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", sites: calls.length, scriptAssets: 302,
  metadataAdmitted: metadata.length, metadataBlocked: metadataBlocked.length,
  sourceJourneys: journeys.length, failedPreflights: failedPreflights.length,
  semanticsVerified: false, originalGameExecuted: false }));
