import test from "node:test";
import assert from "node:assert/strict";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import {
  battleAITargetBlocker,
  planBattleAITarget,
  sourceCounterTargeting,
  type BattleAITargetInput,
  type BattleAITargetUnit,
} from "../src/core/battle-ai-targets.js";
import { battleTargetChoices, resolveBattleTargets, type TargetChoice, type TargetRule } from "../src/core/battle-targets.js";

const noDraw = (): never => assert.fail("This decision must not draw target randomness");
const rule = (range: number, system = 3): TargetRule => {
  const result = compileTargetRule(range, system);
  assert.ok(result);
  return result;
};
function fixture(range: number, system = 3): BattleAITargetInput {
  const units: BattleAITargetUnit[] = [
    { id: "player:fallen", side: "player", hp: 0 },
    { id: "player:1", side: "player", hp: 80 },
    { id: "enemy:1", side: "enemy", hp: 100 },
    { id: "enemy:fallen", side: "enemy", hp: 0 },
  ];
  return { actor: units[2]!, units, eligiblePlayers: [units[1]!], range, rule: rule(range, system), formation: "normal" };
}
function finalChoice(input: BattleAITargetInput, raw: TargetChoice, units = input.units): TargetChoice | null {
  // The executor retains the captured source selection type, including an AI
  // single selected from a menu-side range. This is not another AI decision.
  const targeting: TargetRule = { ...input.rule, modes: [raw.selection.kind], defaultMode: raw.selection.kind };
  return resolveBattleTargets(raw.selection,
    battleTargetChoices(targeting, input.actor, units, input.formation), units, noDraw);
}

test("shared admission distinguishes normal raw scopes from the bounded received-actor and self counter lanes", () => {
  for (const range of [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 20, 21]) {
    assert.equal(battleAITargetBlocker(range, rule(range), "normal"), null, String(range));
    assert.equal(battleAITargetBlocker(range, rule(range), "counter") === null, range === 3 || range === 5 || range === 7);
  }
  assert.match(battleAITargetBlocker(13, rule(3), "normal")!, /target range 13/);
  assert.match(battleAITargetBlocker(0, rule(3), "normal")!, /Invalid/);
  assert.match(battleAITargetBlocker(3.5, rule(3), "normal")!, /Invalid/);
});

test("range and rule must agree without using player default target choices", () => {
  assert.match(battleAITargetBlocker(4, rule(3), "normal")!, /mismatch/);
  assert.match(battleAITargetBlocker(3, { ...rule(3), relation: "ally" }, "normal")!, /mismatch/);
  assert.match(battleAITargetBlocker(6, { ...rule(6), normalFormationOnly: false }, "normal")!, /mismatch/);
  assert.match(battleAITargetBlocker(5, { ...rule(5), defaultRelation: "enemy" }, "normal")!, /mismatch/);
  assert.equal(battleAITargetBlocker(20, { ...rule(20), defaultMode: "single" }, "normal"), null);
});

test("unsupported life and formation cannot become ordinary automatic behavior", () => {
  assert.match(battleAITargetBlocker(7, { ...rule(7), life: "include-fallen-players" }, "normal")!, /life/);
  for (const range of [6, 14, 20, 21]) {
    assert.equal(battleAITargetBlocker(range, rule(range), "normal"), null);
    assert.match(battleAITargetBlocker(range, rule(range), "normal", "opposed")!, /formation/);
  }
  assert.equal(battleAITargetBlocker(4, rule(4), "normal", "opposed"), null);
  const input = fixture(20); input.formation = "opposed";
  assert.throws(() => planBattleAITarget(input, noDraw), /formation/);
});

test("strict rule metadata rejects holes, duplicates, accessors and extra fields before a decision", () => {
  const sparse = rule(6); sparse.modes = ["single", , "side"] as TargetRule["modes"];
  const duplicate = rule(6); duplicate.modes = ["single", "side", "side"];
  const accessor = rule(3);
  Object.defineProperty(accessor, "life", { get: () => assert.fail("Do not evaluate rule accessors") });
  const modeAccessor = rule(3);
  Object.defineProperty(modeAccessor.modes, "0", { get: () => assert.fail("Do not evaluate mode accessors") });
  for (const invalid of [sparse, duplicate, accessor, modeAccessor, { ...rule(3), extra: true }])
    assert.match(battleAITargetBlocker(3, invalid, "normal")!, /Invalid/);
});

