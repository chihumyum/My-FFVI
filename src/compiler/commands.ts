import { compileConditionGroup, type ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";
import type { BattleCommandDefinition } from "../core/battle-content.js";

/** Source membership and IsSelectableCommand restrictions. This does not grant
 * the command to a character or implement its execution/list/unlock behavior. */
export function compileBattleCommand(
  reader: ConditionReader,
  id: number,
  name: (key: string) => string,
) {
  const row = reader.row("command.csv", id),
    v = row.values;
  const group = compileConditionGroup(reader, int(v.condition_group_id));
  const members = reader.group(
    "ability.csv",
    "ability_group_id",
    int(v.ability_group_id),
  );
  const direct = int(v.ability_id);
  const referenced = direct ? reader.row("ability.csv", direct) : null;
  if (referenced) members.push(referenced);
  const command: BattleCommandDefinition = {
    id: int(v.id),
    name: name(v.mes_id_name!),
    kind:
      int(v.ability_group_id) === 0 &&
      direct === 0 &&
      v.execution_type === "2" &&
      v.list_type === "1"
        ? "item"
        : "ability",
    abilityIds: [...new Set(members.map((r) => int(r.values.id)))],
    forbiddenConditionIds: group.ids,
    referencedAbility: referenced
      ? {
          id: int(referenced.values.id),
          typeId: int(referenced.values.type_id),
          wait: int(referenced.values.ability_wait),
        }
      : null,
  };
  return {
    command,
    sources: [
      row,
      ...group.sources,
      ...members,
      ...group.ids.map((n) => reader.row("condition.csv", n)),
    ],
  };
}
