import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEvent } from "../src/compiler/battle-event.js";
import { advanceBattleEvent, createBattleEventState, parseBattleEventProgram, assertBattleEventExecutable,
  type BattleEventContext, type BattleEventOp, type BattleEventProgram } from "../src/core/battle-event.js";

type RawOp = [string, number[]?, number[]?, string[]?];
const source = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64), sha256: "c".repeat(64),
  file: "synthetic.bundle", assetPath: "synthetic/player-event.json", serializedFile: "synthetic", objectId: "90071992547409937" };
/** Authored grammar probes, not copies of the source story or player records. */
function raw(ops: RawOp[]) {
  return { Name: "controlled-player-event", Title: { main: "", sub: "" }, ScriptLocal: ["Stage"], ScriptLocalValue: [7],
    SystemFlag: { KeepBadStatusVisual: 0, KeepPlayerPuppet: 0, RidingVehicle: 0, SkipInitialize: 0 },
    Animations: [], Segments: [{ Label: "Main", EntryPoint: 0, Count: ops.length }],
    Mnemonics: ops.map(([mnemonic, integers = [], reals = [], strings = []]) => ({ mnemonic, type: 1,
      operands: { iValues: Array.from({ length: 8 }, (_, index) => integers[index] ?? 0),
        rValues: Array.from({ length: 8 }, (_, index) => reals[index] ?? 0),
        sValues: Array.from({ length: 8 }, (_, index) => strings[index] ?? "") } })),
  };
}
function program(ops: BattleEventOp[]): BattleEventProgram {
  return { kind: "battle-event-v1", source: null, entry: 0, end: ops.length, blockers: [],
    localNames: ["Stage"], initialLocals: [7], instructions: ops.map(op => ({ mnemonic: op.kind, op: structuredClone(op) })) };
}
const player = () => program([{ kind: "add-player", sourceId: 33 }, { kind: "exit" }]);
test("the unevidenced AddFellow alias stays blocked instead of bypassing the source mnemonic", () => {
  const compiled = compileBattleEvent(raw([["AddFellow", [33]], ["Exit"]]), source);
  assert.equal(compiled.instructions[0]!.op.kind, "blocked");
});
const context = (clock: number, noAct = false, completed = true): BattleEventContext => ({
  clock, timeSeconds: clock / 100, started: true, aiCoreAlive: true, actionStaging: true,
  playerEntry: { noAct, completed }, playerGroupEntry: { completed },
  enemyEntry: { noAct: !noAct, completed: !completed }, enemyPartyEntry: { completed: !completed },
});

test("AddFellow preserves the exact source 33 instead of substituting an available player 1", () => {
  const input = raw([["Nop"], ["BattleAddFellow", [33]], ["BattleAddFellow", [1]], ["Exit"]]), before = structuredClone(input);
  const compiled = compileBattleEvent(input, source);
  assert.deepEqual(compiled.instructions[1]!.op, { kind: "add-player", sourceId: 33 });
  assert.deepEqual(compiled.instructions[2]!.op, { kind: "add-player", sourceId: 1 });
  assert.equal(compiled.instructions.length, 4); assert.deepEqual(compiled.source, source);
  assert.equal(compiled.source!.objectId, "90071992547409937"); assert.deepEqual(input, before);
  const first = advanceBattleEvent(compiled, createBattleEventState(compiled), context(0));
  assert.deepEqual(first.requests, [{ kind: "add-player", pc: 1, sourceId: 33 }]);
});

