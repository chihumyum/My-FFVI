/** Ordinary source victory rewards. AP is a separate, unimplemented provider;
 * magicPoints is MonsterParty.GetValue, not current MP or an ability identity. */
export type BattleRewardPolicy = {
  kind: "battle-reward-policy-v1";
  ap: 0;
  magicPoints: number;
};

/** BattleResultProvider..ctor 0x3d58b0 initializes the field at +0x10 to 0x80. */
export const MAX_MAGIC_LEARNING_VALUE = 128;

const INT32_MAX = 0x7fffffff;

function integer(raw: unknown, maximum: number, label: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || Object.is(raw, -0) ||
      raw < 0 || raw > maximum)
    throw new Error(`Invalid ${label}`);
  return raw;
}

/** Strict content decoding. A policy does not grant actor eligibility, bypass
 * battle flags or authorize magic-stone/equipment/background learning. */
export function parseBattleRewardPolicy(raw: unknown): BattleRewardPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error("Invalid battle reward policy object");
  const keys = ["kind", "ap", "magicPoints"];
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.length !== keys.length ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key)) ||
      keys.some(key => {
        const property = Object.getOwnPropertyDescriptor(raw, key);
        return !property?.enumerable || !("value" in property);
      }))
    throw new Error("Invalid battle reward policy fields");
  const value = raw as Record<string, unknown>;
  if (value.kind !== "battle-reward-policy-v1")
    throw new Error("Invalid battle reward policy kind");
  const ap = integer(value.ap, INT32_MAX, "battle reward AP");
  if (ap !== 0) throw new Error("Nonzero AP reward provider is not implemented");
  return { kind: "battle-reward-policy-v1", ap: 0,
    magicPoints: integer(value.magicPoints, INT32_MAX, "battle reward magic points") };
}

/** Pure ordinary-victory projection. Genelate 0x3d51a0 gives each IsGetExp
 * member the full party MagicPoint amount before StatusUp, with cap 128;
 * ineligible members keep their value. The caller owns qualification and the
 * remaining growth/learning transaction. This does not consume or restore MP. */
export function projectMagicLearningValue(
  current: number,
  magicPoints: number,
  eligible: boolean,
): number {
  const value = integer(current, MAX_MAGIC_LEARNING_VALUE, "owned magic learning value");
  const reward = integer(magicPoints, INT32_MAX, "battle reward magic points");
  if (typeof eligible !== "boolean") throw new Error("Invalid magic learning reward eligibility");
  return eligible ? Math.min(MAX_MAGIC_LEARNING_VALUE, value + reward) : value;
}

const unsupportedRewardFlags: Readonly<Record<number, string>> = {
  3: "NoResultNoSave",
  9: "NoSaveItem",
  10: "NoFanfareNoResult",
  11: "NoExp",
  12: "NoGil",
  13: "OnlyExpGilbart",
};

/** Entry Start captures this flag list. Current child metadata never replaces it.
 * Unknown result providers remain explicit even when reward numbers are zero. */
export function assertBattleRewardFlags(flags:readonly number[]):void {
  if (!Array.isArray(flags) || Reflect.ownKeys(flags).length !== flags.length + 1)
    throw new Error("Invalid source battle reward flag list");
  for (let index = 0; index < flags.length; index++) {
    const property = Object.getOwnPropertyDescriptor(flags, index);
    const flag: unknown = property && "value" in property ? property.value : undefined;
    if (!property?.enumerable || typeof flag !== "number" || !Number.isInteger(flag) || flag < 1 || flag > 27)
      throw new Error("Unknown or invalid source battle reward flag");
    if (unsupportedRewardFlags[flag])
      throw new Error(`Battle reward flag ${flag} (${unsupportedRewardFlags[flag]}) requires an unimplemented result provider`);
  }
}
