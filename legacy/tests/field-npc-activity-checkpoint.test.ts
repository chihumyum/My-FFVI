import test from "node:test";
import assert from "node:assert/strict";
import {
  captureFieldNpcActivities, restoreFieldNpcActivities,
  type FieldNpcActivitiesCheckpoint, type FieldNpcActivityCheckpointRecord,
} from "../src/core/field-npc-activity-checkpoint.js";
import {
  acquireNpcActivity, completeNpcActivity, createNpcActivity, prepareNpcActivity,
  settleNpcActivity, sourceNpcSecondsPerCell,
  type FieldNpcActivityProgram, type FieldNpcActivityState,
} from "../src/core/field-npc-activity.js";
import { canonical } from "../src/core/canonical.js";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint,
  type FieldNativeCheckpointContext } from "../src/core/field-native-checkpoint.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createNativeFieldActorProjection, createNativeFieldActorProjections } from "../src/core/field-native-actors.js";
import { prepareFieldNativeNpcGroup } from "../src/core/field-native-npc.js";
import { prepareFieldActorMotionTick, type FieldActorMotion } from "../src/core/field-script-motion.js";
import { compileFieldNativeNpc } from "../src/compiler/field-native-npc.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function program(actorId = "501", generationHash = "a"): FieldNpcActivityProgram {
  return { policy: "framework-npc-area-v1", actorId, group: "activity", definitionHash: generationHash.repeat(64),
    moveArea: { x: -128, y: 128, width: 256, height: 256 }, layer: 1, updateAttribute: 2,
    sourceSpeedEnum: 7, baseIntervalMs: 100, moveSteps: 2, firstInterval: true };
}
function idle(def: FieldNpcActivityProgram, generation = 1): FieldNpcActivityState {
  return createNpcActivity(def, { generation, seed: 71, initialDelayMs: 30 });
}
function started(def: FieldNpcActivityProgram, generation = 1) {
  const current = idle(def, generation), input = { worldPosition: { x: 0, y: 0 }, direction: "down" as const,
    motionActive: false, dtMs: 1000, updateMask: 3,
    destinations: { up: { x: 0, y: 16 }, right: { x: 16, y: 0 }, down: { x: 0, y: -16 }, left: { x: -16, y: 0 } } };
  const proposal = prepareNpcActivity(def, current, input);
  assert.ok(proposal.intent);
  const result = settleNpcActivity(def, proposal, "started", current, input);
  assert.ok(result.ticket);
  const delta = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } }[proposal.intent.direction];
  const motion: FieldActorMotion = { from: { x: 5, y: 6 }, to: { x: 5 + delta.x, y: 6 + delta.y },
    elapsed: 50, duration: sourceNpcSecondsPerCell(def.sourceSpeedEnum) * 1000, manual: false };
  return { ...result, motion };
}
function row(def: FieldNpcActivityProgram, state: FieldNpcActivityState, motion: FieldActorMotion | null): FieldNpcActivityCheckpointRecord {
  return { program: def, state, actor: { motion } };
}
const clone = <T>(value: T): T => structuredClone(value);

test("mixed idle and paused pending controllers save detached metadata and restore only fresh tickets", () => {
  const a = program(), b = program("502", "b"), moving = started(a, 2), resting = idle(b, 8);
  const records = { [a.actorId]: row(a, moving.state, moving.motion), [b.actorId]: row(b, resting, null) };
  const before = canonical(records), saved = captureFieldNpcActivities(records);
  assert.deepEqual(captureFieldNpcActivities(records), saved, "A paused scheduler does not replace the motion register");
  assert.equal(canonical(records), before);
  assert.deepEqual(Object.keys(saved).sort(), ["activities", "kind"]);
  for (const checkpoint of Object.values(saved.activities)) {
    assert.deepEqual(Object.keys(checkpoint).sort(), ["kind", "state"]);
    for (const key of ["position", "motion", "program", "capability"]) assert.equal(Object.hasOwn(checkpoint.state, key), false);
  }
  const restored = restoreFieldNpcActivities({ [a.actorId]: a, [b.actorId]: b }, saved, { generation: 3 });
  assert.equal(restored.activities[a.actorId]!.state.generation, 3);
  assert.equal(restored.activities[b.actorId]!.state.generation, 9);
  const state = restored.activities[a.actorId]!.state;
  for (const key of ["waitMs", "rngState", "rngDraws", "remainingSteps", "direction", "commandId"] as const)
    assert.equal(state[key], moving.state[key]);
  assert.equal(state.pending!.commandId, moving.state.pending!.commandId);
  assert.ok(state.pending!.revision > moving.state.pending!.revision);
  assert.equal(restored.activities[b.actorId]!.ticket, null);
  assert.deepEqual(restored.autonomousMotions, { [a.actorId]: { definitionHash: a.definitionHash, sourceSpeedEnum: 7,
    commandId: moving.ticket!.commandId, secondsPerCell: sourceNpcSecondsPerCell(7) } });
  assert.throws(() => completeNpcActivity(a, state, moving.ticket!), /Stale/);
  assert.equal(completeNpcActivity(a, state, restored.activities[a.actorId]!.ticket!).remainingSteps, 1);
  saved.activities[a.actorId]!.state.rngState = 42;
  assert.equal(canonical(records), before); assert.notEqual(state.rngState, 42);
});

