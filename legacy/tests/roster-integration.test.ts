import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import type { RosterCommand } from "../src/core/roster.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";

const leave: RosterCommand = {
  kind: "secede",
  sourceId: 2,
  removeEquipment: true,
  refreshActors: true,
};
const rejoin: RosterCommand = {
  kind: "join",
  sourceId: 2,
  position: null,
  row: "front",
  refreshActors: false,
  recovery: false,
  refitEquipment: true,
};
function setup() {
  const { field, catalog } = equipmentGameFixture();
  return { field, catalog, game: new GameSession(field, catalog) };
}

test("departed owners retain identity and progress but release registered equipment occupancy", () => {
  const { game, field, catalog } = setup();
  const before = game.state.snapshot();
  before.party.slots[1][3].id = "b";
  game.state.restore(before);
  game.state.fieldRoster.prepare(leave).commit(); // Controlled state owner, no field rendering claim.
  const after = game.state.snapshot(),
    member = after.roster[1]!;
  assert.deepEqual(member, { ...before.roster[1], enabled: false });
  assert.equal(after.party.slots[0][1].id, null);
  assert.equal(after.party.slots[1][3].id, "b");
  assert.deepEqual(
    game.players.map((p) => p.id),
    ["a"],
  );
  assert.ok(game.state.equipmentInventory.every((s) => s.available >= 0));
  assert.deepEqual(
    GameSession.restore(game.checkpoint(), field, catalog).checkpoint(),
    game.checkpoint(),
  );
  game.state.fieldRoster.prepare(rejoin).commit();
  const returned = game.state.snapshot();
  assert.deepEqual(returned.roster, before.roster);
  assert.deepEqual(returned.equipmentStock, before.equipmentStock);
  assert.deepEqual(
    game.players.map((p) => p.id),
    ["a", "b"],
  );
});

test("candidate roster, inventory and slots share one draft revision and publish together", () => {
  const { game } = setup(),
    before = game.state.snapshot();
  const draft = game.state.prepareFieldState();
  const stale = draft.ports.party.prepare({
    kind: "select-slot",
    slot: 1,
    refreshActors: false,
  });
  draft.ports.roster.prepare(leave).commit();
  assert.throws(stale.commit, /Stale/);
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 7 }).commit();
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(draft.commit(), true);
  assert.equal(game.state.snapshot().roster[1]!.enabled, false);
  assert.equal(game.gil, before.gil + 7);
  draft.ports.roster.prepare(rejoin).commit();
  assert.equal(game.state.snapshot().roster[1]!.enabled, true);
});

test("lifecycle preparation cannot bypass refresh, stale ownership, or missing initialization", () => {
  const { game, field } = setup(),
    before = game.state.snapshot();
  const source = { file: "synthetic", assetPath: "roster-integration" };
  field.scripts.depart = [
    {
      kind: "roster",
      command: leave,
      dependencies: [],
      script: "depart",
      index: 0,
      source,
    },
  ];
  game.field.startEvent("depart");
  game.advance(10);
  assert.match(game.field.stop!.message, /actor refresh/);
  assert.deepEqual(game.state.snapshot(), before);
  const transaction = game.state.fieldRoster.prepare(leave);
  game.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  assert.throws(transaction.commit, /Stale/);
  const next = game.state.snapshot();
  assert.throws(
    () =>
      game.state.fieldRoster.prepare({
        kind: "unlock",
        sourceId: 3,
        refreshActors: false,
      }),
    /initialization/,
  );
  assert.deepEqual(game.state.snapshot(), next);
});

test("battle ownership after departure excludes the disabled reserve and preserves it on victory", () => {
  const { game } = setup();
  game.state.fieldRoster.prepare(leave).commit();
  const reserve = game.state.snapshot().roster[1]!;
  game.field.startEvent("fight");
  game.advance(10);
  assert.deepEqual(
    game.battle!.players.map((p) => p.id),
    ["a"],
  );
  assert.throws(() => game.state.fieldRoster.prepare(rejoin), /reserved/);
  game.battle!.enemies.forEach((e) => {
    e.hp = 0;
  });
  game.advance(10);
  assert.equal(game.continueVictory(), true);
  assert.deepEqual(game.state.snapshot().roster[1], reserve);
  const active = game.state.snapshot().roster[0]!;
  assert.equal(active.additionalLevel, active.level);
});