test("AddFellow accepts only its full source operand shape and never discards nonzero tails", () => {
  const changes: ((input: ReturnType<typeof raw>) => void)[] = [
    input => { input.Mnemonics[0]!.type = 2; },
    input => { input.Mnemonics[0]!.operands.iValues = [33]; },
    input => { input.Mnemonics[0]!.operands.rValues = []; },
    input => { input.Mnemonics[0]!.operands.sValues = []; },
    input => { input.Mnemonics[0]!.operands.iValues[0] = 0; },
    input => { input.Mnemonics[0]!.operands.iValues[0] = -1; },
    input => { input.Mnemonics[0]!.operands.iValues[0] = 2147483648; },
    input => { input.Mnemonics[0]!.operands.iValues[0] = 1.5; },
    ...Array.from({ length: 7 }, (_, index) => (input: ReturnType<typeof raw>) => {
      input.Mnemonics[0]!.operands.iValues[index + 1] = 1;
    }),
    ...Array.from({ length: 8 }, (_, index) => (input: ReturnType<typeof raw>) => {
      input.Mnemonics[0]!.operands.rValues[index] = 1;
    }),
    ...Array.from({ length: 8 }, (_, index) => (input: ReturnType<typeof raw>) => {
      input.Mnemonics[0]!.operands.sValues[index] = "unexpected";
    }),
  ];
  for (const change of changes) {
    const input = raw([["BattleAddFellow", [33]], ["Exit"]]); change(input);
    const compiled = compileBattleEvent(input, source);
    assert.equal(compiled.instructions[0]!.op.kind, "blocked");
    assert.throws(() => assertBattleEventExecutable(compiled));
  }
});

test("the native no-argument player-party selector cannot become an explicitly chosen Web group", () => {
  for (const group of [0, 1, 2]) {
    const compiled = compileBattleEvent(raw([["SysCall", [group], [], ["LB:プレイヤーパーティ変更"]], ["Exit"]]), source);
    assert.equal(compiled.instructions[0]!.op.kind, "blocked");
    if (group === 0) assert.match((compiled.instructions[0]!.op as { reason: string }).reason, /ScriptLocalVariable\[2\]/);
    assert.throws(() => assertBattleEventExecutable(compiled));
  }
  for (const selector of ["ChangePlayerParty", "LB:プレイヤーパーティ変更1", "change-player-group"]) {
    const compiled = compileBattleEvent(raw([["SysCall", [], [], [selector]], ["Exit"]]), source);
    assert.equal(compiled.instructions[0]!.op.kind, "blocked");
  }
  assert.equal(compileBattleEvent(raw([["change-player-group", [1]], ["Exit"]]), source).instructions[0]!.op.kind, "blocked");
});

test("player entry issues one request per clock and restores the originally captured enemy no-act gate", () => {
  for (const previous of [false, true]) {
    const p = player(), initial = createBattleEventState(p), before = structuredClone(initial);
    const first = advanceBattleEvent(p, initial, context(0, previous));
    assert.deepEqual(initial, before);
    assert.deepEqual(first.requests, [{ kind: "add-player", pc: 0, sourceId: 33 }]);
    assert.equal(first.state.pc, 0);
    assert.deepEqual(first.state.wait, { kind: "player-entry", clock: 0, previousNoAct: previous });
    const same = advanceBattleEvent(p, first.state, context(0, !previous));
    assert.deepEqual(same.state, first.state); assert.deepEqual(same.requests, []);
    const restored = advanceBattleEvent(p, first.state, context(1, !previous));
    assert.deepEqual(restored.requests, [{ kind: "enemy-no-act", pc: 0, enabled: previous }]);
    assert.equal(restored.state.pc, 1); assert.equal(restored.state.wait, null);
    assert.equal(advanceBattleEvent(p, restored.state, context(1, previous)).state.status, "exited");
  }
});

test("player IsEndAct completion is independent of enemy loading and action staging", () => {
  const p = player(), first = advanceBattleEvent(p, createBattleEventState(p), context(0, false));
  let waiting = first.state;
  for (const clock of [1, 2, 3]) {
    const unrelatedDone: BattleEventContext = { ...context(clock, true, false), actionStaging: false,
      enemyEntry: { noAct: true, completed: true }, enemyPartyEntry: { completed: true }, playerGroupEntry: { completed: true } };
    const pending = advanceBattleEvent(p, waiting, unrelatedDone);
    assert.deepEqual(pending.requests, []); assert.equal(pending.state.pc, 0);
    assert.deepEqual(pending.state.wait, { kind: "player-entry", clock, previousNoAct: false });
    waiting = pending.state;
  }
  const completed = advanceBattleEvent(p, waiting, { ...context(4, true, true), actionStaging: true,
    enemyEntry: { noAct: true, completed: false }, enemyPartyEntry: { completed: false }, playerGroupEntry: { completed: false } });
  assert.deepEqual(completed.requests, [{ kind: "enemy-no-act", pc: 0, enabled: false }]);
});

