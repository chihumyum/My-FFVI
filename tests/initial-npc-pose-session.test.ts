import test from "node:test";
import assert from "node:assert/strict";
import { GameCommands } from "../src/core/game-commands.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { initialNpcPoseSessionFixture } from "./fixtures/initial-npc-pose-session.js";
const ready = { visible: true, mediaReady: true, overlayOpen: false };
function until(flow: GameFlow, predicate: () => boolean, label: string, stopped = false) {
 for (let tick = 0; tick < 1000; tick++) {
  if (!stopped) assert.equal(flow.session.field.stop, null, label);
  if (predicate()) return; flow.advance(10, ready);
 } assert.fail(label);
}
async function launch() {
 const f = await initialNpcPoseSessionFixture(), game = f.make(), flow = new GameFlow(game); flow.start(); flow.advance(0, ready);
 until(flow, () => game.checkpointReady, "Initial NPC pose failed to settle"); return { f, game, flow };
}

test("the actual native one-direction NPC survives menu/Storage restore without replaying Init or granting missing poses", async () => {
 const { f, game, flow } = await launch(), actor = game.field.actors[f.npcId]!, pose = actor.animation!.snapshot()!, owned = game.state.snapshot();
 assert.equal(pose.key, "WalkB-S"); assert.equal(actor.native!.entity.animation, actor.animation);
 assert.equal(game.field.content.characters[f.asset]!.animations.WalkL, undefined);
 assert.equal(flow.pause(true), true); const commands = new GameCommands(flow, game); assert.equal(commands.menuReady, true);
 const values = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, "source", "controlled-initial-npc-pose"),
  saved = game.checkpoint(); await storage.save(saved, 1); const loaded = await storage.load(); assert.ok(loaded);
 const entry = new GameEntryLoader(flow, { discard: (_: null) => {} });
 const result = await entry.begin("load").prepare(() => ({ session: f.restore(loaded.checkpoint), presentation: null, options: { paused: true } }));
 assert.equal(result.status, "committed"); const restored = flow.session, current = restored.field.actors[f.npcId]!;
 assert.notEqual(current, actor); assert.deepEqual(current.animation!.snapshot(), pose, "Restore cannot second-Look the saved next key back to WalkB");
 assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(restored.state.snapshot(), owned); assert.equal(commands.menuReady, false);
 flow.observeHost(ready); flow.pause(false);
 const before = { direction: current.direction, animation: current.animation!.snapshot(), position: { ...current.native!.entity.position } },
  field = restored.field, owner = restored.state;
 assert.equal(field.startEvent("missing-pose"), true); until(flow, () => field.stop?.kind === "unsupported", "A later missing direction must block", true);
 assert.match(field.stop!.message, /Missing actor animation WalkL/); assert.equal(restored.state, owner); assert.equal(restored.field, field);
 assert.equal(current.native!.entity.animation, current.animation); assert.equal(current.direction, before.direction);
 assert.deepEqual(current.animation!.snapshot(), before.animation); assert.deepEqual(current.native!.entity.position, before.position);
 assert.deepEqual(restored.state.snapshot(), owned); assert.equal(restored.checkpointReady, false);
});

test("saved animation cannot invent another pose and a rejected restoration preserves the live native owner", async () => {
 const { f, game, flow } = await launch(), actor = game.field.actors[f.npcId]!, saved = game.checkpoint(),
  damaged = structuredClone(saved), row = damaged.world.field.native!.actors.actors.find(row => row.id === f.npcId)!;
 assert.ok(row.animation); row.animation.key = "WalkL";
 const rejectedInput = structuredClone(damaged), before = game.checkpoint(), expected = actor.animation!.snapshot(),
  entry = new GameEntryLoader(flow, { discard: (_: null) => {} }),
  attempt = await entry.begin("load").prepare(() => ({ session: f.restore(damaged), presentation: null }));
 assert.equal(attempt.status, "failed"); assert.equal(flow.session, game); assert.equal(game.field.actors[f.npcId], actor);
 assert.deepEqual(game.checkpoint(), before); assert.deepEqual(actor.animation!.snapshot(), expected); assert.deepEqual(damaged, rejectedInput);
});

test("failed and cancelled map candidates retain the same NPC; only committed retry retires its original instance", async () => {
 const { f, game, flow } = await launch(), field = game.field, actor = field.actors[f.npcId]!, owner = game.state, before = owner.snapshot();
 assert.equal(field.startEvent("leave"), true); until(flow, () => field.stop?.kind === "map-transition", "Source-style map request did not publish", true);
 const request = field.stop, fingerprint = field.nativeActorStateFingerprint;
 let mode = "fail", resolveMedia!: (value: null) => void, entered!: () => void;
 const prepared = new Promise<void>(resolve => { entered = resolve; }), loader = new GameMapLoader(flow, f.reader, {
  prepare: async next => { assert.equal(next.actors[f.npcId], undefined); if (mode === "fail") throw new Error("controlled missing target media");
   if (mode === "cancel") { entered(); return new Promise<null>(resolve => { resolveMedia = resolve; }); } return null; }, discard: () => {} });
 assert.equal((await loader.load()).status, "failed"); assert.equal(game.field, field); assert.equal(field.stop, request);
 assert.equal(field.actors[f.npcId], actor); assert.equal(field.nativeActorStateFingerprint, fingerprint); assert.deepEqual(owner.snapshot(), before);
 mode = "cancel"; const pending = loader.load(); await Promise.race([prepared, pending.then(value => assert.fail("Map failed before media: " + JSON.stringify(value)))]);
 loader.cancel(); resolveMedia(null); assert.equal((await pending).status, "cancelled");
 assert.equal(game.field, field); assert.equal(field.stop, request); assert.equal(field.actors[f.npcId], actor); assert.deepEqual(owner.snapshot(), before);
 mode = "commit"; const retry = await loader.load(); assert.equal(retry.status, "committed", retry.status === "failed" ? String(retry.error) : undefined);
 assert.notEqual(game.field, field); assert.equal(game.field.actors[f.npcId], undefined); assert.equal(field.actors[f.npcId], actor);
 until(flow, () => game.checkpointReady, "Committed destination did not settle"); assert.equal(game.state, owner); assert.deepEqual(owner.snapshot(), before);
});
