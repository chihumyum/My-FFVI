import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { FieldContent } from "../field/types.js";
import type { BattleCatalog } from "./battle-content.js";
import type { GameState } from "./game-state.js";
import type { FieldGame } from "./field.js";
import type { DevelopmentProfile } from "./development-profile.js";
import { canonical } from "./canonical.js";
import { createNewGame } from "./new-game.js";
import { EventState } from "./event-state.js";
import { assertSourceEntryProfiles, assertSourceGameCatalog, sourceCatalogProfile } from "./source-catalog.js";
import { createFrameworkFieldPartyActorCheckpoint, validateFieldActorFactory } from "./field-actor-factory.js";
import { validateFieldActorView } from "./field-actor-view.js";
import { validateFieldNativeFoot } from "./field-native-foot.js";
import { prepareMapPartyEntry, readMapPartySwitching } from "./map-party-entry.js";
import { installFreshGameActors, type NativeGameEntryContent } from "./source-new-game.js";
import { worldFieldContent, worldMapEntryView } from "./world-session.js";
import type { MapViewType } from "./map-view.js";

/** The source initializer and source route retain their own identities. This
 * entry declares a separate authored map; it grants no source reachability. */
export type FrameworkNewGameContent = NativeGameEntryContent & {
  kind: "framework-new-game-content-v1";
  initializerHash: string;
  developmentProfile: DevelopmentProfile;
  provenance: {
    kind: "source-initializer-authored-map-v1";
    sourceEntryHash: string;
    sourceMapHash: string;
  };
};

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid framework new-game record");
  const descriptors = Object.getOwnPropertyDescriptors(raw), own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid framework new-game fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function identity(raw: unknown): string {
  if (typeof raw !== "string" || !raw.length || raw.trim() !== raw) throw new Error("Missing framework new-game identity");
  return raw;
}
function digest(raw: unknown): string {
  const hash = identity(raw);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid framework new-game hash");
  return hash;
}
function integer(raw: unknown, minimum: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || Object.is(raw, -0) || raw < minimum || raw > 0x7fffffff)
    throw new Error("Invalid framework new-game entry identity");
  return raw;
}

/** Package parsing establishes metadata, not cryptographic trust. Repository
 * and asynchronous session factories verify all payload and initializer hashes. */
export function parseFrameworkNewGameContent(raw: unknown): FrameworkNewGameContent {
  const data = record(raw, ["kind", "contentHash", "sourceSetHash", "parentSourceSetHash", "battleCatalogHash",
    "worldCatalogHash", "mapContentHash", "initializerHash", "developmentProfile", "entry", "factory",
    "puppetCatalog", "view", "animationKeys", "provenance"]);
  if (data.kind !== "framework-new-game-content-v1") throw new Error("Unknown framework new-game kind");
  for (const key of ["contentHash", "battleCatalogHash", "worldCatalogHash", "mapContentHash", "initializerHash"]) digest(data[key]);
  identity(data.sourceSetHash); identity(data.parentSourceSetHash);
  const entry = record(data.entry, ["mapId", "entrance"]);
  integer(entry.mapId, 1); integer(entry.entrance, 0);
  const provenance = record(data.provenance, ["kind", "sourceEntryHash", "sourceMapHash"]);
  if (provenance.kind !== "source-initializer-authored-map-v1") throw new Error("Unknown framework new-game provenance");
  digest(provenance.sourceEntryHash); digest(provenance.sourceMapHash);
  if (sourceCatalogProfile(data.developmentProfile as DevelopmentProfile) !== "framework")
    throw new Error("Framework new-game requires an explicit development profile");
  const content = structuredClone(data) as FrameworkNewGameContent;
  validateFieldActorFactory(content.factory);
  validateFieldActorView(content.view);
  if (content.puppetCatalog?.kind !== "field-puppet-actors-v1" ||
      content.animationKeys?.kind !== "native-field-animation-keys-v1")
    throw new Error("Framework new-game actor providers are unavailable");
  return content;
}

