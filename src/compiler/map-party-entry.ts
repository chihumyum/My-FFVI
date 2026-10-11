import { fieldCollisionRange } from "../core/collision.js";
import type { MapPartyEntryDefinition } from "../core/map-party-entry.js";
import type { Evidence, FieldEntity } from "../field/types.js";
import { hash, record } from "./content.js";
import type { CorpusAsset } from "./corpus.js";
import type { VariableRef } from "../core/event-state.js";
import { entityProperties } from "./entity-group.js";
import { tableId } from "./table-id.js";

export type MapPartyEntryCompilation = {
  definition: MapPartyEntryDefinition;
  dependencies: { table: string; id: number }[];
};

/** A narrow, source-pinned bootstrap fact, not a generic unknown-state default.
 * NewGameWindow.InitializeUserData -> DataInitializeManager.Create clears the
 * scenario bank. The inspected complete non-advertisement prelude does not
 * subsequently write ScenarioFlag3[45]. Its only scenario writes are 1[0]
 * and 4[132]. SysCalls alter local advertisement/transport/skybox state only.
 * The static native checker binds these dependencies to the exact source DLL.
 */
export function compileNarsheMapEntrySeed(records: readonly Pick<CorpusAsset, "source" | "data">[]): {
  values: { ref: VariableRef; value: number }[];
  scripts: { source: CorpusAsset["source"]; contentHash: string }[];
} {
  const specs = [
    ["Map_40037/Map_40037/sc_e_0001.json", "d03b4052156ef1fedd279fd083b2e8f6ffd94a9dbcb2f1f8b5e926816782aa63"],
    ["Map_20010/Map_20010/sc_e_0001_1.json", "215591f2e58902819a81b1e0294d4e74eb81e8f6640ae09ad452b911343398dd"],
    ["Map_20260/Map_20260/sc_e_0001_2.json", "0a1ee4bd482642e7d46c71143001b067fc8dc7e68d4ccefb2760d6344519ad24"],
    ["Map_40037/Map_40037/sc_e_0001_3.json", "bdeeda0216401574d642ef5a81592a0ffdd49738162139c9e5bc959290bde3c8"],
    ["Map_40000/Map_40000/sc_e_0001_4.json", "8d1f7ebb786b4719888e3cc596592b3f1338999e61345c652d54a40353f4330e"],
    ["Map_20010/Map_20010/sc_e_0001_5.json", "822918a9801fe2b652b2af4cd3fc10ead5b632be9e4f0897f8c07df8188efb6d"],
  ] as const;
  const scripts = specs.map(([suffix, contentHash]) => {
    const matches = records.filter((r) => r.source.assetPath === "Assets/GameAssets/Serial/Res/Map/" + suffix);
    if (matches.length !== 1) throw new Error("Missing or ambiguous map-entry checkpoint prelude");
    const found = matches[0]!;
    if (typeof found.source.objectId !== "string" || !/^-?\d+$/.test(found.source.objectId) || !/^[0-9a-f]{64}$/.test(found.source.sha256) ||
        !found.source.serializedFile || hash(found.data) !== contentHash)
      throw new Error("Map-entry checkpoint prelude source needs review");
    return { source: { ...found.source }, contentHash };
  });
  return { values: [{ ref: { category: "ScenarioFlag3", index: 45 }, value: 0 }], scripts };
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Missing map party entry ${label}`);
  return value;
}
function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new Error(`Invalid map party entry ${label}`);
  return value;
}

/**
 * Reuses the admitted field entity coordinate/layer conversion; additional raw
 * PointIn links and condition-collider inputs cannot be recovered from its old
 * reduced shape. The caller binds both this source object and map.csv to the
 * same package manifest. Unrelated object blockers remain with that compiler.
 */
export function compileMapPartyEntry(tables: Record<string, unknown>, mapId: number,
  geometry: { width: number; height: number },
  defaultGroup: { data: unknown; source: Evidence },
  compiledEntities: readonly FieldEntity[]): MapPartyEntryCompilation {
  integer(mapId, "map identity");
  if (mapId <= 0) throw new Error("Invalid map party entry map identity");
  const maps = array(tables["map.csv"], "map master").map(record).filter((r) => tableId(r.id) === mapId);
  if (maps.length !== 1) throw new Error("Missing or ambiguous map party entry master");
  const loopType = tableId(maps[0]!.loop_type);
  if (loopType < 0 || loopType > 3) throw new Error("Unreviewed map party entry loop type");
  const definition: MapPartyEntryDefinition = {
    formatVersion: 1, kind: "map-party-entry", mapId, width: geometry.width, height: geometry.height,
    mapRange: fieldCollisionRange(geometry.width, geometry.height, compiledEntities), loopType,
    pointIns: [], conditionColliders: [],
  };
  const pointObjects = new Set<string>(), colliderObjects = new Set<string>();
  for (const [li, rawLayer] of array(record(defaultGroup.data).layers, "source layers").entries()) {
    const layer = record(rawLayer);
    for (const [oi, raw] of array(layer.objects, "source objects").entries()) {
      const object = record(raw), p = entityProperties(object.properties);
      const kind = integer(p.object_type, "object type");
      if (kind !== 0 && kind !== 19) continue;
      const pointer = `/layers/${li}/objects/${oi}`;
      const entities = compiledEntities.filter((e) => e.source.file === defaultGroup.source.file &&
        e.source.assetPath === defaultGroup.source.assetPath && e.source.pointer === pointer && e.kind === kind);
      if (entities.length !== 1) throw new Error("Unbound map party entry source object");
      const entity = entities[0]!;
      if (layer.visible === false || object.visible === false || integer(object.rotation ?? 0, "rotation") !== 0 ||
          [layer.x ?? 0, layer.y ?? 0, layer.offsetx ?? 0, layer.offsety ?? 0].some((n) => n !== 0))
        throw new Error("Unsupported map party entry source transform");
      if (kind === 0) {
        if (!Number.isInteger(entity.x) || !Number.isInteger(entity.y) || entity.width !== 1 || entity.height !== 1 ||
            entity.layer < 0 || entity.layer > 3 || entity.objectId === undefined ||
            !["1", "2", "4", "8"].includes(String(p.direction)))
          throw new Error("Unsupported map party entry PointIn shape");
        const linkObject = integer(p.link_object_id ?? 0, "PointIn link");
        if (linkObject < 0) throw new Error("Invalid map party entry PointIn link");
        definition.pointIns.push({ id: entity.objectId, x: entity.x, y: entity.y, layer: entity.layer,
          direction: entity.direction, linkObject, source: { ...entity.source } });
        pointObjects.add(entity.id);
      } else {
        const collisionType = integer(p.collision_type, "collision type");
        const throughConditionType = integer(p.through_condition_type, "through condition type");
        if (collisionType < 0 || collisionType > 7 || throughConditionType < 0)
          throw new Error("Invalid map party entry collider");
        // These require a separate transportation collision provider. A plain
        // condition projection must not accidentally admit that map lifecycle.
        if (p.target_transportation_ids !== "" || p.confirm_landing !== false)
          throw new Error("Map entry transportation collision provider is not implemented");
        definition.conditionColliders.push({ id: entity.id, collisionType, throughConditionType });
        colliderObjects.add(entity.id);
      }
    }
  }
  if (compiledEntities.some((e) => (e.kind === 0 && !pointObjects.has(e.id)) ||
    (e.kind === 19 && !colliderObjects.has(e.id)))) throw new Error("Foreign map party entry objects");
  return { definition, dependencies: [{ table: "map.csv", id: mapId }] };
}
