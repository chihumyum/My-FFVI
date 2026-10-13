import { posix } from "node:path";
import type { CorpusAsset } from "./corpus.js";
import { hash, record } from "./content.js";
import { tableId } from "./table-id.js";
import {
  parseFieldNpcRouteCatalog, parseFieldNpcRouteRawInstruction, parseFieldNpcRouteSource,
  fieldNpcRouteInstructionKind, fieldNpcRouteRequirements,
  type FieldNpcRouteCatalog, type FieldNpcRouteDefinition, type FieldNpcRouteSource, type FieldNpcRouteRequirement,
} from "../core/field-npc-route.js";

type Corpus = { assets: readonly CorpusAsset[]; tables: Record<string, Record<string, string>[]>;
  sourceSetHash: string; manifest: { parentSourceSetHash: string } };
export type FieldNpcRouteDiagnostic = {
  kind: "parse" | "binding" | "capability"; code: string; reason: string;
  source: FieldNpcRouteSource | null; routeId?: number; index?: number;
};
type Assignment = { site: { script: string; index: number; source: FieldNpcRouteSource };
  rawOperands: unknown; entityId: number | null; routeId: number | null;
  loop: boolean | null; binding: "bound" | "unresolved" };
export type FieldNpcRouteCompilation = {
  catalog: FieldNpcRouteCatalog | null; diagnostics: FieldNpcRouteDiagnostic[];
  report: { mapId: number; mapName: string; parse: { declared: number; parsed: number; invalid: number };
    binding: { resolved: number; blocked: number };
    capability: { executionSupport: "none"; migrationReady: false; requirements: FieldNpcRouteRequirement[]; unknownInstructionTypes: number[] };
    assignments: Assignment[] };
};
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
/** Package-local data binding only. No runtime controller, story applicability
 * or source opcode admission is inferred from a parsed route or bound alias. */
