import assert from "node:assert/strict";
import test from "node:test";
import { fieldShakeSessionFixture, shakeHostReady } from "./fixtures/field-shake-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { canonical } from "../src/core/canonical.js";
import { GameCommands } from "../src/core/game-commands.js";
const shake = (game: Awaited<ReturnType<Awaited<ReturnType<typeof fieldShakeSessionFixture>>["make"]>>["game"]) => {
  const value = game.field.storyRuntimeSnapshot;
  assert.equal(value?.kind, "web-field-story-runtime-v2");
  if (value?.kind !== "web-field-story-runtime-v2") throw new Error("Missing shake runtime");
  return value.cameraShake;
};
const projection = { aspect: 1.5, orthographicSize: 80, isClamp: true, effectOffset: { x: 0, y: 0 } };

test("native camera shake only changes effect projection and continues through real menu/storage restore", async () => {
  const f = await fieldShakeSessionFixture(), { game, flow } = await f.make(), field = game.field,
    actor = field.player, native = actor.native!.entity, camera = field.cameraSnapshot, owned = game.state.snapshot(),
    root = field.cameraProjection(projection)!;
  assert.equal(field.startEvent("shake-play"), true); flow.advance(120, shakeHostReady);
  const moving = field.cameraProjection(projection)!;
  assert.notDeepEqual(field.cameraShakeOffset, { x: 0, y: 0 }); assert.notDeepEqual(moving.cameraPosition, root.cameraPosition);
  assert.deepEqual(moving.position, root.position); assert.deepEqual(field.cameraSnapshot, camera);
  assert.strictEqual(field.player, actor); assert.strictEqual(actor.native!.entity, native);
  assert.deepEqual(game.state.snapshot(), owned);
  const playing = canonical(shake(game)); assert.equal(flow.pause(true), true); flow.advance(5000, shakeHostReady);
  assert.equal(canonical(shake(game)), playing); assert.equal(game.checkpointReady, true);
  const data = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); } }, "framework", "shake-save");
  const checkpoint = game.checkpoint(); await storage.save(checkpoint, 100); const saved = (await storage.load())!;
  const restored = f.restore(saved.checkpoint), restoredFlow = new GameFlow(restored);
  restoredFlow.start(); restoredFlow.advance(0, shakeHostReady);
  assert.deepEqual(restored.checkpoint(), checkpoint); assert.deepEqual(shake(restored), shake(game));
  assert.equal(flow.pause(false), true);
  for (const ms of [10, 17, 3, 100, 70, 25, 15]) { flow.advance(ms, shakeHostReady); restoredFlow.advance(ms, shakeHostReady); }
  assert.deepEqual(shake(restored), shake(game)); assert.deepEqual(restored.field.cameraShakeOffset, field.cameraShakeOffset);
  assert.equal(restored.field.startEvent("shake-stop"), true); assert.deepEqual(restored.field.cameraShakeOffset, { x: 0, y: 0 });
  restoredFlow.advance(1000, shakeHostReady); assert.equal(shake(restored).active, null);
  assert.ok(shake(game).active, "the restored owner cannot stop its previous field");
});

test("missing host and forged policy/origin cannot acquire camera capability from a save", async () => {
  const absent = await fieldShakeSessionFixture({ policy: false }), missing = await absent.make(),
    before = missing.game.state.snapshot(), camera = missing.game.field.cameraSnapshot;
  assert.equal(missing.game.field.startEvent("shake-play"), true);
  assert.equal(missing.game.field.stop?.kind, "unsupported"); assert.match(missing.game.field.stop!.message, /camera|policy|provider/i);
  assert.deepEqual(missing.game.state.snapshot(), before);
  // The existing event-start lifecycle legitimately selects the dummy before
  // reaching this unsupported instruction. Shake itself publishes no offset
  // or dummy pose, and does not roll back already completed source operations.
  assert.deepEqual(missing.game.field.cameraSnapshot!.dummy, camera!.dummy);
  assert.deepEqual(missing.game.field.cameraShakeOffset, { x: 0, y: 0 });
  const f = await fieldShakeSessionFixture(), live = await f.make(); live.game.field.startEvent("shake-play");
  live.flow.advance(100, shakeHostReady); const saved = live.game.checkpoint(), prior = canonical(saved);
  assert.throws(() => f.restore(saved, f.map, { battleHandoff: "prepared" }), /policy/);
  for (const key of ["webPc", "mapContentHash"] as const) {
    const forged = structuredClone(saved), runtime = forged.world.field;
    if (!("storyRuntime" in runtime) || runtime.storyRuntime.kind !== "web-field-story-runtime-v2") throw new Error("Expected shake save");
    if (key === "webPc") runtime.storyRuntime.cameraShake.active!.binding.webPc = 99;
    else runtime.storyRuntime.cameraShake.active!.binding.mapContentHash = "f".repeat(64);
    assert.throws(() => f.restore(forged), /origin|trusted|source|binding/i);
  }
  assert.equal(canonical(live.game.checkpoint()), prior);
});

