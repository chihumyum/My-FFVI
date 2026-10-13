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
import { compileBattleDropCatalog } from "./battle-rewards.js";
import { tableInteger as int } from "./table.js";
import { createBattleFormationPlan, type BattleFormationPlan,
  type FrameworkBattleFormationPolicy } from "../core/battle-formations.js";
import { parseBattleEscapePolicy, type FrameworkBattleEscapePolicy } from "../core/battle-escape.js";
import { compileBattleRewardPolicy } from "./battle-result.js";
import type { BattleRewardPolicy } from "../core/battle-result.js";
import { compileBattleEvent } from "./battle-event.js";
import { parseBattleLifecycle, type BattleLifecycle } from "../core/battle-lifecycle.js";
import { parseBattleParticipantContent, type BattleParticipantContent,
  type BattleParticipantSlot, type BattleParticipantRewardScope, type EnemyBattleDefinition } from "../core/battle-participants.js";
import { compileEnemyBattleDefinition, type EnemyBattleSource } from "./enemy-battle-definition.js";
import { canonical } from "../core/canonical.js";

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
  /** Explicitly selected late master resources, not live units or story unlocks.
   * partyId scopes the destination encounter; it is not a BattleAddEnemy operand. */
  reserveEnemies?: readonly { partyId: number; enemy: EnemyBattleSource }[];
  /** Explicit source-bound regression omissions, never runtime permissions to
   * execute an unimplemented script or a new flag group. */
  development: {
    /** Authored selection for non-fixed encounters; never the native weight rule. */
    formations?: FrameworkBattleFormationPolicy;
    /** Opt-in ordinary-field retreat, never source escape RNG or timing. */
    escape?: FrameworkBattleEscapePolicy;
    /** Dynamic source reward accounting and presentation are not inferred from
     * an exported master. The Web integration policy is explicitly authored. */
    participants?: readonly { partyId: number; rewardScope: BattleParticipantRewardScope;
      slots: Record<string, BattleParticipantSlot> }[];
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
  const reserves = input.reserveEnemies ?? [], policies = input.development.participants ?? [];
  if (!requested.length || requested.some((id) => !identity(id)) ||
      new Set(requested).size !== requested.length ||
      new Set(input.encounters.map((e) => e.partyId)).size !== input.encounters.length ||
      input.encounters.some((e) => !requested.includes(e.partyId)) ||
      input.sourceDiagnostics.some((d) => !requested.includes(d.partyId)) ||
      !Array.isArray(reserves) || reserves.some(entry => !requested.includes(entry.partyId) || !identity(entry.enemy.monsterId)) ||
      new Set(reserves.map(entry => `${entry.partyId}:${entry.enemy.monsterId}`)).size !== reserves.length ||
      !Array.isArray(policies) || policies.some(entry => !requested.includes(entry.partyId)) ||
      new Set(policies.map(entry => entry.partyId)).size !== policies.length)
    throw new Error("Invalid runtime encounter selection");
  const diagnostics: BattleEncounterDiagnostic[] = input.sourceDiagnostics.map((d) => ({ ...d, kind: "blocked" }));
  const encounters: Record<string, BattleEncounter> = {};
  const entries: BattleEncounterReport["entries"] = [];
  const drops = compileBattleDropCatalog(reader,
    [...new Set([...input.encounters.flatMap((e) => e.enemies.map((m) => m.monsterId)),
      ...reserves.map(entry => entry.enemy.monsterId)])]);

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
    const enemyDefinitions: Record<string, EnemyBattleDefinition> = {};
    const selectedReserves = reserves.filter(entry => entry.partyId === partyId);
    const participantPolicy = policies.find(entry => entry.partyId === partyId);
    let participants: BattleParticipantContent | undefined;
    let formationPlan: BattleFormationPlan | null = null;
    let escapePolicy: FrameworkBattleEscapePolicy | undefined;
    let rewardPolicy: BattleRewardPolicy | undefined;
    let lifecycle: BattleLifecycle | undefined;
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
      else if (m.scriptId === 0) lifecycle = { kind: "battle-lifecycle-v1", mode: "none" };
      else {
        const omission = input.development.scripts.find((s) => s.id === m.scriptId && same(s.source, encounter.script!.source));
        const issues: { reason: string; pc?: number }[] = [];
        try {
          const program = compileBattleEvent(encounter.script!.data, encounter.script!.source);
          issues.push(...program.blockers.map(reason => ({ reason })),
            ...program.instructions.flatMap(({ op }, pc) => op.kind === "blocked" ? [{ reason: op.reason, pc }] : []));
          if (!issues.length) lifecycle = parseBattleLifecycle({ kind: "battle-lifecycle-v1", mode: "script",
            scriptId: m.scriptId, program });
        } catch (error) { issues.push({ reason: message(error) }); }
        if (!lifecycle && omission) {
          lifecycle = parseBattleLifecycle({ kind: "battle-lifecycle-v1", mode: "development-omission",
            scriptId: m.scriptId, source: encounter.script!.source, reason: omission.reason });
          add("development-omission", "battle-script", omission.reason,
            { dependency: { table: "script.csv", id: m.scriptId } });
        } else if (!lifecycle) {
          for (const issue of issues) add("blocked", "battle-script", issue.reason,
            { dependency: { table: "script.csv", id: m.scriptId },
              ...(issue.pc === undefined ? {} : { pc: issue.pc }) });
        }
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
      try {
        rewardPolicy = compileBattleRewardPolicy({ getAp: m.getAp, getValue: m.getValue,
          battleFlags: m.battleFlags.map(flag => int(flag.values.battle_flag_id)) });
      } catch (error) { block("party-rewards", message(error), "get_ap/get_value/battle_flag_group_id"); }
      if (![0, 2].includes(m.notEscape)) block("escape", "Unresolved source escape mode", "not_escape");
      if (input.development.escape !== undefined) {
        const authored = parseBattleEscapePolicy(input.development.escape);
        if (m.notEscape === 0 && m.getAp === 0) {
          // NoARBattle (14) is the only pre-existing bounded flag omission.
          // In particular CertaintyEscape and other overrides require their
          // own provider; an omission list cannot silently authorize them.
          if (m.battleFlags.some(flag => int(flag.values.battle_flag_id) !== 14))
            block("escape-flags", "Battle flags require a separate escape outcome provider", "battle_flag_group_id");
          else {
            escapePolicy = authored;
            add("development-omission", "escape-policy",
              `Authored ${authored.id} retreat only for ordinary field encounters; guaranteed after the current action, no rewards or learning; source probability and timing remain unresolved`);
          }
        }
      }
      if (!escapePolicy && [0, 2].includes(m.notEscape))
        add("development-omission", "escape", `Escape is unavailable in the development host (source mode ${m.notEscape})`);
      if (![0, 1].includes(m.appearanceProduction))
        block("appearance-production", "Unresolved battle introduction provider", "appearance_production");
      else if (m.appearanceProduction) add("development-omission", "appearance-production", "Source battle introduction is not played");
      if (!Number.isInteger(m.bgmId) || m.bgmId < 0) block("battle-bgm", "Invalid battle BGM identity", "battle_bgm_asset_id");
      else if (m.bgmId) add("development-omission", "battle-bgm", "Source battle BGM is not played",
        { dependency: { table: "battle_bgm_asset.csv", id: m.bgmId } });

      const compileEnemy = (enemy: EnemyBattleSource, slot?: number): EnemyBattleDefinition | null => {
        const compiled = compileEnemyBattleDefinition(reader, { enemy, abilities: input.abilities,
          conditions: input.conditions, sprites: input.sprites, name: input.name,
          parameters: input.parameters, physical: input.physical, formationPlan });
        const context = { source: compiled.source ?? encounter.source,
          ...(slot === undefined ? {} : { enemySlot: slot }) };
        for (const diagnostic of compiled.diagnostics) {
          const { kind, code, reason, ...extra } = diagnostic;
          add(kind, code, reason, { ...context, ...extra });
        }
        for (const failure of drops.blockers.filter(diagnostic => diagnostic.monsterId === enemy.monsterId))
          add("blocked", "monster-drops", failure.reason, { ...context,
            dependency: { table: "monster.csv", id: enemy.monsterId } });
        if (!compiled.definition) return null;
        const previous = enemyDefinitions[String(enemy.monsterId)];
        if (previous && canonical(previous) !== canonical(compiled.definition)) {
          add("blocked", "enemy-template-identity", "Conflicting definitions for the same enemy master", { ...context,
            dependency: { table: "monster.csv", id: enemy.monsterId } });
          return null;
        }
        enemyDefinitions[String(enemy.monsterId)] = compiled.definition;
        return compiled.definition;
      };
      for (const enemy of encounter.enemies) {
        const definition = compileEnemy(enemy, enemy.slot);
        if (definition) enemies.push({ ...structuredClone(definition), id: `enemy:${enemy.slot}`,
          placement: { x: enemy.x, y: enemy.y, group: enemy.group } });
      }
      for (const reserve of selectedReserves) compileEnemy(reserve.enemy);
      const dynamicEntries = lifecycle?.mode === "script" ? lifecycle.program.instructions.flatMap(({ op }, pc) =>
        op.kind === "add-enemy" ? [{ op, pc }] : []) : [];
      const slotIds = new Set(encounter.enemies.map(enemy => String(enemy.slot)));
      if (participantPolicy) for (const key of Object.keys(participantPolicy.slots)) slotIds.add(key);
      for (const { op, pc } of dynamicEntries) {
        if (!enemyDefinitions[String(op.monsterId)])
          add("blocked", "battle-participant-reference", `Battle event PC ${pc} has no admitted enemy master ${op.monsterId}`,
            { pc, dependency: { table: "monster.csv", id: op.monsterId } });
        if (!slotIds.has(String(op.uniqueId)))
          add("blocked", "battle-participant-reference", `Battle event PC ${pc} has no admitted enemy slot ${op.uniqueId}`,
            { pc, dependency: { table: "script.csv", id: encounter.metadata.scriptId } });
      }
      if ((selectedReserves.length || dynamicEntries.length) && !participantPolicy) {
        if (!dynamicEntries.length)
          block("participant-policy", "Late enemy templates require an explicit Web slot and reward policy");
        else for (const { pc } of dynamicEntries)
          add("blocked", "participant-policy", "Dynamic enemy entry requires an explicit Web slot and reward policy",
            { pc, dependency: { table: "script.csv", id: encounter.metadata.scriptId } });
      }
      else {
        try {
          const slots: Record<string, BattleParticipantSlot> = {};
          for (const enemy of encounter.enemies)
            slots[String(enemy.slot)] = { x: enemy.x, y: enemy.y, group: enemy.group };
          if (participantPolicy) {
            for (const [key, placement] of Object.entries<BattleParticipantSlot>(participantPolicy.slots)) {
              if (slots[key] && canonical(slots[key]) !== canonical(placement))
                throw new Error("Participant policy changes an initial enemy slot");
              slots[key] = structuredClone(placement);
            }
            add("development-omission", "participant-policy",
              `Authored web-unique-id-slots-v1 bounds/layout and ${participantPolicy.rewardScope} reward scope; native dynamic layout and accounting remain unverified`);
          }
          participants = parseBattleParticipantContent({ kind: "battle-participant-content-v1",
            profile: "web-unique-id-slots-v1", rewardScope: participantPolicy?.rewardScope ?? "active-units",
            enemyDefinitions, slots,
            initial: encounter.enemies.map(enemy => ({ id: `enemy:${enemy.slot}`, sourceId: enemy.monsterId, uniqueId: enemy.slot })),
          }, enemies);
        } catch (error) { block("participant-content", message(error)); }
      }
    } catch (error) { block("encounter-provider", message(error)); }
    const blocked = diagnostics.slice(start).some((d) => d.kind === "blocked") ||
      input.sourceDiagnostics.some((d) => d.partyId === partyId);
    if (!blocked && formationPlan && rewardPolicy && lifecycle && participants) encounters[partyId] = { encounterId: partyId, enemies,
      background: encounter.background, formationPlan, rewardPolicy, lifecycle, participants,
      ...(escapePolicy ? { escapePolicy } : {}),
      formation: formationPlan.kind === "development" ? null : formationPlan.pattern === 3 ? "opposed" : "normal" };
    entries.push({ partyId, status: blocked ? "blocked" : "compiled", enemyCount: encounter.enemies.length,
      abilityIds: [...new Set(Object.values(enemyDefinitions).flatMap(definition => definition.abilities))].sort((a, b) => a - b) });
  }
  for (const partyId of requested) if (!entries.some((e) => e.partyId === partyId)) {
    if (!diagnostics.some((d) => d.partyId === partyId && d.kind === "blocked"))
      diagnostics.push({ partyId, kind: "blocked", code: "missing-source-encounter",
        reason: "Requested source encounter is absent", source: null });
    entries.push({ partyId, status: "blocked", enemyCount: 0, abilityIds: [] });
  }
  entries.sort((a, b) => a.partyId - b.partyId);
  const publishedMonsterIds = new Set(Object.values(encounters).flatMap(encounter =>
    Object.values(encounter.participants!.enemyDefinitions).map(definition => definition.sourceId)));
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
