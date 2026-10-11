import { initialEnemyBehavior } from "../src/core/enemy-behavior.js";
import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleAI } from "../src/compiler/battle-ai.js";
import {
  BattleAIError,
  drawBattleAIAbility,
  selectBattleAIAbilities,
  planBattleAITurn,
  startBattleAI,
  type BattleAIContext,
} from "../src/core/battle-ai.js";
import { aiSource, cyclingAI, syntheticAI } from "./fixtures/battle-ai.js";

const context: BattleAIContext = {
  self: { hp: 100, mp: 10, monsterId: 1, behavior: initialEnemyBehavior() },
  conditionIds: [],
  players: [{ level: 1 }],
  enemies: [{ level: 2 }],
};

test("initialization writes 15-cell per-enemy parameters and finite variable loops make progress", () => {
  const program = syntheticAI([
    ["VariableAssign", [-7, 0]],
    ["Nop"],
    ["ValueCalc", [0, 1], [], ["＋"]],
    ["IsVariableComparison", [0, 3, 5], [], ["≧"]],
    ["JumpBattleAI", [1]],
    ["Nop"],
    ["VariableAssign", [14, 91]],
    ["ModeSet", [2]],
    ["ModeCount"],
    ["SyncAI"],
  ]);
  const initial = startBattleAI(program, context);
  assert.equal(initial.behavior.variables.length, 15);
  assert.equal(initial.behavior.variables[0], 3);
  assert.equal(initial.behavior.variables[14], 91);
  assert.equal(initial.behavior.mode, 3);
  assert.equal(initial.visited.filter((pc) => pc === 2).length, 3);
  assert.equal(initial.state.pc, 9);
  assert.deepEqual(context.self.behavior, initialEnemyBehavior());
  initial.behavior.variables[0] = 99;
  assert.equal(startBattleAI(program, context).behavior.variables[0], 3);
});

test("variable and mode progress survives turns only when the owner commits it", () => {
  const program = syntheticAI([
    ["VariableAssign", [14, 7]],
    ["ModeSet", [2]],
    ["SyncAI"],
    ["StartTable", [0]],
    ["ValueCalc", [14, 1], [], ["＋"]],
    ["ModeCount"],
    ["IsVariableComparison", [14, 9, 10], [], ["≧"]],
    ["Act", [601]],
    ["EndTable"],
    ["JumpBattleAI", [1]],
    ["Nop"],
    ["Act", [602]],
    ["EndTable"],
    ["JumpBattleAI", [1]],
  ]);
  const initial = startBattleAI(program, context);
  const next = (turn: typeof initial) =>
    planBattleAITurn(program, turn.state, {
      ...context,
      self: { ...context.self, behavior: turn.behavior },
    });
  const first = next(initial),
    second = next(first);
  assert.equal(first.acts[0]!.abilities[0], 601);
  assert.equal(second.acts[0]!.abilities[0], 602);
  assert.equal(first.behavior.mode, 3);
  assert.equal(second.behavior.mode, 4);
  assert.equal(second.behavior.variables[14], 9);
  assert.equal(initial.behavior.variables[14], 7);
  assert.equal(initial.behavior.mode, 2);
  assert.deepEqual(next(initial), first);
});

test("mode predicates use their own register, with signed counter overflow", () => {
  const ctx = structuredClone(context);
  ctx.self.behavior.mode = 2147483647;
  ctx.self.behavior.variables[0] = 2;
  const program = syntheticAI([
    ["ModeCount"],
    ["IsModeSelecting", [-2147483648, 3]],
    ["UnknownWrongMode"],
    ["Nop"],
    ["IsNotModeSelecting", [2, 6]],
    ["UnknownVariableAlias"],
    ["Nop"],
    ["SyncAI"],
  ]);
  const initial = startBattleAI(program, ctx);
  assert.equal(initial.behavior.mode, -2147483648);
  assert.equal(initial.behavior.variables[0], 2);
  assert.equal(initial.state.pc, 7);
});

