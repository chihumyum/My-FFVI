// Source flags and ownership/media are real; actor factory coordinates and
// rendering/transport context below are controlled, not a playable scene claim.
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
const { hash } = await module("compiler/content");
const { compileFieldPuppetActorCatalog, compileFieldPuppetScriptContext } = await module("compiler/field-puppet-actors");
const { compileFieldTaskControlInstruction } = await module("compiler/field-task-control");
const { projectFieldPuppetInitialization, projectFieldPuppetActorEntry, fieldPuppetLeaderId,
  resolveFieldPuppetActor, fieldPuppetResidentIndex } = await module("core/field-puppet-actors");
const { projectFieldPuppetActorEffects, fieldPuppetSemiTransparent, projectFieldPuppetCollision } = await module("core/field-puppet-effects");
const { ActorAnimation } = await module("core/actor-animation");
const { GameState } = await module("core/game-state");
const { partyMemberFieldAsset } = await module("core/party-actors");
const output = root + "build/reports/field-puppet-actors-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-puppet-actors-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-puppet-actors-native-check.json"), native = JSON.parse(nativeBytes);
const corpus = await loadCorpus(root), battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
assert.equal(battle.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
assert.equal(hash(battle.sources), battle.sourceSetHash);
const miscRows = Object.values(battle.assets).filter((a) => a.source.assetPath === "Assets/GameAssets/Serial/Data/Misc/serial_misc_assets.json");
assert.equal(miscRows.length, 1);
const misc = miscRows[0], catalog = compileFieldPuppetActorCatalog(misc.data);
assert.equal(catalog.residents.length, 45);
assert.deepEqual(catalog.corpsOrder, [0, 1, 2, 3]);
assert.deepEqual(catalog.conditionChanges, [
  { type: 665, residentCharacterId: 202 }, { type: 666, residentCharacterId: 203 }, { type: 677, residentCharacterId: 205 },
]);
const sourceFile = corpus.manifest.sources.find((s) => s.file.endsWith("/" + misc.source.file));
assert.ok(sourceFile);
assert.equal(battle.sources.find((s) => s.file === sourceFile.file)?.sha256, sourceFile.sha256);
assert.equal(createHash("sha256").update(await readFile(root + "build/runtime/game/" + sourceFile.file)).digest("hex"), sourceFile.sha256);
const fields = ["SkipInitialize", "KeepPlayerPuppet", "KeepBadStatusVisual", "RidingVehicle"];
const contexts = [], blocked = [], combinations = {}, entryCounts = {};
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  let context;
  try { context = compileFieldPuppetScriptContext(asset.data, misc.data); }
  catch (error) {
    const missing = fields.filter((field) => !Number.isInteger(asset.data.SystemFlag?.[field]));
    assert.ok(missing.length > 0, "Unexpected complete source flag rejection");
    blocked.push({ id: asset.id, source: asset.source, scriptHash: hash(asset.data), missing, reason: error.message });
    continue;
  }
  assert.equal(context.scriptHash, hash(asset.data)); assert.equal(context.miscHash, hash(misc.data));
  for (const [key, sourceKey] of [["skipInitialize", "SkipInitialize"], ["keepPlayerPuppet", "KeepPlayerPuppet"],
    ["keepBadStatusVisual", "KeepBadStatusVisual"], ["ridingVehicle", "RidingVehicle"]])
    assert.equal(context[key], asset.data.SystemFlag[sourceKey] !== 0);
  const flags = fields.map((field) => asset.data.SystemFlag[field]).join(","); combinations[flags] = (combinations[flags] ?? 0) + 1;
  for (const raw of asset.data.Mnemonics ?? []) {
    if (raw.mnemonic !== "SetPuppet") continue;
    try {
      const op = compileFieldTaskControlInstruction(raw), id = Number(op.actor);
      const kind = id === 0 ? "camera" : id === -1010 ? "condition-leader" : id === -1020 ? "companion"
        : id >= -1032 && id <= -1030 ? "other-party" : id < -1000 ? "party-puppet" : id < 0 ? "resident" : "positive-entity";
      entryCounts[kind] = (entryCounts[kind] ?? 0) + 1;
    } catch { entryCounts.incomplete = (entryCounts.incomplete ?? 0) + 1; }
  }
  contexts.push({ asset, context });
}
assert.equal(contexts.length, 2771); assert.equal(blocked.length, 533);
assert.deepEqual(combinations, { "0,0,0,0": 2191, "0,1,0,0": 141, "0,0,1,0": 338, "0,1,1,0": 101 });
const published = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const { contentHash, ...publishedBody } = published; assert.equal(hash(publishedBody), contentHash);
const field = JSON.parse(await readFile(root + "build/game/narshe.json", "utf8"));
const { contentHash: fieldHash, ...fieldBody } = field; assert.equal(hash(fieldBody), fieldHash);
assert.equal(field.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const ownedState = GameState.createNewGame(published.gameState, published.common.players, contentHash, published.common.conditions);
const owned = ownedState.snapshot(), beforeOwned = JSON.stringify(owned);
assert.deepEqual(owned.roster.map((r) => r.sourceId), [1, 31, 32]);
assert.ok(owned.roster.every((r) => r.conditionIds.length === 0));
const cells = owned.party.slots[owned.party.selectedSlot];
const party = cells.map((cell) => cell.id === null ? 0 : owned.roster.find((r) => r.id === cell.id).ownedId);
assert.deepEqual(party, [1, 2, 3, 0]);
const mediaBindings = owned.roster.map((member) => {
  const source = corpus.tables["character_asset.csv"].find((r) => Number(r.character_id) === member.sourceId && Number(r.job_id) === member.jobId);
  assert.ok(source);
  const sourceField = corpus.tables["field_character_asset.csv"].find((r) => r.id === source.field_character_asset_id);
  assert.ok(sourceField);
  const projected = partyMemberFieldAsset(published.gameState.partyActors, member);
  assert.equal(projected.id, Number(source.field_character_asset_id)); assert.equal(projected.asset, sourceField.asset_name);
  const character = field.characters[projected.asset]; assert.ok(character);
  return { ownedId: member.ownedId, sourceId: member.sourceId, jobId: member.jobId,
    fieldAssetId: projected.id, asset: projected.asset, character, source: character.source };
});
assert.deepEqual(mediaBindings.map((r) => r.fieldAssetId), [1, 31, 31]);
let verifiedSpriteFiles = 0;
const seenSpriteFiles = new Set();
for (const { character } of mediaBindings) for (const sprite of Object.values(character.sprites)) {
  if (seenSpriteFiles.has(sprite.file)) continue;
  assert.ok(sprite.file.startsWith("/field/sprites/") && !sprite.file.includes(".."));
  assert.equal(createHash("sha256").update(await readFile(root + "build" + sprite.file)).digest("hex"), sprite.sha256);
  seenSpriteFiles.add(sprite.file); verifiedSpriteFiles++;
}
const context = {
  player: "actual-player", camera: "camera-zero",
  actors: ["actual-player", "puppet:0", "puppet:1", "puppet:2"].map((id) => ({ id, character: true, riding: false })),
  partyPuppets: ["puppet:0", "puppet:1", "puppet:2", null], otherParties: [null, null, null],
  residents: catalog.residents.map((r) => ({ assetId: r.assetId, actor: null })), entities: [], party,
  owned: owned.roster.map((r) => ({ ownedId: r.ownedId, sourceId: r.sourceId, enabled: r.enabled,
    conditionTypes: r.conditionIds.map((id) => published.gameState.partyActors.conditionTypes[id]) })),
  savedLeaderIndex: 0, conditionController: "present", companion: "absent", transport: { id: 1, typeId: 1 },
  restorePartyInstruction: "absent",
};
assert.equal(fieldPuppetLeaderId(catalog, context), -1001);
assert.equal(resolveFieldPuppetActor(catalog, context, -1001).actor, "puppet:0");
assert.notEqual(resolveFieldPuppetActor(catalog, context, -1001).actor, context.player);
for (const [resident, index] of [[1, 0], [31, 1], [32, 2]]) {
  assert.equal(fieldPuppetResidentIndex(catalog, context, resident), index);
  assert.equal(resolveFieldPuppetActor(catalog, context, -resident).actor, "puppet:" + index);
}
const makeSnapshot = () => ({
  actors: context.actors.map((actor) => {
    const index = actor.id === "actual-player" ? 0 : Number(actor.id.split(":")[1]);
    const animation = new ActorAnimation(mediaBindings[index].character); animation.cue("Default", -1);
    return { ...actor, position: actor.id === "actual-player" ? { x: 128, y: -64, z: 0 } : { x: 0, y: 0, z: 0 },
      layer: 9, direction: "down", animation, visible: actor.id === "actual-player", fadeAlpha: actor.id === "actual-player" ? 1 : 0,
      childEntityObject: "absent", moving: false, riderAssetId: null, rideOnEntity: "idle", bodyOpaque: true, shadowVisible: true,
      viewBinding: { map: "controlled-source-map", layer: 9 }, transparentTextures: { first: null, second: null } };
  }), camera: { id: "camera-zero", position: { x: 0, y: 0, z: 0 }, layer: 9 },
});
const providers = { mapRenderContext: "controlled-source-map", transportationType: 1,
  footAttribute: () => 0, upperTexture: null, ceilTexture: null };
const serial = (s) => ({ camera: s.camera, actors: s.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() })) });
const sourceEntry = contexts.flatMap(({ asset, context }) => asset.data.Mnemonics.flatMap((raw, index) =>
  raw.mnemonic === "SetPuppet" && raw.operands?.iValues?.[1] === -1001 &&
    asset.data.Mnemonics[raw.operands.iValues[2] + 1]?.mnemonic !== "Hide"
    ? [{ asset, script: context, raw, index }] : [])).find((r) => !r.script.keepPlayerPuppet && !r.script.keepBadStatusVisual);
