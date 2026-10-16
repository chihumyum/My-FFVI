import test from "node:test";
import assert from "node:assert/strict";
import { sourceEncounterSessionFixture, encounterReady } from "./fixtures/source-encounter-session.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { CheckpointStorage } from "../src/core/saved-game.js";

function setup() {
  const f = sourceEncounterSessionFixture({ seed: 599 }), ability = structuredClone(f.battle.common.abilities[11]!);
  Object.assign(ability, { id: 601, name: "Authored session self counter", power: 1, cost: 3, wait: 0 });
  ability.program.abilityId = 601; ability.program.range = 5;
  ability.plan!.targeting = compileTargetRule(5, 2)!;
  ability.plan!.effects = [{ slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" }];
  ability.plan!.magic = null;
  f.battle.common.abilities[601] = ability;
  f.battle.common.battleAbilities!.abilities.push({ id: 601, typeId: ability.program.rules.type_id!, groupId: ability.program.groupId, range: 5 });
  f.battle.common.initialAtb = { player: [100, 100], enemy: [0, 0] };
  for (const encounter of Object.values(f.battle.encounters)) {
    const enemy = encounter.enemies[0]!;
    Object.assign(enemy, { hp: 300, mp: 10, agility: 0, weight: 21, abilities: [13, 601], ai: syntheticAI([
      ["Nop"], ["SyncAI"], ["StartTable", [0]], ["CounterAct", [601], [100]],
      ["Act", [13], [100]], ["EndTable"], ["JumpBattleAI", [0]],
    ]) });
  }
  // All content and qualification are authored before launch; the session's
  // source initializer, battle lease, resources and result are never patched.
  Object.assign(f.battle, sealBatchContent(f.battle));
  f.content.battleCatalogHash = f.battle.contentHash; Object.assign(f.content, sealBatchContent(f.content));
  return f;
}
const host = { prepareStart: async () => ({ kind: "start" }), prepareReturn: async () => ({ kind: "return" }), discard() {} };

test("actual source Session self reaction survives handoff failure/retry, once-only return, Storage and another encounter", async () => {
  const f = setup(), live = f.make(), { game, flow, commands } = live;
  assert.equal(game.field.startEvent("source-fight"), true);
  for (let i = 0; i < 100 && !game.field.stop; i++) flow.advance(10, encounterReady);
  assert.equal(game.field.stop?.kind, "encounter", game.field.stop?.message);
  const request = structuredClone(game.field.stop), owned = game.state.snapshot(); let failStart = true, failReturn = true;
  const handoff = new GameBattleHandoff(flow, { ...host,
    prepareStart: async () => { if (failStart) throw Error("Controlled preparation failure"); return { kind: "start" }; },
    prepareReturn: async () => { if (failReturn) throw Error("Controlled return failure"); return { kind: "return" }; },
  });
  assert.equal((await handoff.start()).status, "failed"); assert.equal(game.battle, null);
  assert.deepEqual(game.state.snapshot(), owned); assert.deepEqual(game.field.stop, request);
  let release!: (value: { kind: string }) => void;
  const media = new Promise<{ kind: string }>(yes => { release = yes; });
  const cancelled = new GameBattleHandoff(flow, { ...host, prepareStart: () => media });
  const pending = cancelled.start(); cancelled.cancel(); release({ kind: "start" });
  assert.equal((await pending).status, "cancelled"); assert.equal(game.battle, null);
  assert.deepEqual(game.state.snapshot(), owned); assert.deepEqual(game.field.stop, request);
  failStart = false; const started = await handoff.start(); assert.equal(started.status, "committed", JSON.stringify(started));
  const battle = game.battle!, actor = battle.ready[0]!, enemy = battle.enemies[0]!;
  assert.ok(actor); assert.equal(commands.command(battle, actor.id, 10, enemy.id, 100), true);
  flow.advance(410, encounterReady);
  const counter = battle.pendingActions.find(action => action.kind === "counter")!;
  assert.ok(counter); assert.equal(counter.actor, enemy.id); assert.deepEqual(counter.targetIds, [enemy.id]);
  const hp = enemy.hp, attackerHp = actor.hp; flow.advance(920, encounterReady);
  assert.equal(battle.action?.kind, "counter"); assert.equal(battle.action?.resolved, true);
  assert.equal(enemy.hp, hp + 1); assert.equal(enemy.mp, 7); assert.equal(actor.hp, attackerHp);
  let observed = 1;
  for (let i = 0; i < 10000 && battle.phase === "active"; i++) {
    for (const player of battle.ready) {
      const target = battle.enemies.find(unit => unit.hp > 0);
      if (target) commands.command(battle, player.id, 10, target.id, 100);
    }
    flow.advance(20, encounterReady);
    if (battle.action?.kind === "counter" && battle.action.resolved) observed++;
  }
  assert.equal(battle.phase, "victory"); assert.ok(observed >= 1);
  const finished = structuredClone({ units: battle.combatants, result: battle.previewVictory(), state: game.state.snapshot() });
  assert.equal((await handoff.return()).status, "failed"); assert.equal(game.battle, battle);
  assert.deepEqual({ units: battle.combatants, result: battle.previewVictory(), state: game.state.snapshot() }, finished);
  failReturn = false; assert.equal((await handoff.return()).status, "committed");
  for (let i = 0; i < 100 && !game.checkpointReady; i++) flow.advance(10, encounterReady);
  assert.equal(game.checkpointReady, true, game.field.stop?.message); assert.equal(game.state.completedEncounters.length, 1);
  assert.equal(game.field.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  await assert.rejects(() => handoff.return(), /requires/);
  const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", "self-counter-authored");
  await storage.save(game.checkpoint(), 1234); const saved = (await storage.load())!;
  const restored = f.restore(saved.checkpoint); assert.deepEqual(restored.checkpoint(), saved.checkpoint);
  const nextFlow = new GameFlow(restored); nextFlow.start(); nextFlow.advance(0, encounterReady);
  const nextCommands = new GameCommands(nextFlow, restored); assert.equal(restored.field.startEvent("source-next"), true);
  const nextHandoff = new GameBattleHandoff(nextFlow, host); assert.equal((await nextHandoff.start()).status, "committed");
  const next = restored.battle!;
  assert.notEqual(next, battle); assert.equal(next.enemyAIState(enemy.id)!.receivedAbility, null);
  for (let i = 0; i < 10000 && next.phase === "active"; i++) {
    for (const player of next.ready) {
      const target = next.enemies.find(unit => unit.hp > 0);
      if (target) nextCommands.command(next, player.id, 10, target.id, 100);
    }
    nextFlow.advance(20, encounterReady);
  }
  assert.equal(next.phase, "victory"); assert.equal((await nextHandoff.return()).status, "committed");
  nextFlow.advance(100, encounterReady); assert.equal(restored.checkpointReady, true);
  assert.equal(restored.state.completedEncounters.length, 2);
});
