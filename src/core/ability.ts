import type {ResourceAbsorptionEffect} from './resource-absorption.js';
import type { NonDamagingAbilityEffect, NonDamagingAbilityResult } from "./non-damaging-ability.js";
import {
  calculatePhysical,
  validatePhysical,
  type PhysicalRules,
  type PhysicalParameters,
} from "./physical.js";
import {
  calculateMagic,
  validateMagic,
  type MagicRules,
  type MagicParticipant,
} from "./magic.js";
import type { TargetRule } from "./battle-targets.js";
import type { ElementResistances } from "./elements.js";
import type { DefendEffect } from "./defend.js";
import type { PhysicalRowContext } from "./battle-row.js";
import type { ChangeBattleRowEffect, ChangeBattleRowResult } from "./battle-row-change.js";
import type { UserConditionEffect, UniqueNoneEffect, UniqueNoneEffectResult } from "./ability-user-conditions.js";
import type { BattleDerivedActionPlan } from "./battle-derived-actions.js";
/** Decoded source dispatch, separate from the bounded playability executor. */
export type AbilityFunction = {
  slot: number;
  functionId: number;
  type: number;
  series: number;
  values: [number, number, number];
};
export type AbilityProgram = {
  abilityId: number;
  groupId: number;
  functions: AbilityFunction[];
  process: { key: string; values: [number, number, number] };
  range: number;
  rules: Record<string, number>;
  forbiddenConditionIds: number[];
  contentFlags: number[];
  elements: number[];
};
export type AbilityEffect =
  | ResourceAbsorptionEffect
  | BattleDerivedActionPlan
  | DefendEffect
  | ChangeBattleRowEffect
  | UserConditionEffect
  | UniqueNoneEffect
  | NonDamagingAbilityEffect
  | { slot: number; kind: "physical" | "magic" }
  | {
      slot: number;
      kind: "add-condition";
      conditionId: number;
      fixedHit: boolean;
      accuracy: number;
    }
  | { slot: number; kind: "recover-condition"; conditionIds: number[] }
  | {
      slot: number;
      kind: "recover-max-hp";
      mode: "percent" | "divide";
      value: number;
    }
  | {
      slot: number;
      kind: "recovery";
      resource: "hp" | "mp";
      calculation: "fixed" | "magic";
    };
export type DevelopmentAbilityPlan = {
  effects: AbilityEffect[];
  targeting: TargetRule;
  physical: PhysicalRules | null;
  magic: MagicRules | null;
};
export type NumericalEffectResult = {
  slot: number;
  resource: "hp" | "mp";
  recovery: boolean;
  amount: number;
  missed: boolean;
  critical?: boolean;
  nullified?: boolean;
};
export type AbilityEffectResult =
  | NumericalEffectResult
  | ChangeBattleRowResult
  | UniqueNoneEffectResult
  | NonDamagingAbilityResult
  | {
      slot: number;
      resource: "condition";
      recovery: boolean;
      added: number[];
      removed: number[];
      missed: boolean;
    };

/** Numerical branches only, with admitted live target condition types. Status
 * application, reflection, equipment effects and AI are owned by the action host.
 * This computes the whole action before the caller commits HP/MP or cost. */
export function calculateDevelopmentEffects(
  plan: DevelopmentAbilityPlan,
  power: number,
  actor: MagicParticipant & {
    level: number;
    attack: number;
    magic: number;
    physical?: PhysicalParameters | null;
    attackElements: number[];
    /** Required for physical plans; the action host supplies live types. */
    conditionTypes?: readonly number[];
  },
  target: MagicParticipant & {
    defense: number;
    magicDefense: number;
    evasion: number;
    magicEvasion: number;
    elementResistances: ElementResistances;
    /** Derived from the live condition owner by the action host. */
    conditionTypes?: readonly number[];
  },
  randomInt: (min: number, max: number) => number,
  targetCount = 1,
  physicalRows?: PhysicalRowContext,
  abilityId?: number,
): NumericalEffectResult[] {
  if (
    !Number.isInteger(targetCount) ||
    targetCount < 1 ||
    !Number.isInteger(power) ||
    power < 0 ||
    power > 0x7fffffff
  )
    throw new Error("Invalid ability calculation input");
  // Preflight every effect before consuming even the first random value.
  for (const effect of plan.effects) {
    if (
      !["physical", "magic", "recovery"].includes(effect.kind) ||
      (effect.kind === "recovery" &&
        (!["hp", "mp"].includes(effect.resource) ||
          !["fixed", "magic"].includes(effect.calculation)))
    )
      throw new Error("Unimplemented ability effect");
  }
  const physicalInput = () => {
    if (!plan.physical || !actor.physical)
      throw new Error("Missing physical calculation inputs");
    if (!physicalRows) throw new Error("Missing physical row context");
    if (!actor.conditionTypes) throw new Error("Missing physical actor condition types");
    return {
      rules: plan.physical,
      rows: physicalRows,
      power,
      actor: {
        ...actor.physical,
        side: actor.side,
        level: actor.level,
        attackElements: actor.attackElements,
        conditionTypes: actor.conditionTypes,
      },
      target,
      targetCount,
    };
  };
  if (plan.effects.some((e) => e.kind === "physical"))
    validatePhysical(physicalInput());
  const needsMagic = plan.effects.some(
    (e) =>
      e.kind === "magic" ||
      (e.kind === "recovery" && e.calculation === "magic"),
  );
  if (needsMagic) {
    if (!plan.magic) throw new Error("Missing magic calculation rules");
    for (const effect of plan.effects)
      if (
        effect.kind === "magic" ||
        (effect.kind === "recovery" && effect.calculation === "magic")
      )
        validateMagic({
          ...(abilityId !== undefined ? { abilityId } : {}),
          rules: plan.magic,
          power,
          actor,
          target,
          recovery: effect.kind === "recovery",
          targetCount,
        });
  }
  return plan.effects.map((effect): NumericalEffectResult => {
    let amount: number;
    if (effect.kind === "physical") {
      const result = calculatePhysical(physicalInput(), randomInt);
      return {
        slot: effect.slot,
        resource: "hp",
        ...result,
        recovery: result.amount < 0,
        amount: Math.abs(result.amount),
      };
    } else if (effect.kind === "recovery" && effect.calculation === "fixed") {
      // GetFixedRecoveryStatus 0x3d8660/0x157aed0: both ability and ordinary
      // item read their own StandardValue. Carrier admission is done upstream.
      amount = power;
    } else {
      const result = calculateMagic(
        {
          ...(abilityId !== undefined ? { abilityId } : {}),
          rules: plan.magic!,
          power,
          actor,
          target,
          recovery: effect.kind === "recovery",
          targetCount,
        },
        randomInt,
      );
      return {
        slot: effect.slot,
        resource: effect.kind === "recovery" ? effect.resource : "hp",
        ...result,
        recovery: (effect.kind === "recovery") !== result.amount < 0,
        amount: Math.abs(result.amount),
      };
    }
    return {
      slot: effect.slot,
      resource: effect.kind === "recovery" ? effect.resource : "hp",
      recovery: effect.kind === "recovery",
      amount,
      missed: false,
    };
  });
}
