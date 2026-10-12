import test from "node:test";
import assert from "node:assert/strict";
import { GameFlow, type GameFlowHostState, type GameFlowStartOptions } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { gameFlowFixture, readyHost, startFlow } from "./fixtures/game-flow.js";

test("title retains one session owner and new starts require a fresh media observation", () => {
  const { game, flow } = gameFlowFixture(), before = game.checkpoint();
  assert.equal(flow.phase, "title");
  assert.equal(flow.session, game);
  assert.equal(flow.started, false);
  assert.equal(flow.pause(true), false);
  flow.advance(1000, readyHost);
  assert.equal(flow.move("right"), false);
  assert.equal(flow.confirm(), false);
  assert.deepEqual(game.checkpoint(), before);
  flow.start();
  assert.equal(flow.phase, "exploration");
  assert.equal(flow.started, true);
  assert.equal(flow.move("right"), false);
  flow.advance(0, readyHost);
  assert.equal(flow.move("right"), true);
  flow.advance(240, readyHost);
  assert.equal(game.field.player.x, 2);
  assert.equal(flow.session.world, game.world);
  assert.equal(flow.session.state, game.state);
});

test("host gates freeze movement and session remainder without a resume catch-up", () => {
  const gates: GameFlowHostState[] = [
    { ...readyHost, visible: false },
    { ...readyHost, mediaReady: false },
    { ...readyHost, overlayOpen: true },
  ];
  for (const gate of gates) {
    const { game, flow } = gameFlowFixture(); startFlow(flow);
    assert.equal(flow.move("right"), true);
    flow.advance(35, readyHost);
    const pose = structuredClone(game.field.player.motion), time = game.field.time;
    flow.advance(10000, gate);
    assert.equal(game.field.time, time);
    assert.deepEqual(game.field.player.motion, pose);
    assert.equal(flow.move("down"), false);
    assert.equal(flow.confirm(), false);
    flow.advance(4, readyHost);
    assert.equal(game.field.time, time);
    flow.advance(1, readyHost);
    assert.equal(game.field.time, time + 10);
    flow.advance(200, readyHost);
    assert.equal(game.field.player.motion, null);
    assert.equal(game.field.player.x, 2);
  }
});

test("pause freezes an event while host gates still update independently", () => {
  const { game, flow } = gameFlowFixture(); startFlow(flow);
  assert.equal(game.field.startEvent("conversation"), true);
  assert.equal(flow.phase, "event");
  assert.equal(flow.pause(true), true);
  flow.advance(1000, { ...readyHost, visible: false });
  assert.equal(flow.phase, "paused");
  assert.equal(game.field.time, 0);
  assert.equal(flow.confirm(), false);
  assert.equal(flow.pause(false), true);
  assert.equal(flow.phase, "event");
  assert.equal(flow.confirm(), false);
  flow.advance(30, readyHost);
  assert.equal(flow.phase, "dialogue");
  assert.equal(game.field.dialogue!.key, "FLOW");
  assert.equal(flow.confirm(), true);
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "exploration");
  assert.equal(game.field.flags.ScenarioFlag1![3], true);
});

test("inputReady projects the same title, media, visibility, pause and operation gates to battle UI", () => {
  const { flow } = gameFlowFixture();
  assert.equal(flow.inputReady, false);
  flow.advance(0, readyHost);
  assert.equal(flow.inputReady, false);
  flow.start();
  assert.equal(flow.inputReady, false);
  for (const host of [
    { ...readyHost, mediaReady: false },
    { ...readyHost, visible: false },
    { ...readyHost, overlayOpen: true },
  ]) {
    flow.advance(0, host); assert.equal(flow.inputReady, false);
    flow.advance(0, readyHost); assert.equal(flow.inputReady, true);
  }
  flow.pause(true); assert.equal(flow.inputReady, false);
  flow.advance(0, readyHost); assert.equal(flow.inputReady, false);
  flow.pause(false); assert.equal(flow.inputReady, true);
  const operation = flow.beginOperation("save");
  assert.equal(flow.inputReady, false);
  flow.advance(0, readyHost); assert.equal(flow.inputReady, false);
  operation.finish(); assert.equal(flow.inputReady, true);
  flow.returnToTitle(); assert.equal(flow.inputReady, false);
});

