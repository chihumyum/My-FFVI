import test from "node:test";
import assert from "node:assert/strict";
import { calculatePhysical, type PhysicalInput } from "../src/core/physical.js";
import { rowPhysicalInput } from "./fixtures/battle-row.js";

function run(input: PhysicalInput, values = [31, 0, 99]) {
  const draws = [...values], ranges: number[][] = [];
  const result = calculatePhysical(input, (min, max) => {
    ranges.push([min, max]); assert.ok(draws.length, "Unexpected row random draw");
    return draws.shift()!;
  });
  assert.equal(draws.length, 0, "Row calculation dropped random draws");
  return { ...result, ranges };
}

test("actor and target back rows each halve at their own stage; front damage is unchanged", () => {
  const input = rowPhysicalInput();
  assert.equal(run(input).amount, 73);
  input.rows.actor = "back";
  assert.equal(run(input).amount, 36); // base98/2=49, variance48, defense36.
  input.rows.actor = "front"; input.rows.target = "back";
  assert.equal(run(input).amount, 36); // front defense73 /2.
  input.rows.actor = "back";
  assert.equal(run(input).amount, 18);
  assert.deepEqual(run(input).ranges, [[0, 31], [0, 255], [0, 99]]);
});

test("actor row truncates before multiply and still applies when flag5 bypasses target defense", () => {
  const input = rowPhysicalInput();
  input.actor.level = 0; input.actor.attack = 5; input.rules.multiplyPercent = 150;
  input.rules.contentFlags = [5]; input.rows.actor = "back"; input.rows.target = "back";
  input.target.conditionTypes = [19, 1]; input.target.side = "player";
  // trunc(5/2)=2; trunc(2*150/100)=3; variance=2. Moving row later yields3.
  assert.equal(run(input).amount, 2);
  input.rows.ignoreActorPenalty = true;
  assert.equal(run(input).amount, 6);
});

test("target row follows defense plus-one and precedes Defend/friendly/critical/absorption", () => {
  const input = rowPhysicalInput(); input.rows.target = "back";
  input.target.defense = 255;
  assert.equal(run(input).amount, 0); // defense contributes1, then row truncates to0.
  input.target.defense = 64; input.target.side = "player"; input.target.conditionTypes = [19, 1];
  input.actor.attackElements = [1]; input.target.elementResistances = { 1: 4 }; input.targetCount = 3;
  // variance97 -> Protect64 -> defense48 -> row24 -> Defend12 -> friendly6
  // -> critical12 -> absorb-12. Absorbed physical skips multi-target halving.
  assert.equal(run(input, [31, 0, 0]).amount, -12);
  input.rows.actor = "back";
  assert.equal(run(input, [31, 0, 0]).amount, -6);
});

test("actor-only exception does not bypass target row; shared exception bypasses both", () => {
  const input = rowPhysicalInput(); input.rows.actor = "back"; input.rows.target = "back";
  input.rows.ignoreActorPenalty = true;
  assert.equal(run(input).amount, 36);
  input.rows.ignoreTargetPenalty = true;
  assert.equal(run(input).amount, 73);
  input.rows.ignoreActorPenalty = false;
  assert.equal(run(input).amount, 36);
});

test("enemy attacks on a rear target preserve enemy base RNG and do not invent a row draw", () => {
  const input = rowPhysicalInput(); input.actor.side = "enemy"; input.actor.attack = 20; input.power = 30;
  input.rows.target = "back"; input.target.side = "player";
  // Enemy base100 -> variance99 -> defense74 -> rear37. No player-friendly half.
  const result = run(input, [0, 31, 0, 99]);
  assert.equal(result.amount, 37);
  assert.deepEqual(result.ranges, [[0, 7], [0, 31], [0, 255], [0, 99]]);
});

test("miss and guaranteed-hit retain their native RNG schedule with rear rows", () => {
  const input = rowPhysicalInput(); input.rows.actor = "back"; input.rows.target = "back";
  input.target.evasion = 255;
  assert.deepEqual(run(input, [31, 0]), { amount: 0, missed: true, critical: false, ranges: [[0, 31], [0, 255]] });
  input.rules.contentFlags = [1];
  assert.deepEqual(run(input, [31, 99]).ranges, [[0, 31], [0, 99]]);
});

test("unknown physical row data rejects before any random consumption", () => {
  for (const rows of [undefined, {}, { actor: "front", target: "back" },
    { actor: "side", target: "back", ignoreActorPenalty: false, ignoreTargetPenalty: false }]) {
    const input = rowPhysicalInput(); input.rows = rows as never;
    assert.throws(() => calculatePhysical(input, () => assert.fail("RNG consumed before row validation")), /row/);
  }
});