test("HP and MP branches read current integer resources at exact thresholds", () => {
  for (const resource of ["hp", "mp"] as const) {
    const program = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      [resource === "hp" ? "IsCheckHp" : "IsCheckMp", [20, 7], [], ["≦"]],
      ["StartTable", [0]],
      ["Act", [601]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
      ["Nop"],
      ["StartTable", [1]],
      ["Act", [602]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
    ]);
    for (const value of [0, 19, 20, 21, 10000]) {
      const ctx = { ...context, self: { ...context.self, [resource]: value } };
      const initial = startBattleAI(program, ctx);
      assert.equal(
        planBattleAITurn(program, initial.state, ctx).acts[0]!.abilities[0],
        value <= 20 ? 602 : 601,
      );
    }
    const ctx = {
      ...context,
      self: { ...context.self, [resource]: Number.NaN },
    };
    assert.throws(
      () => planBattleAITurn(program, startBattleAI(program, ctx).state, ctx),
      (e) => e instanceof BattleAIError && e.pc === 2,
    );
  }
});

test("integer operations and comparison result equal to one match the shared script calculator", () => {
  const program = syntheticAI([
    ["VariableAssign", [0, 2147483647]],
    ["ValueCalc", [0, 1], [], ["＋"]],
    ["ValueCalc", [0, 0], [], ["÷"]],
    ["ValueCalc", [0, 0], [], ["％"]],
    ["IsVariableComparison", [0, 2, 8], [], ["＋"]],
    ["IsVariableComparison", [0, 1, 6], [], ["＋"]],
    ["Nop"],
    ["SyncAI"],
    ["Nop"],
    ["UnknownTruthyBranch"],
  ]);
  const initial = startBattleAI(program, context);
  assert.equal(initial.state.pc, 7);
  assert.equal(initial.behavior.variables[0], 0);
  assert.equal(initial.visited.includes(9), false);
  const overflow = syntheticAI([
    ["VariableAssign", [0, -2147483648]],
    ["ValueCalc", [0, -1], [], ["÷"]],
    ["SyncAI"],
  ]);
  assert.throws(
    () => startBattleAI(overflow, context),
    (e) =>
      e instanceof BattleAIError && e.pc === 1 && /overflow/.test(e.message),
  );
  assert.deepEqual(context.self.behavior, initialEnemyBehavior());
});

test("unknown parameter addresses and malformed arithmetic never acquire implicit defaults", () => {
  for (const op of [
    ["VariableAssign", [15, 1]],
    ["VariableAssign", [0]],
    ["ValueCalc", [0, 1], [], ["+"]],
    ["ValueCalc", [0, 1], [], ["＋", "extra"]],
    ["ModeSet", []],
    ["ModeCount", [1]],
    ["IsVariableComparison", [0, 1, 99], [], ["＝"]],
  ] as Parameters<typeof syntheticAI>[0])
    assert.throws(
      () => startBattleAI(syntheticAI([op, ["SyncAI"]]), context),
      /unsupported AI/,
    );
  const ctx = structuredClone(context);
  ctx.self.behavior.variables.pop();
  assert.throws(() => startBattleAI(cyclingAI([601]), ctx), /variable bank/);
});

test("state cycles and unbounded growing loops stop transactionally before hanging a frame", () => {
  for (const [op, message] of [
    [["VariableAssign", [0, 1]], /cycle without SyncAI/],
    [["ValueCalc", [0, 1], [], ["＋"]], /instruction budget/],
  ] as const) {
    const program = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      structuredClone(op) as unknown as Parameters<typeof syntheticAI>[0][0],
      ["JumpBattleAI", [1]],
    ]);
    const initial = startBattleAI(program, context);
    assert.throws(
      () => planBattleAITurn(program, initial.state, context),
      message,
    );
    assert.deepEqual(context.self.behavior, initialEnemyBehavior());
    assert.equal(initial.state.pc, 1);
  }
});

