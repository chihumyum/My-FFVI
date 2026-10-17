import { fieldCollisionRange } from "../core/collision.js";
import { projectFieldMoveArea } from "../core/field-move-area.js";
import { parseFieldNpcActivityProgram } from "../core/field-npc-activity.js";
import { parseFieldNpcActivitySource, parseFrameworkNpcActivityDeclaration,
  fieldNpcActivitySourceSpeedEnum, fieldNpcActivitySourceIntervalSeconds,
  validateFrameworkNpcActivityBinding,
  type FieldNpcActivitySourceDefinition, type FieldNpcActivityDiagnostic, type FieldNpcAreaReference,
  type FieldNpcProjectionDefinition, type FrameworkNpcActivityBinding } from "../core/field-npc-activity-source.js";
import type { Evidence } from "../field/types.js";
import type { loadCorpus, CorpusAsset } from "./corpus.js";
import { hash, record } from "./content.js";
import { bindMapPackages } from "./map-package.js";
import { compileEntityGroup, entityProperties } from "./entity-group.js";
import { compileFieldMoveArea } from "./field-move-area.js";
import { compileFieldNativeNpc } from "./field-native-npc.js";
import { compileNpc } from "./npc.js";
import { tableId } from "./table-id.js";

export type FieldNpcActivityCorpus = Pick<Awaited<ReturnType<typeof loadCorpus>>,
  "sourceSetHash" | "manifest" | "assets" | "tables" | "messages">;
export type FieldNpcActivitySources = {
  kind: "field-npc-activity-sources-v1"; sourceSetHash: string; parentSourceSetHash: string; mapId: number;
  mapRange: FieldNpcActivitySourceDefinition["mapRange"];
  definitions: FieldNpcActivitySourceDefinition[]; diagnostics: FieldNpcActivityDiagnostic[];
  counts: { declared: number; parsed: number; bound: number; blocked: number };
};
const sha = /^[0-9a-f]{64}$/;
const layers: Record<string, number> = { BottomObject: 0, GroundObject: 1, UpperObject: 2, CeilObject: 3, MinimapObject: 4 };
const directions = { 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" } as const;
const nativeGaps = [
  "Native custom-property parser missing-field preservation is not fully recovered; source constructor defaults are separately evidenced",
  "Unity Random and Guid manager ordering are not the declared Web RNG/scheduler",
  "Native raycast, return-to-area and PauseMove/ResumeMove/dominion consumers are not the declared Web collision/takeover lifecycle",
];
function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new Error("Invalid NPC activity " + name);
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error("Unknown NPC activity " + name);
  return value;
}
function projection(group: string, entityId: string, layer: number, object: Record<string, unknown>,
  p: Record<string, unknown>, source: Evidence, rows: Record<string, string>[]): FieldNpcProjectionDefinition {
  const sourceEntityId = integer(p.entity_id, "entity selector"), objectType = integer(p.object_type, "object type");
  if (sourceEntityId < 0 || ![6, 17].includes(objectType)) throw new Error("Unsupported NPC source selector or object type");
  if (layer < 0 || layer > 3 || object.width !== 16 || object.height !== 16 || object.visible === false ||
      object.rotation !== undefined && object.rotation !== 0 || object.polyline || object.polygon || object.ellipse || object.point)
    throw new Error("Unsupported NPC activity geometry or layer");
  for (const key of ["affected", "all_layers", "birdview_puppet", "visible_minimap"])
    if (boolean(p[key], key)) throw new Error("Unresolved NPC activity provider " + key);
  if (rows.length !== 1) throw new Error("Missing or ambiguous NPC mapobject row");
  const row = rows[0]!, id = integer(p.asset_id, "asset identity"), sourceDirection = integer(p.direction, "direction");
  if (!Object.hasOwn(directions, sourceDirection)) throw new Error("Unsupported NPC activity direction");
  if (id <= 0 || tableId(row.id) !== id || typeof row.asset_name !== "string" || !row.asset_name ||
      ![0, 1].includes(tableId(row.shadow_type))) throw new Error("Unresolved NPC activity map-object media");
  return { group, entityId, sourceEntityId, objectType: objectType as 6 | 17, source: structuredClone(source),
    geometry: { x: integer(object.x, "x"), y: integer(object.y, "y"), width: 16, height: 16, layer },
    sourceDirection: sourceDirection as keyof typeof directions, direction: directions[sourceDirection as keyof typeof directions],
    asset: { id, asset: row.asset_name, animationAsset: row.asset_name.toUpperCase(),
      shadowType: tableId(row.shadow_type) as 0 | 1, source: structuredClone(source) },
    updateAttribute: boolean(p.move_while_display_message, "message update") ? 10 : 2,
    turnAround: boolean(p.turn_around, "turn around") };
}