test("the exact active program domain is required; an explicitly empty domain creates no authorization", () => {
  const empty = captureFieldNpcActivities({});
  assert.deepEqual(empty, { kind: "field-npc-activities-checkpoint-v1", activities: {} });
  assert.deepEqual(restoreFieldNpcActivities({}, empty, { generation: 1 }), { activities: {}, autonomousMotions: {} });
  const a = program(), b = program("502", "b"), saved = captureFieldNpcActivities({ [a.actorId]: row(a, idle(a), null) });
  for (const definitions of [{}, { [a.actorId]: a, [b.actorId]: b }, { [b.actorId]: b }])
    assert.throws(() => restoreFieldNpcActivities(definitions, saved, { generation: 2 }), /domain/);
  assert.throws(() => restoreFieldNpcActivities({ [a.actorId]: a }, empty, { generation: 2 }), /domain/);
  assert.throws(() => restoreFieldNpcActivities({ alias: a }, saved, { generation: 2 }), /identity/);
  assert.throws(() => captureFieldNpcActivities({ alias: row(a, idle(a), null) }), /identity/);
});

test("a pending command cannot acquire missing, event, differently timed or differently directed motion", () => {
  const a = program(), pending = started(a), resting = idle(a);
  assert.throws(() => captureFieldNpcActivities({ [a.actorId]: row(a, pending.state, null) }), /disagree/);
  assert.throws(() => captureFieldNpcActivities({ [a.actorId]: row(a, resting, pending.motion) }), /disagree/);
  const invalid = [
    { ...pending.motion, manual: true }, { ...pending.motion, duration: 96 },
    { ...pending.motion, elapsed: 51 }, { ...pending.motion, elapsed: 100 },
    { ...pending.motion, to: { x: 5, y: 6 } },
    { ...pending.motion, from: pending.motion.to, to: pending.motion.from },
    { ...pending.motion, from: { x: 5.5, y: 6 } },
    { ...pending.motion, route: { points: [pending.motion.to], index: 0, pendingSegment: false,
      direction: pending.state.pending!.direction, animation: "", animationSecondsPerCell: .096 } },
  ];
  const before = clone(pending);
  for (const motion of invalid)
    assert.throws(() => captureFieldNpcActivities({ [a.actorId]: row(a, pending.state, motion) }));
  assert.deepEqual(pending, before);
  // Normal native Actor position accessors are neither invoked nor rejected.
  const actor = { motion: pending.motion };
  Object.defineProperty(actor, "x", { get() { throw new Error("Position accessor was read"); } });
  assert.doesNotThrow(() => captureFieldNpcActivities({ [a.actorId]: { program: a, state: pending.state, actor } }));
});

test("event-held state is rejected for both idle and moving controllers before saving or restoring", () => {
  const a = program(), pending = started(a);
  for (const [state, motion] of [[idle(a), null], [pending.state, pending.motion]] as const) {
    const held = acquireNpcActivity(a, state, "talk:1");
    assert.throws(() => captureFieldNpcActivities({ [a.actorId]: row(a, held.state, motion) }), /Event-held/);
    const saved: FieldNpcActivitiesCheckpoint = { kind: "field-npc-activities-checkpoint-v1",
      activities: { [a.actorId]: { kind: "field-npc-activity-checkpoint-v1", state: held.state } } };
    assert.throws(() => restoreFieldNpcActivities({ [a.actorId]: a }, saved, { generation: 2 }), /Event-held/);
    assert.deepEqual(held.state.pending, state.pending);
  }
});

