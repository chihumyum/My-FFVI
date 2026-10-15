import type { SourceScriptAnimationCatalog } from "./source-script-animations.js";
import type { FieldNativeAnimationKeys } from "./field-native-appearance.js";
import { validateFieldMapAnimation, WEB_FIELD_MAP_ANIMATION, type FieldMapAnimationDefinition } from "./field-map-animation.js";
import { ActorAnimation, type ActorPlayback } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys, checkpointNumber, checkpointSameIds } from "./checkpoint-validation.js";
import { validateFieldActorFactory, type FieldActorFactoryBindings, type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import { validateFieldActorViewProjection } from "./field-actor-view.js";
import { fieldCameraCellToWorld, type FieldCameraMapRange } from "./field-camera.js";
import type { FieldPartyActorCheckpoint } from "./field-party-actors.js";
import { createNativeFieldActorProjection, type NativeFieldActor, type NativeFieldActorData } from "./field-native-actors.js";
import type { FieldActorMotion } from "./field-script-motion.js";
import { sourceNpcSecondsPerCell } from "./field-npc-activity.js";
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
export type FieldNativeAutonomousMotionBinding = {
  definitionHash: string;
  /** NPC MoveSpeed enum, deliberately separate from Puppet Move speedId. */
  sourceSpeedEnum: number;
  commandId: number;
  /** Derived from the trusted activity program; ordinary NPC magnification is 1. */
  secondsPerCell: number;
};
export type FieldNativeAssignedMotionBinding = { kind: 'assigned-npc-route-grid-v1'; definitionHash: string; commandId: number; secondsPerCell: number; logicalLayer: number; preserveDirection: boolean };
type MotionBinding = FieldNativeAutonomousMotionBinding | FieldNativeAssignedMotionBinding;
export type FieldNativeActorMotionCheckpoint = FieldNativeActorCheckpoint & {
  motion: { definitionHash: string; commandId: number; state: FieldActorMotion };
};
export type FieldNativeCheckpoint = {
  kind: "native-field-actors-checkpoint-v1";
  actors: FieldNativeActorCheckpoint[];
} | {
  kind: "native-field-actors-checkpoint-v2";
  /** Idle rows keep their exact v1 shape; only authorized moving NPCs add the
   * existing Actor.motion register and its correlation with controller state. */
  actors: (FieldNativeActorCheckpoint | FieldNativeActorMotionCheckpoint)[];
};
export type FieldNativeCheckpointOwner = Readonly<Record<string, {
  readonly id: string;
  readonly native?: NativeFieldActorData;
  readonly motion: FieldActorMotion | null;
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
  sourceScriptAnimations?: SourceScriptAnimationCatalog;
  animationKeys?: FieldNativeAnimationKeys;
  npcs: readonly FieldNativeNpcDefinition[];
  animated?: readonly FieldMapAnimationDefinition[];
  animatedPolicy?: typeof WEB_FIELD_MAP_ANIMATION;
  providers: FieldPuppetHostProviders;
  /** Rebuilt from trusted activity/program/pending state, never saved actor
   * rows. The Field host checks exact instance/epoch, active group, policy and
   * program speed, and rejects event-held leases before preparing this map.
   * Only currently pending autonomous commands belong here; idle grants fail. */
  autonomousMotions?: Readonly<Record<string, FieldNativeAutonomousMotionBinding>>;
  assignedMotions?: Readonly<Record<string, FieldNativeAssignedMotionBinding>>;
  transportationPresentation?: FieldTransportActorPresentation;
  /** A retained off-map instance may still reference a previous map material.
   * Without that trusted definition the checkpoint is explicitly unavailable. */
  resolveRetainedView?(contextId: string): FieldPuppetHostProviders | null;
};

type BoundActor = {
  id: string;
  character: boolean;
  metadata: Omit<NativeFieldActorData, "entity">;
  media: Character | null;
  mediaName: string | null;
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
function dataRecord(raw: unknown, fields?: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid autonomous motion checkpoint record");
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(raw), expected = fields?.split(",");
  if (keys.some(key => typeof key !== "string") ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable) ||
      expected && (keys.length !== expected.length || expected.some(key => !Object.hasOwn(descriptors, key))))
    throw new Error("Invalid autonomous motion checkpoint fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function autonomousBindings(context: FieldNativeCheckpointContext, expected: readonly BoundActor[]):
  Map<string, MotionBinding> {
  const result = new Map<string, MotionBinding>();
  const byId = new Map(expected.map(actor => [actor.id, actor]));
  for (const [id, raw] of Object.entries(dataRecord(context.autonomousMotions ?? {}))) {
    const bound = byId.get(id), value = dataRecord(raw, "definitionHash,sourceSpeedEnum,commandId,secondsPerCell");
    if (bound?.metadata.scope?.kind !== "map-npc" || bound.metadata.scope.entityId !== id)
      throw new Error("Autonomous motion requires a trusted map NPC scope");
    if (typeof value.definitionHash !== "string" || !/^[a-f0-9]{64}$/.test(value.definitionHash))
      throw new Error("Invalid autonomous motion definition binding");
    checkpointInteger(value.commandId as number, 1);
    checkpointInteger(value.sourceSpeedEnum as number, 0, 8);
    checkpointNumber(value.secondsPerCell as number, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER / 1000);
    if (value.secondsPerCell !== sourceNpcSecondsPerCell(value.sourceSpeedEnum as Parameters<typeof sourceNpcSecondsPerCell>[0]))
      throw new Error("Autonomous motion timing differs from its trusted source NPC speed enum");
    result.set(id, { definitionHash: value.definitionHash, commandId: value.commandId as number,
      sourceSpeedEnum: value.sourceSpeedEnum as number, secondsPerCell: value.secondsPerCell as number });
  }
  for (const [id, raw] of Object.entries(dataRecord(context.assignedMotions ?? {}))) {
    const bound=byId.get(id),v=dataRecord(raw,'kind,definitionHash,commandId,secondsPerCell,logicalLayer,preserveDirection');
    if(result.has(id)||bound?.metadata.scope?.kind!=='map-npc'||v.kind!=='assigned-npc-route-grid-v1'||typeof v.definitionHash!=='string'||!/^[a-f0-9]{64}$/.test(v.definitionHash)||typeof v.preserveDirection!=='boolean')throw new Error('Invalid assigned route native motion binding');
    checkpointInteger(v.commandId as number,1);checkpointInteger(v.logicalLayer as number,0,2);
    if(![.24,.48,.12,.96,.06,1.92,.16].includes(v.secondsPerCell as number))throw new Error('Unknown assigned route movement speed');
    result.set(id,{kind:'assigned-npc-route-grid-v1',definitionHash:v.definitionHash,commandId:v.commandId as number,secondsPerCell:v.secondsPerCell as number,logicalLayer:v.logicalLayer as number,preserveDirection:v.preserveDirection});
  }
  return result;
}
function autonomousMotion(raw: unknown, binding: MotionBinding,
  row: FieldNativeActorCheckpoint, context: FieldNativeCheckpointContext): FieldNativeActorMotionCheckpoint["motion"] {
  const value = dataRecord(raw, "definitionHash,commandId,state");
  if (value.definitionHash !== binding.definitionHash || value.commandId !== binding.commandId)
    throw new Error("Autonomous motion command binding changed");
  const state = dataRecord(value.state, "from,to,elapsed,duration,manual"),
    from = dataRecord(state.from, "x,y"), to = dataRecord(state.to, "x,y");
  for (const point of [from, to]) for (const coordinate of Object.values(point)) {
    float32(coordinate as number, "motion coordinate");
    checkpointInteger(coordinate as number, -0x80000000, 0x7fffffff);
  }
  const dx = (to.x as number) - (from.x as number), dy = (to.y as number) - (from.y as number);
  if (state.manual !== false || Math.abs(dx) + Math.abs(dy) !== 1 || dx !== 0 && dy !== 0)
    throw new Error("Autonomous motion must be one cardinal non-manual cell");
  const direction: Direction = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
  const duration = binding.secondsPerCell * 1000;
  if (typeof state.duration !== "number" || state.duration !== duration)
    throw new Error("Autonomous motion duration does not match the trusted NPC speed");
  checkpointInteger(state.elapsed as number);
  if ((state.elapsed as number) % 10 !== 0 || (state.elapsed as number) >= duration)
    throw new Error("Autonomous motion elapsed is not a pending field clock");
  const npc = context.npcs.find(npc => npc.entityId === row.id);
  const positionFields = dataRecord(row.position, "x,y,z");
  const assigned='kind' in binding,logicalLayer=assigned?binding.logicalLayer:npc?.geometry.layer;
  if (!npc || row.layer !== logicalLayer! + 9 || positionFields.z !== f(349 - logicalLayer! * 100) ||
      (!assigned || !binding.preserveDirection) && row.direction !== direction)
    throw new Error("Autonomous motion pose does not match its trusted NPC layer/direction");
  const ratio = (state.elapsed as number) / duration;
  const point = { x: (from.x as number) + dx * ratio, y: (from.y as number) + dy * ratio };
  // Same float32 transform as the unique native Actor.x/y accessors. These
  // runtime coordinates corroborate the retained motion; they are no new owner.
  const position = fieldCameraCellToWorld(context.mapRange, { x: f(f(point.x) - context.mapRange.x),
    y: f(f(point.y) - context.mapRange.y) }, 0);
  if (positionFields.x !== position.x || positionFields.y !== position.y)
    throw new Error("Autonomous motion position does not match its elapsed projection");
  return { definitionHash: binding.definitionHash, commandId: binding.commandId,
    state: { from: { x: from.x as number, y: from.y as number }, to: { x: to.x as number, y: to.y as number },
      elapsed: state.elapsed as number, duration, manual: false } };
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
    result.push({ id, character: metadata.scope?.kind !== "map-animated", metadata, media, mediaName, childEntityObject: prefab.childEntityObject,
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
  if (context.animated?.length && context.animatedPolicy !== WEB_FIELD_MAP_ANIMATION)
    throw new Error("Animated checkpoint lacks trusted Web profile");
  for (const d of context.animated ?? []) {
    validateFieldMapAnimation(d);
    add(d.entityId, { fieldAssetId: null, charaZOffset: 0, updateAttribute: 2,
      mapObjectAsset: { id: d.asset.id, asset: d.asset.asset, source: structuredClone(d.asset.source) },
      mapAnimation: structuredClone(d),
      scope: { kind: "map-animated", group: d.group, entityId: d.entityId, source: structuredClone(d.source) } },
      d.asset.asset, context.factory.npcPrefab);
  }
  return result;
}

function material(row: FieldNativeActorCheckpoint, context: FieldNativeCheckpointContext, expected: BoundActor): FieldPuppetHostActor["viewBinding"] {
  if (expected.metadata.scope?.kind === "map-animated") {
    checkpointKeys(row.transparentTextures, "first,second");
    if (row.view !== null || row.transparentTextures.first !== null || row.transparentTextures.second !== null)
      throw new Error("Web animated map entity cannot grant native shader bindings");
    return null;
  }
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

function restoreActor(row: FieldNativeActorCheckpoint | FieldNativeActorMotionCheckpoint, expected: BoundActor,
  context: FieldNativeCheckpointContext, binding?: MotionBinding): NativeFieldActor {
  checkpointKeys(row, "id,position,layer,direction,animation,visible,fadeAlpha,bodyOpaque,shadowVisible,steps,view,transparentTextures" +
    (binding === undefined ? "" : ",motion"));
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
  const motion = binding === undefined ? null
    : autonomousMotion((row as FieldNativeActorMotionCheckpoint).motion, binding, row, context).state;
  const animation = expected.media && new ActorAnimation(expected.media);
  if (animation) {
    const keys=expected.mediaName===null?undefined:context.animationKeys?.assets[expected.mediaName];
    if(row.animation?.sourceCustomCache&&(!expected.character||expected.riding||!keys||!context.sourceScriptAnimations))
      throw new Error("Saved custom animation requires the actual ordinary actor namespace/media authority");
    animation.restore(row.animation,keys&&context.sourceScriptAnimations?{catalog:context.sourceScriptAnimations,baseKeys:keys.keys}:undefined);
    if (row.animation !== null) animation.frame();
  }
  const entity: FieldPuppetHostActor = { id: expected.id, character: expected.character, position: { ...row.position }, layer: row.layer,
    direction: row.direction, animation, visible: row.visible, fadeAlpha: row.fadeAlpha,
    bodyOpaque: row.bodyOpaque, shadowVisible: row.shadowVisible, moving: false, riding: expected.riding, riderAssetId: expected.riderAssetId,
    childEntityObject: expected.childEntityObject, rideOnEntity: expected.rideOnEntity,
    viewBinding: material(row, context, expected), transparentTextures: { ...row.transparentTextures } };
  const actor = createNativeFieldActorProjection({ ...structuredClone(expected.metadata), entity }, context.mapRange, context.partyCatalog,
    context.transportationPresentation);
  actor.steps = row.steps;
  actor.motion = motion;
  return actor;
}

/** Pure restore: every actor is private until the outer field publishes the
 * complete candidate. No lifecycle, Look/Cue, controller init or source script
 * is replayed. Camera and all other owners are deliberately absent here. */
export function restoreFieldNativeCheckpoint(raw: FieldNativeCheckpoint, context: FieldNativeCheckpointContext): NativeFieldActor[] {
  const expected = expectedActors(context), bindings = autonomousBindings(context, expected);
  const fields = dataRecord(raw, "kind,actors");
  if (fields.kind === "native-field-actors-checkpoint-v2") {
    if (!Array.isArray(fields.actors) || fields.actors.length !== expected.length)
      throw new Error("Invalid autonomous motion checkpoint actors");
    const descriptors = Object.getOwnPropertyDescriptors(fields.actors);
    if (Reflect.ownKeys(fields.actors).length !== expected.length + 1)
      throw new Error("Invalid autonomous motion checkpoint actor fields");
    for (let index = 0; index < expected.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new Error("Invalid autonomous motion checkpoint actor fields");
      const row = descriptor.value;
      const actor = dataRecord(row);
      if (Object.hasOwn(actor, "motion")) {
        const binding = bindings.get(actor.id as string);
        if (!binding) throw new Error("Unbound autonomous motion checkpoint");
        // Inspect new fields before clone; saved accessors cannot impersonate
        // controller authority or trigger reads while preparing a candidate.
        autonomousMotion(actor.motion, binding, actor as unknown as FieldNativeActorMotionCheckpoint, context);
      }
    }
  }
  const saved = structuredClone(raw);
  checkpointKeys(saved, "kind,actors");
  if ((saved.kind !== "native-field-actors-checkpoint-v1" && saved.kind !== "native-field-actors-checkpoint-v2") || !Array.isArray(saved.actors))
    throw new Error("Unknown native field actor checkpoint");
  if ((saved.kind === "native-field-actors-checkpoint-v2") !== (bindings.size > 0))
    throw new Error("Autonomous motion checkpoint authorization changed");
  checkpointSameIds(saved.actors.map((a) => a?.id), expected.map((a) => a.id));
  const byId = new Map(saved.actors.map((a) => [a.id, a]));
  return expected.map((bound) => restoreActor(byId.get(bound.id)!, bound, context, bindings.get(bound.id)));
}

/** Read the unique live owner, validate all source dependencies and round-trip
 * admission before returning a detached JSON payload. Failure writes nothing. */
export function captureFieldNativeCheckpoint(owner: FieldNativeCheckpointOwner, context: FieldNativeCheckpointContext): FieldNativeCheckpoint {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) throw new Error("Missing native field actor owner");
  const expected = expectedActors(context), bindings = autonomousBindings(context, expected);
  checkpointSameIds(Object.keys(owner), expected.map((a) => a.id));
  const rows = expected.map((bound): FieldNativeActorCheckpoint | FieldNativeActorMotionCheckpoint => {
    const actor = owner[bound.id]!, native = actor.native, entity = native?.entity;
    const binding = bindings.get(bound.id);
    if (actor.id !== bound.id || !native || !entity || entity.id !== bound.id ||
        entity.moving !== (actor.motion !== null) || (actor.motion !== null) !== (binding !== undefined))
      throw new Error("Cannot checkpoint a moving, legacy or misidentified native actor");
    if (entity.character !== bound.character || entity.riding !== bound.riding || entity.riderAssetId !== bound.riderAssetId ||
        entity.childEntityObject !== bound.childEntityObject || entity.rideOnEntity !== bound.rideOnEntity)
      throw new Error("Native checkpoint actor lifecycle provider is unresolved");
    const { entity: ignored, ...metadata } = native;
    if (canonical(metadata) !== canonical(bound.metadata)) throw new Error("Native checkpoint source metadata changed");
    if ((entity.animation === null) !== (bound.media === null) || entity.animation !== null &&
        (!(entity.animation instanceof ActorAnimation) || canonical(entity.animation.character) !== canonical(bound.media)))
      throw new Error("Native checkpoint media does not match the trusted asset");
    const idleRow: FieldNativeActorCheckpoint = { id: bound.id, position: { ...entity.position }, layer: entity.layer,
      direction: entity.direction, animation: entity.animation?.snapshot() ?? null, visible: entity.visible,
      fadeAlpha: entity.fadeAlpha, bodyOpaque: entity.bodyOpaque, shadowVisible: entity.shadowVisible, steps: actor.steps,
      view: entity.viewBinding && { map: entity.viewBinding.map, layer: entity.viewBinding.layer },
      transparentTextures: { ...entity.transparentTextures } };
    const row = binding === undefined ? idleRow : { ...idleRow,
      motion: autonomousMotion({ definitionHash: binding.definitionHash, commandId: binding.commandId, state: actor.motion },
        binding, idleRow, context) };
    const recovered = restoreActor(row, bound, context, binding);
    if (canonical(recovered.native.entity.viewBinding) !== canonical(entity.viewBinding))
      throw new Error("Native checkpoint material properties are not source-bound");
    return row;
  });
  return bindings.size > 0 ? { kind: "native-field-actors-checkpoint-v2", actors: rows }
    : { kind: "native-field-actors-checkpoint-v1", actors: rows };
}
