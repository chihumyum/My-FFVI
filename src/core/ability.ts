import {
  calculateNeutralPhysical,
  validateNeutralPhysical,
  type PhysicalRules,
  type PhysicalParameters,
} from "./physical.js";
import {
  calculateNeutralMagic,
  validateNeutralMagic,
  type MagicRules,
  type MagicParticipant,
} from "./magic.js";
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
};
export type AbilityEffect =
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
      kind: "recovery";
      resource: "hp" | "mp";
      calculation: "fixed" | "magic";
    };
export type DevelopmentAbilityPlan = {
  effects: AbilityEffect[];
  target: "ally" | "enemy" | "self" | "either";
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
};
export type AbilityEffectResult =
  | NumericalEffectResult
  | {
      slot: number;
      resource: "condition";
      recovery: boolean;
      added: number[];
      removed: number[];
      missed: boolean;
    };

/** Numerical branches only. Conditions, reflection, equipment effects and AI are
 * not inputs to this explicitly temporary executor; admission belongs to its profile.
 * This computes the whole action before the caller commits HP/MP or cost. */
export function calculateDevelopmentEffects(
  plan: DevelopmentAbilityPlan,
  power: number,
  actor: MagicParticipant & {
    level: number;
    attack: number;
    magic: number;
    physical?: PhysicalParameters | null;
  },
  target: MagicParticipant & {
    defense: number;
    magicDefense: number;
    evasion: number;
    magicEvasion: number;
  },
  randomInt: (min: number, max: number) => number,
): NumericalEffectResult[] {
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
    return {
      rules: plan.physical,
      power,
      actor: { ...actor.physical, side: actor.side, level: actor.level },
      target,
      targetCount: 1,
    };
  };
  if (plan.effects.some((e) => e.kind === "physical"))
    validateNeutralPhysical(physicalInput());
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
        validateNeutralMagic({
          rules: plan.magic,
          power,
          actor,
          target,
          recovery: effect.kind === "recovery",
          targetCount: 1,
        });
  }
  return plan.effects.map((effect): NumericalEffectResult => {
    let amount: number;
    if (effect.kind === "physical") {
      return {
        slot: effect.slot,
        resource: "hp",
        recovery: false,
        ...calculateNeutralPhysical(physicalInput(), randomInt),
      };
    } else if (effect.kind === "recovery" && effect.calculation === "fixed") {
      // GetFixedRecoveryStatus 0x3D8660, ability (not item) branch, no conditions.
      amount = power;
    } else {
      const result = calculateNeutralMagic(
        {
          rules: plan.magic!,
          power,
          actor,
          target,
          recovery: effect.kind === "recovery",
          targetCount: 1,
        },
        randomInt,
      );
      return {
        slot: effect.slot,
        resource: effect.kind === "recovery" ? effect.resource : "hp",
        recovery: effect.kind === "recovery",
        ...result,
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
