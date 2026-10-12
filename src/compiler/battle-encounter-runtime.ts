import type { BattleAISource } from "../core/battle-ai.js";
import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import type {
  AbilityDefinition, BattleEncounter, BattleEncounterDiagnostic, BattleEncounterReport,
  CombatantDefinition,
} from "../core/battle-content.js";
import type { ParameterLimits, ParameterValues } from "../core/parameters.js";
import type { PhysicalLimits } from "../core/physical-parameters.js";
import type { PhysicalParameters } from "../core/physical.js";
import type { BattleRow } from "./battle.js";
import type { BattleEncounterDiagnostic as SourceDiagnostic, SourceBattleEncounter } from "./battle-encounters.js";
import { battleAIAbilities, compileBattleAI } from "./battle-ai.js";
import { compileBattleDropCatalog } from "./battle-rewards.js";
import { compileElementResistances } from "./elements.js";
import { compileEnemyParameters } from "./parameters.js";
import { compileEnemyPhysical } from "./physical-parameters.js";
import { tableInteger as int } from "./table.js";
import { createBattleFormationPlan, type BattleFormationPlan,
  type FrameworkBattleFormationPolicy } from "../core/battle-formations.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
  matching(table: string, key: string, value: string | number): BattleRow[];
};
export type BattleEncounterRuntimeInput = {
  requestedPartyIds: readonly number[];
  encounters: readonly SourceBattleEncounter[];
  sourceDiagnostics: readonly SourceDiagnostic[];
  abilities: Readonly<Record<string, AbilityDefinition>>;
  conditions: BattleConditionCatalog;
  sprites: Readonly<Record<string, { file: string; width: number; height: number }>>;
  name(key: string): string;
  parameters: { temporary: ParameterValues; limits: ParameterLimits };
  physical: { temporary: PhysicalParameters; limits: PhysicalLimits };
  /** Explicit source-bound regression omissions, never runtime permissions to
   * execute an unimplemented script or a new flag group. */
  development: {
    /** Authored selection for non-fixed encounters; never the native weight rule. */
    formations?: FrameworkBattleFormationPolicy;
    scripts: readonly { id: number; source: BattleAISource; reason: string }[];
    flagGroups: readonly { id: number; rows: readonly BattleRow[]; reason: string }[];
  };
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const identity = (value: number) => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A batch of runtime definitions, not a playable-enemy count. Broken source
 * dependencies remove only their encounter. Conditional AI instructions/plans
 * remain in the program, with PCs in the report and the existing runtime gate.
 * Shared rule corruption (for example missing drop weights) still fails the batch. */
export function compileBattleEncounterRuntime(reader: Reader, input: BattleEncounterRuntimeInput) {
  const requested = [...input.requestedPartyIds];
  if (!requested.length || requested.some((id) => !identity(id)) ||
      new Set(requested).size !== requested.length ||
      new Set(input.encounters.map((e) => e.partyId)).size !== input.encounters.length ||
      input.encounters.some((e) => !requested.includes(e.partyId)) ||
      input.sourceDiagnostics.some((d) => !requested.includes(d.partyId)))
    throw new Error("Invalid runtime encounter selection");
  const diagnostics: BattleEncounterDiagnostic[] = input.sourceDiagnostics.map((d) => ({ ...d, kind: "blocked" }));
  const encounters: Record<string, BattleEncounter> = {};
  const entries: BattleEncounterReport["entries"] = [];
  const drops = compileBattleDropCatalog(reader,
    [...new Set(input.encounters.flatMap((e) => e.enemies.map((m) => m.monsterId)))]);

  for (const encounter of input.encounters) {
    const partyId = encounter.partyId, start = diagnostics.length;
    const add = (kind: BattleEncounterDiagnostic["kind"], code: string, reason: string,
      extra: Partial<Pick<BattleEncounterDiagnostic, "dependency" | "enemySlot" | "pc" | "source">> = {}) => {
      diagnostics.push({ partyId, kind, code, reason, source: encounter.source, ...extra });
    };
    const block = (code: string, reason: string, field?: string) => add("blocked", code, reason,
      { dependency: { table: "monster_party.csv", id: partyId, ...(field ? { field } : {}) } });
    const media = (key: string) => {
      const value = input.sprites[key];
      if (!value || typeof value.file !== "string" || !value.file.length ||
          !Number.isInteger(value.width) || value.width <= 0 || !Number.isInteger(value.height) || value.height <= 0)
        throw new Error("Missing or invalid battle sprite: " + key);
    };
    const enemies: CombatantDefinition[] = [];
    let formationPlan: BattleFormationPlan | null = null;
    try {
      const m = encounter.metadata;
      if (!encounter.source || encounter.source.rowId !== String(partyId) || !m)
        throw new Error("Invalid runtime encounter source binding");
      try {
        const enabled = encounter.patterns.flatMap((value, index) => value ? [index + 1] : []);
        const fixed = enabled.length === 1 && [1, 3].includes(enabled[0]!);
        formationPlan = createBattleFormationPlan(encounter.patterns, fixed ? undefined : input.development.formations);
        if (formationPlan.kind === "development") add("development-omission", "formation-selection",
          `Authored ${formationPlan.policy.id} formation weights replace the unresolved native selection; all source eligibility bits are retained`);
      } catch (error) { block("formation-selection", message(error), "battle_pattern1..6"); }
      media(encounter.background);
      if (!encounter.enemies.length || encounter.enemies.length > 9 ||
          new Set(encounter.enemies.map((e) => e.slot)).size !== encounter.enemies.length ||
          encounter.enemies.some((e) => !Number.isInteger(e.slot) || e.slot < 1 || e.slot > 9 ||
            !identity(e.monsterId) || ![1, 2].includes(e.group) ||
            !Number.isInteger(e.x) || !Number.isInteger(e.y)))
        throw new Error("Invalid runtime enemy slots or placement");
      if (!Number.isInteger(m.scriptId) || m.scriptId < 0 ||
          (m.scriptId === 0) !== (encounter.script === null))
        block("battle-script", "Missing or inconsistent battle script binding", "script_name");
      else if (m.scriptId) {
        const omission = input.development.scripts.find((s) => s.id === m.scriptId && same(s.source, encounter.script!.source));
        if (!omission) block("battle-script", "Battle script lifecycle is not implemented", "script_name");
        else add("development-omission", "battle-script", omission.reason,
          { dependency: { table: "script.csv", id: m.scriptId } });
      }
      if (!Number.isInteger(m.battleFlagGroupId) || m.battleFlagGroupId < 0 || !Array.isArray(m.battleFlags) ||
          (m.battleFlagGroupId === 0) !== (m.battleFlags.length === 0))
        block("battle-flags", "Missing or inconsistent battle flag binding", "battle_flag_group_id");
      else if (m.battleFlagGroupId) {
        if (m.battleFlags.some(flag => int(flag.values.battle_flag_id) === 27))
          block("formation-override", "ForceSideAttack requires an unimplemented battle formation provider", "battle_flag_group_id");
        const omission = input.development.flagGroups.find((g) => g.id === m.battleFlagGroupId && same(g.rows, m.battleFlags));
        if (!omission) block("battle-flags", "Battle flag group is not implemented", "battle_flag_group_id");
        else add("development-omission", "battle-flags", omission.reason,
          { dependency: { table: "battle_flag_group.csv", id: m.battleFlagGroupId } });
      }
      if (m.getAp !== 0 || m.getValue !== 0)
        block("party-rewards", "Party AP or special reward provider is not implemented", "get_ap/get_value");
      if (![0, 2].includes(m.notEscape)) block("escape", "Unresolved source escape mode", "not_escape");
      else add("development-omission", "escape", `Escape is unavailable in the development host (source mode ${m.notEscape})`);
      if (![0, 1].includes(m.appearanceProduction))
        block("appearance-production", "Unresolved battle introduction provider", "appearance_production");
      else if (m.appearanceProduction) add("development-omission", "appearance-production", "Source battle introduction is not played");
      if (!Number.isInteger(m.bgmId) || m.bgmId < 0) block("battle-bgm", "Invalid battle BGM identity", "battle_bgm_asset_id");
      else if (m.bgmId) add("development-omission", "battle-bgm", "Source battle BGM is not played",
        { dependency: { table: "battle_bgm_asset.csv", id: m.bgmId } });

      for (const enemy of encounter.enemies) {
        let rowSource: BattleRow["source"] = encounter.source;
        try {
          media(enemy.sprite);
          const found = reader.row("monster.csv", enemy.monsterId), r = found.values;
          rowSource = found.source;
          if (int(r.id) !== enemy.monsterId || found.source.rowId !== String(enemy.monsterId))
            throw new Error("Changed enemy source identity");
          for (const key of ["attack_attribute", "attack_plus", "attack_plus_grop", "resistance_condition", "initial_condition"])
            if (int(r[key]) !== 0) throw new Error(`Unimplemented monster ${key}=${r[key]}`);
          const parameters = compileEnemyParameters(reader, enemy.monsterId,
            input.parameters.temporary, input.parameters.limits).confirmed;
          const physical = compileEnemyPhysical(reader, enemy.monsterId,
            input.physical.temporary, input.physical.limits).confirmed;
          if (!identity(int(r.lv)) || parameters.hp <= 0 || int(r.exp) < 0 || int(r.gill) < 0)
            throw new Error("Invalid initial enemy level, life or rewards");
          const ai = compileBattleAI(enemy.ai.data, enemy.ai.source);
          if (ai.blockers.length) throw new Error("Unresolved AI entry: " + ai.blockers.join("; "));
          const abilityIds = battleAIAbilities(ai);
          const context = { enemySlot: enemy.slot, source: rowSource };
          for (const [pc, instruction] of ai.instructions.entries()) {
            const op = instruction.op;
            if (op.kind === "blocked") add("runtime-dependency", "ai-instruction", op.reason, { ...context, pc });
            if (op.kind === "condition" && !input.conditions.rules.definitions.some((c) => c.id === op.conditionId))
              add("blocked", "ai-condition", `Missing AI condition ${op.conditionId}`, { ...context, pc,
                dependency: { table: "condition.csv", id: op.conditionId } });
            if (!["act", "counter-act", "loop-act"].includes(op.kind)) continue;
            if (!("abilities" in op)) continue;
            for (const id of op.abilities) {
              const ability = input.abilities[id];
              const dependency = { table: "ability.csv", id };
              if (!ability || ability.id !== id) add("blocked", "ability-reference", `Missing AI ability ${id}`, { ...context, pc, dependency });
              else if (!ability.plan) add("runtime-dependency", "ability-plan",
                `Ability ${id}: ${ability.blockers.join("; ") || "unimplemented plan"}`, { ...context, pc, dependency });
              else if (![3, 7].includes(ability.program.range) || ability.plan.targeting.life !== "alive")
                add("runtime-dependency", "automatic-target", `Unimplemented automatic target range for ability ${id}`, { ...context, pc, dependency });
              else if (ability.plan.targeting.normalFormationOnly && formationPlan &&
                (formationPlan.kind === "fixed" ? formationPlan.pattern !== 1
                  : formationPlan.patterns[2] === 1 && formationPlan.policy.weights[2] > 0))
                add("runtime-dependency", "ability-formation", `Unimplemented formation for ability ${id}`, { ...context, pc, dependency });
            }
          }
          for (const failure of drops.blockers.filter((d) => d.monsterId === enemy.monsterId))
            add("blocked", "monster-drops", failure.reason, { ...context,
              dependency: { table: "monster.csv", id: enemy.monsterId } });
          enemies.push({
            id: `enemy:${enemy.slot}`, sourceId: enemy.monsterId, name: input.name(r.mes_id_name!),
            side: "enemy", row: "front", level: int(r.lv), attackElements: [],
            elementResistances: compileElementResistances(reader, int(r.resistance_attribute)).resistances,
            physical, ...parameters, exp: int(r.exp), gil: int(r.gill), growthGroup: null,
            abilities: abilityIds, commands: [], conditionIds: [], conditionResistances: {}, ai,
            placement: { x: enemy.x, y: enemy.y, group: enemy.group }, sprites: { idle: enemy.sprite, mount: null },
          });
        } catch (error) {
          add("blocked", "enemy-provider", message(error), { source: rowSource, enemySlot: enemy.slot,
            dependency: { table: "monster.csv", id: enemy.monsterId } });
        }
      }
    } catch (error) { block("encounter-provider", message(error)); }
    const blocked = diagnostics.slice(start).some((d) => d.kind === "blocked") ||
      input.sourceDiagnostics.some((d) => d.partyId === partyId);
    if (!blocked && formationPlan) encounters[partyId] = { encounterId: partyId, enemies,
      background: encounter.background, formationPlan,
      formation: formationPlan.kind === "development" ? null : formationPlan.pattern === 3 ? "opposed" : "normal" };
    entries.push({ partyId, status: blocked ? "blocked" : "compiled", enemyCount: encounter.enemies.length,
      abilityIds: [...new Set(enemies.flatMap((e) => e.abilities))].sort((a, b) => a - b) });
  }
  for (const partyId of requested) if (!entries.some((e) => e.partyId === partyId)) {
    if (!diagnostics.some((d) => d.partyId === partyId && d.kind === "blocked"))
      diagnostics.push({ partyId, kind: "blocked", code: "missing-source-encounter",
        reason: "Requested source encounter is absent", source: null });
    entries.push({ partyId, status: "blocked", enemyCount: 0, abilityIds: [] });
  }
  entries.sort((a, b) => a.partyId - b.partyId);
  const publishedMonsterIds = new Set(Object.values(encounters).flatMap((e) => e.enemies.map((m) => m.sourceId)));
  const monsters = drops.catalog.monsters.filter((m) => publishedMonsterIds.has(m.id));
  const contentIds = new Set(monsters.flatMap((m) => m.slots.flatMap((s, i) =>
    m.rate > 0 && drops.catalog.weights[i]! > 0 && s.contentId ? [s.contentId] : [])));
  const report: BattleEncounterReport = {
    requested: requested.length, compiledDefinitions: Object.keys(encounters).length,
    blocked: entries.filter((e) => e.status === "blocked").length,
    withRuntimeDependencies: new Set(diagnostics.filter((d) => d.kind === "runtime-dependency").map((d) => d.partyId)).size,
    withDevelopmentOmissions: new Set(diagnostics.filter((d) => d.kind === "development-omission").map((d) => d.partyId)).size,
    originalGameExecuted: false, entries,
  };
  return { encounters, diagnostics, report, drops: { ...drops.catalog, monsters,
    contents: drops.catalog.contents.filter((c) => contentIds.has(c.id)) } };
}
