import test from "node:test";
import assert from "node:assert/strict";
import { logicalWorldEffectsFixture } from "./fixtures/logical-world-effects.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameSession } from "../src/core/game-session.js";
import { createWebLogicalFieldEffectsHost } from "../src/core/field-logical-effects.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
const ready = { visible: true, mediaReady: true, overlayOpen: false };
async function fixture(options: Parameters<typeof logicalWorldEffectsFixture>[0] = {}) {
  const f = await logicalWorldEffectsFixture(options), game = await f.make(), flow = new GameFlow(game);
  flow.start(); flow.observeHost(ready); flow.advance(10, ready);
  assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  const commands = new GameCommands(flow, game), files = new Map<string, unknown>([
    ["/framework/world/catalog.json", f.world], ...f.maps.map(map => [f.world.maps[map.mapId]!.url, map] as [string, unknown]),
  ]);
  const refs = { kind: "game-content-refs-v2" as const, profile: "framework" as const,
    world: { url: "/framework/world/catalog.json", contentHash: f.world.contentHash }, source: null, development: null,
    initialized: { entry: { url: "/framework/logical-entry.json", contentHash: f.content.contentHash },
      battle: { url: "/framework/logical-battle.json", contentHash: f.battle.contentHash } } };
  files.set(refs.initialized.entry.url, f.content); files.set(refs.initialized.battle.url, f.battle);
  const repository = new GameContentRepository(async url => {
    assert.ok(files.has(url), "Unknown authored logical-world dependency: " + url); return files.get(url);
  }, "framework", refs);
  return { f, game, flow, commands, repository };
}
test("one native session saves and restores an active all-loop owner without replaying its map setup", async () => {
  const { f, game } = await fixture();
  game.advance(90); const field = game.field, state = field.fieldEffectsSnapshot!, owned = game.state.snapshot();
  assert.equal(state.instanceCount, 1); assert.equal(state.players[0]!.playing, true);
  const checkpoint = game.checkpoint(); assert.equal(checkpoint.world.kind, "idle-world-v11");
  assert.equal(checkpoint.world.logicalEffects!.state.players[0]!.cameraId, 1);
  const restored = f.restore(checkpoint);
  assert.deepEqual(restored.checkpoint(), checkpoint); assert.deepEqual(restored.state.snapshot(), owned);
  assert.deepEqual(restored.field.fieldEffectsSnapshot, state);
  restored.advance(10); assert.ok(restored.field.fieldEffectsSnapshot!.players[0]!.elapsedSec > state.players[0]!.elapsedSec);
  assert.equal(restored.field.fieldEffectsSnapshot!.instanceCount, 1);
  assert.deepEqual(game.field.fieldEffectsSnapshot, state, "Restored ticks cannot touch the former owner");
});
test("stable restore does not even prepare a replacement particle/display candidate or replay source setup", async () => {
  const { f, game } = await fixture(); game.advance(50); const checkpoint = game.checkpoint();
  const actual = createWebLogicalFieldEffectsHost(); let prepares = 0, branches = 0;
  const runtime = { ...f.runtime, fieldEffects: { ...actual,
    prepare(...args: Parameters<typeof actual.prepare>) { prepares++; return actual.prepare(...args); },
    beginCandidate(...args: Parameters<NonNullable<typeof actual.beginCandidate>>) { branches++; return actual.beginCandidate!(...args); },
  } };
  const restored = GameSession.restore(checkpoint, undefined, f.battle, { catalog: f.world, map: f.map,
    initialized: { content: f.content, initialMap: f.map } }, runtime);
  assert.equal(prepares, 0); assert.equal(branches, 0);
  assert.deepEqual(restored.checkpoint(), checkpoint); assert.deepEqual(game.checkpoint(), checkpoint);
  restored.advance(10); assert.equal(prepares, 1); assert.equal(branches, 0);
  assert.equal(restored.field.fieldEffectsSnapshot!.instanceCount, 1);
});
test("cancelled, media-failed and retried map candidates preserve the same owner then allocate one next camera", async () => {
  const { f, game, flow, repository } = await fixture(), first = game.field;
  assert.equal(flow.move("right"), true); flow.advance(240, ready);
  assert.equal(first.stop?.kind, "map-transition");
  const before = game.state.snapshot(), fx = first.fieldEffectsSnapshot;
  let fail = true, release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
  let hold = false;
  const loader = new GameMapLoader(flow, repository, { prepare: async () => {
    if (hold) { entered(); await held; } if (fail) throw new Error("Controlled logical map media failure"); return null;
  }, discard() {} });
  assert.equal((await loader.load()).status, "failed");
  assert.equal(game.field, first); assert.deepEqual(first.fieldEffectsSnapshot, fx); assert.deepEqual(game.state.snapshot(), before);
  fail = false; hold = true; const pending = loader.load(); await reached; loader.cancel(); release();
  assert.equal((await pending).status, "cancelled"); assert.deepEqual(first.fieldEffectsSnapshot, fx); assert.deepEqual(game.state.snapshot(), before);
  hold = false; assert.equal((await loader.load()).status, "committed"); flow.advance(10, ready);
  const second = game.field; assert.notEqual(second, first); assert.equal(second.fieldEffectsSnapshot!.instanceCount, 2);
  assert.equal(second.fieldEffectsSnapshot!.players[0]!.cameraId, 2);
  assert.equal(first.fieldEffectsSnapshot!.players[0]!.cameraId, 1);
  const retired = Reflect.get(first, "effects") as { prepareTick(seconds: number): unknown };
  assert.throws(() => retired.prepareTick(.01), /Retired|retired/);
  const saved = game.checkpoint(), restored = f.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
});
test("effect history survives an empty map and source initializer failure never publishes a partial FX candidate", async () => {
  const h = await fixture({ emptyTarget: true }), first = h.game.field;
  first.startEvent("go-world"); const candidate = h.game.world.prepare(h.f.world, h.f.worldMap);
  assert.equal(h.game.world.commit(candidate), true); h.flow.advance(10, ready);
  assert.equal(h.game.field.fieldEffectsSnapshot, null); assert.equal(h.game.checkpointReady, true);
  const saved = h.game.checkpoint(); assert.equal(saved.world.logicalEffects!.state.instanceCount, 1);
  assert.equal(saved.world.logicalEffects!.state.players.length, 0);
  const restored = h.f.restore(saved); assert.deepEqual(restored.checkpoint(), saved);
  restored.field.startEvent("world-return"); const back = restored.world.prepare(h.f.world, h.f.map);
  assert.equal(restored.world.commit(back), true); restored.advance(10);
  assert.equal(restored.field.fieldEffectsSnapshot!.instanceCount, 2);
  const bad = await fixture({ initializationFailure: true }), before = bad.game.state.snapshot(), fx = bad.game.field.fieldEffectsSnapshot;
  bad.game.field.startEvent("go-world"); assert.throws(() => bad.game.world.prepare(bad.f.world, bad.f.worldMap), /initializer failed/);
  assert.deepEqual(bad.game.state.snapshot(), before); assert.deepEqual(bad.game.field.fieldEffectsSnapshot, fx);
});
test("source-owned board visibility and positive animation completion actually advance through the existing VM", async () => {
  const { game } = await fixture(); assert.equal(game.field.startEvent("fx-play"), true);
  for (let i = 0; i < 100 && game.field.busy && !game.field.stop; i++) game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.field.busy, false);
  assert.equal(game.field.fieldEffectsSnapshot!.boards[0]!.activeSelf, false);
  assert.equal(game.field.fieldEffectsSnapshot!.players[0]!.playing, false);
  assert.equal(game.field.fieldEffectsSnapshot!.players[0]!.loopCount, 1);
  assert.equal(game.checkpointReady, true);
});
test("actual Repository, storage and entry publication restore one logical manager and revoke former commands", async () => {
  const { f, game, flow, commands, repository } = await fixture(); game.advance(70);
  const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", "logical-effects");
  const saved = game.checkpoint(); await storage.save(saved, 100);
  const loaded = (await storage.load())!.checkpoint, loader = new GameEntryLoader<null>(flow, { discard() {} });
  const result = await loader.begin("load").prepare(async () => {
    const dependencies = await repository.restoreSessionContent(loaded);
    return { session: GameSession.restore(loaded, dependencies.initial, dependencies.battle, dependencies.world, f.runtime), presentation: null };
  });
  assert.equal(result.status, "committed");
  assert.notEqual(flow.currentSession, game); assert.equal(commands.menuReady, false);
  assert.deepEqual(flow.currentSession!.checkpoint(), loaded);
  assert.deepEqual(game.checkpoint(), saved);
  const missingHost = await repository.restoreSessionContent(loaded);
  assert.throws(() => GameSession.restore(loaded, missingHost.initial, missingHost.battle, missingHost.world), /runtime host/);
  const forged = structuredClone(loaded); forged.world.logicalEffects!.state.boards[0]!.definition.assetId++;
  assert.throws(() => f.restore(forged), /board\/source/);
});
test("event-save quota failure/retry and restored continuation preserve the active pool without grant replay", async () => {
  const h = await fixture(); h.game.field.startEvent("go-world");
  const next = h.game.world.prepare(h.f.world, h.f.worldMap); h.game.world.commit(next); h.flow.advance(10, ready);
  const baselineCount = h.game.state.snapshot().items.find(i => i.id === 701)!.count;
  h.game.field.startEvent("world-save"); assert.ok(h.game.eventSaveRequest);
  const fx = h.game.field.fieldEffectsSnapshot, request = h.game.eventSaveRequest, bytes = new Map<string, string>(); let fail = true;
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error("Controlled quota failure"); bytes.set(key, value); } });
  const coordinator = new GameEventSaveCoordinator(h.flow, storage);
  assert.equal((await coordinator.save(100)).status, "failed");
  assert.equal(h.game.eventSaveRequest, request); assert.deepEqual(h.game.field.fieldEffectsSnapshot, fx);
  fail = false; assert.equal((await coordinator.save(101)).status, "committed");
  const saved = (await storage.load())!.checkpoint; assert.equal(saved.world.kind, "event-world-v2");
  const restored = h.f.restore(saved); assert.deepEqual(restored.field.fieldEffectsSnapshot, fx);
  restored.advance(10); assert.equal(restored.field.stop, null); assert.equal(restored.checkpointReady, true);
  assert.equal(restored.state.snapshot().items.find(i => i.id === 701)!.count, baselineCount + 2);
  const camera = restored.field.fieldEffectsSnapshot!.players[0]!.cameraId;
  restored.advance(10); assert.equal(restored.state.snapshot().items.find(i => i.id === 701)!.count, baselineCount + 2);
  assert.equal(restored.field.fieldEffectsSnapshot!.players[0]!.cameraId, camera);
});
test("prepared battle handoff fences FX changes and preserves the same paused pool across one settlement", async () => {
  const h = await fixture(); h.game.field.startEvent("fx-battle"); h.flow.advance(10, ready);
  assert.equal(h.game.field.stop?.kind, "encounter"); const field = h.game.field, owned = h.game.state.snapshot();
  let invalidate = true;
  const lease = Reflect.get(field, "effects") as { prepareTick(seconds: number): { commit(): void } };
  const battleHost = new GameBattleHandoff(h.flow, { prepareStart: async () => {
    if (invalidate) { invalidate = false; lease.prepareTick(.01).commit(); } return null;
  }, prepareReturn: async () => null, discard() {} });
  assert.equal((await battleHost.start()).status, "failed"); assert.equal(h.game.battle, null);
  assert.equal(h.game.state.inBattle, false); assert.deepEqual(h.game.state.snapshot(), owned);
  assert.equal((await battleHost.start()).status, "committed");
  const fx = field.fieldEffectsSnapshot!, battle = h.game.battle!;
  for (let i = 0; i < 5000 && battle.phase === "active"; i++) {
    for (const actor of battle.ready) { const target = battle.enemies.find(e => e.hp > 0);
      if (target) h.commands.command(battle, actor.id, 10, target.id, 100); }
    h.flow.advance(10, ready);
  }
  assert.equal(battle.phase, "victory"); assert.deepEqual(field.fieldEffectsSnapshot, fx, "Explicit Web field FX clock pauses during battle");
  assert.equal((await battleHost.return()).status, "committed"); assert.equal(h.game.field, field);
  assert.deepEqual(field.fieldEffectsSnapshot, fx); assert.equal(h.game.state.snapshot().completedBattles.length, 1);
  h.flow.advance(10, ready); assert.equal(h.game.field.stop, null); assert.equal(h.game.checkpointReady, true);
  assert.equal(field.fieldEffectsSnapshot!.players[0]!.cameraId, fx.players[0]!.cameraId);
  assert.ok(field.fieldEffectsSnapshot!.players[0]!.elapsedSec > fx.players[0]!.elapsedSec);
  assert.equal(h.game.continueVictory(), false);
});