test("ranges 3 and 7 preserve one uniform target draw even with one eligible player", () => {
  for (const range of [3, 7]) {
    const input = fixture(range), before = structuredClone(input), calls: number[][] = [];
    const choice = planBattleAITarget(input, (min, max) => { calls.push([min, max]); return min; });
    assert.deepEqual(calls, [[0, 0]]);
    assert.deepEqual(choice, { selection: { kind: "single", id: "player:1" }, targetIds: ["player:1"] });
    assert.deepEqual(input, before);
  }
});

test("mixed menu modes including default-all 20/21 still select one eligible player", () => {
  for (const range of [6, 14, 20, 21]) {
    const input = fixture(range, 1), second: BattleAITargetUnit = { id: "player:2", side: "player", hp: 70 };
    input.units = [...input.units, second]; input.eligiblePlayers = [...input.eligiblePlayers, second];
    if (range === 20 || range === 21) assert.equal(input.rule.defaultMode, "side");
    let calls = 0;
    assert.deepEqual(planBattleAITarget(input, (min, max) => {
      calls++; assert.deepEqual([min, max], [0, 1]); return max;
    }), { selection: { kind: "single", id: second.id }, targetIds: [second.id] });
    assert.equal(calls, 1);
  }
});

test("range 1 draws from raw enemies including fallen instances before final alive fallback", () => {
  const input = fixture(1), calls: number[][] = [];
  const raw = planBattleAITarget(input, (min, max) => { calls.push([min, max]); return max; })!;
  assert.deepEqual(calls, [[0, 1]], "The fallen enemy is not removed by menu eligibility");
  assert.deepEqual(raw, { selection: { kind: "single", id: "enemy:fallen" }, targetIds: ["enemy:fallen"] });
  assert.deepEqual(finalChoice(input, raw), {
    selection: { kind: "single", id: "enemy:1" }, targetIds: ["enemy:1"],
  });
});

test("range 2 keeps raw fallen enemies and forced group identity through final filtering", () => {
  const input = fixture(2), raw = planBattleAITarget(input, noDraw)!;
  assert.deepEqual(raw, { selection: { kind: "side", side: "enemy" }, targetIds: ["enemy:1", "enemy:fallen"] });
  assert.deepEqual(finalChoice(input, raw), { selection: raw.selection, targetIds: ["enemy:1"] });
});

test("ranges 4 and 8 derive from raw players rather than ordinary filtered players", () => {
  for (const range of [4, 8]) {
    const input = fixture(range), raw = planBattleAITarget(input, noDraw)!;
    assert.deepEqual(raw, { selection: { kind: "side", side: "player" }, targetIds: ["player:fallen", "player:1"] });
    assert.deepEqual(finalChoice(input, raw), { selection: raw.selection, targetIds: ["player:1"] },
      "One surviving target does not change the raw group type");
  }
});

test("forced ranges 2 and 4 remain groups even when the raw list contains one member", () => {
  const enemyOnly = fixture(2); enemyOnly.units = [enemyOnly.actor]; enemyOnly.eligiblePlayers = [];
  assert.deepEqual(planBattleAITarget(enemyOnly, noDraw), {
    selection: { kind: "side", side: "enemy" }, targetIds: [enemyOnly.actor.id],
  });
  const playerOnly = fixture(4);
  playerOnly.units = [playerOnly.actor, playerOnly.eligiblePlayers[0]!];
  assert.deepEqual(planBattleAITarget(playerOnly, noDraw), {
    selection: { kind: "side", side: "player" }, targetIds: ["player:1"],
  });
});

