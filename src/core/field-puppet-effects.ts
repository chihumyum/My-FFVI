import { ActorAnimation } from "./actor-animation.js";
import type { Direction } from "../field/types.js";
import type { FieldPuppetActorEffect } from "./field-puppet-actors.js";
import { validateFieldActorViewProjection, type FieldActorViewProjection } from "./field-actor-view.js";

export type FieldPuppetPosition = { x: number; y: number; z: number };
/** A detached read/write projection of the existing field actors. It is never
 * saved as another actor owner. Units must be the same for every input actor. */
export type FieldPuppetHostActor = {
  id: string;
  character: boolean;
  position: FieldPuppetPosition;
  /** Native Unity layer, not a Web map-layer array index. */
  layer: number;
  /** Null preserves a freshly constructed native (0,0) direction vector. */
  direction: Direction | null;
  animation: ActorAnimation | null;
  visible: boolean;
  fadeAlpha: number;
  childEntityObject: "absent" | "unknown";
  moving: boolean;
  riding: boolean;
  riderAssetId: number | null;
  rideOnEntity: "absent" | "idle" | "riding" | "unknown";
  bodyOpaque: boolean;
  shadowVisible: boolean;
  /** Native material inputs on the existing actor. Legacy bindings only admit
   * an idempotent reapply; new map/layer bindings require the explicit ordinary
   * material projection. Renderer parity is a separate capability. */
  viewBinding: { map: string; layer: number; properties?: FieldActorViewProjection } | null;
  transparentTextures: { first: string | null; second: string | null };
};
export type FieldPuppetHostSnapshot = {
  actors: FieldPuppetHostActor[];
  /** Camera zero has no sprite and is separate from the actors collection. */
  camera: { id: string; position: FieldPuppetPosition; layer: number } | null;
};
export type FieldPuppetHostProviders = {
  mapRenderContext: string;
  /** Null means source currentTransport is actually absent and uses Type=1. */
  transportationType: number | null | "unknown";
  /** Read the native map attribute at this projected position. Missing data is
   * null, never an assumed zero. Uniform-zero source maps can supply () => 0. */
  footAttribute(position: Readonly<FieldPuppetPosition>): number | null;
  upperTexture: string | null | "unknown";
  ceilTexture: string | null | "unknown";
  /** A compiled ordinary source provider may prepare a new layer binding.
   * Undefined retains the older same-binding-only capability. */
  applyViewProperties?(layer: number): FieldActorViewProjection | null;
};

/** Existing FieldGame collision owners expose this detached projection; it is
 * not a second saved owner. Map colliders cover native base layers 9/10/11;
 * entityCollision gates the applicable instances without overwriting their
 * intrinsic property. Interactive observation is a separate native switch. */
export type FieldPuppetCollisionState = {
  mapColliders: boolean;
  entityCollision: boolean;
  interactiveObservation: boolean;
};

export function projectFieldPuppetCollision(enabled: boolean): FieldPuppetCollisionState {
  if (typeof enabled !== "boolean") throw new Error("Unknown source puppet collision switch");
  return { mapColliders: enabled, entityCollision: enabled, interactiveObservation: enabled };
}

function integer(value: number, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid source puppet presentation integer");
  return value;
}
function position(value: FieldPuppetPosition): void {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error("Unbound source puppet position");
}
function texture(value: string | null | "unknown"): void {
  if (value === "unknown" || (value !== null && (typeof value !== "string" || !value)))
    throw new Error("Unknown source transparent render texture");
}

/** FF6 TransportationEvent .ctor: river=[10,11,12,13], forest=[9,30].
 * Base IsSemiTransparentBody accepts Forest for every type and also River for
 * transportation Type=9. This is not a generic alpha multiplier. */
export function fieldPuppetSemiTransparent(transportationType: number | null | "unknown", footAttribute: number | null): boolean {
  if (transportationType === "unknown" || footAttribute === null)
    throw new Error("Unknown source puppet transparency provider");
  const type = transportationType === null ? 1 : integer(transportationType);
  integer(footAttribute);
  return (type === 9 && [10, 11, 12, 13].includes(footAttribute)) || [9, 30].includes(footAttribute);
}

/** FieldCharaEntity.AttachTransparentTexture maps upper/ceiling textures to
 * head material slots. Other Unity layers explicitly clear both slots. */
export function fieldPuppetTransparentTextures(layer: number, upper: string | null | "unknown", ceil: string | null | "unknown") {
  integer(layer); texture(upper); texture(ceil);
  return layer === 9 ? { first: upper, second: ceil }
    : layer === 10 ? { first: ceil, second: null }
    : { first: null, second: null };
}

/** Executes the ordinary source effects on a private candidate, including all
 * media look/cue validation. Throwing never writes to the supplied actors,
 * playback instances, camera, or host providers. The caller publishes once. */
