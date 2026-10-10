import { posix } from "node:path";
import { z } from "zod";
import type { CorpusAsset } from "./corpus.js";
import { record } from "./content.js";
import { compileEntityGroup } from "./entity-group.js";
import type { EntityGroup } from "../field/types.js";
import { tableId } from "./table-id.js";

type Tables = Record<string, Record<string, string>[]>;
type Aliases = Record<string, string | null>;
const array = (v: unknown) => z.array(z.unknown()).parse(v);
const text = (v: unknown) => z.string().parse(v);
/** Package-local names never resolve by a filename from an unrelated bundle. */
export function bindMapPackages(assets: CorpusAsset[], tables: Tables) {
  const byPath = new Map<string, CorpusAsset[]>();
  for (const a of assets) {
    const key = a.source.file + "::" + a.source.assetPath;
    byPath.set(key, [...(byPath.get(key) ?? []), a]);
  }
  const packages = assets.filter((a) => a.kind === "map-package"),
    rows = tables["map.csv"] ?? [];
  if (new Set(rows.map((r) => tableId(r.id))).size !== rows.length)
    throw new Error("Duplicate map row");
  const resolveAsset = (
    pkg: CorpusAsset,
    raw: unknown,
    kind: CorpusAsset["kind"],
    issues: string[],
  ) => {
    const relative = text(raw);
    if (
      !relative ||
      relative.startsWith("/") ||
      relative.includes("\\") ||
      relative.split("/").includes("..")
    )
      throw new Error("Unsafe package asset reference");
    const path = posix.join(
      posix.dirname(pkg.source.assetPath),
      relative + ".json",
    );
    const candidates = (byPath.get(pkg.source.file + "::" + path) ?? []).filter(
      (a) => a.kind === kind,
    );
    if (candidates.length !== 1) {
      issues.push(
        `${kind}:${relative}:${candidates.length ? "ambiguous" : "missing"}`,
      );
      return null;
    }
    return candidates[0]!.id;
  };
  const aliases = (
    pkg: CorpusAsset,
    refs: unknown,
    kind: CorpusAsset["kind"],
    issues: string[],
  ): Aliases => {
    const values = new Map<string, string | null>();
    for (const raw of array(refs)) {
      const ref = record(raw),
        name = text(ref.name);
      const id = resolveAsset(pkg, ref.asset, kind, issues);
      if (values.has(name)) {
        issues.push(`duplicate-alias:${name}`);
        values.set(name, null);
      } else values.set(name, id);
    }
    return Object.fromEntries(values);
  };
  // Native MapManager names this one fallback explicitly. Never search other maps by basename.
  const residentMatches = packages.flatMap((pkg) => {
    const data = record(pkg.data);
    return data.asset_group_name === "map_script"
      ? array(data.map)
          .map(record)
          .filter((m) => m.name === "Resident")
          .map((map) => ({ pkg, map }))
      : [];
  });
  const residentIssues: string[] = [];
  if (residentMatches.length > 1)
    residentIssues.push("resident-package:ambiguous");
  const residentScripts =
    residentMatches.length === 1
      ? aliases(
          residentMatches[0]!.pkg,
          residentMatches[0]!.map.script ?? [],
          "script",
          residentIssues,
        )
      : {};
  return rows.map((row) => {
    const matches = packages.flatMap((pkg) => {
      const data = record(pkg.data);
      return data.asset_group_name === row.asset_name
        ? array(data.map)
            .map(record)
            .filter((m) => m.name === row.map_name)
            .map((map) => ({ pkg, map }))
        : [];
    });
    const issues: string[] = [...residentIssues];
    let scriptAliases: Aliases = {},
      groups: Record<string, string> = {};
    let tilemap: string | null = null,
      packageId: string | null = null,
      collision: string | null = null,
      initializer: string | null = null,
      initializerName: string | null = null;
    let initializerStatus:
      "not-configured" | "resolved" | "not-declared" | "unresolved" =
      "not-configured";
    if (matches.length !== 1)
      issues.push(`map-package:${matches.length ? "ambiguous" : "missing"}`);
    else {
      const { pkg, map } = matches[0]!;
      packageId = pkg.id;
      const resolve = (raw: unknown, kind: CorpusAsset["kind"]) =>
        resolveAsset(pkg, raw, kind, issues);
      scriptAliases = aliases(pkg, map.script ?? [], "script", issues);
      const groupAliases = aliases(pkg, map.entity ?? [], "data", issues);
      if (map.entity_default !== undefined && map.entity_default !== "") {
        const id = resolve(map.entity_default, "data");
        if (Object.hasOwn(groupAliases, "entity_default")) {
          issues.push("duplicate-alias:entity_default");
          groupAliases.entity_default = null;
        } else groupAliases.entity_default = id;
      }
      groups = Object.fromEntries(
        Object.entries(groupAliases).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      );
      if (map.tilemap !== undefined && map.tilemap !== "")
        tilemap = resolve(map.tilemap, "data");
      if (map.collision !== undefined && map.collision !== "")
        collision = resolve(map.collision, "data");
      if (row.script_id && tableId(row.script_id) !== 0) {
        const rows = (tables["map_script.csv"] ?? []).filter(
          (s) => tableId(s.id) === tableId(row.script_id),
        );
        initializerStatus = "unresolved";
        if (rows.length === 1) {
          initializerName = text(rows[0]!.script_name);
          const declared =
            Object.hasOwn(scriptAliases, initializerName) ||
            Object.hasOwn(residentScripts, initializerName);
          initializer = resolveMapScript(
            { scriptAliases, residentScripts },
            initializerName,
          );
          if (initializer) initializerStatus = "resolved";
          else if (
            !declared &&
            residentMatches.length === 1 &&
            !residentIssues.length
          )
            initializerStatus = "not-declared";
        }
        if (initializerStatus === "unresolved")
          issues.push(`initializer:${row.script_id}:unresolved`);
      }
    }
    return {
      id: String(tableId(row.id)),
      packageId,
      name: row.map_name!,
      areaId: String(tableId(row.area_id)),
      scripts: [
        ...new Set(
          Object.values(scriptAliases).filter((v): v is string => v !== null),
        ),
      ].sort(),
      scriptAliases,
      residentScripts,
      groups,
      tilemap,
      collision,
      initializer,
      initializerName,
      initializerStatus,
      issues,
    };
  });
}
export type MapBinding = ReturnType<typeof bindMapPackages>[number];
export function resolveMapScript(
  map: { scriptAliases: Aliases; residentScripts: Aliases },
  name: string,
): string | null {
  const aliases = Object.hasOwn(map.scriptAliases, name)
    ? map.scriptAliases
    : map.residentScripts;
  return Object.hasOwn(aliases, name) ? (aliases[name] ?? null) : null;
}
export function compileMapGroups(
  map: MapBinding,
  assets: Map<string, CorpusAsset>,
  tables: Tables,
  messages: Record<string, unknown> = {},
): Record<string, EntityGroup> {
  return Object.fromEntries(
    Object.entries(map.groups).map(([name, id]) => {
      const asset = assets.get(id);
      if (!asset) throw new Error("Missing bound entity group " + id);
      try {
        return [name, compileEntityGroup(name, asset, tables, messages)];
      } catch (error) {
        return [
          name,
          {
            name,
            source: asset.source,
            entities: [],
            blockers: [
              {
                reason: error instanceof Error ? error.message : String(error),
                source: asset.source,
              },
            ],
          },
        ];
      }
    }),
  );
}