test("strict saved identity, state and options reject late corruption without changing any input", () => {
  const a = program(), b = program("502", "b"), pending = started(a);
  const definitions = { [a.actorId]: a, [b.actorId]: b }, records = {
    [a.actorId]: row(a, pending.state, pending.motion), [b.actorId]: row(b, idle(b), null),
  };
  const saved = captureFieldNpcActivities(records), before = canonical({ definitions, records, saved });
  for (const mutate of [
    (bad: FieldNpcActivitiesCheckpoint) => { bad.activities[b.actorId]!.state.definitionHash = "f".repeat(64); },
    (bad: FieldNpcActivitiesCheckpoint) => { bad.activities[b.actorId]!.state.actorId = a.actorId; },
    (bad: FieldNpcActivitiesCheckpoint) => { bad.activities[b.actorId]!.state.rngState = 0; },
    (bad: FieldNpcActivitiesCheckpoint) => { Object.assign(bad.activities[b.actorId]!.state, { position: { x: 5, y: 6 } }); },
    (bad: FieldNpcActivitiesCheckpoint) => { Object.assign(bad.activities[b.actorId]!, { program: b }); },
  ]) {
    const bad = clone(saved); mutate(bad);
    assert.throws(() => restoreFieldNpcActivities(definitions, bad, { generation: 2 }));
    assert.equal(canonical({ definitions, records, saved }), before);
  }
  for (const options of [{ generation: 0 }, { generation: 1.5 }, { generation: Infinity },
    { generation: 2, init: true }])
    assert.throws(() => restoreFieldNpcActivities(definitions, saved, options));
  const overflow = clone(saved); overflow.activities[b.actorId]!.state.generation = Number.MAX_SAFE_INTEGER;
  assert.throws(() => restoreFieldNpcActivities(definitions, overflow, { generation: 2 }), /generation/);
  const revisionOverflow = clone(saved); revisionOverflow.activities[b.actorId]!.state.revision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => restoreFieldNpcActivities(definitions, revisionOverflow, { generation: 2 }), /integer/);
  assert.equal(canonical({ definitions, records, saved }), before);
});

test("dictionary and motion accessors cannot run during a private preparation", () => {
  const a = program(), pending = started(a), saved = captureFieldNpcActivities({ [a.actorId]: row(a, pending.state, pending.motion) });
  let reads = 0;
  const bad = clone(saved);
  Object.defineProperty(bad.activities, a.actorId, { enumerable: true, get() { reads++; return saved.activities[a.actorId]; } });
  assert.throws(() => restoreFieldNpcActivities({ [a.actorId]: a }, bad, { generation: 2 }), /fields/);
  const actor = Object.defineProperty({}, "motion", { get() { reads++; return pending.motion; } });
  assert.throws(() => captureFieldNpcActivities({ [a.actorId]: { program: a, state: pending.state,
    actor: actor as { motion: FieldActorMotion } } }), /motion register/);
  const records = { [a.actorId]: row(a, pending.state, pending.motion) };
  Object.defineProperty(records, "extra", { enumerable: true, get() { reads++; return records[a.actorId]; } });
  assert.throws(() => captureFieldNpcActivities(records), /fields/);
  assert.throws(() => restoreFieldNpcActivities({ [a.actorId]: a }, { ...saved, capability: true }, { generation: 2 }), /fields/);
  assert.equal(reads, 0);
});

