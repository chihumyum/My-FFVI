// Source-list conflict checks, not active status effects or playable battles.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import {
  compileOpeningBattle,
  battleTableIndex,
} from "../dist/src/compiler/battle.js";
import { compileConditionCatalog } from "../dist/src/compiler/conditions.js";
import { ConditionRules } from "../dist/src/core/conditions.js";
import { hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const source = await compileOpeningBattle(root);
const imported = await readSnapshot(root + "/build/import");
const exported = JSON.parse(
  snapshotFile(
    await readSnapshot(root + "/build/battle"),
    "battle.json",
  ).toString(),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json").toString());
const ids = tables["condition.csv"].map((r) => Number(r.id));
const index = battleTableIndex(tables, exported.tableSources);
const compiled = compileConditionCatalog(index, ids);
assert.equal(compiled.catalog.definitions.length, ids.length);
const referencedRules = new Set(compiled.catalog.eraseRules.map((r) => r.id));
const unreferencedRules = tables["erase_condition_group.csv"]
  .filter((r) => !referencedRules.has(Number(r.id)))
  .map((r) => index.row("erase_condition_group.csv", r.id));
// Group 2 exists in the source but no condition in this build selects it.
assert.deepEqual(
  unreferencedRules.map((r) => Number(r.values.id)),
  [2],
);
const rules = new ConditionRules(compiled.catalog);
const checks = [];
// Expected lists were reviewed against native conflict branches, not generated
// by the implementation. They deliberately include asymmetric same-type cases.
for (const [before, incomingId, expected] of [
  [[9, 89], 89, [89]],
  [[89, 9], 9, [89]],
  [[10, 88], 88, [88]],
  [[88, 10], 10, [88, 10]],
  [[13], 13, [13]],
  [[13, 13], 13, []],
  [[21, 25], 25, [25]],
  [[25, 21], 21, [21]],
  [[6, 7], 7, [6, 7]],
  [[7, 6], 6, [7]],
  [[10, 13, 15, 21, 5], 5, [13, 15, 5]],
  [[9, 13, 15, 14, 21, 11], 11, [13, 15, 14, 11]],
  [[9, 9], 9, [9]],
  [[100, 13, 5], 5, [13, 5]],
  [[110], 110, [110]],
]) {
  const input = { currentIds: before, incomingId, equipmentIds: [] };
  const snapshot = structuredClone(input);
  const result = rules.resolveConflict(input);
  assert.deepEqual(result.currentIds, expected, JSON.stringify(input));
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result, rules.resolveConflict(input));
  checks.push({ input, expected, result });
}

// Structural coverage: all pair and repeated-incoming contexts, without timers,
// equipment, battle lifecycle or any assumption that they are reachable states.
const structural = [];
for (const incomingId of ids) {
  for (const existing of ids) {
    for (const currentIds of [
      [existing, incomingId],
      [existing, incomingId, incomingId],
    ]) {
      const result = rules.resolveConflict({
        currentIds,
        incomingId,
        equipmentIds: [],
      });
      const remaining = [...currentIds];
      for (const removed of result.removed) {
        const index = remaining.indexOf(removed.id);
        assert.ok(index >= 0);
        remaining.splice(index, 1);
      }
      assert.deepEqual(result.currentIds, remaining);
      structural.push({ currentIds, incomingId, result });
    }
  }
}
const report = {
  lane: "source-current-condition-list-conflicts",
  sourceSetHash: source.parentSourceSetHash,
  battleSourceContentHash: source.contentHash,
  compiled,
  unreferencedRules,
  checks,
  structuralCases: structural.length,
  structuralHash: hash(structural),
  doesNotEstablish: [
    "status-application",
    "status-timers",
    "damage-or-action-effects",
    "equipment-conditions",
    "battle-integration",
    "original-parity",
    "full-game-playability",
  ],
};
await mkdir(root + "/build/reports", { recursive: true });
await writeFile(
  root + "/build/reports/condition-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    conditions: ids.length,
    eraseRules: compiled.catalog.eraseRules.length,
    unreferencedRules: unreferencedRules.length,
    sourceCases: checks.length,
    structuralCases: structural.length,
  }),
);
