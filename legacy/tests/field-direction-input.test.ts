import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame, type FieldDirectionInputResult } from "../src/core/field.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import type { FieldEntity, Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { readyHost, startFlow } from "./fixtures/game-flow.js";

type Variant = "open" | "door" | "wall" | "npc" | "missing-region" | "overlapping-doors" | "unknown-collision";

/** The existing checkpoint fixture supplies the real tile door, animations,
 * owned state and session. All scenario changes happen before construction. */
function fixture(variant: Variant = "open", invalidDirectionAnimation = false) {
  const { field: supplied, battle } = checkpointFixture();
  const field = structuredClone(supplied);
  field.entry.player.direction = "down";
  const door = field.map.entities.find(entity => entity.kind === 8)!;
  const region = field.map.entities.find(entity => entity.kind === 1)!;
  const entities: FieldEntity[] = [];
  if (variant === "door" || variant === "missing-region" || variant === "overlapping-doors") {
    entities.push(door);
    if (variant !== "missing-region") entities.push(region);
    if (variant === "overlapping-doors") entities.push({ ...door, id: "second-door" });
  }
  if (variant === "npc") entities.push({
    ...field.map.entities.find(entity => entity.kind === 6)!,
    x: 2, y: 1, direction: "down",
  });
  if (variant === "unknown-collision") entities.push({
    ...door, id: "unknown-collision", kind: 19, collision: null,
  });
  if (variant === "wall") field.map.collisions[1]![8] = 1;
  field.map.entities = entities;
  field.map.groups = {
    entity_default: { ...field.map.groups!.entity_default!, entities },
  };
  field.scripts.waiting = [
    { kind: "wait", seconds: 0.1 }, { kind: "exit" },
  ].map((op, index) => ({ ...op, script: "waiting", index, source: field.map.source })) as Op[];
  field.scripts.talking = [
    { kind: "message", key: "SYNTHETIC", speaker: "", text: "Wait for confirmation" },
    { kind: "exit" },
  ].map((op, index) => ({ ...op, script: "talking", index, source: field.map.source })) as Op[];
  if (invalidDirectionAnimation) delete field.characters.hero!.animations.WalkR;
  const game = new GameSession(field, battle, 314), flow = new GameFlow(game);
  return { game, field: game.field, flow };
}

function pose(field: FieldGame) {
  const player = field.player;
  return { x: player.x, y: player.y, layer: player.layer, direction: player.direction,
    steps: player.steps, motion: structuredClone(player.motion), animation: player.animation?.snapshot() ?? null };
}

test("direction input starts one movement on the existing player and keeps the old move boolean", () => {
  const { game, field, flow } = fixture(), owned = game.state.snapshot();
  startFlow(flow);
  const result: FieldDirectionInputResult = flow.directionInput("right");
  assert.deepEqual(result, { kind: "movement" });
  assert.equal(flow.phase, "exploration");
  assert.equal(field.player.x, 1);
  assert.equal(field.player.steps, 0);
  assert.equal(field.player.motion?.manual, true);
  assert.equal(field.player.direction, "right");
  flow.advance(240, readyHost);
  assert.equal(field.player.x, 2);
  assert.equal(field.player.steps, 1);
  assert.equal(field.player.motion, null);
  assert.deepEqual(game.state.snapshot(), owned);
  const legacy = fixture().field;
  assert.equal(legacy.move("right"), true);
  legacy.advance(240);
  assert.equal(legacy.player.x, 2);
  assert.equal(legacy.player.steps, 1);
});

