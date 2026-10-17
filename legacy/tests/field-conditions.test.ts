import test from "node:test";
import assert from "node:assert/strict";
import {
  FieldConditions,
  type FieldConditionCatalog,
  type FieldConditionMember,
} from "../src/core/field-conditions.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import type { BattleConditionCatalog } from "../src/core/battle-conditions.js";
import type { BattleRow } from "../src/compiler/battle.js";

const catalog = (): FieldConditionCatalog => ({
  definitions: [
    { id: 404, type: 4 },
    { id: 505, type: 5 },
    { id: 606, type: 6 },
    { id: 1010, type: 10 },
    { id: 1011, type: 10 },
    { id: 1088, type: 10 },
  ],
  behaviors: [
    { id: 404, kind: "none" },
    { id: 505, kind: "none" },
    { id: 606, kind: "none" },
    { id: 1010, kind: "poison", hpDivisor: 32, soundId: 55 },
    { id: 1011, kind: "poison", hpDivisor: 64, soundId: 66 },
  ],
  dying: { conditionId: 404, thresholdDivisor: 8 },
  transportations: [
    { id: 101, type: 1 },
    { id: 106, type: 12 },
    { id: 104, type: 8 },
  ],
});
const member = (
  patch: Partial<FieldConditionMember> = {},
): FieldConditionMember => ({
  id: "character-a",
  hp: 159,
  maxHp: 159,
  conditionIds: [1010],
  ...patch,
});
const step = (input = member(), transportationId = 101) =>
  new FieldConditions(catalog()).projectStep([input], transportationId);

test("one completed walking step uses integer max HP / 32 and no battle affinity", () => {
  const result = step();
  assert.equal(result.members[0]!.hp, 155);
  assert.deepEqual(result.damage, [
    {
      id: "character-a",
      requested: 4,
      actual: 4,
      hpBefore: 159,
      hpAfter: 155,
    },
  ]);
  assert.equal(result.soundId, 55);
  assert.equal(step(result.members[0]).members[0]!.hp, 151);
});

test("zero calculated damage still requests the source sound without adding dying", () => {
  const result = step(member({ hp: 1, maxHp: 31 }));
  assert.equal(result.members[0]!.hp, 1);
  assert.deepEqual(result.members[0]!.conditionIds, [1010]);
  assert.deepEqual(result.damage, []);
  assert.equal(result.soundId, 55);
});

test("field poison preserves living HP at one and never revives a fallen member", () => {
  const result = step(member({ hp: 2, maxHp: 320 }));
  assert.equal(result.members[0]!.hp, 1);
  assert.deepEqual(result.members[0]!.conditionIds, [1010, 404]);
  assert.equal(result.damage[0]!.requested, 10);
  assert.equal(result.damage[0]!.actual, 1);
  const again = step(result.members[0]);
  assert.equal(again.members[0]!.hp, 1);
  assert.deepEqual(again.members[0]!.conditionIds, [1010, 404]);
  assert.equal(again.damage[0]!.actual, 0);
  const fallen = step(member({ hp: 0, conditionIds: [505] }));
  assert.equal(fallen.members[0]!.hp, 0);
  assert.deepEqual(fallen.members[0]!.conditionIds, [505]);
  // The pure source callback does not settle or clean an inconsistent list.
  // Shared-state validation owns whether such a list can become a live save.
  const poisonedFallen = step(member({ hp: 0, conditionIds: [505, 1010] }));
  assert.equal(poisonedFallen.members[0]!.hp, 0);
  assert.deepEqual(poisonedFallen.members[0]!.conditionIds, [505, 1010]);
  assert.equal(poisonedFallen.damage[0]!.actual, 0);
  assert.equal(poisonedFallen.soundId, 55);
});

test("near-death uses source float32 threshold and only appends a missing identity", () => {
  const exact = step(member({ hp: 25, maxHp: 160 }));
  assert.deepEqual(exact.members[0]!.conditionIds, [1010, 404]);
  assert.equal(exact.members[0]!.hp, 20);
  const above = step(member({ hp: 26, maxHp: 160 }));
  assert.deepEqual(above.members[0]!.conditionIds, [1010]);
  const staleDying = step(member({ conditionIds: [404, 1010] }));
  assert.deepEqual(staleDying.members[0]!.conditionIds, [404, 1010]);
});

