/** FFVI parameter confirmation, after growth, conditions and passive providers
 * have supplied their inputs. This does not infer those inputs from a base row.
 * Native addresses, staging and exclusions: docs/character-parameters.md.
 */
export const parameterNames = [
  "hp",
  "mp",
  "magic",
  "attack",
  "defense",
  "magicDefense",
  "agility",
  "weight",
  "evasion",
  "magicEvasion",
] as const;
export type ParameterName = (typeof parameterNames)[number];
export type ParameterValues = Record<ParameterName, number>;
export type ParameterLimits = Omit<ParameterValues, "weight"> & {
  naturalMagic: number;
  evasionPercent: number;
  magicEvasionPercent: number;
};
export type ParameterEquipment = {
  slot: number;
  kind: "weapon" | "armor";
  /** The native weapon TypeId == 2 branch; not inferred from zero attack. */
  bareHands: boolean;
  /** Membership in this build's condition-601 equipment lists. */
  reversedByCondition601: boolean;
  values: ParameterValues;
};
export type PlayerParameterInput = {
  base: ParameterValues;
  additional: Pick<
    ParameterValues,
    "hp" | "mp" | "magic" | "agility" | "weight"
  >;
  correction: Pick<ParameterValues, "magic" | "agility">;
  temporary: ParameterValues;
  equipment: ParameterEquipment[];
  passive: Pick<ParameterValues, "hp" | "mp" | "magicEvasion">;
  condition601: boolean;
  /** Already resolved HasTwohand / GetTwoHandedMagnification. */
  twoHandMultiplier: number;
};

function int32(n: number): number {
  if (!Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff)
    throw new Error("Parameter input must be a signed int32");
  return n;
}
function add(...values: number[]): number {
  return values.reduce((sum, n) => (sum + int32(n)) | 0, 0);
}
function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n));
}
function checkValues(v: ParameterValues) {
  for (const key of parameterNames) int32(v[key]);
}
function checkLimits(limits: ParameterLimits) {
  for (const key of [
    ...parameterNames.filter((k) => k !== "weight"),
    "naturalMagic",
    "evasionPercent",
    "magicEvasionPercent",
  ] as const) {
    if (int32(limits[key]) <= 0)
      throw new Error("Invalid parameter limit: " + key);
  }
}
function percentage(value: number, max: number, cap: number): number {
  const scaled = Math.fround(
    Math.fround(Math.fround(value) / Math.fround(max)) * 100,
  );
  return Math.min(cap, Math.trunc(Math.min(100, scaled)));
}
function equipmentValue(
  item: ParameterEquipment,
  condition601: boolean,
  key: "attack" | "defense",
) {
  const value = item.values[key];
  return value > 0 && condition601 !== item.reversedByCondition601 ? 1 : value;
}

