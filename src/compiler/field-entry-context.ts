import { posix } from "node:path";
import type { FieldEntryContextDefinition } from "../core/field-entry-context.js";
import type { Evidence } from "../field/types.js";
import type { CorpusAsset } from "./corpus.js";
import { record } from "./content.js";
import { entityProperties } from "./entity-group.js";
import { tableId } from "./table-id.js";

type Asset = Pick<CorpusAsset, "kind" | "data" | "source">;
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Missing source field entry array");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid source field entry text");
  return value;
}
function safeReference(value: unknown): string {
  const path = text(value);
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes(".."))
    throw new Error("Unsafe source field entry reference");
  return path;
}

/** Inspect package-local source objects before the generic entity compiler can
 * omit an unsupported object. A missing source group is unknown, never empty. */
export function compileFieldEntryContext(
  assets: readonly Asset[], tables: Record<string, unknown>, mapId: number,
): FieldEntryContextDefinition {
  if (!Number.isSafeInteger(mapId) || mapId <= 0) throw new Error("Invalid field entry map identity");
  const maps = array(tables["map.csv"]).map(record).filter((r) => tableId(r.id) === mapId);
  if (maps.length !== 1) throw new Error("Missing or ambiguous field entry map master");
  const row = maps[0]!, monsterSetId = tableId(row.monster_set_id);
  if (monsterSetId < 0) throw new Error("Unknown source field monster set");
  const matches = assets.filter((a) => a.kind === "map-package").flatMap((pkg) => {
    const data = record(pkg.data);
    return data.asset_group_name === row.asset_name
      ? array(data.map).map(record).filter((m) => m.name === row.map_name).map((map) => ({ pkg, map })) : [];
  });
  if (matches.length !== 1) throw new Error("Missing or ambiguous field entry source package");
  const { pkg, map } = matches[0]!;
  const source: Evidence = { ...pkg.source, pointer: `/map/${array(record(pkg.data).map).findIndex((m) => m === map)}` };
  const sets = array(tables["monster_set.csv"]).map(record).filter((r) => tableId(r.id) === monsterSetId);
  if (sets.length > 1) throw new Error("Ambiguous field entry monster set");
  const attribute = map.attribute == null ? "" : text(map.attribute);
  if (attribute) safeReference(attribute);
  // SetMapModelData creates a default EncountTable from the actual row. Its
  // dummy FootInformation is (TypeId=0, subtractSteps, background=0). Even an
  // exclusion area then returns no foot info, which CheckBeast maps to 0.
  // Without that default, absent package Attribute skips AttributeAssetLoad;
  // CreateEncountTask leaves EncountData null and the same check returns 0.
  const foot: FieldEntryContextDefinition["foot"] = sets.length && monsterSetId > 0
    ? { kind: "uniform-zero", basis: "default-monster-set", monsterSetId, source }
    : attribute === ""
      ? { kind: "uniform-zero", basis: "no-attribute-asset", monsterSetId, source }
      : { kind: "unresolved", reason: "Source attribute encounter grid and its live selection are not hosted", source };
  const aliases: [string, unknown][] = array(map.entity).map((raw) => {
    const group = record(raw); return [text(group.name), group.asset];
  });
  if (map.entity_default !== undefined && map.entity_default !== "") aliases.unshift(["entity_default", map.entity_default]);
  const groups: FieldEntryContextDefinition["groups"] = {};
  for (const [name, ref] of aliases) {
    if (!name || Object.hasOwn(groups, name)) throw new Error("Duplicate source field entry entity group");
    const path = posix.join(posix.dirname(pkg.source.assetPath), safeReference(ref) + ".json");
    const found = assets.filter((a) => a.kind === "data" && a.source.file === pkg.source.file && a.source.assetPath === path);
    let savePointCount: number | null = null, reason: string | null = null;
    const groupSource = found.length === 1 ? found[0]!.source : source;
    try {
      if (found.length !== 1) throw new Error("Missing or ambiguous source field entry entity group: " + name);
      let count = 0;
      for (const rawLayer of array(record(found[0]!.data).layers)) {
        const layer = record(rawLayer);
        for (const rawObject of array(layer.objects)) {
          const properties = entityProperties(record(rawObject).properties), type = properties.object_type;
          if (!Number.isSafeInteger(type) || Number(type) < 0) throw new Error("Unknown source entity object type: " + name);
          if (type === 9) count++;
        }
      }
      savePointCount = count;
    } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    groups[name] = { savePointCount, reason, source: { ...groupSource } };
  }
  return { kind: "field-entry-context-v1", mapId, beastFieldController: "source-singleton", foot, groups };
}