test("dialogue and shop phases reflect the field owner through trading and farewell", () => {
  const { game, flow } = gameFlowFixture({ shop: true }); startFlow(flow);
  assert.equal(flow.confirm(), true);
  assert.equal(flow.phase, "dialogue");
  assert.equal(game.field.dialogue!.key, "WELCOME");
  assert.equal(flow.confirm(), true);
  assert.equal(flow.phase, "shop");
  assert.equal(flow.move("down"), false);
  assert.equal(game.tradeShop({ kind: "buy", productId: 1001, count: 1 }).totalPrice, 30);
  assert.deepEqual(game.state.snapshot().items, [{ id: 10, count: 1 }]);
  assert.equal(game.state.snapshot().gil, 60);
  assert.equal(game.closeShop(), true);
  assert.equal(flow.phase, "dialogue");
  assert.equal(game.field.dialogue!.key, "GOODBYE");
  assert.equal(flow.confirm(), true);
  assert.equal(flow.phase, "exploration");
});

test("encounter handoff continues from event to battle and victory publishes rewards once", () => {
  const { game, flow } = gameFlowFixture(); startFlow(flow);
  const owned = game.state.snapshot();
  assert.equal(game.field.startEvent("fight"), true);
  assert.equal(flow.phase, "event");
  assert.equal(game.battle, null);
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "battle");
  assert.equal(game.state.inBattle, true);
  const battle = game.battle!;
  for (const [index, actor] of battle.ready.entries())
    assert.equal(battle.command(actor.id, 10, { kind: "single", id: battle.enemies[index]!.id }), true);
  flow.advance(2000, readyHost);
  assert.equal(flow.phase, "victory");
  assert.deepEqual(game.state.snapshot(), owned);
  assert.equal(flow.move("right"), false);
  assert.equal(flow.confirm(), false);
  flow.pause(true);
  assert.equal(flow.continueVictory(), false);
  flow.pause(false);
  flow.advance(0, { ...readyHost, overlayOpen: true });
  assert.equal(flow.continueVictory(), false);
  flow.advance(0, readyHost);
  assert.equal(flow.continueVictory(), true);
  assert.equal(game.battle, null);
  assert.equal(game.state.inBattle, false);
  assert.equal(game.state.snapshot().gil, owned.gil + 14);
  assert.equal(game.state.snapshot().completedBattles.length, 1);
  const after = game.state.snapshot();
  assert.equal(flow.continueVictory(), false);
  assert.deepEqual(game.state.snapshot(), after);
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "exploration");
  assert.equal(game.field.flags.ScenarioFlag1![1], true);
});

test("defeat retry reuses the session lease and restores entry combatants without publishing damage", () => {
  const { game, flow } = gameFlowFixture(); startFlow(flow);
  const owned = game.state.snapshot();
  game.field.startEvent("fight"); flow.advance(10, readyHost);
  const defeated = game.battle!, entry = structuredClone(defeated.players);
  // Controlled lethal outcome; flow still delegates the actual phase transition
  // and retry construction to BattleGame and GameSession.
  for (const player of defeated.players) { player.hp = 0; player.conditionIds = [305]; }
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "defeat");
  assert.equal(flow.continueVictory(), false);
  const io = flow.beginOperation("load");
  assert.equal(flow.retryBattle(), false);
  io.cancel();
  assert.equal(flow.phase, "defeat");
  assert.equal(flow.retryBattle(), true);
  assert.equal(flow.phase, "battle");
  assert.notEqual(game.battle, defeated);
  assert.deepEqual(game.battle!.players, entry);
  assert.deepEqual(game.state.snapshot(), owned);
  assert.equal(game.state.inBattle, true);
  assert.equal(flow.retryBattle(), false);
});

