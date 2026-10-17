import { canonical } from "./canonical.js";
import { validateFieldEffectBoard, type FieldEffectBoardDefinition } from "./field-effects.js";
import type { Evidence, FieldContent, FieldEntity } from "../field/types.js";

type SourceMapRef = { file: string; assetPath: string; objectId: string; serializedFile: string; sha256: string };
export type FieldPassiveEffectBinding = {
  group: string;
  /** The complete source entity, including its unchanged effect definition. */
  entity: FieldEntity;
  /** Exact referring Tiled object/property records, retained for passive proof. */
  rawSource: Record<string, unknown>;
};
export type FieldPassiveEffectsHost = {
  kind: "framework-passive-field-effects-host-v1";
  policy: "framework-passive-field-effects-v1";
  deferral: "omit-particle-render-and-effect-minimap-v1";
  /** UNDERIVED source WorldMapContent.contentHash, never this derived hash. */
  sourceMapHash: string;
  sourceSetHash: string;
  parentSourceSetHash: string;
  mapId: number;
  sourceMapRef: SourceMapRef;
  bindings: FieldPassiveEffectBinding[];
  limitations: string[];
  nativeRulesVerified: false;
};
export const PASSIVE_FIELD_EFFECTS_LIMITATIONS = Object.freeze([
  "Particle rendering and effect minimap display are explicitly deferred in this Web variant.",
  "Source entities, raw properties, definitions and particle/minimap diagnostics remain intact.",
  "No live effect, particle, random stream, camera or minimap state is allocated for these passive objects.",
  "Anonymous source EntityId 0 is not an effect actor selector; source GetEntity(0) addresses the camera.",
  "Unity particle/minimap behavior and original-game visual acceptance remain unverified.",
]);

type Row = Record<string, unknown>;
const entityKeys = "id,objectId,kind,layer,x,y,width,height,direction,asset,script,collision,destinationLayer,source,effect";
const effectKeys = "kind,assetId,assetGroup,assetName,pixelPosition,pixelSize,playOnAwake,front,split,zOffset,affected,blendType,zTest,collision,building,birdviewPuppet,screen,visibleMinimap,source";
const propertyTypes = {
  action_id: "int", affected: "bool", asset_id: "int", birdview_puppet: "bool", blend_type: "int", collision: "bool",
  direction: "int", entity_id: "int", flight_altitude_ratio: "float", front: "bool", ignore_depth_test: "bool",
  link_object_id: "int", object_id: "int", object_type: "int", play_on_awake: "bool", script_id: "int",
  split: "bool", visible_minimap: "bool", zoffset: "int",
} as const;

function row(value: unknown, keys: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error("Invalid passive field effect record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string") ||
      Object.keys(descriptors).sort().join(",") !== keys.split(",").sort().join(",") ||
      Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    throw new Error("Unknown passive field effect fields");
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value)
    throw new Error("Missing passive field effect identity");
  return value;
}
function integer(value: unknown, min = -0x80000000, max = 0x7fffffff): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid passive field effect source integer");
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid passive effect source hash");
  return value;
}
function source(value: unknown, pointer = false): SourceMapRef & Evidence {
  const r = row(value, "file,assetPath,objectId,serializedFile,sha256" + (pointer ? ",pointer" : "")), objectId = text(r.objectId);
  if (!/^-?\d+$/.test(objectId)) throw new Error("Invalid passive effect source path ID");
  const result = { file: text(r.file), assetPath: text(r.assetPath), objectId,
    serializedFile: text(r.serializedFile), sha256: digest(r.sha256) };
  if (!pointer) return result;
  const path = text(r.pointer);
  if (!/^\/layers\/\d+\/objects\/\d+$/.test(path)) throw new Error("Invalid passive effect source pointer");
  return { ...result, pointer: path };
}
function properties(value: unknown): Row {
  if (!Array.isArray(value) || value.length !== Object.keys(propertyTypes).length)
    throw new Error("Unknown passive field effect properties");
  const result: Row = {};
  for (const item of value) {
    const r = row(item, "name,type,value"), name = text(r.name);
    if (!Object.hasOwn(propertyTypes, name) || Object.hasOwn(result, name) ||
        r.type !== propertyTypes[name as keyof typeof propertyTypes])
      throw new Error("Unknown or duplicate passive effect property");
    if (r.type === "int") integer(r.value);
    else if (r.type === "bool" ? typeof r.value !== "boolean" : typeof r.value !== "number" || !Number.isFinite(r.value))
      throw new Error("Invalid passive field effect property value");
    result[name] = r.value;
  }
  return result;
}

