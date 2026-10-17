import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { canonical } from "../src/core/canonical.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint,
  type FieldNativeCheckpoint, type FieldNativeCheckpointContext, type FieldNativeActorMotionCheckpoint } from "../src/core/field-native-checkpoint.js";
import { createNativeFieldActorProjection, createNativeFieldActorProjections, type NativeFieldActor } from "../src/core/field-native-actors.js";
import { prepareFieldNativeNpcGroup } from "../src/core/field-native-npc.js";
import { prepareFieldActorMotionTick, prepareFieldScriptMove } from "../src/core/field-script-motion.js";
import { sourceNpcSecondsPerCell } from "../src/core/field-npc-activity.js";
import { compileFieldNativeNpc } from "../src/compiler/field-native-npc.js";
import type { Direction } from "../src/field/types.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

/** Controlled factory actors and explicitly trusted activity grants exercise
 * the codec boundary. They do not grant autonomous semantics to source Wait
 * definitions; activity/program admission is the containing Field's contract. */
function fixture(crop = false) {
  const f = fieldActorFactoryFixture(), candidate = createFieldActorFactoryCandidate(f.input);
  const mapRange = crop ? { ...f.map.mapRange, x: 4, y: 5 } : f.map.mapRange;
  const owner = Object.fromEntries(createNativeFieldActorProjections(candidate, mapRange, f.partyCatalog).map(actor => [actor.id, actor]));
  const context: FieldNativeCheckpointContext = { mapRange, bindings: candidate.bindings, factory: f.factory,
    partyCatalog: f.partyCatalog, partyCheckpoint: f.entry.checkpoint, characters: f.characters, npcs: [], providers: f.input.providers };
  return { ...f, owner, context, candidate, player: owner[candidate.bindings.player]! };
}
function addNpc(f: ReturnType<typeof fixture>, id: number) {
  const source = { file: "controlled-npc.bundle", assetPath: "Map/activity.json", objectId: "9007199254740997",
    pointer: `/layers/0/objects/${id}` };
  const definition = compileFieldNativeNpc({ group: "activity", object: { x: 80 + (id - 501) * 16, y: 96, width: 16, height: 16 },
    entity: { id: String(id), kind: 6, layer: 1, source }, properties: { entity_id: id, asset_id: 77,
      direction: 1, move_type: 0, turn_around: true, move_while_display_message: true },
    tables: { "mapobject.csv": [{ id: 77, asset_name: f.player.asset!, shadow_type: 1 }] } }).definition;
  assert.ok(definition);
  const prepared = prepareFieldNativeNpcGroup({ definitions: [definition], factory: f.factory, characters: f.characters,
    mapRange: f.context.mapRange, providers: f.input.providers, existingActorIds: Object.keys(f.owner) });
  const actor = createNativeFieldActorProjection(prepared.actors[0]!, f.context.mapRange, f.partyCatalog);
  f.owner[actor.id] = actor; f.context.npcs = [...f.context.npcs, definition];
  const definitionHash = createHash("sha256").update(canonical({ definition, policy: "controlled-one-cell-activity-v1" })).digest("hex");
  return { actor, definitionHash };
}
function move(f: ReturnType<typeof fixture>, npc: ReturnType<typeof addNpc>, direction: Direction,
  sourceSpeedEnum = 0, elapsed = 50, commandId = 1) {
  const from = { x: npc.actor.x, y: npc.actor.y }, delta = {
    up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 },
  }[direction];
  const secondsPerCell = sourceNpcSecondsPerCell(sourceSpeedEnum as Parameters<typeof sourceNpcSecondsPerCell>[0]);
  npc.actor.motion = { from, to: { x: from.x + delta.x, y: from.y + delta.y }, elapsed: 0,
    duration: secondsPerCell * 1000, manual: false };
  npc.actor.direction = direction; npc.actor.animation!.move(direction, secondsPerCell);
  if (elapsed) tick(npc.actor, elapsed);
  f.context.autonomousMotions = { ...f.context.autonomousMotions,
    [npc.actor.id]: { definitionHash: npc.definitionHash, sourceSpeedEnum, commandId, secondsPerCell } };
}
function tick(actor: NativeFieldActor, elapsed: number) {
  assert.ok(actor.motion);
  const next = prepareFieldActorMotionTick(actor.motion, actor.animation, elapsed);
  actor.x = next.point.x; actor.y = next.point.y; actor.motion = next.motion; actor.animation = next.animation;
  if (next.completedSegment) actor.steps++;
}
function movingRow(raw: FieldNativeCheckpoint, id: string): FieldNativeActorMotionCheckpoint {
  const row = raw.actors.find(row => row.id === id);
  assert.ok(row && "motion" in row);
  return row as FieldNativeActorMotionCheckpoint;
}
const copy = <T>(raw: T): T => structuredClone(raw);
const asOwner = (actors: NativeFieldActor[]) => Object.fromEntries(actors.map(actor => [actor.id, actor]));
const save = (f: ReturnType<typeof fixture>) => captureFieldNativeCheckpoint(f.owner, f.context);

