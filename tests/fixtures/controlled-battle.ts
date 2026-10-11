import { BattleGame as SourceBattleGame } from "../../src/core/battle.js";
import type { BattleContent } from "../../src/core/battle-content.js";
import type { BattleInventoryWithQualification } from "../../src/core/battle-entry.js";
import { ignoreRearguardAttackAbilityIds, type BattleRowCatalog } from "../../src/core/battle-row.js";
import type { EquipmentCatalog } from "../../src/core/equipment.js";
import { equipmentCatalog } from "./equipment.js";

/** Explicit authored test context, never imported by production code or source
 * checkers. These invented weapon records all have back_flag=0. */
export function controlledRowCatalog(content: Pick<BattleContent, "abilities">, equipment = equipmentCatalog()): BattleRowCatalog {
  return {
    kind: "battle-row-v1",
    abilities: Object.values(content.abilities).map((ability) => ({ id: ability.id,
      typeId: ability.program.rules.type_id!,
      ignoreRearguardAttack: ignoreRearguardAttackAbilityIds.includes(ability.id) })),
    equipment: Object.values(equipment.definitions).map((gear) => ({ contentId: gear.id,
      weapon: gear.kind === "weapon" ? { typeId: gear.empty ? 2 : 1, backFlag: 0 } : null })),
  };
}

/** Adds the deliberately empty six-slot ownership used by old numerical/AI
 * fixtures. Source-mode calls are passed through untouched, including missing
 * inventory negative cases. They must supply their own explicit fixture data. */
export class ControlledBattleGame extends SourceBattleGame {
  constructor(...args: ConstructorParameters<typeof SourceBattleGame>) {
    const [content, seed, players, givenInventory, projectProgression] = args;
    if (content.qualificationContext?.mode === "source") {
      super(...args);
      return;
    }
    if (!["synthetic", "battle"].includes(content.contentHash) || content.sourceContentHash !== "synthetic")
      throw new Error("Controlled battle helper accepts only authored synthetic fixtures");
    const inventory: BattleInventoryWithQualification = givenInventory
      ? { ...givenInventory } : { definitions: {}, stacks: [], limit: 99 };
    const members = players ?? content.players;
    const equipment: EquipmentCatalog = inventory.qualification?.equipmentCatalog ?? equipmentCatalog();
    if (!inventory.qualification) {
      equipment.characters = Object.fromEntries(members.map((member) => [member.sourceId, {
        ...structuredClone(equipment.characters[1]!), sourceId: member.sourceId,
        jobId: member.ownedAbilities?.jobId ?? 1,
      }]));
      inventory.qualification = { equipmentCatalog: equipment, equipmentStock: [],
        members: members.map((member) => ({ id: member.id, sourceId: member.sourceId, equipment: [1, 1, 3, 4, 5, 5] })) };
    }
    // Match explicitly authored abilities that a test may have added after
    // fixture creation. Do not touch an existing source-mode catalog above.
    content.battleRows = controlledRowCatalog(content, equipment);
    super(content, seed, players, inventory, projectProgression);
  }
}
