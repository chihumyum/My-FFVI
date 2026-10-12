import { ActorAnimation, type ActorPlayback } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys, checkpointNumber, checkpointSameIds } from "./checkpoint-validation.js";
import { validateFieldActorFactory, type FieldActorFactoryBindings, type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import { validateFieldActorViewProjection } from "./field-actor-view.js";
import type { FieldCameraMapRange } from "./field-camera.js";
import type { FieldPartyActorCheckpoint } from "./field-party-actors.js";
import { createNativeFieldActorProjection, type NativeFieldActor, type NativeFieldActorData,
  type NativeFieldMotion } from "./field-native-actors.js";
import { fieldNativeNpcSelectorBinding, type FieldNativeNpcDefinition } from "./field-native-npc.js";
import { fieldPuppetBoundTransparentTextures, type FieldPuppetHostActor,
  type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { PartyActorCatalog, PartyActorInstance } from "./party-actors.js";
import { validateFieldTransportActorInstance, type FieldTransportActorPresentation } from "./field-transport-actors.js";
import type { Character, Direction } from "../field/types.js";

/** Runtime values only. Source metadata, prefab flags, asset IDs, shader
 * properties and compiled media never gain authority by appearing in a save. */
export type FieldNativeActorCheckpoint = {
  id: string;
  position: { x: number; y: number; z: number };
  layer: number;
  direction: Direction | null;
  animation: ActorPlayback | null;
  visible: boolean;
  fadeAlpha: number;
  bodyOpaque: boolean;
  shadowVisible: boolean;
  steps: number;
  view: { map: string; layer: number } | null;
  transparentTextures: { first: string | null; second: string | null };
};
export type FieldNativeCheckpoint = {
  kind: "native-field-actors-checkpoint-v1";
  actors: FieldNativeActorCheckpoint[];
};
export type FieldNativeCheckpointOwner = Readonly<Record<string, {
  readonly id: string;
  readonly native?: NativeFieldActorData;
  readonly motion: NativeFieldMotion | null;
  readonly steps: number;
}>>;
/** All inputs are reconstructed from hash-checked content and the separately
 * validated appearance/owned snapshot. They must NOT be copied from this
 * actor payload. npcs is the exact default plus active-group definition list.
 * The outer field/world codec binds the map/content digest, camera, collision,
 * update mask, groups, and all unsupported-host/activity admission rules. */
export type FieldNativeCheckpointContext = {
  mapRange: FieldCameraMapRange;
  bindings: FieldActorFactoryBindings;
  factory: FieldActorFactoryCatalog;
  partyCatalog: PartyActorCatalog;
  partyCheckpoint: FieldPartyActorCheckpoint;
  characters: Readonly<Record<string, Character>>;
  npcs: readonly FieldNativeNpcDefinition[];
  providers: FieldPuppetHostProviders;
  transportationPresentation?: FieldTransportActorPresentation;
  /** A retained off-map instance may still reference a previous map material.
   * Without that trusted definition the checkpoint is explicitly unavailable. */
  resolveRetainedView?(contextId: string): FieldPuppetHostProviders | null;
};

type BoundActor = {
  id: string;
  metadata: Omit<NativeFieldActorData, "entity">;
  media: Character | null;
  childEntityObject: "absent";
  rideOnEntity: "idle" | "riding";
  riding: boolean;
  riderAssetId: number | null;
};
const f = Math.fround;
function float32(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || f(value) !== value)
    throw new Error("Invalid native actor checkpoint " + label);
}
function bool(value: unknown): void {
  if (typeof value !== "boolean") throw new Error("Invalid native actor checkpoint boolean");
}
function expectedActors(context: FieldNativeCheckpointContext): BoundActor[] {
  if (!context || !context.characters || !context.providers || !context.bindings ||
      !Array.isArray(context.npcs) || !context.partyCheckpoint || !context.partyCatalog)
    throw new Error("Missing trusted native checkpoint context");
  validateFieldActorFactory(context.factory);
  checkpointKeys(context.mapRange, "x,y,width,height");
  for (const value of [context.mapRange.x, context.mapRange.y]) checkpointInteger(value, -0x80000000, 0x7fffffff);
  for (const value of [context.mapRange.width, context.mapRange.height]) checkpointInteger(value, 1, 0x7ffffff);
  const c = context.partyCheckpoint.context, bindings = context.bindings, catalog = context.partyCatalog;
  if (context.partyCheckpoint.kind !== "field-party-actors-v1" || catalog.formatVersion !== 1 ||
      catalog.memberCount !== 4 || catalog.partyCount !== 3 || !c || c.companion !== null ||
      !Array.isArray(c.puppets) || c.puppets.length !== 4 || c.puppets.some((a) => a === null) ||
      !Array.isArray(c.multiParty) || c.multiParty.length !== 3 || c.multiParty.some((p) => !p.actor || p.members.length) ||
      !Array.isArray(c.conditionResidents) || !Array.isArray(bindings.partyPuppets) ||
      !Array.isArray(bindings.otherParties) || !Array.isArray(bindings.residents) ||
      bindings.player !== c.player.id || canonical(bindings.partyPuppets) !== canonical(c.puppets.map((a) => a!.id)) ||
      canonical(bindings.otherParties) !== canonical(c.multiParty.map((p) => p.actor!.id)) ||
      canonical(bindings.residents.map((r) => r.assetId)) !== canonical(c.conditionResidents.map((r) => r.characterId)) ||
      canonical(c.conditionResidents.map((r) => r.characterId)) !== canonical(catalog.residents.map((r) => r.characterId)))
    throw new Error("Native checkpoint persistent actor bindings changed");
  const result: BoundActor[] = [], ids = new Set<string>();
  const add = (id: string, metadata: BoundActor["metadata"], mediaName: string | null,
    prefab: FieldActorFactoryCatalog["npcPrefab"] | FieldActorFactoryCatalog["playerPrefab"],
    riding = false, riderAssetId: number | null = null) => {
    if (typeof id !== "string" || !id || ids.has(id)) throw new Error("Duplicate native checkpoint actor identity");
    ids.add(id);
    const media = mediaName === null ? null : context.characters[mediaName];
    if (media === undefined || media !== null && (!media.source?.file || !media.source.assetPath ||
        !media.animations || !media.sprites || !Object.keys(media.sprites).length))
      throw new Error("Missing native checkpoint source media: " + mediaName);
    result.push({ id, metadata, media, childEntityObject: prefab.childEntityObject,
      rideOnEntity: riding ? "riding" : prefab.rideOnEntity, riding, riderAssetId });
  };
  const persistent = (actor: PartyActorInstance, player = false) => {
    if (!actor) throw new Error("Missing native checkpoint actor identity");
    validateFieldTransportActorInstance(catalog, actor);
    if (actor.riding && context.transportationPresentation !== "framework-development")
      throw new Error("Native checkpoint riding lifecycle requires framework-development presentation");
    if (actor.riderFieldAssetId !== null) {
      const rider = catalog.assets[actor.riderFieldAssetId]!, media = context.characters[rider.asset];
      if (!media?.source?.file || !media.source.assetPath || !media.animations || !media.sprites || !Object.keys(media.sprites).length)
        throw new Error("Missing native checkpoint rider media");
    }
    const asset = actor.fieldAssetId === null ? null : catalog.assets[actor.fieldAssetId];
    if (asset === undefined || asset !== null && (asset.id !== actor.fieldAssetId || ![0, 1].includes(asset.shadowType)))
      throw new Error("Unbound native checkpoint field asset");
    if (actor.fieldAssetId !== null) checkpointInteger(actor.fieldAssetId, 1, 0x7fffffff);
    add(actor.id, { fieldAssetId: actor.fieldAssetId, charaZOffset: player ? 0.5 : context.factory.residentCharaZOffset },
      asset?.asset ?? null, player ? context.factory.playerPrefab : context.factory.npcPrefab, actor.riding, actor.riderFieldAssetId);
  };
  persistent(c.player, true);
  for (const actor of c.puppets) persistent(actor!);
  for (const party of c.multiParty) persistent(party.actor!);
  for (const [index, resident] of c.conditionResidents.entries()) {
    const binding = bindings.residents[index]!;
    if (binding.actor !== `native:resident:${resident.characterId}`)
      throw new Error("Native checkpoint resident instance identity changed");
    persistent({ id: binding.actor, fieldAssetId: resident.fieldAssetId, riderFieldAssetId: null, riding: false });
  }
  for (const npc of context.npcs) {
    fieldNativeNpcSelectorBinding(npc);
    add(npc.entityId, { fieldAssetId: null, charaZOffset: 0,
      mapObjectAsset: { id: npc.asset.id, asset: npc.asset.asset, source: structuredClone(npc.asset.source) }, updateAttribute: npc.updateAttribute,
      scope: { kind: "map-npc", group: npc.group, entityId: npc.entityId, source: structuredClone(npc.source) } },
      npc.asset.asset, context.factory.npcPrefab);
  }
  return result;
}

function material(row: FieldNativeActorCheckpoint, context: FieldNativeCheckpointContext): FieldPuppetHostActor["viewBinding"] {
  checkpointKeys(row.transparentTextures, "first,second");
  if (row.view === null) {
    if (row.layer >= 9 && row.layer <= 12 || row.transparentTextures.first !== null || row.transparentTextures.second !== null)
      throw new Error("Native actor checkpoint is missing its map material binding");
    return null;
  }
  checkpointKeys(row.view, "map,layer");
  if (typeof row.view.map !== "string" || !/^[a-f0-9]{64}$/.test(row.view.map) ||
      ![9, 10, 11, 12].includes(row.view.layer) || row.layer >= 9 && row.layer <= 12 && row.view.layer !== row.layer)
    throw new Error("Invalid native actor checkpoint view identity");
  // Placed actors always carry current-map material; old bindings only survive
  // source MapViewSetup's no-write branch for an unplaced instance.
  if (row.layer >= 9 && row.layer <= 12 && row.view.map !== context.providers.mapRenderContext)
    throw new Error("Native actor checkpoint belongs to another map material");
  const providers = row.view.map === context.providers.mapRenderContext ? context.providers
    : context.resolveRetainedView?.(row.view.map);
  if (!providers || providers.mapRenderContext !== row.view.map || !providers.applyViewProperties)
    throw new Error("Missing trusted native checkpoint retained material provider");
  const properties = providers.applyViewProperties(row.view.layer);
  if (!properties) throw new Error("Missing native checkpoint material projection");
  validateFieldActorViewProjection(properties, row.view.map, row.view.layer);
  if (canonical(row.transparentTextures) !== canonical(fieldPuppetBoundTransparentTextures(row.view.layer, providers)))
    throw new Error("Native checkpoint transparent texture binding changed");
  return { map: row.view.map, layer: row.view.layer, properties: structuredClone(properties) };
}

function restoreActor(row: FieldNativeActorCheckpoint, expected: BoundActor, context: FieldNativeCheckpointContext): NativeFieldActor {
  checkpointKeys(row, "id,position,layer,direction,animation,visible,fadeAlpha,bodyOpaque,shadowVisible,steps,view,transparentTextures");
  if (row.id !== expected.id) throw new Error("Native actor checkpoint identity changed");
  checkpointKeys(row.position, "x,y,z");
  for (const value of Object.values(row.position)) float32(value, "position");
  checkpointInteger(row.layer, 0, 31);
  if (![0, 8, 9, 10, 11, 12].includes(row.layer)) throw new Error("Unsupported native actor checkpoint layer");
  if (row.direction !== null && !["up", "right", "down", "left"].includes(row.direction))
    throw new Error("Invalid native actor checkpoint direction");
  for (const value of [row.visible, row.bodyOpaque, row.shadowVisible]) bool(value);
  float32(row.fadeAlpha, "alpha"); checkpointNumber(row.fadeAlpha, 0, 1); checkpointInteger(row.steps);
  if (expected.media === null && row.animation !== null) throw new Error("Saved animation grants missing source media");
  const animation = expected.media && new ActorAnimation(expected.media);
  if (animation) {
    animation.restore(row.animation);
    if (row.animation !== null) animation.frame();
  }
  const entity: FieldPuppetHostActor = { id: expected.id, character: true, position: { ...row.position }, layer: row.layer,
    direction: row.direction, animation, visible: row.visible, fadeAlpha: row.fadeAlpha,
    bodyOpaque: row.bodyOpaque, shadowVisible: row.shadowVisible, moving: false, riding: expected.riding, riderAssetId: expected.riderAssetId,
    childEntityObject: expected.childEntityObject, rideOnEntity: expected.rideOnEntity,
    viewBinding: material(row, context), transparentTextures: { ...row.transparentTextures } };
  const actor = createNativeFieldActorProjection({ ...structuredClone(expected.metadata), entity }, context.mapRange, context.partyCatalog,
    context.transportationPresentation);
  actor.steps = row.steps;
  return actor;
}

/** Pure restore: every actor is private until the outer field publishes the
 * complete candidate. No lifecycle, Look/Cue, controller init or source script
 * is replayed. Camera and all other owners are deliberately absent here. */
export function restoreFieldNativeCheckpoint(raw: FieldNativeCheckpoint, context: FieldNativeCheckpointContext): NativeFieldActor[] {
  const saved = structuredClone(raw), expected = expectedActors(context);
  checkpointKeys(saved, "kind,actors");
  if (saved.kind !== "native-field-actors-checkpoint-v1" || !Array.isArray(saved.actors))
    throw new Error("Unknown native field actor checkpoint");
  checkpointSameIds(saved.actors.map((a) => a?.id), expected.map((a) => a.id));
  const byId = new Map(saved.actors.map((a) => [a.id, a]));
  return expected.map((bound) => restoreActor(byId.get(bound.id)!, bound, context));
}

/** Read the unique live owner, validate all source dependencies and round-trip
 * admission before returning a detached JSON payload. Failure writes nothing. */
export function captureFieldNativeCheckpoint(owner: FieldNativeCheckpointOwner, context: FieldNativeCheckpointContext): FieldNativeCheckpoint {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) throw new Error("Missing native field actor owner");
  const expected = expectedActors(context);
  checkpointSameIds(Object.keys(owner), expected.map((a) => a.id));
  const rows = expected.map((bound): FieldNativeActorCheckpoint => {
    const actor = owner[bound.id]!, native = actor.native, entity = native?.entity;
    if (actor.id !== bound.id || !native || !entity || entity.id !== bound.id || actor.motion !== null || entity.moving !== false)
      throw new Error("Cannot checkpoint a moving, legacy or misidentified native actor");
    if (entity.character !== true || entity.riding !== bound.riding || entity.riderAssetId !== bound.riderAssetId ||
        entity.childEntityObject !== bound.childEntityObject || entity.rideOnEntity !== bound.rideOnEntity)
      throw new Error("Native checkpoint actor lifecycle provider is unresolved");
    const { entity: ignored, ...metadata } = native;
    if (canonical(metadata) !== canonical(bound.metadata)) throw new Error("Native checkpoint source metadata changed");
    if ((entity.animation === null) !== (bound.media === null) || entity.animation !== null &&
        (!(entity.animation instanceof ActorAnimation) || canonical(entity.animation.character) !== canonical(bound.media)))
      throw new Error("Native checkpoint media does not match the trusted asset");
    const row: FieldNativeActorCheckpoint = { id: bound.id, position: { ...entity.position }, layer: entity.layer,
      direction: entity.direction, animation: entity.animation?.snapshot() ?? null, visible: entity.visible,
      fadeAlpha: entity.fadeAlpha, bodyOpaque: entity.bodyOpaque, shadowVisible: entity.shadowVisible, steps: actor.steps,
      view: entity.viewBinding && { map: entity.viewBinding.map, layer: entity.viewBinding.layer },
      transparentTextures: { ...entity.transparentTextures } };
    const recovered = restoreActor(row, bound, context);
    if (canonical(recovered.native.entity.viewBinding) !== canonical(entity.viewBinding))
      throw new Error("Native checkpoint material properties are not source-bound");
    return row;
  });
  return { kind: "native-field-actors-checkpoint-v1", actors: rows };
}
