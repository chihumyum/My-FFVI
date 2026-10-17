import test from "node:test";
import assert from "node:assert/strict";
import {
  BattleConditions,
  conditionHit,
  conditionsAllowAction,
} from "../src/core/battle-conditions.js";
import { compileConditionGroup } from "../src/compiler/conditions.js";
import { battleTableIndex } from "../src/compiler/battle.js";

const catalog = {
  hpZeroConditionId: 305,
  dying: { conditionId: 304, thresholdDivisor: 8 },
  rules: {
    definitions: [
      { id: 304, type: 4, overlapped: false, eraseGroupId: 1 },
      { id: 305, type: 5, overlapped: false, eraseGroupId: 3 },
      { id: 301, type: 6, overlapped: false, eraseGroupId: 1 },
      { id: 6, type: 99, overlapped: true, eraseGroupId: 1 },
    ],
    eraseRules: [
      { id: 3, groupId: 3, type: 1, conditionId: 305, eraseConditionId: 0 },
      { id: 1, groupId: 1, type: 2, conditionId: 0, eraseConditionId: 0 },
    ],
  },
  behaviors: [
    { id: 304, kind: "dying" as const, name: "Dying", untilType: 3 as const },
    {
      id: 305,
      kind: "unable-fight" as const,
      name: "Fallen",
      untilType: 3 as const,
    },
    {
      id: 301,
      kind: "silence" as const,
      name: "Synthetic silence",
      untilType: 2 as const,
    },
  ],
};
test("derived dying state uses the source ratio boundary and removes one record", () => {
  const engine = new BattleConditions(catalog);
  assert.deepEqual(engine.updateDying(10, 80, [301]), [301, 304]);
  assert.deepEqual(engine.updateDying(11, 80, [304, 301]), [301]);
  assert.deepEqual(engine.updateDying(9, 80, [304, 301]), [304, 301]);
  assert.deepEqual(engine.updateDying(11, 80, [304, 304]), [304]);
  assert.deepEqual(engine.updateDying(0, 80, [304]), [304]);
  assert.deepEqual(engine.battleEnd([304, 301]), [304]);
  assert.deepEqual(engine.settleLife(0, [304], false).conditionIds, [305]);
});
test("HP-zero applies source identity, conflict cleanup and persistent death", () => {
  const engine = new BattleConditions(catalog);
  const before = [301];
  assert.deepEqual(engine.settleLife(0, before, false), {
    hp: 0,
    conditionIds: [305],
  });
  assert.deepEqual(before, [301]);
  assert.deepEqual(engine.settleLife(42, [305], false), {
    hp: 0,
    conditionIds: [305],
  });
  assert.deepEqual(engine.battleEnd([305]), [305]);
  assert.throws(() => engine.settleLife(0, [6], false), /Unimplemented/);
  assert.throws(
    () => new BattleConditions({ ...catalog, hpZeroConditionId: 5 }),
    /HP-zero/,
  );
});
test("removing death restores at least one HP only after all effects settle", () => {
  const engine = new BattleConditions(catalog);
  const change = engine.recover([305], [305]);
  assert.deepEqual(engine.settleLife(0, change.currentIds, true), {
    hp: 1,
    conditionIds: [],
  });
  assert.deepEqual(engine.settleLife(10, change.currentIds, true), {
    hp: 10,
    conditionIds: [],
  });
  assert.deepEqual(engine.settleLife(10, [305], true), {
    hp: 0,
    conditionIds: [305],
  });
  assert.deepEqual(engine.settleLife(0, [305], true), {
    hp: 0,
    conditionIds: [305],
  });
});
test("condition hit uses native evasion units and strict integer threshold", () => {
  const hit = (accuracy: number, evasion: number, draw: number) =>
    conditionHit(accuracy, evasion, (min, max) => {
      assert.deepEqual([min, max], [0, 255]);
      return draw;
    });
  assert.equal(hit(100, 0, 255), true);
  assert.equal(hit(100, 64, 127), true); // chance 50; scaled draw 49.
  assert.equal(hit(100, 64, 128), false); // Equality is a miss.
  assert.equal(hit(100, 128, 0), false);
  assert.equal(hit(254, 128, 0), false);
  assert.equal(
    conditionHit(255, 255, () => assert.fail("Guaranteed branch draws no RNG")),
    true,
  );
  assert.equal(
    conditionHit(500, 255, () => assert.fail("Clamped guaranteed branch")),
    true,
  );
  assert.throws(() => hit(-1, 0, 0), /Invalid/);
  assert.throws(() => hit(100, 0, 256), /Invalid/);
});
test("duplicate and resistance misses precede RNG; fixed-hit keeps its distinct resistance check", () => {
  const engine = new BattleConditions(catalog),
    noRng = () => assert.fail("Unexpected RNG");
  const normal = { accuracy: 100, magicEvasion: 0, fixed: false };
  assert.equal(engine.add([301], {}, 301, normal, noRng).missed, true);
  assert.equal(engine.add([], { 301: 1 }, 301, normal, noRng).missed, true);
  assert.equal(engine.add([], { 301: 0 }, 301, normal, noRng).missed, true);
  assert.equal(
    engine.add([], { 301: 1 }, 301, { ...normal, fixed: true }, noRng).missed,
    true,
  );
  assert.deepEqual(
    engine.add([], { 301: 0 }, 301, { ...normal, fixed: true }, noRng)
      .currentIds,
    [301],
  );
  assert.throws(
    () => engine.add([], { "0301": 1 }, 301, normal, noRng),
    /Noncanonical/,
  );
});
test("recovery preserves ordered multiplicity and preflights the entire request", () => {
  const engine = new BattleConditions(catalog),
    before = [301, 301];
  assert.deepEqual(engine.recover(before, [301]).currentIds, [301]);
  assert.deepEqual(engine.recover(before, [301, 301]).removed, [301, 301]);
  assert.deepEqual(before, [301, 301]);
  assert.equal(engine.recover([], [301]).missed, true);
  assert.throws(() => engine.recover(before, [301, 999]), /Unknown/);
  assert.throws(() => engine.recover([6], [6]), /Unimplemented active/);
  assert.deepEqual(engine.battleEnd([301]), []);
});
test("ability and command restrictions are independent and match row IDs, never effect types", () => {
  assert.equal(conditionsAllowAction([301], [6], []), true);
  assert.equal(conditionsAllowAction([301], [301], []), false);
  assert.equal(conditionsAllowAction([301], [], [301]), false);
  assert.equal(conditionsAllowAction([], [301], [301]), true);
});
test("source group projection retains all rows, their order and duplicates", () => {
  const source = {
    file: "synthetic",
    assetPath: "synthetic",
    objectId: "-9223372036854775807",
    serializedFile: "synthetic",
  };
  const tables = {
    "condition.csv": [{ id: "301" }, { id: "6" }],
    "condition_group.csv": [
      {
        id: "1",
        group_id: "7",
        condition_id: "301",
        type_id: "4",
        invocation_rate: "0",
      },
      {
        id: "2",
        group_id: "7",
        condition_id: "6",
        type_id: "1",
        invocation_rate: "100",
      },
      {
        id: "3",
        group_id: "7",
        condition_id: "301",
        type_id: "6",
        invocation_rate: "50",
      },
    ],
  };
  const reader = battleTableIndex(
    tables,
    Object.fromEntries(Object.keys(tables).map((t) => [t, source])),
  );
  const result = compileConditionGroup(reader, 7);
  assert.deepEqual(result.ids, [301, 6, 301]);
  assert.equal(result.sources[0]!.source.objectId, source.objectId);
  assert.deepEqual(compileConditionGroup(reader, 0).ids, []);
  assert.throws(() => compileConditionGroup(reader, 99), /Unresolved/);
});
