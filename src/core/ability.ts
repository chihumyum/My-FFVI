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
  multiplier: number;
};
export type NumericalEffectResult = {
  slot: number;
  resource: "hp" | "mp";
  recovery: boolean;
  amount: number;
  missed: boolean;
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
  actor: { level: number; attack: number; magic: number; side: string },
  target: { defense: number; magicDefense: number; evasion: number },
  randomInt: (min: number, max: number) => number,
): NumericalEffectResult[] {
  // Preflight every effect before consuming even the first random value.
  for (const effect of plan.effects) {
    if (effect.kind === "physical" && actor.side !== "enemy")
      throw new Error(
        "Player physical formula is outside the development profile",
      );
    if (
      !["physical", "magic", "recovery"].includes(effect.kind) ||
      (effect.kind === "recovery" &&
        (!["hp", "mp"].includes(effect.resource) ||
          !["fixed", "magic"].includes(effect.calculation)))
    )
      throw new Error("Unimplemented ability effect");
  }
  return plan.effects.map((effect): NumericalEffectResult => {
    let amount: number;
    if (effect.kind === "physical") {
      // Retained Guard branch; hit, rounding and multiplier order are provisional.
      if (randomInt(0, 99) < Math.min(100, target.evasion))
        return {
          slot: effect.slot,
          resource: "hp",
          recovery: false,
          amount: 0,
          missed: true,
        };
      const base = Math.trunc(
        ((randomInt(56, 63) + 4 * actor.attack) * actor.level * actor.level) /
          256,
      );
      const varied =
        Math.trunc((base * plan.multiplier * randomInt(224, 255)) / 256) + 1;
      amount = Math.max(
        1,
        Math.trunc(((255 - target.defense) * varied) / 256) + 1,
      );
    } else if (effect.kind === "recovery" && effect.calculation === "fixed") {
      // GetFixedRecoveryStatus 0x3D8660, ability (not item) branch, no conditions.
      amount = power;
    } else {
      const base =
        Math.trunc((actor.level * actor.magic * power) / 32) + 4 * power;
      const varied = Math.trunc((base * randomInt(224, 255)) / 256) + 1;
      amount =
        effect.kind === "recovery"
          ? varied
          : Math.max(
              1,
              Math.trunc(((255 - target.magicDefense) * varied) / 256) + 1,
            );
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
