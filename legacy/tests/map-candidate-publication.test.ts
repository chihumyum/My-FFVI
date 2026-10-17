import assert from "node:assert/strict";
import test from "node:test";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameState } from "../src/core/game-state.js";
import { EventState } from "../src/core/event-state.js";
import { WorldSession } from "../src/core/world-session.js";
import { WEB_SOURCE_SCRIPT_RANDOM } from "../src/core/field-script-random.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { sealBatchContent as seal } from "./fixtures/content-batch.js";
import type { Op } from "../src/field/types.js";
const host = { visible: true, mediaReady: true, overlayOpen: false };
const ref = { category: "MapLocalVariable" as const, index: 7 };
async function setup() {
  const f = await worldLoopSessionFixture(), next = structuredClone(f.worldMap), world = structuredClone(f.world);
  const source = { file: "tests/map-candidate-publication.test.ts", assetPath: "authored/candidate-fence" };
  const op = (value: object, index: number): Op => ({ ...value, script: "authored-observer", index, source }) as Op;
  next.scripts.draw = [op({ kind: "script-random", command: { target: ref, upperInclusive: 4 } }, 99), op({ kind: "exit" }, 100)];
  next.scripts.wait = [op({ kind: "wait", seconds: .02 }, 101), op({ kind: "exit" }, 102)];
  next.scripts.pass = [op({ kind: "exit" }, 103)];
  for (const name of ["draw", "wait", "pass"])
    next.scriptPuppetContexts![name] = structuredClone(next.scriptPuppetContexts![next.initializer!]!);
  const target = seal(next); world.maps[String(target.mapId)]!.contentHash = target.contentHash;
  const catalog = seal(world), content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry,
    sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world: catalog, map: f.map, battle: f.battle,
    entrance: f.map.partyEntry!.pointIns[0]!.id });
  const runtime = { scriptRandom: WEB_SOURCE_SCRIPT_RANDOM, battleHandoff: "prepared" as const };
  const game = await GameSession.prepareFrameworkNewGame(content, catalog, f.map, f.battle, runtime), flow = new GameFlow(game);
  flow.start(); flow.advance(10, host); game.field.startEvent("go-world"); flow.advance(10, host);
  assert.equal(game.field.stop?.kind, "map-transition");
  return { ...f, target, catalog, content, runtime, game, flow };
}
function baseline(game: GameSession) {
  return { field: game.field, request: game.field.stop, actors: game.field.nativeActorStateFingerprint,
    owned: game.state.snapshot(), events: game.field.eventState.snapshot(), transitions: structuredClone(game.world.transitions) };
}
function unchanged(game: GameSession, before: ReturnType<typeof baseline>) {
  assert.equal(game.field, before.field); assert.equal(game.field.stop, before.request);
  assert.equal(game.field.nativeActorStateFingerprint, before.actors); assert.deepEqual(game.state.snapshot(), before.owned);
  assert.deepEqual(game.field.eventState.snapshot(), before.events); assert.deepEqual(game.world.transitions, before.transitions);
}

test("ordinary map candidate EventState writes, including write-back ABA, cannot publish or consume the live owner", async () => {
  for (const aba of [false, true]) {
    const h = await setup(), before = baseline(h.game), candidate = h.game.world.prepare(h.catalog, h.target);
    assert.equal(candidate.field.content.frameworkNpcActivity, undefined);
    assert.equal(candidate.field.content.walkEncounters, undefined);
    const original = candidate.field.eventState.snapshot(), value = candidate.field.eventState.read(ref);
    candidate.field.eventState.write(ref, 7);
    if (aba) { candidate.field.eventState.write(ref, value); assert.deepEqual(candidate.field.eventState.snapshot(), original); }
    assert.equal(h.game.world.commit(candidate), false); unchanged(h.game, before);
    h.game.world.discard(candidate);
    const retry = h.game.world.prepare(h.catalog, h.target); assert.equal(h.game.world.commit(retry), true);
    assert.equal(h.game.field, retry.field); assert.equal(h.game.state.snapshot().fieldRandom!.draws, before.owned.fieldRandom!.draws);
    assert.equal(h.game.world.commit(retry), false);
  }
});

