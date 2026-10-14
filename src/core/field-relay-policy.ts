import { canonical } from "./canonical.js";
import { fieldRelayCellLimits, type FieldRelayMapArea, type FieldRelayParentContext } from "./field-relay-interaction.js";
import type { FieldContent, FieldRelayDefinition } from "../field/types.js";

/** Kept in source compilation even when an explicit Web host admits its own
 * interaction policy. Typed rectangles do not recover the Unity observer. */
export const FIELD_RELAY_SOURCE_OBSERVER_REQUIREMENT = "Unsupported entity kind 16";
export type FieldRelaySourceMapRef = {
  file: string; assetPath: string; objectId: string; serializedFile: string; sha256: string;
};
export type FieldRelayRawMapBinding = {
  mapId: number;
  sourceSetHash: string;
  parentSourceSetHash: string;
  sourceMapRef: FieldRelaySourceMapRef;
  mapRange: { x: number; y: number; width: number; height: number };
  loop: { horizontal: boolean; vertical: boolean };
};
/** Trusted content grants a scoped Web host separately from source diagnostics.
 * sourceMapHash is the UNDERIVED baseline WorldMapContent.contentHash, matching
 * DevelopmentProfile.sourceContentHash; it is not this derived package's hash.
 * Parent/geometry declarations are immutable inputs, not another actor owner. */
export type FieldRelayInteractionHost = FieldRelayRawMapBinding & {
  kind: "framework-relay-interaction-host-v1";
  policy: "framework-relay-interaction-v1";
  sourceMapHash: string;
  coordinateHost: "ordinary-field-native-positions-v1";
  scope: "walking-stationary-same-layer-known-wait-v1";
  parentContext: FieldRelayParentContext;
  bindings: FieldRelayDefinition[];
  limitations: string[];
  nativeRulesVerified: false;
};
export const FRAMEWORK_RELAY_INTERACTION_LIMITATIONS = Object.freeze([
  "Unity observer lock, transportation and moving-target eligibility are not recovered.",
  "This Web host admits stationary walking interactions with known Wait NPCs on the same native Z layer.",
  "Registered source order chooses the first co-located target, then the first front target; distance is not a priority.",
  "Relay prefab presentation and original-game dynamic behavior are not verified.",
]);

type Row = Record<string, unknown>;
function row(value: unknown, keys: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error("Invalid framework relay policy record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string") ||
      Object.keys(descriptors).sort().join(",") !== keys.split(",").sort().join(",") ||
      Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    throw new Error("Invalid framework relay policy fields");
  return value as Row;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid framework relay policy integer");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing framework relay policy identity");
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid framework relay policy source hash");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid framework relay policy loop axis");
  return value;
}
function sourceMapRef(value: unknown): FieldRelaySourceMapRef {
  const r = row(value, "file,assetPath,objectId,serializedFile,sha256"), objectId = text(r.objectId);
  if (!/^-?\d+$/.test(objectId)) throw new Error("Invalid framework relay map path ID");
  return { file: text(r.file), assetPath: text(r.assetPath), objectId,
    serializedFile: text(r.serializedFile), sha256: digest(r.sha256) };
}
function rawMapBinding(r: Row): FieldRelayRawMapBinding {
  const range = row(r.mapRange, "x,y,width,height"), loop = row(r.loop, "horizontal,vertical");
  return {
    mapId: integer(r.mapId, 1, 0x7fffffff), sourceSetHash: digest(r.sourceSetHash),
    parentSourceSetHash: digest(r.parentSourceSetHash), sourceMapRef: sourceMapRef(r.sourceMapRef),
    mapRange: { x: integer(range.x, -0x80000000, 0x7fffffff), y: integer(range.y, -0x80000000, 0x7fffffff),
      width: integer(range.width, 1, 0x7ffffff), height: integer(range.height, 1, 0x7ffffff) },
    loop: { horizontal: bool(loop.horizontal), vertical: bool(loop.vertical) },
  };
}
function identityParent(value: unknown): FieldRelayParentContext {
  const r = row(value, "translation,rotation,scale"), vector = (value: unknown, expected: number) => {
    const v = row(value, "x,y,z");
    if (v.x !== expected || v.y !== expected || v.z !== expected)
      throw new Error("Framework relay coordinate host requires an explicit identity parent");
    return { x: expected, y: expected, z: expected };
  };
  return { translation: vector(r.translation, 0), rotation: vector(r.rotation, 0), scale: vector(r.scale, 1) };
}

