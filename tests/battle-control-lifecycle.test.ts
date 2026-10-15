import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";
import type { AbilityDefinition } from "../src/core/battle-content.js";

/** Authored small clocks exercise the shared owner. No original condition row,
 * enemy or story state is replaced by these synthetic declarations. */
function setup(sleepUntil = 10, zeroPhysical = false, controlledPlayer = false) {
  const content = fixture();
  content.conditionControlPolicy = { kind: "web-source-control-actions-v1" };
  content.abilities[10] = { ...structuredClone(content.abilities[13]!), id: 10, name: "Authored physical" };
  content.abilities[10]!.program.abilityId = 10;
  content.abilities[10]!.program.range = 7;
  content.abilities[10]!.plan!.targeting.relation = "either";
  if (zeroPhysical) content.players[0]!.defense = 255;
  if (controlledPlayer) {
    content.commands[1] = { ...structuredClone(content.commands[100]!), id: 1, abilityIds: [10] };
    content.players[0]!.commands = [1];
  }
  content.conditions.rules.definitions.push(
    { id: 7, type: 7, overlapped: false, eraseGroupId: 1 },
    { id: 12, type: 12, overlapped: false, eraseGroupId: 1 },
    { id: 70, type: 630, overlapped: false, eraseGroupId: 1 },
    { id: 14, type: 404, overlapped: false, eraseGroupId: 1 },
  );
  content.conditions.rules.eraseRules.push({ id: 1, groupId: 1, type: 2, conditionId: 0, eraseConditionId: 0 });
  content.conditions.behaviors.push(
    { id: 7, kind: "sleep", name: "", untilType: 9, untilValue: sleepUntil },
    { id: 12, kind: "confusion", name: "", untilType: 8, untilValue: 1 },
    { id: 70, kind: "temptation", name: "", untilType: 17, untilValue: 0 },
    { id: 14, kind: "doom", name: "", untilType: 2, untilValue: 1, pauseConditionTypes: [17, 627, 11] },
  );
  for (const [id, conditionId] of [[901, 7], [902, 12], [903, 70], [904, 14]] as const) {
    const definition: AbilityDefinition = structuredClone(content.abilities[12]!);
    Object.assign(definition, { id, name: "Synthetic control " + id, cost: 0, wait: 0, power: 0,
      conditionRecoveryHit: { kind: "source-condition-recovery-hit-v1", forAiType: 0, isMagic: false } });
    definition.plan = { effects: [{ slot: 1, kind: "add-condition", conditionId, fixedHit: true, accuracy: 255 }],
      targeting: { relation: "either", modes: ["single"], defaultMode: "single", defaultRelation: "ally", normalFormationOnly: false, life: "alive" },
      physical: null, magic: null };
    content.abilities[id] = definition;
    content.players.forEach(player => player.abilities.push(id));
    content.commands[100]!.abilityIds.push(id);
  }
  for (const ability of Object.values(content.abilities))
    ability.conditionRecoveryHit ??= { kind: "source-condition-recovery-hit-v1", forAiType: ability.plan?.physical ? 1 : 2,
      isMagic: Boolean(ability.plan?.magic) };
  for (const unit of content.enemies) { unit.hp = 9999; unit.agility = 0; unit.weight = 21; }
  for (const unit of [...content.players, ...content.enemies])
    unit.conditionTraits = { kind: "source-condition-traits-v1", baseUndead: false };
  return { content, battle: new BattleGame(content, 177) };
}
function cast(battle: BattleGame, id: number, target = "a") {
  const caster = battle.players.find(player => player.id === "b")!;
  caster.atb = 100;
  assert.equal(battle.command(caster.id, id, target), true);
  battle.advance(410);
  assert.equal(battle.action?.resolved, true);
}

test("new control conditions require their explicit policy, while old content remains unchanged", () => {
  const { content } = setup();
  delete content.conditionControlPolicy;
  content.players[0]!.conditionIds = [7];
  assert.throws(() => new BattleGame(content, 1), /explicit Web condition-control/);
  content.players[0]!.conditionIds = [];
  assert.doesNotThrow(() => new BattleGame(content, 1));
});

