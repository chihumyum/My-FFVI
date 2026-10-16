// Controlled source initialization and current GameState integration, not story playability.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { exportedOrdinaryWeaponEffects } from "./lib/ordinary-weapon-source.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDirFlag = process.argv.includes("--compiled-dir") ? "--compiled-dir" : "--dist";
const outDirIndex = process.argv.indexOf(outDirFlag);
const outDir = outDirIndex < 0 ? "dist" : process.argv[outDirIndex + 1];
if (!outDir || outDir.startsWith("--")) throw new Error("Missing compiled output directory");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { battleDefinitionBlocker } = await module("core/battle-content");
const { compileOwnedCharacterInitialization } = await module("compiler/owned-character");
const { compileEquipmentCatalog } = await module("compiler/equipment");
const { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon");
const { compileRosterLifecycleEvent } = await module("compiler/roster");
const { createOwnedCharacter, validateOwnedCharacterAbilities } = await module("core/owned-character");
const { prepareRosterLifecycle } = await module("core/roster");
const { GameState } = await module("core/game-state");
const { GameSession } = await module("core/game-session");
const { hash } = await module("compiler/content");
const corpus = await loadCorpus(root);
const battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const field = JSON.parse(snapshotFile(await readSnapshot(root + "build/field"), "field.json"));
const catalogIndex = process.argv.indexOf("--catalog");
const catalogPath = catalogIndex < 0 ? "build/game/opening-playable.json" : process.argv[catalogIndex + 1];
if (!catalogPath || catalogPath.startsWith("--")) throw new Error("Missing catalog path");
const catalog = JSON.parse(await readFile(resolve(root, catalogPath), "utf8"));
const { contentHash, ...catalogInput } = catalog;
assert.equal(hash(catalogInput), contentHash);
const native = JSON.parse(await readFile(root + "build/reports/owned-character-native-check.json", "utf8"));
assert.equal(native.methods.length, 39);
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const name = (key) => {
  const value = field.messages.system_zhc[key];
  assert.equal(typeof value, "string", "Missing exact initial character name: " + key);
  return value;
};
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const weaponEffects = exportedOrdinaryWeaponEffects(battle, reader(), compileOrdinaryWeaponEffects).catalog;
const equipmentStateKind = catalog.gameState.equipmentSystem.catalog.kind;
assert.ok(["equipment-development-v1", "source-equipment-state-v2"].includes(equipmentStateKind));
const expectedTemplates = equipmentStateKind === "source-equipment-state-v2" ? 27 : 18;
const templates = new Map(), decoded = [], blocked = [];
for (const row of corpus.tables["character_status.csv"]) {
  const sourceId = Number(row.id);
  try {
    const { template, sources } = compileOwnedCharacterInitialization(reader(), corpus.tables, sourceId, name, weaponEffects, equipmentStateKind);
    templates.set(sourceId, template);
    decoded.push({ sourceId, level: template.initial.level, hp: template.initial.hp, maxHp: template.initial.maxHp, mp: template.initial.mp,
      maxMp: template.initial.maxMp, commandIds: template.initial.abilities.commandIds,
      ownedAbilities: template.initial.abilities.owned.length,
      learnedAbilities: template.initial.abilities.owned.filter((a) => a.skillLevel === 100).length,
      sources });
  } catch (error) { blocked.push({ sourceId, reason: error.message }); }
}
assert.equal(decoded.length + blocked.length, 34);
assert.equal(decoded.length, expectedTemplates);
assert.equal(blocked.length, 34 - expectedTemplates);
assert.equal(Object.keys(catalog.gameState.characterInitializations).length, decoded.length);
for (const [id, template] of Object.entries(catalog.gameState.characterInitializations)) {
  assert.deepEqual(template, templates.get(template.initial.sourceId), id + ": published source template");
  assert.ok(catalog.gameState.characterGrowth[id], id + ": missing source growth plan");
}
for (const id of [1, 2, 31, 32]) assert.ok(templates.has(id), JSON.stringify(blocked));
for (const id of [4, 14, 33]) assert.ok(blocked.some((b) => b.sourceId === id && /conditions/.test(b.reason)));
const make = () => new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
const state = make(), initial = state.snapshot();
assert.equal(initial.formatVersion, 14);
const openingChecks = [];
for (const player of catalog.common.players) {
  const template = templates.get(player.sourceId);
  assert.deepEqual(catalog.gameState.characterInitializations[player.id], template);
  const member = initial.roster.find((r) => r.id === player.id);
  for (const key of ["hp", "mp", "level", "exp", "name"]) {
    assert.equal(template.initial[key], player[key], `${player.id}:${key}`);
    assert.equal(member[key], player[key], `${player.id}:${key}:runtime`);
  }
  assert.equal(template.initial.maxHp, player.hp);
  assert.equal(template.initial.maxMp, player.mp);
  assert.deepEqual(member.abilities, template.initial.abilities);
  assert.deepEqual(template.parameterContext, catalog.gameState.equipmentSystem.contexts[player.id]);
  if (template.nameTag !== null) assert.equal(initial.characterNames[template.nameTag], player.name);
  openingChecks.push({ id: player.id, sourceId: player.sourceId, ownedAbilities: member.abilities.owned.length });
}
assert.deepEqual(openingChecks.map((p) => p.ownedAbilities), [63, 4, 4]);
assert.deepEqual(initial.characterNames, { TINA: catalog.common.players[0].name });
assert.equal(templates.get(31).nameTag, null);
assert.equal(templates.get(32).nameTag, null);
const expectedHistory = [...new Set(initial.roster.flatMap((r) => r.abilities.owned.map((a) => a.abilityId)))];
assert.deepEqual(initial.learnedAbilityIds, expectedHistory);
assert.equal(initial.learnedAbilityIds.length, 63);
assert.ok(initial.learnedAbilityIds.includes(32));
assert.equal(initial.roster[0].abilities.owned.find((a) => a.abilityId === 32).skillLevel, 0);
const restored = make();
restored.restore(JSON.parse(JSON.stringify(initial)));
assert.deepEqual(restored.snapshot(), initial);
const rejected = [];
const mutations = {
  "learned-value": (s) => { s.roster[0].abilities.owned[0].skillLevel = 99; },
  "missing-owned-record": (s) => { s.roster[0].abilities.owned.pop(); },
  "owned-order": (s) => { s.roster[0].abilities.owned.reverse(); },
  "acquisition-order": (s) => { s.roster[0].abilities.additionOrder.reverse(); },
  "global-history-order": (s) => { s.learnedAbilityIds.reverse(); },
  "global-history-duplicate": (s) => { s.learnedAbilityIds.push(s.learnedAbilityIds[0]); },
  "global-history-missing": (s) => { s.learnedAbilityIds.pop(); },
  "name-binding": (s) => { s.characterNames.TINA = "invalid-binding"; },
  "extra-name-binding": (s) => { s.characterNames["SYNTHETIC_UNKNOWN"] = "extra"; },
  "visible-unlearned-ability": (s) => { s.roster[0].abilities.byCommand[0].abilityIds.push(32); },
};
for (const [label, mutate] of Object.entries(mutations)) {
  const corrupted = structuredClone(initial);
  mutate(corrupted);
  assert.throws(() => restored.restore(corrupted), label);
  assert.deepEqual(restored.snapshot(), initial, label + ": atomic restore");
  rejected.push(label);
}
// A source Locke initializer can participate in the pure lifecycle transaction.
// The published profile still owns only its three starting characters.
const sourceIds = [1, 2, 31, 32];
const gearIds = corpus.tables["content.csv"].filter((r) => ["2", "3"].includes(r.type_id)).map((r) => Number(r.id));
const equipment = compileEquipmentCatalog(reader(), gearIds, sourceIds, name,
  Object.fromEntries(sourceIds.map((id) => [id, { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false }])), weaponEffects, equipmentStateKind).catalog;
const lifecycle = { roster: initial.roster, party: initial.party, equipmentStock: initial.equipmentStock, releasedJobIds: initial.releasedJobIds };
const original = structuredClone(lifecycle);
let sideEffects;
const providers = {
  initialize: ({ sourceId, ownedId, releasedJobIds }) => {
    const result = createOwnedCharacter(templates.get(sourceId), { id: "controlled-owner:" + sourceId, ownedId, releasedJobIds,
      learnedAbilityIds: initial.learnedAbilityIds });
    sideEffects = result;
    return result.member;
  },
  validateMember: (member) => validateOwnedCharacterAbilities(member.abilities),
};
const preview = prepareRosterLifecycle(lifecycle, { kind: "unlock", sourceId: 2, refreshActors: false },
  { equipment, jobIds: catalog.gameState.rosterLifecycle.jobIds }, providers);
assert.deepEqual(lifecycle, original);
assert.equal(preview.state.roster.length, 4);
assert.deepEqual(preview.state.party, initial.party);
assert.deepEqual(sideEffects.learnedAbilityIdsToAppend, [229]);
assert.equal(sideEffects.nameBinding.key, "ROCK");
assert.equal(preview.state.roster.at(-1).abilities.owned.length, 59);
assert.equal(preview.state.roster.at(-1).ownedId, 4);
const increments = new Map();
const sourceCharacter = reader().row("character_status.csv", 2).values;
const sourceEquipment = Array.from({ length: 6 }, (_, i) => Number(sourceCharacter[`content_id${i + 1}`]));
assert.deepEqual(templates.get(2).initial.equipment, sourceEquipment);
// AddFromMaster (328110) issues six AddOwnedItem calls before SetEquip;
// its initial grants include empty gear and repeated accessory identities.
for (const id of sourceEquipment) increments.set(id, (increments.get(id) ?? 0) + 1);
assert.equal([...increments.values()].reduce((sum, count) => sum + count, 0), 6);
const expectedCounts = new Map(initial.equipmentStock.map(({ id, count }) => [id, count]));
for (const [id, count] of increments) expectedCounts.set(id, (expectedCounts.get(id) ?? 0) + count);
const expectedStock = [...expectedCounts].sort(([a], [b]) => a - b).map(([id, count]) => ({ id, count }));
assert.deepEqual(preview.state.equipmentStock, expectedStock);
const failed = { ...providers, validateMember: (member) => { providers.validateMember(member); if (member.sourceId === 2) throw new Error("controlled publication rejection"); } };
assert.throws(() => prepareRosterLifecycle(lifecycle, { kind: "unlock", sourceId: 2, refreshActors: false },
  { equipment, jobIds: catalog.gameState.rosterLifecycle.jobIds }, failed), /controlled publication rejection/);
assert.deepEqual(lifecycle, original);
assert.deepEqual(state.snapshot(), initial);

// Exercise the real shared owner with the source selector's flags, changing only
// refreshActors for this isolated no-rendering probe. No published story unlock.
const sourceJoin = compileRosterLifecycleEvent("メンバー加入：ロック", corpus.tables);
assert.equal(sourceJoin.command.sourceId, 2);
assert.equal(sourceJoin.command.recovery, false);
assert.equal(sourceJoin.command.refitEquipment, false);
assert.equal(sourceJoin.command.refreshActors, true);
const join = { ...sourceJoin.command, refreshActors: false };
const joinedState = make(), joinBefore = joinedState.snapshot();
const joining = joinedState.fieldRoster.prepare(join);
assert.equal(joining.refreshActors, false);
assert.deepEqual(joinedState.snapshot(), joinBefore, "join preparation keeps names, history and equipment private");
joining.commit();
const joined = joinedState.snapshot(), newOwner = joined.roster.find((r) => r.sourceId === 2);
assert.equal(joined.roster.length, 4);
assert.equal(newOwner.ownedId, 4);
assert.equal(newOwner.id, "player:2");
assert.equal(newOwner.level, 5);
assert.equal(newOwner.additionalLevel, 5);
assert.equal(newOwner.exp, 400);
assert.equal(newOwner.growth.additionalExp, 400);
assert.equal(newOwner.hp, templates.get(2).initial.hp, "no-recovery joining must retain the initial current HP");
assert.equal(newOwner.mp, templates.get(2).initial.mp, "no-recovery joining must retain the initial current MP");
assert.ok(newOwner.maxHp > newOwner.hp);
assert.deepEqual(newOwner.abilities, templates.get(2).initial.abilities);
assert.deepEqual(joined.party.slots[0][3], { id: newOwner.id, row: "front" });
assert.deepEqual(joined.learnedAbilityIds, [...initial.learnedAbilityIds, 229]);
assert.deepEqual(joined.characterNames, { ...initial.characterNames, ROCK: newOwner.name });
assert.deepEqual(joined.items, initial.items);
assert.equal(joined.gil, initial.gil);
assert.deepEqual(joined.completedBattles, initial.completedBattles);
assert.equal(joined.equipmentStock.length, initial.equipmentStock.length + 1);
assert.deepEqual(joined.equipmentStock, expectedStock);
assert.throws(joining.commit, /Stale/);
joinedState.fieldRoster.prepare(join).commit();
joinedState.fieldRoster.prepare({ kind: "unlock", sourceId: 2, refreshActors: false }).commit();
assert.deepEqual(joinedState.snapshot(), joined, "rejoining or unlocking an existing owner must not duplicate gear or history");
assert.equal(joinedState.battlePartyBlocker, null);
assert.equal(catalog.common.qualificationContext.mode, "source");
assert.equal(catalog.common.qualificationContext.conditionContext, "current");
assert.equal(battleDefinitionBlocker(joinedState.partyPlayers(), catalog.common.qualificationContext,
  catalog.common.conditions), null);
assert.match(battleDefinitionBlocker(joinedState.partyPlayers(),
  { ...catalog.common.qualificationContext, mode: "development-static" }, catalog.common.conditions), /来源战斗入口/);
assert.deepEqual(joinedState.snapshot(), joined);
const restoredJoined = make();
restoredJoined.restore(JSON.parse(JSON.stringify(joined)));
assert.deepEqual(restoredJoined.snapshot(), joined);
restoredJoined.fieldRoster.prepare(join).commit();
assert.deepEqual(restoredJoined.snapshot(), joined, "restoring and rejoining cannot replay acquisition");
const joinedMutations = {
  "dynamic-owned-identity": (s) => { s.roster.at(-1).ownedId = 1; },
  "dynamic-source-identity": (s) => { s.roster.at(-1).sourceId = 3; },
  "dynamic-history": (s) => { s.learnedAbilityIds.pop(); },
  "dynamic-name-binding": (s) => { s.characterNames.ROCK = "invalid-binding"; },
  "dynamic-growth-origin": (s) => { s.roster.at(-1).growth.additionalExp = 0; },
  "dynamic-growth-addition": (s) => { s.roster.at(-1).growth.additional.hp++; },
  "dynamic-registered-equipment": (s) => { s.equipmentStock.find((entry) => entry.id === 94).count = 0; },
};
for (const [label, mutate] of Object.entries(joinedMutations)) {
  const corrupted = structuredClone(joined);
  mutate(corrupted);
  assert.throws(() => restoredJoined.restore(corrupted), label);
  assert.deepEqual(restoredJoined.snapshot(), joined, label + ": atomic restore");
  rejected.push(label);
}
const failedJoins = [];
for (const sourceId of [4, 999]) {
  const before = state.snapshot();
  assert.throws(() => state.fieldRoster.prepare({ ...join, sourceId }), /Unimplemented source character initialization/);
  assert.deepEqual(state.snapshot(), before);
  failedJoins.push({ sourceId, boundary: "source-initialization" });
}
const missingGrowthContent = structuredClone(catalog.gameState);
delete missingGrowthContent.characterGrowth["player:2"];
const missingGrowthState = new GameState(missingGrowthContent, catalog.common.players, catalog.contentHash, catalog.common.conditions);
const missingBefore = missingGrowthState.snapshot();
assert.throws(() => missingGrowthState.fieldRoster.prepare(join), /source character growth/);
assert.deepEqual(missingGrowthState.snapshot(), missingBefore, "late missing growth cannot leak initialized history or gear");
failedJoins.push({ sourceId: 2, boundary: "controlled-missing-growth-provider" });
const staleState = make(), staleJoin = staleState.fieldRoster.prepare(join);
staleState.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
const changed = staleState.snapshot();
assert.throws(staleJoin.commit, /Stale/);
assert.deepEqual(staleState.snapshot(), changed);
const candidateState = make(), candidate = candidateState.prepareFieldState();
candidate.ports.roster.prepare(join).commit();
assert.deepEqual(candidateState.snapshot(), initial);
assert.equal(candidate.commit(), true);
assert.deepEqual(candidateState.snapshot(), joined);
assert.equal(candidate.commit(), false);
candidate.ports.roster.prepare(join).commit();
assert.deepEqual(candidateState.snapshot(), joined, "published candidate port must use the shared owner");
const runtimeField = JSON.parse(await readFile(root + "build/game/narshe.json", "utf8"));
const probeName = "controlled_owned_character_entry", probeSource = { file: "controlled-source-check", assetPath: "owned-entry" };
runtimeField.scripts[probeName] = [
  { ...sourceJoin, kind: "roster", script: probeName, index: 0, source: probeSource },
  { kind: "encounter", party: Number(Object.keys(catalog.encounters)[0]), continuation: "controlled_owned_return",
    script: probeName, index: 1, source: probeSource },
];
runtimeField.scripts.controlled_owned_return = [{ kind: "exit", script: "controlled_owned_return", index: 0, source: probeSource }];
runtimeField.scriptSystemFlags[probeName] = { keepBadStatusVisual: false };
const runtimeSession = new GameSession(runtimeField, catalog);
assert.equal(runtimeSession.field.startEvent(probeName), true); runtimeSession.advance(10);
assert.ok(runtimeSession.battle, runtimeSession.field.stop?.message);
const runtimeOwner = runtimeSession.state.snapshot().roster.find((owner) => owner.sourceId === 2);
assert.deepEqual(runtimeOwner, newOwner);
const runtimePlayer = runtimeSession.battle.players.find((player) => player.sourceId === 2);
assert.equal(runtimePlayer.appearanceState.magitek, null);
assert.equal(runtimePlayer.level, newOwner.level);
assert.deepEqual(runtimePlayer.ownedAbilities.abilities, newOwner.abilities);
assert.deepEqual(runtimeSession.battle.content.qualificationContext.invalidContentIds, [16, 17, 23, 412, 1309]);
assert.equal(runtimeSession.battle.commandQualification(runtimePlayer.id).entries.find((entry) => entry.commandId === 26).released, false);
const report = { lane: "controlled-source-owned-initialization-and-game-state",
  catalogHash: contentHash, sourceSetHash: corpus.sourceSetHash, nativeSha256: native.nativeSha256,
  decoded, blocked, openingChecks, rejected, globalHistoryCount: initial.learnedAbilityIds.length,
  controlledNewOwner: { sourceId: 2, ownedId: 4, ownedAbilities: 59, historyAppend: [229], equipmentIncrements: [...increments] },
  sharedStateJoin: { sourceCommand: sourceJoin, controlledCommand: join, newOwner,
    sourceGrowthLevel: 5, historyAppend: [229], equipmentIncrements: [...increments], failedJoins,
    duplicateCommitRejected: true, repeatedJoinIdempotent: true, roundTripIdempotent: true,
    staleCommitRejected: true, candidatePublicationAtomic: true, battleDefinitionStillBlocked: false,
    gameSessionSourceEntry: { sourceId: runtimePlayer.sourceId, actorRefresh: true, appearance: "ordinary",
      qualification: runtimeSession.battle.content.qualificationContext } },
  acceptance: { compiledSourceInitializations: decoded.length, blockedSourceInitializations: blocked.length, sourceCatalogAndRuntimeOwners: openingChecks.length,
    invalidSavesRejected: rejected.length, jsonRoundTrip: true, controlledUnlock: true, failedPublicationAtomic: true,
    originalRuntimeOracle: false, sourceFirstJoinGrowth: true, sourceNoRecoveryJoin: true, dynamicOwnerRoundTrip: true,
    gameSessionSourceBattleEntry: true, browserRenderedNewOwner: false },
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/owned-character-check.json", output);
console.log(JSON.stringify({ ...report.acceptance, globalHistoryCount: initial.learnedAbilityIds.length, reportHash: hash(report) }, null, 2));