test("idle native checkpoints retain v1 bytes and every idle row shape even with an empty activity-grant map", () => {
  const f = fixture(); addNpc(f, 501);
  const original = save(f);
  f.context.autonomousMotions = {};
  assert.deepEqual(save(f), original); assert.equal(original.kind, "native-field-actors-checkpoint-v1");
  assert.ok(original.actors.every(row => !Object.hasOwn(row, "motion")));
  assert.deepEqual(captureFieldNativeCheckpoint(asOwner(restoreFieldNativeCheckpoint(original, f.context)), f.context), original);
});

test("two authorized native NPC motions round-trip separate speeds and continue on the same actor registers", () => {
  const f = fixture(true), first = addNpc(f, 501), second = addNpc(f, 502);
  move(f, first, "right", 0, 50, 8); move(f, second, "down", 1, 230, 12);
  const raw = save(f), before = copy(raw), restored = asOwner(restoreFieldNativeCheckpoint(JSON.parse(JSON.stringify(raw)), f.context));
  assert.equal(raw.kind, "native-field-actors-checkpoint-v2");
  assert.ok(raw.actors.filter(row => row.id !== first.actor.id && row.id !== second.actor.id).every(row => !Object.hasOwn(row, "motion")));
  assert.deepEqual(Object.keys(movingRow(raw, first.actor.id).motion).sort(), ["commandId", "definitionHash", "state"]);
  for (const npc of [first, second]) {
    const actor = restored[npc.actor.id]!;
    assert.notEqual(actor, npc.actor); assert.notEqual(actor.native.entity, npc.actor.native.entity);
    assert.notEqual(actor.motion, npc.actor.motion); assert.deepEqual(actor.motion, npc.actor.motion);
    assert.equal(actor.native.entity.moving, true); assert.equal(actor.animation, actor.native.entity.animation);
    while (npc.actor.motion) {
      tick(npc.actor, 10); tick(actor, 10);
      assert.deepEqual(actor.motion, npc.actor.motion); assert.deepEqual(actor.native.entity.position, npc.actor.native.entity.position);
      assert.deepEqual(actor.animation!.snapshot(), npc.actor.animation!.snapshot());
      assert.equal(actor.steps, npc.actor.steps);
    }
    assert.equal(actor.native.entity.moving, false);
  }
  assert.deepEqual(raw, before, "Resumed movement cannot mutate the saved registers");
  f.context.autonomousMotions = {};
  assert.equal(captureFieldNativeCheckpoint(restored, f.context).kind, "native-field-actors-checkpoint-v1");
});

test("all nine NPC speed enums bind their shared durations without extending the Puppet Move ABI", () => {
  for (let speedId = 0; speedId < 9; speedId++) for (const direction of ["up", "right", "down", "left"] as const) {
    const f = fixture(), npc = addNpc(f, 501);
    move(f, npc, direction, speedId, 0);
    tick(npc.actor, Math.ceil(npc.actor.motion!.duration / 10) * 10 - 10);
    const raw = save(f), restored = asOwner(restoreFieldNativeCheckpoint(raw, f.context));
    assert.deepEqual(restored[npc.actor.id]!.motion, npc.actor.motion);
    tick(npc.actor, 10); tick(restored[npc.actor.id]!, 10);
    assert.equal(restored[npc.actor.id]!.motion, null);
    assert.deepEqual(restored[npc.actor.id]!.native.entity.position, npc.actor.native.entity.position);
    if (speedId > 6) assert.throws(() => prepareFieldScriptMove({ kind: "move", direction, steps: 1,
      speedId, animation: "" }, { x: 5, y: 5 }, { loop: { horizontal: false, vertical: false }, magnification: 1 }),
      /Invalid checkpoint number/, "An authorized NPC speed cannot grant a new Puppet Move operand");
  }
});

test("restore keeps elapsed playback and never invokes NPC Look, Cue or a random initializer", () => {
  const f = fixture(), npc = addNpc(f, 501); move(f, npc, "left", 3, 190);
  const raw = save(f), look = ActorAnimation.prototype.look, cue = ActorAnimation.prototype.cue, random = Math.random;
  // Pausing belongs to the outer field scheduler: omitting ticks preserves the
  // same motion register instead of resetting position or adding a paused copy.
  const liveMotion = npc.actor.motion, liveAnimation = npc.actor.animation;
  assert.deepEqual(save(f), raw);
  assert.equal(npc.actor.motion, liveMotion); assert.equal(npc.actor.animation, liveAnimation);
  const forbidden = () => { throw new Error("Controller initialization must not replay"); };
  ActorAnimation.prototype.look = forbidden; ActorAnimation.prototype.cue = forbidden; Math.random = forbidden;
  try {
    const restored = asOwner(restoreFieldNativeCheckpoint(raw, f.context));
    assert.deepEqual(captureFieldNativeCheckpoint(restored, f.context), raw);
    tick(restored[npc.actor.id]!, 10);
    assert.equal(restored[npc.actor.id]!.motion!.elapsed, 200);
  } finally { ActorAnimation.prototype.look = look; ActorAnimation.prototype.cue = cue; Math.random = random; }
});

