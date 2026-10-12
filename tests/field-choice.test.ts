import assert from "node:assert/strict";
import test from "node:test";
import { createFieldChoiceRequest, resolveFieldChoiceAnswer, validateFieldChoice } from "../src/core/field-choice.js";
import { FieldGame } from "../src/core/field.js";
import { choiceAssign, choiceDefinition, choiceExit, choiceFixture, choiceMessage, choiceVariable,
  choiceWait, copySelection, selection, type ChoiceInstruction } from "./fixtures/field-choice.js";

test("choice presentation is detached, immutable and never answers its initial highlight", () => {
  const op = choiceDefinition({ presentation: "yes-no", anchor: "bottom-right", initialIndex: 1 });
  const request = createFieldChoiceRequest(op, "field:1", 2);
  op.options[1]!.text = "changed source object";
  assert.equal(request.options[1]!.text, "Second");
  assert.throws(() => Object.assign(request.options[1]!, { text: "changed UI" }));
  for (const input of [-1, 2, 0.5, NaN, Infinity, "cancel"] as const)
    assert.equal(resolveFieldChoiceAnswer(request, input), null);
  assert.equal(resolveFieldChoiceAnswer(request, 0), 0);
  assert.equal(resolveFieldChoiceAnswer(request, 1), 1);
  for (const malformed of [choiceDefinition({ options: [] }), choiceDefinition({ initialIndex: 2 }),
    choiceDefinition({ cancelIndex: -1 }), choiceDefinition({ cancelIndex: 0 }),
    choiceDefinition({ initialIndex: 1 }), choiceDefinition({ anchor: "top-left" }),
    choiceDefinition({ options: [{ key: "ONE", text: "" }, { key: "TWO", text: "Second" }] })])
    assert.throws(() => validateFieldChoice(malformed));
});

test("waiting selection gates confirm, movement, menus, save and map preview without resetting the register", () => {
  const { field, state } = choiceFixture([choiceDefinition(), copySelection, choiceExit]);
  field.startEvent("choice"); const request = field.choice!;
  assert.equal(field.stop, null); assert.equal(request.initialIndex, 0);
  assert.equal(state.read(selection), 9); assert.equal(field.menuReady, false);
  assert.equal(field.checkpointReady, false); assert.throws(() => field.checkpoint(), /Cannot save/);
  assert.equal(field.move("down"), false); assert.throws(() => field.previewMap(2, 1), /during an event/);
  assert.equal(field.startEvent("groups"), false);
  field.confirm(); field.advance(100); assert.equal(field.choice, request);
  assert.equal(state.read(selection), 9); assert.equal(state.read(choiceVariable()), 0);
  for (const input of [-1, 2, 0.1, NaN, "cancel"] as const) assert.equal(field.choose(request.id, input), false);
  assert.equal(field.choose(request.id, 0), true);
  assert.equal(state.read(selection), 0); assert.equal(field.choice, null); assert.equal(field.choicePending, true);
  assert.equal(field.checkpointReady, false); assert.equal(field.choose(request.id, 1), false);
  field.confirm(); assert.equal(state.read(choiceVariable()), 0); assert.equal(field.choicePending, true);
  field.advance(10); assert.equal(field.choicePending, false); assert.equal(field.menuReady, true);
  assert.equal(state.read(choiceVariable()), 0); assert.equal(field.stop, null);
});

test("answering a repeated choice cannot answer the next request or another FieldGame instance", () => {
  const instructions = [choiceDefinition(), choiceDefinition(), copySelection, choiceExit];
  const a = choiceFixture(instructions), b = choiceFixture(instructions);
  a.field.startEvent("choice"); b.field.startEvent("choice");
  const first = a.field.choice!;
  assert.notEqual(first.id, b.field.choice!.id); assert.equal(b.field.choose(first.id, 1), false);
  assert.equal(a.field.choose(first.id, 1), true); assert.equal(a.state.read(choiceVariable()), 0);
  a.field.advance(10); const second = a.field.choice!;
  assert.notEqual(first.id, second.id); assert.equal(first.task, second.task);
  assert.equal(a.field.choose(first.id, 0), false); assert.equal(a.state.read(selection), 1);
  a.field.confirm(); assert.equal(a.field.choice!.id, second.id);
  assert.equal(a.field.choose(second.id, 0), true); a.field.advance(10);
  const checkpoint = a.field.checkpoint();
  const restored = FieldGame.restore(a.content, checkpoint);
  assert.equal(restored.eventState.read(selection), 0);
  assert.equal(restored.choose(second.id, 1), false); restored.startEvent("choice");
  assert.notEqual(restored.choice!.id, first.id); assert.notEqual(restored.choice!.id, second.id);
});