test("contact reports the registered source door and region, waits for completion, and opens once", () => {
  const { game, field, flow } = fixture("door"), owned = game.state.snapshot();
  startFlow(flow);
  assert.deepEqual(flow.directionInput("right"), { kind: "door", entityId: "door", regionId: "region" });
  assert.deepEqual(field.openTriggers.snapshot().pending, { trigger: "door", region: "region" });
  assert.equal(field.tileAnimations.isPlaying("region"), true);
  assert.equal(field.player.motion, null);
  assert.equal(field.player.steps, 0);
  assert.equal(flow.phase, "event");
  const whileOpening = pose(field), doors = field.openTriggers.snapshot();
  assert.deepEqual(flow.directionInput("left"), { kind: "rejected" });
  assert.deepEqual(pose(field), whileOpening);
  assert.deepEqual(field.openTriggers.snapshot(), doors);
  flow.advance(60, readyHost);
  assert.equal(field.openTriggers.busy, true);
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "exploration");
  assert.equal(field.openTriggers.blocks("door"), false);
  assert.deepEqual(flow.directionInput("right"), { kind: "movement" });
  flow.advance(240, readyHost);
  assert.equal(field.player.x, 2);
  assert.equal(field.player.steps, 1);
  assert.equal(field.openTriggers.snapshot().pending, null);
  assert.deepEqual(game.state.snapshot(), owned);
  const legacy = fixture("door").field;
  assert.equal(legacy.move("right"), false);
  assert.equal(legacy.openTriggers.busy, true);
});

test("facing an occupied actor or wall is a direction gesture, never a committed move", () => {
  for (const variant of ["npc", "wall"] as const) {
    const { game, field, flow } = fixture(variant), owned = game.state.snapshot();
    const actor = variant === "npc" ? structuredClone(poseOfActor(field.actors.npc!)) : null;
    startFlow(flow);
    assert.deepEqual(flow.directionInput("right"), { kind: "facing" });
    assert.equal(field.player.direction, "right");
    assert.equal(field.player.x, 1);
    assert.equal(field.player.y, 1);
    assert.equal(field.player.motion, null);
    assert.equal(field.player.steps, 0);
    assert.equal(flow.phase, "exploration");
    if (actor) assert.deepEqual(poseOfActor(field.actors.npc!), actor);
    assert.deepEqual(game.state.snapshot(), owned);
    // Existing movement consumers still receive false. A route must explicitly
    // declare and validate a face target rather than count a wall as movement.
    assert.equal(fixture(variant).field.move("right"), false);
  }
});

function poseOfActor(actor: FieldGame["actors"][string]) {
  return { x: actor.x, y: actor.y, layer: actor.layer, direction: actor.direction,
    steps: actor.steps, motion: structuredClone(actor.motion), animation: actor.animation?.snapshot() ?? null };
}

test("title, pause, unavailable media, hidden host, overlays and I/O reject before dispatch", () => {
  const title = fixture("door"), initial = pose(title.field);
  assert.deepEqual(title.flow.directionInput("right"), { kind: "rejected" });
  assert.deepEqual(pose(title.field), initial);
  assert.equal(title.field.openTriggers.busy, false);
  for (const gate of ["paused", "media", "hidden", "overlay", "io"] as const) {
    const { game, field, flow } = fixture("door");
    startFlow(flow);
    const before = pose(field), owned = game.state.snapshot(), tiles = field.tileAnimations.snapshot();
    let ticket: ReturnType<GameFlow["beginOperation"]> | null = null;
    if (gate === "paused") assert.equal(flow.pause(true), true);
    if (gate === "media") flow.observeHost({ ...readyHost, mediaReady: false });
    if (gate === "hidden") flow.observeHost({ ...readyHost, visible: false });
    if (gate === "overlay") flow.observeHost({ ...readyHost, overlayOpen: true });
    if (gate === "io") ticket = flow.beginOperation("load");
    assert.deepEqual(flow.directionInput("right"), { kind: "rejected" });
    assert.deepEqual(pose(field), before);
    assert.equal(field.openTriggers.busy, false);
    assert.deepEqual(field.tileAnimations.snapshot(), tiles);
    assert.deepEqual(game.state.snapshot(), owned);
    ticket?.cancel();
  }
});

