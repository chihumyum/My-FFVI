import type { CombatantDefinition } from "./battle-content.js";
import type { Combatant, BattleStatProjection } from "./battle.js";
import { projectActionTarget } from "./action-effects.js";
import type {
  FieldInventoryCommand,
  FieldInventoryPort,
  FieldInventoryTransaction,
} from "./inventory-event.js";
import { projectEquipmentOwnership } from "./inventory-ownership.js";
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
} from "./party.js";
import {
  equipmentAvailability,
  initialEquipmentStock,
  previewEquipmentChange,
  projectEquipmentParameters,
  validateEquipmentState,
  equipmentAttackArm,
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
  type BattleInventory,
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
} from "./owned-character.js";
import { canonical } from "./canonical.js";

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
  fieldConditions?: FieldConditionCatalog;
  characterInitializations?: Record<string, OwnedCharacterInitializationTemplate>;
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
  conditionIds: number[];
  /** Null only in logic fixtures that have no source initialization provider. */
  abilities: OwnedCharacterAbilities | null;
};
export type GameStateSnapshot = {
  formatVersion: 5;
  kind: "owned-game-state";
  catalogHash: string;
  roster: OwnedCharacter[];
  party: PartyState;
  gil: number;
  totalGil: number;
  items: { id: number; count: number }[];
  equipmentStock: EquipmentStock[];
  releasedJobIds: number[];
  learnedAbilityIds: number[];
  characterNames: Record<string, string>;
  completedBattles: { serial: number; encounterId: number }[];
};
export type BattleLease = {
  readonly serial: number;
  readonly encounterId: number;
};

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
  private data: GameStateSnapshot;
  private active: {
    lease: BattleLease;
    players: Combatant[];
    items: ItemStack[];
  } | null = null;
  private revision = 0;
  private readonly conditions: BattleConditions;
  private readonly fieldConditions: FieldConditions | null;
  private readonly initialLearnedAbilityIds: number[];
  readonly fieldSteps: FieldConditionPort = {
    prepareStep: (transportationId) => this.prepareFieldStep(transportationId),
  };
  readonly fieldInventory: FieldInventoryPort = {
    prepare: (command) => this.prepareInventoryEvent(command),
  };
  readonly fieldParty: FieldPartyPort = {
    prepare: (command) => this.preparePartyEvent(command),
  };
  readonly fieldRoster: FieldRosterPort = {
    prepare: (command) => this.prepareRosterEvent(command),
  };
  constructor(
    content: GameStateContent,
    players: readonly CombatantDefinition[],
    readonly catalogHash: string,
    conditions: BattleConditionCatalog,
  ) {
    this.conditions = new BattleConditions(structuredClone(conditions));
    this.fieldConditions = content.fieldConditions
      ? new FieldConditions(structuredClone(content.fieldConditions))
      : null;
    this.content = structuredClone(content);
    this.definitions = new Map(players.map((p) => [p.id, structuredClone(p)]));
    distinct(players.map((p) => p.id));
    if (content.kind !== "game-state-development-v1" || !players.length)
      throw new Error("Unsupported owned-state content");
    keys(content.limits, "gil,item,hp,mp,level,exp");
    for (const max of Object.values(content.limits))
      integer(max, 0x7fffffff, 1);
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
    const initializedAbilities = new Map<string, OwnedCharacterAbilities>();
    const learnedAbilityIds: number[] = [];
    const characterNames: Record<string, string> = {};
    if (content.characterInitializations) {
      if (Object.keys(content.characterInitializations).length !== players.length)
        throw new Error("Missing initial character template");
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
        initializedAbilities.set(player.id, initialized.member.abilities);
        learnedAbilityIds.push(...initialized.learnedAbilityIdsToAppend);
        if (initialized.nameBinding) {
          const key = initialized.nameBinding.key;
          if (Object.hasOwn(characterNames, key))
            throw new Error("Duplicate initial character name binding");
          characterNames[key] = player.name;
        }
      }
    }
    this.initialLearnedAbilityIds = [...learnedAbilityIds];
    this.data = {
      formatVersion: 5,
      kind: "owned-game-state",
      catalogHash,
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
        abilities: structuredClone(initializedAbilities.get(p.id) ?? null),
        equipment: [...(content.equipment[p.id] ?? [])],
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
    if (this.content.equipmentSystem)
      this.data.equipmentStock = initialEquipmentStock(
        this.content.equipmentSystem.catalog,
        this.data.roster,
      );
    this.validate(this.data);
  }
  private validate(data: GameStateSnapshot) {
    keys(
      data,
      "formatVersion,kind,catalogHash,roster,party,gil,totalGil,items,equipmentStock,releasedJobIds,learnedAbilityIds,characterNames,completedBattles",
    );
    if (
      data.kind !== "owned-game-state" ||
      data.formatVersion !== 5 ||
      data.catalogHash !== this.catalogHash
    )
      throw new Error("Owned-state source/version mismatch");
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
    if (canonical(data.learnedAbilityIds) !== canonical(this.initialLearnedAbilityIds))
      throw new Error("Unimplemented learned ability history change");
    const names = Object.fromEntries(data.roster.flatMap((p) => {
      const template = this.content.characterInitializations?.[p.id];
      return template?.nameTag ? [[template.nameTag, p.name]] : [];
    }));
    if (canonical(data.characterNames) !== canonical(names))
      throw new Error("Owned character name binding mismatch");
    if (data.roster.length !== this.definitions.size)
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
    distinct(data.items.map((item) => item.id));
    for (const item of data.items) {
      keys(item, "id,count");
      integer(item.id, 0x7fffffff, 1);
      if (!this.content.items[item.id])
        throw new Error("Unimplemented inventory content: " + item.id);
      integer(item.count, limits.item);
    }
    distinct(data.completedBattles.map((b) => b.serial));
    for (const [index, b] of data.completedBattles.entries()) {
      keys(b, "serial,encounterId");
      if (b.serial !== index)
        throw new Error("Invalid battle receipt sequence");
      integer(b.encounterId, 0x7fffffff, 1);
    }
  }
  private validateOwnedMember(p: OwnedCharacter, rosterSize: number) {
    const limits = this.content.limits;
    keys(
      p,
      "id,sourceId,name,enabled,level,exp,hp,mp,maxHp,maxMp,conditionIds,equipment,ownedId,jobId,additionalLevel,magicStoneId,ownedJobs,abilities",
    );
    const definition = this.definitions.get(p.id);
    if (
      !definition ||
      definition.side !== "player" ||
      definition.sourceId !== p.sourceId ||
      typeof p.name !== "string"
    )
      throw new Error("Unknown roster identity");
    if (typeof p.enabled !== "boolean")
      throw new Error("Invalid roster availability");
    const template = this.content.characterInitializations?.[p.id];
    if (template) {
      if (!p.abilities) throw new Error("Missing owned abilities");
      validateOwnedCharacterAbilities(p.abilities);
      if (canonical(p.abilities) !== canonical(template.initial.abilities))
        throw new Error("Unimplemented owned ability learning change");
    } else if (p.abilities !== null) throw new Error("Unbound owned ability state");
    if (!this.content.equipmentSystem && !p.enabled)
      throw new Error("Unimplemented disabled roster equipment ownership");
    const lifecycle = this.content.rosterLifecycle.initial[p.id];
    if (
      !lifecycle ||
      p.ownedId !== lifecycle.ownedId ||
      p.jobId !== lifecycle.jobId
    )
      throw new Error("Unimplemented roster identity/job change");
    integer(p.ownedId, rosterSize, 1);
    integer(p.additionalLevel, limits.level, 1);
    if (
      p.additionalLevel !==
      lifecycle.additionalLevel + p.level - definition.level
    )
      throw new Error("Owned level disagrees with source additional level");
    if (p.magicStoneId !== 0)
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
    if ((p.hp === 0) !== this.conditions.isUnableFight(p.conditionIds))
      throw new Error("Owned HP/death state mismatch");
    // Source death settlement erases ordinary poison. Restores must reject the
    // conflicting stable state rather than publishing an incurable field block.
    if (p.hp === 0 && this.conditions.poisonIds(p.conditionIds).length)
      throw new Error("Owned death/poison state mismatch");
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
    return this.data.completedBattles.map((b) => b.encounterId);
  }
  get inBattle() {
    return this.active !== null;
  }
  snapshot(): GameStateSnapshot {
    return structuredClone(this.data);
  }
  /** A shared-state snapshot is not a complete field/battle save game. */
  restore(snapshot: GameStateSnapshot): void {
    this.requireIdle();
    const next = structuredClone(snapshot);
    this.validate(next);
    this.data = next;
    this.revision++;
  }
  private requireIdle() {
    if (this.active)
      throw new Error("Owned state is reserved by an active battle");
  }
  private projectInventoryEvent(
    data: GameStateSnapshot,
    command: FieldInventoryCommand,
  ) {
    const next = structuredClone(data);
    let result: boolean | null = null;
    if (command.kind === "grant-item" || command.kind === "remove-item") {
      integer(command.id, 0x7fffffff, 1);
      integer(command.count, 0x7fffffff, 1);
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
      next.equipmentStock = projectEquipmentOwnership(
        system.catalog,
        next.roster.filter((p) => p.enabled),
        next.equipmentStock,
        command,
      );
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
    };
  }
  private preparePartyEvent(command: PartyCommand): PartyEventTransaction {
    this.requireIdle();
    const { next, ...projection } = this.projectPartyEvent(this.data, command);
    const revision = this.revision;
    return {
      ...projection,
      commit: () => {
        this.requireIdle();
        if (this.revision !== revision)
          throw new Error("Stale field party transaction");
        this.data = next;
        this.revision++;
      },
    };
  }
  private projectRosterEvent(data: GameStateSnapshot, command: RosterCommand) {
    const preview = prepareRosterLifecycle(
      this.rosterState(data),
      command,
      this.rosterCatalog(),
      {
        validateMember: (member) =>
          this.validateOwnedMember(member, data.roster.length),
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
        // AddFromMaster, CorrectLevel learning/growth and FullRecovery remain
        // absent providers until their complete source effects are available.
      },
    );
    const next = { ...structuredClone(data), ...preview.state };
    this.validate(next);
    return {
      next,
      activeMembers: preview.activeMembers,
      refreshActors: preview.refreshActors,
    };
  }
  private prepareRosterEvent(
    command: RosterCommand,
  ): RosterLifecycleTransaction {
    this.requireIdle();
    const { next, ...projection } = this.projectRosterEvent(this.data, command);
    const revision = this.revision;
    return {
      ...projection,
      commit: () => {
        this.requireIdle();
        if (this.revision !== revision)
          throw new Error("Stale field roster transaction");
        this.data = next;
        this.revision++;
      },
    };
  }
  /** Map initialization runs against this private draft. Publishing rebinds the
   * same ports to live state so later events keep a single state owner. */
  prepareFieldState(): {
    ports: {
      inventory: FieldInventoryPort;
      party: FieldPartyPort;
      roster: FieldRosterPort;
      fieldSteps?: FieldConditionPort;
      movementBlocker: (transportationId: number | null, manual: boolean) => string | null;
    };
    commit(): boolean;
  } {
    this.requireIdle();
    const revision = this.revision;
    let data = this.snapshot(),
      generation = 0,
      published = false,
      publicationRevision: number | null = null;
    const inventory: FieldInventoryPort = {
      prepare: (command) => {
        if (published) return this.prepareInventoryEvent(command);
        const { next, result } = this.projectInventoryEvent(data, command),
          version = generation;
        return {
          result,
          commit: () => {
            if (published || generation !== version)
              throw new Error("Stale candidate inventory transaction");
            data = next;
            generation++;
          },
        };
      },
    };
    const party: FieldPartyPort = {
      prepare: (command) => {
        if (published) return this.preparePartyEvent(command);
        const { next, ...projection } = this.projectPartyEvent(data, command),
          version = generation;
        return {
          ...projection,
          commit: () => {
            if (published || generation !== version)
              throw new Error("Stale candidate party transaction");
            data = next;
            generation++;
          },
        };
      },
    };
    const roster: FieldRosterPort = {
      prepare: (command) => {
        if (published) return this.prepareRosterEvent(command);
        const { next, ...projection } = this.projectRosterEvent(data, command),
          version = generation;
        return {
          ...projection,
          commit: () => {
            if (published || generation !== version)
              throw new Error("Stale candidate roster transaction");
            data = next;
            generation++;
          },
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
            if (generation !== version || (published &&
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
    return {
      ports: {
        inventory,
        party,
        roster,
        ...(this.fieldConditions ? { fieldSteps } : {}),
        movementBlocker: (transportationId, manual) =>
          this.movementBlocker(published ? this.data : data, transportationId, manual),
      },
      commit: () => {
        if (published || this.active || this.revision !== revision)
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
    if (members.some((member) => member.row !== "front"))
      return "后排战斗规则尚未迁移";
    return null;
  }
  partyPlayers(): Combatant[] {
    return this.activeParty.map(({ id }) => {
      const p = this.data.roster.find((p) => p.id === id)!;
      const {
        equipment: _,
        enabled: _enabled,
        ownedId: _ownedId,
        jobId: _job,
        additionalLevel: _additionalLevel,
        magicStoneId: _magicStone,
        ownedJobs: _jobs,
        abilities: _abilities,
        ...progress
      } = p;
      return {
        ...structuredClone(this.definitions.get(id)!),
        ...structuredClone(progress),
        ...(this.content.equipmentSystem ? this.projectOwnedParameters(p) : {}),
        atb: 0,
        queued: false,
        behavior: null,
      };
    });
  }
  private projectOwnedParameters(
    p: Pick<OwnedCharacter, "id" | "sourceId" | "level" | "equipment">,
  ): BattleStatProjection {
    const system = this.content.equipmentSystem;
    if (!system) throw new Error("Equipment system is unavailable");
    const definition = this.definitions.get(p.id),
      original = system.contexts[p.id];
    if (
      !definition ||
      definition.sourceId !== p.sourceId ||
      !original ||
      p.level < definition.level
    )
      throw new Error("Unresolved equipment growth origin");
    const context = structuredClone(original);
    for (let level = definition.level + 1; level <= p.level; level++) {
      const matches = system.growth[definition.growthGroup!]?.filter(
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
    p.equipment = prepared.roster.find((p) => p.id === playerId)!.equipment;
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
    const candidates = new Set([
      system.catalog.characters[p.sourceId]!.emptySlots[slot - 1]!,
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
    const target = this.partyPlayers().find((p) => p.id === targetId);
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
  openBattle(encounterId: number): BattleLease {
    this.requireIdle();
    if (this.battlePartyBlocker) throw new Error(this.battlePartyBlocker);
    integer(encounterId, 0x7fffffff, 1);
    const lease = Object.freeze({
      serial: this.data.completedBattles.length,
      encounterId,
    });
    this.active = {
      lease,
      players: this.partyPlayers(),
      items: structuredClone(this.data.items),
    };
    return lease;
  }
  battlePlayers(lease: BattleLease): Combatant[] {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return structuredClone(this.active.players);
  }
  battleInventory(lease: BattleLease): BattleInventory {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    return structuredClone({
      definitions: this.content.items,
      stacks: this.active.items,
      limit: this.content.limits.item,
    });
  }
  battleProgression(
    lease: BattleLease,
  ): ((player: Combatant) => BattleStatProjection) | undefined {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    if (!this.content.equipmentSystem) return undefined;
    return (player) => {
      if (this.active?.lease !== lease) throw new Error("Stale battle lease");
      const owned = this.data.roster.find((p) => p.id === player.id);
      if (!owned || owned.sourceId !== player.sourceId)
        throw new Error("Battle roster identity changed");
      return this.projectOwnedParameters({ ...owned, level: player.level });
    };
  }
  cancelBattle(lease: BattleLease): void {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    this.active = null;
  }
  prepareVictory(
    lease: BattleLease,
    result: { players: Combatant[]; gil: number; consumedItems: ItemStack[] },
  ): () => void {
    if (this.active?.lease !== lease) throw new Error("Stale battle lease");
    const next = this.snapshot(),
      revision = this.revision;
    integer(result.gil, 0x7fffffff);
    validateItemStacks(
      result.consumedItems,
      this.content.items,
      this.content.limits.item,
    );
    for (const used of result.consumedItems) {
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
    const party = activePartyMembers(next.party);
    if (
      result.players.length !== party.length ||
      result.players.some((p, n) => p.id !== party[n]!.id)
    )
      throw new Error("Battle party identity changed");
    for (const player of result.players) {
      const target = next.roster.find((p) => p.id === player.id)!;
      if (player.side !== "player" || player.sourceId !== target.sourceId)
        throw new Error("Battle roster identity changed");
      Object.assign(target, {
        hp: player.hp,
        mp: player.mp,
        maxHp: player.maxHp,
        maxMp: player.maxMp,
        level: player.level,
        additionalLevel: target.additionalLevel + player.level - target.level,
        exp: player.exp,
        conditionIds: [...player.conditionIds],
      });
    }
    next.gil = Math.min(this.content.limits.gil, next.gil + result.gil);
    next.totalGil += result.gil;
    next.completedBattles.push({ ...lease });
    this.validate(next);
    return () => {
      if (this.active?.lease !== lease || this.revision !== revision)
        throw new Error("Stale victory transaction");
      this.data = next;
      this.active = null;
      this.revision++;
    };
  }
}