test("condition order accumulates requested damage and chooses the last positive SE", () => {
  const result = step(
    member({ maxHp: 128, hp: 128, conditionIds: [1010, 1011] }),
  );
  assert.equal(result.damage[0]!.requested, 6);
  assert.equal(result.soundId, 66);
  const reversed = step(
    member({ maxHp: 128, hp: 128, conditionIds: [1011, 1010] }),
  );
  assert.equal(reversed.damage[0]!.requested, 6);
  assert.equal(reversed.soundId, 55);
  // Native CheckCondition iterates the current list, not a set of types.
  assert.equal(
    step(member({ conditionIds: [1010, 1010] })).damage[0]!.requested,
    8,
  );
});

test("only supplied moving party members are projected in order", () => {
  const engine = new FieldConditions(catalog());
  const result = engine.projectStep(
    [
      member(),
      member({ id: "character-b", hp: 100, maxHp: 100, conditionIds: [606] }),
      member({ id: "character-c", hp: 64, maxHp: 64, conditionIds: [1011] }),
    ],
    101,
  );
  assert.deepEqual(
    result.members.map((m) => m.hp),
    [155, 100, 63],
  );
  assert.deepEqual(
    result.damage.map((d) => d.id),
    ["character-a", "character-c"],
  );
  assert.equal(result.soundId, 66);
  assert.deepEqual(engine.projectStep([], 101), {
    members: [],
    damage: [],
    soundId: null,
  });
});

test("source transportation identity selects the gate; mount appearance is not an input", () => {
  for (const id of [104, 106]) {
    const result = step(member(), id);
    assert.equal(result.members[0]!.hp, 159);
    assert.deepEqual(result.damage, []);
    assert.equal(result.soundId, null);
  }
  assert.throws(() => step(member(), 1), /Unknown field transportation/);
  assert.throws(() => step(member(), 12), /Unknown field transportation/);
  assert.throws(() => step(member(), null as unknown as number), /Unknown/);
});

test("cure and serialized shared state have no hidden field clock or poison counter", () => {
  const first = step();
  const restored = JSON.parse(JSON.stringify(first.members));
  const next = new FieldConditions(catalog()).projectStep(restored, 101);
  assert.equal(next.members[0]!.hp, 151);
  restored[0].conditionIds = [];
  const cured = new FieldConditions(catalog()).projectStep(restored, 101);
  assert.equal(cured.members[0]!.hp, 155);
  assert.deepEqual(cured.damage, []);
  assert.equal(cured.soundId, null);
});

test("unsupported provider or invalid later member cannot leave partial changes", () => {
  const good = Object.freeze({
    ...member(),
    conditionIds: Object.freeze([1010]),
  });
  const bad = member({ id: "character-b", conditionIds: [1088] });
  const engine = new FieldConditions(catalog());
  assert.throws(
    () => engine.projectStep([good, bad], 101),
    /Unimplemented active/,
  );
  assert.equal(good.hp, 159);
  assert.deepEqual(good.conditionIds, [1010]);
  assert.throws(() => step(member({ conditionIds: [9999] })), /Unknown field/);
  assert.throws(() => engine.projectStep([good, good], 101), /duplicate/);
  for (const hp of [-1, 160, NaN, 0.5])
    assert.throws(() => step(member({ hp })), /HP/);
  assert.throws(() => step(member({ maxHp: 0 })), /maximum HP/);
});

test("compiled definitions and projected lists do not alias caller-owned data", () => {
  const raw = catalog();
  const engine = new FieldConditions(raw);
  raw.dying.conditionId = 999;
  raw.transportations[0]!.type = 12;
  const input = member();
  const result = engine.projectStep([input], 101);
  result.members[0]!.conditionIds.push(606);
  assert.deepEqual(input.conditionIds, [1010]);
  assert.equal(input.hp, 159);
  assert.equal(result.members[0]!.hp, 155);
});

