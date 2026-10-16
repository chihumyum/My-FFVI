import { ConditionRules, type ConditionCatalog } from "./conditions.js";
import { validateLevitateBehavior, type LevitateBehavior } from "./condition-levitate.js";
import { mergeElementResistances, validateElementResistances, type ElementResistances } from "./elements.js";
import { accuracyHit } from "./battle-hit.js";
import { applyDefend, clearDefendOnAdmission } from "./defend.js";
import { blindConditionType, validateBlindBehavior, type BlindBehavior } from "./condition-blind.js";
import { controlConditionTypes, validateControlBehavior, type ControlConditionBehavior } from "./condition-control.js";
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
  writePoisonTimeStop,
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
    /** Escape owns action/target eligibility, never HP or death registration.
     * The host publishes its enemy-only lifecycle after the complete action. */
    | { id: number; kind: "escape"; name: string; untilType: 2 }
    | LevitateBehavior
    | ProtectionBehavior
    | SpeedBehavior
    | BlindBehavior
    | ControlConditionBehavior
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
      if ("resistanceProvider" in b && !["levitate", "physical-protection", "magic-protection", "haste", "slow", "blind", "poison", "sleep", "confusion", "temptation", "doom", "stop"].includes(b.kind))
        throw new Error("Unsupported condition resistance provider behavior");
      if (b.kind === "levitate") {
        validateLevitateBehavior(b);
        const entries = Object.entries(b.resistanceProvider?.conditions ?? {});
        if (b.resistanceProvider && (entries.length !== 1 || this.definitions.get(Number(entries[0]![0]))?.type !== 409 || entries[0]![1] !== 1))
          throw new Error("Unresolved Leviteto same-type master resistance provider");
      }
      if (b.kind === "haste" || b.kind === "slow") validateSpeedBehavior(b);
      if (b.kind === "blind") validateBlindBehavior(b);
      if (b.kind === "sleep" || b.kind === "confusion" || b.kind === "temptation" || b.kind === "doom" || b.kind === "stop")
        validateControlBehavior(b);
      if (b.resistanceProvider !== undefined) {
        const provider = b.resistanceProvider;
        if (!provider || !Number.isInteger(provider.groupId) || provider.groupId <= 0 || provider.groupId > 0x7fffffff ||
            !provider.conditions || typeof provider.conditions !== "object" || Array.isArray(provider.conditions) ||
            !Object.keys(provider.conditions).length)
          throw new Error("Invalid condition resistance provider");
        this.validateResistances(provider.conditions);
      }
      if (
        (typeof b.name !== "string" || (!b.name && !["magitek", "defend", "escape", "sleep", "confusion", "temptation", "doom"].includes(b.kind))) ||
        !(b.kind === "defend"
          ? b.untilType === 1 && this.definitions.get(b.id)?.type === 1 &&
            this.definitions.get(b.id)?.overlapped === false
          : b.kind === "silence"
          ? b.untilType === 2 && this.definitions.get(b.id)?.type === 6
          : b.kind === "escape"
          ? b.untilType === 2 && this.definitions.get(b.id)?.type === 3 &&
            this.definitions.get(b.id)?.overlapped === false
          : b.kind === "physical-protection" || b.kind === "magic-protection"
          ? b.untilType === 2 && this.definitions.get(b.id)?.overlapped === false &&
            this.definitions.get(b.id)?.type === (b.kind === "physical-protection" ? physicalProtectionType : magicProtectionType)
          : b.kind === "haste" || b.kind === "slow"
          ? b.untilType === 2 && this.definitions.get(b.id)?.overlapped === false &&
            this.definitions.get(b.id)?.type === (b.kind === "haste" ? hasteConditionType : slowConditionType)
          : b.kind === "sleep" || b.kind === "confusion" || b.kind === "temptation" || b.kind === "doom" || b.kind === "stop"
          ? this.definitions.get(b.id)?.overlapped === false &&
            this.definitions.get(b.id)?.type === controlConditionTypes[b.kind]
          : b.untilType === 3 &&
            ((b.kind === "unable-fight" &&
              this.definitions.get(b.id)?.type === 5) ||
              (b.kind === "dying" && this.definitions.get(b.id)?.type === 4) ||
              (b.kind === "blind" && this.definitions.get(b.id)?.type === blindConditionType &&
                this.definitions.get(b.id)?.overlapped === false) ||
              (b.kind === "levitate" && this.definitions.get(b.id)?.type === 409 &&
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
  /** Native Leviteto Start/Remove is a no-op only for enemies. Player renderer
   * and field retention are unclosed; reject before any owner publishes. */
  validateOwner(ids: readonly number[], owner: "enemy" | "player" | undefined): void {
    this.validateActive(ids);
    if (ids.some(id => this.behaviors.get(id)!.kind === "levitate") && owner !== "enemy")
      throw new Error("Player or unknown-owner Leviteto renderer/field lifecycle is not admitted");
  }
  /** Only this closed family has order-independent Start and disjoint providers.
   * Unknown behaviors, opposite speeds and duplicate kinds are never inferred. */
  validateInitialComposition(ids: readonly number[]): void {
    this.validateActive(ids);
    const kinds = new Set<string>(), keys = new Set<string>();
    for (const id of ids) {
      const b = this.behaviors.get(id)!;
      if (!["levitate", "poison", "blind", "haste", "physical-protection", "magic-protection"].includes(b.kind) || kinds.has(b.kind))
        throw new Error("Unresolved multiple enemy initial condition activation order: noncommuting lifecycle");
      kinds.add(b.kind);
      for (const key of Object.keys(b.resistanceProvider?.conditions ?? {})) {
        if (keys.has(key)) throw new Error("Unresolved multiple enemy initial condition activation order: colliding providers");
        keys.add(key);
      }
    }
  }
  effectiveElements(ids: readonly number[], base: ElementResistances, owner?: "enemy" | "player"): ElementResistances {
    this.validateOwner(ids, owner);
    validateElementResistances(base);
    const temporary: ElementResistances = {};
    for (const id of ids) {
      const behavior = this.behaviors.get(id)!;
      if (behavior.kind === "levitate") Object.assign(temporary, behavior.elementProvider.resistances);
    }
    // Enemy ConfirmedResistanceAttributeList 4af6f0 uses native priority merge.
    return mergeElementResistances(base, temporary);
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
  get escapeConditionId(): number {
    const candidates = [...this.definitions.values()].filter((definition) => definition.type === 3);
    if (candidates.length !== 1 || this.behaviors.get(candidates[0]!.id)?.kind !== "escape")
      throw new Error("Missing or ambiguous Escape condition provider");
    return candidates[0]!.id;
  }
  isEscaped(ids: readonly number[]): boolean {
    this.validateActive(ids);
    return ids.some((id) => this.behaviors.get(id)!.kind === "escape");
  }
  /** Function16.ExecuteEscape -> InterruptAddCondition 0x4582c0 uses Contains,
   * then Add/Conflict/CheckConditionFunction. It has no hit, resistance or RNG
   * stage. Enemy/self qualification and publication remain the caller's job. */
  forceEnemyEscape(currentIds: readonly number[]): ConditionChange {
    this.validateActive(currentIds);
    const incomingId = this.escapeConditionId;
    if (currentIds.includes(incomingId))
      return { currentIds: [...currentIds], added: [], removed: [], missed: false };
    const result = this.rules.resolveConflict({
      currentIds: [...currentIds, incomingId], equipmentIds: [], incomingId,
    });
    this.validateActive(result.currentIds);
    return { currentIds: result.currentIds, added: [incomingId],
      removed: result.removed.map((removed) => removed.id), missed: false };
  }
  /** Stable owned/checkpoint state must already contain the result of its
   * actual death identity's conflict pass. Do not silently repair saves or
   * replace alternate death rows with the HP controller's default identity. */
  validateStableLife(hp: number, ids: readonly number[]): void {
    if (!Number.isInteger(hp) || hp < 0 || hp > 0x7fffffff)
      throw new Error("Invalid life HP");
    this.validateOwner(ids, "player");
    if (this.controlBehaviors(ids).length)
      throw new Error("Battle action-control conditions cannot persist in stable owned state");
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
  /** Read-only function definitions. Owning BattleGame must execute Start,
   * Remove, automatic actions and timers; a definition alone is not a no-op
   * implementation of those lifecycle consumers. */
  controlBehaviors(ids: readonly number[]): ControlConditionBehavior[] {
    this.validateActive(ids);
    const result: ControlConditionBehavior[] = [];
    for (const id of ids) {
      const behavior = this.behaviors.get(id)!;
      if (behavior.kind === "sleep" || behavior.kind === "confusion" || behavior.kind === "temptation" || behavior.kind === "doom" || behavior.kind === "stop") {
        if (result.some(current => current.id === id)) throw new Error("Duplicate active control condition");
        result.push(structuredClone(behavior));
      }
    }
    return result;
  }
  /** Doom's ordinary branch uses the same InterruptAddCondition(5) conflict
   * owner as the HP controller. It does not roll accuracy/resistance or directly
   * zero HP. Undead qualification and final life settlement are host concerns. */
  forceUnableFight(currentIds: readonly number[]): ConditionChange {
    this.validateActive(currentIds);
    const incomingId = this.hpZeroConditionId;
    if (currentIds.includes(incomingId))
      return { currentIds: [...currentIds], added: [], removed: [], missed: false };
    const result = this.rules.resolveConflict({ currentIds: [...currentIds, incomingId], equipmentIds: [], incomingId });
    this.validateActive(result.currentIds);
    if (!this.isUnableFight(result.currentIds)) throw new Error("Unsupported forced death condition conflict");
    return { currentIds: result.currentIds, added: [incomingId], removed: result.removed.map(removed => removed.id), missed: false };
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
  writePoisonTimeStop(conditionIds: readonly number[], state: Readonly<PoisonState>, stopped: boolean): PoisonState {
    this.validateActive(conditionIds);
    return writePoisonTimeStop([...this.behaviors.values()].filter((b): b is Extract<BattleConditionCatalog["behaviors"][number], { kind: "poison" }> =>
      b.kind === "poison"), conditionIds, state, stopped);
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
    this.validateOwner([incomingId], resistanceOwner);
    this.validateOwner(currentIds, resistanceOwner);
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
  /** EventCommand list operations deliberately bypass skill hit, resistance,
   * IsAddable and Conflict. The host owns immediate Web lifecycle publication. */
  eventListChange(currentIds: readonly number[], conditionId: number,
      action: "add" | "recover", owner: "player" | "enemy"): ConditionChange {
    this.validateOwner(currentIds, owner);
    this.validateReferences([conditionId]);
    if (action === "recover") return this.recover(currentIds, [conditionId]);
    if (action !== "add") throw new Error("Unknown event condition list action");
    this.validateOwner([conditionId], owner);
    // Native appends duplicates. This Web lifecycle owner has no proven
    // duplicate Start/Remove phase: retain the gate, never silently de-duplicate.
    if (currentIds.includes(conditionId))
      throw new Error("Source repeated condition append needs a duplicate lifecycle owner");
    const behavior = this.behaviors.get(conditionId)!;
    if (["unable-fight", "dying", "escape", "sleep", "confusion", "temptation", "doom"].includes(behavior.kind))
      throw new Error("Source condition append requires its explicit life/control/instance activation owner: " + conditionId);
    const next = [...currentIds, conditionId];
    // This checks admission only. EventCommand did not call Conflict, so never
    // publish the skill controller's changed list in place of the raw append.
    const conflict = this.rules.resolveConflict({ currentIds: next, equipmentIds: [], incomingId: conditionId });
    if (conflict.currentIds.length !== next.length || conflict.currentIds.some((id, index) => id !== next[index]))
      throw new Error("Source event list append has an unclosed conflicting lifecycle phase");
    return { currentIds: next, added: [conditionId], removed: [], missed: false };
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