export function confirmPlayerParameters(
  input: PlayerParameterInput,
  limits: ParameterLimits,
): ParameterValues {
  checkLimits(limits);
  checkValues(input.base);
  checkValues(input.temporary);
  for (const k of ["hp", "mp", "magic", "agility", "weight"] as const)
    int32(input.additional[k]);
  for (const k of ["magic", "agility"] as const) int32(input.correction[k]);
  for (const k of ["hp", "mp", "magicEvasion"] as const)
    int32(input.passive[k]);
  if (
    typeof input.condition601 !== "boolean" ||
    int32(input.twoHandMultiplier) < 1
  )
    throw new Error("Unresolved parameter provider input");
  const slots = new Set<number>();
  for (const item of input.equipment) {
    if (
      !Number.isInteger(item.slot) ||
      item.slot < 1 ||
      item.slot > 6 ||
      slots.has(item.slot) ||
      !["weapon", "armor"].includes(item.kind) ||
      typeof item.bareHands !== "boolean" ||
      typeof item.reversedByCondition601 !== "boolean"
    )
      throw new Error("Invalid parameter equipment slot");
    checkValues(item.values);
    slots.add(item.slot);
  }
  const { base, additional, correction, temporary, passive } = input;
  const sum = (key: ParameterName) =>
    add(...input.equipment.map((e) => e.values[key]));
  const hands = input.equipment.filter(
    (e) => e.slot <= 2 && e.kind === "weapon",
  );
  const bareHands = hands.length === 2 && hands.every((e) => e.bareHands);
  const naturalAttack = clamp(
    add(base.attack, bareHands ? (input.condition601 ? 1 : 10) : 0),
    limits.attack,
  );
  const weaponAttack = add(
    ...hands.map((e) => equipmentValue(e, input.condition601, "attack")),
  );
  const armorDefense = add(
    ...input.equipment
      .filter((e) => e.kind === "armor")
      .map((e) => equipmentValue(e, input.condition601, "defense")),
  );
  const resource = (key: "hp" | "mp") =>
    Math.min(
      limits[key],
      add(
        clamp(add(base[key], additional[key]), limits[key]),
        temporary[key],
        sum(key),
        passive[key],
      ),
    );
  const staged = (key: "magic" | "agility") =>
    clamp(
      add(
        clamp(
          add(base[key], additional[key], correction[key]),
          key === "magic" ? limits.naturalMagic : limits.agility,
        ),
        temporary[key],
        sum(key),
      ),
      limits[key],
    );
  return {
    hp: resource("hp"),
    mp: resource("mp"),
    magic: staged("magic"),
    agility: staged("agility"),
    // FFVI caps the natural + temporary part BEFORE adding weapons. No final 255 cap.
    attack: Math.max(
      0,
      Math.imul(
        add(
          Math.min(limits.attack, add(naturalAttack, temporary.attack)),
          weaponAttack,
        ),
        input.twoHandMultiplier,
      ),
    ),
    defense: clamp(
      add(clamp(base.defense, limits.defense), temporary.defense, armorDefense),
      limits.defense,
    ),
    magicDefense: clamp(
      add(
        clamp(base.magicDefense, limits.magicDefense),
        temporary.magicDefense,
        sum("magicDefense"),
      ),
      limits.magicDefense,
    ),
    weight: add(
      base.weight,
      additional.weight,
      temporary.weight,
      sum("weight"),
    ),
    evasion: clamp(
      add(
        Math.min(limits.evasion, base.evasion),
        temporary.evasion,
        sum("evasion"),
      ),
      limits.evasion,
    ),
    magicEvasion: clamp(
      add(
        clamp(base.magicEvasion, limits.magicEvasion),
        temporary.magicEvasion,
        sum("magicEvasion"),
        passive.magicEvasion,
      ),
      limits.magicEvasion,
    ),
  };
}

/** Exact isNatunalValue=false path. Magic evasion converts at both native stages. */
export function playerEvasionPercent(
  input: PlayerParameterInput,
  limits: ParameterLimits,
): { physical: number; magic: number } {
  const values = confirmPlayerParameters(input, limits);
  const naturalMagic = percentage(
    clamp(input.base.magicEvasion, limits.magicEvasion),
    limits.magicEvasion,
    limits.magicEvasionPercent,
  );
  const magic = clamp(
    add(
      naturalMagic,
      input.temporary.magicEvasion,
      ...input.equipment.map((e) => e.values.magicEvasion),
      input.passive.magicEvasion,
    ),
    limits.magicEvasion,
  );
  return {
    physical: percentage(values.evasion, limits.evasion, limits.evasionPercent),
    magic: percentage(magic, limits.magicEvasion, limits.magicEvasionPercent),
  };
}

export function confirmEnemyParameters(
  base: ParameterValues,
  temporary: ParameterValues,
  limits: ParameterLimits,
): ParameterValues {
  checkValues(base);
  checkValues(temporary);
  checkLimits(limits);
  return Object.fromEntries(
    parameterNames.map((key) => {
      const total = add(base[key], temporary[key]);
      // Enemy HP/MP/weight are not subject to the player caps. Evasion ignores the bool argument.
      return [
        key,
        key === "hp" || key === "mp" || key === "weight"
          ? total
          : clamp(total, limits[key]),
      ];
    }),
  ) as ParameterValues;
}
