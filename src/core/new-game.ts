import { checkpointKeys } from "./checkpoint-validation.js";
import { EventState, type EventStateSnapshot } from "./event-state.js";
import {
  initialEquipmentStock,
  type EquipmentCatalog,
  type EquipmentStock,
} from "./equipment.js";
import {
  createOwnedCharacter,
  type InitializedOwnedCharacter,
  type OwnedCharacterInitializationTemplate,
} from "./owned-character.js";
import { validatePartyState, type PartyState } from "./party.js";
import {
  Transportations,
  type TransportationCatalog,
  type TransportationIdentity,
} from "./transportation.js";

export type NewGameInventoryGrant = {
  kind: "item" | "equipment";
  id: number;
  count: number;
};

/** Source data for one fresh DataInitializeManager.Create. This is neither a
 * checkpoint seed nor an instruction to reset a running or restored session. */
export type NewGameDefinition = {
  kind: "source-new-game-v1";
  characters: { id: string; template: OwnedCharacterInitializationTemplate }[];
  party: PartyState;
  releasedJobIds: number[];
  inventory: NewGameInventoryGrant[];
  gil: number;
  limits: { gil: number; item: number };
  equipment: EquipmentCatalog;
  /** CreateItems grants these native empty-slot records before creating owners. */
  emptyEquipmentGrants: { id: number; count: 5 }[];
  transportation: TransportationCatalog;
};

export type NewGamePlan = {
  kind: "source-new-game-plan-v1";
  stage: "after-data-create-before-field-load";
  /** A complete initializer candidate is not yet an admitted game session. */
  publication: {
    state: "blocked";
    missingProviders: ["source-new-game-field-host"];
  };
  events: EventStateSnapshot;
  /** The shared owner must add its source growth contexts and save binding,
   * then publish this and the field candidates together. */
  owned: {
    roster: InitializedOwnedCharacter[];
    party: PartyState;
    gil: number;
    totalGil: number;
    items: { id: number; count: number }[];
    equipmentStock: EquipmentStock[];
    releasedJobIds: number[];
    learnedAbilityIds: number[];
    characterNames: Record<string, string>;
    completedBattles: never[];
  };
  entry: {
    mapId: number;
    entrance: number;
    scriptId: number;
    viewType: 0;
    transportation: TransportationIdentity;
    /** SaveMapManager's initial seed; PointIn still determines field position. */
    savedPlayer: { x: 0; y: 0; layer: 10; direction: 4 };
    moveCount: 0;
    subtractSteps: 0;
    beastExchangeFlags: number[];
    beastSeekGroupId: 0;
    /** No SetupEncountData or SetupScriptAfter has happened at this boundary. */
    entrySynchronized: false;
  };
  battlePreferences: { mode: "wait"; speedIndex: 2 };
  nativeInitialization: {
    ownedTransportationIds: number[];
    parkedTransportationMapIds: Record<string, -1>;
    crystalFlags: [false, false, false, false];
    warehouseItems: never[];
    keywords: never[];
    ownedMagic: never[];
    ownedMagicStones: never[];
    counters: {
      playTime: 0;
      escapeCount: 0;
      battleCount: 0;
      steps: 0;
      saveCompleteCount: 0;
      monstersKilledCount: 0;
      currentAreaType: 0;
    };
  };
};

function integer(value: number, minimum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid new-game " + label);
  return value;
}

/** Build a detached source initial state. There is deliberately no existing
 * state argument: initialization cannot merge zero defaults into a save. */
