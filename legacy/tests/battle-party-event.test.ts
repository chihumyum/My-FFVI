import test from "node:test";
import assert from "node:assert/strict";
import { advanceBattleEvent, createBattleEventState, parseBattleEventProgram,
  type BattleEventContext } from "../src/core/battle-event.js";
import { participantProgram } from "./fixtures/battle-participant-game.js";

const context = (clock: number, completed = true): BattleEventContext => ({ clock,
  timeSeconds: clock / 100, started: true, aiCoreAlive: true, actionStaging: true,
  enemyPartyEntry: { completed } });
const program = () => participantProgram([{ kind: "calc", index: 0, operator: "←", right: { kind: "immediate", value: 77 } },
  { kind: "change-enemy-party", partyId: 515, hidden: true }, { kind: "exit" }]);

test("party entry keeps the root local frame and PC across request, same-clock yield and completion", () => {
  const p = program(), input = createBattleEventState(p), before = structuredClone(input);
  const first = advanceBattleEvent(p, input, context(0));
  assert.deepEqual(first.requests, [{ kind: "change-enemy-party", pc: 1, partyId: 515, hidden: true }]);
  assert.equal(first.state.pc, 1); assert.deepEqual(first.state.locals, [77]);
  assert.deepEqual(input, before);
  assert.deepEqual(advanceBattleEvent(p, first.state, context(0)).requests, []);
  const pending = advanceBattleEvent(p, first.state, context(1, false));
  assert.deepEqual(pending.requests, []); assert.deepEqual(pending.state.wait, { kind: "enemy-party-entry", clock: 1 });
  const done = advanceBattleEvent(p, pending.state, context(2));
  assert.equal(done.state.status, "exited"); assert.deepEqual(done.state.locals, [77]);
  assert.deepEqual(done.requests, [], "Joining completion does not set pause or enemy no-act");
});

test("consecutive party requests do not restart the root or reuse the prior wait", () => {
  const p = participantProgram([{ kind: "change-enemy-party", partyId: 513, hidden: false },
    { kind: "change-enemy-party", partyId: 514, hidden: false }, { kind: "exit" }]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context(0));
  const next = advanceBattleEvent(p, first.state, context(1));
  assert.deepEqual(next.requests, [{ kind: "change-enemy-party", pc: 1, partyId: 514, hidden: false }]);
  assert.deepEqual(next.state.wait, { kind: "enemy-party-entry", clock: 1 });
  assert.equal(advanceBattleEvent(p, next.state, context(2)).state.status, "exited");
});

test("a missing completion port and mismatched wait cannot publish a previous local write", () => {
  const p = program(), state = createBattleEventState(p), saved = structuredClone(state);
  const { enemyPartyEntry: _entry, ...missing } = context(0);
  assert.throws(() => advanceBattleEvent(p, state, missing), /Mnemonics\/1.*party entry provider/);
  assert.deepEqual(state, saved);
  const waiting = advanceBattleEvent(p, state, context(0)).state;
  assert.throws(() => advanceBattleEvent(p, { ...waiting, pc: 2 }, context(1)), /wait does not match/);
});

test("party requests and host completion use strict runtime shapes", () => {
  for (const change of [{ partyId: 0 }, { partyId: "513" }, { hidden: 1 }, { ignored: true }]) {
    const p = program(); Object.assign(p.instructions[1]!.op, change);
    assert.throws(() => parseBattleEventProgram(p));
  }
  assert.throws(() => advanceBattleEvent(program(), createBattleEventState(program()),
    { ...context(0), enemyPartyEntry: { completed: 1 } } as unknown as BattleEventContext));
});
