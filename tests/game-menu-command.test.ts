import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { parseGameMenuCommand, type GameMenuCommand } from "../src/core/game-menu-command.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameFlow, type GameFlowOperation } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { partyMenuFixture } from "./fixtures/party-menu.js";
import { gameFlowFixture, readyHost, startFlow } from "./fixtures/game-flow.js";

const mutations: GameMenuCommand[] = [
  { kind: "use-item", itemId: 10, targetId: "a" },
  { kind: "change-equipment", playerId: "a", slot: 5, contentId: 5 },
  { kind: "change-party", change: { kind: "swap", from: 0, to: 1 } },
  { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 4 } },
];
function fixture() {
  const f = partyMenuFixture(), flow = new GameFlow(f.game);
  f.game.state.fieldInventory.prepare({ kind: "grant-item", id: 10, count: 3 }).commit();
  const owned = f.game.state.snapshot(); owned.roster[0]!.hp = 30; f.game.state.restore(owned);
  startFlow(flow); flow.pause(true);
  return { ...f, flow, commands: new GameCommands(flow, f.game) };
}

test("declared menu inputs snapshot all four existing command types across object realms", () => {
  const original: GameMenuCommand[] = [...structuredClone(mutations),
    { kind: "change-equipment", playerId: "a", slot: 6, contentId: 5 },
    { kind: "change-party", change: { kind: "set-row", position: 1, row: "back" } },
    { kind: "change-party", change: { kind: "set-member", slot: 2, position: 3, ownedId: "a", row: "back" } },
    { kind: "change-party", change: { kind: "set-member", slot: 1, position: 0, ownedId: null, row: "front" } },
    { kind: "change-party", change: { kind: "select-slot", slot: 2 } }];
  const foreign = runInNewContext("(" + JSON.stringify(original) + ")") as unknown[];
  const parsed = Array.from(foreign, parseGameMenuCommand);
  assert.deepEqual(parsed, original);
  const party = original[2] as Extract<GameMenuCommand, { kind: "change-party" }>,
    preferences = original[3] as Extract<GameMenuCommand, { kind: "set-preferences" }>;
  const savedParty = parseGameMenuCommand(party), savedPreferences = parseGameMenuCommand(preferences);
  const member = original[6] as Extract<GameMenuCommand, { kind: "change-party" }>;
  const savedMember = parseGameMenuCommand(member);
  member.change = { kind: "set-member", slot: 0, position: 0, ownedId: "b", row: "front" };
  party.change = { kind: "set-row", position: 0, row: "back" }; preferences.preferences.speedIndex = 0;
  assert.deepEqual(savedParty, mutations[2]); assert.deepEqual(savedPreferences, mutations[3]);
  assert.deepEqual(savedMember, { kind: "change-party", change: {
    kind: "set-member", slot: 2, position: 3, ownedId: "a", row: "back" } });
  assert.deepEqual(parseGameMenuCommand(Object.assign(Object.create(null), mutations[0])), mutations[0]);
});

test("invalid fields and boundaries never become a partially applied typed input", () => {
  const f = fixture(), before = f.game.checkpoint();
  const invalid: unknown[] = [
    { kind: "shop", itemId: 10, targetId: "a" },
    { kind: "use-item", itemId: 0, targetId: "a" },
    { kind: "use-item", itemId: 0x80000000, targetId: "a" },
    { kind: "use-item", itemId: 10, targetId: " a" },
    { kind: "use-item", itemId: 10, targetId: "x".repeat(161) },
    { kind: "use-item", itemId: 10, targetId: "a", count: 2 },
    { kind: "change-equipment", playerId: "a", slot: 0, contentId: 5 },
    { kind: "change-equipment", playerId: "a", slot: 7, contentId: 5 },
    { kind: "change-equipment", playerId: "a", slot: 5, contentId: "5" },
    { kind: "change-party", change: { kind: "swap", from: 0, to: 4 } },
    { kind: "change-party", change: { kind: "set-row", position: 0, row: "rear" } },
    { kind: "change-party", change: { kind: "swap", from: 0, to: 1 }, expected: before.owned.party },
    ...[
      { kind: "set-member", slot: 3, position: 0, ownedId: "a", row: "front" },
      { kind: "set-member", slot: 0, position: 4, ownedId: "a", row: "front" },
      { kind: "set-member", slot: 0, position: 0, ownedId: 1, row: "front" },
      { kind: "set-member", slot: 0, position: 0, ownedId: " a", row: "front" },
      { kind: "set-member", slot: 0, position: 0, ownedId: null },
      { kind: "set-member", slot: 0, position: 0, ownedId: null, row: "front", sourceId: 1 },
      { kind: "select-slot", slot: -1 }, { kind: "select-slot", slot: 3 },
      { kind: "select-slot", slot: "1" }, { kind: "select-slot", slot: 1, enabled: true },
    ].map(change => ({ kind: "change-party", change })),
    { kind: "set-preferences", preferences: { mode: "active", speedIndex: 5 } },
    { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 4, extra: true } },
  ];
  for (const input of invalid) {
    assert.throws(() => parseGameMenuCommand(input));
    assert.throws(() => f.commands.menu(input as GameMenuCommand));
  }
  assert.deepEqual(f.game.checkpoint(), before);
});

