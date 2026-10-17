import assert from "node:assert/strict";
import test from "node:test";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { readyHost, startFlow } from "./fixtures/game-flow.js";
import { choiceDefinition, choiceExit, choiceFixture, choiceVariable, copySelection, selection } from "./fixtures/field-choice.js";

function fixture() {
  const f = choiceFixture([choiceDefinition(), copySelection, choiceExit]);
  const game = new GameSession(f.content, f.battle, 1), flow = new GameFlow(game);
  game.field.eventState.write(selection, 9);
  game.field.eventState.write(choiceVariable(), 0);
  startFlow(flow); assert.equal(game.field.startEvent("choice"), true);
  return { ...f, game, flow };
}

test("GameFlow dispatches choices through the current session without treating confirm as selection", () => {
  const { game, flow } = fixture(); const id = game.field.choice!.id;
  assert.equal(flow.phase, "choice"); assert.equal(flow.confirm(), false); assert.equal(flow.move("down"), false);
  assert.equal(game.menuReady, false); assert.equal(game.checkpointReady, false);
  const owned = game.state.snapshot(); assert.throws(() => game.checkpoint(), /Cannot save/);
  assert.equal(flow.choose(id, 1), true); assert.equal(game.field.eventState.read(selection), 1);
  assert.equal(flow.confirm(), false); assert.equal(flow.phase, "event");
  assert.equal(game.field.eventState.read(choiceVariable()), 0); assert.deepEqual(game.state.snapshot(), owned);
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "exploration"); assert.equal(game.field.eventState.read(choiceVariable()), 1);
  assert.equal(game.checkpointReady, true);
});

for (const gate of ["hidden", "media", "overlay", "paused", "io"] as const) {
  test(`the ${gate} host gate suspends selection input without losing the pending request`, () => {
    const { game, flow } = fixture(), request = game.field.choice!, time = game.field.time;
    const before = game.field.eventState.snapshot();
    const host = { ...readyHost };
    if (gate === "hidden") host.visible = false;
    if (gate === "media") host.mediaReady = false;
    if (gate === "overlay") host.overlayOpen = true;
    if (gate === "paused") flow.pause(true);
    const operation = gate === "io" ? flow.beginOperation("load") : null;
    flow.advance(100, host);
    assert.equal(flow.inputReady, false); assert.equal(flow.choose(request.id, 1), false);
    assert.equal(flow.confirm(), false); assert.equal(game.field.time, time);
    assert.equal(game.field.choice, request); assert.deepEqual(game.field.eventState.snapshot(), before);
    operation?.cancel(); if (gate === "paused") flow.pause(false);
    flow.advance(0, readyHost); assert.equal(flow.phase, "choice");
    assert.equal(flow.choose(request.id, 0), true); flow.advance(10, readyHost);
    assert.equal(game.field.eventState.read(choiceVariable()), 0); assert.equal(flow.phase, "exploration");
  });
}

test("return-to-title and successful replacement invalidate old owner callbacks while failed load retains the original choice", () => {
  const a = fixture(), b = fixture(), id = a.game.field.choice!.id;
  a.flow.returnToTitle(); assert.equal(a.flow.choose(id, 1), false);
  a.flow.start(); assert.equal(a.flow.choose(id, 1), false, "new host media readiness is mandatory");
  a.flow.advance(0, readyHost);
  const failed = a.flow.beginOperation("load"); failed.cancel();
  assert.equal(a.flow.session, a.game); assert.equal(a.flow.session.field.choice!.id, id);
  const load = a.flow.beginOperation("load"); assert.equal(load.publish(b.game), true);
  assert.equal(a.flow.choose(id, 1), false); a.flow.advance(0, readyHost);
  assert.equal(a.flow.choose(id, 1), false); assert.equal(b.game.field.eventState.read(selection), 9);
  assert.equal(a.flow.choose(b.game.field.choice!.id, 1), true);
  assert.equal(a.game.field.eventState.read(selection), 9);
});

test("a competing encounter is blocked before a battle lease or shared state can change", () => {
  const f = choiceFixture([
    { kind: "puppet", slot: 0, actor: "npc", target: 4 }, { kind: "exec-puppets", asynchronous: true },
    choiceDefinition(), choiceExit, { kind: "encounter", party: 1000, continuation: "after" }, choiceExit,
  ]);
  const game = new GameSession(f.content, f.battle, 1), flow = new GameFlow(game), owned = game.state.snapshot();
  startFlow(flow); game.field.startEvent("choice"); flow.advance(10, readyHost);
  assert.equal(flow.phase, "blocked"); assert.equal(game.battle, null); assert.equal(game.state.inBattle, false);
  assert.deepEqual(game.state.snapshot(), owned); assert.equal(flow.choose(game.field.choice!.id, 0), false);
});
