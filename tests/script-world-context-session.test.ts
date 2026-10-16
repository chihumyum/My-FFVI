import test from "node:test";
import assert from "node:assert/strict";
import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { Op, Site } from "../src/field/types.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const host = { visible: true, mediaReady: true, overlayOpen: false };
async function fixture() {
  const f = await worldLoopSessionFixture();
  const maps = [structuredClone(f.map), structuredClone(f.worldMap)];
  for (const map of maps) {
    const rootContext = structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
    const scripts: Record<string, Instruction<Op>[]> = {
      "story-entry": [{ kind: "script-transition", targetScript: "SC_MAP_shared", returnToCaller: true }, { kind: "wait", seconds: 0 }, { kind: "exit" }],
      SC_MAP_shared: [{ kind: "nop" }, { kind: "wait", seconds: 0 }, { kind: "exit" }],
      SC_MAP_outer: [{ kind: "script-transition", targetScript: "plain-child", returnToCaller: true }, { kind: "wait", seconds: 0 }, { kind: "exit" }],
      "plain-child": [{ kind: "nop" }, { kind: "wait", seconds: 0 }, { kind: "exit" }],
      SC_MAP_controls: [{ kind: "nop" }, { kind: "puppet", slot: 0, actor: "-1001", target: 5 }, { kind: "exec-puppets", asynchronous: true }, { kind: "wait", seconds: 0 }, { kind: "exit" }, { kind: "nop" }, { kind: "wait", seconds: 0 }, { kind: "exit" }],
      "story-controls": [{ kind: "script-transition", targetScript: "SC_MAP_controls", returnToCaller: true }, { kind: "exit" }],
      "story-direct": [{ kind: "script-transition", targetScript: "SC_MAP_direct", returnToCaller: false }, { kind: "exit" }],
      SC_MAP_direct: [{ kind: "nop" }, { kind: "wait", seconds: 0 }, { kind: "script-transition", targetScript: "plain-child", returnToCaller: false }],
    };
    map.scriptTransitionMetadata ??= {};
    map.scriptLocals ??= {};
    for (const [name, values] of Object.entries(scripts)) {
      map.scripts[name] = values.map((op, index) => ({ ...op, script: name, index, source: f.source })) as Op[];
      map.scriptPuppetContexts![name] = structuredClone(rootContext);
      map.scriptTransitionMetadata[name] = { customAnimations: "none" };
      map.scriptLocals[name] = null;
    }
  }
  const [map, worldMap] = maps.map(sealBatchContent), world = structuredClone(f.world);
  for (const value of [map!, worldMap!]) world.maps[value.mapId]!.contentHash = value.contentHash;
  const catalog = sealBatchContent(world), content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry,
    sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world: catalog, map: map!, battle: f.battle,
    entrance: map!.partyEntry!.pointIns[0]!.id });
  const runtime = { battleHandoff: "prepared" as const };
  const make = async () => { const game = await GameSession.prepareFrameworkNewGame(content, catalog, map!, f.battle, runtime);
    const flow = new GameFlow(game); flow.start(game); flow.observeHost(host); flow.advance(10, host); return { game, flow }; };
  return { ...f, map: map!, worldMap: worldMap!, world: catalog, content, runtime, make };
}
const context = (game: GameSession) => game.field.options.puppetActors!.controlContext();
function finish(game: GameSession) {
  for (let tick = 0; tick < 8 && game.field.busy && !game.field.stop; tick++) game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.field.busy, false);
}
async function enterWorld(f: Awaited<ReturnType<typeof fixture>>, game: GameSession, flow: GameFlow) {
  assert(flow.move("right")); flow.advance(240, host);
  const candidate = game.world.prepare(f.world, f.worldMap); assert(game.world.commit(candidate)); flow.advance(10, host);
}

