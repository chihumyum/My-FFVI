import { ActorAnimation } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { fieldCameraLayerFromLogical, fieldCameraWorldToContinuousCell, type FieldCameraMapRange } from "./field-camera.js";
import { fieldPuppetContextFromActors, type FieldActorFactoryCandidate } from "./field-actor-factory.js";
import type { FieldPuppetActorPlan, FieldPuppetActorsPort, FieldPuppetControlContext } from "./field-puppet-actors.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostActor, type FieldPuppetHostProviders,
  type FieldPuppetHostSnapshot } from "./field-puppet-effects.js";
import type { PartyActorCatalog } from "./party-actors.js";
import { projectFieldPuppetTransportationEffects, type FieldTransportActorPresentation,
  type FieldTransportActorOperation } from "./field-transport-actors.js";
import type { FieldNativeAnimationKeys } from "./field-native-appearance.js";
import type { Character, Direction, Evidence, Point } from "../field/types.js";

/** This is stored ON the existing FieldGame Actor. It is not a second actor
 * collection. The native entity owns pose, playback and visibility; outer
 * properties below only translate the existing owner's representation. */
export type NativeFieldActorData = {
  entity: FieldPuppetHostActor;
  fieldAssetId: number | null;
  charaZOffset: number;
  /** Mapobject rows are a different identity domain from field-character assets. */
  mapObjectAsset?: { id: number; asset: string; source: Evidence };
  updateAttribute?: 2 | 10;
  scope?: { kind: "map-npc"; group: string; entityId: string; source: Evidence };
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
  /** The same FieldPartyActors owner prepares the metadata half of script
   * Init/Finish. Reads and all validation precede native/party publication. */
  transportation?: {
    read(): { catalog: PartyActorCatalog; characters: Readonly<Record<string, Character>>;
      animationKeys: FieldNativeAnimationKeys; presentation: FieldTransportActorPresentation };
    prepare(operations: readonly FieldTransportActorOperation[]): { validate(): void; commit(): void };
  };
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
function validateMetadata(data: NativeFieldActorData): void {
  if (data.mapObjectAsset !== undefined) {
    if (data.fieldAssetId !== null || !data.scope || data.scope.kind !== "map-npc" ||
        !data.scope.group || data.scope.entityId !== data.entity.id ||
        !data.mapObjectAsset.asset || !data.mapObjectAsset.source?.file || !data.mapObjectAsset.source.assetPath ||
        !data.scope.source?.file || !data.scope.source.assetPath || ![2, 10].includes(data.updateAttribute!))
      throw new Error("Unbound native map-object asset/scope");
    checkpointInteger(data.mapObjectAsset.id, 1, 0x7fffffff);
    return;
  }
  if (data.scope !== undefined || data.updateAttribute !== undefined)
    throw new Error("Map-local actor metadata requires its map-object asset");
  if (data.fieldAssetId !== null) checkpointInteger(data.fieldAssetId, 1, 0x7fffffff);
}
function asset(catalog: PartyActorCatalog, data: NativeFieldActorData): string | null {
  validateMetadata(data);
  if (data.mapObjectAsset !== undefined) return data.mapObjectAsset.asset;
  if (data.fieldAssetId === null) return null;
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
  transportationPresentation?: FieldTransportActorPresentation,
): NativeFieldActor[] {
  mapRange(map);
  const ids = new Set<string>();
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
    return createNativeFieldActorProjection({ entity: source, fieldAssetId: metadata.fieldAssetId,
      charaZOffset: metadata.charaZOffset }, map, catalog, transportationPresentation);
  });
}

/** Shared coordinate/playback projection for both persistent factory actors and
 * source-bound map NPCs. Asset identity remains in its own table domain. */
