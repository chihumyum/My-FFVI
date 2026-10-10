import test from "node:test";
import assert from "node:assert/strict";
import { battleTableIndex } from "../src/compiler/battle.js";
import {
  compileAbilityProgram,
  compileDevelopmentAbility,
} from "../src/compiler/ability.js";
import { calculateDevelopmentEffects } from "../src/core/ability.js";

function fixture() {
  const ability: Record<string, string> = {
    id: "901",
    battle_function_group_id: "81",
    process_prog: "None",
    data_a: "0",
    data_b: "0",
    data_c: "0",
    battle_renge_id: "7",
    standard_value: "50",
    use_value: "2",
    ability_wait: "0",
    attribute_id: "0",
    type_id: "3",
    system_id: "1",
    accuracy_rate: "100",
    condition_group_id: "0",
    content_flag_group_id: "0",
    attribute_group_id: "0",
    attack_count: "0",
    Impact_status: "0",
    invalid_boss: "0",
    invalid_reflection: "1",
    resistance_attribute: "0",
    adding_hit_rate: "0",
    valid_hit_rate: "0",
    weak_hit_rate: "0",
    reaction_type: "0",
  };
  const group: Record<string, string> = {
    id: "81",
    function1_id: "801",
    function1_value1: "1",
    function1_value2: "2",
    function1_value3: "0",
    function2_id: "0",
    function2_value1: "0",
    function2_value2: "0",
    function2_value3: "0",
    function3_id: "801",
    function3_value1: "1",
    function3_value2: "3",
    function3_value3: "0",
  };
  const functions = [
    { id: "801", type_id: "1", series_id: "0" },
    { id: "802", type_id: "99", series_id: "0" },
  ];
  const source = {
    file: "synthetic",
    assetPath: "synthetic.csv",
    objectId: "9223372036854775807",
    serializedFile: "synthetic",
  };
  const reader = () =>
    battleTableIndex(
      {
        "ability.csv": [ability],
        "function_group.csv": [group],
        "function.csv": functions,
      },
      Object.fromEntries(
        ["ability.csv", "function_group.csv", "function.csv"].map((t) => [
          t,
          source,
        ]),
      ),
    );
  return {
    ability,
    group,
    functions,
    reader,
    compile: () => compileDevelopmentAbility(reader(), 901, "Synthetic"),
  };
}
test("dispatch follows type references and preserves third slot after an empty slot", () => {
  const f = fixture();
  const { program, sources } = compileAbilityProgram(f.reader(), 901);
  assert.deepEqual(
    program.functions.map((v) => [v.slot, v.functionId, v.type, v.values]),
    [
      [1, 801, 1, [1, 2, 0]],
      [3, 801, 1, [1, 3, 0]],
    ],
  );
  assert.ok(sources.every((r) => r.source.objectId === "9223372036854775807"));
  const plan = f.compile().plan!;
  assert.deepEqual(plan.effects, [
    { slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" },
    { slot: 3, kind: "recovery", resource: "mp", calculation: "fixed" },
  ]);
  assert.equal(plan.target, "either");
});
test("a supported first effect cannot hide an unknown later function or process", () => {
  const f = fixture();
  f.group.function3_id = "802";
  assert.equal(f.compile().plan, null);
  assert.match(
    f.compile().blockers.join(";"),
    /slot 3: unsupported function type 99/,
  );
  f.group.function3_id = "801";
  f.ability.process_prog = "NOT_IMPLEMENTED";
  assert.equal(f.compile().plan, null);
  assert.equal(f.compile().program.process.key, "NOT_IMPLEMENTED");
});
test("unknown scope, selector, condition, series and parameter values never inherit support", () => {
  for (const [column, value] of [
    ["battle_renge_id", "6"],
    ["accuracy_rate", "128"],
    ["condition_group_id", "400"],
    ["content_flag_group_id", "11"],
    ["attribute_group_id", "999"],
    ["attack_count", "3"],
  ]) {
    const f = fixture();
    f.ability[column!] = value!;
    assert.equal(f.compile().plan, null, column);
  }
  const f = fixture();
  f.functions[0]!.series_id = "6";
  assert.equal(f.compile().plan, null);
  f.functions[0]!.series_id = "0";
  f.group.function3_value3 = "1";
  assert.equal(f.compile().plan, null);
});
test("broken references and malformed integers fail instead of producing partial programs", () => {
  const f = fixture();
  f.group.function3_id = "700";
  assert.throws(() => f.compile(), /Unresolved/);
  f.group.function3_id = "801";
  f.ability.data_b = "";
  assert.throws(() => f.compile(), /Invalid table integer/);
  f.ability.data_b = "0";
  f.ability.data_c = "2147483648";
  assert.throws(() => f.compile(), /outside native int32/);
  f.ability.data_c = "0";
  f.group.function2_value1 = "2";
  assert.throws(() => f.compile(), /Orphan/);
});
test("fixed HP and MP effects need neither a magic formula nor a random draw", () => {
  const a = fixture().compile();
  const results = calculateDevelopmentEffects(
    a.plan!,
    a.power,
    { level: 99, attack: 999, magic: 999, side: "player" },
    { defense: 255, magicDefense: 255, evasion: 100 },
    () => assert.fail("Fixed recovery must not draw randomness"),
  );
  assert.deepEqual(results, [
    { slot: 1, resource: "hp", recovery: true, amount: 50, missed: false },
    { slot: 3, resource: "mp", recovery: true, amount: 50, missed: false },
  ]);
});
test("the whole effect plan is preflighted before any RNG or partial calculation", () => {
  let draws = 0;
  assert.throws(
    () =>
      calculateDevelopmentEffects(
        {
          effects: [
            { slot: 1, kind: "magic" },
            { slot: 2, kind: "physical" },
          ],
          target: "enemy",
          multiplier: 1,
        },
        40,
        { level: 5, attack: 30, magic: 20, side: "player" },
        { defense: 0, magicDefense: 0, evasion: 0 },
        () => {
          draws++;
          return 0;
        },
      ),
    /Player physical/,
  );
  assert.equal(draws, 0);
});
