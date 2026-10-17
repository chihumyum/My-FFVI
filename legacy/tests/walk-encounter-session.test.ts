import test from "node:test";
import assert from "node:assert/strict";
import { GameSession, type GameCheckpoint } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { walkEncounterFixture, walkHost, winWalkEncounter } from "./fixtures/walk-encounter-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const start = (flow: GameFlow) => { flow.start(); flow.advance(0, walkHost); };
const walk = (flow: GameFlow, direction: "left" | "right" | "up" | "down" = "right") => {
  assert.equal(flow.move(direction), true); flow.advance(240, walkHost);
};

test("walking battles return to the same field and preserve the next countdown through storage", async () => {
  const f = walkEncounterFixture(), { game, flow } = f, field = game.field, actor = field.player;
  start(flow); walk(flow);
  const checkpoint = game.checkpoint();
  assert.equal(checkpoint.formatVersion, 5);
  if (checkpoint.formatVersion !== 5) assert.fail();
  assert.equal(checkpoint.walkEncounters.completedSteps, 1);
  const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => bytes.get(k) ?? null,
    setItem: (k, v) => { bytes.set(k, v); } }, "framework");
  await storage.save(checkpoint, 1);
  const copy = GameSession.restore((await storage.load())!.checkpoint, f.field, f.battle);
  const replay = new GameFlow(copy); start(replay);
  for (const current of [flow, replay]) {
    walk(current);
    assert.equal(current.phase, "battle");
    assert.equal(current.session.field.stop?.kind, "encounter");
    assert.throws(() => current.session.checkpoint(), /Cannot save/);
    winWalkEncounter(current);
    assert.equal(current.continueVictory(), true); assert.equal(current.continueVictory(), false);
    assert.equal(current.phase, "exploration");
    assert.equal(current.session.gil, 104);
    assert.deepEqual(current.session.completedEncounters, [1000]);
    assert.deepEqual([current.session.field.player.x, current.session.field.player.y], [3, 1]);
    assert.deepEqual(current.session.field.content.scripts, {}, "No fabricated continuation");
  }
  assert.equal(game.field, field); assert.equal(game.field.player, actor);
  assert.deepEqual(copy.checkpoint(), game.checkpoint());
  for (const current of [flow, replay]) { walk(current, "left"); assert.equal(current.phase, "exploration"); walk(current, "left"); }
  assert.equal(flow.phase, "battle"); assert.equal(replay.phase, "battle");
  assert.equal(flow.session.battle!.content.encounterId, replay.session.battle!.content.encounterId);
});

test("pause, hidden media, movement in progress and a wall never consume extra encounter steps", () => {
  const { game, flow } = walkEncounterFixture(3); start(flow);
  const before = game.checkpoint();
  flow.pause(true); flow.advance(60000, walkHost); assert.equal(flow.move("right"), false);
  flow.pause(false);
  for (const host of [{ ...walkHost, visible: false }, { ...walkHost, mediaReady: false }, { ...walkHost, overlayOpen: true }]) {
    flow.advance(60000, host); assert.equal(flow.move("right"), false);
  }
  flow.advance(0, walkHost); assert.deepEqual(game.checkpoint(), before);
  assert.equal(flow.move("up"), true); flow.advance(120, walkHost);
  assert.equal(flow.move("right"), false); assert.throws(() => game.checkpoint());
  flow.advance(120, walkHost);
  const one = game.checkpoint();
  assert.equal(flow.move("up"), false); flow.advance(240, walkHost);
  const after = game.checkpoint();
  if (one.formatVersion !== 5 || after.formatVersion !== 5) assert.fail();
  assert.deepEqual(after.walkEncounters, one.walkEncounters);
  assert.equal(after.walkEncounters.completedSteps, 1);
});

test("failed encounter preparation preserves selection, position and rewards until explicit retry", () => {
  const f = walkEncounterFixture(1), encounter = f.battle.encounters[1000]!;
  delete f.battle.encounters[1000]; start(f.flow); walk(f.flow);
  const request = f.game.field.stop, owned = f.game.state.snapshot();
  assert.equal(f.flow.phase, "blocked"); assert.match(f.game.encounterPreparationError!, /unavailable/);
  assert.equal(f.game.state.inBattle, false); assert.throws(() => f.game.checkpoint());
  assert.equal(f.flow.move("left"), false); f.flow.advance(60000, walkHost);
  assert.equal(f.flow.retryEncounterPreparation(), false);
  assert.equal(f.game.field.stop, request); assert.deepEqual(f.game.state.snapshot(), owned);
  f.battle.encounters[1000] = encounter;
  f.flow.pause(true); assert.equal(f.flow.retryEncounterPreparation(), false); f.flow.pause(false);
  assert.equal(f.flow.retryEncounterPreparation(), true); assert.equal(f.game.field.stop, request);
  assert.equal(f.flow.retryEncounterPreparation(), false);
  winWalkEncounter(f.flow); assert.equal(f.flow.continueVictory(), true);
  const saved = f.game.checkpoint(); if (saved.formatVersion !== 5) assert.fail();
  assert.equal(saved.walkEncounters.completedSteps, 1); assert.equal(saved.walkEncounters.encounters, 1);
  assert.equal(saved.encounterSerial, 1); assert.equal(f.game.gil, 104);
});

