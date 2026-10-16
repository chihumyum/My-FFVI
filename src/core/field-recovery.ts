import { BattleConditions } from "./battle-conditions.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { ownedConditionTargets, type OwnedConditionAppearanceStep, type OwnedConditionMember } from "./owned-condition.js";
import type { PartyPresentationPublication, PartyState } from "./party.js";
import { int32 } from "./script-integer.js";
import {projectFieldHpChange,validateFieldHpChangeCommand,type FieldHpChangeCommand} from './field-hp-changes.js';

export type FieldRecoveryCommand = {
  kind: "recover-hp" | "recover-mp";
  amount: number;
  /** ActionOnCharacter: current Corps (0), enabled roster (-1), status ID (>0). */
  target: number;
  allowUnableFight: boolean;
  allowMineralization: boolean;
};
export type FieldResourceCommand = FieldRecoveryCommand | FieldHpChangeCommand;
export type FieldRecoveryEventOp = {
  kind: "field-recovery";
  command: FieldResourceCommand;
  dependencies: { table: string; id: number }[];
};
export type FieldRecoveryTransaction = {
  targets: string[];
  steps: OwnedConditionAppearanceStep[];
  commit(): void;
  /** Publish prepared actor data and resources within the same owner fence. */
  commitWith(publish: () => void): void;
};
export type FieldRecoveryPort = {
  prepare(command: FieldResourceCommand): FieldRecoveryTransaction;
};
export type FieldRecoveryMember = OwnedConditionMember & {
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
};
export type FieldRecoveryProjection<T extends FieldRecoveryMember> = {
  roster: T[];
  targets: string[];
  steps: { targetId: string; roster: T[] }[];
};

export function validateFieldRecoveryCommand(command: FieldRecoveryCommand): void {
  checkpointKeys(command, "kind,amount,target,allowUnableFight,allowMineralization");
  if (command.kind !== "recover-hp" && command.kind !== "recover-mp")
    throw new Error("Unknown field recovery operation");
  if (int32(command.target) < -1)
    throw new Error("Unknown owned character status selector: " + command.target);
  if (int32(command.amount) === -0x80000000)
    throw new Error("Field recovery absolute amount overflow");
  if (typeof command.allowUnableFight !== "boolean" || typeof command.allowMineralization !== "boolean")
    throw new Error("Invalid field recovery condition flags");
}
export function validateFieldResourceCommand(command:FieldResourceCommand):void {
  if(command.kind==='subtract-hp'||command.kind==='revive-current-corps')validateFieldHpChangeCommand(command);
  else validateFieldRecoveryCommand(command);
}

function dense(values: readonly unknown[], label: string): void {
  if (!Array.isArray(values)) throw new Error("Invalid field recovery " + label);
  for (let i = 0; i < values.length; i++)
    if (!Object.hasOwn(values, i)) throw new Error("Sparse field recovery " + label);
}

/** CanRecovery reads condition types; it does not admit their active behavior.
 * Mineralization remains an identity-only query until its effects are ported. */
export function fieldRecoveryEligible(command: FieldRecoveryCommand, conditionTypes: readonly number[]): boolean {
  validateFieldRecoveryCommand(command);
  dense(conditionTypes, "condition types");
  for (const type of conditionTypes)
    if (int32(type) < 0) throw new Error("Invalid field recovery condition type");
  return (command.allowUnableFight || !conditionTypes.includes(5)) &&
    (command.allowMineralization || !conditionTypes.includes(11));
}

function validateMember(member: FieldRecoveryMember, conditions: BattleConditions): void {
  if (int32(member.maxHp) < 1 || int32(member.maxMp) < 0 ||
      int32(member.hp) < 0 || member.hp > member.maxHp ||
      int32(member.mp) < 0 || member.mp > member.maxMp)
    throw new Error("Invalid field recovery resources");
  dense(member.conditionIds, "condition identities");
  conditions.validateStableLife(member.hp, member.conditionIds);
}