test("AI suspends at SyncAI and cycles table rows without flattening their distributions", () => {
  const program = cyclingAI([601, 602, 603]);
  let state = startBattleAI(program, context).state;
  assert.equal(state.pc, 1);
  assert.equal(state.status, "waiting");
  const sequence = [];
  for (let turn = 0; turn < 7; turn++) {
    const result = planBattleAITurn(program, state, context);
    sequence.push(result.acts.find((a) => a.selected)!.abilities[0]);
    assert.equal(result.acts.length, 3);
    assert.equal(result.state.pc, 1);
    state = result.state;
  }
  assert.deepEqual(sequence, [601, 602, 603, 601, 602, 603, 601]);
});

test("AI instances sharing a program retain independent immutable turn state", () => {
  const program = cyclingAI([601, 602]);
  const first = startBattleAI(program, context).state,
    second = startBattleAI(program, context).state;
  const next = planBattleAITurn(program, first, context);
  assert.equal(next.state.actTurn, 1);
  assert.equal(first.actTurn, 0);
  assert.equal(second.actTurn, 0);
  next.acts[0]!.abilities[0] = 999;
  assert.equal(
    planBattleAITurn(program, first, context).acts[0]!.abilities[0],
    601,
  );
});

test("LoopAct expands ordered repeats as one table row without drawing a lottery", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["LoopAct", [602, 601], [1.9, 2.9]],
    ["Act", [603], [100]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const initial = startBattleAI(program, context);
  const first = planBattleAITurn(program, initial.state, context);
  assert.equal(first.state.actTurn, 1);
  assert.equal(first.state.turnCounter, 2);
  let draws = 0;
  const random = {
    integer: () => {
      draws++;
      return 0;
    },
    float: () => {
      draws++;
      return 0;
    },
  };
  assert.deepEqual(
    first.acts.flatMap((act) => selectBattleAIAbilities(act, random)),
    [602, 601, 601],
  );
  assert.equal(draws, 1); // Unselected Act still draws; LoopAct never does.
  const second = planBattleAITurn(program, first.state, context);
  assert.deepEqual(
    second.acts.flatMap((act) => selectBattleAIAbilities(act, random)),
    [603],
  );
  assert.equal(draws, 2);
  assert.equal(second.state.actTurn, 0);
  assert.equal(initial.state.advancedActCount, 0);
  assert.equal(initial.state.guardianActIsDadaluma, true);
  assert.equal(second.state.advancedActCount, 0);
});

test("LoopAct preserves this build's source monster accounting without mutating committed state", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["LoopAct", [601, 602], [2, 1]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const ctx = { ...context, self: { ...context.self, monsterId: 0x113 } };
  const initial = startBattleAI(program, ctx);
  const first = planBattleAITurn(program, initial.state, ctx);
  assert.equal(first.state.advancedActCount, 6);
  assert.equal(first.state.guardianActIsDadaluma, false);
  const second = planBattleAITurn(program, first.state, ctx);
  assert.equal(second.state.advancedActCount, 9);
  assert.equal(second.state.guardianActIsDadaluma, true);
  assert.equal(initial.state.advancedActCount, 0);
  assert.deepEqual(planBattleAITurn(program, initial.state, ctx), first);
  assert.throws(
    () =>
      planBattleAITurn(program, initial.state, {
        ...ctx,
        self: { ...ctx.self, monsterId: 0 },
      }),
    /Mnemonics\/3: invalid source monster identity/,
  );
});

test("loop operand ambiguity and unbounded expansion remain explicit failures", () => {
  for (const [ids, counts, messages] of [
    [[601, 601], [1, 2], []],
    [[601, 602], [1], []],
    [[601], [2147483648], []],
    [[0], [1], []],
    [[601], [1], ["unmigrated message"]],
  ] as [number[], number[], string[]][]) {
    const program = syntheticAI([["LoopAct", ids, counts, messages]]);
    assert.equal(program.instructions[0]!.op.kind, "blocked");
  }
  const noRandom = {
    integer: () => {
      throw new Error("random");
    },
    float: () => {
      throw new Error("random");
    },
  };
  assert.deepEqual(
    selectBattleAIAbilities(
      {
        kind: "loop-act",
        pc: 3,
        selected: true,
        abilities: [601, 602, 603],
        counts: [0, -2, 1],
      },
      noRandom,
    ),
    [603],
  );
  assert.throws(
    () =>
      selectBattleAIAbilities(
        {
          kind: "loop-act",
          pc: 3,
          selected: true,
          abilities: [601],
          counts: [2147483647],
        },
        noRandom,
      ),
    /host action budget/,
  );
});

