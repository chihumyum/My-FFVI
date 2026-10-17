/** Immutable content only. Actor position, clocks, controller ownership and
 * event state remain with the field host; this catalog grants no execution. */
export type FieldNpcRouteSource = {
  file: string; assetPath: string; objectId: string; serializedFile: string;
  sha256: string; pointer?: string;
};
export type FieldNpcRouteRawInstruction = {
  instruction_type: number;
  speed_id?: number; animation_key?: string; cellx?: number; celly?: number;
  layer?: number; speed_scale?: number; loop_cnt?: number; delay_sec?: number;
  frame?: number; duration?: number; jump_height?: number; se_id?: number;
  seek_time?: number; position?: number; category?: number; index?: number; value?: number;
};
export type FieldNpcRouteInstructionKind = "move-to" | "delay" | "play-animation" |
  "cue-animation" | "show" | "hide" | "move-lerp" | "play-se" | "set-variable" |
  "compare-variable" | "unresolved";
export type FieldNpcRouteRequirement = {
  routeId: number; index: number;
  capability: "actor-motion" | "map-pathfinding" | "map-range" | "npc-controller-clock" |
    "actor-animation" | "actor-visibility" | "actor-lerp" | "sound-presentation" |
    "audio-readiness" | "event-state" | "native-route-consumer";
};
export type FieldNpcRouteInstruction = {
  index: number; kind: FieldNpcRouteInstructionKind; raw: FieldNpcRouteRawInstruction;
  source: FieldNpcRouteSource;
};
export type FieldNpcRouteDefinition = {
  id: number; alias: string; source: FieldNpcRouteSource; aliasSource: FieldNpcRouteSource;
  /** Exact source fields, including absent fields; no guessed defaults. */
  instructions: FieldNpcRouteInstruction[];
};
export type FieldNpcRouteCatalog = {
  kind: "field-npc-route-catalog-v1"; contentHash: string;
  sourceSetHash: string; parentSourceSetHash: string; mapId: number; mapName: string;
  packageSource: FieldNpcRouteSource; routes: Record<string, FieldNpcRouteDefinition>;
  executionSupport: "none"; migrationReady: false;
};
const kinds: Record<number, FieldNpcRouteInstructionKind> = {
  1: "move-to", 2: "delay", 3: "play-animation", 4: "cue-animation", 5: "show",
  6: "hide", 7: "move-lerp", 8: "play-se", 9: "set-variable", 10: "compare-variable",
};
export function fieldNpcRouteInstructionKind(type: number): FieldNpcRouteInstructionKind {
  return kinds[type] ?? "unresolved";
}
const integerKeys = ["instruction_type", "speed_id", "cellx", "celly", "layer", "loop_cnt", "se_id", "category", "index", "value"];
const floatKeys = ["speed_scale", "delay_sec", "frame", "duration", "jump_height", "seek_time", "position"];
const digest = /^[a-f0-9]{64}$/;
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
      Reflect.ownKeys(raw).some(k => typeof k !== "string") ||
      Object.values(Object.getOwnPropertyDescriptors(raw)).some(d => !d.enumerable || !("value" in d)))
    throw new Error("Invalid NPC route record");
  return raw as Record<string, unknown>;
}
function fields(raw: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(raw, k)) || Object.keys(raw).some(k => ![...required, ...optional].includes(k)))
    throw new Error("Invalid NPC route fields");
}
function text(raw: unknown): string {
  if (typeof raw !== "string" || !raw) throw new Error("Invalid NPC route string");
  return raw;
}
function integer(raw: unknown, positive = false): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < (positive ? 1 : -0x80000000) || raw > 0x7fffffff)
    throw new Error("Invalid NPC route integer");
  return raw;
}
function hash(raw: unknown): string {
  if (typeof raw !== "string" || !digest.test(raw)) throw new Error("Invalid NPC route digest");
  return raw;
}
export function parseFieldNpcRouteSource(raw: unknown): FieldNpcRouteSource {
  const v = object(raw); fields(v, ["file", "assetPath", "objectId", "serializedFile", "sha256"], ["pointer"]);
  if (typeof v.objectId !== "string" || !/^-?\d+$/.test(v.objectId)) throw new Error("Invalid NPC route decimal object identity");
  const source: FieldNpcRouteSource = { file: text(v.file), assetPath: text(v.assetPath),
    objectId: v.objectId, serializedFile: text(v.serializedFile), sha256: hash(v.sha256) };
  if (Object.hasOwn(v, "pointer")) source.pointer = text(v.pointer);
  return source;
}
/** Structural decoding does not reinterpret native single values as ms,
 * normalize coordinates, supply missing fields or grant opcode semantics. */
