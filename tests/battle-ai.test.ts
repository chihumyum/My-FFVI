import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleAI } from "../src/compiler/battle-ai.js";
import {
  BattleAIError,
  drawBattleAIAbility,
  planBattleAITurn,
  startBattleAI,
  type BattleAIContext,
} from "../src/core/battle-ai.js";
import { aiSource, cyclingAI, syntheticAI } from "./fixtures/battle-ai.js";

const context: BattleAIContext = {
  conditionIds: [],
  players: [{ level: 1 }],
  enemies: [{ level: 2 }],
};

test("AI suspends at SyncAI and cycles table rows without flattening their distributions", () => {
  const program = cyclingAI([601, 602, 603]);
  let state = startBattleAI(program, context);
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
  const first = startBattleAI(program, context),
    second = startBattleAI(program, context);
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
    startBattleAI(program, context),
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
  const state = startBattleAI(program, context);
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
    startBattleAI(program, context),
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
    startBattleAI(program, context),
    context,
  );
  const visited: number[] = [];
  for (const act of turn.acts)
    drawBattleAIAbility(act, {
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
  const state = startBattleAI(program, context);
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
    () => planBattleAITurn(invalid, startBattleAI(invalid, context), context),
    /unsupported AI/,
  );
  const cycle = syntheticAI([["Nop"], ["SyncAI"], ["JumpBattleAI", [1]]]);
  assert.throws(
    () => planBattleAITurn(cycle, startBattleAI(cycle, context), context),
    /cycle without SyncAI/,
  );
  const malformed = syntheticAI([["Nop", [12]], ["SyncAI"]]);
  assert.throws(() => startBattleAI(malformed, context), /unsupported AI/);
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
  assert.throws(() => startBattleAI(unknownFlag, context), /script flags/);
  const corrupt = cyclingAI([601]);
  (corrupt.instructions[2]!.op as unknown as { kind: string }).kind = "unknown";
  assert.throws(
    () => planBattleAITurn(corrupt, startBattleAI(corrupt, context), context),
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
    () => planBattleAITurn(program, startBattleAI(program, context), context),
    (e) =>
      e instanceof BattleAIError &&
      e.source?.sha256 === source.sha256 &&
      e.pc === 1,
  );
});
