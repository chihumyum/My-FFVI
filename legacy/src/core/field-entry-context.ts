import type { BattleFieldState } from "./field-battle-entry.js";
import type { Evidence } from "../field/types.js";
import { readWorldTerrainFoot, validateWorldTerrainSource, type WorldTerrainDefinition, type WorldTerrainSource } from "./world-terrain.js";
import { checkpointKeys } from "./checkpoint-validation.js";

/** Qualification inputs only. This is not a random-encounter controller. */
export type FieldEntryContextDefinition = {
  kind: "field-entry-context-v1";
  mapId: number;
  beastFieldController: "source-singleton";
  foot:
    | { kind: "uniform-zero"; basis: "default-monster-set" | "no-attribute-asset"; monsterSetId: number; source: Evidence }
    | { kind: "source-terrain-grid"; basis: "attribute-type-dictionary-no-exclusions"; monsterSetId: number;
        mapName: string; terrainHash: string; sourceSetHash: string; parentSourceSetHash: string;
        /** Native SetFootInfoList keys by master TypeId, not master row Id.
         * This compact index references the terrain's existing master rows. */
        typeRowIds: Record<string, number>; source: Evidence }
    | { kind: "unresolved"; reason: string; source: Evidence };
  /** All source groups are inspected, including groups that are not yet active.
   * Active groups accumulate in FieldGame. Hiding a body is not a foot-list exit. */
  groups: Record<string, {
    savePointCount: number | null;
    reason: string | null;
    source: Evidence;
  }>;
};

export type FieldEntryContextInput = {
  mapId: number | null;
  transportationId: number | null;
  activeGroups: readonly string[];
  player: { x: number; y: number; layer: number };
  /** The host has actually completed this map's entry task and the equivalent
   * SetupEncountData. A stopped initializer is not a completed initializer.
   * This proof must survive Web checkpoints; it is never inferred from map ID. */
  entrySynchronized: boolean | null;
  /** Trusted content inputs, never state supplied by a save. No grid copy or
   * encounter-table/RNG owner is introduced by this qualification projection. */
  terrain?: WorldTerrainDefinition;
  sourceSetHash?: string;
  parentSourceSetHash?: string;
};

function integer(value: number, minimum = -0x80000000): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid field entry context integer");
}

function terrainFoot(definition: FieldEntryContextDefinition): Extract<FieldEntryContextDefinition["foot"], { kind: "source-terrain-grid" }> {
  const foot = definition.foot;
  if (foot.kind !== "source-terrain-grid") throw new Error("Missing field entry terrain provider");
  checkpointKeys(foot, "kind,basis,monsterSetId,mapName,terrainHash,sourceSetHash,parentSourceSetHash,typeRowIds,source");
  if (foot.basis !== "attribute-type-dictionary-no-exclusions" || foot.monsterSetId !== 0 ||
      typeof foot.mapName !== "string" || !foot.mapName || foot.mapName.trim() !== foot.mapName ||
      !foot.typeRowIds || typeof foot.typeRowIds !== "object" || Array.isArray(foot.typeRowIds) ||
      ![foot.terrainHash, foot.sourceSetHash, foot.parentSourceSetHash].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)))
    throw new Error("Invalid source terrain field foot provider");
  validateWorldTerrainSource(foot.source as WorldTerrainSource);
  if (!foot.source.assetPath.endsWith("/package.json") || !/^\/map\/\d+$/.test(foot.source.pointer ?? ""))
    throw new Error("Unbound source terrain field foot package");
  return foot;
}

function terrainBinding(definition: FieldEntryContextDefinition, terrain: WorldTerrainDefinition,
  identity: { sourceSetHash: string; parentSourceSetHash: string }): void {
  const foot = terrainFoot(definition);
  if (terrain.kind !== "source-world-terrain-v1" ||
      terrain.mapId !== definition.mapId || terrain.mapName !== foot.mapName || terrain.contentHash !== foot.terrainHash ||
      terrain.sourceSetHash !== foot.sourceSetHash || terrain.parentSourceSetHash !== foot.parentSourceSetHash ||
      identity.sourceSetHash !== foot.sourceSetHash || identity.parentSourceSetHash !== foot.parentSourceSetHash ||
      ["file", "assetPath", "objectId", "sha256", "serializedFile"].some(key =>
        (foot.source as WorldTerrainSource)[key as keyof WorldTerrainSource] !== terrain.sources.package[key as keyof WorldTerrainSource]))
    throw new Error("Field entry terrain source identity mismatch");
}

/** Complete compact master-index validation belongs to content admission.
 * Native 0x301a20 creates a TypeId-keyed dictionary; 0x316500 queries that key.
 * Ambiguous TypeIds require explicit source ordering, never a first row guess. */