test("changing table ID resets the turn while the same table preserves it", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["IsMyCondition", [405, 8]],
    ["StartTable", [11]],
    ["Act", [601]],
    ["Act", [602]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["StartTable", [22]],
    ["Act", [701]],
    ["Act", [702]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  let turn = planBattleAITurn(
    program,
    startBattleAI(program, context).state,
    context,
  );
  assert.equal(turn.state.tableId, 11);
  assert.equal(turn.state.actTurn, 1);
  turn = planBattleAITurn(program, turn.state, {
    ...context,
    conditionIds: [5],
  });
  assert.deepEqual(
    turn.acts.filter((a) => a.selected).map((a) => a.abilities),
    [[602]],
  );
  turn = planBattleAITurn(program, turn.state, {
    ...context,
    conditionIds: [405],
  });
  assert.equal(turn.state.tableId, 22);
  assert.deepEqual(
    turn.acts.filter((a) => a.selected).map((a) => a.abilities),
    [[701]],
  );
});

test("level branches use any unit including a fallen player, and preserve faction", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["IsLevelCheck", [1, 7, 7]],
    ["StartTable", [0]],
    ["Act", [601]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["StartTable", [1]],
    ["Act", [701]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const state = startBattleAI(program, context).state;
  const action = (ctx: BattleAIContext) =>
    planBattleAITurn(program, state, ctx).acts[0]!.abilities[0];
  assert.equal(action({ ...context, enemies: [{ level: 99 }] }), 601);
  assert.equal(action({ ...context, players: [{ level: 6 }] }), 601);
  const fallen = { level: 7, hp: 0 };
  assert.equal(action({ ...context, players: [{ level: 1 }, fallen] }), 701);
});

test("float weighting uses strict subtraction boundaries, including the upper endpoint", () => {
  const act = {
    pc: 1,
    abilities: [101, 102],
    weights: [65, 35],
    selected: true,
  };
  const draw = (value: number) =>
    drawBattleAIAbility(act, {
      integer: () => {
        throw new Error("wrong RNG path");
      },
      float: () => value,
    });
  assert.equal(draw(0), 101);
  assert.equal(draw(64.99), 101);
  assert.equal(draw(65), 102);
  assert.equal(draw(100), 102);
  assert.throws(() => draw(100.1), /Invalid AI float/);
});

test("unweighted actions use integer choice and one-option weighted actions still draw", () => {
  const act = { pc: 1, abilities: [101, 102], weights: [], selected: false };
  assert.equal(
    drawBattleAIAbility(act, {
      integer: (min, max) => {
        assert.deepEqual([min, max], [0, 1]);
        return 1;
      },
      float: () => {
        throw new Error("wrong RNG path");
      },
    }),
    102,
  );
  let draws = 0;
  assert.equal(
    drawBattleAIAbility(
      { ...act, abilities: [103], weights: [100] },
      {
        integer: () => {
          throw new Error("wrong RNG path");
        },
        float: () => {
          draws++;
          return 100;
        },
      },
    ),
    103,
  );
  assert.equal(draws, 1);
});

test("weight summation rounds each addition to this build's float precision", () => {
  const ability = drawBattleAIAbility(
    {
      pc: 1,
      abilities: [101, 102, 103],
      weights: [16777216, 1, 1],
      selected: true,
    },
    {
      integer: () => 0,
      float: (min, max) => {
        assert.deepEqual([min, max], [0, 16777216]);
        return max;
      },
    },
  );
  assert.equal(ability, 102);
});

test("native jumps execute after the label address rather than re-running the label", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["JumpBattleAI", [3]],
    ["MysteryLabelInstruction"],
    ["StartTable", [0]],
    ["Act", [601]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const result = planBattleAITurn(
    program,
    startBattleAI(program, context).state,
    context,
  );
  assert.equal(result.acts[0]!.abilities[0], 601);
  assert.equal(result.visited.includes(3), false);
  assert.equal(result.state.pc, 1);
});

test("unselected table rows also consume draws in program order", () => {
  const program = cyclingAI([601, 602, 603]);
  const turn = planBattleAITurn(
    program,
    startBattleAI(program, context).state,
    context,
  );
  const visited: number[] = [];
  for (const act of turn.acts)
    selectBattleAIAbilities(act, {
      integer: () => 0,
      float: () => {
        visited.push(act.pc);
        return 0;
      },
    });
  assert.deepEqual(visited, [3, 4, 5]);
});

test("unknown branches stay inspectable and block precisely when reached", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["IsMyCondition", [405, 7]],
    ["StartTable", [0]],
    ["Act", [601]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["CounterAct", [701]],
  ]);
  const state = startBattleAI(program, context).state;
  assert.equal(program.instructions[8]!.op.kind, "blocked");
  assert.equal(
    planBattleAITurn(program, state, context).acts[0]!.abilities[0],
    601,
  );
  assert.throws(
    () => planBattleAITurn(program, state, { ...context, conditionIds: [405] }),
    (e) => e instanceof BattleAIError && e.pc === 8,
  );
  assert.equal(state.status, "waiting");
  assert.equal(state.actTurn, 0);
});