test("the event-save barrier retains active shake without replaying its instruction or taking another draw", async () => {
  const f = await fieldShakeSessionFixture(), { game, flow } = await f.make();
  game.field.startEvent("shake-event-save"); const request = game.eventSaveRequest; assert.ok(request);
  const prepared = game.prepareEventSave(request), saved = prepared.checkpoint;
  assert.equal(saved.world.field.kind, "event-field-v4"); const before = shake(game);
  flow.advance(1000, shakeHostReady); assert.deepEqual(shake(game), before);
  const restored = f.restore(saved), replay = new GameFlow(restored); replay.start(); replay.advance(10, shakeHostReady);
  assert.equal(restored.eventSaveRequest, null); assert.equal(restored.checkpointReady, true);
  assert.equal(shake(restored).samples, 0); assert.equal(shake(restored).active!.binding.webPc, 0);
  prepared.commitWith(() => {}); flow.advance(10, shakeHostReady); assert.deepEqual(shake(restored), shake(game));
});

test("candidate cancel/stale/retry retires the old shake only when the new native map publishes", async () => {
  const f = await fieldShakeSessionFixture(), { game, flow } = await f.make();
  game.field.startEvent("shake-play"); flow.advance(70, shakeHostReady);
  const old = game.field, before = canonical(old.storyRuntimeSnapshot), actor = old.player, native = actor.native!.entity;
  old.previewMap(f.secondMap.mapId, f.content.entry.entrance);
  const cancelled = game.world.prepare(f.world, f.secondMap); assert.deepEqual(cancelled.field.cameraShakeOffset, { x: 0, y: 0 });
  game.world.discard(cancelled); assert.equal(game.world.commit(cancelled), false);
  assert.strictEqual(game.field, old); assert.equal(canonical(old.storyRuntimeSnapshot), before);
  assert.strictEqual(old.player, actor); assert.strictEqual(actor.native!.entity, native);
  const stale = game.world.prepare(f.world, f.secondMap);
  assert.equal(stale.field.startEvent("shake-play"), true);
  assert.equal(game.world.commit(stale), false); assert.strictEqual(game.field, old);
  const accepted = game.world.prepare(f.world, f.secondMap); assert.equal(game.world.commit(accepted), true);
  flow.advance(10, shakeHostReady); assert.notStrictEqual(game.field, old);
  assert.deepEqual(game.field.cameraShakeOffset, { x: 0, y: 0 });
  assert.equal(canonical(old.storyRuntimeSnapshot), before, "retirement must not reset the former owner");
  assert.equal(game.field.startEvent("shake-play"), true); flow.advance(70, shakeHostReady);
  const saved = game.checkpoint(), restored = f.restore(saved, f.secondMap); assert.deepEqual(restored.checkpoint(), saved);
});

