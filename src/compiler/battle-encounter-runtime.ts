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
import { parseBattleParticipantContent, parseBattleParticipantEnemyParty, type BattleParticipantContent,
  type BattleParticipantSlot, type BattleParticipantRewardScope, type EnemyBattleDefinition,
  type BattleParticipantEnemyParty } from "../core/battle-participants.js";
import { compileEnemyBattleDefinition, type EnemyBattleSource } from "./enemy-battle-definition.js";
import { canonical } from "../core/canonical.js";
import { checkpointKeys } from "../core/checkpoint-validation.js";
import { parseBattleHandoffPolicy, type BattleHandoffContent, type FrameworkBattleHandoffPolicy } from "../core/battle-handoff-content.js";
import { compileBattleHandoffContent, BattleHandoffDependencyError, type BattleHandoffMusicLookup } from "./battle-handoff.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
  matching(table: string, key: string, value: string | number): BattleRow[];
  handoffMusic?: BattleHandoffMusicLookup;
};
export type BattleEncounterRuntimeInput = {
  requestedPartyIds: readonly number[];
  encounters: readonly SourceBattleEncounter[];
  sourceDiagnostics: readonly SourceDiagnostic[];
  abilities: Readonly<Record<string, AbilityDefinition>>;
  conditions: BattleConditionCatalog;
  /** Declared approximation lane, never a native condition/controller grant. */
  conditionControlPolicy?: { kind: "web-source-control-actions-v1" };
  sprites: Readonly<Record<string, { file: string; width: number; height: number }>>;
  name(key: string): string;
  parameters: { temporary: ParameterValues; limits: ParameterLimits };
  physical: { temporary: PhysicalParameters; limits: PhysicalLimits };
  /** Explicitly selected late master resources, not live units or story unlocks.
   * partyId scopes the destination encounter; it is not a BattleAddEnemy operand. */
  reserveEnemies?: readonly { partyId: number; enemy: EnemyBattleSource }[];
  /** Destination root identity and the source party to swap into that battle.
   * The child is content, not another encounter/session or executable root. */
  enemyParties?: readonly { partyId: number; encounter: SourceBattleEncounter }[];
  /** Opt-in only: preserve old catalogs byte-for-byte when absent. A null
   * policy records source declarations without granting a handoff behavior. */
  handoff?: { policy: FrameworkBattleHandoffPolicy | null };
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
      slots: Record<string, BattleParticipantSlot>;
      enemyParties?: Record<string, { slots: Record<string, BattleParticipantSlot> }> }[];
    scripts: readonly { id: number; source: BattleAISource; reason: string }[];
    flagGroups: readonly { id: number; rows: readonly BattleRow[]; reason: string }[];
  };
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const identity = (value: number) => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Do not widen typed readonly source selections to any[] after validation.
const array = (value: unknown): boolean => Array.isArray(value);

/** A batch of runtime definitions, not a playable-enemy count. Broken source
 * dependencies remove only their encounter. Conditional AI instructions/plans
 * remain in the program, with PCs in the report and the existing runtime gate.
 * Shared rule corruption (for example missing drop weights) still fails the batch. */
