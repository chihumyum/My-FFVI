import { ConditionRules, type ConditionCatalog } from "./conditions.js";
import { accuracyHit } from "./battle-hit.js";

/** Only behavior functions whose state dependencies are implemented are admitted.
 * The full master catalog remains available for references and conflict rules. */
export type BattleConditionCatalog = {
  rules: ConditionCatalog;
  /** Identity passed by the source HP controller, distinct from condition type. */
  hpZeroConditionId: number;
  dying: { conditionId: number; thresholdDivisor: number };
  behaviors: (
    | { id: number; kind: "silence"; name: string; untilType: 2 }
    | { id: number; kind: "unable-fight"; name: string; untilType: 3 }
    | { id: number; kind: "dying"; name: string; untilType: 3 }
  )[];
};
export type ConditionChange = {
  currentIds: number[];
  added: number[];
  removed: number[];
  missed: boolean;
};

/** IsSelectableCommand uses row IDs from BOTH lists, not condition types.
 * This predicate says nothing about ownership, MP, targeting or unlocks. */
export function conditionsAllowAction(
  currentIds: readonly number[],
  abilityForbiddenIds: readonly number[],
  commandForbiddenIds: readonly number[],
): boolean {
  return ![...abilityForbiddenIds, ...commandForbiddenIds].some((id) =>
    currentIds.includes(id),
  );
}

/** CalcExecuteFF6.AddConditionExection 0xa91a90, without content flags.
 * Evasion is ConfirmedAbilityEvasionRate(true), in native units, NOT percent.
 * The provided draw is inclusive; this does not reproduce Unity's PRNG state. */
export function conditionHit(
  accuracy: number,
  magicEvasion: number,
  randomInt: (min: number, max: number) => number,
): boolean {
  return accuracyHit(accuracy, magicEvasion, randomInt);
}

/** Bounded battle behavior, not a general status engine. Silence has no periodic
 * numerical update; source command/ability restrictions supply its gameplay effect.
 * Equipment conditions, undead overrides and other behaviors remain blocked. */
