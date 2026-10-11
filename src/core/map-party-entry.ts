import type { Direction, Evidence } from "../field/types.js";
import type { FieldPartyActorCheckpoint } from "./field-party-actors.js";
import type { PartyAppearanceCandidate } from "./party.js";
import type { TransportationIdentity } from "./transportation.js";
import type { VariableRef } from "./event-state.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { inCollisionRange, validateCollisionRange, type CollisionRange } from "./collision.js";
import { partyActorCameraOffset, partyActorLeaderOnMapChange, partyActorMapArea,
  partyMemberFieldAsset, preparePartyActors, type PartyActorCatalog, type PartyActorContext } from "./party-actors.js";

/** Static inputs belong to the destination package, never to the departed map. */
export type MapPartyEntryDefinition = {
  formatVersion: 1;
  kind: "map-party-entry";
  mapId: number;
  width: number;
  height: number;
  mapRange: CollisionRange;
  loopType: number;
  pointIns: { id: number; x: number; y: number; layer: number; direction: Direction; linkObject: number; source: Evidence }[];
  conditionColliders: NonNullable<PartyActorContext["conditionColliders"]>;
};

export type MapPartyEntryInput = {
  definition: MapPartyEntryDefinition;
  /** Negative LoadData.Point selects the distinct native saved-position path. */
  entrance: number;
  mapViewType: number;
  prior: FieldPartyActorCheckpoint;
  playerVisible: boolean;
  party: PartyAppearanceCandidate;
  /** Already resolved by the source PointIn/MapViewSetup transportation owner. */
  transportation: TransportationIdentity;
  /** FF6 SpcialFlag.CanPartySwitching; null is unknown, not false. */
  canPartySwitching: boolean | null;
};

export type MapPartyEntryPlan = {
  checkpoint: FieldPartyActorCheckpoint;
  player: { x: number; y: number; layer: number; direction: Direction; visible: boolean; asset: string; mount: string };
  /** Hidden actors have no newly invented position. Native MapSetup calls Hide. */
  hiddenActorIds: string[];
  movement: { start: { x: number; y: number }; destination: { x: number; y: number }; elapsed: 0; autoMove: false; cacheActiveEnable: 0; cacheActiveFlag: 0 };
  cameraOffset: { x: number; y: number };
  colliderChanges: { actorId: string; active: boolean }[];
  /** This exact FF6 RemoveCondition constructor registers three empty lists. */
  ownedConditionChanges: [];
};

export const mapPartySwitchingFlag: VariableRef = { category: "ScenarioFlag3", index: 45 };
export function readMapPartySwitching(read: (ref: VariableRef) => number | null): boolean {
  const value = read({ ...mapPartySwitchingFlag });
  if (value !== 0 && value !== 1) throw new Error("Unknown map-entry party switching flag");
  return value === 1;
}

function validateDefinition(def: MapPartyEntryDefinition): void {
  checkpointKeys(def, "formatVersion,kind,mapId,width,height,mapRange,loopType,pointIns,conditionColliders");
  if (def.formatVersion !== 1 || def.kind !== "map-party-entry") throw new Error("Unreviewed map party entry definition");
  checkpointInteger(def.mapId, 1, 0x7fffffff);
  checkpointInteger(def.loopType, 0, 3);
  checkpointKeys(def.mapRange, "x,y,width,height");
  validateCollisionRange(def.width, def.height, def.mapRange);
  if (!Array.isArray(def.pointIns) || !Array.isArray(def.conditionColliders)) throw new Error("Missing map entry source objects");
  for (const point of def.pointIns) {
    checkpointKeys(point, "id,x,y,layer,direction,linkObject,source");
    checkpointInteger(point.id, 0, 0x7fffffff);
    checkpointInteger(point.x, 0, def.width - 1);
    checkpointInteger(point.y, 0, def.height - 1);
    checkpointInteger(point.layer, 0, 3);
    checkpointInteger(point.linkObject, 0, 0x7fffffff);
    if (!["up", "right", "down", "left"].includes(point.direction) || !inCollisionRange(point, def.mapRange))
      throw new Error("Unsupported map entry PointIn geometry");
  }
  const ids = new Set<string>();
  for (const collider of def.conditionColliders) {
    checkpointKeys(collider, "id,collisionType,throughConditionType");
    if (!collider.id || ids.has(collider.id)) throw new Error("Invalid map entry condition collider identity");
    ids.add(collider.id);
    checkpointInteger(collider.collisionType, 0, 7);
    checkpointInteger(collider.throughConditionType, 0, 0x7fffffff);
  }
}

/**
 * FieldController.SetControlPlayer -> PointIn Init -> MapViewSetup. This is
 * intentionally different from ChangeAssetPartyCharacter: map entry hides the
 * persistent puppets but does not refresh their media or their rider caches.
 * All returned values are detached; the host publishes them with its owned and
 * event-state drafts only after source packages and renderer media are ready.
 */
