import { initialEquipmentStock } from "../../src/core/equipment.js";
import { checkpointFixture } from "./checkpoint-game.js";
import {
  equipmentCatalog,
  equipmentContext,
  equipmentLimits,
  fixtureEquipmentGrants,
} from "./equipment.js";

/** Controlled mechanism probe, not a source-derived character or save. Expected
 * resource values are specified here without using runtime projection helpers. */
export function equipmentGameFixture(options: { capped?: boolean } = {}) {
  const { field, battle: catalog } = checkpointFixture();
  const equipment = equipmentCatalog();
  equipment.characters[1]!.initialSlots[4] = 501;
  const contexts = { a: equipmentContext(), b: equipmentContext() };
  const limits = structuredClone(equipmentLimits);
  const growth = {
    g: [
      { level: 3, hp: 15, mp: 4 },
      { level: 4, hp: 20, mp: 2 },
    ],
  };
  if (options.capped) {
    limits.parameters.hp = 100;
    limits.parameters.mp = 10;
    catalog.gameState.limits.hp = 100;
    catalog.gameState.limits.mp = 10;
    equipment.definitions[501]!.parameter!.values.hp = 20;
    equipment.definitions[501]!.parameter!.values.mp = 5;
    for (const context of Object.values(contexts)) {
      context.parameters.base.hp = 95;
      context.parameters.base.mp = 8;
      context.parameters.additional.hp = 0;
      context.parameters.additional.mp = 0;
    }
  }
  catalog.contentHash = options.capped
    ? "synthetic-equipment-game-capped"
    : "synthetic-equipment-game";
  catalog.gameState.equipment = {
    a: [...equipment.characters[1]!.initialSlots],
    b: [...equipment.characters[2]!.initialSlots],
  };
  catalog.gameState.equipmentSystem = {
    catalog: equipment,
    initialStock: initialEquipmentStock(equipment, [
      { id: "a", sourceId: 1, equipment: catalog.gameState.equipment.a! },
      { id: "b", sourceId: 2, equipment: catalog.gameState.equipment.b! },
    ], fixtureEquipmentGrants(equipment)),
    contexts,
    limits,
    growth: structuredClone(growth),
  };
  catalog.common.players[0]!.sourceId = 1;
  catalog.common.players[1]!.sourceId = 2;
  catalog.gameState.rosterLifecycle.jobIds = [1, 2];
  catalog.gameState.rosterLifecycle.releasedJobIds = [1, 2];
  catalog.gameState.rosterLifecycle.initial.b!.jobId = 2;
  for (const metadata of Object.values(
    catalog.gameState.rosterLifecycle.initial,
  ))
    metadata.ownedJobs = [1, 2].map((id) => ({ id, level: 1, proficiency: 0 }));
  catalog.common.players[0]!.hp = options.capped ? 100 : 130;
  catalog.common.players[0]!.mp = options.capped ? 10 : 28;
  catalog.common.players[1]!.hp = options.capped ? 95 : 120;
  catalog.common.players[1]!.mp = options.capped ? 8 : 28;
  catalog.common.growth = structuredClone(growth);
  catalog.common.experience = [
    { level: 2, exp: 0 },
    { level: 3, exp: 5 },
    { level: 4, exp: 20 },
  ];
  const source = { file: "synthetic", assetPath: "equipment-integration" };
  field.scripts.waiting = [
    { kind: "wait", seconds: 1, script: "waiting", index: 0, source },
    { kind: "exit", script: "waiting", index: 1, source },
  ];
  return { field, catalog };
}