assert.ok(sourceEntry);
const controlled = [];
for (const keep of [false, true]) for (const bad of [false, true]) {
  const source = contexts.find((r) => r.context.keepPlayerPuppet === keep && r.context.keepBadStatusVisual === bad);
  assert.ok(source);
  const snapshot = makeSnapshot(), before = serial(snapshot), script = source.context;
  const start = projectFieldPuppetInitialization({ phase: "start", catalog, context, script });
  let candidate = projectFieldPuppetActorEffects(start.effects, snapshot, providers);
  assert.deepEqual(serial(snapshot), before);
  assert.equal(start.leaderId, -1001); assert.deepEqual(start.assignments, [false, false, false, false, false]);
  assert.deepEqual(candidate.camera.position, { x: 128, y: -64, z: 0 });
  assert.equal(candidate.actors[0].visible, !keep);
  assert.equal(candidate.actors[1].visible, keep);
  for (const a of candidate.actors.slice(1)) assert.deepEqual(a.position, { x: 128, y: -64, z: 0 });
  const decoded = compileFieldTaskControlInstruction(sourceEntry.raw);
  const entry = projectFieldPuppetActorEntry({ catalog, context, script, entityId: Number(decoded.actor),
    nextMnemonic: sourceEntry.asset.data.Mnemonics[decoded.target + 1].mnemonic, leaderId: start.leaderId, assignments: start.assignments });
  assert.equal(entry.actor, "puppet:0"); assert.equal(entry.skipEntry, false);
  candidate = projectFieldPuppetActorEffects([...entry.effects, { kind: "show", actor: entry.actor }], candidate, providers);
  assert.equal(candidate.actors[0].visible, false); assert.equal(candidate.actors[1].visible, true);
  // Controlled movement after source Ready; this is not source script execution.
  candidate.actors[1].position.x = 144; candidate.actors[1].direction = "left";
  candidate.actors[1].animation.look("left");
  const finish = projectFieldPuppetInitialization({ phase: "finish", catalog, context, script });
  const ended = projectFieldPuppetActorEffects(finish.effects, candidate, providers);
  assert.equal(ended.actors[0].position.x, 144); assert.equal(ended.actors[0].direction, "left");
  assert.equal(ended.actors[0].visible, true); assert.ok(ended.actors.slice(1).every((a) => !a.visible));
  // Finish first LookAt(left), then CueAnimation(source current key,-1).
  // The source WalkL asset has a next alias, so the second request alternates
  // to WalkL-S rather than cloning the leader's playback key/state.
  assert.equal(candidate.actors[1].animation.snapshot().key, "WalkL");
  const expectedFinalKey = mediaBindings[0].character.animations.WalkL.next;
  assert.equal(expectedFinalKey, "WalkL-S");
  assert.equal(ended.actors[0].animation.snapshot().key, expectedFinalKey);
  controlled.push({ source: source.asset.source, scriptHash: script.scriptHash, flags: source.asset.data.SystemFlag,
    entrySource: { ...sourceEntry.asset.source, pointer: `/Mnemonics/${sourceEntry.index}` },
    entryHash: hash(sourceEntry.raw), start, entry, finish, final: serial(ended) });
}
const sample = contexts.find((r) => !r.context.keepPlayerPuppet && !r.context.keepBadStatusVisual).context;
const gateChecks = [];
for (const [name, changed, pattern] of [
  ["unknown-companion", { ...context, companion: "unknown" }, /companion/],
  ["restore-callback", { ...context, restorePartyInstruction: "present" }, /RestoreParty|restore/i],
  ["condition-stand-in", { ...context, owned: context.owned.map((o, i) => i === 0 ? { ...o, conditionTypes: [665] } : o) }, /stand-in/],
]) {
  assert.throws(() => projectFieldPuppetInitialization({ phase: "start", catalog, context: changed, script: sample }), pattern);
  gateChecks.push(name);
}
const missing = makeSnapshot(); missing.actors[1].animation = null;
const missingBefore = serial(missing), plan = projectFieldPuppetInitialization({ phase: "start", catalog, context, script: sample });
assert.throws(() => projectFieldPuppetActorEffects(plan.effects, missing, providers), /animation/);
assert.deepEqual(serial(missing), missingBefore); gateChecks.push("missing-media-atomic");
assert.equal(fieldPuppetSemiTransparent(9, 10), true); assert.equal(fieldPuppetSemiTransparent(1, 10), false);
assert.equal(fieldPuppetSemiTransparent(1, 30), true); assert.equal(fieldPuppetSemiTransparent(null, 0), false);
assert.deepEqual(projectFieldPuppetCollision(false), { mapColliders: false, entityCollision: false, interactiveObservation: false });
assert.equal(JSON.stringify(ownedState.snapshot()), beforeOwned);
const report = { kind: "field-puppet-actors", sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  miscSource: misc.source, miscHash: catalog.miscHash, nativeReportSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  originalGameExecuted: false, sourceFactoryHostClaimed: false,
  sourceScriptCounts: { admitted: contexts.length, blocked: blocked.length }, combinations, entryCounts,
  catalog, mediaBindings: mediaBindings.map(({ character, ...r }) => r), verifiedSpriteFiles,
  controlledInputs: ["positions/layers/camera instance", "companion/other-party/condition-controller instance presence",
    "already-unmounted riding state and transport 1", "same-map shader/transparent texture bindings and zero foot attribute",
    "ordinary child hierarchy and absent restoration callback", "post-Ready movement and script entry combined independently of story order"],
  controlled, gateChecks, blocked,
  limits: ["2771 decoded flag records are not playable scripts or maps", "Fresh owned state and source media do not prove a field factory ran",
    "Condition stand-ins, companions, riding transitions and new shader/RT effects remain explicit host gates",
    "Formal GameSession actor lifecycle and reachable scene acceptance are separate from this controlled mechanism check"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", scriptContexts: contexts.length, missingFlagsBlocked: blocked.length,
  lifecycleProbes: controlled.length, sourceOwned: owned.roster.length, verifiedSpriteFiles, gateChecks: gateChecks.length,
  sourceFactoryHostClaimed: false, originalGameExecuted: false }));