function compilerFixture() {
  const rows = new Map<string, BattleRow>();
  function add(table: string, id: number, values: Record<string, string>) {
    rows.set(`${table}:${id}`, {
      values: { id: String(id), ...values },
      source: {
        file: "synthetic.asset",
        assetPath: table,
        objectId: "-9007199254740993",
        serializedFile: "synthetic",
        rowId: String(id),
      },
    });
  }
  const zero = Object.fromEntries(
    [
      "until_value",
      "overlapped_type",
      "invalid_type",
      "target_type",
      "condition_group_id",
      "parameter_group_id",
      "attribute_group_id",
      "species_group_id",
      "rate_type2",
      "rate_value2",
      "recovery_invalid",
      "attack_target",
      "game_over_target",
      "state_cover_unavailable",
    ].map((key) => [key, "0"]),
  );
  add("condition.csv", 404, { damage_number: "0", field_se_asset_id: "0" });
  add("condition.csv", 1010, {
    ...zero,
    condition_type: "10",
    system_type: "1",
    resistance_decision: "1",
    until_type: "3",
    rate_type1: "3",
    rate_value1: "16",
    damage_number: "32",
    field_se_asset_id: "55",
  });
  add("transportation.csv", 101, { type_id: "1" });
  add("transportation.csv", 106, { type_id: "12" });
  add("se_asset.csv", 55, { asset_name: "synthetic-field-pain" });
  add("game_constant_int.csv", 232, {
    key_name: "RATE_HAVE_NEAR_DEATH",
    value1: "8",
  });
  const battle: BattleConditionCatalog = {
    rules: {
      definitions: [
        { id: 404, type: 4, overlapped: false, eraseGroupId: 1 },
        { id: 1010, type: 10, overlapped: false, eraseGroupId: 1 },
      ],
      eraseRules: [],
    },
    hpZeroConditionId: 505,
    dying: { conditionId: 404, thresholdDivisor: 8 },
    behaviors: [
      { id: 404, kind: "dying", name: "Dying", untilType: 3 },
      { id: 1010, kind: "poison", name: "Poison", untilType: 3, hpDivisor: 16 },
    ],
  };
  const reader = {
    row: (table: string, id: string | number) => rows.get(`${table}:${id}`)!,
    group: () => [],
    unique: () => rows.get("game_constant_int.csv:232")!,
  };
  return { reader, battle, rows };
}

test("compiler binds field damage independently from battle rate and preserves transport source", () => {
  const { reader, battle } = compilerFixture();
  const { catalog: compiled, sources } = compileFieldConditionCatalog(
    reader,
    battle,
    [101, 106],
  );
  assert.deepEqual(compiled.behaviors[1], {
    id: 1010,
    kind: "poison",
    hpDivisor: 32,
    soundId: 55,
  });
  assert.deepEqual(compiled.transportations, [
    { id: 101, type: 1 },
    { id: 106, type: 12 },
  ]);
  assert.equal(sources.length, 6);
  assert.ok(
    sources.every((row) => row.source.objectId === "-9007199254740993"),
  );
});

test("compiler rejects hidden field providers and ambiguous dying selection", () => {
  const { reader, battle, rows } = compilerFixture();
  rows.get("condition.csv:1010")!.values.condition_group_id = "1303";
  assert.throws(
    () => compileFieldConditionCatalog(reader, battle, [101]),
    /poison provider/,
  );
  rows.get("condition.csv:1010")!.values.condition_group_id = "0";
  rows.get("condition.csv:404")!.values.field_se_asset_id = "1";
  assert.throws(
    () => compileFieldConditionCatalog(reader, battle, [101]),
    /field condition provider/,
  );
  rows.get("condition.csv:404")!.values.field_se_asset_id = "0";
  battle.rules.definitions.push({
    id: 444,
    type: 4,
    overlapped: false,
    eraseGroupId: 1,
  });
  assert.throws(
    () => compileFieldConditionCatalog(reader, battle, [101]),
    /dying selector/,
  );
});