test("a destination cannot drop the global logical catalog or Web marker even when it has no boards", async () => {
  for (const unboundTarget of ["profile", "catalog"] as const) {
    const h = await fixture({ emptyTarget: true, unboundTarget }), before = h.game.checkpoint(), owner = h.game.field, fx = owner.fieldEffectsSnapshot;
    owner.startEvent("go-world");
    assert.throws(() => h.game.world.prepare(h.f.world, h.f.worldMap), /logical effect catalog\/profile|profile mismatch/);
    assert.equal(h.game.field, owner); assert.deepEqual(h.game.state.snapshot(), before.owned);
    assert.deepEqual(h.game.field.fieldEffectsSnapshot, fx);
  }
});

test("source Encount and the actual logical FX owner share media pause, cancel/retry, settlement and restore", async () => {
  const h = await fixture({ sourceEncounter: true }), field = h.game.field;
  assert.equal(field.startEvent("fx-battle"), true); h.flow.advance(10, ready);
  const request = field.stop; assert.equal(request?.kind, "encounter"); assert.ok(request?.sourceEncounter);
  const captured = structuredClone(request), effects = field.fieldEffectsSnapshot,
    native = field.nativeActorStateFingerprint, owned = h.game.state.snapshot(), fieldTime = field.time;
  assert.equal(h.game.checkpointReady, false);
  const failed = new GameBattleHandoff(h.flow, { prepareStart: async () => { throw new Error("Controlled source-FX media failure"); },
    prepareReturn: async () => null, discard() {} });
  assert.equal((await failed.start()).status, "failed");
  assert.deepEqual(field.fieldEffectsSnapshot, effects); assert.deepEqual(h.game.state.snapshot(), owned);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new GameBattleHandoff(h.flow, { prepareStart: async () => { enter(); await held; return null; },
    prepareReturn: async () => null, discard() {} });
  const pending = waiting.start(); await entered;
  for (let i = 0; i < 8; i++) h.flow.advance(20, ready);
  assert.equal(field.time, fieldTime); assert.deepEqual(field.fieldEffectsSnapshot, effects);
  assert.equal(field.nativeActorStateFingerprint, native); assert.deepEqual(request, captured);
  waiting.cancel(); release(); assert.equal((await pending).status, "cancelled");
  assert.deepEqual(field.fieldEffectsSnapshot, effects); assert.deepEqual(h.game.state.snapshot(), owned);
  const battleHost = new GameBattleHandoff(h.flow, { prepareStart: async () => null, prepareReturn: async () => null, discard() {} });
  assert.equal((await battleHost.start()).status, "committed"); const battle = h.game.battle!;
  for (let i = 0; i < 2000 && battle.phase === "active"; i++) {
    for (const actor of battle.ready) { const target = battle.enemies.find(enemy => enemy.hp > 0); if (target)
      h.commands.command(battle, actor.id, 10, { kind: "single", id: target.id }, 100); }
    h.flow.advance(20, ready);
  }
  assert.equal(battle.phase, "victory"); assert.deepEqual(field.fieldEffectsSnapshot, effects);
  assert.equal((await battleHost.return()).status, "committed");
  h.flow.advance(10, ready); assert.equal(h.game.field, field); assert.equal(h.game.checkpointReady, true);
  assert.equal(h.game.state.snapshot().completedBattles.length, 1);
  assert.equal(field.fieldEffectsSnapshot!.instanceCount, effects!.instanceCount);
  assert.equal(field.fieldEffectsSnapshot!.players[0]!.cameraId, effects!.players[0]!.cameraId);
  const saved = h.game.checkpoint(), restored = h.f.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved); const old = field.fieldEffectsSnapshot;
  restored.advance(10); assert.deepEqual(field.fieldEffectsSnapshot, old);
  assert.equal(restored.state.snapshot().completedBattles.length, 1);
  assert.equal(restored.field.fieldEffectsSnapshot!.instanceCount, 1);
});