test("activity metadata and native motion restore jointly with no initializer or new random draw", () => {
  // Synthetic factory/Wait definition supplies the real native actor owner.
  // The explicit trusted activity program is a controlled codec boundary, not
  // a claim that this source Wait NPC natively moves or has Unity RNG parity.
  const f = fieldActorFactoryFixture(), candidate = createFieldActorFactoryCandidate(f.input);
  const owners = Object.fromEntries(createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map(actor => [actor.id, actor]));
  const definition = compileFieldNativeNpc({ group: "activity", object: { x: 80, y: 96, width: 16, height: 16 },
    entity: { id: "501", kind: 6, layer: 1, source: { file: "synthetic-npc", assetPath: "Map/activity.json",
      objectId: "9007199254740997", pointer: "/layers/0/objects/501" } },
    properties: { entity_id: 501, asset_id: 77, direction: 1, move_type: 0, turn_around: true,
      move_while_display_message: true }, tables: { "mapobject.csv": [{ id: 77,
        asset_name: owners[candidate.bindings.player]!.asset!, shadow_type: 1 }] } }).definition;
  assert.ok(definition);
  const group = prepareFieldNativeNpcGroup({ definitions: [definition], factory: f.factory,
    characters: f.characters, mapRange: f.map.mapRange, providers: f.input.providers,
    existingActorIds: Object.keys(owners) });
  const actor = createNativeFieldActorProjection(group.actors[0]!, f.map.mapRange, f.partyCatalog);
  owners[actor.id] = actor;
  const def = program(actor.id), pending = started(def), from = { x: actor.x, y: actor.y };
  actor.motion = { ...pending.motion, elapsed: 0, from,
    to: { x: from.x + pending.motion.to.x - pending.motion.from.x,
      y: from.y + pending.motion.to.y - pending.motion.from.y } };
  actor.direction = pending.state.pending!.direction;
  actor.animation!.move(actor.direction, sourceNpcSecondsPerCell(def.sourceSpeedEnum));
  const next = prepareFieldActorMotionTick(actor.motion, actor.animation, 50);
  actor.x = next.point.x; actor.y = next.point.y; actor.motion = next.motion; actor.animation = next.animation;
  const metadata = captureFieldNpcActivities({ [actor.id]: row(def, pending.state, actor.motion) });
  const restored = restoreFieldNpcActivities({ [actor.id]: def }, metadata, { generation: 2 });
  const context: FieldNativeCheckpointContext = { mapRange: f.map.mapRange, bindings: candidate.bindings,
    factory: f.factory, partyCatalog: f.partyCatalog, partyCheckpoint: f.entry.checkpoint,
    characters: f.characters, npcs: [definition], providers: f.input.providers,
    autonomousMotions: restored.autonomousMotions };
  const native = captureFieldNativeCheckpoint(owners, context), before = canonical({ metadata, native, state: pending.state });
  const look = ActorAnimation.prototype.look, cue = ActorAnimation.prototype.cue, random = Math.random;
  const forbidden = () => { throw new Error("Restore must not initialize or draw random"); };
  ActorAnimation.prototype.look = forbidden; ActorAnimation.prototype.cue = forbidden; Math.random = forbidden;
  try {
    const again = restoreFieldNpcActivities({ [actor.id]: def }, metadata, { generation: 5 });
    const actors = restoreFieldNativeCheckpoint(native, { ...context, autonomousMotions: again.autonomousMotions });
    const resumed = actors.find(value => value.id === actor.id)!;
    assert.deepEqual(resumed.motion, actor.motion); assert.equal(resumed.animation, resumed.native.entity.animation);
    assert.equal(again.activities[actor.id]!.state.rngState, pending.state.rngState);
    assert.equal(again.activities[actor.id]!.state.rngDraws, pending.state.rngDraws);
    const tick = prepareFieldActorMotionTick(resumed.motion!, resumed.animation, 50);
    assert.equal(tick.motion, null);
    assert.equal(completeNpcActivity(def, again.activities[actor.id]!.state, again.activities[actor.id]!.ticket!).remainingSteps, 1);
    const faster = { ...def, sourceSpeedEnum: 8 as const };
    const wrongTiming = restoreFieldNpcActivities({ [actor.id]: faster }, metadata, { generation: 5 });
    assert.throws(() => restoreFieldNativeCheckpoint(native, { ...context, autonomousMotions: wrongTiming.autonomousMotions }), /duration/);
    // Each codec alone accepts a valid direction in its own domain. The final
    // Field joint check must correlate the saved pending with this exact actor.
    const opposite = { up: "down", right: "left", down: "up", left: "right" } as const;
    const changedDirection = clone(metadata), changedState = changedDirection.activities[actor.id]!.state;
    changedState.direction = changedState.pending!.direction = opposite[changedState.pending!.direction];
    const inconsistent = restoreFieldNpcActivities({ [actor.id]: def }, changedDirection, { generation: 5 });
    const privateActors = restoreFieldNativeCheckpoint(native, { ...context, autonomousMotions: inconsistent.autonomousMotions });
    const privateNpc = privateActors.find(value => value.id === actor.id)!;
    assert.throws(() => captureFieldNpcActivities({ [actor.id]: row(def,
      inconsistent.activities[actor.id]!.state, privateNpc.motion) }), /cardinal command/);
    assert.equal(canonical({ metadata, native, state: pending.state }), before);
  } finally {
    ActorAnimation.prototype.look = look; ActorAnimation.prototype.cue = cue; Math.random = random;
  }
});
