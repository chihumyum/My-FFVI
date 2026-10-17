// Published source qualification through a real owned-state lease, followed by
// a separate in-memory potion probe. No test inventory is written to a save.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const module = (name) => import(pathToFileURL(resolve(root, option("--dist", "dist"), "src", name + ".js")));
const { BattleGame } = await module("core/battle");
const { GameState } = await module("core/game-state");
const { encounterContent } = await module("core/battle-content");
const { projectBattleFieldState } = await module("core/field-battle-entry");
const { hash } = await module("compiler/content");
const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
const source = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
for (const document of [source, published]) {
  const { contentHash, ...input } = document;
  assert.equal(hash(input), contentHash);
}
assert.equal(published.common.sourceContentHash, source.contentHash);
assert.equal(published.common.qualificationContext.mode, "source");
assert.equal(published.common.qualificationContext.itemMenuAvailable, null);
assert.deepEqual(published.common.battleEntry, source.entryProviders.catalog);
const native = JSON.parse(await readFile(root + "build/reports/battle-entry-runtime-native-check.json", "utf8"));
assert.equal(native.methods.length, 7); assert.equal(native.rawRanges.length, 4); assert.equal(native.semanticsVerified, false);
assert.equal(native.nativeSha256, source.nativeProfile.sha256);
const contentRows = Object.values(source.tables["content.csv"]).map((row) => row.values);
let abilityContentBindings = 0, firstFunctionBindings = 0;
for (const ability of Object.values(source.tables["ability.csv"]).map((row) => row.values)) {
  const rows = contentRows.filter((row) => row.type_id === "4" && row.type_value === ability.id);
  assert.ok(rows.length <= 1, "Ambiguous source ability content");
  assert.equal(published.common.abilityContentIds[ability.id], rows.length ? Number(rows[0].id) : null);
  abilityContentBindings++;
}
for (const ability of Object.values(published.common.abilities)) {
  const row = source.tables["ability.csv"][ability.id].values;
  const groupId = Number(row.battle_function_group_id);
  assert.equal(ability.program.groupId, groupId);
  const firstFunctionId = groupId ? Number(source.tables["function_group.csv"][groupId].values.function1_id) : 0;
  assert.equal(ability.program.functions.find((fn) => fn.slot === 1)?.functionId ?? 0, firstFunctionId);
  firstFunctionBindings++;
}
const conditionCheckpoint = source.entryProviders.ownedConditionCheckpoint;
assert.equal(conditionCheckpoint.conditionId, 53);
assert.deepEqual(conditionCheckpoint.selectedSourceIds, [1, 31, 32]);
const content = encounterContent(published, Number(Object.keys(published.encounters)[0]));
const exclusions = projectBattleFieldState(content.battleEntry, { mapId: 3, transportationId: 6,
  isSavePoint: null, beastFieldController: null, footAttributeType: null }, published.gameState.fieldConditions.transportations);
assert.deepEqual(exclusions, { invalidContentIds: [16, 17, 23, 412, 1309], blockers: [] });
content.qualificationContext = { ...content.qualificationContext, invalidContentIds: exclusions.invalidContentIds };
const createState = () => new GameState(published.gameState, published.common.players, published.contentHash, content.conditions);
const state = createState(), before = state.snapshot(), lease = state.openBattle(content.encounterId, content.rewardPolicy);
const input = state.battleInventory(lease);
assert.deepEqual(input.qualification.members.map((m) => [m.id, m.sourceId]), state.battlePlayers(lease).map((p) => [p.id, p.sourceId]));
const battle = new BattleGame(content, 79, state.battlePlayers(lease), input);
const players = [];
const hostPoses = ["default", "down", "dying", "IdleR00", "dyingR00", "ready"];
for (const player of battle.players) {
  assert.ok(player.conditionIds.includes(53));
  assert.equal(player.appearanceState.magitek.conditionId, 53);
  const menu = battle.commandMenu(player.id), items = battle.itemQualification(player.id);
  assert.equal(menu.find((c) => c.id === 26).available, true);
  assert.equal(menu.some((c) => c.id === 1), false);
  assert.equal(items.available, true);
  assert.equal(items.canChangeEquipment, true);
  assert.equal(battle.canUse(player.id, 218, 26), true);
  const frames = hostPoses.map((key) => battle.appearanceFrame(player.id, { key, bodyFrame: 0, armorFrame: 0 }));
  frames.forEach((frame) => assert.ok(frame.armor));
  players.push({ id: player.id, sourceId: player.sourceId, items, menu, frames });
}
state.cancelBattle(lease);
assert.deepEqual(state.snapshot(), before);
// One controlled ordinary consumable is introduced only to this isolated state.
const probe = createState();
probe.changeItems([{ id: 2, count: 1 }], "grant");
const probeBefore = probe.snapshot(), probeLease = probe.openBattle(content.encounterId, content.rewardPolicy);
const consuming = new BattleGame(content, 83, probe.battlePlayers(probeLease), probe.battleInventory(probeLease));
consuming.combatants.forEach((unit) => { unit.atb = 0; });
const user = consuming.players[0]; user.atb = 100;
assert.equal(consuming.canUseItem(user.id, 2, 3), true);
assert.equal(consuming.commandItem(user.id, 2, { kind: "single", id: user.id }, 3), true);
assert.equal(consuming.inventory.find((s) => s.id === 2).available, 0);
assert.equal(consuming.itemQualification(user.id).usableItemIds.includes(2), true, "source Count changes on commit");
consuming.advance(410);
assert.equal(consuming.inventory.find((s) => s.id === 2).count, 0);
assert.equal(consuming.itemQualification(user.id).usableItemIds.includes(2), false);
assert.equal(consuming.canUseItem(user.id, 2, 3), false);
assert.equal(consuming.commandMenu(user.id).find((c) => c.id === 3).available, true, "equipped hand keeps the separate equipment branch eligible");
probe.cancelBattle(probeLease);
assert.deepEqual(probe.snapshot(), probeBefore);
assert.deepEqual(state.snapshot(), before);
const report = { lane: "source-bound-dynamic-battle-qualification-host", contentHash: published.contentHash,
  sourceContentHash: source.contentHash, nativeEvidenceHash: hash(native), mode: "source", players,
  appearancePoses: players.length * hostPoses.length,
  abilityContentBindings, firstFunctionBindings,
  openingInvalidContentIds: exclusions.invalidContentIds, sourcePotionId: 2, consumedCount: 1,
  controlledInventoryWrittenToSave: false, publishedCheckpointChanged: false,
  originalGameExecuted: false, semanticsVerified: false,
  blockers: ["special-command-providers", "battle-equipping-execution", "full-effect-coverage", "original-game-dynamic-oracle"] };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/battle-entry-runtime-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ mode: report.mode, players: players.length, sourcePotionId: 2, consumedCount: 1,
  appearancePoses: report.appearancePoses, abilityContentBindings, firstFunctionBindings,
  blockers: report.blockers.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
