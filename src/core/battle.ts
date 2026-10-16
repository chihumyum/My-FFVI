import {parseBattleChildAdmission,parseWebBattleChildAdmission,prepareBattleChildParty,type BattleChildAdmission,type WebBattleChildAdmission} from './battle-child-admission.js';
import { WEB_BATTLE_GAU_INSTANCES, parseBattleGauInstanceContent, gauAppearancePoses, gauAppearanceTimes, gauAppearanceDuration,
  type BattleGauInstanceContent, type BattleGauInstanceHost, type BattleGauOwnedFrame, type BattleGauMediaRequest } from "./battle-gau-instances.js";
import { prepareSourceCatalogName } from "./source-catalog-name.js";
import type { FieldMessageNamesPort } from "./owned-message-names.js";
import { parseBattleGlobalFadeOp, validateBattleGlobalFadeHost, type BattleGlobalFadeHost } from "./battle-global-fade.js";
import { fieldFadeOverlay } from "./field-fade.js";
import { parseFieldReservation, type BattleFieldReservation, type BattleFieldReservationHost } from "./field-reserved-script.js";
import { parseBattleEventCondition, validateBattleEventConditions, WEB_BATTLE_EVENT_CONDITIONS, type BattleEventCondition, type WebBattleEventConditions } from "./battle-event-condition.js";
import {resourceAbsorptionEffect,type AbsorptionContext} from './resource-absorption.js';
import {parseWebEnemySpawnConditions,type WebEnemySpawnConditions} from './battle-spawn-conditions.js';
import {validateOrdinaryConditionAction} from './ordinary-condition-action.js';
import { planCursedShieldCheck, planShadowSecedeLot } from './battle-post-checks.js';
import {parseWebBattleForcedSave,BattleRetainedLootLedger,type BattleSavedForcedReturnResult,type WebBattleForcedSave} from './battle-forced-save.js';
import type { BattleForcedReturnResult } from "./battle-forced-return.js";
import { WEB_BATTLE_BRANCH_EXECUTION, validateBattleBranchExecutionPolicy, type WebBattleBranchExecution } from './battle-branch-execution.js';
import { WEB_BATTLE_EVENT_EFFECTS, WEB_BATTLE_EFFECT_PULSE_MILLISECONDS, parseBattleEventEffectOp, type BattleEventEffectHost, type BattleEffectResourceLease, type BattleEffectProjection, type BattleEventEffectOp } from './battle-event-effect.js';
import { isNonDamagingHit, validateNonDamagingPresentation } from "./non-damaging-ability.js";
import { WEB_SCRIPTED_BATTLE_ACTIONS, validateScriptedBattleActionPolicy, parseScriptedBattleAction, type ScriptedBattleAction, type WebScriptedBattleActions } from "./scripted-battle-action.js";
import type { AbilityEffectResult } from "./ability.js";
import type { ParameterValues } from "./parameters.js";
import { projectAbilityCost, type AbilityCostOwner, type AbilityCostProjection } from "./ability-cost.js";
import { parseSourceBattleControls, WEB_BATTLE_EVENT_CONTROLS, validateBattleEventControls, type WebBattleEventControls } from './battle-controls.js';
import { parseSourceBattleFlags, assertSourceBattleFlagsControls, type SourceBattleFlags } from "./battle-flags.js";
import { equipmentAbilityCostProviders, equipmentOwnedAbilities, validateEquipmentAbilityOwnership, validateEquipmentBattleRows } from "./equipment.js";
import type { OwnedAbility } from "./owned-character.js";
import { projectBattleDrops, validateBattleDropCatalog, type BattleDropPlan, type BattleDropGrant } from "./battle-rewards.js";
import { projectBattleAbilities, projectBattleCommandAvailability, type BattleAbilityProjection } from "./battle-abilities.js";
import {
  createBattleAppearanceState,
  reconcileBattleAppearance,
  projectBattleAppearanceFrame,
  type BattleAppearanceState,
  type BattleAppearanceProjection,
} from "./battle-appearance.js";
import {
  projectBattleItemMenu,
  battleItemContentAllowed,
  battleAbilityContentAllowed,
  type BattleEntryInventory,
  type BattleInventoryWithQualification,
} from "./battle-entry.js";
import { atbIncrement } from "./atb.js";
import {
  chantingSeconds,
  advanceChanting,
  battleClockGate,
  type BattleClockInput,
} from "./battle-timing.js";
import {
  battleAtbSpeed,
  parseBattlePreferences,
  type BattlePreferences,
} from "./battle-preferences.js";
import {
  initialEnemyBehavior,
  type EnemyBehaviorState,
} from "./enemy-behavior.js";
import {
  BattleAIError,
  selectBattleAIAbilities,
  planBattleAITurn,
  planBattleAIReaction,
  startBattleAI,
  type BattleAIState,
  type BattleAITurn,
  type BattleAICounterTargeting,
} from "./battle-ai.js";
import { battleAITargetBlocker, planBattleAITarget, sourceCounterTargeting } from "./battle-ai-targets.js";
import { battleReaction, validateReactionRules } from "./battle-reactions.js";
import { proposeForcedEscape, proposeRandomAbilityDispatch,
  type RandomAbilityDispatchPlan } from "./battle-derived-actions.js";
import { projectActionTargets, type ActionUserConditionResult } from "./action-user-conditions.js";
import { projectPhysicalRows, validateBattleRow, validateBattleRowCatalog, type PhysicalRowContext } from "./battle-row.js";
import type { SlowState } from "./condition-speed.js";
import { createControlRecoveryState, createDoomClock, validateControlRecoveryState, validateDoomClock,
  projectControlRecovery, projectDoomClock, stopConditionRecoveryDuration, type ControlRecoveryState, type DoomClockState,
  type ControlConditionBehavior } from "./condition-control.js";
import {
  validateItemStacks,
  type ItemDefinition,
  type ItemStack,
} from "./items.js";
import { validateElements, validateElementResistances } from "./elements.js";
import {
  battleTargetChoices,
  resolveBattleTargets,
  sameTargetSelection,
  type TargetChoice,
  type TargetSelection,
} from "./battle-targets.js";
import {
  BattleConditions,
  conditionsAllowAction,
  type PoisonState,
} from "./battle-conditions.js";
import type {
  BattleContent,
  CombatantDefinition,
  AbilityDefinition,
} from "./battle-content.js";
import { battleDefinitionBlocker } from "./battle-content.js";
import { validateBattleFormationChoice } from "./battle-formations.js";
import { parseBattleEscapePolicy, type FrameworkBattleEscapePolicy } from "./battle-escape.js";
import { parseBattleRewardPolicy, projectMagicLearningValue, type BattleRewardPolicy } from "./battle-result.js";
import { observeLearningAction, validateObservedLearningCatalog } from "./character-learning.js";
import { advanceBattleEvent, acknowledgeBattleEventMessage, createBattleEventState, BattleEventError, type BattleEventState } from "./battle-event.js";
import { WEB_BATTLE_EVENT_MESSAGE_POLICY, prepareBattleEventMessagePresentation,
  type BattleEventMessageHost, type BattleEventMessagePresentation } from "./battle-event-message.js";
import { createSourceMessageTaskCursor } from "./source-message-sequence.js";
import type { SourceMessageEffect, SourceMessageState } from "./source-message.js";
import { parseBattleLifecycle, type BattleLifecycle } from "./battle-lifecycle.js";
import { battleEventUnitEnded } from "./battle-event-context.js";
import { BattleEventSharedState, type BattleEventSharedSnapshot } from "./battle-event-shared.js";
import { parseBattleGauEntry, planBattleGauMode, type BattleGauEntry } from './battle-gau.js';
import { parseBattleParticipantContent, type BattleParticipantContent, type BattleParticipantSlot,
  type EnemyBattleDefinition } from "./battle-participants.js";
import { createBattleParticipantState, projectEnemyReplacement, projectEnemyPartyReplacement, projectBattleParticipantRewards,
  type BattleParticipantState } from "./battle-participant-state.js";
import { canonical } from "./canonical.js";
import { sourceControlCommandIds, planWebControlAction, planWebControlTarget, webControlTargetChoices,
  type ControlActionMetadata, type ControlActionCandidate } from "./condition-control-actions.js";
import { parseBattlePlayerBorrow, parseBattlePlayerPlan, type BattlePlayerBorrow,
  type BattlePlayerReturn } from "./battle-player-participants.js";
import { createBattlePlayerState, parseBattlePlayerState, projectPlayerJoin, projectPlayerGroup,
  firstEnteredOwnerIds, type BattlePlayerState, type BattlePlayerProjection } from "./battle-player-state.js";

export type Combatant = CombatantDefinition & {
  maxHp: number;
  maxMp: number;
  atb: number;
  queued: boolean;
  /** Shared enemy parameters; deliberately separate from VM execution state. */
  behavior: EnemyBehaviorState | null;
  appearanceState?: BattleAppearanceState;
};
export type BattleStatProjection = Omit<ParameterValues, "hp" | "mp"> &
  Pick<
    Combatant,
    "maxHp" | "maxMp" | "physical" | "attackElements" | "elementResistances"
  >;
export type BattleAction = {
  /** Assigned once by this BattleGame when actually enqueued; never saved. */
  executionTicket?: number;
  kind: "normal" | "loop" | "counter" | "derived" | "event";
  scripted?: { pc: number; command: ScriptedBattleAction; targetInstanceIds: string[] };
  /** Legacy CounterAct captures the attacker; command-conditioned interrupts
   * pass a null target to the native controller and use automatic selection. */
  targeting?: BattleAICounterTargeting;
  /** Battle-local action authority under the explicit Web control policy. */
  control?: ControlActionMetadata;
  actor: string;
  selection: TargetSelection;
  targetIds: string[];
  source: { kind: "ability"; id: number } | { kind: "item"; id: number };
  commandId: number | null;
  /** Native float32 seconds remaining, including a negative ready remainder. */
  charge: number;
  elapsed: number;
  resolved: boolean;
  /** Captured at source InitActionState, before effects or later condition ticks. */
  learningAbilityIds?: number[];
  learningByOwner?: { ownedId: string; abilityIds: number[] }[];
  results: { target: string; effects: AbilityEffectResult[] }[];
  /** Independent caster results; never substituted for target calculation. */
  userConditionResults?: ActionUserConditionResult[];
  /** Caster recovery is presentation data, never another received target hit. */
  userResourceResults?: {ownerId:string;slot:number;resource:'hp'|'mp';recovery:true;amount:number;missed:boolean;nullified?:boolean}[];
};
export type BattleReward = {
  exp: number;
  gil: number;
  magicPoints: number;
  each: number;
  recipients: string[];
  levels: { id: string; from: number; to: number }[];
  drops: BattleDropPlan["drops"] | "pending";
  dropPlan: BattleDropPlan | null;
};
export type BattleEvent = { time: number; text: string };
export type BattleMenuCommand = {
  id: number;
  name: string;
  kind: "ability" | "item" | "unresolved";
  abilityIds: number[];
  menu: "normal" | "extra";
  available: boolean;
  usesList: boolean;
  blockers: string[];
};
type ControlFunctionState = { recovery: ControlRecoveryState; doom: DoomClockState | null };

/** Playability profile only. All provisional rules are enumerated in docs/battle-playability.md.
 * Fixed simulation steps + owned PRNG make failures reproducible; they do not reproduce Unity RNG.
 */