for (const world of [false, true]) test(`actual native owner recomputes both directions of hooked script classification on world=${world}`, async () => {
  const f = await fixture(), { game, flow } = await f.make();
  if (world) await enterWorld(f, game, flow);
  const field = game.field, player = field.player, owned = game.state.snapshot();
  assert.equal(field.sourceCurrentWorldMap, world);
  assert(field.startEvent("story-entry")); assert.equal(field.stop, null);
  assert.equal(context(game).worldMapScript, world);
  game.advance(10); assert.equal(context(game).worldMapScript, false);
  finish(game);
  assert(field.startEvent("SC_MAP_outer")); assert.equal(field.stop, null);
  assert.equal(context(game).worldMapScript, false);
  game.advance(10); assert.equal(context(game).worldMapScript, world);
  finish(game); assert.equal(field.player, player); assert.deepEqual(game.state.snapshot(), owned);
});

for (const world of [false, true]) test(`direct replacements use the new main program without restarting the actor lifecycle on world=${world}`, async () => {
  const f = await fixture(), { game, flow } = await f.make(); if (world) await enterWorld(f, game, flow);
  const player = game.field.player, entity = player.native!.entity, owned = game.state.snapshot();
  assert(game.field.startEvent("story-direct")); assert.equal(game.field.stop, null);
  assert.equal(context(game).worldMapScript, world); game.advance(10);
  assert.equal(context(game).worldMapScript, false); finish(game);
  assert.equal(game.field.player, player); assert.equal(player.native!.entity, entity); assert.deepEqual(game.state.snapshot(), owned);
});

test("canceled map candidates retain the old predicate; successful publication and stable Storage restore rebuild it from the destination", async () => {
  const f = await fixture(), { game, flow } = await f.make(), old = game.field;
  assert(flow.move("right")); flow.advance(240, host);
  const canceled = game.world.prepare(f.world, f.worldMap); assert.equal(canceled.field.sourceCurrentWorldMap, true);
  assert.equal(old.sourceCurrentWorldMap, false); game.world.discard(canceled); assert.equal(game.world.commit(canceled), false);
  assert.equal(game.field, old); assert.equal(old.sourceCurrentWorldMap, false);
  const retry = game.world.prepare(f.world, f.worldMap); assert(game.world.commit(retry)); flow.advance(10, host);
  assert.equal(game.field.sourceCurrentWorldMap, true); assert(game.field.startEvent("story-entry")); finish(game);
  const saved = game.checkpoint(), bytes = new Map<string, string>(), storage = new CheckpointStorage({
    getItem: key => bytes.get(key) ?? null, setItem: (key, value) => { bytes.set(key, value); } });
  (await storage.prepareSave(saved, 1)).commit(); const loaded = await storage.load(); assert(loaded);
  const restored = GameSession.restore(loaded.checkpoint, undefined, f.battle,
    { catalog: f.world, map: f.worldMap, initialized: { content: f.content, initialMap: f.map } }, f.runtime);
  assert.deepEqual(restored.checkpoint(), saved); assert.equal(restored.field.sourceCurrentWorldMap, true);
  assert(restored.field.startEvent("story-entry")); assert.equal(context(restored).worldMapScript, true); finish(restored);
});

test("live source-map changes invalidate the captured independent predicate before a classification change", async () => {
  const f = await fixture(), { game } = await f.make(), field = game.field, view = field.content.entry.viewPlan!;
  view.isWorld = true; assert.throws(() => field.sourceCurrentWorldMap, /binding changed/);
  assert(field.startEvent("story-entry")); assert.equal(field.stop?.kind, "unsupported");
  assert.match(field.stop?.message ?? "", /binding changed/);
  assert.equal(field.stop?.site?.script, "story-entry");
});

for (const world of [false, true]) test(`actual Puppet collision control consumes the recomputed conjunction on world=${world}`, async () => {
  const f = await fixture(), { game, flow } = await f.make(); if (world) await enterWorld(f, game, flow);
  const field = game.field; assert.equal(field.collisionState.mapColliders, true);
  assert(field.startEvent("story-controls")); assert.equal(field.stop, null);
  assert.equal(context(game).worldMapScript, world);
  assert.equal(field.collisionState.mapColliders, world);
  assert.equal(field.collisionState.entityCollision, world);
  finish(game);
});