/** All package-local Area NPC declarations survive, including malformed,
 * unbound and inactive event groups. Their presence never authorizes activity. */
export function compileFieldNpcActivitySources(corpus: FieldNpcActivityCorpus, mapId: number): FieldNpcActivitySources {
  integer(mapId, "map identity");
  const parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  if (mapId <= 0 || !sha.test(corpus.sourceSetHash) || typeof parentSourceSetHash !== "string" || !sha.test(parentSourceSetHash) ||
      hash(corpus.manifest.sources) !== corpus.sourceSetHash)
    throw new Error("Unbound NPC activity corpus fingerprint");
  const binding = bindMapPackages(corpus.assets, corpus.tables).find(b => Number(b.id) === mapId);
  if (!binding) throw new Error("Missing NPC activity source map " + mapId);
  const assets = new Map<string, CorpusAsset>();
  for (const asset of corpus.assets) {
    if (assets.has(asset.id)) throw new Error("Duplicate NPC activity corpus asset identity");
    assets.set(asset.id, asset);
    const sources = (corpus.manifest.sources as { file: string; sha256: string }[]).filter(s => s.file === asset.source.file);
    if (sources.length !== 1 || sources[0]!.sha256 !== asset.source.sha256)
      throw new Error("Foreign NPC activity source asset");
  }
  const diagnostic = (code: string, reason: string, source: Evidence | null): FieldNpcActivityDiagnostic => ({ code, reason, source });
  const diagnostics = binding.issues.map(reason => diagnostic("source-npc-package-binding", reason, null));
  const groups = Object.entries(binding.groups).map(([name, id]) => {
    const asset = assets.get(id); if (!asset) throw new Error("Missing bound NPC activity group");
    return { name, asset };
  });
  let mapRange: FieldNpcActivitySourceDefinition["mapRange"] = null;
  try {
    const tilemap = binding.tilemap && assets.get(binding.tilemap), group = groups.find(g => g.name === "entity_default");
    if (!tilemap || !group) throw new Error("Missing NPC activity source map range inputs");
    const geometry = record(tilemap.data), compiled = compileEntityGroup(group.name, group.asset, corpus.tables, corpus.messages);
    const rawRangeCount = (record(group.asset.data).layers as unknown[]).flatMap(raw => {
      const layer = record(raw); return Array.isArray(layer.objects) ? layer.objects : [];
    }).filter(raw => {
      try { return entityProperties(record(raw).properties).object_type === 27; } catch { return false; }
    }).length;
    if (rawRangeCount !== compiled.entities.filter(entity => entity.kind === 27).length)
      throw new Error("Unbound NPC activity raw map range");
    mapRange = fieldCollisionRange(integer(geometry.width, "map width"), integer(geometry.height, "map height"), compiled.entities);
  } catch (error) { diagnostics.push(diagnostic("source-npc-map-range", String(error), null)); }
  const areas: (FieldNpcAreaReference & { objectId: unknown })[] = [], pending: {
    group: string; asset: CorpusAsset; object: Record<string, unknown>; layer: number; source: Evidence;
    properties: Record<string, unknown>; propertyError: string | null; layerError: string | null;
  }[] = [];
  for (const group of groups) {
    const data = record(group.asset.data);
    if (!Array.isArray(data.layers)) { diagnostics.push(diagnostic("source-npc-group-shape", "Missing source layers", group.asset.source)); continue; }
    for (const [li, rawLayer] of data.layers.entries()) {
      const layer = record(rawLayer), layerId = layers[String(layer.name)] ?? -1;
      const layerError = layerId < 0 || ["offsetx", "offsety", "x", "y"].some(key => Number(layer[key] ?? 0) !== 0) || layer.visible === false
        ? "Unsupported NPC activity source layer transform" : null;
      if (!Array.isArray(layer.objects)) { diagnostics.push(diagnostic("source-npc-group-shape", "Missing source objects", group.asset.source)); continue; }
      for (const [oi, raw] of layer.objects.entries()) {
        const object = record(raw), source = { ...group.asset.source, pointer: `/layers/${li}/objects/${oi}` };
        let p: Record<string, unknown> = {}, propertyError: string | null = null;
        try { p = entityProperties(object.properties); } catch (error) { propertyError = String(error); }
        const rawValues = (name: string) => Array.isArray(object.properties)
          ? object.properties.filter(item => item && typeof item === "object" && (item as Record<string, unknown>).name === name)
            .map(item => (item as Record<string, unknown>).value) : [];
        if (p.object_type === 13 || propertyError && rawValues("object_type").includes(13)) {
          let definition: FieldNpcAreaReference["definition"] = null;
          const blockers: string[] = [...(propertyError ? [propertyError] : []), ...(layerError ? [layerError] : [])];
          try {
            const id = integer(p.entity_id, "area entity selector"), entityId = id ? String(id) : `${group.name}:${li}:${oi}`;
            definition = compileFieldMoveArea({ group: group.name, entityId, layer: layerId, object, properties: p, source });
          } catch (error) { blockers.push(String(error)); }
          areas.push({ group: group.name, source, rawObject: structuredClone(object), properties: p,
            definition, blockers, objectId: p.object_id ?? rawValues("object_id")[0] });
        }
        if ([6, 17].includes(p.object_type as number) && p.move_type === 2 || propertyError &&
            rawValues("move_type").includes(2) && rawValues("object_type").some(kind => kind === 6 || kind === 17))
          pending.push({ group: group.name, asset: group.asset, object, layer: layerId, source, properties: p, propertyError, layerError });
      }
    }
  }
  const definitions = pending.map(item => {
    const p = item.properties, bindingBlockers = [...diagnostics], parameters: FieldNpcActivitySourceDefinition["parameters"] = {
      moveType: 2, sourceSpeedId: null, sourceSpeedEnum: null, sourceIntervalId: null, intervalSeconds: null,
      sourceMoveStep: null, moveSteps: null, firstIntervalPresent: Object.hasOwn(p, "first_interval"), firstInterval: null,
      idling: null, eyeContact: null, pushed: null, linkObjectId: null,
    };
    let entityId: string | null = null, nativeFactory: FieldNpcProjectionDefinition | null = null;
    let rows: Record<string, string>[] = [];
    const fail = (reason: string) => bindingBlockers.push(diagnostic("source-npc-area-binding", reason, item.source));
    if (item.propertyError) fail(item.propertyError);
    if (item.layerError) fail(item.layerError);
    try {
      const id = integer(p.entity_id, "entity selector"); entityId = id ? String(id) : `${item.group}:${/^\/layers\/(\d+)\/objects\/(\d+)$/.exec(item.source.pointer!)!.slice(1).join(":")}`;
      parameters.sourceSpeedId = integer(p.move_speed_id, "speed"); parameters.sourceSpeedEnum = fieldNpcActivitySourceSpeedEnum(parameters.sourceSpeedId);
      parameters.sourceIntervalId = integer(p.move_interval_id, "interval"); parameters.intervalSeconds = fieldNpcActivitySourceIntervalSeconds(parameters.sourceIntervalId);
      parameters.sourceMoveStep = integer(p.move_step, "move step"); parameters.moveSteps = Math.max(1, parameters.sourceMoveStep);
      parameters.linkObjectId = integer(p.link_object_id, "area reference");
      for (const key of ["idling", "eyeContact", "pushed"] as const)
        parameters[key] = boolean(p[key === "eyeContact" ? "eye_contact" : key], key);
      if (parameters.firstIntervalPresent) parameters.firstInterval = boolean(p.first_interval, "first_interval");
      const assetId = integer(p.asset_id, "asset identity");
      rows = (corpus.tables["mapobject.csv"] ?? []).filter(row => tableId(row.id) === assetId).map(row => ({ ...row }));
      nativeFactory = projection(item.group, entityId, item.layer, item.object, p, item.source, rows);
    } catch (error) { fail(String(error)); }
    const areaReferences = areas.filter(area => area.objectId === parameters.linkObjectId).map(({ objectId: _, ...area }) => structuredClone(area));
    if (areaReferences.length !== 1 || !areaReferences[0]!.definition || areaReferences[0]!.blockers.length)
      fail("Missing, ambiguous or malformed source MoveArea reference " + parameters.linkObjectId);
    const entity = { id: entityId ?? "unbound", kind: Number(p.object_type), layer: item.layer, source: item.source };
    const sourceBlockers = [...compileFieldNativeNpc({ group: item.group, object: item.object, entity, properties: p, tables: corpus.tables }).blockers];
    try {
      const scriptId = integer(p.script_id ?? 0, "interaction script"), scriptRows =
        (corpus.tables["script.csv"] ?? []).filter(row => tableId(row.id) === scriptId);
      const script = scriptId === 0 ? null : scriptRows.length === 1 ? scriptRows[0]!.script_name ?? null : null;
      if (scriptId !== 0 && script === null) sourceBlockers.push("Missing or ambiguous source NPC interaction script " + scriptId);
      sourceBlockers.push(...compileNpc(p, script, corpus.tables, corpus.messages).blockers);
    } catch (error) { sourceBlockers.push(String(error)); }
    const body: Omit<FieldNpcActivitySourceDefinition, "contentHash"> = {
      kind: "field-npc-activity-source-v1", sourceSetHash: corpus.sourceSetHash, parentSourceSetHash, mapId,
      mapRange: mapRange && { ...mapRange }, group: item.group, entityId, source: item.source, groupSource: item.asset.source,
      packageSource: binding.packageId ? assets.get(binding.packageId)?.source ?? null : null,
      rawObject: structuredClone(item.object), properties: structuredClone(p), mapObjectRows: rows, nativeFactory,
      parameters, areaReferences, bindingBlockers, sourceBlockers, nativeGaps: [...nativeGaps], nativeParity: false,
    };
    return parseFieldNpcActivitySource({ ...body, contentHash: hash(body) });
  });
  return { kind: "field-npc-activity-sources-v1", sourceSetHash: corpus.sourceSetHash, parentSourceSetHash, mapId,
    mapRange, definitions, diagnostics: [...diagnostics, ...definitions.flatMap(d => d.bindingBlockers)],
    counts: { declared: definitions.length, parsed: definitions.filter(d => d.nativeFactory !== null).length,
      bound: definitions.filter(d => d.bindingBlockers.length === 0).length, blocked: definitions.filter(d => d.bindingBlockers.length > 0).length } };
}

