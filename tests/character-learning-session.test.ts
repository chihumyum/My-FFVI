import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { encounterContent } from "../src/core/battle-content.js";
import { projectCharacterMenu } from "../src/core/character-menu.js";
import { equipmentOwnedAbilities } from "../src/core/equipment.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";

const createState = (f: ReturnType<typeof characterLearningSessionFixture>) =>
  GameState.createNewGame(f.battle.gameState, f.battle.common.players, f.battle.contentHash, f.battle.common.conditions);
function battle(f: ReturnType<typeof characterLearningSessionFixture>, state: GameState) {
  const content = encounterContent(f.battle, 1000)!;
  const lease = state.openBattle(content.encounterId);
  return { lease, game: new BattleGame(content, 17, state.battlePlayers(lease), state.battleInventory(lease),
    state.battleProgression(lease, content.experience)) };
}
function win(game: BattleGame, id: string) {
  for (let i = 0; i < 50; i++) game.advance(10);
  assert.equal(game.command(id, 10, "e1", 100), true);
  for (let i = 0; i < 200 && game.phase === "active"; i++) game.advance(10);
  assert.equal(game.phase, "victory");
  return game.previewVictory()!;
}
function menu(f: ReturnType<typeof characterLearningSessionFixture>, state: GameState) {
  const member = state.snapshot().roster.find((m) => m.id === f.id)!;
  return projectCharacterMenu(member, { growth: f.battle.gameState.characterGrowth![f.id]!,
    developmentExperience: f.battle.common.experience, abilities: f.battle.common.abilities,
    commands: f.battle.common.commands,
    equipmentAbilities: equipmentOwnedAbilities(f.battle.gameState.equipmentSystem!.catalog, member) });
}

