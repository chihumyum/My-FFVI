import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { fieldCameraCellToWorld, fieldCameraLayerFromLogical } from "../src/core/field-camera.js";
import { prepareFieldActorMotionTick, prepareFieldScriptMove, projectFieldScriptLerp,
  type FieldActorMotion, type FieldScriptLerp, type FieldScriptMotion, type FieldScriptMove } from "../src/core/field-script-motion.js";
import type { Op, Site } from "../src/field/types.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";
import { launchScriptMotionIntegration, scriptMotionIntegrationFixture } from "./fixtures/script-motion-integration.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const move = (patch: Partial<FieldScriptMove> = {}): FieldScriptMove =>
  ({ kind: "move", direction: "right", steps: 2, speedId: 0, animation: "Default", ...patch });
const lerp = (patch: Partial<FieldScriptLerp> = {}): FieldScriptLerp =>
  ({ kind: "lerp", x: 7, y: 6, layer: 0, duration: 0.5, arcHeight: 0, animation: "WalkR", ...patch });
const normal = { loop: { horizontal: false, vertical: false }, magnification: 1 };
function native() {
  const f = fieldActorFactoryFixture();
  f.input.player.position = fieldCameraCellToWorld(f.map.mapRange, { x: f.entry.player.x, y: f.entry.player.y }, 0);
  f.input.player.layer = fieldCameraLayerFromLogical(0).layer;
  const candidate = createFieldActorFactoryCandidate(f.input);
  return { f, snapshot: candidate.snapshot, id: candidate.bindings.player };
}
function serial(value: ReturnType<typeof native>["snapshot"]) {
  return JSON.stringify({ ...value, actors: value.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) });
}
function animation() {
  const f = fieldActorFactoryFixture(), media = Object.values(f.characters)[0]!;
  const result = new ActorAnimation(media); result.move("right", 0.24, "Default"); return result;
}
const flag = { category: "ScenarioFlag1" as const, index: 51 };
function runtime(commands: FieldScriptMotion[], options: { wait?: number; before?: Instruction<Op>[] } = {}) {
  const f = scriptMotionIntegrationFixture(), name = "motion_semantics";
  const values: Instruction<Op>[] = [
    { kind: "puppet", slot: 0, actor: "-1001", target: 4 },
    { kind: "exec-puppets", asynchronous: false },
    { kind: "flag", ref: flag, operation: "set" }, { kind: "exit" }, { kind: "nop" },
    ...(options.wait === undefined ? [] : [{ kind: "wait", seconds: options.wait } as const]),
    ...(options.before ?? []), ...commands.map((command) => ({ kind: "field-script-motion" as const, command })), { kind: "exit" },
  ];
  f.map.scripts[name] = values.map((op, index) => ({ ...op, script: name, index, source: f.map.map!.source }) as Op);
  f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "1".repeat(64) };
  f.map.scriptLocals![name] = null;
  const game = launchScriptMotionIntegration(f); game.advance(10);
  return { f, game, name, actor: game.field.actors["native:puppet:0"]! };
}

test("source Move builds ordered waypoints, preserves null default speed, and does not query collision", () => {
  const from = { x: 3.25, y: 4.75 };
  assert.deepEqual(prepareFieldScriptMove(move(), from, normal), {
    points: [{ x: 4, y: 4 }, { x: 5, y: 4 }], secondsPerCell: 0.24, animationSecondsPerCell: 0.24,
  });
  assert.equal(prepareFieldScriptMove(move({ speedId: null }), from, normal).secondsPerCell, 0.24);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((speedId) => prepareFieldScriptMove(move({ speedId }), from, normal).secondsPerCell),
    [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16]);
  assert.equal(prepareFieldScriptMove(move(), from, { ...normal, magnification: 2 }).secondsPerCell, 0.12);
  assert.deepEqual(from, { x: 3.25, y: 4.75 });
});

test("source Move validates host dependencies, reserved fields and bounded allocation before a route exists", () => {
  for (const command of [move({ steps: -1 }), move({ steps: 4097 }), move({ speedId: 7 }), { ...move(), guessed: true }])
    assert.throws(() => prepareFieldScriptMove(command, { x: 0, y: 0 }, normal));
  assert.throws(() => prepareFieldScriptMove(move(), { x: 0, y: 0 }, { ...normal, loop: { horizontal: true, vertical: false } }), /wrap/);
  assert.throws(() => prepareFieldScriptMove(move(), { x: 0, y: 0 }, { ...normal, magnification: 0 }), /magnification/);
  assert.deepEqual(prepareFieldScriptMove(move({ steps: 0 }), { x: 0, y: 0 }, normal).points, []);
});

