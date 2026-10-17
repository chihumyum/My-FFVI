import { ActorAnimation } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { replaceNativeFieldActorAnimation, type FieldNativeAnimationKeys } from "./field-native-appearance.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostSnapshot, type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { FieldPuppetActorEffect } from "./field-puppet-actors.js";
import type { PartyActorCatalog, PartyActorInstance } from "./party-actors.js";
import type { Character } from "../field/types.js";

/** Explicit Web framework presentation. Inner/outer asset ownership follows
 * source, but the source ride-on animation table, feet clipping and overlay
 * synchronization are not yet a complete renderer provider. */
export type FieldTransportActorPresentation = "framework-development";
export type FieldTransportActorOperation =
  | { kind: "ride-on"; actorId: string; frontAssetId: number; skipIfSameOuter: boolean }
  | { kind: "ride-out"; actorId: string; restoreRiderAsset: boolean }
  | { kind: "replace" | "replace-rider"; actorId: string; fieldAssetId: number };
export type FieldTransportActorAsset = { id: string; fieldAssetId: number | null; charaZOffset: number };
export type FieldTransportActorInput = {
  snapshot: FieldPuppetHostSnapshot;
  assets: readonly FieldTransportActorAsset[];
  catalog: PartyActorCatalog;
  characters: Readonly<Record<string, Character>>;
  animationKeys: FieldNativeAnimationKeys;
  operations: readonly FieldTransportActorOperation[];
  presentation?: FieldTransportActorPresentation;
};

function asset(catalog: PartyActorCatalog, id: number) {
  checkpointInteger(id, 1, 0x7fffffff);
  const row = catalog.assets[id];
  if (!row || row.id !== id || !row.asset) throw new Error("Unknown transportation field asset");
  return row;
}
function framework(presentation: FieldTransportActorPresentation | undefined): void {
  if (presentation !== "framework-development")
    throw new Error("Transportation dual-layer animation requires explicit framework-development presentation");
}
export function validateFieldTransportActorInstance(catalog: PartyActorCatalog, actor: PartyActorInstance): void {
  checkpointKeys(actor, "id,fieldAssetId,riderFieldAssetId,riding");
  if (typeof actor.id !== "string" || !actor.id || typeof actor.riding !== "boolean")
    throw new Error("Invalid transportation actor identity");
  if (actor.fieldAssetId !== null) asset(catalog, actor.fieldAssetId);
  if (actor.riderFieldAssetId !== null) asset(catalog, actor.riderFieldAssetId);
  if (actor.riding && (actor.fieldAssetId === null || actor.riderFieldAssetId === null))
    throw new Error("Mounted transportation actor requires both source asset identities");
}
function operation(op: FieldTransportActorOperation, catalog: PartyActorCatalog): void {
  if (!op || typeof op.actorId !== "string" || !op.actorId) throw new Error("Missing transportation actor target");
  if (op.kind === "ride-on") {
    checkpointKeys(op, "kind,actorId,frontAssetId,skipIfSameOuter");
    asset(catalog, op.frontAssetId);
    if (typeof op.skipIfSameOuter !== "boolean") throw new Error("Unknown RideOn same-asset policy");
  } else if (op.kind === "ride-out") {
    checkpointKeys(op, "kind,actorId,restoreRiderAsset");
    if (typeof op.restoreRiderAsset !== "boolean") throw new Error("Unknown RideOut asset restoration policy");
  } else if (op.kind === "replace" || op.kind === "replace-rider") {
    checkpointKeys(op, "kind,actorId,fieldAssetId"); asset(catalog, op.fieldAssetId);
  } else throw new Error("Unknown transportation actor operation");
}

/** Source-order identity projection. RideOn caches CURRENT outer even if
 * already riding. RideOut itself leaves the cache intact. The accessor first
 * restores AND clears the cache; SetupCharaAsset supplies Replace -> RideOut(false).
 * Get/ChangeTransportation is deliberately a separate controller operation. */