test("unavailable encounter becomes a stable blocker before any shared-state lease", () => {
  const { game, flow, battle } = gameFlowFixture();
  delete battle.encounters[1000];
  const before = game.state.snapshot(); startFlow(flow);
  game.field.startEvent("fight");
  assert.equal(flow.phase, "event");
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "blocked");
  assert.match(game.field.stop!.message, /encounter 1000/);
  assert.equal(game.battle, null);
  assert.equal(game.state.inBattle, false);
  assert.deepEqual(game.state.snapshot(), before);
  const time = game.field.time;
  flow.advance(10000, readyHost);
  assert.equal(game.field.time, time);
  assert.equal(flow.confirm(), false);
  assert.equal(flow.move("right"), false);
});

test("an unsupported event stays visible and does not continue its clock or accept confirmation", () => {
  const { game, flow } = gameFlowFixture(); startFlow(flow);
  game.field.startEvent("blocked");
  assert.equal(flow.phase, "blocked");
  const stop = structuredClone(game.field.stop), before = game.state.snapshot();
  flow.advance(10000, readyHost);
  assert.equal(game.field.time, 0);
  assert.equal(flow.confirm(), false);
  assert.deepEqual(game.field.stop, stop);
  assert.deepEqual(game.state.snapshot(), before);
});

test("map preparation is an I/O gate while WorldSession keeps the sole field owner", () => {
  const { game, flow, world, target } = gameFlowFixture(); startFlow(flow);
  const previous = game.field, owned = game.state;
  game.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  game.field.startEvent("leave");
  assert.equal(flow.phase, "transition");
  flow.advance(1000, readyHost);
  assert.equal(previous.time, 0);
  const failed = flow.beginOperation("map");
  assert.throws(() => game.world.prepare({ ...world, parentSourceSetHash: "wrong" }, target));
  failed.cancel();
  assert.equal(flow.phase, "transition");
  assert.equal(flow.session.field, previous);
  const ticket = flow.beginOperation("map"), prepared = game.world.prepare(world, target);
  assert.equal(flow.phase, "transition");
  assert.equal(flow.busy, true);
  assert.equal(flow.move("right"), false);
  assert.equal(game.world.commit(prepared), true);
  assert.equal(ticket.finish(), true);
  assert.equal(flow.session, game);
  assert.equal(flow.session.state, owned);
  assert.notEqual(flow.session.field, previous);
  flow.advance(10, readyHost);
  assert.equal(flow.phase, "exploration");
  assert.equal(game.field.flags.ScenarioFlag1![8], true);
});

test("failed or cancelled new-game/load/save operations preserve the owner and paused state", () => {
  for (const kind of ["new-game", "load", "save"] as const) {
    for (const paused of [false, true]) {
      const { game, flow } = gameFlowFixture(); startFlow(flow); flow.pause(paused);
      const before = game.checkpoint(), operation = flow.beginOperation(kind);
      assert.equal(flow.phase, "loading");
      assert.equal(flow.busy, true);
      assert.equal(flow.pause(!paused), false);
      assert.throws(() => flow.beginOperation("save"), /already in progress/);
      flow.advance(10000, readyHost);
      assert.equal(flow.move("right"), false);
      assert.equal(flow.confirm(), false);
      operation.cancel();
      assert.equal(operation.isCurrent(), false);
      assert.equal(operation.finish(), false);
      assert.equal(flow.busy, false);
      assert.equal(flow.session, game);
      assert.equal(flow.paused, paused);
      assert.equal(flow.phase, paused ? "paused" : "exploration");
      assert.deepEqual(game.checkpoint(), before);
    }
  }
});