function binding(value: unknown): FieldPassiveEffectBinding {
  const b = row(value, "group,entity,rawSource"), group = text(b.group), e = row(b.entity, entityKeys),
    raw = row(b.rawSource, "id,name,type,gid,x,y,width,height,rotation,visible,properties"), p = properties(raw.properties),
    fx = row(e.effect, effectKeys), ref = source(e.source, true), effectRef = source(fx.source, true),
    pixelPosition = row(fx.pixelPosition, "x,y"), pixelSize = row(fx.pixelSize, "width,height");
  if (group !== "entity_default" || e.kind !== 11 || e.objectId !== 0 || p.object_type !== 11 || p.entity_id !== 0 || p.object_id !== 0 ||
      e.script !== null || e.asset !== null || e.collision !== null || e.destinationLayer !== null || e.direction !== "down" ||
      p.script_id !== 0 || p.action_id !== 0 || p.link_object_id !== 0 || p.direction !== 0 || p.flight_altitude_ratio !== 1 ||
      p.collision !== false || p.birdview_puppet !== false || p.blend_type !== 0 ||
      fx.kind !== "source-field-effect-board-v1" || fx.assetName !== "Prefabs/EffectPrefab" ||
      fx.collision !== false || fx.building !== false || fx.screen !== false || fx.birdviewPuppet !== false || fx.blendType !== 0 ||
      raw.type !== "" || raw.rotation !== 0 || raw.visible !== true)
    throw new Error("Source effect is not a proved passive anonymous default object");
  integer(raw.id, 1); integer(raw.gid, 1, 0x0fffffff); text(raw.name);
  integer(raw.x); integer(raw.y); integer(raw.width, 1); integer(raw.height, 1); integer(e.layer, 0, 3);
  const pointer = /^\/layers\/(\d+)\/objects\/(\d+)$/.exec(ref.pointer!)!;
  if (e.id !== `${group}:${pointer[1]}:${pointer[2]}` || canonical(ref) !== canonical(effectRef) ||
      e.x !== (raw.x as number) / 16 || e.y !== ((raw.y as number) - (raw.height as number)) / 16 ||
      e.width !== (raw.width as number) / 16 || e.height !== (raw.height as number) / 16 ||
      pixelPosition.x !== raw.x || pixelPosition.y !== raw.y || pixelSize.width !== raw.width || pixelSize.height !== raw.height ||
      fx.assetId !== p.asset_id || fx.playOnAwake !== p.play_on_awake || fx.front !== p.front || fx.split !== p.split ||
      fx.affected !== p.affected || fx.visibleMinimap !== p.visible_minimap || fx.zTest !== (p.ignore_depth_test ? 8 : 4) ||
      fx.zOffset !== (p.front && (p.zoffset as number) < 0 ? 2 : p.zoffset))
    throw new Error("Passive effect binding changed its raw source entity or definition");
  const effect = structuredClone(b.entity) as FieldEntity;
  validateFieldEffectBoard(effect.effect!);
  if (text(fx.assetGroup) !== (fx.assetGroup as string).toLowerCase()) throw new Error("Invalid passive effect asset group");
  return { group, entity: effect, rawSource: structuredClone(b.rawSource) as Row };
}