test("route completion keeps native list ownership through segment-start and final-drain updates", () => {
  const playback = animation(), original = playback.snapshot();
  let motion: FieldActorMotion = { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, duration: 240, elapsed: 230, manual: false,
    route: { points: [{ x: 1, y: 0 }, { x: 2, y: 0 }], index: 0, pendingSegment: false,
      direction: "right", animation: "Default", animationSecondsPerCell: 0.24 } };
  const input = structuredClone(motion);
  const reached = prepareFieldActorMotionTick(motion, playback, 10);
  assert.equal(reached.completedSegment, true); assert.equal(reached.completedRoute, false);
  assert.equal(reached.motion!.route!.pendingSegment, true); assert.equal(reached.animation!.playing, true);
  assert.deepEqual(motion, input); assert.deepEqual(playback.snapshot(), original);
  const start = prepareFieldActorMotionTick(reached.motion!, reached.animation, 10);
  assert.equal(start.motion!.elapsed, 0); assert.deepEqual(start.point, { x: 1, y: 0 });
  assert.equal(start.completedSegment, false);
  const end = prepareFieldActorMotionTick(start.motion!, start.animation, 240);
  assert.equal(end.completedSegment, true); assert.ok(end.motion);
  const drained = prepareFieldActorMotionTick(end.motion!, end.animation, 10);
  assert.equal(drained.motion, null); assert.equal(drained.completedSegment, false);
  assert.equal(drained.completedRoute, true); assert.equal(drained.animation!.playing, false);
});

test("private animation failure cannot advance the original motion timer or playback", () => {
  const a = animation(), before = a.snapshot();
  const motion: FieldActorMotion = { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, elapsed: 230, duration: 240, manual: true };
  delete a.character.sprites.body;
  assert.throws(() => prepareFieldActorMotionTick(motion, a, 10), /sprite/);
  assert.equal(motion.elapsed, 230); assert.deepEqual(a.snapshot(), before);
});

test("actor Lerp uses source coordinates and task registers without calling movement/foot completion", () => {
  const t = native(), before = serial(t.snapshot), command = lerp();
  const first = projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, null, 10);
  const a = first.snapshot.actors.find((a) => a.id === t.id)!;
  assert.equal(first.flow, "wait"); assert.equal(a.position.z, 344); assert.equal(a.moving, false);
  assert.equal(a.animation!.snapshot()!.key, "WalkR"); assert.equal(a.animation!.snapshot()!.mode, 1);
  const mid = projectFieldScriptLerp(first.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, first.progress, 10.25);
  assert.deepEqual(mid.snapshot.actors.find((a) => a.id === t.id)!.position,
    { x: -72, y: 40, z: 344 });
  const done = projectFieldScriptLerp(mid.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, mid.progress, 10.5);
  assert.equal(done.flow, "next");
  assert.deepEqual(done.snapshot.actors.find((a) => a.id === t.id)!.position, fieldCameraCellToWorld(t.f.map.mapRange, { x: 7, y: 6 }, 0));
  assert.equal(done.snapshot.actors.find((a) => a.id === t.id)!.animation!.playing, true);
  assert.deepEqual(done.progress, first.progress); assert.equal(serial(t.snapshot), before);
});

test("zero Lerp cues immediately, with negative absolute coordinates treated as positions", () => {
  const t = native(), command = lerp({ x: -2, y: -3, duration: 0 });
  const next = projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, null, 0);
  const a = next.snapshot.actors.find((a) => a.id === t.id)!;
  assert.equal(next.flow, "next"); assert.equal(a.animation!.playing, false);
  assert.deepEqual(a.position, fieldCameraCellToWorld(t.f.map.mapRange, { x: -2, y: -3 }, 0));
});

test("positive Lerp selects its animation once, preserving the source same-key next-chain rule", () => {
  const t = native(), actor = t.snapshot.actors.find((a) => a.id === t.id)!;
  const media = actor.animation!.character;
  media.animations["WalkR-next"] = { ...media.animations.WalkR!, next: "" };
  media.animations.WalkR!.next = "WalkR-next";
  const before = serial(t.snapshot), command = lerp();
  const first = projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, null, 0);
  assert.equal(first.snapshot.actors.find((a) => a.id === t.id)!.animation!.snapshot()!.key, "WalkR");
  const end = projectFieldScriptLerp(first.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, first.progress, 0.5);
  const repeated = projectFieldScriptLerp(end.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, null, 1);
  assert.equal(repeated.snapshot.actors.find((a) => a.id === t.id)!.animation!.snapshot()!.key, "WalkR-next");
  assert.equal(serial(t.snapshot), before);
});