test("a late private Random draw is rejected, retry publishes once, and the same port works after save/restore", async () => {
  const h = await setup(), before = baseline(h.game), candidate = h.game.world.prepare(h.catalog, h.target);
  assert.equal(candidate.field.startEvent("draw"), true);
  assert.notEqual(candidate.field.eventState.read(ref), 0); assert.equal(candidate.field.scriptRandomExecutions.length, 1);
  assert.equal(h.game.world.commit(candidate), false); unchanged(h.game, before);
  const retry = h.game.world.prepare(h.catalog, h.target); h.game.world.discard(retry); unchanged(h.game, before);
  const final = h.game.world.prepare(h.catalog, h.target); assert.equal(h.game.world.commit(final), true);
  h.flow.advance(10, host); assert.equal(h.game.state.snapshot().fieldRandom!.draws, before.owned.fieldRandom!.draws);
  assert.equal(h.game.field.startEvent("draw"), true); h.flow.advance(10, host);
  assert.equal(h.game.state.snapshot().fieldRandom!.draws, before.owned.fieldRandom!.draws + 1);
  const saved = h.game.checkpoint(), restored = GameSession.restore(saved, undefined, h.battle,
    { catalog: h.catalog, map: h.target, initialized: { content: h.content, initialMap: h.map } }, h.runtime);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.field.startEvent("draw"), true); restored.advance(10);
  assert.equal(restored.state.snapshot().fieldRandom!.draws, before.owned.fieldRandom!.draws + 2);
  assert.equal(h.game.state.snapshot().fieldRandom!.draws, before.owned.fieldRandom!.draws + 1);
});

test("late Task creation, clocking, content changes and legacy actor changes are all candidate mutations", async () => {
  for (const kind of ["task", "clock", "content", "actor"] as const) {
    const h = await setup(), before = baseline(h.game), candidate = h.game.world.prepare(h.catalog, h.target);
    if (kind === "task") assert.equal(candidate.field.startEvent("pass"), true);
    if (kind === "clock") { assert.equal(candidate.field.startEvent("wait"), true); candidate.field.advance(10); }
    if (kind === "content") candidate.field.content.scripts.pass![0]!.index++;
    if (kind === "actor") candidate.field.player.direction = candidate.field.player.direction === "left" ? "right" : "left";
    assert.equal(h.game.world.commit(candidate), false); unchanged(h.game, before);
  }
});

test("the original EventState owner also rejects write-back ABA during media preparation", async () => {
  const h = await setup(), before = baseline(h.game), candidate = h.game.world.prepare(h.catalog, h.target);
  const old = h.game.field.eventState.read(ref); h.game.field.eventState.write(ref, 8); h.game.field.eventState.write(ref, old);
  assert.deepEqual(h.game.field.eventState.snapshot(), before.events);
  assert.equal(h.game.world.commit(candidate), false); unchanged(h.game, before);
});

test("the existing owned draft generation is sealed even when an inventory transaction returns to the same value", () => {
  const f = checkpointFixture(), state = new GameState(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  let draft: ReturnType<GameState["prepareFieldState"]> | undefined;
  const world = new WorldSession(f.field, EventState.initialized(), { current: {}, prepare: () => {
    draft = state.prepareFieldState(); return draft;
  } });
  const point = f.target.map!.entities.find(entity => entity.kind === 0)!;
  world.field.previewMap(f.target.mapId, point.objectId!);
  const before = state.snapshot(), field = world.field, request = field.stop, candidate = world.prepare(f.world, f.target);
  assert.ok(draft); const candidateEvents = candidate.field.eventState.snapshot();
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  draft.ports.inventory.prepare({ kind: "pay-gil", amount: 1 }).commit();
  assert.deepEqual(candidate.field.eventState.snapshot(), candidateEvents);
  assert.equal(world.commit(candidate), false); assert.equal(draft.commit(), false);
  assert.deepEqual(state.snapshot(), before); assert.equal(world.field, field); assert.equal(field.stop, request);
  const retry = world.prepare(f.world, f.target); assert.equal(world.commit(retry), true);
  assert.deepEqual(state.snapshot(), before); assert.equal(world.field, retry.field);
});
