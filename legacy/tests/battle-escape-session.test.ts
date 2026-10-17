import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { walkEncounterFixture, walkHost, winWalkEncounter } from "./fixtures/walk-encounter-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const policy = { kind: "framework-battle-escape-v1" as const, id: "synthetic-session-exit" };
function setup() {
  const f = walkEncounterFixture(1);
  f.battle.encounters[1000]!.escapePolicy = { ...policy };
  f.flow.start(); f.flow.advance(0, walkHost);
  assert.equal(f.flow.move("right"), true); f.flow.advance(240, walkHost);
  assert.equal(f.flow.phase, "battle"); return f;
}
function escape(flow: GameFlow) {
  assert.equal(flow.requestEscape(), true); flow.advance(10, walkHost);
  assert.equal(flow.phase, "escaped");
}

test("escape commits resource and row changes once, preserves story state, and is not victory coverage", async () => {
  const { game, flow, field, battle } = setup(), owner = game.field, actor = owner.player;
  const before = game.state.snapshot(), flags = owner.eventState.snapshot();
  // Controlled damage/row inputs; the source integration lane exercises real actions.
  game.battle!.players[0]!.hp = 17; game.battle!.players[0]!.mp = 3; game.battle!.players[0]!.row = "back";
  escape(flow); assert.equal(flow.continueVictory(), false); assert.equal(flow.retryBattle(), false);
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(flow.continueEscape(), true); assert.equal(flow.continueEscape(), false);
  assert.equal(game.field, owner); assert.equal(game.field.player, actor);
  assert.deepEqual(owner.eventState.snapshot(), flags); assert.deepEqual([actor.x, actor.y], [2, 1]);
  assert.deepEqual(game.completedEncounters, []);
  const saved = game.checkpoint();
  assert.equal(saved.encounterSerial, 1);
  assert.deepEqual(saved.owned.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "escaped" }]);
  assert.equal(game.gil, before.gil);
  assert.deepEqual([game.players[0]!.hp, game.players[0]!.mp, game.state.activeParty[0]!.row], [17, 3, "back"]);
  const memory = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => memory.get(k) ?? null,
    setItem: (k, v) => { memory.set(k, v); } }, "framework");
  await storage.save(saved, 1);
  const restored = GameSession.restore((await storage.load())!.checkpoint, field, battle);
  assert.deepEqual(restored.checkpoint(), saved);
  const replay = new GameFlow(restored); replay.start(); replay.advance(0, walkHost);
  for (const current of [flow, replay]) {
    assert.equal(current.move("left"), true); current.advance(240, walkHost);
    winWalkEncounter(current); assert.equal(current.continueVictory(), true);
    assert.deepEqual(current.session.completedEncounters, [1000]);
    assert.deepEqual(current.session.state.snapshot().completedBattles.map(b => b.outcome), ["escaped", "victory"]);
  }
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
});

test("failed field preparation and late stale publication preserve the same escaped battle for retry", () => {
  const { game, flow } = setup(), before = game.state.snapshot(), request = game.field.stop;
  escape(flow); const battle = game.battle!, prepare = game.field.prepareEncounterReturn;
  game.field.prepareEncounterReturn = () => { throw new Error("controlled media failure"); };
  assert.throws(() => flow.continueEscape(), /controlled media/);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.field.stop, request);
  assert.equal(game.state.inBattle, true); assert.ok(battle.previewEscape());
  game.field.prepareEncounterReturn = function(...args) {
    const pending = prepare.apply(this, args);
    pending.commitWith = () => { throw new Error("controlled stale return"); };
    return pending;
  };
  assert.throws(() => flow.continueEscape(), /controlled stale/);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.battle, battle);
  assert.equal(game.field.stop, request); assert.ok(battle.previewEscape());
  game.field.prepareEncounterReturn = prepare;
  assert.equal(flow.continueEscape(), true); assert.equal(battle.previewEscape(), null);
  assert.equal(game.state.snapshot().completedBattles.length, 1);
});

test("host pause, visibility and I/O gate both requesting and returning from retreat", () => {
  const { game, flow } = setup();
  for (const host of [{ ...walkHost, visible: false }, { ...walkHost, mediaReady: false }, { ...walkHost, overlayOpen: true }]) {
    flow.advance(0, host); assert.equal(flow.canEscape, false); assert.equal(flow.requestEscape(), false);
  }
  flow.advance(0, walkHost); flow.pause(true); assert.equal(flow.requestEscape(), false); flow.pause(false);
  const load = flow.beginOperation("load"); assert.equal(flow.requestEscape(), false); load.cancel();
  escape(flow); flow.pause(true); assert.equal(flow.continueEscape(), false); flow.pause(false);
  flow.advance(0, { ...walkHost, visible: false }); assert.equal(flow.continueEscape(), false);
  flow.advance(0, walkHost); assert.equal(flow.continueEscape(), true);
  assert.equal(game.state.inBattle, false); assert.equal(flow.requestEscape(), false);
});

test("a scripted victory continuation cannot inherit a catalog's ordinary retreat capability", () => {
  const f = checkpointFixture(); f.battle.encounters[1000]!.escapePolicy = { ...policy };
  assert.equal(f.game.field.startEvent("fight"), true); f.game.advance(10);
  assert.ok(f.game.battle); assert.equal(f.game.battle.content.escapePolicy, undefined);
  assert.equal(f.game.battle.requestEscape(), false); assert.equal(f.game.canEscape, false);
  assert.equal(f.game.requestEscape(), false); assert.equal(f.game.continueEscape(), false);
  assert.equal(f.game.field.stop?.kind, "encounter");
});

test("invalid encounter policy fails before lease acquisition and can retry without another draw", () => {
  const f = walkEncounterFixture(1);
  f.battle.encounters[1000]!.escapePolicy = { ...policy, id: "" };
  const before = f.game.state.snapshot(); f.flow.start(); f.flow.advance(0, walkHost);
  assert.equal(f.flow.move("right"), true); f.flow.advance(240, walkHost);
  assert.equal(f.flow.phase, "blocked"); assert.equal(f.game.state.inBattle, false);
  assert.deepEqual(f.game.state.snapshot(), before);
  f.battle.encounters[1000]!.escapePolicy = { ...policy };
  assert.equal(f.flow.retryEncounterPreparation(), true);
  escape(f.flow); assert.equal(f.flow.continueEscape(), true);
  assert.equal(f.game.checkpoint().encounterSerial, 1);
});