test("actor rows cannot grant authority, replace command identity or reinterpret the trusted speed", () => {
  const f = fixture(), npc = addNpc(f, 501); move(f, npc, "right", 0, 50, 4);
  const raw = save(f), original = copy(raw), binding = f.context.autonomousMotions![npc.actor.id]!;
  for (const grant of [undefined, { ...binding, definitionHash: "f".repeat(64) }, { ...binding, commandId: 5 },
    { ...binding, sourceSpeedEnum: 1, secondsPerCell: sourceNpcSecondsPerCell(1) }]) {
    const context = { ...f.context, autonomousMotions: grant ? { [npc.actor.id]: grant } : {} };
    assert.throws(() => restoreFieldNativeCheckpoint(raw, context), /Unbound|authorization|binding|duration/);
  }
  for (const malformed of ["invalid", { ...binding, commandId: 0 }, { ...binding, sourceSpeedEnum: 9 },
    { ...binding, sourceSpeedEnum: -1 }, { ...binding, secondsPerCell: 0 }, { ...binding, secondsPerCell: .123 },
    { ...binding, definitionHash: "bad" }, { ...binding, extra: true }])
    assert.throws(() => restoreFieldNativeCheckpoint(raw, { ...f.context, autonomousMotions: { [npc.actor.id]: malformed } as never }));
  const withoutMotion = copy(raw); delete (withoutMotion.actors.find(row => row.id === npc.actor.id) as Partial<FieldNativeActorMotionCheckpoint>).motion;
  assert.throws(() => restoreFieldNativeCheckpoint(withoutMotion, f.context), /fields/);
  const downgraded = { ...raw, kind: "native-field-actors-checkpoint-v1" } as FieldNativeCheckpoint;
  assert.throws(() => restoreFieldNativeCheckpoint(downgraded, f.context), /authorization/);
  assert.deepEqual(raw, original); assert.deepEqual(save(f), original);
});

test("player, persistent residents, unknown actors and an unauthorized second event motion remain rejected", () => {
  const f = fixture(), npc = addNpc(f, 501); move(f, npc, "up");
  const grant = f.context.autonomousMotions![npc.actor.id]!, original = save(f);
  for (const id of [f.player.id, f.context.bindings.residents[0]!.actor, "unknown-npc"]) {
    assert.throws(() => save({ ...f, context: { ...f.context, autonomousMotions: { ...f.context.autonomousMotions, [id]: grant } } }), /NPC scope/);
  }
  const second = addNpc(f, 502); move(f, second, "left");
  f.context.autonomousMotions = { [npc.actor.id]: grant };
  const before = canonical({ first: npc.actor.motion, second: second.actor.motion, positions: Object.values(f.owner).map(actor => actor.native.entity.position) });
  assert.throws(() => save(f), /moving/);
  assert.equal(canonical({ first: npc.actor.motion, second: second.actor.motion, positions: Object.values(f.owner).map(actor => actor.native.entity.position) }), before);
  assert.deepEqual(movingRow(original, npc.actor.id).motion.state, npc.actor.motion);
  const falseMoving = { ...f.owner[npc.actor.id]!, native: { ...npc.actor.native, entity: { ...npc.actor.native.entity, moving: false } } };
  assert.throws(() => captureFieldNativeCheckpoint({ ...f.owner, [npc.actor.id]: falseMoving }, f.context), /moving/);
});

test("motion shape, numeric progress, cardinal destination and actual native pose must agree before restoration", () => {
  const f = fixture(), npc = addNpc(f, 501); move(f, npc, "right"); const raw = save(f), before = copy(raw);
  const invalid = [
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.manual = true; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.to.x += 1; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.to.y += 1; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.to = { ...row.motion.state.from }; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.elapsed = -10; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.elapsed = row.motion.state.duration; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.elapsed = 11; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.duration += 10; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.from.x = NaN; },
    (row: FieldNativeActorMotionCheckpoint) => { row.motion.state.route = { points: [{ ...row.motion.state.to }], index: 0,
      pendingSegment: false, direction: "right", animation: "", animationSecondsPerCell: 0.24 }; },
    (row: FieldNativeActorMotionCheckpoint) => { row.position.x += 16; },
    (row: FieldNativeActorMotionCheckpoint) => { row.position.z += 1; },
    (row: FieldNativeActorMotionCheckpoint) => { row.direction = "left"; },
    (row: FieldNativeActorMotionCheckpoint) => { row.layer = 9; },
    (row: FieldNativeActorMotionCheckpoint) => { Object.assign(row.motion, { speedId: 0 }); },
  ];
  for (const mutate of invalid) {
    const bad = copy(raw); mutate(movingRow(bad, npc.actor.id));
    assert.throws(() => restoreFieldNativeCheckpoint(bad, f.context));
    assert.deepEqual(save(f), before);
  }
  assert.deepEqual(raw, before);
});

