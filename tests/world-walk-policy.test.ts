import assert from "node:assert/strict";
import test from "node:test";
import { EventState } from "../src/core/event-state.js";
import type { FieldGameOptions } from "../src/core/field.js";
import { GameSession } from "../src/core/game-session.js";
import { WalkEncounterState, type FrameworkWalkEncounterPolicy } from "../src/core/walk-encounters.js";
import { WorldSession } from "../src/core/world-session.js";
import type { WorldMapContent } from "../src/field/world.js";
import { walkEncounterFixture, walkHost } from "./fixtures/walk-encounter-game.js";

/** Synthetic legacy geometry with the real FieldGame/WorldSession and one
 * scheduler. The host counters expose preparation/publication, not game state. */
function fixture(returnPolicy: "same" | "changed" | "removed" = "same", query = true) {
  const f = walkEncounterFixture(20), scheduler = new WalkEncounterState(314);
  const back: WorldMapContent = structuredClone(f.target);
  back.mapId = 1; back.map!.identity!.mapId = 1; back.contentHash = "controlled-return-map";
  if (returnPolicy === "changed") back.walkEncounters!.id = "changed-visited-map";
  if (returnPolicy === "removed") delete back.walkEncounters;
  f.world.maps[1] = { ...f.world.maps[2]!, url: "/world/maps/1.json", contentHash: back.contentHash };
  const ports: FieldGameOptions = { walkEncounters: query ? scheduler : {
    prepareStep: (mapId, policy) => scheduler.prepareStep(mapId, policy),
  } };
  let preparations = 0, publications = 0;
  const world = new WorldSession(f.field, new EventState(), {
    current: ports,
    prepare: () => { preparations++; return { ports: {}, sealPublication: () => () => true, commit: () => { publications++; return true; } }; },
  });
  return { ...f, world, catalog: f.world, back, scheduler, ports,
    get preparations() { return preparations; }, get publications() { return publications; } };
}
function walk(world: WorldSession) {
  assert.equal(world.field.move("right"), true);
  world.field.advance(240);
  assert.equal(world.field.stop, null);
}
function enter(f: ReturnType<typeof fixture>, target: WorldMapContent) {
  f.world.field.previewMap(target.mapId, 1);
  const next = f.world.prepare(f.catalog, target);
  assert.equal(f.world.commit(next), true);
  return next;
}
const changed = (policy: FrameworkWalkEncounterPolicy): FrameworkWalkEncounterPolicy =>
  ({ ...structuredClone(policy), id: "other-declared-policy" });

test("changed or removed visited-map walking policy fails before any map candidate publication", () => {
  for (const mode of ["changed", "removed"] as const) {
    const f = fixture(mode);
    walk(f.world); enter(f, f.target); walk(f.world);
    const field = f.world.field, actor = field.player;
    field.previewMap(1, 1);
    const stop = field.stop, events = field.eventState.snapshot(), owned = f.scheduler.snapshot();
    const prepared = f.preparations, published = f.publications, transitions = structuredClone(f.world.transitions);
    assert.throws(() => f.world.prepare(f.catalog, f.back), /policy binding mismatch/);
    assert.equal(f.world.field, field); assert.equal(field.player, actor); assert.equal(field.stop, stop);
    assert.deepEqual(field.eventState.snapshot(), events);
    assert.deepEqual(f.scheduler.snapshot(), owned);
    assert.equal(f.preparations, prepared); assert.equal(f.publications, published);
    assert.deepEqual(f.world.transitions, transitions);
  }
});

test("same-policy revisit continues the saved map countdown and one shared random stream", () => {
  const f = fixture();
  walk(f.world); enter(f, f.target); walk(f.world); enter(f, f.back); walk(f.world);
  const saved = f.scheduler.snapshot();
  assert.equal(saved.kind, "framework-walk-encounter-state-v1");
  assert.equal(saved.completedSteps, 3); assert.equal(saved.encounters, 0);
  assert.deepEqual(saved.maps.map(map => [map.mapId, map.remainingSteps]), [[1, 18], [2, 19]]);
  assert.equal(f.publications, 2); assert.equal(f.world.checkpoint().location!.mapId, 1);
  const restored = new WalkEncounterState(314); restored.restore(saved);
  restored.assertPolicy(1, f.policy); restored.assertPolicy(2, f.policy);
  assert.deepEqual(restored.snapshot(), saved);
});

test("unused null query and unused-map preparation stay lazy without drawing or installing state", () => {
  const f = fixture();
  const empty = f.scheduler.snapshot();
  f.scheduler.assertPolicy(99, null); f.scheduler.assertPolicy(99, changed(f.policy));
  assert.deepEqual(f.scheduler.snapshot(), empty);
  f.target.walkEncounters = changed(f.policy);
  f.world.field.previewMap(2, 1);
  const cancelled = f.world.prepare(f.catalog, f.target);
  assert.deepEqual(f.scheduler.snapshot(), empty);
  f.world.discard(cancelled);
  assert.equal(f.world.commit(cancelled), false); assert.deepEqual(f.scheduler.snapshot(), empty);
  const next = f.world.prepare(f.catalog, f.target);
  assert.equal(f.world.commit(next), true); assert.deepEqual(f.scheduler.snapshot(), empty);
  walk(f.world);
  assert.equal(f.scheduler.snapshot().completedSteps, 1);
  assert.deepEqual(f.scheduler.snapshot().maps.map(map => [map.mapId, map.policy.id]), [[2, "other-declared-policy"]]);
});

