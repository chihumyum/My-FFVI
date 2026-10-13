import test from "node:test";
import assert from "node:assert/strict";
import { createBattlePlayerState, parseBattlePlayerState, projectPlayerJoin, projectPlayerGroup,
  firstEnteredOwnerIds, type BattlePlayerGroupSlot, type BattlePlayerState } from "../src/core/battle-player-state.js";

const group = (): BattlePlayerGroupSlot[] => [
  { ownedId: "a", sourceId: 1, row: "front" }, { ownedId: null, row: "back" },
  { ownedId: "b", sourceId: 2, row: "back" }, { ownedId: null, row: "front" },
];
const empty = (): BattlePlayerGroupSlot[] => Array.from({ length: 4 }, (_, index) =>
  ({ ownedId: null, row: index % 2 ? "back" : "front" }));

test("initial player metadata preserves all four saved cells including empty-cell rows", () => {
  const initial = group(), state = createBattlePlayerState(initial);
  assert.deepEqual(state.slots, [{ instanceId: "a", row: "front" }, { instanceId: null, row: "back" },
    { instanceId: "b", row: "back" }, { instanceId: null, row: "front" }]);
  assert.deepEqual(state.entries.map(entry => [entry.instanceId, entry.ownedId, entry.slot]),
    [["a", "a", 0], ["b", "b", 2]]);
  assert.equal(state.nextGeneration, 1); assert.deepEqual(firstEnteredOwnerIds(state), ["a", "b"]);
  initial[0]!.ownedId = "changed"; initial[1]!.row = "front";
  assert.equal(state.slots[0]!.instanceId, "a"); assert.equal(state.slots[1]!.row, "back");
});

test("join fills the first empty cell using its retained row without borrowing a second owned record", () => {
  const before = createBattlePlayerState(group()), snapshot = structuredClone(before), request = { ownedId: "c", sourceId: 3 };
  const projected = projectPlayerJoin(before, request);
  assert.deepEqual(projected.joins, [{ instanceId: "player:dynamic:1", ownedId: "c", sourceId: 3, slot: 1, row: "back" }]);
  assert.deepEqual(projected.removedIds, []); assert.deepEqual(before, snapshot); assert.deepEqual(request, { ownedId: "c", sourceId: 3 });
  assert.deepEqual(projected.state.slots[3], { instanceId: null, row: "front" });
  assert.equal(projected.state.nextGeneration, 2);
  assert.doesNotThrow(() => parseBattlePlayerState(projected.state));
});

test("full party and a duplicate active owner reject join before history or allocator changes", () => {
  const first = projectPlayerJoin(createBattlePlayerState(group()), { ownedId: "c", sourceId: 3 });
  const full = projectPlayerJoin(first.state, { ownedId: "d", sourceId: 4 }).state, before = structuredClone(full);
  assert.throws(() => projectPlayerJoin(full, { ownedId: "e", sourceId: 5 }), /full/);
  assert.throws(() => projectPlayerJoin(full, { ownedId: "a", sourceId: 1 }), /already active/);
  assert.deepEqual(full, before);
});

test("group replacement retires all current instances and allocates in uncompressed source-slot order", () => {
  const before = createBattlePlayerState(group()), requested: BattlePlayerGroupSlot[] = [
    { ownedId: null, row: "back" }, { ownedId: "c", sourceId: 3, row: "front" },
    { ownedId: null, row: "front" }, { ownedId: "a", sourceId: 1, row: "back" },
  ];
  const snapshot = structuredClone(before), projected = projectPlayerGroup(before, requested);
  assert.deepEqual(projected.removedIds, ["a", "b"]);
  assert.deepEqual(projected.joins, [
    { instanceId: "player:dynamic:1", ownedId: "c", sourceId: 3, slot: 1, row: "front" },
    { instanceId: "player:dynamic:2", ownedId: "a", sourceId: 1, slot: 3, row: "back" },
  ]);
  assert.deepEqual(projected.state.slots[0], { instanceId: null, row: "back" });
  assert.deepEqual(firstEnteredOwnerIds(projected.state), ["a", "b", "c"]);
  assert.deepEqual(before, snapshot); assert.doesNotThrow(() => parseBattlePlayerState(projected.state));
});