export function createNativeFieldActorProjection(
  input: NativeFieldActorData, map: FieldCameraMapRange, catalog: PartyActorCatalog,
  transportationPresentation?: FieldTransportActorPresentation,
): NativeFieldActor {
    mapRange(map);
    const boundMap = { ...map };
    if (input.entity.moving) throw new Error("Already moving native actor cannot be installed");
    const entity = cloneEntity(input.entity), data: NativeFieldActorData = {
      entity, fieldAssetId: input.fieldAssetId, charaZOffset: finite(input.charaZOffset),
      ...(input.mapObjectAsset !== undefined ? { mapObjectAsset: structuredClone(input.mapObjectAsset) } : {}),
      ...(input.updateAttribute !== undefined ? { updateAttribute: input.updateAttribute } : {}),
      ...(input.scope !== undefined ? { scope: structuredClone(input.scope) } : {}),
    };
    const assetName = asset(catalog, data);
    if ((assetName === null) !== (entity.animation === null)) throw new Error("Native factory media/asset binding mismatch");
    const ridingMedia = () => {
      const a = data.entity;
      if (a.rideOnEntity === "unknown" || a.riding !== (a.rideOnEntity === "riding") ||
          a.rideOnEntity === "absent" && a.riderAssetId !== null ||
          data.mapObjectAsset !== undefined && (a.riding || a.riderAssetId !== null))
        throw new Error("Invalid native field riding component/cache");
      const rider = a.riderAssetId === null ? null : catalog.assets[a.riderAssetId];
      if (a.riderAssetId !== null && (!Number.isInteger(a.riderAssetId) || !rider || rider.id !== a.riderAssetId || !rider.asset))
        throw new Error("Unbound native field rider asset");
      if (!a.riding) return { asset: asset(catalog, data), mount: null };
      if (transportationPresentation !== "framework-development")
        throw new Error("Native field actor riding projection requires framework-development presentation");
      const outer = asset(catalog, data);
      if (!a.character || !rider || outer === null) throw new Error("Missing native riding inner/outer asset");
      return { asset: rider.asset, mount: outer };
    };
    ridingMedia();
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
      asset: { enumerable: true, get: () => ridingMedia().asset },
      mount: { enumerable: true, get: () => ridingMedia().mount },
    });
    // Interpolation already belongs to Actor.motion. The native read shape must
    // not keep a second moving flag which remains true after that motion ends.
    Object.defineProperty(entity, "moving", { enumerable: true, configurable: false, get: () => actor.motion !== null });
    return actor;
}

/** Private containing-transaction draft, never an actor to install over the
 * live owner. Rebuilding the accessors does not replay a source factory or
 * cancel movement: the temporary non-moving input is detached, and the entire
 * motion (including route fields) is copied back only onto the draft. */
export function createNativeFieldActorDraft(
  actor: NativeFieldActorOwner[string] & { readonly steps: number },
  map: FieldCameraMapRange, catalog: PartyActorCatalog,
  transportationPresentation?: FieldTransportActorPresentation,
): NativeFieldActor {
  if (!actor.native || actor.id !== actor.native.entity.id)
    throw new Error("Native actor draft requires an existing native identity");
  const motion = actor.motion ?? null;
  if (actor.native.entity.moving !== (motion !== null))
    throw new Error("Native actor draft requires the complete movement owner");
  checkpointInteger(actor.steps);
  const copy = createNativeFieldActorProjection({ ...actor.native,
    entity: { ...actor.native.entity, moving: false } }, map, catalog, transportationPresentation);
  copy.motion = structuredClone(motion);
  copy.steps = actor.steps;
  return copy;
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
    validateMetadata(actor.native);
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
      character: native.entity.animation?.character, fieldAssetId: native.fieldAssetId, charaZOffset: native.charaZOffset,
      metadata: canonical({ mapObjectAsset: native.mapObjectAsset ?? null, scope: native.scope ?? null,
        updateAttribute: native.updateAttribute ?? null }) };
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
  return prepareNativeFieldActorProjection(host,
    (snapshot, providers) => projectFieldPuppetActorEffects(effects, snapshot, providers), validateCurrent);
}

/** Common publication boundary for source actor instructions. The projection
 * only edits the existing identities; creation/removal belongs to map lifecycle. */
