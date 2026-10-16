import {parseBattleChildAdmission,type BattleChildAdmission} from './battle-child-admission.js';
import {parseWebBattleGauInstances,type WebBattleGauInstances,type BattleGauInstanceContent} from "./battle-gau-instances.js";
import {parseWebEnemySpawnConditions,type WebEnemySpawnConditions} from './battle-spawn-conditions.js';
import {parseWebBattleForcedSave,type WebBattleForcedSave} from './battle-forced-save.js';
import type { SourceMessageFeeCatalog } from "./source-message-fees.js";
import { parseSourceBattleControls } from './battle-controls.js';
import { parseSourceBattleFlags, assertSourceBattleFlagsControls, type SourceBattleFlags } from "./battle-flags.js";
import type { PhysicalParameters } from "./physical.js";
import type { AtbRules } from "./atb.js";
import type { ParameterValues } from "./parameters.js";
import type { AbilityProgram, DevelopmentAbilityPlan } from "./ability.js";
import type { BattleConditionCatalog } from "./battle-conditions.js";
import type { ElementResistances } from "./elements.js";
import type { BattleAIProgram, BattleAISource } from "./battle-ai.js";
import type { BattleReactionRules } from "./battle-reactions.js";
import type { GameStateContent } from "./game-state.js";
import type { BattleAbilityCatalog, BattleAbilityContext, BattleAbilityMember } from "./battle-abilities.js";
import type { BattleEntryCatalog } from "./battle-entry.js";
import type { BattleAppearanceActor, BattleAppearanceCatalog } from "./battle-appearance.js";
import type { BattleDropCatalog } from "./battle-rewards.js";
import type { BattleRow, BattleRowCatalog } from "./battle-row.js";
import type { BattlePreferences } from "./battle-preferences.js";
import type { BattleEventRules } from "./battle-event-context.js";
import type { ObservedLearningCatalog } from "./character-learning.js";
import { parseBattleFormationPlan, selectBattleFormation,
  type BattleFormationChoice, type BattleFormationPlan } from "./battle-formations.js";
import { parseBattleEscapePolicy, type FrameworkBattleEscapePolicy } from "./battle-escape.js";
import { parseBattleRewardPolicy, type BattleRewardPolicy } from "./battle-result.js";
import { parseBattleLifecycle, type BattleLifecycle } from "./battle-lifecycle.js";
import { parseBattleParticipantContent, type BattleParticipantContent } from "./battle-participants.js";
import { parseBattlePlayerPlan, type BattlePlayerPlan } from "./battle-player-participants.js";
import { parseBattleHandoffContent, type BattleHandoffContent } from "./battle-handoff-content.js";

export type BattleQualificationContext = Omit<BattleAbilityContext, "conditionIds" | "partySize"> & {
  /** Source mode enforces qualification. The explicit development mode keeps
   * the existing bounded actions while exposing unresolved source queries. */
  mode: "source" | "development-static";
  conditionContext: "current" | "unknown";
};

export type BattleCommandDefinition = {
  id: number;
  name: string;
  kind: "ability" | "item";
  abilityIds: number[];
  forbiddenConditionIds: number[];
  /** Command.AbilityId is independent of the ability selected by the actor. */
  referencedAbility: { id: number; typeId: number; wait: number } | null;
};
export type SourceConditionTraits = {
  kind: "source-condition-traits-v1";
  baseUndead: boolean;
};

