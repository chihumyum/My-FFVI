import { ownedCharacterFixture } from "./owned-character.js";
import { compileOwnedCharacterInitialization } from "../../src/compiler/owned-character.js";
import { fixtureWeaponEffects } from "./equipment.js";
import { compileCharacterGrowth } from "../../src/compiler/character-growth.js";
import { createOwnedCharacter } from "../../src/core/owned-character.js";
import { initialCharacterGrowth, type CharacterGrowthMember, type CharacterGrowthProgress } from "../../src/core/character-growth.js";

export function characterGrowthFixture() {
  const fixture = ownedCharacterFixture();
  const tables = fixture.tables;
  const row = (value: Record<string, number | string>) =>
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
  tables["game_constant_int.csv"]!.find((r) => r.key_name === "MAX_LV")!.value1 = "5";
  tables["game_constant_int.csv"]!.find((r) => r.key_name === "MAX_EXP")!.value1 = "400";
  tables["intermediate_growth_curve.csv"]![0]!.growth_curve_group_id = "6";
  tables["exp_table.csv"] = [0, 30, 100, 120, 300]
    .map((total_exp, i) => row({ id: i + 1, group_id: 5, type_id: 1, lv: i + 1, total_exp }));
  tables["growth_curve.csv"] = [0, 10, 20, 30, 40]
    .map((hp_value1, i) => row({ id: 11 + i, group_id: 6, lv: i + 1, hp_value1, mp_value1: i,
      hp_value2: 0, mp_value2: 0, insert_type_1: 1, insert_type_2: 1, insert_type_3: 1 }));
  tables["content.csv"]!.push(row({ id: 604, type_id: 4, type_value: 100 }), row({ id: 605, type_id: 4, type_value: 101 }));
  tables["ability.csv"]!.push(row({ id: 100, type_id: 604, ability_group_id: 7 }), row({ id: 101, type_id: 604, ability_group_id: 7 }));
  tables["ability.csv"]!.push(row({ id: 140, type_id: 504, ability_group_id: 11 }));
  tables["ability_group.csv"]!.push(row({ id: 3, group_id: 7, type_id: 79 }));
  tables["chanting.csv"]!.push(row({ id: 79, ability_type_id: 1 }));
  tables["learning.csv"] = [
    row({ id: 12, type_id: 1, job_id: 12, value1: 4, value2: 0, content_id: 605 }),
    row({ id: 11, type_id: 1, job_id: 12, value1: 3, value2: 0, content_id: 602 }),
    row({ id: 13, type_id: 1, job_id: 12, value1: 3, value2: 0, content_id: 604 }),
    row({ id: 14, type_id: 2, job_id: 0, value1: 90, value2: 2, content_id: 602 }),
    row({ id: 15, type_id: 3, job_id: 99, value1: 7, value2: 0, content_id: 602 }),
    row({ id: 16, type_id: 4, job_id: 0, value1: 207, value2: 1, content_id: 602 }),
  ];
  const compile = () => {
    const initialization = compileOwnedCharacterInitialization(fixture.reader(), tables, 2, (key) => key, fixtureWeaponEffects());
    return { ...compileCharacterGrowth(fixture.reader(), tables, initialization.template), template: initialization.template };
  };
  const compiled = compile();
  const member = createOwnedCharacter(compiled.template, {
    id: "synthetic-growth-owner", ownedId: 1, releasedJobIds: [], learnedAbilityIds: [],
  }).member;
  const progress = initialCharacterGrowth();
  const project = (_member: CharacterGrowthMember, next: CharacterGrowthProgress) => ({
    maxHp: compiled.template.initial.maxHp + next.additional.hp,
    maxMp: compiled.template.initial.maxMp + next.additional.mp,
  });
  return { ...fixture, ...compiled, member, progress, project, compile };
}
