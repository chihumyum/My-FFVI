import { z } from "zod";
import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { fieldEffectBoardBlockers, validateFieldEffectBoard, type FieldEffectBoardDefinition,
  type FieldEffectMediaDefinition } from "../core/field-effects.js";
import type { Evidence } from "../field/types.js";

const int = (value: unknown) => z.number().int().min(-2147483648).max(2147483647).parse(value);
const bool = (value: unknown) => z.boolean().parse(value);
const text = (value: unknown) => z.string().min(1).parse(value);
const array = (value: unknown) => z.array(z.unknown()).parse(value);
const id = (value: unknown) => z.string().regex(/^-?\d+$/).parse(value);

/** PropertyEffectEntity 9f2440 + ctor 9f25c0. Nullable front/split default
 * true; nullable collision defaults false. Front with negative zoffset becomes
 * 2. Building forcibly disables split and birdview, before board construction. */
export function compileFieldEffectBoard(properties: Record<string, unknown>, geometry: {
  x: unknown; y: unknown; width: unknown; height: unknown;
}, mapobjects: unknown, source: Evidence): FieldEffectBoardDefinition {
  if (int(properties.object_type) !== 11) throw new Error("Not a source effect entity");
  const assetId = int(properties.asset_id);
  const found = array(mapobjects).map(record).filter((row) => tableId(row.id) === assetId);
  if (found.length !== 1) throw new Error("Missing or ambiguous field effect asset");
  const group = text(found[0]!.asset_name);
  if (group === "None" || group.trim() !== group || group !== group.toLowerCase()) throw new Error("Unresolved field effect asset group");
  const building = bool(properties.building ?? false), front = bool(properties.front ?? true);
  const zOffset = int(properties.zoffset ?? -1);
  const definition: FieldEffectBoardDefinition = {
    kind: "source-field-effect-board-v1", assetId, assetGroup: group, assetName: "Prefabs/EffectPrefab",
    pixelPosition: { x: int(geometry.x), y: int(geometry.y) },
    pixelSize: { width: int(geometry.width), height: int(geometry.height) },
    playOnAwake: bool(properties.play_on_awake ?? true), front,
    split: building ? false : bool(properties.split ?? true), zOffset: front && zOffset < 0 ? 2 : zOffset,
    affected: bool(properties.affected ?? false), blendType: int(properties.blend_type ?? 0),
    zTest: bool(properties.ignore_depth_test ?? false) ? 8 : 4,
    collision: bool(properties.collision ?? false), building,
    birdviewPuppet: building ? false : bool(properties.birdview_puppet ?? false),
    screen: bool(properties.screen ?? false), visibleMinimap: bool(properties.visible_minimap ?? false),
    source: structuredClone(source),
  };
  // No event/callback is silently dropped from an otherwise drawable board.
  for (const key of ["action_id", "script_id", "link_object_id", "ignore_route_link_object_id"])
    if (int(properties[key] ?? 0) !== 0) throw new Error("Field effect event provider is unavailable: " + key);
  if (bool(properties.gimmick ?? false)) throw new Error("Field effect gimmick provider is unavailable");
  if (String(properties.target_transportation_ids ?? "") !== "") throw new Error("Field effect transport eligibility is unavailable");
  validateFieldEffectBoard(definition);
  return definition;
}

export function fieldEffectCompilationBlockers(definition: FieldEffectBoardDefinition,
  media?: FieldEffectMediaDefinition): string[] {
  const blockers = fieldEffectBoardBlockers(definition);
  if (!media) blockers.push("Field effect particle provider unavailable: " + definition.assetGroup + " (serialized particle/material admission required)");
  else {
    if (media.assetGroup !== definition.assetGroup) throw new Error("Effect media belongs to another asset group");
    blockers.push(...media.blockers.map((reason) => "Field effect particle provider unavailable: " + definition.assetGroup + ": " + reason));
  }
  return blockers;
}

/** Inspects the exact exported EffectPrefab graph. It deliberately preserves
 * unknown Unity simulation/shader work as blockers; a bundle's second original
 * prefab is not a second runtime emitter. Local and external PPtrs never pass
 * through Number, including materials and texture/shader dependencies. */