/** A deliberately bounded development profile, never a parity certificate. */
export type BattleContent = {
  sourceFlags?: SourceBattleFlags;
  controls?: import('./battle-controls.js').SourceBattleControls;
  kind: "opening-battle-development";
  profile: "narshe-playability-v35";
  contentHash: string;
  sourceContentHash: string;
  fieldSourceSetHash: string;
  encounterId: number;
  formation: "normal" | "opposed";
  /** Resolved once by the session before opening its battle lease. */
  formationChoice?: BattleFormationChoice;
  /** Enabled only for explicitly authored ordinary-field development battles. */
  escapePolicy?: FrameworkBattleEscapePolicy;
  /** Per-encounter source rewards, captured before opening owned battle state. */
  rewardPolicy?: BattleRewardPolicy;
  /** New source catalogs always bind the event program or an explicit omission. */
  lifecycle?: BattleLifecycle;
  /** Optional declarations and an explicit handoff policy, not native admission. */
  handoff?: BattleHandoffContent;
  forcedSavePolicy?:WebBattleForcedSave;
  spawnConditionPolicy?:WebEnemySpawnConditions;
  gauInstancePolicy?:WebBattleGauInstances;
  childPartyAdmission?:BattleChildAdmission;
  /** Reusable enemy content is separate from the current battle unit owner. */
  participants?: BattleParticipantContent;
  playerParticipants?: BattlePlayerPlan;
  atb: AtbRules;
  /** Defaults for this entry profile; live source speed slots and mode are session-owned. */
  timing: BattlePreferences;
  reactions: BattleReactionRules;
  /** Explicit Web action/condition scheduling. Source controller parity and
   * Unity's global random stream are not granted by a source status row. */
  conditionControlPolicy?: { kind: "web-source-control-actions-v1" };
  /** Fresh source player parameter facts, keyed by the exact source character.
   * This does not change the owned initializer or represent live equipment. */
  sourceMessageFees?: SourceMessageFeeCatalog;
  playerConditionTraits?: Readonly<Record<string, SourceConditionTraits>>;
  /** null explicitly marks an unported reward lane in development fixtures. */
  drops: BattleDropCatalog | null;
  initialAtb: { player: [number, number]; enemy: [number, number] };
  players: CombatantDefinition[];
  enemies: CombatantDefinition[];
  abilities: Record<string, AbilityDefinition>;
  commands: Record<string, BattleCommandDefinition>;
  battleAbilities?: BattleAbilityCatalog;
  qualificationContext?: BattleQualificationContext;
  battleEntry?: BattleEntryCatalog;
  /** content.type_id=4, with explicit null when the source has no content row. */
  abilityContentIds?: Record<string, number | null>;
  battleAppearance?: BattleAppearanceCatalog;
  /** Source factory facts plus explicit independent Web instance declaration. */
  gauInstances?: BattleGauInstanceContent;
  battleRows?: BattleRowCatalog;
  /** Source condition predicates; current unit state remains owned by BattleGame. */
  battleEvents?: BattleEventRules;
  /** Observations grant learning only through the source recipient and settlement rules. */
  observedLearning?: ObservedLearningCatalog;
  conditions: BattleConditionCatalog;
  growth: Record<string, { level: number; hp: number; mp: number }[]>;
  experience: { level: number; exp: number }[];
  background: string;
  sprites: Record<string, { file: string; width: number; height: number }>;
  limitations: string[];
};
export type CombatantDefinition = ParameterValues & {
  /** Immutable raw label/template; only a live owned-name consumer resolves it. */
  nameSource?: import("./source-catalog-name.js").SourceCatalogName;
  id: string;
  sourceId: number;
  name: string;
  side: "player" | "enemy";
  /** Player corps is projected from the current party cell at entry. */
  row: BattleRow;
  level: number;
  physical: PhysicalParameters | null;
  attackElements: number[];
  elementResistances: ElementResistances;
  exp: number;
  gil: number;
  growthGroup: string | null;
  abilities: number[];
  commands: number[];
  conditionIds: number[];
  conditionResistances: Record<string, number>;
  /** Fixed source parameter facts only. Current conditions and actual equipped
   * providers remain separate inputs to an IsUndead query. Missing is unknown. */
  conditionTraits?: SourceConditionTraits;
  /** Exact source EnemyCharacterParameter constructor, independent of player
   * overrides and legacy missing data. Battle owns actual-instance binding. */
  mpParameter?: import("./source-enemy-mp-parameter.js").SourceEnemyMpParameter;
  /** Current owned state, independent of the development action whitelist. */
  ownedAbilities?: BattleAbilityMember;
  /** Current owned learning counter; distinct from the MP resource. */
  magicLearningValue?: number;
  appearance?: BattleAppearanceActor;
  /** Admission constraints travel with reusable templates, independently of
   * ownership. An empty action list never permits a static-menu fallback. */
  battleRequirements?: {
    qualification: "source";
    conditionContext: "current";
    forbiddenConditionTypes: number[];
  };
  ai: BattleAIProgram | null;
  placement: { x: number; y: number; group: number } | null;
  sprites: { idle: string; mount: string | null };
};

