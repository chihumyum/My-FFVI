import type { VariableRef } from "./event-state.js";

/** TransportationController identity is independent of an actor's riding
 * structure. This model owns no position, release flags, renderer or save. */
export type TransportationIdentity = {
  id: number;
  type: number;
  assetId: number;
};

export type TransportationDefinition = TransportationIdentity & {
  releaseFlag: number;
};

export type TransportationCatalog = {
  definitions: TransportationDefinition[];
  newGame: {
    mapId: number;
    entrance: number;
    scriptId: number;
    transportationId: number;
  };
};

export type TransportationAvailability = Readonly<
  Record<string, boolean | null>
>;

export type TransportationChange = {
  previousId: number | null;
  requestedId: number;
  currentId: number | null;
  currentType: number;
  selected: boolean;
};

export type TransportationMapEntry = {
  /** null means a newly created controller with no current transport. It must
   * not be used to conceal an unknown live or checkpoint identity. */
  currentId: number | null;
  loadId: number;
  mapId: number;
  stayMapIds: Readonly<Record<string, number | null>>;
  availability: TransportationAvailability;
  allowsAttribute?: (transportationId: number) => boolean;
};

// MapConstants::.cctor 0x43b490; these are transportation TYPES, not IDs.
const symbolTypes = new Set([2, 3, 4, 6, 7, 8, 9, 10]);
const notPossibleVoluntaryGetOffTypes = new Set([11, 12]);

function integer(value: number, minimum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid transportation " + label);
}

/** Pure, source-scoped identity projection. A successful projection does not
 * admit vehicle collision, visual switching, flight, landing or boarding. */
export class Transportations {
  private readonly definitions = new Map<number, TransportationDefinition>();
  private readonly newGame;

  constructor(catalog: TransportationCatalog) {
    for (const definition of catalog.definitions) {
      integer(definition.id, 1, "identity");
      integer(definition.type, 1, "type");
      integer(definition.assetId, 0, "asset identity");
      integer(definition.releaseFlag, 0, "release flag");
      if (definition.releaseFlag > 1023)
        throw new Error("Unresolved transportation release-flag category");
      if (definition.type > 12)
        throw new Error("Unresolved transportation type provider");
      if (this.definitions.has(definition.id))
        throw new Error("Duplicate transportation identity");
      this.definitions.set(definition.id, { ...definition });
    }
    this.newGame = { ...catalog.newGame };
    integer(this.newGame.mapId, 1, "new-game map");
    integer(this.newGame.entrance, 0, "new-game entrance");
    integer(this.newGame.scriptId, 0, "new-game script");
    const players = [...this.definitions.values()].filter((d) => d.type === 1);
    // Native selects the first type-1 row (and GetPlayer the last). Ambiguous
    // source data must not turn that disagreement into a guessed identity.
    if (
      players.length !== 1 ||
      players[0]!.id !== this.newGame.transportationId
    )
      throw new Error("Ambiguous new-game player transportation");
    this.identity(1); // Both ordinary PointIn overloads write literal ID 1.
  }

  identity(id: number): TransportationIdentity {
    integer(id, 1, "identity");
    const value = this.definitions.get(id);
    if (!value) throw new Error("Unknown transportation identity: " + id);
    return { id: value.id, type: value.type, assetId: value.assetId };
  }

  newGameIdentity(): TransportationIdentity {
    return this.identity(this.newGame.transportationId);
  }

  /** LoadData.NextMapData(mapId, point) and NextMapData(PropertyGotoMap). */
  pointInIdentity(): TransportationIdentity {
    return this.identity(1);
  }

  /** OwnedTransportationData uses TreasureFlag1..4, not ScenarioFlag1..4. */
  releaseFlagRef(id: number): VariableRef {
    this.identity(id);
    const flag = this.definitions.get(id)!.releaseFlag;
    const category = [
      "TreasureFlag1",
      "TreasureFlag2",
      "TreasureFlag3",
      "TreasureFlag4",
    ] as const;
    return { category: category[Math.floor(flag / 256)]!, index: flag % 256 };
  }

