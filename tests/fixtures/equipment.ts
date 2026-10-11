import type {
  EquipmentCatalog,
  EquipmentDefinition,
  EquipmentParameterContext,
} from "../../src/core/equipment.js";
import type {
  ParameterLimits,
  ParameterValues,
} from "../../src/core/parameters.js";
import type { PhysicalLimits } from "../../src/core/physical-parameters.js";

export const equipmentZero: ParameterValues = {
  hp: 0,
  mp: 0,
  magic: 0,
  vitality: 0,
  attack: 0,
  defense: 0,
  magicDefense: 0,
  agility: 0,
  weight: 0,
  evasion: 0,
  magicEvasion: 0,
};
export const equipmentLimits: {
  parameters: ParameterLimits;
  physical: PhysicalLimits;
} = {
  parameters: {
    hp: 9999,
    mp: 999,
    magic: 128,
    vitality: 128,
    naturalMagic: 128,
    attack: 255,
    defense: 255,
    magicDefense: 255,
    agility: 128,
    evasion: 255,
    magicEvasion: 255,
    evasionPercent: 100,
    magicEvasionPercent: 100,
  },
  physical: {
    attack: 255,
    strength: 128,
    accuracy: 255,
    criticalRate: 100,
    criticalPercent: 100,
  },
};
export function equipmentContext(): EquipmentParameterContext {
  return {
    parameters: {
      base: {
        ...equipmentZero,
        hp: 100,
        mp: 25,
        magic: 40,
        attack: 20,
        defense: 30,
        magicDefense: 20,
        agility: 30,
      },
      additional: {
        hp: 20,
        mp: 3,
        magic: 0,
        vitality: 0,
        agility: 0,
        weight: 0,
      },
      correction: { magic: 0, vitality: 0, agility: 0 },
      temporary: { ...equipmentZero },
      passive: { hp: 0, mp: 0, magicEvasion: 0 },
      condition601: false,
      twoHandMultiplier: 1,
    },
    physical: {
      baseAttack: 20,
      strength: { base: 30, additional: 2, correction: 0 },
      temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 },
    },
  };
}
export function equipmentCatalog(): EquipmentCatalog {
  const create = (
    id: number,
    kind: "weapon" | "armor",
    parts: boolean[],
    empty: boolean,
    values: Partial<ParameterValues> = {},
  ): EquipmentDefinition => ({
    id,
    equipmentId: id + 1000,
    name: "Synthetic equipment " + id,
    kind,
    empty,
    parts,
    jobIds: [1, 2],
    parameter: {
      kind,
      bareHands: kind === "weapon" && empty,
      reversedByCondition601: false,
      values: { ...equipmentZero, ...values },
    },
    strength: 0,
    accuracy: kind === "weapon" ? 100 : 0,
    criticalRate: kind === "weapon" ? 3 : 0,
    attackElements: [],
    elementResistances: {},
    blockers: [],
  });
  const hand = [true, true, false, false, false, false];
  const body = [false, false, true, false, false, false];
  const head = [false, false, false, true, false, false];
  const accessory = [false, false, false, false, true, true];
  const pieces = [
    create(1, "weapon", hand, true),
    create(2, "armor", hand, true),
    create(3, "armor", body, true),
    create(4, "armor", head, true),
    create(5, "armor", accessory, true),
    create(101, "weapon", hand, false, { attack: 30 }),
    create(102, "weapon", hand, false, { attack: 40, magic: 2 }),
    create(201, "armor", hand, false, { defense: 15, magicDefense: 10 }),
    create(202, "armor", hand, false, { defense: 20, magicDefense: 12 }),
    create(301, "armor", body, false, { defense: 4 }),
    create(401, "armor", head, false, { defense: 6, agility: -1 }),
    create(501, "armor", accessory, false, { magic: 7, hp: 10 }),
  ];
  const initialSlots = [101, 201, 301, 401, 5, 5];
  return {
    kind: "equipment-development-v1",
    limit: 99,
    definitions: Object.fromEntries(pieces.map((p) => [p.id, p])),
    characters: {
      1: {
        sourceId: 1,
        jobId: 1,
        dominantArm: 1,
        accessoriesOnly: false,
        hasTwoSwordStyle: false,
        hasTwoHand: false,
        equipAnyJob: false,
        initialSlots: [...initialSlots],
        emptySlots: [1, 1, 3, 4, 5, 5],
      },
      2: {
        sourceId: 2,
        jobId: 2,
        dominantArm: 2,
        accessoriesOnly: false,
        hasTwoSwordStyle: false,
        hasTwoHand: false,
        equipAnyJob: false,
        initialSlots: [201, 102, 301, 401, 5, 5],
        emptySlots: [1, 1, 3, 4, 5, 5],
      },
    },
  };
}
export function equipmentRoster(catalog = equipmentCatalog()) {
  return Object.values(catalog.characters).map((c) => ({
    id: "owner:" + c.sourceId,
    sourceId: c.sourceId,
    equipment: [...c.initialSlots],
  }));
}
