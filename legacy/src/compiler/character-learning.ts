import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import { validateObservedLearningCatalog, type ObservedLearningCatalog } from "../core/character-learning.js";

type Reader = { row(table: string, id: string | number): BattleRow };
type Tables = Record<string, Record<string, string>[]>;
/** The exchange list is a source asset dependency, never a runtime guess. */
export function compileObservedLearning(
  reader: Reader,
  tables: Tables,
  misc: { exchange_learning_ability: { before_ability_id: number; after_ability_id: number }[] },
): { catalog: ObservedLearningCatalog; sources: BattleRow["source"][] } {
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id); sources.push(found.source); return found.values;
  };
  if (!Array.isArray(tables["ability.csv"]) || !Array.isArray(tables["content.csv"]) ||
      !Array.isArray(tables["ability_group.csv"]) || !Array.isArray(tables["chanting.csv"]) || !Array.isArray(misc.exchange_learning_ability))
    throw new Error("Missing source observed learning tables or exchange asset");
  const mapping = new Map<number, number>();
  for (const exchange of misc.exchange_learning_ability) {
    if (!Number.isSafeInteger(exchange.before_ability_id) || exchange.before_ability_id <= 0 ||
        !Number.isSafeInteger(exchange.after_ability_id) || exchange.after_ability_id <= 0 ||
        mapping.has(exchange.before_ability_id)) throw new Error("Ambiguous observed learning exchange");
    row("ability.csv", exchange.before_ability_id); row("ability.csv", exchange.after_ability_id);
    mapping.set(exchange.before_ability_id, exchange.after_ability_id);
  }
  const command = row("command.csv", 17);
  const commandAbilityTypes = tables["ability_group.csv"]
    .filter((r) => int(r.group_id) === int(command.ability_group_id))
    .map((r) => int(row("chanting.csv", row("ability_group.csv", r.id!).type_id!).ability_type_id));
  const candidates = tables["ability.csv"].filter((a) => int(a.type_id) === 504).map((a) => {
    const observed = row("ability.csv", a.id!);
    const abilityId = mapping.get(int(observed.id)) ?? int(observed.id);
    const ability = row("ability.csv", abilityId);
    const contentRows = tables["content.csv"]!.filter((c) => int(c.type_id) === 4 && int(c.type_value) === abilityId);
    if (contentRows.length !== 1) throw new Error("Missing or ambiguous observed learning content");
    const content = row("content.csv", contentRows[0]!.id!);
    return { observedAbilityId: int(observed.id), abilityId, contentId: int(content.id),
      typeId: int(ability.type_id), groupId: int(ability.ability_group_id) };
  });
  const catalog: ObservedLearningCatalog = { kind: "observed-learning-v1", observerSourceId: 8,
    recipientAbilityId: 74, commandId: 17, forbiddenConditionTypes: [5,11,9,7,17,34,12,630,410],
    commandAbilityTypes, candidates };
  validateObservedLearningCatalog(catalog);
  return { catalog, sources };
}
