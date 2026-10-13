import assert from "node:assert/strict";
import test from "node:test";
import { compileMagicStoneDictionaries, compileMagicStoneRows, MAGIC_STONE_NATIVE_BINDING, type MagicStoneDictionaryRow } from "../src/compiler/magic-stones.js";
import { compileCharacterGrowth } from "../src/compiler/character-growth.js";
import { battleTableIndex } from "../src/compiler/battle.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";

const row = (values: Record<string, number | string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));

function fixture() {
  const tables: Record<string, Record<string, string>[]> = {
    "content.csv": [
      row({ id: 900, type_id: 9, type_value: 777, mes_id_name: "STONE_A" }),
      row({ id: 901, type_id: 9, type_value: 888, mes_id_name: "STONE_B" }),
      row({ id: 401, type_id: 4, type_value: 31 }), row({ id: 402, type_id: 4, type_value: 32 }),
    ],
    "ability.csv": [row({ id: 31, type_id: 1 }), row({ id: 32, type_id: 2 }),
      row({ id: 700, type_id: 9 }), row({ id: 701, type_id: 9 })],
    "learning.csv": [
      row({ id: 19, type_id: 2, job_id: 999, value1: 900, value2: 5, content_id: 401 }),
      row({ id: 3, type_id: 2, job_id: 0, value1: 901, value2: 3, content_id: 401 }),
      row({ id: 2, type_id: 2, job_id: 100, value1: 900, value2: 1, content_id: 402 }),
      row({ id: 25, type_id: 1, job_id: 12, value1: 20, value2: 0, content_id: 402 }),
    ],
  };
  const dictionaries: MagicStoneDictionaryRow[] = [
    { contentId: 900, summonAbilityId: 700, parameterType: 2, parameterValue: 10 },
    { contentId: 901, summonAbilityId: 701, parameterType: 0, parameterValue: 0 },
  ];
  const reader = () => battleTableIndex(tables, Object.fromEntries(Object.keys(tables).map(table => [table,
    { file: "authored.csv", assetPath: "synthetic/" + table, objectId: "1", serializedFile: "authored" }])));
  const names: Record<string, string> = { STONE_A: "Synthetic stone A", STONE_B: "Synthetic stone B" };
  return { tables, dictionaries, reader, names,
    compile: () => compileMagicStoneRows(reader(), tables, key => names[key] ?? null, dictionaries) };
}

test("magic stone rows bind native dictionary identities independently of content TypeValue", () => {
  const f = fixture(), result = f.compile();
  assert.equal(result.catalog.stones[900]!.summonAbilityId, 700);
  assert.deepEqual(result.catalog.stones[900]!.bonus, { parameter: 2, value: 10 });
  assert.deepEqual(result.catalog.stones[900]!.learning, [
    { id: 19, contentId: 401, abilityId: 31, rate: 5 },
    { id: 2, contentId: 402, abilityId: 32, rate: 1 },
  ]);
  assert.equal(result.report.learningRows, 3);
  assert.equal(result.report.bonusStones, 1);
  assert.equal(result.report.summonAdmitted, 0);
  assert.equal(result.report.ownershipGranted, false);
  assert.equal(result.report.originalGameExecuted, false);
  assert.ok(Object.values(result.catalog.stones).every(stone => stone.summonBlockers.length > 0));
  assert.ok(result.sources.some(source => source.assetPath.endsWith("learning.csv") && source.rowId === "19"));
  assert.equal(Object.hasOwn(result.catalog, "owned"), false);
});

test("dictionary/content coverage must be complete and duplicate identities fail", () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.dictionaries.pop(); },
    (f: ReturnType<typeof fixture>) => { f.dictionaries.push({ ...f.dictionaries[0]! }); },
    (f: ReturnType<typeof fixture>) => { f.tables["content.csv"]!.push(row({ id: 902, type_id: 9, type_value: 3, mes_id_name: "STONE_A" })); },
    (f: ReturnType<typeof fixture>) => { f.tables["content.csv"]!.push({ ...f.tables["content.csv"]![0]! }); },
  ]) {
    const f = fixture(); mutation(f);
    assert.throws(f.compile, /Incomplete|Duplicate/);
  }
});