export function battleDefinitionBlocker(
  players: readonly Pick<CombatantDefinition, "name" | "conditionIds" | "battleRequirements">[],
  context: BattleQualificationContext | undefined,
  conditions: BattleConditionCatalog,
): string | null {
  for (const player of players) {
    const required = player.battleRequirements;
    if (!required) continue;
    if (required.qualification !== "source" || required.conditionContext !== "current" ||
        !Array.isArray(required.forbiddenConditionTypes) ||
        required.forbiddenConditionTypes.some((id) => !Number.isInteger(id) || id < 1))
      return "Invalid player battle template requirements";
    if (context?.mode !== required.qualification || context.conditionContext !== required.conditionContext)
      return `角色 ${player.name} 的来源战斗入口上下文尚未确认`;
    if (player.conditionIds.some((id) => {
      const row = conditions.rules.definitions.find((d) => d.id === id);
      return row && required.forbiddenConditionTypes.includes(row.type);
    }))
      return `角色 ${player.name} 的特殊战斗外观尚未迁移`;
  }
  return null;
}

export type BattleEncounter = Pick<
  BattleContent,
  "encounterId" | "enemies" | "background"
> & {
  /** null means selection is still required, never a default normal formation. */
  formation: BattleContent["formation"] | null;
  formationPlan?: BattleFormationPlan;
  controls?: import('./battle-controls.js').SourceBattleControls;
  escapePolicy?: FrameworkBattleEscapePolicy;
  sourceFlags?: SourceBattleFlags;
  rewardPolicy?: BattleRewardPolicy;
  lifecycle?: BattleLifecycle;
  handoff?: BattleHandoffContent;
  forcedSavePolicy?:WebBattleForcedSave;
  spawnConditionPolicy?:WebEnemySpawnConditions;
  gauInstancePolicy?:WebBattleGauInstances;
  childPartyAdmission?:BattleChildAdmission;
  gauInstances?:BattleGauInstanceContent;
  participants?: BattleParticipantContent;
  playerParticipants?: BattlePlayerPlan;
};

/** All reachable development branches, not a sample of the weighted pool. */
export function encounterFormationOptions(encounter: BattleEncounter): BattleContent["formation"][] {
  if (encounter.formationPlan === undefined) {
    if (encounter.formation !== "normal" && encounter.formation !== "opposed")
      throw new Error("Missing battle formation plan");
    return [encounter.formation];
  }
  const plan = parseBattleFormationPlan(encounter.formationPlan);
  if (plan.kind === "fixed") {
    const formation = plan.pattern === 1 ? "normal" : "opposed";
    if (encounter.formation !== formation) throw new Error("Inconsistent fixed battle formation");
    return [formation];
  }
  if (encounter.formation !== null) throw new Error("Unresolved battle formation has a premature selection");
  return plan.patterns.flatMap((eligible, index) => eligible && plan.policy.weights[index]! > 0
    ? [index === 0 ? "normal" as const : "opposed" as const] : []);
}
/** Import diagnostics are separate from live party/AI admission. A compiled
 * definition can still have a conditional dependency which the runtime rejects. */
