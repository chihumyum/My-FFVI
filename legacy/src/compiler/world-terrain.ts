import { posix } from "node:path";
import { hash, record } from "./content.js";
import { tableInteger } from "./table.js";
import type { BattleRow } from "./battle.js";
import type { Evidence } from "../field/types.js";
import { validateWorldTerrain, validateWorldTerrainSource, type WorldTerrainDefinition,
  type WorldTerrainSource } from "../core/world-terrain.js";

type Tables = Readonly<Record<string, readonly Record<string, string>[]>>;
type Reader = { row(table: string, id: string | number): BattleRow };
type Asset = { data: unknown; source: Evidence & { sha256?: string; serializedFile?: string } };
type SourceFile = { file: string; sha256: string };
export type WorldMapEntryView = { mapId: number; isWorld: boolean; loopType: 0 | 1 | 2 | 3;
  sources: { map: WorldTerrainSource; area: WorldTerrainSource } };

function list(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("Missing source world terrain array");
  return raw;
}
function positive(value: string | undefined, label: string): number {
  const result = tableInteger(value);
  if (result < 1) throw new Error("Invalid source world terrain " + label);
  return result;
}
function assetSource(asset: Asset, files: readonly SourceFile[]): WorldTerrainSource {
  const source = structuredClone(asset.source) as WorldTerrainSource;
  validateWorldTerrainSource(source);
  if (files.filter(file => file.file === source.file && file.sha256 === source.sha256).length !== 1)
    throw new Error("Foreign world terrain source asset");
  return source;
}
function rowSource(row: BattleRow, files: readonly SourceFile[]): WorldTerrainSource {
  const { rowId, ...raw } = row.source;
  const matches = files.filter(file => file.file === raw.file || file.file.endsWith("/" + raw.file));
  if (matches.length !== 1) throw new Error("Unbound world terrain source table file");
  const source = { ...raw, sha256: matches[0]!.sha256, pointer: `/id/${rowId}` };
  validateWorldTerrainSource(source);
  return source;
}
function boundRow(reader: Reader, name: string, id: number): BattleRow {
  const row = reader.row(name, id);
  if (tableInteger(row.values.id) !== id || row.source.rowId !== String(id))
    throw new Error("World terrain source table row mismatch");
  return row;
}

/** MapModel ctor 0x353640 follows Map.area_id -> Area.map_type, then stores
 * isAreaTypeWorld = (areaType == 0). Loop/name/asset resemblance is not proof. */
export function compileWorldMapEntryView(reader: Reader, mapId: number, files: readonly SourceFile[]): WorldMapEntryView {
  const map = boundRow(reader, "map.csv", mapId);
  const area = boundRow(reader, "area.csv", positive(map.values.area_id, "area identity"));
  const type = tableInteger(area.values.map_type), loop = tableInteger(map.values.loop_type);
  if (type !== 0 && type !== 1 || loop < 0 || loop > 3)
    throw new Error("Unreviewed source world-map area/loop type");
  return { mapId, isWorld: type === 0, loopType: loop as WorldMapEntryView["loopType"],
    sources: { map: rowSource(map, files), area: rowSource(area, files) } };
}

export type WorldTerrainCompilationInput = {
  mapId: number; mapName: string; sourceSetHash: string; parentSourceSetHash: string;
  width: number; height: number;
  mapRange: { x: number; y: number; width: number; height: number };
  packageAsset: Asset; assets: readonly Asset[]; tables: Tables; reader: Reader; sources: readonly SourceFile[];
};

/** Bind both assets from the exact package map. The raw foot array is not a
 * Tiled GID array. Native 0x365870 copies its first layer without subtracting 1.
 * Native 0xb28970 chooses Transportation layers by group ID, independently of
 * its unused attributeCollisionMap argument. Compression below checks every
 * source cell; a spatially varying collision layer cannot become a guessed
 * foot-type rule or an all-pass fallback. */