test("ordinary Msg retains its prompt for yes/no and closes it only after the selected task resumes", () => {
  const effects: unknown[] = [];
  const { field, state } = choiceFixture([choiceMessage,
    choiceDefinition({ presentation: "yes-no", anchor: "bottom-right", initialIndex: 1 }), copySelection, choiceExit],
    { sourceMessageEffects: { prepare: (value) => { effects.push(structuredClone(value)); return () => {}; } } });
  field.startEvent("choice"); assert.equal(field.choice, null); field.confirm();
  const request = field.choice!; assert.equal(field.dialogue, null); assert.equal(field.messageWindow?.key, "PROMPT");
  field.confirm(); assert.equal(field.messageWindow?.key, "PROMPT"); assert.equal(state.read(selection), 9);
  assert.equal(field.choose(request.id, 1), true); assert.equal(field.messageWindow?.key, "PROMPT");
  assert.deepEqual(effects, []); field.advance(10);
  assert.equal(field.messageWindow, null); assert.equal(state.read(choiceVariable()), 1);
  assert.deepEqual(effects, [[{ kind: "entity-update-group", group: 12, invokeCallback: false }]]);
});

test("source next-Msg retention keeps the window and does not emit a close effect", () => {
  let prepared = 0;
  const { field } = choiceFixture([choiceMessage, choiceDefinition({ retainMessage: true }),
    { ...choiceMessage, key: "NEXT", text: "Next line" }, choiceExit],
    { sourceMessageEffects: { prepare: () => { prepared++; return () => {}; } } });
  field.startEvent("choice"); field.confirm(); field.choose(field.choice!.id, 0); field.advance(10);
  assert.equal(prepared, 0); assert.equal(field.dialogue?.key, "NEXT"); assert.equal(field.messageWindow?.key, "NEXT");
  field.confirm(); assert.equal(field.busy, false); assert.equal(field.messageWindow, null);
});

test("yes/no cannot manufacture a missing parent message; windowless subtitles are not ordinary parents", () => {
  const missing = choiceFixture([choiceDefinition({ presentation: "yes-no" }), choiceExit]);
  missing.field.startEvent("choice"); assert.match(missing.field.stop?.message ?? "", /ordinary message window/);
  assert.equal(missing.field.choice, null); assert.equal(missing.state.read(selection), 9);
  const subtitle = choiceFixture([{ kind: "source-message", command: { kind: "play", key: "AUTO", speaker: "",
    layout: { window: "none", anchor: "top" }, seconds: -1,
    document: { kind: "source-message-document-v1", text: "Wait", alignment: "left", autoPage: true, tailWaitSeconds: null } } },
  choiceDefinition(), choiceExit], { sourceMessageEffects: { prepare: () => () => {} } });
  subtitle.field.startEvent("choice");
  assert.match(subtitle.field.stop?.message ?? "", /occupied message manager/);
  assert.equal(subtitle.field.sourceMessage.projection?.key, "AUTO"); assert.equal(subtitle.field.choice, null);
});

test("independent puppet clocks continue while selection waits; answering never clocks them again", () => {
  const { field, state } = choiceFixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 6 }, { kind: "exec-puppets", asynchronous: true },
    choiceDefinition(), { kind: "finish-puppets" }, choiceAssign(77), choiceExit,
    choiceWait, choiceAssign(10, 1), choiceWait, choiceAssign(11, 1), choiceExit,
  ]);
  field.startEvent("choice"); field.advance(10); assert.equal(state.read(choiceVariable(1)), 10);
  const time = field.time; field.choose(field.choice!.id, 1);
  assert.equal(field.time, time); assert.equal(state.read(choiceVariable(1)), 10);
  assert.equal(state.read(choiceVariable()), 0); field.advance(10);
  assert.equal(state.read(choiceVariable(1)), 11); assert.equal(state.read(choiceVariable()), 0);
  field.advance(10); assert.equal(state.read(choiceVariable()), 77); assert.equal(field.stop, null);
});

