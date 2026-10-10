import test from "node:test";
import assert from "node:assert/strict";
import {
  ConditionRules,
  type ConditionCatalog,
} from "../src/core/conditions.js";
import { compileConditionCatalog } from "../src/compiler/conditions.js";
import { battleTableIndex } from "../src/compiler/battle.js";

function fixture(): ConditionCatalog {
  return {
    definitions: [
      [101, 1, 1, false],
      [102, 10, 1, false],
      [103, 10, 3, false],
      [104, 20, 4, false],
      [105, 21, 5, false],
      [106, 30, 6, true],
      [107, 31, 7, false],
      [108, 32, 2, false],
      [109, 33, 8, false],
      [110, 34, 9, true],
      [111, 0, 1, true],
    ].map(([id, type, eraseGroupId, overlapped]) => ({
      id: id as number,
      type: type as number,
      eraseGroupId: eraseGroupId as number,
      overlapped: overlapped as boolean,
    })),
    eraseRules: [
      [1, 2, 0],
      [2, 1, 0],
      [3, 3, 102],
      [4, 4, 105],
      [5, 3, 104],
      [6, 4, 106],
      [7, 5, 102],
      [7, 5, 106],
      [7, 5, 102],
      [8, 6, 102],
      [9, 3, 110],
    ].map(([groupId, type, eraseConditionId], index) => ({
      id: index + 1,
      groupId: groupId!,
      type: type!,
      conditionId: 0,
      eraseConditionId: eraseConditionId!,
    })),
  };
}
const resolve = (currentIds: number[], incomingId: number) =>
  new ConditionRules(fixture()).resolveConflict({
    currentIds,
    incomingId,
    equipmentIds: [],
  });

test("condition identity survives type queries and asymmetric replacement", () => {
  const rules = new ConditionRules(fixture());
  assert.equal(rules.hasType([102, 103], 10), true);
  assert.equal(rules.hasType([111], 0), true);
  assert.deepEqual(resolve([103, 102], 102).currentIds, [103, 102]);
  assert.deepEqual(resolve([102, 103], 103), {
    currentIds: [103],
    removed: [{ id: 102, reason: "replace" }],
    invalidated: false,
    negated: false,
  });
});

test("duplicate resolution keeps the last occurrence and respects overlap", () => {
  const input = [101, 102, 101, 101];
  assert.deepEqual(resolve(input, 101).currentIds, [102, 101]);
  assert.deepEqual(input, [101, 102, 101, 101]);
  assert.deepEqual(resolve([111, 102, 111], 111).currentIds, [111, 102, 111]);
});

test("negation excludes exactly one incoming record before testing opponents", () => {
  assert.deepEqual(resolve([105, 104], 104).currentIds, []);
  assert.deepEqual(resolve([106], 106).currentIds, [106]);
  assert.deepEqual(resolve([106, 101, 106, 106], 106), {
    currentIds: [101],
    removed: [
      { id: 106, reason: "negate" },
      { id: 106, reason: "negate" },
      { id: 106, reason: "negate" },
    ],
    invalidated: false,
    negated: true,
  });
});

test("invalidation removes all incoming copies and returns before replacement", () => {
  assert.deepEqual(resolve([101, 102, 109, 102], 102), {
    currentIds: [101, 109],
    removed: [
      { id: 102, reason: "invalid" },
      { id: 102, reason: "invalid" },
    ],
    invalidated: true,
    negated: false,
  });
  // A newly added protector does not retroactively remove its protected-against ID.
  assert.deepEqual(resolve([102, 109], 109).currentIds, [102, 109]);
});

test("clear and preserve rules retain row identity, order and every preserved copy", () => {
  assert.deepEqual(
    resolve([101, 102, 106, 102, 103, 107], 107).currentIds,
    [102, 106, 102, 107],
  );
  assert.deepEqual(resolve([101, 102, 106, 108], 108).currentIds, [108]);
  assert.deepEqual(resolve([110], 110).currentIds, [110]);
  assert.deepEqual(resolve([110, 101, 110], 110).currentIds, [101]);
});

test("unsupported contexts and unknown identities fail without partial mutation", () => {
  const rules = new ConditionRules(fixture());
  const input = {
    currentIds: [101, 102, 103],
    incomingId: 103,
    equipmentIds: [101],
  };
  const before = structuredClone(input);
  assert.throws(() => rules.resolveConflict(input), /Equipment condition/);
  assert.deepEqual(input, before);
  assert.throws(
    () => resolve([101, 999], 101),
    /Unresolved condition identity/,
  );
  assert.throws(() => resolve([101], 102), /already-appended/);
  assert.throws(
    () => rules.hasType([102, 999], 10),
    /Unresolved condition identity/,
  );
});

test("catalog rejects unknown selectors, broken references and duplicate identities", () => {
  const cases = [
    (c: ConditionCatalog) => {
      c.eraseRules[0]!.type = 7;
    },
    (c: ConditionCatalog) => {
      c.eraseRules[2]!.eraseConditionId = 999;
    },
    (c: ConditionCatalog) => {
      c.eraseRules[2]!.conditionId = 999;
    },
    (c: ConditionCatalog) => {
      c.definitions[0]!.eraseGroupId = 999;
    },
    (c: ConditionCatalog) => {
      c.definitions.push({ ...c.definitions[0]! });
    },
    (c: ConditionCatalog) => {
      c.eraseRules.push({ ...c.eraseRules[0]! });
    },
  ];
  for (const change of cases) {
    const catalog = fixture();
    change(catalog);
    assert.throws(() => new ConditionRules(catalog));
  }
  const catalog = fixture(),
    rules = new ConditionRules(catalog);
  catalog.eraseRules[2]!.eraseConditionId = 101;
  assert.deepEqual(
    rules.resolveConflict({
      currentIds: [102, 103],
      incomingId: 103,
      equipmentIds: [],
    }).currentIds,
    [103],
  );
});

test("source compiler retains raw rows and exact Unity identity without claiming effect support", () => {
  const catalog = fixture();
  const tables = {
    "condition.csv": catalog.definitions.map((c) => ({
      id: String(c.id),
      condition_type: String(c.type),
      overlapped_type: c.overlapped ? "1" : "0",
      erase_condition_group_id: String(c.eraseGroupId),
      until_type: "999",
      parameter_group_id: "999", // Opaque behavior dependencies remain in source rows.
    })),
    "erase_condition_group.csv": catalog.eraseRules.map((r) => ({
      id: String(r.id),
      group_id: String(r.groupId),
      condition_id: String(r.conditionId),
      type_id: String(r.type),
      erase_condition: String(r.eraseConditionId),
    })),
  };
  const source = {
    file: "synthetic",
    assetPath: "synthetic.csv",
    serializedFile: "synthetic",
    objectId: "9223372036854775807",
  };
  const reader = () =>
    battleTableIndex(
      tables,
      Object.fromEntries(Object.keys(tables).map((key) => [key, source])),
    );
  const compiled = compileConditionCatalog(
    reader(),
    catalog.definitions.map((c) => c.id),
  );
  assert.deepEqual(compiled.catalog.definitions, catalog.definitions);
  assert.ok(
    compiled.sources.every((r) => r.source.objectId === source.objectId),
  );
  assert.equal(compiled.sources[0]!.values.until_type, "999");
  assert.equal(compiled.catalog.eraseRules.length, catalog.eraseRules.length);
  tables["condition.csv"][0]!.overlapped_type = "2";
  assert.throws(
    () =>
      compileConditionCatalog(
        reader(),
        catalog.definitions.map((c) => c.id),
      ),
    /Unsupported condition overlap/,
  );
});