export function compileFieldEffectMedia(assetGroup: string, raw: unknown): FieldEffectMediaDefinition {
  const input = record(raw), source = record(input.source);
  const sourceId = id(source.objectId), rootId = id(input.rootId);
  if (sourceId !== rootId || !text(source.assetPath).endsWith("/Prefabs/EffectPrefab.prefab") ||
      !text(source.file).split("/").at(-1)!.startsWith(assetGroup + "_assets_all_") ||
      !/^[a-f0-9]{64}$/.test(text(source.sha256)) || !text(source.serializedFile))
    throw new Error("Unbound field effect prefab source");
  const objects = new Map<string, { type: string; data: Record<string, unknown> }>();
  for (const rawObject of array(input.objects)) {
    const object = record(rawObject), ref = record(object.source), objectId = id(ref.objectId);
    if (objects.has(objectId)) throw new Error("Duplicate effect object ID");
    for (const key of ["file", "assetPath", "serializedFile", "sha256"])
      if (ref[key] !== source[key]) throw new Error("Effect object belongs to another source");
    objects.set(objectId, { type: text(object.type), data: record(object.data) });
  }
  const external = array(input.externals).map(record);
  const externalIds = external.map((entry) => int(entry.fileId));
  if (externalIds.some((value, index) => value !== index + 1) || external.some((entry) => !text(entry.path)))
    throw new Error("Invalid effect external file table");
  const pointer = (value: unknown, local = false): { fileId: number; pathId: string } => {
    const ref = record(value), fileId = int(ref.m_FileID), pathId = id(ref.m_PathID);
    if (fileId < 0 || (fileId !== 0 && !externalIds.includes(fileId)) || (local && (fileId !== 0 || pathId === "0")))
      throw new Error("Unresolved effect pointer file");
    if (pathId !== "0" && fileId === 0 && !objects.has(pathId)) throw new Error("Missing local effect object");
    return { fileId, pathId };
  };
  const local = (value: unknown, expected?: string) => {
    const ref = pointer(value, true), object = objects.get(ref.pathId)!;
    if (expected && object.type !== expected) throw new Error("Effect object type mismatch");
    return { ...object, id: ref.pathId };
  };
  const graph: string[] = [], visited = new Set<string>();
  const visit = (goId: string) => {
    if (visited.has(goId)) throw new Error("Cyclic/aliased effect hierarchy"); visited.add(goId);
    const go = objects.get(goId); if (!go || go.type !== "GameObject") throw new Error("Missing effect GameObject");
    const components = array(go.data.m_Component).map((entry) => local(record(entry).component));
    const transforms = components.filter((entry) => entry.type === "Transform");
    if (transforms.length !== 1) throw new Error("Missing/ambiguous effect transform");
    graph.push(goId, ...components.map((component) => component.id));
    for (const component of components)
      if (local(component.data.m_GameObject, "GameObject").id !== goId) throw new Error("Effect component owner mismatch");
    for (const rawChild of array(transforms[0]!.data.m_Children)) {
      const child = local(rawChild, "Transform");
      if (local(child.data.m_Father, "Transform").id !== transforms[0]!.id) throw new Error("Effect parent mismatch");
      visit(local(child.data.m_GameObject, "GameObject").id);
    }
  };
  visit(rootId);
  if (JSON.stringify(graph) !== JSON.stringify(input.hierarchyIds) || new Set(graph).size !== graph.length)
    throw new Error("Effect hierarchy receipt mismatch");
  const reachable = graph.map((key) => ({ id: key, ...objects.get(key)! }));
  const cameras = reachable.filter((entry) => entry.type === "Camera");
  if (cameras.length !== 1) throw new Error("Missing/ambiguous source effect camera");
  const camera = cameras[0]!.data;
  if (camera.orthographic !== true) throw new Error("Perspective effect camera is unavailable");
  const orthographicSize = z.number().finite().positive().parse(camera["orthographic size"]);
  const renderSize = Math.trunc(Math.fround(Math.fround(orthographicSize) * 2));
  if (renderSize < 1 || renderSize > 8192) throw new Error("Unsupported effect render size");
  const blockers = new Set<string>();
  for (const entry of reachable) if (!["GameObject", "Transform", "Camera", "ParticleSystem", "ParticleSystemRenderer"].includes(entry.type))
    blockers.add("Unimplemented effect component: " + entry.type);
  const particles = reachable.filter((entry) => entry.type === "ParticleSystem").map((entry) => {
    const data = entry.data;
    const enabledModules = Object.entries(data).filter(([name, value]) => name.endsWith("Module") &&
      value !== null && typeof value === "object" && !Array.isArray(value) && record(value).enabled === true).map(([name]) => name);
    if (data.autoRandomSeed === true) blockers.add("Unity ParticleSystem autoRandomSeed provider");
    for (const name of enabledModules) blockers.add("Unity ParticleSystem " + name + " simulation");
    if (data.prewarm === true) blockers.add("Unity ParticleSystem prewarm simulation");
    return { id: entry.id, loop: bool(data.looping), enabledModules };
  });
  if (!particles.length) blockers.add("Particle-free effect execution has not been admitted");
  for (const renderer of reachable.filter((entry) => entry.type === "ParticleSystemRenderer")) {
    for (const material of array(renderer.data.m_Materials)) {
      const ref = pointer(material);
      if (ref.pathId === "0") throw new Error("Null effect particle material");
      if (ref.fileId !== 0) blockers.add("External particle material " + ref.fileId + ":" + ref.pathId);
      else {
        const object = local(material, "Material"), shader = pointer(object.data.m_Shader);
        blockers.add("Particle material shader " + shader.fileId + ":" + shader.pathId);
        for (const rawTexture of array(record(object.data.m_SavedProperties).m_TexEnvs)) {
          const [name, texture] = array(rawTexture), reference = pointer(record(texture).m_Texture);
          if (reference.pathId !== "0") blockers.add("Particle texture " + text(name) + " " + reference.fileId + ":" + reference.pathId);
        }
      }
    }
  }
  blockers.add("Source effect-board material/depth renderer admission");
  return { kind: "source-field-effect-media-v1", assetGroup,
    source: structuredClone(source) as Evidence, orthographicSize,
    renderTexture: { width: renderSize, height: renderSize, filterMode: 0, wrapMode: 1 },
    particles, animator: null, blockers: [...blockers] };
}
