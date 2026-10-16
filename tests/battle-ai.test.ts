import { initialEnemyBehavior } from "../src/core/enemy-behavior.js";
import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleAI } from "../src/compiler/battle-ai.js";
import {
  BattleAIError,
  drawBattleAIAbility,
  selectBattleAIAbilities,
  planBattleAITurn,
  planBattleAIReaction,
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

function receivedTypeProgram(mnemonic: string) {
  return syntheticAI([
    ["Nop"],
    ["SyncAI"],
    [mnemonic, [602, 9]],
    ["VariableAssign", [0, 1]],
    ["StartTable", [0]],
    ["Act", [601]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["Nop"],
    ["VariableAssign", [0, 2]],
    ["CounterAct", [603]],
    ["JumpBattleAI", [0]],
  ]);
}

test("both received-command keys compare the received ability type independently of id and system", () => {
  for (const mnemonic of ["IsReceiveCommand", "IsCheckReceiveCommand"]) {
    const program = receivedTypeProgram(mnemonic);
    assert.deepEqual(program.instructions[2]!.op, {
      kind: "received-ability-branch", field: "typeId", value: 602, target: 9,
    });
    const initial = startBattleAI(program, context);
    const original = structuredClone(initial);
    for (const [id, system, typeId, counterReady, hp, marker, pcs] of [
      [777, 3, 602, true, 100, 2, [11]],
      [602, 602, 7, true, 100, 1, []],
      [777, 3, 602, false, 100, 2, []],
      [777, 3, 602, true, 0, 2, []],
      [777, 2, 602, true, 100, 2, []],
    ] as const) {
      const result = planBattleAIReaction(program, initial.state, {
        ...context, self: { ...context.self, hp },
      }, { counterReady, receivedAbilityId: id, receivedSystemId: system,
        receivedAbilityTypeId: typeId });
      assert.equal(result.behavior.variables[0], marker);
      assert.deepEqual(result.acts.map(a => a.pc), pcs);
      assert.equal(result.state.receivedAbility, null);
      assert.equal(result.state.actTurn, 0);
      if (marker === 2) {
        assert.ok(result.visited.includes(10));
        assert.ok(!result.visited.includes(9), "jump skips the source label");
      }
    }
    assert.deepEqual(initial, original);
    assert.equal(context.self.behavior.variables[0], 0);
  }
});

test("received-command queries expose native null zero during initialization and normal wake", () => {
  for (const mnemonic of ["IsReceiveCommand", "IsCheckReceiveCommand"]) {
    const initialize = syntheticAI([
      [mnemonic, [0, 2]], ["UnreachableWithoutReceiver"], ["Nop"], ["SyncAI"],
    ]);
    assert.equal(startBattleAI(initialize, context).state.pc, 3);
    const program = syntheticAI([
      ["Nop"], ["SyncAI"], [mnemonic, [0, 4]],
      ["UnreachableWithoutReceiver"], ["Nop"], ["StartTable", [0]],
      ["Act", [601]], ["EndTable"], ["JumpBattleAI", [0]],
    ]);
    const initial = startBattleAI(program, context);
    assert.deepEqual(planBattleAITurn(program, initial.state, context).acts[0]!.abilities, [601]);
  }
});

test("SyncAI clears received type and normal progress remains independent from reaction selection", () => {
  const program = receivedTypeProgram("IsCheckReceiveCommand");
  const initial = startBattleAI(program, context);
  const reaction = planBattleAIReaction(program, initial.state, context, {
    counterReady: true, receivedAbilityId: 777, receivedSystemId: 3,
    receivedAbilityTypeId: 602,
  });
  assert.equal(reaction.state.receivedAbility, null);
  const nextContext = { ...context, self: { ...context.self, behavior: reaction.behavior } };
  const normal = planBattleAITurn(program, JSON.parse(JSON.stringify(reaction.state)), nextContext);
  assert.deepEqual(normal.acts.map(a => a.abilities), [[601]]);
  assert.equal(normal.behavior.variables[0], 1);
  assert.equal(reaction.behavior.variables[0], 2);
  const nextReaction = planBattleAIReaction(program, normal.state, nextContext, {
    counterReady: true, receivedAbilityId: 777, receivedSystemId: 3,
    receivedAbilityTypeId: 4,
  });
  assert.deepEqual(nextReaction.acts, []);
  assert.equal(nextReaction.behavior.variables[0], 1);
  assert.throws(() => planBattleAITurn(program, {
    ...normal.state, receivedAbility: { id: 777, systemId: 3, typeId: 602 },
  }, context), /SyncAI retained received ability/);
});

test("missing received type is unknown only when a type query is reached, never an implicit zero", () => {
  const program = receivedTypeProgram("IsReceiveCommand");
  const initial = startBattleAI(program, context);
  assert.throws(() => planBattleAIReaction(program, initial.state, context, {
    counterReady: false, receivedAbilityId: 777, receivedSystemId: 3,
  }), /Mnemonics\/2: missing received ability type identity/);
  const queryZero = receivedTypeProgram("IsReceiveCommand");
  const op = queryZero.instructions[2]!.op;
  assert.equal(op.kind, "received-ability-branch");
  if (op.kind !== "received-ability-branch") throw new Error("Wrong test op");
  op.value = 0;
  assert.throws(() => planBattleAIReaction(queryZero, initial.state, context, {
    counterReady: false, receivedAbilityId: 777, receivedSystemId: 3,
  }), /missing received ability type identity/);

  const conditional = syntheticAI([
    ["Nop"], ["SyncAI"], ["IsMyCondition", [405, 4]],
    ["IsCheckReceiveCommand", [602, 4]], ["Nop"], ["CounterAct", [603]],
    ["JumpBattleAI", [0]],
  ]);
  const prior = startBattleAI(conditional, context);
  assert.deepEqual(planBattleAIReaction(conditional, prior.state, {
    ...context, conditionIds: [405],
  }, { counterReady: true, receivedAbilityId: 777, receivedSystemId: 3 }).acts[0]!.abilities, [603]);
  assert.throws(() => planBattleAIReaction(conditional, prior.state, context, {
    counterReady: true, receivedAbilityId: 777, receivedSystemId: 3,
  }), /Mnemonics\/3: missing received ability type identity/);
});

test("received-type selectors preserve the whole signed source comparison domain without command aliases", () => {
  // These source selector values include several ability types that cannot be
  // represented by a guessed command-id or small enum whitelist.
  for (const value of [1, 2, 4, 9, 10, 56, 57, 408, 409, 421, 504, 601, 602,
    607, 608, 609, 611, 613, 623, 625, 629, 0, 0x7fffffff]) {
    const program = syntheticAI([
      ["Nop"], ["SyncAI"], ["IsCheckReceiveCommand", [value, 4]],
      ["UnreachableOnExactType"], ["Nop"], ["VariableAssign", [2, value]],
      ["JumpBattleAI", [0]],
    ]);
    const initial = startBattleAI(program, context);
    const result = planBattleAIReaction(program, initial.state, context, {
      counterReady: false, receivedAbilityId: 777, receivedSystemId: 3,
      receivedAbilityTypeId: value,
    });
    assert.equal(result.behavior.variables[2], value);
    assert.deepEqual(result.acts, []);
  }
  const negativeComparison = syntheticAI([["IsReceiveCommand", [-0x80000000, 0]], ["SyncAI"]]);
  assert.equal(negativeComparison.instructions[0]!.op.kind, "received-ability-branch");
  assert.equal(startBattleAI(negativeComparison, context).state.pc, 1);
});

test("malformed received-command operands stay blocked and related counter actions remain independent", () => {
  for (const mnemonic of ["IsReceiveCommand", "IsCheckReceiveCommand"]) {
    for (const [ints, reals, strings] of [
      [[602], [], []], [[602, 99], [], []], [[602, 0, 1], [], []],
      [[602, 0], [1], []], [[602, 0], [], ["＝"]],
      [[0x80000000, 0], [], []],
    ] as const) {
      const program = syntheticAI([[mnemonic, [...ints], [...reals], [...strings]], ["SyncAI"]]);
      assert.equal(program.instructions[0]!.op.kind, "blocked");
    }
    const padded = syntheticAI([
      [mnemonic, [602, 0, 0, 0, 0, 0, 0, 0], Array(8).fill(0), Array(8).fill("")],
      ["SyncAI"],
    ]);
    assert.deepEqual(padded.instructions[0]!.op, {
      kind: "received-ability-branch", field: "typeId", value: 602, target: 0,
    });
    const raw = aiSource([[mnemonic, [602, 0]], ["SyncAI"]]);
    raw.Mnemonics[0]!.type = 2;
    assert.equal(compileBattleAI(raw, null).instructions[0]!.op.kind, "blocked");
  }
  for (const mnemonic of ["CounterActReceiveCommand", "CounterPlayerAct", "IsReceivedCommand"])
    assert.equal(syntheticAI([[mnemonic, [602, 603]], ["SyncAI"]]).instructions[0]!.op.kind, "blocked");
});

test("invalid provided type and late reached faults leave the complete AI input unchanged", () => {
  const program = receivedTypeProgram("IsCheckReceiveCommand");
  const initial = startBattleAI(program, context);
  const baseline = structuredClone({ initial, context });
  for (const typeId of [-1, Number.NaN, 1.5, 0x80000000])
    assert.throws(() => planBattleAIReaction(program, initial.state, context, {
      counterReady: true, receivedAbilityId: 777, receivedSystemId: 3,
      receivedAbilityTypeId: typeId,
    }));
  const late = syntheticAI([
    ["Nop"], ["SyncAI"], ["VariableAssign", [0, 5]],
    ["IsCheckReceiveCommand", [602, 5]], ["JumpBattleAI", [0]], ["Nop"],
    ["CounterAct", [603]], ["CounterPlayerAct", [604]], ["JumpBattleAI", [0]],
  ]);
  const lateInitial = startBattleAI(late, context);
  const lateBaseline = structuredClone(lateInitial);
  assert.throws(() => planBattleAIReaction(late, lateInitial.state, context, {
    counterReady: true, receivedAbilityId: 777, receivedSystemId: 3,
    receivedAbilityTypeId: 602,
  }), /Mnemonics\/7: unsupported AI instruction.*CounterPlayerAct/);
  assert.deepEqual(lateInitial, lateBaseline);
  assert.deepEqual({ initial, context }, baseline);
});

test("counter readiness draws only its own instructions and preserves the ordinary table position", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["Act", [601]],
    ["CounterAct", [602, 604], [25, 75]],
    ["Act", [603]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const initial = startBattleAI(program, context);
  assert.deepEqual(initial.acts, []);
  const normal = planBattleAITurn(program, initial.state, context);
  assert.deepEqual(
    normal.acts.map((a) => a.kind),
    ["act", "act"],
  );
  assert.equal(normal.state.actTurn, 1);
  const reaction = planBattleAIReaction(program, normal.state, context, {
    counterReady: true,
    receivedAbilityId: 501,
    receivedSystemId: 3,
  });
  assert.equal(reaction.trigger, "reaction");
  assert.equal(reaction.state.actTurn, 1);
  assert.equal(reaction.state.turnCounter, 0);
  assert.deepEqual(
    reaction.acts.map((a) => [a.kind, a.pc]),
    [["counter-act", 4]],
  );
  let draws = 0;
  assert.deepEqual(
    selectBattleAIAbilities(reaction.acts[0]!, {
      integer: () => {
        throw new Error("unexpected integer draw");
      },
      float: () => {
        draws++;
        return 25;
      },
    }),
    [604],
  );
  assert.equal(draws, 1);
  assert.equal(
    planBattleAITurn(program, reaction.state, context).acts.find(
      (a) => a.selected,
    )!.abilities[0],
    603,
  );
});

test("miss, recovery, system five and fatal hits wake AI without scheduling CounterAct", () => {
  const program = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["ValueCalc", [0, 1], [], ["＋"]],
    ["CounterAct", [602]],
    ["JumpBattleAI", [0]],
  ]);
  const initial = startBattleAI(program, context);
  for (const [counterReady, receivedSystemId, hp] of [
    [false, 3, 100],
    [true, 2, 100],
    [true, 5, 100],
    [true, 3, 0],
  ] as const) {
    const reaction = planBattleAIReaction(
      program,
      initial.state,
      { ...context, self: { ...context.self, hp } },
      { counterReady, receivedAbilityId: 501, receivedSystemId },
    );
    assert.deepEqual(reaction.acts, []);
    assert.equal(reaction.behavior.variables[0], 1);
    assert.equal(reaction.state.actTurn, 0);
  }
  assert.equal(context.self.behavior.variables[0], 0);
  assert.throws(
    () =>
      planBattleAIReaction(program, initial.state, context, {
        counterReady: true,
        receivedAbilityId: 501,
        receivedSystemId: Number.NaN,
      }),
    /signed 32-bit/,
  );
  assert.throws(
    () =>
      planBattleAIReaction(
        program,
        { ...initial.state, status: "running" },
        context,
        { counterReady: true, receivedAbilityId: 501, receivedSystemId: 3 },
      ),
    /suspended SyncAI/,
  );
});

test("counter messages, mismatched weights and unknown operands remain explicit blockers", () => {
  for (const row of [
    ["CounterAct", [602], [0]],
    ["CounterAct", [602, 603], [100]],
    ["CounterAct", [602], [100], ["unimplemented message"]],
  ] as Parameters<typeof syntheticAI>[0]) {
    const program = syntheticAI([["SyncAI"], row]);
    const initial = startBattleAI(program, context);
    assert.equal(program.instructions[1]!.op.kind, "blocked");
    assert.throws(
      () =>
        planBattleAIReaction(program, initial.state, context, {
          counterReady: true,
          receivedAbilityId: 501,
          receivedSystemId: 3,
        }),
      (e) => e instanceof BattleAIError && e.pc === 1,
    );
  }
});

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
    ["FinalLoopAttackAct", [701]],
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
