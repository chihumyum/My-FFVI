import test from "node:test";
import assert from "node:assert/strict";
import { changeBattleRow } from "../src/core/battle-row-change.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { projectActionTarget } from "../src/core/action-effects.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { rowChangeFixture, rowChangeTables } from "./fixtures/battle-row-change.js";

test("source self row update preserves identity and alternates native front/back without randomness", () => {
  const effect = { kind: "change-row" as const, slot: 1 };
  const actor = { id: "owner", side: "player" as const };
  for (const row of ["front", "back"] as const) {
    const target = { ...actor, row };
    assert.deepEqual(changeBattleRow(effect, actor, target), {
      resource: "row", slot: 1, before: row, after: row === "front" ? "back" : "front", missed: false,
    });
    assert.equal(target.row, row);
  }
  for (const target of [{ ...actor, id: "other", row: "front" as const },
    { ...actor, side: "enemy" as const, row: "front" as const }, { ...actor, row: undefined }])
    assert.throws(() => changeBattleRow(effect, actor, target), /self target|row/);
});

test("row compiler admits only the ordinary single self function and its source resources/wait", () => {
  const original = rowChangeTables();
  const ability = compileDevelopmentAbility(original.reader(), 4, "换列");
  assert.deepEqual(ability.blockers, []);
  assert.equal(ability.presentation, "row");
  assert.equal(ability.wait, 3);
  assert.deepEqual(ability.plan!.effects, [{ kind: "change-row", slot: 1 }]);
  assert.equal(ability.plan!.targeting.relation, "self");
  for (const [key, value] of [["battle_renge_id", "1"], ["type_id", "4"], ["system_id", "1"],
    ["accuracy_rate", "99"], ["use_value", "1"], ["standard_value", "1"], ["ability_wait", "0"],
    ["process_prog", "multiply"], ["invalid_reflection", "0"]]) {
    const f = rowChangeTables(); f.ability[key!] = value!;
    assert.equal(compileDevelopmentAbility(f.reader(), 4, "Invalid row").plan, null, key);
  }
  for (const change of [(f: ReturnType<typeof rowChangeTables>) => { f.group.function1_value1 = "1"; },
    (f: ReturnType<typeof rowChangeTables>) => { f.group.function2_id = "17"; }]) {
    const f = rowChangeTables(); change(f);
    assert.equal(compileDevelopmentAbility(f.reader(), 4, "Invalid row").plan, null);
  }
});

test("row target projection leaves resources and states intact and rejects actor/target drift", () => {
  const content = rowChangeFixture(), b = new BattleGame(content, 43), actor = b.players[0]!;
  const before = structuredClone(actor), ability = content.abilities[4]!;
  const random = () => { throw new Error("row may not draw"); };
  const conditions = new BattleConditions(content.conditions);
  const result = projectActionTarget(ability.plan!, 0, actor, actor, conditions, random, 1);
  assert.deepEqual(result.state, { hp: actor.hp, mp: actor.mp, row: "back", conditionIds: [] });
  assert.deepEqual(actor, before);
  assert.throws(() => projectActionTarget(ability.plan!, 0, actor, b.players[1]!, conditions, random, 1), /self target/);
  assert.throws(() => projectActionTarget(ability.plan!, 0, actor, actor, conditions, random, 2), /context/);
  assert.throws(() => projectActionTarget(ability.plan!, 0, actor, actor, conditions, random, 1, 1), /context/);
});

test("row enters the ordinary waiting queue, changes once on effect commit, and consumes its turn", () => {
  const b = new BattleGame(rowChangeFixture(), 4343), actor = b.players[0]!;
  b.enemies.forEach((enemy) => { enemy.atb = -1000; });
  assert.equal(b.command(actor.id, 4, "b", 5), false);
  assert.equal(b.command(actor.id, 4, actor.id, 5), true);
  assert.equal(b.pendingActions[0]!.charge > 0, true);
  assert.equal(actor.row, "front");
  b.advance(400); assert.equal(actor.row, "front");
  for (let i = 0; i < 1000 && actor.row === "front"; i++) b.advance(10);
  assert.equal(actor.row, "back");
  assert.deepEqual(b.action!.results[0]!.effects, [{ resource: "row", slot: 1, before: "front", after: "back", missed: false }]);
  assert.equal(b.command(actor.id, 4, actor.id, 5), false);
  b.advance(500);
  assert.equal(actor.row, "back"); assert.equal(actor.queued, false);
  actor.atb = 100;
  assert.equal(b.command(actor.id, 4, actor.id, 5), true);
  for (let i = 0; i < 1000 && actor.row === "back"; i++) b.advance(10);
  assert.equal(actor.row, "front");
});

test("row uses current target penalty for later physical effects and never grants enemy Corps state", () => {
  const b = new BattleGame(rowChangeFixture(), 43), actor = b.players[0]!, enemy = b.enemies[0]!;
  const ability = b.content.abilities[13]!;
  const damage = (row: "front" | "back") => {
    const result = projectActionTarget(ability.plan!, ability.power, enemy, { ...actor, row },
      b.conditions, (min) => min, 1, 0,
      { actor: "front", target: row, ignoreActorPenalty: false, ignoreTargetPenalty: false });
    const effect = result.effects[0]!;
    assert.equal(effect.resource, "hp");
    return effect.resource === "hp" ? effect.amount : 0;
  };
  assert.equal(damage("back"), Math.trunc(damage("front") / 2));
  enemy.abilities.push(4);
  assert.equal(b.canUse(enemy.id, 4), false);
});

test("a late row action failure rolls back the whole tick including row, action, log and time", () => {
  const b = new BattleGame(rowChangeFixture(), 43), actor = b.players[0]!;
  b.enemies.forEach((enemy) => { enemy.atb = -1000; });
  assert.equal(b.command(actor.id, 4, actor.id, 5), true);
  for (let i = 0; i < 1000 && (!b.action || b.action.elapsed < 390); i++) b.advance(10);
  assert.ok(b.action); assert.equal(b.action.elapsed, 390);
  const before = { players: structuredClone(b.players), action: structuredClone(b.action),
    events: structuredClone(b.events), time: b.time, pending: b.pendingActions };
  const host = b as unknown as { observeDropLife(unit: unknown): void };
  const original = host.observeDropLife;
  host.observeDropLife = () => { throw new Error("controlled late publication fault"); };
  assert.throws(() => b.advance(10), /controlled late/);
  host.observeDropLife = original;
  assert.deepEqual({ players: b.players, action: b.action, events: b.events, time: b.time,
    pending: b.pendingActions }, before);
  b.advance(10);
  assert.equal(actor.row, "back");
});
