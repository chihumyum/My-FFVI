// Real corpus/catalog binding with controlled host time and player layer.
// This exercises the owned phase, not source renderer/controller/GPS behavior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileTransportationCatalog } = await module("compiler/transportation");
const { compileFieldTransportationInstruction } = await module("compiler/field-transportation");
const { hash } = await module("compiler/content");
const { createNewGame } = await module("core/new-game");
const { GameState } = await module("core/game-state");
const { EventState } = await module("core/event-state");
const { Transportations } = await module("core/transportation");
const { transportationStayMaps } = await module("core/transportation-state");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = root + "build/reports/transportation-state-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-transportation-state-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/transportation-state-native-check.json");
const native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const battleSource = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
assert.equal(battleSource.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const publishedBytes = await readFile(root + "build/game/opening-playable.json"), published = JSON.parse(publishedBytes);
const { contentHash, ...body } = published;
assert.equal(contentHash, hash(body));
const plan = createNewGame(published.gameState.sourceNewGame);
const compiledCatalog = compileTransportationCatalog(battleTableIndex(corpus.tables, battleSource.tableSources),
  plan.nativeInitialization.ownedTransportationIds);
assert.deepEqual(compiledCatalog.catalog, published.gameState.sourceNewGame.transportation);
const path = "Assets/GameAssets/Serial/Res/Map/Map_40037/Map_40037/sc_e_0001_3.json";
const matches = corpus.assets.filter((a) => a.kind === "script" && a.source.assetPath === path);
assert.equal(matches.length, 1);
const script = matches[0], instruction = script.data.Mnemonics[4];
assert.equal(hash(script.data), "bdeeda0216401574d642ef5a81592a0ffdd49738162139c9e5bc959290bde3c8");
assert.equal(instruction.mnemonic, "SetVehicle");
const op = compileFieldTransportationInstruction(instruction);
assert.equal(op.command.kind, "place");
assert.equal(op.command.transportationId, 6);
const timeStampTicks = "638958585001234567", playerUnityLayer = 10;
const command = { id: op.command.transportationId, enable: true, mapId: op.command.stayMapId,
  position: op.command.position,
  layer: op.command.layer.kind === "player" ? playerUnityLayer : op.command.layer.value,
  direction: op.command.direction, timeStampTicks };
const fresh = () => GameState.createNewGame(published.gameState, published.common.players,
  contentHash, published.common.conditions);
const state = fresh(), events = new EventState(plan.events), before = state.snapshot();
const transportations = new Transportations(compiledCatalog.catalog), flag = transportations.releaseFlagRef(command.id);
const cases = [];
function check(name, run) { run(); cases.push({ name, pass: true }); }
check("source constructor creates eight complete distinct payloads without synthetic parked locations", () => {
  assert.equal(before.formatVersion, 10); assert.equal(before.nativeState.kind, "source-native-state-v2");
  assert.equal(before.nativeState.ownedTransportations.length, 8);
  assert.deepEqual(before.nativeState.ownedTransportations, plan.nativeInitialization.ownedTransportationIds.map((id) => ({
    id, mapId: -1, position: { x: 1000, y: 1000, z: -1000 }, direction: 0, timeStampTicks: "0",
  })));
  assert.equal(events.read(flag), 0);
});
const tx = state.fieldTransportation.prepare(command), projected = structuredClone(tx.after);
check("exact SetVehicle operands prepare every owned field without writing flags or owner", () => {
  assert.deepEqual(tx.after, { id: command.id, mapId: command.mapId,
    position: { ...command.position, z: ({ 9: 349, 10: 249, 11: 149, 12: 49 })[command.layer] },
    direction: command.direction, timeStampTicks });
  tx.validate(); assert.deepEqual(state.snapshot(), before); assert.equal(events.read(flag), 0);
});
check("prepublication host failure keeps owned and release flag untouched", () => {
  assert.throws(() => tx.commitWith(() => { throw new Error("controlled host failure"); }), /controlled host failure/);
  assert.deepEqual(state.snapshot(), before); assert.equal(events.read(flag), 0);
});
check("joint owned and release-flag commit changes only the source payload and independent flag", () => {
  tx.commitWith(() => events.write(flag, 1));
  assert.deepEqual(state.fieldTransportation.read().find((record) => record.id === command.id), projected);
  assert.equal(events.read(flag), 1);
  assert.equal(transportationStayMaps(state.nativeState.ownedTransportations)[command.id], command.mapId);
  assert.deepEqual(state.nativeState.entrySeed, before.nativeState.entrySeed);
  assert.throws(tx.commit, /Stale/);
});
check("parking survives JSON restore with exact timestamp and all other source-owned domains unchanged", () => {
  const snapshot = JSON.parse(JSON.stringify(state.snapshot())), restored = fresh();
  restored.restore(snapshot); assert.deepEqual(restored.snapshot(), snapshot);
  const { ownedTransportations: _, ...rest } = restored.nativeState;
  const { ownedTransportations: __, ...original } = before.nativeState;
  assert.deepEqual(rest, original);
  assert.equal(restored.fieldTransportation.read().find((record) => record.id === command.id).timeStampTicks, timeStampTicks);
});
check("disabled nullable update preserves location, direction and timestamp while changing parked map", () => {
  const next = state.fieldTransportation.prepare({ ...command, enable: false, mapId: -1,
    position: null, layer: null, direction: null, timeStampTicks: null });
  next.commitWith(() => events.write(flag, 0));
  assert.deepEqual(next.after, { ...projected, mapId: -1 }); assert.equal(events.read(flag), 0);
});
check("stale shared map candidate cannot overwrite newer parking or publish its flag callback", () => {
  const draft = state.prepareFieldState(), candidate = draft.ports.transportation.prepare(command);
  state.fieldTransportation.prepare({ ...command, mapId: 777 }).commit();
  const current = state.snapshot(); let called = false;
  assert.throws(() => candidate.commitWith(() => { called = true; }), /Stale/);
  assert.equal(called, false); assert.equal(draft.commit(), false); assert.deepEqual(state.snapshot(), current);
});
let corruptions = 0;
check("incomplete payloads, foreign identities and prior owned schema reject without partial restore", () => {
  const current = state.snapshot();
  for (const mutate of [s => { delete s.nativeState.ownedTransportations[0].position.z; },
    s => { s.nativeState.ownedTransportations[0].id = 999; },
    s => { s.nativeState.ownedTransportations[0].timeStampTicks = Number(timeStampTicks); },
    s => { s.formatVersion = 9; }]) {
    const saved = structuredClone(current); mutate(saved);
    assert.throws(() => state.restore(saved)); assert.deepEqual(state.snapshot(), current); corruptions++;
  }
});
const implementation = await Promise.all(["src/core/transportation-state.ts", "src/core/source-native-state.ts",
  "src/core/game-state.ts", "src/compiler/field-transportation.ts"].map(async file => ({ file, sha256: sha(await readFile(root + file)) })));
const report = { formatVersion: 1, kind: "transportation-state-source-check", status: "pass", cases,
  sourceSetHash: corpus.manifest.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  catalogHash: contentHash, catalogFileSha256: sha(publishedBytes), profile: published.common.profile,
  nativeReportSha256: sha(nativeBytes), nativeSha256: native.nativeSha256, implementation,
  sourceScript: { source: script.source, hash: hash(script.data), instruction: 4, op },
  controlledHost: { playerUnityLayer, timeStampTicks, scope: "owned phase; no source field/controller/GPS publication" },
  counts: { cases: cases.length, sourceTransportations: compiledCatalog.catalog.definitions.length,
    nativeMethods: native.methods.length, rawMethods: native.raw.length, rejectedCorruptions: corruptions },
  originalGameExecuted: false, semanticsVerified: false,
  limitations: ["The entire source script is not executed by this checker; only its unchanged SetVehicle operand is consumed.",
    "Controlled player layer and timestamp are explicit inputs, not original-process observations.",
    "Runtime controller/appearance, map GPS and transport collision/audio remain separate host providers."] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", ...report.counts, reportSha256: sha(await readFile(output)), semanticsVerified: false }));
