import {resourceAbsorptionEffect,projectResourceAbsorption,type AbsorptionContext,type ActionResourceState} from './resource-absorption.js';
import { projectNonDamagingEffect } from "./non-damaging-ability.js";
import type { AbilityEffectResult, DevelopmentAbilityPlan } from "./ability.js";
import { projectActionTarget, type ActionParticipant } from "./action-effects.js";
import { projectUserConditionPhase, projectUniqueNoneEffect, type UserConditionEffect } from "./ability-user-conditions.js";
import type { BattleConditions } from "./battle-conditions.js";
import type { PhysicalRowContext } from "./battle-row.js";
import type {BaseHpMagicContext} from './base-hp-magic.js';

type UserProjection = ReturnType<typeof projectUserConditionPhase>;
export type ActionUserConditionResult = UserProjection & { slot: number; ownerId: string; targetId: string };

/** Joint action preparation. The caster's condition list belongs to the caster,
 * even when a source function runs once for each nominal target. All returned
 * values are detached; the battle host publishes only after every AI admits. */
export function projectActionTargets<T extends ActionParticipant>(plan: DevelopmentAbilityPlan, power: number,
  actor: T, targets: readonly T[], conditions: BattleConditions,
  random: (min: number, max: number) => number, cost = 0,
  rows?: (target: T) => PhysicalRowContext,
  abilityId?: number,
  absorptionContext?:AbsorptionContext,
  automaticLife: "settle" | "defer-to-battle-owner" = "settle",
  baseHpContext?: BaseHpMagicContext,
): {targets:(ReturnType<typeof projectActionTarget>&{targetId:string})[];userConditionIds:number[];userResults:ActionUserConditionResult[];
  userResourceState?:ActionResourceState;userResourceResults?:{ownerId:string;slot:number;resource:'hp'|'mp';recovery:true;amount:number;missed:boolean;nullified?:boolean}[]} {
  if (automaticLife !== "settle" && automaticLife !== "defer-to-battle-owner") throw new Error("Invalid action automatic life owner");
  if (!targets.length || new Set(targets.map(target => target.id)).size !== targets.length)
    throw new Error("Invalid joint action targets");
  conditions.validateOwner(actor.conditionIds, actor.side);
  for (const target of targets) conditions.validateOwner(target.conditionIds, target.side);
  if (plan.effects.length === 1 && plan.effects[0]?.kind === "non-damaging") {
    const result = projectNonDamagingEffect(plan.effects[0]);
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > actor.mp) throw new Error("Invalid non-damaging action cost");
    conditions.validateActive(actor.conditionIds);
    const projected = targets.map(target => {
      for (const key of ["hp", "mp", "maxHp", "maxMp"] as const)
        if (!Number.isSafeInteger(target[key]) || target[key] < 0 || target[key] > 0x7fffffff)
          throw new Error("Invalid non-damaging target resource");
      if (target.maxHp < 1 || target.hp > target.maxHp || target.mp > target.maxMp)
        throw new Error("Invalid non-damaging target bounds");
      conditions.validateActive(target.conditionIds);
      return { targetId: target.id, effects: [structuredClone(result)] as AbilityEffectResult[],
        state: { hp: target.hp, mp: target.mp - (target.id === actor.id ? cost : 0), conditionIds: [...target.conditionIds] } };
    });
    return { targets: projected, userConditionIds: [...actor.conditionIds], userResults: [] as ActionUserConditionResult[] };
  }
  if(resourceAbsorptionEffect(plan)){
    if(targets.length!==1)throw Error('Unresolved absorption multi-target scope');
    return projectResourceAbsorption(plan,power,actor,targets[0]!,conditions,random,cost,absorptionContext,rows?.(targets[0]!),abilityId,automaticLife);
  }
  const userEffects = plan.effects.filter((effect): effect is UserConditionEffect => effect.kind === "user-condition");
  if (!userEffects.length) return {
    targets: targets.map(target => ({ targetId: target.id,
      ...projectActionTarget(plan, power, actor, target, conditions, random, targets.length, cost, rows?.(target), abilityId, automaticLife, baseHpContext) })),
    userConditionIds: [...actor.conditionIds], userResults: [] as ActionUserConditionResult[],
  };
  // The currently closed source composition has an empty primary calculator
  // dictionary. Numerical/UpdateParameter compositions need their own staging
  // proof; this module does not infer their order from ordinary target actions.
  const primary = plan.effects[0];
  if (primary?.kind !== "unique-none" || primary.primaryResult !== "empty-dictionary" ||
      userEffects.length !== 1 || userEffects[0]!.operation !== "remove" ||
      plan.effects.length !== userEffects.length + 1 ||
      userEffects.some((effect, index) => effect.phase !== "fixed-parameter" ||
        effect.slot <= (index === 0 ? primary.slot : userEffects[index - 1]!.slot)))
    throw new Error("Unimplemented joint user-condition action composition");
  if (!Number.isSafeInteger(cost) || cost < 0 || cost > actor.mp)
    throw new Error("Invalid joint action cost");
  conditions.validateActive(actor.conditionIds);
  for (const target of targets) {
    for (const key of ["hp", "mp", "maxHp", "maxMp"] as const)
      if (!Number.isSafeInteger(target[key]) || target[key] < 0 || target[key] > 0x7fffffff)
        throw new Error("Invalid joint action target resource");
    if (target.maxHp < 1 || target.hp > target.maxHp || target.mp > target.maxMp)
      throw new Error("Invalid joint action target bounds");
  }
  let userConditionIds = [...actor.conditionIds];
  const userResults: ActionUserConditionResult[] = [];
  const projected = targets.map(target => {
    conditions.validateActive(target.conditionIds);
    for (const effect of userEffects) {
      const result = projectUserConditionPhase(effect, "fixed-parameter",
        { id: actor.id, conditionIds: userConditionIds }, conditions);
      userConditionIds = result.currentIds;
      userResults.push({ ...result, slot: effect.slot, ownerId: actor.id, targetId: target.id });
    }
    // Empty target result stays empty. The independent user CalcResult must
    // never create target damage, a hit, received-ability AI or counter readiness.
    const effects: AbilityEffectResult[] = [projectUniqueNoneEffect(primary)];
    return { targetId: target.id, effects, state: { hp: target.hp,
      mp: target.mp - (target.id === actor.id ? cost : 0), conditionIds: [...target.conditionIds] } };
  });
  const self = projected.find(target => target.targetId === actor.id);
  if (self) self.state.conditionIds = [...userConditionIds];
  return { targets: projected, userConditionIds: [...userConditionIds], userResults };
}
