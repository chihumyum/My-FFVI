import test from "node:test";
import assert from "node:assert/strict";
import { battleTableIndex } from "../src/compiler/battle.js";
import { compileItem } from "../src/compiler/items.js";

function fixture() {
  const row = (values: Record<string, number | string>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  const item = row({
    id: 71,
    type_id: 1,
    system_id: 1,
    standard_value: 0,
    accuracy_rate: 100,
    destroy_rate: 100,
    invalid_reflection: 1,
    attribute_id: 0,
    period_id: 0,
    throw_flag: 0,
    preparation_flag: 0,
    drink_flag: 0,
    machine_flag: 0,
    condition_group_id: 0,
    menu_function_group_id: 81,
    battle_function_group_id: 82,
    menu_renge_id: 7,
    battle_renge_id: 7,
  });
  const group = (id: number) =>
    row({
      id,
      ...Object.fromEntries(
        [1, 2, 3].flatMap((n) => [
          [`function${n}_id`, 0],
          ...[1, 2, 3].map((v) => [`function${n}_value${v}`, 0]),
        ]),
      ),
    });
  const menu = group(81),
    battle = group(82);
  const slot = (
    g: Record<string, string>,
    n: number,
    id: number,
    values: number[],
  ) => {
    g[`function${n}_id`] = String(id);
    values.forEach((v, i) => (g[`function${n}_value${i + 1}`] = String(v)));
  };
  const condition = (id: number, death = false) =>
    row({
      id,
      condition_type: death ? 5 : 6,
      system_type: 1,
      until_type: death ? 3 : 2,
      resistance_decision: 1,
      attack_target: Number(death),
      game_over_target: Number(death),
      recovery_invalid: Number(death),
      state_cover_unavailable: Number(death),
      until_value: 0,
      overlapped_type: 0,
      invalid_type: 0,
      target_type: 0,
      condition_group_id: 0,
      parameter_group_id: 0,
      attribute_group_id: 0,
      species_group_id: 0,
      rate_type1: 0,
      rate_type2: 0,
      rate_value1: 0,
      rate_value2: 0,
      damage_number: 0,
    });
  const tables: Record<string, Record<string, string>[]> = {
    "content.csv": [row({ id: 601, type_id: 1, type_value: 71 })],
    "item.csv": [item],
    "function_group.csv": [menu, battle],
    "function.csv": [11, 12, 34, 1].map((type) =>
      row({ id: 100 + type, type_id: type, series_id: 0 }),
    ),
    "condition.csv": [
      condition(706),
      condition(705, true),
      condition(805, true),
    ],
    "condition_group.csv": [
      row({ id: 901, group_id: 920, condition_id: 805 }),
      row({ id: 902, group_id: 920, condition_id: 705 }),
    ],
  };
  const source = {
    file: "synthetic",
    assetPath: "item-condition-programs",
    serializedFile: "fixture",
    objectId: "9223372036854775807",
  };
  const decode = () =>
    compileItem(
      battleTableIndex(
        tables,
        Object.fromEntries(Object.keys(tables).map((t) => [t, source])),
      ),
      601,
      "Synthetic",
    );
  return { item, menu, battle, slot, tables, decode, source };
}

test("item cure programs keep source identities, slot order and independent menu/battle qualification", () => {
  const f = fixture();
  f.slot(f.menu, 3, 111, [706, 0, 0]);
  f.slot(f.battle, 2, 112, [920, 0, 0]);
  const { definition: d, sources } = f.decode();
  assert.equal(d.power, 0);
  assert.deepEqual(d.uses.menu.plan!.effects, [
    { slot: 3, kind: "recover-condition", conditionIds: [706] },
  ]);
  assert.equal(d.uses.menu.plan!.targeting.life, "alive");
  assert.deepEqual(d.uses.battle.plan!.effects, [
    { slot: 2, kind: "recover-condition", conditionIds: [805, 705] },
  ]);
  assert.equal(d.uses.battle.plan!.targeting.life, "include-fallen-players");
  for (const id of [706, 805, 705, 901, 902])
    assert.ok(
      sources.some(
        (s) =>
          s.values.id === String(id) && s.source.objectId === f.source.objectId,
      ),
    );
  f.item.menu_function_group_id = "0";
  assert.equal(f.decode().definition.uses.menu.plan, null);
  assert.ok(f.decode().definition.uses.battle.plan);
  f.tables["condition.csv"]!.pop();
  assert.throws(f.decode, /Unresolved/);
});

test("only ordered death recovery plus supported max-HP selectors admits an item revival chain", () => {
  const f = fixture();
  f.slot(f.menu, 1, 112, [920, 0, 0]);
  f.slot(f.menu, 3, 134, [2, 5, 8]);
  assert.deepEqual(f.decode().definition.uses.menu.plan!.effects, [
    { slot: 1, kind: "recover-condition", conditionIds: [805, 705] },
    { slot: 3, kind: "recover-max-hp", mode: "divide", value: 8 },
  ]);
  f.slot(f.menu, 3, 134, [2, 4, 25]);
  assert.deepEqual(f.decode().definition.uses.menu.plan!.effects[1], {
    slot: 3,
    kind: "recover-max-hp",
    mode: "percent",
    value: 25,
  });
  for (const values of [
    [2, 4, 101],
    [2, 5, 0],
    [1, 5, 8],
  ]) {
    f.slot(f.menu, 3, 134, values);
    assert.equal(f.decode().definition.uses.menu.plan, null);
  }
  f.slot(f.menu, 1, 134, [2, 5, 8]);
  f.slot(f.menu, 3, 112, [920, 0, 0]);
  assert.equal(f.decode().definition.uses.menu.plan, null);
  f.slot(f.menu, 1, 111, [706, 0, 0]);
  f.slot(f.menu, 3, 134, [2, 5, 8]);
  assert.equal(f.decode().definition.uses.menu.plan, null);
});

test("mixed fixed-and-condition recovery and empty or unresolved condition groups never silently execute", () => {
  const f = fixture();
  f.item.standard_value = "100";
  f.slot(f.menu, 1, 101, [1, 2, 0]);
  f.slot(f.menu, 2, 111, [706, 0, 0]);
  assert.equal(f.decode().definition.uses.menu.plan, null);
  f.slot(f.menu, 1, 0, [0, 0, 0]);
  f.slot(f.menu, 2, 112, [0, 0, 0]);
  assert.equal(f.decode().definition.uses.menu.plan, null);
  f.slot(f.menu, 2, 112, [999, 0, 0]);
  assert.throws(f.decode, /Unresolved/);
  f.slot(f.menu, 2, 111, [706, 1, 0]);
  assert.equal(f.decode().definition.uses.menu.plan, null);
  f.slot(f.menu, 2, 101, [1, 2, 0]);
  f.item.standard_value = "0";
  assert.equal(f.decode().definition.uses.menu.plan, null);
});