export function validateFieldEntryTerrainBinding(definition: FieldEntryContextDefinition,
  terrain: WorldTerrainDefinition, identity: { sourceSetHash: string; parentSourceSetHash: string }): void {
  terrainBinding(definition, terrain, identity);
  const foot = terrainFoot(definition);
  const expected = new Map<number, number>();
  for (const row of Object.values(terrain.footRows)) {
    if (expected.has(row.typeId)) throw new Error("Ambiguous field entry foot TypeId dictionary");
    expected.set(row.typeId, row.id);
  }
  if (!foot.typeRowIds || Array.isArray(foot.typeRowIds) || Object.keys(foot.typeRowIds).length !== expected.size ||
      Object.entries(foot.typeRowIds).some(([type, rowId]) => type !== String(Number(type)) || expected.get(Number(type)) !== rowId))
    throw new Error("Field entry foot TypeId dictionary mismatch");
}

/** Derives the admitted uniform-foot/no-savepoint subset from trusted map data
 * plus actual host lifecycle state. Unresolved values remain null. Diagnostics
 * explain inputs; projectBattleFieldState decides which inputs are required by
 * the current transportation branch. Do not reject all diagnostics eagerly. */
export function projectFieldEntryContext(
  definition: FieldEntryContextDefinition | undefined,
  input: FieldEntryContextInput,
): { state: BattleFieldState; diagnostics: string[] } {
  if (input.mapId !== null) integer(input.mapId, 1);
  if (input.transportationId !== null) integer(input.transportationId, 1);
  for (const value of [input.player.x, input.player.y, input.player.layer]) integer(value);
  if (input.entrySynchronized !== null && typeof input.entrySynchronized !== "boolean")
    throw new Error("Invalid field entry synchronization proof");
  if (!Array.isArray(input.activeGroups) || input.activeGroups.some((name) => typeof name !== "string" || !name) ||
      new Set(input.activeGroups).size !== input.activeGroups.length)
    throw new Error("Invalid field entry active groups");
  const state: BattleFieldState = {
    mapId: input.mapId, transportationId: input.transportationId,
    isSavePoint: null, beastFieldController: null, footAttributeType: null,
  };
  const diagnostics: string[] = [];
  if (!definition) return { state, diagnostics: ["Missing source field entry context"] };
  if (definition.kind !== "field-entry-context-v1" || definition.mapId !== input.mapId ||
      definition.beastFieldController !== "source-singleton")
    throw new Error("Field entry context source identity mismatch");
  // Instance() lazily constructs the singleton. EncounterLot's constructor
  // binds it, including ordinary maps; map geography cannot mean absent.
  state.beastFieldController = true;
  if (definition.foot.kind === "uniform-zero") {
    integer(definition.foot.monsterSetId, 0);
    if (!["default-monster-set", "no-attribute-asset"].includes(definition.foot.basis) ||
        (definition.foot.basis === "default-monster-set" && definition.foot.monsterSetId === 0))
      throw new Error("Invalid uniform field foot provider");
    if (input.entrySynchronized === true) state.footAttributeType = 0;
    else diagnostics.push("Current map foot attribute has not completed source entry synchronization");
  } else if (definition.foot.kind === "unresolved" && definition.foot.reason) {
    diagnostics.push(definition.foot.reason);
  } else if (definition.foot.kind === "source-terrain-grid") {
    const foot = terrainFoot(definition);
    if (input.terrain && input.sourceSetHash !== undefined && input.parentSourceSetHash !== undefined)
      terrainBinding(definition, input.terrain, { sourceSetHash: input.sourceSetHash, parentSourceSetHash: input.parentSourceSetHash });
    if (input.entrySynchronized !== true) {
      diagnostics.push("Current map foot attribute has not completed source entry synchronization");
    } else if (!input.terrain || input.sourceSetHash === undefined || input.parentSourceSetHash === undefined) {
      diagnostics.push("Missing trusted source terrain for current field entry context");
    } else {
      const raw = readWorldTerrainFoot(input.terrain, { x: input.player.x, y: input.player.y });
      const rowId = Object.hasOwn(foot.typeRowIds, String(raw)) ? foot.typeRowIds[String(raw)] : undefined;
      if (rowId === undefined) state.footAttributeType = 0; // Absent nullable FootInfo in 0x7aabf0.
      else {
        integer(rowId, 1);
        const row = input.terrain.footRows[String(rowId)];
        if (!row || row.id !== rowId || row.typeId !== raw)
          throw new Error("Field entry foot TypeId dictionary mismatch");
        state.footAttributeType = row.typeId;
      }
    }
  } else throw new Error("Invalid source field foot provider");

  let noSavePoint = true;
  if (!input.activeGroups.length) {
    noSavePoint = false;
    diagnostics.push("Missing source active entity groups for save-point context");
  }
  for (const name of input.activeGroups) {
    const group = Object.hasOwn(definition.groups, name) ? definition.groups[name] : undefined;
    if (!group) {
      noSavePoint = false;
      diagnostics.push("Unknown source save-point entity group: " + name);
      continue;
    }
    if (group.savePointCount === null) {
      noSavePoint = false;
      diagnostics.push(group.reason || "Unresolved source save-point entity group: " + name);
    } else {
      integer(group.savePointCount, 0);
      if (group.savePointCount > 0) {
        noSavePoint = false;
        diagnostics.push("Save-point TriggerPower/TriggerOverlap and foot-event membership are not hosted: " + name);
      }
    }
  }
  if (noSavePoint) state.isSavePoint = false;
  return { state, diagnostics };
}
