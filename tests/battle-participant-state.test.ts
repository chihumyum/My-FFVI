import test from "node:test";
import assert from "node:assert/strict";
import { createBattleParticipantState, parseBattleParticipantState, projectEnemyReplacement,
  activeBattleParticipantIds, projectBattleParticipantRewards, assertBattleParticipantStateCurrent,
  type BattleParticipantInitial } from "../src/core/battle-participant-state.js";

const initial = (): BattleParticipantInitial[] => [
  { id: "enemy:1", sourceId: 17, uniqueId: 1, exp: 9, gil: 7 },
  { id: "opaque-source-slot", sourceId: 17, uniqueId: 5, exp: 11, gil: 13 },
];
const next = (uniqueId = 1) => ({ sourceId: 24, uniqueId, exp: 19, gil: 23 });

test("participant metadata keeps explicit source slots separate from opaque ids and repeated source identities", () => {
  const state = createBattleParticipantState(initial());
  assert.deepEqual(state, { kind: "battle-participant-state-v1", nextGeneration: 1,
    entries: initial().map(entry => ({ ...entry, removed: false })) });
  assert.deepEqual(activeBattleParticipantIds(state), ["enemy:1", "opaque-source-slot"]);
  assert.deepEqual(projectBattleParticipantRewards(state, "active-units"), { exp: 20, gil: 20 });
});

test("same source slot replacement never transfers its old instance identity", () => {
  const before = createBattleParticipantState(initial()), frozen = structuredClone(before), request = next();
  const projected = projectEnemyReplacement(before, request);
  assert.equal(projected.removedId, "enemy:1"); assert.equal(projected.instanceId, "enemy:dynamic:1");
  assert.deepEqual(before, frozen); assert.deepEqual(request, next());
  assert.deepEqual(projected.state.entries[0], { ...initial()[0]!, removed: true });
  assert.deepEqual(activeBattleParticipantIds(projected.state), ["opaque-source-slot", "enemy:dynamic:1"]);
  assert.deepEqual(projectBattleParticipantRewards(projected.state, "active-units"), { exp: 30, gil: 36 });
  assert.deepEqual(projectBattleParticipantRewards(projected.state, "all-entered"), { exp: 39, gil: 43 });
});

test("multiple replacements in one slot retain every instance exactly once", () => {
  let state = createBattleParticipantState(initial());
  const one = projectEnemyReplacement(state, next()); state = one.state;
  const two = projectEnemyReplacement(state, next()); state = two.state;
  const three = projectEnemyReplacement(state, next()); state = three.state;
  assert.deepEqual([one.removedId, two.removedId, three.removedId],
    ["enemy:1", "enemy:dynamic:1", "enemy:dynamic:2"]);
  assert.equal(state.nextGeneration, 4);
  assert.equal(new Set(state.entries.map(entry => entry.id)).size, 5);
  assert.deepEqual(state.entries.filter(entry => entry.uniqueId === 1).map(entry => entry.removed),
    [true, true, true, false]);
  assert.deepEqual(projectBattleParticipantRewards(state, "active-units"), { exp: 30, gil: 36 });
  assert.deepEqual(projectBattleParticipantRewards(state, "all-entered"), { exp: 77, gil: 89 });
});

test("entering an empty original slot retires no unit and retains entry order", () => {
  const state = createBattleParticipantState(initial()), added = projectEnemyReplacement(state, next(2));
  assert.equal(added.removedId, null);
  assert.deepEqual(activeBattleParticipantIds(added.state), ["enemy:1", "opaque-source-slot", "enemy:dynamic:1"]);
  assert.equal(added.state.entries[2]!.uniqueId, 2);
  assert.deepEqual(projectBattleParticipantRewards(added.state, "active-units"),
    projectBattleParticipantRewards(added.state, "all-entered"));
});

