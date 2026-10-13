import type { AbilityEffectResult } from "./ability.js";
import type { ParameterValues } from "./parameters.js";
import { projectAbilityCost, type AbilityCostOwner, type AbilityCostProjection } from "./ability-cost.js";
import { equipmentAbilityCostProviders, equipmentOwnedAbilities, validateEquipmentAbilityOwnership, validateEquipmentBattleRows } from "./equipment.js";
import type { OwnedAbility } from "./owned-character.js";
import { projectBattleDrops, validateBattleDropCatalog, type BattleDropPlan, type BattleDropGrant } from "./battle-rewards.js";
import { projectBattleAbilities, type BattleAbilityProjection } from "./battle-abilities.js";
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
} from "./battle-ai.js";
import { battleAITargetBlocker, planBattleAITarget } from "./battle-ai-targets.js";
import { battleReaction, validateReactionRules } from "./battle-reactions.js";
import { projectActionTargets, type ActionUserConditionResult } from "./action-user-conditions.js";
import { projectPhysicalRows, validateBattleRow, validateBattleRowCatalog, type PhysicalRowContext } from "./battle-row.js";
import type { SlowState } from "./condition-speed.js";
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
import { advanceBattleEvent, createBattleEventState, BattleEventError, type BattleEventState } from "./battle-event.js";
import { parseBattleLifecycle, type BattleLifecycle } from "./battle-lifecycle.js";
import { battleEventUnitEnded } from "./battle-event-context.js";
import { BattleEventSharedState, type BattleEventSharedSnapshot } from "./battle-event-shared.js";
import { parseBattleParticipantContent, type BattleParticipantContent, type BattleParticipantSlot,
  type EnemyBattleDefinition } from "./battle-participants.js";
import { createBattleParticipantState, projectEnemyReplacement, projectEnemyPartyReplacement, projectBattleParticipantRewards,
  type BattleParticipantState } from "./battle-participant-state.js";
import { canonical } from "./canonical.js";
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
  kind: "normal" | "loop" | "counter";
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

/** Playability profile only. All provisional rules are enumerated in docs/battle-playability.md.
 * Fixed simulation steps + owned PRNG make failures reproducible; they do not reproduce Unity RNG.
 */
