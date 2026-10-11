// Real source projections and controlled actions; no unlock, AI or parity claim.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import {
  battleTableIndex,
  compileOpeningBattle,
} from "../dist/src/compiler/battle.js";
import {
  compileElementResistances,
  compileEquipmentElements,
  compileAttackElements,
} from "../dist/src/compiler/elements.js";
import { compileDevelopmentAbility } from "../dist/src/compiler/ability.js";
import { calculateDevelopmentEffects } from "../dist/src/core/ability.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { encounterContent } from "../dist/src/core/battle-content.js";
import { hash } from "../dist/src/compiler/content.js";

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
assert.equal(catalog.common.profile, "narshe-playability-v17");
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const resistances = ["monster.csv", "armor.csv"].flatMap((table) =>
  tables[table].map((row) => {
    const record = {
      table,
      id: Number(row.id),
      source: reader.row(table, row.id).source,
      groupId: Number(row.resistance_attribute),
    };
    try {
      return {
        ...record,
        ...compileElementResistances(reader, record.groupId),
      };
    } catch (error) {
      if (!error.message.startsWith("Unreviewed conflicting element rows"))
        throw error;
      return {
        ...record,
        blocked: error.message,
        sources: reader.group(
          "attribute_group.csv",
          "group_id",
          record.groupId,
        ),
      };
    }
  }),
);
const weapons = tables["weapon.csv"].map((row) => ({
  id: Number(row.id),
  source: reader.row("weapon.csv", row.id).source,
  ...compileAttackElements(
    reader,
    Number(row.attribute_id),
    Number(row.attribute_group_id),
  ),
}));
const abilities = tables["ability.csv"].map((row) => {
  const a = compileDevelopmentAbility(reader, Number(row.id), "Controlled");
  return {
    id: a.id,
    elements: a.program.elements,
    admitted: !!a.plan,
    blockers: a.blockers,
  };
});
const equipment = [];
for (const row of tables["character_status.csv"]) {
  const ids = Array.from({ length: 6 }, (_, i) =>
    Number(row[`content_id${i + 1}`]),
  );
  if (!ids.every((id) => id > 0)) {
    equipment.push({
      id: Number(row.id),
      blocked: "non-concrete initial equipment",
    });
    continue;
  }
  equipment.push({
    id: Number(row.id),
    ...compileEquipmentElements(reader, ids, 1),
  });
}
const base = encounterContent(catalog, 3);
const fire = base.abilities[218];
assert.deepEqual(fire.plan.magic.elements, [1]);
// Each sample holds stats/RNG fixed so only elemental context changes.
const scalar = (values, targetCount = 1) =>
  calculateDevelopmentEffects(
    fire.plan,
    fire.power,
    base.players[0],
    { ...base.enemies[0], elementResistances: values },
    () => 0,
    targetCount,
  )[0];
const normal = scalar({});
assert.equal(scalar({ 1: 1 }).amount, normal.amount * 2);
assert.equal(scalar({ 1: 2 }).amount, Math.trunc(normal.amount / 2));
assert.equal(scalar({ 1: 3 }).nullified, true);
assert.equal(scalar({ 1: 4 }).recovery, true);
assert.equal(scalar({ 1: 4 }).amount, normal.amount);
assert.equal(scalar({ 1: 4 }, 2).amount, Math.trunc(normal.amount / 2));
const scalarCases = [1, 2, 3, 4].map((type) => ({
  type,
  single: scalar({ 1: type }),
  group: scalar({ 1: type }, 2),
}));

// Original fire-weak Lobo projection is now present in the actual catalog.
const wolves = Object.values(catalog.encounters)
  .flatMap((e) => e.enemies)
  .filter((e) => e.sourceId === 26);
assert.ok(wolves.length);
assert.ok(wolves.every((e) => e.elementResistances[1] === 1));
const content = structuredClone(base);
content.initialAtb = { player: [100, 100], enemy: [0, 0] };
for (const enemy of content.enemies) enemy.hp = 5000;
// These are controlled target contexts, not a change to source Guard resistances.
content.enemies[0].elementResistances = { 1: 3 };
content.enemies[1].elementResistances = { 1: 4 };
const run = (target, parts) => {
  const battle = new BattleGame(content, 71);
  battle.enemies[1].hp = 2000;
  assert.equal(battle.command(battle.players[0].id, 218, target, 26), true);
  for (const part of parts) battle.advance(part);
  const result = battle.action?.results[0]?.effects[0];
  assert.ok(result);
  if (target === content.enemies[0].id) {
    assert.equal(result.nullified, true);
    assert.equal(battle.enemies[0].hp, 5000);
  } else {
    assert.equal(result.recovery, true);
    assert.equal(battle.enemies[1].hp, Math.min(5000, 2000 + result.amount));
  }
  return {
    combatants: battle.combatants,
    action: battle.action,
    events: battle.events,
  };
};
const actions = content.enemies
  .map((e) => e.id)
  .map((target) => {
    const result = run(target, [2400]);
    assert.deepEqual(result, run(target, Array(240).fill(10)));
    return { target, result };
  });
const report = {
  lane: "source-element-projections-and-controlled-actions",
  profile: catalog.common.profile,
  sourceSetHash: source.parentSourceSetHash,
  battleContentHash: source.contentHash,
  catalogContentHash: catalog.contentHash,
  resistances,
  weapons,
  equipment,
  abilities,
  scalarCases,
  actions,
  doesNotEstablish: [
    "original-parity",
    "story-unlocks",
    "equipment-eligibility-or-procs",
    "dynamic-affinity-changes",
    "full-game-playability",
  ],
};
await writeFile(
  root + "/build/reports/element-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
await writeFile(
  root + "/build/reports/element-probe.json",
  JSON.stringify(content, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    resistanceRecords: resistances.length,
    blockedResistanceRecords: resistances.filter((r) => r.blocked).length,
    weaponRecords: weapons.length,
    equipment: equipment.filter((e) => !e.blocked).length,
    admittedAbilities: abilities.filter((a) => a.admitted).length,
    blockedAbilities: abilities.filter((a) => !a.admitted).length,
    actions: actions.length,
    scalarCases: scalarCases.length,
  }),
);
