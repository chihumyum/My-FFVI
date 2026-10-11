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

/** Synthetic condition IDs deliberately differ from the original master. */
export function recoveryItemFixture(
  id: number,
  conditionIds: number[],
  revive = false,
): ItemDefinition {
  const item = itemFixture(id);
  item.power = 0;
  item.itemId = id + 100;
  item.name = revive ? "Synthetic revival" : "Synthetic condition cure";
  for (const use of Object.values(item.uses)) {
    use.program = {
      groupId: id + 200,
      range: 7,
      functions: [
        {
          slot: 1,
          functionId: 112,
          type: 12,
          series: 0,
          values: [id + 300, 0, 0],
        },
      ],
    };
    use.plan!.effects = [
      { slot: 1, kind: "recover-condition", conditionIds: [...conditionIds] },
    ];
    if (revive) {
      use.program.functions.push({
        slot: 2,
        functionId: 134,
        type: 34,
        series: 0,
        values: [2, 5, 8],
      });
      use.plan!.effects.push({
        slot: 2,
        kind: "recover-max-hp",
        mode: "divide",
        value: 8,
      });
      use.plan!.targeting.life = "include-fallen-players";
    }
  }
  return item;
}