export function compileFieldNpcRoutes(corpus: Corpus, mapId: number): FieldNpcRouteCompilation {
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 0x7fffffff) throw new Error("Invalid NPC route map identity");
  const rows = (corpus.tables["map.csv"] ?? []).filter(r => tableId(r.id) === mapId);
  if (rows.length !== 1) throw new Error("Missing or ambiguous NPC route map row");
  const row = rows[0]!, mapName = row.map_name;
  if (!mapName || !row.asset_name) throw new Error("Missing NPC route map package identity");
  const diagnostics: FieldNpcRouteDiagnostic[] = [], report: FieldNpcRouteCompilation["report"] = {
    mapId, mapName, parse: { declared: 0, parsed: 0, invalid: 0 }, binding: { resolved: 0, blocked: 0 },
    capability: { executionSupport: "none", migrationReady: false, requirements: [], unknownInstructionTypes: [] }, assignments: [],
  };
  const issue = (kind: FieldNpcRouteDiagnostic["kind"], code: string, reason: string,
    source: FieldNpcRouteSource | null, extra: Pick<FieldNpcRouteDiagnostic, "routeId" | "index"> = {}) => {
    diagnostics.push({ kind, code, reason, source, ...extra });
    if (kind === "binding") report.binding.blocked++;
  };
  const matches = corpus.assets.filter(a => a.kind === "map-package").flatMap(pkg => {
    const data = record(pkg.data);
    if (data.asset_group_name !== row.asset_name || !Array.isArray(data.map)) return [];
    return data.map.map(record).flatMap((map, index) => map.name === mapName ? [{ pkg, map, index }] : []);
  });
  if (matches.length !== 1) {
    issue("binding", "map-package", "Missing or ambiguous package-local NPC route map", null);
    return { catalog: null, diagnostics, report };
  }
  const { pkg, map, index: mapIndex } = matches[0]!, packageSource = parseFieldNpcRouteSource(pkg.source);
  const resolve = (relative: unknown, kind: CorpusAsset["kind"]) => {
    if (typeof relative !== "string" || !relative || relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes(".."))
      throw new Error("Unsafe package-local NPC route reference");
    const path = posix.join(posix.dirname(pkg.source.assetPath), relative + ".json");
    const found = corpus.assets.filter(a => a.source.file === pkg.source.file && a.source.assetPath === path && a.kind === kind);
    if (found.length !== 1) throw new Error("Missing or ambiguous package-local NPC route asset: " + relative);
    if (found[0]!.source.sha256 !== packageSource.sha256)
      throw new Error("NPC route asset/package source fingerprint mismatch");
    return found[0]!;
  };
  const routes: Record<string, FieldNpcRouteDefinition> = {}, ids = new Set<number>();
  const aliases = map.route_instruction ?? [];
  if (!Array.isArray(aliases)) {
    issue("parse", "route-alias-array", "Invalid source route_instruction declaration", packageSource);
    report.parse.invalid++;
  } else for (const [aliasIndex, rawAlias] of aliases.entries()) {
    report.parse.declared++;
    const aliasSource = { ...packageSource, pointer: `/map/${mapIndex}/route_instruction/${aliasIndex}` };
    let routeId: number | undefined;
    let stage: "parse" | "binding" = "parse";
    try {
      const alias = record(rawAlias);
      if (Object.keys(alias).sort().join(",") !== "asset,name" || typeof alias.name !== "string")
        throw new Error("Invalid NPC route alias fields");
      stage = "binding";
      const identity = /^route_instruction_([1-9][0-9]*)$/.exec(alias.name);
      routeId = identity ? tableId(identity[1]) : undefined;
      if (!routeId || routeId > 0x7fffffff) throw new Error("Unresolved numeric NPC route alias identity");
      if (ids.has(routeId)) {
        delete routes[String(routeId)];
        throw new Error("Duplicate NPC route alias identity: " + routeId);
      }
      ids.add(routeId);
      const asset = resolve(alias.asset, "data"); report.binding.resolved++;
      stage = "parse";
      const source = parseFieldNpcRouteSource(asset.source), data = record(asset.data);
      if (Object.keys(data).join(",") !== "instruction_list" || !Array.isArray(data.instruction_list))
        throw new Error("Invalid NPC route instruction_list structure");
      const instructions = data.instruction_list.map((raw, index) => {
        const instruction = parseFieldNpcRouteRawInstruction(raw);
        return { index, kind: fieldNpcRouteInstructionKind(instruction.instruction_type), raw: instruction,
          source: { ...source, pointer: `/instruction_list/${index}` } };
      });
      const definition: FieldNpcRouteDefinition = { id: routeId, alias: alias.name, source, aliasSource, instructions };
      routes[String(routeId)] = definition; report.parse.parsed++;
      report.capability.requirements.push(...fieldNpcRouteRequirements(definition));
      issue("capability", "route-execution-unavailable", "NPC routine execution consumer is not implemented", source, { routeId });
      for (const i of instructions) if (i.kind === "unresolved") {
        report.capability.unknownInstructionTypes.push(i.raw.instruction_type);
        issue("capability", "route-instruction-type", "Unresolved NPC route instruction type " + i.raw.instruction_type, i.source, { routeId, index: i.index });
      }
    } catch (error) {
      report.parse.invalid++;
      issue(stage, stage === "binding" ? "route-binding" : "route-structure", message(error), aliasSource,
        routeId === undefined ? {} : { routeId });
    }
  }
  // Report exact MainCore calls in this map's declared script assets. This is
  // a package reference inventory, not proof those scripts/actors are reachable.
  if (Array.isArray(map.script)) for (const rawScript of map.script) {
    try {
      const script = resolve(record(rawScript).asset, "script");
      const data = record(script.data);
      if (!Array.isArray(data.Mnemonics)) throw new Error("Invalid route assignment script");
      for (const [index, raw] of data.Mnemonics.entries()) {
        const m = record(raw); if (m.mnemonic !== "AssignMoveRoute") continue;
        const operands = record(m.operands), i = operands.iValues, r = operands.rValues, s = operands.sValues;
        const valid = m.type === 1 && Array.isArray(i) && i.length === 8 && i.every(v => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) &&
          i[0] > 0 && i[1] > 0 && (i[2] === 0 || i[2] === 1) && i.slice(3).every(v => v === 0) && Array.isArray(r) && r.length === 8 && r.every(v => v === 0) &&
          Array.isArray(s) && s.length === 8 && s.every(v => v === "");
        const source = { ...parseFieldNpcRouteSource(script.source), pointer: `/Mnemonics/${index}` };
        const assignment: Assignment = { site: { script: script.id, index, source }, rawOperands: structuredClone(operands),
          entityId: valid ? i[0] : null, routeId: valid ? i[1] : null, loop: valid ? i[2] !== 0 : null,
          binding: valid && Object.hasOwn(routes, String(i[1])) ? "bound" : "unresolved" };
        report.assignments.push(assignment);
        if (assignment.binding === "unresolved") issue("binding", "assign-route-binding",
          valid ? "Assigned route is not resolved in this map package" : "Unresolved AssignMoveRoute encoding", source,
          assignment.routeId === null ? { index } : { routeId: assignment.routeId, index });
      }
    } catch (error) { issue("binding", "assignment-script", message(error), packageSource); }
  }
  report.capability.unknownInstructionTypes = [...new Set(report.capability.unknownInstructionTypes)].sort((a, b) => a - b);
  const payload = { kind: "field-npc-route-catalog-v1" as const, sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash, mapId, mapName, packageSource, routes,
    executionSupport: "none" as const, migrationReady: false as const };
  const catalog = parseFieldNpcRouteCatalog({ ...payload, contentHash: hash(payload) });
  return { catalog, diagnostics, report };
}
