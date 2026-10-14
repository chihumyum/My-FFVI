import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { cyclingAI } from "./fixtures/battle-ai.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import type { RandomAbilityDispatchPlan, ForcedEscapeDispatchPlan } from "../src/core/battle-derived-actions.js";

function setup(self = false) {
  const supplied = fixture();
  supplied.players.forEach(unit => unit.hp = 2000);
  supplied.enemies.forEach(unit => unit.hp = 2000);
  supplied.initialAtb = { player: [0, 0], enemy: [100, 100] };
  const child = structuredClone(supplied.abilities[11]!);
  child.id = 16; child.program.abilityId = 16; child.cost = 0;
  child.program.range = 5; child.plan!.targeting = compileTargetRule(5, 3)!;
  supplied.abilities[16] = child;
  const effect: RandomAbilityDispatchPlan = {
    kind: "random-ability", slot: 1, rawValues: [46, 0, 1], groupId: 46,
    fallbackAbilityId: 0, retarget: true,
    rows: [{ rowId: 1171, abilityId: 13, invocationRate: self ? 0 : 50, conditionGroupId: 0, conditionIds: [] },
      { rowId: 1172, abilityId: 13, invocationRate: self ? 0 : 50, conditionGroupId: 0, conditionIds: [] },
      { rowId: 1173, abilityId: 16, invocationRate: self ? 100 : 0, conditionGroupId: 0, conditionIds: [] }],
    primaryResult: { hitType: 0, value: 0 },
    child: { actType: 5, useType: 1, commandId: null, armType: 0,
      actAbilityType: 0, continuousCommandCount: 1, isCounter: false },
  };
  const parent = structuredClone(supplied.abilities[13]!);
  parent.id = 15; parent.program.abilityId = 15; parent.power = 0; parent.wait = 0;
  parent.plan!.effects = [effect]; parent.program.range = 7;
  parent.plan!.targeting = compileTargetRule(7, 3)!;
  supplied.abilities[15] = parent;
  supplied.enemies[0]!.abilities = [15, 13, 16];
  supplied.enemies[0]!.ai = cyclingAI([15]);
  return supplied;
}

test("random parent publishes a real zero-value hit and then one separately identified interrupt child", () => {
  for (const self of [false, true]) {
    const supplied = setup(self), battle = new BattleGame(supplied, 951);
    const hp = battle.combatants.map(unit => unit.hp);
    battle.advance(410);
    assert.equal(battle.action!.source.id, 15);
    assert.ok(battle.action!.results.every(result => result.effects.every(effect =>
      effect.resource === "hp" && effect.amount === 0 && !effect.missed)));
    assert.deepEqual(battle.combatants.map(unit => unit.hp), hp);
    const children = battle.pendingActions.filter(action => action.kind === "derived");
    assert.equal(children.length, 1);
    const child = children[0]!;
    assert.equal(child.source.id, self ? 16 : 13);
    assert.equal(child.commandId, null); assert.equal(child.charge, 0);
    assert.deepEqual(child.selection, self ? { kind: "single", id: "e1" } : battle.action!.selection);
    battle.advance(510);
    assert.equal(battle.action!.kind, "derived");
    assert.equal(battle.enemies[0]!.queued, false);
    assert.ok(battle.enemies[0]!.atb < 1, "Parent completed its ordinary gauge before the child started");
    assert.equal(battle.action!.source.id, child.source.id);
  }
});

test("an unavailable zero-weight child rolls back the entire random parent before an action or queue can publish", () => {
  const supplied = setup();
  supplied.abilities[16]!.cost = 1;
  const battle = new BattleGame(supplied, 952);
  battle.advance(400);
  const before = { units: structuredClone(battle.combatants), events: [...battle.events],
    action: structuredClone(battle.action), pending: battle.pendingActions, time: battle.time };
  assert.throws(() => battle.advance(10), /random-ability child 16/);
  assert.deepEqual({ units: battle.combatants, events: battle.events, action: battle.action,
    pending: battle.pendingActions, time: battle.time }, before);
});

