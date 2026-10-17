import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame } from "../src/core/field.js";
import type { FieldCameraHostDefinition } from "../src/core/field-camera-host.js";
import { fieldPuppetActorHostFixture } from "./fixtures/field-puppet-actors.js";
import { choiceDefinition, choiceMessage } from "./fixtures/field-choice.js";
import { copy, exit, itemSelected, label, localVar, mapVar, selected, set, transition,
  transitionFixture, wait, type TransitionInstruction } from "./fixtures/event-script-transition.js";

test("ChangeScript replaces processing immediately, skips target index zero and preserves provenance", () => {
  const f = transitionFixture({ main: [set(mapVar(), 1), transition("next"), set(mapVar(), 99), exit],
    next: [set(mapVar(), 777), set(mapVar(), 2), exit] });
  const field = f.create(); field.startEvent("main");
  assert.equal(f.content.scripts.main![1]!.script, "main");
  assert.equal(field.stop, null); assert.equal(field.time, 0); assert.equal(field.busy, false);
  assert.equal(f.state.read(mapVar()), 2);
  assert.deepEqual(FieldGame.restore(f.content, field.checkpoint()).checkpoint(), field.checkpoint());
});

test("a hooked script resumes only on the following clock and restores locals but keeps callee selections", () => {
  const f = transitionFixture({ main: [set(localVar(), 21), transition("child", true), copy(mapVar(), localVar()),
    copy(mapVar(1), selected), copy(mapVar(2), itemSelected), exit],
    child: [label, set(localVar(), 99), set(selected, 1), set(itemSelected, 3), exit] });
  f.content.scriptLocals!.main = { labels: ["parent"], values: [7] };
  f.content.scriptLocals!.child = { labels: ["child"], values: [8] };
  const field = f.create(); field.startEvent("main");
  assert.equal(field.stop, null); assert.equal(field.busy, true); assert.equal(f.state.read(mapVar()), 0);
  assert.deepEqual(f.state.snapshot().scriptLabels, ["parent"]); assert.equal(f.state.read(localVar()), 21);
  assert.equal(f.state.read(selected), 1); assert.equal(f.state.read(itemSelected), 3);
  field.confirm(); assert.equal(f.state.read(mapVar()), 0);
  field.advance(10);
  assert.equal(field.stop, null); assert.equal(field.busy, false);
  assert.deepEqual([0, 1, 2].map((index) => f.state.read(mapVar(index))), [21, 1, 3]);
});

test("a non-returning replacement inside a hook retains the original caller and shared-bank writes", () => {
  const f = transitionFixture({ main: [transition("middle", true), copy(mapVar(), localVar()), exit],
    middle: [label, set(localVar(), 41), transition("last"), exit],
    last: [label, set(localVar(), 99), exit] });
  f.content.scriptLocals!.main = { labels: ["shared"], values: [5] };
  f.content.scriptLocals!.last = { labels: ["last"], values: [1] };
  const field = f.create(); field.startEvent("main"); field.advance(10);
  assert.equal(field.stop, null); assert.equal(f.state.read(mapVar()), 41);
  assert.deepEqual(f.state.snapshot().scriptLabels, ["shared"]);
});

test("a second hooked transition fails before changing its current script-local bank", () => {
  const f = transitionFixture({ main: [transition("child", true), exit],
    child: [label, set(localVar(), 42), transition("nested", true), exit], nested: [label, exit] });
  f.content.scriptLocals!.child = { labels: ["child"], values: [7] };
  f.content.scriptLocals!.nested = { labels: ["nested"], values: [9] };
  const field = f.create(); field.startEvent("main");
  assert.match(field.stop?.message ?? "", /already has a hooked caller/);
  assert.equal(field.stop?.site?.script, "child"); assert.equal(field.stop?.site?.index, 2);
  assert.equal(f.state.read(localVar()), 42); assert.deepEqual(f.state.snapshot().scriptLabels, ["child"]);
});

