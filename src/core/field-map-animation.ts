import { ActorAnimation } from "./actor-animation.js";
import { fieldPuppetBoundTransparentTextures } from "./field-puppet-effects.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { validateFieldActorFactory } from "./field-actor-factory.js";
import { fieldNativeMapObjectPosition, type FieldNativeNpcGroupInput } from "./field-native-npc.js";
import type { NativeFieldActorData } from "./field-native-actors.js";
import type { EntityGroup, Evidence, FieldContent } from "../field/types.js";

export const WEB_FIELD_MAP_ANIMATION = "web-field-animated-map-entities-v1" as const;
export const NATIVE_MAP_ANIMATION_HOST = "Native animated map entity presentation/lifecycle is unbound";
/** Immutable source protocol, not a second actor or playback owner. Direction
 * is retained as an opaque property: kind 10 Init selects Default directly. */
export type FieldMapAnimationDefinition = {
  kind: "source-field-animated-map-entity-v1";
  group: string; entityId: string; sourceEntityId: number; source: Evidence;
  sourceDirection: number;
  geometry: { x: number; y: number; width: number; height: number; layer: number };
  asset: { id: number; asset: string; animationAsset: string; source: Evidence };
  playOnAwake: boolean; collision: boolean; front: boolean; split: boolean;
  building: boolean; affected: boolean; zOffset: number;
};
export function validateFieldMapAnimation(d: FieldMapAnimationDefinition): void {
  if (!d || d.kind !== "source-field-animated-map-entity-v1" || !d.group || !d.entityId ||
      !d.source?.file || !d.source.assetPath || !d.source.pointer || !d.asset?.source?.file ||
      !d.asset.source.assetPath || !d.asset.asset || d.asset.animationAsset !== d.asset.asset.toUpperCase())
    throw new Error("Unbound animated map entity source");
  checkpointInteger(d.sourceEntityId, 0, 0x7fffffff);
  checkpointInteger(d.sourceDirection, -0x80000000, 0x7fffffff);
  checkpointInteger(d.asset.id, 1, 0x7fffffff);
  checkpointInteger(d.zOffset, -0x80000000, 0x7fffffff);
  const pointer = /^\/layers\/(0|[1-9]\d*)\/objects\/(0|[1-9]\d*)$/.exec(d.source.pointer);
  if (!pointer || d.entityId !== (d.sourceEntityId ? String(d.sourceEntityId) : `${d.group}:${pointer[1]}:${pointer[2]}`))
    throw new Error("Animated map entity selector/source identity changed");
  checkpointKeys(d.geometry, "x,y,width,height,layer");
  for (const value of [d.geometry.x, d.geometry.y]) checkpointInteger(value, -0x80000000, 0x7fffffff);
  for (const value of [d.geometry.width, d.geometry.height]) checkpointInteger(value, 1, 0x7fffffff);
  checkpointInteger(d.geometry.layer, 0, 3);
  if ([d.playOnAwake, d.collision, d.front, d.split, d.building, d.affected].some(v => typeof v !== "boolean") ||
      d.split || d.building && d.split)
    throw new Error("Unbound animated map entity shape");
}
export function mapAnimationSelector(d: FieldMapAnimationDefinition): { entityId: number; actor: string } | null {
  validateFieldMapAnimation(d);
  return d.sourceEntityId === 0 ? null : { entityId: d.sourceEntityId, actor: d.entityId };
}
export function mapAnimationGroupBlockers(group: EntityGroup, content: Pick<FieldContent, "developmentProfile">): EntityGroup["blockers"] {
  if (content.developmentProfile?.mapAnimatedEntities !== WEB_FIELD_MAP_ANIMATION) return group.blockers;
  return group.blockers.filter(blocker => {
    if (blocker.reason !== NATIVE_MAP_ANIMATION_HOST) return true;
    const entity = group.entities.find(e => e.kind === 10 && canonical(e.source) === canonical(blocker.source));
    if (!entity?.mapAnimation || entity.mapAnimationBlockers?.length) return true;
    validateFieldMapAnimation(entity.mapAnimation);
    return false;
  });
}
/** Web policy deliberately uses the existing flat sprite presentation instead
 * of native split/building/stencil shaders. Colliders and scripts are retained.
 * All returned entities join FieldGame.actors and its existing animation clock. */
export function prepareFieldMapAnimations(input: Omit<FieldNativeNpcGroupInput, "definitions" | "activityPolicy"> & {
  definitions: readonly FieldMapAnimationDefinition[]; policy: typeof WEB_FIELD_MAP_ANIMATION;
}): { actors: NativeFieldActorData[] } {
  if (input.policy !== WEB_FIELD_MAP_ANIMATION) throw new Error("Animated map entities require their trusted Web policy");
  validateFieldActorFactory(input.factory);
  const ids = new Set(input.existingActorIds);
  if (ids.size !== input.existingActorIds.length) throw new Error("Ambiguous animated map actor owner");
  const actors = input.definitions.map((d): NativeFieldActorData => {
    validateFieldMapAnimation(d);
    if (ids.has(d.entityId)) throw new Error("Animated map actor identity already exists");
    ids.add(d.entityId);
    const media = input.characters[d.asset.asset];
    if (!media?.source?.file || !media.source.assetPath || !media.animations.Default || !Object.keys(media.sprites).length)
      throw new Error("Missing animated map entity source media: " + d.asset.asset);
    const animation = new ActorAnimation(media);
    // The explicit Web lane starts a non-playing entity at the first Default
    // frame. It does not invent a cardinal facing from source direction 15.
    if (d.playOnAwake) animation.playSource("Default"); else animation.cue("Default", 0);
    const layer = d.geometry.layer + 9;
    if (!input.providers.mapRenderContext) throw new Error("Missing animated map entity Web map projection");
    return { fieldAssetId: null, charaZOffset: 0, updateAttribute: 2,
      mapObjectAsset: { id: d.asset.id, asset: d.asset.asset, source: structuredClone(d.asset.source) }, mapAnimation: structuredClone(d),
      scope: { kind: "map-animated", group: d.group, entityId: d.entityId, source: structuredClone(d.source) },
      entity: { id: d.entityId, character: false,
        position: fieldNativeMapObjectPosition(d.geometry, input.mapRange, input.standbyAnchorPosition),
        layer, direction: null, animation, visible: true, fadeAlpha: 1,
        childEntityObject: "absent", moving: false, riding: false, riderAssetId: null, rideOnEntity: "idle",
        bodyOpaque: true, shadowVisible: false,
        viewBinding: null, transparentTextures: { first: null, second: null } },
    };
  });
  return { actors };
}