test("sleep removes manual readiness and advances only the admitted progress clock before natural recovery", () => {
  const { battle } = setup(1);
  cast(battle, 901);
  assert.deepEqual(battle.players[0]!.conditionIds, [7]);
  assert.equal(battle.ready.some(player => player.id === "a"), false);
  assert.equal(battle.command("a", 10, "e1"), false);
  const before = battle.controlClockState("a");
  battle.setClockInput({ paused: true, helpPaused: false, progressEnabled: true, uiWaiting: false, forceWaiting: false });
  battle.advance(5000); assert.deepEqual(battle.controlClockState("a"), before);
  battle.setClockInput({ paused: false, helpPaused: false, progressEnabled: true, uiWaiting: false, forceWaiting: false });
  battle.advance(2000);
  assert.deepEqual(battle.players[0]!.conditionIds, []);
  assert.deepEqual(battle.controlClockState("a"), []);
  assert.equal(battle.ready.some(player => player.id === "a"), true);
});

test("a real zero-damage physical hit wakes sleep without an extra timed recovery draw", () => {
  const { battle } = setup(10, true);
  cast(battle, 901); battle.advance(500);
  const caster = battle.players[1]!; caster.atb = 100;
  assert.equal(battle.command("b", 10, "a"), true);
  battle.advance(410);
  assert.ok(battle.action?.results[0]!.effects.some(effect => effect.resource === "hp" && effect.amount === 0 && !effect.missed));
  assert.deepEqual(battle.players[0]!.conditionIds, []);
  assert.deepEqual(battle.controlClockState("a"), []);
});

test("Doom uses actual source traits, defers death during another action and preserves atomic retry", () => {
  const { battle } = setup();
  cast(battle, 904);
  const player = battle.players[0]!, captured = player.conditionTraits;
  delete player.conditionTraits;
  // The one-count timer reaches zero, then requests death only on an unstaged update.
  let failed = false;
  for (let index = 0; index < 5000 && !failed; index++) {
    try { battle.advance(10); } catch (error) { assert.match(String(error), /Undead/); failed = true; }
  }
  assert.equal(failed, true); assert.ok(player.hp > 0);
  const before = { state: battle.controlClockState("a"), time: battle.time, hp: player.hp, pending: battle.pendingActions };
  assert.throws(() => battle.advance(0), /Undead/);
  assert.deepEqual({ state: battle.controlClockState("a"), time: battle.time, hp: player.hp, pending: battle.pendingActions }, before);
  player.conditionTraits = captured!;
  battle.advance(0);
  assert.equal(player.hp, 0); assert.deepEqual(player.conditionIds, [305]);
  assert.deepEqual(battle.controlClockState("a"), []);
  assert.equal(battle.reward, null); assert.equal(battle.phase, "active");
});

test("a late invalid classification rolls back effects, clocks, payment and queues until a single retry", () => {
  const { content, battle } = setup();
  content.conditions.behaviors.find(behavior => behavior.id === 7)!.name = "";
  cast(battle, 901); battle.advance(500);
  const caster = battle.players[1]!; caster.atb = 100;
  delete content.abilities[10]!.conditionRecoveryHit;
  assert.equal(battle.command("b", 10, "a"), true);
  battle.advance(400);
  const before = { units: structuredClone(battle.combatants), clocks: battle.controlClockState("a"), time: battle.time,
    action: structuredClone(battle.action), pending: battle.pendingActions, events: structuredClone(battle.events) };
  assert.throws(() => battle.advance(10), /recovery-hit classification/);
  assert.deepEqual({ units: battle.combatants, clocks: battle.controlClockState("a"), time: battle.time,
    action: battle.action, pending: battle.pendingActions, events: battle.events }, before);
  content.abilities[10]!.conditionRecoveryHit = { kind: "source-condition-recovery-hit-v1", forAiType: 1, isMagic: false };
  battle.advance(0);
  assert.equal(battle.action?.resolved, true);
  assert.deepEqual(battle.players[0]!.conditionIds, []);
});

