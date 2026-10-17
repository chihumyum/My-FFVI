import test from "node:test";
import assert from "node:assert/strict";
import { compileTreasureBoxInstruction, compileTreasureInventory,
  compileTreasureInventoryLimits } from "../src/compiler/treasure-inventory.js";
import { checkTreasureCapacity, planTreasureInventory, treasureFlagRef,
  type TreasureBoxRequest, type TreasureInventoryRead } from "../src/core/treasure-inventory.js";
import { treasureInstruction, treasureProperties, treasureSource,
  treasureTables } from "./fixtures/treasure-inventory.js";

const limits = { item: 99, gil: 9999999 };
const definition = (properties: Record<string, unknown> = {}) =>
  compileTreasureInventory(treasureProperties(properties), treasureTables(), treasureSource);
const request = (change: Partial<TreasureBoxRequest> = {}): TreasureBoxRequest =>
  ({ ...compileTreasureBoxInstruction(treasureInstruction()), ...change });
const owned = (count?: number): TreasureInventoryRead =>
  ({ gil: 0, normalOwnedItems: count === undefined ? [] : [{ id: 101, count }] });
// Exercise the recovered native pure rule outside the narrower field compiler
// admission. A canonical save does not preserve native record absence above 99.
function nativeAmount(count: number, contentId = 101) {
  const out = definition({ content_id: contentId });
  out.contentNum = count;
  if (out.reward.kind === "grant-gil") out.reward.amount = count;
  else out.reward.count = count;
  return out;
}

test("treasure compiler binds property content identity, inventory class and exact source pointer", () => {
  const source = structuredClone(treasureSource);
  const out = compileTreasureInventory(treasureProperties(), treasureTables(), source);
  source.pointer = "/changed";
  assert.equal(out.source.pointer, "/layers/0/objects/1");
  assert.equal(out.source.objectId, "9223372036854775806");
  assert.equal(out.entityId, 42);
  assert.equal(out.presentation.linkObjectId, 100);
  assert.deepEqual(out.reward, { kind: "grant-item", id: 101, count: 1 });
  assert.equal(definition({ content_id: 102 }).ownedList, "important");
  assert.deepEqual(definition({ content_id: 201 }).reward, { kind: "grant-equipment", id: 201, count: 1 });
  assert.deepEqual(definition({ content_id: 301 }).reward, { kind: "grant-equipment", id: 301, count: 1 });
  assert.deepEqual(definition({ content_id: 501, content_num: 77 }).reward, { kind: "grant-gil", amount: 77 });
  assert.deepEqual(compileTreasureInventoryLimits(treasureTables()).limits, limits);
});

test("TreasureBox ignores operand1, always uses after=true and does not inherit property SE", () => {
  for (const ignored of [0, 1, -9, 200]) {
    assert.deepEqual(compileTreasureBoxInstruction(treasureInstruction([42, ignored, 1])),
      { kind: "treasure-box", entityId: 42, after: true, message: false, actionSoundId: 0 });
  }
  assert.equal(compileTreasureBoxInstruction(treasureInstruction([42, 1, -1])).message, true);
  const plan = planTreasureInventory(definition(), request(), false, owned(), limits);
  assert.equal(plan.prelude.soundId, null);
  assert.throws(() => compileTreasureBoxInstruction(treasureInstruction([42, 0, 0, 7])), /operand/);
  const bad = treasureInstruction(); bad.operands.sValues[7] = "unknown";
  assert.throws(() => compileTreasureBoxInstruction(bad), /operand/);
});

test("capacity reads total equipment Count including all worn copies, never available stock", () => {
  const gear = definition({ content_id: 201 });
  const snapshot = { gil: 0, normalOwnedItems: [{ id: 201, count: 99 }] };
  // All 99 copies may be occupied on enabled owners: there is no free-count input.
  assert.equal(checkTreasureCapacity(gear, snapshot, limits), true);
  snapshot.normalOwnedItems[0]!.count = 98;
  assert.equal(checkTreasureCapacity(gear, snapshot, limits), false);
});

test("capacity is strictly greater-than and absence does not mean an existing zero record", () => {
  assert.equal(checkTreasureCapacity(definition(), owned(98), limits), false);
  assert.equal(checkTreasureCapacity(definition(), owned(99), limits), true);
  const many = nativeAmount(100);
  assert.equal(checkTreasureCapacity(many, owned(), limits), false);
  assert.equal(checkTreasureCapacity(many, owned(0), limits), true);
});

