import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { installRowChange } from "./fixtures/battle-row-change.js";

function setup() {
  const f = checkpointFixture();
  installRowChange(f.battle.common);
  const game = new GameSession(f.field, f.battle, 43);
  const snapshot = game.state.snapshot();
  // Other saved slots and unoccupied rows must not follow a battle-local Corps.
  snapshot.party.slots[1][2] = { id: "a", row: "front" };
  snapshot.party.slots[0][3].row = "back";
  game.state.restore(snapshot);
  game.field.startEvent("fight"); game.advance(10);
  assert.ok(game.battle);
  game.battle.combatants.forEach((unit) => { unit.atb = -1000; });
  return { ...f, game };
}
function changeRow(game: GameSession) {
  const actor = game.battle!.players[0]!;
  actor.atb = 100;
  const before = actor.row;
  assert.equal(game.battle!.command(actor.id, 4, actor.id, 5), true);
  assert.equal(actor.row, before);
  for (let i = 0; i < 1000 && actor.row === before; i++) game.advance(10);
  assert.notEqual(actor.row, before);
  return actor;
}
function win(game: GameSession) {
  game.battle!.enemies.forEach((enemy) => { enemy.hp = 0; });
  for (let i = 0; i < 1000 && game.battle!.phase === "active"; i++) game.advance(10);
  assert.equal(game.battle!.phase, "victory");
}

test("same session publishes changed Corps rows with victory, menu, checkpoint and next battle", () => {
  const { game, field, battle } = setup();
  const before = game.state.snapshot(), actor = changeRow(game);
  assert.equal(actor.row, "back");
  assert.deepEqual(game.state.snapshot(), before);
  win(game);
  assert.equal(game.continueVictory(), true);
  game.advance(10);
  assert.equal(game.menuReady, true);
  assert.deepEqual(game.state.activeParty.map(({ id, row }) => ({ id, row })),
    [{ id: "a", row: "back" }, { id: "b", row: "front" }]);
  const saved = game.checkpoint();
  assert.deepEqual(saved.owned.party.slots[1], before.party.slots[1]);
  assert.deepEqual(saved.owned.party.slots[2], before.party.slots[2]);
  assert.deepEqual(saved.owned.party.slots[0][3], before.party.slots[0][3]);
  const restored = GameSession.restore(JSON.parse(JSON.stringify(saved)), field, battle);
  assert.deepEqual(restored.checkpoint(), saved);
  restored.field.startEvent("fight"); restored.advance(10);
  assert.equal(restored.battle!.players[0]!.row, "back");
});

test("defeat and retry retain the original lease rows instead of publishing the changed Corps", () => {
  const { game } = setup(), before = game.state.snapshot();
  changeRow(game);
  game.battle!.players.forEach((player) => { player.hp = 0; player.conditionIds = [305]; });
  for (let i = 0; i < 1000 && game.battle!.phase === "active"; i++) game.advance(10);
  assert.equal(game.battle!.phase, "defeat");
  assert.equal(game.retryBattle(), true);
  assert.equal(game.battle!.players[0]!.row, "front");
  assert.deepEqual(game.state.snapshot(), before);
});

test("a rejected field return leaves row and rewards uncommitted; the same victory may retry", () => {
  const { game } = setup(), before = game.state.snapshot();
  changeRow(game); win(game);
  const prepare = game.field.prepareEncounterReturn;
  game.field.prepareEncounterReturn = () => { throw new Error("controlled return provider unavailable"); };
  assert.throws(() => game.continueVictory(), /controlled return/);
  assert.deepEqual(game.state.snapshot(), before);
  assert.ok(game.battle!.previewVictory());
  assert.equal(game.state.inBattle, true);
  game.field.prepareEncounterReturn = prepare;
  assert.equal(game.continueVictory(), true);
  assert.equal(game.state.activeParty[0]!.row, "back");
});

test("victory row preflight rejects missing/invalid rows and wrong participant identity atomically", () => {
  const f = checkpointFixture(); installRowChange(f.battle.common);
  const game = new GameSession(f.field, f.battle, 43), owner = game.state;
  const before = owner.snapshot(), lease = owner.openBattle(1000);
  const valid = owner.battlePlayers(lease); valid[0]!.row = "back";
  for (const mutation of [
    (players: typeof valid) => { players[1]!.row = "invalid" as "front"; },
    (players: typeof valid) => { delete (players[1] as Partial<typeof valid[number]>).row; },
    (players: typeof valid) => { players[1]!.sourceId++; },
  ]) {
    const players = structuredClone(valid); mutation(players);
    assert.throws(() => owner.prepareVictory(lease, { players, gil: 0, consumedItems: [] }), /identity/);
    assert.deepEqual(owner.snapshot(), before);
  }
  const commit = owner.prepareVictory(lease, { players: valid, gil: 0, consumedItems: [] });
  assert.deepEqual(owner.snapshot(), before);
  owner.cancelBattle(lease);
  assert.throws(commit, /Stale/);
  assert.deepEqual(owner.snapshot(), before);
});
