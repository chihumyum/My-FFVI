// Real source instructions, explicit controlled owners and no native execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"));
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus"), { hash } = await module("compiler/content");
const { compileFieldCameraInstruction, compileFieldCameraMotionInstruction, compileFieldCameraMapRange, fieldCameraSelectors } = await module("compiler/field-camera");
const { createFieldCameraState, fieldCameraActorFromCell, projectFieldCameraTarget, projectFieldCamera,
  projectFieldCameraSetPosition, stepFieldCameraLerp, fieldCameraWorldToContinuousCell,
  validateFieldCameraState, validateFieldCameraLerpProgress,
  fieldCameraSelectsDummyAtScriptStart, fieldCameraRestoresPlayerAtScriptEnd } = await module("core/field-camera");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const output = root + "build/reports/field-camera-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-camera-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-camera-native-check.json");
const native = JSON.parse(nativeBytes), corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const calls = [], transitions = [];
const tilemap = corpus.assets.filter((a) => a.source.assetPath === "Assets/GameAssets/Serial/Res/Map/Map_40037/Map_40037/tilemap.json");
const objects = corpus.assets.filter((a) => a.source.assetPath === "Assets/GameAssets/Serial/Res/Map/Map_40037/Map_40037/entity_default.json");
assert.equal(tilemap.length, 1); assert.equal(objects.length, 1);
const map = compileFieldCameraMapRange(tilemap[0].data, objects[0].data);
assert.deepEqual(map, { x: 0, y: 0, width: 42, height: 32 });
const player = fieldCameraActorFromCell(map, { x: 26, y: 7 }, 0, "right", { x: 0, y: 0 });
for (const asset of corpus.assets.filter((a) => a.kind === "script"))
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (raw.mnemonic !== "SysCall" || !fieldCameraSelectors.includes(raw.operands?.sValues?.[0])) continue;
    const op = compileFieldCameraInstruction(raw);
    const site = { script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    assert.equal(typeof site.source.objectId, "string");
    calls.push({ site, instructionHash: hash(raw), op });
    for (const previous of ["player", "dummy"]) {
      const state = projectFieldCameraTarget(createFieldCameraState(), { target: previous }, player, { 9: 349 }).state;
      if (previous === "dummy") state.dummy.position.x += 24;
      const before = structuredClone(state), plan = projectFieldCameraTarget(state, op.command, player, { 9: 349 });
      assert.equal(plan.state.target, op.command.target);
      assert.deepEqual(state, before);
      if (op.command.target === "dummy") assert.equal(plan.state.dummy.position.x,
        previous === "dummy" ? before.dummy.position.x : player.position.x);
      else assert.deepEqual(plan.state.dummy, before.dummy);
      const restored = JSON.parse(JSON.stringify(plan.state)); validateFieldCameraState(restored);
      assert.deepEqual(projectFieldCamera(restored, player, { x: 16, y: -8 }),
        projectFieldCamera(plan.state, player, { x: 16, y: -8 }));
      transitions.push({ script: site.script, index, previous, target: op.command.target,
        beforeUnchanged: true, checkpointRoundTrip: true });
    }
  }
assert.equal(calls.length, 34);
const initial = corpus.assets.filter((a) => a.kind === "script" && a.data.Name === "sc_e_0001");
assert.equal(initial.length, 1);
const asset = initial[0], rawSet = asset.data.Mnemonics[26], rawLerp = asset.data.Mnemonics[33];
assert.equal(rawSet.mnemonic, "SetPos"); assert.equal(rawLerp.mnemonic, "Lerp");
const set = compileFieldCameraMotionInstruction(rawSet), lerp = compileFieldCameraMotionInstruction(rawLerp);
assert.deepEqual(set.command, { kind: "set-position", x: 29, y: 5, layer: 0 });
assert.deepEqual(lerp.command, { kind: "lerp", x: 29, y: 24, layer: 0, duration: 11, arcHeight: 0 });
assert.equal(fieldCameraSelectsDummyAtScriptStart(true), true);
let camera = projectFieldCameraTarget(createFieldCameraState(), { target: "dummy" }, player, { 9: 349 }).state;
const setPlan = projectFieldCameraSetPosition(camera, set.command, map); camera = setPlan.state;
assert.deepEqual(fieldCameraWorldToContinuousCell(map, { x: camera.dummy.position.x, y: camera.dummy.position.y }), { x: 29, y: 5 });
assert.equal(setPlan.notifySetPosition.sourceEntityId, 0);
const samples = [], first = stepFieldCameraLerp(camera, lerp.command, map, null, 2);
assert.equal(first.flow, "wait");
assert.deepEqual(first.state.dummy.position, { ...camera.dummy.position, z: 344 });
for (const elapsed of [0, 0.01, 5.5, 10.99, 11, 12]) {
  const candidate = stepFieldCameraLerp(first.state, lerp.command, map, first.progress, 2 + elapsed);
  const saved = JSON.parse(JSON.stringify(candidate)); validateFieldCameraState(saved.state);
  validateFieldCameraLerpProgress(saved.progress);
  const same = stepFieldCameraLerp(saved.state, lerp.command, map, saved.progress, 2 + elapsed);
  assert.deepEqual(same, candidate);
  assert.equal(candidate.flow, elapsed >= 11 ? "next" : "wait");
  samples.push({ elapsed, flow: candidate.flow,
    cell: fieldCameraWorldToContinuousCell(map, { x: candidate.state.dummy.position.x, y: candidate.state.dummy.position.y }),
    z: candidate.state.dummy.position.z, checkpointRoundTrip: true });
}
assert.deepEqual(samples.find((s) => s.elapsed === 5.5)?.cell, { x: 29, y: 14.5 });
assert.deepEqual(samples.find((s) => s.elapsed === 11)?.cell, { x: 29, y: 24 });
assert.equal(fieldCameraRestoresPlayerAtScriptEnd(1), false);
assert.equal(fieldCameraRestoresPlayerAtScriptEnd(0), true);
const report = { lane: "source-field-camera-controlled-projection", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeReportSha256: sha(nativeBytes), calls, transitions,
  sourceMotion: { script: asset.data.Name, source: asset.source, setIndex: 26, lerpIndex: 33,
    set, lerp, instructionHashes: [hash(rawSet), hash(rawLerp)], samples,
    setPositionCallback: "returned effect descriptor; this pure probe does not claim an arbitrary callback host",
    mapRange: { ...map, sources: [tilemap[0].source, objects[0].source],
      provenance: "source MapAssetLoader seed and ParseMapRange first-type27 rule; source opening has no type27 override" } },
  semanticsVerified: false, originalGameExecuted: false,
  doesNotEstablish: ["native-dynamic-parity", "full-prelude-field-execution", "browser-camera-or-viewport-parity",
    "formal-field-host-admission", "arbitrary-animation-or-SetPos-callback", "reachable-map-coverage"] };
const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
console.log(JSON.stringify({ sourceSelectors: calls.length, controlledTargetTransitions: transitions.length,
  sourceMotionInstructions: 2, controlledMotionSamples: samples.length, reportSha256: sha(bytes),
  semanticsVerified: false, originalGameExecuted: false }));