function addClamped(current: number, amount: number, maximum: number): number {
  // This Web admission boundary rejects native signed-overflow cases instead
  // of guessing an abs(INT_MIN) or wrapping before the maximum comparison.
  const result = current + amount;
  if (result > 0x7fffffff) throw new Error("Field recovery resource addition overflow");
  return Math.min(result, maximum);
}

/** Owns no resource state. All selected owners are checked before projection;
 * no owner is created, enabled or moved by this instruction. The GameState
 * adapter also validates the complete resulting persistent snapshot. */
export function projectFieldRecovery<T extends FieldRecoveryMember>(
  roster: readonly T[], party: PartyState, command: FieldResourceCommand, conditions: BattleConditions,
): FieldRecoveryProjection<T> {
  if(command.kind==='subtract-hp'||command.kind==='revive-current-corps')
    return projectFieldHpChange(roster,party,command,conditions);
  validateFieldRecoveryCommand(command);
  dense(roster, "roster");
  const targets = ownedConditionTargets(roster, party, command.target);
  const byId = new Map(roster.map((member) => [member.id, member]));
  for (const id of targets) validateMember(byId.get(id)!, conditions);

  const candidates = new Map<string, T>();
  for (const id of targets) {
    const member = structuredClone(byId.get(id)!);
    const types = conditions.referenceTypes(member.conditionIds);
    const deathIds = new Set(member.conditionIds.filter((_, index) => types[index] === 5));
    if (fieldRecoveryEligible(command, types)) {
      const key = command.kind === "recover-hp" ? "hp" : "mp";
      const maximum = command.kind === "recover-hp" ? member.maxHp : member.maxMp;
      member[key] = addClamped(member[key], command.amount === 0 ? maximum : Math.abs(command.amount), maximum);
      if (command.kind === "recover-hp") {
        // The numeric setter and Character.RecoveryHp wrapper each execute
        // IfNeededDying. Keep both calls, including duplicate-record ordering.
        member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
        member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
      }
    }
    if (command.kind === "recover-hp" && command.allowUnableFight && deathIds.size) {
      // The delegate calls RemoveCondition(type=5, mc=null) independently of
      // CanRecovery. Remove all present rows, then add one HP once per owner.
      member.conditionIds = member.conditionIds.filter((conditionId) => !deathIds.has(conditionId));
      member.hp = addClamped(member.hp, 1, member.maxHp);
      member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
    }
    validateMember(member, conditions);
    candidates.set(id, member);
  }

  const next = structuredClone([...roster]);
  const indexes = new Map(next.map((member, index) => [member.id, index]));
  const steps: FieldRecoveryProjection<T>["steps"] = [];
  for (const targetId of targets) {
    next[indexes.get(targetId)!] = candidates.get(targetId)!;
    // RemoveCondition always Refresh(false) + AffectLeader, even when there
    // was no death record or CanRecovery skipped its numeric recovery.
    if (command.kind === "recover-hp" && command.allowUnableFight)
      steps.push({ targetId, roster: structuredClone(next) });
  }
  return { roster: next, targets, steps };
}

/** Prepare every actor step, then perform its last fallible validation while
 * the prior owned state remains live. The owner publishes resources last. */
export function executeFieldRecoveryEvent(
  op: FieldRecoveryEventOp, port: FieldRecoveryPort | undefined,
  preparePresentation?: (steps: readonly OwnedConditionAppearanceStep[]) => PartyPresentationPublication,
): void {
  if (op.kind !== "field-recovery") throw new Error("Invalid field recovery event");
  validateFieldResourceCommand(op.command);
  if (!port) throw new Error("Field recovery owned state is unavailable");
  const transaction = port.prepare(structuredClone(op.command));
  let publish: PartyPresentationPublication | undefined;
  if (transaction.steps.length) {
    if (!preparePresentation) throw new Error("Field recovery actor refresh is unavailable");
    publish = preparePresentation(structuredClone(transaction.steps));
    if (typeof publish !== "function") throw new Error("Invalid field recovery presentation transaction");
  }
  publish?.validate?.();
  transaction.commitWith(publish ?? (() => {}));
}
