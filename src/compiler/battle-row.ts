import {
  ignoreRearguardAttackAbilityIds,
  validateBattleRowCatalog,
  type BattleRowCatalog,
} from "../core/battle-row.js";
import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";

type Reader = { row(table: string, id: string | number): BattleRow };
type Tables = Record<string, Record<string, string>[]>;

/** Compile identities from the complete source tables. No action, ranged
 * weapon or dual-wield admission is granted by this metadata catalog. */
export function compileBattleRowCatalog(reader: Reader, tables: Tables): {
  catalog: BattleRowCatalog;
  sources: BattleRow["source"][];
} {
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id);
    sources.push(found.source);
    return found.values;
  };
  const all = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error("Missing battle row source table: " + table);
    return tables[table]!.map((entry) => row(table, entry.id!));
  };
  const abilities = all("ability.csv").map((ability) => ({
    id: int(ability.id), typeId: int(ability.type_id),
    ignoreRearguardAttack: ignoreRearguardAttackAbilityIds.includes(int(ability.id)),
  }));
  const contents = all("content.csv");
  if (new Set(contents.map((entry) => int(entry.id))).size !== contents.length)
    throw new Error("Duplicate battle row content identity");
  const equipment = contents.filter((entry) => [2, 3].includes(int(entry.type_id))).map((content) => {
    // OwnedItemData.Weapon is set only for source content type2. Armor is
    // rejected by the native Weapon!=null hand predicate before its type read.
    const weapon = int(content.type_id) === 2 ? row("weapon.csv", int(content.type_value)) : null;
    return { contentId: int(content.id), weapon: weapon === null ? null : {
      typeId: int(weapon.type_id), backFlag: int(weapon.back_flag),
    } };
  });
  const catalog: BattleRowCatalog = { kind: "battle-row-v1", abilities, equipment };
  validateBattleRowCatalog(catalog);
  return { catalog, sources: [...new Map(sources.map((source) => [JSON.stringify(source), source])).values()] };
}
