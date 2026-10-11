// Real content with private controlled events; does not grant story progress.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = option("--dist", "dist");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")));
const { GameSession } = await module("core/game-session");
const { battleDefinitionBlocker } = await module("core/battle-content");
const { hash } = await module("compiler/content");
const field = JSON.parse(await readFile(resolve(root, option("--field", "build/game/narshe.json"))));
const battle = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json"))));
for (const content of [field, battle]) {
  const { contentHash, ...input } = content;
  assert.equal(contentHash, hash(input));
}
assert.equal(battle.common.profile, "narshe-playability-v24");
assert.equal(battle.common.qualificationContext.mode, "source");
assert.equal(battle.common.qualificationContext.conditionContext, "current");
assert.equal(field.entry.transportationId, 6);
assert.equal(field.entry.partyActors.context.player.fieldAssetId, 38);
assert.equal(field.entry.partyActors.context.player.riderFieldAssetId, 1);
assert.deepEqual(field.scriptSystemFlags.sc_e_0001_5, { keepBadStatusVisual: false });
const cases = [];
const source = { file: "controlled-source-integration", assetPath: "mechanism-probe" };
const make = () => {
  const content = structuredClone(field);
  return { content, game: new GameSession(content, battle) };
};
const execute = ({ game, content }, command, kind, visualFlag = false) => {
  const name = "controlled_system_probe";
  content.scripts[name] = [
    { kind, command, dependencies: [], script: name, index: 0, source },
    { kind: "exit", script: name, index: 1, source },
  ];
  content.scriptSystemFlags[name] = visualFlag === undefined ? null : { keepBadStatusVisual: visualFlag };
  assert.equal(game.field.startEvent(name), true);
  game.advance(10);
};
const join = { kind: "join", sourceId: 2, position: 3, row: "front",
  refreshActors: true, recovery: false, refitEquipment: false };
const f = make(), before = f.game.state.snapshot();
execute(f, join, "roster");
assert.equal(f.game.field.stop, null);
let snapshot = f.game.state.snapshot(), locke = snapshot.roster.find((p) => p.sourceId === 2);
assert.equal(locke.ownedId, 4); assert.equal(locke.level, 5); assert.equal(locke.exp, 400);
assert.equal(locke.hp, 48); assert.equal(locke.maxHp, 102);
assert.equal(snapshot.characterNames[battle.gameState.characterInitializations[locke.id].nameTag], locke.name);
assert.deepEqual(snapshot.learnedAbilityIds, [...before.learnedAbilityIds, 229]);
assert.equal(f.game.field.player.asset, field.entry.player.asset);
assert.equal(f.game.field.partyActorCheckpoint.context.puppets[3].fieldAssetId, 2);
assert.equal(f.game.state.battlePartyBlocker, null);
assert.equal(battleDefinitionBlocker(f.game.state.partyPlayers(), battle.common.qualificationContext,
  battle.common.conditions), null);
assert.match(battleDefinitionBlocker(f.game.state.partyPlayers(),
  { ...battle.common.qualificationContext, mode: "development-static" }, battle.common.conditions), /来源战斗入口/);
