import test from "node:test";
import assert from "node:assert/strict";
import { birdViewActorsFixture, birdHost, birdReached } from "./fixtures/bird-view-actors.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameFlow } from "../src/core/game-flow.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
const puppet = "native:puppet:0";
test("actual PuppetCore height-only first clock yields, changes no logical coordinates and completes at the next clock", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
  assert(field.startEvent("bird-instant"));
  const actor = field.actors[puppet]!, native = actor.native!.entity, ground = { ...native.position }, camera = field.cameraSnapshot;
  assert.equal(actor.birdView?.height, 0); assert.equal(field.birdViewActorElevation(puppet), 0);
  assert.equal(game.checkpointReady, false); assert.equal(field.eventState.read(birdReached), 0);
  flow.advance(10, birdHost);
  assert.equal(field.birdViewActorElevation(puppet), 60); assert.equal(field.eventState.read(birdReached), 0);
  assert.deepEqual(field.cameraSnapshot, camera);
  // MainCore observes the finished PuppetCore on the following shared clock.
  flow.advance(10, birdHost); assert.equal(field.eventState.read(birdReached), 1);
  assert.equal(actor.native!.entity, native); assert.deepEqual(native.position, ground);
  assert.equal(field.cameraSnapshot!.target, "player"); // Existing FinishPuppet owns this target restoration.
  assert.equal(actor.motion, null); assert.equal(game.checkpointReady, true);
});
test("height interpolation and ordinary route use one Field clock; pause and duration do not complete movement early", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
  assert(field.startEvent("bird-move")); const actor = field.actors[puppet]!, start = { x: actor.x, y: actor.y }, motion = actor.motion;
  assert(motion?.route); assert.equal(motion.duration, 240); assert.equal(actor.birdView!.height, 0);
  flow.pause(true); flow.advance(200, birdHost); assert.equal(actor.birdView!.height, 0); assert.equal(actor.motion, motion);
  flow.pause(false); flow.advance(150, birdHost); assert.equal(actor.birdView!.height, 45); assert(actor.motion);
  flow.advance(150, birdHost); assert.equal(actor.birdView!.height, 90); assert(actor.motion); assert.equal(field.eventState.read(birdReached), 0);
  flow.advance(210, birdHost); assert.equal(actor.motion, null); assert.equal(field.eventState.read(birdReached), 1);
  assert.equal(actor.x, start.x + 2); assert.equal(actor.y, start.y); assert.equal(field.birdViewActorElevation(puppet), 90);
});
test("independent actors and same-actor arbitration retain the original movement failures before any height publication", async () => {
  const f = await birdViewActorsFixture();
  for (const name of ["bird-missing-animation", "bird-camera", "bird-conflict"] as const) {
    const { game, flow } = await f.make(), field = game.field, owned = game.state.snapshot();
    assert(field.startEvent(name)); flow.advance(50, birdHost); assert.equal(field.stop?.kind, "unsupported", name);
    assert.equal(field.eventState.read(birdReached), 0); assert.deepEqual(game.state.snapshot(), owned);
    if (name !== "bird-conflict") { assert.equal(field.actors[puppet]!.birdView, undefined); assert.equal(field.actors[puppet]!.motion, null); }
    assert.equal(field.stop!.site?.source.file, "tests/fixtures/bird-view-actors.ts");
  }
});
test("content and runtime both authorize the component; actual source actors are never inferred from camera or unknown bindings", async () => {
  for (const contentPolicy of [true, false]) {
    const f = await birdViewActorsFixture({ contentPolicy }), { game, flow } = await f.make(contentPolicy ? {} : f.runtime);
    assert(game.field.startEvent("bird-up")); flow.advance(20, birdHost);
    assert.equal(game.field.stop?.kind, "unsupported"); assert.equal(game.field.actors[puppet]!.birdView, undefined);
    assert.equal(game.field.eventState.read(birdReached), 0);
  }
});
test("stable Storage restores numeric pose on a new actual actor and rejects capability injection or unknown identities", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(); assert(game.field.startEvent("bird-up")); flow.advance(510, birdHost);
  assert.equal(game.field.birdViewActorElevation(puppet), 120); const saved = game.checkpoint();
  const bytes = new Map<string, string>(), store = new CheckpointStorage({ getItem: k => bytes.get(k) ?? null, setItem: (k, v) => { bytes.set(k, v); } });
  const failure = new CheckpointStorage({ getItem: () => null, setItem: () => { throw new Error("Controlled quota failure"); } });
  assert.throws((await failure.prepareSave(saved, 1)).commit, /quota/); assert.deepEqual(game.checkpoint(), saved);
  (await store.prepareSave(saved, 1)).commit(); const loaded = await store.load(); assert(loaded);
  const restored = f.restore(loaded.checkpoint); assert.notEqual(restored.field.actors[puppet], game.field.actors[puppet]);
  assert.deepEqual(restored.checkpoint(), saved); assert.equal(restored.field.birdViewActorElevation(puppet), 120);
  assert.throws(() => f.restore(saved, { battleHandoff: "prepared" }), /BirdView|policy/);
  for (const change of ["unknown", "policy", "number", "duplicate"] as const) {
    const malformed = structuredClone(saved), poses = malformed.world.field.native!.birdViewActors!;
    if (change === "unknown") poses.poses[0]!.actorId = "unknown-original-actor";
    if (change === "policy") Reflect.set(poses, "policy", "forged");
    if (change === "number") poses.poses[0]!.height = .1;
    if (change === "duplicate") poses.poses.push(structuredClone(poses.poses[0]!));
    assert.throws(() => f.restore(malformed), /BirdView|checkpoint/);
  }
  const rflow = new GameFlow(restored); rflow.start(restored); rflow.observeHost(birdHost);
  assert(restored.field.startEvent("bird-down")); rflow.advance(110, birdHost); assert.equal(restored.field.birdViewActorElevation(puppet), 0);
});
test("active height tasks reject stable checkpoints and actor replacement stops the original PC rather than writing another instance", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
  assert(field.startEvent("bird-up")); flow.advance(100, birdHost); assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint());
  const actor = field.actors[puppet]!, height = actor.birdView!.height;
  field.actors[puppet] = { ...actor }; flow.advance(10, birdHost);
  assert.equal(field.stop?.kind, "unsupported"); assert.match(field.stop!.message, /actual actor instance/);
  assert.equal(actor.birdView!.height, height); assert.equal(field.actors[puppet]!.birdView!.height, height);
  assert.equal(field.stop!.site?.index, 5); assert.equal(field.eventState.read(birdReached), 0);
});
test("map discard and failed preparation preserve actor pose; retry retires the old owner and creates fresh destination elevation", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
  assert(field.startEvent("bird-up")); flow.advance(510, birdHost); const actor = field.actors[puppet]!, pose = actor.birdView;
  assert(field.startEvent("go-world")); flow.advance(10, birdHost); assert.equal(field.stop?.kind, "map-transition");
  const owned = game.state.snapshot(), wrong = structuredClone(f.worldMap); wrong.contentHash = "f".repeat(64);
  assert.throws(() => game.world.prepare(f.world, wrong)); assert.equal(game.field, field); assert.equal(actor.birdView, pose); assert.deepEqual(game.state.snapshot(), owned);
  const discarded = game.world.prepare(f.world, f.worldMap); game.world.discard(discarded); assert.equal(game.world.commit(discarded), false);
  assert.equal(game.field, field); assert.equal(actor.birdView, pose);
  const retry = game.world.prepare(f.world, f.worldMap); assert.equal(game.world.commit(retry), true); flow.advance(10, birdHost);
  assert.notEqual(game.field, field); assert.equal(game.field.birdViewActorElevation(puppet), 0);
  const before = field.time; field.advance(1000); assert.equal(field.time, before); assert.equal(actor.birdView, pose);
});
test("real prepared battle media failure, cancel, victory return and once-only settlement preserve the same field component", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
  assert(field.startEvent("bird-up")); flow.advance(510, birdHost); const actor = field.actors[puppet]!, pose = structuredClone(actor.birdView), owned = game.state.snapshot();
  assert(field.startEvent("stone-battle")); assert.equal(field.stop?.kind, "encounter"); const request = field.stop;
  let fail = true; const handoff = new GameBattleHandoff(flow, { prepareStart: async () => { if (fail) { fail = false; throw new Error("Controlled missing battle media"); } return null; }, prepareReturn: async () => null, discard: () => {} });
  assert.equal((await handoff.start()).status, "failed"); assert.equal(field.stop, request); assert.deepEqual(actor.birdView, pose); assert.deepEqual(game.state.snapshot(), owned);
  let release!: (value: null) => void;
  const cancelled = new GameBattleHandoff(flow, { prepareStart: () => new Promise<null>(resolve => { release = resolve; }), prepareReturn: async () => null, discard: () => {} });
  const attempt = cancelled.start(); cancelled.cancel(); release(null); assert.equal((await attempt).status, "cancelled");
  assert.equal(field.stop, request); assert.deepEqual(actor.birdView, pose); assert.deepEqual(game.state.snapshot(), owned);
  assert.equal((await handoff.start()).status, "committed"); const battle = game.battle!;
  for (let i = 0; i < 3000 && battle.phase === "active"; i++) { for (const a of battle.ready) assert(battle.command(a.id, 10, battle.enemies[0]!.id, 100)); flow.advance(10, birdHost); }
  assert.equal(battle.phase, "victory"); assert.equal((await handoff.return()).status, "committed"); flow.advance(10, birdHost);
  assert.equal(game.field, field); assert.equal(field.actors[puppet], actor); assert.deepEqual(actor.birdView, pose); assert(game.checkpointReady);
  const after = game.state.snapshot(); assert.equal(after.completedBattles.length, owned.completedBattles.length + 1);
  await assert.rejects(handoff.return()); assert.deepEqual(game.state.snapshot(), after);
});

