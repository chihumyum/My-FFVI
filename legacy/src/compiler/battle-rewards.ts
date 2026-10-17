import {
  validateBattleDropCatalog,
  type BattleDropCatalog,
  type MonsterDropDefinition,
} from "../core/battle-rewards.js";
import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  matching(table: string, key: string, value: string | number): BattleRow[];
};

/** Source identity resolution is separate from drop chance and owned capacity.
 * Unsupported ownership content blocks its monster before battle, even if a
 * particular random seed would have missed that drop. */
export function compileBattleDropCatalog(reader: Reader, monsterIds: readonly number[]): {
  catalog: BattleDropCatalog;
  sources: BattleRow["source"][];
  blockers: { monsterId: number; reason: string }[];
} {
  if (!Array.isArray(monsterIds) || new Set(monsterIds).size !== monsterIds.length ||
      monsterIds.some((id) => !Number.isInteger(id) || id <= 0))
    throw new Error("Invalid requested battle drop identities");
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id);
    sources.push(found.source);
    return found.values;
  };
  const weights = Array.from({ length: 8 }, (_, index) => {
    const found = reader.unique("game_constant_int.csv", "key_name", `MONSTER_DROP_RATE_${index + 1}`);
    sources.push(found.source);
    return int(found.values.value1);
  });
  const catalog: BattleDropCatalog = { kind: "battle-drops-v1", weights, monsters: [], contents: [] };
  validateBattleDropCatalog(catalog);
  const contents = new Map<number, BattleDropCatalog["contents"][number]>();
  const blockers: { monsterId: number; reason: string }[] = [];
  for (const monsterId of monsterIds) {
    try {
      const monster = row("monster.csv", monsterId);
      const definition: MonsterDropDefinition = {
        id: int(monster.id), rate: int(monster.drop_rate),
        slots: Array.from({ length: 8 }, (_, index) => ({
          contentId: int(monster[`drop_content_id${index + 1}`]),
          count: int(monster[`drop_content_id${index + 1}_value`]),
        })),
      };
      if (definition.id !== monsterId) throw new Error("Changed monster drop source identity");
      const reachable = new Map<number, BattleDropCatalog["contents"][number]>();
      for (const [index, slot] of definition.slots.entries()) {
        if (definition.rate <= 0 || weights[index] === 0 || slot.contentId === 0) continue;
        const content = row("content.csv", slot.contentId), type = int(content.type_id);
        if (slot.count <= 0) throw new Error("Nonpositive drop quantity is not admitted");
        const targetId = int(content.type_value);
        if (type === 1) {
          const item = row("item.csv", targetId);
          if (![1, 2].includes(int(item.type_id))) throw new Error("Unresolved drop item ownership type");
          reachable.set(slot.contentId, { id: slot.contentId, kind: "item" });
        } else if (type === 2 || type === 3) {
          const equipment = row(type === 2 ? "weapon.csv" : "armor.csv", targetId);
          if (int(equipment.type_id) !== 1) throw new Error("Unresolved or empty drop equipment identity");
          const aliases = reader.matching("content.csv", "type_value", targetId)
            .filter((r) => int(r.values.type_id) === type);
          sources.push(...aliases.map((r) => r.source));
          if (aliases.length !== 1) throw new Error("Ambiguous drop equipment ownership identity");
          reachable.set(slot.contentId, { id: slot.contentId, kind: "equipment" });
        } else throw new Error(`Battle drop content type ${type} is not implemented`);
      }
      const candidate = { ...catalog, monsters: [definition], contents: [...reachable.values()] };
      validateBattleDropCatalog(candidate);
      catalog.monsters.push(definition);
      for (const [id, content] of reachable) contents.set(id, content);
    } catch (error) {
      blockers.push({ monsterId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  catalog.contents = [...contents.values()];
  validateBattleDropCatalog(catalog);
  return { catalog, blockers,
    sources: [...new Map(sources.map((source) => [JSON.stringify(source), source])).values()] };
}
