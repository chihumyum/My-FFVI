import type { BattleRow } from "./battle.js";
import { tableInteger } from "./table.js";
import { parseSourceEnemyMpParameter } from "../core/source-enemy-mp-parameter.js";

/** Native 4afb70 -> exact MethodMetadata2004de8/predicate4b4d20 tests flag4;
 * 4dad80/4efbb0 filter MonsterFlagGroup.GroupId and project MonsterFlagId.
 * Inherited getter4ac6b0 reads base+151, through actual Parameter slot38.
 * This factory contract is EnemyCharacterParameter, not an enemy-side default.
 * Full native evidence and its scopes: docs/source-enemy-mp-parameter.md. */
export function compileSourceEnemyMpParameter(reader: {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
}, sourceId: number) {
  const int = (raw: string | undefined) => {
    const value = tableInteger(raw);
    if (value < 0 || value > 0x7fffffff) throw new Error("Invalid source enemy MP parameter integer");
    return value;
  };
  const bound = (row: BattleRow, table: string) => {
    if (row.source.assetPath.split("/").at(-1) !== table || !row.source.file || !row.source.serializedFile ||
        !/^-?\d+$/.test(row.source.objectId)) throw new Error("Unbound source enemy MP parameter table");
    return row;
  };
  const monster = bound(reader.row("monster.csv", sourceId), "monster.csv");
  if (monster.source.rowId !== String(sourceId) || int(monster.values.id) !== sourceId)
    throw new Error("Changed source enemy MP parameter monster identity");
  const groupId = int(monster.values.monster_flag_group_id), sources = [monster];
  const rows = groupId === 0 ? [] : reader.group("monster_flag_group.csv", "group_id", groupId);
  if (groupId && !rows.length) throw new Error("Missing source enemy MP flag group");
  const seen = new Set<number>();
  const flags = rows.map(row => {
    bound(row, "monster_flag_group.csv");
    const id = int(row.values.id), flag = int(row.values.monster_flag_id);
    if (!id || !flag || seen.has(id) || row.source.rowId !== String(id) || int(row.values.group_id) !== groupId)
      throw new Error("Changed source enemy MP parameter flag identity");
    seen.add(id); sources.push(row); return flag;
  });
  return { metadata: parseSourceEnemyMpParameter({ kind: "source-enemy-mp-parameter-v1", sourceId,
    isUnableMP: flags.includes(4) }, sourceId), sources };
}
