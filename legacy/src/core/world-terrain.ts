import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import type { Evidence, Point } from "../field/types.js";

export type WorldTerrainSource = Evidence & { objectId: string; sha256: string; serializedFile?: string };
export type WorldTerrainFootRow = {
  id: number; typeId: number; subtractSteps: number; battleBackgroundAssetId: number; source: WorldTerrainSource;
};
export type WorldTerrainTransportRule = {
  id: number; typeId: number; groupId: number;
  /** Original Type1..Type32 values. These are the separate CheckOkList input,
   * not the source transportation collision layer's 0/1 values. */
  groupFlags: number[];
  /** Lossless compression of the bound transportation layer by raw FootId.
   * The compiler rejects a layer if one FootId has different collision codes. */
  collisionByFoot: Record<string, 0 | 1>;
  source: WorldTerrainSource; groupSource: WorldTerrainSource; collisionSource: WorldTerrainSource;
};
/** One immutable content grid serves locomotion and native foot queries.
 * Transportation IDs, master foot IDs and master type IDs remain distinct. */
export type WorldTerrainDefinition = {
  kind: "source-world-terrain-v1"; contentHash: string;
  mapId: number; mapName: string; sourceSetHash: string; parentSourceSetHash: string;
  width: number; height: number; loopType: 0 | 1 | 2 | 3;
  cells: number[]; footRows: Record<string, WorldTerrainFootRow>;
  transportRules: Record<string, WorldTerrainTransportRule>;
  sources: { package: WorldTerrainSource; attribute: WorldTerrainSource; transportation: WorldTerrainSource;
    map: WorldTerrainSource; area: WorldTerrainSource };
};

export function validateWorldTerrainSource(source: WorldTerrainSource): void {
  if (!source || typeof source.file !== "string" || !source.file ||
      typeof source.assetPath !== "string" || !source.assetPath ||
      typeof source.objectId !== "string" || !/^-?\d+$/.test(source.objectId) ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      (source.serializedFile !== undefined && (typeof source.serializedFile !== "string" || !source.serializedFile)) ||
      (source.pointer !== undefined && (typeof source.pointer !== "string" || !source.pointer.startsWith("/"))) ||
      Object.keys(source).some(key => !["file", "assetPath", "objectId", "sha256", "serializedFile", "pointer"].includes(key)))
    throw new Error("Unbound world terrain source identity");
}

