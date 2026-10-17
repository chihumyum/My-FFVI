/** Source FF6 elemental resistance values. Other series' values are not admitted. */
export type ElementResistance = 1 | 2 | 3 | 4;
export type ElementResistances = Record<string, ElementResistance>;

export function validateElements(elements: readonly number[]): void {
  if (
    !Array.isArray(elements) ||
    elements.some((id) => !Number.isInteger(id) || id < 1 || id > 8)
  )
    throw new Error("Invalid or missing attack elements");
}
export function validateElementResistances(values: ElementResistances): void {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("Missing elemental resistances");
  for (const [key, value] of Object.entries(values)) {
    validateElements([Number(key)]);
    if (key !== String(Number(key)) || ![1, 2, 3, 4].includes(value))
      throw new Error("Unimplemented elemental resistance");
  }
}

/** MargedResistanceAttribute 0x4e7500. First entry in native priority wins.
 * Native priority includes other-series types; they remain blocked above. */
export function mergeElementResistances(
  ...sources: ElementResistances[]
): ElementResistances {
  const result: ElementResistances = {};
  for (const source of sources) {
    validateElementResistances(source);
    for (const [key, value] of Object.entries(source))
      if (result[key] === undefined || value > result[key]!)
        result[key] = value;
  }
  return result;
}

/** PhysicalExecution aggregates matching types: absorption > immune > half > weak. */
export function physicalElementDamage(
  damage: number,
  elements: readonly number[],
  target: ElementResistances,
) {
  const types = elements.map((id) => target[id]);
  if (types.includes(4)) return { damage: -damage, nullified: false };
  if (types.includes(3)) return { damage: 0, nullified: true };
  if (types.includes(2)) damage = Math.trunc(damage / 2);
  else if (types.includes(1)) damage *= 2;
  return { damage, nullified: false };
}

/** MagicExecution applies attributes in source order; immune stops the loop.
 * Do not sort/deduplicate: rounding and repeated absorption are observable. */
export function magicElementDamage(
  damage: number,
  elements: readonly number[],
  target: ElementResistances,
) {
  for (const id of elements) {
    switch (target[id]) {
      case 1:
        damage *= 2;
        break;
      case 2:
        damage = Math.trunc(damage / 2);
        break;
      case 3:
        return { damage: 0, nullified: true };
      case 4:
        damage = -damage;
        break;
    }
  }
  return { damage, nullified: false };
}