test("a retired held owner may rejoin later but never reuses its original instance or prior row", () => {
  const entry = createBattlePlayerState(group()), nextGroup = empty();
  nextGroup[2] = { ownedId: "c", sourceId: 3, row: "front" };
  const replaced = projectPlayerGroup(entry, nextGroup);
  const rejoined = projectPlayerJoin(replaced.state, { ownedId: "a", sourceId: 1 });
  assert.deepEqual(rejoined.joins, [{ instanceId: "player:dynamic:2", ownedId: "a", sourceId: 1, slot: 0, row: "front" }]);
  const later = projectPlayerGroup(rejoined.state, group());
  assert.deepEqual(later.joins.map(join => join.instanceId), ["player:dynamic:3", "player:dynamic:4"]);
  assert.deepEqual(firstEnteredOwnerIds(later.state), ["a", "b", "c"]);
  assert.equal(new Set(later.state.entries.map(entry => entry.instanceId)).size, 6);
  assert.doesNotThrow(() => parseBattlePlayerState(later.state));
});

test("repeated groups preserve held/source mapping while rows and battle slots can change", () => {
  const first = createBattlePlayerState(group()), reshuffled = group();
  reshuffled[0] = { ownedId: "b", sourceId: 2, row: "back" };
  reshuffled[2] = { ownedId: "a", sourceId: 1, row: "front" };
  const second = projectPlayerGroup(first, reshuffled), third = projectPlayerGroup(second.state, group());
  assert.deepEqual(third.removedIds, ["player:dynamic:1", "player:dynamic:2"]);
  assert.equal(third.state.nextGeneration, 5);
  assert.deepEqual(firstEnteredOwnerIds(third.state), ["a", "b"]);
  assert.deepEqual(third.state.entries.filter(entry => entry.ownedId === "a").map(entry => entry.sourceId), [1, 1, 1]);
});

test("a held identity or a source identity cannot be reassigned after retirement", () => {
  const nextGroup = empty(); nextGroup[0] = { ownedId: "c", sourceId: 3, row: "back" };
  const state = projectPlayerGroup(createBattlePlayerState(group()), nextGroup).state, before = structuredClone(state);
  for (const request of [{ ownedId: "a", sourceId: 99 }, { ownedId: "new-a", sourceId: 1 }]) {
    assert.throws(() => projectPlayerJoin(state, request), /identity changed/);
    const requested = empty(); requested[3] = { ...request, row: "front" };
    assert.throws(() => projectPlayerGroup(state, requested), /identity changed/);
    assert.deepEqual(state, before);
  }
});

test("late duplicate, changed source or malformed group member cannot retire an earlier valid member", () => {
  const state = createBattlePlayerState(group()), before = structuredClone(state);
  for (const bad of [
    { ownedId: "c", sourceId: 3, row: "back" }, { ownedId: "d", sourceId: 3, row: "back" },
    { ownedId: "a", sourceId: 99, row: "front" }, { ownedId: "d", sourceId: 0, row: "front" },
    { ownedId: "d", sourceId: 4, row: "unknown" }, { ownedId: null, sourceId: 4, row: "front" },
    { ownedId: "d", sourceId: 4, row: "front", hp: 99 },
  ]) {
    const requested = empty(); requested[0] = { ownedId: "c", sourceId: 3, row: "front" };
    requested[3] = bad as BattlePlayerGroupSlot; const snapshot = structuredClone(requested);
    assert.throws(() => projectPlayerGroup(state, requested));
    assert.deepEqual(state, before); assert.deepEqual(requested, snapshot);
  }
});