test("ResetAll cancels Awake and Ready slots before the target can reuse the same global tracks", () => {
  const f = transitionFixture({ main: [
    { kind: "puppet", slot: 0, actor: "npc", target: 7 }, { kind: "exec-puppets", asynchronous: true },
    { kind: "puppet", slot: 1, actor: "npc", target: 10 }, wait, transition("next"), exit, label,
    { kind: "wait", seconds: 0.05 }, set(mapVar(1), 99), exit, set(mapVar(2), 88), exit],
    next: [label, { kind: "puppet", slot: 0, actor: "npc", target: 4 },
      { kind: "exec-puppets", asynchronous: false }, exit, set(mapVar(), 42), exit] });
  const field = f.create(); field.startEvent("main"); field.advance(100);
  assert.equal(field.stop, null); assert.equal(field.busy, false);
  assert.deepEqual([0, 1, 2].map((index) => f.state.read(mapVar(index))), [42, 0, 0]);
});

test("the old Call stack is cleared at entry and is never restored with the hook", () => {
  const f = transitionFixture({ main: [{ kind: "call", target: 3 }, exit, label, label, transition("child", true),
    { kind: "return" }], child: [label, exit] });
  const field = f.create(); field.startEvent("main"); assert.equal(field.busy, true);
  field.advance(10); assert.match(field.stop?.message ?? "", /Return has no matching Call/);
});

test("a callee left inside a Call is blocked instead of silently dropping its native remaining stack", () => {
  const f = transitionFixture({ main: [transition("child", true), set(mapVar(), 1), exit],
    child: [label, { kind: "call", target: 3 }, exit, label, exit] });
  const field = f.create(); field.startEvent("main");
  assert.match(field.stop?.message ?? "", /nonempty callee Call stack/);
  assert.equal(f.state.read(mapVar()), 0);
});

test("a ChangeScript invoked by a puppet cannot reset the main or publish target locals", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 3 },
    { kind: "exec-puppets", asynchronous: false }, exit, transition("child"), exit], child: [label, exit] });
  f.content.scriptLocals!.child = { labels: ["child"], values: [99] };
  const field = f.create(); field.startEvent("main");
  assert.match(field.stop?.message ?? "", /from a puppet/);
  assert.equal(f.state.snapshot().script, null);
});

for (const damage of ["missing-target", "missing-metadata", "unsupported-metadata", "missing-locals", "invalid-locals"] as const) {
  test(`failed ${damage} preflight leaves the shared event bank and current owners untouched`, () => {
    const f = transitionFixture({ main: [set(localVar(), 12), wait, transition("child"), exit], child: [label, exit] });
    f.content.scriptLocals!.main = { labels: ["parent"], values: [3] };
    f.content.scriptLocals!.child = { labels: ["child"], values: [5] };
    if (damage === "missing-target") delete f.content.scripts.child;
    if (damage === "missing-metadata") delete f.content.scriptTransitionMetadata!.child;
    if (damage === "unsupported-metadata") f.content.scriptTransitionMetadata!.child = null;
    if (damage === "missing-locals") delete f.content.scriptLocals!.child;
    if (damage === "invalid-locals") f.content.scriptLocals!.child = { labels: ["child"], values: [NaN] };
    const field = f.create(); field.startEvent("main"); const before = f.state.snapshot(), player = field.player;
    field.advance(10); assert.equal(field.stop?.kind, "unsupported");
    assert.deepEqual(f.state.snapshot(), before); assert.equal(field.player, player);
    assert.equal(field.stop?.site?.script, "main"); assert.equal(field.stop?.site?.index, 2);
  });
}

test("a choice in the caller and callee uses the same owner but distinct stale-safe request identities", () => {
  const f = transitionFixture({ main: [choiceDefinition(), copy(mapVar(), selected), transition("child", true),
    copy(mapVar(2), selected), exit], child: [label, choiceDefinition(), copy(mapVar(1), selected), exit] });
  const field = f.create(); field.startEvent("main"); const first = field.choice!;
  field.choose(first.id, 1); field.advance(10); const second = field.choice!;
  assert.equal(first.task, second.task); assert.notEqual(first.id, second.id);
  assert.equal(field.choose(first.id, 0), false); field.confirm(); assert.equal(field.choice, second);
  assert.equal(field.move("down"), false); assert.equal(field.checkpointReady, false);
  field.choose(second.id, 0); field.advance(20);
  assert.equal(field.stop, null); assert.equal(field.busy, false);
  assert.deepEqual([0, 1, 2].map((index) => f.state.read(mapVar(index))), [1, 0, 0]);
});