test("battle media failure/cancel/retry freezes one field stream and return prepares its re-execute once", async () => {
  for (const reexecute of [0, 30]) {
    const f = await fieldShakeSessionFixture({ reexecute }), { game, flow, commands } = await f.make();
    game.field.startEvent("shake-play"); flow.advance(70, shakeHostReady); game.field.startEvent("shake-fight");
    flow.advance(10, shakeHostReady); assert.equal(game.field.stop?.kind, "encounter");
    const field = game.field, frozen = shake(game), owned = game.state.snapshot();
    let resolve!: () => void, fail = true, waits = 0;
    const handoff = new GameBattleHandoff(flow, { prepareStart: async () => {
      waits++; await new Promise<void>(done => { resolve = done; }); if (fail) throw new Error("controlled media failure"); return {};
    }, prepareReturn: async () => { if (fail) throw new Error("controlled return media failure"); return {}; }, discard() {} });
    const first = handoff.start(); await new Promise<void>(done => setImmediate(done));
    for (let i = 0; i < 12; i++) flow.advance(16, shakeHostReady);
    assert.deepEqual(shake(game), frozen); assert.strictEqual(game.field, field); resolve();
    assert.equal((await first).status, "failed"); assert.deepEqual(game.state.snapshot(), owned);
    const cancelled = handoff.start(); await new Promise<void>(done => setImmediate(done)); handoff.cancel(); resolve();
    assert.equal((await cancelled).status, "cancelled"); assert.deepEqual(shake(game), frozen);
    fail = false; const third = handoff.start(); await new Promise<void>(done => setImmediate(done)); resolve();
    assert.equal((await third).status, "committed"); assert.equal(waits, 3); const battle = game.battle!;
    for (let i = 0; i < 10000 && battle.phase === "active"; i++) {
      for (const player of battle.ready) commands.command(battle, player.id, 10, battle.enemies[0]!.id, 100);
      flow.advance(10, shakeHostReady);
    }
    assert.equal(battle.phase, "victory"); assert.deepEqual(shake(game), frozen);
    fail = true; assert.equal((await handoff.return()).status, "failed"); assert.deepEqual(shake(game), frozen);
    assert.equal(game.state.completedEncounters.length, 0);
    fail = false; assert.equal((await handoff.return()).status, "committed");
    assert.equal(game.state.completedEncounters.length, 1); assert.equal(shake(game).rngState, frozen.rngState);
    assert.deepEqual(field.cameraShakeOffset, { x: 0, y: 0 });
    assert.equal(shake(game).active !== null, reexecute !== 0);
    await assert.rejects(() => handoff.return(), /requires/); assert.equal(game.state.completedEncounters.length, 1);
    flow.advance(100, shakeHostReady);
    assert.equal(game.checkpointReady, true); const restored = f.restore(game.checkpoint());
    assert.deepEqual(restored.checkpoint(), game.checkpoint());
    const nextFlow = new GameFlow(restored); nextFlow.start(); nextFlow.advance(0, shakeHostReady);
    const nextCommands = new GameCommands(nextFlow, restored), nextHandoff = new GameBattleHandoff(nextFlow,
      { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
    restored.field.startEvent("shake-fight"); nextFlow.advance(10, shakeHostReady);
    assert.equal((await nextHandoff.start()).status, "committed"); const nextBattle = restored.battle!;
    assert.equal(commands.command(battle, game.players[0]!.id, 10, "retired", 100), false);
    for (let i = 0; i < 10000 && nextBattle.phase === "active"; i++) {
      for (const player of nextBattle.ready) nextCommands.command(nextBattle, player.id, 10, nextBattle.enemies[0]!.id, 100);
      nextFlow.advance(10, shakeHostReady);
    }
    assert.equal(nextBattle.phase, "victory"); assert.equal((await nextHandoff.return()).status, "committed");
    nextFlow.advance(100, shakeHostReady); assert.equal(restored.state.completedEncounters.length, 2);
  }
});

test("natural defeat and fixed-entry retry do not reset or consume the suspended camera stream", async () => {
  const f = await fieldShakeSessionFixture({ reexecute: 30, lethalEnemy: true }), { game, flow } = await f.make();
  game.field.startEvent("shake-play"); flow.advance(90, shakeHostReady); game.field.startEvent("shake-fight");
  flow.advance(10, shakeHostReady); const field = game.field, actor = field.player, native = actor.native!.entity,
    before = shake(game), owned = game.state.snapshot(), request = structuredClone(field.stop),
    handoff = new GameBattleHandoff(flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, "committed"); const battle = game.battle!;
  for (let i = 0; i < 30000 && battle.phase === "active"; i++) flow.advance(10, shakeHostReady);
  assert.equal(battle.phase, "defeat"); assert.deepEqual(shake(game), before);
  assert.deepEqual(game.state.snapshot(), owned); assert.equal(game.state.completedEncounters.length, 0);
  assert.equal((await handoff.retry()).status, "committed"); assert.notStrictEqual(game.battle, battle);
  assert.deepEqual(field.stop, request); assert.strictEqual(game.field, field); assert.strictEqual(field.player, actor);
  assert.strictEqual(actor.native!.entity, native); assert.deepEqual(shake(game), before);
  assert.deepEqual(game.state.snapshot(), owned); assert.equal(game.state.completedEncounters.length, 0);
});
