import test from "node:test";
import assert from "node:assert/strict";
import { createTreasureTask, advanceTreasureTask, type TreasureTaskState } from "../src/core/treasure-task.js";
import { compileTreasureBoxInstruction, compileTreasureTaskMessages } from "../src/compiler/treasure-inventory.js";
import { treasureInstruction } from "./fixtures/treasure-inventory.js";
import { taskDefinition, taskRequest, taskOwned, taskLimits, taskMessages,
  taskSystemMessages } from "./fixtures/treasure-task.js";

const start = (state: TreasureTaskState, flag: boolean | null = false, count = 0) =>
  advanceTreasureTask(state, { kind: "start", flag, owned: taskOwned(count), limits: taskLimits });
const kinds = (effects: { kind: string }[]) => effects.map((e) => e.kind);

test("ordinary caller deactivates the action and waits for property SE before Open; explicit caller has no property SE", () => {
  const def = taskDefinition(), manual = createTreasureTask(def, taskRequest());
  const before = structuredClone(manual), next = start(manual);
  assert.deepEqual(manual, before);
  assert.equal(next.wait, "sound");
  assert.deepEqual(next.effects, [{ kind: "deactivate-action" },
    { kind: "sound", id: 909, waitForLoad: true, waitForPlayback: false }]);
  assert.throws(() => advanceTreasureTask(next.state, { kind: "message-complete" }), /sound-complete/);
  const explicit = start(createTreasureTask(def, compileTreasureBoxInstruction(treasureInstruction())));
  assert.equal(explicit.wait, "message");
  assert.deepEqual(kinds(explicit.effects), ["open", "tile-animation", "grant", "set-message-value", "message"]);
});

test("sound resume rereads TreasureFlag instead of preserving an old unopened decision", () => {
  const pending = start(createTreasureTask(taskDefinition(), taskRequest()));
  const resumed = advanceTreasureTask(pending.state,
    { kind: "sound-complete", flag: true, owned: taskOwned(), limits: taskLimits });
  assert.deepEqual(kinds(resumed.effects), ["open", "tile-animation", "scene-state", "message"]);
  assert.equal(resumed.effects.find((e) => e.kind === "message")?.key, "SYN_EMPTY");
  assert.equal(resumed.effects.some((e) => e.kind === "grant"), false);
});

test("capacity reads the inventory at grant time after SE loading and preserves the full requested amount", () => {
  const pending = start(createTreasureTask(taskDefinition({ content_num: 2 }), taskRequest({ content_num: 2 })), false, 0);
  const resumed = advanceTreasureTask(pending.state,
    { kind: "sound-complete", flag: false, owned: taskOwned(98), limits: taskLimits });
  assert.deepEqual(resumed.effects.find((e) => e.kind === "grant"),
    { kind: "grant", command: { kind: "grant-item", id: 101, count: 2 } });
  assert.deepEqual(resumed.effects.at(-1), { kind: "message", key: "SYNTHETIC_TREASURE", close: false });
});

test("over-capacity grants once, keeps the first window, waits for both messages, then writes the flag", () => {
  let next = start(createTreasureTask(taskDefinition(), taskRequest({}, { actionSoundId: 0 })), false, 99);
  const all = [...next.effects];
  assert.equal(next.wait, "message");
  assert.deepEqual(next.effects.at(-1), { kind: "message", key: "SYNTHETIC_TREASURE", close: false });
  next = advanceTreasureTask(next.state, { kind: "message-complete" });
  all.push(...next.effects);
  assert.equal(next.wait, "frame");
  assert.deepEqual(kinds(next.effects), ["yield"]);
  next = advanceTreasureTask(next.state, { kind: "frame" });
  all.push(...next.effects);
  assert.equal(next.wait, "message");
  assert.deepEqual(next.effects, [{ kind: "message", key: "SYN_FULL", close: true }]);
  assert.equal(all.some((e) => e.kind === "flag"), false);
  next = advanceTreasureTask(next.state, { kind: "message-complete" });
  all.push(...next.effects);
  next = advanceTreasureTask(next.state, { kind: "frame" });
  all.push(...next.effects);
  assert.deepEqual(next.effects, [{ kind: "scene-state", state: "player" },
    { kind: "flag", ref: { category: "TreasureFlag2", index: 4 }, value: 1 }, { kind: "yield", frames: 1 }]);
  assert.equal(next.wait, "frame");
  next = advanceTreasureTask(next.state, { kind: "frame" });
  assert.equal(next.wait, "complete");
  assert.equal(all.filter((e) => e.kind === "grant").length, 1);
  assert.equal(all.filter((e) => e.kind === "flag").length, 1);
  assert.deepEqual(advanceTreasureTask(next.state, { kind: "frame" }).effects, []);
});

