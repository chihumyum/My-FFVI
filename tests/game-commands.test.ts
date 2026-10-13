import test from "node:test";
import assert from "node:assert/strict";
import { GameCommands } from "../src/core/game-commands.js";
import { GameFlow, type GameFlowOperation } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import type { BattleGame } from "../src/core/battle.js";
import { readyHost, startFlow, gameFlowFixture } from "./fixtures/game-flow.js";
import { partyMenuFixture } from "./fixtures/party-menu.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function menuFixture() {
  const f = partyMenuFixture(), flow = new GameFlow(f.game);
  f.game.state.fieldInventory.prepare({ kind: "grant-item", id: 10, count: 3 }).commit();
  const saved = f.game.state.snapshot(); saved.roster[0]!.hp = 30; f.game.state.restore(saved);
  startFlow(flow); flow.pause(true);
  return { ...f, flow, commands: new GameCommands(flow, f.game) };
}
function rejectMenus(f: ReturnType<typeof menuFixture>) {
  const owned = f.game.state.snapshot(), preferences = f.game.battlePreferences,
    appearance = f.game.field.partyActorCheckpoint;
  assert.equal(f.commands.useMenuItem(10, "a"), false);
  assert.equal(f.commands.changeEquipment("a", 5, 5), false);
  assert.equal(f.commands.changeParty({ expected: owned.party, change: { kind: "swap", from: 0, to: 1 } }), false);
  assert.equal(f.commands.setBattlePreferences({ mode: "wait", speedIndex: 4 }), false);
  assert.equal(f.commands.closeShop(), false);
  assert.equal(f.commands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
  assert.deepEqual(f.game.state.snapshot(), owned);
  assert.deepEqual(f.game.battlePreferences, preferences);
  assert.deepEqual(f.game.field.partyActorCheckpoint, appearance);
}
function battleFixture() {
  const f = gameFlowFixture(); startFlow(f.flow);
  const commands = new GameCommands(f.flow, f.game);
  f.game.field.startEvent("fight"); f.flow.advance(10, readyHost);
  assert.ok(f.game.battle);
  return { ...f, commands, instance: f.game.battle };
}

test("a real owner is required and title/readiness facts do not create a menu capability", () => {
  const f = menuFixture();
  assert.throws(() => new GameCommands({} as GameFlow, f.game), /GameFlow/);
  assert.throws(() => new GameCommands(f.flow, {} as GameSession), /GameSession/);
  assert.equal(f.commands.ownsBattle(null as unknown as BattleGame), false);
  f.flow.returnToTitle(); rejectMenus(f);
  f.flow.start(f.game, { paused: true });
  assert.equal(f.flow.menuInputReady, false, "a new start cannot inherit old media facts"); rejectMenus(f);
  f.flow.observeHost(readyHost);
  assert.equal(f.flow.menuInputReady, true); assert.equal(f.flow.inputReady, false);
  assert.equal(f.commands.menuReady, true);
});

test("paused menu commands update the sole owned resources and actor projection, then save/restore", () => {
  const f = menuFixture(), before = f.game.state.snapshot(), time = f.game.field.time;
  assert.equal(f.commands.useMenuItem(10, "a"), true);
  assert.equal(f.game.state.snapshot().roster[0]!.hp, 80);
  assert.deepEqual(f.game.state.snapshot().items, [{ id: 10, count: 2 }]);
  assert.equal(f.commands.changeEquipment("a", 5, 5), true);
  assert.equal(f.commands.changeParty({ expected: f.game.state.snapshot().party,
    change: { kind: "swap", from: 0, to: 1 } }), true);
  assert.equal(f.game.field.player.asset, "bravo");
  assert.equal(f.game.state.activeParty[0]!.id, "b");
  assert.equal(f.commands.setBattlePreferences({ mode: "wait", speedIndex: 4 }), true);
  assert.deepEqual(f.game.battlePreferences, { mode: "wait", speedIndex: 4 });
  assert.equal(f.game.state.snapshot().gil, before.gil);
  assert.equal(f.game.field.time, time, "commands and host observations never clock the paused field");
  const saved = f.game.checkpoint(), restored = GameSession.restore(saved, f.field, f.battle);
  assert.deepEqual(restored.checkpoint(), saved);
});

test("every asynchronous flow operation rejects paused mutation before touching an owner", () => {
  const f = menuFixture();
  for (const kind of ["new-game", "load", "save", "map", "battle-entry", "battle-return"] as GameFlowOperation[]) {
    const operation = f.flow.beginOperation(kind);
    assert.equal(f.commands.menuReady, false); assert.equal(f.commands.settingsReady, false);
    rejectMenus(f);
    operation.finish(); assert.equal(f.commands.menuReady, true);
  }
});

test("observeHost revokes pause-menu input immediately, without an event advance", () => {
  const f = menuFixture(), before = f.game.checkpoint();
  for (const host of [{ ...readyHost, visible: false }, { ...readyHost, mediaReady: false },
    { ...readyHost, overlayOpen: true }]) {
    f.flow.observeHost(host); rejectMenus(f);
    assert.deepEqual(f.game.checkpoint(), before);
    f.flow.observeHost(readyHost); assert.equal(f.commands.menuReady, true);
  }
  assert.throws(() => f.flow.observeHost({ ...readyHost, visible: undefined } as unknown as typeof readyHost), /host state/);
  assert.equal(f.commands.menuReady, true, "an invalid observation leaves the earlier complete facts intact");
});

test("an old gateway cannot mutate either owner after an otherwise-ready replacement session", () => {
  const f = menuFixture(), next = partyMenuFixture(), nextBefore = next.game.checkpoint();
  f.flow.start(next.game, { paused: true }); f.flow.observeHost(readyHost);
  rejectMenus(f);
  assert.deepEqual(next.game.checkpoint(), nextBefore);
  const current = new GameCommands(f.flow, next.game);
  assert.equal(current.settingsReady, true);
  assert.equal(current.setBattlePreferences({ mode: "wait", speedIndex: 0 }), true);
  assert.deepEqual(next.game.battlePreferences, { mode: "wait", speedIndex: 0 });
});

test("normal play, an event and a battle do not gain item/equipment/party menu rights", () => {
  const f = menuFixture(); f.flow.pause(false);
  assert.equal(f.commands.menuReady, false);
  assert.equal(f.commands.useMenuItem(10, "a"), false);
  assert.equal(f.commands.changeEquipment("a", 5, 5), false);
  assert.equal(f.commands.setBattlePreferences({ mode: "wait", speedIndex: 4 }), false);
  f.game.field.startEvent("waiting"); f.flow.pause(true);
  assert.equal(f.flow.menuInputReady, true); assert.equal(f.commands.menuReady, false);
  const before = f.game.state.snapshot();
  assert.equal(f.commands.useMenuItem(10, "a"), false); assert.deepEqual(f.game.state.snapshot(), before);
  const b = battleFixture(); b.flow.pause(true);
  assert.equal(b.flow.menuInputReady, true); assert.equal(b.commands.menuReady, false);
  assert.equal(b.commands.settingsReady, true, "battle preferences remain pause-menu runtime inputs");
  assert.equal(b.commands.setBattlePreferences({ mode: "wait", speedIndex: 3 }), true);
  assert.deepEqual(b.instance.preferences, { mode: "wait", speedIndex: 3 });
});

test("late actual appearance preparation rechecks the Flow owner before owned or actor publication", () => {
  for (const cause of ["title", "replace", "host", "operation"] as const) {
    const f = menuFixture(), before = f.game.checkpoint(), next = partyMenuFixture(), nextBefore = next.game.checkpoint();
    const prepare = f.game.field.prepareMenuPartyAppearance.bind(f.game.field);
    let publications = 0;
    const pending: { operation: ReturnType<GameFlow["beginOperation"]> | null } = { operation: null };
    f.game.field.prepareMenuPartyAppearance = (appearance) => {
      const publish = prepare(appearance);
      if (cause === "title") f.flow.returnToTitle();
      if (cause === "replace") { f.flow.start(next.game, { paused: true }); f.flow.observeHost(readyHost); }
      if (cause === "host") f.flow.observeHost({ ...readyHost, visible: false });
      if (cause === "operation") pending.operation = f.flow.beginOperation("load");
      return Object.assign(() => { publications++; publish(); }, { validate: publish.validate });
    };
    assert.equal(f.commands.changeParty({ expected: before.owned.party, change: { kind: "swap", from: 0, to: 1 } }), false);
    assert.equal(publications, 0);
    assert.deepEqual(f.game.checkpoint(), before);
    assert.deepEqual(next.game.checkpoint(), nextBefore);
    pending.operation?.cancel();
  }
});

test("the shared party entry rejects malformed admission hooks while legacy callers keep their contract", () => {
  const { game } = partyMenuFixture(), before = game.checkpoint(), request = {
    expected: game.state.snapshot().party, change: { kind: "swap" as const, from: 0 as const, to: 1 as const },
  };
  assert.throws(() => game.changeParty(request, true as unknown as () => boolean), /admission predicate/);
  assert.equal(game.changeParty(request, () => false), false); assert.deepEqual(game.checkpoint(), before);
  assert.equal(game.changeParty(request), true);
});

test("shop commands require active host input and retain real inventory/gil transactions", () => {
  const f = gameFlowFixture({ shop: true }); startFlow(f.flow);
  const commands = new GameCommands(f.flow, f.game);
  f.flow.confirm(); f.flow.confirm(); assert.ok(f.game.field.currentShop);
  const before = f.game.state.snapshot(), shop = f.game.field.currentShop;
  for (const host of [{ ...readyHost, visible: false }, { ...readyHost, mediaReady: false },
    { ...readyHost, overlayOpen: true }]) {
    f.flow.observeHost(host);
    assert.equal(commands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
    assert.equal(commands.closeShop(), false);
    assert.deepEqual(f.game.state.snapshot(), before); assert.deepEqual(f.game.field.currentShop, shop);
  }
  f.flow.observeHost(readyHost); f.flow.pause(true);
  assert.equal(commands.shopReady, false); assert.equal(commands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
  f.flow.pause(false);
  const result = commands.tradeShop({ kind: "buy", productId: 1001, count: 1 });
  assert.equal(result?.totalPrice, 30); assert.equal(f.game.state.snapshot().gil, 60);
  assert.deepEqual(f.game.state.snapshot().items, [{ id: 10, count: 1 }]);
  assert.equal(commands.closeShop(), true); assert.equal(commands.closeShop(), false);
  assert.equal(f.game.field.dialogue?.key, "GOODBYE");
});

test("battle input denies paused/background/overlay/operation while keeping a live presentation binding", () => {
  const f = battleFixture(), before = f.game.state.snapshot();
  const reject = () => {
    const available = f.instance.ready.map(player => player.id);
    assert.equal(f.commands.command(f.instance, "a", 10, "e1"), false);
    assert.equal(f.commands.commandItem(f.instance, "a", 10, { kind: "single", id: "a" }, 100), false);
    assert.equal(f.commands.requestEscape(f.instance), false);
    assert.deepEqual(f.instance.ready.map(player => player.id), available);
    assert.deepEqual(f.game.state.snapshot(), before);
  };
  f.flow.pause(true); reject(); assert.equal(f.commands.ownsBattle(f.instance), true);
  f.flow.pause(false);
  for (const host of [{ ...readyHost, visible: false }, { ...readyHost, mediaReady: false },
    { ...readyHost, overlayOpen: true }]) { f.flow.observeHost(host); reject(); }
  f.flow.observeHost(readyHost); const operation = f.flow.beginOperation("load"); reject(); operation.cancel();
  assert.equal(f.commands.canEscape(f.instance), false, "the gateway grants no source escape policy");
  assert.equal(f.commands.command(f.instance, "a", 10, "e1"), true);
  assert.equal(f.commands.command(f.instance, "a", 10, "e1"), false, "the actual action owner still consumes readiness once");
});

test("retry rejects an old exact battle even when the same owner and actor IDs are ready again", () => {
  const f = battleFixture();
  for (const player of f.instance.players) { player.hp = 0; player.conditionIds = [305]; }
  f.flow.advance(10, readyHost); assert.equal(f.commands.canRetryBattle(f.instance), true);
  assert.equal(f.commands.canReturnBattle(f.instance), false);
  assert.equal(f.flow.retryBattle(), true);
  const next = f.game.battle!, before = f.game.state.snapshot();
  assert.notEqual(next, f.instance); assert.equal(f.commands.ownsBattle(f.instance), false);
  assert.equal(f.commands.command(f.instance, "a", 10, "e1"), false);
  assert.equal(f.commands.commandItem(f.instance, "a", 10, { kind: "single", id: "a" }, 100), false);
  assert.equal(f.commands.canRetryBattle(f.instance), false); assert.equal(f.commands.canReturnBattle(f.instance), false);
  assert.equal(f.commands.requestEscape(f.instance), false);
  assert.deepEqual(f.game.state.snapshot(), before);
  assert.equal(f.commands.command(next, "a", 10, "e1"), true);
});

test("terminal button admission delegates once-only return to the real prepared handoff", async () => {
  const data = checkpointFixture(), game = new GameSession(data.field, data.battle, 314, { battleHandoff: "prepared" });
  const flow = new GameFlow(game); startFlow(flow);
  const commands = new GameCommands(flow, game), handoff = new GameBattleHandoff(flow, {
    prepareStart: async () => ({}), prepareReturn: async () => ({}), discard: () => {},
  });
  game.field.startEvent("fight"); assert.equal((await handoff.start()).status, "committed");
  const battle = game.battle!;
  for (const [index, actor] of battle.ready.entries())
    assert.equal(commands.command(battle, actor.id, 10, battle.enemies[index]!.id), true);
  flow.advance(2000, readyHost); assert.equal(battle.phase, "victory");
  const before = game.state.snapshot();
  flow.observeHost({ ...readyHost, mediaReady: false }); assert.equal(commands.canReturnBattle(battle), false);
  assert.deepEqual(game.state.snapshot(), before);
  flow.observeHost(readyHost); assert.equal(commands.canReturnBattle(battle), true);
  assert.equal((await handoff.return()).status, "committed");
  assert.equal(game.state.snapshot().completedBattles.length, 1);
  assert.equal(commands.canReturnBattle(battle), false); assert.equal(commands.ownsBattle(battle), false);
  assert.equal(commands.canRetryBattle(battle), false);
});