test("framework Lerp keeps riding identity through progress while strict source rejects the active rider", () => {
  const t = native(), actor = t.snapshot.actors.find((a) => a.id === t.id)!;
  actor.riding = true; actor.riderAssetId = 1; actor.rideOnEntity = "riding";
  const before = serial(t.snapshot), command = lerp();
  assert.throws(() => projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id,
    command, t.f.map.mapRange, null, 0), /riding host/);
  const providers = { ...t.f.input.providers, transportationPresentation: "framework-development" as const };
  const first = projectFieldScriptLerp(t.snapshot, providers, t.id, command, t.f.map.mapRange, null, 0);
  const last = projectFieldScriptLerp(first.snapshot, providers, t.id, command, t.f.map.mapRange, first.progress, 0.5);
  const after = last.snapshot.actors.find((a) => a.id === t.id)!;
  assert.equal(last.flow, "next"); assert.equal(after.riding, true); assert.equal(after.riderAssetId, 1);
  assert.equal(serial(t.snapshot), before);
});

test("Lerp layer increase applies view at start, decrease at completion, with no partial provider failure", () => {
  const t = native(), command = lerp({ layer: 3 });
  const up = projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, null, 0);
  let a = up.snapshot.actors.find((a) => a.id === t.id)!;
  assert.equal(a.layer, 11); assert.equal(a.position.z, 144); assert.equal(a.viewBinding!.layer, 11);
  const top = projectFieldScriptLerp(up.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, up.progress, 0.5);
  const down = projectFieldScriptLerp(top.snapshot, t.f.input.providers, t.id, lerp({ layer: 1 }), t.f.map.mapRange, null, 1);
  a = down.snapshot.actors.find((a) => a.id === t.id)!;
  assert.equal(a.layer, 11); assert.equal(a.position.z, 144);
  const end = projectFieldScriptLerp(down.snapshot, t.f.input.providers, t.id, lerp({ layer: 1 }), t.f.map.mapRange, down.progress, 1.5);
  a = end.snapshot.actors.find((a) => a.id === t.id)!;
  assert.equal(a.layer, 9); assert.equal(a.position.z, 349); assert.equal(a.viewBinding!.layer, 9);
  const before = serial(t.snapshot);
  assert.throws(() => projectFieldScriptLerp(t.snapshot, { ...t.f.input.providers, applyViewProperties: () => { throw new Error("missing-layer-provider"); } },
    t.id, command, t.f.map.mapRange, null, 0), /missing-layer-provider/);
  assert.equal(serial(t.snapshot), before);
});

test("unimplemented sprite arc, negative duration, missing animation and stale registers reject without a transform write", () => {
  const t = native(), before = serial(t.snapshot);
  for (const command of [lerp({ arcHeight: 2 }), lerp({ duration: -1 }), lerp({ animation: "Missing" })])
    assert.throws(() => projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id, command, t.f.map.mapRange, null, 0));
  const first = projectFieldScriptLerp(t.snapshot, t.f.input.providers, t.id, lerp(), t.f.map.mapRange, null, 3);
  assert.throws(() => projectFieldScriptLerp(first.snapshot, t.f.input.providers, t.id, lerp(), t.f.map.mapRange, first.progress, 2), /clock/);
  assert.equal(serial(t.snapshot), before);
});

test("source multi-cell route waits to drain, retains explicit-animation facing, then releases synchronous Join", () => {
  const t = runtime([move()]); t.game.field.startEvent(t.name);
  const actor = t.actor, nativeEntity = actor.native!.entity;
  assert.equal(actor.direction, "up"); assert.equal(actor.animation!.snapshot()!.key, "Default");
  assert.equal(t.game.field.eventState.read(flag), 0); assert.equal(t.game.field.checkpointReady, false);
  t.game.advance(240);
  assert.equal(actor.x, 4); assert.equal(actor.steps, 1); assert.ok(actor.motion);
  t.game.advance(10); assert.equal(actor.motion!.elapsed, 0);
  t.game.advance(240); assert.equal(actor.x, 5); assert.equal(actor.steps, 2);
  assert.ok(actor.motion); assert.equal(t.game.field.eventState.read(flag), 0);
  t.game.advance(20);
  assert.equal(t.game.field.stop, null); assert.equal(actor.motion, null); assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.field.actors[actor.id], actor); assert.equal(actor.native!.entity, nativeEntity);
});