test("new Fn9 functions are not counted as old hit functions and the same player owner chooses automatic actions", () => {
  const { content, battle } = setup(10, false, true);
  content.abilities[902]!.conditionRecoveryHit = { kind: "source-condition-recovery-hit-v1", forAiType: 1, isMagic: false };
  cast(battle, 902);
  const player = battle.players[0]!;
  assert.deepEqual(player.conditionIds, [12]);
  assert.equal(battle.controlClockState(player.id)[0]!.recovery.physicalHits, 0);
  assert.equal(battle.ready.some(unit => unit === player), false);
  const pending = battle.pendingActions.find(action => action.actor === player.id)!;
  assert.deepEqual(pending.control, { conditionId: 12, kind: "confusion", policy: "web-source-control-actions-v1" });
  assert.equal(pending.commandId, 1); assert.equal(pending.source.id, 10);
  assert.equal(battle.command(player.id, 10, "e1"), false);
  battle.advance(1000);
  assert.strictEqual(battle.players[0], player, "the controller never replaces the combatant owner");
});

test("an unknown automatic candidate rejects the entire status action and retry cannot replay its effects", () => {
  const { content, battle } = setup(10, false, true);
  const old = content.abilities[10]!.plan;
  content.abilities[10]!.plan = null;
  assert.equal(battle.command("b", 902, "a"), true); battle.advance(400);
  const before = { units: structuredClone(battle.combatants), clocks: battle.controlClockState("a"),
    pending: battle.pendingActions, action: structuredClone(battle.action), time: battle.time, events: structuredClone(battle.events) };
  assert.throws(() => battle.advance(10), /Unresolved control ability 10/);
  assert.deepEqual({ units: battle.combatants, clocks: battle.controlClockState("a"),
    pending: battle.pendingActions, action: battle.action, time: battle.time, events: battle.events }, before);
  content.abilities[10]!.plan = old;
  battle.advance(0);
  assert.equal(battle.action?.resolved, true);
  assert.deepEqual(battle.players[0]!.conditionIds, [12]);
  assert.equal(battle.pendingActions.filter(action => action.actor === "a").length, 1);
});

test("removing control cancels its queued intent and releases the same player to ordinary input", () => {
  const { content } = setup(10, true, true);
  content.players[0]!.conditionIds = [12];
  content.abilities[10]!.wait = 100;
  const hit = structuredClone(content.abilities[10]!);
  hit.id = 905; hit.program.abilityId = 905; hit.wait = 0;
  content.abilities[905] = hit; content.players[1]!.abilities.push(905); content.commands[100]!.abilityIds.push(905);
  const battle = new BattleGame(content, 177), player = battle.players[0]!;
  assert.equal(battle.command("b", 905, "a"), true);
  battle.advance(400);
  assert.equal(battle.pendingActions.some(action => action.actor === player.id && action.control?.conditionId === 12), true);
  battle.advance(10);
  assert.deepEqual(player.conditionIds, []);
  assert.equal(battle.pendingActions.some(action => action.actor === player.id), false);
  assert.equal(player.queued, false);
  assert.equal(battle.ready.includes(player), true);
});

test("player source traits can live in common metadata without changing owned templates", () => {
  const { content } = setup();
  content.playerConditionTraits = Object.fromEntries(content.players.map(player => [String(player.sourceId),
    { kind: "source-condition-traits-v1" as const, baseUndead: false }]));
  for (const player of content.players) delete player.conditionTraits;
  const battle = new BattleGame(content, 177);
  cast(battle, 904);
  for (let index = 0; index < 5000 && battle.players[0]!.hp > 0; index++) battle.advance(10);
  assert.equal(battle.players[0]!.hp, 0);
  const invalid = structuredClone(content);
  invalid.playerConditionTraits = { wrong: { kind: "source-condition-traits-v1", baseUndead: false } };
  assert.throws(() => new BattleGame(invalid, 177), /player condition traits/);
  const living = structuredClone(content);
  living.playerConditionTraits![String(living.players[0]!.sourceId)]!.baseUndead = true;
  const undead = new BattleGame(living, 177), target = undead.players[0]!;
  cast(undead, 10, target.id); assert.ok(target.hp > 0 && target.hp < target.maxHp);
  undead.advance(500); cast(undead, 904, target.id);
  for (let index = 0; index < 5000 && target.conditionIds.includes(14); index++) undead.advance(10);
  assert.equal(target.hp, target.maxHp); assert.deepEqual(target.conditionIds, []);
  assert.strictEqual(undead.players[0], target);
});
