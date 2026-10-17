import assert from "node:assert/strict";
import test from "node:test";
import { expectedOwnedGrowth, growCharacter, validateCharacterGrowth, validateObservedLearning } from "../src/core/character-growth.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";

test("source base experience is separate from additional experience and ignores source base lv", () => {
  const f = characterGrowthFixture();
  assert.equal(f.template.base.level, 90);
  assert.equal(f.member.level, 2);
  assert.equal(f.member.exp, 30);
  assert.equal(f.progress.additionalExp, 0);
  assert.deepEqual(expectedOwnedGrowth(f.plan, f.progress).additional, f.progress.additional);
  const next = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 69, context: "battle", observedAbilityIds: [] }, f.project);
  assert.equal(next.member.level, 2);
  assert.equal(next.member.exp, 99);
  assert.equal(next.progress.additionalExp, 69);
  assert.deepEqual(next.steps, []);
});

test("level threshold grants source increments without healing current HP or MP", () => {
  const f = characterGrowthFixture();
  f.member.hp = 1; f.member.mp = 0;
  const next = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 70, context: "battle", observedAbilityIds: [] }, f.project);
  assert.equal(next.member.level, 3);
  assert.equal(next.member.additionalLevel, 3);
  assert.equal(next.progress.additional.hp, 20);
  assert.equal(next.progress.additional.mp, 2);
  assert.equal(next.member.maxHp, f.member.maxHp + 20);
  assert.equal(next.member.hp, 1);
  assert.equal(next.member.mp, 0);
  assert.deepEqual(next.learnedAbilityIdsToAppend, []);
});

test("CorrectLevel replaces saved experience by global row ID before adding base experience", () => {
  const f = characterGrowthFixture();
  const a = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 60, context: "field" }, f.project);
  const b = growCharacter(f.plan, a.member, a.progress, { kind: "correct-level", targetLevel: 3 }, f.project);
  assert.equal(b.progress.additionalExp, 100);
  assert.equal(b.member.exp, 130);
  // The native target chooses an exp row, not the exact resulting level.
  assert.equal(b.member.level, 4);
  assert.deepEqual(b.steps.map((s) => s.level), [3, 4]);
  assert.equal(b.progress.additional.hp, 50);
});

test("CorrectLevel never lowers an existing character or invokes projection for a no-op", () => {
  const f = characterGrowthFixture();
  const result = growCharacter(f.plan, f.member, f.progress, { kind: "correct-level", targetLevel: 1 }, () => { throw new Error("must not execute"); });
  assert.deepEqual(result.member, f.member);
  assert.notEqual(result.member, f.member);
  assert.deepEqual(result.steps, []);
});

test("natural learning updates existing skill-zero abilities and appends new identities in level then source order", () => {
  const f = characterGrowthFixture();
  assert.deepEqual(f.member.abilities.owned.map((a) => [a.abilityId, a.skillLevel]), [[220,100],[31,0],[229,100]]);
  const result = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 90, context: "battle", observedAbilityIds: [] }, f.project);
  assert.deepEqual(result.member.abilities.owned.map((a) => a.abilityId), [220,31,229,100,101]);
  assert.equal(result.member.abilities.owned.find((a) => a.abilityId === 31)!.skillLevel, 100);
  assert.deepEqual(result.member.abilities.additionOrder, [603,601,602,604,605]);
  assert.deepEqual(result.member.abilities.byCommand, [{ commandId: 41, abilityIds: [220,100,101,31] }]);
  assert.deepEqual(result.steps.map((s) => s.learnedAbilityIds), [[31,100],[101]]);
  assert.deepEqual(result.learnedAbilityIdsToAppend, []);
});

test("split awards and one bulk award agree including learned identity order", () => {
  const f = characterGrowthFixture();
  const first = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 70, context: "battle", observedAbilityIds: [] }, f.project);
  const split = growCharacter(f.plan, first.member, first.progress, { kind: "add-experience", amount: 20, context: "battle", observedAbilityIds: [] }, f.project);
  const bulk = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 90, context: "battle", observedAbilityIds: [] }, f.project);
  assert.deepEqual(split.member, bulk.member);
  assert.deepEqual(split.progress, bulk.progress);
});

test("raw additions survive capped parameter projection and maximum experience is capped separately", () => {
  const f = characterGrowthFixture();
  const first = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 390, context: "field" }, () => ({ maxHp: 10, maxMp: 0 }));
  assert.equal(first.member.exp, 400);
  assert.equal(first.progress.additionalExp, 390);
  assert.equal(first.progress.additional.hp, 90);
  assert.equal(first.member.maxHp, 10);
  assert.equal(first.member.hp, 10);
  const last = growCharacter(f.plan, first.member, first.progress, { kind: "add-experience", amount: 400, context: "field" }, f.project);
  assert.equal(last.progress.additionalExp, 400);
  assert.equal(last.member.exp, 400);
  assert.equal(last.member.level, 5);
  assert.equal(last.progress.additional.hp, 90);
});

test("failed parameter projection and caller mutation cannot partially publish a growth transaction", () => {
  const f = characterGrowthFixture();
  const before = structuredClone({ member: f.member, progress: f.progress });
  assert.throws(() => growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 90, context: "battle", observedAbilityIds: [] }, (member, progress) => {
    member.hp = 0; member.abilities.owned.splice(0); progress.additionalExp = 0;
    throw new Error("projection not available");
  }), /projection not available/);
  assert.deepEqual({ member: f.member, progress: f.progress }, before);
});