/** Shared synchronous gate for already verified content. In particular this
 * never rewrites definition.transportation.newGame to the authored map. */
export function assertFrameworkNewGameBindings(content: FrameworkNewGameContent, world: WorldCatalog,
  map: WorldMapContent, battle: BattleCatalog): void {
  const entry = parseFrameworkNewGameContent(content);
  if (world.kind !== "world-development" || world.formatVersion !== 1 ||
      map.kind !== "world-map-development" || map.formatVersion !== 1 ||
      entry.battleCatalogHash !== battle.contentHash || entry.worldCatalogHash !== world.contentHash ||
      entry.mapContentHash !== map.contentHash || map.mapId !== entry.entry.mapId ||
      world.maps[String(map.mapId)]?.contentHash !== map.contentHash ||
      world.maps[String(map.mapId)]?.areaId !== map.areaId)
    throw new Error("Framework new-game dependency identity mismatch");
  if (entry.sourceSetHash !== world.sourceSetHash || entry.parentSourceSetHash !== world.parentSourceSetHash ||
      map.sourceSetHash !== world.sourceSetHash || map.parentSourceSetHash !== world.parentSourceSetHash ||
      map.mediaSourceSetHash !== world.mediaSourceSetHash)
    throw new Error("Framework new-game source identity mismatch");
  if (assertSourceEntryProfiles(entry, world, map) !== "framework")
    throw new Error("Framework new-game profile mismatch");
  assertSourceGameCatalog(battle, "framework");
  const points = map.partyEntry?.pointIns.filter(point => point.id === entry.entry.entrance) ?? [];
  const entities = map.map?.groups?.entity_default?.entities.filter(entity =>
    entity.kind === 0 && entity.objectId === entry.entry.entrance) ?? [];
  if (!map.map || map.map.identity?.mapId !== map.mapId || map.map.identity.areaId !== map.areaId ||
      map.partyEntry?.mapId !== map.mapId || points.length !== 1 || entities.length !== 1)
    throw new Error("Framework new-game PointIn identity mismatch");
  const point = points[0]!, entity = entities[0]!;
  if (point.x !== entity.x || point.y !== entity.y || point.layer !== entity.layer ||
      point.direction !== entity.direction || canonical(point.source) !== canonical(entity.source))
    throw new Error("Framework new-game PointIn source mismatch");
  if (!map.actorView || map.actorViewBlockers?.length || canonical(entry.view) !== canonical(map.actorView) ||
      !map.cameraHost || map.cameraHostBlockers?.length ||
      !world.nativeAnimationKeys || canonical(entry.animationKeys) !== canonical(world.nativeAnimationKeys))
    throw new Error("Framework new-game actor/camera/animation provider is unavailable");
  if (map.partyEntryBlockers?.length) throw new Error(map.partyEntryBlockers[0]!.reason);
  if (map.nativeCompositionBlockers?.length) throw new Error(map.nativeCompositionBlockers[0]!.reason);
  if (map.nativeFootBlockers?.length) throw new Error(map.nativeFootBlockers[0]!.reason);
  if (!map.nativeFoot) throw new Error("Framework new-game native foot provider is unavailable");
  validateFieldNativeFoot(map.nativeFoot, map.map.id, map.map.worldTerrain);
}

