import type { BattleFieldState } from "./field-battle-entry.js";
import type { Evidence } from "../field/types.js";

/** Qualification inputs only. This is not a random-encounter controller. */
export type FieldEntryContextDefinition = {
  kind: "field-entry-context-v1";
  mapId: number;
  beastFieldController: "source-singleton";
  foot:
    | { kind: "uniform-zero"; basis: "default-monster-set" | "no-attribute-asset"; monsterSetId: number; source: Evidence }
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
};

function integer(value: number, minimum = -0x80000000): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid field entry context integer");
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
