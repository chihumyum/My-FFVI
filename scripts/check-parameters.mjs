import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  compileOpeningBattle,
  battleTableIndex,
} from "../dist/src/compiler/battle.js";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import {
  compilePlayerParameters,
  compileEnemyParameters,
  compileParameterEquipment,
  compileParameterLimits,
} from "../dist/src/compiler/parameters.js";
import {
  confirmPlayerParameters,
  confirmEnemyParameters,
  playerEvasionPercent,
} from "../dist/src/core/parameters.js";
import { hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const source = await compileOpeningBattle(root); // validates the pinned source manifests and native build
const base = await readSnapshot(root + "/build/import");
const battle = JSON.parse(
  snapshotFile(
    await readSnapshot(root + "/build/battle"),
    "battle.json",
  ).toString(),
);
const tables = JSON.parse(snapshotFile(base, "tables.json").toString());
const index = battleTableIndex(tables, battle.tableSources);
const zero = {
  hp: 0,
  mp: 0,
  magic: 0,
  attack: 0,
  defense: 0,
  magicDefense: 0,
  agility: 0,
  weight: 0,
  evasion: 0,
  magicEvasion: 0,
};
const context = {
  additional: { hp: 0, mp: 0, magic: 0, agility: 0, weight: 0 },
  correction: { magic: 0, agility: 0 },
  temporary: zero,
  passive: { hp: 0, mp: 0, magicEvasion: 0 },
  condition601: false,
  twoHandMultiplier: 1,
};
const limits = compileParameterLimits(index);
const players = [],
  blocked = [];
for (const row of tables["character_status.csv"]) {
  const id = Number(row.id);
  let compiled;
  try {
    compiled = compilePlayerParameters(index, id, context, limits.values);
  } catch (e) {
    if (
      !/^Unresolved (character initial conditions:|(?:weapon|armor):\d+ wear_)/.test(
        e.message,
      )
    )
      throw e;
    blocked.push({ characterId: id, reason: e.message });
    continue;
  }
  assert.deepEqual(
    compiled.confirmed,
    confirmPlayerParameters(structuredClone(compiled.input), limits.values),
  );
  assert.deepEqual(
    compiled,
    compilePlayerParameters(index, id, context, limits.values),
  );
  players.push({
    characterId: id,
    ...compiled,
    percentage: playerEvasionPercent(compiled.input, limits.values),
  });
}
const enemies = tables["monster.csv"].map((row) => {
  const compiled = compileEnemyParameters(
    index,
    Number(row.id),
    zero,
    limits.values,
  );
  assert.deepEqual(
    compiled.confirmed,
    confirmEnemyParameters(compiled.base, zero, limits.values),
  );
  assert.equal(compiled.base.magic, Number(row.ability_attack));
  return {
    monsterId: Number(row.id),
    initialCondition: row.initial_condition,
    ...compiled,
  };
});
const equipment = [],
  excludedEquipment = [];
for (const row of tables["content.csv"].filter((r) =>
  ["2", "3"].includes(r.type_id),
)) {
  try {
    equipment.push({
      contentId: Number(row.id),
      ...compileParameterEquipment(index, [
        { slot: 1, contentId: Number(row.id) },
      ]),
    });
  } catch (e) {
    if (!/^Unresolved (?:weapon|armor):\d+ wear_/.test(e.message)) throw e;
    excludedEquipment.push({ contentId: Number(row.id), reason: e.message });
  }
}
// Independent native/source regressions: constructor series-6 branch uses AbilityAttack,
// and enemy resources are allowed above the player limit.
assert.equal(enemies.find((e) => e.monsterId === 1).confirmed.magic, 6);
const largeEnemy = enemies.find((e) => e.base.hp > limits.values.hp);
assert.ok(largeEnemy);
assert.equal(largeEnemy.confirmed.hp, largeEnemy.base.hp);
assert.ok(players.some((p) => ![1, 31, 32].includes(p.characterId)));
const report = {
  formatVersion: 1,
  kind: "source-parameter-confirmation-check",
  sourceSetHash: source.sourceSetHash,
  parentSourceSetHash: source.parentSourceSetHash,
  sourceContentHash: source.contentHash,
  limits,
  scope:
    "Numeric confirmation with explicit controlled zero growth/correction/status/passive inputs. Not story initialization, party eligibility, menu availability, equipment legality, status application or original-game parity.",
  context,
  players,
  blocked,
  enemies,
  equipment,
  excludedEquipment,
  regressions: {
    guardMagic: 6,
    uncappedEnemy: {
      monsterId: largeEnemy.monsterId,
      hp: largeEnemy.confirmed.hp,
    },
  },
  nativeParity: "unknown",
};
await mkdir(root + "/build/reports", { recursive: true });
await writeFile(
  root + "/build/reports/parameter-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    characters: players.length,
    blockedCharacters: blocked.length,
    enemies: enemies.length,
    equipment: equipment.length,
    blockedEquipment: excludedEquipment.length,
    regressions: report.regressions,
  }),
);