test("a puppet-owned answer resumes only that task while the main core keeps its independent wait", () => {
  const { field, state } = choiceFixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 6 }, { kind: "exec-puppets", asynchronous: true },
    { kind: "wait", seconds: 0.02 }, choiceAssign(90, 1), { kind: "finish-puppets" }, choiceExit,
    choiceDefinition(), copySelection, choiceExit,
  ]);
  field.startEvent("choice"); const request = field.choice!; assert.equal(request.task, 2);
  assert.equal(field.choose(request.id, 1), true);
  assert.equal(state.read(choiceVariable()), 0); assert.equal(state.read(choiceVariable(1)), 0);
  field.advance(10);
  assert.equal(state.read(choiceVariable()), 1); assert.equal(state.read(choiceVariable(1)), 0);
  field.advance(10); assert.equal(state.read(choiceVariable(1)), 90); assert.equal(field.stop, null);
});

for (const conflicting of [choiceDefinition(), choiceMessage,
  { kind: "change-map", request: { mapId: 2, entrance: 1, continuation: null, birdview: false,
    skipFade: false, skipBgm: false, origin: "script" } },
  { kind: "encounter", party: 1000, continuation: "after" }] as ChoiceInstruction[]) {
  test(`a concurrent ${conflicting.kind} cannot replace or escape an existing choice owner`, () => {
    const { field, state } = choiceFixture([
      { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true },
      choiceDefinition(), choiceExit, conflicting, choiceExit,
    ]);
    field.startEvent("choice"); const request = field.choice!;
    assert.equal(field.stop?.kind, "unsupported"); assert.match(field.stop?.message ?? "", /unfinished choice/);
    assert.equal(request.task, 1); assert.equal(field.choose(request.id, 1), false);
    assert.equal(state.read(selection), 9);
  });
}

test("main termination cannot silently orphan a puppet-owned choice", () => {
  const { field, state } = choiceFixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true },
    choiceWait, choiceExit, choiceDefinition(), choiceExit,
  ]);
  field.startEvent("choice"); const request = field.choice!; assert.equal(request.task, 2);
  field.advance(10); assert.match(field.stop?.message ?? "", /unfinished choice task/);
  assert.equal(field.choose(request.id, 1), false); assert.equal(state.read(selection), 9);
});

test("close preparation failure leaves the source callback result and retained message but never advances the task", () => {
  const { field, state } = choiceFixture([choiceMessage, choiceDefinition(), choiceAssign(77), choiceExit],
    { sourceMessageEffects: { prepare: () => { throw new Error("controlled close host failure"); } } });
  field.startEvent("choice"); field.confirm(); const id = field.choice!.id;
  field.choose(id, 1); field.advance(10);
  assert.equal(state.read(selection), 1); assert.equal(state.read(choiceVariable()), 0);
  assert.equal(field.messageWindow?.key, "PROMPT"); assert.equal(field.choicePending, true);
  assert.match(field.stop?.message ?? "", /controlled close host failure/); assert.equal(field.choose(id, 0), false);
});

test("a malformed message host cannot inherit the explicit legacy entity-mask path", () => {
  const { field, state } = choiceFixture([choiceMessage, choiceDefinition(), choiceAssign(77), choiceExit],
    { sourceMessageEffects: { prepare: () => undefined as unknown as () => void } });
  field.startEvent("choice"); field.confirm(); field.choose(field.choice!.id, 1); field.advance(10);
  assert.match(field.stop?.message ?? "", /Invalid choice message host transaction/);
  assert.equal(field.messageWindow?.key, "PROMPT"); assert.equal(state.read(choiceVariable()), 0);
});
