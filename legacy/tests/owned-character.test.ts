import test from "node:test";
import assert from "node:assert/strict";
import { compileOwnedCharacterInitialization } from "../src/compiler/owned-character.js";
import { fixtureWeaponEffects } from "./fixtures/equipment.js";
import { createOwnedCharacter, validateOwnedCharacterAbilities } from "../src/core/owned-character.js";
import { ownedCharacterFixture } from "./fixtures/owned-character.js";

const compile = (f = ownedCharacterFixture()) =>
  compileOwnedCharacterInitialization(f.reader(), f.tables, 2, (key) => key, fixtureWeaponEffects());
const request = () => ({ id: "owner:new", ownedId: 4, releasedJobIds: [1, 12], learnedAbilityIds: [999, 31] });

test("initial owned, learned, command-visible and acquisition order retain distinct native meanings", () => {
  const { template, sources } = compile();
  const a = template.initial.abilities;
  assert.deepEqual(a.commandIds, [41, 42, 43, 45]);
  assert.deepEqual(a.owned, [
    { abilityId: 220, contentId: 601, skillLevel: 100 },
    { abilityId: 31, contentId: 602, skillLevel: 0 },
    { abilityId: 229, contentId: 603, skillLevel: 100 },
  ]);
  assert.deepEqual(a.additionOrder, [603, 601]);
  assert.deepEqual(a.byCommand, [{ commandId: 41, abilityIds: [220] }]);
  assert.deepEqual(a.equipment, [0, 0, 0]);
  assert.deepEqual(a.slots.map((s) => s.abilityIds), Array.from({ length: 8 }, () => [null, null, null]));
  assert.ok(sources.every((s) => s.objectId === "9223372036854775807"));
  for (const table of ["chanting.csv", "ability_random_group.csv", "exp_table.csv", "job.csv"])
    assert.ok(sources.some((s) => s.assetPath === table));
});

test("initial level is experience-derived and equipment boosts never refill initial HP", () => {
  const f = ownedCharacterFixture();
  f.tables["armor.csv"]!.find((r) => r.id === "7")!.max_hp_up = "50";
  const { template: t } = compile(f);
  assert.equal(t.base.level, 90);
  assert.equal(t.initial.level, 2);
  assert.equal(t.initial.additionalLevel, 2);
  assert.equal(t.initial.exp, 30);
  assert.equal(t.initial.hp, 100);
  assert.equal(t.initial.maxHp, 150);
  assert.equal(t.parameterContext.parameters.additional.hp, 0);
  assert.equal(t.parameterContext.parameters.base.hp, 100);
});

test("new ownership returns detached member, deduplicated ordered history and name binding", () => {
  const { template } = compile();
  const input = request(), before = structuredClone({ template, input });
  const created = createOwnedCharacter(template, input);
  assert.equal(created.member.id, "owner:new");
  assert.equal(created.member.ownedId, 4);
  assert.deepEqual(created.member.ownedJobs, [{ id: 12, level: 1, proficiency: 0 }, { id: 1, level: 1, proficiency: 0 }]);
  assert.deepEqual(created.learnedAbilityIdsToAppend, [220, 229]);
  assert.deepEqual(created.nameBinding, { key: "OWNER_TAG", value: "SYNTHETIC_OWNER" });
  assert.deepEqual({ template, input }, before);
  created.member.abilities.owned[0]!.skillLevel = 0;
  created.member.equipment[0] = 999;
  assert.deepEqual({ template, input }, before);
  const unlearned = createOwnedCharacter(template, { ...request(), learnedAbilityIds: [] });
  assert.deepEqual(unlearned.learnedAbilityIdsToAppend, [220, 31, 229]);
});

test("empty source ability group is distinct from missing or duplicate dependencies", () => {
  const empty = ownedCharacterFixture();
  empty.tables["character_status.csv"]![0]!.ability_random_group_id = "0";
  const t = compile(empty).template;
  assert.deepEqual(t.initial.abilities.owned, []);
  assert.deepEqual(t.initial.abilities.additionOrder, []);
  assert.deepEqual(t.initial.abilities.byCommand, []);
  const missing = ownedCharacterFixture();
  missing.tables["ability_random_group.csv"] = [];
  assert.throws(() => compile(missing), /Missing initial owned ability group/);
  const duplicate = ownedCharacterFixture();
  duplicate.tables["ability_random_group.csv"]!.push({ id: "99", group_id: "22", ability_id: "220" });
  assert.throws(() => compile(duplicate), /Duplicate initial owned ability/);
  const curve = ownedCharacterFixture();
  curve.tables["intermediate_growth_curve.csv"]!.push({ ...curve.tables["intermediate_growth_curve.csv"]![0]!, id: "2" });
  assert.throws(() => compile(curve), /experience curve/);
});