test("zero-step Move waits one interpreter clock without changing the actor", () => {
  const t = runtime([move({ steps: 0 })]); t.game.field.startEvent(t.name);
  const before = { x: t.actor.x, y: t.actor.y, direction: t.actor.direction, animation: t.actor.animation!.snapshot() };
  assert.equal(t.actor.motion, null); assert.equal(t.game.field.eventState.read(flag), 0);
  t.game.advance(10); assert.equal(t.game.field.eventState.read(flag), 0);
  t.game.advance(10); assert.equal(t.game.field.eventState.read(flag), 1);
  assert.deepEqual({ x: t.actor.x, y: t.actor.y, direction: t.actor.direction, animation: t.actor.animation!.snapshot() }, before);
});

test("native Lerp follows the shared VM clock, leaves no motion/step duplicate, and cannot be saved mid-task", () => {
  const t = runtime([lerp()]); t.game.field.startEvent(t.name);
  const actor = t.actor, initialSteps = actor.steps;
  assert.equal(actor.motion, null); assert.equal(actor.native!.entity.moving, false);
  assert.equal(actor.native!.entity.position.z, 344); assert.equal(t.game.checkpointReady, false);
  t.game.advance(250); assert.equal(actor.x, 5); assert.equal(actor.y, 5);
  t.game.advance(270);
  assert.equal(t.game.field.stop, null); assert.equal(actor.x, 7); assert.equal(actor.y, 6);
  assert.equal(actor.native!.entity.position.z, 349); assert.equal(actor.steps, initialSteps);
  assert.equal(t.game.field.eventState.read(flag), 1);
});

test("missing animation blocks at the instruction without publishing position, playback or a completion flag", () => {
  for (const command of [move({ animation: "missing" }), lerp({ animation: "missing" })]) {
    const t = runtime([command], { wait: 0.03 }); t.game.field.startEvent(t.name);
    t.game.advance(20);
    const before = { position: { ...t.actor.native!.entity.position }, animation: t.actor.animation, playback: t.actor.animation!.snapshot(), motion: t.actor.motion };
    t.game.advance(10);
    assert.match(t.game.field.stop!.message, /animation/);
    assert.deepEqual(t.actor.native!.entity.position, before.position); assert.equal(t.actor.animation, before.animation);
    assert.deepEqual(t.actor.animation!.snapshot(), before.playback); assert.equal(t.actor.motion, before.motion);
    assert.equal(t.game.field.eventState.read(flag), 0);
  }
});

test("ChangeScript, map and battle handoffs cannot discard another task's active interpolation", () => {
  const transitions: Instruction<Op>[] = [
    { kind: "script-transition", targetScript: "callee", returnToCaller: false },
    { kind: "change-map", request: { mapId: 902, entrance: 1, continuation: null, birdview: false,
      skipFade: true, skipBgm: true, origin: "script" } },
    { kind: "encounter", party: 42, continuation: "callee" },
    { kind: "exit" },
  ];
  for (const camera of [false, true]) for (const transition of transitions) {
    const f = scriptMotionIntegrationFixture(), name = "interpolation_handoff";
    const values: Instruction<Op>[] = [
      { kind: "puppet", slot: 0, actor: camera ? "0" : "-1001", target: 5 },
      { kind: "exec-puppets", asynchronous: true }, { kind: "wait", seconds: 0.1 }, transition,
      { kind: "exit" }, { kind: "nop" },
      { kind: "field-script-motion", command: lerp({ duration: 1, animation: camera ? "" : "WalkR" }) }, { kind: "exit" },
    ];
    f.map.scripts[name] = values.map((op, index) => ({ ...op, script: name, index, source: f.map.map!.source }) as Op);
    f.map.scripts.callee = [{ kind: "nop", script: "callee", index: 0, source: f.map.map!.source },
      { kind: "exit", script: "callee", index: 1, source: f.map.map!.source }];
    for (const key of [name, "callee"]) {
      f.map.scriptPuppetContexts![key] = { ...f.map.scriptPuppetContexts!.reserved! };
      f.map.scriptLocals![key] = { labels: [], values: [] };
    }
    f.map.scriptTransitionMetadata = { [name]: { customAnimations: "none" }, callee: { customAnimations: "none" } };
    const game = launchScriptMotionIntegration(f); game.advance(10);
    game.field.startEvent(name);
    game.field.eventState.write({ category: "MessageSelection", index: 0 }, 1);
    game.advance(80);
    const owned = game.state.snapshot();
    game.advance(30);
    assert.equal(game.field.stop?.kind, "unsupported", `${camera}/${transition.kind}`);
    assert.match(game.field.stop!.message, /interpolation/);
    assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint());
    assert.deepEqual(game.state.snapshot(), owned);
    assert.equal(game.field.eventState.read({ category: "MessageSelection", index: 0 }), 1);
    assert.throws(() => game.field.prepareEncounterReturn(42), /interpolation/);
    assert.throws(() => game.field.previewMap(902, 1), /during an event/);
  }
});