test("unresolved bonus values and summon identities cannot produce a usable catalogue", () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.dictionaries[0]!.parameterType = 13; },
    (f: ReturnType<typeof fixture>) => { f.dictionaries[0]!.parameterValue = 11; },
    (f: ReturnType<typeof fixture>) => { f.dictionaries[1]!.parameterValue = 1; },
    (f: ReturnType<typeof fixture>) => { f.tables["ability.csv"]![2]!.type_id = "1"; },
    (f: ReturnType<typeof fixture>) => { f.dictionaries[0]!.summonAbilityId = 777; },
  ]) {
    const f = fixture(); mutation(f);
    assert.throws(f.compile, /Unresolved|Missing/);
  }
});

test("Type2 learning rejects broken stone, content, ability and proficiency references", () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.tables["learning.csv"]![0]!.value1 = "999"; },
    (f: ReturnType<typeof fixture>) => { f.tables["learning.csv"]![0]!.content_id = "900"; },
    (f: ReturnType<typeof fixture>) => { f.tables["content.csv"]![2]!.type_value = "999"; },
    (f: ReturnType<typeof fixture>) => { f.tables["learning.csv"]![0]!.value2 = "-1"; },
    (f: ReturnType<typeof fixture>) => { f.tables["learning.csv"]!.push({ ...f.tables["learning.csv"]![0]! }); },
  ]) {
    const f = fixture(); mutation(f);
    assert.throws(f.compile, /Unresolved|Missing|Invalid|Duplicate/);
  }
});

test("one learned ability cannot acquire conflicting content identities across stones", () => {
  const f = fixture();
  f.tables["content.csv"]!.push(row({ id: 403, type_id: 4, type_value: 31 }));
  f.tables["learning.csv"]![1]!.content_id = "403";
  assert.throws(f.compile, /Ambiguous magic stone learning ability content/);
});

test("a mismatched source reader cannot substitute another table row", () => {
  const f = fixture(), actual = f.reader();
  assert.throws(() => compileMagicStoneRows({ row: (table, id) => {
    const result = actual.row(table, id);
    return table === "learning.csv" ? { ...result, values: { ...result.values, value2: "99" } } : result;
  } }, f.tables, key => f.names[key] ?? null, f.dictionaries), /Mismatched magic stone table enumeration/);
});

test("unavailable source names fail explicitly instead of fabricating a usable label", () => {
  const f = fixture(); delete f.names.STONE_A;
  assert.throws(f.compile, /Missing or ambiguous magic stone message: STONE_A/);
  f.tables["content.csv"]![0]!.mes_id_name = "None";
  assert.throws(f.compile, /Missing or ambiguous magic stone message: None/);
});

test("compiled catalogue and source locations are detached from caller dictionaries and tables", () => {
  const f = fixture(), before = structuredClone({ tables: f.tables, dictionaries: f.dictionaries });
  const result = f.compile();
  result.catalog.stones[900]!.learning[0]!.rate = 90;
  result.catalog.stones[900]!.bonus.value = 50;
  result.sources[0]!.rowId = "wrong";
  assert.deepEqual({ tables: f.tables, dictionaries: f.dictionaries }, before);
  assert.equal(f.compile().catalog.stones[900]!.learning[0]!.rate, 5);
});

test("source compiler rejects missing or partial native manifests rather than attesting authored data", () => {
  for (const receipt of [null, {}, { ...MAGIC_STONE_NATIVE_BINDING, status: "complete", semanticsVerified: false, methods: [] }])
    assert.throws(() => compileMagicStoneDictionaries({ receipt, constructorC: "authored placeholder", sourceSetHash: "a".repeat(64) }), /Expected object|native evidence/);
});

