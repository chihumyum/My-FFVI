import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { cyclingAI } from "./fixtures/battle-ai.js";
import { enemyPartyFixture, enemyPartySessionFixture } from "./fixtures/battle-party-game.js";

const snapshot = (b: BattleGame) => ({ units: structuredClone(b.combatants), party: b.enemyPartyExecution,
  participants: b.participantExecution, event: b.eventExecution, pending: b.pendingActions,
  action: structuredClone(b.action), time: b.time, phase: b.phase, reward: b.reward,
  ai: b.enemies.map(unit => b.enemyAIState(unit.id)), events: structuredClone(b.events) });
function win(game: GameSession) {
  const waves: number[] = [];
  for (let n = 0; n < 30000 && game.battle?.phase === "active"; n++) {
    const battle = game.battle, party = battle.enemyPartyExecution.partyId;
    if (waves.at(-1) !== party) waves.push(party);
    for (const actor of battle.ready) {
      const target = battle.targets(actor.id, 10)[0]; if (target) battle.command(actor.id, 10, target.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, "victory"); return waves;
}

test("complete-party replacement keeps the player objects, root frame and encounter identity", () => {
  const c = enemyPartyFixture([{ kind: "change-enemy-party", partyId: 513, hidden: false },
    { kind: "calc", index: 1, operator: "←", right: { kind: "immediate", value: 77 } },
    { kind: "change-enemy-party", partyId: 514, hidden: false },
    { kind: "calc", index: 1, operator: "＋", right: { kind: "immediate", value: 1 } }]);
  const b = new BattleGame(c, 61), players = b.players, collection = b.combatants;
  players[0]!.mp = 3; b.advance(10);
  assert.deepEqual(b.enemies.map(unit => unit.id), ["enemy:dynamic:1", "enemy:dynamic:2"]);
  assert.equal(b.enemyAIState("e1"), null); assert.equal(b.enemyAIState("e2"), null);
  assert.equal(b.enemies[0]!.sourceId, b.enemies[1]!.sourceId);
  b.advance(10); b.advance(10);
  assert.equal(b.combatants, collection); assert.ok(b.players.every((unit, index) => unit === players[index]));
  assert.equal(b.players[0]!.mp, 3); assert.equal(b.content.encounterId, 1000);
  assert.equal(b.enemyPartyExecution.partyId, 514); assert.equal(b.eventExecution.state!.locals[1], 78);
  assert.equal(b.participantExecution.entries.filter(entry => entry.removed).length, 4);
});

test("new normal enemy decisions respect the retained no-act gate across a party change", () => {
  const c = enemyPartyFixture([{ kind: "enemy-no-act", enabled: true },
    { kind: "change-enemy-party", partyId: 513, hidden: false }]);
  c.initialAtb.enemy = [100, 100]; const b = new BattleGame(c, 63);
  b.advance(10); b.advance(10);
  assert.equal(b.eventExecution.controls.enemyNoAct, true);
  assert.ok(b.pendingActions.every(action => !b.enemies.some(unit => unit.id === action.actor)));
});

test("a late second-unit admission failure restores every prior member and the random entry stream", () => {
  const c = enemyPartyFixture(); c.initialAtb.enemy = [0, 80];
  c.participants!.enemyParties![513]!.members[1]!.sourceId = 72;
  const master = c.participants!.enemyDefinitions[72]!; master.ai = cyclingAI([500]); master.abilities = [500];
  c.abilities[500] = { ...structuredClone(c.abilities[13]!), id: 500,
    program: { ...structuredClone(c.abilities[13]!.program), abilityId: 500 } };
  const b = new BattleGame(c, 67), control = new BattleGame(structuredClone(c), 67);
  const owners = [...b.combatants], before = snapshot(b), plan = c.abilities[500]!.plan;
  c.abilities[500]!.plan = null;
  assert.throws(() => b.advance(10), /ability|Ability/); assert.deepEqual(snapshot(b), before);
  assert.ok(b.combatants.every((unit, index) => unit === owners[index]));
  c.abilities[500]!.plan = plan; b.advance(0); control.advance(10);
  assert.deepEqual(snapshot(b), snapshot(control));
});

test("post-publication failure restores phase layout, visibility, AI owners and original object identities", () => {
  const c = enemyPartyFixture([{ kind: "change-enemy-party", partyId: 513, hidden: true }]);
  const b = new BattleGame(c, 71), control = new BattleGame(structuredClone(c), 71), before = snapshot(b), owners = [...b.combatants];
  Object.defineProperty(b.events, "push", { configurable: true,
    value: () => { throw new Error("Controlled phase publication failure"); } });
  assert.throws(() => b.advance(10), /Controlled phase publication/);
  assert.deepEqual(snapshot(b), before); assert.ok(b.combatants.every((unit, index) => unit === owners[index]));
  delete (b.events as unknown as { push?: unknown }).push; b.advance(0); control.advance(10);
  assert.deepEqual(snapshot(b), snapshot(control));
});

test("slot joins after a party transition use the current layout and never alias a retired target", () => {
  const c = enemyPartyFixture([{ kind: "change-enemy-party", partyId: 513, hidden: true },
    { kind: "add-enemy", monsterId: 342, uniqueId: 2 }]);
  const b = new BattleGame(c, 73); b.advance(10);
  assert.ok(b.enemies.every(unit => !b.isCombatantVisible(unit.id)));
  assert.ok(b.players.every(unit => b.isCombatantVisible(unit.id)));
  b.advance(10); const joined = b.enemies.find(unit => unit.sourceId === 342)!;
  assert.deepEqual(joined.placement, c.participants!.enemyParties![513]!.slots[2]);
  assert.equal(b.isCombatantVisible(joined.id), true);
  assert.equal(b.command("a", 10, "e1"), false);
});

test("missing party or a mixed root's absent layout is rejected before any owned state is borrowed", () => {
  const c = enemyPartyFixture(); delete c.participants!.enemyParties![513];
  assert.throws(() => new BattleGame(c, 79), /admitted replacement/);
  const mixed = enemyPartyFixture([{ kind: "add-enemy", monsterId: 342, uniqueId: 2 }]);
  delete mixed.participants!.enemyParties![514]!.slots[2];
  assert.throws(() => new BattleGame(mixed, 79), /slot in replacement/);
});

test("four rounds keep one battle lease, resume progress through root SyncAI and return rewards exactly once", () => {
  for (const [scope, exp, gil] of [["active-units", 11, 13], ["all-entered", 62, 66]] as const) {
    const f = enemyPartySessionFixture(scope), game = new GameSession(f.field, f.battle, 83), before = game.state.snapshot();
    game.field.startEvent("fight"); game.advance(10);
    const battle = game.battle;
    assert.deepEqual(win(game), [1000, 513, 514, 515]);
    assert.equal(game.battle, battle); assert.equal(game.battle!.eventExecution.state!.locals[1], 3);
    assert.equal(game.battle!.reward!.exp, exp); assert.equal(game.battle!.reward!.gil, gil);
    assert.deepEqual(game.state.snapshot(), before);
    assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false); game.advance(10);
    assert.equal(game.state.snapshot().completedBattles.length, 1);
    const checkpoint = JSON.parse(JSON.stringify(game.checkpoint()));
    const restored = GameSession.restore(checkpoint, f.field, f.battle);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    restored.field.startEvent("fight"); restored.advance(10); win(restored);
    assert.equal(restored.continueVictory(), true); restored.advance(10);
    assert.equal(restored.state.snapshot().completedBattles.length, 2);
    assert.equal(restored.gil, before.gil + gil * 2);
  }
});

test("defeat in a later round retries the frozen initial roster and full phase plan", () => {
  const f = enemyPartySessionFixture(), game = new GameSession(f.field, f.battle, 89);
  game.field.startEvent("fight"); game.advance(10);
  for (let n = 0; n < 10000 && game.battle!.enemyPartyExecution.partyId === 1000; n++) {
    for (const actor of game.battle!.ready) {
      const target = game.battle!.targets(actor.id, 10)[0]; if (target) game.battle!.command(actor.id, 10, target.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle!.enemyPartyExecution.partyId, 513);
  const before = game.state.snapshot(), fixed = game.battle!.participantEntryContent;
  for (const player of game.battle!.players) { player.hp = 0; player.conditionIds = [305]; }
  game.advance(10); assert.equal(game.battle!.phase, "defeat");
  game.battle!.content.participants!.enemyParties![513]!.members.splice(0);
  assert.equal(game.retryBattle(), true); assert.deepEqual(game.battle!.participantEntryContent, fixed);
  assert.equal(game.battle!.enemyPartyExecution.partyId, 1000); assert.equal(game.battle!.participantExecution.nextGeneration, 1);
  assert.deepEqual(game.state.snapshot(), before); win(game); assert.equal(game.continueVictory(), true);
});