/** Separate authored execution from unchanged source metadata and blockers.
 * No declaration grants Unity RNG, native physics or original story access. */
export function deriveFrameworkNpcActivity(rawSource: FieldNpcActivitySourceDefinition, rawDeclaration: unknown): FrameworkNpcActivityBinding {
  const source = parseFieldNpcActivitySource(rawSource), declaration = parseFrameworkNpcActivityDeclaration(rawDeclaration);
  const { contentHash, ...sourceBody } = source;
  if (hash(sourceBody) !== contentHash || declaration.sourceHash !== contentHash)
    throw new Error("NPC activity source/declaration digest mismatch");
  if (source.bindingBlockers.length || !source.nativeFactory || !source.mapRange ||
      source.areaReferences.length !== 1 || !source.areaReferences[0]!.definition)
    throw new Error("NPC activity source bindings remain blocked");
  const factory = source.nativeFactory, area = projectFieldMoveArea(source.areaReferences[0]!.definition!, source.mapRange), p = source.parameters;
  const policyHash = hash(declaration), definitionHash = hash({ sourceHash: contentHash, policyHash, projection: factory, area: area.moveArea });
  const program = parseFieldNpcActivityProgram({ policy: declaration.policy, actorId: factory.entityId, group: factory.group,
    definitionHash, moveArea: area.moveArea, layer: factory.geometry.layer, updateAttribute: factory.updateAttribute,
    sourceSpeedEnum: p.sourceSpeedEnum, baseIntervalMs: p.intervalSeconds! * 1000,
    moveSteps: p.moveSteps, firstInterval: p.firstIntervalPresent ? p.firstInterval : true });
  const definition: FrameworkNpcActivityBinding["definition"] = { ...structuredClone(factory),
    kind: "framework-map-npc-v1", controller: "area", activitySourceHash: contentHash, policyHash, program };
  const binding = { source, declaration, definition, program: structuredClone(program), sourceBlockers: [...source.sourceBlockers],
    limitations: [...source.nativeGaps, "Framework activity does not close original dialogue, event, provider or story-reachability blockers"] };
  validateFrameworkNpcActivityBinding(binding);
  return binding;
}