export function compileBattleEncounterRuntime(reader: Reader, input: BattleEncounterRuntimeInput) {
  const requested = [...input.requestedPartyIds];
  const reserves = input.reserveEnemies ?? [], policies = input.development.participants ?? [], waves = input.enemyParties ?? [];
  if (!requested.length || requested.some((id) => !identity(id)) ||
      new Set(requested).size !== requested.length ||
      new Set(input.encounters.map((e) => e.partyId)).size !== input.encounters.length ||
      input.encounters.some((e) => !requested.includes(e.partyId)) ||
      input.sourceDiagnostics.some((d) => !requested.includes(d.partyId)) ||
      !array(reserves) || reserves.some(entry => !requested.includes(entry.partyId) || !identity(entry.enemy.monsterId)) ||
      new Set(reserves.map(entry => `${entry.partyId}:${entry.enemy.monsterId}`)).size !== reserves.length ||
      !array(waves) || waves.some(entry => !requested.includes(entry.partyId) || !identity(entry.encounter.partyId)) ||
      new Set(waves.map(entry => `${entry.partyId}:${entry.encounter.partyId}`)).size !== waves.length ||
      !array(policies) || policies.some(entry => !requested.includes(entry.partyId)) ||
      new Set(policies.map(entry => entry.partyId)).size !== policies.length)
    throw new Error("Invalid runtime encounter selection");
  const diagnostics: BattleEncounterDiagnostic[] = input.sourceDiagnostics.map((d) => ({ ...d, kind: "blocked" }));
  const encounters: Record<string, BattleEncounter> = {};
  const entries: BattleEncounterReport["entries"] = [];
  const handoffSources: NonNullable<BattleEncounterReport["handoffSources"]> = [];
  let handoffPolicy: FrameworkBattleHandoffPolicy | null | undefined;
  if (input.handoff !== undefined) {
    checkpointKeys(input.handoff, "policy");
    handoffPolicy = input.handoff.policy === null ? null : parseBattleHandoffPolicy(input.handoff.policy);
  }
  const drops = compileBattleDropCatalog(reader,
    [...new Set([...input.encounters.flatMap((e) => e.enemies.map((m) => m.monsterId)),
      ...reserves.map(entry => entry.enemy.monsterId),
      ...waves.flatMap(entry => entry.encounter.enemies.map(enemy => enemy.monsterId))])]);

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
    const selectedWaves = waves.filter(entry => entry.partyId === partyId);
    const enemyParties: Record<string, BattleParticipantEnemyParty> = {};
    const participantPolicy = policies.find(entry => entry.partyId === partyId);
    let participants: BattleParticipantContent | undefined;
    let formationPlan: BattleFormationPlan | null = null;
    let escapePolicy: FrameworkBattleEscapePolicy | undefined;
    let rewardPolicy: BattleRewardPolicy | undefined;
    let lifecycle: BattleLifecycle | undefined;
    let handoff: BattleHandoffContent | undefined;
    try {
      const m = encounter.metadata;
      if (!encounter.source || encounter.source.rowId !== String(partyId) || !m)
        throw new Error("Invalid runtime encounter source binding");
      if (handoffPolicy !== undefined) {
        try {
          handoff = compileBattleHandoffContent(reader, encounter, handoffPolicy);
          handoffSources.push({ partyId, content: structuredClone(handoff) });
          for (const dependency of handoff.source.dependencies) if (dependency.binding === "unresolved")
            add(handoffPolicy ? "development-omission" : "runtime-dependency", "battle-handoff-bgm-unresolved",
              dependency.reason, { dependency: { table: dependency.table, id: dependency.id } });
          if (handoffPolicy) add("development-omission", "battle-handoff-policy",
            `Authored ${handoffPolicy.id} retains field audio and omits the battle introduction; native music, introduction and escape are not admitted`);
        } catch (error) {
          add("blocked", "battle-handoff-dependency", message(error), error instanceof BattleHandoffDependencyError
            ? { dependency: error.dependency } : {});
        }
      }
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

      const compileEnemy = (enemy: EnemyBattleSource, slot?: number, childPartyId?: number): EnemyBattleDefinition | null => {
        const compiled = compileEnemyBattleDefinition(reader, { enemy,
          entryPhase: slot === undefined || childPartyId !== undefined ? "late" : "initial", abilities: input.abilities,
          conditions: input.conditions, sprites: input.sprites, name: input.name,
          parameters: input.parameters, physical: input.physical, formationPlan,
          ...(input.conditionControlPolicy ? { conditionControlPolicy: input.conditionControlPolicy } : {}) });
        const context = { source: compiled.source ?? encounter.source,
          ...(slot === undefined ? {} : { enemySlot: slot }) };
        for (const diagnostic of compiled.diagnostics) {
          const { kind, code, reason, ...extra } = diagnostic;
          add(kind, code, childPartyId === undefined ? reason : `Enemy party ${childPartyId}: ${reason}`, { ...context, ...extra });
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
      const policyParties = participantPolicy?.enemyParties;
      if (policyParties !== undefined) {
        for (const key of Object.keys(policyParties)) {
          const childId = Number(key);
          if (!identity(childId) || String(childId) !== key || !selectedWaves.some(wave => wave.encounter.partyId === childId))
            add("blocked", "enemy-party-reference", `Enemy party policy ${key} has no selected source party binding`);
        }
      }
      for (const selection of selectedWaves) {
        const child = selection.encounter, childId = child.partyId, childStart = diagnostics.length;
        let childSource: BattleRow["source"] | null = null;
        const stage = (kind: BattleEncounterDiagnostic["kind"], code: string, reason: string,
          extra: Partial<Pick<BattleEncounterDiagnostic, "dependency" | "enemySlot" | "pc">> = {}) =>
          add(kind, code, `Enemy party ${childId}: ${reason}`, { source: childSource,
            dependency: { table: "monster_party.csv", id: childId }, ...extra });
        try {
          if (!child.source || child.source.rowId !== String(childId) ||
              [child.source.file, child.source.assetPath, child.source.serializedFile, child.source.objectId]
                .some(value => typeof value !== "string" || !value.length) ||
              !/^-?(?:0|[1-9]\d*)$/.test(child.source.objectId) ||
              BigInt(child.source.objectId) < -(1n << 63n) || BigInt(child.source.objectId) >= (1n << 63n))
            throw new Error("Missing or inconsistent child source binding");
          childSource = child.source;
          if (!Array.isArray(child.enemies) || !child.enemies.length || child.enemies.length > 9 ||
              new Set(child.enemies.map(enemy => enemy.slot)).size !== child.enemies.length ||
              child.enemies.some(enemy => !Number.isInteger(enemy.slot) || enemy.slot < 1 || enemy.slot > 9 ||
                !identity(enemy.monsterId) || ![1, 2].includes(enemy.group) ||
                !Number.isInteger(enemy.x) || !Number.isInteger(enemy.y)))
            throw new Error("Invalid source child members, slots or placement");
          const metadata = child.metadata;
          checkpointKeys(metadata, "battleFlagGroupId,battleFlags,backgroundId,bgmId,appearanceProduction,notEscape,getAp,getValue,scriptId");
          for (const [key, value] of Object.entries(metadata)) {
            if (key === "battleFlags") continue;
            if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0x7fffffff)
              throw new Error("Invalid child metadata: " + key);
          }
          if (!identity(metadata.backgroundId)) throw new Error("Missing child background identity");
          if (!Array.isArray(metadata.battleFlags) ||
              (metadata.battleFlagGroupId === 0) !== (metadata.battleFlags.length === 0))
            throw new Error("Missing or inconsistent child battle flag binding");
          if (metadata.battleFlagGroupId) {
            for (const flag of metadata.battleFlags)
              if (int(flag.values.group_id) !== metadata.battleFlagGroupId ||
                  flag.source.rowId !== String(int(flag.values.id)) || !identity(int(flag.values.battle_flag_id)))
                throw new Error("Inconsistent child battle flag source");
            stage("blocked", "enemy-party-flags", "Child battle flags need a reviewed applicability provider",
              { dependency: { table: "battle_flag_group.csv", id: metadata.battleFlagGroupId } });
          }
          if ((metadata.scriptId === 0) !== (child.script === null) || metadata.scriptId !== 0 && !child.script)
            throw new Error("Missing or inconsistent child script binding");
          if (metadata.scriptId)
            stage("blocked", "enemy-party-script", "Child root applicability is not admitted; switching never executes a new root",
              { dependency: { table: "script.csv", id: metadata.scriptId } });
          if (![0, 2].includes(metadata.notEscape))
            stage("blocked", "enemy-party-escape", "Unresolved child escape mode");
          if (![0, 1].includes(metadata.appearanceProduction))
            stage("blocked", "enemy-party-appearance", "Unresolved child introduction mode");
          try { createBattleFormationPlan(child.patterns); }
          catch (error) { stage("blocked", "enemy-party-formation", message(error)); }
          try { compileBattleRewardPolicy({ getAp: metadata.getAp, getValue: metadata.getValue,
            battleFlags: metadata.battleFlags.map(flag => int(flag.values.battle_flag_id)) }); }
          catch (error) { stage("blocked", "enemy-party-rewards", message(error)); }
          media(child.background);
          const fields: Record<string, string> = { battleFlagGroupId: "battle_flag_group_id", backgroundId: "battle_background_asset_id",
            bgmId: "battle_bgm_asset_id", appearanceProduction: "appearance_production", notEscape: "not_escape",
            getAp: "get_ap", getValue: "get_value", scriptId: "script_name" };
          for (const [key, field] of Object.entries(fields)) {
            const childValue = metadata[key as keyof typeof metadata], parentValue = encounter.metadata[key as keyof typeof metadata];
            if (canonical(childValue) !== canonical(parentValue))
              stage("development-omission", "enemy-party-metadata", `${field}=${childValue} differs from entry ${parentValue}; Web retains parent context`,
                { dependency: { table: "monster_party.csv", id: childId, field } });
          }
          if (canonical(child.patterns) !== canonical(encounter.patterns))
            stage("development-omission", "enemy-party-metadata", `Source formation ${child.patterns.join(",")} differs from entry; Web retains parent formation`,
              { dependency: { table: "monster_party.csv", id: childId, field: "battle_pattern1..6" } });
          if (child.background !== encounter.background)
            stage("development-omission", "enemy-party-metadata", "Source child background differs; Web retains entry scene");
          const slots: Record<string, BattleParticipantSlot> = {};
          for (const enemy of child.enemies) {
            slots[String(enemy.slot)] = { x: enemy.x, y: enemy.y, group: enemy.group };
            compileEnemy(enemy, enemy.slot, childId);
          }
          const authored = policyParties?.[String(childId)];
          if (authored !== undefined) {
            checkpointKeys(authored, "slots");
            for (const [key, placement] of Object.entries<BattleParticipantSlot>(authored.slots)) {
              if (slots[key] && canonical(slots[key]) !== canonical(placement))
                throw new Error("Participant policy changes a source child slot");
              slots[key] = structuredClone(placement);
            }
          }
          if (!diagnostics.slice(childStart).some(diagnostic => diagnostic.kind === "blocked")) {
            enemyParties[String(childId)] = parseBattleParticipantEnemyParty({ members: child.enemies.map(enemy =>
              ({ sourceId: enemy.monsterId, uniqueId: enemy.slot })), slots }, enemyDefinitions);
            stage("development-omission", "enemy-party-policy", "Web swaps source members/layout within the same battle; parent formation, scene, reward policy and root remain fixed");
          }
        } catch (error) { stage("blocked", "enemy-party-provider", message(error)); }
      }
      const dynamicEntries = lifecycle?.mode === "script" ? lifecycle.program.instructions.flatMap(({ op }, pc) =>
        op.kind === "add-enemy" || op.kind === "change-enemy-party" ? [{ op, pc }] : []) : [];
      if (lifecycle?.mode === "script") for (const [pc, { op }] of lifecycle.program.instructions.entries()) {
        if (op.kind === "add-player") add("blocked", "owned-player-borrow-policy",
          `Battle event PC ${pc} requires an admitted existing owned source ${op.sourceId}, resource closure and explicit return policy`,
          { pc, dependency: { table: "character_status.csv", id: op.sourceId } });
      }
      const slotIds = new Set(encounter.enemies.map(enemy => String(enemy.slot)));
      if (participantPolicy) for (const key of Object.keys(participantPolicy.slots)) slotIds.add(key);
      for (const { op, pc } of dynamicEntries) {
        if (op.kind === "change-enemy-party") {
          if (!enemyParties[String(op.partyId)])
            add("blocked", "enemy-party-reference", `Battle event PC ${pc} has no admitted source enemy party ${op.partyId}`,
              { pc, dependency: { table: "monster_party.csv", id: op.partyId } });
          continue;
        }
        if (!enemyDefinitions[String(op.monsterId)])
          add("blocked", "battle-participant-reference", `Battle event PC ${pc} has no admitted enemy master ${op.monsterId}`,
            { pc, dependency: { table: "monster.csv", id: op.monsterId } });
        else if (enemyDefinitions[String(op.monsterId)]!.conditionIds.length)
          add("blocked", "enemy-late-initial-condition", "Dynamic entry cannot reuse the initial battle condition activation phase",
            { pc, dependency: { table: "monster.csv", id: op.monsterId, field: "initial_condition" } });
        if (!slotIds.has(String(op.uniqueId)))
          add("blocked", "battle-participant-reference", `Battle event PC ${pc} has no admitted enemy slot ${op.uniqueId}`,
            { pc, dependency: { table: "script.csv", id: encounter.metadata.scriptId } });
        // A control-flow-to-phase analysis is not yet available. Require the
        // reference in every selected layout instead of guessing which phase
        // can reach this PC or inventing positions for an empty source slot.
        for (const wave of selectedWaves) {
          const childId = wave.encounter.partyId;
          if (!enemyParties[String(childId)]?.slots[String(op.uniqueId)])
            add("blocked", "battle-participant-reference",
              `Battle event PC ${pc} slot ${op.uniqueId} is missing from enemy party ${childId}; all selected phases need an explicit layout`,
              { pc, dependency: { table: "monster_party.csv", id: childId } });
        }
      }
      if ((selectedReserves.length || selectedWaves.length || dynamicEntries.length) && !participantPolicy) {
        if (!dynamicEntries.length)
          block("participant-policy", "Late enemy templates or parties require an explicit Web slot and reward policy");
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
            ...(selectedWaves.length ? { enemyParties } : {}),
          }, enemies);
        } catch (error) { block("participant-content", message(error)); }
      }
    } catch (error) { block("encounter-provider", message(error)); }
    const blocked = diagnostics.slice(start).some((d) => d.kind === "blocked") ||
      input.sourceDiagnostics.some((d) => d.partyId === partyId);
    if (!blocked && formationPlan && rewardPolicy && lifecycle && participants) encounters[partyId] = { encounterId: partyId, enemies,
      background: encounter.background, formationPlan, rewardPolicy, lifecycle, participants,
      ...(escapePolicy ? { escapePolicy } : {}), ...(handoff ? { handoff } : {}),
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
  if (waves.length) report.enemyPartySources = waves.map(({ partyId, encounter: child }) => ({ rootPartyId: partyId,
    partyId: child.partyId, source: structuredClone(child.source), patterns: [...child.patterns],
    background: child.background, metadata: structuredClone(child.metadata),
    scriptSource: child.script?.source ? structuredClone(child.script.source) : null, consumerSemantics: "unverified" }));
  if (input.handoff !== undefined) report.handoffSources = handoffSources;
  return { encounters, diagnostics, report, drops: { ...drops.catalog, monsters,
    contents: drops.catalog.contents.filter((c) => contentIds.has(c.id)) } };
}
