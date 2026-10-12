import { ActorAnimation } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { fieldCameraLayerFromLogical, fieldCameraWorldToContinuousCell, type FieldCameraMapRange } from "./field-camera.js";
import { fieldPuppetContextFromActors, type FieldActorFactoryCandidate } from "./field-actor-factory.js";
import type { FieldPuppetActorPlan, FieldPuppetActorsPort, FieldPuppetControlContext } from "./field-puppet-actors.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostActor, type FieldPuppetHostProviders,
  type FieldPuppetHostSnapshot } from "./field-puppet-effects.js";
import type { PartyActorCatalog } from "./party-actors.js";
import type { Direction, Point } from "../field/types.js";

/** This is stored ON the existing FieldGame Actor. It is not a second actor
 * collection. The native entity owns pose, playback and visibility; outer
 * properties below only translate the existing owner's representation. */
export type NativeFieldActorData = {
  entity: FieldPuppetHostActor;
  fieldAssetId: number | null;
  charaZOffset: number;
};
export type NativeFieldMotion = { from: Point; to: Point; elapsed: number; duration: number; manual: boolean };
export type NativeFieldActor = {
  readonly id: string;
  readonly native: NativeFieldActorData;
  x: number;
  y: number;
  /** 0..3 are browser layers; null is an unplaced source layer, not layer 0. */
  layer: number | null;
  direction: Direction | null;
  animation: ActorAnimation | null;
  readonly asset: string | null;
  readonly mount: string | null;
  motion: NativeFieldMotion | null;
  steps: number;
};
export type NativeFieldActorOwner = Readonly<Record<string, {
  readonly id: string;
  readonly native?: NativeFieldActorData;
  readonly motion?: NativeFieldMotion | null;
}>>;
export type NativeFieldActorContextRead = Omit<Parameters<typeof fieldPuppetContextFromActors>[0], "snapshot">;
export type NativeFieldCamera = FieldPuppetHostSnapshot["camera"];
export type NativeFieldActorEffectHost = {
  readActors(): NativeFieldActorOwner;
  readProviders(): FieldPuppetHostProviders;
  readCamera(): NativeFieldCamera;
  /** Optional only when the shared FieldGame has already removed camera
   * effects and prepared them against its unique FieldCameraHost. */
  prepareCamera?(candidate: NativeFieldCamera): () => void;
};
export type NativeFieldPuppetActorsHost = NativeFieldActorEffectHost & {
  readContext(): NativeFieldActorContextRead;
  controlContext(): FieldPuppetControlContext;
  prepareCollision(enabled: boolean): () => void;
};

const f = Math.fround;
const directions = ["up", "right", "down", "left"] as const;
function finite(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid native field coordinate");
  return f(value);
}
function mapRange(map: FieldCameraMapRange): void {
  checkpointKeys(map, "x,y,width,height");
  checkpointInteger(map.x, -0x80000000, 0x7fffffff); checkpointInteger(map.y, -0x80000000, 0x7fffffff);
  checkpointInteger(map.width, 1, 0x7ffffff); checkpointInteger(map.height, 1, 0x7ffffff);
}
function cloneEntity(entity: FieldPuppetHostActor): FieldPuppetHostActor {
  if (!entity || typeof entity.id !== "string" || !entity.id || !entity.position)
    throw new Error("Missing native field actor identity");
  const position = { x: finite(entity.position.x), y: finite(entity.position.y), z: finite(entity.position.z) };
  if (entity.position.x !== position.x || entity.position.y !== position.y || entity.position.z !== position.z)
    throw new Error("Native field coordinates must retain float32 values");
  checkpointInteger(entity.layer, 0, 31);
  if (entity.direction !== null && !directions.includes(entity.direction)) throw new Error("Unknown native field direction");
  if (entity.animation !== null && !(entity.animation instanceof ActorAnimation)) throw new Error("Unknown native field playback");
  return { ...entity, position, animation: entity.animation?.clone() ?? null,
    viewBinding: entity.viewBinding && structuredClone(entity.viewBinding),
    transparentTextures: { ...entity.transparentTextures } };
}
function asset(catalog: PartyActorCatalog, data: NativeFieldActorData): string | null {
  if (data.fieldAssetId === null) return null;
  checkpointInteger(data.fieldAssetId, 1, 0x7fffffff);
  const row = catalog.assets[data.fieldAssetId];
  if (!row || !row.asset) throw new Error("Missing native field asset binding");
  return row.asset;
}

/** Translate a detached factory candidate into the objects to insert in the
 * existing actors owner. The caller must retain each object, not spread it:
 * spreading accessors would create stale duplicate positions/playback. This
 * function makes no publication and never retains the candidate or camera. */
