import test from "node:test";
import assert from "node:assert/strict";
import { battleTableIndex } from "../src/compiler/battle.js";
import {
  compileEquipment,
  compileEquipmentCatalog,
  compileEquipmentParameterContext,
} from "../src/compiler/equipment.js";
import { parameterLimitKeys } from "../src/compiler/parameters.js";
import { physicalLimitKeys } from "../src/compiler/physical-parameters.js";
import { equipmentLimits, fixtureWeaponEffects } from "./fixtures/equipment.js";

function fixture() {
  const row = (values: Record<string, number | string>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  const piece = (
    id: number,
    parts: number,
    empty: boolean,
    values: Record<string, number | string> = {},
  ) =>
    row({
      id,
      type_id: empty ? 2 : 1,
      parts_group_id: parts,
      equip_job_group_id: 8,
      process_prog: "None",
      wear_condition_group_id: 0,
      wear_function_group_id: 0,
      trigger_ability_id: 0,
      attribute_group_id: 0,
      attribute_id: 0,
      vitality: 0,
      intelligence: 0,
      spirit: 0,
      ability_disturbed_rate: 0,
      weak_attribute: 0,
      effective_species: 0,
      two_handed_flag: 0,
      back_flag: 0,
      additional_condition_group_id: 0,
      resistance_species: 0,
      resistance_condition: 0,
      resistance_attribute: 0,
      strength: 0,
      accuracy_rate: 100,
      critical_rate: 3,
      max_hp_up: 0,
      max_mp_up: 0,
      magic: 0,
      agility: 0,
      weight: 0,
      evasion_rate: 0,
      attack: 0,
      defense: 0,
      ability_defense: 0,
      ability_evasion_rate: 0,
      ...values,
    });
  const content = (id: number, type: number, value: number) =>
    row({
      id,
      type_id: type,
      type_value: value,
      mes_id_name: "SYNTHETIC_" + id,
    });
  const parts = (id: number, allowed: number[]) =>
    row({
      id,
      ...Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          "equip" + (i + 1) + "_possible",
          Number(allowed.includes(i + 1)),
        ]),
      ),
    });
  const slots = [101, 201, 3, 4, 5, 5];
  const character = (id: number, dominant: number) =>
    row({
      id,
      dominant_arm: dominant,
      job_id: 12,
      initial_condition_group: 0,
      hp: 100,
      mp: 25,
      magic: 40,
      vitality: 25,
      attack: 20,
      strength: 30,
      defense: 30,
      ability_defense: 20,
      agility: 30,
      evasion_rate: 0,
      magic_evasion_rate: 0,
      ...Object.fromEntries(slots.map((v, i) => ["content_id" + (i + 1), v])),
    });
  const constants = new Map<string, number>([["MAX_ITEM", 99]]);
  for (const [key, name] of Object.entries(parameterLimitKeys))
    constants.set(
      name,
      equipmentLimits.parameters[key as keyof typeof parameterLimitKeys],
    );
  for (const [key, name] of Object.entries(physicalLimitKeys))
    constants.set(
      name,
      equipmentLimits.physical[key as keyof typeof equipmentLimits.physical],
    );
  const tables: Record<string, Record<string, string>[]> = {
    "content.csv": [
      content(1, 2, 1),
      content(2, 3, 1),
      content(3, 3, 2),
      content(4, 3, 3),
      content(5, 3, 4),
      content(101, 2, 7),
      content(201, 3, 7),
    ],
    "weapon.csv": [
      piece(1, 1, true),
      piece(7, 1, false, { attack: 30, attribute_id: 1 }),
    ],
    "armor.csv": [
      piece(1, 1, true),
      piece(2, 2, true),
      piece(3, 3, true),
      piece(4, 4, true),
      piece(7, 1, false, {
        defense: 15,
        ability_defense: 10,
        resistance_attribute: 9,
      }),
    ],
    "parts_group.csv": [
      parts(1, [1, 2]),
      parts(2, [3]),
      parts(3, [4]),
      parts(4, [5, 6]),
    ],
    "job_group.csv": [
      row({ id: 8, job1_accept: 0, job12_accept: 1, job99_accept: 0 }),
    ],
    "attribute.csv": [row({ id: 1 })],
    "attribute_group.csv": [
      row({ id: 33, group_id: 9, attribute_id: 1, type_id: 2 }),
    ],
    "character_status.csv": [character(1, 1), character(14, 2)],
    "game_constant_int.csv": [...constants].map(([key_name, value1], i) =>
      row({ id: i + 1, key_name, value1 }),
    ),
  };
  const source = {
    file: "synthetic",
    assetPath: "equipment",
    serializedFile: "fixture",
    objectId: "9223372036854775807",
  };
  const reader = () =>
    battleTableIndex(
      tables,
      Object.fromEntries(
        Object.keys(tables).map((t) => [t, { ...source, assetPath: t }]),
      ),
    );
  const providers = {
    hasTwoSwordStyle: false,
    hasTwoHand: false,
    equipAnyJob: false,
  };
  const compile = () =>
    compileEquipmentCatalog(
      reader(),
      tables["content.csv"]!.map((r) => Number(r.id)),
      [1, 14],
      (k) => k,
      { 1: providers, 14: providers },
      fixtureWeaponEffects(),
    );
  return { tables, reader, compile, source, providers };
}

