/** Function19 is not a missing result. NonFunction.Calc asks GetFixedStatus(Hit)
 * and its UpdateParameter body returns. Keep that result distinct from the
 * FF6 Unique empty dictionary, zero HP damage and a status application. */
export type NonDamagingAbilityEffect = {
  kind: "non-damaging";
  slot: number;
  calculation: "fixed-status-hit";
  parameterUpdate: "none";
};
export type NonDamagingAbilityResult = {
  slot: number;
  resource: "none";
  primaryResult: "fixed-status-hit";
  calcResult: { value: 0; hitType: 0; hitCount: 0; conditions: null; recovery: false };
  missed: false;
};
export const WEB_NON_DAMAGING_PRESENTATION = "web-source-non-damaging-effect-deferred-v1" as const;
export type NonDamagingAbilityPresentation = {
  kind: typeof WEB_NON_DAMAGING_PRESENTATION;
  /** Exact Ability.BattleEffectAssetId. Zero is an explicit source absence. */
  effectAssetId: number;
  sourceEffect: { assetName: string; positionType: number; displayType: number; soundAssetIds: [number, number, number] } | null;
  originalEffect: "deferred";
  actionClock: "existing-web-action-stages";
};
export function validateNonDamagingEffect(value: NonDamagingAbilityEffect): void {
  if (value.kind !== "non-damaging" || !Number.isInteger(value.slot) || value.slot < 1 || value.slot > 3 ||
      value.calculation !== "fixed-status-hit" || value.parameterUpdate !== "none")
    throw new Error("Invalid non-damaging ability effect");
}
export function projectNonDamagingEffect(value: NonDamagingAbilityEffect): NonDamagingAbilityResult {
  validateNonDamagingEffect(value);
  return { slot: value.slot, resource: "none", primaryResult: "fixed-status-hit",
    calcResult: { value: 0, hitType: 0, hitCount: 0, conditions: null, recovery: false }, missed: false };
}
export function validateNonDamagingPresentation(value: NonDamagingAbilityPresentation): void {
  if (value.kind !== WEB_NON_DAMAGING_PRESENTATION || !Number.isInteger(value.effectAssetId) ||
      value.effectAssetId < 0 || value.effectAssetId > 0x7fffffff || value.originalEffect !== "deferred" ||
      value.actionClock !== "existing-web-action-stages")
    throw new Error("Unresolved source non-damaging presentation policy");
  const effect = value.sourceEffect;
  if ((value.effectAssetId === 0) !== (effect === null) || effect !== null &&
      (typeof effect.assetName !== "string" || !effect.assetName || effect.assetName === "None" ||
       ![effect.positionType, effect.displayType, ...effect.soundAssetIds].every(v => Number.isInteger(v) && v >= 0 && v <= 0x7fffffff) ||
       !Array.isArray(effect.soundAssetIds) || effect.soundAssetIds.length !== 3))
    throw new Error("Unbound source non-damaging effect metadata");
}
export function isNonDamagingHit(value: unknown): value is NonDamagingAbilityResult {
  if (value === null || typeof value !== "object") return false;
  const effect = value as NonDamagingAbilityResult;
  if (effect.resource !== "none" || effect.primaryResult !== "fixed-status-hit") return false;
  const calc = effect.calcResult;
  if (!Number.isInteger(effect.slot) || effect.slot < 1 || effect.slot > 3 || effect.missed !== false ||
      !calc || calc.value !== 0 || calc.hitType !== 0 || calc.hitCount !== 0 || calc.conditions !== null || calc.recovery !== false)
    throw new Error("Invalid non-damaging fixed Hit result");
  return true;
}