test("unimplemented stone, equipment and battle learning are explicit while field natural growth remains available", () => {
  const f = characterGrowthFixture();
  const request = { kind: "add-experience", amount: 1, context: "battle", observedAbilityIds: [] } as const;
  assert.throws(() => growCharacter(f.plan, { ...f.member, magicStoneId: 90 }, f.progress, request, f.project), /magic stone/);
  assert.throws(() => growCharacter(f.plan, { ...f.member, equipment: [207] }, f.progress, request, f.project), /equipment learning/);
  const backgroundPlan = { ...f.plan, hasBattleBackgroundLearning: true };
  assert.throws(() => growCharacter(backgroundPlan, f.member, f.progress, request, f.project), /battle background/);
  assert.equal(growCharacter(backgroundPlan, f.member, f.progress, { ...request, context: "field" }, f.project).member.exp, 31);
  const lorePlan = structuredClone(f.plan), loreMember = structuredClone(f.member);
  for (const list of [lorePlan.initialAbilities.owned, loreMember.abilities.owned])
    list.push({ abilityId: 74, contentId: 0, skillLevel: 0 });
  lorePlan.abilities.push({ id: 74, typeId: 504, groupId: 0, contentId: 0 });
  assert.equal(growCharacter(lorePlan, loreMember, f.progress, request, f.project).member.exp, 31);
  assert.throws(() => growCharacter(lorePlan, loreMember, f.progress, { ...request, observedAbilityIds: [140] }, f.project), /observed-ability/);
  const missingLog = JSON.parse(JSON.stringify(request)); delete missingLog.observedAbilityIds;
  assert.throws(() => growCharacter(lorePlan, loreMember, f.progress, missingLog, f.project), /Missing observed/);
});

test("restore validation rejects changed additions, experience, learned flags, command and identity order", () => {
  const f = characterGrowthFixture();
  const good = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 90, context: "battle", observedAbilityIds: [] }, f.project);
  const mutations: ((copy: typeof good) => void)[] = [
    (c) => { c.progress.additional.hp++; },
    (c) => { c.progress.additional.strength++; },
    (c) => { c.progress.additionalExp++; },
    (c) => { c.member.additionalLevel--; },
    (c) => { c.member.abilities.owned[0]!.skillLevel--; },
    (c) => { c.member.abilities.owned.reverse(); },
    (c) => { c.member.abilities.additionOrder.reverse(); },
    (c) => { c.member.abilities.byCommand[0]!.abilityIds.reverse(); },
    (c) => { c.member.jobId++; },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(good); mutate(bad);
    assert.throws(() => validateCharacterGrowth(f.plan, bad.member, bad.progress));
  }
  validateCharacterGrowth(f.plan, JSON.parse(JSON.stringify(good.member)), JSON.parse(JSON.stringify(good.progress)));
});

test("experience-ineligible members only validate observation learning without other StatusUp providers", () => {
  const f = characterGrowthFixture();
  const plan = { ...f.plan, hasBattleBackgroundLearning: true };
  const member = { ...f.member, hp: 0, magicStoneId: 90, equipment: [207] };
  const before = structuredClone({ member, progress: f.progress });
  validateObservedLearning(plan, member, [140]);
  assert.deepEqual({ member, progress: f.progress }, before);
  member.abilities.owned.push({ abilityId: 74, contentId: 0, skillLevel: 0 });
  const withRawLearningAbility = structuredClone(member);
  validateObservedLearning(plan, member, []);
  assert.throws(() => validateObservedLearning(plan, member, [140]), /observed-ability/);
  assert.deepEqual(member, withRawLearningAbility);
  assert.throws(() => validateObservedLearning(plan, member, undefined as unknown as number[]), /Missing observed/);
  assert.throws(() => validateObservedLearning(plan, member, [0]), /Invalid character growth integer/);
});

test("compiler rejects missing, ambiguous or mismatched source growth instead of defaulting", () => {
  const mutations: ((tables: ReturnType<typeof characterGrowthFixture>["tables"]) => void)[] = [
    (t) => { delete t["growth_curve.csv"]; },
    (t) => { t["growth_curve.csv"]!.pop(); },
    (t) => { t["growth_curve.csv"]![1]!.insert_type_1 = "2"; },
    (t) => { t["growth_curve.csv"]![1]!.insert_type_2 = "2"; },
    (t) => { t["growth_curve.csv"]![1]!.insert_type_3 = "2"; },
    (t) => { t["growth_curve.csv"]![1]!.hp_value2 = "7"; },
    (t) => { t["growth_curve.csv"]![1]!.mp_value2 = "7"; },
    (t) => { t["growth_curve.csv"]!.push({ ...t["growth_curve.csv"]![0]!, id: "99" }); },
    (t) => { t["intermediate_growth_curve.csv"]!.push({ ...t["intermediate_growth_curve.csv"]![0]!, id: "99" }); },
    (t) => { t["exp_table.csv"]![2]!.id = "88"; },
    (t) => { t["learning.csv"]![0]!.type_id = "99"; },
    (t) => { t["learning.csv"]![3]!.value1 = "0"; },
    (t) => { t["learning.csv"]![0]!.content_id = "9999"; },
    (t) => { t["ability.csv"]!.find((a) => a.id === "101")!.type_id = "12"; },
  ];
  for (const mutate of mutations) {
    const f = characterGrowthFixture(); mutate(f.tables);
    assert.throws(f.compile);
  }
});
