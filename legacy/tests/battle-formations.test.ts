import assert from "node:assert/strict";
import test from "node:test";
import {
  createBattleFormationPlan, parseBattleFormationPlan, selectBattleFormation,
  validateBattleFormationChoice, type BattleFormationPatterns, type FrameworkBattleFormationPolicy,
} from "../src/core/battle-formations.js";

const normal: BattleFormationPatterns = [1, 0, 0, 0, 0, 0];
const opposed: BattleFormationPatterns = [0, 0, 1, 0, 0, 0];
const mixed: BattleFormationPatterns = [1, 1, 1, 1, 1, 0];
const policy = (weights: FrameworkBattleFormationPolicy["weights"] = [2, 0, 3, 0, 0, 0]): FrameworkBattleFormationPolicy =>
  ({ kind: "framework-battle-formations-v1", id: "controlled-formations", weights });

test("only a single supported source pattern creates a fixed plan without a policy", () => {
  for (const [patterns, pattern, formation] of [[normal, 1, "normal"], [opposed, 3, "opposed"]] as const) {
    const plan = createBattleFormationPlan(patterns);
    assert.deepEqual(plan, { kind: "fixed", patterns, pattern });
    assert.deepEqual(selectBattleFormation(plan), { plan, pattern, formation, seed: null });
    assert.deepEqual(selectBattleFormation(plan, 1234), selectBattleFormation(plan));
    validateBattleFormationChoice(selectBattleFormation(plan), formation, 1234);
  }
  for (const patterns of [mixed, [0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1]] as BattleFormationPatterns[])
    assert.throws(() => createBattleFormationPlan(patterns), /explicit development policy/);
});

test("source patterns reject empty, unknown, sparse, extended and non-integer bits", () => {
  const bad: unknown[] = [null, [], [1], [0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0],
    [true, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, NaN], [1, 0, 0, 0, 0, -0],
    [1, 0, 0, 0, 0, -1], [1, 0, 0, 0, 0, 0.5], [1, 0, 0, 0, 0, 0, 0],
    Object.assign(new Array(6), { 0: 1 }), Object.assign([...normal], { extra: true })];
  for (const patterns of bad) assert.throws(() => createBattleFormationPlan(patterns as BattleFormationPatterns, policy()));
});

test("a development subset preserves all source candidates and the original authored weights", () => {
  const patterns: BattleFormationPatterns = [1, 1, 1, 1, 1, 1];
  const rule = policy([8, 0, 0, 0, 0, 0]);
  const plan = createBattleFormationPlan(patterns, rule);
  assert.deepEqual(plan, { kind: "development", patterns, policy: rule });
  for (const seed of [0, 1, 19, 0xffffffff]) assert.equal(selectBattleFormation(plan, seed).pattern, 1);
  const intersected = createBattleFormationPlan(opposed, policy());
  assert.equal(selectBattleFormation(intersected, 0).pattern, 3);
  assert.deepEqual(intersected.kind === "development" && intersected.policy.weights, [2, 0, 3, 0, 0, 0]);
  assert.throws(() => createBattleFormationPlan(normal, policy([0, 0, 4, 0, 0, 0])), /no intersection/);
  assert.throws(() => createBattleFormationPlan([0, 1, 0, 0, 0, 0], policy()), /no intersection/);
});

test("unsupported positive weights are rejected even outside the source mask", () => {
  for (const index of [1, 3, 4, 5]) {
    const weights: FrameworkBattleFormationPolicy["weights"] = [1, 0, 0, 0, 0, 0];
    weights[index] = 1;
    assert.throws(() => createBattleFormationPlan(normal, policy(weights)), /Unsupported positive/);
  }
});

test("policy validation requires exact identity and finite uint32 weights with a positive bounded total", () => {
  const bad: unknown[] = [null, {}, { ...policy(), kind: "source" }, { ...policy(), id: "" },
    { ...policy(), id: " extra " }, { ...policy(), extra: true }, { ...policy(), weights: [] },
    { ...policy(), weights: [0, 0, 0, 0, 0, 0] }, policy([0xffffffff, 0, 1, 0, 0, 0]),
    { ...policy(), weights: Object.assign(new Array(6), { 0: 1 }) }];
  for (const value of [-1, -0, 0.1, NaN, Infinity, "1", 0x100000000])
    bad.push({ ...policy(), weights: [value, 0, 1, 0, 0, 0] });
  for (const value of bad) assert.throws(() => createBattleFormationPlan(mixed, value as FrameworkBattleFormationPolicy));
  assert.equal(selectBattleFormation(createBattleFormationPlan(normal, policy([0xffffffff, 0, 0, 0, 0, 0])), 0).pattern, 1);
});

test("strict plan parsing cannot disguise multiple candidates as a fixed plan", () => {
  const bad: unknown[] = [null, {}, [], { kind: "source", patterns: normal },
    { kind: "fixed", patterns: normal, pattern: 3 }, { kind: "fixed", patterns: mixed, pattern: 1 },
    { kind: "fixed", patterns: normal, pattern: 1, policy: policy() },
    { kind: "development", patterns: mixed },
    { kind: "development", patterns: normal, policy: policy(), pattern: 1 }];
  for (const value of bad) assert.throws(() => parseBattleFormationPlan(value));
  const getter = { patterns: normal, pattern: 1 };
  Object.defineProperty(getter, "kind", { enumerable: true, get: () => { throw new Error("Getter evaluated"); } });
  assert.throws(() => parseBattleFormationPlan(getter), /Invalid battle formation plan kind/);
});