test("battle constructor failure cancels its lease and can retry without selecting another encounter", () => {
  const f = walkEncounterFixture(1), prefs = f.battle.common.initialAtb;
  f.battle.common.initialAtb = { player: [Number.NaN, 100], enemy: [0, 0] };
  start(f.flow); walk(f.flow);
  assert.equal(f.game.state.inBattle, false); assert.equal(f.flow.phase, "blocked");
  f.battle.common.initialAtb = prefs;
  assert.equal(f.flow.retryEncounterPreparation(), true);
  winWalkEncounter(f.flow); assert.equal(f.flow.continueVictory(), true);
  assert.equal(f.game.checkpoint().encounterSerial, 1);
});

test("natural defeat retries the same walking battle and consumes its rewards only after victory", () => {
  const f = walkEncounterFixture(1); start(f.flow);
  const baseline = f.game.state.snapshot(); walk(f.flow);
  const request = f.game.field.stop, oldBattle = f.game.battle;
  for (let n = 0; n < 50000 && f.flow.phase === "battle"; n++) f.flow.advance(50, walkHost);
  assert.equal(f.flow.phase, "defeat");
  assert.deepEqual(f.game.state.snapshot(), baseline);
  assert.equal(f.flow.retryBattle(), true); assert.notEqual(f.game.battle, oldBattle);
  assert.equal(f.game.field.stop, request); assert.equal(f.flow.retryBattle(), false);
  assert.deepEqual(f.game.battle!.players.map(p => p.hp), baseline.roster.map(p => p.hp));
  winWalkEncounter(f.flow); assert.equal(f.flow.continueVictory(), true);
  const saved = f.game.checkpoint(); if (saved.formatVersion !== 5) assert.fail();
  assert.equal(saved.walkEncounters.completedSteps, 1); assert.equal(saved.walkEncounters.encounters, 1);
  assert.equal(saved.encounterSerial, 1); assert.equal(f.game.gil, 104);
});

test("map preparation failure and later return keep independent map countdowns", () => {
  const f = walkEncounterFixture(3); start(f.flow); walk(f.flow);
  const before = f.game.checkpoint(); if (before.formatVersion !== 5) assert.fail();
  f.game.field.previewMap(2, 1);
  const bad = structuredClone(f.target); bad.contentHash = "wrong";
  assert.throws(() => f.game.world.prepare(f.world, bad));
  const prepared = f.game.world.prepare(f.world, f.target);
  assert.equal(f.game.world.commit(prepared), true);
  f.flow.advance(0, walkHost); walk(f.flow);
  const saved = f.game.checkpoint(); if (saved.formatVersion !== 5) assert.fail();
  assert.deepEqual(saved.walkEncounters.maps.map(m => [m.mapId, m.remainingSteps]), [[1, 2], [2, 2]]);
  const copy = GameSession.restore(saved, f.field, f.battle, { catalog: f.world, map: f.target });
  assert.deepEqual(copy.checkpoint(), saved);
  const changed = structuredClone(f.target); changed.walkEncounters!.maxSteps++;
  assert.throws(() => GameSession.restore(saved, f.field, f.battle, { catalog: f.world, map: changed }), /policy/i);
});

test("legacy saves upgrade only when the trusted current content has no walking policy", () => {
  const f = checkpointFixture(), next = f.game.checkpoint();
  if (next.formatVersion !== 5) assert.fail();
  const { walkEncounters: _, ...payload } = next;
  const old: GameCheckpoint = { ...payload, formatVersion: 4 };
  const restored = GameSession.restore(old, f.field, f.battle);
  assert.equal(restored.checkpoint().formatVersion, 5);
  const walking = walkEncounterFixture(), saved = walking.game.checkpoint();
  if (saved.formatVersion !== 5) assert.fail();
  const { walkEncounters: __, ...other } = saved;
  assert.throws(() => GameSession.restore({ ...other, formatVersion: 4 }, walking.field, walking.battle), /Legacy checkpoint/);
});

test("unpublished, cancelled and retired map candidates cannot consume the live walk stream", () => {
  const f = walkEncounterFixture(3); start(f.flow);
  f.game.field.previewMap(2, 1);
  const candidate = f.game.world.prepare(f.world, f.target);
  assert.equal(candidate.field.move("right"), false);
  assert.match(candidate.field.stop!.message, /published current map/);
  assert.equal(f.game.world.commit(candidate), false, "A mutated private field cannot be published");
  const cancelled = f.game.world.prepare(f.world, f.target);
  f.game.world.discard(cancelled);
  assert.equal(cancelled.field.move("right"), false);
  cancelled.field.advance(240);
  const retry = f.game.world.prepare(f.world, f.target);
  assert.equal(f.game.world.commit(retry), true);
  const saved = f.game.checkpoint(); if (saved.formatVersion !== 5) assert.fail();
  assert.deepEqual(saved.walkEncounters.maps, []);
  assert.equal(saved.walkEncounters.completedSteps, 0);
  walk(f.flow);
  const next = f.game.checkpoint(); if (next.formatVersion !== 5) assert.fail();
  assert.equal(next.walkEncounters.completedSteps, 1);
});