test("an in-progress player motion and active events cannot be redirected by the new input", () => {
  const moving = fixture();
  startFlow(moving.flow);
  assert.deepEqual(moving.flow.directionInput("right"), { kind: "movement" });
  moving.flow.advance(30, readyHost);
  const before = pose(moving.field), motion = moving.field.player.motion, animation = moving.field.player.animation;
  assert.deepEqual(moving.flow.directionInput("down"), { kind: "rejected" });
  assert.deepEqual(moving.field.directionInput("down"), { kind: "rejected" });
  assert.deepEqual(pose(moving.field), before);
  assert.equal(moving.field.player.motion, motion);
  assert.equal(moving.field.player.animation, animation);
  for (const script of ["waiting", "talking"] as const) {
    const { game, field, flow } = fixture();
    startFlow(flow);
    assert.equal(field.startEvent(script), true);
    const eventPose = pose(field), owned = game.state.snapshot();
    assert.ok(["event", "dialogue"].includes(flow.phase));
    assert.deepEqual(flow.directionInput("right"), { kind: "rejected" });
    assert.deepEqual(field.directionInput("right"), { kind: "rejected" });
    assert.deepEqual(pose(field), eventPose);
    assert.deepEqual(game.state.snapshot(), owned);
  }
});

test("animation failure rejects movement, facing and door contact without partly changing the player", () => {
  for (const variant of ["open", "wall", "door"] as const) {
    const { game, field, flow } = fixture(variant, true);
    startFlow(flow);
    const before = pose(field), owned = game.state.snapshot(), animation = field.player.animation,
      tiles = field.tileAnimations.snapshot(), doors = field.openTriggers.snapshot();
    assert.deepEqual(flow.directionInput("right"), { kind: "rejected" });
    assert.equal(field.stop?.kind, "unsupported");
    assert.match(field.stop!.message, /Missing actor animation WalkR/);
    assert.deepEqual(pose(field), before);
    assert.equal(field.player.animation, animation);
    assert.deepEqual(field.openTriggers.snapshot(), doors);
    assert.deepEqual(field.tileAnimations.snapshot(), tiles);
    assert.deepEqual(game.state.snapshot(), owned);
  }
});

test("unknown collision, missing door links and overlapping source contacts remain rejected", () => {
  for (const variant of ["unknown-collision", "missing-region", "overlapping-doors"] as const) {
    const { game, field, flow } = fixture(variant);
    startFlow(flow);
    const before = pose(field), owned = game.state.snapshot(), doors = field.openTriggers.snapshot(),
      tiles = field.tileAnimations.snapshot();
    assert.deepEqual(flow.directionInput("right"), { kind: "rejected" });
    assert.equal(field.stop?.kind, "unsupported");
    assert.deepEqual(pose(field), before);
    assert.deepEqual(field.openTriggers.snapshot(), doors);
    assert.deepEqual(field.tileAnimations.snapshot(), tiles);
    assert.deepEqual(game.state.snapshot(), owned);
    assert.deepEqual(flow.directionInput("down"), { kind: "rejected" });
    assert.deepEqual(pose(field), before);
  }
});

test("owner replacement invalidates old tickets and command channels without inheriting input readiness", () => {
  const old = fixture("door"), replacement = fixture("door");
  startFlow(old.flow);
  const oldCommands = new GameCommands(old.flow, old.game), ticket = old.flow.beginOperation("load"),
    oldPose = pose(old.field), nextPose = pose(replacement.field), oldOwned = old.game.state.snapshot(),
    nextOwned = replacement.game.state.snapshot();
  old.flow.start(replacement.game);
  assert.equal(ticket.isCurrent(), false);
  assert.equal(ticket.publish(old.game), false);
  assert.equal(old.flow.currentSession, replacement.game);
  assert.deepEqual(old.flow.directionInput("right"), { kind: "rejected" });
  assert.deepEqual(pose(replacement.field), nextPose);
  old.flow.observeHost(readyHost);
  assert.equal(old.flow.pause(true), true);
  assert.equal(oldCommands.setBattlePreferences({ mode: "active", speedIndex: 2 }), false);
  assert.deepEqual(old.game.state.snapshot(), oldOwned);
  assert.deepEqual(replacement.game.state.snapshot(), nextOwned);
  assert.deepEqual(pose(old.field), oldPose);
  assert.deepEqual(pose(replacement.field), nextPose);
  const currentTicket = old.flow.beginOperation("map");
  ticket.cancel();
  assert.equal(currentTicket.isCurrent(), true);
  assert.deepEqual(old.flow.directionInput("right"), { kind: "rejected" });
  currentTicket.cancel();
});
