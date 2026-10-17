import test from "node:test";
import assert from "node:assert/strict";
import { compileObservedLearning } from "../src/compiler/character-learning.js";
import { battleTableIndex } from "../src/compiler/battle.js";

function fixture() {
  const tables: Record<string, Record<string, string>[]> = {
    "ability.csv": [
      { id: "161", type_id: "504", ability_group_id: "5" },
      { id: "1350", type_id: "504", ability_group_id: "5" },
      { id: "160", type_id: "504", ability_group_id: "5" },
      { id: "142", type_id: "504", ability_group_id: "5" },
      { id: "99", type_id: "3", ability_group_id: "1" },
    ],
    "content.csv": [
      { id: "491", type_id: "4", type_value: "161" },
      { id: "490", type_id: "4", type_value: "160" },
      { id: "472", type_id: "4", type_value: "142" },
    ],
    "command.csv": [{ id: "17", ability_group_id: "52" }],
    "ability_group.csv": [{ id: "104", group_id: "52", type_id: "32" }],
    "chanting.csv": [{ id: "32", ability_type_id: "504" }],
  };
  const sources = Object.fromEntries(Object.keys(tables).map((file) =>
    [file, { file, assetPath: "controlled/" + file, objectId: "1", serializedFile: "controlled" }]));
  const misc = { exchange_learning_ability: [{ before_ability_id: 1350, after_ability_id: 160 }] };
  return { tables, misc, compile: () => compileObservedLearning(battleTableIndex(tables, sources), tables, misc) };
}

test("learning compiler preserves master order, resolves chanting types and binds mapped content", () => {
  const f = fixture(), result = f.compile();
  assert.deepEqual(result.catalog.commandAbilityTypes, [504]);
  assert.deepEqual(result.catalog.candidates.map((r) => [r.observedAbilityId, r.abilityId, r.contentId]),
    [[161,161,491], [1350,160,490], [160,160,490], [142,142,472]]);
  assert.ok(result.sources.some((s) => s.file === "chanting.csv" && s.rowId === "32"));
  assert.ok(result.sources.some((s) => s.file === "content.csv" && s.rowId === "490"));
});

test("learning compiler rejects missing or ambiguous mapped content instead of taking the first row", () => {
  const f = fixture();
  f.tables["content.csv"]!.push({ id: "1490", type_id: "4", type_value: "160" });
  assert.throws(f.compile, /ambiguous observed learning content/);
  f.tables["content.csv"] = f.tables["content.csv"]!.filter((r) => r.type_value !== "160");
  assert.throws(f.compile, /Missing or ambiguous observed learning content/);
});

test("learning compiler requires explicit exchange metadata and its exact row identities", () => {
  const f = fixture();
  f.misc.exchange_learning_ability.push({ before_ability_id: 1350, after_ability_id: 142 });
  assert.throws(f.compile, /Ambiguous observed learning exchange/);
  f.misc.exchange_learning_ability = [{ before_ability_id: 1350, after_ability_id: 999 }];
  assert.throws(f.compile, /Unresolved table row/);
});