test("four-cell group contracts reject missing, excessive, sparse or unknown empty bindings", () => {
  const state = createBattlePlayerState(group()), before = structuredClone(state), sparse = group(); delete sparse[1];
  const extra = group(); Object.assign(extra, { extra: true });
  for (const requested of [[], group().slice(0, 3), [...group(), { ownedId: null, row: "front" }], sparse, extra]) {
    assert.throws(() => createBattlePlayerState(requested as BattlePlayerGroupSlot[]));
    assert.throws(() => projectPlayerGroup(state, requested as BattlePlayerGroupSlot[]));
    assert.deepEqual(state, before);
  }
  assert.throws(() => projectPlayerGroup(state, empty()), /must not be empty/);
  const emptyState = createBattlePlayerState(empty());
  assert.deepEqual(firstEnteredOwnerIds(emptyState), []);
  assert.equal(projectPlayerJoin(emptyState, { ownedId: "c", sourceId: 3 }).joins[0]!.slot, 0);
});

test("history parser rejects active slot aliases, stale rows and retired instances still occupying a cell", () => {
  const state = projectPlayerGroup(createBattlePlayerState(group()), group()).state;
  for (const mutate of [
    (candidate: BattlePlayerState) => { candidate.slots[0]!.instanceId = "missing"; },
    (candidate: BattlePlayerState) => { candidate.slots[0]!.row = "back"; },
    (candidate: BattlePlayerState) => { candidate.slots[1]!.instanceId = candidate.slots[0]!.instanceId; },
    (candidate: BattlePlayerState) => { candidate.slots[0]!.instanceId = "a"; },
    (candidate: BattlePlayerState) => { candidate.entries[2]!.slot = 1; },
    (candidate: BattlePlayerState) => { candidate.entries[2]!.removed = true; },
  ]) {
    const candidate = structuredClone(state); mutate(candidate);
    assert.throws(() => parseBattlePlayerState(candidate));
  }
});

test("generation histories cannot rewind, reuse old instances or restore old owners over newer entries", () => {
  const state = projectPlayerGroup(createBattlePlayerState(group()), group()).state;
  for (const mutate of [
    (candidate: BattlePlayerState) => { candidate.nextGeneration = 1; },
    (candidate: BattlePlayerState) => { candidate.nextGeneration = 4; },
    (candidate: BattlePlayerState) => { candidate.entries[2]!.instanceId = "a"; },
    (candidate: BattlePlayerState) => { candidate.entries[2]!.instanceId = "player:dynamic:01"; },
    (candidate: BattlePlayerState) => { candidate.entries[2]!.instanceId = "player:dynamic:2"; },
    (candidate: BattlePlayerState) => {
      candidate.entries[0]!.removed = false; candidate.entries[2]!.removed = true; candidate.slots[0]!.instanceId = "a";
    },
  ]) {
    const candidate = structuredClone(state); mutate(candidate); assert.throws(() => parseBattlePlayerState(candidate));
  }
  assert.throws(() => createBattlePlayerState([{ ownedId: "player:dynamic:1", sourceId: 1, row: "front" }, ...empty().slice(1)]), /Reserved/);
  assert.throws(() => projectPlayerJoin(state, { ownedId: "player:dynamic:3", sourceId: 99 }), /Reserved/);
});

test("state fields and nested history are strict, dense and detached", () => {
  const state = createBattlePlayerState(group()), parsed = parseBattlePlayerState(state);
  parsed.entries[0]!.ownedId = "changed"; parsed.slots[1]!.row = "front";
  assert.equal(state.entries[0]!.ownedId, "a"); assert.equal(state.slots[1]!.row, "back");
  const sparseEntries = structuredClone(state); delete sparseEntries.entries[0];
  const sparseSlots = structuredClone(state); delete sparseSlots.slots[3];
  for (const malformed of [
    { ...state, hp: 99 }, { ...state, kind: "other" }, { ...state, nextGeneration: 0 },
    { ...state, nextGeneration: Infinity }, { ...state, nextGeneration: 2147483648 },
    { ...state, entries: [{ ...state.entries[0], sourceId: "1" }] },
    { ...state, entries: [{ ...state.entries[0], row: "unknown" }] },
    { ...state, entries: [{ ...state.entries[0], removed: 1 }] },
    { ...state, entries: [{ ...state.entries[0], equipment: [] }] },
    { ...state, slots: state.slots.map(slot => ({ ...slot, ownedId: null })) }, sparseEntries, sparseSlots,
  ]) assert.throws(() => parseBattlePlayerState(malformed));
});

