import { ActorAnimation, FIELD_POSE } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { validateFieldActorViewProjection } from "./field-actor-view.js";
import { readNativeFieldActors, type NativeFieldActorOwner } from "./field-native-actors.js";
import type { FieldPartyActorRenderStep, FieldPartyActorRendererPublication } from "./field-party-actors.js";
import type { FieldPuppetHostActor, FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { PartyActorAsset, PartyActorCatalog } from "./party-actors.js";
import type { FieldTransportActorPresentation } from "./field-transport-actors.js";
import type { Character, Direction, Evidence } from "../field/types.js";

export type FieldNativeAnimationKeys = {
  kind: "native-field-animation-keys-v1";
  /** Includes source keys whose playback compilation is blocked. Absence from
   * the usable Character.animations alone is NOT source key absence. */
  assets: Record<string, { keys: string[]; source: Evidence; contentHash: string }>;
};

export type NativeFieldAppearanceHost = {
  readActors(): NativeFieldActorOwner;
  readCatalog(): PartyActorCatalog;
  readCharacters(): Readonly<Record<string, Character>>;
  readAnimationKeys(): FieldNativeAnimationKeys;
  readProviders(): FieldPuppetHostProviders;
  transportationPresentation?: FieldTransportActorPresentation;
};

/** SetAssetStructure (aec180) allocates a fresh animation owner, then
 * OverrideOldData (b11ff0) restores time/play only if the old key exists in the
 * new asset. SetupAnimCommon obtains duration/mode/flip from the NEW asset.
 * A missing old key chooses GetMovingAnimName(direction), then source Default.
 * Zero native direction selects Default without changing the direction.
 * No previous animation object means InitAssetStructure only: no implicit cue. */
export function replaceNativeFieldActorAnimation(
  previous: ActorAnimation | null, character: Character, direction: Direction | null, sourceKeys: readonly string[],
): ActorAnimation {
  if (direction !== null && !Object.hasOwn(FIELD_POSE, direction)) throw new Error("Unknown native appearance direction");
  if (!character || !character.animations || !character.sprites || !Object.keys(character.sprites).length || !Object.keys(character.animations).length)
    throw new Error("Missing native appearance media");
  if (!Array.isArray(sourceKeys) || sourceKeys.some((key) => typeof key !== "string" || !key) ||
      new Set(sourceKeys).size !== sourceKeys.length || Object.keys(character.animations).some((key) => !sourceKeys.includes(key)))
    throw new Error("Invalid native appearance source animation keys");
  const next = new ActorAnimation(character);
  if (previous === null) return next;
  const old = previous.snapshot();
  const retained = old !== null && sourceKeys.includes(old.key);
  const directional = direction === null ? "Default" : FIELD_POSE[direction];
  const key = retained ? old.key : sourceKeys.includes(directional) ? directional : "Default";
  const animation = character.animations[key];
  if (!animation) throw new Error((sourceKeys.includes(key) ? "Uncompiled native appearance source animation: " : "Missing native appearance fallback animation: ") + key);
  next.restore({ key, mode: animation.mode, duration: Math.fround(animation.duration), flip: animation.flip,
    elapsed: retained ? old.elapsed : 0, playing: retained ? old.playing : false, loops: 0 });
  // Validate the actual selected frame before any state publication. In
  // particular, a present key with missing sprites must NOT become fallback.
  next.frame();
  return next;
}

const serialEntity = (actor: FieldPuppetHostActor) => ({ ...actor, animation: actor.animation?.snapshot() ?? null });
function capture(host: NativeFieldAppearanceHost) {
  const owner = host.readActors(), snapshot = readNativeFieldActors(owner, null);
  const refs = snapshot.actors.map((actor) => {
    const outer = owner[actor.id]!, native = outer.native!;
    return { id: actor.id, outer, native, entity: native.entity, animation: native.entity.animation,
      character: native.entity.animation?.character, fieldAssetId: native.fieldAssetId, charaZOffset: native.charaZOffset,
      metadata: canonical({ mapAnimation: native.mapAnimation ?? null, mapObjectAsset: native.mapObjectAsset ?? null, scope: native.scope ?? null,
        updateAttribute: native.updateAttribute ?? null }) };
  });
  return { snapshot, refs, fingerprint: canonical(snapshot.actors.map(serialEntity)) };
}
type Capture = ReturnType<typeof capture>;
type AppearanceUpdate = { id: string; fieldAssetId: number; riderAssetId: number | null;
  animation?: ActorAnimation; shadowVisible?: boolean };

function boundAsset(catalog: PartyActorCatalog, value: PartyActorAsset): PartyActorAsset {
  const expected = catalog.assets[value.id];
  if (!expected || canonical(expected) !== canonical(value)) throw new Error("Unbound native appearance asset");
  if (![0, 1].includes(expected.shadowType)) throw new Error("Native appearance custom shadow is unavailable");
  return expected;
}
function material(actor: FieldPuppetHostActor, providers: FieldPuppetHostProviders): void {
  // InitAssetStructure retains the existing body material and copies blend
  // factors into the existing head material. It does not reapply map settings,
  // attach render targets, alter CharaZOffset, show/hide, or change Unity layer.
  const view = actor.viewBinding;
  if (view === null) {
    if (actor.layer >= 9 && actor.layer <= 12) throw new Error("Missing native appearance view binding");
    return;
  }
  if (view.map !== providers.mapRenderContext || view.layer !== actor.layer || !view.properties)
    throw new Error("Unknown native appearance material binding");
  validateFieldActorViewProjection(view.properties, view.map, actor.layer);
  if (providers.applyViewProperties && canonical(providers.applyViewProperties(actor.layer)) !== canonical(view.properties))
    throw new Error("Stale native appearance material provider");
}
function project(host: NativeFieldAppearanceHost, input: Capture, steps: readonly FieldPartyActorRenderStep[]) {
  const catalog = host.readCatalog(), characters = host.readCharacters(), providers = host.readProviders(), animationKeys = host.readAnimationKeys();
  if (!catalog || catalog.formatVersion !== 1 || !characters || !providers || animationKeys?.kind !== "native-field-animation-keys-v1")
    throw new Error("Missing native appearance providers");
  const entities = new Map(input.snapshot.actors.map((entity) => [entity.id, entity]));
  const assets = new Map(input.refs.map((ref) => [ref.id, ref.fieldAssetId]));
  const usedMedia = new Map<string, Character>(), usedAssets = new Map<number, PartyActorAsset>();
  const updates = new Map<string, AppearanceUpdate>();
  for (const step of steps) {
    if (step.media.mount !== null && host.transportationPresentation !== "framework-development")
      throw new Error("Native appearance riding publication is unavailable without framework-development presentation");
    for (const change of step.plan.changes) {
      const entity = entities.get(change.actorId);
      if (!entity) throw new Error("Missing native appearance actor: " + change.actorId);
      if (input.refs.find((ref) => ref.id === entity.id)!.native.mapObjectAsset !== undefined)
        throw new Error("Party appearance cannot replace a map-object actor asset");
      if (!entity.character || !["replace", "rider"].includes(change.mode) || entity.rideOnEntity === "unknown" || entity.riding !== (entity.rideOnEntity === "riding") ||
          entity.rideOnEntity === "absent" && entity.riderAssetId !== null ||
          change.mode === "replace" && entity.riding || change.mode === "rider" && !entity.riding)
        throw new Error("Native appearance riding/character replacement is unavailable");
      if (change.mode === "rider" && host.transportationPresentation !== "framework-development")
        throw new Error("Native rider replacement requires framework-development presentation");
      const selected = boundAsset(catalog, change.asset), character = characters[selected.asset];
      if (!character) throw new Error("Missing native appearance media: " + selected.asset);
      const keys = animationKeys.assets[selected.asset];
      if (!keys || !/^[a-f0-9]{64}$/.test(keys.contentHash) || canonical(keys.source) !== canonical(character.source))
        throw new Error("Unbound native appearance source animation keys");
      const oldAssetId = assets.get(entity.id)!;
      if ((oldAssetId === null) !== (entity.animation === null)) throw new Error("Native appearance old asset/playback mismatch");
      if (oldAssetId !== null) {
        const oldAsset = catalog.assets[oldAssetId], oldCharacter = oldAsset && characters[oldAsset.asset];
        if (!oldAsset || !oldCharacter || canonical(entity.animation!.character) !== canonical(oldCharacter))
          throw new Error("Unbound native appearance old media");
        usedAssets.set(oldAsset.id, oldAsset); usedMedia.set(oldAsset.asset, oldCharacter);
      }
      material(entity, providers);
      if (change.mode === "rider") {
        if (oldAssetId === null || entity.riderAssetId === null) throw new Error("Missing native inner/outer appearance identity");
        const oldRider = catalog.assets[entity.riderAssetId], oldRiderMedia = oldRider && characters[oldRider.asset];
        if (!oldRider || !oldRiderMedia) throw new Error("Unbound native prior rider media");
        usedAssets.set(oldRider.id, oldRider); usedMedia.set(oldRider.asset, oldRiderMedia);
        // UpdateRigingCharaAsset changes +0x1a0 and the ride-on component. The
        // outer playback/shadow remain owned by the transport. The framework
        // renderer derives its inner presentation from these real identities.
        entity.riderAssetId = selected.id;
        usedAssets.set(selected.id, selected); usedMedia.set(selected.asset, character);
        updates.set(entity.id, { ...updates.get(entity.id), id: entity.id, fieldAssetId: oldAssetId, riderAssetId: selected.id });
        continue;
      }
      const animation = replaceNativeFieldActorAnimation(entity.animation, character, entity.direction, keys.keys);
      entity.animation = animation; entity.shadowVisible = selected.shadowType === 1;
      assets.set(entity.id, selected.id); usedAssets.set(selected.id, selected); usedMedia.set(selected.asset, character);
      updates.set(entity.id, { id: entity.id, fieldAssetId: selected.id, riderAssetId: entity.riderAssetId,
        animation, shadowVisible: entity.shadowVisible });
    }
  }
  return { updates: [...updates.values()], media: [...usedMedia.entries()],
    fingerprint: canonical({ actors: [...entities.values()].map(serialEntity), assets: [...assets],
      sourceAssets: [...usedAssets], media: [...usedMedia], animationKeys: [...usedMedia.keys()].map((key) => [key, animationKeys.assets[key]]) }) };
}
function writable(object: object, keys: readonly string[]): void {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.writable !== true)
      throw new Error("Native appearance publication needs writable existing data");
  }
}