test("a policy bound while host media is preparing is checked again before commit", () => {
  const f = fixture(), field = f.world.field;
  field.previewMap(2, 1);
  const request = field.stop, next = f.world.prepare(f.catalog, f.target);
  f.scheduler.prepareStep(2, changed(f.policy)).commitWith(() => {});
  const before = f.scheduler.snapshot(), events = field.eventState.snapshot();
  assert.throws(() => f.world.commit(next), /policy binding mismatch/);
  assert.equal(f.world.field, field); assert.equal(field.stop, request);
  assert.deepEqual(field.eventState.snapshot(), events); assert.deepEqual(f.scheduler.snapshot(), before);
  assert.equal(f.publications, 0); assert.deepEqual(f.world.transitions, []);
});

test("host mutation of the candidate policy cannot bypass the captured binding", () => {
  const f = fixture(), field = f.world.field;
  field.previewMap(2, 1);
  const next = f.world.prepare(f.catalog, f.target), before = f.scheduler.snapshot();
  next.field.content.walkEncounters!.minSteps++;
  assert.throws(() => f.world.commit(next), /candidate policy changed/);
  assert.equal(f.world.field, field); assert.equal(f.publications, 0);
  assert.deepEqual(f.scheduler.snapshot(), before); assert.deepEqual(f.world.transitions, []);
});

test("preparation captures map identity and policy rather than rereading the caller's later metadata", () => {
  const f = fixture(); f.world.field.previewMap(2, 1);
  const next = f.world.prepare(f.catalog, f.target), before = f.scheduler.snapshot();
  f.target.mapId = 1; f.target.walkEncounters!.id = "late-caller-change";
  assert.equal(f.world.commit(next), true); assert.deepEqual(f.scheduler.snapshot(), before);
  walk(f.world);
  assert.deepEqual(f.scheduler.snapshot().maps.map(map => [map.mapId, map.policy.id]), [[2, f.policy.id]]);
});

test("walking map admission requires the query while old nonwalking hosts remain compatible", () => {
  const f = fixture("same", false);
  f.world.field.previewMap(2, 1);
  assert.throws(() => f.world.prepare(f.catalog, f.target), /bound scheduler policy query/);
  assert.equal(f.preparations, 0); assert.equal(f.publications, 0);
  delete f.target.walkEncounters;
  const next = f.world.prepare(f.catalog, f.target);
  assert.equal(f.world.commit(next), true); assert.equal(f.publications, 1);
  assert.deepEqual(f.scheduler.snapshot().maps, []);
});

test("GameSession supplies the same read-only policy query on its published maps", () => {
  const f = walkEncounterFixture(20);
  f.flow.start(); f.flow.advance(0, walkHost);
  const initial = f.game.checkpoint();
  f.game.field.options.walkEncounters!.assertPolicy!(2, null);
  assert.deepEqual(f.game.checkpoint(), initial);
  f.game.field.previewMap(2, 1);
  const next = f.game.world.prepare(f.world, f.target);
  assert.equal(f.game.world.commit(next), true);
  f.flow.advance(0, walkHost);
  assert.equal(f.flow.move("right"), true); f.flow.advance(240, walkHost);
  const before = f.game.checkpoint();
  const query = f.game.field.options.walkEncounters!.assertPolicy!;
  assert.throws(() => query(2, changed(f.policy)), /policy binding mismatch/);
  assert.throws(() => query(2, null), /policy binding mismatch/);
  query(2, f.policy); assert.deepEqual(f.game.checkpoint(), before);
});

test("restore rejects a removed current-map policy but does not bind an unused nonwalking map", () => {
  const f = walkEncounterFixture(20);
  f.flow.start(); f.flow.advance(0, walkHost);
  assert.equal(f.flow.move("right"), true); f.flow.advance(240, walkHost);
  const initialSaved = f.game.checkpoint(), changedInitial = structuredClone(f.field);
  delete changedInitial.walkEncounters;
  assert.throws(() => GameSession.restore(initialSaved, changedInitial, f.battle), /policy binding mismatch/);
  f.game.field.previewMap(2, 1);
  assert.equal(f.game.world.commit(f.game.world.prepare(f.world, f.target)), true);
  f.flow.advance(0, walkHost);
  assert.equal(f.flow.move("right"), true); f.flow.advance(240, walkHost);
  const saved = f.game.checkpoint(), changedMap = structuredClone(f.target);
  delete changedMap.walkEncounters;
  assert.throws(() => GameSession.restore(saved, f.field, f.battle,
    { catalog: f.world, map: changedMap }), /policy binding mismatch/);
  const restored = GameSession.restore(saved, f.field, f.battle, { catalog: f.world, map: f.target });
  assert.deepEqual(restored.checkpoint(), saved);
  const unused = walkEncounterFixture(20), untouched = unused.game.checkpoint();
  const noPolicy = structuredClone(unused.field); delete noPolicy.walkEncounters;
  const legacy = GameSession.restore(untouched, noPolicy, unused.battle);
  assert.deepEqual(legacy.checkpoint(), untouched);
});
