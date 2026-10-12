import { ActorAnimation } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger } from "./checkpoint-validation.js";
import { fieldCameraCellToWorld, fieldCameraLayerFromLogical } from "./field-camera.js";
import type { FieldActorFactoryCandidate } from "./field-actor-factory.js";
import { projectFieldActorView, validateFieldActorView, type FieldActorViewDefinition } from "./field-actor-view.js";
import { replaceNativeFieldActorAnimation, type FieldNativeAnimationKeys } from "./field-native-appearance.js";
import { assertFieldCompositionRenderTargets, fieldCompositionTexture, validateFieldNativeComposition,
  type FieldNativeCompositionDefinition } from "./field-native-composition.js";
import type { FieldPartyActorCheckpoint } from "./field-party-actors.js";
import { fieldPuppetSemiTransparent, fieldPuppetBoundTransparentTextures, projectFieldPuppetActorEffects,
  type FieldPuppetHostActor, type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { MapPartyEntryDefinition, MapPartyEntryPlan } from "./map-party-entry.js";
import { partyActorLeaderOnMapChange, partyActorMapArea, preparePartyActors, type PartyActorCatalog, type PartyActorInstance } from "./party-actors.js";
import type { PartyAppearanceCandidate } from "./party.js";
import type { Character } from "../field/types.js";

/** Inputs are detached reads of the current owners and an already prepared
 * destination MapSetup/PointIn. This function never creates a fresh game or
 * infers a transportation, party, condition, view or player pose. */
export type SourceNativeMapInput = {
  prior: FieldActorFactoryCandidate;
  priorCheckpoint: FieldPartyActorCheckpoint;
  entry: MapPartyEntryPlan;
  definition: MapPartyEntryDefinition;
  catalog: PartyActorCatalog;
  party: PartyAppearanceCandidate;
  characters: Readonly<Record<string, Character>>;
  animationKeys: FieldNativeAnimationKeys;
  /** Trusted departed map content, required whenever a retained actor has RT
   * references. Actor tokens alone cannot authorize their source identity. */
  priorComposition?: FieldNativeCompositionDefinition;
  view: FieldActorViewDefinition;
  providers: FieldPuppetHostProviders;
};

function same(actual: unknown, expected: unknown, message: string): void {
  if (canonical(actual) !== canonical(expected)) throw new Error(message);
}

function validatePriorTextures(actor: FieldPuppetHostActor, prior: FieldNativeCompositionDefinition | undefined): void {
  if (actor.transparentTextures.first === null && actor.transparentTextures.second === null) return;
  if (!prior) throw new Error("Missing trusted departed native composition for retained textures");
  const slots = actor.layer === 9 ? ["UpperLayer", "CeilLayer"] as const
    : actor.layer === 10 ? ["CeilLayer", null] as const : [null, null] as const;
  for (const [index, token] of [actor.transparentTextures.first, actor.transparentTextures.second].entries()) {
    if (token === null) continue;
    const layer = slots[index];
    if (!layer || token !== fieldCompositionTexture(prior.contextId, layer))
      throw new Error("Unbound departed native texture slots");
    if (!prior.layers.includes(layer) && !prior.renderHost)
      throw new Error("Missing trusted global native render target for retained disabled slot");
  }
  if (!actor.viewBinding || actor.viewBinding.map !== prior.contextId || actor.viewBinding.layer !== actor.layer)
    throw new Error("Retained native textures disagree with departed material identity");
  same(actor.viewBinding.properties, projectFieldActorView(prior.view, actor.layer), "Retained native textures disagree with departed material properties");
}

/** MapSetup keeps CommonCamera's global RT objects. A persistent actor outside
 * FieldController.entityList is not reattached by ChangeViewNormal. Preserve
 * each existing reference (including null); only rebind the Web content token
 * for the same global target. A disabled target remains a reference to the
 * global object, whose cleared contents are proved by MapSetup. The current
 * renderer/codec may still reject that reference when shown or saved. */
function retainTextures(actor: FieldPuppetHostActor, prior: FieldNativeCompositionDefinition | undefined,
  providers: FieldPuppetHostProviders): FieldPuppetHostActor["transparentTextures"] {
  const destination = fieldPuppetBoundTransparentTextures(actor.layer, providers);
  const relocate = (token: string | null): string | null => {
    if (token === null) return null;
    const slot = prior && token === fieldCompositionTexture(prior.contextId, "UpperLayer") ? "UpperLayer"
      : prior && token === fieldCompositionTexture(prior.contextId, "CeilLayer") ? "CeilLayer" : undefined;
    const next = slot === "UpperLayer" ? providers.upperTexture : slot === "CeilLayer" ? providers.ceilTexture : undefined;
    if (next === null) {
      if (!providers.composition?.renderHost || !slot)
        throw new Error("Retained native render target is disabled without a trusted global target host");
      // CommonCamera's objects survive layer disablement. Do not erase the
      // reference or carry the departed map's content token into the new map.
      return fieldCompositionTexture(providers.mapRenderContext, slot);
    }
    if (next === undefined || next === "unknown") throw new Error("Unbound retained native render target");
    return next;
  };
  const value = { first: relocate(actor.transparentTextures.first), second: relocate(actor.transparentTextures.second) };
  // MapSetup has already hidden party puppets. Unplaced/hidden residents keep
  // null slots; destination layer presence alone does not perform Attach.
  if (actor.visible) same(value, destination, "Visible retained native texture slots require an unsupported destination renderer binding");
  return value;
}

/** Ordinary, positive PointIn handoff of the existing native actor instances.
 * ResetMap clears registration/callbacks, not resident transforms or playback.
 * MapSetup hides party puppets/other parties, initializes ONLY the actual player,
 * and reapplies destination material properties to the registered actor set.
 *
 * The caller must install the result on a private FieldGame and select the
 * actual player on its existing camera owner before starting the destination
 * initializer/continuation. It must publish actors, owned/event drafts, audio,
 * camera and fader atomically. This value is not an independent saved owner.
 */
export function prepareSourceNativeMap(input: SourceNativeMapInput): FieldActorFactoryCandidate {
  const { prior, priorCheckpoint, entry, definition, catalog, party, characters, animationKeys, view, providers } = input;
  validateFieldActorView(view);
  if (!prior || priorCheckpoint.kind !== "field-party-actors-v1" || entry.checkpoint.kind !== "field-party-actors-v1" ||
      catalog.formatVersion !== 1 || catalog.memberCount !== 4 || catalog.partyCount !== 3 ||
      definition.kind !== "map-party-entry" || definition.formatVersion !== 1 || definition.loopType !== 0)
    throw new Error("Unknown source native map lifecycle");
  same({ width: view.mapSize.width, height: view.mapSize.height }, { width: definition.mapRange.width, height: definition.mapRange.height },
    "Destination native map range/material size mismatch");
  if (providers.mapRenderContext !== view.contextId || !providers.applyViewProperties)
    throw new Error("Missing destination native map material provider");
  if (providers.composition !== undefined) {
    validateFieldNativeComposition(providers.composition, view);
    assertFieldCompositionRenderTargets(providers.composition);
  }
  if (input.priorComposition !== undefined) {
    validateFieldNativeComposition(input.priorComposition);
    assertFieldCompositionRenderTargets(input.priorComposition);
  }
  const before = priorCheckpoint.context, after = entry.checkpoint.context;
  if (before.companion !== null || after.companion !== null ||
      !Array.isArray(before.conditionResidents) || !Array.isArray(after.conditionResidents) ||
      before.puppets.length !== 4 || after.puppets.length !== 4 || before.multiParty.length !== 3 || after.multiParty.length !== 3 ||
      before.puppets.some((p) => p === null) || after.puppets.some((p) => p === null) ||
      before.multiParty.some((p) => p.actor === null || p.members.length) ||
      after.multiParty.some((p) => p.actor === null || p.members.length))
    throw new Error("Native map companion/party placement lifecycle is unresolved");
  if (before.currentTransport?.typeId !== 1 || after.currentTransport?.typeId !== 1 ||
      providers.transportationType !== 1 || before.camera.mapViewType !== 0 || after.camera.mapViewType !== 0)
    throw new Error("Native map handoff requires explicit ordinary walking transportation/view");
  same(after.currentTransport, before.currentTransport, "Native map transportation switch lifecycle is unresolved");
  same(after.camera.mapArea, partyActorMapArea(definition.mapRange.width, definition.mapRange.height, definition.loopType),
    "Destination native map camera range mismatch");
  same(after.conditionColliders, definition.conditionColliders, "Destination native map collider context mismatch");
  same(after.puppets, before.puppets, "MapSetup does not refresh party puppet media");
  same(after.multiParty, before.multiParty, "MapSetup does not recreate other-party actors");
  same(after.conditionResidents, before.conditionResidents, "MapSetup does not recreate resident actors");
  same(entry.ownedConditionChanges, [], "Unsupported native map owned condition changes");
  if (after.player.id !== before.player.id) throw new Error("MapSetup cannot replace the actual player identity");
  const bindings = prior.bindings;
  if (bindings.player !== before.player.id) throw new Error("Unbound actual player identity");
  same(bindings.partyPuppets, before.puppets.map((p) => p!.id), "Unbound native party puppet identities");
  same(bindings.otherParties, before.multiParty.map((p) => p.actor!.id), "Unbound native other-party identities");
  same(bindings.residents.map((r) => r.assetId), before.conditionResidents.map((r) => r.characterId),
    "Unbound native resident identities");
  const ids = [bindings.player, ...bindings.partyPuppets, ...bindings.otherParties, ...bindings.residents.map((r) => r.actor)];
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length ||
      !Array.isArray(prior.assets) || prior.assets.length !== ids.length || prior.snapshot.actors.length !== ids.length)
    throw new Error("Native map actor set contains missing, duplicate or unsupported map-local actors");
  const metadata = new Map(prior.assets.map((row) => [row.id, row]));
  if (metadata.size !== ids.length || ids.some((id) => !metadata.has(id)))
    throw new Error("Unbound native map actor asset metadata");
  const expected = new Map<string, number | null>();
  const add = (actor: PartyActorInstance) => {
    if (actor.riding || actor.riderFieldAssetId !== null)
      throw new Error("Native map riding instance/cache lifecycle is unresolved");
    expected.set(actor.id, actor.fieldAssetId);
  };
  [before.player, ...before.puppets, ...before.multiParty.map((p) => p.actor)].forEach((actor) => {
    if (!actor) throw new Error("Missing source native map instance");
    add(actor);
  });
  if (after.player.riding || after.player.riderFieldAssetId !== null)
    throw new Error("Native map riding instance/cache lifecycle is unresolved");
  for (const [index, resident] of before.conditionResidents.entries()) expected.set(bindings.residents[index]!.actor, resident.fieldAssetId);
  same(entry.hiddenActorIds, [...bindings.partyPuppets, ...bindings.otherParties], "Unbound native map hidden actor set");
  const point = entry.player;
  if (point.mount !== "" || typeof point.visible !== "boolean" || !definition.pointIns.some((p) =>
    p.linkObject === 0 && p.x === point.x && p.y === point.y && p.layer === point.layer && p.direction === point.direction))
    throw new Error("Native map player pose is not a supported source PointIn");
  same(entry.movement, { start: { x: point.x, y: point.y }, destination: { x: point.x, y: point.y },
    elapsed: 0, autoMove: false, cacheActiveEnable: 0, cacheActiveFlag: 0 }, "Unknown native map player movement initialization");
  const targetAsset = after.player.fieldAssetId === null ? null : catalog.assets[after.player.fieldAssetId];
  if (!targetAsset || targetAsset.asset !== point.asset || entry.checkpoint.playerAssetCacheId !== targetAsset.id)
    throw new Error("Unbound destination native player asset/cache");
  // This clone also validates every presentation field and every identity,
  // including residents hidden off-map. No changes reach the departed owner.
  const snapshot = projectFieldPuppetActorEffects([], prior.snapshot, providers);
  for (const actor of snapshot.actors) {
    const row = metadata.get(actor.id);
    if (!row || !expected.has(actor.id) || row.fieldAssetId !== expected.get(actor.id))
      throw new Error("Native map actor metadata disagrees with appearance owner");
    if (!actor.character || actor.childEntityObject !== "absent" || actor.moving || actor.riding || actor.riderAssetId !== null ||
        !["absent", "idle"].includes(actor.rideOnEntity))
      throw new Error("Active movement, riding or child native map lifecycle is unresolved");
    if (!Number.isFinite(row.charaZOffset) || Math.fround(row.charaZOffset) !== row.charaZOffset ||
        [actor.position.x, actor.position.y, actor.position.z].some((n) => !Number.isFinite(Math.fround(n)) || Math.fround(n) !== n))
      throw new Error("Native map transform must retain finite float32 values");
    checkpointInteger(actor.layer, 0, 31);
    if (!actor.bodyOpaque) throw new Error("Native map transparent body lifecycle is unresolved");
    validatePriorTextures(actor, input.priorComposition);
    if (row.fieldAssetId === null) {
      if (actor.animation !== null) throw new Error("Unbound native map actor playback");
    } else {
      const asset = catalog.assets[row.fieldAssetId], media = asset && characters[asset.asset];
      if (!asset || !media || !actor.animation || ![0, 1].includes(asset.shadowType))
        throw new Error("Missing native map media or custom shadow provider");
      same(actor.animation.character, media, "Native map actor media identity changed");
      // A corrupt playback cannot survive a handoff just because the sprite is
      // currently hidden. Restore checks the complete animation chain.
      const checked = new ActorAnimation(media); checked.restore(actor.animation.snapshot());
      actor.animation = checked;
    }
  }
  const player = snapshot.actors.find((a) => a.id === bindings.player)!;
  if (point.visible !== player.visible) throw new Error("PointIn must retain actual player visibility");
  const media = characters[targetAsset.asset];
  if (!media || ![0, 1].includes(targetAsset.shadowType)) throw new Error("Missing destination player media/shadow provider");
  if (animationKeys?.kind !== "native-field-animation-keys-v1") throw new Error("Missing native map source animation keys");
  const refreshContext = structuredClone(before);
  refreshContext.leaderIndex = partyActorLeaderOnMapChange(refreshContext.leaderIndex, party.activeMembers);
  refreshContext.camera = structuredClone(after.camera);
  refreshContext.conditionColliders = structuredClone(after.conditionColliders);
  const appearance = preparePartyActors(catalog, party.activeMembers, refreshContext, true);
  const replacements = appearance.changes.filter((change) => change.actorId === player.id);
  if (replacements.length < 1 || replacements.length > 2 || replacements[0]!.reason !== "leader" ||
      replacements.some((change, index) => change.mode !== "replace" || index === 1 && change.reason !== "condition") ||
      replacements.at(-1)!.asset.id !== targetAsset.id || appearance.playerAssetCache?.id !== targetAsset.id ||
      appearance.savedLeaderIndex !== after.leaderIndex)
    throw new Error("Native map owned party/ordered player replacement mismatch");
  const replacePlayer = (assetId: number) => {
    const asset = catalog.assets[assetId], character = asset && characters[asset.asset], keys = asset && animationKeys.assets[asset.asset];
    if (!character || !keys || !/^[a-f0-9]{64}$/.test(keys.contentHash) || canonical(keys.source) !== canonical(character.source))
      throw new Error("Unbound native map source animation keys/media");
    player.animation = replaceNativeFieldActorAnimation(player.animation, character, player.direction, keys.keys);
  };
  // ClearSprite only clears the old sprite dictionary. Each SetAssetStructure
  // preserves its current key/time/play via OverrideOldData, including the
  // intermediate base assignment before a condition appearance assignment.
  for (const change of replacements) replacePlayer(change.asset.id);
  // PointIn LookAt(changeAnimDefault=true) leaves a same-key playing animation
  // running; true is not a force-reset flag.
  player.animation!.look(point.direction);
  player.direction = point.direction;
  // MapViewSetup's walking SetupCharaAsset installs the current cache again
  // after PointIn. Do not collapse this ordered replacement into the first one.
  replacePlayer(targetAsset.id);
  if (!media.animations.Default || media.animations.Default.mode === 1)
    throw new Error("Native map transportation automatic playback is unresolved");
  // PointIn is in package cell coordinates; ConversionMapRangeCell subtracts
  // the map range's origin before CellToWorld centres the destination map.
  player.position = fieldCameraCellToWorld(definition.mapRange,
    { x: point.x - definition.mapRange.x, y: point.y - definition.mapRange.y }, point.layer);
  player.layer = fieldCameraLayerFromLogical(point.layer).layer;
  player.shadowVisible = targetAsset.shadowType === 1;
  if (fieldPuppetSemiTransparent(providers.transportationType, providers.footAttribute({ ...player.position })))
    throw new Error("Destination native map body transparency is unresolved");
  player.transparentTextures = fieldPuppetBoundTransparentTextures(player.layer, providers);
  for (const actor of snapshot.actors) {
    if (entry.hiddenActorIds.includes(actor.id)) { actor.visible = false; actor.fadeAlpha = 0; }
    if (actor.id !== bindings.player) actor.transparentTextures = retainTextures(actor, input.priorComposition, providers);
    const properties = projectFieldActorView(view, actor.layer);
    same(providers.applyViewProperties(actor.layer), properties, "Destination native map material provider disagrees with source");
    // Native ApplyCustomProperties returns outside layers 9..12. Keep the old
    // binding for an unplaced actor instead of inventing a destination layer.
    if (properties !== null) actor.viewBinding = { map: view.contextId, layer: actor.layer, properties };
  }
  const assets = prior.assets.map((row) => row.id === bindings.player
    ? { ...row, fieldAssetId: targetAsset.id, charaZOffset: 0.5 } : { ...row });
  return { snapshot, bindings: structuredClone(bindings), assets };
}