function growthFixture() {
  const f = characterGrowthFixture();
  f.tables["content.csv"]!.push(row({ id: 90, type_id: 9, type_value: 99, mes_id_name: "STONE" }),
    row({ id: 606, type_id: 4, type_value: 102 }));
  f.tables["ability.csv"]!.push(row({ id: 700, type_id: 9, ability_group_id: 9 }),
    row({ id: 102, type_id: 2, ability_group_id: 8 }));
  f.tables["learning.csv"]!.push(row({ id: 17, type_id: 2, job_id: 777, value1: 90, value2: 5, content_id: 606 }));
  f.tables["command.csv"]!.push(row({ id: 7, ability_group_id: 71 }), row({ id: 31, ability_group_id: 72 }));
  f.tables["ability_group.csv"]!.push(row({ id: 71, group_id: 71, type_id: 79 }), row({ id: 72, group_id: 72, type_id: 80 }));
  f.tables["chanting.csv"]!.push(row({ id: 80, ability_type_id: 2 }));
  const catalog = compileMagicStoneRows(f.reader(), f.tables, key => key,
    [{ contentId: 90, summonAbilityId: 700, parameterType: 2, parameterValue: 10 }]).catalog;
  const compile = () => compileCharacterGrowth(f.reader(), f.tables, f.template, undefined, catalog);
  return { ...f, catalog, compile };
}

test("optional stone growth metadata adds source command bindings without granting initial ownership", () => {
  const f = growthFixture(), before = structuredClone(f.template), result = f.compile();
  assert.deepEqual(result.plan.commands.map(command => command.id), [41, 42, 43, 45, 7, 31]);
  assert.deepEqual(result.plan.commands.find(command => command.id === 7), { id: 7, abilityTypes: [1] });
  assert.deepEqual(result.plan.commands.find(command => command.id === 31), { id: 31, abilityTypes: [2] });
  assert.deepEqual(result.plan.abilities.find(ability => ability.id === 102), { id: 102, typeId: 2, groupId: 8, contentId: 606 });
  assert.equal(result.plan.abilities.some(ability => ability.id === 700), false);
  assert.deepEqual(result.plan.initialAbilities, before.initial.abilities);
  assert.deepEqual(f.template, before);
  assert.notEqual(result.plan.magicStones, f.catalog);
  assert.ok(result.sources.some(source => source.assetPath.endsWith("command.csv") && source.rowId === "7"));
});

test("legacy growth compilation without a magic stone capability remains unchanged", () => {
  const f = growthFixture();
  const old = compileCharacterGrowth(f.reader(), f.tables, f.template).plan;
  assert.equal(Object.hasOwn(old, "magicStones"), false);
  assert.deepEqual(old.commands.map(command => command.id), [41, 42]);
  assert.equal(old.abilities.some(ability => ability.id === 102 || ability.id === 700), false);
});

test("growth compiler refuses stale learning order, rates, identities and missing dynamic command providers", () => {
  for (const mutate of [
    (f: ReturnType<typeof growthFixture>) => { f.catalog.stones[90]!.learning.reverse(); },
    (f: ReturnType<typeof growthFixture>) => { f.catalog.stones[90]!.learning[0]!.rate++; },
    (f: ReturnType<typeof growthFixture>) => { f.catalog.stones[90]!.learning[1]!.abilityId = 31; },
    (f: ReturnType<typeof growthFixture>) => { f.tables["command.csv"] = f.tables["command.csv"]!.filter(value => value.id !== "7"); },
    (f: ReturnType<typeof growthFixture>) => { f.catalog.stones[90]!.learning.pop(); },
  ]) {
    const f = growthFixture(); mutate(f);
    assert.throws(f.compile, /Changed|Ambiguous|Missing|Unresolved|magic stone/i);
  }
});
