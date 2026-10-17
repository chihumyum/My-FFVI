import test from "node:test";
import assert from "node:assert/strict";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { selectWebSourceEncounter } from "../src/core/source-encounter-entry.js";
import { sourceEncounterSessionFixture, encounterReady } from "./fixtures/source-encounter-session.js";

function defer<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function begin(f: ReturnType<typeof sourceEncounterSessionFixture>, name = "source-fight") {
  const live = f.make(); assert.equal(live.game.field.startEvent(name), true);
  for (let i = 0; i < 100 && !live.game.field.stop; i++) live.flow.advance(10, encounterReady);
  return live;
}
function encounterRequest(field: ReturnType<typeof begin>["game"]["field"]) {
  const stop = field.stop; assert.ok(stop?.kind === "encounter", stop?.message); return stop;
}
function snapshot(game: ReturnType<typeof sourceEncounterSessionFixture>["make"] extends () => infer T
  ? T extends { game: infer G } ? G : never : never) {
  return structuredClone({ owned: game.state.snapshot(), native: game.field.nativeActorStateFingerprint,
    camera: game.field.cameraSnapshot, stop: game.field.stop, events: game.field.eventState.snapshot() });
}
const host = { prepareStart: async () => ({ kind: "start" }), prepareReturn: async () => ({ kind: "return" }), discard() {} };
function win(live: ReturnType<typeof begin>) {
  const battle = live.game.battle!;
  for (let i = 0; i < 2000 && battle.phase === "active"; i++) {
    for (const actor of battle.ready) {
      const target = battle.enemies.find(unit => unit.hp > 0); if (!target) break;
      live.commands.command(battle, actor.id, 10, { kind: "single", id: target.id }, 100);
    }
    live.flow.advance(20, encounterReady);
  }
  assert.equal(battle.phase, "victory"); return battle;
}

test("Web source lottery retains repeated physical slots and the session's saved seed/serial", () => {
  const command = { kind: "source-encounter" as const, slots: [63, 63, 63, 47] as [number, number, number, number],
    effectId: 7, continuation: "original-next", footCapture: "before-player-sync" as const };
  const counts = [0, 0, 0, 0];
  for (let seed = 0; seed < 256; seed++) {
    const chosen = selectWebSourceEncounter(command, seed, 0); counts[chosen.slotIndex]!++;
    assert.equal(chosen.partyId, command.slots[chosen.slotIndex]);
    assert.equal(chosen.effectId, 7); assert.equal(chosen.continuation, "original-next");
    assert.deepEqual(chosen, selectWebSourceEncounter(structuredClone(command), seed, 0));
  }
  assert.deepEqual(counts, [64, 64, 64, 64]);
  assert.throws(() => selectWebSourceEncounter(command, NaN, 0));
});

