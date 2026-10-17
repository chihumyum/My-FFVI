import test from "node:test";
import assert from "node:assert/strict";
import { createBattleParticipantState, parseBattleParticipantState, projectEnemyReplacement, projectEnemyPartyReplacement,
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

test("whole enemy party replacement retires all current slots and preserves noncompact source order", () => {
  const before = createBattleParticipantState(initial()), frozen = structuredClone(before);
  const members = [next(9), { ...next(1), sourceId: 25 }, next(4)], request = structuredClone(members);
  const projected = projectEnemyPartyReplacement(before, members);
  assert.deepEqual(projected.removedIds, ["enemy:1", "opaque-source-slot"]);
  assert.deepEqual(projected.joins, [
    { instanceId: "enemy:dynamic:1", sourceId: 24, uniqueId: 9 },
    { instanceId: "enemy:dynamic:2", sourceId: 25, uniqueId: 1 },
    { instanceId: "enemy:dynamic:3", sourceId: 24, uniqueId: 4 },
  ]);
  assert.deepEqual(before, frozen); assert.deepEqual(members, request);
  assert.deepEqual(activeBattleParticipantIds(projected.state), projected.joins.map(join => join.instanceId));
  assert.equal(projected.state.entries.find(entry => entry.uniqueId === 5)!.removed, true,
    "A slot absent from the new party also retires");
  assert.equal(projected.state.nextGeneration, 4);
  assert.doesNotThrow(() => parseBattleParticipantState(projected.state));
});

test("same masters across several enemy parties remain distinct historical instances and rewards", () => {
  const entry = createBattleParticipantState(initial());
  const one = projectEnemyPartyReplacement(entry, [next(7), next(2)]);
  const two = projectEnemyPartyReplacement(one.state, [next(2), next(7)]);
  const three = projectEnemyPartyReplacement(two.state, [next(7)]);
  assert.deepEqual(two.removedIds, ["enemy:dynamic:1", "enemy:dynamic:2"]);
  assert.deepEqual(three.removedIds, ["enemy:dynamic:3", "enemy:dynamic:4"]);
  assert.equal(three.state.nextGeneration, 6);
  assert.equal(new Set(three.state.entries.map(entry => entry.id)).size, 7);
  assert.deepEqual(activeBattleParticipantIds(three.state), ["enemy:dynamic:5"]);
  assert.deepEqual(projectBattleParticipantRewards(three.state, "active-units"), { exp: 19, gil: 23 });
  assert.deepEqual(projectBattleParticipantRewards(three.state, "all-entered"), { exp: 115, gil: 135 });
  assert.deepEqual(three.state.entries.slice(0, -1).map(entry => entry.removed), Array(6).fill(true));
});

test("whole-party and single-slot replacements share one allocator without losing retired history", () => {
  const entry = createBattleParticipantState(initial()), single = projectEnemyReplacement(entry, next(1));
  const party = projectEnemyPartyReplacement(single.state, [next(9), next(4)]);
  assert.deepEqual(party.removedIds, ["opaque-source-slot", "enemy:dynamic:1"]);
  assert.deepEqual(party.joins.map(join => join.instanceId), ["enemy:dynamic:2", "enemy:dynamic:3"]);
  const laterSingle = projectEnemyReplacement(party.state, { ...next(9), sourceId: 26 });
  assert.equal(laterSingle.removedId, "enemy:dynamic:2");
  assert.equal(laterSingle.instanceId, "enemy:dynamic:4");
  assert.deepEqual(activeBattleParticipantIds(laterSingle.state), ["enemy:dynamic:3", "enemy:dynamic:4"]);
  assert.equal(laterSingle.state.entries.length, 6);
  assert.deepEqual(projectBattleParticipantRewards(laterSingle.state, "all-entered"), { exp: 96, gil: 112 });
});

test("a late invalid party member never retires an earlier owner or allocates an earlier join", () => {
  const state = createBattleParticipantState(initial()), before = structuredClone(state);
  for (const bad of [
    { ...next(4), sourceId: 0 }, { ...next(4), sourceId: 2147483648 },
    { ...next(4), uniqueId: 10 }, { ...next(4), uniqueId: 7 },
    { ...next(4), exp: -1 }, { ...next(4), gil: Infinity }, { ...next(4), hp: 99 },
  ]) {
    const members = [next(7), next(2), bad], request = structuredClone(members);
    assert.throws(() => projectEnemyPartyReplacement(state, members));
    assert.deepEqual(state, before); assert.deepEqual(members, request);
  }
});

test("whole-party input rejects empty, excessive, sparse and duplicate-slot collections", () => {
  const state = createBattleParticipantState(initial()), before = structuredClone(state);
  const sparse = [next(1), next(9)]; delete sparse[1];
  const padded = [next(1)]; Object.assign(padded, { unexpected: true });
  for (const members of [[], Array.from({ length: 10 }, (_, index) => next(index + 1)),
    sparse, padded, [next(1), next(1)]]) {
    assert.throws(() => projectEnemyPartyReplacement(state, members)); assert.deepEqual(state, before);
  }
  const full = projectEnemyPartyReplacement(state, Array.from({ length: 9 }, (_, index) => next(index + 1)));
  assert.equal(activeBattleParticipantIds(full.state).length, 9);
  assert.equal(full.state.nextGeneration, 10);
});

test("party rollback/replay restores one allocator reservation and detached publication metadata", () => {
  const before = createBattleParticipantState(initial()), saved = parseBattleParticipantState(before);
  const members = [next(9), next(1)], attempt = projectEnemyPartyReplacement(before, members);
  const replay = projectEnemyPartyReplacement(parseBattleParticipantState(saved), members);
  assert.deepEqual(attempt, replay);
  assert.throws(() => assertBattleParticipantStateCurrent(attempt.state, saved), /Stale/);
  attempt.joins[0]!.sourceId = 99; attempt.removedIds.length = 0;
  assert.equal(attempt.state.entries[2]!.sourceId, 24);
  assert.deepEqual(before, saved);
  const forged = structuredClone(replay.state); forged.nextGeneration = 1;
  assert.throws(() => projectEnemyPartyReplacement(forged, members), /allocator/);
  const boundary = structuredClone(saved); boundary.nextGeneration = 2147483647;
  assert.throws(() => projectEnemyPartyReplacement(boundary, members), /allocator|exhausted/);
  assert.equal(boundary.entries.length, 2); assert.equal(boundary.nextGeneration, 2147483647);
});

test("party retirement does not infer death, drops or intermediate rewards", () => {
  const before = createBattleParticipantState(initial());
  const nextParty = projectEnemyPartyReplacement(before, [{ sourceId: 17, uniqueId: 5, exp: 0, gil: 0 }]);
  assert.deepEqual(Object.keys(nextParty).sort(), ["joins", "removedIds", "state"]);
  assert.deepEqual(Object.keys(nextParty.state.entries[0]!).sort(), ["exp", "gil", "id", "removed", "sourceId", "uniqueId"]);
  assert.deepEqual(projectBattleParticipantRewards(nextParty.state, "active-units"), { exp: 0, gil: 0 });
  assert.deepEqual(projectBattleParticipantRewards(nextParty.state, "all-entered"), { exp: 20, gil: 20 });
  const overflowEntry = createBattleParticipantState([{ ...initial()[0]!, exp: 2147483647 }]);
  const replacement = projectEnemyPartyReplacement(overflowEntry, [next(7), next(3)]);
  assert.deepEqual(projectBattleParticipantRewards(replacement.state, "active-units"), { exp: 38, gil: 46 });
  assert.throws(() => projectBattleParticipantRewards(replacement.state, "all-entered"), /integer/);
  assert.equal(overflowEntry.entries[0]!.removed, false);
});
