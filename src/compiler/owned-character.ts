import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import { compileEquipmentCatalog, compileEquipmentParameterContext } from "./equipment.js";
import { confirmPlayerParameters, parameterNames, type ParameterValues } from "../core/parameters.js";
import { validateEquipmentLoadout, projectEquipmentParameters } from "../core/equipment.js";
import { createOwnedCharacter, type OwnedCharacterAbilities, type OwnedCharacterInitializationTemplate } from "../core/owned-character.js";
import type { OrdinaryWeaponEffectsCatalog } from "../core/ordinary-weapon.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = {
  row(table: string, id: string | number): BattleRow;
  matching(table: string, key: string, value: string | number): BattleRow[];
  group(table: string, key: string, value: string | number): BattleRow[];
  unique(table: string, key: string, value: string): BattleRow;
};

/** FF6 InitialPossessionAbilityData::.ctor 0x84f8a0. IDs absent from the
 * owner's source ability_random_group are skipped by UpdateAbilityData. */
export const initialPossessionAbilityIds: Readonly<Record<number, readonly number[]>> = {
  1: [31, 40, 228, 218, 219, 220, 221, 222, 223, 224, 225],
  2: [229, 218, 219, 220, 222],
  3: [230, 218, 219, 220, 222, 124],
  4: [231, 218, 219, 220, 221, 222],
  5: [232, 218, 219, 220, 221, 222],
  6: [233, 218, 219, 220, 221, 222, 132],
  7: [234, 218, 219, 220, 221, 222, 41],
  8: [235, 218, 219, 220, 221, 222, 143, 147, 160],
  9: [236, 218, 219, 220, 221, 222],
  10: [237, 210, 211, 212, 213, 214, 215, 216, 112, 218, 219, 220, 222],
  11: [238, 218, 219, 220, 221, 222],
  12: [811, 814, 819, 821, 825, 846, 854, 857, 866, 218, 219, 220, 222],
  13: [239, 218, 219, 220, 221, 222],
  14: [201, 218, 219, 220, 221, 222],
  31: [218, 219, 220, 221, 222],
  32: [218, 219, 220, 221, 222],
};

/** AddFromMaster for the ordinary, condition-free initialization path. Source
 * rows retain unavailable mechanics; no growth or battle action is fabricated. */
