import test from "node:test";
import assert from "node:assert/strict";
import { advanceBattleEvent, createBattleEventState, parseBattleEventProgram,
  type BattleEventContext } from "../src/core/battle-event.js";
import { participantProgram } from "./fixtures/battle-participant-game.js";

const context = (clock: number, noAct = false, completed = true): BattleEventContext => ({
  clock, timeSeconds: clock / 100, started: true, aiCoreAlive: true, actionStaging: true,
  enemyEntry: { noAct, completed },
});
const program = () => participantProgram([{ kind: "add-enemy", monsterId: 341, uniqueId: 8 }, { kind: "exit" }]);

test("entry yields at the same PC, emits only once per clock and preserves the previous enemy gate", () => {
  for (const previous of [false, true]) {
    const p = program(), initial = createBattleEventState(p), before = structuredClone(initial);
    const first = advanceBattleEvent(p, initial, context(0, previous));
    assert.deepEqual(initial, before);
    assert.deepEqual(first.requests, [{ kind: "add-enemy", pc: 0, monsterId: 341, uniqueId: 8 }]);
    assert.deepEqual(first.state.wait, { kind: "enemy-entry", clock: 0, previousNoAct: previous });
    assert.equal(first.state.pc, 0);
    const same = advanceBattleEvent(p, first.state, context(0, true));
    assert.deepEqual(same.state, first.state); assert.deepEqual(same.requests, []);
    const complete = advanceBattleEvent(p, first.state, context(1, true));
    assert.deepEqual(complete.requests, [{ kind: "enemy-no-act", pc: 0, enabled: previous }]);
    assert.equal(complete.state.pc, 1); assert.equal(complete.state.wait, null);
    // An unrelated staged action and living AI do not hold entry completion.
    assert.equal(advanceBattleEvent(p, complete.state, context(1)).state.status, "exited");
  }
});

test("pending asynchronous host completion cannot repeat removal or forget the saved gate", () => {
  const p = program();
  let state = advanceBattleEvent(p, createBattleEventState(p), context(0, false)).state;
  for (const clock of [1, 2, 3]) {
    const next = advanceBattleEvent(p, state, context(clock, true, false));
    assert.deepEqual(next.requests, []); assert.equal(next.state.pc, 0);
    assert.deepEqual(next.state.wait, { kind: "enemy-entry", clock, previousNoAct: false });
    state = next.state;
  }
  assert.deepEqual(advanceBattleEvent(p, state, context(4, true)).requests,
    [{ kind: "enemy-no-act", pc: 0, enabled: false }]);
});

test("consecutive joins restore then capture the actual current gate at each host request", () => {
  const p = participantProgram([{ kind: "add-enemy", monsterId: 341, uniqueId: 2 },
    { kind: "add-enemy", monsterId: 342, uniqueId: 2 }, { kind: "exit" }]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context(0, false));
  const restore = advanceBattleEvent(p, first.state, context(1, true));
  const second = advanceBattleEvent(p, restore.state, context(1, false));
  assert.deepEqual(second.requests, [{ kind: "add-enemy", pc: 1, monsterId: 342, uniqueId: 2 }]);
  assert.deepEqual(second.state.wait, { kind: "enemy-entry", clock: 1, previousNoAct: false });
});

test("missing or malformed entry provider and mismatched waits never publish input state", () => {
  const p = program(), initial = createBattleEventState(p), before = structuredClone(initial);
  const { enemyEntry: _entry, ...missing } = context(0);
  assert.throws(() => advanceBattleEvent(p, initial, missing), /Mnemonics\/0.*entry provider/);
  assert.deepEqual(initial, before);
  assert.throws(() => advanceBattleEvent(p, initial,
    { ...context(0), enemyEntry: { noAct: 0, completed: true } } as unknown as BattleEventContext));
  const waiting = advanceBattleEvent(p, initial, context(0)).state;
  assert.throws(() => advanceBattleEvent(p, { ...waiting, pc: 1 }, context(1)), /wait does not match/);
});

test("enemy gate is a typed host control, independent of whole-battle pause", () => {
  const p = participantProgram([{ kind: "enemy-no-act", enabled: true }, { kind: "exit" }]);
  const result = advanceBattleEvent(p, createBattleEventState(p), context(0));
  assert.deepEqual(result.requests, [{ kind: "enemy-no-act", pc: 0, enabled: true }]);
  assert.equal(result.state.pc, 1);
});

test("entry schema rejects unknown policies, coercion and slots outside the admitted profile", () => {
  for (const change of [{ monsterId: 0 }, { monsterId: 1.5 }, { monsterId: "341" },
    { uniqueId: 0 }, { uniqueId: 10 }, { uniqueId: false }, { ignored: 0 }]) {
    const p = program(); Object.assign(p.instructions[0]!.op, change);
    assert.throws(() => parseBattleEventProgram(p));
  }
});