function definition(value: unknown): FieldRelayDefinition {
  const r = row(value, "kind,group,entityId,sourceEntityId,objectId,editorObjectId,layer,rawGeometry,editorGid,horizontalCellLimit,verticalCellLimit,source"),
    geometry = row(r.rawGeometry, "x,y,width,height"), s = row(r.source, "file,assetPath,objectId,serializedFile,sha256,pointer");
  if (r.kind !== "source-field-relay-v1") throw new Error("Unsupported source relay binding");
  const pointer = text(s.pointer), indices = /^\/layers\/(\d+)\/objects\/(\d+)$/.exec(pointer);
  if (!indices) throw new Error("Invalid source relay pointer");
  const { pointer: _pointer, ...source } = s, group = text(r.group), sourceEntityId = integer(r.sourceEntityId, -0x80000000, 0x7fffffff),
    entityId = text(r.entityId), rawGeometry = {
      x: integer(geometry.x, -0x80000000, 0x7fffffff), y: integer(geometry.y, -0x80000000, 0x7fffffff),
      width: integer(geometry.width, 1, 0x7fffffff), height: integer(geometry.height, 1, 0x7fffffff),
    }, limits = fieldRelayCellLimits(rawGeometry.width, rawGeometry.height);
  if (entityId !== (sourceEntityId ? String(sourceEntityId) : `${group}:${indices[1]}:${indices[2]}`) ||
      r.horizontalCellLimit !== limits.horizontalCellLimit || r.verticalCellLimit !== limits.verticalCellLimit)
    throw new Error("Source relay binding changed its identity or cell limits");
  return { kind: r.kind, group, entityId, sourceEntityId, objectId: integer(r.objectId, -0x80000000, 0x7fffffff),
    editorObjectId: integer(r.editorObjectId, 1, 0x7fffffff), layer: integer(r.layer, 0, 3), rawGeometry,
    editorGid: integer(r.editorGid, 1, 0x0fffffff), ...limits, source: { ...sourceMapRef(source), pointer } };
}

export function parseFieldRelayInteractionHost(raw: unknown): FieldRelayInteractionHost {
  const r = row(raw, "kind,policy,sourceMapHash,mapId,sourceSetHash,parentSourceSetHash,sourceMapRef,mapRange,loop,coordinateHost,scope,parentContext,bindings,limitations,nativeRulesVerified");
  if (r.kind !== "framework-relay-interaction-host-v1" || r.policy !== "framework-relay-interaction-v1" ||
      r.coordinateHost !== "ordinary-field-native-positions-v1" ||
      r.scope !== "walking-stationary-same-layer-known-wait-v1" || r.nativeRulesVerified !== false ||
      !Array.isArray(r.bindings) || !r.bindings.length || !Array.isArray(r.limitations) ||
      canonical(r.limitations) !== canonical(FRAMEWORK_RELAY_INTERACTION_LIMITATIONS))
    throw new Error("Unsupported framework relay interaction policy");
  const bindings = r.bindings.map(definition);
  if (new Set(bindings.map(d => d.entityId)).size !== bindings.length ||
      new Set(bindings.map(d => canonical(d.source))).size !== bindings.length)
    throw new Error("Duplicate framework relay source binding");
  return { ...rawMapBinding(r), kind: r.kind, policy: r.policy, sourceMapHash: digest(r.sourceMapHash),
    coordinateHost: r.coordinateHost, scope: r.scope, parentContext: identityParent(r.parentContext),
    bindings, limitations: [...FRAMEWORK_RELAY_INTERACTION_LIMITATIONS], nativeRulesVerified: false };
}

