import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameState } from "../src/core/game-state.js";
import { GameSession } from "../src/core/game-session.js";
import { encounterContent } from "../src/core/battle-content.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { sourceQualifiedBattleFixture } from "./fixtures/battle-abilities.js";

function fixture(points = 5) {
  const f = characterLearningSessionFixture();
  f.battle.encounters[1000]!.rewardPolicy = { kind: "battle-reward-policy-v1", ap: 0, magicPoints: points };
  return f;
}
function win(battle: BattleGame, id: string) {
  for (let i = 0; i < 50; i++) battle.advance(10);
  assert.equal(battle.command(id, 10, "e1", 100), true);
  for (let i = 0; i < 200 && battle.phase === "active"; i++) battle.advance(10);
  assert.equal(battle.phase, "victory");
  return battle.previewVictory()!;
}

test("positive magic points require a progression owner and an actual counter before entry", () => {
  const f = fixture(), content = encounterContent(f.battle, 1000)!;
  const state = GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  const lease = state.openBattle(1000, content.rewardPolicy);
  state.battleRewardPolicy(lease).magicPoints = 999;
  assert.equal(state.battleRewardPolicy(lease).magicPoints, 5);
  const players = state.battlePlayers(lease), inventory = state.battleInventory(lease);
  assert.throws(() => new BattleGame(content, 17, players, inventory), /owned progression provider/);
  delete players[0]!.magicLearningValue;
  assert.throws(() => new BattleGame(content, 17, players, inventory,
    state.battleProgression(lease, content.experience)), /owned magic learning value/);
  assert.equal(state.snapshot().roster[0]!.magicLearningValue, 0);
  state.cancelBattle(lease);
  assert.throws(() => state.battleRewardPolicy(lease), /Stale battle lease/);
});

test("source policy is copied at encounter decode and frozen for the live battle and owned lease", () => {
  const f = fixture(), detached = encounterContent(f.battle, 1000)!;
  detached.rewardPolicy!.magicPoints = 99;
  assert.equal(f.battle.encounters[1000]!.rewardPolicy!.magicPoints, 5);
  const session = f.make(), before = session.state.snapshot();
  session.field.startEvent("learning"); session.advance(10);
  const battle = session.battle!;
  battle.content.rewardPolicy!.magicPoints = 17;
  f.battle.encounters[1000]!.rewardPolicy!.magicPoints = 33;
  const result = win(battle, f.id);
  assert.equal(result.magicPoints, 5);
  assert.equal(result.players[0]!.magicLearningValue, 5);
  assert.equal(battle.reward!.magicPoints, 5);
  assert.deepEqual(session.state.snapshot(), before);
  assert.equal(session.continueVictory(), true);
  assert.equal(session.state.snapshot().roster[0]!.magicLearningValue, 5);
  assert.equal(session.continueVictory(), false);
});

test("failed field return leaves magic points unclaimed and retry publishes them once across checkpoint restore", () => {
  const f = fixture(), continuation = f.map.scripts["after-learning"]!;
  delete f.map.scripts["after-learning"];
  const session = f.make(), before = session.state.snapshot();
  session.field.startEvent("learning"); session.advance(10);
  win(session.battle!, f.id);
  for (let i = 0; i < 2; i++) {
    assert.throws(() => session.continueVictory(), /Missing battle continuation/);
    assert.deepEqual(session.state.snapshot(), before);
    assert.equal(session.battle!.reward!.magicPoints, 5);
  }
  f.map.scripts["after-learning"] = continuation;
  assert.equal(session.continueVictory(), true); session.advance(10);
  assert.equal(session.characterMenu(f.id).magicLearningValue, 5);
  const snapshot = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = GameSession.restore(snapshot, session.field.content, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  assert.equal(restored.characterMenu(f.id).magicLearningValue, 5);
  restored.field.startEvent("learning"); restored.advance(10);
  assert.equal(restored.battle!.players[0]!.magicLearningValue, 5);
  win(restored.battle!, f.id); restored.continueVictory(); restored.advance(10);
  assert.equal(restored.characterMenu(f.id).magicLearningValue, 10);
  assert.equal(restored.state.snapshot().completedBattles.length, 2);
});

test("defeat retry and retreat keep the leased magic learning value without awarding victory points", () => {
  const f = fixture(), session = f.make();
  session.field.startEvent("learning"); session.advance(10);
  const original = session.state.snapshot();
  session.battle!.content.rewardPolicy!.magicPoints = 17;
  for (const player of session.battle!.players) {
    player.hp = 0; player.conditionIds = [session.battle!.content.conditions.hpZeroConditionId];
  }
  session.battle!.advance(10); assert.equal(session.battle!.phase, "defeat");
  assert.equal(session.retryBattle(), true);
  assert.deepEqual(session.state.snapshot(), original);
  assert.equal(session.battle!.players[0]!.magicLearningValue, 0);
  const retried = win(session.battle!, f.id);
  assert.equal(retried.magicPoints, 5, "retry preserves the original leased reward policy");
  assert.equal(session.continueVictory(), true);
  assert.equal(session.state.snapshot().roster[0]!.magicLearningValue, 5);
  const owned = GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  const content = encounterContent(f.battle, 1000)!;
  content.escapePolicy = { kind: "framework-battle-escape-v1", id: "controlled-retreat" };
  const lease = owned.openBattle(1000, content.rewardPolicy);
  const battle = new BattleGame(content, 17, owned.battlePlayers(lease), owned.battleInventory(lease),
    owned.battleProgression(lease, content.experience));
  assert.equal(battle.requestEscape(), true); battle.advance(10);
  assert.equal(battle.phase, "escaped"); assert.equal(battle.reward, null);
  owned.prepareEscape(lease, battle.previewEscape()!)();
  assert.equal(owned.snapshot().roster[0]!.magicLearningValue, 0);
  assert.equal(owned.snapshot().completedBattles[0]!.outcome, "escaped");
});

test("source encounters cannot bypass reward decoding or move per-encounter policy into common content", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { delete f.battle.encounters[1000]!.rewardPolicy; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.battle.common, { rewardPolicy: f.battle.encounters[1000]!.rewardPolicy }); },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.battle.encounters[1000]!.rewardPolicy!, { ap: 1 }); },
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => encounterContent(f.battle, 1000));
    assert.ok(analyzeBatchEncounters(f.battle, [1000]).diagnostics.some(d => d.code === "encounter-rewards"));
  }
  const synthetic = checkpointFixture().battle;
  synthetic.encounters[1000]!.rewardPolicy = { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 1 };
  assert.ok(analyzeBatchEncounters(synthetic, [1000]).diagnostics.some(d => d.code === "encounter-rewards"));
});

