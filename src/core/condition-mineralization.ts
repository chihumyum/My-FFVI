/** A Web scheduling policy for the recovered source behavior. Start has no
 * HP write in FF6 (SystemConfigData.GetSerialType returns 6). The shared
 * ActEndUpdate/DownStart body writes zero HP only for enemy units. The existing
 * action presentation ends before this boundary; it is not native animation
 * callback timing or a second condition/resource owner. */
export const WEB_MINERALIZATION_PHASES = 'web-source-mineralization-action-down-boundary-v1' as const;
export type MineralizationBehavior = {
  id: number; kind: 'mineralization'; name: string; untilType: 3;
  phasePolicy: typeof WEB_MINERALIZATION_PHASES;
};
export function validateMineralizationBehavior(value: MineralizationBehavior): void {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || value.id > 0x7fffffff ||
      value.kind !== 'mineralization' || typeof value.name !== 'string' || !value.name ||
      value.untilType !== 3 || value.phasePolicy !== WEB_MINERALIZATION_PHASES)
    throw new Error('Unresolved Mineralization lifecycle/scheduling policy');
}

/** The caller owns the current active list, actual faction and phase. Positive
 * player HP is deliberately preserved. Do not use this projection at Start,
 * for hit/target eligibility, or to manufacture an UnableFight identity. */
export function mineralizationBoundaryHp(side: 'player' | 'enemy', hp: number, active: boolean): number {
  if (!['player', 'enemy'].includes(side) || !Number.isInteger(hp) || hp < 0 || hp > 0x7fffffff || typeof active !== 'boolean')
    throw new Error('Invalid Mineralization phase owner');
  return active && side === 'enemy' ? 0 : hp;
}
