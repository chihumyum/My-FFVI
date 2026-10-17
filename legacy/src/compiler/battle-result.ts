import { assertBattleRewardFlags, parseBattleRewardPolicy, type BattleRewardPolicy } from "../core/battle-result.js";

export type BattleRewardSource = {
  getAp: number;
  getValue: number;
  battleFlags: readonly number[];
};

/** Compile the two distinct MonsterParty reward fields. The real flag list is
 * mandatory: development omissions are not reward permission. Other known
 * flag lifecycles, Colosseum and per-character learning remain runtime gates. */
export function compileBattleRewardPolicy(source: BattleRewardSource): BattleRewardPolicy {
  const policy = parseBattleRewardPolicy({ kind: "battle-reward-policy-v1",
    ap: source.getAp, magicPoints: source.getValue });
  assertBattleRewardFlags(source.battleFlags);
  return policy;
}