type RelayHostContent = Pick<FieldContent, "map" | "sourceSetHash" | "parentSourceSetHash" | "cameraHost"> & {
  frameworkRelayInteraction?: FieldRelayInteractionHost;
  developmentProfile?: { kind: "framework-development-v1"; sourceContentHash: string; relayInteraction?: string };
};
function entityMatches(d: FieldRelayDefinition, entity: FieldContent["map"]["entities"][number]): boolean {
  return entity.kind === 16 && entity.id === d.entityId && entity.objectId === d.objectId && entity.layer === d.layer &&
    entity.x === d.rawGeometry.x / 16 && entity.y === (d.rawGeometry.y - d.rawGeometry.height) / 16 &&
    entity.width === d.rawGeometry.width / 16 && entity.height === d.rawGeometry.height / 16 &&
    entity.asset === null && entity.script === null && !entity.npc && !entity.nativeNpc && !entity.mapObject &&
    !!entity.relay && canonical(entity.source) === canonical(d.source) && canonical(entity.relay) === canonical(d);
}

/** Match the existing trusted-content/profile pattern. Saves cannot supply
 * declarations. The lookup is immutable binding data, not registration order;
 * search must use the current Field's registered entityList and native poses. */
export function bindFieldRelays(content: RelayHostContent): Map<string, FieldRelayDefinition> {
  const result = new Map<string, FieldRelayDefinition>();
  if (!content.frameworkRelayInteraction) return result;
  const h = parseFieldRelayInteractionHost(content.frameworkRelayInteraction), profile = content.developmentProfile;
  if (profile?.kind !== "framework-development-v1" || profile.relayInteraction !== h.policy ||
      profile.sourceContentHash !== h.sourceMapHash || h.sourceSetHash !== content.sourceSetHash ||
      h.parentSourceSetHash !== content.parentSourceSetHash || h.mapId !== content.map.identity?.mapId ||
      canonical(h.sourceMapRef) !== canonical(content.map.source) || !content.cameraHost || !content.map.groups ||
      canonical(h.mapRange) !== canonical(content.cameraHost.mapRange) || canonical(h.loop) !== canonical(content.cameraHost.loop))
    throw new Error("Unbound framework relay content host");
  for (const d of h.bindings) {
    const matches = content.map.groups[d.group]?.entities.filter(e => e.id === d.entityId) ?? [];
    if (matches.length !== 1 || !entityMatches(d, matches[0]!))
      throw new Error("Framework relay binding changed its source entity or geometry");
    result.set(d.entityId, d);
  }
  return result;
}

/** Only the exact kind16 diagnostic at a bound source pointer is admitted by
 * this Web host. Source arrays and all unrelated diagnostics stay intact. */
export function fieldRelayGroupBlockers(group: NonNullable<FieldContent["map"]["groups"]>[string],
  host?: FieldRelayInteractionHost): typeof group.blockers {
  if (!host) return group.blockers;
  const h = parseFieldRelayInteractionHost(host);
  return group.blockers.filter(blocker => {
    if (blocker.reason !== FIELD_RELAY_SOURCE_OBSERVER_REQUIREMENT) return true;
    const definitions = h.bindings.filter(d => d.group === group.name && canonical(d.source) === canonical(blocker.source));
    if (definitions.length !== 1) return true;
    return !group.entities.some(entity => entityMatches(definitions[0]!, entity));
  });
}

/** Source GetMapArea uses mapRange, with each axis multiplied by its loop flag.
 * Both false produces an explicit zero rect, not the full map's pixel size. */
export function projectFieldRelayPolicyMapArea(policy: FieldRelayInteractionHost): FieldRelayMapArea {
  const p = parseFieldRelayInteractionHost(policy), f = Math.fround,
    width = p.loop.horizontal ? f(p.mapRange.width * 16) : 0,
    height = p.loop.vertical ? f(p.mapRange.height * 16) : 0;
  return { xMin: width ? f(-width * .5) : 0, yMin: height ? f(height * .5) : 0, width, height };
}
