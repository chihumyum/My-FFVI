import { battleTableIndex } from "../../src/compiler/battle.js";
import { compileBattleRowCatalog } from "../../src/compiler/battle-row.js";
import type { PhysicalRowRequest } from "../../src/core/battle-row.js";
import type { PhysicalInput } from "../../src/core/physical.js";

/** Synthetic content; row exception identities are source constants, not data
 * copies. A two-weapon combination here tests the predicate, not admission. */
export function battleRowFixture() {
  const tables: Record<string, Record<string, string>[]> = {
    "ability.csv": [
      { id: "1", type_id: "4" }, { id: "124", type_id: "601" },
      { id: "127", type_id: "601" }, { id: "130", type_id: "601" },
      { id: "401", type_id: "602" }, { id: "402", type_id: "609" },
    ],
    "content.csv": [
      { id: "11", type_id: "2", type_value: "1" },
      { id: "12", type_id: "2", type_value: "2" },
      { id: "13", type_id: "2", type_value: "3" },
      { id: "21", type_id: "3", type_value: "1" },
      { id: "31", type_id: "1", type_value: "1" },
    ],
    "weapon.csv": [
      { id: "1", type_id: "2", back_flag: "0" },
      { id: "2", type_id: "1", back_flag: "0" },
      { id: "3", type_id: "1", back_flag: "1" },
    ],
  };
  const source = { file: "synthetic.bundle", objectId: "1", serializedFile: "synthetic.serialized" };
  const reader = () => battleTableIndex(tables, Object.fromEntries(Object.keys(tables).map((table) =>
    [table, { ...source, assetPath: "synthetic/" + table }])));
  const compile = () => compileBattleRowCatalog(reader(), tables);
  const request = (): PhysicalRowRequest => ({ abilityId: 1,
    actor: { side: "player", row: "back", equipment: [12, 21, 21, 21, 21, 21], conditionTypes: [] },
    targetRow: "back" });
  return { tables, reader, compile, request };
}

export function rowPhysicalInput(): PhysicalInput {
  return {
    rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] },
    rows: { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false },
    power: 0,
    actor: { side: "player", level: 10, attackElements: [], conditionTypes: [], attack: 40, strength: 30, accuracy: 100, criticalRate: 3 },
    target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {} },
    targetCount: 1,
  };
}