test("a pending puppet choice cannot be orphaned by the main changing scripts", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 5 },
    { kind: "exec-puppets", asynchronous: true }, wait, transition("child"), exit, choiceDefinition(), exit],
    child: [label, set(mapVar(), 99), exit] });
  const field = f.create(); field.startEvent("main"); const request = field.choice!;
  field.advance(10);
  assert.match(field.stop?.message ?? "", /unfinished choice/); assert.equal(field.choice, request);
  assert.equal(field.choose(request.id, 1), false); assert.equal(f.state.read(mapVar()), 0);
});

test("another task's ordinary message remains present when a script transition is refused", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 5 },
    { kind: "exec-puppets", asynchronous: true }, wait, transition("child"), exit, choiceMessage, exit],
    child: [label, exit] });
  const field = f.create(); field.startEvent("main"); const message = field.messageWindow;
  field.advance(10); assert.match(field.stop?.message ?? "", /another task's message/);
  assert.equal(field.messageWindow, message);
});

test("the root SystemFlags remain in effect after ChangeScript, independent of the new metadata", () => {
  for (const rootFlag of [false, true]) {
    let prepared = 0;
    const f = transitionFixture({ main: [transition("child"), exit], child: [label,
      { kind: "roster", command: { kind: "join", sourceId: 1, position: null, row: "front",
        refreshActors: false, recovery: true, refitEquipment: false }, dependencies: [] }, exit] },
      { roster: { prepare: () => { prepared++; throw new Error("controlled roster preparation"); } } });
    f.content.scriptSystemFlags = { main: { keepBadStatusVisual: rootFlag }, child: { keepBadStatusVisual: !rootFlag } };
    const field = f.create(); field.startEvent("main");
    assert.equal(prepared, rootFlag ? 0 : 1);
    assert.match(field.stop?.message ?? "", rootFlag ? /condition-visual context/ : /controlled roster preparation/);
  }
});

const camera: FieldCameraHostDefinition = { kind: "source-field-camera-host-v1",
  mapRange: { x: 0, y: 0, width: 40, height: 40 }, loop: { horizontal: false, vertical: false },
  playerVisualOffset: { x: 0, y: -6 }, callbacks: "fresh-normal-field-v1",
  sources: [{ file: "synthetic-native", sha256: "1".repeat(64) }, { file: "synthetic-prefab", sha256: "2".repeat(64) }] };

test("hook entry and return preserve the original puppet and camera lifecycle until the whole event finishes", () => {
  const host = fieldPuppetActorHostFixture({ worldMapScript: false, callback: "absent" });
  host.context.player = "-1001"; host.context.camera = "native:camera";
  host.context.actors.find((actor) => actor.id === "player")!.id = "-1001";
  host.snapshot().actors.find((actor) => actor.id === "player")!.id = "-1001";
  host.snapshot().camera!.id = "native:camera";
  const prepare = host.port.prepare; let publications = 0;
  host.port.prepare = (plan) => { const publish = prepare(plan); return () => { publications++; publish(); }; };
  const f = transitionFixture({ main: [transition("child", true), wait, exit], child: [label, exit] },
    { puppetActors: host.port });
  f.content.cameraHost = structuredClone(camera);
  // No child lifecycle is provided: ChangeScript is not a new Execute.
  f.content.scriptPuppetContexts = { main: host.script };
  const field = f.create(); field.startEvent("main");
  assert.equal(field.stop, null); assert.equal(publications, 1); assert.equal(field.cameraSnapshot?.target, "dummy");
  field.advance(10); assert.equal(publications, 1); assert.equal(field.cameraSnapshot?.target, "dummy");
  field.advance(10); assert.equal(field.stop, null); assert.equal(publications, 2);
  assert.equal(field.cameraSnapshot?.target, "player");
});