test("character without a default-name row has no substitution binding", () => {
  const f = ownedCharacterFixture();
  f.tables["character_default_name.csv"] = [];
  const template = compile(f).template;
  assert.equal(template.nameTag, null);
  assert.equal(createOwnedCharacter(template, request()).nameBinding, null);
  assert.equal(template.initial.name, "SYNTHETIC_OWNER");
  f.tables["character_default_name.csv"] = [
    { id: "1", character_id: "2", tag_name: "OWNER" },
    { id: "2", character_id: "2", tag_name: "OTHER" },
  ];
  assert.throws(() => compile(f), /Ambiguous initial character name tag/);
});

test("native null content can survive unlearned ownership, but cannot become a learned content identity", () => {
  const f = ownedCharacterFixture();
  f.tables["content.csv"] = f.tables["content.csv"]!.filter((r) => r.id !== "602");
  assert.equal(compile(f).template.initial.abilities.owned[1]!.contentId, 0);
  f.tables["content.csv"] = f.tables["content.csv"]!.filter((r) => r.id !== "601");
  assert.throws(() => compile(f), /Missing initial learned ability content/);
});

test("unsupported initialization providers reject instead of supplying zero-valued substitutes", () => {
  const condition = ownedCharacterFixture();
  condition.tables["character_status.csv"]![0]!.initial_condition_group = "7";
  assert.throws(() => compile(condition), /conditions/);
  const passive = ownedCharacterFixture();
  passive.tables["ability_random_group.csv"]![1]!.ability_id = "245";
  passive.tables["ability.csv"]![1]!.id = "245";
  assert.throws(() => compile(passive), /passive/);
  const two = ownedCharacterFixture();
  two.tables["ability.csv"]![1]!.type_id = "12";
  assert.throws(() => compile(two), /dual-wield/);
  const job = ownedCharacterFixture();
  job.tables["job.csv"]![0]!.change_command_1 = "1";
  assert.throws(() => compile(job), /job command replacement/);
  const equipment = ownedCharacterFixture();
  equipment.tables["armor.csv"]!.find((r) => r.id === "7")!.wear_function_group_id = "8";
  assert.throws(() => compile(equipment), /wear_function_group/);
});

test("history and released job errors leave inputs intact", () => {
  const { template } = compile();
  const before = structuredClone(template);
  assert.throws(() => createOwnedCharacter(template, { ...request(), releasedJobIds: [99] }), /Unknown initialization job/);
  assert.throws(() => createOwnedCharacter(template, { ...request(), learnedAbilityIds: [31, 31] }), /Duplicate/);
  assert.throws(() => createOwnedCharacter(template, { ...request(), ownedId: 0 }), /integer/);
  assert.deepEqual(template, before);
});

test("ability save admission rejects dangling identity, unlearned commands and malformed source slots", () => {
  const abilities = compile().template.initial.abilities;
  const corrupt = structuredClone(abilities);
  corrupt.byCommand[0]!.abilityIds = [31];
  assert.throws(() => validateOwnedCharacterAbilities(corrupt), /Unlearned/);
  corrupt.byCommand[0]!.abilityIds = [999];
  assert.throws(() => validateOwnedCharacterAbilities(corrupt), /Unlearned/);
  const slot = structuredClone(abilities);
  slot.slots[1]!.level = 1;
  assert.throws(() => validateOwnedCharacterAbilities(slot), /slots/);
  const order = structuredClone(abilities);
  order.additionOrder.push(999);
  assert.throws(() => validateOwnedCharacterAbilities(order), /Unowned/);
  const provider = structuredClone(abilities);
  provider.skillLevelTargets["missing-provider"] = 0;
  assert.throws(() => validateOwnedCharacterAbilities(provider), /checkpoint fields/);
});