test("already flagged explicit message task still opens visuals and always returns scene to Player without granting", () => {
  const def = taskDefinition({ pick_up: true });
  let next = start(createTreasureTask(def, compileTreasureBoxInstruction(treasureInstruction())), true);
  assert.deepEqual(next.effects[0], { kind: "open", entityId: 42, hide: true });
  assert.equal(next.effects.some((e) => e.kind === "grant" || e.kind === "sound" || e.kind === "flag"), false);
  next = advanceTreasureTask(next.state, { kind: "message-complete" });
  next = advanceTreasureTask(next.state, { kind: "frame" });
  assert.equal(next.wait, "complete");
  assert.deepEqual(next.effects, [{ kind: "scene-state", state: "player" }]);
});

test("explicit after message task does not change scene for a new reward", () => {
  let next = start(createTreasureTask(taskDefinition(), compileTreasureBoxInstruction(treasureInstruction())));
  assert.equal(next.effects.some((e) => e.kind === "scene-state"), false);
  next = advanceTreasureTask(next.state, { kind: "message-complete" });
  next = advanceTreasureTask(next.state, { kind: "frame" });
  assert.deepEqual(kinds(next.effects), ["flag", "yield"]);
});

test("silent explicit instruction ignores a set flag, grants zero as a real command and yields after flag", () => {
  const next = start(createTreasureTask(taskDefinition({ content_num: 0 }),
    compileTreasureBoxInstruction(treasureInstruction([42, 0, 1]))), true);
  assert.equal(next.wait, "frame");
  assert.deepEqual(kinds(next.effects), ["open", "tile-animation", "grant", "flag", "yield"]);
  assert.deepEqual(next.effects[2], { kind: "grant", command: { kind: "grant-item", id: 101, count: 0 } });
});

test("ordinary script treasure hands off its task without awarding or setting the flag; explicit after bypasses that script", () => {
  const def = taskDefinition({ script_id: 31, se_id: 0 });
  let next = start(createTreasureTask(def, taskRequest({ script_id: 31, se_id: 0 })));
  assert.deepEqual(kinds(next.effects), ["deactivate-action", "open", "tile-animation", "run-script", "yield"]);
  assert.deepEqual(next.effects[3], { kind: "run-script", id: 31, name: "synthetic-treasure" });
  next = advanceTreasureTask(next.state, { kind: "frame" });
  assert.equal(next.wait, "complete");
  assert.deepEqual(next.effects, []);
  const after = start(createTreasureTask(def, compileTreasureBoxInstruction(treasureInstruction())));
  assert.equal(after.effects.some((e) => e.kind === "run-script"), false);
  assert.equal(after.effects.some((e) => e.kind === "grant"), true);
});

test("unknown reads and failed effect publication leave the input state retryable; private task snapshots do not alias", () => {
  const def = taskDefinition(), request = taskRequest({}, { actionSoundId: 0 });
  const state = createTreasureTask(def, request), before = structuredClone(state);
  assert.throws(() => start(state, null), /Unknown/);
  assert.deepEqual(state, before);
  const candidate = start(state);
  candidate.state.definition.contentNum = 100;
  candidate.state.remaining.length = 0;
  assert.deepEqual(state, before);
  assert.deepEqual(start(state), start(before));
  def.contentNum = 80; request.message = false;
  assert.deepEqual(state, before);
});

test("anonymous ordinary treasure uses its exact source ID 0 and unknown/mismatched requests are rejected", () => {
  const def = taskDefinition({ entity_id: 0 });
  assert.equal(start(createTreasureTask(def, taskRequest({ entity_id: 0 }))).wait, "sound");
  assert.throws(() => createTreasureTask(def, taskRequest()), /request/);
  assert.throws(() => createTreasureTask(def, taskRequest({ entity_id: 0 }, { actionSoundId: -1 })), /request/);
});

