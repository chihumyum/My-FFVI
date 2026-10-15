import assert from "node:assert/strict";
import test from "node:test";
import { transitionFixture, transition, set, mapVar, label, exit, wait,
  type TransitionInstruction } from "./fixtures/event-script-transition.js";
import type { FieldGame, FieldGameOptions } from "../src/core/field.js";

const sequence = (seconds = 0): TransitionInstruction => ({ kind: "source-message", command: {
  kind: "sequence", key: "CONTROLLED_MESSAGE", speaker: "", layout: { window: "frame", anchor: "bottom" },
  seconds, bypassSpeed: false, after: "close", document: { kind: "source-message-sequence-v1", alignment: "left",
    tokens: [{ kind: "text", text: "Owned source window" }, { kind: "wait", suffix: "04", seconds: 1 },
      { kind: "text", text: "Preserve this owner" }] } } });
const options: FieldGameOptions = { sourceMessageSequence: { prepare: () => ({ context: {
  kind: "web-field-message-sequence-v1", layout: "source-explicit-pages", integratorAutomatic: false,
  battleMessageSpeedFactor: 1 }, validate() {} }) } };
const tasks = (field: FieldGame) => (field as unknown as { tasks: { id: number; slot: number | null;
  script: string; sourceMessageWait: unknown }[] }).tasks;

test("ChangeScript refuses to discard another task's synchronous source message before target locals or writes", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 5 },
    { kind: "exec-puppets", asynchronous: true }, wait, transition("child"), exit, sequence(), exit],
    child: [label, set(mapVar(), 99), exit] }, options);
  f.content.scriptLocals!.main = { labels: ["caller"], values: [7] };
  f.content.scriptLocals!.child = { labels: ["target"], values: [99] };
  const field = f.create(); field.startEvent("main");
  const before = f.state.snapshot(), array = tasks(field), puppet = array.find(task => task.slot === 0)!, cursor = puppet.sourceMessageWait;
  const expected = field.sourceMessage.fork(); expected.advance(.01);
  field.advance(10);
  assert.match(field.stop?.message ?? "", /ChangeScript cannot detach another task's source message/);
  assert.equal(field.stop?.site?.script, "main"); assert.equal(field.stop?.site?.index, 3);
  assert.equal(tasks(field), array); assert.equal(tasks(field).find(task => task.slot === 0), puppet);
  assert.equal(puppet.sourceMessageWait, cursor); assert.deepEqual(f.state.snapshot(), before);
  assert.deepEqual(field.sourceMessage.snapshot(), expected.snapshot()); assert.equal(f.state.read(mapVar()), 0);
});

test("main Exit cannot retire a different task's asynchronous global source window", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 5 },
    { kind: "exec-puppets", asynchronous: true }, wait, exit, label, sequence(-1), exit] }, options);
  const field = f.create(); field.startEvent("main"); const array = tasks(field), before = f.state.snapshot();
  const expected = field.sourceMessage.fork(); expected.advance(.01); field.advance(10);
  assert.match(field.stop?.message ?? "", /Main script ended with another task's source message window/);
  assert.equal(tasks(field), array); assert.deepEqual(field.sourceMessage.snapshot(), expected.snapshot());
  assert.deepEqual(f.state.snapshot(), before); assert.equal(field.sourceMessage.active, true);
});

test("hook return cannot replace the callee bank or resume its caller while a puppet owns the source window", () => {
  const f = transitionFixture({ main: [transition("child", true), set(mapVar(), 99), exit],
    child: [label, { kind: "puppet", slot: 0, actor: "npc", target: 5 },
      { kind: "exec-puppets", asynchronous: true }, wait, exit, sequence(-1), exit] }, options);
  f.content.scriptLocals!.main = { labels: ["caller"], values: [7] };
  f.content.scriptLocals!.child = { labels: ["callee"], values: [11] };
  const field = f.create(); field.startEvent("main"); const before = f.state.snapshot(), array = tasks(field);
  field.advance(10);
  assert.match(field.stop?.message ?? "", /another task's source message window/);
  assert.deepEqual(f.state.snapshot(), before); assert.deepEqual(f.state.snapshot().scriptLabels, ["callee"]);
  assert.equal(f.state.read(mapVar()), 0); assert.equal(tasks(field), array); assert.equal(field.sourceMessage.active, true);
});

for (const handoff of [
  { kind: "encounter", party: 1000, continuation: "after" },
  { kind: "change-map", request: { mapId: 2, entrance: 1, continuation: null, birdview: false,
    skipFade: false, skipBgm: false, origin: "script" } },
] satisfies TransitionInstruction[]) test(`another task's ${handoff.kind} cannot escape a source message owner in the ordinary legacy host`, () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 5 },
    { kind: "exec-puppets", asynchronous: true }, sequence(), set(mapVar(), 99), exit, handoff, exit] }, options);
  const field = f.create(); field.startEvent("main");
  assert.equal(field.stop?.kind, "unsupported"); assert.match(field.stop?.message ?? "", /Source message must close/);
  assert.equal(f.state.read(mapVar()), 0); assert.equal(field.sourceMessage.active, true);
  assert.equal(tasks(field).some(task => task.slot === null && task.sourceMessageWait !== null), true);
  assert.throws(() => field.checkpoint(), /Cannot save/);
});

test("an explicit concurrent close invalidates the waiting task ticket and never executes its successor", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 5 },
    { kind: "exec-puppets", asynchronous: true }, sequence(), set(mapVar(), 99), exit,
    { kind: "source-message", command: { kind: "close" } }, exit] }, options);
  const field = f.create(); field.startEvent("main"); assert.equal(field.sourceMessage.active, false);
  field.advance(10); assert.match(field.stop?.message ?? "", /Stale source Msg wrapper window/);
  assert.equal(f.state.read(mapVar()), 0); assert.equal(field.sourceMessage.active, false);
});

test("same-task asynchronous Msg continues once and its explicit close permits the ordinary lifecycle", () => {
  const f = transitionFixture({ main: [sequence(-1), set(mapVar(), 1), { kind: "wait", seconds: .02 },
    { kind: "source-message", command: { kind: "close" } }, set(mapVar(), 2), exit] }, options);
  const field = f.create(); field.startEvent("main"); assert.equal(f.state.read(mapVar()), 1);
  field.advance(100); assert.equal(field.stop, null); assert.equal(f.state.read(mapVar()), 2);
  assert.equal(field.sourceMessage.active, false); assert.equal(field.checkpointReady, true);
});
