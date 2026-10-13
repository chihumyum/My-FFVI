import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/battle-content.js";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { projectActionTargets } from "../src/core/action-user-conditions.js";
import type { UserConditionEffect } from "../src/core/ability-user-conditions.js";

function content() {
  const f = fixture();
  f.conditions.rules.definitions.push({ id: 701, type: 19, overlapped: false, eraseGroupId: 3 });
  f.conditions.behaviors.push({ id: 701, kind: "physical-protection", name: "Protect", untilType: 2 });
  f.players[0]!.conditionIds = [701];
  for (const enemy of f.enemies) { enemy.hp = 2000; enemy.conditionIds = [701]; }
  const effect: UserConditionEffect = { kind: "user-condition", slot: 2, conditionId: 701, conditionType: 19,
    phase: "fixed-parameter", operation: "remove", rawValues: [701, 0, 1] };
  const ability = f.abilities[10]!;
  ability.cost = 2;
  ability.plan = { effects: [{ kind: "unique-none", slot: 1, primaryResult: "empty-dictionary" }, effect],
    targeting: { ...ability.plan!.targeting, modes: ["side"], defaultMode: "side" }, physical: null, magic: null };
  ability.program.functions = [{ slot: 1, functionId: 1, type: 23, series: 0, values: [0, 0, 0] },
    { slot: 2, functionId: 2, type: 38, series: 0, values: [701, 0, 1] }];
  return f;
}

test("caster conditions thread through nominal targets without changing target conditions or inventing a hit", () => {
  const f = content(), original = structuredClone(f);
  const actor = { ...f.players[0]!, maxHp: 80, maxMp: 8 },
    targets = f.enemies.map(enemy => ({ ...enemy, maxHp: 2000, maxMp: 8 }));
  const result = projectActionTargets(f.abilities[10]!.plan!, 0, actor, targets,
    new BattleConditions(f.conditions), () => { throw new Error("No hit/RNG for an empty primary dictionary"); }, 2);
  assert.deepEqual(result.userConditionIds, []);
  assert.deepEqual(result.userResults.map(r => r.removed), [[701], []]);
  assert.deepEqual(result.userResults.map(r => r.calcResult.hitType), [-1, -1]);
  for (const target of result.targets) {
    assert.deepEqual(target.state.conditionIds, [701]);
    assert.equal(target.state.hp, 2000);
    assert.equal(target.effects[0]!.resource, "none");
    assert.equal("missed" in target.effects[0]!, false);
  }
  assert.deepEqual(f, original);
});

test("the actual battle action commits caster conditions and one cost without target reactions", () => {
  const battle = new BattleGame(content(), 719);
  assert.equal(battle.command("a", 10, { kind: "side", side: "enemy" }), true);
  battle.advance(410);
  assert.deepEqual(battle.players[0]!.conditionIds, []);
  assert.equal(battle.players[0]!.mp, 6);
  assert.ok(battle.enemies.every(enemy => enemy.hp === 2000 && enemy.conditionIds.includes(701)));
  assert.equal(battle.pendingActions.some(action => action.kind === "counter"), false);
  assert.equal(battle.action!.userConditionResults?.length, 2);
  assert.deepEqual(battle.action!.userConditionResults?.map(r => r.ownerId), ["a", "a"]);
});

test("second-target failure leaves caster status, payment, action result and logs intact and retry is deterministic", () => {
  const f = content(), broken = new BattleGame(structuredClone(f), 719), clean = new BattleGame(f, 719);
  for (const battle of [broken, clean]) assert.equal(battle.command("a", 10, { kind: "side", side: "enemy" }), true);
  broken.advance(10);
  const before = structuredClone({ units: broken.combatants, events: broken.events, action: broken.action });
  const referenceTypes = broken.conditions.referenceTypes.bind(broken.conditions);
  let invocations = 0;
  broken.conditions.referenceTypes = ids => {
    if (++invocations === 2) throw new Error("Controlled second nominal target binding unavailable");
    return referenceTypes(ids);
  };
  assert.throws(() => broken.advance(400), /second nominal target binding unavailable/);
  assert.equal(invocations, 2);
  broken.conditions.referenceTypes = referenceTypes;
  assert.equal(broken.players[0]!.mp, before.units[0]!.mp);
  assert.deepEqual(broken.players[0]!.conditionIds, before.units[0]!.conditionIds);
  assert.deepEqual(broken.events, before.events);
  assert.equal(broken.action!.resolved, false);
  assert.equal(broken.action!.userConditionResults, undefined);
  broken.advance(10); clean.advance(420);
  assert.deepEqual(broken.combatants, clean.combatants);
  assert.deepEqual(broken.action, clean.action);
});

test("unproved user UpdateParameter or numerical composition is rejected before random draws", () => {
  const f = content(), actor = { ...f.players[0]!, maxHp: 80, maxMp: 8 },
    target = { ...f.enemies[0]!, maxHp: 2000, maxMp: 8 };
  const plan = f.abilities[10]!.plan!;
  const user = plan.effects[1] as UserConditionEffect;
  user.phase = "update-parameter"; user.rawValues[1] = 1;
  assert.throws(() => projectActionTargets(plan, 0, actor, [target], new BattleConditions(f.conditions),
    () => { throw new Error("RNG was consumed"); }), /Unimplemented joint/);
  user.phase = "fixed-parameter"; user.rawValues[1] = 0;
  plan.effects[0] = { kind: "magic", slot: 1 };
  assert.throws(() => projectActionTargets(plan, 0, actor, [target], new BattleConditions(f.conditions),
    () => { throw new Error("RNG was consumed"); }), /Unimplemented joint/);
});