test("a world loop keeps the ordinary Move gate while height-only projection preserves the same logical actor", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make();
  assert(game.field.startEvent("go-world")); flow.advance(10, birdHost);
  assert(game.world.commit(game.world.prepare(f.world, f.worldMap))); flow.advance(10, birdHost);
  const field = game.field, owned = game.state.snapshot(); assert(field.startEvent("bird-move")); flow.advance(20, birdHost);
  assert.equal(field.stop?.kind, "unsupported"); assert.match(field.stop!.message, /wrap/);
  assert.equal(field.actors[puppet]!.birdView, undefined); assert.equal(field.actors[puppet]!.motion, null);
  assert.equal(field.eventState.read(birdReached), 0); assert.deepEqual(game.state.snapshot(), owned);
});

test("the actual PuppetCore bank retains native r0/r1/r2 and refuses a replaced bank before a height write", async () => {
  const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
  assert(field.startEvent("bird-up"));
  const tasks = Reflect.get(field, "tasks") as { actor: string; birdViewMove: unknown; generalRegisters: { kind: string; i: number[]; r: number[]; s: (string|null)[] } }[];
  const task = tasks.find(t => t.actor === puppet && t.birdViewMove)!; assert(task);
  assert.deepEqual(task.generalRegisters.r.slice(0, 3), [0, 120, field.time / 1000]);
  const actor = field.actors[puppet]!, height = actor.birdView!.height;
  task.generalRegisters = structuredClone(task.generalRegisters); flow.advance(10, birdHost);
  assert.equal(field.stop?.kind, "unsupported"); assert.equal(actor.birdView!.height, height); assert.equal(field.stop!.site?.index, 5);
});