test("source result-changing flags remain blocked even under exact development omission grants", () => {
  for (const flagId of [3, 9, 10, 11, 12, 13]) {
    const f = encounterRuntimeFixture(), encounter = f.input.encounters[0]!;
    encounter.metadata.getValue = 5;
    encounter.metadata.battleFlagGroupId = 4;
    encounter.metadata.battleFlags = [{ values: { id: "1", battle_flag_id: String(flagId) },
      source: f.rowSource("battle_flag_group.csv", 1) }];
    f.input.development.flagGroups = [{ id: 4, rows: structuredClone(encounter.metadata.battleFlags), reason: "Controlled omission" }];
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.encounters[9201], undefined);
    assert.ok(result.diagnostics.some(d => d.partyId === 9201 && d.code === "party-rewards" && d.kind === "blocked"));
  }
});

test("command qualification reads each actor's owned counter instead of shared catalog context", () => {
  const content = sourceQualifiedBattleFixture();
  content.qualificationContext!.magicLearningValue = 128;
  for (const [index, player] of content.players.entries()) {
    player.ownedAbilities!.abilities.commandIds.push(8);
    player.magicLearningValue = index === 0 ? 7 : 8;
  }
  const battle = new BattleGame(content, 17);
  assert.equal(battle.commandQualification("a")!.entries.find(c => c.commandId === 8)!.available, false);
  assert.equal(battle.commandQualification("b")!.entries.find(c => c.commandId === 8)!.available, true);
  assert.equal(content.qualificationContext!.magicLearningValue, 128);
});

test("a wrong progression counter rolls back the terminal frame and can be retried without partial awards", () => {
  const f = fixture(), content = encounterContent(f.battle, 1000)!;
  const state = GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions), before = state.snapshot();
  const lease = state.openBattle(1000, content.rewardPolicy), project = state.battleProgression(lease, content.experience)!;
  let broken = true;
  const battle = new BattleGame(content, 17, state.battlePlayers(lease), state.battleInventory(lease),
    (player, exp, observed, points) => {
      const projected = project(player, exp, observed, points);
      return broken ? { ...projected, magicLearningValue: projected.magicLearningValue + 1 } : projected;
    });
  for (let i = 0; i < 50; i++) battle.advance(10);
  assert.equal(battle.command(f.id, 10, "e1", 100), true);
  const visible = () => structuredClone({ units: battle.combatants, time: battle.time,
    phase: battle.phase, reward: battle.reward, events: battle.events, action: battle.action,
    pending: battle.pendingActions });
  let failed = false;
  for (let i = 0; i < 200; i++) {
    const frame = visible();
    try { battle.advance(10); }
    catch (error) {
      assert.match(String(error), /progression magic learning value mismatch/);
      assert.deepEqual(visible(), frame);
      assert.deepEqual(state.snapshot(), before);
      failed = true; break;
    }
  }
  assert.equal(failed, true);
  broken = false; battle.advance(10);
  assert.equal(battle.phase, "victory");
  state.prepareVictory(lease, battle.previewVictory()!)();
  assert.equal(state.snapshot().roster[0]!.magicLearningValue, 5);
  assert.equal(state.snapshot().completedBattles.length, 1);
});