test("consecutive player entries capture the current gate independently at each source PC", () => {
  const p = program([{ kind: "add-player", sourceId: 33 }, { kind: "add-player", sourceId: 1 }, { kind: "exit" }]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context(0, false));
  const restore = advanceBattleEvent(p, first.state, context(1, true));
  const second = advanceBattleEvent(p, restore.state, context(1, false));
  assert.deepEqual(second.requests, [{ kind: "add-player", pc: 1, sourceId: 1 }]);
  assert.deepEqual(second.state.wait, { kind: "player-entry", clock: 1, previousNoAct: false });
  assert.deepEqual(advanceBattleEvent(p, second.state, context(1, true)).requests, []);
});

test("a missing player provider cannot publish preceding local writes or use an enemy provider as a fallback", () => {
  const p = program([{ kind: "calc", index: 0, operator: "←", right: { kind: "immediate", value: 99 } },
    { kind: "add-player", sourceId: 33 }, { kind: "exit" }]);
  const initial = createBattleEventState(p), before = structuredClone(initial), { playerEntry: _entry, ...missing } = context(0);
  assert.throws(() => advanceBattleEvent(p, initial, missing), /Mnemonics\/1.*owned player entry provider/);
  assert.deepEqual(initial, before);
  for (const entry of [{ noAct: 1, completed: true }, { noAct: false, completed: 1 }, { completed: true },
    { noAct: false, completed: true, enemyDone: true }]) {
    assert.throws(() => advanceBattleEvent(p, initial, { ...context(0), playerEntry: entry } as BattleEventContext));
    assert.deepEqual(initial, before);
  }
});

test("player waits cannot be rebound to an enemy instruction or a later PC", () => {
  const p = player(), first = advanceBattleEvent(p, createBattleEventState(p), context(0)), before = structuredClone(first.state);
  assert.throws(() => advanceBattleEvent(p, { ...first.state, pc: 1 }, context(1)), /wait does not match/);
  assert.throws(() => advanceBattleEvent(p,
    { ...first.state, wait: { kind: "enemy-entry", clock: 0, previousNoAct: false } }, context(1)), /wait does not match/);
  assert.deepEqual(first.state, before);
});

test("a late local fault after entry completion never mutates the resumed VM input", () => {
  const p = program([{ kind: "add-player", sourceId: 33 },
    { kind: "calc", index: 0, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "variable-calc", left: { category: "ScriptLocalVariable", index: 0 }, operator: "←",
      right: { kind: "variable", ref: { category: "ScenarioVariable", index: 3 } } }, { kind: "exit" }]);
  const joined = advanceBattleEvent(p, createBattleEventState(p), context(0));
  const restored = advanceBattleEvent(p, joined.state, context(1)), before = structuredClone(restored.state);
  assert.throws(() => advanceBattleEvent(p, restored.state, context(1)), /Mnemonics\/2/);
  assert.deepEqual(restored.state, before); assert.equal(restored.state.locals[0], 7);
});

test("player source identity is strict but a well-formed unknown identity is retained for the held-record provider", () => {
  for (const change of [{ sourceId: 0 }, { sourceId: -1 }, { sourceId: 1.5 }, { sourceId: 2147483648 },
    { sourceId: "33" }, { sourceId: null }, { sourceId: undefined }, { ownedId: "available-player" }]) {
    const p = player(); Object.assign(p.instructions[0]!.op, change);
    assert.throws(() => parseBattleEventProgram(p));
  }
  const compiled = compileBattleEvent(raw([["BattleAddFellow", [9999]], ["Exit"]]), source);
  const request = advanceBattleEvent(compiled, createBattleEventState(compiled), context(0)).requests[0];
  assert.deepEqual(request, { kind: "add-player", pc: 0, sourceId: 9999 });
});

