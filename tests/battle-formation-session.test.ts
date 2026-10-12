import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { createBattleFormationPlan } from "../src/core/battle-formations.js";
import { walkEncounterFixture, walkHost, winWalkEncounter } from "./fixtures/walk-encounter-game.js";

function fixture(steps = 1) {
  const f = walkEncounterFixture(steps), encounter = f.battle.encounters[1000]!;
  encounter.formation = null;
  encounter.formationPlan = createBattleFormationPlan([1, 1, 1, 1, 1, 1], {
    kind: "framework-battle-formations-v1", id: "session-branches", weights: [1, 0, 1, 0, 0, 0],
  });
  f.flow.start(); f.flow.advance(0, walkHost);
  return f;
}
function walk(flow: GameFlow, direction: "right" | "left" = "right") {
  assert.equal(flow.move(direction), true); flow.advance(240, walkHost);
}
function entry(game: GameSession) {
  const b = game.battle!;
  return { choice: structuredClone(b.content.formationChoice), formation: b.content.formation,
    units: b.combatants.map(u => ({ id: u.id, hp: u.hp, mp: u.mp, atb: u.atb, placement: u.placement })) };
}

test("failed construction and explicit retry preserve the formation, combat stream and encounter serial", () => {
  const failed = fixture(), control = fixture(), atb = failed.battle.common.initialAtb;
  failed.battle.common.initialAtb = { player: [Number.NaN, 100], enemy: [0, 0] };
  const owned = failed.game.state.snapshot();
  walk(failed.flow); walk(control.flow);
  assert.equal(failed.flow.phase, "blocked"); assert.equal(failed.game.state.inBattle, false);
  assert.deepEqual(failed.game.state.snapshot(), owned);
  const request = failed.game.field.stop;
  failed.flow.advance(60000, walkHost);
  failed.battle.common.initialAtb = atb;
  assert.equal(failed.flow.retryEncounterPreparation(), true);
  assert.equal(failed.game.field.stop, request);
  assert.deepEqual(entry(failed.game), entry(control.game));
  for (const f of [failed, control]) {
    winWalkEncounter(f.flow); assert.equal(f.flow.continueVictory(), true);
    assert.equal(f.game.checkpoint().encounterSerial, 1);
  }
  assert.deepEqual(failed.game.checkpoint(), control.game.checkpoint());
});

test("saving before the encounter reproduces each later branch without changing the walking stream", () => {
  const f = fixture(2); walk(f.flow);
  const saved = f.game.checkpoint(), copy = GameSession.restore(saved, f.field, f.battle);
  const replay = new GameFlow(copy); replay.start(); replay.advance(0, walkHost);
  for (const flow of [f.flow, replay]) walk(flow);
  assert.deepEqual(entry(f.game), entry(copy));
  for (const flow of [f.flow, replay]) {
    winWalkEncounter(flow); assert.equal(flow.continueVictory(), true);
    walk(flow, "left"); walk(flow, "left");
  }
  assert.deepEqual(entry(f.game), entry(copy));
  for (const flow of [f.flow, replay]) { winWalkEncounter(flow); assert.equal(flow.continueVictory(), true); }
  assert.deepEqual(f.game.checkpoint(), copy.checkpoint());
  const after = f.game.checkpoint(); if (after.formatVersion !== 5) assert.fail();
  assert.equal(after.encounterSerial, 2); assert.equal(after.walkEncounters.encounters, 2);
  assert.equal(after.walkEncounters.completedSteps, 4);
});

test("natural defeat uses the already resolved entry even if the catalog policy later changes", () => {
  const f = fixture(); walk(f.flow);
  const original = entry(f.game), before = f.game.state.snapshot();
  for (let n = 0; n < 50000 && f.flow.phase === "battle"; n++) f.flow.advance(50, walkHost);
  assert.equal(f.flow.phase, "defeat");
  const plan = f.battle.encounters[1000]!.formationPlan!;
  if (plan.kind !== "development") assert.fail();
  plan.policy.weights = original.formation === "normal" ? [0, 0, 1, 0, 0, 0] : [1, 0, 0, 0, 0, 0];
  assert.equal(f.flow.retryBattle(), true);
  assert.deepEqual(entry(f.game), original);
  assert.deepEqual(f.game.state.snapshot(), before);
  winWalkEncounter(f.flow); assert.equal(f.flow.continueVictory(), true);
  assert.equal(f.game.checkpoint().encounterSerial, 1);
});

test("an invalid selection policy fails before acquiring ownership and keeps the same ordinary encounter", () => {
  const f = fixture(), plan = f.battle.encounters[1000]!.formationPlan!;
  if (plan.kind !== "development") assert.fail();
  plan.policy.weights[4] = 1;
  const before = f.game.state.snapshot(); walk(f.flow);
  assert.equal(f.flow.phase, "blocked"); assert.match(f.game.encounterPreparationError!, /Unsupported/);
  assert.equal(f.game.state.inBattle, false); assert.deepEqual(f.game.state.snapshot(), before);
  assert.equal(f.flow.retryEncounterPreparation(), false);
  plan.policy.weights[4] = 0;
  assert.equal(f.flow.retryEncounterPreparation(), true);
  winWalkEncounter(f.flow); assert.equal(f.flow.continueVictory(), true);
  assert.equal(f.game.checkpoint().encounterSerial, 1);
});
