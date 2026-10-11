import test from "node:test";
import assert from "node:assert/strict";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import {
  battleTargetChoices,
  resolveBattleTargets,
} from "../src/core/battle-targets.js";
const units = [
  { id: "a", side: "player" as const, hp: 100 },
  { id: "b", side: "player" as const, hp: 100 },
  { id: "c", side: "player" as const, hp: 0 },
  { id: "x", side: "enemy" as const, hp: 100 },
  { id: "y", side: "enemy" as const, hp: 100 },
];
test("source ranges preserve faction, cardinality and default selection", () => {
  const expected: Record<number, string[][]> = {
    1: [["a"], ["b"]],
    2: [["a", "b"]],
    3: [["x"], ["y"]],
    4: [["x", "y"]],
    5: [["a"]],
    6: [["x"], ["y"], ["a"], ["b"], ["x", "y"], ["a", "b"]],
    7: [["x"], ["y"], ["a"], ["b"]],
    8: [
      ["x", "y"],
      ["a", "b"],
    ],
    9: [["a", "b", "x", "y"]],
    14: [["x"], ["y"], ["x", "y"]],
    20: [["x", "y"], ["a", "b"], ["x"], ["y"], ["a"], ["b"]],
    21: [["x", "y"], ["x"], ["y"]],
  };
  for (const [range, ids] of Object.entries(expected)) {
    const rule = compileTargetRule(Number(range), 3)!;
    assert.deepEqual(
      battleTargetChoices(rule, units[0]!, units, "normal").map(
        (c) => c.targetIds,
      ),
      ids,
      range,
    );
  }
  assert.deepEqual(
    battleTargetChoices(
      compileTargetRule(4, 3)!,
      units[3]!,
      units,
      "normal",
    )[0]!.targetIds,
    ["a", "b"],
  );
  assert.deepEqual(
    battleTargetChoices(
      compileTargetRule(6, 1)!,
      units[0]!,
      units,
      "normal",
    )[0]!.targetIds,
    ["a"],
  );
  assert.deepEqual(
    battleTargetChoices(
      compileTargetRule(20, 1)!,
      units[0]!,
      units,
      "normal",
    )[0]!.targetIds,
    ["a", "b"],
  );
});
test("special scopes and unimplemented position groups cannot become whole-faction attacks", () => {
  for (const range of [0, 10, 11, 12, 13, 15, 16, 17, 18, 19, 999])
    assert.equal(compileTargetRule(range, 3), null);
  for (const range of [6, 14, 20, 21])
    assert.deepEqual(
      battleTargetChoices(
        compileTargetRule(range, 3)!,
        units[0]!,
        units,
        "opposed",
      ),
      [],
    );
  assert.deepEqual(
    battleTargetChoices(
      compileTargetRule(4, 3)!,
      units[0]!,
      units,
      "opposed",
    )[0]!.targetIds,
    ["x", "y"],
  );
});
test("lost single targets stay on the selected faction; group intent survives only one member", () => {
  const current = structuredClone(units);
  current[3]!.hp = 0;
  const single = battleTargetChoices(
    compileTargetRule(7, 3)!,
    current[0]!,
    current,
    "normal",
  );
  assert.deepEqual(
    resolveBattleTargets({ kind: "single", id: "x" }, single, current, () =>
      assert.fail("enemy replacement is ordered"),
    )!.targetIds,
    ["y"],
  );
  current[4]!.hp = 0;
  assert.equal(
    resolveBattleTargets(
      { kind: "single", id: "x" },
      battleTargetChoices(
        compileTargetRule(7, 3)!,
        current[0]!,
        current,
        "normal",
      ),
      current,
      () => assert.fail("empty faction must not draw"),
    ),
    null,
  );
  const own = battleTargetChoices(
    compileTargetRule(2, 1)!,
    current[0]!,
    current.filter((u) => u.id !== "b"),
    "normal",
  );
  assert.deepEqual(own, [
    { selection: { kind: "side", side: "player" }, targetIds: ["a"] },
  ]);
});
