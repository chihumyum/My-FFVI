import assert from "node:assert/strict";
import { sourceEncounterSessionFixture, encounterReady } from "./source-encounter-session.js";
import { sealBatchContent } from "./content-batch.js";
import { compileOwnedConditionInstruction } from "../../src/compiler/owned-condition.js";
import { GameBattleHandoff } from "../../src/core/game-battle-handoff.js";
import type { Op, Site } from "../../src/field/types.js";
type Instruction<T = Op> = T extends Site ? Omit<T, keyof Site> : never;

/** Controlled declarations precede launch. Injury is produced by a legal
 * enemy action in BattleGame, never by patching a live HP/condition/held bank.
 * Raw RemoveCondition operands are the source family's exact type4/5 target0
 * shape; synthetic master IDs remain explicit and are not story coverage. */
export function removeLifeConditionSessionFixture() {
  const f = sourceEncounterSessionFixture(), common = f.battle.common;
  f.world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  common.initialAtb.player = [100, 100]; common.initialAtb.enemy = [100, 100];
  for (const encounter of Object.values(f.battle.encounters)) {
    const enemy = encounter.enemies[0]!;
    enemy.attack = 5000; enemy.physical = { ...enemy.physical!, attack: 5000, strength: 255, accuracy: 255, criticalRate: 0 };
  }
  const tables = { "condition.csv": common.conditions.rules.definitions.map(({ id, type }) =>
    ({ id: String(id), condition_type: String(type) })) };
  const remove = (type: 4 | 5): Instruction => compileOwnedConditionInstruction({
    type: 1, mnemonic: "RemoveCondition", operands: { iValues: [type, 0, 0, 0, 0, 0, 0, 0],
      rValues: Array(8).fill(0), sValues: Array(8).fill("") },
  }, tables);
  const programs: Record<string, Instruction[]> = {
    "life-remove": [remove(5), { kind: "event-save" }, remove(4), { kind: "exit" }],
    "life-barrier": [{ kind: "event-save" }, remove(5), { kind: "event-save" }, { kind: "exit" }],
    "life-noop": [remove(4), remove(5), { kind: "exit" }],
  };
  for (const [name, values] of Object.entries(programs)) {
    f.map.scripts[name] = values.map((op, index) => ({ ...op, script: name, index, source: f.source } as Op));
    f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "7".repeat(64) };
    (f.map.scriptLocals ??= {})[name] = null;
    (f.map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
    (f.map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
  }
  Object.assign(f.battle, sealBatchContent(f.battle)); Object.assign(f.map, sealBatchContent(f.map));
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash; Object.assign(f.world, sealBatchContent(f.world));
  Object.assign(f.content, { battleCatalogHash: f.battle.contentHash, worldCatalogHash: f.world.contentHash,
    mapContentHash: f.map.contentHash }); Object.assign(f.content, sealBatchContent(f.content));
  const enter = async () => {
    const live = f.make(); assert.equal(live.game.field.startEvent("source-fight"), true);
    for (let i = 0; i < 100 && !live.game.field.stop; i++) live.flow.advance(10, encounterReady);
    const handoff = new GameBattleHandoff(live.flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
    assert.equal((await handoff.start()).status, "committed");
    const battle = live.game.battle!, before = live.game.state.snapshot();
    for (let i = 0; i < 5000 && !battle.players.some(player => player.hp === 0); i++) live.flow.advance(10, encounterReady);
    assert.equal(battle.players.filter(player => player.hp === 0).length, 1, "legal enemy damage must kill exactly one borrowed player");
    const dead = battle.players.find(player => player.hp === 0)!;
    assert.ok(dead.conditionIds.includes(common.conditions.hpZeroConditionId));
    assert.deepEqual(live.game.state.snapshot(), before, "battle has not yet published owned resources");
    for (let i = 0; i < 5000 && battle.phase === "active"; i++) {
      for (const player of battle.ready) {
        const target = battle.enemies.find(enemy => enemy.hp > 0);
        if (target) live.commands.command(battle, player.id, 10, { kind: "single", id: target.id }, 100);
      }
      live.flow.advance(10, encounterReady);
    }
    assert.equal(battle.phase, "victory"); assert.equal((await handoff.return()).status, "committed");
    for (let i = 0; i < 100 && !live.game.checkpointReady; i++) live.flow.advance(10, encounterReady);
    assert.equal(live.game.checkpointReady, true, live.game.field.stop?.message);
    assert.equal(live.game.state.snapshot().roster.find(row => row.id === dead.id)!.hp, 0);
    assert.equal(live.game.state.completedEncounters.length, 1);
    return { ...live, handoff, battle, deadId: dead.id };
  };
  return { ...f, enter, remove };
}
