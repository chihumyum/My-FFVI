import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame, type FieldGameOptions, type Stop } from "../src/core/field.js";
import { WalkEncounterState, type FrameworkWalkEncounterPolicy } from "../src/core/walk-encounters.js";
import type { Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";

const policy = (): FrameworkWalkEncounterPolicy => ({ kind: "framework-walk-encounters-v1",
  id: "controlled-field-walk", minSteps: 1, maxSteps: 1,
  transportationIds: [1], parties: [{ partyId: 1000, weight: 1 }] });
const emptyStep = { members: [], damage: [], soundId: null };
function setup(options: FieldGameOptions = {}) {
  const fixture = checkpointFixture(), scheduler = new WalkEncounterState(314), content = fixture.field;
  content.entry.transportationId = 1;
  content.walkEncounters = policy();
  content.map.entities = [];
  content.map.groups!.entity_default!.entities = [];
  const field = new FieldGame(content, undefined, undefined, undefined, {
    walkEncounters: scheduler, ...options,
  });
  return { fixture, content, field, scheduler };
}
function command(field: FieldGame, name: string, values: Record<string, unknown>[]): Op[] {
  return values.map((value, index) => ({ ...value, script: name, index, source: field.content.map.source }) as Op);
}
function ordinaryStop(field: FieldGame) {
  field.stop = { kind: "encounter", party: 1000, returnTo: { kind: "field-idle" }, site: null, message: "Controlled ordinary encounter" };
}
function fieldState(field: FieldGame) {
  return structuredClone({ event: field.eventState.snapshot(), native: field.nativeActorStateFingerprint,
    camera: field.cameraSnapshot, party: field.partyActorCheckpoint,
    actors: Object.values(field.actors).map(actor => ({ id: actor.id, x: actor.x, y: actor.y,
      layer: actor.layer, direction: actor.direction, asset: actor.asset, mount: actor.mount,
      steps: actor.steps, motion: actor.motion, animation: actor.animation?.snapshot() ?? null })),
    stop: field.stop, time: field.time, busy: field.busy });
}

test("manual completion commits one choice and emits an idle return without a script", () => {
  const { field, scheduler } = setup(), before = scheduler.snapshot(), actor = field.player;
  assert.equal(field.move("right"), true);
  field.advance(230);
  assert.deepEqual(scheduler.snapshot(), before);
  assert.equal(field.player.steps, 0); assert.equal(field.stop, null);
  field.advance(10);
  assert.equal(field.player, actor);
  assert.deepEqual([actor.x, actor.y, actor.steps], [2, 1, 1]);
  assert.equal(scheduler.snapshot().completedSteps, 1);
  assert.equal(scheduler.snapshot().encounters, 1);
  assert.deepEqual(field.stop, { kind: "encounter", party: 1000, returnTo: { kind: "field-idle" },
    site: null, message: "普通步行遭遇" });
  field.advance(60000);
  assert.equal(scheduler.snapshot().completedSteps, 1);
});

test("no policy, excluded transport, and scripted movement do not allocate walking state", () => {
  for (const mode of ["absent", "transport", "script"] as const) {
    const { field, scheduler } = setup(), before = scheduler.snapshot();
    if (mode === "absent") delete field.content.walkEncounters;
    if (mode === "transport") field.content.walkEncounters!.transportationIds = [2];
    if (mode === "script") {
      field.content.scripts.walk = command(field, "walk", [
        { kind: "move", direction: "right", steps: 1, secondsPerCell: 0.24 }, { kind: "exit" },
      ]);
      assert.equal(field.startEvent("walk"), true);
    } else assert.equal(field.move("right"), true);
    field.advance(250);
    assert.equal(field.player.x, 2); assert.equal(field.stop, null);
    assert.deepEqual(scheduler.snapshot(), before, mode);
  }
});

test("closed doors and collision refusals never prepare an encounter", () => {
  const f = checkpointFixture(), scheduler = new WalkEncounterState(1);
  f.field.walkEncounters = policy(); f.field.entry.transportationId = 1;
  let preparations = 0;
  const field = new FieldGame(f.field, undefined, undefined, undefined, {
    walkEncounters: { prepareStep: (...args) => { preparations++; return scheduler.prepareStep(...args); } },
  });
  assert.equal(field.move("right"), false, "touching the closed door starts its own action");
  assert.equal(preparations, 0); field.advance(240);
  field.player.x = 0;
  assert.equal(field.move("left"), false);
  assert.equal(preparations, 0); assert.equal(scheduler.snapshot().completedSteps, 0);
});

test("an explicit eligible policy requires a known map, transport, and scheduler before movement", () => {
  for (const missing of ["transport", "scheduler", "map"] as const) {
    const f = checkpointFixture(), scheduler = new WalkEncounterState(7);
    f.field.walkEncounters = policy(); f.field.map.entities = [];
    f.field.map.groups!.entity_default!.entities = [];
    if (missing !== "transport") f.field.entry.transportationId = 1;
    if (missing === "map") delete f.field.map.identity;
    const field = new FieldGame(f.field, undefined, undefined, undefined,
      missing === "scheduler" ? {} : { walkEncounters: scheduler });
    assert.equal(field.move("right"), false);
    assert.equal(field.player.motion, null); assert.equal(field.player.steps, 0);
    assert.equal(scheduler.snapshot().completedSteps, 0);
    assert.equal(field.stop?.kind, "unsupported");
  }
});

test("a failed owned step leaves scheduler, movement endpoint, and destination event unpublished", () => {
  let commits = 0;
  const { field, scheduler } = setup({ fieldSteps: { prepareStep: () => ({ result: emptyStep,
    commit: () => { commits++; throw new Error("Controlled stale owned step"); } }) } });
  const before = scheduler.snapshot();
  assert.equal(field.move("right"), true); field.advance(230);
  const actor = structuredClone({ x: field.player.x, y: field.player.y, motion: field.player.motion,
    animation: field.player.animation?.snapshot(), steps: field.player.steps });
  field.advance(10);
  assert.equal(commits, 1); assert.match(field.stop!.message, /stale owned step/);
  assert.deepEqual(scheduler.snapshot(), before);
  assert.deepEqual({ x: field.player.x, y: field.player.y, motion: field.player.motion,
    animation: field.player.animation?.snapshot(), steps: field.player.steps }, actor);
});

test("a stale encounter candidate fails before publishing the owned step", () => {
  let commits = 0;
  const { field, scheduler } = setup({ fieldSteps: { prepareStep: () => ({ result: emptyStep,
    commit: () => { commits++; } }) } });
  assert.equal(field.move("right"), true);
  scheduler.prepareStep(1, policy()).commitWith(() => {});
  const changed = scheduler.snapshot(); field.advance(240);
  assert.match(field.stop!.message, /Stale walk encounter candidate/);
  assert.equal(commits, 0); assert.equal(field.player.x, 1); assert.equal(field.player.steps, 0);
  assert.deepEqual(scheduler.snapshot(), changed);
});

test("destination scripts consume the roll but take priority even when they finish immediately", () => {
  for (const waits of [false, true]) {
    const f = checkpointFixture(), scheduler = new WalkEncounterState(8), content = f.field;
    content.walkEncounters = policy(); content.entry.transportationId = 1;
    const fieldScript = waits ? [{ kind: "wait", seconds: 0.1 }, { kind: "exit" }]
      : [{ kind: "flag", ref: { category: "ScenarioFlag1", index: 50 }, operation: "set" }, { kind: "exit" }];
    content.scripts.destination = fieldScript.map((value, index) => ({ ...value, script: "destination", index,
      source: content.map.source }) as Op);
    const { openTrigger: _, ...entity } = content.map.entities[0]!;
    const trigger = { ...entity, kind: 2, id: "destination",
      script: "destination", x: 2, y: 1 };
    content.map.entities = [trigger]; content.map.groups!.entity_default!.entities = [trigger];
    const field = new FieldGame(content, undefined, undefined, undefined, { walkEncounters: scheduler });
    assert.equal(field.move("right"), true); field.advance(240);
    assert.equal(scheduler.snapshot().encounters, 1); assert.equal(field.stop, null);
    if (!waits) assert.equal(field.eventState.read({ category: "ScenarioFlag1", index: 50 }), 1);
    field.advance(1000);
    assert.equal(field.stop, null); assert.equal(field.busy, false);
    assert.equal(field.move("left"), true); field.advance(240);
    assert.equal((field.stop as Stop | null)?.kind, "encounter"); assert.equal(scheduler.snapshot().encounters, 2);
  }
});

test("a destination map transition takes priority without deferring its walking battle", () => {
  const f = checkpointFixture(), scheduler = new WalkEncounterState(9);
  f.field.walkEncounters = policy(); f.field.entry.transportationId = 1;
  const trigger = { ...f.field.map.entities[0]!, kind: 3, id: "leave", x: 2, y: 1,
    destination: { mapId: 2, entrance: 1 } };
  delete trigger.openTrigger;
  f.field.map.entities = [trigger]; f.field.map.groups!.entity_default!.entities = [trigger];
  const field = new FieldGame(f.field, undefined, undefined, undefined, { walkEncounters: scheduler });
  assert.equal(field.move("right"), true); field.advance(240);
  assert.equal(field.stop?.kind, "map-transition"); assert.equal(scheduler.snapshot().encounters, 1);
});

test("idle return preserves the field, events, finished tasks and actor identities, without executing scripts", () => {
  const { field } = setup();
  field.content.scripts.prior = command(field, "prior", [
    { kind: "flag", ref: { category: "ScenarioFlag1", index: 51 }, operation: "flip" }, { kind: "exit" },
  ]);
  field.eventState.write({ category: "ScenarioFlag1", index: 51 }, 0);
  field.startEvent("prior");
  const before = field.checkpoint(), owner = field.actors, actor = field.player;
  ordinaryStop(field);
  const prepared = field.prepareEncounterReturn(1000);
  let commits = 0; prepared.commitWith(() => { commits++; });
  assert.equal(commits, 1); assert.equal(field.stop, null); assert.equal(field.checkpointReady, true);
  assert.equal(field.actors, owner); assert.equal(field.player, actor);
  assert.deepEqual(field.checkpoint(), before);
  assert.throws(() => prepared.commitWith(() => { commits++; }), /Stale/);
  assert.equal(commits, 1); field.advance(10);
  assert.equal(field.eventState.read({ category: "ScenarioFlag1", index: 51 }), 1);
});

test("idle return rejects stale events and owned refusal without clearing the request", () => {
  const { field } = setup(); ordinaryStop(field);
  const stale = field.prepareEncounterReturn(1000);
  field.eventState.write({ category: "ScenarioFlag1", index: 52 }, 1);
  let commits = 0;
  assert.throws(() => stale.commitWith(() => { commits++; }), /Stale/);
  assert.equal(commits, 0); const before = fieldState(field);
  const failed = field.prepareEncounterReturn(1000);
  assert.throws(() => failed.commitWith(() => { throw new Error("Owned publication refused"); }), /refused/);
  assert.deepEqual(fieldState(field), before); assert.throws(failed, /Stale/);
  field.prepareEncounterReturn(1000)(); assert.equal(field.stop, null);
});

test("an idle target cannot silently override an event continuation or an active script", () => {
  const { field } = setup(); ordinaryStop(field);
  if (field.stop?.kind !== "encounter") assert.fail();
  field.stop.continuation = "after";
  assert.throws(() => field.prepareEncounterReturn(1000), /return target/);
  field.stop = null;
  field.content.scripts.waiting = command(field, "waiting", [{ kind: "wait", seconds: 1 }, { kind: "exit" }]);
  field.startEvent("waiting"); ordinaryStop(field);
  assert.throws(() => field.prepareEncounterReturn(1000), /suspended idle field/);
});

test("native idle return refreshes prepared appearance without replacing any actor or rereading the new roster", () => {
  const session = characterLearningSessionFixture().make(), field = session.field;
  assert.equal(field.menuReady, true);
  const before = fieldState(field), owner = field.actors;
  const identities = Object.values(owner).map(actor => ({ actor, native: actor.native, entity: actor.native!.entity }));
  ordinaryStop(field);
  const appearance = field.options.partyAppearance!, current = appearance.current, catalog = appearance.catalog;
  let rejectProvider = false;
  Object.defineProperty(appearance, "catalog", { configurable: true, get: () => {
    if (rejectProvider) throw new Error("Appearance provider read after owned publication");
    return catalog;
  } });
  let reads = 0, commits = 0;
  const prepared = field.prepareEncounterReturn(1000, () => { reads++; return {
    puppetRoster: field.options.puppetRoster!.current(), partyAppearance: current(),
  }; });
  prepared.validate();
  try {
    prepared.commitWith(() => { commits++; rejectProvider = true;
      appearance.current = () => { throw new Error("Roster read after publication"); }; });
  } finally {
    appearance.current = current;
    Object.defineProperty(appearance, "catalog", { configurable: true, writable: true, value: catalog });
  }
  assert.equal(reads, 1); assert.equal(commits, 1); assert.equal(field.actors, owner);
  for (const identity of identities) {
    assert.equal(owner[identity.actor.id], identity.actor);
    assert.equal(identity.actor.native, identity.native); assert.equal(identity.native!.entity, identity.entity);
  }
  assert.equal(field.stop, null); assert.equal(field.checkpointReady, true);
  assert.deepEqual(field.eventState.snapshot(), before.event);
  assert.deepEqual(fieldState(field).actors.map(({ id, x, y, direction }) => ({ id, x, y, direction })),
    before.actors.map(({ id, x, y, direction }) => ({ id, x, y, direction })));
  assert.deepEqual(field.cameraSnapshot, before.camera);
});

test("native idle return missing media or candidate appearance fails before any owned commit", () => {
  const session = characterLearningSessionFixture().make(), field = session.field;
  ordinaryStop(field); const before = fieldState(field);
  assert.throws(() => field.prepareEncounterReturn(1000), /candidate owned-state appearance/);
  assert.throws(() => field.prepareEncounterReturn(1000, () => ({
    puppetRoster: field.options.puppetRoster!.current(), partyAppearance: null,
  })), /candidate party appearance/);
  delete field.content.characters[field.player.asset!];
  assert.throws(() => field.prepareEncounterReturn(1000, () => ({
    puppetRoster: field.options.puppetRoster!.current(), partyAppearance: field.options.partyAppearance!.current(),
  })), /media|character|asset/i);
  assert.deepEqual(fieldState(field), before);
});

test("a changed native appearance provider rejects idle return before rewards are published", () => {
  const session = characterLearningSessionFixture().make(), field = session.field;
  ordinaryStop(field);
  const prepared = field.prepareEncounterReturn(1000, () => ({
    puppetRoster: field.options.puppetRoster!.current(), partyAppearance: field.options.partyAppearance!.current(),
  }));
  const before = fieldState(field), appearance = field.options.partyAppearance!, catalog = appearance.catalog;
  let commits = 0;
  Object.defineProperty(appearance, "catalog", { configurable: true, get: () => {
    throw new Error("Controlled native appearance provider unavailable");
  } });
  try {
    assert.throws(() => prepared.commitWith(() => { commits++; }), /provider unavailable/);
  } finally {
    Object.defineProperty(appearance, "catalog", { configurable: true, writable: true, value: catalog });
  }
  assert.equal(commits, 0); assert.deepEqual(fieldState(field), before);
});

test("native manual movement uses the same step boundary and does not consume a stale owned step", () => {
  const session = characterLearningSessionFixture().make(), field = session.field;
  field.content.walkEncounters = { ...policy(), transportationIds: [field.transportationId!] };
  const scheduler = new WalkEncounterState(10); field.options.walkEncounters = scheduler;
  let commits = 0;
  field.options.fieldSteps = { prepareStep: () => ({ result: emptyStep,
    commit: () => { commits++; throw new Error("Controlled native owned refusal"); } }) };
  const owner = field.player, before = scheduler.snapshot();
  assert.equal(field.move("right"), true); field.advance(230);
  const point = { x: owner.x, y: owner.y }, animation = owner.animation!.snapshot();
  field.advance(10);
  assert.equal(commits, 1); assert.match(field.stop!.message, /native owned refusal/);
  assert.deepEqual({ x: owner.x, y: owner.y }, point);
  assert.deepEqual(owner.animation!.snapshot(), animation);
  assert.equal(owner.motion!.elapsed, 230); assert.equal(owner.steps, 0);
  assert.deepEqual(scheduler.snapshot(), before);
});