cases.push({ name: "new owner plus source correction and full same-map refresh", level: locke.level, exp: locke.exp, hp: locke.hp, maxHp: locke.maxHp });
const checkpoint = f.game.checkpoint();
assert.deepEqual(GameSession.restore(JSON.parse(JSON.stringify(checkpoint)), f.content, battle).checkpoint(), checkpoint);
cases.push({ name: "new owned state and native actor checkpoint round trip" });
const stock = structuredClone(snapshot.equipmentStock);
execute(f, join, "roster");
assert.equal(f.game.field.stop, null);
assert.deepEqual(f.game.state.snapshot().equipmentStock, stock);
cases.push({ name: "already-level-corrected owner does not regrant gear" });
const ownedBeforeMissing = f.game.state.snapshot(), actorsBeforeMissing = f.game.field.partyActorCheckpoint;
execute(f, { kind: "organize-slot", slot: 0, members: [2, 1, 31, 32], refreshActors: true }, "party");
assert.match(f.game.field.stop.message, /Missing party appearance media/);
assert.deepEqual(f.game.state.snapshot(), ownedBeforeMissing);
assert.deepEqual(f.game.field.partyActorCheckpoint, actorsBeforeMissing);
cases.push({ name: "unloaded leader media leaves owned and every native actor unchanged" });
const reordered = make();
execute(reordered, { kind: "organize-slot", slot: 0, members: [31, 1, 32, null], refreshActors: true }, "party");
assert.equal(reordered.game.field.stop, null);
assert.equal(reordered.game.field.player.asset, "mo_ff6_p021");
assert.equal(reordered.game.field.player.mount, "mo_ff6_v006_c00");
assert.equal(reordered.game.field.partyActorCheckpoint.context.player.riderFieldAssetId, 31);
assert.equal(reordered.game.field.partyActorCheckpoint.context.player.fieldAssetId, 38);
assert.deepEqual(GameSession.restore(reordered.game.checkpoint(), reordered.content, battle).checkpoint(), reordered.game.checkpoint());
cases.push({ name: "source-mounted leader change renders inner identity and restores" });
const recovered = make();
execute(recovered, { ...join, refreshActors: false, recovery: true }, "roster");
assert.equal(recovered.game.field.stop, null);
locke = recovered.game.state.snapshot().roster.find((p) => p.sourceId === 2);
assert.equal(locke.hp, locke.maxHp); assert.equal(locke.mp, locke.maxMp);
assert.equal(recovered.game.field.partyActorCheckpoint.context.puppets[3].fieldAssetId, 2);
cases.push({ name: "full recovery invokes implicit setDummy=false refresh" });
const revived = make(), poisoned = revived.game.state.snapshot();
poisoned.roster[0].hp = 0; poisoned.roster[0].conditionIds = [5];
revived.game.state.restore(poisoned);
execute(revived, { ...join, sourceId: 1, position: 0, refreshActors: false, recovery: true }, "roster");
assert.equal(revived.game.field.stop, null);
assert.equal(revived.game.state.snapshot().roster[0].hp, poisoned.roster[0].maxHp);
assert.deepEqual(revived.game.state.snapshot().roster[0].conditionIds, []);
cases.push({ name: "explicit source visual flag permits admitted death recovery" });
const unknownVisual = make(), initial = unknownVisual.game.state.snapshot();
execute(unknownVisual, { ...join, recovery: true }, "roster", true);
assert.match(unknownVisual.game.field.stop.message, /condition-visual context/);
assert.deepEqual(unknownVisual.game.state.snapshot(), initial);
cases.push({ name: "preserved bad-status visuals require another host and cannot grant owner" });
const poisonedArmor = make(), poisonState = poisonedArmor.game.state.snapshot();
poisonState.roster[0].conditionIds = [10];
poisonedArmor.game.state.restore(poisonState);
assert.equal(poisonedArmor.game.field.move("up"), true);
poisonedArmor.game.advance(240);
assert.equal(poisonedArmor.game.state.snapshot().roster[0].hp, poisonState.roster[0].hp);
assert.deepEqual(GameSession.restore(poisonedArmor.game.checkpoint(), poisonedArmor.content, battle).checkpoint(), poisonedArmor.game.checkpoint());
cases.push({ name: "source opening transport 6 skips ordinary field poison" });
const walkingField = structuredClone(field);
delete walkingField.entry.partyActors;
walkingField.entry.transportationId = 1; walkingField.entry.player.mount = "";
const walking = new GameSession(walkingField, battle);
walking.state.restore(poisonState);
assert.equal(walking.field.move("up"), true); walking.advance(240);
assert.equal(walking.state.snapshot().roster[0].hp, poisonState.roster[0].hp - 1);
cases.push({ name: "controlled transport 1 still runs the same ordinary poison provider" });
for (const mutate of [
  (s) => { s.world.field.partyActors.context.player.fieldAssetId = 1; },
  (s) => { s.world.field.partyActors.context.multiParty[0].leaderIndex = 3; },
  (s) => { s.world.field.partyActors.context.player.riderFieldAssetId = null; },
  (s) => { s.world.field.partyActors.playerAssetCacheId = "1"; },
]) {
  const bad = structuredClone(checkpoint); mutate(bad);
  assert.throws(() => GameSession.restore(bad, f.content, battle));
}
cases.push({ name: "four forged native-actor checkpoint providers rejected" });
const enterBattle = (game, content) => {
  const name = "controlled_battle_entry", after = "controlled_battle_return";
  content.scripts[name] = [{ kind: "encounter", party: Number(Object.keys(battle.encounters)[0]),
    continuation: after, script: name, index: 0, source }];
  content.scripts[after] = [{ kind: "exit", script: after, index: 0, source }];
  assert.equal(game.field.startEvent(name), true); game.advance(10);
};
const entry = make();
assert.deepEqual(entry.game.state.snapshot().roster.map((p) => p.conditionIds), [[53], [53], [53]]);
execute(entry, join, "roster");
const entryOwned = entry.game.state.snapshot(), entrySave = entry.game.checkpoint();
const entryRestored = GameSession.restore(JSON.parse(JSON.stringify(entrySave)), entry.content, battle);
enterBattle(entryRestored, entry.content);
assert.ok(entryRestored.battle, entryRestored.field.stop?.message);
assert.equal(entryRestored.battle.content.qualificationContext.mode, "source");
assert.equal(entryRestored.battle.content.qualificationContext.conditionContext, "current");
assert.deepEqual(entryRestored.battle.content.qualificationContext.invalidContentIds, [16, 17, 23, 412, 1309]);
assert.deepEqual(entryRestored.state.snapshot(), entryOwned, "entry does not spend or reinitialize ownership");
const ordinary = entryRestored.battle.players.find((p) => p.sourceId === 2);
assert.deepEqual(ordinary.conditionIds, []);
assert.equal(ordinary.appearanceState.magitek, null);
assert.equal(ordinary.level, 5); assert.equal(ordinary.hp, 48); assert.equal(ordinary.maxHp, 102);
assert.deepEqual(ordinary.ownedAbilities.abilities, entryOwned.roster.find((p) => p.sourceId === 2).abilities);
assert.equal(entryRestored.battle.commandQualification(ordinary.id).entries.find((e) => e.commandId === 26).released, false);
assert.ok(entryRestored.battle.commandQualification(ordinary.id).entries.find((e) => e.commandId === 1).abilityIds.includes(1));
for (const p of entryRestored.battle.players.filter((p) => p.sourceId !== 2)) {
  assert.deepEqual(p.conditionIds, [53]); assert.equal(p.appearanceState.magitek.conditionId, 53);
  assert.equal(entryRestored.battle.commandQualification(p.id).entries.find((e) => e.commandId === 26).released, true);
}
cases.push({ name: "source field and saved four-owner state enter mixed Magitek and ordinary battle", sourceId: 2,
  fieldMapId: entryRestored.field.content.map.identity.mapId, transportationId: entryRestored.field.transportationId,
  invalidContentIds: entryRestored.battle.content.qualificationContext.invalidContentIds });