test("snapshot parse rejects changed held/source mapping and duplicate active owners", () => {
  const state = projectPlayerGroup(createBattlePlayerState(group()), group()).state;
  const sourceChanged = structuredClone(state); sourceChanged.entries[2]!.sourceId = 99;
  assert.throws(() => parseBattlePlayerState(sourceChanged), /identity changed/);
  const otherOwner = structuredClone(state); otherOwner.entries[2]!.ownedId = "different";
  assert.throws(() => parseBattlePlayerState(otherOwner), /identity changed/);
  const doubleActive = structuredClone(state); doubleActive.entries[0]!.removed = false;
  assert.throws(() => parseBattlePlayerState(doubleActive), /Duplicate active/);
});

test("failed or rolled-back player requests preserve generation and replay the same independent candidates", () => {
  const state = createBattlePlayerState(group()), saved = parseBattlePlayerState(state), request = { ownedId: "c", sourceId: 3 };
  const attempt = projectPlayerJoin(state, request), replay = projectPlayerJoin(saved, request);
  assert.deepEqual(attempt, replay); assert.deepEqual(state, saved);
  attempt.joins[0]!.sourceId = 99; attempt.removedIds.push("not-removed");
  assert.equal(attempt.state.entries[2]!.sourceId, 3);
  const groupAttempt = projectPlayerGroup(replay.state, group()), groupReplay = projectPlayerGroup(parseBattlePlayerState(replay.state), group());
  assert.deepEqual(groupAttempt, groupReplay);
  const forgedBoundary = structuredClone(saved); forgedBoundary.nextGeneration = 2147483647;
  assert.throws(() => projectPlayerGroup(forgedBoundary, group()), /allocator|exhausted/);
  assert.equal(forgedBoundary.nextGeneration, 2147483647); assert.deepEqual(forgedBoundary.entries, saved.entries);
});

test("join schema rejects coercion, missing or new metadata fields without consuming a slot", () => {
  const state = createBattlePlayerState(group()), before = structuredClone(state);
  for (const malformed of [
    { ownedId: "c", sourceId: 0 }, { ownedId: "c", sourceId: -1 }, { ownedId: "c", sourceId: 2147483648 },
    { ownedId: "c", sourceId: 1.1 }, { ownedId: "c", sourceId: "3" }, { ownedId: null, sourceId: 3 },
    { ownedId: " ", sourceId: 3 }, { ownedId: "c" }, { ownedId: "c", sourceId: 3, row: "back" },
    { ownedId: "c", sourceId: 3, hp: 99 },
  ]) {
    assert.throws(() => projectPlayerJoin(state, malformed as { ownedId: string; sourceId: number }));
    assert.deepEqual(state, before);
  }
});

test("first held-owner receipt order is independent of current group and returned instance generations", () => {
  let state = createBattlePlayerState(group());
  state = projectPlayerJoin(state, { ownedId: "c", sourceId: 3 }).state;
  const next = empty(); next[1] = { ownedId: "d", sourceId: 4, row: "back" };
  next[3] = { ownedId: "b", sourceId: 2, row: "front" };
  state = projectPlayerGroup(state, next).state;
  state = projectPlayerJoin(state, { ownedId: "a", sourceId: 1 }).state;
  const order = firstEnteredOwnerIds(state); order.reverse();
  assert.deepEqual(firstEnteredOwnerIds(state), ["a", "b", "c", "d"]);
  assert.equal(state.entries.length, 6);
  assert.equal(state.slots[0]!.row, "front");
});
