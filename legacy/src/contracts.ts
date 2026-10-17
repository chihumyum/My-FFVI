import { z } from "zod";

export const Scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
export const Conditions = z.record(z.string(), Scalar);
export type Context = z.infer<typeof Conditions>;
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SourceRef = z.object({ file: z.string(), assetPath: z.string(), objectId: z.string().regex(/^-?\d+$/).optional() }).strict();
export const Fact = z.object({
  id: z.string(), subject: z.string(), predicate: z.string(), value: Scalar,
  when: Conditions, status: z.enum(["observed", "verified", "hypothesis", "contradicted"]),
  sourceSetHash: Hash, evidence: z.array(z.string()).min(1),
}).strict();
export type Fact = z.infer<typeof Fact>;
export const Asset = z.object({
  id: z.string(), version: z.string(), semanticId: z.string(), role: z.string(),
  regions: z.array(z.string()).min(1), when: Conditions,
  styleVersion: z.string(), interfaceVersion: z.string(),
  contentHash: Hash, status: z.enum(["proposed", "approved"]),
  parent: z.string().nullable(), evidence: z.array(z.string()).min(1),
}).strict();
export type Asset = z.infer<typeof Asset>;
export const Registry = z.object({
  schemaVersion: z.literal(1),
  regions: z.array(z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()), questions: z.array(z.string()) }).strict()),
  facts: z.array(Fact), assets: z.array(Asset),
}).strict();
export type Registry = z.infer<typeof Registry>;

export const Capability = z.object({
  id: z.string(), version: z.string(), status: z.enum(["unverified", "verified"]),
  sourceSetHash: Hash.nullable(), evidence: z.array(z.string()),
}).strict().superRefine((v, c) => {
  if (v.status === "verified" && (!v.sourceSetHash || !v.evidence.length))
    c.addIssue({ code: "custom", message: "Verified capabilities require source identity and evidence" });
});
export const CapabilityRegistry = z.object({ schemaVersion: z.literal(1), capabilities: z.array(Capability) }).strict();
export type Capability = z.infer<typeof Capability>;

export const ImportedProject = z.object({
  formatVersion: z.literal(1), adapterVersion: z.string(), unityPyVersion: z.string(), sourceSetHash: Hash,
  sources: z.array(z.object({ file: z.string(), sha256: Hash, bytes: z.number().int().nonnegative() }).strict()).min(1),
  regions: z.array(z.object({ id: z.string(), areaId: z.string(), nameKey: z.string(), names: z.record(z.string(), z.string()),
    maps: z.array(z.record(z.string(), z.string())), worldPhase: z.literal("unknown"), evidence: z.array(z.record(z.string(), z.unknown())) }).strict()),
  narshe: z.object({ mapName: z.string(), assets: z.record(z.string(), z.object({ source: SourceRef, data: z.unknown() }).strict()),
    textures: z.array(z.object({ source: SourceRef, name: z.string(), file: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), sha256: Hash, rowOrder: z.literal("unity-storage") }).strict()) }).strict(),
  opera: z.array(z.object({ sourceFile: z.string(), graphFile: z.string(), objectTypes: z.record(z.string(), z.number()),
    timelineClasses: z.record(z.string(), z.number()), unverified: z.array(z.string()) }).strict()),
  corpus: z.object({ bundleCount: z.number(), jsonCount: z.number(), mnemonicScriptCount: z.number(),
    opcodes: z.record(z.string(), z.number()), syscalls: z.record(z.string(), z.number()) }).strict(),
}).strict();
export type ImportedProject = z.infer<typeof ImportedProject>;

export const lanes = ["source", "structure", "behavior", "visual", "browser", "transfer"] as const;
export type Lane = typeof lanes[number];
export type Diagnostic = { code: string; location: string; detail: string; nextAction: string };
export type TargetReport = {
  target: string; sourceSetHash: string; artifactHash: string; accepted: boolean;
  lanes: Record<Lane, { status: "pass" | "fail" | "unknown"; detail: string }>;
  blockers: Diagnostic[];
};