export function prepareNativeFieldActorProjection(
  host: NativeFieldActorEffectHost,
  project: (snapshot: FieldPuppetHostSnapshot, providers: FieldPuppetHostProviders) => FieldPuppetHostSnapshot,
  validateCurrent: () => void = () => {},
): () => void {
  const initial = capture(host), next = project(initial.snapshot, host.readProviders());
  if (next.actors.length !== initial.refs.length || next.actors.some((actor, index) => actor.id !== initial.refs[index]!.id))
    throw new Error("Native instruction cannot replace actor identities");
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
        ref.animation !== prior.animation || ref.character !== prior.character || ref.fieldAssetId !== prior.fieldAssetId ||
        ref.charaZOffset !== prior.charaZOffset || ref.metadata !== prior.metadata;
    })) throw new Error("Stale native field actor transaction");
    // Providers are live reads. A map/foot/media change between preparation and
    // publication cannot be hidden behind an unchanged actor snapshot.
    if (canonical(serial(project(current.snapshot, host.readProviders()))) !== expected)
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

/** A containing transaction can run several source operations on one detached
 * actor draft, then publish its final state into the SAME live identities.
 * Preparation freezes the write set; unchanged actors are never overwritten.
 * validate checks both live and draft identities/values and is fallible. The
 * containing owner must validate after its last fallible operation, then run
 * commit (plain writes only) within its synchronous publication boundary. */
export function prepareNativeFieldActorState(
  host: NativeFieldActorEffectHost, candidate: NativeFieldActorOwner,
): { validate(): void; commit(): void } {
  // This transaction owns actor writes only. Its containing transaction owns
  // the camera, which may publish before these prevalidated plain writes.
  const readState = (owner: NativeFieldActorOwner) => {
    const state = capture({ ...host, readActors: () => owner, readCamera: () => null });
    const refs = state.refs.map((ref) => {
      // Do not narrow the value to NativeFieldMotion's common fields: routes
      // and any future movement registers belong to this same owner. Retain
      // nested identities too, so replacing an equal route is still stale.
      const motion = ref.actor.motion ?? null, motionFingerprint = canonical(motion), motionRefs: object[] = [];
      const visit = (value: unknown): void => {
        if (value !== null && typeof value === "object") {
          motionRefs.push(value);
          for (const child of Object.values(value)) visit(child);
        }
      };
      visit(motion);
      return { ...ref, motion, motionFingerprint, motionRefs };
    });
    return { ...state, refs, fingerprint: canonical({ actors: serial(state.snapshot).actors,
      metadata: refs.map((ref) => ({ fieldAssetId: ref.fieldAssetId, charaZOffset: ref.charaZOffset,
        scope: ref.metadata, motion: ref.motionFingerprint })) }) };
  };
  const initial = readState(host.readActors()), next = readState(candidate);
  if (initial.refs.length !== next.refs.length || initial.refs.some((ref, index) => {
    const after = next.refs[index]!;
    return ref.id !== after.id || ref.charaZOffset !== after.charaZOffset || ref.metadata !== after.metadata;
  })) throw new Error("Native actor candidate cannot replace source identities or scopes");
  const writes = initial.refs.flatMap((ref, index) => {
    const before = initial.snapshot.actors[index]!, entity = next.snapshot.actors[index]!, after = next.refs[index]!;
    const changed = ref.fieldAssetId !== after.fieldAssetId || ref.character !== after.character ||
      canonical(serial({ camera: null, actors: [before] })) !== canonical(serial({ camera: null, actors: [entity] }));
    if (ref.motionFingerprint !== after.motionFingerprint ||
        (before.moving || entity.moving) && (changed || ref.motion === null || after.motion === null))
      throw new Error("Native actor state publication requires an explicit movement takeover");
    // No assignments, including equivalent cloned playback/position values,
    // are permitted on an actor outside the candidate's actual write set.
    return changed ? [{ ref, entity, fieldAssetId: after.fieldAssetId }] : [];
  });
  const sameState = (current: ReturnType<typeof readState>, prior: ReturnType<typeof readState>) =>
    current.fingerprint === prior.fingerprint && current.refs.length === prior.refs.length &&
    current.refs.every((ref, index) => {
      const before = prior.refs[index]!;
      return ref.id === before.id && ref.actor === before.actor && ref.native === before.native &&
        ref.entity === before.entity && ref.animation === before.animation && ref.character === before.character &&
        ref.motion === before.motion && ref.motionRefs.length === before.motionRefs.length &&
        ref.motionRefs.every((value, i) => value === before.motionRefs[i]);
    });
  const validateWritable = () => {
    for (const { ref, entity } of writes) {
      writable(ref.entity, entity);
      const descriptor = Object.getOwnPropertyDescriptor(ref.native, "fieldAssetId");
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.writable !== true)
        throw new Error("Native actor candidate requires writable asset metadata");
    }
  };
  validateWritable();
  let validated = false, committed = false;
  return {
    validate: () => {
      validated = false;
      if (committed) throw new Error("Native actor candidate already committed");
      if (!sameState(readState(host.readActors()), initial)) throw new Error("Stale native actor candidate owner");
      if (!sameState(readState(candidate), next)) throw new Error("Stale native actor candidate draft");
      validateWritable(); validated = true;
    },
    commit: () => {
      if (!validated || committed) throw new Error("Native actor publication requires current validation");
      for (const { ref, entity, fieldAssetId } of writes) {
        const { moving: _, ...values } = entity;
        ref.native.fieldAssetId = fieldAssetId;
        Object.assign(ref.entity, values);
      }
      committed = true;
    },
  };
}

