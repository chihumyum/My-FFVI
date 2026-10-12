import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { GameSession } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { sourceNewGameFixture, reservedFlag } from "./fixtures/source-new-game.js";
import { transitionFixture, transition, set, copy, exit, label, mapVar, localVar, selected,
  type TransitionInstruction } from "./fixtures/event-script-transition.js";

const save = { kind: "event-save" } as const;
const increment = (index: number): TransitionInstruction => ({ kind: "calc", left: mapVar(index),
  operator: "＋", right: { kind: "immediate", value: 1 } });

test("barrier restores inside Call, skips committed effects, and resumes on the next clock", () => {
  const fixture = transitionFixture({ main: [increment(0), { kind: "call", target: 4 },
    increment(1), exit, label, save, increment(2), { kind: "return" }] });
  const field = fixture.create(); field.startEvent("main");
  assert.equal(field.stop, null);
  const request = field.eventSaveRequest!; assert.ok(request);
  const checkpoint = field.eventCheckpoint(request);
  assert.equal(checkpoint.kind, "event-field-v1");
  const next = FieldGame.restore(fixture.content, checkpoint);
  assert.equal(next.eventSaveRequest, null);
  assert.equal(next.busy, true); assert.equal(next.checkpointReady, false);
  assert.equal(next.eventState.read(mapVar(0)), 1); assert.equal(next.eventState.read(mapVar(1)), 0);
  next.advance(0);
  assert.equal(next.eventState.read(mapVar(2)), 0);
  field.advance(60000); field.advance(1);
  assert.deepEqual(field.eventCheckpoint(request), checkpoint, "waiting time is discarded");
  field.acknowledgeEventSave(request);
  field.advance(10); next.advance(10);
  assert.equal(next.stop, null); assert.equal(next.checkpointReady, true);
  for (const index of [0, 1, 2]) assert.equal(next.eventState.read(mapVar(index)), 1);
  assert.deepEqual(next.checkpoint(), field.checkpoint());
  assert.throws(() => next.acknowledgeEventSave(request), /Stale/);
});

for (const detached of [false, true]) test(`ChangeScript hook retains ${detached ? "detached" : "shared"} local bank through save`, () => {
  const f = transitionFixture({ main: [set(localVar(), 7), transition("child", true),
    copy(mapVar(0), localVar()), exit], child: [label, set(localVar(), 42), save,
    set(localVar(), 43), set(selected, 3), exit] });
  f.content.scriptLocals!.main = { labels: ["caller"], values: [0] };
  f.content.scriptLocals!.child = detached ? { labels: ["callee"], values: [0] } : null;
  const field = f.create(); field.startEvent("main");
  assert.equal(field.stop, null);
  const request = field.eventSaveRequest!; assert.ok(request);
  const checkpoint = field.eventCheckpoint(request);
  const next = FieldGame.restore(f.content, checkpoint);
  field.acknowledgeEventSave(request);
  for (const owner of [field, next]) {
    owner.advance(10);
    assert.equal(owner.eventState.read(mapVar()), 0, "hook return must retain its logical yield");
    owner.advance(10);
    assert.equal(owner.stop, null); assert.equal(owner.checkpointReady, true);
    assert.equal(owner.eventState.read(mapVar()), detached ? 7 : 43);
    assert.equal(owner.eventState.read(selected), 3, "caller restore must preserve callee selection");
  }
  assert.deepEqual(next.checkpoint(), field.checkpoint());
});

test("parallel puppet work is rejected before publishing an incomplete save request", () => {
  const f = transitionFixture({ main: [{ kind: "puppet", slot: 0, actor: "npc", target: 3 },
    save, exit, label, { kind: "wait", seconds: 5 }, exit] });
  const field = f.create(); field.startEvent("main");
  assert.equal(field.stop?.kind, "unsupported");
  assert.match(field.stop!.message, /quiescent main task/);
  assert.equal(field.eventSaveRequest, null);
});

test("continuation cannot masquerade as an idle save or invent a new barrier", () => {
  const f = transitionFixture({ main: [increment(0), save, increment(1), exit] });
  const field = f.create(); field.startEvent("main");
  const raw = field.eventCheckpoint(field.eventSaveRequest!);
  assert.equal(raw.kind, "event-field-v1");
  if (raw.kind !== "event-field-v1") throw new Error("Missing continuation");
  const wrongPc = structuredClone(raw); wrongPc.execution.main.pc++;
  assert.throws(() => FieldGame.restore(f.content, wrongPc), /consumed barrier/);
  assert.throws(() => FieldGame.restore(f.content, { ...raw, kind: "idle-field-v10" }), /checkpoint fields/);
  const wrongCode = structuredClone(f.content); wrongCode.scripts.main![1]!.kind = "nop";
  assert.throws(() => FieldGame.restore(wrongCode, raw), /barrier/);
});

test("native source-origin entry continues without factory, Init or source flag replay", () => {
  // The package uses a deliberately authored Web barrier. It is not a mapping
  // of the source AutoSave instruction or a claim about original save files.
  const f = sourceNewGameFixture();
  const script = f.map.scripts.reserved!;
  script.splice(2, 0, { ...save, script: "reserved", index: 999, source: f.source });
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) { const step = entry.prepareResume(fade, true)!; step.commit(); fade = step.fade; }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.field.stop, null);
  const request = game.eventSaveRequest!; assert.ok(request);
  // Persist a modification after the earlier flag opcode to expose replay.
  game.field.eventState.write(reservedFlag, 0);
  const prepared = game.prepareEventSave(request), raw = prepared.checkpoint;
  assert.equal(raw.world.field.entrySynchronized, false);
  assert.equal(raw.world.kind, "event-world-v1");
  assert.equal(raw.world.field.native!.completedScript, null);
  const install = FieldGame.prototype.installNativeActors;
  FieldGame.prototype.installNativeActors = () => { throw new Error("Factory replay"); };
  let next: GameSession;
  try { next = GameSession.restore(raw, undefined, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } }); }
  finally { FieldGame.prototype.installNativeActors = install; }
  assert.equal(next.eventSaveRequest, null); assert.equal(next.field.entrySynchronized, false);
  assert.equal(next.field.eventState.read(reservedFlag), 0);
  prepared.commitWith(() => {});
  game.advance(10); next.advance(10);
  assert.equal(next.field.stop, null); assert.equal(next.checkpointReady, true);
  assert.equal(next.field.entrySynchronized, true);
  assert.equal(next.field.eventState.read(reservedFlag), 0);
  assert.deepEqual(next.checkpoint(), game.checkpoint());
});