export class BattleConditions {
  private readonly rules: ConditionRules;
  private readonly definitions;
  private readonly behaviors;
  private readonly hpZeroConditionId;
  private readonly dying;
  constructor(catalog: BattleConditionCatalog) {
    this.rules = new ConditionRules(catalog.rules);
    this.definitions = new Map(
      catalog.rules.definitions.map((d) => [d.id, { ...d }]),
    );
    this.behaviors = new Map(catalog.behaviors.map((b) => [b.id, { ...b }]));
    this.hpZeroConditionId = catalog.hpZeroConditionId;
    this.dying = { ...catalog.dying };
    if (this.behaviors.size !== catalog.behaviors.length)
      throw new Error("Duplicate battle condition behavior");
    for (const b of this.behaviors.values()) {
      if (
        !b.name ||
        !(b.kind === "silence"
          ? b.untilType === 2 && this.definitions.get(b.id)?.type === 6
          : b.untilType === 3 &&
            ((b.kind === "unable-fight" &&
              this.definitions.get(b.id)?.type === 5) ||
              (b.kind === "dying" && this.definitions.get(b.id)?.type === 4)))
      )
        throw new Error("Unsupported battle condition behavior");
    }
    if (this.behaviors.get(this.hpZeroConditionId)?.kind !== "unable-fight")
      throw new Error("Missing HP-zero condition identity");
    if (
      this.behaviors.get(this.dying.conditionId)?.kind !== "dying" ||
      !Number.isInteger(this.dying.thresholdDivisor) ||
      this.dying.thresholdDivisor < 1
    )
      throw new Error("Invalid dying condition dependency");
  }
  validateReferences(ids: readonly number[]) {
    for (const id of ids)
      if (!this.definitions.has(id))
        throw new Error("Unknown battle condition identity: " + id);
  }
  validateActive(ids: readonly number[]) {
    this.validateReferences(ids);
    for (const id of ids)
      if (!this.behaviors.has(id))
        throw new Error("Unimplemented active battle condition: " + id);
  }
  validateResistances(resistances: Record<string, number>) {
    for (const id of Object.keys(resistances))
      if (String(Number(id)) !== id)
        throw new Error("Noncanonical resistance identity");
    this.validateReferences(Object.keys(resistances).map(Number));
    for (const value of Object.values(resistances))
      if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff)
        throw new Error("Invalid condition resistance selector");
  }
  name(id: number) {
    this.validateActive([id]);
    return this.behaviors.get(id)!.name;
  }
  isUnableFight(ids: readonly number[]) {
    this.validateActive(ids);
    return ids.some((id) => this.behaviors.get(id)!.kind === "unable-fight");
  }
  /** IfNeededDying 0x7680e0: no-op at zero HP, otherwise float32 ratio,
   * add missing source row or remove one occurrence. No conflict pass here. */
  updateDying(hp: number, maxHp: number, currentIds: readonly number[]) {
    this.validateActive(currentIds);
    if (
      !Number.isInteger(hp) ||
      !Number.isInteger(maxHp) ||
      hp < 0 ||
      maxHp < 1 ||
      hp > maxHp ||
      maxHp > 0x7fffffff
    )
      throw new Error("Invalid dying HP");
    const result = [...currentIds];
    if (hp === 0) return result;
    const index = result.indexOf(this.dying.conditionId);
    if (
      Math.fround(Math.fround(hp) / Math.fround(maxHp)) <=
      Math.fround(1 / Math.fround(this.dying.thresholdDivisor))
    ) {
      if (index < 0) result.push(this.dying.conditionId);
    } else if (index >= 0) result.splice(index, 1);
    return result;
  }
  /** HP controller 0x459980 -> InterruptAddCondition(5); behavior Start/Remove
   * 0x5282a0/0x527eb0. Run once after an action's effect updates, before outcome.
   * Only admitted non-undead, non-permanent conditions are represented here. */
  settleLife(
    hp: number,
    currentIds: readonly number[],
    wasUnableFight: boolean,
  ) {
    if (!Number.isInteger(hp) || hp < 0 || hp > 0x7fffffff)
      throw new Error("Invalid life HP");
    let conditionIds = [...currentIds];
    if (this.isUnableFight(conditionIds)) return { hp: 0, conditionIds };
    // Remove restores 1 only when recovery left HP exactly zero.
    if (wasUnableFight && hp === 0) hp = 1;
    if (hp === 0) {
      conditionIds = this.rules.resolveConflict({
        currentIds: [...conditionIds, this.hpZeroConditionId],
        equipmentIds: [],
        incomingId: this.hpZeroConditionId,
      }).currentIds;
      this.validateActive(conditionIds);
      if (!this.isUnableFight(conditionIds))
        throw new Error("Unsupported HP-zero condition conflict");
    }
    return { hp, conditionIds };
  }
  add(
    currentIds: readonly number[],
    resistances: Record<string, number>,
    incomingId: number,
    hit: { accuracy: number; magicEvasion: number; fixed: boolean },
    randomInt: (min: number, max: number) => number,
  ): ConditionChange {
    this.validateActive(currentIds);
    this.validateActive([incomingId]);
    this.validateResistances(resistances);
    const miss = {
      currentIds: [...currentIds],
      added: [],
      removed: [],
      missed: true,
    };
    // AddConditionFunction prechecks value 1; normal CalcController also checks
    // dictionary key presence. Fixed-hit Value2=1 bypasses the latter provider.
    if (
      !this.rules.isAddable(currentIds, incomingId) ||
      (hit.fixed
        ? resistances[incomingId] === 1
        : Object.hasOwn(resistances, incomingId))
    )
      return miss;
    if (!hit.fixed && !conditionHit(hit.accuracy, hit.magicEvasion, randomInt))
      return miss;
    const result = this.rules.resolveConflict({
      currentIds: [...currentIds, incomingId],
      equipmentIds: [],
      incomingId,
    });
    this.validateActive(result.currentIds);
    return {
      currentIds: result.currentIds,
      added: [incomingId],
      removed: result.removed.map((r) => r.id),
      missed: false,
    };
  }
  recover(
    currentIds: readonly number[],
    recoveryIds: readonly number[],
  ): ConditionChange {
    this.validateActive(currentIds);
    this.validateReferences(recoveryIds);
    const next = [...currentIds],
      removed: number[] = [];
    // RecoveryCondition[Multi]Function removes ONE record per requested ID.
    for (const id of recoveryIds) {
      const index = next.indexOf(id);
      if (index < 0) continue;
      next.splice(index, 1);
      removed.push(id);
    }
    return {
      currentIds: next,
      added: [],
      removed,
      missed: removed.length === 0,
    };
  }
  battleEnd(currentIds: readonly number[]): number[] {
    this.validateActive(currentIds);
    // Controller retains until types 3 and 19; death/dying persist into the field.
    return currentIds.filter((id) => this.behaviors.get(id)!.untilType === 3);
  }
}
