import test from "node:test";
import assert from "node:assert/strict";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { FieldGame } from "../src/core/field.js";
import type { GameSession } from "../src/core/game-session.js";
import { fieldNpcAreaContains } from "../src/core/field-npc-activity.js";
import { fieldNpcSessionFixture } from "./fixtures/field-npc-session.js";

const ready = { visible: true, mediaReady: true, overlayOpen: false };
type Fixture = Awaited<ReturnType<typeof fieldNpcSessionFixture>>;
function published(game: GameSession) {
  const flow = new GameFlow(game); flow.start(); flow.advance(0, ready); return flow;
}
function npc(game: GameSession, id = "601") {
  const actor = game.field.actors[id]; assert.ok(actor?.native, "Expected the original native NPC actor"); return actor;
}
function state(game: GameSession, id = "601") {
  const value = game.field.npcActivitySnapshot[id]; assert.ok(value, "Expected admitted NPC activity"); return value;
}
function currentBattle(game: GameSession) { const battle = game.battle; assert.ok(battle); return battle; }
function until(flow: GameFlow, predicate: () => boolean, reason: string, limit = 3000): void {
  for (let i = 0; !predicate(); i++) {
    assert.ok(i < limit, reason);
    assert.notEqual(flow.phase, "blocked", JSON.stringify(flow.session.field.stop));
    flow.advance(10, ready);
  }
}
function move(flow: GameFlow, direction: Parameters<GameFlow["move"]>[0]) {
  assert.equal(flow.move(direction), true, "Expected ordinary player input " + direction);
  until(flow, () => !flow.session.field.player.motion, "Player step did not finish");
}
function motionObservation(game: GameSession) {
  const actor = npc(game);
  return { position: structuredClone(actor.native!.entity.position), motion: structuredClone(actor.motion),
    animation: actor.animation?.snapshot(), steps: actor.steps, activity: state(game) };
}
function store() {
  const bytes = new Map<string, string>();
  return { bytes, storage: new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", "controlled-npc-session") };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function contentReader(f: Fixture) {
  return { world: async () => f.world, map: async (id: number) => {
    const map = f.maps[id]; if (!map) throw new Error("Unknown controlled map " + id); return map;
  } };
}

test("compiled Area bindings retain source blockers and the same native actor moves with player/actor collision", async () => {
  const f = await fieldNpcSessionFixture(), game = f.make(), flow = published(game);
  const source = f.map.map!.entities.find(entity => entity.id === f.npcId)!;
  assert.equal(source.npc!.moveType, 2); assert.ok(source.nativeNpcBlockers!.length);
  assert.ok(f.map.map!.groups!.entity_default!.blockers.some(row => /movement controller 2/.test(row.reason)));
  assert.equal(f.map.frameworkNpcActivity!.nativeRulesVerified, false);
  const actor = npc(game), native = actor.native, entity = native!.entity, wall = npc(game, f.obstacleId);
  assert.equal(actor.native!.scope!.kind, "map-npc");
  move(flow, "down"); assert.equal(game.field.player.x, 3); assert.equal(game.field.player.y, 5);
  const area = f.map.frameworkNpcActivity!.bindings[0]!.program.moveArea;
  const observed = new Set<string>(), owned = game.state.snapshot();
  for (let i = 0; i < 500; i++) {
    flow.advance(10, ready); assert.equal(game.field.stop, null);
    assert.equal(npc(game), actor); assert.equal(actor.native, native); assert.equal(actor.native!.entity, entity);
    const { x, y } = actor.native!.entity.position;
    assert.equal(fieldNpcAreaContains(area, { x, y }), true);
    if (actor.motion) {
      observed.add(`${actor.motion.from.x}->${actor.motion.to.x}`);
      assert.notDeepEqual(actor.motion.to, { x: game.field.player.x, y: game.field.player.y });
      assert.notDeepEqual(actor.motion.to, { x: wall.x, y: wall.y });
      assert.equal(actor.motion.manual, false);
    }
  }
  assert.ok(actor.steps > 1); assert.ok(observed.size >= 2, "Activity must really traverse and return");
  assert.equal(game.field.player.steps, 1, "Autonomous motion cannot charge player steps");
  assert.deepEqual(game.state.snapshot(), owned, "Autonomous ticks do not mutate shared owned state");
  const snapshot = game.field.npcActivitySnapshot;
  snapshot[f.npcId]!.rngState = 1; assert.notEqual(state(game).rngState, 1, "Observation is detached");
});

test("Flow pause, hidden/media gates and dialogue update masks freeze the one autonomous motion without catch-up", async () => {
  const f = await fieldNpcSessionFixture(), game = f.make(), flow = published(game), actor = npc(game);
  until(flow, () => !!actor.motion && actor.motion.elapsed > 0, "NPC never began moving");
  for (const gate of ["paused", "hidden", "media", "overlay"] as const) {
    const motion = actor.motion, before = motionObservation(game), time = game.field.time;
    if (gate === "paused") assert.equal(flow.pause(true), true);
    flow.advance(4000, { visible: gate !== "hidden", mediaReady: gate !== "media", overlayOpen: gate === "overlay" });
    assert.equal(actor.motion, motion); assert.deepEqual(motionObservation(game), before); assert.equal(game.field.time, time);
    if (gate === "paused") flow.pause(false);
    flow.advance(0, ready); assert.deepEqual(motionObservation(game), before);
  }
  const beforeElapsed = actor.motion!.elapsed;
  flow.advance(10, ready); assert.equal(actor.motion!.elapsed, beforeElapsed + 10);
});

test("ordinary NPC Talk and NPC script each acquire the same pending motion and release a fresh completion ticket", async t => {
  for (const interaction of ["talk", "script"] as const) await t.test(interaction, async () => {
    const f = await fieldNpcSessionFixture({ interaction }), game = f.make(), flow = published(game), actor = npc(game);
    move(flow, "down");
    // The public interaction grid addresses an actual cell. Catch the next
    // command at that cell before its first motion tick; no pose is patched.
    until(flow, () => actor.x === 4 && actor.y === 5 && !!actor.motion && actor.motion.elapsed === 0,
      "NPC did not expose its next command at the adjacent source cell");
    assert.equal(flow.move("right"), false, "The occupied/reserved actor cell stays blocked");
    const motion = actor.motion, native = actor.native, command = state(game).pending!, before = motionObservation(game);
    assert.equal(flow.confirm(), true); assert.ok(game.field.dialogue);
    assert.equal(npc(game), actor); assert.equal(actor.native, native); assert.equal(actor.motion, motion);
    assert.deepEqual(actor.motion, before.motion); assert.equal(state(game).pending!.commandId, command.commandId);
    assert.ok(state(game).holder); assert.equal(game.checkpointReady, false);
    flow.advance(1000, ready); assert.equal(actor.motion, motion); assert.deepEqual(actor.motion, before.motion);
    assert.equal(flow.confirm(), true);
    until(flow, () => game.field.dialogue === null && !game.field.busy, "Conversation did not release its event lease");
    assert.equal(state(game).holder, null); assert.equal(npc(game), actor);
    if (state(game).pending) assert.notEqual(state(game).pending!.revision, command.revision);
    until(flow, () => actor.steps > before.steps, "Released NPC failed to complete its original motion");
    if (interaction === "script") assert.equal(game.field.eventState.read({ category: "MapLocalVariable", index: 1 }), 1);
  });
});

test("player-root message pauses a half-finished attribute-2 NPC without acquiring its actor lease", async () => {
  const f = await fieldNpcSessionFixture(), game = f.make(), flow = published(game), actor = npc(game);
  until(flow, () => !!actor.motion && actor.motion.elapsed > 0,
    "NPC did not begin its ordinary command before the player trigger");
  assert.equal(flow.move("right"), true);
  until(flow, () => game.field.dialogue !== null && game.field.updateAttributeMask === 9,
    "Authored player trigger did not enter the source message update mask");
  assert.ok(actor.motion && actor.motion.elapsed > 0 && actor.motion.elapsed < actor.motion.duration);
  const motion = actor.motion, before = motionObservation(game), command = state(game).pending!;
  assert.equal(state(game).holder, null); flow.advance(1200, ready);
  assert.equal(actor.motion, motion); assert.deepEqual(motionObservation(game).position, before.position);
  assert.equal(actor.motion.elapsed, before.motion!.elapsed);
  assert.equal(flow.confirm(), true);
  until(flow, () => !game.field.busy, "Root task did not finish");
  assert.equal(state(game).holder, null); assert.equal(state(game).pending!.commandId, command.commandId);
  assert.equal(state(game).pending!.revision, command.revision);
  until(flow, () => actor.steps > before.steps, "Original suspended command never completed");
});

test("moving NPC permits menu/storage and restores progress/RNG with new authority before new input", async () => {
  const f = await fieldNpcSessionFixture(), game = f.make(), flow = published(game), actor = npc(game);
  until(flow, () => !!actor.motion && actor.motion.elapsed >= 40, "NPC never reached a savable motion");
  assert.equal(flow.pause(true), true);
  const commands = new GameCommands(flow, game), before = motionObservation(game);
  assert.equal(commands.menuReady, true);
  assert.equal(commands.menu({ kind: "set-preferences", preferences: { mode: "wait", speedIndex: 1 } }), true);
  assert.deepEqual(motionObservation(game), before); assert.equal(game.checkpointReady, true);
  const { storage } = store(), save = flow.beginOperation("save"), raw = game.checkpoint();
  const prepared = await storage.prepareSave(raw, 1730000000000);
  flow.advance(3000, ready); assert.deepEqual(motionObservation(game), before);
  prepared.commit(); assert.equal(save.finish(), true);
  const loaded = await storage.load(); assert.ok(loaded);
  const next = f.restore(loaded.checkpoint), nextActor = npc(next), nextState = state(next);
  assert.notEqual(nextActor, actor); assert.notEqual(nextActor.native!.entity, actor.native!.entity);
  assert.deepEqual(nextActor.native!.entity.position, before.position); assert.deepEqual(nextActor.motion, before.motion);
  assert.deepEqual(nextActor.animation!.snapshot(), before.animation); assert.equal(nextActor.steps, before.steps);
  for (const key of ["rngState", "rngDraws", "waitMs", "remainingSteps", "direction", "commandId"] as const)
    assert.equal(nextState[key], before.activity[key]);
  assert.ok(nextState.generation > before.activity.generation); assert.ok(nextState.revision > before.activity.revision);
  const load = flow.beginOperation("load"); assert.equal(load.publish(next, { paused: true }), true); flow.advance(0, ready);
  assert.equal(commands.menu({ kind: "set-preferences", preferences: { mode: "active", speedIndex: 4 } }), false);
  assert.deepEqual(next.battlePreferences, { mode: "wait", speedIndex: 1 });
  flow.pause(false); flow.advance(10, ready); assert.equal(nextActor.motion!.elapsed, before.motion!.elapsed + 10);
  move(flow, "down"); assert.equal(next.field.stop, null);
});

test("failed animation admission preserves pose, animation, pending state and uncommitted random draws", async () => {
  const f = await fieldNpcSessionFixture({ missingMovingAnimation: true }), game = f.make(), flow = published(game), actor = npc(game);
  until(flow, () => state(game).waitMs <= 10, "Activity timer did not approach an intent");
  let before = motionObservation(game), animation = actor.animation;
  // A blocked collision may legitimately settle a prior candidate. Capture the
  // actual failing animation tick instead of assuming a particular RNG choice.
  for (let i = 0; flow.phase !== "blocked"; i++) {
    assert.ok(i < 3000, "Missing move animation was never requested");
    before = motionObservation(game); animation = actor.animation;
    flow.advance(10, ready);
  }
  assert.equal(flow.phase, "blocked"); assert.match(JSON.stringify(game.field.stop), /animation|动画/i);
  assert.deepEqual(motionObservation(game), before); assert.equal(actor.animation, animation);
});

test("map failure/cancel/late completion preserve the old owner; retry and return install fresh same-ID NPCs", async () => {
  const f = await fieldNpcSessionFixture(), game = f.make(), flow = published(game);
  until(flow, () => !!npc(game).motion, "NPC never started before travel");
  move(flow, "left"); assert.equal(game.field.stop?.kind, "map-transition");
  const oldField = game.field, oldActor = npc(game), before = motionObservation(game), request = oldField.stop;
  const reader = contentReader(f), error = new Error("Controlled map download failure"), media = deferred<{ id: number }>(), entered = deferred<void>();
  let failedDownload = false, preparations = 0;
  const discarded: number[] = [], candidates: FieldGame[] = [];
  const loader = new GameMapLoader(flow, { ...reader, map: async id => {
    if (!failedDownload) { failedDownload = true; throw error; } return reader.map(id);
  } }, { prepare: async field => {
    candidates.push(field);
    if (++preparations === 1) { entered.resolve(); return media.promise; }
    return { id: preparations };
  }, discard: presentation => { discarded.push(presentation.id); } });
  const failed = await loader.load(); assert.equal(failed.status, "failed");
  if (failed.status === "failed") assert.equal(failed.error, error);
  assert.equal(game.field, oldField); assert.equal(oldField.stop, request); assert.deepEqual(motionObservation(game), before);
  const ownedBefore = game.state.snapshot();
  for (const change of ["direction", "policy"] as const) {
    // This is deliberate corruption of an unpublished transition candidate,
    // never a pose/flag patch on the live session or a simulated successful map.
    const stale = game.world.prepare(f.world, structuredClone(f.maps[f.secondMap]!));
    if (change === "direction") {
      const privateNpc = stale.field.actors[f.npcId]!;
      privateNpc.direction = privateNpc.direction === "left" ? "right" : "left";
    } else {
      (stale.field.content.frameworkNpcActivity as unknown as { policy: string }).policy = "untrusted-policy";
    }
    assert.equal(game.world.commit(stale), false, "Changed private NPC candidate must not publish");
    assert.equal(game.field, oldField); assert.equal(oldField.stop, request);
    assert.deepEqual(motionObservation(game), before); assert.deepEqual(game.state.snapshot(), ownedBefore);
  }
  const pending = loader.load(); await entered.promise; loader.cancel();
  flow.advance(1000, ready); assert.equal(game.field, oldField); assert.deepEqual(motionObservation(game), before);
  assert.equal((await loader.load()).status, "committed");
  const destination = game.field, newActor = npc(game), fresh = state(game);
  assert.notEqual(destination, oldField); assert.notEqual(newActor, oldActor); assert.equal(newActor.id, oldActor.id);
  assert.equal(fresh.commandId, 0); assert.equal(newActor.motion, null);
  media.resolve({ id: 90 }); assert.equal((await pending).status, "cancelled"); assert.deepEqual(discarded, [90]);
  assert.equal(game.field, destination); assert.equal(npc(game), newActor);
  const candidate = candidates[0]!, abandoned = candidate.npcActivitySnapshot;
  candidate.advance(1000); assert.deepEqual(candidate.npcActivitySnapshot, abandoned, "Discarded candidate cannot clock autonomous commands");
  const retired = oldField.npcActivitySnapshot;
  oldField.advance(1000); assert.deepEqual(oldField.npcActivitySnapshot, retired, "Retired field cannot revive its old activity ticket");
  flow.advance(10, ready); until(flow, () => !game.field.busy, "Destination initializer did not finish");
  move(flow, "left"); assert.equal((await loader.load()).status, "committed"); flow.advance(10, ready);
  assert.equal(game.field.content.map.identity!.mapId, f.firstMap); assert.notEqual(npc(game), oldActor);
  assert.equal(game.state, flow.session.state); assert.equal(game.checkpointReady, true);
});

test("background motion does not block prepared battle entry, victory settlement and same-session field continuation", async () => {
  const f = await fieldNpcSessionFixture(), game = f.make(), flow = published(game), owned = game.state;
  until(flow, () => !!npc(game).motion && npc(game).motion!.elapsed > 0, "NPC never started before battle");
  move(flow, "up"); assert.equal(game.field.stop?.kind, "encounter"); assert.equal(game.battle, null);
  const actor = npc(game), before = motionObservation(game), commands = new GameCommands(flow, game);
  const handoff = new GameBattleHandoff(flow, { prepareStart: async () => ({ kind: "start" }),
    prepareReturn: async () => ({ kind: "return" }), discard: () => {} });
  const started = await handoff.start();
  assert.equal(started.status, "committed", started.status === "failed" ? String(started.error) : undefined);
  assert.equal(game.state, owned); assert.equal(npc(game), actor);
  const battle = currentBattle(game);
  for (let i = 0; battle.phase === "active"; i++) {
    assert.ok(i < 2000, "Controlled source-initialized battle failed to terminate");
    for (const player of battle.ready)
      assert.equal(commands.command(battle, player.id, 10, battle.enemies[0]!.id, 100), true);
    flow.advance(10, ready);
  }
  assert.equal(battle.phase, "victory"); assert.deepEqual(npc(game).motion, before.motion);
  const returned = await handoff.return();
  assert.equal(returned.status, "committed", returned.status === "failed" ? String(returned.error) : undefined);
  assert.equal(game.state, owned); assert.equal(npc(game), actor); assert.equal(game.battle, null);
  flow.advance(10, ready); until(flow, () => !game.field.busy, "Battle continuation did not finish");
  assert.equal(game.state.snapshot().completedBattles.length, 1);
  until(flow, () => actor.steps > before.steps, "Autonomous command did not resume after battle");
  assert.equal(game.checkpointReady, true); move(flow, "left");
});