function validateInitialAnimationKeys(field: FieldContent, content: FrameworkNewGameContent, state: GameState): void {
  const checkpoint = field.entry.partyActors, catalog = state.fieldPartyAppearance?.catalog;
  if (!checkpoint || !catalog || !content.animationKeys.assets)
    throw new Error("Framework fresh animation owner is unavailable");
  const context = checkpoint.context;
  const used = [...[context.player, ...context.puppets].flatMap(actor =>
    actor?.fieldAssetId === null || actor === null ? [] : [actor.fieldAssetId]),
  ...(context.conditionResidents ?? []).flatMap(resident => resident.fieldAssetId === null ? [] : [resident.fieldAssetId])];
  for (const id of new Set(used)) {
    const asset = catalog.assets[id], character = asset && field.characters[asset.asset];
    const source = asset && content.animationKeys.assets[asset.asset];
    if (!asset || !character || !source || !Array.isArray(source.keys) ||
        Array.from(source.keys).some(key => typeof key !== "string" || !key) ||
        new Set(source.keys).size !== source.keys.length || !/^[a-f0-9]{64}$/.test(source.contentHash) ||
        Object.keys(character.animations).some(key => !source.keys.includes(key)))
      throw new Error("Framework fresh source animation binding is unavailable: " + (asset?.asset ?? id));
  }
}

/** Produce placement from the real initialized owner. EventState and the normal
 * map initializer are installed by the session; no source boot script runs here. */
export function prepareFrameworkNewGameField(content: FrameworkNewGameContent, world: WorldCatalog,
  map: WorldMapContent, battle: BattleCatalog, state: GameState, fade?: FieldContent["entry"]["fade"]) {
  assertFrameworkNewGameBindings(content, world, map, battle);
  const definition = battle.gameState.sourceNewGame, partyPort = state.fieldPartyAppearance;
  if (!definition || state.initialization !== "source-new-game" || state.catalogHash !== battle.contentHash || !partyPort)
    throw new Error("Framework new-game requires its source initialized owner");
  const fresh = createNewGame(definition), catalog = partyPort.catalog, party = partyPort.current();
  const initial = createFrameworkFieldPartyActorCheckpoint({ content, catalog, fresh, party,
    map: map.partyEntry!, playerId: "-1001" });
  const viewPlan = worldMapEntryView(map, fresh.entry.viewType as MapViewType);
  const plan = prepareMapPartyEntry(catalog, { definition: map.partyEntry!, entrance: content.entry.entrance,
    mapViewType: viewPlan?.presentationViewType ?? fresh.entry.viewType, prior: initial, playerVisible: true, party,
    ...(viewPlan ? { viewPlan } : {}),
    transportation: fresh.entry.transportation,
    canPartySwitching: readMapPartySwitching(ref => new EventState(fresh.events).read(ref)) });
  const asset = catalog.assets[plan.checkpoint.context.player.fieldAssetId!];
  if (!asset || plan.checkpoint.context.player.riding) throw new Error("Framework fresh player media is unresolved");
  const field = worldFieldContent(world, map, { mapId: map.mapId, entrance: content.entry.entrance,
    birdview: (fresh.entry.viewType as MapViewType) === 1 },
    { asset: asset.asset, mount: "", transportationId: fresh.entry.transportation.id }, content.parentSourceSetHash,
    { plan, assets: Object.values(catalog.assets).map(value => value.asset) }, fade, true);
  if (viewPlan) field.entry.viewPlan = viewPlan;
  field.contentHash = content.contentHash;
  field.limitations.push("作者地图使用来源初始化后的持有状态；不代表来源新游戏路线或剧情可达性。");
  validateInitialAnimationKeys(field, content, state);
  return { field, fresh, plan };
}

export function installFrameworkNewGameActors(field: FieldGame, content: FrameworkNewGameContent,
  state: GameState, map: WorldMapContent): void {
  const entry = parseFrameworkNewGameContent(content);
  if (field.content.contentHash !== entry.contentHash || field.content.map.identity?.mapId !== entry.entry.mapId ||
      map.mapId !== entry.entry.mapId || map.contentHash !== entry.mapContentHash ||
      state.initialization !== "source-new-game" || state.catalogHash !== entry.battleCatalogHash ||
      !map.actorView || canonical(entry.view) !== canonical(map.actorView) ||
      assertSourceEntryProfiles(entry, map, field.content) !== "framework")
    throw new Error("Framework new-game actor installation identity mismatch");
  validateInitialAnimationKeys(field.content, entry, state);
  installFreshGameActors(field, entry, state, map);
}