export function parseFieldNpcRouteRawInstruction(raw: unknown): FieldNpcRouteRawInstruction {
  const v = object(raw); fields(v, ["instruction_type"], [...integerKeys.slice(1), ...floatKeys, "animation_key"]);
  for (const key of Object.keys(v)) {
    if (integerKeys.includes(key)) integer(v[key]);
    else if (key === "animation_key") {
      if (typeof v[key] !== "string") throw new Error("Invalid NPC route animation key");
    } else if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || !Number.isFinite(Math.fround(v[key] as number)))
      throw new Error("Invalid NPC route single value");
  }
  return structuredClone(v) as FieldNpcRouteRawInstruction;
}
export function parseFieldNpcRouteCatalog(raw: unknown): FieldNpcRouteCatalog {
  const v = object(raw); fields(v, ["kind", "contentHash", "sourceSetHash", "parentSourceSetHash", "mapId", "mapName", "packageSource", "routes", "executionSupport", "migrationReady"]);
  if (v.kind !== "field-npc-route-catalog-v1" || v.executionSupport !== "none" || v.migrationReady !== false)
    throw new Error("Unimplemented NPC route execution contract");
  const packageSource = parseFieldNpcRouteSource(v.packageSource);
  const routes = object(v.routes), copied: Record<string, FieldNpcRouteDefinition> = {};
  for (const [key, rawRoute] of Object.entries(routes)) {
    const r = object(rawRoute); fields(r, ["id", "alias", "source", "aliasSource", "instructions"]);
    const id = integer(r.id, true), alias = text(r.alias), source = parseFieldNpcRouteSource(r.source),
      aliasSource = parseFieldNpcRouteSource(r.aliasSource);
    if (key !== String(id) || alias !== `route_instruction_${id}` || !Array.isArray(r.instructions))
      throw new Error("NPC route identity disagrees with package alias");
    if (source.file !== packageSource.file || source.sha256 !== packageSource.sha256 ||
        ["file", "assetPath", "objectId", "serializedFile", "sha256"].some(k => aliasSource[k as keyof FieldNpcRouteSource] !== packageSource[k as keyof FieldNpcRouteSource]) ||
        !/^\/map\/(0|[1-9][0-9]*)\/route_instruction\/(0|[1-9][0-9]*)$/.test(aliasSource.pointer ?? ""))
      throw new Error("NPC route package/source binding mismatch");
    const instructions = r.instructions.map((rawInstruction, index): FieldNpcRouteInstruction => {
      const i = object(rawInstruction); fields(i, ["index", "kind", "raw", "source"]);
      const instruction = parseFieldNpcRouteRawInstruction(i.raw), evidence = parseFieldNpcRouteSource(i.source);
      if (i.index !== index || i.kind !== fieldNpcRouteInstructionKind(instruction.instruction_type) ||
          evidence.pointer !== `/instruction_list/${index}` ||
          ["file", "assetPath", "objectId", "serializedFile", "sha256"].some(k => evidence[k as keyof FieldNpcRouteSource] !== source[k as keyof FieldNpcRouteSource]))
        throw new Error("NPC route instruction/source binding mismatch");
      return { index, kind: fieldNpcRouteInstructionKind(instruction.instruction_type), raw: instruction, source: evidence };
    });
    copied[key] = { id, alias, source, aliasSource, instructions };
  }
  return { kind: "field-npc-route-catalog-v1", contentHash: hash(v.contentHash), sourceSetHash: hash(v.sourceSetHash),
    parentSourceSetHash: hash(v.parentSourceSetHash), mapId: integer(v.mapId, true), mapName: text(v.mapName),
    packageSource, routes: copied, executionSupport: "none", migrationReady: false };
}
export function fieldNpcRouteRequirements(route: FieldNpcRouteDefinition): FieldNpcRouteRequirement[] {
  const byType: Record<number, FieldNpcRouteRequirement["capability"][]> = {
    1: ["actor-motion", "map-pathfinding", "map-range", "npc-controller-clock"],
    2: ["npc-controller-clock"], 3: ["actor-animation", "npc-controller-clock"],
    4: ["actor-animation"], 5: ["actor-visibility"], 6: ["actor-visibility"],
    7: ["actor-lerp", "map-range", "npc-controller-clock"],
    8: ["audio-readiness", "sound-presentation"], 9: ["event-state"], 10: ["event-state"],
  };
  return route.instructions.flatMap(i => [...(byType[i.raw.instruction_type] ?? []), "native-route-consumer" as const]
    .map(capability => ({ routeId: route.id, index: i.index, capability })));
}