export class BattleGame {
  readonly combatants: Combatant[];
  readonly events: BattleEvent[] = [];
  phase: "active" | "victory" | "defeat" | "escaped" | "forced" = "active";
  action: BattleAction | null = null;
  reward: BattleReward | null = null;
  time = 0;
  private remainder = 0;
  private randomState: number;
  private queue: BattleAction[] = [];
  #nextActionTicket=1;
  /** The native fixed-player dictionary remembers the latest accepted action
   * per source character. Store a reference ticket, never another action copy. */
  #fixedPlayerActions=new Map<number,number>();
  #actionCancellations:{pc:number;time:number;staged:number|null;stagedCommitted:boolean;queued:number[];fixed:{sourceId:number;ticket:number}[]}[]=[];
  get actionExecutor(){return {state:this.action?(this.action.resolved?'presenting':'staging'):'idle',
    currentTicket:this.action?.executionTicket??null,fixedPlayerActions:[...this.#fixedPlayerActions].map(([sourceId,ticket])=>({sourceId,ticket})),
    cancellations:structuredClone(this.#actionCancellations)};}

  private reactions: BattleAction[] = [];
  private aiStates = new Map<string, BattleAIState>();
  private poisonStates = new Map<string, PoisonState>();
  private slowStates = new Map<string, SlowState>();
  /** Function-local clocks/captured targeting, not a second condition list.
   * Exact unit references prevent a retired target's ID being rebound. */
  private controlStates = new Map<string, ControlFunctionState[]>();
  private controlTargetUnits = new Map<string, Map<number, Combatant>>();
  private collected = false;
  private readonly escapeRule: FrameworkBattleEscapePolicy | null;
  private readonly rewardPolicy: Readonly<BattleRewardPolicy>;
  private readonly lifecycle: BattleLifecycle;
  private readonly controlPolicy: BattleContent["conditionControlPolicy"] | null;
  private readonly playerConditionTraits = new Map<number, Readonly<NonNullable<CombatantDefinition["conditionTraits"]>>>();
  readonly #conditionUnitIdentities = new WeakMap<Combatant, { id: string; sourceId: number; side: "player" | "enemy" }>();
  private eventState: BattleEventState | null = null;
  readonly #branchPolicy:WebBattleBranchExecution|undefined;
  #branchVisited=new Set<number>();
  #branchFrameVisited:number[]=[];
  #branchLastFailure:{pc:number;reason:string;raw:unknown;attemptedTime:number;attemptedVisited:number[]}|null=null;
  get eventBranchExecution(){
    if(this.lifecycle.kind!=="battle-lifecycle-v2")return null;
    const p=this.lifecycle.program,visited=[...this.#branchVisited].sort((a,b)=>a-b);
    return {policy:this.#branchPolicy,committedVisited:visited,unvisited:p.instructions.flatMap((_,pc)=>this.#branchVisited.has(pc)?[]:[pc]),
      unvisitedDependencies:p.branchExecution!.deferred.filter(site=>!this.#branchVisited.has(site.pc)).map(site=>({...site,raw:structuredClone(p.branchExecution!.sourceProgram.Mnemonics[site.pc])})),
      lastFailure:structuredClone(this.#branchLastFailure)};
  }
  private get deferredEventStart(){return !!this.#childAdmission||!!(this.content.gauInstancePolicy&&this.#gauHost)||this.#hasGlobalFade||!!this.#messageHost||!!this.#effectHost||this.lifecycle.kind==="battle-lifecycle-v2"||this.lifecycle.mode==="script"&&this.lifecycle.program.instructions.some(row=>row.op.kind==="condition-list");}
  readonly #fadeHost:BattleGlobalFadeHost|null;
  #hasGlobalFade=false;
  #fadeRevision=0;
  #fadeFrame:ReturnType<BattleGlobalFadeHost["owner"]["prepareFrame"]>|null=null;
  #fadeJournal:{action:"start"|"complete";pc:number;time:number}[]=[];
  get globalFadeOverlay(){return fieldFadeOverlay(this.#fadeHost?.owner.projection??null);}
  get globalFadeRaycast(){return this.#fadeHost?.owner.projection?.raycastTarget??false;}
  get fadeExecution(){return structuredClone(this.#fadeJournal);}
  private validateFadeOwnership(){if(this.#fadeHost&&this.#fadeHost.owner.mutationRevision!==this.#fadeRevision)throw new Error("Shared global fade owner changed outside its battle frame");}


  readonly #effectHost: BattleEventEffectHost | null;
  #effects: {projection:BattleEffectProjection;targets:Combatant[];resource:BattleEffectResourceLease}[]=[];
  #effectNextTicket=1;
  #effectRetired=false;
  #effectPendingCommits:BattleEffectResourceLease[]=[];
  #effectPendingDiscards:BattleEffectResourceLease[]=[];
  #effectJournal:{action:'request'|'play'|'complete'|'retire';ticket:number;pc:number;time:number}[]=[];
  #effectCleanupFailures:{reason:'complete'|'rollback'|'retire';time:number}[]=[];
  #frameCleanupFailures:{owner:'message'|'fade'|'owned';time:number}[]=[];
  get frameCleanupFailures(){return structuredClone(this.#frameCleanupFailures);}
  private discardBattleFrame(owner:'message'|'fade'|'owned',frame:{discard():void}|null|undefined):void {
    try{frame?.discard();}catch{this.#frameCleanupFailures.push({owner,time:this.time});}
  }
  get effectPresentation():readonly BattleEffectProjection[]{return this.#effects.map(e=>structuredClone(e.projection));}
  get effectExecution(){return structuredClone(this.#effectJournal);}
  /** Resource cleanup is outside logical publication. Failure cannot restore an
   * already published window or stop the remaining resources from retiring. */
  get effectCleanupFailures(){return structuredClone(this.#effectCleanupFailures);}
  private discardBattleEffectResources(resources:readonly BattleEffectResourceLease[],reason:'complete'|'rollback'|'retire'):void {
    for(const resource of resources)try{resource.discard();}
    catch{this.#effectCleanupFailures.push({reason,time:this.time});}
  }
  /** Global join also sees the existing action presentation, never a separate
   * fake source completion flag supplied by the VM. */
  private get battleEffectsFinished(){return this.#effects.length===0&&this.action===null;}
  private prepareBattleEffect(op:Extract<BattleEventEffectOp,{kind:'play-battle-effect'}>,pc:number):void {
    op=parseBattleEventEffectOp(op) as typeof op;
    if(!this.#effectHost||this.#effectRetired||this.lifecycle.mode!=='script'||
      canonical(this.lifecycle.program.instructions[pc]?.op)!==canonical(op))throw new Error('Unbound battle effect request');
    const targets=this.scriptedUnits(op.target);
    if(targets.length!==1)throw new Error('Battle effect source target is absent or ambiguous');
    const ticket=this.#effectNextTicket++,request={ticket,effect:structuredClone(op.effect),targetInstanceIds:targets.map(t=>t.id)},
      resource=this.observeMessageProvider(()=>this.#effectHost!.prepare(request));
    if(!resource||['status','validate','commit','discard'].some(k=>typeof resource[k as keyof BattleEffectResourceLease]!=='function'))throw new Error('Invalid battle effect resource lease');
    this.#effectPendingCommits.push(resource);this.observeMessageProvider(()=>resource.validate());
    this.#effects.push({projection:{ticket,pc,effect:structuredClone(op.effect),targetInstanceIds:targets.map(t=>t.id),phase:'loading',elapsed:0,duration:WEB_BATTLE_EFFECT_PULSE_MILLISECONDS},targets:[...targets],resource});
    this.#effectJournal.push({action:'request',ticket,pc,time:this.time});
  }
  private advanceBattleEffects():void {
    for(const e of [...this.#effects]){
      if(e.targets.some((unit,index)=>!this.activeCombatants.includes(unit)||unit.id!==e.projection.targetInstanceIds[index]))throw new Error('Retired battle effect target instance');
      this.observeMessageProvider(()=>e.resource.validate());
      if(e.projection.phase==='loading'){
        const status=this.observeMessageProvider(()=>e.resource.status());
        if(status==='failed')throw new Error('Battle effect resource preparation failed');
        if(status==='loading')continue;
        if(status!=='ready')throw new Error('Unknown battle effect resource status');
        e.projection.phase='playing';e.projection.elapsed=0;
        this.#effectJournal.push({action:'play',ticket:e.projection.ticket,pc:e.projection.pc,time:this.time});
      }else{
        e.projection.elapsed+=10;
        if(e.projection.elapsed>=e.projection.duration){
          this.#effects=this.#effects.filter(row=>row!==e);this.#effectPendingDiscards.push(e.resource);
          this.#effectJournal.push({action:'complete',ticket:e.projection.ticket,pc:e.projection.pc,time:this.time});
        }
      }
    }
  }
  private prepareEffectRetirement(){
    const before=canonical({effects:this.effectPresentation,journal:this.#effectJournal,next:this.#effectNextTicket,time:this.time}),resources=this.#effects.map(e=>e.resource);let used=false;
    const validate=()=>{if(used||this.#effectRetired||this.#messageBusy||canonical({effects:this.effectPresentation,journal:this.#effectJournal,next:this.#effectNextTicket,time:this.time})!==before)throw new Error('Stale battle effect retirement');for(const r of resources)this.observeMessageProvider(()=>r.validate());};
    // Only prepareEventRetirement calls commit, immediately after validating
    // both owners and publishing the message retirement. No host callback may
    // fail between that publication and these owned effect-state assignments.
    return {validate,commit:()=>{used=true;this.#effectRetired=true;this.#effects=[];this.#effectJournal.push({action:'retire',ticket:0,pc:-1,time:this.time});this.discardBattleEffectResources(resources,'retire');}};
  }
  prepareEventRetirement(){const message=this.prepareMessageRetirement(),effect=this.prepareEffectRetirement(),
    task=this.#gauTask,resource=task?.resource;let used=false;
    const validate=()=>{if(used||this.#gauTask!==task)throw new Error("Stale source Gau retirement");message.validate();effect.validate();resource?.validate();};
    return {validate,commit:()=>{validate();message.commit();effect.commit();used=true;this.#gauHost?.owned.retire();this.#gauTask=null;
      this.#gauJournal.push({action:"retire",pc:-1,time:this.time,actorId:null,value:null});if(resource)this.discardBattleEffectResources([resource],"retire");}};}
  readonly #messageHost: BattleEventMessageHost | null;
  #messageFrame: ReturnType<SourceMessageState["prepareFrame"]> | null = null;
  #messagePresentation: { ticket: number; value: BattleEventMessagePresentation } | null = null;
  #messageFrameValidations: (() => void)[] = [];
  #messageFrameEffects: readonly SourceMessageEffect[] | null = null;
  #messageBusy = false;
  #messageRetired = false;
  #messageRootStarted = false;
  #messageJournal: { action: "open" | "close" | "page-input" | "complete" | "confirm" | "retire";
    pc: number | null; ticket: number | null; time: number }[] = [];
  get messageExecution() { return structuredClone(this.#messageJournal); }
  private validateMessageOwnership(): void {
    const owner = this.#messageHost?.owner;
    if (owner?.active && (!this.#messagePresentation || owner.projection?.windowTicket !== this.#messagePresentation.ticket))
      throw new Error("Battle source-message window was replaced outside its owner");
  }
  private observeMessageProvider<T>(read: () => T): T {
    const fingerprint = () => canonical({ units: this.combatants, time: this.time, phase: this.phase,
      event: this.eventState, controls: this.eventControls, queue: this.queue, reactions: this.reactions,
      action: this.action, stock: this.stock, reward: this.reward, random: this.randomState,
      preferences: this.currentPreferences, clock: this.clockInput, remainder: this.remainder, events: this.events,
      effect:this.effectPresentation,effectJournal:this.#effectJournal,nextEffect:this.#effectNextTicket });
    const before = fingerprint(), result = read();
    if (fingerprint() !== before) throw new Error("Battle message observer mutated a gameplay owner");
    return result;
  }
  get sourceMessage(): SourceMessageState | undefined { return this.#messageRetired ? undefined : this.#messageHost?.owner; }
  get messagePresentation(): BattleEventMessagePresentation | null {
    const held = this.#messagePresentation, value = this.#messageHost?.owner.projection;
    return held && value?.windowTicket === held.ticket ? { ...held.value } : null;
  }
  get messageInputPending(): boolean { return this.eventState?.wait?.kind === "message"; }
  confirmMessage(): boolean {
    if (this.#messageRetired) throw new Error("Retired battle message owner");
    if (this.#messageBusy) throw new Error("Reentrant battle message input");
    this.validateMessageOwnership();
    const ticket = this.#messageHost?.owner.projection?.windowTicket ?? null,
      accepted = this.#messageHost?.owner.confirm() ?? false;
    if (accepted) this.#messageJournal.push({ action: "confirm", pc: this.eventState?.pc ?? null, ticket, time: this.time });
    return accepted;
  }
  /** Explicit Web battle-scene retirement, not a synthetic confirmation. The
   * live global owner is cleared only by successful retry/return publication. */
  prepareMessageRetirement() {
    const owner = this.#messageHost?.owner, held = this.#messagePresentation;
    if (!owner) return { validate() {}, commit() {} };
    if (owner.active && (!held || owner.projection?.windowTicket !== held.ticket))
      throw new Error("Battle message owner was replaced before retirement");
    const revision = owner.mutationRevision, close = owner.prepare({ kind: "source-message", command: { kind: "close" } }),
      effects = this.#messageHost!.prepareEffects(close.effects);
    let committed = false;
    const validate = () => {
      if (committed || this.#messageRetired || this.#messageBusy || owner.mutationRevision !== revision || this.#messagePresentation !== held)
        throw new Error("Stale battle message retirement");
      effects.validate();
    };
    return { validate, commit: () => { validate(); effects.commit(); close.commit(); this.#messagePresentation = null; this.#messageRetired = true;
      this.#messageJournal.push({ action: "retire", pc: null, ticket: held?.ticket ?? null, time: this.time }); committed = true; } };
  }
  private readonly eventShared: BattleEventSharedState | null;
  readonly #childAdmission:BattleChildAdmission|undefined;
  readonly #gauHost: BattleGauInstanceHost | null;
  readonly #gauContent: BattleGauInstanceContent | null;
  #gauFrame: BattleGauOwnedFrame | null = null;
  #gauTask: {kind:"replace"|"appearance";pc:number;phase:"loading"|"playing"|"complete";
    resource:BattleEffectResourceLease|null;partyId:number|null;actor:Combatant|null;startTime:number;poseIndex:number} | null = null;
  #gauJournal: {action:"request"|"replace"|"pose"|"complete"|"join"|"retire";pc:number;time:number;actorId:string|null;value:number|string|null}[]=[];
  private readonly gauEntry:BattleGauEntry|null;
  private gauEnemyIds:number[]|null=null;
  private fieldReservation: BattleFieldReservation | null = null;
  private gauModeJournal:{pc:number;modeWrite:1|2|null;atMilliseconds:number}[]=[];
  private readonly participantContent: BattleParticipantContent | null;
  private readonly entryEnemies: CombatantDefinition[];
  private participantState: BattleParticipantState;
  private currentEnemyPartyId: number;
  private currentEnemySlots: Record<string, BattleParticipantSlot>;
  private hiddenEnemyIds = new Set<string>();
  private readonly playerBorrow: BattlePlayerBorrow | null;
  private playerState: BattlePlayerState | null = null;
  /** Retired resource copies; active resources remain owned by combatants. */
  private playerResources = new Map<string, Combatant>();
  private playerObservations = new Map<string, number[]>();
  private eventControls = { aiStarted: false, aiAliveLastSync: false, endEnabled: true,
    interactive: true, updateEnabled: true, enemyNoAct: false };
  private eventUI = { visible: true, pauseLocked: false, revision: 0 };
  /** Detached presentation/input projection. The battle owns these facts. */
  get uiControls() { return { ...this.eventUI }; }
  private escapeRequested = false;
  private forceReturnRequested = false;
  private forceSaveRequested=false;
  private forcedSaveTerminal=false;
  private readonly forcedSavePolicy:WebBattleForcedSave|null;
  private readonly spawnConditionPolicy:WebEnemySpawnConditions|null;
  private readonly retainedLoot=new BattleRetainedLootLedger();
  private currentPreferences: BattlePreferences;
  private currentPlayerControlMode:'manual'='manual';
  get playerControlMode():'manual' {return this.currentPlayerControlMode;}
  setAutomaticMode(value:boolean):void {if(value!==false)throw new Error('Automatic actions require an unimplemented Web controller');this.currentPlayerControlMode='manual';}
  private clockInput = {
    paused: false,
    helpPaused: false,
    progressEnabled: true,
    uiWaiting: false,
    forceWaiting: false,
  };
  readonly conditions: BattleConditions;
  readonly items: Record<string, ItemDefinition>;
  private stock: ItemStack[];
  private inventoryQualification: BattleEntryInventory | undefined;
  private readonly costOwners = new Map<string, AbilityCostOwner>();
  private readonly unresolvedCostOwners = new Set<string>();
  private readonly equipmentAbilities = new Map<string, OwnedAbility[]>();
  private consumedItems: ItemStack[] = [];
  private observedAbilityIds: number[] = [];
  private dropRegistrations: number[] = [];
  private dropDead = new Set<string>();
  /** Participation history survives battle-end condition cleanup. HP and
   * active conditions remain on the original combatant, never on this record. */
  private enemyExits = new Map<string, { kind: "escaped"; conditionId: number }>();
  private rewardRegisteredInstances = new Set<string>();
  private readonly sourceFlags:SourceBattleFlags|null;
  get sourceFlagExecution():SourceBattleFlags|null{return this.sourceFlags===null?null:structuredClone(this.sourceFlags);}
  constructor(
    readonly content: BattleContent,
    seed: number,
    players?: Combatant[],
    inventory: BattleInventoryWithQualification = { definitions: {}, stacks: [], limit: 99 },
    private readonly projectProgression?: (
      player: Combatant,
      amount: number,
      observedAbilityIds: readonly number[],
      magicPoints: number,
      participantIndex?: number,
    ) => BattleStatProjection & { level: number; exp: number; magicLearningValue?: number },
    initialPreferences?: BattlePreferences,
    eventShared?: BattleEventSharedSnapshot,
    playerBorrow?: BattlePlayerBorrow,
    private readonly eventHosts?: { names?: FieldMessageNamesPort; childPartyAdmission?:WebBattleChildAdmission; gauInstances?:BattleGauInstanceHost; conditions?: WebBattleEventConditions; scriptedActions?: WebScriptedBattleActions; messages?: BattleEventMessageHost; effects?:BattleEventEffectHost; fade?:BattleGlobalFadeHost; controls?:WebBattleEventControls; gau?:BattleGauEntry; fieldContinuation?:BattleFieldReservationHost; branchExecution?:WebBattleBranchExecution },
  ) {
    if (eventHosts !== undefined && (!eventHosts || typeof eventHosts !== "object" || Array.isArray(eventHosts) ||
        Object.keys(eventHosts).some(key => key !== "names" && key !== "childPartyAdmission" && key !== "gauInstances" && key !== "conditions" && key !== "messages" && key !== "scriptedActions" && key !== "effects" && key !== "controls" && key !== "branchExecution" && key !== "gau" && key !== "fade" && key !== "fieldContinuation")))
      throw new Error("Unknown battle event host options");
    validateBattleBranchExecutionPolicy(eventHosts?.branchExecution);this.#branchPolicy=eventHosts?.branchExecution;
    validateBattleGlobalFadeHost(eventHosts?.fade);this.#fadeHost=eventHosts?.fade?Object.freeze({...eventHosts.fade}):null;
    this.#fadeRevision=this.#fadeHost?.owner.mutationRevision??0;
    if(eventHosts?.childPartyAdmission!==undefined)parseWebBattleChildAdmission(eventHosts.childPartyAdmission);
    this.#childAdmission=content.childPartyAdmission===undefined?undefined:parseBattleChildAdmission(content.childPartyAdmission);
    if(this.#childAdmission&&(this.#childAdmission.rootPartyId!==content.encounterId||eventHosts?.childPartyAdmission!==this.#childAdmission.policy))throw new Error("Source child-party admission requires matching content and actual runtime policy");
    this.#gauContent=content.gauInstances===undefined?null:parseBattleGauInstanceContent(content.gauInstances);
    const gauHost=eventHosts?.gauInstances;
    if(gauHost&&(gauHost.policy!==WEB_BATTLE_GAU_INSTANCES||typeof gauHost.prepare!=="function"||
      gauHost.owned?.policy!==WEB_BATTLE_GAU_INSTANCES||typeof gauHost.owned.prepareFrame!=="function"||typeof gauHost.owned.retire!=="function"))
      throw new Error("Unknown source Gau actual instance/media/owned host");
    this.#gauHost=gauHost?Object.freeze({...gauHost}):null;
    const messageHost = eventHosts?.messages;
    if(eventHosts?.effects!==undefined&&(eventHosts.effects.policy!==WEB_BATTLE_EVENT_EFFECTS||typeof eventHosts.effects.prepare!=="function"))throw new Error("Unknown battle effect presentation host");
    if (
      content.kind !== "opening-battle-development" ||
      content.profile !== "narshe-playability-v35"
    )
      throw new Error("Unsupported battle runtime profile");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error("Invalid battle seed");
    if (content.formation !== "normal" && content.formation !== "opposed")
      throw new Error("Battle formation selection is unresolved");
    if (content.formationChoice !== undefined)
      validateBattleFormationChoice(content.formationChoice, content.formation, seed);
    this.sourceFlags=content.sourceFlags===undefined?null:parseSourceBattleFlags(content.sourceFlags);
    if(this.sourceFlags){
      if(this.sourceFlags.partySource.rowId!==String(content.encounterId))throw new Error("Battle source flags belong to another encounter");
      assertSourceBattleFlagsControls(this.sourceFlags,content.controls);
    }
    this.escapeRule = content.escapePolicy === undefined ? null : parseBattleEscapePolicy(content.escapePolicy);
    this.rewardPolicy = Object.freeze(parseBattleRewardPolicy(content.rewardPolicy === undefined
      ? { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 } : content.rewardPolicy));
    validateBattleEventConditions(eventHosts?.conditions);
    validateScriptedBattleActionPolicy(eventHosts?.scriptedActions);
    validateBattleEventControls(eventHosts?.controls);
    this.lifecycle = parseBattleLifecycle(content.lifecycle ?? { kind: "battle-lifecycle-v1", mode: "none" });
    if(content.gauInstancePolicy!==undefined&&content.gauInstancePolicy!==WEB_BATTLE_GAU_INSTANCES)throw new Error("Unknown source Gau instance content policy");
    if(this.lifecycle.mode==="script"&&this.lifecycle.program.instructions.some(({op})=>["gau-replace","gau-appearance","gau-join"].includes(op.kind))&&
      (!this.#gauHost||!this.#gauContent||content.gauInstancePolicy!==WEB_BATTLE_GAU_INSTANCES))
      throw new Error("Source Gau instances require explicit content and actual media/owned host");
    this.spawnConditionPolicy=content.spawnConditionPolicy===undefined?null:parseWebEnemySpawnConditions(content.spawnConditionPolicy);
    this.forcedSavePolicy=content.forcedSavePolicy===undefined?null:parseWebBattleForcedSave(content.forcedSavePolicy);
    if(eventHosts?.fieldContinuation){
      if(typeof eventHosts.fieldContinuation.require!=='function')throw new Error('Missing source field reservation host');
      this.fieldReservation={kind:'battle-field-reservation-v1',entry:eventHosts.fieldContinuation.entry===null?null:parseFieldReservation(eventHosts.fieldContinuation.entry),candidate:eventHosts.fieldContinuation.entry===null?null:parseFieldReservation(eventHosts.fieldContinuation.entry)};
    }
    this.gauEntry=eventHosts?.gau===undefined?null:parseBattleGauEntry(eventHosts.gau);
    if(this.gauEntry&&this.gauEntry.catalogHash!==content.contentHash)throw new Error('Gau entry belongs to another battle catalog');
    if(this.lifecycle.mode==='script'&&this.lifecycle.program.instructions.some(({op})=>op.kind==='set-gau-mode'||op.kind==='shadow-secede-lot'||op.kind==='shadow-battle-departure')&&!this.gauEntry)
      throw new Error('Gau/Shadow checks require their complete source-owned battle entry');
    if(this.lifecycle.kind==="battle-lifecycle-v2"&&this.#branchPolicy!==WEB_BATTLE_BRANCH_EXECUTION)throw new Error("Source branch lifecycle requires the explicit Web runtime host");
    const hasMessages = this.lifecycle.mode === "script" && this.lifecycle.program.instructions.some(({ op }) => op.kind === "message");
    if (hasMessages && (!messageHost || messageHost.policy !== WEB_BATTLE_EVENT_MESSAGE_POLICY ||
        !messageHost.owner || typeof messageHost.sequence?.prepare !== "function" || typeof messageHost.prepareEffects !== "function"))
      throw new Error("Battle event Msg requires the shared source-message host and explicit Web policy");
    this.#messageHost = hasMessages ? Object.freeze({ ...messageHost! }) : null;
    const hasEffects=this.lifecycle.mode==='script'&&this.lifecycle.program.instructions.some(({op})=>['play-battle-effect','sync-battle-effect'].includes(op.kind));
    if(hasEffects&&!eventHosts?.effects)throw new Error('Battle effects require their explicit Web presentation/resource host');
    this.#hasGlobalFade=this.lifecycle.mode==='script'&&this.lifecycle.program.instructions.some(row=>row.op.kind==='global-fade');
    if(this.#hasGlobalFade&&(!this.#fadeHost||!this.#fadeHost.owner.known))throw new Error('Battle global fade requires its actual known shared Field fade host');
    this.#effectHost=hasEffects?Object.freeze({...eventHosts!.effects!}):null;
    if (content.conditionControlPolicy !== undefined && (!content.conditionControlPolicy ||
        Object.keys(content.conditionControlPolicy).length !== 1 || content.conditionControlPolicy.kind !== "web-source-control-actions-v1"))
      throw new Error("Invalid condition-control scheduler policy");
    this.controlPolicy = content.conditionControlPolicy === undefined ? null : Object.freeze({ ...content.conditionControlPolicy });
    if (content.playerConditionTraits !== undefined) {
      if (!content.playerConditionTraits || Array.isArray(content.playerConditionTraits) || typeof content.playerConditionTraits !== "object")
        throw new Error("Invalid source player condition traits");
      for (const [key, traits] of Object.entries(content.playerConditionTraits)) {
        const sourceId = Number(key);
        if (!Number.isSafeInteger(sourceId) || sourceId < 1 || String(sourceId) !== key || !traits ||
            Object.keys(traits).length !== 2 || traits.kind !== "source-condition-traits-v1" || typeof traits.baseUndead !== "boolean")
          throw new Error("Invalid source player condition traits");
        this.playerConditionTraits.set(sourceId, Object.freeze({ ...traits }));
      }
    }
    this.entryEnemies = structuredClone(content.enemies);
    this.participantContent = content.participants === undefined ? null
      : parseBattleParticipantContent(content.participants, this.entryEnemies);
    this.playerBorrow = playerBorrow === undefined ? null : parseBattlePlayerBorrow(playerBorrow);
    if (Boolean(content.playerParticipants) !== Boolean(this.playerBorrow) ||
        (this.playerBorrow && canonical(parseBattlePlayerPlan(content.playerParticipants)) !== canonical(this.playerBorrow.plan)))
      throw new Error("Battle player plan requires its matching owned borrow");
    this.currentEnemyPartyId = content.encounterId;
    this.currentEnemySlots = structuredClone(this.participantContent?.slots ?? {});
    this.participantState = createBattleParticipantState(this.entryEnemies.map((unit, index) => ({
      id: unit.id, sourceId: unit.sourceId, exp: unit.exp, gil: unit.gil,
      uniqueId: this.participantContent?.initial.find(entry => entry.id === unit.id)?.uniqueId ?? index + 1,
    })));
    this.eventShared = eventShared === undefined ? null : new BattleEventSharedState(eventShared);
    if (this.lifecycle.mode === "script") this.eventState = createBattleEventState(this.lifecycle.program,this.#branchPolicy);
    if (this.lifecycle.mode === "script") for (const [pc, { op }] of this.lifecycle.program.instructions.entries()) {
      if ((op.kind === "ui-visibility" || op.kind === "stop-auto" || op.kind === "force-return" || op.kind === "force-save-return" || op.kind === "remove-all-actions") && eventHosts?.controls !== WEB_BATTLE_EVENT_CONTROLS)
        throw new BattleEventError(this.lifecycle.program.source, pc, "Missing explicit Web battle event control policy");
      if(op.kind==='force-save-return'&&!this.forcedSavePolicy)throw new BattleEventError(this.lifecycle.program.source,pc,"Missing explicit Web saved forced-return policy");
      if(op.kind==="script-action"){
        if(eventHosts?.scriptedActions!==WEB_SCRIPTED_BATTLE_ACTIONS)
          throw new BattleEventError(this.lifecycle.program.source,pc,"Missing explicit Web scripted battle action policy");
        if(!content.abilities[op.abilityId]?.plan)
          throw new BattleEventError(this.lifecycle.program.source,pc,"Unresolved scripted battle ability "+op.abilityId);
      }
      if (op.kind === "add-enemy" && (!this.participantContent ||
          !this.participantContent.enemyDefinitions[op.monsterId] || !this.participantContent.slots[op.uniqueId]))
        throw new BattleEventError(this.lifecycle.program.source, pc, "Missing admitted battle enemy entry definition or slot");
      if (op.kind === "add-enemy" && this.participantContent?.enemyParties &&
          Object.values(this.participantContent.enemyParties).some(party => !party.slots[op.uniqueId]))
        throw new BattleEventError(this.lifecycle.program.source, pc, "Missing admitted enemy slot in replacement party");
      if (op.kind === "change-enemy-party" && !this.participantContent?.enemyParties?.[op.partyId])
        throw new BattleEventError(this.lifecycle.program.source, pc, "Missing admitted replacement enemy party");
      if (op.kind === "add-player" && (!this.playerBorrow?.plan.sourceIds.includes(op.sourceId) ||
          !this.playerBorrow.candidates.some(player => player.sourceId === op.sourceId)))
        throw new BattleEventError(this.lifecycle.program.source, pc, "Missing admitted owned player borrow");
      if (op.kind === "change-player-group" && !this.playerBorrow?.groups[op.group])
        throw new BattleEventError(this.lifecycle.program.source, pc, "Missing admitted Web player group");
    }
    if(content.controls!==undefined){const controls=parseSourceBattleControls(content.controls);this.currentPlayerControlMode=controls.initialMode;}
    this.randomState = seed || 1;
    this.currentPreferences = parseBattlePreferences(content.timing);
    if (initialPreferences !== undefined)
      this.currentPreferences = parseBattlePreferences(initialPreferences);
    this.items = structuredClone(inventory.definitions);
    validateItemStacks(inventory.stacks, this.items, inventory.limit);
    this.stock = structuredClone(inventory.stacks);
    this.inventoryQualification = inventory.qualification ? structuredClone(inventory.qualification) : undefined;
    validateReactionRules(content.reactions);
    this.conditions = new BattleConditions(content.conditions);
    if (content.observedLearning) validateObservedLearningCatalog(content.observedLearning);
    if (content.battleRows) validateBattleRowCatalog(content.battleRows);
    if (content.drops !== null) {
      validateBattleDropCatalog(content.drops);
      if (content.enemies.some((enemy) => !content.drops!.monsters.some((row) => row.id === enemy.sourceId)))
        throw new Error("Missing enemy drop definition");
    }
    if (Boolean(content.battleAbilities) !== Boolean(content.qualificationContext))
      throw new Error("Incomplete battle qualification configuration");
    if (content.qualificationContext &&
      (!["source", "development-static"].includes(content.qualificationContext.mode) ||
       !["current", "unknown"].includes(content.qualificationContext.conditionContext)))
      throw new Error("Invalid battle qualification mode");
    const templateBlocker = battleDefinitionBlocker(players ?? content.players, content.qualificationContext, content.conditions);
    if (templateBlocker) throw new Error(templateBlocker);
    if ((players ?? content.players).some(player => player.nameSource !== undefined))
      throw new Error("Owned player names cannot be replaced by catalog templates");
    const entryNames = content.enemies.map(enemy => prepareSourceCatalogName(enemy.name, enemy.nameSource, eventHosts?.names));
    this.combatants = [
      ...(players
        ? structuredClone(players)
        : content.players.map((p) => ({
            ...structuredClone(p),
            maxHp: p.hp,
            maxMp: p.mp,
            atb: 0,
            queued: false,
            behavior: null,
          }))),
      ...content.enemies.map((p, index) => ({
        ...structuredClone(p), name: entryNames[index]!.name,
        maxHp: p.hp,
        maxMp: p.mp,
        atb: 0,
        queued: false,
        behavior: initialEnemyBehavior(),
      })),
    ];
    if (this.playerBorrow) {
      this.playerState = createBattlePlayerState(this.playerBorrow.initial);
      const entered = this.playerState.entries;
      if (entered.length !== this.players.length || entered.some((entry, index) => {
        const player = this.players[index]!, candidate = this.playerBorrow!.candidates.find(p => p.id === entry.ownedId);
        return !candidate || player.id !== entry.ownedId || player.sourceId !== entry.sourceId || player.row !== entry.row ||
          canonical({ ...player, atb: 0, queued: false, behavior: null }) !==
          canonical({ ...candidate, row: entry.row, atb: 0, queued: false, behavior: null });
      })) throw new Error("Battle player initial borrow identity or resources changed");
      if (this.playerBorrow.qualification) this.inventoryQualification = {
        ...structuredClone(this.playerBorrow.qualification),
        members: this.playerBorrow.qualification.members.filter(member => entered.some(entry => entry.ownedId === member.id))
          .map(member => structuredClone(member)),
      };
    }
    if (
      new Set(this.combatants.map((c) => c.id)).size !== this.combatants.length
    )
      throw new Error("Duplicate battle identity");
    if (this.rewardPolicy.magicPoints > 0) {
      if (!this.projectProgression) throw new Error("Magic point rewards require an owned progression provider");
      for (const player of this.players) {
        if (player.magicLearningValue === undefined) throw new Error("Missing owned magic learning value");
        projectMagicLearningValue(player.magicLearningValue, 0, false);
      }
    }
    this.validateInventoryQualification();
    if (this.inventoryQualification) for (const player of this.players) {
      const catalog = this.inventoryQualification.equipmentCatalog,
        loadout = this.inventoryQualification.members.find((member) => member.id === player.id);
      if (!loadout || loadout.sourceId !== player.sourceId)
        throw new Error("Battle ability cost owner mismatch");
      const passives = equipmentOwnedAbilities(catalog, loadout);
      if (player.ownedAbilities) validateEquipmentAbilityOwnership(catalog, loadout, player.ownedAbilities.abilities.owned);
      else if (passives.length) throw new Error("Equipment passive lacks owned battle abilities");
      this.equipmentAbilities.set(player.id, passives);
      try { equipmentAbilityCostProviders(catalog, loadout); }
      catch {
        // An unknown equipment provider blocks dependent MP fees, not an
        // independently admitted consumable or a known zero-cost command.
        this.unresolvedCostOwners.add(player.id);
        continue;
      }
      this.costOwners.set(player.id, { side: "player", catalog, loadout });
    }
    this.validateConditionState();
    if (this.participantContent)
      this.validateConditionState(Object.values(this.participantContent.enemyDefinitions));
    this.reconcileAppearances();
    if (this.usesSourceQualification)
      for (const player of this.players) {
        if (!player.ownedAbilities) throw new Error("Source battle player lacks owned abilities");
        this.commandQualification(player.id);
      }
    for (const ability of Object.values(content.abilities))
      this.conditions.validateReferences(ability.program.forbiddenConditionIds);
    for (const command of Object.values(content.commands))
      this.conditions.validateReferences(command.forbiddenConditionIds);
    for (const item of Object.values(this.items))
      this.conditions.validateReferences(item.forbiddenConditionIds);
    for (const c of this.combatants) {
      if (this.conditions.isEscaped(c.conditionIds))
        throw new Error("Source initial Escape component lifecycle is not admitted");
      validateElements(c.attackElements);
      validateElementResistances(c.elementResistances);
    }
    if (!this.eventState) this.startEnemyAI();
    for (const c of this.combatants) {
      const range = content.initialAtb[c.side];
      c.atb = this.randomInt(range[0], range[1]);
      c.queued = false;
      Object.assign(c, this.conditions.settleLife(c.hp, c.conditionIds, false));
      this.observeDropLife(c);
      if (c.hp === 0) c.atb = 0;
      this.poisonStates.set(
        c.id,
        this.conditions.reconcilePoisonState(
          c.conditionIds,
          [],
          this.atbSpeed,
        ),
      );
      this.slowStates.set(c.id, this.conditions.reconcileSlowState(c.conditionIds, []));
      const control = this.prepareControlState(c, c.conditionIds, [], new Map(), null);
      this.controlStates.set(c.id, control.state);
      this.controlTargetUnits.set(c.id, control.targets);
    }
    this.reconcileAppearances();
    if (this.playerBorrow) {
      this.validatePlayerBorrow();
      for (const player of this.players) this.playerResources.set(player.id, structuredClone(player));
      for (const owner of firstEnteredOwnerIds(this.playerState!)) this.playerObservations.set(owner, []);
    }
    for (const view of entryNames) this.observeMessageProvider(() => view.validate());
    this.log("敌人出现了。");
    // Message-bearing roots start on the first admitted battle tick. Preparing
    // a media handoff or retry never publishes a global window in a constructor.
    if (!this.deferredEventStart) {
      this.advanceEvent();
      // Legacy roots can create an instance inside the unpublished constructor.
      // They must validate the same live-name read before the entry is exposed.
      for (const validate of this.#messageFrameValidations) validate();
      this.#messageFrameValidations = [];
    }
  }
  get players() {
    return this.combatants.filter((c) => c.side === "player");
  }
  get enemies() {
    return this.combatants.filter((c) => c.side === "enemy");
  }
  enemyExitState(id: string): { kind: "escaped"; conditionId: number } | null {
    const exit = this.enemyExits.get(id);
    return exit ? { ...exit } : null;
  }
  private get activeCombatants() {
    return this.combatants.filter(unit => !this.enemyExits.has(unit.id));
  }
  get registeredDropMonsters(): readonly number[] {
    return [...this.dropRegistrations];
  }
  /** UnableFight.Start calls SetLotMonster, once per start, including another
   * start after revival. Two enemies sharing a master identity remain two rolls. */
  private observeDropLife(unit: Combatant) {
    if (unit.side !== "enemy") return;
    if (this.conditions.isUnableFight(unit.conditionIds)) this.rewardRegisteredInstances.add(unit.id);
    if (this.content.drops === null) return;
    if (!this.conditions.isUnableFight(unit.conditionIds)) this.dropDead.delete(unit.id);
    else if (!this.dropDead.has(unit.id)) {
      this.dropDead.add(unit.id);
      this.dropRegistrations.push(unit.sourceId);
    }
  }
  get ready() {
    if (this.deferredEventStart && !this.#messageRootStarted || this.escapeRequested || !this.eventControls.interactive || !this.eventUI.visible) return [];
    return this.players.filter((c) => c.hp > 0 && c.atb >= 100 && !c.queued &&
      !this.actionSuspended(c) && !this.hasAutomaticControl(c));
  }
  get escapePending(): boolean { return this.escapeRequested; }
  get canRequestEscape(): boolean {
    return (!this.deferredEventStart || this.#messageRootStarted) && this.escapeRule !== null && this.phase === "active" && !this.escapeRequested &&
      this.eventControls.endEnabled && this.eventControls.interactive && this.eventControls.updateEnabled && this.eventUI.visible &&
      this.players.some(c => c.hp > 0) && this.enemies.some(c => c.hp > 0) &&
      !this.clockInput.paused && !this.clockInput.helpPaused && this.clockInput.progressEnabled && !this.clockInput.forceWaiting;
  }
  requestEscape(): boolean {
    if (!this.canRequestEscape) return false;
    this.escapeRequested = true;
    this.log("正在撤退…");
    return true;
  }
  private get usesSourceQualification() {
    return this.content.qualificationContext?.mode === "source";
  }
  private appearanceCandidate(unit: Combatant): BattleAppearanceState | undefined {
    const binding=unit.side==="enemy"?(this.content.gauInstancePolicy?this.#gauContent:undefined)?.playerPrefabs.find(row=>row.monsterId===unit.sourceId):undefined;
    if(binding&&!this.#gauHost)throw new Error("Enemy player prefab requires its explicit actual factory host");
    if(binding&&!binding.actor)throw new Error("Source enemy player prefab media gate: "+binding.gate);
    const actor = binding?.actor??unit.appearance, catalog = this.content.battleAppearance;
    const hasMagitek = this.conditions.types(unit.conditionIds).includes(607);
    if (!actor || !catalog) {
      if (hasMagitek || actor || unit.appearanceState)
        throw new Error("Missing source battle appearance provider");
      return undefined;
    }
    if (binding?binding.characterStatusId!==actor.sourceId:actor.sourceId !== unit.sourceId) throw new Error("Battle appearance actor identity mismatch");
    const state = reconcileBattleAppearance(catalog, actor,
      unit.appearanceState ?? createBattleAppearanceState(actor), unit.conditionIds);
    if (!unit.appearanceState || Boolean(state.magitek) !== Boolean(unit.appearanceState.magitek)) {
      // These are the host's supported default/down/dying streams, not an
      // animation-time guess. Check every body and armor frame independently.
      const poses = ["default", "down", "dying", "IdleR00", "dyingR00"];
      if (this.content.conditions.behaviors.some((behavior) => behavior.kind === "defend")) poses.push("ready");
      for (const key of poses) {
        const alias = catalog.aliases[key];
        if (!alias?.body.length || state.magitek && !alias.armor.length)
          throw new Error("Missing battle appearance pose: " + key);
        for (let bodyFrame = 0; bodyFrame < alias.body.length; bodyFrame++)
          projectBattleAppearanceFrame(catalog, actor, state, { key, bodyFrame, armorFrame: 0 }, this.content.sprites);
        if (state.magitek)
          for (let armorFrame = 1; armorFrame < alias.armor.length; armorFrame++)
            projectBattleAppearanceFrame(catalog, actor, state, { key, bodyFrame: 0, armorFrame }, this.content.sprites);
      }
    }
    return state;
  }
  /** All actors prepare before any appearance state is published. Tick rollback
   * also includes these candidates, so failed effects cannot partially dismount. */
  private reconcileAppearances() {
    const candidates = this.combatants.map((unit) => ({ unit, state: this.appearanceCandidate(unit) }));
    for (const { unit, state } of candidates) if (state) unit.appearanceState = state;
  }
  /** The renderer receives exact source layers; it never mutates pose caches. */
  appearanceFrame(actorId: string, frame: { key: string; bodyFrame: number; armorFrame: number }): BattleAppearanceProjection | null {
    const unit = this.combatants.find((c) => c.id === actorId);
    if (!unit) throw new Error("Unknown battle appearance actor");
    const state = this.appearanceCandidate(unit);
    if (!state) return null;
    const actor=unit.side==="enemy"?(this.content.gauInstancePolicy?this.#gauContent:undefined)?.playerPrefabs.find(row=>row.monsterId===unit.sourceId)?.actor??unit.appearance:unit.appearance;
    const cue=this.#gauTask?.kind==="appearance"&&this.#gauTask.actor===unit&&this.#gauTask.phase!=="loading"?this.#gauTask.poseIndex:null;
    const selected=cue===null?frame:{key:gauAppearancePoses[cue]!,bodyFrame:0,armorFrame:0};
    const candidate = projectBattleAppearanceFrame(this.content.battleAppearance!, actor!, state, selected, this.content.sprites);
    unit.appearanceState = candidate.state;
    return candidate.projection;
  }
  private validateInventoryQualification() {
    const input = this.inventoryQualification, catalog = this.content.battleEntry;
    if (!input) return;
    if (!catalog) {
      if (this.usesSourceQualification) throw new Error("Battle inventory qualification lacks source catalog");
      return;
    }
    if (input.members.length !== this.players.length ||
      new Set(input.members.map((m) => m.id)).size !== input.members.length)
      throw new Error("Battle inventory qualification member mismatch");
    const stock = new Map(input.equipmentStock.map((row) => [row.id, row]));
    if (stock.size !== input.equipmentStock.length) throw new Error("Duplicate battle equipment stock");
    for (const row of input.equipmentStock) {
      const item = catalog.items.find((i) => i.id === row.id);
      if (!item || ![2, 3].includes(item.type)) throw new Error("Invalid battle equipment stock content");
    }
    const occupied = new Map<number, number>();
    for (const player of this.players) {
      const member = input.members.find((m) => m.id === player.id);
      if (!member || member.sourceId !== player.sourceId || member.equipment.length !== 6)
        throw new Error("Battle inventory qualification member mismatch");
      for (const id of member.equipment) {
        const gear = input.equipmentCatalog.definitions[id];
        if (!gear) throw new Error("Missing battle equipment qualification metadata");
        if (!gear.empty) occupied.set(id, (occupied.get(id) ?? 0) + 1);
      }
      this.itemQualification(player.id);
    }
    for (const [id, count] of occupied)
      if ((stock.get(id)?.equipped ?? 0) < count)
        throw new Error("Battle equipment occupancy omits an active owner");
  }
  /** Recomputed from current stock for one actor. Queued reservations constrain
   * execution, but do not rewrite the source's Count/EquipCount menu predicate. */
  itemQualification(actorId: string): ReturnType<typeof projectBattleItemMenu> {
    const actor = this.players.find((p) => p.id === actorId);
    return this.itemQualificationFor(actor, this.inventoryQualification);
  }
  private itemQualificationFor(actor: Combatant | undefined, input: BattleEntryInventory | undefined) {
    const catalog = this.content.battleEntry;
    if (!actor || !input || !catalog)
      return { available: null, usableItemIds: [], canChangeEquipment: null,
        blockers: ["Unknown per-character battle inventory qualification"] };
    const member = input.members.find((m) => m.id === actor.id);
    if (!member || member.sourceId !== actor.sourceId)
      throw new Error("Battle inventory qualification member mismatch");
    return projectBattleItemMenu(catalog, {
      sourceId: actor.sourceId, equipment: member.equipment,
      inventory: [...this.stock.map((row) => ({ ...row, equipped: 0 })), ...input.equipmentStock],
    }, input.equipmentCatalog);
  }
  /** A read-only source query is also available while the opening development
   * actions remain in use. Unknown entry conditions are never guessed empty. */
  commandQualification(actorId: string): BattleAbilityProjection | null {
    const actor = this.players.find((p) => p.id === actorId);
    return this.commandQualificationFor(actor, this.players.length, this.inventoryQualification,
      this.equipmentAbilities.get(actorId));
  }
  private commandQualificationFor(actor: Combatant | undefined, partySize: number,
    inventory: BattleEntryInventory | undefined, equipmentAbilities: OwnedAbility[] | undefined, availabilityOnly = false) {
    const catalog = this.content.battleAbilities,
      context = this.content.qualificationContext;
    if (!actor || !actor.ownedAbilities || !catalog || !context) return null;
    if (actor.ownedAbilities.sourceId !== actor.sourceId)
      throw new Error("Battle owned ability identity mismatch");
    return (availabilityOnly ? projectBattleCommandAvailability : projectBattleAbilities)(catalog, actor.ownedAbilities, {
      conditionIds: context.conditionContext === "current" ? actor.conditionIds : null,
      battleType: context.battleType,
      magicLearningValue: actor.magicLearningValue ?? context.magicLearningValue,
      invalidContentIds: context.invalidContentIds,
      itemMenuAvailable: this.usesSourceQualification ? this.itemQualificationFor(actor, inventory).available : context.itemMenuAvailable,
      partySize,
    }, equipmentAbilities);
  }
  /** The UI receives source menu entries, including unresolved commands. Effect
   * support is separate from qualification and cannot grant an owned ability. */
  commandMenu(actorId: string): BattleMenuCommand[] {
    const actor = this.players.find((p) => p.id === actorId);
    if (!actor) return [];
    if (!this.usesSourceQualification)
      return actor.commands.map((id) => {
        const command = this.content.commands[id]!;
        const abilityIds = command.abilityIds.filter((id) => actor.abilities.includes(id));
        return { id, name: command.name, kind: command.kind, abilityIds, menu: "normal",
          available: true, usesList: command.kind === "item" || abilityIds.length !== 1, blockers: [] };
      });
    const projection = this.commandQualification(actorId);
    if (!projection) throw new Error("Missing source battle ability projection");
    return projection.entries.filter((entry) => entry.released !== false && entry.menu !== "none")
      .map((entry) => {
        const command = this.content.commands[entry.commandId];
        const blockers = [...entry.blockers];
        if (entry.kind === "item" && entry.available === null)
          blockers.push(...this.itemQualification(actorId).blockers);
        if (!command) blockers.push("Battle command execution metadata is not admitted");
        const kind = entry.kind === "item" ? "item" : entry.kind === "unresolved" ? "unresolved" : "ability";
        if (command && command.kind !== kind) blockers.push("Battle command execution kind mismatch");
        if (kind === "ability" && entry.abilityIds.length &&
          entry.abilityIds.every((id) => !this.content.abilities[id]?.plan))
          blockers.push("Battle ability effects are not admitted");
        return { id: entry.commandId, name: command?.name || entry.nameKey || "指令 " + entry.commandId,
          kind, abilityIds: [...entry.abilityIds], menu: entry.menu as "normal" | "extra",
          available: entry.released === true && entry.available === true && blockers.length === 0,
          usesList: entry.kind !== "direct", blockers };
      });
  }
  private qualifiedAbility(actor: Combatant, abilityId: number): boolean {
    return actor.side !== "player" || !this.usesSourceQualification
      ? actor.abilities.includes(abilityId)
      : this.commandMenu(actor.id).some((command) => command.available && command.abilityIds.includes(abilityId));
  }
  get preferences(): BattlePreferences {
    return { ...this.currentPreferences };
  }
  setPreferences(preferences: BattlePreferences): void {
    this.currentPreferences = parseBattlePreferences(preferences);
  }
  private get atbSpeed(): number {
    return battleAtbSpeed(this.currentPreferences.speedIndex);
  }
  /** Copies of the effective settings/host inputs for UI, diagnostics and replay.
   * Source content remains unchanged when a player switches battle mode. */
  get timingState() {
    return {
      mode: this.currentPreferences.mode,
      speedIndex: this.currentPreferences.speedIndex,
      atbSpeed: this.atbSpeed,
      input: { ...this.clockInput },
      gate: this.clockGate(),
    };
  }
  /** Host pause/menu inputs are separate from action presentation and ready units. */
  setClockInput(
    input: Pick<
      BattleClockInput,
      "paused" | "helpPaused" | "progressEnabled" | "uiWaiting" | "forceWaiting"
    >,
  ): void {
    battleClockGate({
      ...input,
      mode: this.currentPreferences.mode,
      battleResult: 0,
    });
    this.clockInput = { ...input };
  }
  private clockGate() {
    return battleClockGate({
      ...this.clockInput,
      progressEnabled: this.clockInput.progressEnabled && this.eventControls.updateEnabled,
      // Once accepted, an old target/ability menu must not deadlock WAIT.
      // Pause, help, special input and the host progress gate still apply.
      uiWaiting: this.escapeRequested || !this.eventUI.visible ? false : this.clockInput.uiWaiting,
      forceWaiting: this.eventUI.visible && this.clockInput.forceWaiting,
      mode: this.currentPreferences.mode,
      battleResult: this.phase === "active" ? 0 : 1,
    });
  }
  get inventory() {
    return this.stock.map((i) => ({
      ...i,
      available: this.availableItemCount(i.id),
    }));
  }
  private availableItemCount(id: number, except?: BattleAction) {
    const reserved = [
      ...this.queue,
      ...this.reactions,
      ...(this.action ? [this.action] : []),
    ].filter(
      (a) =>
        a !== except &&
        !a.resolved &&
        a.source.kind === "item" &&
        a.source.id === id,
    ).length;
    return (this.stock.find((i) => i.id === id)?.count ?? 0) - reserved;
  }
  canUseItem(actorId: string, itemId: number, commandId: number): boolean {
    return this.itemAllowed(actorId, itemId, commandId);
  }
  private itemAllowed(
    actorId: string,
    itemId: number,
    commandId: number,
    except?: BattleAction,
  ): boolean {
    const actor = this.players.find((c) => c.id === actorId),
      item = this.items[itemId],
      command = this.content.commands[commandId];
    if (
      !actor ||
      actor.hp <= 0 ||
      this.actionSuspended(actor) ||
      !item ||
      item.important ||
      !item.uses.battle.plan ||
      item.uses.battle.plan.effects.some((effect) => effect.kind === "physical" || effect.kind === "change-row") ||
      !(this.usesSourceQualification
        ? this.commandMenu(actorId).some((c) => c.id === commandId && c.kind === "item" && c.available)
        : actor.commands.includes(commandId)) ||
      command?.kind !== "item" ||
      this.availableItemCount(itemId, except) < 1
    )
      return false;
    if (this.usesSourceQualification && (
      !this.itemQualification(actorId).usableItemIds.includes(itemId) ||
      battleItemContentAllowed(this.content.qualificationContext!.invalidContentIds, itemId) !== true
    )) return false;
    this.conditions.validateActive(actor.conditionIds);
    return conditionsAllowAction(
      actor.conditionIds,
      item.forbiddenConditionIds,
      command.forbiddenConditionIds,
    );
  }
  itemTargetChoices(actorId: string, itemId: number): TargetChoice[] {
    const actor = this.players.find((c) => c.id === actorId),
      item = this.items[itemId];
    if (!actor || !item?.uses.battle.plan || item.important) return [];
    // Enemy-target item reactions still need their own received-item provider.
    // Keep the source range intact; this bounded host admits player targets only.
    return battleTargetChoices(
      item.uses.battle.plan.targeting,
      actor,
      this.activeCombatants,
      this.content.formation,
    ).filter((choice) =>
      choice.targetIds.every((id) => this.players.some((p) => p.id === id)),
    );
  }
  commandItem(
    actorId: string,
    itemId: number,
    selection: TargetSelection,
    commandId: number,
  ): boolean {
    const actor = this.ready.find((c) => c.id === actorId);
    if (
      this.phase !== "active" ||
      !actor ||
      !this.canUseItem(actorId, itemId, commandId)
    )
      return false;
    const choice = this.itemTargetChoices(actorId, itemId).find((c) =>
      sameTargetSelection(c.selection, selection),
    );
    if (!choice) return false;
    const action: BattleAction = {
      kind: "normal",
      actor: actorId,
      source: { kind: "item", id: itemId },
      selection: structuredClone(choice.selection),
      targetIds: [...choice.targetIds],
      commandId,
      charge: chantingSeconds({
        actor: actor.side,
        firstAbility: null,
        command: this.content.commands[commandId]!,
        agility: actor.agility,
        conditionTypes: this.conditions.types(actor.conditionIds),
        atbSpeed: this.atbSpeed,
      }),
      elapsed: 0,
      resolved: false,
      results: [],
    };
    const conditionIds = this.conditions.admitAtbAction(actor.conditionIds, []);
    this.registerActions([action]);this.queue.push(action);
    actor.conditionIds = conditionIds;
    actor.queued = true;
    return true;
  }
  actionDefinition(action: BattleAction) {
    if (action.source.kind === "ability")
      return this.content.abilities[action.source.id]!;
    const item = this.items[action.source.id]!,
      use = item.uses.battle;
    return {
      name: item.name,
      plan: use.plan,
      power: item.power,
      cost: 0,
      presentation: use.plan?.effects.every(
        (e) => e.kind === "recover-condition",
      )
        ? "condition"
        : "heal",
      attribute: 0,
      program: {
        functions: use.program.functions,
        rules: { system_id: item.systemId },
      },
    };
  }
  private canUseAction(action: BattleAction) {
    if(action.kind==="event")return this.canUseScriptedAction(action);
    if (action.control) {
      const actor = this.combatants.find(unit => unit.id === action.actor);
      if (!actor || this.actionSuspended(actor) || !this.controlPolicy || action.control.policy !== this.controlPolicy.kind ||
          !this.conditions.controlBehaviors(actor.conditionIds).some(behavior =>
            behavior.id === action.control!.conditionId && behavior.kind === action.control!.kind)) return false;
      if (actor.side === "player") {
        if (action.source.kind !== "ability" || !this.controlPlayerCandidates(actor).some(candidate => candidate.commandId === action.commandId &&
            candidate.abilities.some(ability => ability.id === action.source.id))) return false;
        const ability = this.content.abilities[action.source.id]!, command = this.content.commands[action.commandId!],
          cost = this.abilityCost(actor.id, action.source.id);
        return actor.hp > 0 && Boolean(command && cost && actor.mp >= cost.mp) &&
          conditionsAllowAction(actor.conditionIds, ability.program.forbiddenConditionIds, command!.forbiddenConditionIds);
      }
    }
    return action.source.kind === "ability"
      ? this.canUse(action.actor, action.source.id, action.commandId)
      : action.commandId !== null &&
          this.itemAllowed(
            action.actor,
            action.source.id,
            action.commandId,
            action,
          );
  }
  private validateConditionState(units: readonly Omit<CombatantDefinition, "id" | "placement">[] = this.combatants) {
    for (const c of units) {
      validateBattleRow(c.row);
      if (c.side === "enemy" && c.row !== "front") throw new Error("Unresolved enemy battle row");
      this.conditions.validateOwner(c.conditionIds, c.side);
      this.conditions.validateResistances(c.conditionResistances);
      for (const id of (c.side === "player" && this.usesSourceQualification ? [] : c.commands))
        if (!this.content.commands[id])
          throw new Error("Unknown battle command: " + id);
    }
  }
  /** Keep command context separate from ability identity: one ability may be
   * offered by several commands. An omitted, ambiguous context is rejected. */
  private actionCommand(
    actor: Combatant,
    abilityId: number,
    requested?: number | null,
  ) {
    if (actor.side === "enemy") return requested == null ? null : undefined;
    const choices = this.usesSourceQualification
      ? this.commandMenu(actor.id).filter((c) => c.kind === "ability" && c.available &&
        c.abilityIds.includes(abilityId)).map((c) => c.id)
      : actor.commands.filter((id) => this.content.commands[id]?.kind === "ability" &&
        this.content.commands[id]?.abilityIds.includes(abilityId));
    if (requested === undefined)
      return choices.length === 1 ? choices[0] : undefined;
    return requested !== null && choices.includes(requested)
      ? requested
      : undefined;
  }
  /** Menu, eligibility and final payment share the same frozen entry loadout.
   * A source player with a positive fee requires an established equipment owner.
   * Legacy synthetic profiles explicitly use the unmodified base fee. */
  abilityCost(actorId: string, abilityId: number): AbilityCostProjection | null {
    const actor = this.combatants.find((c) => c.id === actorId), ability = this.content.abilities[abilityId];
    if (!actor || !ability?.plan) return null;
    if (this.unresolvedCostOwners.has(actorId))
      return ability.cost === 0 ? projectAbilityCost(ability, { side: "enemy" }) : null;
    const owner = this.costOwners.get(actorId);
    if (owner) return projectAbilityCost(ability, owner);
    if (actor.side === "player" && this.usesSourceQualification && ability.cost !== 0) return null;
    return projectAbilityCost(ability, { side: "enemy" });
  }
  rewardItemName(contentId: number): string {
    const name = this.items[contentId]?.name ?? this.inventoryQualification?.equipmentCatalog.definitions[contentId]?.name;
    if (typeof name !== "string") throw new Error("Missing battle reward content name");
    return name;
  }
  /** GetCorpsId reads current battle members; weapon exceptions use the frozen
   * owned entry loadout. Item/machine-specific providers are not inferred. */
  private physicalRows(actor: Combatant, abilityId: number, target: Combatant): PhysicalRowContext {
    if (!this.content.battleRows) throw new Error("Missing physical row catalog");
    const loadout = actor.side === "player"
      ? this.inventoryQualification?.members.find((member) => member.id === actor.id) : null;
    if (actor.side === "player" && (!loadout || loadout.sourceId !== actor.sourceId))
      throw new Error("Missing physical row player equipment provider");
    if (loadout)
      validateEquipmentBattleRows(this.inventoryQualification!.equipmentCatalog, loadout, this.content.battleRows);
    return projectPhysicalRows(this.content.battleRows, { abilityId,
      actor: { side: actor.side, row: actor.row, equipment: loadout?.equipment ?? null,
        conditionTypes: this.conditions.types(actor.conditionIds) }, targetRow: target.row });
  }
  canUse(
    actorId: string,
    abilityId: number,
    commandId?: number | null,
  ): boolean {
    const actor = this.combatants.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId], cost = this.abilityCost(actorId, abilityId);
    if (
      !actor ||
      !ability?.plan ||
      !this.qualifiedAbility(actor, abilityId) ||
      actor.hp <= 0 ||
      this.actionSuspended(actor) ||
      this.enemyExits.has(actor.id) ||
      ability.plan.effects.some(effect =>
        (effect.kind === "random-ability" || effect.kind === "forced-escape") && actor.side !== "enemy") ||
      !cost || (actor.side === "player" && actor.mp < cost.mp) ||
      (ability.plan.targeting.normalFormationOnly &&
        this.content.formation !== "normal")
    )
      return false;
    this.conditions.validateActive(actor.conditionIds);
    resourceAbsorptionEffect(ability.plan);
    validateOrdinaryConditionAction(ability);
    if (ability.plan.effects.some((effect) => effect.kind === "physical")) {
      try { this.physicalRows(actor, abilityId, actor); }
      catch { return false; }
    }
    if (ability.plan.effects.some((effect) => effect.kind === "change-row") &&
        (actor.side !== "player" || !["front", "back"].includes(actor.row))) return false;
    const command = this.actionCommand(actor, abilityId, commandId);
    if (command === undefined) return false;
    if (actor.side === "player" && this.usesSourceQualification &&
      this.commandMenu(actorId).find((c) => c.id === command)?.usesList) {
      const contentId = this.content.abilityContentIds
        ? this.content.abilityContentIds[abilityId] ?? null
        : actor.ownedAbilities?.abilities.owned.find((a) => a.abilityId === abilityId)?.contentId ?? null;
      if (battleAbilityContentAllowed(
        this.content.qualificationContext!.invalidContentIds,
        contentId,
        ability.program.functions.find((f) => f.slot === 1)?.functionId ?? 0,
      ) !== true) return false;
    }
    return (
      conditionsAllowAction(
        actor.conditionIds,
        ability.program.forbiddenConditionIds,
        command === null
          ? []
          : this.content.commands[command]!.forbiddenConditionIds,
      ) &&
      !(
        !actor.physical &&
        ability.plan.effects.some((e) => e.kind === "physical")
      )
    );
  }
  private randomUnit() {
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 0x100000000;
  }
  private randomInt(min: number, max: number) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max)
      throw new Error("Invalid random range");
    return min + Math.floor(this.randomUnit() * (max - min + 1));
  }
  private aiContext(
    actor: Combatant,
    units: readonly Combatant[] = this.combatants,
  ) {
    if (!actor.behavior) throw new Error("Missing enemy behavior parameters");
    return {
      self: {
        hp: actor.hp,
        mp: actor.mp,
        monsterId: actor.sourceId,
        behavior: actor.behavior,
      },
      conditionIds: actor.conditionIds,
      players: units.filter((c) => c.side === "player"),
      enemies: units.filter((c) => c.side === "enemy"),
      ...(this.content.battleEvents ? { events: {
        rules: this.content.battleEvents,
        selfId: actor.id,
        units: units.map((c) => ({ id: c.id, side: c.side, conditionIds: [...c.conditionIds],
          // Retired instances and their AI owners have left this live roster.
          // Staged ActType.FinalAttack remains a separate unavailable lane.
          removed: false })),
        finalAttackFirstTargetSide: null,
      } } : {}),
    };
  }
  enemyAIState(actorId: string): BattleAIState | null {
    const state = this.aiStates.get(actorId);
    return state ? structuredClone(state) : null;
  }
  /** A retry starts this same admitted event definition from its entry; mutable
   * renderer/content references cannot replace a battle's control program. */
  get lifecycleDefinition(): BattleLifecycle { return structuredClone(this.lifecycle); }
  get eventExecution() {
    return { state: structuredClone(this.eventState), controls: { ...this.eventControls } };
  }
  get eventSharedEntry(): BattleEventSharedSnapshot | undefined { return this.eventShared?.entry; }
  get fieldReservationReturn(): BattleFieldReservation | null { return structuredClone(this.fieldReservation); }
  get gauLifecycle(){return {entry:this.gauEntry&&structuredClone(this.gauEntry),encounteredEnemyIds:structuredClone(this.gauEnemyIds),journal:structuredClone(this.gauModeJournal)};}
  get eventSharedReturn() { return this.eventShared?.prepareReturn() ?? null; }
  get participantExecution(): BattleParticipantState { return structuredClone(this.participantState); }
  get enemyPartyExecution() {
    return { partyId: this.currentEnemyPartyId, slots: structuredClone(this.currentEnemySlots),
      hiddenEnemyIds: [...this.hiddenEnemyIds] };
  }
  isCombatantVisible(id: string): boolean {
    if (!this.combatants.some(unit => unit.id === id)) throw new Error("Unknown battle combatant");
    return !this.hiddenEnemyIds.has(id) && !this.enemyExits.has(id);
  }
  /** The entry roster and reserve definitions are fixed for defeat/retry. */
  get participantEntryContent(): Pick<BattleContent, "enemies" | "participants"> {
    return { enemies: structuredClone(this.entryEnemies),
      ...(this.participantContent ? { participants: structuredClone(this.participantContent) } : {}) };
  }
  get playerEntryContent(): Pick<BattleContent, "playerParticipants"> {
    return this.playerBorrow ? { playerParticipants: structuredClone(this.playerBorrow.plan) } : {};
  }
  get playerExecution(): BattlePlayerState | null {
    if (!this.playerState) return null;
    const state = structuredClone(this.playerState);
    for (const entry of state.entries.filter(entry => !entry.removed)) {
      const unit = this.players.find(player => player.id === entry.instanceId);
      if (!unit || unit.sourceId !== entry.sourceId) throw new Error("Battle player live identity changed");
      entry.row = unit.row; state.slots[entry.slot]!.row = unit.row;
    }
    return parseBattlePlayerState(state);
  }
  /** Public projections keep identity metadata separate from resource owners. */
  playerOwnedId(instanceId: string): string {
    if (!this.playerState) return instanceId;
    const entry = this.playerState.entries.find(entry => entry.instanceId === instanceId);
    if (!entry) throw new Error("Unknown battle player instance");
    return entry.ownedId;
  }
  resultPlayerName(ownedId: string): string {
    const player = this.playerBorrow?.candidates.find(player => player.id === ownedId) ??
      this.players.find(player => player.id === ownedId);
    if (!player) throw new Error("Unknown battle result player");
    return player.name;
  }
  private playerEquipment(player: Combatant, qualification: BattleEntryInventory | undefined) {
    if (!qualification) return { passives: [] as OwnedAbility[], cost: null as AbilityCostOwner | null, unresolved: false };
    const catalog = qualification.equipmentCatalog,
      loadout = qualification.members.find(member => member.id === player.id);
    if (!loadout || loadout.sourceId !== player.sourceId) throw new Error("Battle borrowed equipment owner mismatch");
    const passives = equipmentOwnedAbilities(catalog, loadout);
    if (player.ownedAbilities) validateEquipmentAbilityOwnership(catalog, loadout, player.ownedAbilities.abilities.owned);
    else if (passives.length) throw new Error("Equipment passive lacks borrowed owned abilities");
    try {
      equipmentAbilityCostProviders(catalog, loadout);
      return { passives, cost: { side: "player" as const, catalog, loadout }, unresolved: false };
    } catch { return { passives, cost: null, unresolved: true }; }
  }
  private validateBorrowedPlayer(player: Combatant, qualification: BattleEntryInventory | undefined, partySize: number) {
    if (player.side !== "player" || player.ai !== null || player.behavior !== null)
      throw new Error("Borrow requires an owned player definition");
    const blocker = battleDefinitionBlocker([player], this.content.qualificationContext, this.content.conditions);
    if (blocker) throw new Error(blocker);
    this.validateConditionState([player]);
    validateElements(player.attackElements); validateElementResistances(player.elementResistances);
    for (const id of player.abilities) if (!this.content.abilities[id]) throw new Error("Missing borrowed player ability");
    if (!this.content.sprites[player.sprites.idle] || player.sprites.mount !== null && !this.content.sprites[player.sprites.mount])
      throw new Error("Missing borrowed player media");
    this.appearanceCandidate(player);
    if (this.rewardPolicy.magicPoints > 0) {
      if (player.magicLearningValue === undefined) throw new Error("Missing borrowed magic learning value");
      projectMagicLearningValue(player.magicLearningValue, 0, false);
    }
    const gear = this.playerEquipment(player, qualification);
    if (this.usesSourceQualification && !player.ownedAbilities) throw new Error("Source borrowed player lacks owned abilities");
    this.itemQualificationFor(player, qualification);
    this.commandQualificationFor(player, partySize, qualification, gear.passives);
    return gear;
  }
  private validatePlayerBorrow(): void {
    const borrow = this.playerBorrow!;
    for (const player of borrow.candidates) {
      if (player.id.startsWith("enemy:dynamic:") || this.entryEnemies.some(enemy => enemy.id === player.id))
        throw new Error("Borrowed player collides with enemy identity");
      this.validateBorrowedPlayer(player, borrow.qualification ?? undefined, 1);
    }
  }
  private preparePlayerTransition(planned: BattlePlayerProjection) {
    const borrow = this.playerBorrow!;
    const resources = new Map(this.playerResources);
    for (const instanceId of planned.removedIds) {
      const player = this.players.find(player => player.id === instanceId);
      if (!player) throw new Error("Missing retiring battle player owner");
      resources.set(this.playerOwnedId(instanceId), structuredClone(player));
    }
    const units = planned.joins.map(entry => {
      const held = resources.get(entry.ownedId) ?? borrow.candidates.find(player => player.id === entry.ownedId);
      if (!held || held.sourceId !== entry.sourceId) throw new Error("Missing admitted owned player borrow");
      const unit: Combatant = { ...structuredClone(held), id: entry.instanceId, row: entry.row,
        atb: 0, queued: false, behavior: null };
      Object.assign(unit, this.conditions.settleLife(unit.hp, unit.conditionIds, false));
      return unit;
    });
    const players = this.players.filter(player => !planned.removedIds.includes(player.id)).concat(units)
      .sort((a, b) => planned.state.entries.find(entry => entry.instanceId === a.id)!.slot -
        planned.state.entries.find(entry => entry.instanceId === b.id)!.slot);
    const qualification = borrow.qualification === null ? undefined : {
      ...structuredClone(borrow.qualification),
      members: players.map(player => {
        const entry = planned.state.entries.find(entry => entry.instanceId === player.id)!;
        const held = borrow.qualification!.members.find(member => member.id === entry.ownedId);
        if (!held || held.sourceId !== player.sourceId) throw new Error("Missing borrowed equipment loadout");
        return { ...structuredClone(held), id: player.id };
      }),
    };
    const entries = units.map(unit => ({
      gear: this.validateBorrowedPlayer(unit, qualification, players.length),
      poison: this.conditions.reconcilePoisonState(unit.conditionIds, [], this.atbSpeed),
      slow: this.conditions.reconcileSlowState(unit.conditionIds, []),
      control: this.prepareControlState(unit, unit.conditionIds, [], new Map(), null),
    }));
    // All candidate owners/conditions/loadouts are admitted before owned RNG.
    for (const unit of units) unit.atb = unit.hp === 0 ? 0 : this.randomInt(...this.content.initialAtb.player);
    return { planned, resources, players, units, entries, qualification };
  }
  private publishPlayerTransition(next: ReturnType<BattleGame["preparePlayerTransition"]>): void {
    this.retireActors(next.planned.removedIds);
    for (const id of next.planned.removedIds) {
      this.costOwners.delete(id); this.unresolvedCostOwners.delete(id); this.equipmentAbilities.delete(id);
    }
    this.combatants.splice(0, this.combatants.length, ...next.players, ...this.enemies);
    this.playerState = next.planned.state;
    this.playerResources = next.resources;
    this.inventoryQualification = next.qualification;
    for (const [index, unit] of next.units.entries()) {
      const entry = next.entries[index]!;
      this.poisonStates.set(unit.id, entry.poison); this.slowStates.set(unit.id, entry.slow);
      this.controlStates.set(unit.id, entry.control.state); this.controlTargetUnits.set(unit.id, entry.control.targets);
      this.equipmentAbilities.set(unit.id, entry.gear.passives);
      if (entry.gear.cost) this.costOwners.set(unit.id, entry.gear.cost);
      if (entry.gear.unresolved) this.unresolvedCostOwners.add(unit.id);
      const owner = this.playerOwnedId(unit.id);
      if (!this.playerObservations.has(owner)) this.playerObservations.set(owner, []);
    }
  }
  private addPlayer(sourceId: number): void {
    const held = this.playerBorrow?.plan.sourceIds.includes(sourceId)
      ? this.playerBorrow.candidates.find(player => player.sourceId === sourceId) : undefined;
    if (!held || !this.playerState) throw new Error("Missing admitted owned player borrow");
    const planned = projectPlayerJoin(this.playerExecution!, { ownedId: held.id, sourceId });
    this.publishPlayerTransition(this.preparePlayerTransition(planned));
    this.eventControls.enemyNoAct = true;
    this.log(`${held.name} 加入战斗。`);
  }
  private changePlayerGroup(group: 0 | 1 | 2): void {
    const members = this.playerBorrow?.groups[group];
    if (!members || !this.playerState) throw new Error("Missing admitted Web player group");
    const planned = projectPlayerGroup(this.playerExecution!, members);
    this.publishPlayerTransition(this.preparePlayerTransition(planned));
    this.log("战斗编队已切换。");
  }
  private addEnemy(monsterId: number, uniqueId: number): void {
    const definition = this.participantContent?.enemyDefinitions[monsterId],
      placement = this.currentEnemySlots[uniqueId];
    if (!definition || !placement) throw new Error("Missing admitted battle enemy entry definition or slot");
    const planned = projectEnemyReplacement(this.participantState,
      { sourceId: monsterId, uniqueId, exp: definition.exp, gil: definition.gil });
    const unit = this.prepareEnemy(definition, placement, planned.instanceId);
    const nextUnits = this.combatants.filter(current => current.id !== planned.removedId).concat(unit);
    const entry = this.prepareEnemyEntry(unit, nextUnits);
    this.retireActors(planned.removedId === null ? [] : [planned.removedId]);
    this.combatants.splice(0, this.combatants.length, ...nextUnits);
    this.participantState = planned.state;
    this.publishEnemyEntry(unit, entry);
    this.eventControls.enemyNoAct = true;
    this.log(`${unit.name} 加入战斗。`);
  }
  get gauInstanceExecution(){return {task:this.#gauTask?{kind:this.#gauTask.kind,pc:this.#gauTask.pc,phase:this.#gauTask.phase,
    partyId:this.#gauTask.partyId,actorId:this.#gauTask.actor?.id??null,startTime:this.#gauTask.startTime,poseIndex:this.#gauTask.poseIndex}:null,
    journal:structuredClone(this.#gauJournal)};}
  private gauMedia(keys:Iterable<string>,operation:"replace"|"appearance"):BattleGauMediaRequest{
    const sprites=[...new Set(keys)].map(id=>{const sprite=this.content.sprites[id];if(!sprite)throw new Error("Missing source Gau media: "+id);return {id,file:sprite.file,width:sprite.width,height:sprite.height};});
    if(!sprites.length)throw new Error("Missing source Gau player factory media");
    return {kind:"source-gau-instance-media-v1",operation,sprites};
  }
  private startGauTask(kind:"replace"|"appearance",pc:number){
    if(!this.#gauHost||!this.#gauContent||this.#effectRetired||this.#gauTask&&this.#gauTask.phase!=="complete")throw new Error("Missing or busy actual source Gau instance host");
    let partyId:number|null=null,actor:Combatant|null=null;const keys:string[]=[];
    if(kind==="replace"){
      if(!this.eventShared)throw new Error("Gau replacement requires shared source ScenarioVariable[8]");
      partyId=this.eventShared.read({category:"ScenarioVariable",index:8})===0?this.#gauContent.firstPartyId:this.#gauContent.returnPartyId;
      const party=this.#childAdmission?prepareBattleChildParty(this.#childAdmission,partyId,this.participantContent):this.participantContent?.enemyParties?.[partyId];if(!party)throw new Error("Missing complete source-selected Gau child party");
      if(this.players.some(player=>this.conditions.types(player.conditionIds).includes(506)))throw new Error("Gau replacement requires the active Quick condition exit lifecycle");
      for(const member of party.members){const binding=this.#gauContent.playerPrefabs.find(row=>row.monsterId===member.sourceId);
        if(!binding)throw new Error("Source-selected Gau child requires its actual enemy-player factory row");if(!binding.actor)throw new Error("Source Gau factory media gate: "+binding.gate);keys.push(...Object.values(binding.actor.bodySprites));}
    }else{
      actor=this.enemies[0]??null;if(!actor)throw new Error("Gau appearance requires the actual first enemy instance");
      const binding=this.#gauContent.playerPrefabs.find(row=>row.monsterId===actor!.sourceId);
      if(!binding?.actor||!this.content.battleAppearance)throw new Error("Gau appearance requires an actual source player-entity enemy, not an owned guess");
      const state=this.appearanceCandidate(actor)!;
      for(const key of gauAppearancePoses){const alias=this.content.battleAppearance.aliases[key];
        if(!alias?.body.length)throw new Error("Missing source Gau appearance pose: "+key);
        for(let bodyFrame=0;bodyFrame<alias.body.length;bodyFrame++){
          const projected=projectBattleAppearanceFrame(this.content.battleAppearance,binding.actor,state,{key,bodyFrame,armorFrame:0},this.content.sprites);
          keys.push(projected.projection.body.sprite);}
      }
    }
    const request=this.gauMedia(keys,kind),resource=this.observeMessageProvider(()=>this.#gauHost!.prepare(request));
    if(!resource||["status","validate","commit","discard"].some(key=>typeof resource[key as keyof BattleEffectResourceLease]!=="function"))throw new Error("Invalid source Gau resource lease");
    this.#effectPendingCommits.push(resource);this.observeMessageProvider(()=>resource.validate());
    this.#gauTask={kind,pc,phase:"loading",resource,partyId,actor,startTime:this.time,poseIndex:0};
    this.#gauJournal.push({action:"request",pc,time:this.time,actorId:actor?.id??null,value:partyId});
  }
  private advanceGauTask(){
    const task=this.#gauTask;if(!task||task.phase==="complete")return;
    if(this.#effectRetired||task.actor&&!this.combatants.includes(task.actor))throw new Error("Retired source Gau instance completion");
    const resource=task.resource!;this.observeMessageProvider(()=>resource.validate());
    const status=this.observeMessageProvider(()=>resource.status());
    if(status==="failed")throw new Error("Source Gau media failed");if(status==="loading")return;
    if(status!=="ready")throw new Error("Unknown source Gau media readiness");
    if(task.kind==="replace"){
      this.changeEnemyParty(task.partyId!,false);this.reconcileAppearances();task.phase="complete";
      this.#gauJournal.push({action:"replace",pc:task.pc,time:this.time,actorId:this.enemies[0]?.id??null,value:task.partyId});
    }else{
      if(task.phase==="loading"){task.phase="playing";task.startTime=this.time;task.poseIndex=0;
        this.#gauJournal.push({action:"pose",pc:task.pc,time:this.time,actorId:task.actor!.id,value:gauAppearancePoses[0]});}
      const elapsed=Math.fround((this.time-task.startTime)/1000);
      for(let index=task.poseIndex+1;index<gauAppearanceTimes.length;index++)if(elapsed>=gauAppearanceTimes[index]!){task.poseIndex=index;
        this.#gauJournal.push({action:"pose",pc:task.pc,time:this.time,actorId:task.actor!.id,value:gauAppearancePoses[index]!});}
      if(elapsed<gauAppearanceDuration)return;task.phase="complete";
    }
    this.#gauJournal.push({action:"complete",pc:task.pc,time:this.time,actorId:task.actor?.id??null,value:task.partyId});
    this.#effectPendingDiscards.push(resource);task.resource=null;
  }
  private prepareEnemy(definition: EnemyBattleDefinition, placement: BattleParticipantSlot, id: string): Combatant {
    if (this.combatants.some(unit => unit.id === id)) throw new Error("Duplicate battle identity");
    if(this.usesSourceQualification&&definition.conditionIds.length&&!this.spawnConditionPolicy)
      throw new Error('Source late enemy conditions require the explicit Web spawn initialization policy');
    if(this.spawnConditionPolicy){this.conditions.validateOwner(definition.conditionIds,'enemy');if(definition.conditionIds.length>1)this.conditions.validateInitialComposition(definition.conditionIds);}
    const name = this.observeMessageProvider(() => prepareSourceCatalogName(definition.name, definition.nameSource, this.eventHosts?.names));
    this.#messageFrameValidations.push(() => this.observeMessageProvider(() => name.validate()));
    const unit: Combatant = { ...structuredClone(definition), name: name.name, id,
      placement: structuredClone(placement), maxHp: definition.hp, maxMp: definition.mp,
      atb: 0, queued: false, behavior: initialEnemyBehavior() };
    this.validateConditionState([unit]);
    validateElements(unit.attackElements);
    validateElementResistances(unit.elementResistances);
    if (this.content.drops !== null && !this.content.drops.monsters.some(row => row.id === definition.sourceId))
      throw new Error("Missing enemy drop definition");
    Object.assign(unit, this.conditions.settleLife(unit.hp, unit.conditionIds, false));
    return unit;
  }
  private prepareEnemyEntry(unit: Combatant, nextUnits: readonly Combatant[]) {
    if (this.conditions.isEscaped(unit.conditionIds))
      throw new Error("Source initial Escape component lifecycle is not admitted");
    if (!unit.ai) throw new BattleAIError(null, 0, "missing enemy AI program");
    const started = startBattleAI(unit.ai, this.aiContext(unit, nextUnits));
    const context = this.aiContext(unit, nextUnits);
    context.self.behavior = started.behavior;
    this.admitAITurn(unit, planBattleAITurn(unit.ai, started.state, context));
    unit.behavior = started.behavior;
    const poison = this.conditions.reconcilePoisonState(unit.conditionIds, [], this.atbSpeed),
      slow = this.conditions.reconcileSlowState(unit.conditionIds, []),
      control = this.prepareControlState(unit, unit.conditionIds, [], new Map(), null);
    unit.atb = unit.hp === 0 ? 0 : this.randomInt(this.content.initialAtb.enemy[0], this.content.initialAtb.enemy[1]);
    return { ai: started.state, poison, slow, control };
  }
  /** Both single-slot and complete-party transitions invalidate old instances
   * through one shared queue/timer boundary. Death/drop registrations survive. */
  private retireActors(ids: readonly string[]): void {
    const removed = new Set(ids);
    this.queue = this.queue.filter(action => !removed.has(action.actor));
    this.reactions = this.reactions.filter(action => !removed.has(action.actor));
    if (this.action && (removed.has(this.action.actor) || this.action.targetIds.some(id => removed.has(id)))) {
      this.releaseStagedAction('actor-retired');
    }
    for(const unit of this.combatants)if(removed.has(unit.id)&&unit.side==='player')this.#fixedPlayerActions.delete(unit.sourceId);
    for (const removedId of removed) {
      this.aiStates.delete(removedId);
      // Function clocks belong to this retired instance, including Stop's
      // Poison write. A new Gau/party actor initializes from [] below.
      this.poisonStates.delete(removedId);
      this.slowStates.delete(removedId);
      this.controlStates.delete(removedId); this.controlTargetUnits.delete(removedId);
      this.dropDead.delete(removedId);
      this.hiddenEnemyIds.delete(removedId);
    }
  }
  private publishEnemyEntry(unit: Combatant, entry: ReturnType<BattleGame["prepareEnemyEntry"]>): void {
    this.aiStates.set(unit.id, entry.ai);
    this.poisonStates.set(unit.id, entry.poison);
    this.slowStates.set(unit.id, entry.slow);
    this.controlStates.set(unit.id, entry.control.state); this.controlTargetUnits.set(unit.id, entry.control.targets);
    this.observeDropLife(unit);
  }
  private changeEnemyParty(partyId: number, hidden: boolean): void {
    const party = this.#childAdmission?prepareBattleChildParty(this.#childAdmission,partyId,this.participantContent):this.participantContent?.enemyParties?.[partyId];
    if (!party) throw new Error("Missing admitted replacement enemy party");
    const masters = party.members.map(member => {
      const definition = this.participantContent!.enemyDefinitions[member.sourceId], placement = party.slots[member.uniqueId];
      if (!definition || !placement) throw new Error("Missing replacement enemy definition or slot");
      return { definition, placement, member };
    });
    const planned = projectEnemyPartyReplacement(this.participantState, masters.map(({ definition, member }) =>
      ({ sourceId: member.sourceId, uniqueId: member.uniqueId, exp: definition.exp, gil: definition.gil })));
    const units = masters.map(({ definition, placement }, index) =>
      this.prepareEnemy(definition, placement, planned.joins[index]!.instanceId));
    const players = this.players, playerCandidates = players.map(player => {
      const types = this.conditions.types(player.conditionIds);
      return { ...player, conditionIds: player.conditionIds.filter((_, index) => types[index] !== 506) };
    });
    const nextUnits = playerCandidates.concat(units), entries = units.map(unit => this.prepareEnemyEntry(unit, nextUnits));
    const playerTimers = playerCandidates.map(player => ({
      poison: this.conditions.reconcilePoisonState(player.conditionIds, this.poisonStates.get(player.id)!, this.atbSpeed),
      slow: this.conditions.reconcileSlowState(player.conditionIds, this.slowStates.get(player.id)!),
    }));
    // Explicit Web transaction: all late resources were admitted before entry.
    // Native removes the prior display/party while asynchronous loading runs.
    this.retireActors(planned.removedIds);
    players.forEach((player, index) => {
      player.conditionIds = playerCandidates[index]!.conditionIds;
      this.poisonStates.set(player.id, playerTimers[index]!.poison);
      this.slowStates.set(player.id, playerTimers[index]!.slow);
    });
    this.combatants.splice(0, this.combatants.length, ...players, ...units);
    this.participantState = planned.state;
    this.currentEnemySlots = structuredClone(party.slots);
    this.currentEnemyPartyId = partyId;
    units.forEach((unit, index) => { this.publishEnemyEntry(unit, entries[index]!);
      if (hidden) this.hiddenEnemyIds.add(unit.id); });
    this.eventControls.aiStarted = true;
    // Progress permission and no-act remain owned by the continuing root.
    // SyncAI restores progress after an ended round, as on the native path.
    this.log("下一轮敌人出现了。");
  }
  private startEnemyAI(): void {
    if ([...this.aiStates.values()].some(state => state.status !== "exited"))
      throw new Error("Battle AI cores are already running");
    const initial = this.enemies.map(actor => {
      if (!actor.ai) throw new BattleAIError(null, 0, "missing enemy AI program");
      const turn = startBattleAI(actor.ai, this.aiContext(actor));
      const context = this.aiContext(actor);
      context.self.behavior = turn.behavior;
      this.admitAITurn(actor, planBattleAITurn(actor.ai, turn.state, context));
      return { actor, turn };
    });
    for (const { actor, turn } of initial) {
      actor.behavior = turn.behavior;
      this.aiStates.set(actor.id, turn.state);
    }
    this.eventControls.aiStarted = true;
  }
  private currentSourceCorps(): string[] {
    if(!this.gauEntry)throw new Error('Missing complete source-owned Corps entry');
    const expected=this.gauEntry.party.slots[this.gauEntry.party.selectedSlot].flatMap(cell=>cell.id===null?[]:[cell.id]),
      current=this.playerState?this.playerState.entries.filter(entry=>!entry.removed).map(entry=>({id:entry.ownedId,sourceId:entry.sourceId})):this.players,
      actual=current.map(unit=>unit.id);
    if(canonical(expected)!==canonical(actual)||current.some(unit=>this.gauEntry!.roster.find(owner=>owner.id===unit.id)?.sourceId!==unit.sourceId))
      throw new Error('Gau/Shadow current Corps owner changed; live source-owned formation publication is required');
    return expected;
  }
  private advanceEvent(): void {
    if (this.lifecycle.mode !== "script" || !this.eventState || this.eventState.status === "exited") return;
    const program = this.lifecycle.program;
    if (this.deferredEventStart) this.#messageRootStarted = true;
    for (;;) {
      const cores = this.battleAICoresAlive();
      const result = advanceBattleEvent(program, this.eventState, {
        clock: this.time / 10, timeSeconds: this.time / 1000, started: true,
        ...(this.eventState.wait?.kind === "message" ? {
          messageStatus: this.#messageFrame!.state.sequenceStatus(this.eventState.wait.cursor.ticket),
        } : {}),
        gauTaskCompleted:this.#gauTask?.phase==="complete"&&this.#gauTask.pc===this.eventState.pc,
        battleEffectsFinished:this.battleEffectsFinished,
        ...(this.#fadeFrame?.state.known?{globalFadeStatus:{in:this.#fadeFrame.state.poll('in')==='next',out:this.#fadeFrame.state.poll('out')==='next'}}:{}),
        enemyModes:this.participantState.entries.filter(entry=>!entry.removed).map(entry=>{
          const unit=this.combatants.find(unit=>unit.id===entry.id&&unit.side==='enemy');
          if(!unit?.behavior)throw new Error('Missing actual enemy mode parameter owner');
          return {uniqueId:entry.uniqueId,mode:unit.behavior.mode};
        }),
        aiCoreAlive: cores.alive,
        // Source IsNowAttackStaging includes staged/interrupt actions, but not
        // ordinary queued turns. The queues remain owned by this BattleGame.
        actionStaging: this.action !== null || this.reactions.length > 0,
        enemyEntry: { noAct: this.eventControls.enemyNoAct, completed: true },
        enemyPartyEntry: { completed: true },
        // Resources are admitted synchronously in this Web profile. The two
        // ports remain distinct; native asynchronous completion is unverified.
        playerEntry: { noAct: this.eventControls.enemyNoAct, completed: true },
        playerGroupEntry: { completed: true },
        ...(this.eventShared ? { variables: { read: (ref) => this.eventShared!.read(ref) } } : {}),
        ...(program.instructions.some(({ op }) => op.kind === "players-ended") ? {
          playersEnded: this.eventPlayersEnded(),
        } : {}),
      },this.#branchPolicy);
      if(this.lifecycle.kind==='battle-lifecycle-v2')this.#branchFrameVisited.push(...result.visited);
      let nextEventState = result.state;
      for (const request of result.requests) {
        try {
          switch (request.kind) {
            case 'global-fade-complete': {
              if(!this.#fadeFrame||this.lifecycle.mode!=='script'||this.lifecycle.program.instructions[request.pc]?.op.kind!=='global-fade')throw new Error('Unbound global fade completion');
              this.#fadeJournal.push({action:'complete',pc:request.pc,time:this.time});break;
            }
            case 'global-fade': {
              const {pc,...raw}=request,op=parseBattleGlobalFadeOp(raw);
              if(!this.#fadeHost||!this.#fadeFrame||this.lifecycle.mode!=='script'||canonical(this.lifecycle.program.instructions[pc]?.op)!==canonical(op))throw new Error('Unbound actual shared global fade request');
              this.#fadeFrame.state.start({...op,kind:'field-fade'},.01);
              this.#fadeJournal.push({action:'start',pc,time:this.time});break;
            }
            case "condition-list": {
              const { pc, ...operation } = request; this.applyEventCondition(operation, pc); break;
            }
            case "gau-replace": this.startGauTask("replace",request.pc); break;
            case "gau-appearance": this.startGauTask("appearance",request.pc); break;
            case "gau-join": {
              if(!this.#gauHost||!this.#gauContent||!this.eventShared)throw new Error("Missing actual source Gau owned join frame");
              this.#gauFrame??=this.#gauHost.owned.prepareFrame();
              const owner=this.#gauFrame.join({sourceId:this.#gauContent.joinedSourceId,
                firstEncounter:this.eventShared.read({category:"ScenarioVariable",index:8})===0});
              this.#gauJournal.push({action:"join",pc:request.pc,time:this.time,actorId:owner.ownedId,value:owner.sourceId});break;
            }
            case 'cursed-shield-check': {
              if(!this.eventShared)throw new Error('CursedShield requires the shared source scenario-variable owner');
              const plan=planCursedShieldCheck(ref=>this.eventShared!.read(ref),this.players,this.inventoryQualification,this.content.battleEntry);
              if(plan.counter!==null)this.eventShared.write({category:'ScenarioVariable',index:9},plan.counter);
              break;
            }
            case 'shadow-secede-lot': {
              if(!this.eventShared)throw new Error('Shadow lottery requires the shared source scenario-flag owner');
              nextEventState.locals[3]=0;
              nextEventState.locals[3]=planShadowSecedeLot(this.gauEntry??undefined,ref=>this.eventShared!.read(ref),
                ()=>this.currentSourceCorps(),()=>{throw new Error('Shadow lottery requires the actual BattleActLog publication/lifecycle owner; the Web display/learning log is not a substitute');},
                (min,max)=>this.randomInt(min,max));
              break;
            }
            case 'gau-leap': {
              // Native scans active condition functions on every actual player,
              // not CharacterStatusId.Gau. The empty match branch does no write.
              if(this.players.some(player=>this.conditions.types(player.conditionIds).includes(614)))
                throw new Error('Gau leap condition614 requires held Rage learning, Corps disable and actual action/ATB/borrowed-instance retirement');
              break;
            }
            case 'shadow-battle-departure': {
              if(!this.gauEntry)throw new Error('Shadow departure requires the complete source-owned player identities');
              const actual=this.players.map(player=>{
                const id=this.playerOwnedId(player.id),owner=this.gauEntry!.roster.find(row=>row.id===id&&row.sourceId===player.sourceId);
                if(!owner)throw new Error('Shadow departure actual player is not bound to its held source owner');
                return owner;
              });
              if(actual.some(owner=>owner.sourceId===4))
                throw new Error('Shadow departure requires same-held SecedeCharacter(false), equipment/parameters and SaveParameter result ordering before owned disable');
              if(!this.fieldReservation||!this.eventHosts?.fieldContinuation)throw new Error('Shadow departure requires the unconditional Integrator ReserveScript/field continuation owner');
              this.fieldReservation.candidate=parseFieldReservation(this.eventHosts.fieldContinuation.require('shadow-departure'));
              if(this.fieldReservation.candidate.script!=='sc_secede_shadow')throw new Error('Shadow field continuation host returned another native reservation');
              break;
            }
            case 'reserve-gau-first': {
              if(!this.eventShared)throw new Error('Gau first reservation requires DataStorage group8[8]');
              if(!this.fieldReservation||!this.eventHosts?.fieldContinuation)throw new Error('Gau first reservation requires Integrator ReserveScript/field continuation owner');
              const reservation=parseFieldReservation(this.eventHosts.fieldContinuation.require('gau-first-join'));
              if(reservation.script!=='sc_e_0239')throw new Error('Gau field continuation host returned another native reservation');
              this.eventShared.write({category:'ScenarioVariable',index:8},1);
              // Both wrappers cancel the previous single slot before reserving.
              this.fieldReservation.candidate=reservation;
              break;
            }
            case 'set-gau-mode': {
              if(!this.gauEntry)throw new Error('Missing source Gau owned entry');
              this.currentSourceCorps();
              const plan=planBattleGauMode(this.gauEntry,this.enemies.map(unit=>unit.sourceId),(min,max)=>this.randomInt(min,max));
              this.gauEnemyIds=plan.encounteredEnemyIds;
              if(plan.modeWrite!==null)nextEventState.locals[2]=plan.modeWrite;
              if(plan.endEnabled!==null)this.eventControls.endEnabled=plan.endEnabled;
              this.gauModeJournal.push({pc:request.pc,modeWrite:plan.modeWrite,atMilliseconds:this.time});break;
            }
            case "ui-visibility":
              this.eventUI.visible = request.visible;
              this.eventUI.pauseLocked = !request.visible;
              this.eventUI.revision++;
              // A retired menu cannot keep WAIT or special-input clocks held.
              // Host/background pause and progress observations are preserved.
              this.clockInput.uiWaiting = false; this.clockInput.forceWaiting = false;
              break;
            case "stop-auto": this.setAutomaticMode(false); break;
            case "force-return": this.forceReturnRequested = true; break;
            case "force-save-return": this.forceSaveRequested=true;break;
            case "remove-all-actions": this.removeAllActions(request.pc); break;
            case "play-battle-effect": { const {pc,...op}=request;this.prepareBattleEffect(op,pc);break; }
            case "script-action": { const { pc, ...command }=request; this.enqueueScriptedAction(command, pc); break; }
            case "message": {
              if (!this.#messageHost || !this.#messageFrame) throw new Error("Missing battle source-message frame");
              const owner = this.#messageFrame.state, operation = request.operation;
              if (operation.command.kind === "close") {
                const ticket = this.#messagePresentation?.ticket ?? null;
                const closed = owner.prepare({ kind: "source-message", command: { kind: "close" } });
                closed.commit(); this.#messageFrameEffects = closed.effects;
                this.#messagePresentation = null;
                this.#messageJournal.push({ action: "close", pc: request.pc, ticket, time: this.time });
              } else {
                const presentation = this.observeMessageProvider(() => prepareBattleEventMessagePresentation(operation.command as Extract<typeof operation.command, { kind: "sequence" }>, this.#messageHost!, owner)),
                  context = this.observeMessageProvider(() => this.#messageHost!.sequence.prepare()),
                  prepared = owner.prepare({ kind: "source-message", command: presentation.command }, context.context);
                this.observeMessageProvider(presentation.validate); this.observeMessageProvider(context.validate);
                prepared.commit(); this.#messageFrameEffects = prepared.effects;
                this.#messageFrameValidations.push(() => this.observeMessageProvider(presentation.validate), () => this.observeMessageProvider(context.validate));
                this.#messagePresentation = { ticket: prepared.ticket, value: { ...operation.presentation! } };
                this.#messageJournal.push({ action: "open", pc: request.pc, ticket: prepared.ticket, time: this.time });
                nextEventState = acknowledgeBattleEventMessage(program, nextEventState, request.pc,
                  createSourceMessageTaskCursor(operation.command, prepared.timing!, prepared.ticket, this.time));
              }
              break;
            }
            case "message-page-input":
              if (!this.#messageFrame) throw new Error("Missing battle source-message frame");
              this.#messageFrame.state.executePageInput(request.ticket);
              this.#messageJournal.push({ action: "page-input", pc: request.pc, ticket: request.ticket, time: this.time }); break;
            case "message-complete":
              if (!this.#messageFrame || this.#messagePresentation?.ticket !== request.ticket)
                throw new Error("Stale battle message completion");
              this.#messageFrame.state.sequenceStatus(request.ticket);
              if (request.close) {
                const closed = this.#messageFrame.state.prepare({ kind: "source-message", command: { kind: "close" } });
                closed.commit(); this.#messageFrameEffects = closed.effects;
                this.#messagePresentation = null;
              }
              this.#messageJournal.push({ action: "complete", pc: request.pc, ticket: request.ticket, time: this.time });
              break;
            case "exec-ai": this.startEnemyAI(); break;
            case "sync-ai":
              for (const id of cores.exitedIds) this.aiStates.get(id)!.status = "exited";
              if (cores.alive !== this.eventControls.aiAliveLastSync)
                this.eventControls.updateEnabled = cores.alive;
              this.eventControls.aiAliveLastSync = cores.alive;
              break;
            case "end-enabled": this.eventControls.endEnabled = request.enabled; break;
            case "pause": this.eventControls.updateEnabled = !request.enabled; break;
            case "interactive": this.eventControls.interactive = request.enabled; break;
            case "enemy-no-act": this.eventControls.enemyNoAct = request.enabled; break;
            case "add-enemy": this.addEnemy(request.monsterId, request.uniqueId); break;
            case "change-enemy-party": this.changeEnemyParty(request.partyId, request.hidden); break;
            case "add-player": this.addPlayer(request.sourceId); break;
            case "change-player-group": this.changePlayerGroup(request.group); break;
            case "write-variable":
              if (!this.eventShared) throw new Error("Missing shared battle event state");
              this.eventShared.write(request.ref, request.value);
              break;
          }
        } catch (error) {
          throw new BattleEventError(program.source, request.pc,
            error instanceof Error ? error.message : String(error));
        }
      }
      this.eventState = nextEventState;
      if (!result.requests.length) return;
    }
  }
  #conditionJournal: { pc: number; time: number; operation: BattleEventCondition;
    targets: { instanceId: string; sourceId: number; before: number[]; after: number[] }[] }[] = [];
  get conditionExecution() { return structuredClone(this.#conditionJournal); }
  private applyEventCondition(operation: BattleEventCondition, pc: number): void {
    const op = parseBattleEventCondition(operation);
    if (this.eventHosts?.conditions !== WEB_BATTLE_EVENT_CONDITIONS || this.lifecycle.mode !== "script" ||
        canonical(this.lifecycle.program.instructions[pc]?.op) !== canonical(op))
      throw new Error("Missing or unbound explicit Web condition-list lifecycle owner");
    this.conditions.validateReferences([op.conditionId]);
    // The original wrapper always owns this separate phase, for both list
    // actions. A synchronous state update is not its down-animation callback.
    if (op.target.side === "enemy" && op.conditionId === 5)
      throw new Error("Source enemy condition5 requires down-animation synchronization and previous enemy no-act restoration");
    const targets = this.scriptedUnits(op.target);
    if (!targets.length || op.target.id > 0 && targets.length !== 1)
      throw new Error("Source condition target is absent or ambiguous; no empty target provider");
    const planned = targets.map(unit => {
      const change = this.conditions.eventListChange(unit.conditionIds, op.conditionId, op.action, unit.side);
      const changed = canonical(unit.conditionIds) !== canonical(change.currentIds);
      const life = changed ? this.conditions.settleLife(unit.hp, change.currentIds,
        this.conditions.isUnableFight(unit.conditionIds)) : { hp: unit.hp, conditionIds: [...unit.conditionIds] };
      if (life.hp !== unit.hp) life.conditionIds = this.conditions.updateDying(life.hp, unit.maxHp, life.conditionIds);
      const control = this.prepareControlState(unit, life.conditionIds, this.controlStates.get(unit.id)!,
        this.controlTargetUnits.get(unit.id)!, null, change.removed);
      const stop=this.prepareStopTransition(unit,life.conditionIds,this.conditions.reconcilePoisonState(life.conditionIds,
        this.poisonStates.get(unit.id)!.filter(clock=>!change.removed.includes(clock.conditionId)),this.atbSpeed),change.removed);
      const slow = this.conditions.reconcileSlowState(life.conditionIds, this.slowStates.get(unit.id)!.filter(clock=>!change.removed.includes(clock.conditionId)));
      return { unit, change, life, control, poison:stop.state, stop, slow, before: [...unit.conditionIds] };
    });
    // Every target/provider and same-actor ready ticket is prepared before
    // publishing the first live list. Direct script writes use the same native
    // Stop Start/Remove boundary as the complete ability action carrier.
    const {owners:stopReady,actions:stopCancelled}=this.prepareStopReadyCancellation(
      planned.filter(next=>next.stop.started).map(next=>next.unit.id));
    this.queue=this.queue.filter(action=>!stopReady.has(action.actor));
    this.reactions=this.reactions.filter(action=>!stopReady.has(action.actor));
    for(const action of stopCancelled){const unit=this.combatants.find(unit=>unit.id===action.actor)!;
      if(unit.side==="player"&&this.#fixedPlayerActions.get(unit.sourceId)===action.executionTicket)this.#fixedPlayerActions.delete(unit.sourceId);}
    for (const next of planned) {
      const lifeChanged = (next.unit.hp === 0) !== (next.life.hp === 0);
      Object.assign(next.unit, next.life);
      if(stopReady.has(next.unit.id)){next.unit.atb=0;next.unit.queued=false;}
      if(next.stop.removed)next.unit.atb=0;
      this.poisonStates.set(next.unit.id, next.poison); this.slowStates.set(next.unit.id, next.slow);
      this.controlStates.set(next.unit.id, next.control.state); this.controlTargetUnits.set(next.unit.id, next.control.targets);
      this.observeDropLife(next.unit);
      if (lifeChanged) {
        next.unit.atb = 0; next.unit.queued = false;
        this.queue = this.queue.filter(action => action.actor !== next.unit.id);
        this.reactions = this.reactions.filter(action => action.actor !== next.unit.id);
      }
      if (next.change.removed.some(id => this.content.conditions.behaviors.find(behavior => behavior.id === id)?.kind === "sleep"))
        for (const action of this.queue) if (action.actor === next.unit.id) action.charge = 0;
    }
    const keepsControl = (action: BattleAction) => !action.control || this.combatants.some(unit => unit.id === action.actor &&
      this.conditions.controlBehaviors(unit.conditionIds).some(behavior => behavior.id === action.control!.conditionId && behavior.kind === action.control!.kind));
    const dropped = this.queue.filter(action => action.control && !keepsControl(action)).map(action => action.actor);
    this.queue = this.queue.filter(keepsControl); this.reactions = this.reactions.filter(keepsControl);
    for (const id of dropped) {
      const unit = this.combatants.find(unit => unit.id === id)!;
      if (!this.queue.some(action => action.actor === id) && this.action?.actor !== id) unit.queued = false;
    }
    this.#conditionJournal.push({ pc, time: this.time, operation: op, targets: planned.map(next => ({
      instanceId: next.unit.id, sourceId: next.unit.sourceId, before: next.before, after: [...next.unit.conditionIds] })) });
  }
  /** The source request has no authority to create a combatant or grant an
   * ability. It captures current instance identities into the existing action
   * queue; target slot reuse can never redirect an old action. */
  private scriptedUnits(ref: ScriptedBattleAction["actor"]): Combatant[] {
    const units=this.activeCombatants.filter(unit=>unit.side===ref.side);
    if(ref.id<=0)return units;
    return units.filter(unit=>ref.side==="player"?unit.sourceId===ref.id:
      this.participantState.entries.some(entry=>!entry.removed&&entry.id===unit.id&&entry.uniqueId===ref.id));
  }
  private enqueueScriptedAction(command:ScriptedBattleAction,pc:number):void {
    command=parseScriptedBattleAction(command);
    if(this.eventHosts?.scriptedActions!==WEB_SCRIPTED_BATTLE_ACTIONS||this.lifecycle.mode!=="script"||
      canonical(this.lifecycle.program.instructions[pc]?.op)!==canonical(command))
      throw new Error("Unbound scripted battle action request");
    const actors=this.scriptedUnits(command.actor),targets=this.scriptedUnits(command.target);
    if(actors.length!==1||!targets.length||command.target.id>0&&targets.length!==1)
      throw new Error("Scripted battle source actor/target is absent or ambiguous");
    const actor=actors[0]!,ability=this.content.abilities[command.abilityId];
    if(!ability?.plan||!this.abilityCost(actor.id,command.abilityId))
      throw new Error("Unresolved scripted battle ability or cost owner");
    const selection:TargetSelection=command.target.id>0?{kind:"single",id:targets[0]!.id}:
      {kind:"side",side:command.target.side};
    const action:BattleAction={kind:"event",scripted:{pc,command:structuredClone(command),targetInstanceIds:targets.map(unit=>unit.id)},
      actor:actor.id,selection,targetIds:targets.map(unit=>unit.id),source:{kind:"ability",id:ability.id},
      commandId:null,charge:0,elapsed:0,resolved:false,results:[]};
    // Unsupported content is an error. Current death/sleep/insufficient MP can
    // invalidate a supported action at staging, using the ordinary queue path.
    this.validateScriptedAbility(actor,ability);
    this.registerActions([action]);this.reactions.push(action);
  }
  private validateScriptedAbility(actor:Combatant,ability:AbilityDefinition):void {
    if(!ability.plan||ability.plan.effects.some(effect=>effect.kind==="random-ability"||effect.kind==="forced-escape"))
      throw new Error("Unresolved scripted derived-action provider");
    if(ability.plan.targeting.normalFormationOnly&&this.content.formation!=="normal")
      throw new Error("Unresolved scripted battle formation");
    if (ability.plan.effects.some(effect => effect.kind === "non-damaging")) {
      if (!ability.nonDamagingPresentation || ability.presentation !== "source-effect-deferred")
        throw new Error("Missing source non-damaging presentation policy");
      validateNonDamagingPresentation(ability.nonDamagingPresentation);
    }
    this.conditions.validateActive(actor.conditionIds);
    resourceAbsorptionEffect(ability.plan);
    validateOrdinaryConditionAction(ability);
    if(ability.plan.effects.some(effect=>effect.kind==="physical")){
      if(!actor.physical)throw new Error("Unresolved scripted physical owner");
      this.physicalRows(actor,ability.id,actor);
    }
    if(ability.plan.effects.some(effect=>effect.kind==="change-row")&&actor.side!=="player")
      throw new Error("Unresolved scripted row owner");
  }
  private canUseScriptedAction(action:BattleAction):boolean {
    const binding=action.scripted,actor=this.combatants.find(unit=>unit.id===action.actor);
    if(!binding||this.eventHosts?.scriptedActions!==WEB_SCRIPTED_BATTLE_ACTIONS||action.source.kind!=="ability"||
      this.lifecycle.mode!=="script"||canonical(this.lifecycle.program.instructions[binding.pc]?.op)!==canonical(binding.command)||
      action.source.id!==binding.command.abilityId)throw new Error("Invalid scripted action authority");
    if(!actor)return false;
    const ability=this.content.abilities[action.source.id],cost=this.abilityCost(actor.id,action.source.id);
    if(!ability?.plan||!cost)throw new Error("Scripted battle definition/cost changed");
    this.validateScriptedAbility(actor,ability);
    return actor.hp>0&&!this.actionSuspended(actor)&&!this.enemyExits.has(actor.id)&&
      (actor.side!=="player"||actor.mp>=cost.mp)&&conditionsAllowAction(actor.conditionIds,ability.program.forbiddenConditionIds,[]);
  }
  private scriptedTargetChoices(action:BattleAction):TargetChoice[] {
    if(!this.canUseScriptedAction(action))return[];
    const plan=this.content.abilities[action.source.id]!.plan!;
    const targets=action.scripted!.targetInstanceIds.filter(id=>this.activeCombatants.some(unit=>unit.id===id&&
      (unit.hp>0||plan.targeting.life==="include-fallen-players"&&unit.side==="player")));
    return targets.length?[{selection:structuredClone(action.selection),targetIds:targets}]:[];
  }
  private eventPlayersEnded(): boolean {
    if (!this.content.battleEvents) throw new Error("Missing battle event condition rules");
    // Current.BattleFinishIsPlayersFault projects the current player parameters,
    // then All(IsBattleEndByUnit). It neither reads the persistent HP copy nor
    // creates another roster/life-state owner.
    return this.players.every(player => battleEventUnitEnded(this.content.battleEvents!, player.conditionIds));
  }
  private battleAICoresAlive(): { alive: boolean; exitedIds: string[] } {
    const exitedIds: string[] = [];
    let alive = false;
    const actionsEnded = !this.action && !this.queue.length && !this.reactions.length;
    for (const [id, state] of this.aiStates) {
      if (this.enemyExits.has(id)) continue;
      if (state.status === "exited") continue;
      const actor = this.enemies.find(enemy => enemy.id === id);
      if (!actor) throw new Error("Battle event AI core has no unit owner");
      if (!this.content.battleEvents) throw new Error("Missing battle event condition rules");
      if (battleEventUnitEnded(this.content.battleEvents, actor.conditionIds) && actionsEnded)
        exitedIds.push(id);
      else alive = true;
    }
    return { alive, exitedIds };
  }
  /** Inspection/replay callers cannot mutate the live queue or its selections. */
  get pendingActions(): readonly BattleAction[] {
    return structuredClone([...this.reactions, ...this.queue]);
  }
  conditionClockState(actorId: string): PoisonState {
    const state = this.poisonStates.get(actorId);
    if (!state) throw new Error("Unknown condition clock owner");
    return structuredClone(state);
  }
  slowClockState(actorId: string): SlowState {
    const state = this.slowStates.get(actorId);
    if (!state) throw new Error("Unknown slow clock owner");
    return structuredClone(state);
  }
  controlClockState(actorId: string): readonly ControlFunctionState[] {
    const state = this.controlStates.get(actorId);
    if (!state) throw new Error("Unknown condition-control owner");
    return structuredClone(state);
  }
  private controlTargetPolicy(ability: AbilityDefinition): NonNullable<BattleContent["conditionControlPolicy"]> | undefined {
    if (!this.controlPolicy || ability.program.range !== 16 || !ability.plan?.effects.length ||
        ability.plan.effects.some(effect => effect.kind !== "add-condition" ||
          this.conditions.controlBehaviors([effect.conditionId]).length !== 1)) return undefined;
    return this.controlPolicy;
  }
  private prepareControlState(unit: Combatant, conditionIds: readonly number[], previous: readonly ControlFunctionState[],
    targetedUnits: ReadonlyMap<number, Combatant>, addedBy: Combatant | null, resetIds: readonly number[] = []) {
    if (!this.#conditionUnitIdentities.has(unit))
      this.#conditionUnitIdentities.set(unit, { id: unit.id, sourceId: unit.sourceId, side: unit.side });
    const behaviors = this.conditions.controlBehaviors(conditionIds), state: ControlFunctionState[] = [],
      targets = new Map<number, Combatant>();
    if (behaviors.length && !this.controlPolicy) throw new Error("Missing explicit Web condition-control scheduler policy");
    const seen = new Set<number>();
    for (const clock of previous) {
      if (seen.has(clock.recovery.conditionId)) throw new Error("Duplicate condition-control clock");
      seen.add(clock.recovery.conditionId);
    }
    for (const behavior of behaviors) {
      const old = resetIds.includes(behavior.id) ? undefined : previous.find(clock => clock.recovery.conditionId === behavior.id);
      const captured = old ? targetedUnits.get(behavior.id) ?? null : addedBy;
      const recovery = old ? { ...old.recovery } : createControlRecoveryState(behavior, captured?.id ?? null);
      validateControlRecoveryState(behavior, recovery);
      if (recovery.targetedUnitId !== (captured?.id ?? null)) throw new Error("Condition targeting instance mismatch");
      const doom = behavior.kind === "doom" ? old?.doom ? { ...old.doom } : createDoomClock(behavior) : null;
      if (behavior.kind === "doom") validateDoomClock(behavior, doom!);
      else if (old?.doom) throw new Error("Unexpected condition countdown owner");
      state.push({ recovery, doom });
      if (captured) targets.set(behavior.id, captured);
    }
    return { state, targets };
  }
  private actionSuspended(unit: Pick<Combatant, "conditionIds">): boolean {
    // The closed live function contributions stay independent. Stop.Remove
    // cannot release another active Sleep (native actNotPossibleCounter).
    return this.conditions.controlBehaviors(unit.conditionIds).some(behavior => behavior.kind === "sleep" || behavior.kind === "stop");
  }
  /** Current presentation/interaction projection, never an external setter. */
  isStopped(actorId: string): boolean {
    const unit = this.combatants.find(current => current.id === actorId);
    if (!unit) throw new Error("Missing current Stop presentation unit");
    return this.conditions.controlBehaviors(unit.conditionIds).some(behavior => behavior.kind === "stop");
  }
  private prepareStopTransition(unit: Combatant, conditionIds: readonly number[], poison: Readonly<PoisonState>,
    removedIds: readonly number[] = []) {
    const before = this.conditions.controlBehaviors(unit.conditionIds).filter(b => b.kind === "stop"),
      after = this.conditions.controlBehaviors(conditionIds).filter(b => b.kind === "stop");
    if (before.length > 1 || after.length > 1) throw new Error("Unresolved overlapping Stop function writers");
    const removed = before.some(b => !after.some(next => next.id === b.id) || removedIds.includes(b.id)),
      started = after.some(b => !before.some(old => old.id === b.id) || removedIds.includes(b.id));
    let state = poison.map(clock => ({ ...clock }));
    // Each native Remove/Start writes then-current actual instances. A newly
    // constructed Poison is not suspended simply because Stop is still present.
    if (removed) state = this.conditions.writePoisonTimeStop(conditionIds, state, false);
    if (started) state = this.conditions.writePoisonTimeStop(conditionIds, state, true);
    return { state, removed, started };
  }
  private prepareStopReadyCancellation(startedIds: readonly string[]) {
    const owners=new Set(startedIds.filter(id=>this.queue.some(pending=>pending.actor===id&&["normal","loop"].includes(pending.kind)))),
      actions=[...this.queue,...this.reactions].filter(pending=>owners.has(pending.actor));
    for(const action of actions)if(!Number.isInteger(action.executionTicket)||action.executionTicket!<1||
      action.executionTicket!>=this.#nextActionTicket||!this.combatants.some(unit=>unit.id===action.actor))
      throw new Error("Stop ready cancellation requires actual action owner and execution ticket");
    return {owners,actions};
  }
  private hasAutomaticControl(unit: Pick<Combatant, "conditionIds">): boolean {
    return this.conditions.controlBehaviors(unit.conditionIds).some(behavior => behavior.kind === "confusion" || behavior.kind === "temptation");
  }
  private actionControl(unit: Combatant): ControlActionMetadata | null {
    const active = this.conditions.controlBehaviors(unit.conditionIds).filter(behavior =>
      behavior.kind === "confusion" || behavior.kind === "temptation");
    if (!active.length) return null;
    if (!this.controlPolicy || active.length !== 1) throw new Error("Unresolved overlapping action-control providers");
    const behavior = active[0]!;
    return { conditionId: behavior.id, kind: behavior.kind as "confusion" | "temptation", policy: this.controlPolicy.kind };
  }
  private controlPlayerCandidates(actor: Combatant): ControlActionCandidate[] {
    if (!this.controlPolicy || actor.side !== "player") throw new Error("Missing current controlled player context");
    const projection = this.usesSourceQualification
      ? this.commandQualificationFor(actor, this.players.length, this.inventoryQualification, this.equipmentAbilities.get(actor.id), true)
      : null;
    if (this.usesSourceQualification && !projection) throw new Error("Missing owned control-command availability");
    const entries = projection?.entries ?? actor.commands.map(commandId => {
      const command = this.content.commands[commandId];
      return { commandId, kind: command?.kind === "item" ? "item" : "direct",
        abilityIds: command?.abilityIds.filter(id => actor.abilities.includes(id)) ?? [],
        available: command ? conditionsAllowAction(actor.conditionIds, [], command.forbiddenConditionIds) : null,
        blockers: command ? [] : ["Missing authored command"] };
    });
    const result: ControlActionCandidate[] = [];
    for (const entry of entries) {
      if (!sourceControlCommandIds.includes(entry.commandId) ||
          entry.commandId === 26 && !this.conditions.types(actor.conditionIds).includes(607) || entry.available === false) continue;
      if (entry.available !== true || entry.blockers.length || entry.kind === "item" || entry.kind === "unresolved")
        throw new Error("Unresolved control-command availability: " + entry.commandId);
      if (entry.commandId === 31) throw new Error("Unresolved double-action control command");
      for (const id of entry.abilityIds) if (!this.content.abilities[id]) throw new Error("Missing control ability master: " + id);
      const ids = entry.commandId === 7
        ? entry.abilityIds.filter(id => [1, 2].includes(this.content.abilities[id]!.program.rules.type_id!))
        : [...entry.abilityIds];
      // GetAutoSelectAbility returns original master ability1 when its filtered
      // list is empty. This temporary action never grants a held ability.
      if (!ids.length && entry.commandId === 7) ids.push(1);
      if (!ids.length) throw new Error("Missing control-command ability candidates: " + entry.commandId);
      const abilities = ids.map(id => {
        const ability = this.content.abilities[id];
        if (!ability?.plan || !this.abilityCost(actor.id, id) ||
            ability.plan.effects.some(effect => effect.kind === "random-ability" || effect.kind === "forced-escape") ||
            ability.plan.effects.some(effect => effect.kind === "physical") && !actor.physical)
          throw new Error(`Unresolved control ability ${id}: ${ability?.blockers.join("; ") ?? "missing definition"}`);
        return { id, range: ability.program.range, rule: ability.plan.targeting };
      });
      result.push({ commandId: entry.commandId, abilities });
    }
    if (!result.length) throw new Error("No admitted owned control command");
    return result;
  }
  private decideControlledPlayer(actor: Combatant): void {
    const control = this.actionControl(actor);
    if (!control) throw new Error("Missing player control function");
    const result = planWebControlAction({ policy: control.policy, actor, units: this.activeCombatants,
      formation: this.content.formation, candidates: this.controlPlayerCandidates(actor) }, (min, max) => this.randomInt(min, max));
    const ability = this.content.abilities[result.abilityId]!, action = this.createAction(actor, ability, result.choice, result.commandId);
    action.control = control;
    const conditionIds = this.conditions.admitAtbAction(actor.conditionIds, [{ id: ability.id, type: ability.program.rules.type_id! }]);
    this.registerActions([action]);this.queue.push(action); actor.conditionIds = conditionIds; actor.queued = true;
  }
  private conditionUndead(unit: Combatant, conditionIds: readonly number[]): boolean {
    const identity = this.#conditionUnitIdentities.get(unit);
    if (!identity || !this.combatants.includes(unit) || identity.id !== unit.id || identity.sourceId !== unit.sourceId || identity.side !== unit.side)
      throw new Error("Undead condition owner identity changed");
    const commonTraits = unit.side === "player" ? this.playerConditionTraits.get(unit.sourceId) : undefined,
      traits = unit.conditionTraits ?? commonTraits;
    if (unit.conditionTraits && commonTraits && canonical(unit.conditionTraits) !== canonical(commonTraits))
      throw new Error("Conflicting source Undead condition provider");
    if (!traits || traits.kind !== "source-condition-traits-v1" || typeof traits.baseUndead !== "boolean")
      throw new Error("Missing explicit source Undead condition provider");
    const types = this.conditions.types(conditionIds);
    // The separate isUndeadFromRampage field cannot be inferred from missing
    // metadata. This runtime has never installed a Rampage function; an entry
    // carrying that unimplemented function is rejected by validateActive.
    if (types.includes(9)) throw new Error("Unresolved Rampage Undead provider");
    if (traits.baseUndead || types.includes(34)) return true;
    if (unit.side === "enemy") return false;
    const input = this.inventoryQualification,
      loadout = input?.members.find(member => member.id === unit.id);
    if (!input || !loadout) {
      if (this.usesSourceQualification) throw new Error("Missing owned Undead equipment provider");
      // The catalog-less synthetic profile has no mutable equipment owner.
      return false;
    }
    if (loadout.sourceId !== unit.sourceId || loadout.equipment.length !== 6)
      throw new Error("Undead equipment owner mismatch");
    const equipment = loadout.equipment.map(id => {
      const gear = input.equipmentCatalog.definitions[id];
      if (!gear || gear.blockers.length || !gear.parameter)
        throw new Error("Unresolved Undead equipment provider");
      return gear;
    });
    // FF6 parameter provider checks armor master 124 in accessory slots 5/6,
    // independently of the source parameter's fixed baseUndead flag.
    return equipment.slice(4, 6).some(gear => gear.kind === "armor" && gear.equipmentId === 124);
  }
  private prepareControlAdvance(actor: Combatant, initialIds: readonly number[], initialHp: number, seconds: number) {
    const previous = this.controlStates.get(actor.id), references = this.controlTargetUnits.get(actor.id);
    if (!previous || !references) throw new Error("Missing condition-control function owner");
    let conditionIds = [...initialIds], hp = initialHp;
    const clocks: ControlFunctionState[] = [], removedIds: number[] = [];
    const duration = Math.fround(Math.fround(seconds) * Math.fround(this.atbSpeed));
    for (const behavior of this.conditions.controlBehaviors(initialIds)) {
      const clock = previous.find(state => state.recovery.conditionId === behavior.id);
      if (!clock) throw new Error("Missing active condition-control function");
      const target = references.get(behavior.id);
      if (behavior.kind === "temptation" && (!target || !this.combatants.includes(target)))
        throw new Error("Retired or missing targeted condition unit");
      const recovery = projectControlRecovery(behavior, clock.recovery, {
        progress: true, durationSeconds: behavior.kind === "stop"
          ? stopConditionRecoveryDuration(this.conditions.types(initialIds), Math.fround(seconds), Math.fround(this.atbSpeed)) : duration,
        // Ordinary source entry constructs an empty list; unsupported weapon
        // condition/function providers never enter this runtime domain.
        normalAttackAdded: false,
        targetedUnitGameOver: behavior.kind === "temptation" ? this.conditions.isUnableFight(target!.conditionIds) : null,
      }, (min, max) => this.randomInt(min, max));
      let doom = clock.doom ? { ...clock.doom } : null;
      for (const _reason of recovery.naturalRemovals) {
        const change = this.conditions.recover(conditionIds, [behavior.id]);
        conditionIds = change.currentIds;
        removedIds.push(...change.removed);
      }
      if (behavior.kind === "doom" && conditionIds.includes(behavior.id)) {
        const projected = projectDoomClock(behavior, doom!, {
          conditionTypes: this.conditions.types(conditionIds), seconds: duration, actionStaging: this.action !== null,
        });
        doom = projected.state;
        if (projected.requestsDeath) {
          if (this.conditionUndead(actor, conditionIds)) {
            if (hp > 0) hp = actor.maxHp;
            const ids = this.conditions.controlBehaviors(conditionIds).filter(current => current.kind === "doom").map(current => current.id);
            const change = this.conditions.recover(conditionIds, ids);
            conditionIds = change.currentIds; removedIds.push(...change.removed);
          } else {
            const change = this.conditions.forceUnableFight(conditionIds);
            conditionIds = change.currentIds; removedIds.push(...change.removed);
          }
          doom = { ...doom, dead: true };
        }
      }
      clocks.push({ recovery: recovery.state, doom });
    }
    const next = this.prepareControlState(actor, conditionIds, clocks, references, null);
    return { hp, conditionIds, control: next, removedIds };
  }
  private prepareControlHit(unit: Combatant, conditionIds: readonly number[], control: ReturnType<BattleGame["prepareControlState"]>,
    action: BattleAction, ability: ReturnType<BattleGame["actionDefinition"]>, effects: readonly AbilityEffectResult[],
    projected: readonly Combatant[]) {
    const activeFunctions = new Set(this.controlStates.get(unit.id)!.map(clock => clock.recovery.conditionId));
    if (!control.state.some(clock => activeFunctions.has(clock.recovery.conditionId)))
      return { conditionIds: [...conditionIds], control, removedIds: [] as number[] };
    if (action.source.kind !== "ability") throw new Error("Missing item condition recovery-hit classification");
    const classification = this.content.abilities[action.source.id]?.conditionRecoveryHit;
    if (!classification || classification.kind !== "source-condition-recovery-hit-v1" ||
        !Number.isInteger(classification.forAiType) || classification.forAiType < 0 || typeof classification.isMagic !== "boolean")
      throw new Error("Missing explicit source condition recovery-hit classification");
    if (classification.forAiType !== 1 || classification.isMagic ||
        !effects.some(effect => effect.resource === "none" ? isNonDamagingHit(effect) : !effect.missed))
      return { conditionIds: [...conditionIds], control, removedIds: [] as number[] };
    if (!ability.plan) throw new Error("Missing condition recovery ability plan");
    let ids = [...conditionIds];
    const clocks: ControlFunctionState[] = [], removedIds: number[] = [];
    for (const behavior of this.conditions.controlBehaviors(ids)) {
      const clock = control.state.find(current => current.recovery.conditionId === behavior.id)!;
      if (!activeFunctions.has(behavior.id)) { clocks.push(structuredClone(clock)); continue; }
      const target = control.targets.get(behavior.id);
      if (behavior.kind === "temptation" && (!target || !this.combatants.includes(target)))
        throw new Error("Retired or missing targeted condition unit");
      const targetState = target ? projected.find(current => current.id === target.id) : undefined;
      const recovery = projectControlRecovery(behavior,
        { ...clock.recovery, physicalHits: clock.recovery.physicalHits + 1 }, {
          progress: false, durationSeconds: 0, normalAttackAdded: false,
          targetedUnitGameOver: behavior.kind === "temptation"
            ? this.conditions.isUnableFight(targetState!.conditionIds) : null,
        }, () => { throw new Error("CountUpNumberOfExecutions must not draw random"); });
      for (const _reason of recovery.naturalRemovals) {
        const change = this.conditions.recover(ids, [behavior.id]); ids = change.currentIds; removedIds.push(...change.removed);
      }
      clocks.push({ recovery: recovery.state, doom: clock.doom ? { ...clock.doom } : null });
    }
    return { conditionIds: ids, control: this.prepareControlState(unit, ids, clocks, control.targets, null), removedIds };
  }
  private admitAITurn(actor: Combatant, turn: BattleAITurn) {
    const program = actor.ai!;
    const fail = (pc: number, reason: string): never => {
      throw new BattleAIError(program.source, pc, reason);
    };
    if (turn.state.status !== "waiting")
      fail(
        turn.state.pc,
        `${turn.trigger} action path does not return to SyncAI`,
      );
    if (
      turn.trigger === "normal" &&
      turn.acts.filter((a) => a.selected).length !== 1
    )
      fail(
        turn.state.pc,
        "normal action path must select exactly one table row",
      );
    if (
      turn.trigger === "reaction" &&
      turn.acts.some((a) => a.kind !== "counter-act")
    )
      fail(turn.state.pc, "reaction path emitted a normal action");
    if (turn.acts.length > 1000)
      fail(turn.state.pc, "AI exceeded host action budget");
    for (const pc of turn.visited) {
      const op = program.instructions[pc]!.op;
      if (op.kind === "condition")
        this.conditions.validateReferences([op.conditionId]);
    }
    for (const act of turn.acts) {
      if (act.kind === "loop-act") {
        const count = act.counts.reduce((sum, n) => sum + Math.max(0, n), 0);
        if (count > 1000) fail(act.pc, "AI loop exceeded host action budget");
        if (act.selected && count === 0)
          fail(act.pc, "empty loop action decision");
      }
      for (const id of act.abilities) {
        const ability = this.content.abilities[id];
        if (!actor.abilities.includes(id) || !ability?.plan)
          fail(
            act.pc,
            `unimplemented ability ${id}: ${ability?.blockers.join("; ") ?? "missing definition"}`,
          );
        const requestedTargeting = act.kind === "counter-act" ? act.targeting ?? "received-actor" : null;
        if (requestedTargeting !== null && requestedTargeting !== "received-actor" && requestedTargeting !== "automatic")
          fail(act.pc, "invalid counter target provider");
        const targeting = requestedTargeting === null ? null : sourceCounterTargeting(ability!.program.range, requestedTargeting);
        // SetActData checks IsConfusion before null-target self dispatch. The
        // ordinary Web control owner has no interrupt completion contract yet;
        // a new self lane must not silently ignore that actual active owner.
        if (act.kind === "counter-act" && requestedTargeting === "received-actor" &&
            ability!.program.range === 5 && this.hasAutomaticControl(actor))
          fail(act.pc, "Source self-counter target under active action control is unresolved");
        const targetBlocker = battleAITargetBlocker(ability!.program.range,
          ability!.plan!.targeting, targeting === "received-actor" ? "counter" : "normal", undefined, this.controlTargetPolicy(ability!));
        if (targetBlocker)
          fail(
            act.pc,
            `unimplemented automatic target range for ability ${id}: ${targetBlocker}`,
          );
        if (
          !actor.physical &&
          ability!.plan!.effects.some((e) => e.kind === "physical")
        )
          fail(act.pc, `missing physical parameters for ability ${id}`);
        if (
          ability!.plan!.targeting.normalFormationOnly &&
          this.content.formation !== "normal"
        )
          fail(act.pc, `unimplemented formation for ability ${id}`);
      }
    }
  }
  private decideEnemyAction(actor: Combatant) {
    const state = this.aiStates.get(actor.id)!;
    const turn = planBattleAITurn(actor.ai!, state, this.aiContext(actor));
    this.admitAITurn(actor, turn);
    const previousRandom = this.randomState;
    try {
      const decisions: BattleAction[] = [];
      for (const act of turn.acts) {
        const ids = selectBattleAIAbilities(act, {
          integer: (min, max) => this.randomInt(min, max),
          float: (min, max) =>
            Math.fround(min + this.randomUnit() * (max - min)),
        });
        for (const id of ids) {
          const ability = this.content.abilities[id]!;
          // Native raw groups and their derived target type precede execution
          // eligibility. In particular, an enemy corpse still in the current
          // list can be the initial random ally, and range 8 collapses to a
          // single only when the raw player list contains one instance.
          const control = this.actionControl(actor);
          const choice = control ? planWebControlTarget({ id, range: ability.program.range, rule: ability.plan!.targeting },
            actor, this.activeCombatants, this.content.formation, (min, max) => this.randomInt(min, max)) : planBattleAITarget({ actor, units: this.activeCombatants,
            eligiblePlayers: this.players.filter(player => player.hp > 0),
            range: ability.program.range, rule: ability.plan!.targeting,
            formation: this.content.formation,
            ...(this.controlTargetPolicy(ability) ? { controlPolicy: this.controlPolicy! } : {}),
          }, (min, max) => this.randomInt(min, max));
          if (!choice)
            throw new BattleAIError(
              actor.ai!.source,
              act.pc,
              `no admitted automatic target for ability ${id}`,
            );
          const action = this.createAction(
              actor,
              ability,
              choice,
              null,
              act.kind === "loop-act" ? "loop" : "normal",
            );
          if (control) action.control = control;
          decisions.push(action);
        }
      }
      if (!decisions.length)
        throw new BattleAIError(
          actor.ai!.source,
          state.pc,
          "no normal action decision",
        );
      // Commit the whole group only after every target has been selected. A
      // later failure cannot leave half a LoopAct in the live queue.
      const conditionIds = this.conditions.admitAtbAction(actor.conditionIds, decisions.map((action) => {
        const ability = this.content.abilities[action.source.id]!;
        return { id: ability.id, type: ability.program.rules.type_id! };
      }));
      this.registerActions(decisions);this.queue.push(...decisions);
      actor.conditionIds = conditionIds;
      actor.queued = true;
      this.aiStates.set(actor.id, turn.state);
      actor.behavior = turn.behavior;
    } catch (error) {
      this.randomState = previousRandom;
      throw error;
    }
  }
  private log(text: string) {
    this.events.push({ time: this.time, text });
    if (this.events.length > 80) this.events.shift();
  }
  targetChoices(actorId: string, abilityId: number): TargetChoice[] {
    if (this.enemyExits.has(actorId)) return [];
    const actor = this.combatants.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability ||
      !this.qualifiedAbility(actor, abilityId) ||
      !ability.plan
    )
      return [];
    if (
      !actor.physical &&
      ability.plan.effects.some((e) => e.kind === "physical")
    )
      return [];
    return battleTargetChoices(
      ability.plan.targeting,
      actor,
      this.activeCombatants,
      this.content.formation,
    );
  }
  /** Single-unit candidates for existing callers. Group requests must use an
   * explicit selection so a one-member group never silently becomes single. */
  targets(actorId: string, abilityId: number): Combatant[] {
    return this.targetChoices(actorId, abilityId)
      .filter((choice) => choice.selection.kind === "single")
      .map((choice) =>
        this.combatants.find((c) => c.id === choice.targetIds[0])!,
      );
  }
  command(
    actorId: string,
    abilityId: number,
    target: string | TargetSelection,
    commandId?: number | null,
  ): boolean {
    if (this.phase !== "active") return false;
    const actor = this.ready.find((c) => c.id === actorId),
      ability = this.content.abilities[abilityId];
    if (
      !actor ||
      !ability ||
      !ability.plan ||
      !this.canUse(actorId, abilityId, commandId)
    )
      return false;
    const selection: TargetSelection =
      typeof target === "string" ? { kind: "single", id: target } : target;
    const choice = this.targetChoices(actorId, abilityId).find((c) =>
      sameTargetSelection(c.selection, selection),
    );
    if (!choice) return false;
    const action = this.createAction(
      actor,
      ability,
      choice,
      this.actionCommand(actor, abilityId, commandId)!,
    );
    const conditionIds = this.conditions.admitAtbAction(actor.conditionIds,
      [{ id: ability.id, type: ability.program.rules.type_id! }]);
    this.registerActions([action]);this.queue.push(action);
    actor.conditionIds = conditionIds;
    actor.queued = true;
    return true;
  }
  private createAction(
    actor: Combatant,
    ability: AbilityDefinition,
    choice: TargetChoice,
    commandId: number | null = null,
    kind: BattleAction["kind"] = "normal",
    targeting?: BattleAICounterTargeting,
  ): BattleAction {
    if (targeting !== undefined && (kind !== "counter" ||
        targeting !== "received-actor" && targeting !== "automatic"))
      throw new Error("Invalid interrupt target provider");
    return {
      kind,
      ...(targeting === undefined ? {} : { targeting }),
      actor: actor.id,
      selection: structuredClone(choice.selection),
      targetIds: [...choice.targetIds],
      source: { kind: "ability", id: ability.id },
      commandId,
      // ActDecision 0x1587aa0 routes Interrupt directly to the executor;
      // it never enters Progress.SetActData/GetChantingTime.
      charge:
        kind === "counter" || kind === "derived" || kind === "event"
          ? 0
          : chantingSeconds({
              actor: actor.side,
              firstAbility: {
                id: ability.id,
                typeId: ability.program.rules.type_id!,
                wait: ability.wait,
              },
              command:
                commandId === null ? null : this.content.commands[commandId]!,
              agility: actor.agility,
              conditionTypes: this.conditions.types(actor.conditionIds),
              atbSpeed: this.atbSpeed,
            }),
      elapsed: 0,
      resolved: false,
      results: [],
    };
  }
  private registerActions(actions:readonly BattleAction[]):void {
    if(this.#nextActionTicket+actions.length>0x7fffffff)throw new Error('Battle action ticket capacity exceeded');
    const owners=actions.map(action=>{
      const owner=this.combatants.find(unit=>unit.id===action.actor);
      if(!owner||!['player','enemy'].includes(owner.side)||action.executionTicket!==undefined)
        throw new Error('Unresolved or already published battle action identity');
      return owner;
    });
    for(const [index,action]of actions.entries()){
      action.executionTicket=this.#nextActionTicket++;
      const owner=owners[index]!;
      if(owner.side==='player')this.#fixedPlayerActions.set(owner.sourceId,action.executionTicket);
    }
  }
  private releaseStagedAction(reason:'completed'|'cancelled'|'actor-retired'):void {
    const action=this.action;if(!action)return;
    this.action=null;
    // Cancellation is not normal completion: native clears staging before its
    // state transition, so no staged actor reaches the ordinary ATB delegate.
    if(reason!=='cancelled'){
      const actor=this.combatants.find(unit=>unit.id===action.actor);
      if(actor)this.finishActorAction(actor,action.kind);
    }
  }
  private removeAllActions(pc:number):void {
    const pending=[...this.queue,...this.reactions],all=[...(this.action?[this.action]:[]),...pending];
    // Unknown ownership cannot be hidden by deleting the offending action.
    const tickets=new Set<number>();
    for(const action of all){
      const ticket=action.executionTicket;
      if(!Number.isInteger(ticket)||ticket!<1||ticket!>=this.#nextActionTicket||tickets.has(ticket!)||
          !this.combatants.some(unit=>unit.id===action.actor&&['player','enemy'].includes(unit.side)))
        throw new Error('RemoveAllAct requires every actual queued/staged action owner and execution ticket');
      tickets.add(ticket!);
    }
    const journal={pc,time:this.time,staged:this.action?.executionTicket??null,stagedCommitted:this.action?.resolved??false,
      queued:pending.map(action=>action.executionTicket!),fixed:[...this.#fixedPlayerActions].map(([sourceId,ticket])=>({sourceId,ticket}))};
    // Web controls V1 cancels both source side-filters atomically before idle
    // entry; it never dispatches a surviving enemy interrupt between the two.
    this.queue=[];this.reactions=[];this.#fixedPlayerActions.clear();
    this.releaseStagedAction('cancelled');
    for(const unit of this.combatants)unit.queued=false;
    this.#actionCancellations.push(journal);
    this.eventUI.revision++;
    this.clockInput.uiWaiting=false;this.clockInput.forceWaiting=false;
    // HP/MP, costs, consumed items, results, condition clocks, ATB values, AI
    // continuation/parameters, source messages and global effects stay owned.
  }
  private finishActorAction(actor: Combatant, kind: BattleAction["kind"]) {
    // Interrupt actions have no ordinary ATB completion delegate. In particular,
    // a counter must preserve a partially filled gauge or an already queued turn.
    if (kind === "counter") return;
    // Native ActExectionEndDelegate keeps the gauge while normal/Loop actions
    // remain in chanting or execution stacks. One LoopAct is one table turn.
    actor.queued = this.queue.some((pending) => pending.actor === actor.id);
    if (!actor.queued) actor.atb = 0;
  }
  advance(ms: number) {
    if (this.#messageRetired||this.#effectRetired) throw new Error("Retired battle presentation owner");
    if (this.#messageBusy) throw new Error("Reentrant battle presentation update");
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid battle elapsed time");
    this.validateConditionState();
    if (!this.clockGate().simulation) return;
    this.remainder += ms;
    while (this.remainder >= 10) {
      if (this.phase === "active") this.tick();
      else if (this.#messageHost?.owner.active||this.#fadeHost) this.advanceTerminalMessage();
      this.remainder -= 10;
    }
  }
  private advanceTerminalMessage(): void {
    if(this.#messageBusy)throw new Error("Reentrant battle presentation update");
    this.validateMessageOwnership();this.validateFadeOwnership();
    const frame=this.#messageHost?.owner.active?this.#messageHost.owner.prepareFrame():null;let fade:ReturnType<BattleGlobalFadeHost["owner"]["prepareFrame"]>|null=null;
    this.#messageBusy=true;
    try {fade=this.#fadeHost?.owner.prepareFrame()??null;fade?.state.advance(.01);frame?.state.advance(.01);
      const f=fade?.prepareCommit(),m=frame?.prepareCommit();f?.validate();m?.validate();m?.commit();f?.commit();this.#fadeRevision=this.#fadeHost?.owner.mutationRevision??0;
    }catch(error){this.discardBattleFrame('message',frame);this.discardBattleFrame('fade',fade);throw error;}finally{this.#messageBusy=false;}
  }
  private tick() {
    if (this.#messageBusy) throw new Error("Reentrant battle message frame");
    // One failed simulation step consumes neither logical time nor randomness.
    // Definitions/media/AI programs stay shared; only mutable runtime values are copied.
    const before = {
      conditionJournal: structuredClone(this.#conditionJournal),
      unitOwners: [...this.combatants],
      participantState: structuredClone(this.participantState),
      currentEnemyPartyId: this.currentEnemyPartyId,
      currentEnemySlots: structuredClone(this.currentEnemySlots),
      hiddenEnemyIds: new Set(this.hiddenEnemyIds),
      playerState: structuredClone(this.playerState),
      playerResources: structuredClone(this.playerResources),
      playerObservations: structuredClone(this.playerObservations),
      // Qualification catalogs/loadouts are immutable; group publication swaps
      // the complete view. Preserve its owner without copying the master per tick.
      inventoryQualification: this.inventoryQualification,
      costOwners: new Map(this.costOwners),
      unresolvedCostOwners: new Set(this.unresolvedCostOwners),
      equipmentAbilities: new Map(this.equipmentAbilities),
      units: this.combatants.map((c) => ({
        ...c,
        conditionIds: [...c.conditionIds],
        behavior: c.behavior ? structuredClone(c.behavior) : null,
        ...(c.appearanceState ? { appearanceState: structuredClone(c.appearanceState) } : {}),
      })),
      action: structuredClone(this.action),
      nextActionTicket:this.#nextActionTicket,fixedPlayerActions:new Map(this.#fixedPlayerActions),actionCancellations:structuredClone(this.#actionCancellations),
      queue: structuredClone(this.queue),
      reactions: structuredClone(this.reactions),
      ai: structuredClone(this.aiStates),
      gauTask:this.#gauTask?{...this.#gauTask}:null,gauJournal:structuredClone(this.#gauJournal),
      fadeJournal:structuredClone(this.#fadeJournal),
      eventState: structuredClone(this.eventState),branchVisited:new Set(this.#branchVisited),
      fieldReservation:structuredClone(this.fieldReservation),gauEnemyIds:structuredClone(this.gauEnemyIds),gauModeJournal:structuredClone(this.gauModeJournal),
      effectState:this.#effects.map(e=>({...e,projection:structuredClone(e.projection),targets:[...e.targets]})),effectNextTicket:this.#effectNextTicket,effectJournal:structuredClone(this.#effectJournal),
      messagePresentation: this.#messagePresentation, messageRootStarted: this.#messageRootStarted, messageJournal: structuredClone(this.#messageJournal),
      eventControls: { ...this.eventControls },
      eventUI: { ...this.eventUI },
      playerControlMode: this.currentPlayerControlMode,
      eventShared: this.eventShared?.snapshot() ?? null,
      poison: structuredClone(this.poisonStates),
      slow: structuredClone(this.slowStates),
      control: structuredClone(this.controlStates),
      controlTargets: new Map([...this.controlTargetUnits].map(([id, targets]) => [id, new Map(targets)])),
      stock: structuredClone(this.stock),
      consumedItems: structuredClone(this.consumedItems),retainedLoot:this.retainedLoot.snapshot(),forcedSaveTerminal:this.forcedSaveTerminal,forceSaveRequested:this.forceSaveRequested,
      observedAbilityIds: [...this.observedAbilityIds],
      dropRegistrations: [...this.dropRegistrations],
      dropDead: new Set(this.dropDead),
      enemyExits: structuredClone(this.enemyExits),
      rewardRegisteredInstances: new Set(this.rewardRegisteredInstances),
      events: [...this.events],
      time: this.time,
      random: this.randomState,
      phase: this.phase,
      reward: this.reward,
      clockInput: { ...this.clockInput }, preferences: { ...this.currentPreferences }, remainder: this.remainder,
      escapeRequested: this.escapeRequested, forceReturnRequested: this.forceReturnRequested,
    };
    this.validateMessageOwnership();this.validateFadeOwnership();
    const frame = this.#messageHost?.owner.prepareFrame() ?? null;
    this.#messageBusy = true;
    this.#messageFrame = frame; this.#messageFrameValidations = []; this.#messageFrameEffects = null;
    this.#effectPendingCommits=[];this.#effectPendingDiscards=[];this.#branchFrameVisited=[];
    const completedResources:BattleEffectResourceLease[]=[];
    try {
      this.#fadeFrame=this.#fadeHost?.owner.prepareFrame()??null;
      this.#fadeFrame?.state.advance(.01);frame?.state.advance(.01);
      this.reconcileAppearances();
      this.step();
      this.reconcileAppearances();
      const ownedWrite=this.#gauFrame?.prepareCommit();ownedWrite?.validate();
      const fadeWrite=this.#fadeFrame?.prepareCommit();fadeWrite?.validate();
      const messageWrite = frame?.prepareCommit(), effects = this.#messageFrameEffects === null ? null :
        this.observeMessageProvider(() => this.#messageHost!.prepareEffects(this.#messageFrameEffects!));
      for (const validate of this.#messageFrameValidations) validate();
      if (this.#messageFrameEffects !== null && (!effects || typeof effects.validate !== "function" || typeof effects.commit !== "function"))
        throw new Error("Invalid battle source-message effects transaction");
      if (effects) this.observeMessageProvider(effects.validate);
      messageWrite?.validate();
      for(const e of this.#effects)this.observeMessageProvider(()=>e.resource.validate());
      if(this.#gauTask?.resource)this.observeMessageProvider(()=>this.#gauTask!.resource!.validate());
      ownedWrite?.validate();
      for(const resource of this.#effectPendingCommits)this.observeMessageProvider(()=>resource.commit());
      // All external resource callbacks have returned. Validate every current
      // dependency before any deterministic Field-mask/Msg/Fade/owned write.
      for(const validate of this.#messageFrameValidations)validate();
      for(const e of this.#effects)this.observeMessageProvider(()=>e.resource.validate());
      if(this.#gauTask?.resource)this.observeMessageProvider(()=>this.#gauTask!.resource!.validate());
      if(effects)this.observeMessageProvider(effects.validate);
      // The presentation already describes the staged window; use the actual
      // prepared owner's revision/reservation rather than comparing old pixels.
      this.validateFadeOwnership();messageWrite?.validate();fadeWrite?.validate();ownedWrite?.validate();
      effects?.commit();messageWrite?.commit();fadeWrite?.commit();ownedWrite?.commit();this.#fadeRevision=this.#fadeHost?.owner.mutationRevision??0;
      for(const pc of this.#branchFrameVisited)this.#branchVisited.add(pc);
      // Publication ends here. Cleanup must never enter the rollback handler
      // after the shared source-message frame has committed.
      completedResources.push(...this.#effectPendingDiscards);
    } catch (error) {
      this.#gauTask=before.gauTask;this.#gauJournal=before.gauJournal;this.#fadeJournal=before.fadeJournal;
      this.#effects=before.effectState;this.#effectNextTicket=before.effectNextTicket;this.#effectJournal=before.effectJournal;
      this.#messagePresentation = before.messagePresentation; this.#messageRootStarted = before.messageRootStarted; this.#messageJournal = before.messageJournal;
      this.#conditionJournal = before.conditionJournal;
      this.combatants.splice(0, this.combatants.length, ...before.unitOwners);
      for (const [index, unit] of before.units.entries())
        Object.assign(this.combatants[index]!, unit);
      this.participantState = before.participantState;
      this.currentEnemyPartyId = before.currentEnemyPartyId;
      this.currentEnemySlots = before.currentEnemySlots;
      this.hiddenEnemyIds = before.hiddenEnemyIds;
      this.playerState = before.playerState;
      this.playerResources = before.playerResources;
      this.playerObservations = before.playerObservations;
      this.inventoryQualification = before.inventoryQualification;
      this.costOwners.clear(); before.costOwners.forEach((value, key) => this.costOwners.set(key, value));
      this.unresolvedCostOwners.clear(); before.unresolvedCostOwners.forEach(key => this.unresolvedCostOwners.add(key));
      this.equipmentAbilities.clear(); before.equipmentAbilities.forEach((value, key) => this.equipmentAbilities.set(key, value));
      this.action = before.action;
      this.#nextActionTicket=before.nextActionTicket;this.#fixedPlayerActions=before.fixedPlayerActions;this.#actionCancellations=before.actionCancellations;
      this.queue = before.queue;
      this.reactions = before.reactions;
      this.enemyExits = before.enemyExits;
      this.rewardRegisteredInstances = before.rewardRegisteredInstances;
      this.aiStates = before.ai;
      this.eventState = before.eventState;this.#branchVisited=before.branchVisited;
      if(this.lifecycle.kind==='battle-lifecycle-v2'&&error instanceof BattleEventError)this.#branchLastFailure={
        pc:error.pc,reason:error.reason,raw:structuredClone(this.lifecycle.program.branchExecution!.sourceProgram.Mnemonics[error.pc]),
        attemptedTime:before.time+10,attemptedVisited:[...this.#branchFrameVisited,...error.attemptedVisited]};
      this.fieldReservation=before.fieldReservation;this.gauEnemyIds=before.gauEnemyIds;this.gauModeJournal=before.gauModeJournal;
      this.eventControls = before.eventControls;
      this.eventUI = before.eventUI;
      this.currentPlayerControlMode = before.playerControlMode;
      if (this.eventShared && before.eventShared) this.eventShared.restore(before.eventShared);
      this.poisonStates = before.poison;
      this.slowStates = before.slow;
      this.controlStates = before.control;
      this.controlTargetUnits = before.controlTargets;
      this.stock = before.stock;
      this.consumedItems = before.consumedItems;this.retainedLoot.restore(before.retainedLoot);this.forcedSaveTerminal=before.forcedSaveTerminal;this.forceSaveRequested=before.forceSaveRequested;
      this.observedAbilityIds = before.observedAbilityIds;
      this.dropRegistrations = before.dropRegistrations;
      this.dropDead = before.dropDead;
      this.events.splice(0, this.events.length, ...before.events);
      this.time = before.time;
      this.randomState = before.random;
      this.phase = before.phase;
      this.reward = before.reward;
      this.clockInput = before.clockInput; this.currentPreferences = before.preferences; this.remainder = before.remainder;
      this.escapeRequested = before.escapeRequested; this.forceReturnRequested = before.forceReturnRequested;
      // A lease may have published before another host failed. Revoke every
      // candidate after restoring owners; a throwing discard cannot interrupt
      // rollback or replace the original publication error.
      this.discardBattleFrame('message',frame);this.discardBattleFrame('fade',this.#fadeFrame);this.discardBattleFrame('owned',this.#gauFrame);
      this.discardBattleEffectResources(this.#effectPendingCommits,'rollback');
      throw error;
    } finally {
      this.#gauFrame=null;this.#fadeFrame=null;this.#messageFrame = null; this.#messageFrameValidations = []; this.#messageFrameEffects = null;this.#effectPendingCommits=[];this.#effectPendingDiscards=[];this.#branchFrameVisited=[];
      // Retain the reentrancy guard during external cleanup, but keep cleanup
      // outside the catch that can restore this already published frame.
      this.discardBattleEffectResources(completedResources,'complete');
      this.#messageBusy = false;
    }
  }
  private step() {
    const gate = this.clockGate();
    if (!gate.simulation) return;
    this.time += 10;
    this.advanceBattleEffects();
    if(this.#gauTask&&this.#gauTask.phase!=="complete"){
      this.advanceGauTask();this.checkOutcome();return;
    }
    if ((this.forceReturnRequested||this.forceSaveRequested) && this.eventControls.endEnabled) { this.checkOutcome(); return; }
    if (this.escapeRequested && !this.action) {
      // Existing lethal results outrank retreat; a request cannot avoid defeat
      // or turn a completed victory into a reward-free exit.
      // The event clock remains live when a script pauses progress. In
      // particular its later unpause/end permission must be able to run.
      this.checkOutcome();
      if (this.phase === "active" && this.eventControls.endEnabled && this.clockGate().progress) this.finishEscape();
      return;
    }
    // The presentation remains a development profile. FF6 progress clocks run
    // after the executor update even while this action is on screen.
    const presenting = this.action !== null;
    if (this.action) {
      this.action.elapsed += 10;
      if (!this.action.resolved && this.action.elapsed >= 400)
        this.resolve(this.action);
      if (this.action.elapsed >= 900) {
        this.releaseStagedAction('completed');
      }
    }
    if (gate.conditions) this.advanceConditions(0.01);
    if (gate.progress) {
      for (const pending of this.queue)
        pending.charge = advanceChanting(
          pending.charge,
          0.01,
          this.atbSpeed,
        );
      for (const c of this.combatants) {
        if (c.hp <= 0 || c.queued || this.enemyExits.has(c.id) || this.actionSuspended(c)) continue;
        if (c.atb < 100)
          c.atb = Math.fround(
            c.atb +
              atbIncrement(this.content.atb, {
                agility: c.agility,
                weight: c.weight,
                enemy: c.side === "enemy",
                speedPercent: this.conditions.speedPercent(c.conditionIds),
                battleSpeed: this.atbSpeed,
                seconds: 0.01,
              }),
          );
        if (!this.escapeRequested && c.side === "player" && c.atb >= 100 && this.hasAutomaticControl(c))
          this.decideControlledPlayer(c);
        if (!this.actionSuspended(c) && !this.escapeRequested && !this.eventControls.enemyNoAct && c.side === "enemy" && c.atb >= 100 &&
            this.aiStates.get(c.id)?.status === "waiting") {
          if (!this.players.some((p) => p.hp > 0)) break;
          this.decideEnemyAction(c);
        }
      }
    }
    if (presenting) {
      // BattleMainUpdate 0x1588930 performs end judgment after Progress.Update,
      // including the frame on which execution finishes.
      this.checkOutcome();
      if (this.escapeRequested && this.clockGate().progress && this.phase === "active" && !this.action &&
          this.eventControls.endEnabled) this.finishEscape();
      return;
    }
    const eligible = (a: BattleAction) => a.charge <= 0 &&
      (a.kind === "event" || !this.actionSuspended(this.combatants.find(unit => unit.id === a.actor)!));
    const reactionIndex = this.reactions.findIndex(eligible);
    // Explicit web-source-control-actions-v1 scheduler rule, not inferred
    // native priority parity: only already-ready interrupts whose known live
    // function owner is suspended may yield to another ordinary actor. Unknown
    // owners/charges and legacy content retain the strict interrupt boundary.
    const suspendedInterrupts = this.controlPolicy !== null && this.reactions.length > 0 &&
      this.reactions.every(a => a.kind !== "event" && a.charge <= 0 &&
        this.actionSuspended(this.combatants.find(unit => unit.id === a.actor)!));
    const queue = this.reactions.length && !suspendedInterrupts ? this.reactions : this.queue;
    // SetBattleUpdateEnabled does not cancel staged or interrupt actions. Its
    // executor gate only prevents a new ordinary action from starting.
    const index = queue === this.reactions ? reactionIndex : !this.eventControls.updateEnabled ? -1 : queue.findIndex(eligible);
    if (index >= 0) {
      const action = queue.splice(index, 1)[0]!,
        actor = this.combatants.find((c) => c.id === action.actor)!;
      if (!this.canUseAction(action)) {
        this.finishActorAction(actor, action.kind);
        this.log(`${actor.name} 的行动已失效。`);
        this.checkOutcome();
        return;
      }
      const choice = resolveBattleTargets(
        action.selection,
        this.actionTargetChoices(action),
        this.combatants,
        (min, max) => this.randomInt(min, max),
      );
      if (!choice) {
        this.finishActorAction(actor, action.kind);
        this.checkOutcome();
        return;
      }
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      if (this.content.observedLearning) {
        action.learningAbilityIds = action.source.kind === "item" ? [] : observeLearningAction(
          this.content.observedLearning,
          { id: action.source.id, typeId: this.content.abilities[action.source.id]!.program.rules.type_id! },
          this.players.map((player) => ({ sourceId: player.sourceId,
            conditionTypes: this.conditions.types(player.conditionIds),
            abilities: player.ownedAbilities?.abilities ?? null })),
        );
      }
      if (this.playerBorrow) action.learningByOwner = this.players.map(player => ({
        ownedId: this.playerOwnedId(player.id),
        // Source observation is decided once by the current first source8.
        // Each present owner captures that log; result ownership filters it.
        abilityIds: action.source.kind === "item" ? [] : this.content.observedLearning
          ? [...action.learningAbilityIds!] : [action.source.id],
      }));
      this.action = action;
      const actionName = this.actionDefinition(action).name;
      this.log(actionName ? `${actor.name} · ${actionName}` : `${actor.name} 行动。`);
    }
    this.checkOutcome();
  }
  private advanceConditions(seconds: number) {
    // Prepare all actors before publishing any HP, lifetime, queue or log change.
    const staged = this.activeCombatants.map((actor) => {
      const result = this.conditions.advancePoison({
        conditionIds: actor.conditionIds,
        state: this.poisonStates.get(actor.id)!,
        hp: actor.hp,
        maxHp: actor.maxHp,
        elementResistances: actor.elementResistances,
        seconds,
        atbSpeed: this.atbSpeed,
        // Per-instance Stop writes are retained on the actual Poison clocks.
        // The old explicit caller input is not inferred from condition types.
        isTimeStopped: false,
      });
      let life = result.ticks.length
        ? this.conditions.settleLife(
            result.hp,
            this.conditions.updateDying(
              result.hp,
              actor.maxHp,
              actor.conditionIds,
            ),
            this.conditions.isUnableFight(actor.conditionIds),
          )
        : { hp: actor.hp, conditionIds: [...actor.conditionIds] };
      const control = this.prepareControlAdvance(actor, life.conditionIds, life.hp, seconds);
      if (control.hp !== life.hp || canonical(control.conditionIds) !== canonical(life.conditionIds))
        life = this.conditions.settleLife(control.hp,
          this.conditions.updateDying(control.hp, actor.maxHp, control.conditionIds),
          this.conditions.isUnableFight(life.conditionIds));
      const finalControl = this.prepareControlState(actor, life.conditionIds, control.control.state, control.control.targets, null);
      const stop = this.prepareStopTransition(actor, life.conditionIds, this.conditions.reconcilePoisonState(
        life.conditionIds,
        result.state,
        this.atbSpeed,
      ), control.removedIds);
      const state = stop.state;
      const slow = this.conditions.reconcileSlowState(life.conditionIds,
        this.conditions.advanceSlow(actor.conditionIds, this.slowStates.get(actor.id)!, seconds));
      return { actor, life, state, slow, control: finalControl, stopRemoved: stop.removed,
        removedIds: control.removedIds, ticks: result.ticks };
    });
    for (const { actor, life, state, slow, control, stopRemoved, removedIds, ticks } of staged) {
      const died = actor.hp > 0 && life.hp === 0;
      Object.assign(actor, life);
      this.observeDropLife(actor);
      this.poisonStates.set(actor.id, state);
      this.slowStates.set(actor.id, slow);
      this.controlStates.set(actor.id, control.state); this.controlTargetUnits.set(actor.id, control.targets);
      if (stopRemoved) actor.atb = 0;
      if (removedIds.some(id => this.content.conditions.behaviors.find(behavior => behavior.id === id)?.kind === "sleep"))
        for (const action of this.queue) if (action.actor === actor.id) action.charge = 0;
      if (died) {
        actor.atb = 0;
        actor.queued = false;
        this.queue = this.queue.filter((action) => action.actor !== actor.id);
        this.reactions = this.reactions.filter(
          (action) => action.actor !== actor.id,
        );
      }
      for (const tick of ticks)
        this.log(
          tick.recovery
            ? `${actor.name} 因中毒属性吸收恢复 ${tick.amount} HP。`
            : `${actor.name} 因中毒受到 ${tick.amount} 点伤害。`,
        );
      if (died) this.log(`${actor.name} 倒下了。`);
    }
  }
  /** CounterAct supplies the attacker explicitly, even for friendly fire. Its
   * target is not selected through the player's menu or the normal enemy AI.
   * This profile admits living single-target ranges 3/7 only. Existing fallback
   * keeps the selected faction if that attacker dies before the counter starts. */
  private counterTargetChoices(units: readonly Combatant[]): TargetChoice[] {
    return units
      .filter((c) => c.hp > 0)
      .map((c) => ({
        selection: { kind: "single" as const, id: c.id },
        targetIds: [c.id],
      }));
  }
  private actionTargetChoices(action: BattleAction) {
    if(action.kind==="event")return this.scriptedTargetChoices(action);
    if (action.targeting !== undefined && (action.kind !== "counter" ||
        action.targeting !== "received-actor" && action.targeting !== "automatic"))
      throw new Error("Invalid interrupt target provider");
    if (action.control) {
      const actor = this.combatants.find(unit => unit.id === action.actor), ability = this.content.abilities[action.source.id];
      if (!actor || action.source.kind !== "ability" || !ability?.plan || !this.canUseAction(action)) return [];
      return webControlTargetChoices({ id: ability.id, range: ability.program.range, rule: ability.plan.targeting },
        actor, this.activeCombatants, this.content.formation, action.selection.kind);
    }
    if (action.kind === "counter" && action.targeting !== "automatic")
      return this.counterTargetChoices(this.activeCombatants);
    if (action.source.kind === "item") return this.itemTargetChoices(action.actor, action.source.id);
    const actor = this.combatants.find(unit => unit.id === action.actor),
      ability = this.content.abilities[action.source.id];
    if (actor?.side !== "enemy") return this.targetChoices(action.actor, action.source.id);
    if (!ability?.plan || !this.qualifiedAbility(actor, ability.id)) return [];
    // Automatic decisions preserve native target type, independently of menu
    // modes. Resolve their captured single/side/all intent against the current
    // roster at both staging and effect execution; never redirect a retired
    // instance to a newly added unit that happens to occupy its old slot.
    const mode = action.selection.kind;
    return battleTargetChoices({ ...ability.plan.targeting, modes: [mode], defaultMode: mode },
      actor, this.activeCombatants, this.content.formation);
  }
  private planReactions(
    action: BattleAction,
    units: readonly Combatant[],
    results: readonly { target: string; effects: AbilityEffectResult[] }[],
  ) {
    const ability = this.actionDefinition(action);
    const updates: { actor: string; turn: BattleAITurn }[] = [];
    const decisions: BattleAction[] = [];
    for (const result of results) {
      const actor = units.find((c) => c.id === result.target)!;
      if (actor.side !== "enemy") continue;
      if (this.enemyExits.has(actor.id) || this.conditions.isEscaped(actor.conditionIds) || this.actionSuspended(actor)) continue;
      if (this.aiStates.get(actor.id)?.status !== "waiting") continue;
      if (action.source.kind === "item")
        throw new Error("Unimplemented enemy item reaction");
      const reaction = battleReaction(this.content.reactions, {
        actor: action.actor,
        target: actor.id,
        isCounter: action.kind === "counter",
        abilityId: action.source.id,
        systemId: ability.program.rules.system_id!,
        primarySlot: ability.program.functions[0]?.slot ?? -1,
        effects: result.effects,
      });
      if (!reaction) continue;
      const receivedTypeId = this.content.abilities[action.source.id]!.program.rules.type_id;
      const turn = planBattleAIReaction(
        actor.ai!,
        this.aiStates.get(actor.id)!,
        this.aiContext(actor, units),
        { ...reaction, ...(receivedTypeId === undefined ? {} : { receivedAbilityTypeId: receivedTypeId }) },
      );
      this.admitAITurn(actor, turn);
      for (const act of turn.acts) {
        for (const id of selectBattleAIAbilities(act, {
          integer: (min, max) => this.randomInt(min, max),
          float: (min, max) =>
            Math.fround(min + this.randomUnit() * (max - min)),
        })) {
          const requestedTargeting = act.kind === "counter-act" ? act.targeting ?? "received-actor" : null;
          if (requestedTargeting === null) throw new Error("Reaction emitted a noninterrupt action");
          const ability = this.content.abilities[id]!;
          const targeting = sourceCounterTargeting(ability.program.range, requestedTargeting);
          const active = units.filter(unit => !this.enemyExits.has(unit.id) &&
            !this.conditions.isEscaped(unit.conditionIds));
          const choice = targeting === "automatic"
            ? planBattleAITarget({ actor, units: active,
                eligiblePlayers: active.filter(unit => unit.side === "player" && unit.hp > 0),
                range: ability.program.range, rule: ability.plan!.targeting,
                formation: this.content.formation,
                ...(this.controlTargetPolicy(ability) ? { controlPolicy: this.controlPolicy! } : {}),
              }, (min, max) => this.randomInt(min, max))
            : this.counterTargetChoices(active).find((c) => c.targetIds[0] === action.actor);
          if (!choice)
            throw new BattleAIError(
              actor.ai!.source,
              act.pc,
              `no admitted counter target for ability ${id}`,
            );
          decisions.push(
            this.createAction(
              actor,
              this.content.abilities[id]!,
              choice,
              null,
              "counter",
              targeting === "automatic" ? targeting : undefined,
            ),
          );
        }
      }
      updates.push({ actor: actor.id, turn });
    }
    return { updates, decisions };
  }
  /** Parent calculations and child queue proposals stay private until every
   * target, receiver, condition and dependency of the action has admitted. */
  private projectDerivedAction(action: BattleAction, actor: Combatant, choice: TargetChoice,
    children: BattleAction[], payment: number): ReturnType<typeof projectActionTargets> {
    const ability = this.actionDefinition(action), effect = ability.plan!.effects[0]!;
    if (actor.side !== "enemy" || ability.plan!.effects.length !== 1 || payment !== 0)
      throw new Error("Unresolved derived-action actor/composition/payment");
    if (effect.kind === "forced-escape") {
      proposeForcedEscape(effect, { actorId: actor.id, actorSide: actor.side, targetIds: choice.targetIds });
      if (effect.conditionId !== this.conditions.escapeConditionId)
        throw new Error("Escape condition identity differs from the source catalog");
      const change = this.conditions.forceEnemyEscape(actor.conditionIds);
      if (!change.currentIds.includes(effect.conditionId)) throw new Error("Escape condition conflict did not admit departure");
      return { targets: [{ targetId: actor.id,
        state: { hp: actor.hp, mp: actor.mp, conditionIds: change.currentIds },
        effects: [{ slot: effect.slot, resource: "condition", recovery: false,
          added: change.added, removed: change.removed, missed: false }] }],
        userConditionIds: [...actor.conditionIds], userResults: [] };
    }
    if (effect.kind !== "random-ability") throw new Error("Invalid derived-action plan");
    const ready = this.randomChildReadiness(actor, effect, choice);
    const selected = proposeRandomAbilityDispatch(effect, ready, (min, max) => this.randomInt(min, max)),
      child = this.content.abilities[selected.abilityId]!,
      target = this.derivedChildTarget(actor, effect, child, choice);
    children.push(this.createAction(actor, child, target, null, "derived"));
    return { targets: choice.targetIds.map(targetId => {
      const unit = this.combatants.find(candidate => candidate.id === targetId)!;
      return { targetId, state: { hp: unit.hp, mp: unit.mp, conditionIds: [...unit.conditionIds] },
        effects: [{ slot: effect.slot, resource: "hp" as const, recovery: false, amount: 0, missed: false }] };
    }), userConditionIds: [...actor.conditionIds], userResults: [] };
  }
  private randomChildReadiness(actor: Combatant, effect: RandomAbilityDispatchPlan, parent: TargetChoice): number[] {
    const ids = [...new Set(effect.rows.map(row => row.abilityId))];
    for (const id of ids) {
      const ability = this.content.abilities[id];
      if (!ability?.plan || !actor.abilities.includes(id) || !this.canUse(actor.id, id, null) ||
          ability.cost !== 0 || ability.plan.effects.some(part => part.kind === "random-ability") ||
          ability.plan.effects.some(part => part.kind === "physical") && !actor.physical)
        throw new Error(`Unresolved random-ability child ${id}`);
      this.derivedChildTarget(actor, effect, ability, parent);
    }
    return ids;
  }
  private derivedChildTarget(actor: Combatant, effect: RandomAbilityDispatchPlan,
    child: AbilityDefinition, parent: TargetChoice): TargetChoice {
    if (!child.plan || parent.selection.kind !== "single" || parent.targetIds.length !== 1)
      throw new Error("Unresolved derived child parent target scope");
    const blocker = battleAITargetBlocker(child.program.range, child.plan.targeting, "normal", this.content.formation, this.controlTargetPolicy(child));
    if (blocker) throw new Error(blocker);
    const selection = effect.retarget && child.program.range === 5
      ? { kind: "single" as const, id: actor.id } : parent.selection;
    if (effect.retarget && ![3, 5, 7].includes(child.program.range))
      throw new Error("Unresolved derived default target provider");
    const choice = battleTargetChoices(child.plan.targeting, actor, this.activeCombatants, this.content.formation)
      .find(candidate => sameTargetSelection(candidate.selection, selection));
    if (!choice) throw new Error("Derived child target is not currently eligible");
    return choice;
  }
  private absorptionContext(actor:Combatant,ability:Pick<AbilityDefinition,"plan">,targetIds:readonly string[]):AbsorptionContext|undefined {
    if(!ability.plan||!resourceAbsorptionEffect(ability.plan))return undefined;
    if(targetIds.length!==1)throw Error('Unresolved source absorption multi-target phase');
    const target=this.combatants.find(unit=>unit.id===targetIds[0]);
    if(!target||this.conditionUndead(actor,actor.conditionIds)||this.conditionUndead(target,target.conditionIds))
      throw Error('Unresolved source absorption reverse-recovery context');
    return {kind:'source-non-reversing-absorption-v1',actorId:actor.id,targetId:target.id};
  }
  private resolve(action: BattleAction) {
    // Stale presentation/executor completions cannot revive a cancelled action
    // or a retired battle. No RNG, cost, lookup or effect precedes this fence.
    if(this.phase!=='active'||this.#messageRetired||this.#effectRetired||this.action!==action)return;
    const actor = this.combatants.find((c) => c.id === action.actor)!;
    const ability = this.actionDefinition(action);
    if (action.resolved) return;
    if(action.source.kind==='ability')validateOrdinaryConditionAction(this.content.abilities[action.source.id]!);
    if (!ability.plan) throw new Error("Unimplemented ability cannot execute");
    if (ability.plan.effects.some(effect => effect.kind === "non-damaging")) {
      if (!("nonDamagingPresentation" in ability) || !ability.nonDamagingPresentation || ability.presentation !== "source-effect-deferred")
        throw new Error("Missing source non-damaging presentation policy");
      validateNonDamagingPresentation(ability.nonDamagingPresentation);
    }
    if (!this.canUseAction(action)) {
      action.resolved = true;
      return;
    }
    const cost = action.source.kind === "item" ? 0 : this.abilityCost(actor.id, action.source.id)!.mp;
    // IsUsableAbility checks MP for players only. UseMp still charges enemies,
    // clamping the resulting resource at zero instead of cancelling their act.
    const payment = Math.min(actor.mp, cost);
    const randomBefore = this.randomState;
    try {
      const choice = resolveBattleTargets(
        action.selection,
        this.actionTargetChoices(action),
        this.combatants,
        (min, max) => this.randomInt(min, max),
      );
      if (!choice) {
        action.targetIds = [];
        action.resolved = true;
        return;
      }
      const derived: BattleAction[] = [];
      const first = ability.plan.effects[0];
      const projection = first?.kind === "random-ability" || first?.kind === "forced-escape"
        ? this.projectDerivedAction(action, actor, choice, derived, payment)
        : projectActionTargets(
          ability.plan!,
          ability.power,
          actor,
          choice.targetIds.map(id => this.combatants.find(c => c.id === id)!),
          this.conditions,
          (min, max) => this.randomInt(min, max),
          payment,
          ability.plan!.effects.some((effect) => effect.kind === "physical")
            ? action.source.kind === "ability" ? target => this.physicalRows(actor, action.source.id, target)
              : (() => { throw new Error("Physical item row providers are unavailable"); })()
            : undefined,
          action.source.kind === "ability" ? action.source.id : undefined,
          this.absorptionContext(actor,ability,choice.targetIds),
        );
      const staged = projection.targets.map(({ targetId, state, effects }) => {
        const target = this.combatants.find(c => c.id === targetId)!;
        const messages: string[] = [];
        for (const effect of effects) {
          if (effect.resource === "none") {
            continue;
          } else if (effect.resource === "row") {
            messages.push(`${target.name} 移到${effect.after === "front" ? "前排" : "后排"}。`);
          } else if (effect.missed) {
            messages.push(
              effect.resource === "condition"
                ? `${target.name} 的状态未改变。`
                : effect.recovery
                  ? `${target.name} 的恢复未生效。`
                  : `${target.name} 闪避了攻击。`,
            );
          } else if (effect.resource !== "condition" && effect.nullified) {
            messages.push(`${target.name} · 无效。`);
          } else if (effect.resource === "condition") {
            for (const id of effect.added)
              if (this.conditions.name(id)) messages.push(`${target.name} 获得${this.conditions.name(id)}状态。`);
            for (const id of effect.removed)
              if (this.conditions.name(id)) messages.push(
                `${target.name} 的${this.conditions.name(id)}已解除。`,
              );
          } else {
            const resource = effect.resource;
            messages.push(
              effect.recovery
                ? `${target.name} 恢复 ${effect.amount} ${resource.toUpperCase()}。`
                : `${target.name} 受到 ${effect.amount} 点伤害。`,
            );
          }
        }
        if (target.hp > 0 && state.hp === 0)
          messages.push(`${target.name} 倒下了。`);
        else if (target.hp === 0 && state.hp > 0)
          messages.push(`${target.name} 重新加入战斗。`);
        return { target, state, effects, messages };
      });
      // AI must see the completed action's HP/MP/conditions, including its cost,
      // but cannot mutate the live battle until EVERY target and reaction admits.
      const projected = this.combatants.map((c) => ({
        ...c,
        mp: c.mp - (c === actor ? payment : 0),
        ...staged.find((entry) => entry.target.id === c.id)?.state,
        ...(c===actor&&projection.userResourceState?projection.userResourceState:{}),
        ...(c === actor && projection.userResults.length ? { conditionIds: projection.userConditionIds } : {}),
      }));
      const results = staged.map((entry) => ({
        target: entry.target.id,
        effects: entry.effects,
      }));
      const userMessages: string[] = [];
      for(const result of projection.userResourceResults??[])if(!result.missed&&!result.nullified&&result.amount>0)
        userMessages.push(`${actor.name} 恢复 ${result.amount} ${result.resource.toUpperCase()}。`);
      for (const result of projection.userResults) {
        for (const id of result.added)
          if (this.conditions.name(id)) userMessages.push(`${actor.name} 获得${this.conditions.name(id)}状态。`);
        for (const id of result.removed)
          if (this.conditions.name(id)) userMessages.push(`${actor.name} 的${this.conditions.name(id)}已解除。`);
      }
      const changedIds = [...new Set([...staged.map(entry => entry.target.id),
        ...(projection.userResults.length||projection.userResourceState ? [actor.id] : [])])];
      const poison = changedIds.map(id => {
        const unit = projected.find(c => c.id === id)!;
        const targetEntry = staged.find(entry => entry.target.id === id);
        const removed = (targetEntry?.effects ?? []).flatMap((effect) =>
          effect.resource === "condition" ? effect.removed : [],
        );
        removed.push(...projection.userResults.filter(result => result.ownerId === id).flatMap(result => result.removed));
        let control = this.prepareControlState(this.combatants.find(current => current.id === id)!, unit.conditionIds,
          this.controlStates.get(id)!, this.controlTargetUnits.get(id)!, actor, removed);
        if (targetEntry) {
          const hit = this.prepareControlHit(targetEntry.target, unit.conditionIds, control, action, ability, targetEntry.effects, projected);
          unit.conditionIds = hit.conditionIds; targetEntry.state.conditionIds = [...hit.conditionIds]; control = hit.control;
          removed.push(...hit.removedIds);
        }
        const previous = this.poisonStates
          .get(id)!
          .filter((clock) => !removed.includes(clock.conditionId));
        const stop = this.prepareStopTransition(this.combatants.find(current => current.id === id)!, unit.conditionIds,
          this.conditions.reconcilePoisonState(unit.conditionIds, previous, this.atbSpeed), removed);
        return {
          id,
          state: stop.state, stopStarted: stop.started, stopRemoved: stop.removed,
          slow: this.conditions.reconcileSlowState(unit.conditionIds,
            this.slowStates.get(id)!.filter((clock) => !removed.includes(clock.conditionId))),
          control,
        };
      });
      const reactions = this.planReactions(action, projected, results);
      const controlStarts = new Set<string>(), sleepResets = new Set<string>();
      for (const entry of staged) {
        const added = entry.effects.flatMap(effect => effect.resource === "condition" ? effect.added : []);
        const starts = this.conditions.controlBehaviors(added);
        if (starts.some(behavior => behavior.kind === "sleep" || behavior.kind === "confusion" || behavior.kind === "temptation")) {
          controlStarts.add(entry.target.id);
          if (starts.some(behavior => behavior.kind === "sleep") &&
              (entry.target.queued || this.queue.some(pending => pending.actor === entry.target.id) ||
                this.action?.actor === entry.target.id && ["normal", "loop"].includes(this.action.kind))) sleepResets.add(entry.target.id);
        }
      }
      // Stop.Start calls RemoveActReady only when this same unit has actual
      // ordinary chanting/normal-stack work. A bare partial/full gauge or a
      // lone interrupt is not proof of readiness and is not cleared here.
      const {owners:stopReady,actions:stopCancelled}=this.prepareStopReadyCancellation(
        poison.filter(next=>next.stopStarted).map(next=>next.id));
      const keepsControl = (pending: BattleAction) => !pending.control || projected.some(unit => unit.id === pending.actor &&
        this.conditions.controlBehaviors(unit.conditionIds).some(behavior => behavior.id === pending.control!.conditionId && behavior.kind === pending.control!.kind));
      const nextQueue = this.queue.filter(pending => !controlStarts.has(pending.actor) && !stopReady.has(pending.actor) && keepsControl(pending));
      const nextReactions = this.reactions.filter(pending => !controlStarts.has(pending.actor) && !stopReady.has(pending.actor) && keepsControl(pending));
      const cancelledControlOwners = new Set(this.queue.filter(pending => pending.control && !nextQueue.includes(pending))
        .map(pending => pending.actor));
      // One transaction includes effects, enemy parameters, AI PCs, both queues,
      // result/log publication and the owned random stream.
      if (action.source.kind === "item") {
        this.stock.find((i) => i.id === action.source.id)!.count--;
        const used = this.consumedItems.find((i) => i.id === action.source.id);
        if (used) used.count++;
        else this.consumedItems.push({ id: action.source.id, count: 1 });
      }
      if (this.playerBorrow) {
        if (!Array.isArray(action.learningByOwner)) throw new Error("Missing player action-start observations");
        for (const observation of action.learningByOwner) {
          const held = this.playerObservations.get(observation.ownedId);
          if (!held) throw new Error("Missing player learning owner");
          for (const id of observation.abilityIds) if (!held.includes(id)) held.push(id);
        }
        this.observedAbilityIds = [...new Set(firstEnteredOwnerIds(this.playerState!).flatMap(owner => this.playerObservations.get(owner)!))];
      } else if (this.content.observedLearning) {
        if (!Array.isArray(action.learningAbilityIds)) throw new Error("Missing action-start learning observation");
        for (const id of action.learningAbilityIds)
          if (!this.observedAbilityIds.includes(id)) this.observedAbilityIds.push(id);
      } else if (action.source.kind === "ability" && !this.observedAbilityIds.includes(action.source.id)) {
        // Catalog-less synthetic/development callers retain the conservative
        // log; growth still rejects matching observations without a provider.
        this.observedAbilityIds.push(action.source.id);
      }
      actor.mp -= payment;
      if(projection.userResourceState)Object.assign(actor,projection.userResourceState);
      this.queue = nextQueue; this.reactions = nextReactions;
      for (const pending of stopCancelled) {
        const owner = this.combatants.find(unit => unit.id === pending.actor)!;
        if (owner.side === "player" && this.#fixedPlayerActions.get(owner.sourceId) === pending.executionTicket)
          this.#fixedPlayerActions.delete(owner.sourceId);
      }
      for (const unit of this.combatants) {
        if (controlStarts.has(unit.id) || stopReady.has(unit.id) || cancelledControlOwners.has(unit.id) &&
            !nextQueue.some(pending => pending.actor === unit.id) && this.action?.actor !== unit.id) unit.queued = false;
        if (sleepResets.has(unit.id) || stopReady.has(unit.id) || poison.some(next => next.id === unit.id && next.stopRemoved)) unit.atb = 0;
      }
      if (projection.userResults.length) actor.conditionIds = [...projection.userConditionIds];
      for (const next of poison) {
        this.poisonStates.set(next.id, next.state);
        this.slowStates.set(next.id, next.slow);
        this.controlStates.set(next.id, next.control.state); this.controlTargetUnits.set(next.id, next.control.targets);
      }
      for (const entry of staged) {
        const lifeChanged = (entry.target.hp === 0) !== (entry.state.hp === 0);
        Object.assign(entry.target, entry.state);
        this.observeDropLife(entry.target);
        if (lifeChanged) {
          entry.target.atb = 0;
          entry.target.queued = false;
          this.queue = this.queue.filter((a) => a.actor !== entry.target.id);
          this.reactions = this.reactions.filter(
            (a) => a.actor !== entry.target.id,
          );
        }
        if (this.conditions.isEscaped(entry.target.conditionIds) && !this.enemyExits.has(entry.target.id)) {
          if (entry.target.side !== "enemy") throw new Error("Player escape needs its own admitted lifecycle");
          this.enemyExits.set(entry.target.id, { kind: "escaped", conditionId: this.conditions.escapeConditionId });
          entry.target.atb = 0;
          entry.target.queued = false;
          this.queue = this.queue.filter(pending => pending.actor !== entry.target.id);
          this.reactions = this.reactions.filter(pending => pending.actor !== entry.target.id);
        }
        for (const message of entry.messages) this.log(message);
      }
      for (const message of userMessages) this.log(message);
      for (const update of reactions.updates) {
        this.aiStates.set(update.actor, update.turn.state);
        this.combatants.find((c) => c.id === update.actor)!.behavior =
          update.turn.behavior;
      }
      // Function46 enqueues its child during HitCalc, before the parent's
      // completed result wakes receivers. Both preparations commit together.
      this.registerActions([...derived,...reactions.decisions]);this.reactions.push(...derived, ...reactions.decisions);
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      action.results = results;
      if (projection.userResults.length) action.userConditionResults = structuredClone(projection.userResults);
      if(projection.userResourceResults)action.userResourceResults=structuredClone(projection.userResourceResults);
      action.resolved = true;
    } catch (error) {
      this.randomState = randomBefore;
      throw error;
    }
  }

  private checkOutcome() {
    if (this.phase !== "active") return;
    // Fixed Web ordering: action/progress, then event clock, then end judgment.
    // Native Integrator and battle updates are separate Unity components; their
    // relative frame order is not certified. The VM runs while progress waits.
    this.advanceEvent();
    if ((this.forceReturnRequested||this.forceSaveRequested) && this.eventControls.endEnabled) {
      // Native Forced=4 precedes ordinary death/victory judgment, even with
      // staged work. Keep that work suspended until the whole battle owner is
      // retired by the prepared handoff; this is not RemoveAllAct cancellation.
      this.forcedSaveTerminal=!this.forceReturnRequested&&this.forceSaveRequested;
      if(this.forcedSaveTerminal){
        if(!this.forcedSavePolicy)throw new Error('Missing explicit Web forced-save policy');
        for(const player of this.players)Object.assign(player,this.conditions.settleLife(player.hp,player.conditionIds,false));
        this.clearBattleConditions();
      }
      this.phase = "forced"; this.escapeRequested = false;
      this.log(this.forcedSaveTerminal?'战斗结束，保存当前状态并返回。':"战斗结束，返回进入战斗前的状态。"); return;
    }
    if (this.action || this.reactions[0]?.kind === "derived") return;
    for (const c of this.combatants) {
      Object.assign(c, this.conditions.settleLife(c.hp, c.conditionIds, false));
      this.observeDropLife(c);
      if (c.hp === 0) {
        c.atb = 0;
        c.queued = false;
        this.queue = this.queue.filter((a) => a.actor !== c.id);
        this.reactions = this.reactions.filter((a) => a.actor !== c.id);
      }
    }
    if (this.reactions.some(action=>action.kind==="event")) return;
    if (!this.eventControls.endEnabled) return;
    if (!this.players.some((c) => c.hp > 0)) {
      this.clearBattleConditions();
      this.phase = "defeat";
      this.escapeRequested = false;
      this.queue = [];
      this.reactions = [];
      this.log("队伍倒下了。");
      return;
    }
    // Normal source judgment uses !mainCore.IsReady for victory. Player defeat
    // above is independent of that flag and takes precedence in the same frame.
    if (this.eventState && this.eventState.status !== "exited") return;
    if (this.eventState && this.enemies.some((c) => c.hp > 0 && !this.enemyExits.has(c.id)))
      throw new Error("Battle event victory with live enemies requires an admitted result provider");
    if (this.enemies.some((c) => c.hp > 0 && !this.enemyExits.has(c.id))) return;
    // Missing growth for a later recipient must not leave an earlier recipient
    // upgraded, or publish a victory whose reward cannot be collected.
    const players = this.settlementPlayers().map((c) => ({
      ...structuredClone(c),
      conditionIds: this.conditions.battleEnd(c.conditionIds),
    }));
    const rewardState = { ...this.participantState, entries: this.participantState.entries.map(entry =>
      this.enemyExits.has(entry.id) && !this.rewardRegisteredInstances.has(entry.id)
        ? { ...entry, exp: 0, gil: 0 } : entry) };
    const { exp, gil } = projectBattleParticipantRewards(rewardState,
      this.participantContent?.rewardScope ?? "active-units");
    const recipients = players.filter((c) => c.hp > 0),
      each = Math.trunc(exp / Math.max(1, recipients.length));
    const levels: BattleReward["levels"] = [];
    for (const c of recipients) {
      const from = c.level;
      if (this.projectProgression) {
        Object.assign(c, this.progressionResult(c, each));
        c.hp = Math.min(c.hp, c.maxHp);
        c.mp = Math.min(c.mp, c.maxMp);
      } else {
        c.exp += each;
        const level =
          this.content.experience.filter((l) => l.exp <= c.exp).at(-1)?.level ??
          c.level;
        for (let next = c.level + 1; next <= level; next++) {
          const growth = this.content.growth[c.growthGroup!]?.find((g) => g.level === next);
          if (!growth) throw new Error("Missing level growth dependency");
          c.maxHp = Math.min(9999, c.maxHp + growth.hp);
          c.maxMp = Math.min(999, c.maxMp + growth.mp);
        }
        c.level = Math.max(c.level, level);
      }
      c.conditionIds = this.conditions.updateDying(
        c.hp,
        c.maxHp,
        c.conditionIds,
      );
      if (c.level !== from) levels.push({ id: c.id, from, to: c.level });
    }
    // Native nonrecipients still run observation learning, independently of
    // StatusUp. The owned provider preserves their existing growth exactly.
    if (this.projectProgression) for (const c of players.filter((p) => p.hp === 0))
      Object.assign(c, this.progressionResult(c, 0));
    const dropPlan = this.content.drops === null ? null : projectBattleDrops(this.content.drops,
      this.dropRegistrations, (min, max) => this.randomInt(min, max));
    if(dropPlan)this.retainedLoot.record('drops',dropPlan.grants);
    for (const player of players) {
      const live = this.players.find(c => this.playerOwnedId(c.id) === player.id);
      if (live) Object.assign(live, player, { id: live.id });
      if (this.playerBorrow) this.playerResources.set(player.id, structuredClone(player));
    }
    this.phase = "victory";
    this.escapeRequested = false;
    this.poisonStates.clear();
    this.slowStates.clear();
    this.controlStates.clear(); this.controlTargetUnits.clear();
    this.queue = [];
    this.reactions = [];
    this.reward = {
      exp,
      gil,
      magicPoints: this.rewardPolicy.magicPoints,
      each,
      recipients: recipients.map((c) => c.id),
      levels,
      drops: dropPlan ? structuredClone(dropPlan.drops) : "pending",
      dropPlan,
    };
    this.log(`战斗胜利！获得 ${exp} EXP / ${gil} Gil。`);
  }
  private progressionResult(player: Combatant, experience: number) {
    const projected = this.projectProgression!(structuredClone(player), experience,
      this.playerBorrow ? [...this.playerObservations.get(player.id)!] : [...this.observedAbilityIds], this.rewardPolicy.magicPoints,
      this.playerBorrow ? firstEnteredOwnerIds(this.playerState!).indexOf(player.id) : undefined);
    if (this.rewardPolicy.magicPoints > 0 || projected.magicLearningValue !== undefined) {
      if (player.magicLearningValue === undefined || projected.magicLearningValue !==
          projectMagicLearningValue(player.magicLearningValue, this.rewardPolicy.magicPoints, player.hp > 0))
        throw new Error("Battle progression magic learning value mismatch");
    }
    return projected;
  }
  private clearBattleConditions() {
    for (const c of this.players)
      c.conditionIds = this.conditions.battleEnd(c.conditionIds);
    if (this.playerBorrow) for (const player of this.playerResources.values())
      player.conditionIds = this.conditions.battleEnd(player.conditionIds);
    this.poisonStates.clear();
    this.slowStates.clear();
    this.controlStates.clear(); this.controlTargetUnits.clear();
  }
  private finishEscape(): void {
    if (!this.escapeRule || !this.escapeRequested || this.phase !== "active" || this.action ||
        !this.eventControls.endEnabled)
      throw new Error("Battle escape is not at a safe action boundary");
    this.clearBattleConditions();
    this.phase = "escaped";
    this.escapeRequested = false;
    this.queue = [];
    this.reactions = [];
    for (const unit of this.combatants) { unit.atb = 0; unit.queued = false; }
    this.log("已撤离战斗。");
  }
  private settlementPlayers(): Combatant[] {
    if (!this.playerState) return this.players;
    return firstEnteredOwnerIds(this.playerState).map(owner => {
      const live = this.players.find(player => this.playerOwnedId(player.id) === owner);
      const held = live ?? this.playerResources.get(owner);
      if (!held) throw new Error("Missing entered player resource owner");
      return { ...structuredClone(held), id: owner };
    });
  }
  private playerReturn(escaped = false): { playerParticipants?: BattlePlayerReturn } {
    if (!this.playerState) return {};
    return { playerParticipants: { state: this.playerExecution!,
      observations: firstEnteredOwnerIds(this.playerState).map(ownedId => ({ ownedId,
        abilityIds: escaped ? [] : [...this.playerObservations.get(ownedId)!] })) } };
  }
  get retainedLootSnapshot(){return this.retainedLoot.snapshot();}
  previewForcedReturn(): BattleForcedReturnResult | BattleSavedForcedReturnResult | null {
    if (this.phase !== "forced" || this.collected) return null;
    if(this.forcedSaveTerminal){const players=structuredClone(this.settlementPlayers()).map(player=>({...player,conditionIds:this.conditions.battleEnd(player.conditionIds),atb:0,queued:false}));
      const baseEquipment=this.playerBorrow?.qualification??this.inventoryQualification??null;
      const equipment=baseEquipment===null?null:{...structuredClone(baseEquipment),members:players.map(player=>{
        const held=baseEquipment.members.find(member=>member.id===player.id&&member.sourceId===player.sourceId);
        if(!held)throw new Error('Missing entered owned equipment save binding');
        const live=this.players.find(unit=>this.playerOwnedId(unit.id)===player.id),actual=live&&this.inventoryQualification?.members.find(member=>member.id===live.id);
        if(live&&(!actual||canonical(actual.equipment)!==canonical(held.equipment)))throw new Error('Unadmitted battle equipment save mutation');
        return structuredClone(held);
      })};
      return {kind:'battle-save-return-v1',resultType:6,policy:{...this.forcedSavePolicy!},players,
        participants:players.map(player=>({ownedId:player.id,sourceId:player.sourceId})),
        consumedItems:structuredClone(this.consumedItems).sort((a,b)=>a.id-b.id),retainedLoot:this.retainedLoot.snapshot(),
        equipment,...this.playerReturn(true)};
    }
    return { kind: "battle-no-save-return-v1", resultType: 4,
      participants: this.settlementPlayers().map(player => ({ ownedId: player.id, sourceId: player.sourceId })),
      ...this.playerReturn(true) };
  }
  takeForcedReturn(): BattleForcedReturnResult | BattleSavedForcedReturnResult | null {
    const result = this.previewForcedReturn(); if (result) this.collected = true; return result;
  }
  previewEscape(): { players: Combatant[]; consumedItems: ItemStack[]; playerParticipants?: BattlePlayerReturn } | null {
    if (this.phase !== "escaped" || this.collected) return null;
    return { players: structuredClone(this.settlementPlayers()).map(player => ({ ...player, atb: 0, queued: false })),
      ...this.playerReturn(true),
      consumedItems: structuredClone(this.consumedItems).sort((a, b) => a.id - b.id) };
  }
  takeEscape(): { players: Combatant[]; consumedItems: ItemStack[]; playerParticipants?: BattlePlayerReturn } | null {
    const result = this.previewEscape();
    if (result) this.collected = true;
    return result;
  }
  previewVictory(): {
    players: Combatant[];
    gil: number;
    magicPoints: number;
    consumedItems: ItemStack[];
    awardedExperience: { id: string; amount: number }[];
    observedAbilityIds: number[];
    dropGrants: BattleDropGrant[];
    playerParticipants?: BattlePlayerReturn;
  } | null {
    if (this.phase !== "victory" || !this.reward || this.collected) return null;
    return {
      players: structuredClone(this.settlementPlayers()).map((c) => ({
        ...c,
        atb: 0,
        queued: false,
      })),
      gil: this.reward.gil,
      ...this.playerReturn(),
      magicPoints: this.reward.magicPoints,
      dropGrants: structuredClone(this.reward.dropPlan?.grants ?? []),
      observedAbilityIds: [...this.observedAbilityIds],
      awardedExperience: this.settlementPlayers().map((p) => ({ id: p.id,
        amount: this.reward!.recipients.includes(p.id) ? this.reward!.each : 0 })),
      consumedItems: structuredClone(this.consumedItems).sort(
        (a, b) => a.id - b.id,
      ),
    };
  }
  takeVictory(): {
    players: Combatant[];
    gil: number;
    magicPoints: number;
    consumedItems: ItemStack[];
    awardedExperience: { id: string; amount: number }[];
    observedAbilityIds: number[];
    dropGrants: BattleDropGrant[];
    playerParticipants?: BattlePlayerReturn;
  } | null {
    const result = this.previewVictory();
    if (result) this.collected = true;
    return result;
  }
}