test("returning to title expires outstanding work without discarding the session state", () => {
  const { game, flow } = gameFlowFixture(); startFlow(flow);
  flow.move("right"); flow.advance(240, readyHost);
  const before = game.checkpoint(), old = flow.beginOperation("load");
  flow.returnToTitle();
  assert.equal(flow.phase, "title");
  assert.equal(flow.started, false);
  assert.equal(flow.busy, false);
  assert.equal(old.isCurrent(), false);
  const current = flow.beginOperation("new-game");
  assert.equal(old.publish(gameFlowFixture().game), false);
  assert.equal(old.finish(), false);
  old.cancel();
  assert.equal(current.isCurrent(), true);
  assert.equal(flow.busy, true);
  current.cancel();
  assert.equal(flow.phase, "title");
  flow.advance(1000, readyHost);
  assert.deepEqual(game.checkpoint(), before);
  flow.start();
  assert.equal(flow.move("right"), false);
  flow.advance(0, readyHost);
  assert.equal(flow.session, game);
  assert.equal(game.field.player.x, 2);
});

test("successful load publishes one restored owner, waits for media and invalidates its ticket", () => {
  const { game, flow, field, battle } = gameFlowFixture(); startFlow(flow);
  flow.move("right"); flow.advance(240, readyHost);
  const restored = GameSession.restore(game.checkpoint(), field, battle);
  const ticket = flow.beginOperation("load");
  assert.equal(ticket.publish(restored, { paused: true }), true);
  assert.equal(ticket.isCurrent(), false);
  assert.equal(flow.session, restored);
  assert.equal(flow.phase, "paused");
  flow.pause(false);
  assert.equal(flow.move("down"), false);
  flow.advance(0, readyHost);
  assert.equal(flow.move("down"), true);
  flow.advance(240, readyHost);
  assert.equal(restored.field.player.y, 2);
  assert.equal(game.field.player.y, 1);
  assert.equal(ticket.publish(game), false);
  assert.equal(flow.session, restored);
});

test("explicit start invalidates a pending ticket, including a reentrant publish option", () => {
  const { flow, game } = gameFlowFixture(), next = gameFlowFixture().game;
  const old = flow.beginOperation("new-game");
  flow.start(next);
  assert.equal(old.publish(game), false);
  assert.equal(flow.session, next);
  const pending = flow.beginOperation("load");
  const options: GameFlowStartOptions = { get paused() { flow.start(next, { paused: true }); return false; } };
  assert.equal(pending.publish(game, options), false);
  assert.equal(flow.session, next);
  assert.equal(flow.paused, true);
  assert.equal(flow.busy, false);
});

test("invalid publication cannot remove a current ticket or mutate the current owner", () => {
  const { flow, game } = gameFlowFixture(); startFlow(flow); flow.pause(true);
  const pending = flow.beginOperation("load");
  assert.throws(() => pending.publish({} as GameSession), /GameSession/);
  assert.throws(() => pending.publish(game, { paused: "yes" } as unknown as GameFlowStartOptions), /options/);
  assert.equal(pending.isCurrent(), true);
  assert.equal(flow.session, game);
  assert.equal(flow.paused, true);
  pending.cancel();
  assert.equal(flow.phase, "paused");
});

test("invalid clock and incomplete host observations leave readiness and owned state unchanged", () => {
  const { flow, game } = gameFlowFixture(); startFlow(flow);
  const before = game.checkpoint();
  for (const delta of [-1, NaN, Infinity, 60001])
    assert.throws(() => flow.advance(delta, { ...readyHost, visible: false }), /elapsed time/);
  assert.throws(() => flow.advance(10, { visible: true } as GameFlowHostState), /host state/);
  assert.throws(() => flow.pause(1 as unknown as boolean), /pause value/);
  assert.throws(() => flow.move("north" as "up"), /direction/);
  assert.deepEqual(game.checkpoint(), before);
  assert.equal(flow.move("right"), true);
});
