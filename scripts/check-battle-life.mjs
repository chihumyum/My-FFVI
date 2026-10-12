import { sourceBattleInventory } from "./battle-probe-context.mjs";
// Supplied-build death/revival probes; controlled party context, no story unlock.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import {
  battleTableIndex,
  compileOpeningBattle,
} from "../dist/src/compiler/battle.js";
import {
  compileDevelopmentAbility,
  compileAbilityProgram,
} from "../dist/src/compiler/ability.js";
import { compileBattleConditionCatalog } from "../dist/src/compiler/conditions.js";
import { controlledBattleContent as encounterContent } from "./battle-probe-context.mjs";
import { BattleGame } from "../dist/src/core/battle.js";
import { revivalEffects } from "../dist/src/core/battle-revival.js";
import { hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const tables = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/import"), "tables.json"),
);
const sourceExport = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/battle"), "battle.json"),
);
const reader = battleTableIndex(tables, sourceExport.tableSources);
const source = await compileOpeningBattle(root);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.profile, "narshe-playability-v31");
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const conditions = compileBattleConditionCatalog(
  reader,
  tables["condition.csv"].map((r) => Number(r.id)),
  (k) => k,
);
assert.equal(conditions.catalog.hpZeroConditionId, 5);
assert.deepEqual(conditions.catalog.dying, {
  conditionId: 4,
  thresholdDivisor: 8,
});
assert.deepEqual(
  conditions.catalog.behaviors
    .filter((b) => b.kind === "unable-fight")
    .map((b) => b.id),
  [5, 100],
);
const rows = tables["ability.csv"]
  .map((row) => {
    const compiled = compileDevelopmentAbility(
      reader,
      Number(row.id),
      "Controlled",
    );
    if (!compiled.program.functions.some((f) => f.type === 34)) return null;
    return {
      id: compiled.id,
      plan: compiled.plan,
      blockers: compiled.blockers,
      sources: compileAbilityProgram(reader, compiled.id).sources,
    };
  })
  .filter(Boolean);
assert.deepEqual(
  rows.filter((r) => r.plan && revivalEffects(r.plan)).map((r) => r.id),
  [34, 35],
);
assert.ok(
  rows
    .find((r) => r.id === 290)
    .blockers.includes("unresolved native condition ability override"),
);
const base = encounterContent(catalog, 3);
function fixture(id, deathId = 5, hp = 80) {
  const content = structuredClone(base);
  const ability = compileDevelopmentAbility(
    reader,
    id,
    id === 34 ? "复活" : "完全复活",
  );
  assert.ok(ability.plan);
  content.abilities[id] = ability;
  content.commands[9000] = {
    id: 9000,
    name: "机制检查",
    kind: "ability",
    abilityIds: [id],
    referencedAbility: null,
    forbiddenConditionIds: [],
  };
  content.initialAtb = { player: [100, 100], enemy: [0, 0] };
  for (const p of content.players) {
    p.abilities = [id];
    p.commands = [9000];
    p.mp = 200;
  }
  content.players[1].hp = hp;
  content.players[1].conditionIds = [deathId];
  content.enemies.forEach((e) => {
    e.hp = 5000;
    e.agility = 0;
  });
  return content;
}
const checks = [];
for (const id of [34, 35])
  for (const deathId of [5, 100])
    for (const hp of [1, 7, 80, 9999]) {
      const content = fixture(id, deathId, hp);
      function run(partitions) {
        const battle = new BattleGame(content, 113, undefined, sourceBattleInventory(catalog));
        const actor = battle.players[0],
          target = battle.players[1];
        assert.equal(target.hp, 0);
        assert.equal(target.atb, 0);
        assert.ok(battle.command(actor.id, id, target.id));
        for (const step of partitions) battle.advance(step);
        const expected = id === 34 ? Math.max(1, Math.trunc(hp / 8)) : hp;
        assert.equal(target.hp, expected);
        assert.deepEqual(target.conditionIds, id === 34 && hp >= 8 ? [4] : []);
        assert.equal(actor.mp, 200 - content.abilities[id].cost);
        return {
          units: battle.combatants,
          events: battle.events,
          phase: battle.phase,
        };
      }
      const result = run([4000]);
      assert.deepEqual(result, run(Array(400).fill(10)));
      checks.push({
        id,
        deathId,
        maxHp: hp,
        recoveredHp: result.units[1].hp,
        conditionIds: result.units[1].conditionIds,
        replay: true,
      });
    }
// Two source Raise actions: later resolution misses without healing the survivor.
const pair = new BattleGame(fixture(34), 117, undefined, sourceBattleInventory(catalog));
pair.command(pair.players[0].id, 34, pair.players[1].id);
pair.command(pair.players[2].id, 34, pair.players[1].id);
pair.advance(6000);
assert.equal(pair.players[1].hp, 10);
assert.equal(pair.players[0].mp, 170);
assert.equal(pair.players[2].mp, 170);
assert.ok(pair.events.some((e) => e.text.includes("状态未改变")));
// Persist the actual controlled source fixture for menu/browser acceptance.
const probe = fixture(34);
await writeFile(
  root + "/build/reports/revival-probe.json",
  JSON.stringify(probe, null, 2) + "\n",
);
const report = {
  lane: "source-compiled-controlled-life-actions",
  sourceSetHash: source.parentSourceSetHash,
  battleSourceSetHash: source.sourceSetHash,
  fieldSourceSetHash: catalog.common.fieldSourceSetHash,
  sourceContentHash: source.contentHash,
  catalogHash: catalog.contentHash,
  conditionSources: conditions.sources.filter(
    (s) =>
      (["4", "5", "100"].includes(s.source.rowId) &&
        s.source.assetPath.endsWith("condition.csv")) ||
      s.values.key_name === "RATE_HAVE_NEAR_DEATH",
  ),
  rows,
  checks,
  laterRevivalMiss: true,
  limitations: [
    "no-original-parity",
    "no-enemy-revival-ai-reward-lifecycle",
    "no-undead",
    "no-equipment-conditions",
    "no-item-or-summon-use",
    "development-scheduling",
  ],
};
report.contentHash = hash(report);
await writeFile(
  root + "/build/reports/battle-life-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    checks: checks.length,
    admitted: rows.filter((r) => r.plan).map((r) => r.id),
    contentHash: report.contentHash,
  }),
);
