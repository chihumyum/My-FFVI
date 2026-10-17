import {validateFieldWaterCatalog,type FieldWaterCatalog}from "../core/field-map-transforms.js";
import { posix } from "node:path";
import { hash, record } from "./content.js";
import { validateCollisionRange, type CollisionRange } from "../core/collision.js";
import type { FieldActorViewSource, FrameworkFlatFieldViewDefinition } from "../core/field-actor-view.js";
import { validateFieldActorView } from "../core/field-actor-view.js";
import { FIELD_COMPOSITION_LAYERS, fieldCompositionTexture, validateFieldCompositionRenderHost,
  validateFieldNativeComposition, type FieldCompositionLayer, type FieldCompositionRenderHost,
  type FieldNativeCompositionDefinition } from "../core/field-native-composition.js";

type Asset = { data: unknown; source: FieldActorViewSource };
export type FrameworkFieldPresentation = {
  kind: "framework-ordinary-field-presentation-v1";
  view: FrameworkFlatFieldViewDefinition;
  composition: FieldNativeCompositionDefinition;
};
export type FrameworkFieldPresentationInput = {
  policy: "framework-ordinary-field-flat-v1";
  water?:FieldWaterCatalog;
  sources: readonly { file: string; sha256: string }[];
  tilemap: Asset;
  mapPackage: Asset;
  /** Full source tilemap dimensions, distinct from the active native crop. */
  mapSize: { width: number; height: number };
  mapRange: CollisionRange;
  renderHost: FieldCompositionRenderHost;
};

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Missing complete ordinary field source list");
  return value;
}
function properties(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const raw of list(value ?? [])) {
    const item = record(raw);
    if (typeof item.name !== "string" || !item.name || Object.hasOwn(result, item.name))
      throw new Error("Ambiguous ordinary field property");
    result[item.name] = item.value;
  }
  return result;
}
function source(asset: Asset, sources: FrameworkFieldPresentationInput["sources"]): void {
  const s = asset.source;
  if (!s || typeof s.file !== "string" || !s.file || typeof s.assetPath !== "string" || !s.assetPath ||
      typeof s.objectId !== "string" || !/^-?\d+$/.test(s.objectId) || !/^[a-f0-9]{64}$/.test(s.sha256) ||
      sources.filter(candidate => candidate.file === s.file && candidate.sha256 === s.sha256).length !== 1)
    throw new Error("Foreign ordinary field presentation source");
}
function stationary(layer: Record<string, unknown>): boolean {
  return layer.visible === true && layer.opacity === 1 &&
    [layer.x ?? 0, layer.y ?? 0, layer.offsetx ?? 0, layer.offsety ?? 0].every(value => value === 0);
}

/** A deliberate Canvas presentation of complete source tiles and the current
 * native actor frames. Only the material/body-threshold split is omitted; the
 * compiler neither edits source properties nor grants field logic, collision,
 * world identity, story state, or map reachability. Unknown declarations fail. */