test("parse and creation detach nested metadata and never admit HP or another unit state owner", () => {
  const definitions = initial(), state = createBattleParticipantState(definitions);
  definitions[0]!.exp = 300;
  const parsed = parseBattleParticipantState(state); parsed.entries[0]!.sourceId = 99;
  assert.equal(state.entries[0]!.exp, 9); assert.equal(state.entries[0]!.sourceId, 17);
  assert.throws(() => parseBattleParticipantState({ ...state, hp: 999 }));
  assert.throws(() => parseBattleParticipantState({ ...state,
    entries: [{ ...state.entries[0], hp: 1 }, state.entries[1]] }));
});

test("full-roster add is a replacement of an explicit slot and never produces a tenth active slot", () => {
  const state = createBattleParticipantState(Array.from({ length: 9 }, (_, index) =>
    ({ id: "enemy:" + (index + 1), sourceId: 17, uniqueId: index + 1, exp: 1, gil: 1 })));
  const replaced = projectEnemyReplacement(state, next(9));
  assert.equal(replaced.removedId, "enemy:9"); assert.equal(activeBattleParticipantIds(replaced.state).length, 9);
  assert.throws(() => projectEnemyReplacement(state, next(10)), /integer/);
  assert.equal(state.entries.length, 9);
});

test("invalid late replacement fields cannot mutate membership, history or generation", () => {
  const state = createBattleParticipantState(initial()), before = structuredClone(state);
  for (const request of [
    { ...next(), sourceId: 0 }, { ...next(), sourceId: 2147483648 },
    { ...next(), uniqueId: 0 }, { ...next(), uniqueId: -1 }, { ...next(), uniqueId: 10 },
    { ...next(), uniqueId: 1.5 }, { ...next(), exp: -1 }, { ...next(), gil: Infinity },
    { ...next(), exp: 2147483648 }, { ...next(), gil: 1.1 },
    { ...next(), unused: 0 }, { ...next(), exp: undefined },
  ]) {
    assert.throws(() => projectEnemyReplacement(state, request as ReturnType<typeof next>));
    assert.deepEqual(state, before);
  }
});

test("duplicate instance ids and duplicate initial or active source slots are rejected", () => {
  assert.throws(() => createBattleParticipantState([initial()[0]!, { ...initial()[1]!, id: "enemy:1" }]), /duplicate/);
  assert.throws(() => createBattleParticipantState([initial()[0]!, { ...initial()[1]!, uniqueId: 1 }]), /initial|slot/);
  const state = projectEnemyReplacement(createBattleParticipantState(initial()), next()).state;
  state.entries[0]!.removed = false;
  assert.throws(() => parseBattleParticipantState(state), /slot/);
  assert.throws(() => createBattleParticipantState([{ ...initial()[0]!, id: "enemy:dynamic:1" }]), /Reserved/);
});

test("forged generation rewinds and recycled dynamic ids cannot alias retired owners", () => {
  const before = createBattleParticipantState(initial()), state = projectEnemyReplacement(before, next()).state;
  assert.throws(() => projectEnemyReplacement({ ...state, nextGeneration: 1 }, next()), /allocator/);
  const duplicated = structuredClone(state); duplicated.entries.push({ ...duplicated.entries[2]! });
  assert.throws(() => parseBattleParticipantState(duplicated), /duplicate/);
  for (const id of ["enemy:dynamic:0", "enemy:dynamic:01", "enemy:dynamic:2", "enemy:dynamic:bad"]) {
    const altered = structuredClone(state); altered.entries[2]!.id = id;
    assert.throws(() => parseBattleParticipantState(altered), /generation/);
  }
  assert.throws(() => parseBattleParticipantState({ ...state, nextGeneration: 3 }), /allocator/);
  const recycled = structuredClone(state);
  recycled.entries[0]!.removed = false; recycled.entries[2]!.removed = true;
  assert.throws(() => parseBattleParticipantState(recycled), /cannot become active/);
  assert.deepEqual(before, createBattleParticipantState(initial()));
});