const conditionEvent = make();
execute(conditionEvent, { kind: "remove-condition", conditionType: 607, target: 0 }, "owned-condition");
assert.equal(conditionEvent.game.field.stop, null);
assert.equal(conditionEvent.game.checkpointReady, true);
assert.deepEqual(conditionEvent.game.state.snapshot().roster.map((p) => p.conditionIds), [[], [], []]);
const removedSave = conditionEvent.game.checkpoint();
const ordinarySession = GameSession.restore(JSON.parse(JSON.stringify(removedSave)), conditionEvent.content, battle);
assert.deepEqual(ordinarySession.state.snapshot().roster.map((p) => p.conditionIds), [[], [], []], "restore never replays initialOwnedConditions");
enterBattle(ordinarySession, conditionEvent.content);
assert.ok(ordinarySession.battle, ordinarySession.field.stop?.message);
for (const player of ordinarySession.battle.players) {
  assert.equal(player.appearanceState.magitek, null);
  const appearance = ordinarySession.battle.appearanceFrame(player.id, { key: "default", bodyFrame: 0, armorFrame: 0 });
  assert.equal(appearance.armor, null);
  assert.equal(appearance.body.sprite, player.appearance.bodySprites[battle.common.battleAppearance.aliases.default.body[0]]);
  assert.deepEqual(appearance.body.textureOffset, { x: 0, y: 0 });
  assert.deepEqual(appearance.body.position, { x: 0, y: 0 });
  const qualification = ordinarySession.battle.commandQualification(player.id);
  assert.equal(qualification.entries.find((entry) => entry.commandId === 26).released, false);
  assert.equal(qualification.entries.find((entry) => entry.commandId === 1).released, true);
  assert.ok(qualification.entries.find((entry) => entry.commandId === 1).abilityIds.includes(1));
}
cases.push({ name: "FieldGame Remove607 saves and restores ordinary source entry without seed replay" });
const reacquired = { content: structuredClone(conditionEvent.content), game: null };
reacquired.game = GameSession.restore(JSON.parse(JSON.stringify(removedSave)), reacquired.content, battle);
execute(reacquired, { kind: "add-condition", conditionType: 607, target: 0 }, "owned-condition");
assert.equal(reacquired.game.field.stop, null);
assert.deepEqual(reacquired.game.state.snapshot().roster.map((p) => p.conditionIds), [[53], [53], [53]]);
enterBattle(reacquired.game, reacquired.content);
assert.ok(reacquired.game.battle, reacquired.game.field.stop?.message);
for (const player of reacquired.game.battle.players) {
  assert.equal(player.appearanceState.magitek.conditionId, 53);
  assert.ok(reacquired.game.battle.appearanceFrame(player.id, { key: "default", bodyFrame: 0, armorFrame: 0 }).armor);
  const qualification = reacquired.game.battle.commandQualification(player.id);
  assert.equal(qualification.entries.find((entry) => entry.commandId === 26).released, true);
  assert.equal(qualification.entries.find((entry) => entry.commandId === 1).released, false);
}
cases.push({ name: "FieldGame Add607 restores source command26 and battle armor after ordinary save" });
for (const [label, mutateBattle, mutateField, pattern] of [
  ["missing appearance catalog", (b) => { delete b.common.battleAppearance; }, () => {}, /appearance provider/],
  ["missing source inventory provider", (b) => { delete b.common.battleEntry; }, () => {}, /source catalog/],
  ["unconfirmed template context", (b) => { b.common.qualificationContext.mode = "development-static"; }, () => {}, /来源战斗入口/],
  ["unknown live transportation", () => {}, (f) => { delete f.entry.partyActors; f.entry.transportationId = null; }, /transportation identity/],
]) {
  const alteredBattle = structuredClone(battle), alteredField = structuredClone(field);
  mutateBattle(alteredBattle); mutateField(alteredField);
  const blocked = new GameSession(alteredField, alteredBattle), before = blocked.state.snapshot();
  enterBattle(blocked, alteredField);
  assert.equal(blocked.battle, null, label); assert.equal(blocked.state.inBattle, false, label);
  assert.match(blocked.field.stop.message, pattern, label);
  assert.deepEqual(blocked.state.snapshot(), before, label + " cannot leave a lease or mutate ownership");
  cases.push({ name: label + " rejects source battle entry atomically" });
}
const report = { kind: "source-system-integration-v23", sourceSetHash: field.parentSourceSetHash,
  fieldHash: field.contentHash, battleCatalogHash: battle.contentHash, cases,
  originalRuntimeOracle: false, storyCoverageExpanded: false, completeMigration: false };
await writeFile(root + "build/reports/system-integration-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, cases: cases.length, fieldHash: field.contentHash, battleCatalogHash: battle.contentHash }));
