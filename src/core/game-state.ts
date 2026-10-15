import { previewSourcePartySelection, type FieldSourcePartySelectionPort, type SourcePartySelectionModel, type SourcePartySelectionOutcome } from './source-party-selection.js';
import { parseBattleGauEntry, type BattleGauEntry } from './battle-gau.js';
import type { BattleFieldState } from './field-battle-entry.js';
import { WEB_SOURCE_SCRIPT_RANDOM, validateScriptRandomUpper, type WebSourceScriptRandom, type FieldScriptRandomPort } from "./field-script-random.js";
import type { CombatantDefinition, BattleContent } from "./battle-content.js";
import type { BattleEntryInventory, BattleInventoryWithQualification } from "./battle-entry.js";
import type { Combatant, BattleStatProjection } from "./battle.js";
import { parseBattlePlayerBorrow, parseBattlePlayerPlan, parseBattlePlayerReturn,
  type BattlePlayerBorrow, type BattlePlayerPlan, type BattlePlayerReturn } from "./battle-player-participants.js";
import { firstEnteredOwnerIds,
  type BattlePlayerGroupSlot } from "./battle-player-state.js";
import { projectActionTarget, type ActionParticipant } from "./action-effects.js";
import type {
  FieldInventoryCommand,
  FieldInventoryPort,
  FieldInventoryTransaction,
} from "./inventory-event.js";
import { projectEquipmentOwnership } from "./inventory-ownership.js";
import type { BattleDropGrant } from "./battle-rewards.js";
import { MAX_MAGIC_LEARNING_VALUE, parseBattleRewardPolicy, projectMagicLearningValue,
  type BattleRewardPolicy } from "./battle-result.js";
import {parseBattleSavedForcedReturnResult,parseWebBattleForcedSave,type BattleSavedForcedReturnResult,type WebBattleForcedSave} from './battle-forced-save.js';
import { parseBattleForcedReturnResult, type BattleForcedReturnResult } from "./battle-forced-return.js";
import { projectShopTrade, shopBuyOptions, shopSellOptions, validateShopCatalog,
  type ShopCatalog, type ShopInventoryRead, type ShopTradeRequest } from "./shop.js";
import {
  prepareRosterLifecycle,
  validateRosterLifecycle,
  type RosterMember,
  type RosterCommand,
  type FieldRosterPort,
  type RosterLifecycleTransaction,
} from "./roster.js";
import {
  activePartyMembers,
  previewPartyCommand,
  validatePartyState,
  type PartyState,
  type PartyCommand,
  type FieldPartyPort,
  type PartyEventTransaction,
  type PartyAppearanceCandidate,
} from "./party.js";
import { previewPartyMenu, type PartyMenuRequest } from "./party-menu.js";
import {
  equipmentAvailability,
  selectEmptyEquipment,
  previewEquipmentChange,
  projectEquipmentParameters,
  validateEquipmentState,
  equipmentAttackArm,
  equipmentAbilityCostProviders,
  validateEquipmentAbilityOwnership,
  applyEquipmentAbilityChange,
  type EquipmentCatalog,
  type EquipmentParameterContext,
  type EquipmentStock,
} from "./equipment.js";
import type { ParameterLimits } from "./parameters.js";
import type { PhysicalLimits } from "./physical-parameters.js";
import {
  validateItemStacks,
  type ItemDefinition,
  type ItemStack,
} from "./items.js";
import {
  BattleConditions,
  type BattleConditionCatalog,
} from "./battle-conditions.js";
import {
  FieldConditions,
  type FieldConditionCatalog,
  type FieldConditionPort,
} from "./field-conditions.js";
import {
  createOwnedCharacter,
  validateOwnedCharacterAbilities,
  type OwnedCharacterAbilities,
  type OwnedCharacterInitializationTemplate,
  type InitializedOwnedCharacter,
} from "./owned-character.js";
import { canonical } from "./canonical.js";
import { createNewGame, type NewGameDefinition, type NewGamePlan } from "./new-game.js";
import type { FieldTreasurePort } from "./treasure-port.js";
import type { TreasureInventoryRead, TreasureRewardCommand } from "./treasure-inventory.js";
import { recoverJoinedCharacter } from "./character-recovery.js";
import type { PartyActorCatalog, PartyActorMember } from "./party-actors.js";
import { projectFieldPuppetRoster, type FieldPuppetRosterPort } from "./field-puppet-roster.js";
import { createSourceNativeState, validateSourceNativeState,
  type SourceNativeState } from "./source-native-state.js";
import { projectTransportationState, type FieldTransportationPort,
  type FieldTransportationTransaction, type TransportationStateCommand } from "./transportation-state.js";
import { projectOwnedCondition, projectOwnedConditionRemoveAll, type FieldOwnedConditionPort,
  type OwnedConditionCommand, type OwnedConditionTransaction } from "./owned-condition.js";
import { projectFieldRecovery, type FieldRecoveryCommand,
  type FieldRecoveryPort, type FieldRecoveryTransaction } from "./field-recovery.js";
import { projectOwnedMessageNames, type FieldMessageNamesPort,
  type PreparedFieldMessageNames } from "./owned-message-names.js";
import type { CharacterMessageNameRef } from "./field-message-template.js";
import { fieldAbilityMenu, fieldAbilityTargets, projectFieldAbility, validateFieldAbilityCatalog,
  type FieldAbilityCatalog, type FieldAbilityContext, type FieldAbilityRequest,
  type FieldAbilityMember, type FieldAbilityCostOwner } from "./field-abilities.js";
import { createFieldRandom, drawFieldRandom, validateFieldRandom, type FieldRandomState } from "./field-random.js";
import { validateMagicStoneCatalog, validateMagicStoneOwnership, projectAcquireMagicStone,
  projectEquipMagicStone, projectRemoveMagicStone, projectRemoveInventoryMagicStone,
  type MagicStoneCatalog, type MagicStonePassiveContext } from "./magic-stones.js";
import {
  growCharacter,
  initialCharacterGrowth,
  validateCharacterGrowth,
  learnObservedCharacter,
  projectCharacterMagicStone,
  projectCharacterInventoryMagicStoneRemoval,
  type CharacterGrowthPlan,
  type CharacterGrowthProgress,
  type CharacterGrowthRequest,
} from "./character-growth.js";

export type GameStateContent = {
  kind: "game-state-development-v1";
  limits: {
    gil: number;
    item: number;
    hp: number;
    mp: number;
    level: number;
    exp: number;
  };
  initialGil: number;
  initialParty: PartyState;
  /** Source initializer bound by this content package. The development field
   * checkpoint remains a separate constructor mode. */
  sourceNewGame?: NewGameDefinition;
  /** Explicit source-bound development checkpoint state, applied after source
   * AddFromMaster initialization. This never creates or enables an owner. */
  initialOwnedConditions?: { id: string; conditionIds: number[] }[];
  fieldConditions?: FieldConditionCatalog;
  characterInitializations?: Record<string, OwnedCharacterInitializationTemplate>;
  characterGrowth?: Record<string, CharacterGrowthPlan>;
  partyActors?: PartyActorCatalog;
  shops?: ShopCatalog;
  /** Field execution is independent of an ability's battle plan and creates no
   * ownership. Packages without this contract do not expose menu spellcasting. */
  fieldAbilities?: FieldAbilityCatalog;
  magicStones?: MagicStoneCatalog;
  /** Source templates for potential party members, not additional owned actors. */
  battleDefinitions?: CombatantDefinition[];
  rosterLifecycle: {
    initial: Record<
      string,
      Pick<
        RosterMember,
        "ownedId" | "jobId" | "additionalLevel" | "magicStoneId" | "ownedJobs"
      >
    >;
    releasedJobIds: number[];
    jobIds: number[];
    firstJoinLevelAdjustments?: Record<string, number>;
  };
  /** Ordinary/important stacks; equipment has separate count/occupancy semantics. */
  items: Record<string, ItemDefinition>;
  initialItems: { id: number; count: number }[];
  equipment: Record<string, number[]>;
  equipmentSystem?: {
    catalog: EquipmentCatalog;
    /** Complete source-bound initial Count, including native empty equipment.
     * This is consumed once, never inferred from restored loadouts. */
    initialStock: EquipmentStock[];
    contexts: Record<string, EquipmentParameterContext>;
    limits: { parameters: ParameterLimits; physical: PhysicalLimits };
    /** The current fixed-increment development growth profile, not full growth providers. */
    growth: Record<string, { level: number; hp: number; mp: number }[]>;
  };
};
export type OwnedCharacter = RosterMember & {
  name: string;
  level: number;
  exp: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  /** Source per-character reserve; independent of ability proficiency and MP. */
  magicLearningValue: number;
  conditionIds: number[];
  /** Null only in logic fixtures that have no source initialization provider. */
  abilities: OwnedCharacterAbilities | null;
  /** Additional values are durable source state; capped maxima are projections. */
  growth: CharacterGrowthProgress | null;
};
export type GameStateSnapshot = {
  formatVersion: 12 | 13 | 14 | 15;
  kind: "owned-game-state";
  catalogHash: string;
  initialization: "development-checkpoint" | "source-new-game";
  /** Null means the development checkpoint never proved these source domains. */
  nativeState: SourceNativeState | null;
  /** Required in v13 packages with menu abilities; absent in historical v12
   * packages. Restore never recreates a missing stream from the entry seed. */
  fieldRandom?: FieldRandomState;
  roster: OwnedCharacter[];
  party: PartyState;
  gil: number;
  totalGil: number;
  items: { id: number; count: number }[];
  equipmentStock: EquipmentStock[];
  releasedJobIds: number[];
  learnedAbilityIds: number[];
  characterNames: Record<string, string>;
  /** One receipt per settled lease, including escapes. Only victories qualify
   * as won encounters or as a source observation-learning result. */
  completedBattles: { serial: number; encounterId: number; outcome: "victory" | "escaped" | "forced" | "forced-save" }[];
};
/** The two supported historical formats had no admitted magic-point rewards;
 * version 10 additionally could only settle victories. */
type LegacyOwnedCharacter = Omit<OwnedCharacter, "magicLearningValue">;
export type LegacyGameStateSnapshotV11 = Omit<GameStateSnapshot, "formatVersion" | "roster" | "completedBattles"> & {
  formatVersion: 11;
  roster: LegacyOwnedCharacter[];
  completedBattles: { serial: number; encounterId: number; outcome: "victory" | "escaped" }[];
};
export type LegacyGameStateSnapshotV10 = Omit<LegacyGameStateSnapshotV11, "formatVersion" | "completedBattles"> & {
  formatVersion: 10;
  completedBattles: { serial: number; encounterId: number }[];
};
export type BattleLease = {
  readonly serial: number;
  readonly encounterId: number;
};
export type BattleEscapeResult = { players: Combatant[]; consumedItems: ItemStack[];
  playerParticipants?: BattlePlayerReturn };
export type BattleVictoryResult = BattleEscapeResult & {
  gil: number;
  /** Exactly the frozen encounter policy, before per-character eligibility/cap. */
  magicPoints?: number;
  awardedExperience?: { id: string; amount: number }[];
  observedAbilityIds?: number[];
  dropGrants?: BattleDropGrant[];
};
export type PreparedBattleReturn = (() => void) & {
  validate(): void;
  fieldState(): { puppetRoster: ReturnType<FieldPuppetRosterPort["current"]>; partyAppearance: PartyAppearanceCandidate | null };
};

const ownedSnapshotFields = "formatVersion,kind,catalogHash,initialization,nativeState,roster,party,gil,totalGil,items,equipmentStock,releasedJobIds,learnedAbilityIds,characterNames,completedBattles";
const legacyOwnedMemberFields = "id,sourceId,name,enabled,level,exp,hp,mp,maxHp,maxMp,conditionIds,equipment,ownedId,jobId,additionalLevel,magicStoneId,ownedJobs,abilities,growth";

function integer(value: number, max: number, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid owned-state integer");
  return value;
}
function distinct<T>(values: readonly T[]) {
  if (new Set(values).size !== values.length)
    throw new Error("Duplicate owned-state identity");
}
function keys(value: object, expected: string) {
  if (
    Object.keys(value).sort().join(",") !== expected.split(",").sort().join(",")
  )
    throw new Error("Unknown or missing owned-state field");
}

