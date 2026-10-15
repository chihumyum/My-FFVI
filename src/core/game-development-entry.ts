import type { Evidence, FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { BattleCatalog } from "./battle-content.js";
import type { MapPartyEntryDefinition } from "./map-party-entry.js";
import type { DevelopmentProfile } from "./development-profile.js";
import { GameSession, type GameSessionRuntime } from "./game-session.js";
import { canonical } from "./canonical.js";
import { verifyContent } from "./content-integrity.js";
import { assertSourceEntryProfiles, sourceCatalogProfile } from "./source-catalog.js";

export type GameDevelopmentEntry = {
  kind: "game-development-map-entry-v1";
  baseFieldHash: string;
  battleHash: string;
  worldHash: string;
  mapHash: string;
  startMap: number;
  entrance: number;
  pointIn: MapPartyEntryDefinition["pointIns"][number];
  provenance: {
    kind: "controlled-development-baseline-v1";
    state: "preserve-baseline";
    relocation: "source-point-in";
    storyReachability: "unverified";
  };
};

function record(raw: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid development map entry record");
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== null) {
    if (typeof prototype !== "object" || Object.getPrototypeOf(prototype) !== null)
      throw new Error("Invalid development map entry prototype");
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (!constructor || !("value" in constructor) || typeof constructor.value !== "function" ||
        Object.getOwnPropertyDescriptor(constructor.value, "prototype")?.value !== prototype ||
        Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(Object))
      throw new Error("Invalid development map entry prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(raw);
  if (keys.some(key => typeof key !== "string" || ![...required, ...optional].includes(key)) ||
      required.some(key => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid development map entry fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.trim() !== value) throw new Error("Missing development map entry identity");
  return value;
}
function digest(value: unknown): string {
  const hash = text(value);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid development map entry hash");
  return hash;
}
function integer(value: unknown, minimum: number, maximum = 0x7fffffff): number {
  if (typeof value !== "number" || !Number.isInteger(value) || Object.is(value, -0) || value < minimum || value > maximum)
    throw new Error("Invalid development map entry integer");
  return value;
}
function evidence(raw: unknown): Evidence {
  const source = record(raw, ["file", "assetPath"], ["objectId", "pointer", "serializedFile", "sha256"]);
  text(source.file); text(source.assetPath);
  for (const key of ["objectId", "pointer", "serializedFile"]) if (Object.hasOwn(source, key)) text(source[key]);
  if (Object.hasOwn(source, "objectId")) {
    const id = source.objectId as string;
    if (!/^-?(?:0|[1-9]\d*)$/.test(id) || id === "-0" || BigInt(id) < -(1n << 63n) || BigInt(id) >= (1n << 63n))
      throw new Error("Invalid development map entry source object");
  }
  if (Object.hasOwn(source, "sha256")) digest(source.sha256);
  return structuredClone(source) as Evidence;
}

/** Metadata describes an explicit relocation of an existing development
 * checkpoint. It grants no source story state, owner or instruction support. */
export function parseGameDevelopmentEntry(raw: unknown): GameDevelopmentEntry {
  const value = record(raw, ["kind", "baseFieldHash", "battleHash", "worldHash", "mapHash", "startMap", "entrance", "pointIn", "provenance"]);
  if (value.kind !== "game-development-map-entry-v1") throw new Error("Unknown development map entry kind");
  const point = record(value.pointIn, ["id", "x", "y", "layer", "direction", "linkObject", "source"]);
  if (!["up", "right", "down", "left"].includes(point.direction as string)) throw new Error("Invalid development PointIn direction");
  const provenance = record(value.provenance, ["kind", "state", "relocation", "storyReachability"]);
  if (provenance.kind !== "controlled-development-baseline-v1" || provenance.state !== "preserve-baseline" ||
      provenance.relocation !== "source-point-in" || provenance.storyReachability !== "unverified")
    throw new Error("Unsupported development map entry provenance");
  const entrance = integer(value.entrance, 0);
  if (integer(point.id, 0) !== entrance) throw new Error("Development map entry PointIn identity mismatch");
  return { kind: "game-development-map-entry-v1", baseFieldHash: digest(value.baseFieldHash),
    battleHash: digest(value.battleHash), worldHash: digest(value.worldHash), mapHash: digest(value.mapHash),
    startMap: integer(value.startMap, 1), entrance,
    pointIn: { id: entrance, x: integer(point.x, 0), y: integer(point.y, 0), layer: integer(point.layer, 0, 3),
      direction: point.direction as GameDevelopmentEntry["pointIn"]["direction"],
      linkObject: integer(point.linkObject, 0), source: evidence(point.source) },
    provenance: { kind: "controlled-development-baseline-v1", state: "preserve-baseline",
      relocation: "source-point-in", storyReachability: "unverified" } };
}

export function gameDevelopmentEntryProfile(baseFieldHash: string, catalog: WorldCatalog): DevelopmentProfile {
  if (sourceCatalogProfile(catalog.developmentProfile) !== "framework") throw new Error("Development map entry requires a framework catalog");
  return { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: baseFieldHash, omissions: [],
    ...(catalog.developmentProfile!.transportation ? { transportation: catalog.developmentProfile!.transportation } : {}),
    ...(catalog.developmentProfile!.worldMap ? { worldMap: catalog.developmentProfile!.worldMap } : {}),
    ...(catalog.developmentProfile!.fieldPresentation ? { fieldPresentation: catalog.developmentProfile!.fieldPresentation } : {}),
    ...(catalog.developmentProfile!.worldAutoMove ? {worldAutoMove:catalog.developmentProfile!.worldAutoMove}:{}),
    ...(catalog.developmentProfile!.worldAutoTasks ? { worldAutoTasks: catalog.developmentProfile!.worldAutoTasks } : {}),
    ...(catalog.developmentProfile!.storyRuntime ? { storyRuntime: catalog.developmentProfile!.storyRuntime } : {}),
    ...(catalog.developmentProfile!.autoSave ? { autoSave: catalog.developmentProfile!.autoSave } : {}) };
}

/** Only the exact marker this compiler owns may be removed. A caller cannot
 * hide arbitrary omissions or another derivation while claiming a raw base. */
export function gameDevelopmentEntryBaseline(field: FieldContent, catalog: WorldCatalog): FieldContent {
  const entry = parseGameDevelopmentEntry(field.developmentEntry);
  if (canonical(field.developmentProfile) !== canonical(gameDevelopmentEntryProfile(entry.baseFieldHash, catalog)))
    throw new Error("Development map entry profile does not preserve its baseline");
  const { developmentEntry: _, developmentProfile: _profile, contentHash: _hash, ...baseline } = structuredClone(field);
  return { ...baseline, contentHash: entry.baseFieldHash };
}

/** Shared synchronous identity gate for callers which have already verified
 * their payload digests. Baseline payload integrity is checked separately by
 * the compiler and by assertGameDevelopmentEntry below. */
export function validateGameDevelopmentEntryBindings(field: FieldContent, battle: BattleCatalog,
  catalog: WorldCatalog, map: WorldMapContent): GameDevelopmentEntry {
  const entry = parseGameDevelopmentEntry(field.developmentEntry);
  gameDevelopmentEntryBaseline(field, catalog);
  if (field.kind !== "field-development" || field.formatVersion !== 1 || battle.kind !== "narshe-battle-catalog" ||
      catalog.kind !== "world-development" || catalog.formatVersion !== 1 ||
      map.kind !== "world-map-development" || map.formatVersion !== 1 ||
      battle.contentHash !== entry.battleHash || catalog.contentHash !== entry.worldHash || map.contentHash !== entry.mapHash ||
      map.mapId !== entry.startMap || catalog.maps[String(entry.startMap)]?.contentHash !== entry.mapHash ||
      catalog.maps[String(entry.startMap)]?.areaId !== map.areaId)
    throw new Error("Development map entry dependency identity mismatch");
  if (field.sourceSetHash !== battle.common.fieldSourceSetHash || field.parentSourceSetHash !== catalog.parentSourceSetHash ||
      map.parentSourceSetHash !== catalog.parentSourceSetHash || map.sourceSetHash !== catalog.sourceSetHash ||
      map.mediaSourceSetHash !== catalog.mediaSourceSetHash)
    throw new Error("Development map entry source identity mismatch");
  if (assertSourceEntryProfiles(field, catalog, map) !== "framework") throw new Error("Development map entry requires a framework profile");
  const points = map.partyEntry?.pointIns.filter(point => point.id === entry.entrance) ?? [];
  const entities = map.map?.groups?.entity_default?.entities.filter(entity => entity.kind === 0 && entity.objectId === entry.entrance) ?? [];
  if (!map.map || map.map.identity?.mapId !== map.mapId || map.map.identity.areaId !== map.areaId ||
      map.partyEntry?.mapId !== map.mapId || points.length !== 1 || entities.length !== 1 ||
      canonical(points[0]) !== canonical(entry.pointIn))
    throw new Error("Development map entry PointIn source mismatch");
  const point = entities[0]!;
  if (point.x !== entry.pointIn.x || point.y !== entry.pointIn.y || point.layer !== entry.pointIn.layer ||
      point.direction !== entry.pointIn.direction || canonical(point.source) !== canonical(entry.pointIn.source))
    throw new Error("Development map entry PointIn geometry mismatch");
  return entry;
}

export async function assertGameDevelopmentEntry(field: FieldContent, battle: BattleCatalog,
  catalog: WorldCatalog, map: WorldMapContent): Promise<GameDevelopmentEntry> {
  const captured = structuredClone({ field, battle, catalog, map });
  const entry = validateGameDevelopmentEntryBindings(captured.field, captured.battle, captured.catalog, captured.map);
  await Promise.all([verifyContent(captured.field), verifyContent(captured.battle), verifyContent(captured.catalog), verifyContent(captured.map),
    verifyContent(gameDevelopmentEntryBaseline(captured.field, captured.catalog), entry.baseFieldHash)]);
  return entry;
}

/** Prepare relocation on a private session using the same map transaction as
 * ordinary play. EntryLoader owns external publication; normal logical ticks
 * execute the original scheduled initializer. Restore never calls this helper. */
export async function prepareGameDevelopmentEntry(field: FieldContent, battle: BattleCatalog,
  catalog: WorldCatalog, map: WorldMapContent, runtime: GameSessionRuntime = {}, seed = 20261010): Promise<GameSession> {
  const captured = structuredClone({ field, battle, catalog, map });
  const capturedRuntime = { ...runtime };
  const entry = await assertGameDevelopmentEntry(captured.field, captured.battle, captured.catalog, captured.map);
  const game = new GameSession(captured.field, captured.battle, seed, capturedRuntime);
  game.field.previewMap(entry.startMap, entry.entrance);
  const candidate = game.world.prepare(captured.catalog, captured.map);
  try {
    if (!game.world.commit(candidate)) throw new Error("Development map entry relocation became obsolete");
  } catch (error) { game.world.discard(candidate); throw error; }
  return game;
}