test("accessors, symbols and inherited input data cannot run a reentrant command during parsing", () => {
  const f = fixture(), before = f.game.checkpoint(); let getters = 0;
  const target = { kind: "use-item", itemId: 10 };
  Object.defineProperty(target, "targetId", { enumerable: true, get() { getters++; f.flow.returnToTitle(); return "a"; } });
  const preferences = { mode: "wait" };
  Object.defineProperty(preferences, "speedIndex", { enumerable: true, get() { getters++; return 4; } });
  const membership = { kind: "set-member", slot: 0, position: 0, row: "front" };
  Object.defineProperty(membership, "ownedId", { enumerable: true, get() { getters++; f.flow.returnToTitle(); return "b"; } });
  class Input { kind = "use-item"; itemId = 10; targetId = "a"; }
  for (const input of [target, { kind: "set-preferences", preferences }, { kind: "change-party", change: membership }, new Input(),
    { ...mutations[0], [Symbol("metadata")]: 1 }, Object.create(mutations[0]!)])
    assert.throws(() => f.commands.menu(input as GameMenuCommand));
  assert.equal(getters, 0); assert.equal(f.flow.currentSession, f.game); assert.equal(f.flow.started, true);
  assert.deepEqual(f.game.checkpoint(), before);
  f.flow.returnToTitle();
  assert.throws(() => f.commands.menu({ kind: "use-item" } as GameMenuCommand),
    /fields/, "Malformed typed input throws before admission, including at title");
});

test("the shared menu command updates real inventory, equipment, party, preferences and checkpoint owners", () => {
  const f = fixture(), initial = f.game.state.snapshot(), time = f.game.field.time;
  assert.equal(f.commands.menu(mutations[0]!), true);
  assert.equal(f.game.state.snapshot().roster[0]!.hp, 80);
  assert.deepEqual(f.game.state.snapshot().items, [{ id: 10, count: 2 }]);
  assert.equal(f.commands.menu(mutations[1]!), true);
  assert.equal(f.commands.menu(mutations[2]!), true);
  assert.equal(f.game.state.activeParty[0]!.id, "b"); assert.equal(f.game.field.player.asset, "bravo");
  assert.equal(f.commands.menu({ kind: "change-party", change: { kind: "set-row", position: 1, row: "back" } }), true);
  assert.equal(f.game.state.activeParty[1]!.row, "back");
  assert.equal(f.commands.menu(mutations[3]!), true);
  assert.deepEqual(f.game.battlePreferences, { mode: "wait", speedIndex: 4 });
  assert.equal(f.game.state.snapshot().gil, initial.gil); assert.equal(f.game.field.time, time);
  const saved = f.game.checkpoint(), restored = GameSession.restore(saved, f.field, f.battle);
  assert.deepEqual(restored.checkpoint(), saved);
});