export function compileOwnedCharacterInitialization(
  reader: Reader,
  tables: Tables,
  sourceId: number,
  name: (key: string) => string,
  ordinaryWeaponEffects: OrdinaryWeaponEffectsCatalog,
): { template: OwnedCharacterInitializationTemplate; sources: BattleRow["source"][] } {
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id);
    sources.push(found.source);
    return found.values;
  };
  const all = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error("Missing initialization table: " + table);
    return tables[table]!.map((r) => row(table, r.id!));
  };
  const character = row("character_status.csv", sourceId);
  const nameBindings = all("character_default_name.csv").filter((r) => int(r.character_id) === sourceId);
  if (nameBindings.length > 1) throw new Error("Ambiguous initial character name tag");
  const nameTag = nameBindings[0]?.tag_name ?? null;
  if (int(character.initial_condition_group) !== 0)
    throw new Error("Unresolved owned initialization conditions: " + sourceId);
  if (int(character.hp) <= 0)
    throw new Error("Unresolved zero-base-HP initialization provider");
  const job = row("job.csv", character.job_id!);
  // RemoveJobCommand/AddJobCommand are inert for FF6's five zero replacements.
  // Their three missing command-content records remain three zero sentinels.
  for (let i = 1; i <= 5; i++)
    if (int(job[`change_command_${i}`]) !== 0)
      throw new Error("Unresolved initial job command replacement");
  if (int(job.initial_condition) !== 0)
    throw new Error("Unresolved initial job condition");
  const content = all("content.csv");
  if (content.some((r) => int(r.type_id) === 7 && int(r.type_value) === 0))
    throw new Error("Unexpected zero job command content");
  const commands = all("command.csv");
  const subCommands = all("sub_command.csv");
  const initialCommands = Array.from({ length: 6 }, (_, i) => int(character[`command_id${i + 1}`]))
    .filter((id) => id !== 0);
  initialCommands.forEach((id) => row("command.csv", id));
  const abilityRows = new Map<number, Record<string, string>>();
  const randomGroupId = int(character.ability_random_group_id);
  const randomGroup = randomGroupId === 0 ? [] : all("ability_random_group.csv")
    .filter((r) => int(r.group_id) === randomGroupId);
  if (randomGroupId !== 0 && !randomGroup.length)
    throw new Error("Missing initial owned ability group");
  const owned = randomGroup.map((r) => {
    const abilityId = int(r.ability_id);
    const ability = row("ability.csv", abilityId);
    abilityRows.set(abilityId, ability);
    const matches = content.filter((c) => int(c.type_id) === 4 && int(c.type_value) === abilityId);
    if (matches.length > 1) throw new Error("Ambiguous initial owned ability content");
    return { abilityId, contentId: matches[0] ? int(matches[0].id) : 0, skillLevel: 0 };
  });
  if (new Set(owned.map((a) => a.abilityId)).size !== owned.length)
    throw new Error("Duplicate initial owned ability identity");
  const additionOrder: number[] = [];
  for (const id of initialPossessionAbilityIds[sourceId] ?? []) {
    const ability = owned.find((a) => a.abilityId === id);
    if (!ability) continue;
    if (!ability.contentId) throw new Error("Missing initial learned ability content");
    ability.skillLevel = 100;
    if (!additionOrder.includes(ability.contentId)) additionOrder.push(ability.contentId);
  }
  // GetValue reads these actual ability identities, regardless of SkillLevel;
  // HasTwoSwordStyle reads TypeId 12, and HasTwohand reads ability 251.
  const passiveIds = [244, 245, 256, 257, 258, 259, 286, 287, 288, 289];
  if (owned.some((a) => passiveIds.includes(a.abilityId)))
    throw new Error("Unresolved initial passive parameter ability");
  if (owned.some((a) => a.abilityId === 251 || int(abilityRows.get(a.abilityId)!.type_id) === 12))
    throw new Error("Unresolved initial two-hand or dual-wield ability");
  const groups = all("ability_group.csv");
  const byCommand: OwnedCharacterAbilities["byCommand"] = [];
  for (const commandId of initialCommands) {
    const command = row("command.csv", commandId);
    const matches: number[] = [];
    for (const group of groups.filter((g) => int(g.group_id) === int(command.ability_group_id))) {
      const chanting = row("chanting.csv", group.type_id!);
      for (const ability of owned) {
        const master = abilityRows.get(ability.abilityId)!;
        if (int(master.type_id) === int(chanting.ability_type_id) && int(master.ability_group_id) !== 0 && ability.skillLevel >= 100)
          matches.push(ability.abilityId);
      }
    }
    if (!matches.length) continue;
    const existing = byCommand.find((c) => c.commandId === commandId);
    if (existing) {
      for (const id of matches) if (!existing.abilityIds.includes(id)) existing.abilityIds.push(id);
    } else byCommand.push({ commandId, abilityIds: matches });
  }
  const commandIds = [...initialCommands];
  for (const command of commands) {
    if (![2, 5, 6].includes(int(command.command_type))) continue;
    const children = subCommands.filter((s) => int(s.command_id) === int(command.id));
    if (children.length > 1) throw new Error("Ambiguous initial sub-command");
    if (!children[0] || [1, 2].includes(int(children[0].type_id))) commandIds.push(int(command.id));
  }
  const jobId = int(job.id);
  const curves = all("intermediate_growth_curve.csv")
    .filter((r) => int(r.character_id) === sourceId && int(r.job_id) === jobId);
  if (curves.length !== 1) throw new Error("Unresolved initialization experience curve");
  const expLimit = reader.unique("game_constant_int.csv", "key_name", "MAX_EXP");
  const levelLimit = reader.unique("game_constant_int.csv", "key_name", "MAX_LV");
  sources.push(expLimit.source, levelLimit.source);
  const exp = Math.min(int(character.exp), int(expLimit.values.value1));
  if (exp < 0) throw new Error("Invalid initial experience");
  const levels = all("exp_table.csv").filter((r) => int(r.group_id) === int(curves[0]!.exp_table_group_id) && int(r.type_id) === 1 && int(r.total_exp) <= exp);
  if (!levels.length) throw new Error("Missing initial experience level");
  const additionalLevel = Math.max(...levels.map((r) => int(r.lv)));
  if (additionalLevel < 1 || additionalLevel > int(levelLimit.values.value1))
    throw new Error("Unresolved initial level limit");
  const equipment = Array.from({ length: 6 }, (_, i) => int(character[`content_id${i + 1}`]));
  if (equipment.includes(317)) throw new Error("Unresolved initial equip-any-job ability");
  const emptyIds = content.filter((c) => [2, 3].includes(int(c.type_id)))
    .filter((c) => int(row(int(c.type_id) === 2 ? "weapon.csv" : "armor.csv", c.type_value!).type_id) === 2)
    .map((c) => int(c.id));
  const compiledEquipment = compileEquipmentCatalog(reader, [...new Set([...equipment, ...emptyIds])], [sourceId], name,
    { [sourceId]: { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false } }, ordinaryWeaponEffects);
  sources.push(...compiledEquipment.sources);
  // Constructor-created additional/correction/temporary blocks start at zero.
  // The guards above establish zero passive and no condition/equipment provider.
  const zero = Object.fromEntries(parameterNames.map((key) => [key, 0])) as ParameterValues;
  const parameters = compileEquipmentParameterContext(reader, sourceId, {
    additional: { hp: 0, mp: 0, magic: 0, vitality: 0, agility: 0, weight: 0 },
    correction: { magic: 0, vitality: 0, agility: 0 },
    temporary: zero, passive: { hp: 0, mp: 0, magicEvasion: 0 },
    condition601: false, twoHandMultiplier: 1,
  }, { additionalStrength: 0, correctionStrength: 0, temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 } });
  sources.push(...parameters.sources);
  validateEquipmentLoadout(compiledEquipment.catalog, { id: "initialization", sourceId, equipment });
  const confirmed = projectEquipmentParameters(compiledEquipment.catalog, equipment, parameters.context, parameters.limits).parameters;
  const beforeEquipment = confirmPlayerParameters({ ...parameters.context.parameters, equipment: [] }, parameters.limits.parameters);
  const template: OwnedCharacterInitializationTemplate = {
    kind: "owned-character-initialization-v1",
    nameKey: character.mes_id_name!,
    nameTag,
    initial: {
      sourceId, enabled: true, jobId, additionalLevel, magicStoneId: 0,
      name: name(character.mes_id_name!), level: additionalLevel, exp,
      hp: beforeEquipment.hp, mp: beforeEquipment.mp, maxHp: confirmed.hp, maxMp: confirmed.mp,
      conditionIds: [], equipment,
      abilities: { commandIds, owned, byCommand, additionOrder, sortOrder: [],
        slots: Array.from({ length: 8 }, (_, i) => ({ level: i + 1, abilityIds: [null, null, null] })),
        skillLevelTargets: {}, learning: [], equipment: [0, 0, 0] },
    },
    parameterContext: parameters.context,
    limits: parameters.limits,
    equipmentCharacter: compiledEquipment.catalog.characters[sourceId]!,
    confirmed,
    base: { level: int(character.lv), intelligence: int(character.intelligence), spirit: int(character.spirit), luck: int(character.luck),
      mpCounts: Array.from({ length: 8 }, (_, i) => int(character[`magical_times${i + 1}`])) },
    jobIds: all("job.csv").map((r) => int(r.id)),
  };
  // Validate the detached product before exposing a compilable capability.
  createOwnedCharacter(template, { id: "initialization", ownedId: 1, releasedJobIds: [], learnedAbilityIds: [] });
  return { template, sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()] };
}
