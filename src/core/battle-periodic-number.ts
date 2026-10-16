import { canonical } from './canonical.js';
export const WEB_BATTLE_PERIODIC_NUMBERS = 'web-source-periodic-numbers-2d-v1' as const;
/** Explicit Web presentation duration; no native particle/timing parity claim. */
export const WEB_PERIODIC_NUMBER_MILLISECONDS = 400;
export type PeriodicNumberConsumption = 'drawn' | 'controlled-request-consumed';
export type BattlePeriodicNumberRequest = { ticket: number; epoch: number; unitId: string; conditionId: number; amount: number };
export type BattlePeriodicNumberLease = {
  validate(): void; commit(): void; discard(): void;
  consumption(): PeriodicNumberConsumption | null;
  acknowledge(evidence: PeriodicNumberConsumption): void;
};
export type BattlePeriodicNumberHost = { policy: typeof WEB_BATTLE_PERIODIC_NUMBERS;
  prepare(request: Readonly<BattlePeriodicNumberRequest>): BattlePeriodicNumberLease };
export type BattlePeriodicNumberProjection = BattlePeriodicNumberRequest & {
  elapsed: number; duration: number; consumption: PeriodicNumberConsumption | null;
};
export function validatePeriodicNumberHost(host: BattlePeriodicNumberHost | undefined): void {
  if (host !== undefined && (!host || Object.keys(host).sort().join(',') !== 'policy,prepare' ||
      host.policy !== WEB_BATTLE_PERIODIC_NUMBERS || typeof host.prepare !== 'function')) throw Error('Unknown periodic number host');
}
function createHost(controlled: boolean, consumed?: (request: Readonly<BattlePeriodicNumberRequest>) => void): BattlePeriodicNumberHost {
  return { policy: WEB_BATTLE_PERIODIC_NUMBERS, prepare(request) {
    if (!request || Object.keys(request).sort().join(',') !== 'amount,conditionId,epoch,ticket,unitId' ||
      ![request.ticket, request.epoch, request.conditionId, request.amount].every(n => Number.isSafeInteger(n) && n > 0) ||
      typeof request.unitId !== 'string' || !request.unitId) throw Error('Invalid actual periodic number request');
    const original = canonical(request); let committed = false, retired = false, evidence: PeriodicNumberConsumption | null = null;
    const validate = () => { if (retired || canonical(request) !== original) throw Error('Stale periodic number resource'); };
    return { validate, commit() { validate(); if (committed) throw Error('Repeated periodic number commit');
      if (controlled) { if (!consumed) throw Error('Missing controlled periodic number consumer'); consumed(Object.freeze({ ...request })); evidence = 'controlled-request-consumed'; }
      committed = true;
    }, consumption() { validate(); return evidence; }, acknowledge(value) { validate();
      if (!committed || value !== 'drawn' || controlled) throw Error('Wrong periodic number consumption evidence'); evidence = value;
    }, discard() { retired = true; } };
  } };
}
/** Production requires actual BattleView drawing before its clock can drain. */
export function createWebBattlePeriodicNumberHost(): BattlePeriodicNumberHost { return createHost(false); }
/** Controlled replay records each actual request; this is explicitly no pixels.
 * BattleGame still owns the same 400ms post-consumption clock. */
export function createControlledBattlePeriodicNumberHost(consume: (request: Readonly<BattlePeriodicNumberRequest>) => void): BattlePeriodicNumberHost {
  if (typeof consume !== 'function') throw Error('Missing controlled periodic number consumer');
  return createHost(true, consume);
}