test("unadmitted typed commands cannot inspect a party model or mutate either old or replacement owner", () => {
  const f = fixture(), before = f.game.checkpoint(); let models = 0;
  const partyMenu = f.game.partyMenu.bind(f.game);
  f.game.partyMenu = () => { models++; return partyMenu(); };
  const reject = () => {
    for (const command of mutations) assert.equal(f.commands.menu(command), false);
    assert.deepEqual(f.game.checkpoint(), before); assert.equal(models, 0);
  };
  f.flow.pause(false); reject(); f.flow.pause(true);
  for (const host of [{ ...readyHost, visible: false }, { ...readyHost, mediaReady: false },
    { ...readyHost, overlayOpen: true }]) { f.flow.observeHost(host); reject(); }
  f.flow.observeHost(readyHost);
  for (const kind of ["new-game", "load", "save", "map", "battle-entry", "battle-return"] as GameFlowOperation[]) {
    const operation = f.flow.beginOperation(kind); reject(); operation.cancel();
  }
  f.flow.returnToTitle(); reject();
  const next = fixture(), nextBefore = next.game.checkpoint();
  f.flow.start(next.game, { paused: true }); f.flow.observeHost(readyHost); reject();
  assert.deepEqual(next.game.checkpoint(), nextBefore);
});

test("party commands use a new current model each time while no-effect results keep original owner semantics", () => {
  const f = fixture(), initial = f.game.state.snapshot().party;
  assert.equal(f.commands.menu(mutations[2]!), true); assert.equal(f.commands.menu(mutations[2]!), true);
  assert.deepEqual(f.game.state.snapshot().party, initial);
  assert.equal(f.commands.menu(mutations[1]!), true);
  const equipped = f.game.checkpoint();
  assert.equal(f.commands.menu(mutations[1]!), false); assert.deepEqual(f.game.checkpoint(), equipped);
  assert.equal(f.commands.menu({ kind: "change-party", change: { kind: "swap", from: 0, to: 0 } }), false);
  assert.equal(f.commands.menu({ kind: "use-item", itemId: 10, targetId: "unowned" }), false);
  assert.deepEqual(f.game.checkpoint(), equipped);
  const preferences = f.game.battlePreferences;
  assert.equal(f.commands.menu({ kind: "set-preferences", preferences }), true);
  assert.deepEqual(f.game.checkpoint(), equipped, "Preference acceptance does not promise a value change");
});

test("paused battle preferences remain admitted without acquiring inventory or party menu rights", () => {
  const f = gameFlowFixture(); startFlow(f.flow); f.game.field.startEvent("fight"); f.flow.advance(10, readyHost);
  assert.ok(f.game.battle); f.flow.pause(true);
  const commands = new GameCommands(f.flow, f.game), owned = f.game.state.snapshot();
  for (const command of mutations.slice(0, 3)) assert.equal(commands.menu(command), false);
  assert.equal(commands.menu(mutations[3]!), true);
  assert.deepEqual(f.game.battle.preferences, { mode: "wait", speedIndex: 4 });
  assert.deepEqual(f.game.state.snapshot(), owned);
});

test("actual party preparation still rechecks owner and asynchronous operation admission before publication", () => {
  for (const cause of ["title", "replace", "host", "operation"] as const) {
    const f = fixture(), before = f.game.checkpoint(), next = fixture(), nextBefore = next.game.checkpoint();
    const prepare = f.game.field.prepareMenuPartyAppearance.bind(f.game.field); let publications = 0;
    const pending: { operation: ReturnType<GameFlow["beginOperation"]> | null } = { operation: null };
    f.game.field.prepareMenuPartyAppearance = (appearance) => {
      const publish = prepare(appearance);
      if (cause === "title") f.flow.returnToTitle();
      if (cause === "replace") { f.flow.start(next.game, { paused: true }); f.flow.observeHost(readyHost); }
      if (cause === "host") f.flow.observeHost({ ...readyHost, mediaReady: false });
      if (cause === "operation") pending.operation = f.flow.beginOperation("load");
      return Object.assign(() => { publications++; publish(); }, { validate: publish.validate });
    };
    assert.equal(f.commands.menu(mutations[2]!), false);
    assert.equal(publications, 0); assert.deepEqual(f.game.checkpoint(), before);
    assert.deepEqual(next.game.checkpoint(), nextBefore); pending.operation?.cancel();
  }
});