test("late failure and motion accessors cannot partially change or invoke the live owner", () => {
  const f = fixture(), first = addNpc(f, 501), second = addNpc(f, 502);
  move(f, first, "right"); move(f, second, "down", 1, 90);
  const raw = save(f), before = copy(raw), invalid = copy(raw);
  movingRow(invalid, second.actor.id).animation!.key = "unloaded-source-pose";
  assert.throws(() => restoreFieldNativeCheckpoint(invalid, f.context), /Missing actor animation/);
  assert.deepEqual(save(f), before); assert.deepEqual(raw, before);
  const bad = copy(raw), row = movingRow(bad, second.actor.id); let reads = 0;
  Object.defineProperty(row.motion.state, "elapsed", { enumerable: true, get() { reads++; return 90; } });
  assert.throws(() => restoreFieldNativeCheckpoint(bad, f.context), /fields/); assert.equal(reads, 0);
  const badGrant = Object.create(null);
  Object.defineProperty(badGrant, second.actor.id, { enumerable: true, get() { reads++; return f.context.autonomousMotions![second.actor.id]; } });
  assert.throws(() => captureFieldNativeCheckpoint(f.owner, { ...f.context, autonomousMotions: badGrant }), /fields/);
  const badRows = copy(raw);
  Object.defineProperty(badRows.actors, "0", { enumerable: true, get() { reads++; return raw.actors[0]; } });
  assert.throws(() => restoreFieldNativeCheckpoint(badRows, f.context), /fields/);
  const sparse = copy(raw); delete sparse.actors[0];
  assert.throws(() => restoreFieldNativeCheckpoint(sparse, f.context), /fields/);
  assert.equal(reads, 0); assert.deepEqual(save(f), before);
});

test("fractional endpoints cannot masquerade as a source-planned single grid step", () => {
  const f = fixture(true), npc = addNpc(f, 501); move(f, npc, "right");
  const raw = save(f), before = copy(raw), bad = copy(raw), row = movingRow(bad, npc.actor.id);
  // This is a consistent half-cell translation of both native XY and motion.
  // A delta-only cardinal test would accept it, but this authorized
  // cardinal-grid policy requires actual integer-cell endpoints.
  row.motion.state.from.x += 0.5; row.motion.state.to.x += 0.5; row.position.x += 8;
  assert.throws(() => restoreFieldNativeCheckpoint(bad, f.context), /grid|integer|destination/);
  assert.deepEqual(save(f), before); assert.deepEqual(raw, before);

  npc.actor.motion!.from.x += 0.5; npc.actor.motion!.to.x += 0.5; npc.actor.x += 0.5;
  const actor = npc.actor, native = actor.native, entity = native.entity, motion = actor.motion, animation = actor.animation;
  const invalidBefore = canonical({ motion, position: entity.position, playback: animation!.snapshot() });
  assert.throws(() => save(f), /grid|integer|destination/);
  assert.equal(actor.native, native); assert.equal(native.entity, entity); assert.equal(actor.motion, motion);
  assert.equal(actor.animation, animation);
  assert.equal(canonical({ motion, position: entity.position, playback: animation!.snapshot() }), invalidBefore);
});

test("idle motion grants and motion-free v2 saves cannot create a pending command", () => {
  const f = fixture(), npc = addNpc(f, 501), raw = save(f);
  assert.throws(() => restoreFieldNativeCheckpoint({ ...raw, kind: "native-field-actors-checkpoint-v2" }, f.context), /authorization/);
  f.context.autonomousMotions = { [npc.actor.id]: { definitionHash: npc.definitionHash, sourceSpeedEnum: 0, commandId: 1, secondsPerCell: sourceNpcSecondsPerCell(0) } };
  const native = npc.actor.native, animation = npc.actor.animation;
  assert.throws(() => save(f), /moving/);
  assert.throws(() => restoreFieldNativeCheckpoint(raw, f.context), /authorization/);
  assert.equal(npc.actor.native, native); assert.equal(npc.actor.animation, animation); assert.equal(npc.actor.motion, null);
  f.context.autonomousMotions = {};
  assert.equal(JSON.stringify(save(f)), JSON.stringify(raw));
});
