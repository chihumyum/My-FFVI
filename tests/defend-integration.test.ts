import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { projectActionTarget } from "../src/core/action-effects.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { itemFixture } from "./fixtures/items.js";

function defendingFixture() {
  const content = fixture();
  content.conditions.rules.definitions.push({ id: 701, type: 1, overlapped: false, eraseGroupId: 4 });
  content.conditions.rules.eraseRules.push({ id: 4, groupId: 4, conditionId: 0, type: 2, eraseConditionId: 0 });
  content.conditions.behaviors.push({ id: 701, kind: "defend", name: "", untilType: 1 });
  content.abilities[72] = {
    ...structuredClone(content.abilities[10]!), id: 72, name: "Defend", cost: 0, power: 0,
    presentation: "condition",
    program: { ...structuredClone(content.abilities[10]!.program), abilityId: 72, range: 5,
      rules: { system_id: 2, type_id: 5 },
      functions: [{ slot: 1, functionId: 115, type: 15, series: 0, values: [0, 0, 0] }] },
    plan: { effects: [{ slot: 1, kind: "defend", conditionId: 701 }],
      targeting: compileTargetRule(5, 2)!, physical: null, magic: null },
  };
  content.commands[202] = { id: 202, name: "Defend", kind: "ability", abilityIds: [72],
    forbiddenConditionIds: [], referencedAbility: { id: 72, typeId: 5, wait: 0 } };
  content.commands[200] = { id: 200, name: "Items", kind: "item", abilityIds: [],
    forbiddenConditionIds: [], referencedAbility: null };
  for (const player of content.players) {
    player.commands.push(202, 200); player.abilities.push(72);
  }
  content.enemies.forEach((enemy) => { enemy.hp = 2000; });
  return content;
}

test("Defend activates on effect commit, survives its own completion, and clears on the next accepted action", () => {
  const b = new BattleGame(defendingFixture(), 1009), actor = b.players[0]!;
  const resources = [actor.hp, actor.mp];
  assert.equal(b.command(actor.id, 72, "b", 202), false);
  assert.equal(b.command(actor.id, 72, actor.id, 202), true);
  assert.deepEqual(actor.conditionIds, []);
  b.advance(410);
  assert.deepEqual(actor.conditionIds, [701]);
  assert.deepEqual([actor.hp, actor.mp], resources);
  b.advance(500);
  assert.deepEqual(actor.conditionIds, [701]);
  assert.equal(actor.queued, false);
  actor.atb = 100;
  assert.equal(b.command(actor.id, 12, "e1", 100), false);
  assert.deepEqual(actor.conditionIds, [701]);
  assert.equal(b.command(actor.id, 10, "missing", 100), false);
  assert.deepEqual(actor.conditionIds, [701]);
  assert.equal(b.command(actor.id, 10, "e1", 100), true);
  assert.deepEqual(actor.conditionIds, []);
  assert.equal(b.pendingActions.length, 1);
  assert.ok(b.events.every((event) => !event.text.includes("陷入。")));
});

test("an accepted item clears Defend once, while invalid stock or targets preserve both states", () => {
  const c = defendingFixture(); c.players[0]!.conditionIds = [701];
  const b = new BattleGame(c, 1013, undefined, { definitions: { 10: itemFixture() }, stacks: [{ id: 10, count: 1 }], limit: 99 });
  const actor = b.players[0]!;
  assert.equal(b.commandItem(actor.id, 10, { kind: "single", id: "missing" }, 200), false);
  assert.deepEqual(actor.conditionIds, [701]);
  assert.equal(b.commandItem(actor.id, 11, { kind: "single", id: actor.id }, 200), false);
  assert.deepEqual(actor.conditionIds, [701]);
  assert.equal(b.commandItem(actor.id, 10, { kind: "single", id: actor.id }, 200), true);
  assert.deepEqual(actor.conditionIds, []);
  assert.deepEqual(b.inventory, [{ id: 10, count: 1, available: 0 }]);
  b.advance(410);
  assert.deepEqual(b.inventory, [{ id: 10, count: 0, available: 0 }]);
});

test("direct counter admission and execution retain Defend; ordinary enemy admission clears it", () => {
  const c = defendingFixture(), enemy = c.enemies[0]!;
  enemy.conditionIds = [701];
  enemy.ai = syntheticAI([
    ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [13]],
    ["CounterAct", [13]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  const b = new BattleGame(c, 1019);
  assert.equal(b.command("a", 10, "e1", 100), true);
  b.advance(410);
  assert.equal(b.pendingActions[0]!.kind, "counter");
  assert.deepEqual(b.enemies[0]!.conditionIds, [701]);
  b.advance(1410);
  assert.deepEqual(b.enemies[0]!.conditionIds, [701]);
  b.enemies[0]!.atb = 100;
  b.advance(10);
  assert.deepEqual(b.enemies[0]!.conditionIds, []);
});

test("unknown native action-chain branches fail before dropping Defend or publishing an action", () => {
  const c = defendingFixture(); c.players[0]!.conditionIds = [701];
  c.abilities[83] = { ...structuredClone(c.abilities[10]!), id: 83 };
  c.players[0]!.abilities.push(83); c.commands[100]!.abilityIds.push(83);
  const b = new BattleGame(c, 1021), actor = b.players[0]!, before = structuredClone(actor);
  assert.throws(() => b.command(actor.id, 83, "e1", 100), /[Cc]hain|[Dd]efend|[Uu]nresolved|[Uu]nsupported/);
  assert.deepEqual(actor, before);
  assert.deepEqual(b.pendingActions, []);
});

test("action effects derive physical guard from condition identity and do not halve magic", () => {
  const c = defendingFixture(), b = new BattleGame(c, 1031);
  const actor = b.enemies[0]!, target = b.players[0]!, conditions = new BattleConditions(c.conditions);
  actor.level = 25; actor.physical = { attack: 70, strength: 20, accuracy: 100, criticalRate: 0 };
  const damage = (ability: number, guarded: boolean) => {
    const result = projectActionTarget(c.abilities[ability]!.plan!, c.abilities[ability]!.power,
      actor, { ...target, conditionIds: guarded ? [701] : [] }, conditions, (min) => min, 1, 0,
      { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false });
    const effect = result.effects[0]!;
    assert.notEqual(effect.resource, "condition");
    return effect.resource === "condition" ? 0 : effect.amount;
  };
  assert.equal(damage(13, true), Math.trunc(damage(13, false) / 2));
  assert.equal(damage(10, true), damage(10, false));
  const active = [701, 304];
  assert.deepEqual(conditions.battleEnd(active), [304]);
  assert.deepEqual(conditions.settleLife(0, active, false).conditionIds, [305]);
});
