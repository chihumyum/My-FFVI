/** Native condition type, distinct from its master-row identity. */
export const blindConditionType = 9;

export type BlindBehavior = {
  id: number;
  kind: "blind";
  name: string;
  untilType: 3;
  effectAssetId: number;
  iconId: number;
};

function integer(value: number, minimum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid Blind " + label);
}

export function validateBlindBehavior(behavior: BlindBehavior): void {
  integer(behavior.id, 1, "condition identity");
  integer(behavior.effectAssetId, 1, "effect identity");
  integer(behavior.iconId, 1, "icon identity");
  if (behavior.kind !== "blind" || behavior.untilType !== 3 ||
      typeof behavior.name !== "string" || !behavior.name)
    throw new Error("Invalid Blind condition behavior");
}

/** PhysicalExecution 0xa97b20: the selected accuracy is capped at 255 before
 * ordinary Blind halves it with integer division. Content flag 1 is applied
 * later and overrides the penalty. Special weapons/processes that bypass the
 * Blind check are outside this ordinary physical domain, not inferred here. */
export function physicalAccuracyWithBlind(
  accuracy: number,
  actorConditionTypes: readonly number[],
  guaranteedHit: boolean,
): number {
  integer(accuracy, 0, "physical accuracy");
  if (!Array.isArray(actorConditionTypes))
    throw new Error("Missing physical actor condition types");
  for (const type of actorConditionTypes) integer(type, 0, "actor condition type");
  if (typeof guaranteedHit !== "boolean") throw new Error("Invalid guaranteed hit flag");
  let value = Math.min(255, accuracy);
  if (actorConditionTypes.includes(blindConditionType)) value = Math.trunc(value / 2);
  return guaranteedHit ? 255 : value;
}

/** Blind.Update 0x76f880 only changes visibility for FF6 player effects after
 * their asset loads. Two independent Confusion signals are consulted. When
 * they disagree native retains the previous visibility. This pure lifecycle
 * contract does not substitute a sprite for the unported particle system. */
export function projectBlindEffectVisible(input: {
  serialType: number;
  isPlayer: boolean;
  assetLoaded: boolean;
  effectPresent: boolean;
  active: boolean;
  isConfusion: boolean;
  hasConfusionBehavior: boolean;
}): boolean {
  integer(input.serialType, 0, "serial type");
  for (const value of [input.isPlayer, input.assetLoaded, input.effectPresent,
    input.active, input.isConfusion, input.hasConfusionBehavior])
    if (typeof value !== "boolean") throw new Error("Invalid Blind effect context");
  if (input.serialType !== 6 || !input.isPlayer || !input.assetLoaded || !input.effectPresent)
    return input.active;
  if (input.active && input.isConfusion && input.hasConfusionBehavior) return false;
  if (!input.active && !input.isConfusion && !input.hasConfusionBehavior) return true;
  return input.active;
}