/** Owns durable character/item values. Battles borrow a projection, never the roster itself. */
export class GameState {
  private readonly content: GameStateContent;
  private readonly definitions: Map<string, CombatantDefinition>;
  private readonly initialIds: readonly string[];
  private sourceNativeBaseline: SourceNativeState | undefined;
  private data: GameStateSnapshot;
  private active: {
    lease: BattleLease;
    players: Combatant[];
    items: ItemStack[];
    qualification: BattleEntryInventory | null;
    forcedSavePolicy:WebBattleForcedSave|null;
    rewardPolicy: Readonly<BattleRewardPolicy>;
    playerBorrow: BattlePlayerBorrow | undefined;
  } | null = null;
  private revision = 0;
  private transportationPublication = false;
  private menuPublication = false;
  private readonly conditions: BattleConditions;
  private readonly ownedConditionDefinitions: { id: number; type: number }[];
  private readonly fieldConditions: FieldConditions | null;
  readonly fieldSteps: FieldConditionPort = {
    prepareStep: (transportationId) => this.prepareFieldStep(transportationId),
  };
  readonly fieldInventory: FieldInventoryPort = {
    prepare: (command) => this.prepareInventoryEvent(command),
  };
  readonly fieldTreasure: FieldTreasurePort;
  readonly fieldParty: FieldPartyPort = {
    prepare: (command) => this.preparePartyEvent(command),
  };
  readonly fieldRoster: FieldRosterPort = {
    prepare: (command) => this.prepareRosterEvent(command),
  };
  readonly fieldOwnedConditions: FieldOwnedConditionPort = {
    prepare: (command) => this.prepareOwnedConditionEvent(command),
  };
  readonly fieldScriptRandom: FieldScriptRandomPort = { prepare: upper => this.prepareScriptRandom(upper) };
  readonly fieldRecovery: FieldRecoveryPort = {
    prepare: (command) => this.prepareFieldRecovery(command),
  };
  /** Whole-roster source identities and the selected four Corps cells. */
  readonly fieldPuppetRoster: FieldPuppetRosterPort = {
    current: () => this.projectPuppetRoster(this.data),
  };
  /** Character macros read the complete held roster, including disabled or
   * off-party owners, through its existing source/tag binding. */
  readonly fieldMessageNames: FieldMessageNamesPort = {
    prepare: (refs) => {
      const data = this.data, revision = this.revision;
      return this.prepareMessageNames(data, refs,
        () => !this.transportationPublication && this.data === data && this.revision === revision);
    },
  };
  /** Source fresh/restore only. A development checkpoint never invents the
   * complete parking payload from its current selected transport identity. */
  get fieldTransportation(): FieldTransportationPort | undefined {
    if (!this.data.nativeState || !this.content.sourceNewGame) return undefined;
    return {
      catalog: structuredClone(this.content.sourceNewGame.transportation),
      read: () => this.readTransportations(this.data),
      prepare: (command) => this.prepareTransportation(command),
    };
  }
  readonly fieldShop = { validate: (groupId: number): void => { this.shopOptions(groupId); } };
  /** Creates only the shared owner. The field host must independently prepare
   * and publish the source route before this can become a new game session. */
  static createNewGame(
    content: GameStateContent,
    players: readonly CombatantDefinition[],
    catalogHash: string,
    conditions: BattleConditionCatalog,
  ): GameState {
    return new GameState(content, players, catalogHash, conditions, "new-game");
  }
  constructor(
    content: GameStateContent,
    players: readonly CombatantDefinition[],
    readonly catalogHash: string,
    conditions: BattleConditionCatalog,
    initialization: "development-checkpoint" | "new-game" = "development-checkpoint",
  ) {
    this.conditions = new BattleConditions(structuredClone(conditions));
    this.ownedConditionDefinitions = conditions.rules.definitions.map(({ id, type }) => ({ id, type }));
    this.fieldConditions = content.fieldConditions
      ? new FieldConditions(structuredClone(content.fieldConditions))
      : null;
    this.content = structuredClone(content);
    if (content.fieldAbilities) validateFieldAbilityCatalog(this.content.fieldAbilities!, this.conditions);
    if (content.magicStones) validateMagicStoneCatalog(this.content.magicStones!);
    if (content.shops) {
      validateShopCatalog(content.shops);
      if (content.shops.itemLimit !== content.limits.item || content.shops.gilLimit !== content.limits.gil)
        throw new Error("Shop and owned inventory limits differ");
    }
    this.initialIds = players.map((p) => p.id);
    const definitions = content.battleDefinitions ?? players;
    distinct(definitions.map((p) => p.id));
    distinct(definitions.map((p) => p.sourceId));
    if (players.some((p) => !definitions.some((d) => d.id === p.id && d.sourceId === p.sourceId)))
      throw new Error("Missing initial battle definition");
    this.definitions = new Map(definitions.map((p) => [p.id, structuredClone(p)]));
    this.fieldTreasure = {
      limits: { item: content.limits.item, gil: content.limits.gil },
      read: () => this.treasureInventoryRead(this.data),
      prepare: (command) => this.prepareTreasureReward(command),
    };
    distinct(players.map((p) => p.id));
    if (content.kind !== "game-state-development-v1" || !players.length)
      throw new Error("Unsupported owned-state content");
    keys(content.limits, "gil,item,hp,mp,level,exp");
    for (const max of Object.values(content.limits))
      integer(max, 0x7fffffff, 1);
    if (!["development-checkpoint", "new-game"].includes(initialization))
      throw new Error("Unknown owned-state initialization mode");
    const fresh = initialization === "new-game" ? this.sourceNewGamePlan(players) : null;
    for (const p of players) {
      const equipment = content.equipment[p.id];
      if (!equipment || equipment.length !== 6)
        throw new Error("Missing source equipment slots");
      equipment.forEach((id) => integer(id, 0x7fffffff, 1));
      if (!content.rosterLifecycle?.initial[p.id])
        throw new Error("Missing source roster lifecycle metadata");
    }
    for (const [key, item] of Object.entries(content.items)) {
      if (
        key !== String(integer(item.id, 0x7fffffff, 1)) ||
        typeof item.name !== "string" ||
        typeof item.important !== "boolean"
      )
        throw new Error("Invalid item identity");
      integer(item.itemId, 0x7fffffff, 1);
      this.conditions.validateReferences(item.forbiddenConditionIds);
    }
    const initializedMembers = new Map<string, InitializedOwnedCharacter>();
    const learnedAbilityIds: number[] = [];
    const characterNames: Record<string, string> = {};
    if (!fresh && content.characterInitializations) {
      distinct(Object.values(content.characterInitializations).map((t) => t.initial.sourceId));
      for (const player of players) {
        const template = content.characterInitializations[player.id];
        if (!template || template.initial.sourceId !== player.sourceId)
          throw new Error("Initial character template identity mismatch");
        const initialized = createOwnedCharacter(template, {
          id: player.id,
          ownedId: content.rosterLifecycle.initial[player.id]!.ownedId,
          releasedJobIds: content.rosterLifecycle.releasedJobIds,
          learnedAbilityIds,
        });
        initializedMembers.set(player.id, initialized.member);
        learnedAbilityIds.push(...initialized.learnedAbilityIdsToAppend);
        if (initialized.nameBinding) {
          const key = initialized.nameBinding.key;
          if (Object.hasOwn(characterNames, key))
            throw new Error("Duplicate initial character name binding");
          characterNames[key] = initialized.member.name;
        }
      }
    }
    this.data = {
      formatVersion: content.magicStones ? 14 : content.fieldAbilities ? 13 : 12,
      kind: "owned-game-state",
      catalogHash,
      initialization: fresh ? "source-new-game" : "development-checkpoint",
      nativeState: fresh ? createSourceNativeState(fresh) : null,
      ...(content.fieldAbilities ? { fieldRandom: createFieldRandom(content.fieldAbilities.rules.random.seed) } : {}),
      roster: players.map((p) => ({
        ...structuredClone(content.rosterLifecycle.initial[p.id]!),
        id: p.id,
        sourceId: p.sourceId,
        name: p.name,
        enabled: true,
        level: p.level,
        exp: p.exp,
        hp: p.hp,
        mp: p.mp,
        maxHp: p.hp,
        maxMp: p.mp,
        conditionIds: [...p.conditionIds],
        abilities: null,
        equipment: [...(content.equipment[p.id] ?? [])],
        ...structuredClone(initializedMembers.get(p.id) ?? {}),
        magicLearningValue: 0,
        growth: content.characterGrowth?.[p.id] ? initialCharacterGrowth(content.characterGrowth[p.id]) : null,
      })),
      party: structuredClone(content.initialParty),
      gil: content.initialGil,
      totalGil: content.initialGil,
      items: structuredClone(content.initialItems),
      equipmentStock: [],
      releasedJobIds: [...content.rosterLifecycle.releasedJobIds],
      learnedAbilityIds,
      characterNames,
      completedBattles: [],
    };
    if (fresh) {
      this.sourceNativeBaseline = createSourceNativeState(fresh);
      Object.assign(this.data, structuredClone(fresh.owned), {
        roster: fresh.owned.roster.map((member) => ({
          ...structuredClone(member),
          magicLearningValue: 0,
          growth: content.characterGrowth?.[member.id] ? initialCharacterGrowth(content.characterGrowth[member.id]) : null,
        })),
      });
    }
    const seeded = new Set<string>();
    for (const seed of fresh ? [] : this.content.initialOwnedConditions ?? []) {
      keys(seed, "id,conditionIds");
      if (seeded.has(seed.id) || !this.initialIds.includes(seed.id) || !Array.isArray(seed.conditionIds))
        throw new Error("Invalid initial owned condition checkpoint identity");
      seeded.add(seed.id);
      distinct(seed.conditionIds);
      this.conditions.validateOwner(seed.conditionIds, "player");
      this.data.roster.find((member) => member.id === seed.id)!.conditionIds = [...seed.conditionIds];
    }
    if (!fresh && this.content.equipmentSystem) {
      if (!Array.isArray(this.content.equipmentSystem.initialStock))
        throw new Error("Missing source initial equipment ownership");
      this.data.equipmentStock = structuredClone(this.content.equipmentSystem.initialStock);
    }
    this.validate(this.data);
  }
  private sourceNewGamePlan(players: readonly Pick<CombatantDefinition, "id" | "sourceId">[]): NewGamePlan {
    const definition = this.content.sourceNewGame, system = this.content.equipmentSystem;
    if (!definition || !system) throw new Error("Missing source new-game initializer");
    const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
    const plan = createNewGame(definition);
    if (!same(definition.characters.map(({ id, template }) => ({ id, sourceId: template.initial.sourceId })),
      players.map(({ id, sourceId }) => ({ id, sourceId }))) ||
      !same(definition.party, this.content.initialParty) ||
      !same(definition.releasedJobIds, this.content.rosterLifecycle.releasedJobIds) ||
      definition.gil !== this.content.initialGil ||
      definition.limits.gil !== this.content.limits.gil || definition.limits.item !== this.content.limits.item ||
      !same(plan.owned.items, [...this.content.initialItems].sort((a, b) => a.id - b.id)) ||
      !same(plan.owned.equipmentStock, system.initialStock))
      throw new Error("Source new-game ownership binding mismatch");
    if (definition.equipment.limit !== system.catalog.limit ||
      !same(definition.equipment.ordinaryWeaponEffects, system.catalog.ordinaryWeaponEffects))
      throw new Error("Source new-game equipment catalog mismatch");
    for (const [id, item] of Object.entries(definition.equipment.definitions))
      if (!same(item, system.catalog.definitions[id]))
        throw new Error("Source new-game equipment definition mismatch");
    for (const { id, template } of definition.characters) {
      if (!same(template, this.content.characterInitializations?.[id]) ||
        !same(template.parameterContext, system.contexts[id]) ||
        !same(template.limits, system.limits) ||
        !same(template.initial.equipment, this.content.equipment[id]) ||
        !same(definition.equipment.characters[template.initial.sourceId], system.catalog.characters[template.initial.sourceId]))
        throw new Error("Source new-game character context mismatch");
    }
    return plan;
  }
  private validate(data: GameStateSnapshot) {
    keys(data, ownedSnapshotFields + (this.content.fieldAbilities ? ",fieldRandom" : ""));
    if (
      data.kind !== "owned-game-state" ||
      data.formatVersion !== (Array.isArray(data.completedBattles)&&data.completedBattles.some(b=>b.outcome==='forced-save')?15:this.content.magicStones ? 14 : this.content.fieldAbilities ? 13 : 12) ||
      data.catalogHash !== this.catalogHash
    )
      throw new Error("Owned-state source/version mismatch");
    if (this.content.fieldAbilities) {
      if (!data.fieldRandom) throw new Error("Missing field random ownership");
      validateFieldRandom(data.fieldRandom);
    }
    if (data.initialization === "source-new-game") {
      if (data.nativeState === null)
        throw new Error("Missing source native-state ownership");
      if (!this.sourceNativeBaseline) {
        // Reconstruct only the validation baseline from trusted content. This
        // does not merge fresh defaults, grants or checkpoint seeds into data.
        const plan = this.sourceNewGamePlan(this.initialIds.map((id) => this.definitions.get(id)!));
        this.sourceNativeBaseline = createSourceNativeState(plan);
      }
      validateSourceNativeState(data.nativeState, this.sourceNativeBaseline, this.observedMagic(data),
        this.content.magicStones ? Object.values(this.content.magicStones.stones).map(stone => stone.contentId) : undefined);
    } else if (data.initialization !== "development-checkpoint" || data.nativeState !== null) {
      throw new Error("Owned-state initialization identity mismatch");
    }
    const limits = this.content.limits;
    integer(data.gil, limits.gil);
    integer(data.totalGil, 0x7fffffff);
    distinct(data.roster.map((p) => p.id));
    distinct(data.roster.map((p) => p.ownedId));
    distinct(data.roster.map((p) => p.sourceId));
    distinct(data.releasedJobIds);
    for (const job of data.releasedJobIds)
      if (
        !this.content.rosterLifecycle.jobIds.includes(
          integer(job, 0x7fffffff, 1),
        )
      )
        throw new Error("Unknown released job");
    for (const p of data.roster)
      this.validateOwnedMember(p, data.roster.length);
    // AddFromMaster contributes its initial owned identities (including skill 0)
    // in acquisition order. Ordinary StatusUp learning does not add to history.
    const learnedAbilityIds = [...new Set([...data.roster]
      .sort((a, b) => a.ownedId - b.ownedId)
      .flatMap((p) => this.content.characterInitializations?.[p.id]?.initial.abilities.owned.map((a) => a.abilityId) ?? []))];
    if (canonical(data.learnedAbilityIds) !== canonical(learnedAbilityIds))
      throw new Error("Unimplemented learned ability history change");
    const names = Object.fromEntries(data.roster.flatMap((p) => {
      const template = this.content.characterInitializations?.[p.id];
      return template?.nameTag ? [[template.nameTag, p.name]] : [];
    }));
    if (canonical(data.characterNames) !== canonical(names))
      throw new Error("Owned character name binding mismatch");
    if (this.initialIds.some((id) => !data.roster.some((p) => p.id === id)))
      throw new Error("Missing roster member");
    if (this.content.equipmentSystem)
      validateRosterLifecycle(
        this.rosterState(data),
        this.rosterCatalog(),
        () => {}, // Complete member fields were checked above; this validates ownership and slots.
      );
    else if (data.equipmentStock.length)
      throw new Error("Unimplemented equipment stock");
    validatePartyState(data.party, data.roster);
    if (this.content.magicStones) {
      const roster = this.magicStoneRoster(data);
      validateMagicStoneOwnership(this.content.magicStones, data.nativeState?.ownedMagicStones ?? [],
        roster, this.magicStonePassives(data));
      const receiptIds = new Set<string>();
      for (const member of roster) for (const receipt of member.growth?.history ?? []) {
        if (receipt.kind !== "status-up" || receipt.battleSerial === null) continue;
        const key = `${receipt.battleSerial}:${receipt.participantIndex}`;
        if (receiptIds.has(key) || !data.completedBattles.some(battle =>
          battle.serial === receipt.battleSerial && battle.outcome === "victory"))
          throw new Error("Unbound magic stone growth battle receipt");
        receiptIds.add(key);
      }
    }
    distinct(data.items.map((item) => item.id));
    for (const item of data.items) {
      keys(item, "id,count");
      integer(item.id, 0x7fffffff, 1);
      if (!this.content.items[item.id])
        throw new Error("Unimplemented inventory content: " + item.id);
      integer(item.count, limits.item);
    }
    this.observedMagic(data);
    distinct(data.completedBattles.map((b) => b.serial));
    for (const [index, b] of data.completedBattles.entries()) {
      keys(b, "serial,encounterId,outcome");
      if (b.serial !== index)
        throw new Error("Invalid battle receipt sequence");
      integer(b.encounterId, 0x7fffffff, 1);
      if (b.outcome !== "victory" && b.outcome !== "escaped" && b.outcome !== "forced" && (b.outcome!=="forced-save"||data.formatVersion!==15))
        throw new Error("Invalid battle receipt outcome");
    }
  }
  /** Rebuild the single native magic owner from source-bound per-character
   * transition receipts. Ordering follows result participant order, not roster order. */
  private observedMagic(data: GameStateSnapshot): number[] {
    const values = [...(this.sourceNativeBaseline?.ownedMagic ?? [])];
    const receipts = data.roster.flatMap((member) =>
      (member.growth?.observedLearning ?? []).map((receipt) => ({ member, receipt })));
    if (receipts.length && data.initialization !== "source-new-game")
      throw new Error("Observed learning requires source native owned-magic state");
    receipts.sort((a, b) => a.receipt.battleSerial - b.receipt.battleSerial ||
      a.receipt.participantIndex - b.receipt.participantIndex);
    const identities = new Set<string>();
    for (const { member, receipt } of receipts) {
      const key = `${receipt.battleSerial}:${receipt.participantIndex}`;
      if (identities.has(key) || !data.completedBattles.some((b) =>
        b.serial === receipt.battleSerial && b.outcome === "victory"))
        throw new Error("Unbound observed learning battle receipt");
      identities.add(key);
      const catalog = this.content.characterGrowth?.[member.id]?.observedLearning;
      if (!catalog || !member.abilities?.owned.some((a) => a.abilityId === catalog.recipientAbilityId))
        throw new Error("Unbound observed learning recipient");
      for (const observed of receipt.observedAbilityIds) {
        const row = catalog.candidates.find((r) => r.observedAbilityId === observed);
        if (!row) throw new Error("Unknown observed learning receipt ability");
        if (!values.includes(row.contentId)) values.push(row.contentId);
      }
    }
    return values;
  }
  private validateOwnedMember(p: OwnedCharacter, rosterSize: number) {
    const limits = this.content.limits;
    keys(
      p,
      legacyOwnedMemberFields + ",magicLearningValue",
    );
    // This is current owned state, like HP and Gil, not a second progression
    // ledger or a claim that a serialized save proves its historical battles.
    integer(p.magicLearningValue, MAX_MAGIC_LEARNING_VALUE);
    if (Object.is(p.magicLearningValue, -0)) throw new Error("Invalid owned magic learning value");
    const definition = this.definitions.get(p.id);
    const template = this.content.characterInitializations?.[p.id];
    if (
      (!definition && !template) ||
      (definition && (definition.side !== "player" || definition.sourceId !== p.sourceId)) ||
      (template && template.initial.sourceId !== p.sourceId) ||
      typeof p.name !== "string"
    )
      throw new Error("Unknown roster identity");
    if (typeof p.enabled !== "boolean")
      throw new Error("Invalid roster availability");
    const growthPlan = this.content.characterGrowth?.[p.id];
    if (template) {
      if (!p.abilities) throw new Error("Missing owned abilities");
      const passives = this.equipmentAbilities(p);
      validateOwnedCharacterAbilities(p.abilities, passives);
      if (growthPlan) {
        if (!p.growth) throw new Error("Missing owned character growth");
        validateCharacterGrowth(growthPlan, { ...p, abilities: p.abilities }, p.growth, passives);
      } else if (canonical({ ...p.abilities, owned: p.abilities.owned.filter((a) =>
        !passives.some((passive) => passive.abilityId === a.abilityId)) }) !== canonical(template.initial.abilities))
        throw new Error("Unimplemented owned ability learning change");
    } else if (p.abilities !== null) throw new Error("Unbound owned ability state");
    if (!growthPlan && p.growth !== null) throw new Error("Unbound owned growth state");
    if (!this.content.equipmentSystem && !p.enabled)
      throw new Error("Unimplemented disabled roster equipment ownership");
    const lifecycle = this.content.rosterLifecycle.initial[p.id];
    if (
      (lifecycle ? p.ownedId !== lifecycle.ownedId : p.ownedId <= this.initialIds.length) ||
      p.jobId !== (template?.initial.jobId ?? lifecycle?.jobId)
    )
      throw new Error("Unimplemented roster identity/job change");
    integer(p.ownedId, rosterSize, 1);
    integer(p.additionalLevel, limits.level, 1);
    if (
      p.additionalLevel !==
      (template ? p.level : lifecycle!.additionalLevel + p.level - definition!.level)
    )
      throw new Error("Owned level disagrees with source additional level");
    if (p.magicStoneId !== 0 && !this.content.magicStones)
      throw new Error("Unimplemented owned magic stone");
    distinct(p.ownedJobs.map((j) => j.id));
    for (const job of p.ownedJobs) {
      keys(job, "id,level,proficiency");
      if (
        !this.content.rosterLifecycle.jobIds.includes(
          integer(job.id, 0x7fffffff, 1),
        )
      )
        throw new Error("Unknown owned job");
      integer(job.level, 0x7fffffff, 1);
      integer(job.proficiency, 0x7fffffff);
    }
    if (!p.ownedJobs.some((j) => j.id === p.jobId))
      throw new Error("Current job is not owned");
    integer(p.level, limits.level, 1);
    integer(p.exp, limits.exp);
    integer(p.maxHp, limits.hp, 1);
    integer(p.maxMp, limits.mp);
    integer(p.hp, p.maxHp);
    integer(p.mp, p.maxMp);
    distinct(p.conditionIds);
    p.conditionIds.forEach((id) => integer(id, 0x7fffffff, 1));
    this.conditions.validateActive(p.conditionIds);
    // Validate the actual death row's erase rules, including newly admitted
    // persistent conditions. A restore must not repair an unreachable state.
    this.conditions.validateStableLife(p.hp, p.conditionIds);
    if (
      !this.content.equipmentSystem &&
      (p.equipment.length !== 6 ||
        p.equipment.some((id, n) => id !== this.content.equipment[p.id]?.[n]))
    )
      throw new Error("Unimplemented equipment change");
    if (this.content.equipmentSystem) {
      if (
        this.content.equipmentSystem.catalog.characters[p.sourceId]?.jobId !==
        p.jobId
      )
        throw new Error("Equipment job disagrees with owned job");
      const projection = this.projectOwnedParameters(p);
      if (p.maxHp !== projection.maxHp || p.maxMp !== projection.maxMp)
        throw new Error(
          "Owned resource maximum disagrees with equipment/growth",
        );
    }
  }
  private rosterState(data: GameStateSnapshot) {
    return {
      roster: data.roster,
      party: data.party,
      equipmentStock: data.equipmentStock,
      releasedJobIds: data.releasedJobIds,
    };
  }
  private rosterCatalog() {
    const system = this.content.equipmentSystem;
    if (!system)
      throw new Error("Roster lifecycle equipment system is unavailable");
    const { initial: _, ...metadata } = this.content.rosterLifecycle;
    return { ...metadata, equipment: system.catalog };
  }
  get gil() {
    return this.data.gil;
  }
  get completedEncounters() {
    return this.data.completedBattles.filter((b) => b.outcome === "victory").map((b) => b.encounterId);
  }
  get inBattle() {
    return this.active !== null;
  }
  snapshot(): GameStateSnapshot {
    return structuredClone(this.data);
  }
  get initialization(): GameStateSnapshot["initialization"] {
    return this.data.initialization;
  }
  /** Capture every held record before the battle lease; a bounded development
   * roster cannot prove that a source character has never been owned. */
  sourceBattleGauEntry(field:BattleFieldState):BattleGauEntry{
    this.requireIdle();
    if(this.data.initialization!=='source-new-game'||!this.content.sourceNewGame||!this.data.nativeState)
      throw new Error('Gau mode requires the complete source-initialized owned owner');
    return parseBattleGauEntry({kind:'source-battle-gau-entry-v1',catalogHash:this.catalogHash,
      roster:this.data.roster.map(({id,sourceId,ownedId,enabled})=>({id,sourceId,ownedId,enabled})),
      party:this.data.party,field,fixedPreemptiveState:null});
  }
  /** Source domains and entry seed are returned by value. A read never creates
   * source state for a development checkpoint or authorizes a later mutation. */
  get nativeState(): SourceNativeState | null {
    return structuredClone(this.data.nativeState);
  }
  /** A shared-state snapshot is not a complete field/battle save game. */
  restore(snapshot: GameStateSnapshot | LegacyGameStateSnapshotV10 | LegacyGameStateSnapshotV11): void {
    this.requireIdle();
    const input = structuredClone(snapshot);
    let next: GameStateSnapshot;
    if (input.formatVersion === 10 || input.formatVersion === 11) {
      // Both historical compilers rejected positive GetValue. Check their
      // exact old shape before supplying the proven initial reserve; never
      // recompute it from battle receipts, or rewrite their content identity.
      keys(input, ownedSnapshotFields);
      if (!Array.isArray(input.roster)) throw new Error("Invalid legacy owned roster");
      for (const member of input.roster) keys(member, legacyOwnedMemberFields);
      if (!Array.isArray(input.completedBattles)) throw new Error("Invalid legacy battle receipts");
      for (const receipt of input.completedBattles) {
        keys(receipt, input.formatVersion === 10 ? "serial,encounterId" : "serial,encounterId,outcome");
        if (input.formatVersion === 11 && "outcome" in receipt && receipt.outcome !== "victory" && receipt.outcome !== "escaped")
          throw new Error("Invalid historical battle receipt outcome");
      }
      next = { ...input, formatVersion: 12,
        roster: input.roster.map((member) => ({ ...member, magicLearningValue: 0 })),
        completedBattles: input.formatVersion === 10
          ? input.completedBattles.map((receipt) => ({ ...receipt, outcome: "victory" }))
          : input.completedBattles };
    } else next = input;
    this.validate(next);
    this.data = next;
    this.revision++;
  }
  private requireIdle() {
    if (this.menuPublication)
      throw new Error("Owned menu publication is in progress");
    if (this.transportationPublication)
      throw new Error("Owned transportation publication is in progress");
    if (this.active)
      throw new Error("Owned state is reserved by an active battle");
  }
  private commitMenuPresentation(next: GameStateSnapshot, validate: () => void, publish: () => void): void {
    validate();
    if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
      throw new Error("Menu publication must be synchronous");
    this.menuPublication = true;
    try {
      const result: unknown = publish();
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new Error("Menu publication must be synchronous");
      // The prepared actor publisher finishes its last fallible validation
      // while the old owned state is still live, then writes only prepared data.
      this.data = next; this.revision++;
    } finally { this.menuPublication = false; }
  }
  private readTransportations(data: GameStateSnapshot) {
    if (!data.nativeState || !this.content.sourceNewGame)
      throw new Error("Missing source transportation ownership");
    return structuredClone(data.nativeState.ownedTransportations);
  }
  private projectTransportation(data: GameStateSnapshot, command: TransportationStateCommand) {
    if (!data.nativeState || !this.content.sourceNewGame)
      throw new Error("Missing source transportation ownership");
    const change = projectTransportationState(this.content.sourceNewGame.transportation,
      data.nativeState.ownedTransportations, command);
    const next = structuredClone(data);
    const index = next.nativeState!.ownedTransportations.findIndex((record) => record.id === command.id);
    next.nativeState!.ownedTransportations[index] = structuredClone(change.after);
    this.validate(next);
    return { next, ...change };
  }
  private prepareTransportation(command: TransportationStateCommand): FieldTransportationTransaction {
    this.requireIdle();
    const { next, ...change } = this.projectTransportation(this.data, command), revision = this.revision;
    const validate = () => {
      this.requireIdle();
      if (this.revision !== revision) throw new Error("Stale transportation transaction");
    };
    const commitWith = (publish: () => void) => {
      validate();
      if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
        throw new Error("Transportation publication must be synchronous");
      this.transportationPublication = true;
      try {
        const result: unknown = publish();
        if (result && typeof (result as { then?: unknown }).then === "function")
          throw new Error("Transportation publication must be synchronous");
        // Everything fallible was prepared/validated before the external
        // assignment-only publication. The owned publish cannot now fail.
        this.data = next;
        this.revision++;
      } finally { this.transportationPublication = false; }
    };
    return { ...change, validate, commit: () => commitWith(() => {}), commitWith };
  }
  private projectInventoryEvent(
    data: GameStateSnapshot,
    command: FieldInventoryCommand,
    treasure = false,
  ) {
    const next = structuredClone(data);
    let result: boolean | null = null;
    if (command.kind === "grant-item" || command.kind === "remove-item") {
      integer(command.id, 0x7fffffff, 1);
      integer(command.count, 0x7fffffff, treasure && command.kind === "grant-item" ? 0 : 1);
      if (!this.content.items[command.id])
        throw new Error("Unimplemented inventory content: " + command.id);
      let entry = next.items.find((i) => i.id === command.id);
      if (command.kind === "grant-item") {
        if (!entry) next.items.push((entry = { id: command.id, count: 0 }));
        entry.count = Math.min(
          this.content.limits.item,
          entry.count + command.count,
        );
      } else if (entry) {
        // RemoveOwnedItem exhausts the stack even when the requested count is
        // greater. A zero stack is our canonical equivalent of source removal.
        entry.count = Math.max(0, entry.count - command.count);
      }
      next.items.sort((a, b) => a.id - b.id);
    } else if (
      command.kind === "grant-equipment" ||
      command.kind === "remove-equipment"
    ) {
      const system = this.content.equipmentSystem;
      if (!system) throw new Error("Equipment system is unavailable");
      if (treasure && command.kind === "grant-equipment" && command.count === 0) {
        const definition = system.catalog.definitions[command.id];
        if (!definition || definition.id !== command.id || definition.empty)
          throw new Error("Unknown treasure equipment ownership identity");
        if (!next.equipmentStock.some((s) => s.id === command.id))
          next.equipmentStock.push({ id: command.id, count: 0 });
        next.equipmentStock.sort((a, b) => a.id - b.id);
      } else next.equipmentStock = projectEquipmentOwnership(
        system.catalog,
        next.roster.filter((p) => p.enabled),
        next.equipmentStock,
        command,
      );
    } else if (command.kind === "grant-magic-stone" || command.kind === "remove-magic-stone") {
      integer(command.id, 0x7fffffff, 1); integer(command.count, 0x7fffffff, -2147483648);
      const catalog = this.content.magicStones;
      if (!catalog || !next.nativeState) throw new Error("Magic stone ownership is unavailable in this entry");
      if (command.kind === "grant-magic-stone")
        next.nativeState.ownedMagicStones = projectAcquireMagicStone(catalog, next.nativeState.ownedMagicStones, command.id);
      else {
        const projection = projectRemoveInventoryMagicStone(catalog, next.nativeState.ownedMagicStones,
          this.magicStoneRoster(next), command.id, this.magicStonePassives(next));
        next.nativeState.ownedMagicStones = projection.heldIds;
        for (const id of projection.changedIds) {
          const member = next.roster.find(member => member.id === id)!;
          Object.assign(member, this.projectMagicStoneRemoval(member));
        }
      }
    } else if (command.kind === "grant-gil") {
      integer(command.amount, 0x7fffffff);
      next.gil = Math.min(this.content.limits.gil, next.gil + command.amount);
      next.totalGil += command.amount;
    } else if (command.kind === "pay-gil") {
      integer(command.amount, 0x7fffffff);
      result = next.gil >= command.amount;
      if (result) next.gil -= command.amount;
    } else throw new Error("Unknown field inventory command");
    this.validate(next);
    return { next, result };
  }
  private treasureInventoryRead(data: GameStateSnapshot): TreasureInventoryRead {
    return {
      gil: data.gil,
      normalOwnedItems: [
        ...data.items.filter((item) => !this.content.items[item.id]!.important),
        ...data.equipmentStock,
      ].map((item) => ({ ...item })).sort((a, b) => a.id - b.id),
    };
  }
  private shopInventoryRead(data: GameStateSnapshot): ShopInventoryRead {
    const system = this.content.equipmentSystem;
    if (!system) throw new Error("Shop equipment ownership is unavailable");
    return { gil: data.gil, entries: [
      ...data.items.map((item) => ({ ...item, kind: "item" as const, equipped: 0 })),
      ...equipmentAvailability(system.catalog, data.roster.filter((p) => p.enabled), data.equipmentStock)
        .map(({ id, count, equipped }) => ({ id, count, equipped, kind: "equipment" as const })),
    ] };
  }
  shopOptions(groupId: number) {
    this.requireIdle();
    return this.projectShopOptions(this.data, groupId);
  }
  private projectShopOptions(data: GameStateSnapshot, groupId: number) {
    const catalog = this.content.shops;
    if (!catalog) throw new Error("Ordinary shop rules are unavailable");
    const inventory = this.shopInventoryRead(data);
    return { groupId, name: catalog.groups.find((group) => group.id === groupId)?.name ?? "",
      gil: inventory.gil, buy: shopBuyOptions(catalog, groupId, inventory),
      sell: shopSellOptions(catalog, groupId, inventory) };
  }
  /** One candidate owns both stock and money. The field host controls whether
   * this group is currently open; stale or repeated publication is rejected. */
  prepareShopTrade(groupId: number, request: ShopTradeRequest) {
    this.requireIdle();
    const catalog = this.content.shops;
    if (!catalog) throw new Error("Ordinary shop rules are unavailable");
    const plan = projectShopTrade(catalog, groupId, request, this.shopInventoryRead(this.data));
    const revision = this.revision;
    let next = this.snapshot();
    for (const command of plan.commands) {
      const projected = this.projectInventoryEvent(next, command);
      if (projected.result === false) throw new Error("Shop payment failed");
      next = projected.next;
    }
    const stock = this.shopInventoryRead(next);
    if (stock.gil !== plan.gilAfter || stock.entries.find((entry) => entry.id === plan.contentId)?.count !== plan.countAfter)
      throw new Error("Shop ownership projection differs from its trade plan");
    return { plan: structuredClone(plan), commit: () => {
      this.requireIdle();
      if (revision !== this.revision) throw new Error("Stale shop trade transaction");
      this.data = next;
      this.revision++;
    } };
  }
  private prepareTreasureReward(command: TreasureRewardCommand): FieldInventoryTransaction {
    this.requireIdle();
    if (!["grant-gil", "grant-item", "grant-equipment"].includes(command.kind))
      throw new Error("Invalid treasure reward command");
    const { next, result } = this.projectInventoryEvent(this.data, command, true);
    const revision = this.revision;
    return { result, commit: () => {
      this.requireIdle();
      if (this.revision !== revision) throw new Error("Stale treasure inventory transaction");
      this.data = next;
      this.revision++;
    } };
  }
  private prepareInventoryEvent(
    command: FieldInventoryCommand,
  ): FieldInventoryTransaction {
    this.requireIdle();
    const { next, result } = this.projectInventoryEvent(this.data, command),
      revision = this.revision;
    return {
      result,
      commit: () => {
        this.requireIdle();
        if (this.revision !== revision)
          throw new Error("Stale field inventory transaction");
        this.data = next;
        this.revision++;
      },
    };
  }
  private projectPartyEvent(data: GameStateSnapshot, command: PartyCommand) {
    const next = structuredClone(data);
    const preview = previewPartyCommand(next.party, next.roster, command);
    next.party = preview.state;
    this.validate(next);
    return {
      next,
      activeMembers: preview.activeMembers,
      refreshActors: preview.refreshActors,
      appearance: this.projectPartyAppearance(next),
    };
  }
  private preparePartyEvent(command: PartyCommand): PartyEventTransaction {
    this.requireIdle();
    const { next, ...projection } = this.projectPartyEvent(this.data, command);
    const revision = this.revision;
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision)
        throw new Error("Stale field party transaction");
    };
    const commitWith = (publish: () => void) => {
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    };
    return {
      ...projection,
      commit: () => commitWith(() => {}), commitWith,
    };
  }
  /** Menu organization changes only saved cells and the selected group. It
   * never performs the source Join/Unlock lifecycle or changes owned resources. */
  /** Shared source UI transaction; the UI never owns a roster or durable slot state. */
  private sourceSelectionRead(data: GameStateSnapshot) {
    return {party:structuredClone(data.party),roster:data.roster.map(({id,sourceId,enabled})=>({id,sourceId,enabled}))};
  }
  readonly fieldSourcePartySelection: FieldSourcePartySelectionPort = {
    read:()=>this.sourceSelectionRead(this.data),
    capture:()=>{this.requireIdle();const revision=this.revision,current=this.sourceSelectionRead(this.data);
      return {current,validate:()=>{if(this.inBattle||this.revision!==revision) throw new Error('Stale source party selection ownership');}};},
    prepare:(model,outcome)=>this.prepareSourcePartySelection(model,outcome),
  };
  prepareSourcePartySelection(model:SourcePartySelectionModel,outcome:SourcePartySelectionOutcome) {
    this.requireIdle(); const next=this.snapshot(),revision=this.revision;
    next.party=previewSourcePartySelection(model,this.sourceSelectionRead(next),outcome); this.validate(next);
    let consumed=false;
    const validate=()=>{this.requireIdle();if(consumed||this.revision!==revision) throw new Error('Stale source party selection transaction');};
    return {appearance:this.projectPartyAppearance(next),confirmed:outcome.kind==='confirm',validate,
      commitWith:(publish:()=>void)=>{this.commitMenuPresentation(next,validate,publish);consumed=true;}};
  }
  preparePartyMenu(request: PartyMenuRequest) {
    this.requireIdle();
    const next = this.snapshot(), revision = this.revision;
    const preview = previewPartyMenu(next.party, next.roster, request);
    const activeChanged = next.party.selectedSlot !== preview.state.selectedSlot ||
      canonical(activePartyMembers(next.party)) !== canonical(preview.activeMembers);
    next.party = preview.state;
    this.validate(next);
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision) throw new Error("Stale party menu transaction");
    };
    const project = (member: OwnedCharacter, row: "front" | "back") => this.projectOwnedBattlePlayer(member, row);
    const commitWith = (publish: () => void) => {
      if (!preview.changed) { validate(); consumed = true; return; }
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    };
    return {
      changed: preview.changed,
      activeChanged,
      activeMembers: preview.activeMembers,
      appearance: this.projectPartyAppearance(next),
      /** Projection from the same private candidate, without opening a lease
       * or changing the fixed entry of any current battle. */
      get candidatePlayers(): Combatant[] {
        validate();
        return activePartyMembers(next.party).map(({ id, row }) =>
          project(next.roster.find(member => member.id === id)!, row));
      },
      validate,
      commit: () => commitWith(() => {}),
      commitWith,
    };
  }
  private projectRosterEvent(data: GameStateSnapshot, command: RosterCommand) {
    const next = structuredClone(data);
    let candidateRosterSize = next.roster.length;
    const preview = prepareRosterLifecycle(
      this.rosterState(next),
      command,
      this.rosterCatalog(),
      {
        validateMember: (member) =>
          this.validateOwnedMember(member, candidateRosterSize),
        initialize: ({ sourceId, ownedId, releasedJobIds }) => {
          const entry = Object.entries(this.content.characterInitializations ?? {})
            .find(([, template]) => template.initial.sourceId === sourceId);
          if (!entry) throw new Error("Unimplemented source character initialization: " + sourceId);
          const [id, template] = entry;
          const initialized = createOwnedCharacter(template, {
            id, ownedId, releasedJobIds, learnedAbilityIds: next.learnedAbilityIds,
          });
          next.learnedAbilityIds.push(...initialized.learnedAbilityIdsToAppend);
          if (initialized.nameBinding)
            next.characterNames[initialized.nameBinding.key] = initialized.nameBinding.value;
          candidateRosterSize++;
          return { ...initialized.member, magicLearningValue: 0,
            growth: this.content.characterGrowth?.[id] ? initialCharacterGrowth(this.content.characterGrowth[id]) : null };
        },
        projectEquipment: (member) => {
          const projected = this.projectOwnedParameters(member);
          member.maxHp = projected.maxHp;
          member.maxMp = projected.maxMp;
          member.hp = Math.min(member.hp, member.maxHp);
          member.mp = Math.min(member.mp, member.maxMp);
          member.conditionIds = this.conditions.updateDying(
            member.hp,
            member.maxHp,
            member.conditionIds,
          );
          return member;
        },
        correctLevel: (member, targetLevel) => this.projectGrowth(member,
          { kind: "correct-level", targetLevel }),
        recover: (member) => recoverJoinedCharacter(member, this.conditions),
        removeMagicStone: (member) => this.projectMagicStoneRemoval(member),
      },
    );
    Object.assign(next, preview.state);
    this.validate(next);
    return {
      next,
      activeMembers: preview.activeMembers,
      refreshActors: preview.refreshActors,
      appearance: this.projectPartyAppearance(next),
    };
  }
  private prepareRosterEvent(
    command: RosterCommand,
  ): RosterLifecycleTransaction {
    this.requireIdle();
    const { next, ...projection } = this.projectRosterEvent(this.data, command);
    const revision = this.revision;
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision)
        throw new Error("Stale field roster transaction");
    };
    const commitWith = (publish: () => void) => {
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    };
    return {
      ...projection,
      commit: () => commitWith(() => {}), commitWith,
    };
  }
  private projectOwnedConditionEvent(data: GameStateSnapshot, command: OwnedConditionCommand) {
    const next = structuredClone(data);
    const preview: { roster: GameStateSnapshot["roster"]; targets: string[];
      steps: { targetId: string; roster: GameStateSnapshot["roster"] }[]; coreI0Writes?: readonly number[] } =
      command.kind === "remove-condition" && command.conditionType === 0
      ? projectOwnedConditionRemoveAll(next.roster, next.party, command, this.conditions)
      : projectOwnedCondition(next.roster, next.party, command, this.ownedConditionDefinitions);
    next.roster = preview.roster;
    this.validate(next);
    return { next, targets: preview.targets,
      ...(preview.coreI0Writes !== undefined ? { coreI0Writes: preview.coreI0Writes } : {}),
      steps: preview.steps.map((step) => ({
      targetId: step.targetId,
      appearance: this.projectPartyAppearance({ ...next, roster: step.roster }),
      ...(this.content.partyActors ? { puppetRoster: this.projectPuppetRoster({ ...next, roster: step.roster }) } : {}),
      setDummy: false as const, affectLeader: true as const,
    })) };
  }
  private prepareOwnedConditionEvent(command: OwnedConditionCommand): OwnedConditionTransaction {
    this.requireIdle();
    const { next, ...projection } = this.projectOwnedConditionEvent(this.data, command);
    const revision = this.revision;
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision) throw new Error("Stale field owned condition transaction");
    };
    const commitWith = (publish: () => void) => {
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    };
    return { ...projection, commit: () => commitWith(() => {}), commitWith };
  }
  private projectFieldRecoveryState(data: GameStateSnapshot, command: FieldRecoveryCommand) {
    const next = structuredClone(data);
    const preview = projectFieldRecovery(next.roster, next.party, command, this.conditions);
    next.roster = preview.roster;
    this.validate(next);
    return { next, targets: [...preview.targets], steps: preview.steps.map(step => {
      // Every source-ordered refresh candidate must be a valid owned state,
      // including unchanged targets. Presentation reads only this projection.
      const intermediate = { ...next, roster: step.roster };
      this.validate(intermediate);
      return { targetId: step.targetId, appearance: this.projectPartyAppearance(intermediate),
        ...(this.content.partyActors ? { puppetRoster: this.projectPuppetRoster(intermediate) } : {}),
        setDummy: false as const, affectLeader: true as const };
    }) };
  }
  private prepareFieldRecovery(command: FieldRecoveryCommand): FieldRecoveryTransaction {
    this.requireIdle();
    const { next, ...projection } = this.projectFieldRecoveryState(this.data, command), revision = this.revision;
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision) throw new Error("Stale field recovery transaction");
    };
    const commitWith = (publish: () => void) => {
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    };
    return { ...projection, commit: () => commitWith(() => {}), commitWith };
  }
  private prepareScriptRandom(upper: number): ReturnType<FieldScriptRandomPort["prepare"]> {
    this.requireIdle(); validateScriptRandomUpper(upper);
    if (!this.data.fieldRandom) throw new Error("Missing field random ownership");
    const next = this.snapshot(), revision = this.revision, value = drawFieldRandom(next.fieldRandom!, 1, upper);
    this.validate(next); let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision) throw new Error("Stale source script random transaction");
    };
    return { value, validate, commitWith: publish => {
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    } };
  }
  /** Map initialization runs against this private draft. Publishing rebinds the
   * same ports to live state so later events keep a single state owner. */
  prepareFieldState(options: { scriptRandom?: WebSourceScriptRandom } = {}): {
    ports: {
      inventory: FieldInventoryPort;
      treasure: FieldTreasurePort;
      party: FieldPartyPort;
      sourcePartySelectionPort: FieldSourcePartySelectionPort;
      roster: FieldRosterPort;
      ownedConditions: FieldOwnedConditionPort;
      recovery: FieldRecoveryPort;
      scriptRandom?: FieldScriptRandomPort;
      puppetRoster: FieldPuppetRosterPort;
      messageNames: FieldMessageNamesPort;
      transportation?: FieldTransportationPort;
      shop: { validate(groupId: number): void };
      fieldSteps?: FieldConditionPort;
      partyAppearance?: { catalog: PartyActorCatalog; current(): PartyAppearanceCandidate };
      movementBlocker: (transportationId: number | null, manual: boolean) => string | null;
    };
    /** Seal the initializer's existing draft generation for map publication. */
    sealPublication(): () => boolean;
    commit(): boolean;
  } {
    this.requireIdle();
    if (options.scriptRandom !== undefined && options.scriptRandom !== WEB_SOURCE_SCRIPT_RANDOM)
      throw new Error("Unknown source script random policy");
    const revision = this.revision;
    let data = this.snapshot(),
      generation = 0,
      published = false,
      transportationPublishing = false,
      sealedGeneration: number | undefined,
      publicationRevision: number | null = null;
    const scriptRandom: FieldScriptRandomPort = { prepare: upper => {
      if (published) return this.prepareScriptRandom(upper);
      this.requireIdle(); validateScriptRandomUpper(upper);
      if (!data.fieldRandom) throw new Error("Missing field random ownership");
      const next = structuredClone(data), version = generation;
      const value = drawFieldRandom(next.fieldRandom!, 1, upper);
      this.validate(next); let consumed = false;
      const validate = () => {
        this.requireIdle();
        if (consumed || transportationPublishing || published || generation !== version || this.revision !== revision)
          throw new Error("Stale candidate source script random transaction");
      };
      return { value, validate, commitWith: publish => {
        validate();
        if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
          throw new Error("Source script random publication must be synchronous");
        transportationPublishing = true;
        try { const result: unknown = publish();
          if (result && typeof (result as {then?: unknown}).then === "function")
            throw new Error("Source script random publication must be synchronous");
          data = next; generation++; consumed = true;
        } finally { transportationPublishing = false; }
      } };
    } };
    const inventory: FieldInventoryPort = {
      prepare: (command) => {
        if (published) return this.prepareInventoryEvent(command);
        const { next, result } = this.projectInventoryEvent(data, command),
          version = generation;
        return {
          result,
          commit: () => {
            if (transportationPublishing || published || generation !== version)
              throw new Error("Stale candidate inventory transaction");
            data = next;
            generation++;
          },
        };
      },
    };
    const treasure: FieldTreasurePort = {
      limits: { ...this.fieldTreasure.limits },
      read: () => this.treasureInventoryRead(published ? this.data : data),
      prepare: (command) => {
        if (published) return this.prepareTreasureReward(command);
        if (!["grant-gil", "grant-item", "grant-equipment"].includes(command.kind))
          throw new Error("Invalid treasure reward command");
        const { next, result } = this.projectInventoryEvent(data, command, true);
        const version = generation;
        return { result, commit: () => {
          if (transportationPublishing || published || generation !== version)
            throw new Error("Stale candidate treasure transaction");
          data = next;
          generation++;
        } };
      },
    };
    const party: FieldPartyPort = {
      prepare: (command) => {
        if (published) return this.preparePartyEvent(command);
        const { next, ...projection } = this.projectPartyEvent(data, command),
          version = generation;
        const commitWith = (publish: () => void) => {
          if (transportationPublishing || published || generation !== version)
            throw new Error("Stale candidate party transaction");
          if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
            throw new Error("Candidate party publication must be synchronous");
          transportationPublishing = true;
          try {
            const result: unknown = publish();
            if (result && typeof (result as { then?: unknown }).then === "function")
              throw new Error("Candidate party publication must be synchronous");
            data = next; generation++;
          } finally { transportationPublishing = false; }
        };
        return {
          ...projection,
          commit: () => commitWith(() => {}), commitWith,
        };
      },
    };
    const sourcePartySelectionPort: FieldSourcePartySelectionPort = {
      read:()=>this.sourceSelectionRead(published?this.data:data),
      capture:()=>{
        if(published)return this.fieldSourcePartySelection.capture();
        const version=generation,owner=data,current=this.sourceSelectionRead(data);
        // The same map port survives its one publication. Bind that exact
        // draft identity/revision rather than granting a newly selected bank.
        return {current,validate:()=>{if(this.inBattle||generation!==version||data!==owner||
          (published?(this.data!==owner||this.revision!==publicationRevision):this.revision!==revision))
          throw new Error('Stale candidate source party selection owner');}};
      },
      prepare:(model,outcome)=>{
        if(published)return this.prepareSourcePartySelection(model,outcome);
        const next=structuredClone(data),version=generation;
        next.party=previewSourcePartySelection(model,this.sourceSelectionRead(data),outcome);this.validate(next);let consumed=false;
        const validate=()=>{this.requireIdle();if(consumed||published||transportationPublishing||generation!==version||this.revision!==revision)
          throw new Error('Stale candidate source party selection transaction');};
        return {appearance:this.projectPartyAppearance(next),confirmed:outcome.kind==='confirm',validate,commitWith:(publish)=>{
          validate();if(typeof publish!=='function'||publish.constructor.name==='AsyncFunction')throw new Error('Source party publication must be synchronous');
          transportationPublishing=true;try {const result:unknown=publish();if(result&&typeof (result as {then?:unknown}).then==='function')
            throw new Error('Source party publication must be synchronous');data=next;generation++;consumed=true;}finally{transportationPublishing=false;}
        }};
      },
    };
    const roster: FieldRosterPort = {
      prepare: (command) => {
        if (published) return this.prepareRosterEvent(command);
        const { next, ...projection } = this.projectRosterEvent(data, command),
          version = generation;
        const commitWith = (publish: () => void) => {
          if (transportationPublishing || published || generation !== version)
            throw new Error("Stale candidate roster transaction");
          if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
            throw new Error("Candidate roster publication must be synchronous");
          transportationPublishing = true;
          try {
            const result: unknown = publish();
            if (result && typeof (result as { then?: unknown }).then === "function")
              throw new Error("Candidate roster publication must be synchronous");
            data = next; generation++;
          } finally { transportationPublishing = false; }
        };
        return {
          ...projection,
          commit: () => commitWith(() => {}), commitWith,
        };
      },
    };
    const fieldSteps: FieldConditionPort = {
      prepareStep: (transportationId) => {
        if (published) return this.prepareFieldStep(transportationId);
        const { next, result } = this.projectFieldStep(data, transportationId),
          version = generation;
        return {
          result,
          commit: () => {
            if (transportationPublishing || this.transportationPublication || generation !== version || (published &&
              (this.active || this.revision !== publicationRevision)))
              throw new Error("Stale candidate field step transaction");
            data = next;
            generation++;
            if (published) {
              this.data = next;
              this.revision++;
            }
          },
        };
      },
    };
    const ownedConditions: FieldOwnedConditionPort = {
      prepare: (command) => {
        if (published) return this.prepareOwnedConditionEvent(command);
        this.requireIdle();
        if (this.revision !== revision) throw new Error("Stale candidate owned condition owner");
        const { next, ...projection } = this.projectOwnedConditionEvent(data, command), version = generation;
        let consumed = false;
        const validate = () => {
          this.requireIdle();
          if (consumed || transportationPublishing || published || generation !== version || this.revision !== revision)
            throw new Error("Stale candidate owned condition transaction");
        };
        const commitWith = (publish: () => void) => {
          validate();
          if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
            throw new Error("Candidate owned condition publication must be synchronous");
          transportationPublishing = true;
          try {
            const result: unknown = publish();
            if (result && typeof (result as { then?: unknown }).then === "function")
              throw new Error("Candidate owned condition publication must be synchronous");
            data = next; generation++; consumed = true;
          } finally { transportationPublishing = false; }
        };
        return { ...projection, commit: () => commitWith(() => {}), commitWith };
      },
    };
    const recovery: FieldRecoveryPort = {
      prepare: (command) => {
        if (published) return this.prepareFieldRecovery(command);
        this.requireIdle();
        if (this.revision !== revision) throw new Error("Stale candidate field recovery owner");
        const { next, ...projection } = this.projectFieldRecoveryState(data, command), version = generation;
        let consumed = false;
        const validate = () => {
          this.requireIdle();
          if (consumed || transportationPublishing || published || generation !== version || this.revision !== revision)
            throw new Error("Stale candidate field recovery transaction");
        };
        const commitWith = (publish: () => void) => {
          validate();
          if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
            throw new Error("Candidate field recovery publication must be synchronous");
          transportationPublishing = true;
          try {
            const result: unknown = publish();
            if (result && typeof (result as { then?: unknown }).then === "function")
              throw new Error("Candidate field recovery publication must be synchronous");
            data = next; generation++; consumed = true;
          } finally { transportationPublishing = false; }
        };
        return { ...projection, commit: () => commitWith(() => {}), commitWith };
      },
    };
    const transportation: FieldTransportationPort | undefined = data.nativeState && this.content.sourceNewGame ? {
      catalog: structuredClone(this.content.sourceNewGame.transportation),
      read: () => this.readTransportations(published ? this.data : data),
      prepare: (command) => {
        if (published) return this.prepareTransportation(command);
        const { next, ...change } = this.projectTransportation(data, command), version = generation;
        const validate = () => {
          this.requireIdle();
          if (transportationPublishing || published || generation !== version || this.revision !== revision)
            throw new Error("Stale candidate transportation transaction");
        };
        const commitWith = (publish: () => void) => {
          validate();
          if (typeof publish !== "function" || publish.constructor.name === "AsyncFunction")
            throw new Error("Transportation publication must be synchronous");
          transportationPublishing = true;
          this.transportationPublication = true;
          try {
            const result: unknown = publish();
            if (result && typeof (result as { then?: unknown }).then === "function")
              throw new Error("Transportation publication must be synchronous");
            data = next;
            generation++;
          } finally {
            transportationPublishing = false;
            this.transportationPublication = false;
          }
        };
        return { ...change, validate, commit: () => commitWith(() => {}), commitWith };
      },
    } : undefined;
    return {
      ports: {
        sourcePartySelectionPort,
        inventory,
        treasure,
        party,
        roster,
        ownedConditions,
        recovery,
        ...(options.scriptRandom === WEB_SOURCE_SCRIPT_RANDOM ? { scriptRandom } : {}),
        puppetRoster: { current: () => this.projectPuppetRoster(published ? this.data : data) },
        messageNames: { prepare: (refs) => {
          if (published) return this.fieldMessageNames.prepare(refs);
          const version = generation, current = data;
          return this.prepareMessageNames(current, refs,
            () => !transportationPublishing && !this.transportationPublication && !published &&
              generation === version && data === current && this.revision === revision);
        } },
        ...(transportation ? { transportation } : {}),
        shop: { validate: (groupId) => { this.projectShopOptions(published ? this.data : data, groupId); } },
        ...(this.fieldConditions ? { fieldSteps } : {}),
        ...(this.content.partyActors ? { partyAppearance: {
          catalog: this.content.partyActors,
          current: () => this.projectPartyAppearance(published ? this.data : data),
        } } : {}),
        movementBlocker: (transportationId, manual) =>
          this.movementBlocker(published ? this.data : data, transportationId, manual),
      },
      sealPublication: () => {
        this.requireIdle();
        if (sealedGeneration !== undefined || transportationPublishing || published || this.revision !== revision)
          throw new Error("Cannot seal a stale or already sealed map owned draft");
        const version = sealedGeneration = generation;
        return () => !transportationPublishing && !this.transportationPublication && !this.menuPublication &&
          !published && !this.active && this.revision === revision && generation === version;
      },
      commit: () => {
        if (transportationPublishing || this.transportationPublication || this.menuPublication || published || this.active || this.revision !== revision ||
            sealedGeneration !== undefined && generation !== sealedGeneration)
          return false;
        this.data = data;
        this.revision++;
        published = true;
        publicationRevision = this.revision;
        return true;
      },
    };
  }
  get activeParty() {
    return activePartyMembers(this.data.party);
  }
  private projectPuppetRoster(data: GameStateSnapshot) {
    return projectFieldPuppetRoster(data.roster, data.party, this.ownedConditionDefinitions);
  }
  private prepareMessageNames(data: GameStateSnapshot, refs: readonly CharacterMessageNameRef[],
    current: () => boolean): PreparedFieldMessageNames {
    const validate = () => {
      if (!current()) throw new Error("Stale field message names projection");
    };
    validate();
    const names = projectOwnedMessageNames({
      roster: data.roster.map(({ id, sourceId, name }) => ({ id, sourceId, name })),
      bindings: data.roster.flatMap(member => {
        const template = this.content.characterInitializations?.[member.id];
        return template && template.nameTag !== null
          ? [{ id: member.id, sourceId: template.initial.sourceId, tag: template.nameTag }] : [];
      }),
      characterNames: data.characterNames,
    }, refs);
    return Object.freeze({ get names() { return [...names]; }, validate });
  }
  private projectPartyAppearance(data: GameStateSnapshot): PartyAppearanceCandidate {
    const parties = data.party.slots.map((slot) => slot.flatMap((cell, index): PartyActorMember[] => {
      if (cell.id === null) return [];
      const p = data.roster.find((p) => p.id === cell.id)!;
      return [{ id: p.id, sourceId: p.sourceId, jobId: p.jobId, index: index as 0 | 1 | 2 | 3,
        row: cell.row, enabled: p.enabled, conditionIds: [...p.conditionIds] }];
    }));
    return { parties, activeMembers: structuredClone(parties[data.party.selectedSlot]!) };
  }
  get fieldPartyAppearance() {
    return this.content.partyActors ? { catalog: this.content.partyActors,
      current: () => this.projectPartyAppearance(this.data) } : undefined;
  }
  private projectFieldStep(data: GameStateSnapshot, transportationId: number) {
    if (!this.fieldConditions)
      throw new Error("地图状态结算的来源规则尚未载入");
    const next = structuredClone(data);
    const result = this.fieldConditions.projectStep(
      activePartyMembers(next.party).map(({ id }) => next.roster.find((p) => p.id === id)!),
      transportationId,
    );
    for (const member of result.members) {
      const target = next.roster.find((p) => p.id === member.id)!;
      target.hp = member.hp;
      target.conditionIds = [...member.conditionIds];
    }
    this.validate(next);
    return { next, result };
  }
  private prepareFieldStep(transportationId: number) {
    this.requireIdle();
    const revision = this.revision;
    const { next, result } = this.projectFieldStep(this.data, transportationId);
    return {
      result,
      commit: () => {
        if (this.active || this.revision !== revision)
          throw new Error("Stale field step transaction");
        this.data = next;
        this.revision++;
      },
    };
  }
  private movementBlocker(data: GameStateSnapshot, transportationId: number | null, _manual: boolean): string | null {
    const poisoned = activePartyMembers(data.party).some(
      ({ id }) =>
        this.conditions.poisonIds(
          data.roster.find((p) => p.id === id)!.conditionIds,
        ).length > 0,
    );
    if (!poisoned) return null;
    if (!this.fieldConditions)
      return "中毒的地图行走伤害尚未迁移；可在菜单中解除中毒后继续。";
    if (transportationId === null)
      return "当前交通状态尚未确定，无法结算地图毒伤；可在菜单中解除中毒。";
    try {
      this.projectFieldStep(data, transportationId);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  get fieldMovementBlocker() {
    return this.movementBlocker(this.data, null, true);
  }
  fieldMoveBlocker(transportationId: number | null, manual: boolean): string | null {
    return this.movementBlocker(this.data, transportationId, manual);
  }
  get battlePartyBlocker(): string | null {
    const members = this.activeParty;
    if (!members.length) return "当前编队没有成员，无法开始战斗";
    const missing = members.find(({ id }) => !this.definitions.has(id));
    if (missing) return "角色的战斗动作与表现尚未迁移：" + this.data.roster.find((p) => p.id === missing.id)!.name;
    return null;
  }
  partyPlayers(party: PartyState = this.data.party): Combatant[] {
    validatePartyState(party, this.data.roster);
    return activePartyMembers(party).map(({ id, row }) =>
      this.projectOwnedBattlePlayer(this.data.roster.find((p) => p.id === id)!, row));
  }
  private projectOwnedBattlePlayer(p: OwnedCharacter, row: "front" | "back"): Combatant {
    const definition = this.definitions.get(p.id);
    if (!definition) throw new Error("Unimplemented owned character battle definition: " + p.id);
    if (definition.sourceId !== p.sourceId || definition.side !== "player")
      throw new Error("Owned character battle definition identity mismatch");
    const {
      equipment: _,
      enabled: _enabled,
      ownedId: _ownedId,
      jobId: _job,
      additionalLevel: _additionalLevel,
      magicStoneId: _magicStone,
      ownedJobs: _jobs,
      abilities: _abilities,
      growth: _growth,
      ...progress
    } = p;
    return {
      ...structuredClone(definition),
      ...structuredClone(progress),
      row,
      ...(p.abilities ? { ownedAbilities: {
        sourceId: p.sourceId, jobId: p.jobId, magicStoneId: p.magicStoneId,
        abilities: structuredClone(p.abilities),
      } } : {}),
      ...(this.content.equipmentSystem ? this.projectOwnedParameters(p) : {}),
      atb: 0,
      queued: false,
      behavior: null,
    };
  }
  private prepareBattlePlayerBorrow(rawPlan: BattlePlayerPlan, initialPlayers: readonly Combatant[]): BattlePlayerBorrow {
    const plan = parseBattlePlayerPlan(rawPlan);
    const owners = new Map<string, OwnedCharacter>();
    const admit = (id: string): OwnedCharacter => {
      const matches = this.data.roster.filter(member => member.id === id);
      if (matches.length !== 1) throw new Error("Missing or ambiguous borrowed player owner");
      const member = matches[0]!;
      if (member.id.startsWith("player:dynamic:")) throw new Error("Reserved dynamic battle player owner identity");
      owners.set(id, member);
      return member;
    };
    const group = (index: 0 | 1 | 2): BattlePlayerGroupSlot[] => this.data.party.slots[index].map(cell => {
      if (cell.id === null) return { ownedId: null, row: cell.row };
      const member = admit(cell.id);
      return { ownedId: member.id, sourceId: member.sourceId, row: cell.row };
    });
    const initial = group(this.data.party.selectedSlot);
    for (const sourceId of plan.sourceIds) {
      // Disabled held records remain candidates. No AddFromMaster, Join or
      // persistent availability/party transition is performed by a battle.
      const matches = this.data.roster.filter(member => member.sourceId === sourceId);
      if (matches.length !== 1) throw new Error("Missing or ambiguous borrowed source owner: " + sourceId);
      admit(matches[0]!.id);
    }
    const groups: BattlePlayerBorrow["groups"] = {};
    for (const index of plan.groups) groups[index] = group(index);
    const candidates = [...owners.values()].map(member => {
      const entered = initialPlayers.find(player => player.id === member.id);
      if (entered) return structuredClone(entered);
      const definition = this.definitions.get(member.id);
      if (!definition) throw new Error("Unimplemented owned character battle definition: " + member.id);
      return this.projectOwnedBattlePlayer(member, definition.row);
    });
    const system = this.content.equipmentSystem;
    const qualification: BattleEntryInventory | null = system ? {
      equipmentCatalog: structuredClone(system.catalog),
      // Enabled nonparticipants already occupy inventory copies. Add each
      // admitted disabled owner once so later eligibility cannot reuse gear.
      equipmentStock: equipmentAvailability(system.catalog,
        this.data.roster.filter(member => member.enabled || owners.has(member.id)), this.data.equipmentStock)
        .map(({ id, count, equipped }) => ({ id, count, equipped })),
      members: [...owners.values()].map(member => ({ id: member.id, sourceId: member.sourceId,
        equipment: [...member.equipment] })),
    } : null;
    return parseBattlePlayerBorrow({ kind: "battle-player-borrow-v1", plan, initial, candidates, groups, qualification });
  }
  private projectOwnedParameters(
    p: Pick<OwnedCharacter, "id" | "sourceId" | "level" | "equipment" | "growth">,
  ): BattleStatProjection {
    const system = this.content.equipmentSystem;
    if (!system) throw new Error("Equipment system is unavailable");
    const definition = this.definitions.get(p.id),
      original = system.contexts[p.id];
    if (
      !original ||
      (definition && definition.sourceId !== p.sourceId)
    )
      throw new Error("Unresolved equipment growth origin");
    const context = structuredClone(original);
    if (p.growth) {
      for (const key of ["hp", "mp", "magic", "vitality", "agility"] as const)
        context.parameters.additional[key] += p.growth.additional[key];
      context.physical.strength.additional += p.growth.additional.strength;
    } else if (this.content.characterInitializations?.[p.id]) {
      if (p.level !== this.content.characterInitializations[p.id]!.initial.level)
        throw new Error("Missing source character growth plan");
    } else for (let level = definition!.level + 1; level <= p.level; level++) {
      const matches = system.growth[definition!.growthGroup!]?.filter(
        (g) => g.level === level,
      );
      if (matches?.length !== 1)
        throw new Error("Missing or ambiguous equipment growth dependency");
      context.parameters.additional.hp += matches[0]!.hp;
      context.parameters.additional.mp += matches[0]!.mp;
    }
    const projected = projectEquipmentParameters(
      system.catalog,
      p.equipment,
      context,
      system.limits,
    );
    const arm = equipmentAttackArm(system.catalog, p.sourceId, p.equipment);
    const { hp, mp, ...parameters } = projected.parameters;
    return {
      ...parameters,
      maxHp: hp,
      maxMp: mp,
      physical: projected.physicalByArm[arm],
      attackElements: projected.attackElementsByArm[arm],
      elementResistances: projected.elementResistances,
    };
  }
  private projectGrowth(member: OwnedCharacter, request: CharacterGrowthRequest): OwnedCharacter {
    const plan = this.content.characterGrowth?.[member.id];
    if (!plan || !member.growth || !member.abilities)
      throw new Error("Unimplemented source character growth: " + member.id);
    const result = growCharacter(plan, { ...member, abilities: member.abilities }, member.growth,
      request, (candidate, growth) => this.projectOwnedParameters({ ...candidate, growth }), this.equipmentAbilities(member));
    if (result.progress.observedLearning.length > member.growth.observedLearning.length && !this.data.nativeState)
      throw new Error("Observed learning requires source native owned-magic state");
    const next: OwnedCharacter = { ...result.member, growth: result.progress };
    next.conditionIds = this.conditions.updateDying(next.hp, next.maxHp, next.conditionIds);
    return next;
  }
  private projectObservedLearning(member: OwnedCharacter, observedAbilityIds: readonly number[], lease: BattleLease,
    participantIndex: number): OwnedCharacter {
    const plan = this.content.characterGrowth?.[member.id];
    if (!plan || !member.growth || !member.abilities) throw new Error("Missing source observation recipient");
    const result = learnObservedCharacter(plan, { ...member, abilities: member.abilities }, member.growth,
      observedAbilityIds, { battleSerial: lease.serial, participantIndex }, this.equipmentAbilities(member));
    if (result.progress.observedLearning.length > member.growth.observedLearning.length && !this.data.nativeState)
      throw new Error("Observed learning requires source native owned-magic state");
    return { ...result.member, growth: result.progress };
  }
  private menuParticipant(member: OwnedCharacter): ActionParticipant {
    const definition = this.definitions.get(member.id);
    if (!this.content.equipmentSystem && !definition)
      throw new Error("Missing owned parameter projection");
    const parameters = this.content.equipmentSystem ? this.projectOwnedParameters(member) : definition!;
    return { ...parameters, id: member.id, side: "player", level: member.level,
      hp: member.hp, mp: member.mp, maxHp: member.maxHp, maxMp: member.maxMp,
      conditionIds: [...member.conditionIds],
      ...(definition ? { conditionResistances: definition.conditionResistances } : {}) };
  }
  private fieldAbilityInput(actorId: string): { roster: FieldAbilityMember[]; costOwner: FieldAbilityCostOwner } | null {
    const system = this.content.equipmentSystem;
    const actor = this.data.roster.find(member => member.id === actorId && member.enabled);
    if (!system || !actor || !this.activeParty.some(member => member.id === actorId)) return null;
    const roster = this.activeParty.map(({ id }) => {
      const member = this.data.roster.find(candidate => candidate.id === id)!;
      return { ...this.menuParticipant(member), sourceId: member.sourceId, enabled: member.enabled,
        abilities: structuredClone(member.abilities) };
    });
    return { roster, costOwner: { side: "player", catalog: system.catalog, loadout: actor } };
  }
  private magicStoneRoster(data: GameStateSnapshot) {
    return data.roster.flatMap(member => {
      if (!member.abilities) {
        if (member.magicStoneId !== 0) throw new Error("Equipped magic stone requires owned abilities");
        return [];
      }
      return [{ ...member, abilities: member.abilities }];
    });
  }
  private projectMagicStoneRemoval(member: OwnedCharacter): OwnedCharacter {
    if (member.magicStoneId === 0) return structuredClone(member);
    const plan = this.content.characterGrowth?.[member.id];
    if (!plan?.magicStones || !member.abilities || !member.growth)
      throw new Error("Missing magic stone removal history provider");
    const result = projectCharacterInventoryMagicStoneRemoval(plan, { ...member, abilities: member.abilities },
      member.growth, this.equipmentAbilities(member));
    return { ...result.member, growth: result.progress };
  }
  private magicStonePassives(data: GameStateSnapshot): MagicStonePassiveContext {
    return Object.fromEntries(data.roster.map(member => [member.id, this.equipmentAbilities(member)]));
  }
  magicStoneMenu(playerId: string) {
    const catalog = this.content.magicStones, member = this.data.roster.find(candidate => candidate.id === playerId);
    const available = !this.active && catalog !== undefined && this.data.nativeState !== null;
    const plan = this.content.characterGrowth?.[playerId];
    const canEquip = available && !!member?.enabled && !!member.abilities && !!member.growth &&
      plan?.magicStones !== undefined && !catalog!.rules.excludedSourceIds.includes(member.sourceId as 13 | 14);
    return { available, playerId: member?.id ?? null, currentContentId: member?.magicStoneId ?? null,
      currentName: member?.magicStoneId ? catalog?.stones[member.magicStoneId]?.name ?? null : null, canEquip,
      stones: available ? this.data.nativeState!.ownedMagicStones.map(contentId => {
        const stone = catalog!.stones[contentId]!;
        const equipped = this.data.roster.find(owner => owner.enabled && owner.magicStoneId === contentId);
        return { contentId, name: stone.name, equippedBy: equipped ? { id: equipped.id, name: equipped.name } : null,
          bonus: structuredClone(stone.bonus), learning: stone.learning.map(row => ({ abilityId: row.abilityId,
            name: this.content.fieldAbilities?.abilities[row.abilityId]?.name ?? String(row.abilityId), rate: row.rate,
            skillLevel: member?.abilities?.owned.find(ability => ability.abilityId === row.abilityId)?.skillLevel ?? 0 })) };
      }) : [] };
  }
  /** Association and command history publish to the original owner together.
   * Equipping has no immediate parameter, learned-skill or resource effect. */
  prepareMagicStoneMenu(playerId: string, contentId: number) {
    this.requireIdle(); integer(contentId, 0x7fffffff);
    const catalog = this.content.magicStones;
    if (!catalog || !this.data.nativeState) throw new Error("Magic stone ownership is unavailable in this entry");
    const roster = this.magicStoneRoster(this.data), passives = this.magicStonePassives(this.data);
    const metadata = [...Object.values(this.content.characterGrowth ?? {}).flatMap(plan => plan.abilities),
      ...Object.values(this.content.fieldAbilities?.abilities ?? {}).map(ability => ({ id: ability.id, typeId: ability.typeId }))];
    const projection = contentId === 0
      ? projectRemoveMagicStone(catalog, this.data.nativeState.ownedMagicStones, roster, playerId, metadata, passives)
      : projectEquipMagicStone(catalog, this.data.nativeState.ownedMagicStones, roster,
        { ownedId: playerId, contentId }, metadata, passives);
    if (!projection.changedIds.length) return null;
    const next = this.snapshot(), revision = this.revision;
    for (const id of projection.changedIds) {
      const old = this.data.roster.find(member => member.id === id)!, plan = this.content.characterGrowth?.[id];
      if (!plan?.magicStones || canonical(plan.magicStones) !== canonical(catalog) || !old.abilities || !old.growth)
        throw new Error("Missing source magic stone growth contract");
      const target = projection.roster.find(member => member.id === id)!;
      const projected = projectCharacterMagicStone(plan, { ...old, abilities: old.abilities }, old.growth,
        target.magicStoneId, passives[id] ?? []);
      Object.assign(next.roster.find(member => member.id === id)!, projected.member, { growth: projected.progress });
    }
    this.validate(next);
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision) throw new Error("Stale magic stone menu transaction");
    };
    return { validate, commit: () => {
      this.commitMenuPresentation(next, validate, () => {}); consumed = true;
    } };
  }
  menuAbilities(actorId: string, context: FieldAbilityContext) {
    if (this.active || !this.content.fieldAbilities) return [];
    const input = this.fieldAbilityInput(actorId);
    return input ? fieldAbilityMenu(this.content.fieldAbilities, input.roster, this.data.party,
      actorId, input.costOwner, this.conditions, context) : [];
  }
  menuAbilityTargets(actorId: string, abilityId: number, context: FieldAbilityContext) {
    if (this.active || !this.content.fieldAbilities) return [];
    const input = this.fieldAbilityInput(actorId);
    return input ? fieldAbilityTargets(this.content.fieldAbilities, input.roster, this.data.party,
      actorId, abilityId, input.costOwner, this.conditions, context) : [];
  }
  /** Project every recipient and the payer before preparing field appearance.
   * Abilities, equipment, growth and inventory stay with their existing owner. */
  prepareFieldAbility(request: FieldAbilityRequest, context: FieldAbilityContext) {
    this.requireIdle();
    const catalog = this.content.fieldAbilities, input = this.fieldAbilityInput(request.actorId);
    if (!catalog || !input) return null;
    if (!this.data.fieldRandom) throw new Error("Missing field random ownership");
    const candidateRandom = structuredClone(this.data.fieldRandom);
    const projected = projectFieldAbility(catalog, input.roster, this.data.party, request,
      input.costOwner, this.conditions, context, (min, max) => drawFieldRandom(candidateRandom, min, max));
    if (!projected) return null;
    const next = this.snapshot(), revision = this.revision, catalogBaseline = canonical(catalog);
    next.fieldRandom = candidateRandom;
    let appearanceChanged = false;
    for (const candidate of projected.roster) {
      const member = next.roster.find(member => member.id === candidate.id);
      if (!member) throw new Error("Field ability changed an unowned identity");
      appearanceChanged ||= canonical(member.conditionIds) !== canonical(candidate.conditionIds);
      member.hp = candidate.hp; member.mp = candidate.mp;
      member.conditionIds = [...candidate.conditionIds];
    }
    this.validate(next);
    let consumed = false;
    const validate = () => {
      this.requireIdle();
      if (consumed || this.revision !== revision || canonical(this.content.fieldAbilities) !== catalogBaseline)
        throw new Error("Stale field ability transaction");
    };
    const commitWith = (publish: () => void) => {
      this.commitMenuPresentation(next, validate, publish); consumed = true;
    };
    return {
      result: structuredClone({ actorId: projected.actorId, abilityId: projected.abilityId,
        targetIds: projected.targetIds, cost: projected.cost, effects: projected.effects }),
      appearance: appearanceChanged ? this.projectPartyAppearance(next) : undefined,
      appearanceChanged,
      validate,
      commit: () => commitWith(() => {}),
      commitWith,
    };
  }
  get equipmentInventory() {
    const system = this.content.equipmentSystem;
    return system
      ? equipmentAvailability(
          system.catalog,
          this.data.roster.filter((p) => p.enabled),
          this.data.equipmentStock,
        )
      : [];
  }
  private equipmentAbilities(member: OwnedCharacter) {
    const catalog = this.content.equipmentSystem?.catalog;
    if (!catalog) return [];
    const providers = equipmentAbilityCostProviders(catalog, member);
    if (!member.abilities) {
      if (providers.length) throw new Error("Equipment passive lacks owned ability state");
      return [];
    }
    validateEquipmentAbilityOwnership(catalog, member, member.abilities.owned);
    return providers.map((provider) => provider.ability);
  }
  private previewEquipment(playerId: string, slot: number, contentId: number) {
    this.requireIdle();
    const system = this.content.equipmentSystem;
    if (!system) throw new Error("Equipment system is unavailable");
    const prepared = previewEquipmentChange(
      system.catalog,
      this.data.roster.filter((p) => p.enabled),
      this.data.equipmentStock,
      playerId,
      slot,
      contentId,
    );
    const next = this.snapshot(),
      p = next.roster.find((p) => p.id === playerId)!;
    const loadout = prepared.roster.find((p) => p.id === playerId)!;
    if (p.abilities) p.abilities.owned = applyEquipmentAbilityChange(p.abilities.owned, p, loadout, system.catalog);
    else if (equipmentAbilityCostProviders(system.catalog, loadout).length)
      throw new Error("Equipment passive lacks owned ability state");
    p.equipment = loadout.equipment;
    const projection = this.projectOwnedParameters(p);
    p.maxHp = projection.maxHp;
    p.maxMp = projection.maxMp;
    p.hp = Math.min(p.hp, p.maxHp);
    p.mp = Math.min(p.mp, p.maxMp);
    p.conditionIds = this.conditions.updateDying(p.hp, p.maxHp, p.conditionIds);
    this.validate(next);
    return { next, changes: prepared.changes, projection };
  }
  equipmentChoices(playerId: string, slot: number) {
    if (this.active || !this.content.equipmentSystem) return [];
    const system = this.content.equipmentSystem;
    const p = this.data.roster.find((p) => p.id === playerId);
    if (!p?.enabled || !Number.isInteger(slot) || slot < 1 || slot > 6)
      return [];
    let empty: number | null;
    try { empty = selectEmptyEquipment(system.catalog, this.data.equipmentStock, p.sourceId, slot); }
    catch { return []; }
    const candidates = new Set([
      ...(empty === null ? [] : [empty]),
      p.equipment[slot - 1]!,
      ...this.equipmentInventory
        .filter((i) => i.available > 0)
        .map((i) => i.id),
    ]);
    return [...candidates].flatMap((id) => {
      try {
        const preview = this.previewEquipment(playerId, slot, id);
        return [
          { id, changes: preview.changes, projection: preview.projection },
        ];
      } catch {
        return [];
      }
    });
  }
  changeEquipment(playerId: string, slot: number, contentId: number): boolean {
    const preview = this.previewEquipment(playerId, slot, contentId);
    if (!preview.changes.length) return false;
    this.data = preview.next;
    this.revision++;
    return true;
  }
  private previewItem(id: number, targetId: string) {
    this.requireIdle();
    const item = this.content.items[id];
    const owned = this.activeParty.some((p) => p.id === targetId)
      ? this.data.roster.find((p) => p.id === targetId) : undefined;
    const target = owned ? this.menuParticipant(owned) : undefined;
    if (
      !item ||
      item.important ||
      !item.uses.menu.plan ||
      !this.data.items.some((i) => i.id === id && i.count > 0) ||
      !target ||
      (target.hp <= 0 && item.uses.menu.plan.targeting.life === "alive") ||
      target.conditionIds.some((c) => item.forbiddenConditionIds.includes(c))
    )
      return null;
    const projection = projectActionTarget(
      item.uses.menu.plan,
      item.power,
      target,
      target,
      this.conditions,
      () => {
        throw new Error("Unimplemented menu item randomness");
      },
      1,
    );
    return projection.state.hp !== target.hp ||
      projection.state.mp !== target.mp ||
      projection.state.conditionIds.length !== target.conditionIds.length ||
      projection.state.conditionIds.some(
        (id, n) => id !== target.conditionIds[n],
      )
      ? projection
      : null;
  }
  menuItemTargets(id: number): string[] {
    if (this.active) return [];
    return this.activeParty
      .map(({ id }) => id)
      .filter((target) => this.previewItem(id, target) !== null);
  }
  /** Menu eligibility and effects are projected again at confirmation. No effect
   * means no consumption; stock and the entire character projection commit once. */
  useMenuItem(id: number, targetId: string): boolean {
    const projected = this.previewItem(id, targetId);
    if (!projected) return false;
    const next = this.snapshot();
    Object.assign(
      next.roster.find((p) => p.id === targetId)!,
      projected.state,
    );
    next.items.find((i) => i.id === id)!.count--;
    this.validate(next);
    this.data = next;
    this.revision++;
    return true;
  }
  /** Commands validate affordability before consuming; this is not a raw event RemoveOwnedItem emulation. */
  changeItems(
    changes: readonly { id: number; count: number }[],
    mode: "grant" | "consume",
  ): void {
    this.requireIdle();
    if (mode !== "grant" && mode !== "consume")
      throw new Error("Unknown inventory operation");
    const next = this.snapshot();
    for (const change of changes) {
      integer(change.id, 0x7fffffff, 1);
      if (!this.content.items[change.id])
        throw new Error("Unimplemented inventory content: " + change.id);
      integer(change.count, 0x7fffffff);
      let entry = next.items.find((item) => item.id === change.id);
      if (!entry) {
        entry = { id: change.id, count: 0 };
        next.items.push(entry);
      }
      if (mode === "consume" && entry.count < change.count)
        throw new Error("Insufficient inventory");
      entry.count =
        mode === "grant"
          ? Math.min(this.content.limits.item, entry.count + change.count)
          : entry.count - change.count;
    }
    next.items.sort((a, b) => a.id - b.id);
    this.validate(next);
    this.data = next;
    this.revision++;
  }
  openBattle(encounterId: number, rewardPolicy?: BattleRewardPolicy, playerPlan?: BattlePlayerPlan, forcedSavePolicy?:WebBattleForcedSave): BattleLease {
    this.requireIdle();
    if (this.battlePartyBlocker) throw new Error(this.battlePartyBlocker);
    integer(encounterId, 0x7fffffff, 1);
    if (rewardPolicy === undefined && this.content.characterInitializations)
      throw new Error("Source battle requires an explicit reward policy");
    const policy = Object.freeze(parseBattleRewardPolicy(rewardPolicy === undefined
      ? { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 } : rewardPolicy));
    const lease = Object.freeze({
      serial: this.data.completedBattles.length,
      encounterId,
    });
    const players = this.partyPlayers();
    const equipment = this.content.equipmentSystem;
    const qualification: BattleEntryInventory | null = equipment ? {
      equipmentCatalog: structuredClone(equipment.catalog),
      equipmentStock: equipmentAvailability(equipment.catalog, this.data.roster.filter((p) => p.enabled),
        this.data.equipmentStock).map(({ id, count, equipped }) => ({ id, count, equipped })),
      members: players.map((player) => {
        const owner = this.data.roster.find((member) => member.id === player.id)!;
        return { id: owner.id, sourceId: owner.sourceId, equipment: [...owner.equipment] };
      }),
    } : null;
    const playerBorrow = playerPlan === undefined ? undefined : this.prepareBattlePlayerBorrow(playerPlan, players);
    this.active = {
      lease,
      players,
      items: structuredClone(this.data.items),
      qualification,forcedSavePolicy:forcedSavePolicy===undefined?null:parseWebBattleForcedSave(forcedSavePolicy),
      rewardPolicy: policy,
      playerBorrow,
    };
    return lease;
  }
  battlePlayers(lease: BattleLease): Combatant[] {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return structuredClone(this.active.players);
  }
  battlePlayerBorrow(lease: BattleLease): BattlePlayerBorrow | undefined {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return this.active.playerBorrow === undefined ? undefined : structuredClone(this.active.playerBorrow);
  }
  battleRewardPolicy(lease: BattleLease): BattleRewardPolicy {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return { ...this.active.rewardPolicy };
  }
  battleInventory(lease: BattleLease): BattleInventoryWithQualification {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return structuredClone({
      definitions: this.content.items,
      stacks: this.active.items,
      limit: this.content.limits.item,
      ...(this.active.qualification ? { qualification: this.active.qualification } : {}),
    });
  }
  battleProgression(
    lease: BattleLease,
    fixtureExperience: BattleContent["experience"] = [],
  ): ((player: Combatant, amount: number, observedAbilityIds: readonly number[], magicPoints?: number, participantIndex?: number) =>
    BattleStatProjection & { level: number; exp: number; magicLearningValue: number }) | undefined {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    if (!this.content.equipmentSystem) return undefined;
    return (player, amount, observedAbilityIds, magicPoints = 0, participantIndex) => {
      if (this.active?.lease !== lease) throw new Error("Stale battle lease");
      const owned = this.data.roster.find((p) => p.id === player.id);
      if (!owned || owned.sourceId !== player.sourceId)
        throw new Error("Battle roster identity changed");
      const initialIndex = this.active.players.findIndex(candidate => candidate.id === player.id);
      let ordinal: number;
      if (this.active.playerBorrow) {
        if (!this.active.playerBorrow.candidates.some(candidate => candidate.id === player.id && candidate.sourceId === player.sourceId))
          throw new Error("Unadmitted borrowed progression owner");
        if (participantIndex === undefined) throw new Error("Missing borrowed progression participant index");
        ordinal = integer(participantIndex, 0x7fffffff);
        if (initialIndex >= 0 && ordinal !== initialIndex) throw new Error("Initial borrowed participant index changed");
        // Pure projection: the host derives this index from its identity
        // ledger. Final return replays growth at the first-entered ordinal,
        // so a failed frame never reserves an index in the persistent owner.
      } else {
        if (initialIndex < 0) throw new Error("Battle progression party identity changed");
        ordinal = initialIndex;
      }
      integer(amount, this.content.limits.exp);
      if (magicPoints !== this.active.rewardPolicy.magicPoints)
        throw new Error("Battle magic points disagree with leased reward policy");
      const magicLearningValue = projectMagicLearningValue(owned.magicLearningValue, magicPoints, player.hp > 0);
      if (owned.growth) {
        // IsGetExp excludes condition types 5/3/608. Only death (5) is
        // currently admitted, with HP/condition consistency checked by core.
        if (player.hp === 0) {
          if (amount !== 0 || !owned.abilities) throw new Error("Invalid nonrecipient experience award");
          const next = this.projectObservedLearning(owned, observedAbilityIds, lease,
            ordinal);
          return { ...this.projectOwnedParameters(next), level: next.level, exp: next.exp, magicLearningValue };
        }
        const next = this.projectGrowth({ ...owned, hp: player.hp, mp: player.mp,
          conditionIds: [...player.conditionIds] }, { kind: "add-experience", amount, context: "battle", observedAbilityIds: [...observedAbilityIds],
          magicPoints, learningReceipt: { battleSerial: lease.serial, participantIndex: ordinal } });
        return { ...this.projectOwnedParameters(next), level: next.level, exp: next.exp, magicLearningValue };
      }
      // Only synthetic profiles without source initialization use this legacy
      // numerical fixture curve. Source owners require a recovered growth plan.
      if (this.content.characterInitializations?.[owned.id])
        throw new Error("Missing source character growth plan");
      if (!fixtureExperience.length) throw new Error("Missing fixture experience curve");
      const exp = Math.min(this.content.limits.exp, owned.exp + amount);
      const level = Math.max(owned.level, fixtureExperience.filter((r) => r.exp <= exp).at(-1)?.level ?? owned.level);
      return { ...this.projectOwnedParameters({ ...owned, level }), level, exp, magicLearningValue };
    };
  }
  cancelBattle(lease: BattleLease): void {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    this.active = null;
  }
  prepareVictory(
    lease: BattleLease,
    result: BattleVictoryResult,
  ): PreparedBattleReturn {
    return this.prepareBattleReturn(lease, { outcome: "victory", result });
  }
  /** Development escape settlement is not a zero-experience victory. Source
   * result learning, loot, currency and growth are deliberately not invoked. */
  prepareEscape(lease: BattleLease, result: BattleEscapeResult): PreparedBattleReturn {
    keys(result, "players,consumedItems" + (Object.hasOwn(result, "playerParticipants") ? ",playerParticipants" : ""));
    return this.prepareBattleReturn(lease, { outcome: "escaped", result });
  }
  /** Forced=4 releases borrowed battle resources without SaveParameter. It
   * records neither victory nor escape and never publishes resource changes. */
  prepareForcedReturn(lease: BattleLease, input: BattleForcedReturnResult|BattleSavedForcedReturnResult): PreparedBattleReturn {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    if(input.kind==='battle-save-return-v1'){
      const result=parseBattleSavedForcedReturnResult(input);
      if(!this.active.forcedSavePolicy||canonical(result.policy)!==canonical(this.active.forcedSavePolicy))throw new Error('Saved forced return is outside its actual owned lease policy');
      if(canonical(result.participants)!==canonical(result.players.map(player=>({ownedId:player.id,sourceId:player.sourceId}))))throw new Error('Saved forced-return participant identity changed');
      const baseEquipment=this.active.playerBorrow?.qualification??this.active.qualification;
      const equipment=baseEquipment===null?null:{...baseEquipment,members:result.players.map(player=>{
        const member=baseEquipment.members.find(member=>member.id===player.id&&member.sourceId===player.sourceId);
        if(!member)throw new Error('Missing entered saved equipment owner');return member;
      })};
      if(canonical(result.equipment)!==canonical(equipment))throw new Error('Saved forced return equipment differs from its admitted actual six-slot/stock owner; no equipment mutation writer is admitted');
      return this.prepareBattleReturn(lease,{outcome:'forced-save',result});
    }
    const result = parseBattleForcedReturnResult(input), borrowed = this.validateBorrowedReturn(result, null),
      ids = borrowed ? firstEnteredOwnerIds(borrowed.state) : this.active.players.map(player => player.id),
      expected = ids.map(ownedId => {
        const owner = this.data.roster.find(member => member.id === ownedId);
        if (!owner) throw new Error("Missing forced-return owned participant");
        return { ownedId, sourceId: owner.sourceId };
      });
    if (canonical(result.participants) !== canonical(expected)) throw new Error("Forced-return participant identity changed");
    const next = this.snapshot(), revision = this.revision;
    next.completedBattles.push({ ...lease, outcome: "forced" });
    this.validate(next);
    const validate = () => { if (this.active?.lease !== lease || this.revision !== revision) throw new Error("Stale forced-return transaction"); };
    const commit = () => { validate(); this.data = next; this.active = null; this.revision++; };
    return Object.assign(commit, { validate, fieldState: () => { validate(); return {
      puppetRoster: this.projectPuppetRoster(next),
      partyAppearance: this.content.partyActors ? this.projectPartyAppearance(next) : null }; } });
  }
  private validateBorrowedReturn(
    result: Pick<BattleEscapeResult, "playerParticipants">,
    victory: BattleVictoryResult | null,
  ): BattlePlayerReturn | null {
    const borrow = this.active!.playerBorrow;
    if (!borrow) {
      if (Object.hasOwn(result, "playerParticipants")) throw new Error("Fixed battle cannot return borrowed player participants");
      return null;
    }
    if (!Object.hasOwn(result, "playerParticipants")) throw new Error("Missing borrowed player return envelope");
    const returned = parseBattlePlayerReturn(result.playerParticipants);
    const initial = returned.state.entries.filter(entry => !entry.instanceId.startsWith("player:dynamic:"));
    const expected = borrow.initial.flatMap((cell, slot) => cell.ownedId === null ? [] :
      [{ instanceId: cell.ownedId, ownedId: cell.ownedId, sourceId: cell.sourceId!, slot }]);
    if (initial.length !== expected.length || initial.some((entry, index) => {
      const original = expected[index]!;
      return entry.instanceId !== original.instanceId || entry.ownedId !== original.ownedId ||
        entry.sourceId !== original.sourceId || entry.slot !== original.slot;
    })) throw new Error("Borrowed initial participant history changed");
    for (const entry of returned.state.entries)
      if (!borrow.candidates.some(candidate => candidate.id === entry.ownedId && candidate.sourceId === entry.sourceId))
        throw new Error("Borrowed return contains an unadmitted owner/source identity");
    if (!victory && returned.observations.some(observation => observation.abilityIds.length))
      throw new Error("Escape cannot learn borrowed player observations");
    if (victory && !Array.isArray(victory.awardedExperience)) throw new Error("Missing borrowed experience awards");
    if (victory && victory.observedAbilityIds !== undefined) {
      if (!Array.isArray(victory.observedAbilityIds) || Object.keys(victory.observedAbilityIds).length !== victory.observedAbilityIds.length ||
          Array.from({ length: victory.observedAbilityIds.length }, (_, index) => !Object.hasOwn(victory.observedAbilityIds!, index)).some(Boolean))
        throw new Error("Invalid borrowed global observation collection");
      distinct(victory.observedAbilityIds);
      victory.observedAbilityIds.forEach(id => integer(id, 0x7fffffff, 1));
      const union = [...new Set(returned.observations.flatMap(observation => observation.abilityIds))];
      if (canonical(victory.observedAbilityIds) !== canonical(union))
        throw new Error("Borrowed global observations differ from owner observation union");
    }
    return returned;
  }
  private prepareBattleReturn(
    lease: BattleLease,
    exit: { outcome: "victory"; result: BattleVictoryResult } | { outcome: "escaped"; result: BattleEscapeResult } | {outcome:"forced-save";result:BattleSavedForcedReturnResult},
  ): PreparedBattleReturn {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    const result = exit.result, victory = exit.outcome === "victory" ? exit.result : null,saved=exit.outcome==='forced-save'?exit.result:null;
    const borrowed = this.validateBorrowedReturn(result, victory);
    let next = this.snapshot();
    const revision = this.revision;
    if (victory) integer(victory.gil, 0x7fffffff);
    const magicPoints = victory && victory.magicPoints !== undefined ? victory.magicPoints : 0;
    if (victory && (magicPoints !== this.active.rewardPolicy.magicPoints ||
        (victory.magicPoints === undefined && this.content.characterInitializations)))
      throw new Error("Battle magic points disagree with leased reward policy");
    // Native save order is committed steals, used items, then the already
    // existing drop list. This branch never invokes the victory lottery.
    if(saved)for(const grant of saved.retainedLoot.stolen)next=this.projectInventoryEvent(next,grant).next;
    validateItemStacks(
      result.consumedItems,
      this.content.items,
      this.content.limits.item,
    );
    for (const used of result.consumedItems) {
      if(saved&&(this.active.items.find(item=>item.id===used.id)?.count??0)<used.count)
        throw new Error('Saved battle consumption exceeds its actual entry stock');
      const stock = next.items.find((i) => i.id === used.id);
      if (
        !stock ||
        stock.count < used.count ||
        this.content.items[used.id]!.important ||
        !this.content.items[used.id]!.uses.battle.plan
      )
        throw new Error("Invalid battle inventory consumption");
      stock.count -= used.count;
    }
    const grants = victory?.dropGrants ?? saved?.retainedLoot.drops ?? [];
    if (!Array.isArray(grants)) throw new Error("Invalid battle drop grants");
    distinct(grants.map((grant) => grant.id));
    // FixedStatusInfo.SaveItem removes used items before adding DropItemList.
    // Reuse the single inventory owner so caps include equipped copies and a
    // late invalid grant cannot publish an earlier grant or consumed item.
    for (const grant of grants) {
      keys(grant, "kind,id,count");
      if (!["grant-item", "grant-equipment"].includes(grant.kind))
        throw new Error("Unimplemented battle drop ownership kind");
      next = this.projectInventoryEvent(next, grant).next;
    }
    const party = activePartyMembers(next.party);
    const ownerIds = borrowed ? firstEnteredOwnerIds(borrowed.state) : party.map(member => member.id);
    if (
      !Array.isArray(result.players) || Object.keys(result.players).length !== result.players.length ||
      Array.from({ length: result.players.length }, (_, index) => !Object.hasOwn(result.players, index)).some(Boolean) ||
      result.players.length !== ownerIds.length ||
      result.players.some((p, n) => p.id !== ownerIds[n])
    )
      throw new Error("Battle party identity changed");
    if (victory?.awardedExperience) {
      if (Object.keys(victory.awardedExperience).length !== victory.awardedExperience.length ||
          Array.from({ length: victory.awardedExperience.length }, (_, index) => !Object.hasOwn(victory.awardedExperience!, index)).some(Boolean))
        throw new Error("Invalid battle experience award collection");
      distinct(victory.awardedExperience.map((award) => award.id));
      for (const award of victory.awardedExperience) {
        keys(award, "id,amount");
        integer(award.amount, this.content.limits.exp);
      }
      if (victory.awardedExperience.length !== ownerIds.length ||
        victory.awardedExperience.some((award, index) => borrowed ? award.id !== ownerIds[index] : !ownerIds.includes(award.id)))
        throw new Error("Battle experience identity changed");
    }
    for (const [participantIndex, player] of result.players.entries()) {
      const target = next.roster.find((p) => p.id === player.id);
      if (!target || player.side !== "player" || player.sourceId !== target.sourceId)
        throw new Error("Battle roster identity changed");
      const cell = borrowed ? null : next.party.slots[next.party.selectedSlot][party[participantIndex]!.index];
      const entry = borrowed ? this.active.playerBorrow!.candidates.find(candidate => candidate.id === player.id) : this.active.players[participantIndex];
      const latest = borrowed?.state.entries.filter(history => history.ownedId === player.id).at(-1);
      if (!entry || entry.id !== player.id || entry.sourceId !== player.sourceId ||
          (cell !== null && (cell.id !== player.id || cell.row !== entry.row)) ||
          (latest !== undefined && latest.row !== player.row) ||
          (player.row !== "front" && player.row !== "back"))
        throw new Error("Battle party row identity changed");
      if (entry.magicLearningValue !== target.magicLearningValue)
        throw new Error("Battle magic learning owner changed");
      const magicLearningValue = victory
        ? projectMagicLearningValue(target.magicLearningValue, magicPoints, player.hp > 0)
        : target.magicLearningValue;
      const providedMagicLearningValue = player.magicLearningValue === undefined &&
        !this.content.characterInitializations && magicPoints === 0 && target.magicLearningValue === 0
        ? 0 : player.magicLearningValue;
      if (providedMagicLearningValue !== magicLearningValue)
        throw new Error("Battle magic learning projection mismatch");
      // The borrowed Web profile preserves all saved party cells, including
      // rows and disabled owners. Legacy fixed-party Function17 row writeback
      // stays within the same leased, atomic field-return transaction.
      if (cell) cell.row = player.row;
      if(saved){
        // SaveCorpList writes CorpsId (Front/Back), never CharacterId. The
        // explicit Web all-entered variant preserves saved membership.
        if(borrowed)for(const savedCell of next.party.slots[next.party.selectedSlot])if(savedCell.id===player.id)savedCell.row=player.row;
        if(saved.equipment){const loadout=saved.equipment.members.find(row=>row.id===player.id);
          if(!loadout||loadout.sourceId!==target.sourceId)throw new Error('Missing saved forced equipment owner');target.equipment=[...loadout.equipment];}
      }
      if (!victory) {
        for (const key of ["level", "exp", "maxHp", "maxMp"] as const)
          if (player[key] !== entry[key] || entry[key] !== target[key])
            throw new Error("Escape cannot change owned growth or resource maxima");
        if (canonical(player.ownedAbilities ?? null) !== canonical(entry.ownedAbilities ?? null))
          throw new Error("Escape cannot change held abilities");
        if (canonical(this.conditions.battleEnd(player.conditionIds)) !== canonical(player.conditionIds))
          throw new Error("Escape contains uncleared battle-only conditions");
        target.hp = player.hp;
        target.mp = player.mp;
        target.conditionIds = [...player.conditionIds];
        continue;
      }
      if (target.growth) {
        const award = victory.awardedExperience?.find((award) => award.id === player.id);
        if (!award) throw new Error("Missing source experience award");
        const observations = borrowed ? borrowed.observations[participantIndex]!.abilityIds : victory.observedAbilityIds;
        if (!Array.isArray(observations)) throw new Error("Missing battle ability observations");
        distinct(observations);
        observations.forEach((id) => integer(id, 0x7fffffff, 1));
        const resources = { ...target, hp: player.hp, mp: player.mp, conditionIds: [...player.conditionIds], magicLearningValue };
        let projected: OwnedCharacter;
        if (player.hp === 0) {
          if (award.amount !== 0 || !target.abilities) throw new Error("Invalid nonrecipient experience award");
          projected = this.projectObservedLearning(resources, observations, lease, participantIndex);
        } else projected = this.projectGrowth(resources, { kind: "add-experience", amount: award.amount,
          context: "battle", observedAbilityIds: observations,
          magicPoints, learningReceipt: { battleSerial: lease.serial, participantIndex } });
        for (const key of ["level", "exp", "maxHp", "maxMp", "hp", "mp"] as const)
          if (projected[key] !== player[key]) throw new Error("Battle source growth projection mismatch");
        if (canonical(projected.conditionIds) !== canonical(player.conditionIds))
          throw new Error("Battle source growth condition mismatch");
        Object.assign(target, projected);
        continue;
      }
      Object.assign(target, {
        hp: player.hp,
        mp: player.mp,
        maxHp: player.maxHp,
        maxMp: player.maxMp,
        level: player.level,
        additionalLevel: target.additionalLevel + player.level - target.level,
        exp: player.exp,
        magicLearningValue,
        conditionIds: [...player.conditionIds],
      });
    }
    if (victory) {
      next.gil = Math.min(this.content.limits.gil, next.gil + victory.gil);
      next.totalGil += victory.gil;
    }
    if(saved){
      for(const owner of next.roster)owner.conditionIds=this.conditions.battleEnd(owner.conditionIds);
      next.formatVersion=15;
    }
    next.completedBattles.push({ ...lease, outcome: exit.outcome });
    if (victory && next.nativeState) next.nativeState.ownedMagic = this.observedMagic(next);
    this.validate(next);
    const validate = () => {
      if (this.active?.lease !== lease || this.revision !== revision)
        throw new Error(`Stale ${victory ? "victory" : "escape"} transaction`);
    };
    const commit = () => {
      validate();
      this.data = next;
      this.active = null;
      this.revision++;
    };
    return Object.assign(commit, {
      validate,
      fieldState: () => {
        validate();
        return { puppetRoster: this.projectPuppetRoster(next),
          partyAppearance: this.content.partyActors ? this.projectPartyAppearance(next) : null };
      },
    });
  }
}