test("range 8 with one raw player preserves a single instance even after another player enters", () => {
  const input = fixture(8); input.units = [input.actor, input.eligiblePlayers[0]!];
  const raw = planBattleAITarget(input, noDraw)!;
  assert.deepEqual(raw, { selection: { kind: "single", id: "player:1" }, targetIds: ["player:1"] });
  assert.equal(input.rule.defaultMode, "side");
  const later = [...input.units, { id: "player:dynamic:1", side: "player" as const, hp: 90 }];
  assert.deepEqual(finalChoice(input, raw, later), raw);
});

test("a fallen-only raw range 8 remains single, with no admitted final target or default fallback", () => {
  const input = fixture(8); input.units = [input.units[0]!, input.actor]; input.eligiblePlayers = [];
  const raw = planBattleAITarget(input, noDraw)!;
  assert.deepEqual(raw, { selection: { kind: "single", id: "player:fallen" }, targetIds: ["player:fallen"] });
  assert.equal(finalChoice(input, raw), null);
});

test("retired single instances never alias new same-slot members, while queued group intent rebuilds", () => {
  const single = fixture(8); single.units = [single.actor, single.eligiblePlayers[0]!];
  const selected = planBattleAITarget(single, noDraw)!;
  const replacement: BattleAITargetUnit = { id: "player:dynamic:1", side: "player", hp: 90 };
  assert.equal(finalChoice(single, selected, [single.actor, replacement]), null,
    "The retired ID is absent, so same-side fallback must not reinterpret a reused slot");
  const group = fixture(8), all = planBattleAITarget(group, noDraw)!;
  assert.deepEqual(finalChoice(group, all, [group.actor, group.eligiblePlayers[0]!, replacement]), {
    selection: { kind: "side", side: "player" }, targetIds: ["player:1", replacement.id],
  });
});

test("range 9 captures both factions including fallen raw members, then filters only at execution", () => {
  const input = fixture(9), raw = planBattleAITarget(input, noDraw)!;
  assert.deepEqual(raw, { selection: { kind: "all" }, targetIds: input.units.map(unit => unit.id) });
  assert.deepEqual(finalChoice(input, raw), { selection: { kind: "all" }, targetIds: ["player:1", "enemy:1"] });
});

test("range 9 preserves player-then-enemy raw AddRange order without sorting instance IDs", () => {
  const input = fixture(9);
  input.units = [input.units[3]!, input.units[1]!, input.actor, input.units[0]!];
  assert.deepEqual(planBattleAITarget(input, noDraw), { selection: { kind: "all" },
    targetIds: ["player:1", "player:fallen", "enemy:fallen", "enemy:1"] });
});

test("the bounded side projection for range 9 derives single-side and one-instance selections", () => {
  const input = fixture(9); input.units = input.units.filter(unit => unit.side === "enemy"); input.eligiblePlayers = [];
  const raw = planBattleAITarget(input, noDraw)!;
  assert.deepEqual(raw, { selection: { kind: "side", side: "enemy" }, targetIds: ["enemy:1", "enemy:fallen"] });
  assert.deepEqual(finalChoice(input, raw), { selection: raw.selection, targetIds: ["enemy:1"] });
  input.units = [input.actor];
  assert.deepEqual(planBattleAITarget(input, noDraw), { selection: { kind: "single", id: input.actor.id }, targetIds: [input.actor.id] });
});

test("self selection has no target draw and never follows the player's default relation", () => {
  const input = fixture(5), before = structuredClone(input), raw = planBattleAITarget(input, noDraw)!;
  assert.deepEqual(raw, { selection: { kind: "single", id: input.actor.id }, targetIds: [input.actor.id] });
  assert.deepEqual(finalChoice(input, raw), raw); assert.deepEqual(input, before);
  input.actor = { ...input.actor, hp: 0 };
  input.units = input.units.map(unit => unit.id === input.actor.id ? input.actor : unit);
  assert.equal(planBattleAITarget(input, noDraw), null);
});

test("an empty ordinary player projection and empty raw player groups have no guessed fallback", () => {
  const single = fixture(3); single.eligiblePlayers = [];
  assert.equal(planBattleAITarget(single, noDraw), null, "Raw living players do not authorize an unknown eligibility fallback");
  for (const range of [4, 8]) {
    const input = fixture(range); input.units = input.units.filter(unit => unit.side === "enemy"); input.eligiblePlayers = [];
    assert.equal(planBattleAITarget(input, noDraw), null);
  }
});

