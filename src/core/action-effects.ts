import {
  calculateDevelopmentEffects,
  type AbilityEffectResult,
  type DevelopmentAbilityPlan,
} from "./ability.js";
import { calculateRevivalEffects, revivalEffects } from "./battle-revival.js";
import type { BattleConditions } from "./battle-conditions.js";
import type { BattleRow, PhysicalRowContext } from "./battle-row.js";
import { changeBattleRow } from "./battle-row-change.js";
import {baseHpMagicEffect,calculateBaseHpMagic,type BaseHpMagicContext} from './base-hp-magic.js';

/** Effects need numerical and condition state, not a battle renderer, command
 * queue or encounter definition. Owned characters can use menu items before a
 * battle presentation has been admitted for them. */
export type ActionParticipant = Parameters<typeof calculateDevelopmentEffects>[2] &
  Parameters<typeof calculateDevelopmentEffects>[3] & {
    id: string;
    hp: number;
    mp: number;
    maxHp: number;
    maxMp: number;
    conditionIds: number[];
    row?: BattleRow;
    conditionResistances?: Record<string, number>;
  };

/** A pure target projection shared by battle and owned-state item use. The
 * caller admits targets/cost, stages every target, then commits the whole action. */
export function projectActionTarget(
  plan: DevelopmentAbilityPlan,
  power: number,
  actor: ActionParticipant,
  target: ActionParticipant,
  conditions: BattleConditions,
  random: (min: number, max: number) => number,
  targetCount: number,
  cost = 0,
  physicalRows?: PhysicalRowContext,
  abilityId?: number,
  automaticLife: "settle" | "defer-to-battle-owner" = "settle",
  baseHpContext?: BaseHpMagicContext,
) {
  if (automaticLife !== "settle" && automaticLife !== "defer-to-battle-owner") throw new Error("Invalid action automatic life owner");
  for (const key of ["hp", "mp", "maxHp", "maxMp"] as const)
    if (
      !Number.isSafeInteger(target[key]) ||
      target[key] < 0 ||
      target[key] > 0x7fffffff
    )
      throw new Error("Invalid action target resource");
  if (
    target.maxHp < 1 ||
    target.hp > target.maxHp ||
    target.mp > target.maxMp ||
    !Number.isSafeInteger(cost) ||
    cost < 0 ||
    cost > actor.mp
  )
    throw new Error("Invalid action resource bounds/cost");
  conditions.validateOwner(actor.conditionIds, actor.side);
  conditions.validateOwner(target.conditionIds, target.side);
  let conditionIds = [...target.conditionIds];
  let effects: AbilityEffectResult[];
  let row: BattleRow | undefined;
  const first = plan.effects[0];
  const baseHp=baseHpMagicEffect(plan);
  if (baseHp) {
    conditions.validateActive(actor.conditionIds); conditions.validateActive(target.conditionIds);
    effects=[calculateBaseHpMagic(baseHp,actor,target,conditions.types(target.conditionIds),random,targetCount,baseHpContext)];
  } else if (revivalEffects(plan)) {
    ({ effects, conditionIds } = calculateRevivalEffects(
      plan,
      conditions,
      target,
    ));
  } else if (plan.effects.length === 1 && first?.kind === "change-row") {
    if (cost !== 0 || targetCount !== 1 || plan.targeting.relation !== "self" ||
        plan.targeting.modes.length !== 1 || plan.targeting.modes[0] !== "single")
      throw new Error("Invalid Change Row action context");
    const result = changeBattleRow(first, actor, { ...target, row: target.row });
    row = result.after;
    effects = [result];
  } else if (plan.effects.length === 1 && first?.kind === "defend") {
    if (cost !== 0 || targetCount !== 1) throw new Error("Invalid Defend action context");
    const change = conditions.defend(target.conditionIds, first.conditionId, actor.id, target.id);
    conditionIds = change.currentIds;
    effects = [{ slot: first.slot, resource: "condition", recovery: false,
      added: change.added, removed: change.removed, missed: change.missed }];
  } else if (
    plan.effects.length === 1 &&
    first &&
    (first.kind === "add-condition" || first.kind === "recover-condition")
  ) {
    if(first.kind==='recover-condition'&&first.recoveryHit!==undefined&&first.recoveryHit!=='matching-current-condition-or-miss')
      throw Error('Unresolved source condition recovery Hit policy');
    if (first.kind === "add-condition" && !target.conditionResistances)
      throw new Error("Missing action target condition resistances");
    const change =
      first.kind === "add-condition"
        ? conditions.add(
            target.conditionIds,
            target.conditionResistances!,
            first.conditionId,
            {
              accuracy: first.accuracy,
              magicEvasion: target.magicEvasion,
              fixed: first.fixedHit,
            },
            random,
            target.side,
          )
        : conditions.recover(target.conditionIds, first.conditionIds);
    conditionIds = change.currentIds;
    effects = [
      {
        slot: first.slot,
        resource: "condition",
        recovery: first.kind === "recover-condition",
        added: change.added,
        removed: change.removed,
        missed: first.kind==='recover-condition'&&first.recoveryHit==='matching-current-condition-or-miss'
          ? change.removed.length===0 : change.missed,
      },
    ];
  } else {
    effects = calculateDevelopmentEffects(
      plan,
      power,
      { ...actor, conditionTypes: conditions.types(actor.conditionIds) },
      { ...target, conditionTypes: conditions.types(target.conditionIds),
        elementResistances: conditions.effectiveElements(target.conditionIds, target.elementResistances, target.side) },
      random,
      targetCount,
      physicalRows,
      abilityId,
    );
  }
  const state: { hp: number; mp: number; conditionIds: number[]; row?: BattleRow } = {
    hp: target.hp,
    mp: target.mp - (target.id === actor.id ? cost : 0),
    conditionIds,
    ...(row ? { row } : {}),
  };
  for (const effect of effects) {
    if (effect.resource === "none") throw new Error("Empty primary calculation requires the joint battle action host");
    if (effect.missed || effect.resource === "condition" || effect.resource === "row" || effect.nullified)
      continue;
    const resource = effect.resource;
    state[resource] = effect.recovery
      ? Math.min(
          resource === "hp" ? target.maxHp : target.maxMp,
          state[resource] + effect.amount,
        )
      : Math.max(0, state[resource] - effect.amount);
    if (resource === "hp")
      state.conditionIds = conditions.updateDying(
        state.hp,
        target.maxHp,
        state.conditionIds,
      );
  }
  if (automaticLife === "settle") Object.assign(
    state,
    conditions.settleLife(
      state.hp,
      state.conditionIds,
      conditions.isUnableFight(target.conditionIds),
    ),
  );
  return { state, effects };
}