export function compileFrameworkFieldPresentation(input: FrameworkFieldPresentationInput): FrameworkFieldPresentation {
  if (input.policy !== "framework-ordinary-field-flat-v1")
    throw new Error("Explicit ordinary field presentation policy required");
  const { sources, tilemap, mapPackage, mapSize } = input;
  if (new Set(sources.map(item => item.file)).size !== sources.length || sources.some(item =>
      typeof item.file !== "string" || !item.file || !/^[a-f0-9]{64}$/.test(item.sha256)))
    throw new Error("Ambiguous ordinary field source manifest");
  source(tilemap, sources); source(mapPackage, sources);
  if (tilemap.source.file !== mapPackage.source.file || tilemap.source.sha256 !== mapPackage.source.sha256)
    throw new Error("Ordinary field tilemap/package source mismatch");
  const map = record(tilemap.data), pkg = record(mapPackage.data), root = posix.dirname(mapPackage.source.assetPath);
  if (list(pkg.map).map(record).filter(item => typeof item.tilemap === "string" &&
      posix.join(root, item.tilemap + ".json") === tilemap.source.assetPath).length !== 1 ||
      ![mapSize.width, mapSize.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff / 16) ||
      map.width !== mapSize.width || map.height !== mapSize.height || map.tilewidth !== 16 || map.tileheight !== 16 ||
      map.orientation !== "orthogonal" || map.infinite === true || Object.keys(properties(map.properties)).length&&!input.water)
    throw new Error("Unbound ordinary field tile geometry");
  validateCollisionRange(mapSize.width, mapSize.height, input.mapRange);
  const textureNames = new Set<string>();
  for (const texture of list(pkg.texture).map(record)) {
    if (typeof texture.name !== "string" || !texture.name || typeof texture.asset !== "string" || !texture.asset ||
        textureNames.has(texture.name)) throw new Error("Ambiguous ordinary field texture alias");
    textureNames.add(texture.name);
    if (/_pal_anim(?:$|\.)/i.test(texture.name) || /_pal_anim(?:$|\.)/i.test(texture.asset))
      throw new Error("Ordinary field palette presentation is unresolved");
  }
  if(input.water){validateFieldWaterCatalog(input.water);if(input.water.unresolved.length||input.water.rawHash!==hash(map)||hash(input.water.source)!==hash(tilemap.source))throw Error("Unbound flat WaterGroup provider");
    const root=properties(map.properties);if(Object.keys(root).some(key=>!Object.hasOwn(input.water!.properties,key)))throw Error("Unknown root water material declaration");}
  const rawGroups=list(map.layers).map(record);
  if(input.water){for(const group of rawGroups)if(group.name!=="TileGroup"&&group.name!=="WaterGroup")throw Error("Independent background/material presentation is unresolved");}
  const groups = input.water?rawGroups.filter(group=>group.name==="TileGroup"):rawGroups;
  if (groups.length !== 1 || groups[0]!.type !== "group" || groups[0]!.name !== "TileGroup" || !stationary(groups[0]!))
    throw new Error("Unsupported ordinary field group or background");
  const group = groups[0]!, groupProperties = properties(group.properties);
  if (Object.keys(groupProperties).some(key => !["backdrop", "body_threshold"].includes(key)) ||
      groupProperties.backdrop !== undefined && (typeof groupProperties.backdrop !== "string" ||
        !/^#[a-fA-F0-9]{8}$/.test(groupProperties.backdrop)) ||
      groupProperties.body_threshold !== undefined && (typeof groupProperties.body_threshold !== "number" ||
        !Number.isSafeInteger(groupProperties.body_threshold) || groupProperties.body_threshold < 0 ||
        groupProperties.body_threshold > 0x7fffffff))
    throw new Error("Unsupported ordinary field group material");
  const layers: FieldCompositionLayer[] = [], cells = new Map<FieldCompositionLayer, number[]>();
  for (const raw of list(group.layers)) {
    const layer = record(raw), name = layer.name as FieldCompositionLayer;
    if (layer.type !== "tilelayer" || !FIELD_COMPOSITION_LAYERS.includes(name) || layers.includes(name) ||
        !stationary(layer) || layer.width !== mapSize.width || layer.height !== mapSize.height ||
        Object.keys(properties(layer.properties)).length)
      throw new Error("Unsupported ordinary field tile layer");
    const data = list(layer.data);
    if (data.length !== mapSize.width * mapSize.height || data.some(value => typeof value !== "number" ||
        !Number.isInteger(value) || value < 0 || value > 0xffffffff || (value & 0x10000000) !== 0))
      throw new Error("Incomplete ordinary field tile cells");
    layers.push(name); cells.set(name, data as number[]);
  }
  if (!layers.length) throw new Error("Missing ordinary field tile layers");
  validateFieldCompositionRenderHost(input.renderHost);
  const bound = [tilemap, mapPackage].map(asset => ({ source: structuredClone(asset.source), contentHash: hash(asset.data) }));
  const body = { kind: "framework-flat-field-view-v1" as const, policy: input.policy, sources: bound,
    mapSize: { width: input.mapRange.width, height: input.mapRange.height }, backgrounds: [],
    omissions: ["ordinary-group-materials" as const] };
  const view: FrameworkFlatFieldViewDefinition = { ...body, contextId: hash({ ...body, mapRange: input.mapRange }) };
  validateFieldActorView(view);
  const texture = (layer: "UpperLayer" | "CeilLayer") => cells.has(layer) ? fieldCompositionTexture(view.contextId, layer) : null;
  const readiness = (layer: "UpperLayer" | "CeilLayer") => !cells.has(layer) ? "disabled" as const :
    cells.get(layer)!.some(value => (value & 0x0fffffff) !== 0) ? "source-rendered" as const : "clear-only" as const;
  const composition: FieldNativeCompositionDefinition = {
    kind: "native-ordinary-field-composition-v1", contextId: view.contextId, view: structuredClone(view),
    sources: [...bound.map(item => structuredClone(item.source)), ...structuredClone(input.renderHost.sources)],
    layers, upperTexture: texture("UpperLayer"), ceilTexture: texture("CeilLayer"),
    renderHost: structuredClone(input.renderHost), renderTargets: { upper: readiness("UpperLayer"), ceil: readiness("CeilLayer") },
  };
  validateFieldNativeComposition(composition, view);
  return { kind: "framework-ordinary-field-presentation-v1", view, composition };
}