test("source request captures pre-sync foot once; failed/cancelled media keeps actors and retry joins one battle", async () => {
  const f = sourceEncounterSessionFixture(), live = begin(f), { game, flow } = live, field = game.field;
  assert.equal(field.stop?.kind, "encounter", field.stop?.message);
  const request = encounterRequest(field), before = snapshot(game), player = field.player, native = player.native!, entity = native.entity;
  assert.notDeepEqual(entity.position, field.cameraSnapshot!.dummy.position, "the authored camera task actually moved only the dummy");
  const chosen = structuredClone(request.sourceEncounter!), originalDirection = entity.direction,
    originalAnimation = entity.animation!.snapshot(), originalView = structuredClone(entity.viewBinding);
  assert.deepEqual(chosen.foot.player.position, entity.position);
  let fail = true;
  const handoff = new GameBattleHandoff(flow, { ...host, prepareStart: async () => {
    if (fail) throw new Error("Controlled media failure"); return { kind: "start" }; } });
  assert.equal((await handoff.start()).status, "failed");
  assert.deepEqual(snapshot(game), before); assert.equal(game.state.inBattle, false);
  const media = defer<{ kind: string }>(), cancellable = new GameBattleHandoff(flow,
    { ...host, prepareStart: () => media.promise });
  const pending = cancellable.start(); cancellable.cancel(); media.resolve({ kind: "start" });
  assert.equal((await pending).status, "cancelled"); assert.deepEqual(snapshot(game), before);
  fail = false; assert.equal((await handoff.start()).status, "committed");
  assert.equal(field.player, player); assert.equal(player.native, native); assert.equal(native.entity, entity);
  assert.deepEqual(entity.position, field.cameraSnapshot!.dummy.position);
  assert.equal(entity.layer, field.cameraSnapshot!.dummy.layer);
  assert.equal(entity.direction, originalDirection); assert.deepEqual(entity.animation!.snapshot(), originalAnimation);
  assert.deepEqual(entity.viewBinding, originalView, "direct layer copy does not run a material refresh");
  assert.deepEqual(request.sourceEncounter, chosen); assert.equal(game.canEscape, false);
  const battle = win(live); assert.equal((await handoff.return()).status, "committed");
  assert.equal(game.state.completedEncounters.length, 1); assert.equal(game.battle, null);
  for (let i = 0; i < 50 && !game.checkpointReady; i++) flow.advance(10, encounterReady);
  assert.equal(game.checkpointReady, true, field.stop?.message);
  assert.equal(field.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  await assert.rejects(() => handoff.return(), /requires/, "a settled request cannot publish rewards twice");
  const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", "source-encounter-synthetic");
  await storage.save(game.checkpoint(), 1000); const saved = (await storage.load())!;
  const restored = f.restore(saved.checkpoint), restoredFlow = new GameFlow(restored); restoredFlow.start(); restoredFlow.advance(0, encounterReady);
  assert.deepEqual(restored.checkpoint(), saved.checkpoint);
  const restoredCommands = new GameCommands(restoredFlow, restored);
  assert.equal(live.commands.command(battle, game.players[0]!.id, 10, "retired-target", 100), false);
  assert.equal(restored.field.startEvent("source-next"), true);
  assert.equal(restored.field.stop?.kind, "encounter", restored.field.stop?.message);
  const next = encounterRequest(restored.field).sourceEncounter!;
  assert.deepEqual(next.selection, selectWebSourceEncounter(next.command, restored.seed, 1));
  const second = new GameBattleHandoff(restoredFlow, host); assert.equal((await second.start()).status, "committed");
  win({ game: restored, flow: restoredFlow, commands: restoredCommands });
  assert.equal((await second.return()).status, "committed"); restoredFlow.advance(100, encounterReady);
  assert.equal(restored.state.completedEncounters.length, 2); assert.equal(restored.checkpointReady, true);
});

test("source entry validates exact player/camera and pending command before opening a lease", () => {
  for (const mutate of [
    (field: ReturnType<typeof begin>["game"]["field"]) => { field.player.native!.entity.position.x += 16; },
    (field: ReturnType<typeof begin>["game"]["field"]) => { encounterRequest(field).sourceEncounter!.command.slots[0] = 999; },
    (field: ReturnType<typeof begin>["game"]["field"]) => { field.player.native!.entity = { ...field.player.native!.entity, position: { ...field.player.native!.entity.position } }; },
  ]) {
    const f = sourceEncounterSessionFixture(), { game } = begin(f); mutate(game.field); const before = snapshot(game);
    assert.throws(() => game.prepareBattleStart(), /Stale/); assert.equal(game.state.inBattle, false);
    assert.deepEqual(snapshot(game), before); assert.equal(game.battle, null);
  }
});

test("a source pool never hides an unavailable secondary behind a selected ready primary", () => {
  const f = sourceEncounterSessionFixture({ slots: [1000, 1000, 1000, 999999] }), { game } = begin(f);
  assert.equal(game.field.stop?.kind, "encounter", game.field.stop?.message);
  const before = snapshot(game); assert.throws(() => game.prepareBattleStart(), /candidate 999999 is unavailable/);
  assert.deepEqual(snapshot(game), before); assert.equal(game.state.inBattle, false);
});

test("unknown source policy or pre-entry FootInfo never borrows an arbitrary default", () => {
  const f = sourceEncounterSessionFixture({ policy: false }), { game } = begin(f);
  assert.equal(game.field.stop?.kind, "unsupported"); assert.match(game.field.stop!.message, /explicit|Source encounter/i);
  assert.equal(game.state.inBattle, false); assert.equal(game.battle, null);
  const second = sourceEncounterSessionFixture(); delete second.map.map!.entryContext;
  // Declared content mutation precedes launch and must be refused rather than
  // interpreting a qualification scalar/default background as nullable info.
  const live = begin(second); assert.equal(live.game.field.stop?.kind, "unsupported");
  assert.match(live.game.field.stop!.message, /FootInfo|foot/i);
});

test("ordinary legacy encounter remains compatible without source selector or new checkpoint fields", async () => {
  const f = sourceEncounterSessionFixture({ policy: false }), live = begin(f, "legacy-fight");
  assert.equal(encounterRequest(live.game.field).sourceEncounter, undefined);
  const handoff = new GameBattleHandoff(live.flow, host); assert.equal((await handoff.start()).status, "committed");
  win(live); assert.equal((await handoff.return()).status, "committed"); live.flow.advance(100, encounterReady);
  const saved = live.game.checkpoint(); assert.equal(saved.formatVersion, 5);
  assert.equal(Object.hasOwn(saved, "sourceEncounter"), false); assert.deepEqual(f.restore(saved).checkpoint(), saved);
});

test("defeat retries the fixed entry and frozen lease without selecting or syncing another request", async () => {
  const f = sourceEncounterSessionFixture({ lethalEnemy: true }), live = begin(f), handoff = new GameBattleHandoff(live.flow, host);
  assert.equal(live.flow.pause(true), true);
  assert.equal(live.commands.menu({ kind: "set-preferences", preferences: { mode: "active", speedIndex: 2 } }), true);
  assert.equal(live.flow.pause(false), true);
  assert.equal((await handoff.start()).status, "committed");
  const request = live.game.field.stop, captured = structuredClone(request), position = { ...live.game.field.player.native!.entity.position };
  for (let i = 0; i < 3000 && live.game.battle!.phase === "active"; i++) live.flow.advance(50, encounterReady);
  assert.equal(live.game.battle!.phase, "defeat"); const defeated = live.game.battle;
  assert.equal((await handoff.retry()).status, "committed");
  assert.notEqual(live.game.battle, defeated); assert.equal(live.game.field.stop, request);
  assert.deepEqual(request, captured); assert.deepEqual(live.game.field.player.native!.entity.position, position);
  assert.equal(live.game.state.completedEncounters.length, 0); assert.equal(live.game.state.snapshot().completedBattles.length, 0);
  win(live); assert.equal((await handoff.return()).status, "committed"); live.flow.advance(100, encounterReady);
  assert.equal(live.game.state.completedEncounters.length, 1);
});


test("media preparation cannot publish an entry after its exact actor or camera owner changes", async () => {
  for (const change of ["actor", "camera"] as const) {
    const f = sourceEncounterSessionFixture(), live = begin(f), before = live.game.state.snapshot();
    const handoff = new GameBattleHandoff(live.flow, { ...host, prepareStart: async () => {
      if (change === "actor") live.game.field.player.native!.entity.position.x += 16;
      else {
        const camera = Reflect.get(live.game.field, "camera");
        camera.prepareState(camera.snapshot()).commit(); // equal values, changed owner revision
      }
      return { kind: "start" };
    } });
    const result = await handoff.start(); assert.equal(result.status, "failed");
    assert.deepEqual(live.game.state.snapshot(), before); assert.equal(live.game.state.inBattle, false);
    assert.equal(live.game.battle, null); assert.equal(live.game.field.stop?.kind, "encounter");
  }
});
