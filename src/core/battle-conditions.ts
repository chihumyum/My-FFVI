import { ConditionRules, type ConditionCatalog } from "./conditions.js";
import { accuracyHit } from "./battle-hit.js";
import { applyDefend, clearDefendOnAdmission } from "./defend.js";
import { blindConditionType, validateBlindBehavior, type BlindBehavior } from "./condition-blind.js";
import {
  magicProtectionType,
  physicalProtectionType,
  type ProtectionBehavior,
} from "./protection.js";
import {
  advanceSlowClocks,
  conditionAtbSpeedPercent,
  hasteConditionType,
  reconcileSlowClocks,
  slowConditionType,
  validateSpeedBehavior,
  type SlowState,
  type SpeedBehavior,
} from "./condition-speed.js";
import {
  advancePoisonClocks,
  reconcilePoisonClocks,
  type PoisonAdvanceInput,
  type PoisonState,
} from "./condition-poison.js";
export type { PoisonState, PoisonTick } from "./condition-poison.js";
export type { SlowState } from "./condition-speed.js";

/** The generic condition Init provider, independent of the behavior's numeric
 * effect. Active identities remain the only owner of these temporary values. */
export type BattleConditionResistanceProvider = NonNullable<ProtectionBehavior["resistanceProvider"]>;
export type WithConditionResistanceProvider<T> = T & {
  resistanceProvider?: BattleConditionResistanceProvider;
};

/** Only behavior functions whose state dependencies are implemented are admitted.
 * The full master catalog remains available for references and conflict rules. */
