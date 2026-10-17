import { ActorAnimation } from "./actor-animation.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { validateFieldActorFactory, type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import { validateFieldActorViewProjection } from "./field-actor-view.js";
import type { FieldCameraMapRange } from "./field-camera.js";
import type { NativeFieldActorData } from "./field-native-actors.js";
import { fieldPuppetBoundTransparentTextures, type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { Character, Direction, Evidence } from "../field/types.js";
import { parseNpcActivityProgram, type FieldNpcActivityProgram } from "./field-npc-activity.js";

/** Mapobject is a separate master domain from party field-character assets.
 * source identifies the referring map object; media has its own source binding. */
type FieldNativeNpcBody = {
  group: string;
  /** PropertyEntity.EntityId is a script selector; zero is anonymous. */
  sourceEntityId: number;
  /** Stable internal identity, including source-pointer IDs for anonymous NPCs. */
  entityId: string;
  objectType: 6 | 17;
  source: Evidence;
  geometry: { x: number; y: number; width: 16; height: 16; layer: number };
  sourceDirection: 0 | 1 | 2 | 4 | 8;
  direction: Direction;
  asset: { id: number; asset: string; animationAsset: string; shadowType: 0 | 1; source: Evidence };
  updateAttribute: 2 | 10;
  turnAround: boolean;
};
export type FieldNativeNpcDefinition = FieldNativeNpcBody & (
  { kind: "native-map-npc-v1"; controller: "wait" }
  | { kind: "framework-map-npc-v1"; controller: "area"; activitySourceHash: string;
      policyHash: string; program: FieldNpcActivityProgram }
);
export type FieldFrameworkAreaNpcDefinition = Extract<FieldNativeNpcDefinition, { controller: "area" }>;
export type FieldNativeNpcScope = NonNullable<NativeFieldActorData["scope"]>;
export type FieldNativeNpcStandby = {
  kind: "native-map-npc-standby-v1";
  position: { x: 30000; y: 30000 };
  sources: { file: string; sha256: string }[];
};
export const FIELD_NATIVE_NPC_STANDBY_SOURCES = [
  { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
  { file: "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/scene_maingame_scenes_all_934d23f66ea5ce66932f11655d1e4899.bundle",
    sha256: "9b406d18f7e629a9cd224fdae27757897753554e5468fb7ee411baf8de8fe5c7" },
] as const;
/** This binding is for the ordinary FieldMap scene root only; it is not an
 * arbitrary MapManager, transformed preview root, or extra-library scene. */
export function fieldNativeNpcStandbyPosition(definition: FieldNativeNpcStandby): { x: number; y: number } {
  if (!definition || definition.kind !== "native-map-npc-standby-v1" || !Array.isArray(definition.sources) ||
      definition.sources.length !== FIELD_NATIVE_NPC_STANDBY_SOURCES.length ||
      definition.position?.x !== 30000 || definition.position.y !== 30000)
    throw new Error("Unbound native NPC standby lifecycle");
  checkpointKeys(definition.position, "x,y");
  for (const source of FIELD_NATIVE_NPC_STANDBY_SOURCES)
    if (definition.sources.filter((s) => s.file === source.file && s.sha256 === source.sha256).length !== 1)
      throw new Error("Foreign native NPC standby source");
  return { ...definition.position };
}
export type FieldNativeNpcGroupInput = {
  definitions: readonly FieldNativeNpcDefinition[];
  factory: FieldActorFactoryCatalog;
  characters: Readonly<Record<string, Character>>;
  mapRange: FieldCameraMapRange;
  providers: FieldPuppetHostProviders;
  existingActorIds: readonly string[];
  /** A trusted content profile selects this Web host. A source definition or
   * saved state cannot grant its scheduling/collision policy. */
  activityPolicy?: "framework-npc-area-v1";
  /** CreateOutOfRangeMapPosition reads this world-space transform. It is not
   * the persistent residents' offMapPosition. Missing is not zero. */
  standbyAnchorPosition?: { x: number; y: number };
};

const f = Math.fround;
const directions = { 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" } as const;
function evidence(value: Evidence): void {
  if (!value || typeof value.file !== "string" || !value.file ||
      typeof value.assetPath !== "string" || !value.assetPath ||
      (value.objectId !== undefined && (typeof value.objectId !== "string" || !/^-?\d+$/.test(value.objectId))) ||
      (value.pointer !== undefined && typeof value.pointer !== "string"))
    throw new Error("Unbound native NPC source identity");
}
function finite(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("Invalid native NPC coordinate");
  return f(value);
}
export function validateFieldNativeNpc(definition: FieldNativeNpcDefinition): void {
  if (!definition || !((definition.kind === "native-map-npc-v1" && definition.controller === "wait") ||
      (definition.kind === "framework-map-npc-v1" && definition.controller === "area")) || typeof definition.group !== "string" || !definition.group ||
      typeof definition.entityId !== "string" || !definition.entityId ||
      ![6, 17].includes(definition.objectType) ||
      typeof definition.turnAround !== "boolean" ||
      ![2, 10].includes(definition.updateAttribute) ||
      !Object.hasOwn(directions, definition.sourceDirection) || directions[definition.sourceDirection] !== definition.direction)
    throw new Error("Unbound native NPC definition");
  evidence(definition.source); evidence(definition.asset?.source);
  // GetFieldEntity reserves zero for scrollDummy and all negative selectors
  // for special/party/resident actors. Anonymous map NPCs still need distinct
  // internal identities, but can never occupy one of those selectors.
  checkpointInteger(definition.sourceEntityId, 0, 0x7fffffff);
  const pointer = /^\/layers\/(0|[1-9]\d*)\/objects\/(0|[1-9]\d*)$/.exec(definition.source.pointer ?? "");
  const expectedId = definition.sourceEntityId > 0 ? String(definition.sourceEntityId)
    : pointer ? `${definition.group}:${pointer[1]}:${pointer[2]}` : null;
  if (definition.entityId !== expectedId) throw new Error("Native NPC actor identity disagrees with source entity selector");
  checkpointKeys(definition.geometry, "x,y,width,height,layer");
  for (const value of [definition.geometry.x, definition.geometry.y]) checkpointInteger(value, -0x80000000, 0x7fffffff);
  checkpointInteger(definition.geometry.layer, 0, 3);
  if (definition.geometry.width !== 16 || definition.geometry.height !== 16)
    throw new Error("Native NPC non-cell collision geometry is unresolved");
  checkpointInteger(definition.asset.id, 1, 0x7fffffff);
  if (typeof definition.asset.asset !== "string" || !definition.asset.asset ||
      definition.asset.animationAsset !== definition.asset.asset.toUpperCase() ||
      ![0, 1].includes(definition.asset.shadowType))
    throw new Error("Unbound native NPC map-object media");
  if (definition.controller === "area") {
    const program = parseNpcActivityProgram(definition.program);
    if (!/^[a-f0-9]{64}$/.test(definition.activitySourceHash) || !/^[a-f0-9]{64}$/.test(definition.policyHash) ||
        program.actorId !== definition.entityId || program.group !== definition.group ||
        program.layer !== definition.geometry.layer || program.updateAttribute !== definition.updateAttribute)
      throw new Error("Unbound framework NPC activity definition");
  }
}

/** GetFieldEntity(0) returns the camera dummy before searching map entities.
 * Only a positive PropertyEntity.EntityId participates in that later search. */
export function fieldNativeNpcSelectorBinding(definition: FieldNativeNpcDefinition): { entityId: number; actor: string } | null {
  validateFieldNativeNpc(definition);
  return definition.sourceEntityId === 0 ? null : { entityId: definition.sourceEntityId, actor: definition.entityId };
}

/** MapUtility.GetEntityGroups -> MapManager.CreateOutOfRangeMapPosition.
 * Raw Tiled bottom anchor is retained; normalized legacy cells are not input. */
export function fieldNativeNpcPosition(definition: FieldNativeNpcDefinition, map: FieldCameraMapRange,
  standbyAnchorPosition?: { x: number; y: number }): { x: number; y: number; z: number } {
  validateFieldNativeNpc(definition);
  return fieldNativeMapObjectPosition(definition.geometry, map, standbyAnchorPosition);
}

/** Shared ParseMapObject placement from original signed pixel rectangles.
 * Relay widths/heights remain raw source dimensions, not synthetic NPC cells. */
export function fieldNativeMapObjectPosition(object: {
  x: number; y: number; width: number; height: number; layer: number;
}, map: FieldCameraMapRange, standbyAnchorPosition?: { x: number; y: number }): { x: number; y: number; z: number } {
  checkpointKeys(object, "x,y,width,height,layer");
  for (const value of [object.x, object.y]) checkpointInteger(value, -0x80000000, 0x7fffffff);
  for (const value of [object.width, object.height]) checkpointInteger(value, 1, 0x7fffffff);
  checkpointInteger(object.layer, 0, 3);
  checkpointKeys(map, "x,y,width,height");
  for (const value of [map.x, map.y]) checkpointInteger(value, -0x80000000, 0x7fffffff);
  for (const value of [map.width, map.height]) checkpointInteger(value, 1, 0x7ffffff);
  // Original TileMapObjectData and mapRange arithmetic is signed int32 before
  // its conversion to float. Reject overflow rather than silently use doubles.
  const integer = (value: number) => { checkpointInteger(value, -0x80000000, 0x7fffffff); return value; };
  const tx = f(integer(object.x - integer(map.x * 16))), ty = f(integer(object.y - integer(map.y * 16)));
  const z = f(349 - object.layer * 100);
  if (f(tx * f(0.0625)) < 0 || map.width <= f(tx * f(0.0625)) ||
      f(ty * f(0.0625)) <= 0 || map.height < f(ty * f(0.0625))) {
    if (!standbyAnchorPosition) throw new Error("Native NPC standby anchor world transform is unresolved");
    checkpointKeys(standbyAnchorPosition, "x,y");
    return { x: finite(standbyAnchorPosition.x), y: finite(standbyAnchorPosition.y), z };
  }
  return { x: f(f(tx - f(integer(map.width * 8))) + Math.trunc(object.width / 2)),
    y: f(f(f(integer(map.height * 8)) - ty) + Math.trunc(object.height / 2)), z };
}

/** Detached first activation only. Source map creation installs a playback
 * structure without selecting/playing an animation. Inactive groups are not
 * registered; activation builds Wait controllers and Init calls Setup -> Init
 * again, selecting this pose. Wait is not a moving controller, so the manager's
 * Random.Range/Guid permutation receives no rows. Other controllers, repeat
 * activation, custom minimap/stencil/birdview and unloaded media are not covered.
 * Caller validates the rest of the entity group, then inserts these actors into
 * its EXISTING actor owner in the same publication as group registration. */
export function prepareFieldNativeNpcGroup(input: FieldNativeNpcGroupInput): { actors: NativeFieldActorData[] } {
  validateFieldActorFactory(input.factory);
  if (!Array.isArray(input.definitions) || !Array.isArray(input.existingActorIds) ||
      !input.providers?.mapRenderContext || !input.providers.applyViewProperties)
    throw new Error("Incomplete native NPC group candidate");
  const ids = new Set(input.existingActorIds);
  if (ids.size !== input.existingActorIds.length || input.existingActorIds.some((id) => typeof id !== "string" || !id))
    throw new Error("Ambiguous native NPC actor owner");
  let group: string | null = null;
  const actors = input.definitions.map((definition): NativeFieldActorData => {
    validateFieldNativeNpc(definition);
    if (definition.controller === "area" && input.activityPolicy !== "framework-npc-area-v1")
      throw new Error("Framework NPC activity requires its trusted content host");
    if (group !== null && group !== definition.group) throw new Error("Native NPC candidate mixes entity groups");
    group = definition.group;
    if (ids.has(definition.entityId)) throw new Error("Native NPC actor identity already exists: " + definition.entityId);
    ids.add(definition.entityId);
    const media = input.characters[definition.asset.asset];
    if (!media || !Object.keys(media.sprites).length || !media.animations)
      throw new Error("Missing native NPC source media: " + definition.asset.asset);
    evidence(media.source);
    const animation = new ActorAnimation(media);
    animation.look(definition.direction);
    // Controller.Init first invokes NPC.Setup -> Chara.Init, then Setup looks
    // back at keepPreDirection when turnAround is true. Re-cueing a stopped
    // source key can select its authored next key, so it must not be collapsed.
    if (definition.turnAround) animation.look(definition.direction);
    const layer = definition.geometry.layer + 9;
    const view = input.providers.applyViewProperties!(layer);
    if (view === null) throw new Error("Missing native NPC source material projection");
    validateFieldActorViewProjection(view, input.providers.mapRenderContext, layer);
    return {
      fieldAssetId: null, charaZOffset: 0,
      mapObjectAsset: { id: definition.asset.id, asset: definition.asset.asset, source: structuredClone(definition.asset.source) },
      updateAttribute: definition.updateAttribute,
      scope: { kind: "map-npc", group: definition.group, entityId: definition.entityId, source: structuredClone(definition.source) },
      entity: {
        id: definition.entityId, character: true,
        position: fieldNativeNpcPosition(definition, input.mapRange, input.standbyAnchorPosition),
        layer, direction: definition.direction, animation, visible: true, fadeAlpha: 1,
        childEntityObject: input.factory.npcPrefab.childEntityObject, moving: false,
        riding: false, riderAssetId: null, rideOnEntity: input.factory.npcPrefab.rideOnEntity,
        bodyOpaque: true, shadowVisible: definition.asset.shadowType === 1,
        viewBinding: { map: input.providers.mapRenderContext, layer, properties: structuredClone(view) },
        transparentTextures: fieldPuppetBoundTransparentTextures(layer, input.providers),
      },
    };
  });
  return { actors };
}

/** MapModel.Destroy owns every map-local group. This plan only identifies
 * retirement; the old FieldGame must remain untouched until handoff commits. */
export function fieldNativeNpcRetirement(actors: readonly NativeFieldActorData[]): string[] {
  const ids = new Set<string>(), result: string[] = [];
  for (const actor of actors) {
    if (!actor.entity?.id || ids.has(actor.entity.id)) throw new Error("Ambiguous native actor retirement identity");
    ids.add(actor.entity.id);
    if (actor.scope === undefined) {
      if (actor.mapObjectAsset !== undefined) throw new Error("Map NPC is missing its lifecycle scope");
      continue;
    }
    if (!["map-npc", "map-animated"].includes(actor.scope.kind) || actor.scope.entityId !== actor.entity.id || !actor.scope.group ||
        !actor.mapObjectAsset || actor.fieldAssetId !== null)
      throw new Error("Unbound native NPC retirement scope");
    evidence(actor.scope.source); result.push(actor.entity.id);
  }
  return result;
}