test("a source name classification change never guesses the world-map conjunct from false", () => {
  const host = fieldPuppetActorHostFixture({ worldMapScript: false, callback: "absent" });
  const f = transitionFixture({ main: [transition("SC_MAP_child"), exit], SC_MAP_child: [label, exit] },
    { puppetActors: host.port });
  f.content.scriptPuppetContexts = { main: host.script };
  const field = f.create(); field.startEvent("main");
  assert.match(field.stop?.message ?? "", /current world-map provider/);
});

test("a callee's source subtitle remains with its independent owner until the caller explicitly closes it", () => {
  const effects: number[] = [];
  const f = transitionFixture({ main: [transition("child", true),
    { kind: "source-message", command: { kind: "close" } }, choiceMessage, exit], child: [label,
    { kind: "source-message", command: { kind: "play", key: "SUBTITLE", speaker: "",
      layout: { window: "none", anchor: "top" }, seconds: -1,
      document: { kind: "source-message-document-v1", text: "Still visible", alignment: "left",
        autoPage: true, tailWaitSeconds: null } } }, exit] },
    { sourceMessageEffects: { prepare: (planned) => () => { effects.push(...planned.map((effect) => effect.group)); } } });
  const field = f.create(); field.startEvent("main");
  assert.equal(field.sourceMessage.active, true); assert.equal(field.sourceMessage.projection?.key, "SUBTITLE");
  assert.deepEqual(effects, [8]); assert.equal(field.checkpointReady, false);
  field.advance(10); assert.equal(field.sourceMessage.active, false); assert.equal(field.dialogue?.key, "PROMPT");
  assert.deepEqual(effects, [8, 12]); field.confirm(); assert.equal(field.stop, null); assert.equal(field.busy, false);
});

test("hook return cannot silently orphan a message opened by a remaining puppet", () => {
  const f = transitionFixture({ main: [transition("child", true), set(mapVar(), 99), exit], child: [label,
    { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true }, exit,
    choiceMessage, exit] });
  const field = f.create(); field.startEvent("main");
  assert.match(field.stop?.message ?? "", /Hooked script cannot detach another task's message/);
  assert.equal(field.messageWindow?.key, "PROMPT"); assert.equal(f.state.read(mapVar()), 0);
});

for (const handoff of [
  { kind: "encounter", party: 1000, continuation: "after" },
  { kind: "change-map", request: { mapId: 2, entrance: 1, continuation: null, birdview: false,
    skipFade: true, skipBgm: true, origin: "script" } },
] as TransitionInstruction[]) {
  test(`a suspended caller blocks ${handoff.kind} before another session can discard its frame`, () => {
    const f = transitionFixture({ main: [transition("child", true), set(mapVar(), 99), exit],
      child: [label, handoff, exit], after: [set(mapVar(), 88), exit] });
    const field = f.create(); field.startEvent("main");
    assert.equal(field.stop?.kind, "unsupported"); assert.match(field.stop?.message ?? "", /suspended-caller provider/);
    assert.equal(f.state.read(mapVar()), 0); assert.equal(field.checkpointReady, false);
  });
}

test("direct preview and battle return cannot bypass a live hook's owner boundary", () => {
  const f = transitionFixture({ main: [transition("child", true), exit],
    child: [label, { kind: "wait", seconds: 0.1 }, exit], after: [label, exit] });
  const field = f.create(); field.startEvent("main"); const before = f.state.snapshot();
  assert.throws(() => field.previewMap(2, 1), /during an event/);
  field.stop = { kind: "encounter", party: 1000, continuation: "after", message: "controlled host injection", site: null };
  assert.throws(() => field.prepareEncounterReturn(1000), /suspended-caller handoff provider/);
  assert.deepEqual(f.state.snapshot(), before); assert.equal(field.stop.continuation, "after");
});
