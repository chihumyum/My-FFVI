import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";
import { projectFieldMoveArea, validateFieldMoveArea } from "./field-move-area.js";
import { parseFieldNpcActivityProgram } from "./field-npc-activity.js";
import type { FieldCameraMapRange } from "./field-camera.js";
import type { FieldMoveAreaDefinition } from "./field-move-area.js";
import type { FieldNativeNpcDefinition } from "./field-native-npc.js";
import type { FieldNpcActivityProgram } from "./field-npc-activity.js";
import type { Evidence } from "../field/types.js";

export type FieldNpcProjectionDefinition = Omit<Extract<FieldNativeNpcDefinition, { controller: "wait" }>, "kind" | "controller">;
export type FieldFrameworkAreaNpcDefinition = Extract<FieldNativeNpcDefinition, { controller: "area" }>;
export type FieldNpcActivityDiagnostic = { code: string; reason: string; source: Evidence | null };
export type FieldNpcAreaReference = {
  group: string; source: Evidence; rawObject: unknown; properties: Record<string, unknown>;
  definition: FieldMoveAreaDefinition | null; blockers: string[];
};

/** Immutable evidence only. Neither binding nor parsing installs a controller,
 * edits the original map/NPC, or grants the source RNG/physics consumers. */
export type FieldNpcActivitySourceDefinition = {
  kind: "field-npc-activity-source-v1"; contentHash: string;
  sourceSetHash: string; parentSourceSetHash: string; mapId: number;
  mapRange: FieldCameraMapRange | null; group: string; entityId: string | null;
  source: Evidence; groupSource: Evidence; packageSource: Evidence | null;
  rawObject: unknown; properties: Record<string, unknown>; mapObjectRows: Record<string, string>[];
  nativeFactory: FieldNpcProjectionDefinition | null;
  parameters: {
    moveType: 2; sourceSpeedId: number | null; sourceSpeedEnum: number | null;
    sourceIntervalId: number | null; intervalSeconds: number | null;
    sourceMoveStep: number | null; moveSteps: number | null;
    firstIntervalPresent: boolean; firstInterval: boolean | null;
    idling: boolean | null; eyeContact: boolean | null; pushed: boolean | null;
    linkObjectId: number | null;
  };
  areaReferences: FieldNpcAreaReference[];
  bindingBlockers: FieldNpcActivityDiagnostic[]; sourceBlockers: string[]; nativeGaps: string[];
  nativeParity: false;
};

export type FrameworkNpcActivityDeclaration = {
  kind: "framework-npc-area-declaration-v1"; policy: "framework-npc-area-v1"; sourceHash: string;
  missingFirstInterval: "source-ctor-true"; random: "web-xorshift32-v1";
  collision: "actor-grid-reservations-v1"; schedule: "fixed-step-source-order-v1";
  takeover: "pause-autonomous-motion-v1"; reason: string;
};
export type FrameworkNpcActivityBinding = {
  source: FieldNpcActivitySourceDefinition; declaration: FrameworkNpcActivityDeclaration;
  definition: FieldFrameworkAreaNpcDefinition; program: FieldNpcActivityProgram;
  sourceBlockers: string[]; limitations: string[];
};

const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
/** PropertyNpc.ConvertPropertyToData and GetMoveInterval are separate from
 * Web controller scheduling. Preserve the input IDs beside these projections. */
