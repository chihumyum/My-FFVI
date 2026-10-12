import { parseBattleRewardPolicy, type BattleRewardPolicy } from "../core/battle-result.js";

export type BattleRewardSource = {
  getAp: number;
  getValue: number;
  battleFlags: readonly number[];
};

const unsupportedRewardFlags: Readonly<Record<number, string>> = {
  3: "NoResultNoSave",
  9: "NoSaveItem",
  10: "NoFanfareNoResult",
  11: "NoExp",
  12: "NoGil",
  13: "OnlyExpGilbart",
};

/** Compile the two distinct MonsterParty reward fields. The real flag list is
 * mandatory: development omissions are not reward permission. Other known
 * flag lifecycles, Colosseum and per-character learning remain runtime gates. */
export function compileBattleRewardPolicy(source: BattleRewardSource): BattleRewardPolicy {
  const policy = parseBattleRewardPolicy({ kind: "battle-reward-policy-v1",
    ap: source.getAp, magicPoints: source.getValue });
  const flags = source.battleFlags;
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
  return policy;
}