export type BattleConditionCatalog = {
  rules: ConditionCatalog;
  /** Identity passed by the source HP controller, distinct from condition type. */
  hpZeroConditionId: number;
  dying: { conditionId: number; thresholdDivisor: number };
  behaviors: WithConditionResistanceProvider<
    | { id: number; kind: "defend"; name: string; untilType: 1 }
    | { id: number; kind: "silence"; name: string; untilType: 2 }
    | ProtectionBehavior
    | SpeedBehavior
    | BlindBehavior
    | { id: number; kind: "unable-fight"; name: string; untilType: 3 }
    | { id: number; kind: "dying"; name: string; untilType: 3 }
    /** No timer or numeric modifier; a battle appearance host must execute
     * Start/Remove. Empty name is the source's hidden None message identity. */
    | { id: number; kind: "magitek"; name: string; untilType: 3 }
    | {
        id: number;
        kind: "poison";
        name: string;
        untilType: 3;
        hpDivisor: number;
      }
  >[];
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

/** Bounded battle behavior, not a general status engine. Poison has a pure
 * battle-local clock/HP projection; the host owns publication and life settlement.
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
    this.behaviors = new Map(catalog.behaviors.map((b) => [b.id, structuredClone(b)]));
    this.hpZeroConditionId = catalog.hpZeroConditionId;
    this.dying = { ...catalog.dying };
    if (this.behaviors.size !== catalog.behaviors.length)
      throw new Error("Duplicate battle condition behavior");
    for (const b of this.behaviors.values()) {
      if ("resistanceProvider" in b && !["physical-protection", "magic-protection", "haste", "slow", "blind", "poison"].includes(b.kind))
        throw new Error("Unsupported condition resistance provider behavior");
      if (b.kind === "haste" || b.kind === "slow") validateSpeedBehavior(b);
      if (b.kind === "blind") validateBlindBehavior(b);
      if (b.resistanceProvider !== undefined) {
        const provider = b.resistanceProvider;
        if (!provider || !Number.isInteger(provider.groupId) || provider.groupId <= 0 || provider.groupId > 0x7fffffff ||
            !provider.conditions || typeof provider.conditions !== "object" || Array.isArray(provider.conditions) ||
            !Object.keys(provider.conditions).length)
          throw new Error("Invalid condition resistance provider");
        this.validateResistances(provider.conditions);
      }
      if (
        (typeof b.name !== "string" || (!b.name && !["magitek", "defend"].includes(b.kind))) ||
        !(b.kind === "defend"
          ? b.untilType === 1 && this.definitions.get(b.id)?.type === 1 &&
            this.definitions.get(b.id)?.overlapped === false
          : b.kind === "silence"
          ? b.untilType === 2 && this.definitions.get(b.id)?.type === 6
          : b.kind === "physical-protection" || b.kind === "magic-protection"
          ? b.untilType === 2 && this.definitions.get(b.id)?.overlapped === false &&
            this.definitions.get(b.id)?.type === (b.kind === "physical-protection" ? physicalProtectionType : magicProtectionType)
          : b.kind === "haste" || b.kind === "slow"
          ? b.untilType === 2 && this.definitions.get(b.id)?.overlapped === false &&
            this.definitions.get(b.id)?.type === (b.kind === "haste" ? hasteConditionType : slowConditionType)
          : b.untilType === 3 &&
            ((b.kind === "unable-fight" &&
              this.definitions.get(b.id)?.type === 5) ||
              (b.kind === "dying" && this.definitions.get(b.id)?.type === 4) ||
              (b.kind === "blind" && this.definitions.get(b.id)?.type === blindConditionType &&
                this.definitions.get(b.id)?.overlapped === false) ||
              (b.kind === "magitek" &&
                this.definitions.get(b.id)?.type === 607 &&
                this.definitions.get(b.id)?.overlapped === false) ||
              (b.kind === "poison" &&
                this.definitions.get(b.id)?.type === 10 &&
                this.definitions.get(b.id)?.overlapped === false &&
                Number.isInteger(b.hpDivisor) &&
                b.hpDivisor > 0 &&
                b.hpDivisor <= 0x7fffffff)))
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
  /** BattleTempParameter.UpdateParameter 0x75ffc0 reads each active function's
   * resistance dictionary in order; UpdateDicResistance 0x75fe80 overwrites
   * earlier duplicate keys. Enemy ConfirmedResistanceCondtionList 0x4af760
   * gives that temporary dictionary precedence over base resistance. The player
   * duplicate-key provider is separate and is not admitted by this contract. */
  effectiveResistances(currentIds: readonly number[], base: Record<string, number>, owner?: "enemy" | "player") {
    this.validateActive(currentIds);
    this.validateResistances(base);
    const temporary: Record<string, number> = {};
    for (const id of currentIds) {
      const behavior = this.behaviors.get(id)!;
      if (behavior.resistanceProvider)
        Object.assign(temporary, behavior.resistanceProvider.conditions);
    }
    for (const [id, selector] of Object.entries(temporary))
      if (Object.hasOwn(base, id) && base[id] !== selector && owner !== "enemy")
        throw new Error("Unresolved player or unknown-owner temporary condition resistance precedence");
    return { ...base, ...temporary };
  }
  name(id: number) {
    this.validateActive([id]);
    return this.behaviors.get(id)!.name;
  }
  isUnableFight(ids: readonly number[]) {
    this.validateActive(ids);
    return ids.some((id) => this.behaviors.get(id)!.kind === "unable-fight");
  }
  /** Stable owned/checkpoint state must already contain the result of its
   * actual death identity's conflict pass. Do not silently repair saves or
   * replace alternate death rows with the HP controller's default identity. */
  validateStableLife(hp: number, ids: readonly number[]): void {
    if (!Number.isInteger(hp) || hp < 0 || hp > 0x7fffffff)
      throw new Error("Invalid life HP");
    this.validateActive(ids);
    const deaths = ids.filter((id) => this.behaviors.get(id)!.kind === "unable-fight");
    if ((hp === 0) !== (deaths.length > 0))
      throw new Error("Owned HP/death state mismatch");
    for (const incomingId of deaths) {
      const result = this.rules.resolveConflict({ currentIds: [...ids], equipmentIds: [], incomingId });
      if (result.currentIds.length !== ids.length || result.currentIds.some((id, n) => id !== ids[n]))
        throw new Error("Owned death/condition state mismatch");
    }
  }
  types(ids: readonly number[]): number[] {
    this.validateActive(ids);
    return ids.map((id) => this.definitions.get(id)!.type);
  }
  /** Identity-only predicate read. This does not admit active effects, life
   * behavior or persistence for a known but unported master condition. */
  referenceTypes(ids: readonly number[]): number[] {
    this.validateReferences(ids);
    return ids.map((id) => this.definitions.get(id)!.type);
  }
  private speedBehaviors(): SpeedBehavior[] {
    return [...this.behaviors.values()].filter((b): b is SpeedBehavior =>
      b.kind === "haste" || b.kind === "slow");
  }
  speedPercent(ids: readonly number[]): number {
    this.validateActive(ids);
    return conditionAtbSpeedPercent(this.speedBehaviors(), ids);
  }
  reconcileSlowState(
    ids: readonly number[],
    previous: Readonly<SlowState>,
  ): SlowState {
    this.validateActive(ids);
    return reconcileSlowClocks(this.speedBehaviors(), ids, previous);
  }
  advanceSlow(
    ids: readonly number[],
    state: Readonly<SlowState>,
    seconds: number,
  ): SlowState {
    this.validateActive(ids);
    return advanceSlowClocks(this.speedBehaviors(), ids, state, seconds);
  }
  magitekIds(ids: readonly number[]): number[] {
    this.validateActive(ids);
    const result = ids.filter((id) => this.behaviors.get(id)!.kind === "magitek");
    if (result.length > 1) throw new Error("Multiple active Magitek conditions");
    return result;
  }
  poisonIds(ids: readonly number[]): number[] {
    this.validateActive(ids);
    const result = ids.filter(
      (id) => this.behaviors.get(id)!.kind === "poison",
    );
    if (new Set(result).size !== result.length)
      throw new Error("Duplicate active poison condition");
    return result;
  }
  reconcilePoisonState(
    conditionIds: readonly number[],
    previousState: Readonly<PoisonState>,
    atbSpeed: number,
  ): PoisonState {
    this.poisonIds(conditionIds);
    return reconcilePoisonClocks(
      [...this.behaviors.values()].filter((b) => b.kind === "poison"),
      conditionIds,
      previousState,
      atbSpeed,
      this.types(conditionIds),
    );
  }
  advancePoison(input: PoisonAdvanceInput) {
    this.poisonIds(input.conditionIds);
    return advancePoisonClocks(
      [...this.behaviors.values()].filter((b) => b.kind === "poison"),
      input,
      this.types(input.conditionIds),
    );
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
    resistanceOwner?: "enemy" | "player",
  ): ConditionChange {
    this.validateActive(currentIds);
    this.validateActive([incomingId]);
    const effective = this.effectiveResistances(currentIds, resistances, resistanceOwner);
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
        ? effective[incomingId] === 1
        : Object.hasOwn(effective, incomingId))
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
  defend(currentIds: readonly number[], conditionId: number, actorId: string, targetId: string): ConditionChange {
    this.validateActive(currentIds);
    if (this.behaviors.get(conditionId)?.kind !== "defend")
      throw new Error("Unimplemented Defend condition identity");
    const change = applyDefend({ conditionId, conditionType: 1, untilType: 1 },
      this.rules, currentIds, actorId, targetId);
    this.validateActive(change.currentIds);
    return change;
  }
  /** SetActData recovers until=1 after accepting the entire ordinary action
   * group. Direct reactions do not pass this boundary. This host never creates
   * a native chained-action group; those providers remain explicit blockers. */
  admitAtbAction(currentIds: readonly number[], abilities: readonly { id: number; type: number }[]): number[] {
    this.validateActive(currentIds);
    const defenses = [...this.behaviors.values()].filter((b) => b.kind === "defend");
    if (defenses.length > 1) throw new Error("Ambiguous Defend lifecycle identity");
    if (!defenses.length) return [...currentIds];
    return clearDefendOnAdmission({ conditionId: defenses[0]!.id, conditionType: 1, untilType: 1 },
      this.rules, currentIds, { route: "atb", abilities: [...abilities], nativeChain: "empty" }).currentIds;
  }
  battleEnd(currentIds: readonly number[]): number[] {
    this.validateActive(currentIds);
    // Controller retains until types 3 and 19; death/dying persist into the field.
    return currentIds.filter((id) => this.behaviors.get(id)!.untilType === 3);
  }
}