export function parseFieldPassiveEffectsHost(raw: unknown): FieldPassiveEffectsHost {
  const h = row(raw, "kind,policy,deferral,sourceMapHash,sourceSetHash,parentSourceSetHash,mapId,sourceMapRef,bindings,limitations,nativeRulesVerified");
  if (h.kind !== "framework-passive-field-effects-host-v1" || h.policy !== "framework-passive-field-effects-v1" ||
      h.deferral !== "omit-particle-render-and-effect-minimap-v1" || h.nativeRulesVerified !== false ||
      !Array.isArray(h.bindings) || !h.bindings.length || canonical(h.limitations) !== canonical(PASSIVE_FIELD_EFFECTS_LIMITATIONS))
    throw new Error("Unsupported passive field effects deferral declaration");
  const bindings = h.bindings.map(binding);
  if (new Set(bindings.map(b => b.entity.id)).size !== bindings.length ||
      new Set(bindings.map(b => canonical(b.entity.source))).size !== bindings.length)
    throw new Error("Duplicate passive field effect binding");
  return { kind: h.kind, policy: h.policy, deferral: h.deferral, sourceMapHash: digest(h.sourceMapHash),
    sourceSetHash: digest(h.sourceSetHash), parentSourceSetHash: digest(h.parentSourceSetHash), mapId: integer(h.mapId, 1),
    sourceMapRef: source(h.sourceMapRef), bindings, limitations: [...PASSIVE_FIELD_EFFECTS_LIMITATIONS], nativeRulesVerified: false };
}

type PassiveContent = Pick<FieldContent, "map" | "sourceSetHash" | "parentSourceSetHash"> & {
  frameworkPassiveEffects?: FieldPassiveEffectsHost;
  developmentProfile?: { kind: "framework-development-v1"; sourceContentHash: string; passiveEffects?: string };
};
/** Returned IDs only exclude declared passive objects from live FX allocation.
 * They grant no source actor selector, state codec, renderer or RNG capability. */
export function bindPassiveEffects(content: PassiveContent): Set<string> {
  const result = new Set<string>();
  if (!content.frameworkPassiveEffects) return result;
  const h = parseFieldPassiveEffectsHost(content.frameworkPassiveEffects), profile = content.developmentProfile;
  if (profile?.kind !== "framework-development-v1" || profile.passiveEffects !== h.policy || profile.sourceContentHash !== h.sourceMapHash ||
      h.sourceSetHash !== content.sourceSetHash || h.parentSourceSetHash !== content.parentSourceSetHash ||
      h.mapId !== content.map.identity?.mapId || canonical(h.sourceMapRef) !== canonical(content.map.source) || !content.map.groups)
    throw new Error("Unbound passive field effects content host");
  for (const b of h.bindings) {
    const matches = content.map.groups[b.group]?.entities.filter(e => e.id === b.entity.id) ?? [];
    if (matches.length !== 1 || canonical(matches[0]) !== canonical(b.entity))
      throw new Error("Passive effect declaration changed its source entity");
    result.add(b.entity.id);
  }
  return result;
}

function deferredBlocker(reason: string, effect: FieldEffectBoardDefinition): boolean {
  return effect.visibleMinimap && reason === "Field effect minimap provider is unavailable" ||
    reason === `Field effect particle provider unavailable: ${effect.assetGroup} (serialized particle/material admission required)`;
}
/** Keep all source arrays. Only exact known display diagnostics at the matched
 * passive source object receive this explicitly scoped Web deferral. */
export function passiveEffectsGroupBlockers(group: NonNullable<FieldContent["map"]["groups"]>[string],
  host?: FieldPassiveEffectsHost): typeof group.blockers {
  if (!host) return group.blockers;
  const h = parseFieldPassiveEffectsHost(host);
  return group.blockers.filter(blocker => {
    const matches = h.bindings.filter(b => b.group === group.name && canonical(b.entity.source) === canonical(blocker.source));
    if (matches.length !== 1) return true;
    const b = matches[0]!;
    return !deferredBlocker(blocker.reason, b.entity.effect!) ||
      !group.entities.some(entity => entity.id === b.entity.id && canonical(entity) === canonical(b.entity));
  });
}
