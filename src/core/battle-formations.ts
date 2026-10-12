/** Source monster_party battle_pattern1..6 eligibility, in source column order.
 * The columns are not enum indices or random weights. */
export type BattleFormationPatterns = [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1];

/** Authored Web selection rules. Only the currently supported source columns
 * 1 and 3 may receive weight; this is not the native formation algorithm. */
export type FrameworkBattleFormationPolicy = {
  kind: "framework-battle-formations-v1";
  id: string;
  weights: [number, number, number, number, number, number];
};

export type BattleFormationPlan =
  | { kind: "fixed"; patterns: BattleFormationPatterns; pattern: 1 | 3 }
  | { kind: "development"; patterns: BattleFormationPatterns; policy: FrameworkBattleFormationPolicy };

export type BattleFormationChoice = {
  plan: BattleFormationPlan;
  pattern: 1 | 3;
  formation: "normal" | "opposed";
  /** Original battle seed, not the derived selection stream. Fixed plans use
   * no randomness and therefore always retain null. */
  seed: number | null;
};

const UINT32_MAX = 0xffffffff;
const UINT32_SIZE = 0x100000000;
// ASCII FORM. This domain is part of the versioned development protocol.
const FORMATION_DOMAIN = 0x464f524d;

function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error(`Invalid ${label} object`);
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
      keys.some((key) => !Object.getOwnPropertyDescriptor(raw, key)?.enumerable ||
        !("value" in Object.getOwnPropertyDescriptor(raw, key)!)))
    throw new Error(`Invalid ${label} fields`);
  return raw as Record<string, unknown>;
}

function integer(raw: unknown, maximum: number, label: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || Object.is(raw, -0) || raw < 0 || raw > maximum)
    throw new Error(`Invalid ${label}`);
  return raw;
}

function sixIntegers(raw: unknown, maximum: number, label: string): FrameworkBattleFormationPolicy["weights"] {
  if (!Array.isArray(raw) || raw.length !== 6 || Reflect.ownKeys(raw).length !== 7)
    throw new Error(`Invalid ${label}: expected six integers`);
  const result: number[] = [];
  for (let index = 0; index < 6; index++) {
    const property = Object.getOwnPropertyDescriptor(raw, index);
    if (!property?.enumerable || !("value" in property)) throw new Error(`Invalid ${label} array`);
    result.push(integer(property.value, maximum, `${label}[${index}]`));
  }
  return result as FrameworkBattleFormationPolicy["weights"];
}

function parsePatterns(raw: unknown): BattleFormationPatterns {
  const result = sixIntegers(raw, 1, "source battle formation patterns") as BattleFormationPatterns;
  if (!result.some((bit) => bit === 1)) throw new Error("Source battle formation eligibility is empty");
  return result;
}

function parsePolicy(raw: unknown): FrameworkBattleFormationPolicy {
  const value = record(raw, ["kind", "id", "weights"], "development battle formation policy");
  if (value.kind !== "framework-battle-formations-v1" || typeof value.id !== "string" ||
      !value.id.length || value.id.trim() !== value.id)
    throw new Error("Invalid development battle formation policy identity");
  const weights = sixIntegers(value.weights, UINT32_MAX, "development battle formation weights");
  if ([1, 3, 4, 5].some((index) => weights[index] !== 0))
    throw new Error("Unsupported positive battle formation weight: only source columns 1 and 3 are implemented");
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0 || total > UINT32_MAX) throw new Error("Invalid development battle formation total weight");
  return { kind: value.kind, id: value.id, weights };
}

/** Importing eligibility never chooses a random formation. A development
 * author may explicitly restrict it to a supported subset, but the complete
 * source mask and authored weights remain in the resulting plan. */
export function createBattleFormationPlan(
  rawPatterns: BattleFormationPatterns,
  rawPolicy?: FrameworkBattleFormationPolicy,
): BattleFormationPlan {
  const patterns = parsePatterns(rawPatterns);
  if (rawPolicy === undefined) {
    const enabled = patterns.flatMap((bit, index) => bit ? [index + 1] : []);
    if (enabled.length !== 1 || (enabled[0] !== 1 && enabled[0] !== 3))
      throw new Error("Battle formation selection requires an explicit development policy for these source patterns");
    return { kind: "fixed", patterns, pattern: enabled[0] };
  }
  const policy = parsePolicy(rawPolicy);
  if (!patterns.some((bit, index) => bit === 1 && policy.weights[index]! > 0))
    throw new Error("Development battle formation policy has no intersection with source eligibility");
  return { kind: "development", patterns, policy };
}

/** Strict content/checkpoint decoding; never trusts the saved choice of kind or
 * a preselected pattern to bypass source eligibility. Returns detached data. */
export function parseBattleFormationPlan(raw: unknown): BattleFormationPlan {
  const kind = raw !== null && typeof raw === "object"
    ? Object.getOwnPropertyDescriptor(raw, "kind")?.value : undefined;
  if (kind === "fixed") {
    const value = record(raw, ["kind", "patterns", "pattern"], "fixed battle formation plan");
    const result = createBattleFormationPlan(parsePatterns(value.patterns));
    if (result.kind !== "fixed" || value.pattern !== result.pattern)
      throw new Error("Fixed battle formation pattern disagrees with source eligibility");
    return result;
  }
  if (kind === "development") {
    const value = record(raw, ["kind", "patterns", "policy"], "development battle formation plan");
    return createBattleFormationPlan(parsePatterns(value.patterns), parsePolicy(value.policy));
  }
  throw new Error("Invalid battle formation plan kind");
}

/** Pure, domain-separated Web selection. The private full-period uint32 LCG
 * uses rejection sampling instead of biased modulo reduction. It consumes no
 * combat RNG and is not a reconstruction of native GetRandWeight. */
export function selectBattleFormation(rawPlan: BattleFormationPlan, seed?: number): BattleFormationChoice {
  const plan = parseBattleFormationPlan(rawPlan);
  if (plan.kind === "fixed") return { plan, pattern: plan.pattern,
    formation: plan.pattern === 1 ? "normal" : "opposed", seed: null };
  const battleSeed = integer(seed, UINT32_MAX, "development battle formation seed");
  const weights = plan.policy.weights.map((weight, index) => plan.patterns[index] === 1 ? weight : 0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const limit = UINT32_SIZE - UINT32_SIZE % total;
  let random = (battleSeed ^ FORMATION_DOMAIN) >>> 0;
  do { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; } while (random >= limit);
  const pattern = random % total < weights[0]! ? 1 : 3;
  return { plan, pattern, formation: pattern === 1 ? "normal" : "opposed", seed: battleSeed };
}

/** Verifies a carried selection against the actual battle seed and selected
 * runtime formation. The caller separately binds choice.plan to trusted content. */
export function validateBattleFormationChoice(
  raw: unknown,
  formation: "normal" | "opposed",
  seed: number,
): void {
  const battleSeed = integer(seed, UINT32_MAX, "battle seed");
  const value = record(raw, ["plan", "pattern", "formation", "seed"], "battle formation choice");
  const expected = selectBattleFormation(parseBattleFormationPlan(value.plan), battleSeed);
  if (expected.seed !== null) integer(value.seed, UINT32_MAX, "battle formation choice seed");
  if (value.pattern !== expected.pattern || value.formation !== expected.formation ||
      value.seed !== expected.seed || formation !== expected.formation)
    throw new Error("Battle formation choice disagrees with its plan, formation or battle seed");
}