test("all late roster and eligibility faults are checked before the first random draw", () => {
  const late = fixture(3); late.units = [...late.units, { id: "late", side: "enemy", hp: Number.NaN }];
  const sparse = fixture(3); sparse.units = [...sparse.units, ,] as BattleAITargetUnit[];
  const duplicate = fixture(3); duplicate.units = [...duplicate.units, { ...duplicate.actor }];
  const invalidPlayer = fixture(3); invalidPlayer.eligiblePlayers = [...invalidPlayer.eligiblePlayers, invalidPlayer.units[0]!];
  const stalePlayer = fixture(3); stalePlayer.eligiblePlayers = [{ ...stalePlayer.eligiblePlayers[0]!, hp: 1 }];
  const unheld = fixture(3); unheld.eligiblePlayers = [{ id: "late-player", side: "player", hp: 1 }];
  for (const input of [late, sparse, duplicate, invalidPlayer, stalePlayer, unheld]) {
    const before = structuredClone(input); let draws = 0;
    assert.throws(() => planBattleAITarget(input, () => { draws++; return 0; }), /Invalid|Duplicate/);
    assert.equal(draws, 0); assert.deepEqual(input, before);
  }
});

test("ordinary eligible players retain raw source order without executing roster array accessors", () => {
  const input = fixture(3), second: BattleAITargetUnit = { id: "player:2", side: "player", hp: 70 };
  input.units = [...input.units, second]; input.eligiblePlayers = [second, ...input.eligiblePlayers];
  assert.throws(() => planBattleAITarget(input, noDraw), /player order/);
  const accessor = fixture(3);
  Object.defineProperty(accessor.units, "3", { get: () => assert.fail("Do not evaluate roster accessors") });
  assert.throws(() => planBattleAITarget(accessor, noDraw), /Invalid automatic target roster/);
});

test("a stale or non-enemy actor cannot acquire another instance's AI target decision", () => {
  const stale = fixture(1); stale.actor = { ...stale.actor, hp: 1 };
  const absent = fixture(1); absent.units = absent.units.filter(unit => unit.id !== absent.actor.id);
  const player = fixture(1); player.actor = player.eligiblePlayers[0]!;
  for (const input of [stale, absent, player])
    assert.throws(() => planBattleAITarget(input, noDraw), /current enemy instance/);
});

test("malformed random results fail without changing a valid roster", () => {
  for (const value of [-1, 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const input = fixture(3), before = structuredClone(input);
    assert.throws(() => planBattleAITarget(input, () => value), /random draw/);
    assert.deepEqual(input, before);
  }
});

test("returned raw target identities are detached from the roster and all prior choices", () => {
  const input = fixture(9), before = structuredClone(input), first = planBattleAITarget(input, noDraw)!;
  first.targetIds.push("unowned"); first.selection = { kind: "single", id: "unowned" };
  assert.deepEqual(input, before);
  assert.deepEqual(planBattleAITarget(input, noDraw), { selection: { kind: "all" }, targetIds: before.units.map(unit => unit.id) });
});


test("source CounterAct dispatch uses selected self range without widening received-command or nonself scopes", () => {
  for (const range of [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 20, 21]) {
    assert.equal(sourceCounterTargeting(range, "received-actor"), range === 5 ? "automatic" : "received-actor");
    assert.equal(sourceCounterTargeting(range, "automatic"), "automatic");
  }
  for (const range of [0, -1, 3.5, NaN, Infinity, 0x80000000])
    assert.throws(() => sourceCounterTargeting(range, "received-actor"), /Invalid/);
  assert.throws(() => sourceCounterTargeting(5, "unknown" as "automatic"), /Invalid/);
  assert.match(battleAITargetBlocker(2, rule(2), "counter")!, /counter/);
  assert.match(battleAITargetBlocker(5, rule(3), "counter")!, /mismatch/);
});