test("equipment compiler retains content namespaces, exact source dependencies and native empty-slot preference", () => {
  const f = fixture(),
    result = f.compile(),
    c = result.catalog;
  assert.equal(c.limit, 99);
  assert.equal(
    c.definitions[101]!.equipmentId,
    c.definitions[201]!.equipmentId,
  );
  assert.equal(c.definitions[101]!.kind, "weapon");
  assert.equal(c.definitions[201]!.kind, "armor");
  assert.deepEqual(c.definitions[101]!.jobIds, [12]);
  assert.deepEqual(c.definitions[101]!.attackElements, [1]);
  assert.deepEqual(c.definitions[201]!.elementResistances, { 1: 2 });
  assert.deepEqual(c.characters[1]!.emptySlots, [1, 1, 3, 4, 5, 5]);
  assert.deepEqual(c.characters[14]!.emptySlots, [1, 1, 3, 4, 5, 5]);
  assert.equal(c.characters[1]!.accessoriesOnly, false);
  assert.equal(c.characters[14]!.accessoriesOnly, true);
  assert.ok(result.sources.every((s) => s.objectId === f.source.objectId));
  for (const table of [
    "content.csv",
    "weapon.csv",
    "armor.csv",
    "parts_group.csv",
    "job_group.csv",
    "attribute.csv",
    "attribute_group.csv",
    "character_status.csv",
    "game_constant_int.csv",
  ])
    assert.ok(
      result.sources.some((s) => s.assetPath === table),
      table,
    );
});

test("source vitality equipment is admitted with its exact numeric contribution", () => {
  const f = fixture();
  f.tables["weapon.csv"]![1]!.vitality = "7";
  f.tables["armor.csv"]![4]!.vitality = "-3";
  const compiled = f.compile().catalog;
  assert.deepEqual(compiled.definitions[101]!.blockers, []);
  assert.deepEqual(compiled.definitions[201]!.blockers, []);
  assert.equal(compiled.definitions[101]!.parameter!.values.vitality, 7);
  assert.equal(compiled.definitions[201]!.parameter!.values.vitality, -3);
  delete f.tables["weapon.csv"]![1]!.vitality;
  assert.throws(f.compile, /integer/i);
});

test("unknown effects preserve inventory identity but missing references, ambiguous empties and invalid flags fail compilation", () => {
  const f = fixture(),
    weapon = f.tables["weapon.csv"]![1]!;
  weapon.process_prog = "unreviewed";
  weapon.wear_function_group_id = "47";
  const blocked = compileEquipment(f.reader(), 101, "Synthetic", fixtureWeaponEffects()).definition;
  assert.equal(blocked.id, 101);
  assert.equal(blocked.parameter, null);
  assert.ok(
    blocked.blockers.some((b) => b.includes("process_prog=unreviewed")),
  );
  assert.ok(
    blocked.blockers.some((b) => b.includes("wear_function_group_id=47")),
  );
  weapon.intelligence = "2";
  assert.ok(
    compileEquipment(f.reader(), 101, "Synthetic", fixtureWeaponEffects()).definition.blockers.some(
      (b) => b.includes("intelligence=2"),
    ),
  );
  f.tables["parts_group.csv"]![0]!.equip1_possible = "2";
  assert.throws(f.compile, /acceptance flag/);
  f.tables["parts_group.csv"]![0]!.equip1_possible = "1";
  f.tables["attribute.csv"] = [];
  assert.throws(f.compile, /Unresolved/);
  const g = fixture();
  g.tables["content.csv"]!.push({ ...g.tables["content.csv"]![0]!, id: "999" });
  assert.throws(g.compile, /ambiguous empty/);
  g.tables["content.csv"]!.pop();
  g.tables["character_status.csv"]![0]!.dominant_arm = "3";
  assert.throws(g.compile, /dominant arm provider/);
});

test("source parameter contexts retain uncapped explicit growth and contain no stale initial equipment contributions", () => {
  const f = fixture();
  const zero = {
    hp: 0,
    mp: 0,
    magic: 0,
    vitality: 0,
    attack: 0,
    defense: 0,
    magicDefense: 0,
    agility: 0,
    weight: 0,
    evasion: 0,
    magicEvasion: 0,
  };
  const result = compileEquipmentParameterContext(
    f.reader(),
    1,
    {
      additional: {
        hp: 20000,
        mp: 3000,
        magic: 2,
        vitality: 0,
        agility: 1,
        weight: 0,
      },
      correction: { magic: 1, vitality: 0, agility: 2 },
      temporary: zero,
      passive: { hp: 0, mp: 0, magicEvasion: 0 },
      condition601: false,
      twoHandMultiplier: 1,
    },
    {
      additionalStrength: 7,
      correctionStrength: 2,
      temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 },
    },
  );
  assert.equal(result.context.parameters.base.hp, 100);
  assert.equal(result.context.parameters.additional.hp, 20000);
  assert.equal(result.context.parameters.additional.mp, 3000);
  assert.equal(Object.hasOwn(result.context.parameters, "equipment"), false);
  assert.deepEqual(result.context.physical.strength, {
    base: 30,
    additional: 7,
    correction: 2,
  });
  assert.deepEqual(result.limits, equipmentLimits);
});
