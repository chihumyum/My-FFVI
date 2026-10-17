import type { BattleContent } from "../../src/core/battle-content.js";
import { compileDevelopmentAbility } from "../../src/compiler/ability.js";
import { battleTableIndex } from "../../src/compiler/battle.js";
import { fixture } from "./battle-content.js";

/** Source-shaped values with explicitly synthetic provenance. No source owner
 * is granted a command by this helper; it is for controlled runtime/UI tests. */
export function rowChangeTables() {
  const ability: Record<string, string> = {
    id: "4", battle_function_group_id: "403", process_prog: "None",
    data_a: "0", data_b: "0", data_c: "0", battle_renge_id: "5",
    standard_value: "0", use_value: "0", ability_wait: "3", attribute_id: "0",
    type_id: "7", system_id: "2", accuracy_rate: "100", invalid_reflection: "1",
    ...Object.fromEntries(["condition_group_id", "content_flag_group_id", "attribute_group_id",
      "attack_count", "Impact_status", "invalid_boss", "resistance_attribute", "adding_hit_rate",
      "valid_hit_rate", "weak_hit_rate", "reaction_type"].map((key) => [key, "0"])),
  };
  const group: Record<string, string> = { id: "403", ...Object.fromEntries(
    [1, 2, 3].flatMap((slot) => [[`function${slot}_id`, slot === 1 ? "17" : "0"],
      ...[1, 2, 3].map((value) => [`function${slot}_value${value}`, "0"])]) ) };
  const tables: Record<string, Record<string, string>[]> = {
    "ability.csv": [ability], "function_group.csv": [group],
    "function.csv": [{ id: "17", type_id: "17", series_id: "0" }],
  };
  const source = { file: "synthetic.bundle", objectId: "1", serializedFile: "synthetic.serialized" };
  const reader = () => battleTableIndex(tables,
    Object.fromEntries(Object.keys(tables).map((table) => [table, { ...source, assetPath: "synthetic/" + table }])));
  return { ability, group, tables, reader };
}

export function installRowChange(content: Pick<BattleContent, "abilities" | "commands" | "players">): void {
  content.abilities[4] = compileDevelopmentAbility(rowChangeTables().reader(), 4, "换列");
  content.commands[5] = { id: 5, name: "换列", kind: "ability", abilityIds: [4],
    forbiddenConditionIds: [], referencedAbility: { id: 4, typeId: 7, wait: 3 } };
  for (const player of content.players) {
    player.commands.push(5);
    player.abilities.push(4);
  }
}
export function rowChangeFixture(): BattleContent {
  const content = fixture();
  installRowChange(content);
  content.enemies.forEach((enemy) => { enemy.hp = 10000; });
  return content;
}