export function compileWorldTerrain(input: WorldTerrainCompilationInput): WorldTerrainDefinition {
  const view = compileWorldMapEntryView(input.reader, input.mapId, input.sources);
  if (!view.isWorld) throw new Error("Source terrain capability is limited to bound world maps");
  const mapRow = boundRow(input.reader, "map.csv", input.mapId);
  if (mapRow.values.map_name !== input.mapName || input.mapRange.x !== 0 || input.mapRange.y !== 0 ||
      input.mapRange.width !== input.width || input.mapRange.height !== input.height)
    throw new Error("Unbound world terrain name/full map range");
  const pkgSource = assetSource(input.packageAsset, input.sources), pkg = record(input.packageAsset.data);
  if (pkg.asset_group_name !== mapRow.values.asset_name)
    throw new Error("World terrain package asset-group identity mismatch");
  const declarations = list(pkg.map).map(record).filter(map => map.name === input.mapName);
  if (declarations.length !== 1) throw new Error("Missing or ambiguous world terrain package map");
  const selected = declarations[0]!;
  // Native SynthesizeToCollider is a separate sub-collision override. It must
  // not be dropped when a future source world map declares it.
  if (selected.sub_collision !== undefined && selected.sub_collision !== null && selected.sub_collision !== "")
    throw new Error("World terrain sub-collision override is not implemented");
  const resolve = (ref: unknown): Asset => {
    if (typeof ref !== "string" || !ref || ref.trim() !== ref || ref.startsWith("/") || ref.includes("\\") ||
        ref.split("/").some(part => !part || part === "." || part === ".."))
      throw new Error("Invalid world terrain package asset reference");
    const path = posix.join(posix.dirname(pkgSource.assetPath), ref + ".json");
    const found = input.assets.filter(asset => asset.source.file === pkgSource.file && asset.source.assetPath === path);
    if (found.length !== 1) throw new Error("Missing or ambiguous world terrain package asset");
    assetSource(found[0]!, input.sources);
    return found[0]!;
  };
  const attribute = resolve(selected.attribute), transport = resolve(selected.transportation);
  const gridLayers = (asset: Asset): Record<string, unknown>[] => {
    const group = record(asset.data);
    if (group.type !== "group" || group.x !== 0 || group.y !== 0 ||
        group.offsetx !== undefined && group.offsetx !== 0 || group.offsety !== undefined && group.offsety !== 0)
      throw new Error("Unsupported world terrain group transform");
    return list(group.layers).map(record).map(layer => {
      if (layer.type !== "tilelayer" || layer.width !== input.width || layer.height !== input.height ||
          layer.x !== 0 || layer.y !== 0 || layer.offsetx !== undefined && layer.offsetx !== 0 ||
          layer.offsety !== undefined && layer.offsety !== 0 ||
          list(layer.properties ?? []).length || !Number.isInteger(layer.id) || Number(layer.id) <= 0 ||
          list(layer.data).length !== input.width * input.height)
        throw new Error("Unsupported world terrain layer shape");
      return layer;
    });
  };
  const attributeLayers = gridLayers(attribute), transportLayers = gridLayers(transport);
  if (attributeLayers.length !== 1) throw new Error("Ambiguous world terrain raw attribute layer");
  if (new Set(transportLayers.map(layer => layer.id)).size !== transportLayers.length)
    throw new Error("Ambiguous world terrain transportation group layer");
  const cells = list(attributeLayers[0]!.data).map(raw => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 0x7fffffff)
      throw new Error("Invalid raw world terrain foot ID");
    return raw;
  });
  const footRows: WorldTerrainDefinition["footRows"] = {};
  for (const raw of input.tables["foot_information.csv"] ?? []) {
    const id = positive(raw.id, "foot identity");
    if (Object.hasOwn(footRows, String(id))) throw new Error("Duplicate world terrain foot row");
    const row = boundRow(input.reader, "foot_information.csv", id);
    footRows[String(id)] = { id, typeId: positive(row.values.type_id, "foot type"),
      subtractSteps: tableInteger(row.values.subtract_steps), battleBackgroundAssetId: tableInteger(row.values.battle_background_asset_id),
      source: rowSource(row, input.sources) };
  }
  const transportRules: WorldTerrainDefinition["transportRules"] = {};
  for (const raw of input.tables["transportation.csv"] ?? []) {
    const id = positive(raw.id, "transportation identity");
    if (Object.hasOwn(transportRules, String(id))) throw new Error("Duplicate world terrain transportation row");
    const row = boundRow(input.reader, "transportation.csv", id), groupId = positive(row.values.transportation_group_id, "transportation group");
    const group = boundRow(input.reader, "transportation_group.csv", groupId);
    const layerIndex = transportLayers.findIndex(layer => layer.id === groupId);
    if (layerIndex < 0) throw new Error("Missing world terrain source transportation group layer");
    const data = list(transportLayers[layerIndex]!.data), collisionByFoot: Record<string, 0 | 1> = {};
    cells.forEach((foot, index) => {
      const code = data[index];
      if (code !== 0 && code !== 1) throw new Error("World terrain collision requires an unsupported directional rule");
      if (Object.hasOwn(collisionByFoot, String(foot)) && collisionByFoot[String(foot)] !== code)
        throw new Error("World terrain collision varies within one raw foot ID");
      collisionByFoot[String(foot)] = code;
    });
    transportRules[String(id)] = { id, typeId: positive(row.values.type_id, "transportation type"), groupId,
      groupFlags: Array.from({ length: 32 }, (_, index) => tableInteger(group.values[index < 3 ? `type${index + 1}` : `type_${index + 1}`])),
      collisionByFoot, source: rowSource(row, input.sources), groupSource: rowSource(group, input.sources),
      collisionSource: { ...assetSource(transport, input.sources), pointer: `/layers/${layerIndex}` } };
  }
  const value: Omit<WorldTerrainDefinition, "contentHash"> = { kind: "source-world-terrain-v1", mapId: input.mapId, mapName: input.mapName,
    sourceSetHash: input.sourceSetHash, parentSourceSetHash: input.parentSourceSetHash,
    width: input.width, height: input.height, loopType: view.loopType, cells, footRows, transportRules,
    sources: { package: pkgSource, attribute: assetSource(attribute, input.sources), transportation: assetSource(transport, input.sources), ...view.sources } };
  const definition = { ...value, contentHash: hash(value) };
  validateWorldTerrain(definition);
  return definition;
}