/** A short-lived, ordered candidate for the EXISTING actor owner. No persistent
 * second actor store is introduced. Metadata/camera/owned state belong to the
 * containing transaction; this helper publishes only SetAssetStructure effects.
 * Call validate before owned commit, then commit synchronously with no intervening
 * actor/media mutation. commit intentionally does no fallible provider reads. */
export function prepareNativeFieldActorAppearance(
  host: NativeFieldAppearanceHost, steps: readonly FieldPartyActorRenderStep[],
): FieldPartyActorRendererPublication {
  for (const key of ["readActors", "readCatalog", "readCharacters", "readAnimationKeys", "readProviders"] as const)
    if (typeof host[key] !== "function") throw new Error("Missing native appearance host: " + key);
  if (!Array.isArray(steps)) throw new Error("Missing native appearance batch");
  const plans = structuredClone(steps), initial = capture(host), candidate = project(host, initial, plans);
  const writes = candidate.updates.map((update) => {
    const ref = initial.refs.find((ref) => ref.id === update.id)!;
    return { ref, update };
  });
  const validateWritable = () => {
    for (const { ref } of writes) {
      writable(ref.native, ["fieldAssetId"]); writable(ref.entity, ["animation", "shadowVisible", "riderAssetId"]);
    }
  };
  validateWritable();
  let validated = false, committed = false;
  return {
    validate: () => {
      validated = false;
      if (committed) throw new Error("Native appearance transaction already committed");
      const current = capture(host);
      if (current.fingerprint !== initial.fingerprint || current.refs.length !== initial.refs.length || current.refs.some((ref, index) => {
        const prior = initial.refs[index]!;
        return ref.id !== prior.id || ref.outer !== prior.outer || ref.native !== prior.native || ref.entity !== prior.entity ||
          ref.animation !== prior.animation || ref.character !== prior.character || ref.fieldAssetId !== prior.fieldAssetId ||
          ref.charaZOffset !== prior.charaZOffset || ref.metadata !== prior.metadata;
      })) throw new Error("Stale native appearance actor candidate");
      const refreshed = project(host, current, plans);
      if (refreshed.fingerprint !== candidate.fingerprint || refreshed.media.some(([key, media], index) =>
        candidate.media[index]?.[0] !== key || candidate.media[index]?.[1] !== media))
        throw new Error("Stale native appearance media/providers");
      validateWritable(); validated = true;
    },
    commit: () => {
      if (committed || !validated) throw new Error("Native appearance publication requires current validation");
      // These are prevalidated plain data writes, with no callback or live
      // roster/provider read between them. Keep outer/native/entity identities.
      for (const { ref, update } of writes) {
        ref.native.fieldAssetId = update.fieldAssetId;
        ref.entity.riderAssetId = update.riderAssetId;
        if (update.animation !== undefined) ref.entity.animation = update.animation;
        if (update.shadowVisible !== undefined) ref.entity.shadowVisible = update.shadowVisible;
      }
      committed = true;
    },
  };
}
