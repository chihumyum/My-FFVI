import { isNonDamagingHit } from './non-damaging-ability.js';
import type { AbilityEffectResult } from './ability.js';

/** Native values are ConditionType selectors, never condition-master IDs. */
export const FINAL_ATTACK_EXCLUDED_TYPES = [5, 659, 660, 502] as const;
export function sourceFinalReady(input: { hp: number; conditionTypes: readonly number[];
  incomingInterrupt: boolean; primarySlot: number; effects: readonly AbilityEffectResult[] }): boolean {
  if (input.incomingInterrupt || input.hp !== 0 ||
      input.conditionTypes.some(type => (FINAL_ATTACK_EXCLUDED_TYPES as readonly number[]).includes(type))) return false;
  const first = input.effects[0];
  if (!first) throw new Error('Missing Final primary calculation');
  if (first.slot !== input.primarySlot) throw new Error('Unresolved Final primary calculation slot');
  if (first.resource === 'none') {
    if (!isNonDamagingHit(first) && (first.primaryResult !== 'empty-dictionary' || first.calcResult !== null))
      throw new Error('Invalid Final empty primary calculation');
    return isNonDamagingHit(first);
  }
  return !first.missed;
}

type Unit = { id: string; sourceId: number; side: 'player' | 'enemy' };
type Ticket<U extends Unit> = { id: number; unit: U; unitId: string; sourceId: number; parentAction: number; actions: number[]; targets: { action: number; units: U[] }[] };
/** Battle-local authority. Tickets are not serialized, supplied by content or
 * reconstructed from IDs. Actual object identity fences same-slot replacement.
 * The owning Battle frame snapshots this owner with resources/AI/queues/RNG. */
export class BattleFinalAttackTickets<U extends Unit> {
  #next = 1;
  #tickets: Ticket<U>[] = [];
  #retired = false;
  #prepared = new WeakSet<object>();
  snapshot() { return { next: this.#next, retired: this.#retired,
    tickets: this.#tickets.map(ticket => ({ ...ticket, actions: [...ticket.actions], targets: ticket.targets.map(target => ({ action: target.action, units: [...target.units] })) })) }; }
  restore(state: ReturnType<BattleFinalAttackTickets<U>['snapshot']>) {
    this.#prepared = new WeakSet<object>();
    this.#next = state.next; this.#retired = state.retired;
    this.#tickets = state.tickets.map(ticket => ({ ...ticket, actions: [...ticket.actions], targets: ticket.targets.map(target => ({ action: target.action, units: [...target.units] })) }));
  }
  prepare(unit: U, parentAction: number) {
    if (this.#retired || this.#next >= 0x7fffffff || typeof unit.id !== 'string' || !unit.id ||
        !Number.isInteger(unit.sourceId) || unit.sourceId < 1 || unit.side !== 'enemy' || !Number.isSafeInteger(parentAction) || parentAction < 1 || this.has(unit))
      throw new Error('Invalid Final death-ticket owner');
    const ticket = { id: this.#next++, unit, unitId: unit.id, sourceId: unit.sourceId, parentAction, actions: [], targets: [] } as Ticket<U>;
    this.#prepared.add(ticket); return ticket;
  }
  publish(ticket: Ticket<U>, actionTickets: readonly number[], targets: { action: number; units: U[] }[] = []) {
    if (this.#retired || !this.#prepared.has(ticket) || this.has(ticket.unit) || ticket.unit.id !== ticket.unitId ||
        ticket.unit.sourceId !== ticket.sourceId || !actionTickets.length ||
        actionTickets.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(actionTickets).size !== actionTickets.length)
      throw new Error('Invalid Final queue publication');
    this.#prepared.delete(ticket);
    this.#tickets.push({ ...ticket, actions: [...actionTickets], targets: targets.map(target => ({ action: target.action, units: [...target.units] })) });
  }
  has(unit: U) { return !this.#retired && this.#tickets.some(ticket => ticket.unit === unit &&
    ticket.unitId === unit.id && ticket.sourceId === unit.sourceId && ticket.actions.length > 0); }
  owns(unit: U, actionTicket: number | undefined) { return !this.#retired && this.#tickets.some(ticket =>
    ticket.unit === unit && ticket.unitId === unit.id && ticket.sourceId === unit.sourceId &&
    actionTicket !== undefined && ticket.actions.includes(actionTicket)); }
  complete(actionTicket: number | undefined) {
    for (const ticket of this.#tickets) {
      ticket.actions = ticket.actions.filter(id => id !== actionTicket);
      ticket.targets = ticket.targets.filter(target => target.action !== actionTicket);
    }
    this.#tickets = this.#tickets.filter(ticket => ticket.actions.length);
  }
  targetsCurrent(action: number | undefined, units: readonly U[]) {
    const ticket = this.#tickets.find(ticket => action !== undefined && ticket.actions.includes(action));
    const captured = ticket?.targets.find(target => target.action === action);
    return !!captured && captured.units.length > 0 && captured.units.every(target => units.includes(target));
  }
  cancelReferences(unit: U) {
    this.#tickets = this.#tickets.filter(ticket => ticket.unit !== unit);
    for (const ticket of this.#tickets) {
      const cancelled = ticket.targets.filter(target => target.units.includes(unit)).map(target => target.action);
      ticket.actions = ticket.actions.filter(action => !cancelled.includes(action));
      ticket.targets = ticket.targets.filter(target => !cancelled.includes(target.action));
    }
    this.#tickets = this.#tickets.filter(ticket => ticket.actions.length);
  }
  cancel(unit: U) { this.#tickets = this.#tickets.filter(ticket => ticket.unit !== unit); }
  cancelAll() { this.#tickets = []; this.#prepared = new WeakSet<object>(); }
  retire() { this.cancelAll(); this.#retired = true; }
  get projection() { return this.#tickets.map(ticket => ({ id: ticket.id, unitId: ticket.unitId,
    sourceId: ticket.sourceId, parentAction: ticket.parentAction, actions: [...ticket.actions], targets: ticket.targets.map(target => ({ action: target.action, unitIds: target.units.map(unit => unit.id) })) })); }
}