export class BattleGame {
  readonly combatants: Combatant[];
  readonly events: BattleEvent[] = [];
  phase: "active" | "victory" | "defeat" | "escaped" = "active";
  action: BattleAction | null = null;
  reward: BattleReward | null = null;
  time = 0;
  private remainder = 0;
  private randomState: number;
  private queue: BattleAction[] = [];
  private reactions: BattleAction[] = [];
  private aiStates = new Map<string, BattleAIState>();
  private poisonStates = new Map<string, PoisonState>();
  private slowStates = new Map<string, SlowState>();
  private collected = false;
  private readonly escapeRule: FrameworkBattleEscapePolicy | null;
  private readonly rewardPolicy: Readonly<BattleRewardPolicy>;
  private readonly lifecycle: BattleLifecycle;
  private eventState: BattleEventState | null = null;
  private readonly eventShared: BattleEventSharedState | null;
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
  private escapeRequested = false;
  private currentPreferences: BattlePreferences;
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
  ) {
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
    this.escapeRule = content.escapePolicy === undefined ? null : parseBattleEscapePolicy(content.escapePolicy);
    this.rewardPolicy = Object.freeze(parseBattleRewardPolicy(content.rewardPolicy === undefined
      ? { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 } : content.rewardPolicy));
    this.lifecycle = parseBattleLifecycle(content.lifecycle ?? { kind: "battle-lifecycle-v1", mode: "none" });
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
    if (this.lifecycle.mode === "script") this.eventState = createBattleEventState(this.lifecycle.program);
    if (this.lifecycle.mode === "script") for (const [pc, { op }] of this.lifecycle.program.instructions.entries()) {
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
      ...content.enemies.map((p) => ({
        ...structuredClone(p),
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
    }
    this.reconcileAppearances();
    if (this.playerBorrow) {
      this.validatePlayerBorrow();
      for (const player of this.players) this.playerResources.set(player.id, structuredClone(player));
      for (const owner of firstEnteredOwnerIds(this.playerState!)) this.playerObservations.set(owner, []);
    }
    this.log("敌人出现了。");
    this.advanceEvent();
  }
  get players() {
    return this.combatants.filter((c) => c.side === "player");
  }
  get enemies() {
    return this.combatants.filter((c) => c.side === "enemy");
  }
  get registeredDropMonsters(): readonly number[] {
    return [...this.dropRegistrations];
  }
  /** UnableFight.Start calls SetLotMonster, once per start, including another
   * start after revival. Two enemies sharing a master identity remain two rolls. */
  private observeDropLife(unit: Combatant) {
    if (unit.side !== "enemy" || this.content.drops === null) return;
    if (!this.conditions.isUnableFight(unit.conditionIds)) this.dropDead.delete(unit.id);
    else if (!this.dropDead.has(unit.id)) {
      this.dropDead.add(unit.id);
      this.dropRegistrations.push(unit.sourceId);
    }
  }
  get ready() {
    if (this.escapeRequested || !this.eventControls.interactive) return [];
    return this.players.filter((c) => c.hp > 0 && c.atb >= 100 && !c.queued);
  }
  get escapePending(): boolean { return this.escapeRequested; }
  get canRequestEscape(): boolean {
    return this.escapeRule !== null && this.phase === "active" && !this.escapeRequested &&
      this.eventControls.endEnabled && this.eventControls.interactive && this.eventControls.updateEnabled &&
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
    const actor = unit.appearance, catalog = this.content.battleAppearance;
    const hasMagitek = this.conditions.types(unit.conditionIds).includes(607);
    if (!actor || !catalog) {
      if (hasMagitek || actor || unit.appearanceState)
        throw new Error("Missing source battle appearance provider");
      return undefined;
    }
    if (actor.sourceId !== unit.sourceId) throw new Error("Battle appearance actor identity mismatch");
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
    const candidate = projectBattleAppearanceFrame(this.content.battleAppearance!, unit.appearance!, state, frame, this.content.sprites);
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
    inventory: BattleEntryInventory | undefined, equipmentAbilities: OwnedAbility[] | undefined) {
    const catalog = this.content.battleAbilities,
      context = this.content.qualificationContext;
    if (!actor || !actor.ownedAbilities || !catalog || !context) return null;
    if (actor.ownedAbilities.sourceId !== actor.sourceId)
      throw new Error("Battle owned ability identity mismatch");
    return projectBattleAbilities(catalog, actor.ownedAbilities, {
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
      uiWaiting: this.escapeRequested ? false : this.clockInput.uiWaiting,
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
      this.combatants,
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
    this.queue.push(action);
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
      this.conditions.validateActive(c.conditionIds);
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
      !cost || (actor.side === "player" && actor.mp < cost.mp) ||
      (ability.plan.targeting.normalFormationOnly &&
        this.content.formation !== "normal")
    )
      return false;
    this.conditions.validateActive(actor.conditionIds);
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
  get eventSharedReturn() { return this.eventShared?.prepareReturn() ?? null; }
  get participantExecution(): BattleParticipantState { return structuredClone(this.participantState); }
  get enemyPartyExecution() {
    return { partyId: this.currentEnemyPartyId, slots: structuredClone(this.currentEnemySlots),
      hiddenEnemyIds: [...this.hiddenEnemyIds] };
  }
  isCombatantVisible(id: string): boolean {
    if (!this.combatants.some(unit => unit.id === id)) throw new Error("Unknown battle combatant");
    return !this.hiddenEnemyIds.has(id);
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
  private prepareEnemy(definition: EnemyBattleDefinition, placement: BattleParticipantSlot, id: string): Combatant {
    if (this.combatants.some(unit => unit.id === id)) throw new Error("Duplicate battle identity");
    const unit: Combatant = { ...structuredClone(definition), id,
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
    if (!unit.ai) throw new BattleAIError(null, 0, "missing enemy AI program");
    const started = startBattleAI(unit.ai, this.aiContext(unit, nextUnits));
    const context = this.aiContext(unit, nextUnits);
    context.self.behavior = started.behavior;
    this.admitAITurn(unit, planBattleAITurn(unit.ai, started.state, context));
    unit.behavior = started.behavior;
    const poison = this.conditions.reconcilePoisonState(unit.conditionIds, [], this.atbSpeed),
      slow = this.conditions.reconcileSlowState(unit.conditionIds, []);
    unit.atb = unit.hp === 0 ? 0 : this.randomInt(this.content.initialAtb.enemy[0], this.content.initialAtb.enemy[1]);
    return { ai: started.state, poison, slow };
  }
  /** Both single-slot and complete-party transitions invalidate old instances
   * through one shared queue/timer boundary. Death/drop registrations survive. */
  private retireActors(ids: readonly string[]): void {
    const removed = new Set(ids);
    this.queue = this.queue.filter(action => !removed.has(action.actor));
    this.reactions = this.reactions.filter(action => !removed.has(action.actor));
    if (this.action && (removed.has(this.action.actor) || this.action.targetIds.some(id => removed.has(id)))) {
      const action = this.action, actor = this.combatants.find(current => current.id === action.actor);
      this.action = null;
      if (actor) this.finishActorAction(actor, action.kind);
    }
    for (const removedId of removed) {
      this.aiStates.delete(removedId);
      this.poisonStates.delete(removedId);
      this.slowStates.delete(removedId);
      this.dropDead.delete(removedId);
      this.hiddenEnemyIds.delete(removedId);
    }
  }
  private publishEnemyEntry(unit: Combatant, entry: ReturnType<BattleGame["prepareEnemyEntry"]>): void {
    this.aiStates.set(unit.id, entry.ai);
    this.poisonStates.set(unit.id, entry.poison);
    this.slowStates.set(unit.id, entry.slow);
    this.observeDropLife(unit);
  }
  private changeEnemyParty(partyId: number, hidden: boolean): void {
    const party = this.participantContent?.enemyParties?.[partyId];
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
  private advanceEvent(): void {
    if (this.lifecycle.mode !== "script" || !this.eventState || this.eventState.status === "exited") return;
    const program = this.lifecycle.program;
    for (;;) {
      const cores = this.battleAICoresAlive();
      const result = advanceBattleEvent(program, this.eventState, {
        clock: this.time / 10, timeSeconds: this.time / 1000, started: true,
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
      });
      for (const request of result.requests) {
        try {
          switch (request.kind) {
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
      this.eventState = result.state;
      if (!result.requests.length) return;
    }
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
        const targetBlocker = battleAITargetBlocker(ability!.program.range,
          ability!.plan!.targeting, act.kind === "counter-act" ? "counter" : "normal");
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
          const choice = planBattleAITarget({ actor, units: this.combatants,
            eligiblePlayers: this.players.filter(player => player.hp > 0),
            range: ability.program.range, rule: ability.plan!.targeting,
            formation: this.content.formation }, (min, max) => this.randomInt(min, max));
          if (!choice)
            throw new BattleAIError(
              actor.ai!.source,
              act.pc,
              `no admitted automatic target for ability ${id}`,
            );
          decisions.push(
            this.createAction(
              actor,
              ability,
              choice,
              null,
              act.kind === "loop-act" ? "loop" : "normal",
            ),
          );
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
      this.queue.push(...decisions);
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
      this.combatants,
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
    this.queue.push(action);
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
  ): BattleAction {
    return {
      kind,
      actor: actor.id,
      selection: structuredClone(choice.selection),
      targetIds: [...choice.targetIds],
      source: { kind: "ability", id: ability.id },
      commandId,
      // ActDecision 0x1587aa0 routes Interrupt directly to the executor;
      // it never enters Progress.SetActData/GetChantingTime.
      charge:
        kind === "counter"
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
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid battle elapsed time");
    this.validateConditionState();
    if (!this.clockGate().simulation) return;
    this.remainder += ms;
    while (this.remainder >= 10) {
      if (this.phase === "active") this.tick();
      this.remainder -= 10;
    }
  }
  private tick() {
    // One failed simulation step consumes neither logical time nor randomness.
    // Definitions/media/AI programs stay shared; only mutable runtime values are copied.
    const before = {
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
      queue: structuredClone(this.queue),
      reactions: structuredClone(this.reactions),
      ai: structuredClone(this.aiStates),
      eventState: structuredClone(this.eventState),
      eventControls: { ...this.eventControls },
      eventShared: this.eventShared?.snapshot() ?? null,
      poison: structuredClone(this.poisonStates),
      slow: structuredClone(this.slowStates),
      stock: structuredClone(this.stock),
      consumedItems: structuredClone(this.consumedItems),
      observedAbilityIds: [...this.observedAbilityIds],
      dropRegistrations: [...this.dropRegistrations],
      dropDead: new Set(this.dropDead),
      events: [...this.events],
      time: this.time,
      random: this.randomState,
      phase: this.phase,
      reward: this.reward,
      escapeRequested: this.escapeRequested,
    };
    try {
      this.reconcileAppearances();
      this.step();
      this.reconcileAppearances();
    } catch (error) {
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
      this.queue = before.queue;
      this.reactions = before.reactions;
      this.aiStates = before.ai;
      this.eventState = before.eventState;
      this.eventControls = before.eventControls;
      if (this.eventShared && before.eventShared) this.eventShared.restore(before.eventShared);
      this.poisonStates = before.poison;
      this.slowStates = before.slow;
      this.stock = before.stock;
      this.consumedItems = before.consumedItems;
      this.observedAbilityIds = before.observedAbilityIds;
      this.dropRegistrations = before.dropRegistrations;
      this.dropDead = before.dropDead;
      this.events.splice(0, this.events.length, ...before.events);
      this.time = before.time;
      this.randomState = before.random;
      this.phase = before.phase;
      this.reward = before.reward;
      this.escapeRequested = before.escapeRequested;
      throw error;
    }
  }
  private step() {
    const gate = this.clockGate();
    if (!gate.simulation) return;
    this.time += 10;
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
        const actor = this.combatants.find((c) => c.id === this.action!.actor)!;
        const kind = this.action.kind;
        this.action = null;
        this.finishActorAction(actor, kind);
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
        if (c.hp <= 0 || c.queued) continue;
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
        if (!this.escapeRequested && !this.eventControls.enemyNoAct && c.side === "enemy" && c.atb >= 100 &&
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
    const queue = this.reactions.length ? this.reactions : this.queue;
    // SetBattleUpdateEnabled does not cancel staged or interrupt actions. Its
    // executor gate only prevents a new ordinary action from starting.
    const index = queue === this.queue && !this.eventControls.updateEnabled
      ? -1 : queue.findIndex((a) => a.charge <= 0);
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
    const staged = this.combatants.map((actor) => {
      const result = this.conditions.advancePoison({
        conditionIds: actor.conditionIds,
        state: this.poisonStates.get(actor.id)!,
        hp: actor.hp,
        maxHp: actor.maxHp,
        elementResistances: actor.elementResistances,
        seconds,
        atbSpeed: this.atbSpeed,
        // Time-stop types remain outside the active condition capability set.
        isTimeStopped: false,
      });
      const life = result.ticks.length
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
      const state = this.conditions.reconcilePoisonState(
        life.conditionIds,
        result.state,
        this.atbSpeed,
      );
      const slow = this.conditions.reconcileSlowState(life.conditionIds,
        this.conditions.advanceSlow(actor.conditionIds, this.slowStates.get(actor.id)!, seconds));
      return { actor, life, state, slow, ticks: result.ticks };
    });
    for (const { actor, life, state, slow, ticks } of staged) {
      const died = actor.hp > 0 && life.hp === 0;
      Object.assign(actor, life);
      this.observeDropLife(actor);
      this.poisonStates.set(actor.id, state);
      this.slowStates.set(actor.id, slow);
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
    if (action.kind === "counter") return this.counterTargetChoices(this.combatants);
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
      actor, this.combatants, this.content.formation);
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
          const choice = this.counterTargetChoices(units).find(
            (c) => c.targetIds[0] === action.actor,
          );
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
            ),
          );
        }
      }
      updates.push({ actor: actor.id, turn });
    }
    return { updates, decisions };
  }
  private resolve(action: BattleAction) {
    const actor = this.combatants.find((c) => c.id === action.actor)!;
    const ability = this.actionDefinition(action);
    if (action.resolved) return;
    if (!ability.plan) throw new Error("Unimplemented ability cannot execute");
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
      const projection = projectActionTargets(
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
        ...(c === actor && projection.userResults.length ? { conditionIds: projection.userConditionIds } : {}),
      }));
      const results = staged.map((entry) => ({
        target: entry.target.id,
        effects: entry.effects,
      }));
      const reactions = this.planReactions(action, projected, results);
      const userMessages: string[] = [];
      for (const result of projection.userResults) {
        for (const id of result.added)
          if (this.conditions.name(id)) userMessages.push(`${actor.name} 获得${this.conditions.name(id)}状态。`);
        for (const id of result.removed)
          if (this.conditions.name(id)) userMessages.push(`${actor.name} 的${this.conditions.name(id)}已解除。`);
      }
      const changedIds = [...new Set([...staged.map(entry => entry.target.id),
        ...(projection.userResults.length ? [actor.id] : [])])];
      const poison = changedIds.map(id => {
        const unit = projected.find(c => c.id === id)!;
        const removed = (staged.find(entry => entry.target.id === id)?.effects ?? []).flatMap((effect) =>
          effect.resource === "condition" ? effect.removed : [],
        );
        removed.push(...projection.userResults.filter(result => result.ownerId === id).flatMap(result => result.removed));
        const previous = this.poisonStates
          .get(id)!
          .filter((clock) => !removed.includes(clock.conditionId));
        return {
          id,
          state: this.conditions.reconcilePoisonState(
            unit.conditionIds,
            previous,
            this.atbSpeed,
          ),
          slow: this.conditions.reconcileSlowState(unit.conditionIds,
            this.slowStates.get(id)!.filter((clock) => !removed.includes(clock.conditionId))),
        };
      });
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
      if (projection.userResults.length) actor.conditionIds = [...projection.userConditionIds];
      for (const next of poison) {
        this.poisonStates.set(next.id, next.state);
        this.slowStates.set(next.id, next.slow);
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
        for (const message of entry.messages) this.log(message);
      }
      for (const message of userMessages) this.log(message);
      for (const update of reactions.updates) {
        this.aiStates.set(update.actor, update.turn.state);
        this.combatants.find((c) => c.id === update.actor)!.behavior =
          update.turn.behavior;
      }
      this.reactions.push(...reactions.decisions);
      action.selection = choice.selection;
      action.targetIds = choice.targetIds;
      action.results = results;
      if (projection.userResults.length) action.userConditionResults = structuredClone(projection.userResults);
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
    if (this.action) return;
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
    if (this.eventState && this.enemies.some((c) => c.hp > 0))
      throw new Error("Battle event victory with live enemies requires an admitted result provider");
    if (this.enemies.some((c) => c.hp > 0)) return;
    // Missing growth for a later recipient must not leave an earlier recipient
    // upgraded, or publish a victory whose reward cannot be collected.
    const players = this.settlementPlayers().map((c) => ({
      ...structuredClone(c),
      conditionIds: this.conditions.battleEnd(c.conditionIds),
    }));
    const { exp, gil } = projectBattleParticipantRewards(this.participantState,
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
    for (const player of players) {
      const live = this.players.find(c => this.playerOwnedId(c.id) === player.id);
      if (live) Object.assign(live, player, { id: live.id });
      if (this.playerBorrow) this.playerResources.set(player.id, structuredClone(player));
    }
    this.phase = "victory";
    this.escapeRequested = false;
    this.poisonStates.clear();
    this.slowStates.clear();
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
