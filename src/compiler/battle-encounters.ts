import type { BattleAISource } from "../core/battle-ai.js";
import type { BattleRow } from "./battle.js";
import { battleAIAbilities, compileBattleAI } from "./battle-ai.js";
import { compileElementResistances } from "./elements.js";
import { compileConditionResistances, ConditionResistanceCompilationError } from "./condition-resistances.js";
import { tableInteger } from "./table.js";
import type { BattleFormationPatterns } from "../core/battle-formations.js";

export type BattleEncounterDiagnostic = {
  partyId: number;
  code: string;
  reason: string;
  source: BattleRow["source"] | null;
  dependency?: { table: string; id: number; field?: string };
};
export type BattleEncounterJson = { data: unknown; source: BattleAISource };
export type SourceBattleEncounter = {
  partyId: number;
  source: BattleRow["source"];
  /** All source eligibility bits, including pattern 6. No random pattern is
   * chosen by importing a party or by taking its first nonzero field. */
  patterns: BattleFormationPatterns;
  enemies: {
    slot: number;
    monsterId: number;
    group: number;
    x: number;
    y: number;
    sprite: string;
    ai: BattleEncounterJson;
    aiAbilityIds: number[];
  }[];
  script: BattleEncounterJson | null;
  background: string;
  metadata: {
    battleFlagGroupId: number;
    battleFlags: BattleRow[];
    backgroundId: number;
    bgmId: number;
    appearanceProduction: number;
    notEscape: number;
    getAp: number;
    getValue: number;
    scriptId: number;
  };
};
export type BattleEncounterSourceInput = {
  partyIds: readonly number[];
  json(name: string): BattleEncounterJson;
  spritePath(suffix: string): string;
};
type Reader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
};
type Dependency = NonNullable<BattleEncounterDiagnostic["dependency"]>;

class EncounterFailure extends Error {
  constructor(readonly code: string, message: string, readonly source: BattleRow["source"] | null,
    readonly dependency?: Dependency) { super(message); }
}
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function tableNumber(row: BattleRow, table: string, key: string, minimum = 0): number {
  let value: number;
  try { value = tableInteger(row.values[key]); }
  catch (error) {
    throw new EncounterFailure("invalid-source-value", `${table}:${row.values.id}.${key}: ${reason(error)}`,
      row.source, { table, id: tableInteger(row.values.id), field: key });
  }
  if (value < minimum || value > 0x7fffffff)
    throw new EncounterFailure("invalid-source-value", `Invalid ${table}:${row.values.id}.${key}: ${value}`,
      row.source, { table, id: tableInteger(row.values.id), field: key });
  return value;
}
function tableName(row: BattleRow, table: string, key: string): string {
  const name = row.values[key];
  if (typeof name !== "string" || !name.length)
    throw new EncounterFailure("invalid-source-value", `Missing ${table}:${row.values.id}.${key}`, row.source,
      { table, id: tableInteger(row.values.id), field: key });
  return name;
}

/** Source selection and dependency resolution only. A result is not permission
 * to execute AI, ignore battle scripts/flags, grant rewards or enter combat.
 * Callers run the separate runtime capability compiler for every descriptor. */