export function prepareMapPartyEntry(catalog: PartyActorCatalog, input: MapPartyEntryInput): MapPartyEntryPlan {
  validateDefinition(input.definition);
  const def = input.definition;
  checkpointInteger(input.entrance, -0x80000000, 0x7fffffff);
  if (input.entrance < 0) throw new Error("Saved-position map party entry is not implemented");
  if (input.mapViewType !== 0 || def.loopType !== 0) throw new Error("Map party entry view/loop presentation is not implemented");
  if (typeof input.playerVisible !== "boolean") throw new Error("Unknown map-entry player visibility");
  if (input.canPartySwitching === null || typeof input.canPartySwitching !== "boolean") throw new Error("Unknown map-entry party switching flag");
  if (input.canPartySwitching) throw new Error("Map party placement and switching entry is not implemented");
  const entries = def.pointIns.filter((point) => point.id === input.entrance);
  if (entries.length !== 1) throw new Error("Missing or ambiguous map party PointIn");
  const entry = entries[0]!;
  if (entry.linkObject !== 0) throw new Error("Map party PointIn linked opening is not implemented");
  checkpointKeys(input.prior, "kind,context,playerAssetCacheId");
  if (input.prior.kind !== "field-party-actors-v1") throw new Error("Unknown prior map party checkpoint");
  const context = structuredClone(input.prior.context);
  if (context.companion !== null) throw new Error("Map companion initialization is not implemented");
  if (context.currentTransport === null) throw new Error("Unknown prior map transportation");
  if (context.conditionResidents === null) throw new Error("Missing map condition appearance provider");
  if (context.multiParty.some((p) => p.actor === null)) throw new Error("Missing map-entry other-party actor instance");
  if (!Array.isArray(input.party.parties) || input.party.parties.length !== 3 ||
      context.multiParty.some((p) => p.members.length !== 0)) throw new Error("Invalid map-entry owned party projection");
  // Validate references and actor uniqueness with the existing source preparer,
  // without publishing its broader refresh operations.
  const validating = structuredClone(context);
  validating.multiParty.forEach((p, i) => { p.members = structuredClone(input.party.parties[i]!); });
  preparePartyActors(catalog, input.party.activeMembers, validating, true);
  if (input.prior.playerAssetCacheId !== null && !catalog.assets[input.prior.playerAssetCacheId])
    throw new Error("Unknown prior map player cache");
  const transport = catalog.transportations.find((t) => t.id === input.transportation.id);
  if (!transport || transport.typeId !== input.transportation.type || transport.fieldAssetId !== input.transportation.assetId)
    throw new Error("Mismatched destination map transportation");
  const walking = transport.typeId === 1;
  // FF6's exact front/overlay rule for id6 was separately recovered; type12
  // alone is not sufficient to classify another transport as Magitek armor.
  const armor = transport.id === 6 && transport.typeId === 12 && transport.fieldAssetId === 38;
  if (!walking && !armor) throw new Error("Map transportation actor lifecycle is not implemented");

  context.leaderIndex = partyActorLeaderOnMapChange(context.leaderIndex, input.party.activeMembers);
  context.camera = { mapViewType: input.mapViewType,
    mapArea: partyActorMapArea(def.mapRange.width, def.mapRange.height, def.loopType) };
  context.conditionColliders = structuredClone(def.conditionColliders);
  // Only these provider projections are used. Puppet/other-party refresh changes
  // would belong to a different native entry point and must not leak into entry.
  const projection = preparePartyActors(catalog, input.party.activeMembers, context, true);
  const leader = input.party.activeMembers.find((m) => m.index === projection.selectedLeaderIndex);
  if (!leader) throw new Error("Empty map entry party is not implemented");
  const base = partyMemberFieldAsset(catalog, leader);
  context.leaderIndex = projection.savedLeaderIndex;
  context.player.fieldAssetId = base.id; // ChangeAssetOfPlayer(isInit=true).
  const playerAssetCacheId = projection.playerAssetCache?.id ?? input.prior.playerAssetCacheId;
  for (const change of projection.changes) {
    if (change.actorId !== context.player.id || change.reason !== "condition") continue;
    if (change.mode === "rider") context.player.riderFieldAssetId = change.asset.id;
    else context.player.fieldAssetId = change.asset.id;
  }
  if (playerAssetCacheId === null || !catalog.assets[playerAssetCacheId]) throw new Error("Missing map entry player media cache");
  if (walking) {
    // SetupCharaAsset sets the current player structure and calls RideOut;
    // RideOut clears the active flag, preserving the cached rider pointer.
    context.player.fieldAssetId = playerAssetCacheId;
    context.player.riding = false;
  } else {
    // RideOn always caches the current base structure before installing front38,
    // even when the actor was already riding on the preceding map.
    context.player.riderFieldAssetId = context.player.fieldAssetId;
    context.player.fieldAssetId = transport.fieldAssetId;
    context.player.riding = true;
  }
  context.currentTransport = structuredClone(transport);
  const actual = context.player.riding ? context.player.riderFieldAssetId : context.player.fieldAssetId;
  const asset = actual === null ? null : catalog.assets[actual];
  const mount = context.player.riding && context.player.fieldAssetId !== null ? catalog.assets[context.player.fieldAssetId] : null;
  if (!asset || (context.player.riding && !mount)) throw new Error("Missing map entry actor media");
  const position = { x: entry.x, y: entry.y };
  return {
    checkpoint: { kind: "field-party-actors-v1", context, playerAssetCacheId },
    player: { ...position, layer: entry.layer, direction: entry.direction, visible: input.playerVisible,
      asset: asset.asset, mount: mount?.asset ?? "" },
    hiddenActorIds: [...context.puppets.flatMap((p) => p ? [p.id] : []),
      ...context.multiParty.flatMap((p) => p.actor ? [p.actor.id] : [])],
    movement: { start: { ...position }, destination: { ...position }, elapsed: 0, autoMove: false, cacheActiveEnable: 0, cacheActiveFlag: 0 },
    cameraOffset: partyActorCameraOffset(catalog, walking ? playerAssetCacheId : transport.fieldAssetId, context.camera),
    colliderChanges: structuredClone(projection.colliderChanges), ownedConditionChanges: [],
  };
}
