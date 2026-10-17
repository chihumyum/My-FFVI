import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import type { OwnedCharacterInitializationTemplate } from "../core/owned-character.js";
import { initialCharacterGrowth, validateCharacterGrowth, type CharacterGrowthPlan } from "../core/character-growth.js";

import type { ObservedLearningCatalog } from "../core/character-learning.js";
import { validateMagicStoneCatalog, type MagicStoneCatalog } from "../core/magic-stones.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
};

/** Compile the FF6 ordinary StatusUp path. Initialization, experience and
 * growth are separate source inputs; the source character's exp is a base. */
export function compileCharacterGrowth(
  reader: Reader,
  tables: Tables,
  template: OwnedCharacterInitializationTemplate,
  observedLearning?: ObservedLearningCatalog,
  magicStones?: MagicStoneCatalog,
  currentJob?: {sourceId:number;initialJobId:number;jobId:number},
): { plan: CharacterGrowthPlan; sources: BattleRow["source"][] } {
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id);
    sources.push(found.source);
    return found.values;
  };
  const all = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error("Missing character growth table: " + table);
    return tables[table]!.map((r) => row(table, r.id!));
  };
  const limit = (key: string) => {
    const found = reader.unique("game_constant_int.csv", "key_name", key);
    sources.push(found.source);
    return int(found.values.value1);
  };
  const sourceId = template.initial.sourceId;
  const jobId = currentJob?.jobId ?? template.initial.jobId;
  if(currentJob && (currentJob.sourceId!==sourceId || currentJob.initialJobId!==template.initial.jobId || !Number.isSafeInteger(jobId) || jobId<1))
    throw new Error("Invalid explicit source growth job context");
  const character = row("character_status.csv", sourceId);
  if (int(character.job_id) !== (currentJob?.initialJobId ?? jobId) || template.initial.magicStoneId !== 0)
    throw new Error("Unresolved character growth job or magic stone origin");
  const curves = all("intermediate_growth_curve.csv")
    .filter((r) => int(r.character_id) === sourceId && int(r.job_id) === jobId);
  if (curves.length !== 1) throw new Error("Unresolved character growth curve");
  const curve = curves[0]!;
  const maxExp = limit("MAX_EXP"), maxLevel = limit("MAX_LV");
  const experience = all("exp_table.csv")
    .filter((r) => int(r.group_id) === int(curve.exp_table_group_id) && int(r.type_id) === 1)
    .map((r) => ({ id: int(r.id), level: int(r.lv), totalExp: int(r.total_exp) }))
    .sort((a, b) => a.level - b.level);
  // CorrectLevel uses the globally keyed ExpTable ID. This source's selected
  // curve has one row per level with id=level. Do not substitute a group lookup
  // for an unrelated ID when importing another curve.
  if (experience.some((r) => r.id !== r.level))
    throw new Error("Unresolved correction experience identity");
  const growthRows = all("growth_curve.csv")
    .filter((r) => int(r.group_id) === int(curve.growth_curve_group_id));
  // FF6 Execution directly reads HpValue1/MpValue1; it does not invoke the
  // shared random insertion helpers. Limit import to the observed fixed table
  // shape rather than silently accepting another game's curve semantics.
  if (growthRows.some((r) => [1, 2, 3].some((i) => int(r[`insert_type_${i}`]) !== 1) ||
    int(r.hp_value2) !== 0 || int(r.mp_value2) !== 0))
    throw new Error("Unresolved character growth insertion shape");
  const growth = growthRows
    .map((r) => ({ id: int(r.id), level: int(r.lv), hp: int(r.hp_value1), mp: int(r.mp_value1) }))
    .sort((a, b) => a.level - b.level);
  const learningRows = all("learning.csv");
  if (learningRows.some((r) => ![1, 2, 3, 4].includes(int(r.type_id))))
    throw new Error("Unknown character learning provider");
  if (learningRows.some((r) => int(r.type_id) === 2 && int(r.value1) === 0))
    throw new Error("Unresolved learning for no magic stone");
  const natural = learningRows.filter((r) => int(r.type_id) === 1 && int(r.job_id) === jobId);
  const learning = natural.map((r) => {
    const content = row("content.csv", r.content_id!);
    if (int(content.type_id) !== 4) throw new Error("Unresolved natural learning content kind");
    return { id: int(r.id), level: int(r.value1), abilityId: int(content.type_value), contentId: int(content.id) };
  });
  const stoneLearning = magicStones ? Object.values(magicStones.stones).flatMap(stone => stone.learning) : [];
  if (magicStones) {
    validateMagicStoneCatalog(magicStones);
    const referencedIds = new Set<number>();
    for (const stone of Object.values(magicStones.stones)) {
      const expected = learningRows.filter(r => int(r.type_id) === 2 && int(r.value1) === stone.contentId);
      if (expected.length !== stone.learning.length || expected.some((r, i) => int(r.id) !== stone.learning[i]!.id))
        throw new Error("Changed magic stone learning enumeration");
      for (const binding of stone.learning) {
        const r = row("learning.csv", binding.id);
        if (int(r.type_id) !== 2 || int(r.value1) !== stone.contentId ||
            int(r.content_id) !== binding.contentId || int(r.value2) !== binding.rate || referencedIds.has(binding.id))
          throw new Error("Changed magic stone growth learning identity");
        referencedIds.add(binding.id);
      }
    }
    if (learningRows.some(r => int(r.type_id) === 2 && !referencedIds.has(int(r.id))))
      throw new Error("Incomplete magic stone growth learning catalog");
  }
  const abilityIds = [...new Set([...template.initial.abilities.owned.map((a) => a.abilityId), ...learning.map((r) => r.abilityId), ...(observedLearning?.candidates.map((r) => r.abilityId) ?? []), ...stoneLearning.map(r => r.abilityId)])];
  const abilities = abilityIds.map((id) => {
    const source = row("ability.csv", id);
    const contents = new Set([
      ...template.initial.abilities.owned.filter((a) => a.abilityId === id).map((a) => a.contentId),
      ...learning.filter((r) => r.abilityId === id).map((r) => r.contentId),
      ...(observedLearning?.candidates.filter((r) => r.abilityId === id).map((r) => r.contentId) ?? []),
      ...stoneLearning.filter(r => r.abilityId === id).map(r => r.contentId),
    ]);
    if (contents.size !== 1) throw new Error("Ambiguous growth ability content");
    const contentId = [...contents][0]!;
    if (contentId) {
      const content = row("content.csv", contentId);
      if (int(content.type_id) !== 4 || int(content.type_value) !== id)
        throw new Error("Changed growth ability content identity");
    }
    return { id, typeId: int(source.type_id), groupId: int(source.ability_group_id), contentId };
  });
  // These passive getters inspect ownership independently of SkillLevel.
  // A natural-learning grant must not bypass the initialization admission gate.
  const passiveIds = [244, 245, 251, 256, 257, 258, 259, 286, 287, 288, 289];
  if (abilities.some((a) => passiveIds.includes(a.id) || a.typeId === 12))
    throw new Error("Unresolved learned passive parameter ability");
  const groups = all("ability_group.csv");
  const commandIds = Array.from({ length: 6 }, (_, i) => int(character[`command_id${i + 1}`]))
    .filter((id) => id !== 0);
  if (magicStones)
    // Initialization also appends source common commands (for example row and
    // defend). Dynamic projection reads that complete owned list, not only the
    // six character_status slots. Metadata closure does not grant a command.
    for (const id of [...template.initial.abilities.commandIds,
      magicStones.rules.magicCommandId, magicStones.rules.alternativeMagicCommandId])
      if (!commandIds.includes(id)) commandIds.push(id);
  const commands = commandIds.map((id) => {
      const command = row("command.csv", id);
      const abilityTypes = groups.filter((r) => int(r.group_id) === int(command.ability_group_id))
        .map((group) => int(row("chanting.csv", group.type_id!).ability_type_id));
      return { id, abilityTypes };
    });
  const plan: CharacterGrowthPlan = {
    kind: "character-growth-v1", sourceId, jobId,
    ...(observedLearning ? { observedLearning: structuredClone(observedLearning) } : {}),
    ...(magicStones ? { magicStones: structuredClone(magicStones) } : {}),
    baseExp: Math.min(maxExp, int(character.exp)), initialLevel: template.initial.level,
    maxExp, maxLevel, experience, growth, learning, abilities, commands,
    initialAbilities: structuredClone(template.initial.abilities),
    equipmentLearningContentIds: [...new Set(learningRows.filter((r) => int(r.type_id) === 4).map((r) => int(r.value1)))],
    hasBattleBackgroundLearning: learningRows.some((r) => int(r.type_id) === 3 && int(r.job_id) === jobId),
    observedLearningAbilityIds: all("ability.csv").filter((r) => int(r.type_id) === 504).map((r) => int(r.id)),
  };
  validateCharacterGrowth(plan, {...template.initial,jobId}, initialCharacterGrowth(plan));
  return { plan, sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()] };
}