  /** Reads the existing event-state owner. SaveTransportationData.enable is
   * not authoritative for OwnedTransportationData.Enable. */
  availability(
    read: (ref: VariableRef) => number | null,
  ): Record<string, boolean | null> {
    return Object.fromEntries(
      [...this.definitions.values()].map((d) => {
        const value = read(this.releaseFlagRef(d.id));
        if (value !== null && value !== 0 && value !== 1)
          throw new Error("Invalid transportation release flag value");
        return [String(d.id), value === null ? null : value !== 0];
      }),
    );
  }

  /** RestoreSaveData copies the saved ID. No absent-value walking fallback. */
  restoreIdentity(id: number): TransportationIdentity {
    return this.identity(id);
  }

  /** Only valid immediately after DataStorage.Initialize and source new-game
   * creation, before scenario code can alter release flags. */
  newGameAvailability(): Record<string, boolean> {
    return Object.fromEntries(
      [...this.definitions.values()].map((d) => [String(d.id), d.type === 1]),
    );
  }

  /** AutomationSelectId. The caller must provide terrain compatibility when
   * an enabled seamless alternative can actually be selected. A missing
   * provider is irrelevant only if the source candidate set is empty. */
  selectForMap(
    assumeId: number,
    availability: TransportationAvailability,
    allowsAttribute?: (transportationId: number) => boolean,
  ): TransportationIdentity {
    const assumed = this.identity(assumeId);
    if (assumed.type !== 1) return assumed;
    for (const candidate of this.definitions.values()) {
      if (
        candidate.id === assumeId ||
        symbolTypes.has(candidate.type) ||
        notPossibleVoluntaryGetOffTypes.has(candidate.type)
      )
        continue;
      if (!this.enabled(candidate.id, availability)) continue;
      if (!allowsAttribute)
        throw new Error("Missing transportation terrain provider");
      const allowed = allowsAttribute(candidate.id);
      if (typeof allowed !== "boolean")
        throw new Error("Unknown transportation terrain compatibility");
      if (allowed) return this.identity(candidate.id);
    }
    return assumed;
  }

  /** MapViewSetup 0x2e6fe0 distinguishes an existing controller from first
   * setup after load. A PointIn LoadData ID does not override a retained
   * symbol or non-disembarkable transport. The final Change projection still
   * requires the target release flag, regardless of how its ID was chosen. */
  projectMapEntry(input: TransportationMapEntry): TransportationChange {
    integer(input.mapId, 1, "destination map");
    const loaded = this.identity(input.loadId);
    let assumed = this.newGameIdentity();
    if (input.currentId !== null) {
      const current = this.identity(input.currentId);
      if (
        current.type === 1 ||
        symbolTypes.has(current.type) ||
        notPossibleVoluntaryGetOffTypes.has(current.type)
      )
        assumed = current;
    } else if (notPossibleVoluntaryGetOffTypes.has(loaded.type)) {
      assumed = loaded;
    } else if (symbolTypes.has(loaded.type)) {
      const stay = input.stayMapIds[String(loaded.id)];
      if (
        !Number.isInteger(stay) ||
        (stay as number) < -1 ||
        (stay as number) > 0x7fffffff
      )
        throw new Error("Unknown transportation stay map: " + loaded.id);
      if (stay === input.mapId) assumed = loaded;
    }
    const target = this.selectForMap(
      assumed.id,
      input.availability,
      input.allowsAttribute,
    );
    return this.projectChange(input.currentId, target.id, input.availability);
  }

  /** The identity assignment in ChangeTransportation 0x990fd0. Known disabled
   * targets retain the current identity; unknown inputs are admission errors.
   * The owner must prepare all field/media effects before publishing this. */
  projectChange(
    currentId: number | null,
    requestedId: number,
    availability: TransportationAvailability,
  ): TransportationChange {
    const current = currentId === null ? null : this.identity(currentId);
    const requested = this.identity(requestedId);
    const selected = this.enabled(requestedId, availability);
    return {
      previousId: currentId,
      requestedId,
      currentId: selected ? requestedId : currentId,
      currentType: selected ? requested.type : (current?.type ?? 0),
      selected,
    };
  }

  private enabled(
    id: number,
    availability: TransportationAvailability,
  ): boolean {
    const value = availability[String(id)];
    if (typeof value !== "boolean")
      throw new Error("Unknown transportation availability: " + id);
    return value;
  }
}