/** Validate the complete grid once at content admission, never on every step. */
export function validateWorldTerrain(definition: WorldTerrainDefinition,
  expected?: { mapId: number; mapName: string; width: number; height: number; loopType?: number }): void {
  checkpointKeys(definition, "kind,contentHash,mapId,mapName,sourceSetHash,parentSourceSetHash,width,height,loopType,cells,footRows,transportRules,sources");
  if (definition.kind !== "source-world-terrain-v1" || typeof definition.mapName !== "string" ||
      !definition.mapName || definition.mapName.trim() !== definition.mapName ||
      ![definition.contentHash, definition.sourceSetHash, definition.parentSourceSetHash].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)))
    throw new Error("Invalid world terrain header");
  checkpointInteger(definition.mapId, 1, 0x7fffffff);
  checkpointInteger(definition.width, 1, 0x7fffffff); checkpointInteger(definition.height, 1, 0x7fffffff);
  checkpointInteger(definition.loopType, 0, 3);
  const count = definition.width * definition.height;
  if (count > 0x7fffffff || !Array.isArray(definition.cells) || definition.cells.length !== count)
    throw new Error("Invalid world terrain grid dimensions");
  if (expected && (definition.mapId !== expected.mapId || definition.mapName !== expected.mapName ||
      definition.width !== expected.width || definition.height !== expected.height ||
      expected.loopType !== undefined && definition.loopType !== expected.loopType))
    throw new Error("World terrain belongs to another map");
  checkpointKeys(definition.sources, "package,attribute,transportation,map,area");
  for (const source of Object.values(definition.sources)) validateWorldTerrainSource(source);
  if (!definition.sources.package.assetPath.endsWith("/package.json") ||
      !definition.sources.attribute.assetPath.endsWith("/attribute.json") ||
      !definition.sources.transportation.assetPath.endsWith("/transportation.json") ||
      !definition.sources.map.assetPath.endsWith("map.csv") || !definition.sources.area.assetPath.endsWith("area.csv"))
    throw new Error("World terrain source roles are mismatched");
  for (const asset of [definition.sources.attribute, definition.sources.transportation])
    if (asset.file !== definition.sources.package.file || asset.sha256 !== definition.sources.package.sha256)
      throw new Error("World terrain source package mismatch");
  const footIds = new Set<string>();
  if (!definition.footRows || Array.isArray(definition.footRows) || !Object.keys(definition.footRows).length)
    throw new Error("Missing world terrain foot master");
  for (const [key, row] of Object.entries(definition.footRows)) {
    checkpointKeys(row, "id,typeId,subtractSteps,battleBackgroundAssetId,source");
    checkpointInteger(row.id, 1, 0x7fffffff); checkpointInteger(row.typeId, 1, 32);
    checkpointInteger(row.subtractSteps, 0, 0x7fffffff); checkpointInteger(row.battleBackgroundAssetId, 0, 0x7fffffff);
    if (key !== String(row.id)) throw new Error("World terrain foot master identity mismatch");
    validateWorldTerrainSource(row.source);
    if (!row.source.assetPath.endsWith("foot_information.csv") || row.source.pointer !== `/id/${row.id}`)
      throw new Error("Unbound world terrain foot master row");
  }
  for (const foot of definition.cells) {
    checkpointInteger(foot, 1, 0x7fffffff);
    if (!Object.hasOwn(definition.footRows, String(foot))) throw new Error("Unresolved world terrain foot master");
    footIds.add(String(foot));
  }
  if (!definition.transportRules || Array.isArray(definition.transportRules) || !Object.keys(definition.transportRules).length)
    throw new Error("Missing world terrain transportation rules");
  for (const [key, rule] of Object.entries(definition.transportRules)) {
    checkpointKeys(rule, "id,typeId,groupId,groupFlags,collisionByFoot,source,groupSource,collisionSource");
    checkpointInteger(rule.id, 1, 0x7fffffff); checkpointInteger(rule.typeId, 1, 12); checkpointInteger(rule.groupId, 1, 0x7fffffff);
    if (key !== String(rule.id) || !Array.isArray(rule.groupFlags) || rule.groupFlags.length !== 32)
      throw new Error("Invalid world terrain transportation identity/table");
    rule.groupFlags.forEach(value => checkpointInteger(value, 0, 0x7fffffff));
    if (!rule.collisionByFoot || Array.isArray(rule.collisionByFoot) ||
        Object.keys(rule.collisionByFoot).length !== footIds.size ||
        Object.entries(rule.collisionByFoot).some(([id, value]) => !footIds.has(id) || value !== 0 && value !== 1))
      throw new Error("Incomplete world terrain collision lookup");
    for (const source of [rule.source, rule.groupSource, rule.collisionSource]) validateWorldTerrainSource(source);
    if (!rule.source.assetPath.endsWith("transportation.csv") || rule.source.pointer !== `/id/${rule.id}` ||
        !rule.groupSource.assetPath.endsWith("transportation_group.csv") || rule.groupSource.pointer !== `/id/${rule.groupId}` ||
        rule.collisionSource.file !== definition.sources.transportation.file ||
        rule.collisionSource.assetPath !== definition.sources.transportation.assetPath ||
        rule.collisionSource.objectId !== definition.sources.transportation.objectId ||
        rule.collisionSource.sha256 !== definition.sources.transportation.sha256 ||
        !/^\/layers\/\d+$/.test(rule.collisionSource.pointer ?? ""))
      throw new Error("Unbound world terrain transportation row/layer");
  }
}

/** O(1) sampling on an already admitted definition. Logical world loop axes
 * wrap the cell; a non-looping outside cell has the raw native zero value. */
export function readWorldTerrainFoot(definition: WorldTerrainDefinition, cell: Readonly<Point>): number {
  if (!definition || definition.kind !== "source-world-terrain-v1") throw new Error("World terrain is unavailable");
  checkpointKeys(cell, "x,y"); checkpointInteger(cell.x, -0x80000000, 0x7fffffff); checkpointInteger(cell.y, -0x80000000, 0x7fffffff);
  const wrap = (n: number, size: number) => ((n % size) + size) % size;
  const x = (definition.loopType & 1) ? wrap(cell.x, definition.width) : cell.x;
  const y = (definition.loopType & 2) ? wrap(cell.y, definition.height) : cell.y;
  if (x < 0 || y < 0 || x >= definition.width || y >= definition.height) return 0;
  const value = definition.cells[y * definition.width + x];
  if (!Number.isInteger(value) || !definition.footRows[String(value)]) throw new Error("Unresolved world terrain foot cell");
  return value!;
}

/** Actual transportation ID selects its source GroupId layer. Only ordinary
 * walking/forced walking are admitted here: native airship Type5 merges the
 * player's collision layer; boarding/flight/landing require other contracts. */
export function worldTerrainCollisionMask(definition: WorldTerrainDefinition, transportId: number, cell: Readonly<Point>): 0 | 15 {
  checkpointInteger(transportId, 1, 0x7fffffff);
  const rule = definition.transportRules[String(transportId)];
  if (!rule || rule.typeId !== 1 && rule.typeId !== 12)
    throw new Error("World terrain transportation movement is not implemented");
  const foot = readWorldTerrainFoot(definition, cell);
  if (foot === 0) return 0;
  const collision = rule.collisionByFoot[String(foot)];
  if (collision !== 0 && collision !== 1) throw new Error("Missing world terrain collision cell");
  return collision === 0 ? 15 : 0;
}