test("frame rollback restores the allocator and replay prepares the same fresh instance", () => {
  const entry = createBattleParticipantState(initial()), saved = parseBattleParticipantState(entry);
  const firstAttempt = projectEnemyReplacement(entry, next());
  const retried = projectEnemyReplacement(parseBattleParticipantState(saved), next());
  assert.deepEqual(firstAttempt, retried);
  assert.equal(saved.nextGeneration, 1); assert.equal(saved.entries.length, 2);
});

test("optimistic pre-publication check rejects later transitions and read-only metadata drift", () => {
  const actual = createBattleParticipantState(initial()), expected = parseBattleParticipantState(actual);
  assert.doesNotThrow(() => assertBattleParticipantStateCurrent(actual, expected));
  const replacement = projectEnemyReplacement(actual, next());
  assert.throws(() => assertBattleParticipantStateCurrent(replacement.state, expected), /Stale/);
  actual.entries[1]!.exp = 12;
  assert.throws(() => assertBattleParticipantStateCurrent(actual, expected), /Stale/);
  assert.equal(expected.entries[1]!.exp, 11);
});

test("history parsers reject sparse arrays, extra fields, malformed values and nonboolean removal", () => {
  const state = createBattleParticipantState(initial());
  const sparse = structuredClone(state); delete sparse.entries[0];
  assert.throws(() => parseBattleParticipantState(sparse), /history/);
  const initialSparse = initial(); delete initialSparse[0];
  assert.throws(() => createBattleParticipantState(initialSparse), /participants/);
  for (const malformed of [
    { ...state, nextGeneration: 0 }, { ...state, nextGeneration: NaN },
    { ...state, nextGeneration: 2147483648 }, { ...state, entries: null },
    { ...state, unused: false }, { ...state, kind: "other" },
    { ...state, entries: [{ ...state.entries[0], removed: 1 }] },
    { ...state, entries: [{ ...state.entries[0], id: " " }] },
    { ...state, entries: [{ ...state.entries[0], id: "enemy with spaces" }] },
    { ...state, entries: [{ ...state.entries[0], sourceId: "17" }] },
  ]) assert.throws(() => parseBattleParticipantState(malformed));
  assert.deepEqual(state, createBattleParticipantState(initial()));
});

test("reward scope is mandatory, independent of death and checks integer overflow before any mutation", () => {
  const empty = createBattleParticipantState([]);
  assert.deepEqual(projectBattleParticipantRewards(empty, "active-units"), { exp: 0, gil: 0 });
  assert.deepEqual(projectBattleParticipantRewards(empty, "all-entered"), { exp: 0, gil: 0 });
  assert.throws(() => projectBattleParticipantRewards(empty, undefined as never), /scope/);
  assert.throws(() => projectBattleParticipantRewards(empty, "defeated" as never), /scope/);
  const state = createBattleParticipantState([{ ...initial()[0]!, exp: 2147483647, gil: 2147483647 }]);
  const projected = projectEnemyReplacement(state, next());
  assert.deepEqual(projectBattleParticipantRewards(projected.state, "active-units"), { exp: 19, gil: 23 });
  const before = structuredClone(projected.state);
  assert.throws(() => projectBattleParticipantRewards(projected.state, "all-entered"), /integer/);
  assert.deepEqual(projected.state, before);
});

test("current membership is detached and no removal is inferred from zero reward metadata", () => {
  const state = createBattleParticipantState([{ ...initial()[0]!, exp: 0, gil: 0 }]);
  const ids = activeBattleParticipantIds(state); ids.length = 0;
  assert.deepEqual(activeBattleParticipantIds(state), ["enemy:1"]);
  assert.equal(state.entries[0]!.removed, false);
  assert.deepEqual(projectBattleParticipantRewards(state, "all-entered"), { exp: 0, gil: 0 });
});