export type BattleEncounterDiagnostic = {
  partyId: number;
  kind: "blocked" | "runtime-dependency" | "development-omission";
  code: string;
  reason: string;
  source: { file: string; assetPath: string; serializedFile: string; objectId: string; rowId: string } | null;
  dependency?: { table: string; id: number; field?: string };
  enemySlot?: number;
  pc?: number;
  battleEventDependency?:{kind:"source-battle-branch-dependency-v1";source:BattleAISource;pc:number;category:import("./battle-branch-execution.js").BattleDeferredInstructionCategory;reason:string;raw:import("./battle-branch-execution.js").BattleSourceInstruction};
};
export type BattleEncounterReport = {
  requested: number;
  compiledDefinitions: number;
  blocked: number;
  withRuntimeDependencies: number;
  withDevelopmentOmissions: number;
  originalGameExecuted: false;
  entries: { partyId: number; status: "compiled" | "blocked"; enemyCount: number; abilityIds: number[] }[];
  /** Source annotations, not providers or proof that later native consumers
   * ignore child metadata. Kept separately from executable participant data. */
  enemyPartySources?: {
    rootPartyId: number;
    partyId: number;
    source: BattleEncounterDiagnostic["source"];
    patterns: number[];
    background: string;
    metadata: unknown;
    scriptSource: BattleAISource | null;
    consumerSemantics: "unverified";
  }[];
  /** Opt-in handoff declarations also survive when another lane blocks the encounter. */
  handoffSources?: { partyId: number; content: BattleHandoffContent }[];
  /** Proven immutable flag applicability survives unrelated script/AI blocks. */
  flagSources?: { partyId: number; content: SourceBattleFlags }[];
};
export type BattleCatalog = {
  kind: "narshe-battle-catalog";
  contentHash: string;
  gameState: GameStateContent;
  common: Omit<BattleContent, keyof BattleEncounter | "contentHash" | "formationChoice">;
  encounters: Record<string, BattleEncounter>;
  encounterDiagnostics?: BattleEncounterDiagnostic[];
  encounterReport?: BattleEncounterReport;
};
export function encounterContent(
  catalog: BattleCatalog,
  id: number,
  seed?: number,
): BattleContent | null {
  if (Object.hasOwn(catalog.common, "escapePolicy")) throw new Error("Escape policy must belong to an encounter");
  if (Object.hasOwn(catalog.common, "rewardPolicy")) throw new Error("Reward policy must belong to an encounter");
  if (Object.hasOwn(catalog.common, "lifecycle")) throw new Error("Battle lifecycle must belong to an encounter");
  if (Object.hasOwn(catalog.common, "handoff")) throw new Error("Battle handoff must belong to an encounter");
  if (Object.hasOwn(catalog.common, "participants")) throw new Error("Battle participants must belong to an encounter");
  if (Object.hasOwn(catalog.common, "playerParticipants")) throw new Error("Battle player participants must belong to an encounter");
  if(Object.hasOwn(catalog.common,'controls'))throw new Error('Battle controls must belong to an encounter');
  if(Object.hasOwn(catalog.common,'gauInstances'))throw new Error('Gau factory facts must belong to an encounter');
  if(Object.hasOwn(catalog.common,'gauInstancePolicy'))throw new Error('Gau instance policy must belong to an encounter');
  if(Object.hasOwn(catalog.common,'spawnConditionPolicy'))throw new Error('Spawn condition policy must belong to an encounter');
  if(Object.hasOwn(catalog.common,'forcedSavePolicy'))throw new Error('Forced save policy must belong to an encounter');
  if(Object.hasOwn(catalog.common,'sourceFlags'))throw new Error('Battle source flags must belong to an encounter');
  if(Object.hasOwn(catalog.common,'childPartyAdmission'))throw new Error('Child-party admission must belong to an encounter');
  const encounter = catalog.encounters[String(id)];
  if (!encounter) return null;
  if (encounter.encounterId !== id) throw new Error("Inconsistent battle encounter identity");
  const options = encounterFormationOptions(encounter);
  const { formationPlan, escapePolicy, rewardPolicy, lifecycle, handoff, participants, playerParticipants, controls, sourceFlags, forcedSavePolicy, spawnConditionPolicy, gauInstancePolicy, childPartyAdmission, ...definition } = encounter;
  const manualControls=controls===undefined?{}:{controls:parseSourceBattleControls(controls)};
  const flagPlan=sourceFlags===undefined?undefined:parseSourceBattleFlags(sourceFlags);
  if(flagPlan){
    if(flagPlan.partySource.rowId!==String(id))throw new Error('Battle source flags belong to another encounter');
    assertSourceBattleFlagsControls(flagPlan,manualControls.controls);
  }
  const flagContent=flagPlan===undefined?{}:{sourceFlags:flagPlan};
  const escape = escapePolicy === undefined ? {} : { escapePolicy: parseBattleEscapePolicy(escapePolicy) };
  if (rewardPolicy === undefined && catalog.gameState.characterInitializations)
    throw new Error("Source encounter lacks battle reward policy");
  const rewards = rewardPolicy === undefined ? {} : { rewardPolicy: parseBattleRewardPolicy(rewardPolicy) };
  if (lifecycle === undefined && catalog.gameState.characterInitializations)
    throw new Error("Source encounter lacks battle lifecycle binding");
  const parsedLifecycle = lifecycle === undefined ? undefined : parseBattleLifecycle(lifecycle);
  if (catalog.gameState.characterInitializations && parsedLifecycle?.mode === "script" && parsedLifecycle.program.source === null)
    throw new Error("Source encounter battle lifecycle lacks source identity");
  const event = parsedLifecycle === undefined ? {} : { lifecycle: parsedLifecycle };
  const childContent=childPartyAdmission===undefined?{}:{childPartyAdmission:parseBattleChildAdmission(childPartyAdmission)};
  if(childContent.childPartyAdmission&&childContent.childPartyAdmission.rootPartyId!==id)throw new Error("Child-party admission belongs to another encounter");
  const saveContent={...childContent,...(gauInstancePolicy===undefined?{}:{gauInstancePolicy:parseWebBattleGauInstances(gauInstancePolicy)}),...(forcedSavePolicy===undefined?{}:{forcedSavePolicy:parseWebBattleForcedSave(forcedSavePolicy)}),...(spawnConditionPolicy===undefined?{}:{spawnConditionPolicy:parseWebEnemySpawnConditions(spawnConditionPolicy)})};
  const handoffContent = handoff === undefined ? {} : { handoff: parseBattleHandoffContent(handoff, id) };
  const units = participants === undefined ? {} : { participants: parseBattleParticipantContent(participants, encounter.enemies) };
  const playerPlan = playerParticipants === undefined ? {} : { playerParticipants: parseBattlePlayerPlan(playerParticipants) };
  if (!formationPlan)
    return { ...catalog.common, ...definition, ...escape, ...rewards, ...event, ...handoffContent, ...units, ...playerPlan, ...manualControls, ...flagContent, ...saveContent,
      formation: options[0]!, contentHash: catalog.contentHash };
  const choice = selectBattleFormation(formationPlan, seed);
  return { ...catalog.common, ...definition, ...escape, ...rewards, ...event, ...handoffContent, ...units, ...playerPlan, ...manualControls, ...flagContent, ...saveContent, formation: choice.formation, formationChoice: choice,
    contentHash: catalog.contentHash };
}
export type AbilityDefinition = {
  ordinaryConditionPresentation?: import('./ordinary-condition-action.js').OrdinaryConditionPresentation;
  nonDamagingPresentation?: import("./non-damaging-ability.js").NonDamagingAbilityPresentation;
  /** Source AbilityUtility/FF6 hit classification, independent of the effect
   * plan. It does not itself authorize an effect or an active condition. */
  conditionRecoveryHit?: { kind: "source-condition-recovery-hit-v1"; forAiType: number; isMagic: boolean };
  id: number;
  name: string;
  program: AbilityProgram;
  plan: DevelopmentAbilityPlan | null;
  blockers: string[];
  limitations: string[];
  /** Presentation only. Logic dispatches the complete admitted effect plan. */
  presentation: "beam" | "heal" | "physical" | "condition" | "row" | "source-effect-deferred" | "unsupported";
  power: number;
  cost: number;
  wait: number;
  attribute: number;
};
