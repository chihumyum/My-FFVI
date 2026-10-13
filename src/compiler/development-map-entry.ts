import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { BattleCatalog } from "../core/battle-content.js";
import { assertGameDevelopmentEntry, type GameDevelopmentEntry } from "../core/game-development-entry.js";
import { verifyContent } from "../core/content-integrity.js";
import { hash } from "./content.js";

export type DevelopmentMapEntryInput = {
  baseField: FieldContent;
  baseBattle: BattleCatalog;
  catalog: WorldCatalog;
  map: WorldMapContent;
  entrance: number;
};

/** Derive a separately identified development entry. Original baseline
 * gameplay, scripts, resources and sparse event seeds stay byte-equivalent;
 * source PointIn provenance records only an authored starting relocation. */
export async function compileDevelopmentMapEntry(input: DevelopmentMapEntryInput): Promise<FieldContent> {
  const { baseField, baseBattle, catalog, map, entrance } = structuredClone(input);
  if (Object.hasOwn(baseField, "developmentEntry") || Object.hasOwn(baseField, "developmentProfile"))
    throw new Error("Development map entry requires a raw development baseline");
  await Promise.all([verifyContent(baseField), verifyContent(baseBattle), verifyContent(catalog), verifyContent(map)]);
  const points = map.partyEntry?.pointIns.filter(point => point.id === entrance) ?? [];
  if (points.length !== 1) throw new Error("Missing or ambiguous development map PointIn");
  const developmentEntry: GameDevelopmentEntry = { kind: "game-development-map-entry-v1",
    baseFieldHash: baseField.contentHash, battleHash: baseBattle.contentHash,
    worldHash: catalog.contentHash, mapHash: map.contentHash, startMap: map.mapId, entrance,
    pointIn: structuredClone(points[0]!), provenance: { kind: "controlled-development-baseline-v1",
      state: "preserve-baseline", relocation: "source-point-in", storyReachability: "unverified" } };
  const { contentHash: _, ...baseline } = baseField;
  const payload = { ...baseline, developmentEntry,
    developmentProfile: { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
      sourceContentHash: baseField.contentHash, omissions: [],
      ...(catalog.developmentProfile?.transportation ? { transportation: catalog.developmentProfile.transportation } : {}) } };
  const result = { ...payload, contentHash: hash(payload) };
  await assertGameDevelopmentEntry(result, baseBattle, catalog, map);
  return result;
}