test("important records are outside the normal-list capacity query; Gil has its own limit", () => {
  const important = nativeAmount(100, 102);
  assert.equal(important.ownedList, "important");
  // Its 99 important copies are intentionally not projected into NormalOwnedItemList.
  assert.equal(checkTreasureCapacity(important, owned(99), limits), false);
  const gil = definition({ content_id: 501, content_num: 2 });
  assert.equal(checkTreasureCapacity(gil, { ...owned(), gil: 9999997 }, limits), false);
  assert.equal(checkTreasureCapacity(gil, { ...owned(), gil: 9999998 }, limits), true);
});

test("over-capacity still emits the full grant and delays flag until reward message completes", () => {
  const plan = planTreasureInventory(definition(), request(), false, owned(99), limits);
  assert.equal(plan.kind, "grant");
  if (plan.kind !== "grant") throw new Error("Expected grant");
  assert.equal(plan.overCapacity, true);
  assert.deepEqual(plan.command, { kind: "grant-item", id: 101, count: 1 });
  assert.deepEqual(plan.flagWrite, { ref: { category: "TreasureFlag2", index: 4 }, value: 1 });
  assert.equal(plan.flagAfter, "reward-message-complete");
  assert.equal(plan.completionYieldFrames, 1);
  assert.deepEqual(plan.effects.map((effect) => effect.kind),
    ["open", "tile-animation", "grant", "set-message-value", "message", "message", "flag", "yield"]);
  assert.deepEqual(plan.effects.filter((effect) => effect.kind === "message"), [
    { kind: "message", key: "SYNTHETIC_TREASURE", close: false },
    { kind: "message", key: "SYN_FULL", close: true },
  ]);
});

test("message=false bypasses already-open test, retains grant and writes flag without message wait", () => {
  const plan = planTreasureInventory(definition(), request({ message: false }), true, owned(3), limits);
  assert.equal(plan.kind, "grant");
  if (plan.kind !== "grant") throw new Error("Expected grant");
  assert.equal(plan.message, false);
  assert.equal(plan.flagAfter, "reward-commit");
  assert.deepEqual(plan.command, { kind: "grant-item", id: 101, count: 1 });
  assert.equal(plan.prelude.openVisual, true);
  assert.deepEqual(plan.effects.map((effect) => effect.kind), ["open", "tile-animation", "grant", "flag", "yield"]);
});

test("already-open message path precedes script dispatch and has no reward or flag effect", () => {
  const plan = planTreasureInventory(definition({ script_id: 31 }), request({ after: false }), true, owned(), limits);
  assert.equal(plan.kind, "empty-message");
  assert.equal("command" in plan, false);
  assert.equal("flagWrite" in plan, false);
  assert.equal(plan.prelude.openVisual, true);
  assert.deepEqual(plan.effects.slice(2), [
    { kind: "scene-state", state: "message" }, { kind: "message", key: "SYN_EMPTY", close: true },
    { kind: "scene-state", state: "player" },
  ]);
});

test("ordinary action dispatches property script; explicit after instruction awards directly", () => {
  const chest = definition({ script_id: 31 });
  const first = planTreasureInventory(chest, request({ after: false }), false, owned(), limits);
  assert.equal(first.kind, "run-script");
  if (first.kind !== "run-script") throw new Error("Expected script");
  assert.equal(first.scriptName, "synthetic-treasure");
  assert.equal("flagWrite" in first, false);
  assert.equal(planTreasureInventory(chest, request(), false, owned(), limits).kind, "grant");
});

test("message value uses original amount and source name key, with caller-specific scene effects", () => {
  const item = planTreasureInventory(definition(), request({ after: false }), false, owned(), limits);
  assert.deepEqual(item.effects.slice(3, 7), [
    { kind: "set-message-value", token: "ITEM_N", messageKey: "SYN_ITEM" },
    { kind: "scene-state", state: "message" },
    { kind: "message", key: "SYNTHETIC_TREASURE", close: true },
    { kind: "scene-state", state: "player" },
  ]);
  const gil = planTreasureInventory(definition({ content_id: 501, content_num: 5000 }),
    request(), false, { ...owned(), gil: limits.gil }, limits);
  assert.deepEqual(gil.effects[3], { kind: "set-message-value", token: "NUM", number: 5000 });
  assert.equal(gil.effects.some((effect) => effect.kind === "scene-state"), false);
});