test("bad jumps, silent nonzero operands and non-progressing loops cannot be no-ops", () => {
  const invalid = syntheticAI([["SyncAI"], ["JumpBattleAI", [99]]]);
  assert.throws(
    () =>
      planBattleAITurn(invalid, startBattleAI(invalid, context).state, context),
    /unsupported AI/,
  );
  const cycle = syntheticAI([["Nop"], ["SyncAI"], ["JumpBattleAI", [1]]]);
  assert.throws(
    () => planBattleAITurn(cycle, startBattleAI(cycle, context).state, context),
    /cycle without SyncAI/,
  );
  const malformed = syntheticAI([["Nop", [12]], ["SyncAI"]]);
  assert.throws(
    () => startBattleAI(malformed, context).state,
    /unsupported AI/,
  );
});

test("messages, invalid weight arity and nonpositive abilities remain explicit blockers", () => {
  for (const act of [
    ["Act", [601], [100], ["source-message"]],
    ["Act", [601, 602], [100]],
    ["Act", [0], [100]],
    ["Act", [601], [-1]],
    ["Act", [601], [0]],
  ] as Parameters<typeof syntheticAI>[0]) {
    const program = syntheticAI([["SyncAI"], act, ["JumpBattleAI", [0]]]);
    assert.equal(program.instructions[1]!.op.kind, "blocked");
  }
});

test("unknown script flags and corrupt compiled opcodes are explicit stops", () => {
  const raw = aiSource([["SyncAI"], ["Exit"]]);
  raw.SystemFlag = { UnreviewedFlag: 0 };
  const unknownFlag = compileBattleAI(raw, null);
  assert.throws(
    () => startBattleAI(unknownFlag, context).state,
    /script flags/,
  );
  const corrupt = cyclingAI([601]);
  (corrupt.instructions[2]!.op as unknown as { kind: string }).kind = "unknown";
  assert.throws(
    () =>
      planBattleAITurn(corrupt, startBattleAI(corrupt, context).state, context),
    /unsupported compiled AI/,
  );
});

test("compiler binds exact object identity without rounding through JavaScript numbers", () => {
  const source = {
    sourceSetHash: "a".repeat(64),
    battleSourceSetHash: "b".repeat(64),
    file: "synthetic.bundle",
    sha256: "c".repeat(64),
    assetPath: "synthetic.json",
    serializedFile: "synthetic",
    objectId: "9223372036854775801",
  };
  const program = compileBattleAI(aiSource([["SyncAI"], ["Mystery"]]), source);
  assert.equal(program.source!.objectId, source.objectId);
  assert.throws(
    () =>
      planBattleAITurn(program, startBattleAI(program, context).state, context),
    (e) =>
      e instanceof BattleAIError &&
      e.source?.sha256 === source.sha256 &&
      e.pc === 1,
  );
});