test("fresh native session settles learning, returns to the same actor owner and saves its next-battle qualification", () => {
  const f = characterLearningSessionFixture(), session = f.make();
  const before = session.state.snapshot();
  const actor = session.field.player;
  assert.equal(session.characterMenu(f.id).abilities!.find((a) => a.id === 142)!.skillLevel, 0);
  session.field.startEvent("learning"); session.advance(10);
  assert.ok(session.battle);
  const result = win(session.battle, f.id);
  assert.deepEqual(result.observedAbilityIds, [142]);
  assert.equal(session.continueVictory(), true);
  session.advance(10);
  assert.equal(session.battle, null);
  assert.equal(session.field.stop, null);
  assert.equal(session.field.player, actor, "battle return preserves the native actor owner");
  assert.equal(session.characterMenu(f.id).abilities!.find((a) => a.id === 142)!.skillLevel, 100);
  assert.deepEqual(session.state.snapshot().nativeState!.ownedMagic, [742]);
  assert.deepEqual(session.state.snapshot().learnedAbilityIds, before.learnedAbilityIds);
  assert.equal(session.checkpointReady, true);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = GameSession.restore(saved, session.field.content, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  assert.deepEqual(restored.state.snapshot(), session.state.snapshot());
  assert.equal(restored.characterMenu(f.id).abilities!.find((a) => a.id === 142)!.skillLevel, 100);
  restored.field.startEvent("learning"); restored.advance(10);
  assert.deepEqual(restored.battle!.commandMenu(f.id).find((c) => c.id === 17)!.abilityIds, [142]);
  assert.equal(restored.battle!.canUse(f.id, 142, 17), true);
});

test("a missing battle continuation cannot publish learning or rewards in a fresh native session", () => {
  const f = characterLearningSessionFixture(); delete f.map.scripts["after-learning"];
  const session = f.make(), before = session.state.snapshot();
  session.field.startEvent("learning"); session.advance(10);
  assert.ok(session.battle); win(session.battle, f.id);
  const event = session.field.stop, actor = structuredClone(session.field.player);
  assert.throws(() => session.continueVictory(), /Missing battle continuation/);
  assert.deepEqual(session.state.snapshot(), before);
  assert.equal(session.field.stop, event);
  assert.deepEqual(structuredClone(session.field.player), actor);
  assert.equal(session.battle.phase, "victory");
  assert.equal(session.checkpointReady, false);
});

test("one source state settles learning, projects the menu, restores and admits the skill next battle", () => {
  const f = characterLearningSessionFixture(), state = createState(f), before = state.snapshot();
  const first = battle(f, state);
  assert.deepEqual(first.game.commandMenu(f.id).find((c) => c.id === 17)!.abilityIds, []);
  assert.equal(first.game.canUse(f.id, 142, 17), false);
  const result = win(first.game, f.id), publish = state.prepareVictory(first.lease, result);
  assert.deepEqual(state.snapshot(), before, "preview and prepare publish nothing");
  publish();
  const saved = JSON.parse(JSON.stringify(state.snapshot())) as ReturnType<GameState["snapshot"]>;
  assert.equal(saved.formatVersion, 10);
  assert.deepEqual(saved.nativeState!.ownedMagic, [742]);
  assert.deepEqual(saved.learnedAbilityIds, before.learnedAbilityIds, "initial history is a separate source list");
  assert.equal(menu(f, state).abilities!.find((a) => a.id === 142)!.skillLevel, 100);
  assert.equal(menu(f, state).abilities!.find((a) => a.id === 142)!.effectSupport, "implemented");
  assert.throws(publish, /Stale|lease|completed/);
  const restored = createState(f); restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  const next = battle(f, restored);
  assert.deepEqual(next.game.commandMenu(f.id).find((c) => c.id === 17)!.abilityIds, [142]);
  assert.equal(next.game.canUse(f.id, 142, 17), true);
  const nextResult = win(next.game, f.id);
  assert.deepEqual(nextResult.observedAbilityIds, [], "already learned source8 observation is not logged again");
  restored.prepareVictory(next.lease, nextResult)();
  assert.deepEqual(restored.snapshot().nativeState!.ownedMagic, [742]);
  assert.equal(restored.snapshot().roster[0]!.growth!.observedLearning.length, 1);
});

test("learning save replay rejects forged global magic, receipts, skill and initial history atomically", () => {
  const f = characterLearningSessionFixture(), state = createState(f), run = battle(f, state);
  state.prepareVictory(run.lease, win(run.game, f.id))();
  const saved = state.snapshot();
  const changes: ((s: typeof saved) => void)[] = [
    (s) => { s.nativeState!.ownedMagic = []; },
    (s) => { s.nativeState!.ownedMagic.push(761); },
    (s) => { s.roster[0]!.growth!.observedLearning[0]!.battleSerial = 1; },
    (s) => { s.roster[0]!.growth!.observedLearning[0]!.observedAbilityIds = [999]; },
    (s) => { s.roster[0]!.growth!.observedLearning = []; },
    (s) => { s.roster[0]!.abilities!.owned.find((a) => a.abilityId === 142)!.skillLevel = 0; },
    (s) => { s.learnedAbilityIds.push(142); },
    (s) => { s.formatVersion = 9 as 10; },
  ];
  for (const change of changes) {
    const bad = structuredClone(saved); change(bad);
    assert.throws(() => state.restore(bad));
    assert.deepEqual(state.snapshot(), saved);
  }
});

test("source observer state is captured at action start and failed resolution preserves the battle transaction", () => {
  const f = characterLearningSessionFixture(), state = createState(f), run = battle(f, state);
  run.game.advance(10);
  assert.deepEqual(run.game.action!.learningAbilityIds, [142]);
  // Inject a failed effect provider at the resolution boundary, after action
  // start captured observation. One failed tick must not publish its learning.
  while (run.game.action!.elapsed < 390) run.game.advance(10);
  const action = structuredClone(run.game.action), player = structuredClone(run.game.players[0]);
  const magic = run.game.content.abilities[142]!.plan!.magic!;
  const flags = [...magic.contentFlags]; magic.contentFlags.push(99999);
  assert.throws(() => run.game.advance(10), /Unsupported|Unknown|content flag/);
  assert.deepEqual(run.game.action, action);
  assert.deepEqual(run.game.players[0], player);
  magic.contentFlags = flags;
  const result = win(run.game, f.id);
  assert.deepEqual(result.observedAbilityIds, [142]);
  assert.deepEqual(state.snapshot().nativeState!.ownedMagic, []);
});