test("zero-amount source rewards are preserved rather than invented as absent rewards", () => {
  for (const id of [101, 102, 201, 501]) {
    const chest = definition({ content_id: id, content_num: 0 });
    const plan = planTreasureInventory(chest, request({ message: false }), false, owned(), limits);
    assert.equal(plan.kind, "grant");
    if (plan.kind !== "grant") throw new Error("Expected zero grant");
    assert.equal(plan.command.kind === "grant-gil" ? plan.command.amount : plan.command.count, 0);
    assert.equal(plan.flagAfter, "reward-commit");
  }
});

test("only actually read unknown flags block; action-owned sound has its own read dependency", () => {
  assert.throws(() => planTreasureInventory(definition(), request(), null, owned(), limits), /Unknown/);
  assert.throws(() => planTreasureInventory(definition(), request({ message: false, actionSoundId: 12 }), null, owned(), limits), /Unknown/);
  const silent = planTreasureInventory(definition(), request({ message: false }), null, owned(), limits);
  assert.equal(silent.kind, "grant");
  const sound = planTreasureInventory(definition(), request({ actionSoundId: 12 }), false, owned(), limits);
  assert.equal(sound.prelude.soundId, 12);
});

test("planning is immutable and reads a fresh candidate, not a cached capacity result", () => {
  const chest = definition(), draft = owned(98), before = structuredClone({ chest, draft });
  const first = planTreasureInventory(chest, request(), false, draft, limits);
  assert.deepEqual({ chest, draft }, before);
  assert.equal(first.kind === "grant" && first.overCapacity, false);
  const next = { ...draft, normalOwnedItems: [{ id: 101, count: 99 }] };
  const second = planTreasureInventory(chest, request(), false, next, limits);
  assert.equal(second.kind === "grant" && second.overCapacity, true);
  if (first.kind === "grant" && first.command.kind === "grant-item") first.command.count = 80;
  assert.equal(chest.reward.kind === "grant-item" && chest.reward.count, 1);
});

test("missing/ambiguous dependencies, unknown reward types and invalid candidate records block", () => {
  assert.throws(() => definition({ content_id: 901 }), /not implemented/);
  assert.throws(() => definition({ content_id: 990 }), /dependency/);
  assert.throws(() => definition({ content_num: -1 }), /Negative/);
  assert.throws(() => definition({ script_id: 32 }), /dependency/);
  const tables = treasureTables(); tables["weapon.csv"].push({ id: "71", type_id: "1" });
  assert.throws(() => compileTreasureInventory(treasureProperties({ content_id: 201 }), tables, treasureSource), /dependency/);
  assert.throws(() => checkTreasureCapacity(definition(), { gil: 0, normalOwnedItems: [{ id: 101, count: 1 }, { id: 101, count: 2 }] }, limits), /normal inventory/);
  assert.throws(() => checkTreasureCapacity(definition(), owned(100), limits), /normal inventory/);
  assert.throws(() => checkTreasureCapacity(nativeAmount(2147483647), owned(1), limits), /32-bit/);
  assert.throws(() => planTreasureInventory(definition(), request({ entityId: 100 }), false, owned(), limits), /request/);
  for (const [flag, expected] of [[0, ["TreasureFlag1", 0]], [255, ["TreasureFlag1", 255]],
    [256, ["TreasureFlag2", 0]], [1023, ["TreasureFlag4", 255]]] as const)
    assert.deepEqual(treasureFlagRef(flag), { category: expected[0], index: expected[1] });
  assert.throws(() => treasureFlagRef(1024), /address/);
});

test("field reward admission preserves zero and the item limit, but blocks record-presence-sensitive quantities", () => {
  for (const content_id of [101, 102, 201, 301]) {
    assert.equal(definition({ content_id, content_num: 0 }).contentNum, 0);
    assert.equal(definition({ content_id, content_num: 99 }).contentNum, 99);
    assert.throws(() => definition({ content_id, content_num: 100 }), /record-presence/);
  }
  assert.equal(definition({ content_id: 501, content_num: 10000 }).contentNum, 10000);
});