test("a forbidden active condition on an unselected child rejects the entire parent before drawing", () => {
  const supplied = setup();
  supplied.conditions.rules.definitions.push({ id: 6, type: 6, overlapped: false, eraseGroupId: 6 });
  supplied.conditions.rules.eraseRules.push({ id: 6, groupId: 6, conditionId: 6, type: 1, eraseConditionId: 0 });
  supplied.conditions.behaviors.push({ id: 6, kind: "silence", name: "Silence", untilType: 2 });
  supplied.enemies[0]!.conditionIds = [6];
  supplied.abilities[16]!.program.forbiddenConditionIds = [6];
  const battle = new BattleGame(supplied, 955);
  battle.advance(400);
  const before = { units: structuredClone(battle.combatants), events: [...battle.events],
    action: structuredClone(battle.action), pending: battle.pendingActions, time: battle.time };
  assert.throws(() => battle.advance(10), /random-ability child 16/);
  assert.deepEqual({ units: battle.combatants, events: battle.events, action: battle.action,
    pending: battle.pendingActions, time: battle.time }, before);
});

function escapeSetup() {
  const supplied = setup();
  supplied.enemies = supplied.enemies.slice(0, 1);
  supplied.conditions.rules.definitions.push({ id: 3, type: 3, overlapped: false, eraseGroupId: 33 });
  supplied.conditions.rules.eraseRules.push({ id: 33, groupId: 33, conditionId: 3, type: 1, eraseConditionId: 0 });
  supplied.conditions.behaviors.push({ id: 3, kind: "escape", name: "", untilType: 2 });
  const effect: ForcedEscapeDispatchPlan = { kind: "forced-escape", slot: 1,
    rawValues: [2, 0, 0], actorDomain: "enemy", target: "self", conditionId: 3,
    conditionType: 3, primaryResult: { hitType: 0, value: 0 } };
  const ability = structuredClone(supplied.abilities[13]!);
  ability.id = 18; ability.program.abilityId = 18; ability.program.range = 5;
  ability.plan!.targeting = compileTargetRule(5, 2)!; ability.plan!.effects = [effect];
  supplied.abilities[18] = ability;
  supplied.enemies[0]!.abilities = [18]; supplied.enemies[0]!.ai = cyclingAI([18]);
  return supplied;
}

test("enemy self escape preserves HP and identity, stops actions and targets, and does not register death rewards", () => {
  const supplied = escapeSetup(), battle = new BattleGame(supplied, 953), hp = battle.enemies[0]!.hp;
  battle.advance(410);
  assert.equal(battle.enemies[0]!.hp, hp);
  assert.ok(battle.enemies[0]!.conditionIds.includes(3));
  assert.deepEqual(battle.enemyExitState("e1"), { kind: "escaped", conditionId: 3 });
  assert.equal(battle.isCombatantVisible("e1"), false);
  assert.equal(battle.canUse("e1", 18), false);
  assert.deepEqual(battle.targetChoices("a", 10), []);
  assert.deepEqual(battle.registeredDropMonsters, []);
  battle.advance(510);
  assert.equal(battle.phase, "victory");
  assert.equal(battle.reward!.exp, 0); assert.equal(battle.reward!.gil, 0);
  assert.equal(battle.enemies[0]!.hp, hp);
  assert.deepEqual(battle.enemyExitState("e1"), { kind: "escaped", conditionId: 3 });
});

test("derived queues and enemy exits replay with the same complete ownership under different frame partitions", () => {
  for (const supplied of [setup(), escapeSetup()]) {
    const once = new BattleGame(structuredClone(supplied), 954), split = new BattleGame(supplied, 954);
    once.advance(2500);
    for (const dt of [17, 383, 510, 1590]) split.advance(dt);
    assert.deepEqual(split.combatants, once.combatants);
    assert.deepEqual(split.action, once.action);
    assert.deepEqual(split.pendingActions, once.pendingActions);
    assert.deepEqual(split.enemyExitState("e1"), once.enemyExitState("e1"));
    assert.deepEqual(split.events, once.events); assert.deepEqual(split.reward, once.reward);
  }
});

test("an initial Escape state cannot borrow the completed in-battle departure lifecycle", () => {
  const supplied = escapeSetup();
  supplied.enemies[0]!.conditionIds = [3];
  assert.throws(() => new BattleGame(supplied, 956), /initial Escape/);
});