test("treasure message compiler removes the source icon through SetValue, replaces all parameters, and retains CT centering", () => {
  const messages = taskMessages();
  const projected = compileTreasureTaskMessages(taskDefinition(), messages, taskSystemMessages);
  assert.deepEqual(projected.reward, { key: "SYNTHETIC_TREASURE", speaker: "",
    text: "Found Sample medicine.\nKeep it.", alignment: "center" });
  assert.deepEqual(projected.empty, { key: "SYN_EMPTY", text: "It is empty.", speaker: "" });
  assert.deepEqual(projected.parameter, { token: "ITEM_N", value: "Sample medicine", sourceKey: "SYN_ITEM" });
  messages.story_mes_zhc.SYNTHETIC_TREASURE = "(ITEM_N) + (ITEM_N)";
  assert.equal(compileTreasureTaskMessages(taskDefinition(), messages, taskSystemMessages).reward!.text,
    "Sample medicine + Sample medicine");
});

test("Gil message uses source requested quantity including zero, never the clipped gain or locale grouping", () => {
  for (const count of [0, 12345]) {
    const def = taskDefinition({ content_id: 501, content_num: count, message_key: "SYN_GIL_REWARD" });
    const projected = compileTreasureTaskMessages(def, taskMessages(), {});
    assert.equal(projected.reward!.text, `Found ${count} coins.`);
    assert.deepEqual(projected.parameter, { token: "NUM", value: String(count), sourceKey: null });
  }
});

test("ordinary scripted treasure does not require its unused placeholder reward, but explicit message does", () => {
  const properties = { content_id: 501, content_num: 0, script_id: 31 };
  const def = taskDefinition(properties), messages = taskMessages();
  const ordinary = compileTreasureTaskMessages(def, messages, {}, taskRequest(properties));
  assert.equal(ordinary.reward, null);
  assert.equal(ordinary.empty.key, "SYN_EMPTY");
  assert.equal(ordinary.countOver?.key, "SYN_FULL");
  assert.throws(() => compileTreasureTaskMessages(def, messages, {}), /substitution/);
  assert.throws(() => compileTreasureTaskMessages(def, messages, {},
    compileTreasureBoxInstruction(treasureInstruction())), /substitution/);
  const silent = compileTreasureTaskMessages(def, messages, {},
    compileTreasureBoxInstruction(treasureInstruction([42, 0, 1])));
  assert.equal(silent.reward, null);
});

test("message compiler blocks missing names, stale substitutions and unimplemented controls before a task can publish", () => {
  assert.throws(() => compileTreasureTaskMessages(taskDefinition(), taskMessages(), {}), /Missing/);
  for (const text of ["(UNKNOWN)", "(NUM)", "<WAIT>hello", "hello\\c"]) {
    const messages = taskMessages(); messages.story_mes_zhc.SYNTHETIC_TREASURE = text;
    assert.throws(() => compileTreasureTaskMessages(taskDefinition(), messages, taskSystemMessages), /Unsupported|unsupported/);
  }
  const messages = taskMessages(); messages.story_mes_zhc.SYN_EMPTY = "(ITEM_N)";
  assert.throws(() => compileTreasureTaskMessages(taskDefinition(), messages, taskSystemMessages), /substitution/);
  assert.throws(() => compileTreasureTaskMessages(taskDefinition(), taskMessages(), { SYN_ITEM: "<WAIT>thing" }), /control/);
  assert.throws(() => compileTreasureTaskMessages(taskDefinition(), taskMessages(), { SYN_ITEM: "<IC_BAG><IC_ROD>thing" }), /substitution/);
});

test("treasure substitutions use shared whole-message CT alignment regardless of control position", () => {
  for (const text of ["(ITEM_N)<CT>", "<CT><CT>(ITEM_N)"]) {
    const messages = taskMessages(); messages.story_mes_zhc.SYNTHETIC_TREASURE = text;
    assert.deepEqual(compileTreasureTaskMessages(taskDefinition(), messages, taskSystemMessages).reward,
      { key: "SYNTHETIC_TREASURE", text: "Sample medicine", speaker: "", alignment: "center" });
  }
});
