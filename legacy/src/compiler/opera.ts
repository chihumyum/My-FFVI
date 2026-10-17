import { z } from "zod";
import type { Diagnostic } from "../contracts.js";
import { hash, localPointerKey, makeReport, record } from "./content.js";

const ObjectSchema = z.object({ file: z.string(), id: z.string().regex(/^-?\d+$/), type: z.string(),
  class: z.string().nullable(), assembly: z.string().nullable(), data: z.record(z.string(), z.unknown()) }).strict();
export const OperaGraph = z.object({ objects: z.array(ObjectSchema), externalFiles: z.record(z.string(), z.array(z.unknown())) }).strict();
export type OperaGraph = z.infer<typeof OperaGraph>;

export function inspectOpera(graphs: { sourceFile: string; graph: OperaGraph }[], sourceSetHash: string) {
  const tracks: { sourceFile: string; file: string; objectId: string; name: string; type: string; clips: { start: number; duration: number; label: string; asset: unknown }[] }[] = [];
  const cameras: { sourceFile: string; file: string; id: string; orthographic: unknown; size: unknown; fieldOfView: unknown }[] = [];
  const diagnostics: Diagnostic[] = [];
  let externalReferences = 0;
  let unresolvedLocalReferences = 0;
  for (const { sourceFile, graph } of graphs) {
    const keys = graph.objects.map(o => `${o.file}:${o.id}`);
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate Unity object identity");
    const known = new Set(keys);
    for (const object of graph.objects) {
      if (object.type === "Camera") cameras.push({ sourceFile, file: object.file, id: object.id, orthographic: object.data.orthographic ?? null,
        size: object.data["orthographic size"] ?? null, fieldOfView: object.data["field of view"] ?? null });
      if (object.class?.endsWith("Track") && object.assembly === "Unity.Timeline.dll") {
        const raw = object.data.m_Clips;
        if (raw !== undefined && !Array.isArray(raw)) throw new Error("Malformed Timeline clips");
        const clips = (raw as unknown[] | undefined ?? []).map(c => {
          const clip = record(c);
          if (typeof clip.m_Start !== "number" || !Number.isFinite(clip.m_Start)
            || typeof clip.m_Duration !== "number" || !Number.isFinite(clip.m_Duration) || clip.m_Duration < 0)
            throw new Error(`Unsupported clip time: ${object.id}`);
          return { start: clip.m_Start, duration: clip.m_Duration, label: String(clip.m_DisplayName ?? ""), asset: clip.m_Asset ?? null };
        });
        tracks.push({ sourceFile, file: object.file, objectId: object.id, name: String(object.data.m_Name ?? ""), type: object.class, clips });
      }
      const walk = (value: unknown) => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (!value || typeof value !== "object") return;
        const v = record(value);
        if ("m_FileID" in v && "m_PathID" in v) {
          if (typeof v.m_PathID !== "string" || !/^-?\d+$/.test(v.m_PathID) || !Number.isInteger(v.m_FileID)) throw new Error("Lossy Unity pointer");
          if (v.m_PathID === "0") return;
          if (v.m_FileID !== 0) { externalReferences++; return; }
          const key = localPointerKey(object.file, v);
          if (key && !known.has(key)) unresolvedLocalReferences++;
        } else Object.values(v).forEach(walk);
      };
      walk(object.data);
    }
  }
  diagnostics.push({ code: "OPERA_DEPENDENCY_CLOSURE_OPEN", location: "opera", detail: `${externalReferences} external pointer occurrences; ${unresolvedLocalReferences} local pointer occurrences outside inspected object subset`, nextAction: "Resolve referenced serialized files and remaining object types; choose an active timeline root" });
  diagnostics.push({ code: "TIMELINE_SEMANTICS_UNVERIFIED", location: "opera", detail: "Track decoding does not establish playback, audio synchronization, materials or postprocessing", nextAction: "Capture and compare a bounded original-game segment" });
  const artifact = { formatVersion: 1, kind: "inspection-package", sourceSetHash, target: "opera", tracks, cameras,
    graphCount: graphs.length, externalReferences, unresolvedLocalReferences, diagnostics };
  return { artifact, report: makeReport("opera", sourceSetHash, hash(artifact), diagnostics) };
}