export function compileBattleEncounterSources(reader: Reader, input: BattleEncounterSourceInput): {
  requestedPartyIds: number[];
  encounters: SourceBattleEncounter[];
  diagnostics: BattleEncounterDiagnostic[];
} {
  if (!Array.isArray(input.partyIds) || !input.partyIds.length || input.partyIds.some((id) =>
    !Number.isInteger(id) || id <= 0 || id > 0x7fffffff) || new Set(input.partyIds).size !== input.partyIds.length)
    throw new Error("Invalid or duplicate encounter party selection");
  const requestedPartyIds = [...input.partyIds].sort((a, b) => a - b);
  const encounters: SourceBattleEncounter[] = [], diagnostics: BattleEncounterDiagnostic[] = [];
  for (const partyId of requestedPartyIds) {
    let partySource: BattleRow["source"] | null = null;
    const row = (table: string, identity: string | number): BattleRow => {
      const id = tableInteger(String(identity));
      try {
        const found = reader.row(table, id);
        if (tableInteger(found.values.id) !== id || found.source.rowId !== String(id))
          throw new Error("Resolved row has a different identity");
        return found;
      } catch (error) {
        throw new EncounterFailure("table-reference", reason(error), partySource, { table, id });
      }
    };
    const asset = <T>(read: () => T, label: string, source: BattleRow["source"], dependency: Dependency): T => {
      try { return read(); }
      catch (error) { throw new EncounterFailure("asset-reference", `${label}: ${reason(error)}`, source, dependency); }
    };
    try {
      const party = row("monster_party.csv", partyId);
      partySource = party.source;
      const number = (key: string) => tableNumber(party, "monster_party.csv", key);
      const patterns = Array.from({ length: 6 }, (_, i) => number(`battle_pattern${i + 1}`)) as SourceBattleEncounter["patterns"];
      const enabled = patterns.flatMap((value, i) => value ? [i + 1] : []);
      if (patterns.some((value) => value !== 0 && value !== 1) || !enabled.length)
        throw new EncounterFailure("formation", `Invalid battle formation values: ${patterns.join(",")}`,
          partySource, { table: "monster_party.csv", id: partyId, field: "battle_pattern1..6" });
      const battleFlagGroupId = number("battle_flag_group_id");
      let battleFlags: BattleRow[] = [];
      if (battleFlagGroupId) {
        try {
          battleFlags = reader.group("battle_flag_group.csv", "group_id", battleFlagGroupId);
          if (!battleFlags.length || battleFlags.some((flag) =>
            tableNumber(flag, "battle_flag_group.csv", "group_id") !== battleFlagGroupId))
            throw new Error("Missing or mismatched battle flag group");
          for (const flag of battleFlags) tableNumber(flag, "battle_flag_group.csv", "battle_flag_id", 1);
        } catch (error) {
          throw new EncounterFailure("table-reference", reason(error), partySource,
            { table: "battle_flag_group.csv", id: battleFlagGroupId, field: "group_id" });
        }
      }
      const metadata: SourceBattleEncounter["metadata"] = {
        battleFlagGroupId, battleFlags,
        backgroundId: number("battle_background_asset_id"), bgmId: number("battle_bgm_asset_id"),
        appearanceProduction: number("appearance_production"), notEscape: number("not_escape"),
        getAp: number("get_ap"), getValue: number("get_value"), scriptId: number("script_name"),
      };
      const enemies: SourceBattleEncounter["enemies"] = [];
      for (let slot = 1; slot <= 9; slot++) {
        const id = number(`monster${slot}`);
        if (!id) continue;
        const monster = row("monster.csv", id);
        const resistanceGroup = tableNumber(monster, "monster.csv", "resistance_condition");
        try { compileConditionResistances(reader, resistanceGroup); }
        catch (error) {
          throw new EncounterFailure("condition-resistance-reference", reason(error), monster.source,
            error instanceof ConditionResistanceCompilationError ? error.dependency
              : { table: "monster.csv", id, field: "resistance_condition" });
        }
        const spriteId = tableNumber(monster, "monster.csv", "monster_asset_id", 1);
        const media = row("monster_asset.csv", spriteId);
        const aiId = tableNumber(monster, "monster.csv", "script_id", 1);
        const aiRow = row("monster_ai_script.csv", aiId);
        const aiName = tableName(aiRow, "monster_ai_script.csv", "script_name");
        const decoded = asset(() => {
          const ai = input.json(aiName);
          return { ai, aiAbilityIds: battleAIAbilities(compileBattleAI(ai.data, ai.source)) };
        }, "Monster AI " + aiName, aiRow.source, { table: "monster_ai_script.csv", id: aiId });
        for (const abilityId of decoded.aiAbilityIds) row("ability.csv", abilityId);
        const suffix = `/${tableName(media, "monster_asset.csv", "group_name")}_${tableName(media, "monster_asset.csv", "asset_name")}.png`;
        const sprite = asset(() => input.spritePath(suffix), "Monster sprite " + suffix, media.source,
          { table: "monster_asset.csv", id: spriteId });
        compileElementResistances({ row, group: reader.group.bind(reader) },
          tableNumber(monster, "monster.csv", "resistance_attribute"));
        enemies.push({ slot, monsterId: id, group: number(`monster${slot}_group`),
          x: tableNumber(party, "monster_party.csv", `monster${slot}_x_position`, -0x80000000),
          y: tableNumber(party, "monster_party.csv", `monster${slot}_y_position`, -0x80000000), sprite, ...decoded });
      }
      if (!enemies.length) throw new EncounterFailure("members", "Encounter has no source monster members", partySource);
      const background = row("battle_background_asset.csv", metadata.backgroundId);
      const suffix = `/${tableName(background, "battle_background_asset.csv", "asset_name")}.png`;
      const backgroundSprite = asset(() => input.spritePath(suffix), "Battle background " + suffix, background.source,
        { table: "battle_background_asset.csv", id: metadata.backgroundId });
      let script: BattleEncounterJson | null = null;
      if (metadata.scriptId) {
        const scriptRow = row("script.csv", metadata.scriptId);
        const name = tableName(scriptRow, "script.csv", "script_name");
        script = asset(() => input.json(name), "Battle script " + name, scriptRow.source,
          { table: "script.csv", id: metadata.scriptId });
      }
      encounters.push(structuredClone({ partyId, source: partySource, patterns,
        enemies, script, background: backgroundSprite, metadata }));
    } catch (error) {
      diagnostics.push(structuredClone({ partyId,
        code: error instanceof EncounterFailure ? error.code : "source-dependency",
        reason: reason(error), source: error instanceof EncounterFailure ? error.source : partySource,
        ...(error instanceof EncounterFailure && error.dependency ? { dependency: error.dependency } : {}) }));
    }
  }
  return { requestedPartyIds, encounters, diagnostics };
}