test("plans, choices and parsed nested arrays never alias caller inputs or each other", () => {
  const patterns = [...mixed] as BattleFormationPatterns, rule = policy();
  const plan = createBattleFormationPlan(patterns, rule), parsed = parseBattleFormationPlan(plan);
  const before = structuredClone(plan), choice = selectBattleFormation(plan, 19);
  patterns[0] = 0; rule.weights[0] = 99;
  assert.deepEqual(plan, before);
  parsed.patterns[0] = 0;
  if (parsed.kind === "development") parsed.policy.weights[0] = 123;
  choice.plan.patterns[0] = 0;
  if (choice.plan.kind === "development") choice.plan.policy.weights[0] = 777;
  assert.deepEqual(plan, before);
  assert.notEqual(selectBattleFormation(plan, 19).plan, plan);
});

test("development choices require explicit uint32 seeds and replay deterministically", () => {
  const plan = createBattleFormationPlan(mixed, policy());
  for (const seed of [undefined, -1, -0, 0.5, NaN, Infinity, 0x100000000])
    assert.throws(() => selectBattleFormation(plan, seed), /seed/);
  for (const seed of [0, 1, 1234, 0xffffffff]) {
    const a = selectBattleFormation(plan, seed), b = selectBattleFormation(parseBattleFormationPlan(JSON.parse(JSON.stringify(plan))), seed);
    assert.deepEqual(a, b); assert.equal(a.seed, seed);
    validateBattleFormationChoice(a, a.formation, seed);
  }
});

test("independent inverse LCG vectors reach every weighted bucket boundary", () => {
  const plan = createBattleFormationPlan(mixed, policy());
  // Seeds are inverse vectors for the first domain-separated uint32 draw
  // 0, 1, 2, 3, 4. Weights produce intervals [0,2) and [2,5).
  const inverse = 4276115653n, modulus = 0x100000000n;
  for (let draw = 0; draw < 5; draw++) {
    const initial = Number((BigInt(draw) - 1013904223n + modulus) * inverse % modulus);
    const seed = (initial ^ 0x464f524d) >>> 0;
    assert.equal(selectBattleFormation(plan, seed).pattern, draw < 2 ? 1 : 3);
  }
});

test("rejection sampling excludes the incomplete uint32 tail instead of applying biased modulo", () => {
  // The first draw is 0xffffffff, rejected for total 5. Its successor is
  // 1012239698 (bucket 3). Immediate modulo would incorrectly choose normal.
  const modulus = 0x100000000n;
  const initial = Number((0xffffffffn - 1013904223n + modulus) * 4276115653n % modulus);
  const seed = (initial ^ 0x464f524d) >>> 0;
  const plan = createBattleFormationPlan(mixed, policy());
  assert.equal(selectBattleFormation(plan, seed).pattern, 3);
});

test("selection is separate from the combat stream and does not retain mutable RNG state", () => {
  const plan = createBattleFormationPlan(mixed, policy([1, 0, 1, 0, 0, 0]));
  const combat = { seed: 1234, rng: 1234 }, before = structuredClone(combat);
  const first = selectBattleFormation(plan, combat.seed);
  // XOR with odd FORM changes parity relative to the unchanged first combat
  // LCG draw, so this controlled 1:1 example also distinguishes the domains.
  const combatDraw = (Math.imul(combat.rng, 1664525) + 1013904223) >>> 0;
  assert.notEqual(first.pattern, combatDraw % 2 === 0 ? 1 : 3);
  selectBattleFormation(plan, 4567);
  assert.deepEqual(selectBattleFormation(plan, combat.seed), first);
  assert.deepEqual(combat, before);
});

test("choice validation rejects forged results, seed substitutions and unknown fields", () => {
  const plan = createBattleFormationPlan(mixed, policy()), choice = selectBattleFormation(plan, 1234);
  const otherPattern = choice.pattern === 1 ? 3 : 1;
  for (const forged of [null, { ...choice, pattern: otherPattern },
    { ...choice, formation: choice.formation === "normal" ? "opposed" : "normal" },
    { ...choice, seed: 1235 }, { ...choice, seed: null }, { ...choice, extra: true },
    { ...choice, plan: { kind: "fixed", patterns: mixed, pattern: choice.pattern } }])
    assert.throws(() => validateBattleFormationChoice(forged, choice.formation, 1234));
  assert.throws(() => validateBattleFormationChoice(choice, choice.formation, 1235), /seed/);
  assert.throws(() => validateBattleFormationChoice(choice, choice.formation === "normal" ? "opposed" : "normal", 1234));
  const fixed = selectBattleFormation(createBattleFormationPlan(normal));
  assert.throws(() => validateBattleFormationChoice({ ...fixed, seed: 0 }, "normal", 0));
  assert.throws(() => validateBattleFormationChoice(fixed, "normal", -1), /seed/);
  const zero = selectBattleFormation(plan, 0);
  assert.throws(() => validateBattleFormationChoice({ ...zero, seed: -0 }, zero.formation, 0), /seed/);
});
