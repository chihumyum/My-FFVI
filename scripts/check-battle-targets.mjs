import { sourceBattleInventory } from "./battle-probe-context.mjs";
// Source range inventory plus a real all-enemy action in controlled contexts.
// This does not grant a story command or substitute for the full source AI.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  battleTableIndex,
  compileOpeningBattle,
} from "../dist/src/compiler/battle.js";
import {
  compileDevelopmentAbility,
  compileAbilityProgram,
} from "../dist/src/compiler/ability.js";
import { compileTargetRule } from "../dist/src/compiler/battle-targets.js";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { hash } from "../dist/src/compiler/content.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { enemyBattleDefinition } from "../dist/src/core/battle-participants.js";
import { controlledBattleContent as encounterContent } from "./battle-probe-context.mjs";
import { calculateDevelopmentEffects } from "../dist/src/core/ability.js";
import { BattleConditions } from "../dist/src/core/battle-conditions.js";
import { battleTargetChoices } from "../dist/src/core/battle-targets.js";

// The HP override belongs to this controlled host's immutable templates.
// Keep every source identity and raw slot instead of dropping the binding.
function admittedTargetProbe(content) {
  const entry = content.participants;
  assert.ok(entry, "Missing source participants for controlled target host");
  return { ...content, participants: { ...entry,
    enemyDefinitions: Object.fromEntries(content.enemies.map(enemy =>
      [enemy.sourceId, enemyBattleDefinition(enemy)])),
    initial: content.enemies.map(enemy => {
      const binding = entry.initial.find(binding => binding.id === enemy.id);
      assert.ok(binding && binding.sourceId === enemy.sourceId,
        "Changed source identity or missing raw slot for controlled target host");
      return structuredClone(binding);
    }),
  } };
}

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const imported = await readSnapshot(root + "/build/import");
const exported = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/battle"), "battle.json"),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const reader = battleTableIndex(tables, exported.tableSources);
const source = await compileOpeningBattle(root);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.profile, "narshe-playability-v35");
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const base = encounterContent(catalog, 3);
const inventory = tables["ability.csv"].map((row) => {
  const ability = compileDevelopmentAbility(
    reader,
    Number(row.id),
    `能力 #${row.id}`,
  );
  return {
    abilityId: ability.id,
    range: ability.program.range,
    targeting: compileTargetRule(
      ability.program.range,
      ability.program.rules.system_id,
    ),
    admitted: ability.plan !== null,
    blockers: ability.blockers,
  };
});
const ability = compileDevelopmentAbility(reader, 345, "来源群体物理动作 #345");
assert.ok(ability.plan, ability.blockers.join(";"));
assert.equal(ability.program.range, 4);
assert.equal(ability.plan.effects[0].kind, "physical");
assert.deepEqual(ability.program.contentFlags, [1]);
const content = structuredClone(base);
content.abilities[ability.id] = ability;
content.initialAtb = { player: [100, 100], enemy: [0, 0] };
content.commands[900001] = {
  id: 900001,
  name: "受控机制检查",
  kind: "ability",
  abilityIds: [ability.id],
  referencedAbility: null,
  forbiddenConditionIds: [],
};
content.players[0].commands = [900001];
content.players[0].abilities = [ability.id];
// Extend target HP only to observe multiple results, not as a source balance edit.
for (const enemy of content.enemies) enemy.hp = 5000;
const sourceResults = [];
for (const count of [1, 2]) {
  const run = (parts) => {
    const battle = new BattleGame(admittedTargetProbe(content), 71, undefined, sourceBattleInventory(catalog));
    const actor = battle.players[0];
    for (const enemy of battle.enemies.slice(count)) enemy.hp = 0;
    const choice = battle.targetChoices(actor.id, ability.id);
    assert.equal(choice.length, 1);
    assert.equal(choice[0].selection.kind, "side");
    assert.equal(choice[0].targetIds.length, count);
    assert.equal(
      battle.command(actor.id, ability.id, battle.enemies[0].id),
      false,
    );
    assert.equal(
      battle.command(actor.id, ability.id, choice[0].selection),
      true,
    );
    for (const dt of parts) battle.advance(dt);
    assert.equal(battle.action.results.length, count);
    for (const result of battle.action.results) {
      const effect = result.effects[0];
      const target = battle.enemies.find((e) => e.id === result.target);
      assert.equal(effect.resource, "hp");
      assert.ok(effect.amount > 0);
      assert.equal(target.hp, 5000 - effect.amount);
    }
    return {
      combatants: battle.combatants,
      action: battle.action,
      events: battle.events,
    };
  };
  const result = run([500]);
  assert.deepEqual(result, run(Array(50).fill(10)));
  sourceResults.push({ count, result });
}
assert.equal(
  sourceResults[1].result.action.results[0].effects[0].amount,
  Math.max(
    1,
    Math.trunc(sourceResults[0].result.action.results[0].effects[0].amount / 2),
  ),
);
// Relation is actor-relative even when this ability belongs to an enemy.
const enemy = content.enemies[0];
const conditions = new BattleConditions(content.conditions);
assert.deepEqual(
  battleTargetChoices(
    ability.plan.targeting,
    enemy,
    [...content.players, ...content.enemies],
    "normal",
  )[0].targetIds,
  content.players.map((p) => p.id),
);
// Source physical parameters remain valid in either actor role.
const enemyEffects = content.players.map((target) =>
  calculateDevelopmentEffects(
    ability.plan,
    ability.power,
    { ...enemy, conditionTypes: conditions.types(enemy.conditionIds) },
    { ...target, conditionTypes: conditions.types(target.conditionIds) },
    (min) => min,
    content.players.length,
    { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false },
  ),
);
assert.ok(enemyEffects.every((effects) => effects[0].amount > 0));
const report = {
  lane: "source-target-rules-and-controlled-multi-target-action",
  sourceSetHash: source.parentSourceSetHash,
  sourceContentHash: source.contentHash,
  contentHash: catalog.contentHash,
  profile: catalog.common.profile,
  rangeInventory: inventory,
  controlledAbility: ability,
  controlledAbilitySources: compileAbilityProgram(reader, ability.id).sources,
  sourceResults,
  enemyEffects,
  doesNotEstablish: [
    "original-parity",
    "story-unlock",
    "enemy-AI",
    "position-groups",
    "revive-or-hidden-targets",
    "reflection-or-confusion",
    "complete-battle",
    "full-game-playability",
  ],
};
await mkdir(root + "/build/reports", { recursive: true });
await writeFile(
  root + "/build/reports/battle-target-check.json",
  JSON.stringify({ ...report, reportHash: hash(report) }, null, 2) + "\n",
);
// Browser harness may consume this exact checked setup without changing the game catalog.
await writeFile(
  root + "/build/reports/battle-target-probe.json",
  JSON.stringify(admittedTargetProbe(content)) + "\n",
);
console.log(
  JSON.stringify({
    reportHash: hash(report),
    sourceRanges: [...new Set(inventory.map((a) => a.range))],
    decoded: inventory.length,
    admittedDevelopmentPlans: inventory.filter((a) => a.admitted).length,
    controlledAbility: ability.id,
    controlledTargetCounts: sourceResults.map((r) => r.count),
  }),
);