export function projectFieldTransportActorInstance(
  actor: PartyActorInstance, operations: readonly FieldTransportActorOperation[], catalog: PartyActorCatalog,
  presentation?: FieldTransportActorPresentation,
): PartyActorInstance {
  validateFieldTransportActorInstance(catalog, actor);
  if (!Array.isArray(operations)) throw new Error("Missing transportation actor operations");
  const next = { ...actor };
  for (const op of operations) {
    operation(op, catalog);
    if (op.actorId !== next.id) throw new Error("Transportation actor operation targets another identity");
    if (op.kind === "ride-on") {
      if (op.skipIfSameOuter && next.fieldAssetId === op.frontAssetId) continue;
      framework(presentation);
      if (next.fieldAssetId === null) throw new Error("RideOn requires an existing character asset");
      next.riderFieldAssetId = next.fieldAssetId;
      next.fieldAssetId = op.frontAssetId; next.riding = true;
    } else if (op.kind === "ride-out") {
      if (next.riding) framework(presentation);
      // ReturnRidingCharaAsset 87a4c0 restores, then clears +0x1a0. A null cache
      // means no SetAssetStructure call; RideOut itself never clears the cache.
      if (op.restoreRiderAsset && next.riderFieldAssetId !== null) {
        next.fieldAssetId = next.riderFieldAssetId; next.riderFieldAssetId = null;
      }
      next.riding = false;
    } else if (op.kind === "replace-rider") {
      framework(presentation);
      if (!next.riding) throw new Error("Rider replacement requires active riding");
      next.riderFieldAssetId = op.fieldAssetId;
    } else {
      if (next.riding) framework(presentation);
      next.fieldAssetId = op.fieldAssetId;
    }
  }
  validateFieldTransportActorInstance(catalog, next);
  return next;
}

/** A disposable projection of the same actor set. This function neither
 * publishes nor creates actors and does not read a mutable transport owner. */
export function projectFieldTransportActors(input: FieldTransportActorInput): {
  snapshot: FieldPuppetHostSnapshot; assets: FieldTransportActorAsset[];
} {
  const { catalog, characters, animationKeys, operations, presentation } = input;
  if (!input.snapshot || !Array.isArray(input.snapshot.actors) || !Array.isArray(input.assets) ||
      !Array.isArray(operations) || catalog?.formatVersion !== 1 ||
      animationKeys?.kind !== "native-field-animation-keys-v1") throw new Error("Missing transportation actor providers");
  const assets = input.assets.map((row) => ({ ...row }));
  const ids = new Set<string>();
  const snapshot: FieldPuppetHostSnapshot = { camera: input.snapshot.camera && structuredClone(input.snapshot.camera),
    actors: input.snapshot.actors.map((a) => ({ ...a, position: { ...a.position },
      animation: a.animation?.clone() ?? null, viewBinding: a.viewBinding && structuredClone(a.viewBinding),
      transparentTextures: { ...a.transparentTextures } })) };
  if (assets.length !== snapshot.actors.length || new Set(assets.map((a) => a.id)).size !== assets.length)
    throw new Error("Incomplete transportation actor asset bindings");
  const targets = new Set(operations.map((op) => { operation(op, catalog); return op.actorId; }));
  const media = (id: number) => {
    const row = asset(catalog, id), character = characters[row.asset], keys = animationKeys.assets[row.asset];
    if (!character || !keys || !/^[a-f0-9]{64}$/.test(keys.contentHash) ||
        canonical(keys.source) !== canonical(character.source) || ![0, 1].includes(row.shadowType))
      throw new Error("Unbound transportation actor media/animation/shadow provider");
    return { row, character, keys };
  };
  for (const a of snapshot.actors) {
    if (!a.id || ids.has(a.id)) throw new Error("Duplicate transportation actor identity");
    ids.add(a.id);
    const row = assets.find((r) => r.id === a.id);
    if (!row) throw new Error("Missing transportation actor asset binding");
    // This is an operation projection, not a fresh actor loader. Untargeted
    // map objects have their own asset domain (null fieldAssetId with playback)
    // and retain the complete state admitted by their original owner.
    if (!targets.has(a.id)) continue;
    validateFieldTransportActorInstance(catalog, { id: a.id, fieldAssetId: row.fieldAssetId,
      riderFieldAssetId: a.riderAssetId, riding: a.riding });
    if (a.riding !== (a.rideOnEntity === "riding") || a.rideOnEntity === "unknown" ||
        a.rideOnEntity === "absent" && (a.riding || a.riderAssetId !== null))
      throw new Error("Transportation actor has an inconsistent ride-on component");
    if ((row.fieldAssetId === null) !== (a.animation === null)) throw new Error("Transportation asset/playback mismatch");
    if (row.fieldAssetId !== null) {
      const bound = media(row.fieldAssetId);
      if (canonical(a.animation!.character) !== canonical(bound.character)) throw new Error("Unbound transportation outer animation");
      const checked = a.animation!.validatedClone(); a.animation = checked;
    }
    if (a.riderAssetId !== null) media(a.riderAssetId);
  }
  for (const op of operations) {
    operation(op, catalog);
    const a = snapshot.actors.find((a) => a.id === op.actorId), row = assets.find((r) => r.id === op.actorId);
    if (!a || !row) throw new Error("Missing existing transportation actor");
    if (!a.character || a.moving || a.childEntityObject !== "absent")
      throw new Error("Transportation actor movement/child/component lifecycle is unresolved");
    if ((op.kind === "ride-on" || op.kind === "ride-out" || op.kind === "replace-rider") && a.rideOnEntity === "absent")
      throw new Error("Transportation actor has no source ride-on component");
    const before: PartyActorInstance = { id: a.id, fieldAssetId: row.fieldAssetId, riderFieldAssetId: a.riderAssetId, riding: a.riding };
    const after = projectFieldTransportActorInstance(before, [op], catalog, presentation);
    const skipped = op.kind === "ride-on" && op.skipIfSameOuter && before.fieldAssetId === op.frontAssetId;
    const replaced = !skipped && (op.kind === "replace" || op.kind === "ride-on" ||
      op.kind === "ride-out" && op.restoreRiderAsset && before.riderFieldAssetId !== null);
    if (replaced && after.fieldAssetId !== null) {
      const bound = media(after.fieldAssetId);
      a.animation = replaceNativeFieldActorAnimation(a.animation, bound.character, a.direction, bound.keys.keys);
      a.shadowVisible = bound.row.shadowType === 1;
    }
    if (after.riderFieldAssetId !== null) media(after.riderFieldAssetId);
    row.fieldAssetId = after.fieldAssetId; a.riderAssetId = after.riderFieldAssetId; a.riding = after.riding;
    if (!skipped && (op.kind === "ride-on" || op.kind === "ride-out")) a.rideOnEntity = after.riding ? "riding" : "idle";
  }
  return { snapshot, assets };
}