test("Web groups 0..2 use their own completion wait and preserve the continuing local frame", () => {
  for (const group of [0, 1, 2] as const) {
    const p = program([{ kind: "calc", index: 0, operator: "←", right: { kind: "immediate", value: 77 } },
      { kind: "change-player-group", group },
      { kind: "calc", index: 0, operator: "＋", right: { kind: "immediate", value: 1 } }, { kind: "exit" }]);
    const initial = createBattleEventState(p), before = structuredClone(initial);
    const first = advanceBattleEvent(p, initial, context(0));
    assert.deepEqual(first.requests, [{ kind: "change-player-group", pc: 1, group }]);
    assert.deepEqual(first.state.wait, { kind: "player-group-entry", clock: 0 });
    assert.deepEqual(advanceBattleEvent(p, first.state, context(0)).requests, []);
    const pending = advanceBattleEvent(p, first.state, { ...context(1), playerGroupEntry: { completed: false } });
    assert.equal(pending.state.pc, 1); assert.deepEqual(pending.requests, []); assert.deepEqual(pending.state.locals, [77]);
    const done = advanceBattleEvent(p, pending.state, { ...context(2), playerEntry: { noAct: true, completed: false } });
    assert.equal(done.state.status, "exited"); assert.deepEqual(done.state.locals, [78]);
    assert.deepEqual(done.requests, [], "Web group completion does not implicitly change the enemy gate");
    assert.deepEqual(initial, before);
  }
});

test("Web group schema and completion provider reject out-of-range selections or native-shaped arguments", () => {
  const p = () => program([{ kind: "change-player-group", group: 1 }, { kind: "exit" }]);
  for (const change of [{ group: -1 }, { group: 3 }, { group: 1.5 }, { group: "1" },
    { group: null }, { group: undefined }, { selector: "LB:プレイヤーパーティ変更" }]) {
    const changed = p(); Object.assign(changed.instructions[0]!.op, change);
    assert.throws(() => parseBattleEventProgram(changed));
  }
  const input = createBattleEventState(p()), before = structuredClone(input), { playerGroupEntry: _entry, ...missing } = context(0);
  assert.throws(() => advanceBattleEvent(p(), input, missing), /player group provider/);
  for (const completion of [{ completed: 1 }, { completed: true, group: 1 }, {}])
    assert.throws(() => advanceBattleEvent(p(), input,
      { ...context(0), playerGroupEntry: completion } as BattleEventContext));
  assert.deepEqual(input, before);
});

test("consecutive Web groups each own a separate request clock and cannot inherit the old wait", () => {
  const p = program([{ kind: "change-player-group", group: 0 }, { kind: "change-player-group", group: 2 }, { kind: "exit" }]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context(0));
  const second = advanceBattleEvent(p, first.state, context(1));
  assert.deepEqual(second.requests, [{ kind: "change-player-group", pc: 1, group: 2 }]);
  assert.deepEqual(second.state.wait, { kind: "player-group-entry", clock: 1 });
  assert.deepEqual(advanceBattleEvent(p, second.state, context(1)).requests, []);
  assert.equal(advanceBattleEvent(p, second.state, context(2)).state.status, "exited");
  assert.throws(() => advanceBattleEvent(p, { ...second.state, pc: 2 }, context(2)), /wait does not match/);
});

test("a late fault on Web group completion preserves the waiting input and prior local bank", () => {
  const p = program([{ kind: "change-player-group", group: 1 },
    { kind: "calc", index: 0, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "variable-calc", left: { category: "ScriptLocalVariable", index: 0 }, operator: "←",
      right: { kind: "variable", ref: { category: "ScenarioVariable", index: 3 } } }, { kind: "exit" }]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context(0)), before = structuredClone(first.state);
  assert.throws(() => advanceBattleEvent(p, first.state, context(1)), /Mnemonics\/2/);
  assert.deepEqual(first.state, before); assert.deepEqual(first.state.locals, [7]);
});
