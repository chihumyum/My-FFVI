import { test } from "node:test";
import assert from "node:assert/strict";
import { trackSourceConditionReads } from "../src/compiler/source-condition-reader.js";
import type { BattleRow } from "../src/compiler/battle.js";
const row: BattleRow = { values: { id: "3", value: "source" }, source: {
  file: "master.bundle", assetPath: "Assets/condition.csv", serializedFile: "CAB-source",
  objectId: "-9007199254740997", rowId: "3",
} };
const identity = { sourceSetHash: "a".repeat(64), parentSourceSetHash: "b".repeat(64),
  battleSourceSetHash: "c".repeat(64), physicalSources: [{ file: "data/master.bundle", sha256: "d".repeat(64), bytes: 123 }] };
function reader() { return { row: () => row, unique: () => row, group: () => [row], matching: () => [row] }; }
test("complete condition reader retains raw rows, large source IDs and physical bundle bindings once", () => {
  const tracked = trackSourceConditionReads(reader(), identity);
  tracked.reader.row("condition.csv", 3); tracked.reader.group("condition.csv", "group_id", 1);
  tracked.reader.unique("condition.csv", "id", 3); tracked.reader.matching("condition.csv", "id", 3);
  const snapshot = tracked.snapshot();
  assert.equal(snapshot.rows.length, 1);
  assert.deepEqual(snapshot.rows[0], { table: "condition.csv", row, physicalSource: identity.physicalSources[0] });
  snapshot.rows[0]!.row.values.value = "detached";
  assert.equal(tracked.snapshot().rows[0]!.row.values.value, "source");
});
test("complete reader rejects changed source rows rather than silently refreshing the audit", () => {
  const source = structuredClone(row), tracked = trackSourceConditionReads({ ...reader(), row: () => source }, identity);
  tracked.reader.row("condition.csv", 3);
  source.values.value = "changed";
  assert.throws(() => tracked.reader.row("condition.csv", 3), /changed during compilation/);
  assert.equal(tracked.snapshot().rows[0]!.row.values.value, "source");
});
test("unbound, ambiguous physical files and mismatched row IDs never produce a ledger entry", () => {
  for (const physicalSources of [[], [identity.physicalSources[0]!, { ...identity.physicalSources[0]!, file: "master.bundle" }]]) {
    const tracked = trackSourceConditionReads(reader(), { ...identity, physicalSources });
    assert.throws(() => tracked.reader.row("condition.csv", 3), /Unbound/);
    assert.equal(tracked.snapshot().rows.length, 0);
  }
  const invalid = { ...row, source: { ...row.source, rowId: "4" } };
  const tracked = trackSourceConditionReads({ ...reader(), row: () => invalid }, identity);
  assert.throws(() => tracked.reader.row("condition.csv", 3), /row identity mismatch/);
});