export function createNewGame(definition: NewGameDefinition): NewGamePlan {
  checkpointKeys(
    definition,
    "kind,characters,party,releasedJobIds,inventory,gil,limits,equipment,emptyEquipmentGrants,transportation",
  );
  if (definition.kind !== "source-new-game-v1")
    throw new Error("Invalid new-game definition");
  checkpointKeys(definition.limits, "gil,item");
  integer(definition.limits.gil, 1, "Gil limit");
  integer(definition.limits.item, 1, "item limit");
  integer(definition.gil, 0, "initial Gil");
  if (definition.equipment.limit !== definition.limits.item)
    throw new Error("New-game inventory capacity mismatch");
  if (
    !Array.isArray(definition.characters) ||
    !definition.characters.length ||
    definition.characters.length > 4
  )
    throw new Error("Unresolved initial owned-character count");
  const ids = new Set<string>(),
    sources = new Set<number>();
  const learnedAbilityIds: number[] = [],
    characterNames: Record<string, string> = {};
  const roster = definition.characters.map(({ id, template }, index) => {
    if (ids.has(id) || sources.has(template.initial.sourceId))
      throw new Error("Duplicate initial owned-character identity");
    ids.add(id);
    sources.add(template.initial.sourceId);
    const created = createOwnedCharacter(template, {
      id,
      ownedId: index + 1,
      releasedJobIds: definition.releasedJobIds,
      learnedAbilityIds,
    });
    learnedAbilityIds.push(...created.learnedAbilityIdsToAppend);
    if (created.nameBinding) {
      if (Object.hasOwn(characterNames, created.nameBinding.key))
        throw new Error("Ambiguous initial character name binding");
      Object.defineProperty(characterNames, created.nameBinding.key, {
        value: created.nameBinding.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return created.member;
  });
  validatePartyState(definition.party, roster);
  if (
    definition.party.selectedSlot !== 0 ||
    definition.party.slots
      .slice(1)
      .some((slot) => slot.some((cell) => cell.id !== null))
  )
    throw new Error("New-game party must start in the first Corps slot");
  const emptyIds = new Set<number>();
  for (const grant of definition.emptyEquipmentGrants) {
    checkpointKeys(grant, "id,count");
    if (emptyIds.has(grant.id) || grant.count !== 5 || !definition.equipment.definitions[grant.id]?.empty)
      throw new Error("Invalid native empty-equipment initialization");
    emptyIds.add(grant.id);
  }
  for (const item of Object.values(definition.equipment.definitions))
    if (item.empty && !emptyIds.has(item.id))
      throw new Error("Missing native empty-equipment grant");
  const initialEquipmentGrants: EquipmentStock[] = [];
  const items = new Map<number, number>();
  for (const grant of definition.inventory) {
    checkpointKeys(grant, "kind,id,count");
    integer(grant.id, 1, "content identity");
    integer(grant.count, 1, "item count");
    if (grant.kind === "equipment") {
      initialEquipmentGrants.push({ id: grant.id, count: grant.count });
    } else if (grant.kind === "item") {
      if (definition.equipment.definitions[grant.id])
        throw new Error("New-game item and equipment identity overlap");
      const previous = items.get(grant.id) ?? 0;
      const next = integer(
        previous + Math.min(grant.count, definition.limits.item),
        1,
        "merged item count",
      );
      items.set(grant.id, Math.min(next, definition.limits.item));
    } else throw new Error("Unresolved initial inventory owner");
  }
  // CreateItems grants configured items and the empty records before any
  // AddFromMaster. Initialization is independent of field reward admission.
  const equipmentStock = initialEquipmentStock(definition.equipment, roster,
    [...initialEquipmentGrants, ...definition.emptyEquipmentGrants]);
  const transportation = new Transportations(definition.transportation);
  const events = EventState.initialized();
  // CreateTransportationData visits each nonzero type. Its type-1 record writes
  // one release flag after DataStorage.Initialize cleared the entire bank.
  for (const source of definition.transportation.definitions)
    if (source.type === 1)
      events.write(transportation.releaseFlagRef(source.id), 1);
  const route = definition.transportation.newGame;
  return {
    kind: "source-new-game-plan-v1",
    stage: "after-data-create-before-field-load",
    publication: {
      state: "blocked",
      missingProviders: ["source-new-game-field-host"],
    },
    events: events.snapshot(),
    owned: {
      roster,
      party: structuredClone(definition.party),
      gil: Math.min(definition.gil, definition.limits.gil),
      totalGil: definition.gil,
      items: [...items]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => a.id - b.id),
      equipmentStock,
      releasedJobIds: [...definition.releasedJobIds],
      learnedAbilityIds,
      characterNames,
      completedBattles: [],
    },
    entry: {
      mapId: route.mapId,
      entrance: route.entrance,
      scriptId: route.scriptId,
      viewType: 0,
      transportation: transportation.newGameIdentity(),
      savedPlayer: { x: 0, y: 0, layer: 10, direction: 4 },
      moveCount: 0,
      subtractSteps: 0,
      beastExchangeFlags: Array<number>(400).fill(0),
      beastSeekGroupId: 0,
      entrySynchronized: false,
    },
    battlePreferences: { mode: "wait", speedIndex: 2 },
    nativeInitialization: {
      ownedTransportationIds: definition.transportation.definitions.map(
        (d) => d.id,
      ),
      parkedTransportationMapIds: Object.fromEntries(
        definition.transportation.definitions.map((d) => [
          String(d.id),
          -1 as const,
        ]),
      ),
      crystalFlags: [false, false, false, false],
      warehouseItems: [],
      keywords: [],
      ownedMagic: [],
      ownedMagicStones: [],
      counters: {
        playTime: 0,
        escapeCount: 0,
        battleCount: 0,
        steps: 0,
        saveCompleteCount: 0,
        monstersKilledCount: 0,
        currentAreaType: 0,
      },
    },
  };
}
