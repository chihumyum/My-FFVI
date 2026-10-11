import { ConditionRules, type ConditionCatalog } from "./conditions.js";
import { accuracyHit } from "./battle-hit.js";

/** Only behavior functions whose state dependencies are implemented are admitted.
 * The full master catalog remains available for references and conflict rules. */
export type BattleConditionCatalog = {
  rules: ConditionCatalog;
  behaviors: { id: number; kind: "silence"; name: string; untilType: 2 }[];
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
 * Equipment conditions, death/undead overrides and other behaviors remain blocked. */
export class BattleConditions {
  private readonly rules: ConditionRules;
  private readonly definitions;
  private readonly behaviors;
  constructor(catalog: BattleConditionCatalog) {
    this.rules = new ConditionRules(catalog.rules);
    this.definitions = new Map(
      catalog.rules.definitions.map((d) => [d.id, { ...d }]),
    );
    this.behaviors = new Map(catalog.behaviors.map((b) => [b.id, { ...b }]));
    if (this.behaviors.size !== catalog.behaviors.length)
      throw new Error("Duplicate battle condition behavior");
    for (const b of this.behaviors.values()) {
      if (
        b.kind !== "silence" ||
        b.untilType !== 2 ||
        !b.name ||
        this.definitions.get(b.id)?.type !== 6
      )
        throw new Error("Unsupported battle condition behavior");
    }
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
    // Controller retains until types 3 and 19. The admitted behavior is type 2.
    return [];
  }
}
