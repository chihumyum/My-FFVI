import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { playerSessionFixture } from "./fixtures/battle-player-game.js";
import { characterLearningFixture } from "./fixtures/character-learning.js";

function start(f = playerSessionFixture(), seed = 301) {
  const game = new GameSession(f.field, f.battle, seed);
  game.field.startEvent("fight"); game.advance(10); assert.ok(game.battle);
  return { game, f, battle: game.battle };
}
export function winPlayerSession(game: GameSession) {
  for (let frame = 0; frame < 20000 && game.battle?.phase === "active"; frame++) {
    for (const actor of game.battle.ready) {
      const target = game.battle.targets(actor.id, 10)[0];
      if (target) game.battle.command(actor.id, 10, target.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, "victory");
}
const snapshot = (battle: BattleGame) => ({ units: structuredClone(battle.combatants),
  players: battle.playerExecution, event: battle.eventExecution, enemy: battle.participantExecution,
  action: structuredClone(battle.action), pending: battle.pendingActions,
  phase: battle.phase, reward: structuredClone(battle.reward), events: structuredClone(battle.events), time: battle.time });

test("player joining uses an existing owner and the first empty saved cell's row", () => {
  const { game, battle } = start(playerSessionFixture([{ kind: "add-player", sourceId: 33 }]));
  const before = game.state.snapshot(), owner = battle.players[0]!;
  game.advance(10);
  const guest = battle.players.find(player => player.sourceId === 33)!;
  assert.equal(guest.id, "player:dynamic:1"); assert.equal(guest.row, "back");
  assert.equal(battle.playerOwnedId(guest.id), "guest:33");
  assert.equal(battle.players[0], owner); assert.deepEqual(game.state.snapshot(), before);
  assert.deepEqual(battle.playerExecution!.slots.map(cell => cell.instanceId), ["a", guest.id, "b", null]);
  const detached = battle.playerExecution!; detached.entries[0]!.ownedId = "other";
  assert.equal(battle.playerExecution!.entries[0]!.ownedId, "a");
});

test("group changes retire old actors, retain resources and never rebind their queued actions", () => {
  const { game, battle } = start(playerSessionFixture([
    { kind: "wait", seconds: 0.04 }, { kind: "change-player-group", group: 1 },
    { kind: "wait", seconds: 0.03 }, { kind: "change-player-group", group: 0 },
  ]));
  battle.players[0]!.mp = 3;
  assert.equal(battle.command("a", 10, "e1"), true);
  assert.equal(battle.command("b", 10, "e1"), true);
  game.advance(60);
  assert.deepEqual(battle.players.map(player => battle.playerOwnedId(player.id)), ["c", "d"]);
  assert.ok(battle.pendingActions.every(action => action.actor !== "a" && action.actor !== "b"));
  assert.ok(!battle.action || !["a", "b"].includes(battle.action.actor));
  assert.equal(battle.command("a", 10, "e1"), false);
  game.advance(70);
  const returned = battle.players.find(player => battle.playerOwnedId(player.id) === "a")!;
  assert.ok(returned.id.startsWith("player:dynamic:")); assert.equal(returned.mp, 3);
  assert.equal(battle.command("a", 10, "e1"), false);
  assert.equal(battle.playerExecution!.entries.filter(entry => entry.ownedId === "a").length, 2);
});

test("late group publication failure restores owners, ledger and RNG for zero-delta retry", () => {
  const f = playerSessionFixture([{ kind: "change-player-group", group: 1 }]);
  const controlled = playerSessionFixture([{ kind: "change-player-group", group: 1 }]);
  const { game, battle } = start(f, 307);
  const control = start(controlled, 307), before = snapshot(battle), owners = [...battle.combatants];
  Object.defineProperty(battle.events, "push", { configurable: true,
    value: () => { throw new Error("Controlled player publication failure"); } });
  assert.throws(() => game.advance(10), /Controlled player publication/);
  assert.deepEqual(snapshot(battle), before); assert.ok(battle.combatants.every((unit, index) => unit === owners[index]));
  delete (battle.events as unknown as { push?: unknown }).push;
  battle.advance(0); control.game.advance(10);
  assert.deepEqual(snapshot(battle), snapshot(control.battle));
});

test("action-start observation reaches all present eligible owners and never a later entrant", () => {
  const f = playerSessionFixture([{ kind: "wait", seconds: 1.2 }, { kind: "add-player", sourceId: 33 }]);
  const learning = characterLearningFixture(), common = f.battle.common;
  common.observedLearning = structuredClone(learning.catalog);
  common.observedLearning.candidates[0]!.observedAbilityId = 10;
  common.abilities[10]!.program.rules.type_id = 504;
  for (const [index, sourceId] of [8, 9].entries()) {
    const player = common.players[index]!; player.sourceId = sourceId;
    player.ownedAbilities = { sourceId, jobId: 1, magicStoneId: 0, abilities: structuredClone(learning.member.abilities) };
  }
  const { game, battle } = start(f, 309);
  assert.equal(battle.command("a", 10, "e1"), true); game.advance(1500);
  assert.ok(battle.players.some(player => player.sourceId === 33));
  const log = (battle as unknown as { playerObservations: Map<string, number[]> }).playerObservations;
  assert.deepEqual(log.get("a"), [10]); assert.deepEqual(log.get("b"), [10]);
  assert.deepEqual(log.get("guest:33"), []);
});

test("result names use held owners even after every active runtime ID changed", () => {
  const f = playerSessionFixture(); f.battle.common.growth.g!.push({ level: 3, hp: 5, mp: 1 });
  f.battle.common.experience.push({ level: 3, exp: 1 });
  const { game, battle } = start(f, 310); winPlayerSession(game);
  assert.equal(battle.reward!.levels.length, 5);
  for (const level of battle.reward!.levels) assert.equal(battle.resultPlayerName(level.id),
    f.battle.common.players.find(player => player.id === level.id)!.name);
  assert.throws(() => battle.resultPlayerName("unheld"));
});

test("one owner participates multiple times but receives one result, return, save and next battle receipt", () => {
  const { game, f, battle } = start(), before = game.state.snapshot();
  winPlayerSession(game);
  const result = battle.previewVictory()!;
  assert.deepEqual(result.players.map(player => player.id), ["a", "b", "guest:33", "c", "d"]);
  assert.ok(result.playerParticipants!.state.entries.length > result.players.length);
  assert.equal(result.awardedExperience.length, 5);
  assert.equal(result.playerParticipants!.observations.length, 5);
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false); game.advance(10);
  assert.deepEqual(game.state.snapshot().party, before.party);
  assert.equal(game.state.snapshot().completedBattles.length, 1);
  const checkpoint = JSON.parse(JSON.stringify(game.checkpoint())), loaded = GameSession.restore(checkpoint, f.field, f.battle);
  assert.deepEqual(loaded.checkpoint(), checkpoint);
  loaded.field.startEvent("fight"); loaded.advance(10); winPlayerSession(loaded);
  assert.equal(loaded.continueVictory(), true); loaded.advance(10);
  assert.equal(loaded.state.snapshot().completedBattles.length, 2);
});

test("failed field return publishes no player resource, reward or permanent party change", () => {
  const { game, battle } = start(), before = game.state.snapshot(); winPlayerSession(game);
  const original = game.field.prepareEncounterReturn.bind(game.field), result = battle.previewVictory();
  game.field.prepareEncounterReturn = () => { throw new Error("Controlled borrowed return failure"); };
  assert.throws(() => game.continueVictory(), /Controlled borrowed return/);
  assert.deepEqual(game.state.snapshot(), before); assert.deepEqual(battle.previewVictory(), result);
  game.field.prepareEncounterReturn = original;
  assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false);
});

test("defeat retries the frozen held pool and initial party despite mutable content changes", () => {
  const { game, battle } = start(), before = game.state.snapshot(); game.advance(150);
  for (const player of battle.players) { player.hp = 0; player.conditionIds = [305]; }
  game.advance(10); assert.equal(battle.phase, "defeat");
  battle.content.playerParticipants!.sourceIds.splice(0); battle.content.playerParticipants!.groups.splice(0);
  assert.equal(game.retryBattle(), true);
  assert.deepEqual(game.battle!.players.map(player => player.id), ["a", "b"]);
  assert.equal(game.battle!.playerExecution!.nextGeneration, 1);
  assert.deepEqual(game.state.snapshot(), before);
  winPlayerSession(game); assert.equal(game.continueVictory(), true);
});

test("an unheld source identity is a pre-entry blocker and cannot borrow source1 as a fallback", () => {
  const f = playerSessionFixture([{ kind: "add-player", sourceId: 9999 }]), game = new GameSession(f.field, f.battle, 313);
  const before = game.state.snapshot(); game.field.startEvent("fight"); game.advance(10);
  assert.equal(game.battle, null); assert.equal(game.field.stop?.kind, "unsupported");
  assert.deepEqual(game.state.snapshot(), before);
});
