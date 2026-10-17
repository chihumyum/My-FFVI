import { createHash } from "node:crypto";
import type { Capability, Diagnostic, ImportedProject, TargetReport } from "../contracts.js";
import { lanes } from "../contracts.js";

import { canonical } from "../core/canonical.js";
export { canonical } from "../core/canonical.js";
export function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
  return value as Record<string, unknown>;
}
export function requiredCapabilities(script: unknown): string[] {
  const x = record(script);
  if (!Array.isArray(x.Mnemonics)) throw new Error("Expected Mnemonics array");
  const requirements = new Set<string>();
  for (const raw of x.Mnemonics) {
    const m = record(raw);
    if (typeof m.mnemonic !== "string") throw new Error("Instruction name missing");
    // Exact parameter form and the enclosing type remain in the signature. Name coverage alone is insufficient.
    requirements.add(`instruction:${m.mnemonic}:${hash({ operands: m.operands, type: m.type })}`);
  }
  return [...requirements].sort();
}
export function capabilityGaps(required: string[], registry: Capability[], sourceSetHash: string): string[] {
  const ids = registry.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate capability owner");
  const verified = new Set(registry.filter(c => c.status === "verified" && c.sourceSetHash === sourceSetHash && c.evidence.length).map(c => c.id));
  return [...new Set(required)].filter(id => !verified.has(id)).sort();
}
export function localPointerKey(file: string, pointer: unknown): string | null {
  const ref = record(pointer);
  if (!Number.isInteger(ref.m_FileID) || typeof ref.m_PathID !== "string" || !/^-?\d+$/.test(ref.m_PathID)) throw new Error("Invalid Unity reference identity");
  if (ref.m_PathID === "0") return null;
  if (ref.m_FileID !== 0) throw new Error("External reference requires explicit file resolution");
  return `${file}:${ref.m_PathID}`;
}
export function acceptance(report: TargetReport): boolean {
  return report.blockers.length === 0 && lanes.every(lane => report.lanes[lane]?.status === "pass");
}

export function compileNarshe(project: ImportedProject, capabilities: Capability[]) {
  const assets = Object.values(project.narshe.assets);
  const tilemaps = assets.filter(a => a.source.assetPath.endsWith("/tilemap.json"));
  if (tilemaps.length !== 1) throw new Error("Expected exactly one selected Narshe map");
  const tilemap = record(tilemaps[0]!.data);
  const scripts = assets.filter(a => a.data && typeof a.data === "object" && !Array.isArray(a.data) && "Mnemonics" in a.data);
  const required = [...new Set(scripts.flatMap(s => requiredCapabilities(s.data)))].sort();
  const capabilitySites: Record<string, { source: typeof scripts[number]["source"]; instructionIndex: number }[]> = {};
  for (const script of scripts) {
    const instructions = record(script.data).Mnemonics as unknown[];
    instructions.forEach((instruction, instructionIndex) => {
      const id = requiredCapabilities({ Mnemonics: [instruction] })[0]!;
      (capabilitySites[id] ??= []).push({ source: script.source, instructionIndex });
    });
  }
  const gaps = capabilityGaps(required, capabilities, project.sourceSetHash);
  const diagnostics: Diagnostic[] = [];
  for (const key of ["width", "height", "tilewidth", "tileheight"])
    if (!Number.isInteger(tilemap[key]) || Number(tilemap[key]) <= 0) throw new Error(`Invalid map ${key}`);
  const textures = new Set(project.narshe.textures.map(t => `${t.name}.png`));
  const checkLayers = (layers: unknown) => {
    if (!Array.isArray(layers)) throw new Error("Invalid layers");
    for (const raw of layers) {
      const l = record(raw);
      if (l.type === "group") checkLayers(l.layers);
      else if (l.type === "tilelayer") {
        if (!Array.isArray(l.data) || l.data.length !== Number(l.width) * Number(l.height)) throw new Error(`Tile count mismatch: ${l.name}`);
        if (l.data.some(v => !Number.isInteger(v) || v < 0 || v > 0xffffffff)) throw new Error(`Invalid tile GID: ${l.name}`);
      } else if (l.type === "imagelayer") {
        if (typeof l.image !== "string" || !textures.has(l.image)) diagnostics.push({ code: "IMAGE_REFERENCE_UNRESOLVED", location: String(l.name), detail: String(l.image), nextAction: "Resolve the Addressables image dependency before visual acceptance" });
      } else diagnostics.push({ code: "LAYER_TYPE_UNSUPPORTED", location: String(l.name), detail: String(l.type), nextAction: "Define layer conversion semantics" });
    }
  };
  checkLayers(tilemap.layers);
  for (const id of gaps) {
    const site = capabilitySites[id]![0]!;
    diagnostics.push({ code: "CAPABILITY_UNVERIFIED", location: `${site.source.assetPath}#/Mnemonics/${site.instructionIndex}`,
      detail: `${id}: no source-bound behavior evidence`, nextAction: "Inspect implementation and compare an original-game fixture; capabilitySites lists every source use" });
  }
  diagnostics.push({ code: "STORY_STATE_UNKNOWN", location: project.narshe.mapName, detail: "Map-region binding does not establish plot applicability", nextAction: "Trace map/variant selection and capture the opening state" });
  const artifact = { formatVersion: 1, kind: "inspection-package", sourceSetHash: project.sourceSetHash,
    target: "narshe", tilemap, source: tilemaps[0]!.source, textures: project.narshe.textures,
    collision: assets.filter(a => a.source.assetPath.endsWith("/collision.json")),
    entities: assets.filter(a => a.source.assetPath.endsWith("/entity_default.json")),
    scriptCount: scripts.length, requiredCapabilities: required, capabilitySites, diagnostics };
  return { artifact, report: makeReport("narshe", project.sourceSetHash, hash(artifact), diagnostics) };
}

export function makeReport(target: string, sourceSetHash: string, artifactHash: string, blockers: Diagnostic[]): TargetReport {
  const report: TargetReport = { target, sourceSetHash, artifactHash, accepted: false, blockers,
    lanes: {
      source: { status: "pass", detail: "Source hashes checked at import; exported snapshot bytes verified at compile. This is not a live original-game check." },
      structure: { status: "unknown", detail: "Decoded inspection subset; unresolved semantic/dependency coverage remains" },
      behavior: { status: "unknown", detail: "No independent original-game replay comparison" },
      visual: { status: "unknown", detail: "No original-scene visual equivalence review" },
      browser: { status: "unknown", detail: "Workbench inspection is not target game acceptance" },
      transfer: { status: "unknown", detail: "Held-out map/scene generalization not yet tested" },
    } };
  report.accepted = acceptance(report); return report;
}