export function fieldNpcActivitySourceSpeedEnum(value: number): number {
  checkpointInteger(value, -0x80000000, 0x7fffffff);
  return ({ 2: 1, 4: 3, 8: 5, 15: 7, 26: 8 } as Record<number, number>)[value] ?? 0;
}
export function fieldNpcActivitySourceIntervalSeconds(value: number): number {
  checkpointInteger(value, -0x80000000, 0x7fffffff);
  return Math.fround(({ 0: 0, 2: 1.5749999, 3: 6.2999997, 4: 9.45, 5: .1, 6: .2 } as Record<number, number>)[value] ?? 3.1499999);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error("NPC source requires plain JSON records");
}
function json(value: unknown, stack = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || stack.has(value)) throw new Error("Invalid NPC source JSON data");
  stack.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error("Sparse NPC source JSON array");
    for (const item of value) json(item, stack);
  } else {
    object(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error("Invalid NPC source property");
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!d.enumerable || !Object.hasOwn(d, "value")) throw new Error("NPC source requires plain JSON properties");
      json(d.value, stack);
    }
  }
  stack.delete(value);
}
function evidence(value: unknown): void {
  object(value);
  if (typeof value.file !== "string" || !value.file || typeof value.assetPath !== "string" || !value.assetPath ||
      typeof value.objectId !== "string" || !/^-?\d+$/.test(value.objectId) ||
      typeof value.sha256 !== "string" || !digest(value.sha256) || typeof value.serializedFile !== "string" || !value.serializedFile)
    throw new Error("Unbound NPC activity source provenance");
}
function properties(raw: unknown): Record<string, unknown> {
  object(raw);
  if (!Array.isArray(raw.properties)) throw new Error("Missing raw NPC activity properties");
  const values: Record<string, unknown> = Object.create(null);
  for (const item of raw.properties) {
    object(item);
    if (typeof item.name !== "string" || !item.name || !Object.hasOwn(item, "value") || Object.hasOwn(values, item.name))
      throw new Error("Malformed or duplicate raw NPC activity properties");
    values[item.name] = item.value;
  }
  return { ...values };
}
function sourceObject(value: Record<string, unknown>): void {
  if (value.visible === false || value.rotation !== undefined && value.rotation !== 0 ||
      value.polyline || value.polygon || value.ellipse || value.point)
    throw new Error("Unresolved NPC activity source transform");
}
function validateSourceProjection(raw: Record<string, unknown>): void {
  if (raw.nativeFactory === null) return;
  object(raw.nativeFactory); object(raw.rawObject); object(raw.properties);
  const d = raw.nativeFactory, o = raw.rawObject, p = raw.properties;
  checkpointKeys(d, "group,sourceEntityId,entityId,objectType,source,geometry,sourceDirection,direction,asset,updateAttribute,turnAround");
  object(d.geometry); object(d.asset);
  checkpointKeys(d.geometry, "x,y,width,height,layer");
  checkpointKeys(d.asset, "id,asset,animationAsset,shadowType,source");
  evidence(d.source); evidence(d.asset.source); sourceObject(o);
  for (const key of ["x", "y"]) checkpointInteger(d.geometry[key] as number, -0x80000000, 0x7fffffff);
  checkpointInteger(d.geometry.layer as number, 0, 3);
  checkpointInteger(d.sourceEntityId as number, 0, 0x7fffffff);
  const pointer = /^\/layers\/(0|[1-9]\d*)\/objects\/(0|[1-9]\d*)$/.exec((raw.source as Evidence).pointer ?? ""),
    expectedId = d.sourceEntityId !== 0 ? String(d.sourceEntityId) : pointer ? `${raw.group}:${pointer[1]}:${pointer[2]}` : null;
  const directions: Record<number, string> = { 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" };
  if (d.group !== raw.group || d.entityId !== raw.entityId || d.entityId !== expectedId ||
      d.sourceEntityId !== p.entity_id || ![6, 17].includes(d.objectType as number) || d.objectType !== p.object_type ||
      canonical(d.source) !== canonical(raw.source) || canonical(d.asset.source) !== canonical(raw.source) ||
      d.geometry.x !== o.x || d.geometry.y !== o.y || d.geometry.width !== 16 || d.geometry.height !== 16 ||
      o.width !== 16 || o.height !== 16 || !Object.hasOwn(directions, d.sourceDirection as number) ||
      d.sourceDirection !== p.direction || d.direction !== directions[d.sourceDirection as number] ||
      d.turnAround !== p.turn_around || typeof d.turnAround !== "boolean" ||
      typeof p.move_while_display_message !== "boolean" || d.updateAttribute !== (p.move_while_display_message ? 10 : 2))
    throw new Error("NPC activity projection disagrees with its raw source");
  for (const key of ["affected", "all_layers", "birdview_puppet", "visible_minimap"])
    if (p[key] !== false) throw new Error("Unresolved NPC activity projection provider");
  checkpointInteger(d.asset.id as number, 1, 0x7fffffff);
  const rows = raw.mapObjectRows as Record<string, string>[];
  if (rows.length !== 1 || String(d.asset.id) !== rows[0]!.id || d.asset.id !== p.asset_id ||
      d.asset.asset !== rows[0]!.asset_name || typeof d.asset.asset !== "string" || !d.asset.asset ||
      d.asset.animationAsset !== d.asset.asset.toUpperCase() || ![0, 1].includes(d.asset.shadowType as number) ||
      String(d.asset.shadowType) !== rows[0]!.shadow_type)
    throw new Error("NPC activity projection changed its mapobject row");
}

/** Header/shape validation is separate from the producer/I/O SHA check. Failed
 * source records are valid inventory entries, never executable definitions. */
export function parseFieldNpcActivitySource(raw: unknown): FieldNpcActivitySourceDefinition {
  json(raw); object(raw);
  checkpointKeys(raw, "kind,contentHash,sourceSetHash,parentSourceSetHash,mapId,mapRange,group,entityId,source,groupSource,packageSource,rawObject,properties,mapObjectRows,nativeFactory,parameters,areaReferences,bindingBlockers,sourceBlockers,nativeGaps,nativeParity");
  if (raw.kind !== "field-npc-activity-source-v1" || !digest(raw.contentHash) || !digest(raw.sourceSetHash) ||
      !digest(raw.parentSourceSetHash) || raw.nativeParity !== false || typeof raw.group !== "string" || !raw.group ||
      raw.entityId !== null && (typeof raw.entityId !== "string" || !raw.entityId))
    throw new Error("Invalid NPC activity source header");
  checkpointInteger(raw.mapId as number, 1, 0x7fffffff);
  evidence(raw.source); evidence(raw.groupSource); if (raw.packageSource !== null) evidence(raw.packageSource);
  if (!/^\/layers\/(0|[1-9]\d*)\/objects\/(0|[1-9]\d*)$/.test((raw.source as Evidence).pointer ?? ""))
    throw new Error("Unbound NPC activity source object pointer");
  if (raw.mapRange !== null) {
    object(raw.mapRange); checkpointKeys(raw.mapRange, "x,y,width,height");
    for (const key of ["x", "y"]) checkpointInteger(raw.mapRange[key] as number, -0x80000000, 0x7fffffff);
    for (const key of ["width", "height"]) checkpointInteger(raw.mapRange[key] as number, 1, 0x7ffffff);
  }
  object(raw.properties); object(raw.parameters);
  checkpointKeys(raw.parameters, "moveType,sourceSpeedId,sourceSpeedEnum,sourceIntervalId,intervalSeconds,sourceMoveStep,moveSteps,firstIntervalPresent,firstInterval,idling,eyeContact,pushed,linkObjectId");
  if (raw.parameters.moveType !== 2 || typeof raw.parameters.firstIntervalPresent !== "boolean")
    throw new Error("Invalid NPC activity source parameters");
  for (const key of ["firstInterval", "idling", "eyeContact", "pushed"])
    if (raw.parameters[key] !== null && typeof raw.parameters[key] !== "boolean")
      throw new Error("Invalid NPC activity source boolean");
  if (!raw.parameters.firstIntervalPresent && raw.parameters.firstInterval !== null)
    throw new Error("Missing source first_interval must remain unfilled");
  for (const key of ["sourceSpeedId", "sourceSpeedEnum", "sourceIntervalId", "sourceMoveStep", "moveSteps", "linkObjectId"])
    if (raw.parameters[key] !== null) checkpointInteger(raw.parameters[key] as number, -0x80000000, 0x7fffffff);
  if (raw.parameters.intervalSeconds !== null &&
      (typeof raw.parameters.intervalSeconds !== "number" || !Number.isFinite(raw.parameters.intervalSeconds) || raw.parameters.intervalSeconds < 0))
    throw new Error("Invalid NPC activity source interval");
  for (const key of ["areaReferences", "bindingBlockers", "sourceBlockers", "nativeGaps", "mapObjectRows"])
    if (!Array.isArray(raw[key])) throw new Error("Invalid NPC activity source collection");
  for (const list of [raw.sourceBlockers, raw.nativeGaps] as unknown[][])
    if (list.some(value => typeof value !== "string" || !value)) throw new Error("Invalid NPC activity source blocker");
  for (const row of raw.mapObjectRows as unknown[]) {
    object(row); if (Object.values(row).some(value => typeof value !== "string")) throw new Error("Invalid NPC mapobject source row");
  }
  for (const d of raw.bindingBlockers as unknown[]) {
    object(d); checkpointKeys(d, "code,reason,source");
    if (typeof d.code !== "string" || !d.code || typeof d.reason !== "string" || !d.reason)
      throw new Error("Invalid NPC activity binding diagnostic");
    if (d.source !== null) evidence(d.source);
  }
  let rawProperties: Record<string, unknown> | null = null;
  try { rawProperties = properties(raw.rawObject); } catch (error) {
    if (!(raw.bindingBlockers as unknown[]).length || raw.nativeFactory !== null) throw error;
  }
  if (rawProperties !== null && canonical(rawProperties) !== canonical(raw.properties))
    throw new Error("NPC activity property bag disagrees with its raw source");
  const p = raw.properties, params = raw.parameters;
  if (rawProperties !== null) {
    if (p.object_type !== 6 && p.object_type !== 17 || p.move_type !== 2 ||
        params.firstIntervalPresent !== Object.hasOwn(p, "first_interval"))
      throw new Error("NPC activity source classification changed");
    const pairs = { sourceSpeedId: "move_speed_id", sourceIntervalId: "move_interval_id", sourceMoveStep: "move_step",
      linkObjectId: "link_object_id", idling: "idling", eyeContact: "eye_contact", pushed: "pushed", firstInterval: "first_interval" };
    for (const [key, sourceKey] of Object.entries(pairs))
      if (params[key] !== null && params[key] !== p[sourceKey]) throw new Error("NPC activity parameter changed its raw source");
    if (params.sourceSpeedEnum !== null && (params.sourceSpeedId === null ||
        params.sourceSpeedEnum !== fieldNpcActivitySourceSpeedEnum(params.sourceSpeedId as number)) ||
        params.intervalSeconds !== null && (params.sourceIntervalId === null ||
          params.intervalSeconds !== fieldNpcActivitySourceIntervalSeconds(params.sourceIntervalId as number)) ||
        params.moveSteps !== null && (params.sourceMoveStep === null || params.moveSteps !== Math.max(1, params.sourceMoveStep as number)))
      throw new Error("NPC activity normalized parameter disagrees with its source consumer");
  }
  for (const ref of raw.areaReferences as unknown[]) {
    object(ref); checkpointKeys(ref, "group,source,rawObject,properties,definition,blockers"); evidence(ref.source); object(ref.properties);
    if (typeof ref.group !== "string" || !ref.group || !Array.isArray(ref.blockers) || ref.blockers.some(b => typeof b !== "string"))
      throw new Error("Invalid NPC area source reference");
    if (ref.definition !== null) {
      validateFieldMoveArea(ref.definition as FieldMoveAreaDefinition);
      const definition = ref.definition as FieldMoveAreaDefinition, rawArea = ref.rawObject;
      object(rawArea); sourceObject(rawArea);
      if (rawArea.gid !== undefined || canonical(properties(rawArea)) !== canonical(ref.properties) ||
          Object.keys(ref.properties).sort().join(",") !== "entity_id,object_id,object_type" || ref.properties.object_type !== 13 ||
          ref.properties.object_id !== params.linkObjectId || definition.objectId !== ref.properties.object_id ||
          definition.sourceEntityId !== ref.properties.entity_id || definition.group !== ref.group ||
          canonical(definition.source) !== canonical(ref.source) ||
          ["x", "y", "width", "height"].some(key => definition.geometry[key as keyof typeof definition.geometry] !== rawArea[key]))
        throw new Error("NPC activity Area reference disagrees with its raw source");
    }
  }
  validateSourceProjection(raw);
  if (!(raw.bindingBlockers as unknown[]).length && (raw.nativeFactory === null || raw.mapRange === null ||
      raw.packageSource === null || (raw.areaReferences as FieldNpcAreaReference[]).length !== 1 ||
      !(raw.areaReferences as FieldNpcAreaReference[])[0]!.definition ||
      Object.entries(params).some(([key, value]) => value === null && !(key === "firstInterval" && !params.firstIntervalPresent))))
    throw new Error("NPC activity source omitted its binding blocker");
  return structuredClone(raw) as FieldNpcActivitySourceDefinition;
}

export function parseFrameworkNpcActivityDeclaration(raw: unknown): FrameworkNpcActivityDeclaration {
  json(raw); object(raw);
  checkpointKeys(raw, "kind,policy,sourceHash,missingFirstInterval,random,collision,schedule,takeover,reason");
  if (raw.kind !== "framework-npc-area-declaration-v1" || raw.policy !== "framework-npc-area-v1" ||
      !digest(raw.sourceHash) || raw.missingFirstInterval !== "source-ctor-true" || raw.random !== "web-xorshift32-v1" ||
      raw.collision !== "actor-grid-reservations-v1" || raw.schedule !== "fixed-step-source-order-v1" ||
      raw.takeover !== "pause-autonomous-motion-v1" || typeof raw.reason !== "string" || !raw.reason.trim())
    throw new Error("NPC activity requires its explicit framework execution declaration");
  return structuredClone(raw) as FrameworkNpcActivityDeclaration;
}

/** Browser-safe binding checks. This verifies the complete derived projection
 * and hash associations, not SHA values themselves; producer/repository SHA
 * verification remains a separate boundary. */
export function validateFrameworkNpcActivityBinding(binding: FrameworkNpcActivityBinding): void {
  json(binding); object(binding);
  checkpointKeys(binding, "source,declaration,definition,program,sourceBlockers,limitations");
  const source = parseFieldNpcActivitySource(binding.source), declaration = parseFrameworkNpcActivityDeclaration(binding.declaration),
    program = parseFieldNpcActivityProgram(binding.program), definition = binding.definition;
  if (!definition || !source.nativeFactory || !source.mapRange || source.bindingBlockers.length ||
      source.areaReferences.length !== 1 || !source.areaReferences[0]!.definition || source.areaReferences[0]!.blockers.length)
    throw new Error("Framework NPC activity source bindings remain blocked");
  checkpointKeys(definition, "kind,controller,group,sourceEntityId,entityId,objectType,source,geometry,sourceDirection,direction,asset,updateAttribute,turnAround,activitySourceHash,policyHash,program");
  const { kind, controller, activitySourceHash, policyHash, program: attached, ...projection } = definition;
  if (kind !== "framework-map-npc-v1" || controller !== "area" || !digest(policyHash) ||
      declaration.sourceHash !== source.contentHash || activitySourceHash !== source.contentHash ||
      canonical(projection) !== canonical(source.nativeFactory) || canonical(attached) !== canonical(program))
    throw new Error("Framework NPC activity projection/source associations changed");
  const p = source.parameters, expected = { policy: declaration.policy, actorId: projection.entityId, group: projection.group,
    definitionHash: program.definitionHash, moveArea: projectFieldMoveArea(source.areaReferences[0]!.definition, source.mapRange).moveArea,
    layer: projection.geometry.layer, updateAttribute: projection.updateAttribute, sourceSpeedEnum: p.sourceSpeedEnum,
    baseIntervalMs: p.intervalSeconds! * 1000, moveSteps: p.moveSteps,
    firstInterval: p.firstIntervalPresent ? p.firstInterval : true };
  if (canonical(program) !== canonical(expected)) throw new Error("Framework NPC activity program changed its source projection");
  if (!Array.isArray(binding.sourceBlockers) || canonical(binding.sourceBlockers) !== canonical(source.sourceBlockers) ||
      !Array.isArray(binding.limitations) || binding.limitations.some(value => typeof value !== "string" || !value) ||
      source.nativeGaps.some(gap => !binding.limitations.includes(gap)))
    throw new Error("Framework NPC activity lost its source blockers or limitations");
}