export function createNativeFieldActorProjections(
  candidate: FieldActorFactoryCandidate, map: FieldCameraMapRange, catalog: PartyActorCatalog,
): NativeFieldActor[] {
  mapRange(map);
  const boundMap = { ...map }, ids = new Set<string>();
  if (!candidate || candidate.snapshot.actors.length !== candidate.assets.length)
    throw new Error("Incomplete native field actor factory candidate");
  const assetIds = new Set<string>();
  for (const metadata of candidate.assets) {
    if (!metadata.id || assetIds.has(metadata.id)) throw new Error("Duplicate native field asset identity");
    assetIds.add(metadata.id);
  }
  return candidate.snapshot.actors.map((source) => {
    if (ids.has(source.id)) throw new Error("Duplicate native field actor identity");
    ids.add(source.id);
    const metadata = candidate.assets.find((row) => row.id === source.id);
    if (!metadata || source.moving) throw new Error("Unbound or already moving factory actor");
    const entity = cloneEntity(source), data: NativeFieldActorData = {
      entity, fieldAssetId: metadata.fieldAssetId, charaZOffset: finite(metadata.charaZOffset),
    };
    const assetName = asset(catalog, data);
    if ((assetName === null) !== (entity.animation === null)) throw new Error("Native factory media/asset binding mismatch");
    if (entity.riding || entity.riderAssetId !== null || !["absent", "idle"].includes(entity.rideOnEntity))
      throw new Error("Native field actor riding projection is unavailable");
    const actor = { motion: null, steps: 0 } as NativeFieldActor;
    Object.defineProperties(actor, {
      id: { enumerable: true, value: entity.id },
      native: { enumerable: true, value: data },
      x: { enumerable: true, get: () => f(fieldCameraWorldToContinuousCell(boundMap,
        { x: data.entity.position.x, y: data.entity.position.y }).x + boundMap.x),
        set: (x: number) => {
          const local = f(finite(x) - boundMap.x);
          data.entity.position.x = finite(f(f(f(local - f(boundMap.width * 0.5)) * 16) + 8));
        } },
      y: { enumerable: true, get: () => f(fieldCameraWorldToContinuousCell(boundMap,
        { x: data.entity.position.x, y: data.entity.position.y }).y + boundMap.y),
        set: (y: number) => {
          const local = f(finite(y) - boundMap.y);
          data.entity.position.y = finite(f(f(f(f(boundMap.height * 0.5) - 1) - local) * 16 + 8));
        } },
      layer: { enumerable: true, get: () => data.entity.layer >= 9 && data.entity.layer <= 12 ? data.entity.layer - 9 : null,
        set: (value: number | null) => {
          // Translation only: a source ChangeLayer/SetPos caller still owns Z.
          // There is no fourth entry in Puppet.kLayerValues.
          if (value === null) {
            if (data.entity.layer >= 9 && data.entity.layer <= 12) throw new Error("Cannot infer an unplaced native layer");
            return;
          }
          data.entity.layer = fieldCameraLayerFromLogical(value).layer;
        } },
      direction: { enumerable: true, get: () => data.entity.direction,
        set: (value: Direction | null) => {
          if (value !== null && !directions.includes(value)) throw new Error("Unknown native field direction");
          data.entity.direction = value;
        } },
      animation: { enumerable: true, get: () => data.entity.animation,
        set: (value: ActorAnimation | null) => {
          if (value !== null && !(value instanceof ActorAnimation)) throw new Error("Unknown native field playback");
          data.entity.animation = value;
        } },
      asset: { enumerable: true, get: () => asset(catalog, data) },
      mount: { enumerable: true, get: () => {
        if (data.entity.riding || data.entity.riderAssetId !== null || !["absent", "idle"].includes(data.entity.rideOnEntity))
          throw new Error("Native field actor riding projection is unavailable");
        return null;
      } },
    });
    // Interpolation already belongs to Actor.motion. The native read shape must
    // not keep a second moving flag which remains true after that motion ends.
    Object.defineProperty(entity, "moving", { enumerable: true, configurable: false, get: () => actor.motion !== null });
    return actor;
  });
}

/** Legacy actors without native admission are not invented as native objects.
 * A mapped/referenced legacy actor will be rejected by context/effect lookup. */
export function readNativeFieldActors(owner: NativeFieldActorOwner, camera: NativeFieldCamera): FieldPuppetHostSnapshot {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) throw new Error("Missing field actor owner");
  const actors: FieldPuppetHostActor[] = [];
  for (const [id, actor] of Object.entries(owner)) {
    if (!actor || actor.id !== id) throw new Error("Field actor owner key/identity mismatch");
    if (!actor.native) continue;
    if (actor.native.entity.id !== id) throw new Error("Native and outer field actor identities differ");
    if (actor.native.fieldAssetId !== null) checkpointInteger(actor.native.fieldAssetId, 1, 0x7fffffff);
    finite(actor.native.charaZOffset);
    const entity = cloneEntity(actor.native.entity);
    if (actor.motion !== undefined) entity.moving = actor.motion !== null;
    actors.push(entity);
  }
  const dummy = camera && { ...camera, position: { x: finite(camera.position.x), y: finite(camera.position.y), z: finite(camera.position.z) } };
  if (dummy && (actors.some((a) => a.id === dummy.id) || !dummy.id)) throw new Error("Native camera conflicts with an actor");
  return { actors, camera: dummy };
}

