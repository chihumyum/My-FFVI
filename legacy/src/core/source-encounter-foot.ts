import type { FieldEntryContextDefinition } from "./field-entry-context.js";
import type { Evidence } from "../field/types.js";

export type SourceEncounterFootPlayer = {
  id: string;
  position: { x: number; y: number; z: number };
  layer: number;
};
export type SourceEncounterFootBackground = {
  kind: "source-encounter-foot-background-v1";
  mapId: number;
  player: SourceEncounterFootPlayer;
  origin: "default-or-excluded-unprojected" | "known-null";
  backgroundId: 0;
  /** Encount consumes only the nullable FootInfo's BG projection. A default
   * table's type0/SubtrackStep is not a master row or a null FootInfo; exclusion
   * can turn it null, and either path's consumed BG is exactly zero. */
  fullFootInformation: "not-projected";
  source: Evidence;
};
/** Source GetCurrentFootInformation 2e0990 -> GetEncountInfo 2d9a30/2d9950.
 * This is distinct from beast/qualification footAttributeType. It accepts the
 * trusted map-definition branches whose BG projection is proved regardless of
 * exclusion: default EncountTable has FootInfo(...,BG0)/overwrite0; absent
 * Attribute plus no default has no FootInfo. Terrain/overwrite selection needs
 * its own source provider and is never inferred from a zero qualification. */
export function captureSourceEncounterFootBackground(input: {
  definition: FieldEntryContextDefinition | undefined;
  mapId: number;
  entrySynchronized: boolean | null;
  player: Readonly<SourceEncounterFootPlayer>;
}): SourceEncounterFootBackground {
  const { definition, mapId, entrySynchronized, player } = input;
  if (!definition || definition.kind !== "field-entry-context-v1" || definition.mapId !== mapId ||
      !Number.isInteger(mapId) || mapId < 1 || mapId > 0x7fffffff)
    throw new Error("Source encounter foot requires its current trusted map definition");
  if (entrySynchronized !== true) throw new Error("Source encounter foot requires completed map entry synchronization");
  if (!player || typeof player.id !== "string" || !player.id || !player.position ||
      ![player.position.x, player.position.y, player.position.z].every(value => Number.isFinite(value) && Math.fround(value) === value) ||
      !Number.isInteger(player.layer) || player.layer < 0 || player.layer > 31)
    throw new Error("Source encounter foot requires the original native player pose");
  const foot = definition.foot;
  if (!foot || foot.kind !== "uniform-zero")
    throw new Error("Source terrain foot background, overwrite and exclusion selection are not hosted");
  if (!Number.isInteger(foot.monsterSetId) || foot.monsterSetId < 0 || foot.monsterSetId > 0x7fffffff ||
      foot.basis === "default-monster-set" && foot.monsterSetId === 0 ||
      foot.basis === "no-attribute-asset" && foot.monsterSetId !== 0 ||
      !["default-monster-set", "no-attribute-asset"].includes(foot.basis))
    throw new Error("Invalid source encounter foot default/attribute binding");
  if (!foot.source || typeof foot.source.file !== "string" || !foot.source.file ||
      typeof foot.source.assetPath !== "string" || !foot.source.assetPath ||
      foot.source.objectId !== undefined && (typeof foot.source.objectId !== "string" || !/^-?\d+$/.test(foot.source.objectId)))
    throw new Error("Unbound source encounter foot evidence");
  return { kind: "source-encounter-foot-background-v1", mapId, player: structuredClone(player),
    origin: foot.basis === "default-monster-set" ? "default-or-excluded-unprojected" : "known-null",
    backgroundId: 0, fullFootInformation: "not-projected", source: structuredClone(foot.source) };
}