export function projectFieldPuppetActorEffects(
  effects: readonly FieldPuppetActorEffect[], snapshot: FieldPuppetHostSnapshot, providers: FieldPuppetHostProviders,
): FieldPuppetHostSnapshot {
  if (!Array.isArray(snapshot.actors) || typeof providers.mapRenderContext !== "string" || !providers.mapRenderContext ||
      typeof providers.footAttribute !== "function") throw new Error("Missing source puppet effect host");
  const ids = new Set<string>();
  const result: FieldPuppetHostSnapshot = {
    actors: snapshot.actors.map((a) => {
      if (!a || !a.id || ids.has(a.id)) throw new Error("Invalid source puppet effect actor identity");
      ids.add(a.id); position(a.position); integer(a.layer);
      if ((a.direction !== null && !["up", "right", "down", "left"].includes(a.direction)) ||
          [a.character, a.visible, a.moving, a.riding, a.bodyOpaque, a.shadowVisible].some((v) => typeof v !== "boolean") ||
          !["absent", "unknown"].includes(a.childEntityObject) ||
          !["absent", "idle", "riding", "unknown"].includes(a.rideOnEntity) ||
          !Number.isFinite(a.fadeAlpha) || a.fadeAlpha < 0 || a.fadeAlpha > 1)
        throw new Error("Unknown source puppet effect actor state");
      if (a.riderAssetId !== null) integer(a.riderAssetId, 1);
      if (a.animation !== null && !(a.animation instanceof ActorAnimation)) throw new Error("Unbound source actor animation");
      if (a.viewBinding !== null && (!a.viewBinding || typeof a.viewBinding.map !== "string" || !a.viewBinding.map ||
          !Number.isInteger(a.viewBinding.layer))) throw new Error("Unbound source actor shader properties");
      if (a.viewBinding?.properties) validateFieldActorViewProjection(a.viewBinding.properties, a.viewBinding.map, a.viewBinding.layer);
      if (!a.transparentTextures) throw new Error("Unknown source actor transparent texture state");
      texture(a.transparentTextures.first); texture(a.transparentTextures.second);
      return { ...a, position: { ...a.position }, animation: a.animation?.clone() ?? null,
        viewBinding: a.viewBinding && structuredClone(a.viewBinding), transparentTextures: { ...a.transparentTextures } };
    }),
    camera: snapshot.camera && { ...snapshot.camera, position: { ...snapshot.camera.position } },
  };
  if (result.camera !== null) {
    if (!result.camera || !result.camera.id || ids.has(result.camera.id)) throw new Error("Camera dummy conflicts with a sprite actor");
    position(result.camera.position); integer(result.camera.layer);
  }
  const actor = (id: string) => {
    const a = result.actors.find((a) => a.id === id);
    if (!a) throw new Error("Missing source puppet effect actor: " + id);
    return a;
  };
  for (const effect of effects) {
    if (effect.kind === "init-camera-dummy") {
      if (!result.camera || result.camera.id !== effect.actor) throw new Error("Source camera dummy host is missing");
      const player = actor(effect.player);
      result.camera.position = { ...player.position }; result.camera.layer = player.layer;
      continue;
    }
    const target = actor(effect.actor);
    switch (effect.kind) {
      case "copy-position": {
        const from = actor(effect.from);
        if (target.moving || from.moving) throw new Error("Active source movement cannot be silently reset at script boundaries");
        if (effect.mode === "player-z") target.position.z = from.position.z;
        else if (effect.mode === "overwrite" || effect.mode === "local") target.position = { ...from.position };
        else throw new Error("Unknown source position copy mode");
        break;
      }
      case "copy-layer": target.layer = actor(effect.from).layer; break;
      case "look": {
        const direction = actor(effect.from).direction;
        if (direction === null) throw new Error("Source puppet zero-direction look provider is unresolved");
        target.direction = direction;
        if (!target.animation) throw new Error("Missing source puppet look animation media");
        target.animation.look(target.direction); break;
      }
      case "cue": {
        const from = actor(effect.from), key = from.animation?.snapshot()?.key;
        if (!key || !target.animation) throw new Error("Missing source puppet current animation/media");
        target.animation.cue(key, -1); break;
      }
      case "show": case "hide":
        if (target.childEntityObject !== "absent") throw new Error("Source puppet child visibility propagation is unresolved");
        target.visible = effect.kind === "show"; target.fadeAlpha = target.visible ? 1 : 0; break;
      case "apply-view-properties":
        if (target.character && providers.applyViewProperties) {
          const properties = providers.applyViewProperties(target.layer);
          if (properties === null) {
            if (target.layer >= 9 && target.layer <= 12) throw new Error("Missing source actor material projection");
          } else {
            validateFieldActorViewProjection(properties, providers.mapRenderContext, target.layer);
            target.viewBinding = { map: providers.mapRenderContext, layer: target.layer, properties: structuredClone(properties) };
          }
          break;
        }
        if (target.character && (target.viewBinding?.map !== providers.mapRenderContext || target.viewBinding.layer !== target.layer))
          throw new Error("Source map/layer shader projection has not been bound to this actor");
        break;
      case "attach-transparent": {
        if (!target.character) break;
        const projected = fieldPuppetTransparentTextures(target.layer, providers.upperTexture, providers.ceilTexture);
        // Non-null render targets require a Web compositor. A repeated already
        // bound projection is harmless, but new targets must not disappear.
        if ((projected.first !== null || projected.second !== null) &&
            (projected.first !== target.transparentTextures.first || projected.second !== target.transparentTextures.second))
          throw new Error("Source transparent render-texture composition is unsupported");
        target.transparentTextures = projected; break;
      }
      case "switch-transparent":
        if (!target.character) break;
        if (fieldPuppetSemiTransparent(providers.transportationType, providers.footAttribute({ ...target.position })))
          throw new Error("Source semi-transparent body material projection is unsupported");
        target.bodyOpaque = true; target.shadowVisible = true; break;
      case "ride-out":
        if (!target.character || target.riding || target.riderAssetId !== null ||
            !["absent", "idle"].includes(target.rideOnEntity))
          throw new Error("Source RideOut needs a riding asset/renderer transition provider");
        // Proven already-unmounted/empty-cache branch. It must never discard a
        // retained riding asset; ReturnRidingCharaAsset consumes that cache.
        break;
      case "ride-on": throw new Error("Source RideOn needs transportation media/animation providers");
      default: throw new Error("Unknown source puppet actor effect");
    }
  }
  return result;
}