const serial = (snapshot: FieldPuppetHostSnapshot) => ({ camera: snapshot.camera,
  actors: snapshot.actors.map((entity) => ({ ...entity, animation: entity.animation?.snapshot() ?? null })) });
function capture(host: NativeFieldActorEffectHost) {
  const owner = host.readActors(), snapshot = readNativeFieldActors(owner, host.readCamera());
  const refs = snapshot.actors.map(({ id }) => {
    const actor = owner[id]!, native = actor.native!;
    return { id, actor, native, entity: native.entity, animation: native.entity.animation,
      character: native.entity.animation?.character, fieldAssetId: native.fieldAssetId, charaZOffset: native.charaZOffset };
  });
  return { snapshot, refs, fingerprint: canonical(serial(snapshot)) };
}
function writable(entity: FieldPuppetHostActor, candidate: FieldPuppetHostActor): void {
  for (const key of Object.keys(candidate)) {
    if (key === "moving") continue;
    const descriptor = Object.getOwnPropertyDescriptor(entity, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.writable !== true)
      throw new Error("Native field publication needs a writable existing entity");
  }
}

/** Both preparation and stale rejection leave every existing identity intact.
 * No persistent actor copy is captured by the port: only this short-lived
 * transaction retains a candidate until its single synchronous publication. */
export function prepareNativeFieldActorEffects(
  host: NativeFieldActorEffectHost, plan: Readonly<FieldPuppetActorPlan>, validateCurrent: () => void = () => {},
): () => void {
  const effects = structuredClone(plan.effects);
  const initial = capture(host), next = projectFieldPuppetActorEffects(effects, initial.snapshot, host.readProviders());
  const expected = canonical(serial(next));
  for (const [index, ref] of initial.refs.entries()) writable(ref.entity, next.actors[index]!);
  const cameraChanged = canonical(initial.snapshot.camera) !== canonical(next.camera);
  if (cameraChanged && !host.prepareCamera) throw new Error("Native camera effects require the existing camera owner");
  const publishCamera = cameraChanged ? host.prepareCamera!(next.camera) : null;
  if (publishCamera !== null && typeof publishCamera !== "function") throw new Error("Invalid native camera transaction");
  let committed = false;
  return () => {
    if (committed) throw new Error("Native field actor transaction already committed");
    validateCurrent();
    const current = capture(host);
    if (current.fingerprint !== initial.fingerprint || current.refs.length !== initial.refs.length || current.refs.some((ref, index) => {
      const prior = initial.refs[index]!;
      return ref.id !== prior.id || ref.actor !== prior.actor || ref.native !== prior.native || ref.entity !== prior.entity ||
        ref.animation !== prior.animation || ref.character !== prior.character || ref.fieldAssetId !== prior.fieldAssetId || ref.charaZOffset !== prior.charaZOffset;
    })) throw new Error("Stale native field actor transaction");
    // Providers are live reads. A map/foot/media change between preparation and
    // publication cannot be hidden behind an unchanged actor snapshot.
    if (canonical(serial(projectFieldPuppetActorEffects(effects, current.snapshot, host.readProviders()))) !== expected)
      throw new Error("Stale native field actor providers");
    for (const [index, ref] of current.refs.entries()) writable(ref.entity, next.actors[index]!);
    // Camera commits first and may reject its own stale revision. All actor
    // writes after it are prevalidated plain data writes, without callbacks.
    publishCamera?.();
    for (const [index, ref] of current.refs.entries()) {
      const { moving: _, ...values } = next.actors[index]!;
      Object.assign(ref.entity, values);
    }
    committed = true;
  };
}

/** Dynamic adapter to the existing actor, roster, appearance, camera and
 * collision owners. No mutable owned/actor/camera collection is retained. */
export function createNativeFieldPuppetActorsPort(host: NativeFieldPuppetActorsHost): FieldPuppetActorsPort {
  for (const key of ["readActors", "readContext", "readProviders", "readCamera", "controlContext", "prepareCollision"] as const)
    if (typeof host[key] !== "function") throw new Error("Missing native field actor host port: " + key);
  const read = () => {
    const source = host.readContext();
    return { catalog: structuredClone(source.catalog),
      context: fieldPuppetContextFromActors({ ...source, snapshot: readNativeFieldActors(host.readActors(), host.readCamera()) }) };
  };
  return {
    read,
    prepare: (plan) => {
      const context = canonical(read());
      return prepareNativeFieldActorEffects(host, plan, () => {
        if (canonical(read()) !== context) throw new Error("Stale native field actor context");
      });
    },
    controlContext: () => structuredClone(host.controlContext()),
    prepareCollision: (enabled) => host.prepareCollision(enabled),
  };
}