function prepareNativeFieldPuppetTransportation(
  host: NativeFieldPuppetActorsHost, plan: Readonly<FieldPuppetActorPlan>, validateCurrent: () => void,
): () => void {
  const transportation = host.transportation!;
  const initial = capture(host), effects = structuredClone(plan.effects);
  const project = () => projectFieldPuppetTransportationEffects({ ...transportation.read(), effects,
    snapshot: initial.snapshot, assets: initial.refs.map(({ id, fieldAssetId, charaZOffset }) =>
      ({ id, fieldAssetId, charaZOffset })), providers: host.readProviders() });
  const next = project();
  const serialResult = (value: typeof next) => canonical({ ...value, snapshot: serial(value.snapshot),
    characters: value.snapshot.actors.map((actor) => actor.animation?.character ?? null) });
  const expected = serialResult(next);
  const candidate = Object.fromEntries(initial.refs.map((ref, index) => [ref.id, { id: ref.id,
    motion: structuredClone(ref.actor.motion ?? null),
    native: { ...ref.native, entity: next.snapshot.actors[index]!,
      fieldAssetId: next.assets.find((row) => row.id === ref.id)!.fieldAssetId } }]));
  const actorPublication = prepareNativeFieldActorState(host, candidate);
  const partyPublication = transportation.prepare(structuredClone(next.operations));
  const cameraChanged = canonical(initial.snapshot.camera) !== canonical(next.snapshot.camera);
  if (cameraChanged && !host.prepareCamera) throw new Error("Native camera effects require the existing camera owner");
  const publishCamera = cameraChanged ? host.prepareCamera!(next.snapshot.camera) : null;
  if (publishCamera !== null && typeof publishCamera !== "function") throw new Error("Invalid native camera transaction");
  let committed = false;
  return () => {
    if (committed) throw new Error("Native field actor transaction already committed");
    if (host.transportation !== transportation) throw new Error("Stale native transportation host");
    validateCurrent(); actorPublication.validate(); partyPublication.validate();
    if (serialResult(project()) !== expected) throw new Error("Stale native transportation providers");
    // Read-only providers cannot mutate an owner while we validate the other.
    validateCurrent(); actorPublication.validate(); partyPublication.validate();
    publishCamera?.();
    actorPublication.commit(); partyPublication.commit(); committed = true;
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
      const validate = () => {
        if (canonical(read()) !== context) throw new Error("Stale native field actor context");
      };
      if (host.transportation && host.readProviders().transportationPresentation === "framework-development" &&
          plan.effects.some((effect) => effect.kind === "ride-on" || effect.kind === "ride-out"))
        return prepareNativeFieldPuppetTransportation(host, plan, validate);
      return prepareNativeFieldActorEffects(host, plan, validate);
    },
    controlContext: () => structuredClone(host.controlContext()),
    prepareCollision: (enabled) => host.prepareCollision(enabled),
  };
}