/** InitializePlayerPuppetEntities calls IEntityAccessor slots 28/29, the same
 * RideOnTransportation/ReturnRidingCharaAsset wrappers as ordinary NPC riding.
 * Preserve their position in the effect sequence: Look and material updates
 * precede the ride, while Hide/Cue consume its resulting outer animation. */
export function projectFieldPuppetTransportationEffects(input: Omit<FieldTransportActorInput, "operations"> & {
  effects: readonly FieldPuppetActorEffect[];
  providers: FieldPuppetHostProviders;
}): { snapshot: FieldPuppetHostSnapshot; assets: FieldTransportActorAsset[]; operations: FieldTransportActorOperation[] } {
  if (input.presentation !== "framework-development" || input.providers.transportationPresentation !== input.presentation)
    throw new Error("Source puppet transportation requires trusted framework-development providers");
  let snapshot = projectFieldPuppetActorEffects([], input.snapshot, input.providers);
  const assets = input.assets.map((row) => ({ ...row })), operations: FieldTransportActorOperation[] = [];
  if (assets.length !== snapshot.actors.length || new Set(assets.map((row) => row.id)).size !== assets.length ||
      snapshot.actors.some((actor) => !assets.some((row) => row.id === actor.id)))
    throw new Error("Incomplete source puppet transportation asset bindings");
  for (const effect of input.effects) {
    if (effect.kind !== "ride-on" && effect.kind !== "ride-out") {
      snapshot = projectFieldPuppetActorEffects([effect], snapshot, input.providers);
      continue;
    }
    const index = snapshot.actors.findIndex((actor) => actor.id === effect.actor), target = snapshot.actors[index];
    const metadata = assets.find((row) => row.id === effect.actor);
    if (!target || !metadata) throw new Error("Missing source puppet transportation actor");
    // Keep the already-proved empty RideOut path and its absent-component
    // semantics. It does not create an asset-bookkeeping write for a resident.
    if (effect.kind === "ride-out" && !target.riding && target.riderAssetId === null) {
      snapshot = projectFieldPuppetActorEffects([effect], snapshot, input.providers);
      continue;
    }
    let operation: FieldTransportActorOperation;
    if (effect.kind === "ride-on") {
      const rows = input.catalog.transportations.filter((row) => row.id === effect.transportationId);
      if (rows.length !== 1 || rows[0]!.typeId !== 12 || rows[0]!.fieldAssetId !== 38)
        throw new Error("Unknown source puppet transportation front asset");
      operation = { kind: "ride-on", actorId: target.id, frontAssetId: rows[0]!.fieldAssetId, skipIfSameOuter: true };
    } else operation = { kind: "ride-out", actorId: target.id, restoreRiderAsset: true };
    // Only the selected actor enters the field-character asset domain. Unrelated
    // map-object NPCs retain their own metadata and need no riding admission.
    const next = projectFieldTransportActors({ ...input, snapshot: { actors: [target], camera: null },
      assets: [metadata], operations: [operation] });
    snapshot.actors[index] = next.snapshot.actors[0]!;
    Object.assign(metadata, next.assets[0]!);
    operations.push(operation);
  }
  return { snapshot, assets, operations };
}
