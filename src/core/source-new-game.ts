import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { FieldContent } from "../field/types.js";
import type { BattleCatalog } from "./battle-content.js";
import type { GameState } from "./game-state.js";
import { createNewGame } from "./new-game.js";
import { createFreshFieldPartyActorCheckpoint, createFieldActorFactoryCandidate,
  type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import type { FieldPuppetActorCatalog } from "./field-puppet-actors.js";
import type { FieldActorViewDefinition } from "./field-actor-view.js";
import type { NewGameFieldEntryDefinition, NewGameFieldLaunch } from "./new-game-field-entry.js";
import { prepareMapPartyEntry, readMapPartySwitching } from "./map-party-entry.js";
import { fieldCameraCellToWorld, fieldCameraLayerFromLogical } from "./field-camera.js";
import { worldFieldContent } from "./world-session.js";
import type { FieldGame } from "./field.js";
import { prepareNativeFieldProviders } from "./field-native-providers.js";
import { EventState } from "./event-state.js";
import { canonical } from "./canonical.js";
import type { FieldNativeAnimationKeys } from "./field-native-appearance.js";
import type { DevelopmentProfile } from "./development-profile.js";

/** Binds the differently scoped source manifests explicitly. The battle
 * package's development-field fingerprint is never relabelled as the corpus. */
export type SourceNewGameContent = {
  kind: "source-new-game-content-v1";
  contentHash: string;
  developmentProfile?: DevelopmentProfile;
  sourceSetHash: string;
  parentSourceSetHash: string;
  battleCatalogHash: string;
  worldCatalogHash: string;
  mapContentHash: string;
  entry: NewGameFieldEntryDefinition;
  factory: FieldActorFactoryCatalog;
  puppetCatalog: FieldPuppetActorCatalog;
  view: FieldActorViewDefinition;
  animationKeys: FieldNativeAnimationKeys;
};

export function prepareSourceNewGameField(content: SourceNewGameContent, world: WorldCatalog,
  map: WorldMapContent, battle: BattleCatalog, state: GameState, fade: FieldContent["entry"]["fade"]) {
  const definition = battle.gameState.sourceNewGame;
  if (content.kind !== "source-new-game-content-v1" || !definition || state.initialization !== "source-new-game" ||
      content.battleCatalogHash !== battle.contentHash || content.worldCatalogHash !== world.contentHash ||
      content.mapContentHash !== map.contentHash || world.maps[String(map.mapId)]?.contentHash !== map.contentHash ||
      content.sourceSetHash !== world.sourceSetHash || map.sourceSetHash !== world.sourceSetHash ||
      !map.actorView || map.actorViewBlockers?.length || canonical(content.view) !== canonical(map.actorView) ||
      !world.nativeAnimationKeys || canonical(content.animationKeys) !== canonical(world.nativeAnimationKeys) ||
      content.parentSourceSetHash !== world.parentSourceSetHash || map.parentSourceSetHash !== world.parentSourceSetHash)
    throw new Error("Fresh game source/content binding mismatch");
  const fresh = createNewGame(definition), partyPort = state.fieldPartyAppearance;
  if (!partyPort || !map.partyEntry || !map.cameraHost || map.cameraHostBlockers?.length ||
      fresh.entry.mapId !== content.entry.mapId || fresh.entry.entrance !== content.entry.entrance ||
      fresh.entry.scriptId !== content.entry.reservedScript.id || map.mapId !== fresh.entry.mapId ||
      map.scriptPuppetContexts?.[content.entry.reservedScript.name]?.scriptHash !== content.entry.reservedScript.contentHash)
    throw new Error("Fresh game route or actor/camera provider is unavailable");
  const party = partyPort.current(), catalog = partyPort.catalog;
  const initial = createFreshFieldPartyActorCheckpoint({ factory: content.factory, catalog,
    fresh, party, map: map.partyEntry, playerId: "-1001" });
  const plan = prepareMapPartyEntry(catalog, { definition: map.partyEntry, entrance: fresh.entry.entrance,
    mapViewType: fresh.entry.viewType, prior: initial, playerVisible: true, party,
    transportation: fresh.entry.transportation,
    canPartySwitching: readMapPartySwitching((ref) => new EventState(fresh.events).read(ref)) });
  const asset = catalog.assets[plan.checkpoint.context.player.fieldAssetId!];
  if (!asset || plan.checkpoint.context.player.riding) throw new Error("Fresh player media is unresolved");
  const field = worldFieldContent(world, map, { mapId: map.mapId, entrance: fresh.entry.entrance, birdview: false },
    { asset: asset.asset, mount: "", transportationId: fresh.entry.transportation.id }, content.parentSourceSetHash,
    { plan, assets: Object.values(catalog.assets).map((a) => a.asset) }, fade, true);
  // This is a fresh-session identity. It cannot restore a development checkpoint.
  field.contentHash = content.contentHash;
  field.limitations.push("原始新游戏入口已接入；原生演员稳定存档、完整开场与后续切图仍需逐项接通。",
    "Canvas 保留原生材质输入；GPU 着色器、上层遮罩与色彩处理尚未通过原版对照。");
  return { field, fresh, plan };
}

/** Called after real MapSetup and media preparation and before the reserved
 * script. No second actor list survives installation in FieldGame. */
export function installSourceNewGameActors(field: FieldGame, content: SourceNewGameContent,
  state: GameState, map: WorldMapContent): void {
  const party = state.fieldPartyAppearance, checkpoint = field.partyActorCheckpoint, camera = field.cameraSnapshot;
  if (!party || !checkpoint || !camera || !map.partyEntry || !field.content.cameraHost)
    throw new Error("Fresh field was not prepared with its party and camera owners");
  if (map.nativeFootBlockers?.length) throw new Error(map.nativeFootBlockers[0]!.reason);
  const providers = prepareNativeFieldProviders(field, content.view, map.nativeFoot);
  const p = field.player, range = map.partyEntry.mapRange;
  const candidate = createFieldActorFactoryCandidate({ factory: content.factory, partyCatalog: party.catalog,
    checkpoint, characters: field.content.characters,
    player: { position: fieldCameraCellToWorld(range, { x: p.x - range.x, y: p.y - range.y }, p.layer),
      layer: fieldCameraLayerFromLogical(p.layer).layer, direction: p.direction, visible: field.isEntityVisible(p.id) },
    camera: { id: field.cameraActorId, position: camera.dummy.position, layer: camera.dummy.layer }, providers: providers() });
  field.installNativeActors(candidate, content.puppetCatalog, providers, { worldMapScript: false, callback: "absent" },
    content.animationKeys, { factory: content.factory });
  field.initializeMapCamera();
}

export function validateSourceNewGameLaunch(content: SourceNewGameContent, launch: NewGameFieldLaunch): void {
  if (launch.mapId !== content.entry.mapId || launch.entrance !== content.entry.entrance ||
      launch.scriptName !== content.entry.reservedScript.name || launch.scriptContentHash !== content.entry.reservedScript.contentHash ||
      launch.entrySynchronized !== false || launch.startChangeState !== true || launch.endChangeState !== true ||
      launch.fallbackBranch !== "discard-after-reserved-script" || launch.sourcePresentation.origin !== "title-new-game" ||
      launch.sourcePresentation.advertisementOpeningFader !== "absent") throw new Error("Invalid source new-game launch");
}
