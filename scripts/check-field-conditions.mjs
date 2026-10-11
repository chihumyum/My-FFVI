// Real source tables plus controlled state. This does not inject poison or
// extra items into a published opening and does not count as playable coverage.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory> to select an isolated TypeScript build",
);
const compiledRoot = resolve(root, args[1] ?? "dist");
const module = (path) =>
  import(pathToFileURL(resolve(compiledRoot, "src", path)).href);
const { readSnapshot, snapshotFile } = await module("compiler/integrity.js");
const { battleTableIndex } = await module("compiler/battle.js");
const { compileBattleConditionCatalog } = await module(
  "compiler/conditions.js",
);
const { compileFieldConditionCatalog } = await module(
  "compiler/field-conditions.js",
);
const { compileDevelopmentAbility } = await module("compiler/ability.js");
const { compileItem } = await module("compiler/items.js");
const { FieldConditions } = await module("core/field-conditions.js");
const { BattleConditions } = await module("core/battle-conditions.js");
const { hash } = await module("compiler/content.js");
const reportPath = root + "build/reports/field-conditions-check.json";
await rm(reportPath, { force: true });
execFileSync(
  process.execPath,
  [root + "scripts/check-field-conditions-native.mjs"],
  { cwd: root, stdio: "pipe" },
);
const nativeBytes = await readFile(
  root + "build/reports/field-conditions-native-check.json",
);
const native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const imported = await readSnapshot(root + "build/import");
const manifest = JSON.parse(snapshotFile(imported, "project.json"));
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const battleExport = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"),
);
assert.equal(battleExport.parentSourceSetHash, manifest.sourceSetHash);
assert.equal(
  manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const index = battleTableIndex(tables, battleExport.tableSources);
const battle = compileBattleConditionCatalog(
  index,
  tables["condition.csv"].map((r) => Number(r.id)),
  (key) => key,
);
const field = compileFieldConditionCatalog(
  index,
  battle.catalog,
  tables["transportation.csv"].map((r) => Number(r.id)),
);
const conditions = new FieldConditions(field.catalog);
const battleConditions = new BattleConditions(battle.catalog);
assert.deepEqual(
  field.catalog.behaviors.map((b) => b.id),
  [4, 5, 6, 10, 53, 100],
);
assert.deepEqual(
  field.catalog.behaviors.find((b) => b.id === 10),
  { id: 10, kind: "poison", hpDivisor: 32, soundId: 5 },
);
assert.deepEqual(field.catalog.transportations, [
  { id: 1, type: 1 },
  { id: 2, type: 2 },
  { id: 3, type: 9 },
  { id: 4, type: 8 },
  { id: 5, type: 8 },
  { id: 6, type: 12 },
  { id: 7, type: 8 },
  { id: 8, type: 8 },
]);
const cases = [];
const member = (hp, maxHp, conditionIds = [10]) => ({
  id: "controlled-source-member",
  hp,
  maxHp,
  conditionIds,
});
function stepCase(
  name,
  input,
  expectedHp,
  expectedConditions,
  expectedDamage,
  soundId = 5,
) {
  const before = structuredClone(input);
  const result = conditions.projectStep([input], 1);
  assert.deepEqual(input, before, name + " does not mutate source input");
  assert.equal(result.members[0].hp, expectedHp, name);
  assert.deepEqual(result.members[0].conditionIds, expectedConditions, name);
  assert.equal(result.damage[0]?.requested ?? 0, expectedDamage, name);
  assert.equal(result.soundId, soundId, name);
  cases.push({ name, before, result });
  return result;
}
stepCase("integer division ignores remaining HP", member(70, 159), 66, [10], 4);
stepCase(
  "less than divisor has zero damage and requests sound",
  member(1, 31),
  1,
  [10],
  0,
);
stepCase("equal divisor", member(32, 32), 31, [10], 1);
stepCase(
  "near-death boundary appends condition master 4",
  member(25, 160),
  20,
  [10, 4],
  5,
);
stepCase("one above near-death boundary", member(26, 160), 21, [10], 5);
const low = stepCase("damage cannot kill", member(2, 320), 1, [10, 4], 10);
stepCase(
  "one HP remains one and poison remains",
  low.members[0],
  1,
  [10, 4],
  10,
);
stepCase("fallen member stays zero", member(0, 320, [5]), 0, [5], 0, null);
stepCase(
  "existing dying identity is not removed",
  member(160, 160, [4, 10]),
  155,
  [4, 10],
  5,
);
stepCase(
  "unpoisoned supported statuses are unchanged",
  member(160, 160, [6]),
  160,
  [6],
  0,
  null,
);
stepCase("Magitek source condition has no step damage or sound", member(160, 160, [53]), 160, [53], 0, null);
for (const { id, type } of field.catalog.transportations.filter(
  (t) => t.type !== 1,
)) {
  const before = member(160, 160);
  const result = conditions.projectStep([before], id);
  assert.deepEqual(result.members, [before]);
  assert.deepEqual(result.damage, []);
  assert.equal(result.soundId, null);
  cases.push({
    name: "known transportation skips condition monitor",
    transportationId: id,
    type,
    result,
  });
}
for (const conditionId of [88, 15, 16]) {
  assert.throws(
    () => conditions.projectStep([member(160, 160, [conditionId])], 1),
    /Unimplemented active/,
  );
  cases.push({ name: "unsupported active provider rejected", conditionId });
}
assert.throws(
  () => conditions.projectStep([member(160, 160)], 999),
  /Unknown field transportation/,
);
cases.push({ name: "unknown transportation rejected", transportationId: 999 });

const sourcePoison = compileDevelopmentAbility(index, 417, "source-poison-417");
assert.equal(sourcePoison.plan.effects[0].kind, "add-condition");
const effect = sourcePoison.plan.effects[0];
const added = battleConditions.add(
  [],
  {},
  effect.conditionId,
  { accuracy: effect.accuracy, fixed: effect.fixedHit, magicEvasion: 0 },
  () => 0,
);
const fieldIds = battleConditions.battleEnd(added.currentIds);
assert.deepEqual(fieldIds, [10]);
const first = conditions.projectStep([member(160, 160, fieldIds)], 1);
assert.equal(first.members[0].hp, 155);
const restored = JSON.parse(JSON.stringify(first.members));
assert.deepEqual(
  conditions.projectStep(restored, 1).members[0],
  member(150, 160),
);
const antidote = compileItem(index, 12, "source-antidote-12");
const recovery = antidote.definition.uses.menu.plan.effects.find(
  (e) => e.kind === "recover-condition",
);
assert.deepEqual(recovery.conditionIds, [10, 88]);
const cured = battleConditions.recover(
  restored[0].conditionIds,
  recovery.conditionIds,
);
restored[0].conditionIds = cured.currentIds;
const afterCure = conditions.projectStep(restored, 1);
assert.equal(afterCure.members[0].hp, 155);
assert.deepEqual(afterCure.members[0].conditionIds, []);
assert.equal(afterCure.soundId, null);
cases.push({
  name: "source poison action then battle-end field steps serialized state and source cure",
  abilityId: 417,
  itemId: 12,
  first,
  afterCure,
});

const provenance = [];
for (const [table, selected] of Object.entries(index.selected)) {
  for (const r of Object.values(selected)) {
    const raw = tables[table].filter((v) => v.id === r.values.id);
    assert.equal(raw.length, 1);
    assert.deepEqual(raw[0], r.values);
    const sourceFiles = battleExport.sources.filter(
      (s) => s.file === r.source.file || s.file.endsWith("/" + r.source.file),
    );
    assert.equal(sourceFiles.length, 1);
    provenance.push({
      table,
      rowId: r.values.id,
      source: r.source,
      fileSha256: sourceFiles[0].sha256,
      rowHash: hash(raw[0]),
    });
  }
}
const report = {
  kind: "source-field-condition-controlled-check",
  parentSourceSetHash: manifest.sourceSetHash,
  battleSourceSetHash: battleExport.sourceSetHash,
  nativeReportSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  catalogHash: hash(field.catalog),
  catalog: field.catalog,
  provenance,
  controlledProbes: cases.length,
  cases,
  nativeSemanticsVerified: false,
  limitations: [
    "Controlled source probes do not establish gameplay acquisition, playable map coverage, or original-runtime parity.",
    "The caller owns completion timing, transportation state and atomic publication; these pure probes do not verify those host integrations.",
    "No hidden field poison clock is serialized. Concurrent party or HP mutations during a movement require the host's explicit transaction policy.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    ok: true,
    report: reportPath,
    controlledProbes: cases.length,
    sourceRows: provenance.length,
    nativeSemanticsVerified: false,
  }),
);
