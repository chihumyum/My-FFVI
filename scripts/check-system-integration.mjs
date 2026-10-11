// Real content with private controlled events; does not grant story progress.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { GameSession } from "../dist/src/core/game-session.js";
import { battleDefinitionBlocker } from "../dist/src/core/battle-content.js";
import { hash } from "../dist/src/compiler/content.js";
const root = new URL("..", import.meta.url).pathname;
const field = JSON.parse(await readFile(root + "build/game/narshe.json"));
const battle = JSON.parse(await readFile(root + "build/game/opening-playable.json"));
for (const content of [field, battle]) {
  const { contentHash, ...input } = content;
  assert.equal(contentHash, hash(input));
}
assert.equal(battle.common.profile, "narshe-playability-v21");
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
assert.match(battleDefinitionBlocker(f.game.state.partyPlayers(), battle.common.qualificationContext,
  battle.common.conditions), /来源战斗入口/);
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
const report = { kind: "source-system-integration-v21", sourceSetHash: field.parentSourceSetHash,
  fieldHash: field.contentHash, battleCatalogHash: battle.contentHash, cases,
  originalRuntimeOracle: false, storyCoverageExpanded: false, completeMigration: false };
await writeFile(root + "build/reports/system-integration-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, cases: cases.length, fieldHash: field.contentHash, battleCatalogHash: battle.contentHash }));
