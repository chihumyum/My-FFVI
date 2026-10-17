import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import type { BattleAbilityCatalog } from "../core/battle-abilities.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = { row(table: string, id: string | number): BattleRow };

/** Source menu metadata is independent of executable ability-effect plans.
 * An unsupported source provider is retained as a blocker on its entry. */
export function compileBattleAbilityCatalog(
  reader: Reader,
  tables: Tables,
  sourceIds: readonly number[],
): { catalog: BattleAbilityCatalog; sources: BattleRow["source"][] } {
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some((id) => !Number.isInteger(id) || id <= 0))
    throw new Error("Invalid battle ability character identities");
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id);
    sources.push(found.source);
    return found.values;
  };
  const all = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error("Missing battle ability table: " + table);
    return tables[table]!.map((r) => row(table, r.id!));
  };
  const commandRows = all("command.csv");
  const subcommands = all("sub_command.csv");
  const groups = all("ability_group.csv");
  const conditionGroups = all("condition_group.csv");
  const contents = all("content.csv");
  const commandIds = new Set<number>();
  const characters = sourceIds.map((sourceId) => {
    const character = row("character_status.csv", sourceId);
    const jobId = int(character.job_id);
    const job = row("job.csv", jobId);
    const blockers: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const commandId = int(character[`command_id${i}`]);
      if (commandId) commandIds.add(commandId);
    }
    if (Array.from({ length: 5 }, (_, i) => int(job[`change_command_${i + 1}`])).some((id) => id !== 0))
      blockers.push("Unresolved job command replacement");
    if (sourceId === 13) blockers.push("Unresolved Gogo party/equipment ability provider");
    return { sourceId, jobId, blockers };
  });
  // AddFromMaster appends shared subcommands. Their UI menu admission is a
  // separate step driven by command_type and SystemConfig.BattleType.
  for (const command of commandRows) {
    if (![2, 5, 6].includes(int(command.command_type))) continue;
    const children = subcommands.filter((s) => int(s.command_id) === int(command.id));
    if (children.length > 1) throw new Error("Ambiguous battle ability sub-command");
    if (!children[0] || [1, 2].includes(int(children[0].type_id))) commandIds.add(int(command.id));
  }
  const abilities = all("ability.csv").map((r) => ({ id: int(r.id), typeId: int(r.type_id), groupId: int(r.ability_group_id), range: int(r.renge_id) }));
  const conditions = all("condition.csv").map((r) => ({ id: int(r.id), type: int(r.condition_type) }));
  const commands = [...commandIds].map((id) => {
    const r = row("command.csv", id);
    const blockers: string[] = [];
    const groupId = int(r.ability_group_id);
    const abilityTypes = groups.filter((g) => int(g.group_id) === groupId)
      .map((g) => int(row("chanting.csv", g.type_id!).ability_type_id));
    if (groupId && !abilityTypes.length) throw new Error("Missing battle command ability group: " + id);
    const conditionGroupId = int(r.condition_group_id);
    const forbiddenConditionIds = conditionGroups.filter((g) => int(g.group_id) === conditionGroupId)
      .map((g) => int(g.condition_id));
    if (conditionGroupId && !forbiddenConditionIds.length) throw new Error("Missing battle command condition group: " + id);
    for (const conditionId of forbiddenConditionIds) row("condition.csv", conditionId);
    const abilityId = int(r.ability_id);
    const commandContents = contents.filter((c) => int(c.type_id) === 7 && int(c.type_value) === id);
    if (commandContents.length > 1) throw new Error("Ambiguous battle command content: " + id);
    if (abilityId) row("ability.csv", abilityId);
    const releaseType = int(r.release_type);
    const releaseValues: [number, number] = [int(r.release_value1), int(r.release_value2)];
    if ([3, 5].includes(releaseType))
      for (const conditionId of releaseValues) if (conditionId) row("condition.csv", conditionId);
    if (![0, 3, 5].includes(releaseType)) blockers.push("Unresolved command availability release type: " + releaseType);
    if (![1, 2, 5, 6].includes(int(r.command_type))) blockers.push("Unresolved command menu type: " + r.command_type);
    return {
      id, nameKey: r.mes_id_name!, type: int(r.command_type), listType: int(r.list_type),
      executionType: int(r.execution_type), abilityId, contentId: commandContents[0] ? int(commandContents[0].id) : null,
      abilityTypes, releaseType, releaseValues,
      forbiddenConditionIds, blockers,
    };
  });
  return { catalog: { kind: "battle-abilities-v1", characters, commands, abilities, conditions },
    sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()] };
}
