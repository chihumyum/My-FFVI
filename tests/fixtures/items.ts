import type { ItemDefinition } from "../../src/core/items.js";
export function itemFixture(id = 10, important = false): ItemDefinition {
  const use = {
    program: {
      groupId: 1,
      range: 7,
      functions: [
        {
          slot: 1,
          functionId: 1,
          type: 1,
          series: 0,
          values: [1, 2, 0] as [number, number, number],
        },
      ],
    },
    plan: important
      ? null
      : {
          effects: [
            {
              slot: 1,
              kind: "recovery" as const,
              resource: "hp" as const,
              calculation: "fixed" as const,
            },
          ],
          targeting: {
            life: "alive" as const,
            relation: "either" as const,
            modes: ["single" as const],
            defaultMode: "single" as const,
            defaultRelation: "ally" as const,
            normalFormationOnly: false,
          },
          physical: null,
          magic: null,
        },
    blockers: important ? ["important item"] : [],
  };
  return {
    id,
    itemId: 1,
    name: important ? "Synthetic key" : "Synthetic potion",
    important,
    power: 50,
    systemId: 1,
    forbiddenConditionIds: [],
    uses: { menu: structuredClone(use), battle: structuredClone(use) },
  };
}
