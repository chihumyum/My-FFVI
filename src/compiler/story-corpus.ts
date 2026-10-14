import type { Op } from "../field/types.js";
import type { ScriptLocals } from "../core/event-state.js";
import { Hash } from "../contracts.js";
import {
  analyzeCorpus,
  CorpusAsset,
  instructionFamily,
  type loadCorpus,
} from "./corpus.js";
import { canonical, hash, record } from "./content.js";
import { decodeFieldOp, decodeScriptLocals } from "./field.js";

export type StoryCorpusSnapshot = Pick<
  Awaited<ReturnType<typeof loadCorpus>>,
  "assets" | "tables" | "messages" | "sourceSetHash"
> & { manifest?: Record<string, unknown> };
export type StoryCorpusSite = {
  script: string;
  index: number;
  source: CorpusAsset["source"] & { pointer: string };
  maps: string[];
};
export type StoryCorpusDiagnostic = {
  code: "FIELD_OPERAND_BLOCKED" | "FIELD_OPERAND_REJECTED" | "FIELD_LOCALS_REJECTED";
  reason: string;
};
export type StoryCorpusInstruction = {
  site: StoryCorpusSite;
  family: string;
  raw: unknown;
  rawPreserved: true;
  /** Acceptance by an operand adapter is independent of runnable admission. */
  operandDecoded: "decoded" | "blocked" | "unassessed";
  decoded: Op | null;
  diagnostic: StoryCorpusDiagnostic | null;
  runtimeAdmission: "unassessed";
};
export type StoryCorpusScript = {
  id: string;
  source: CorpusAsset["source"];
  /** Includes every source key, including Mnemonics, Segments and local banks. */
  raw: unknown;
  rawHash: string;
  rawPreserved: true;
  domain: "field" | "not-assessed-by-field-runtime";
  maps: string[];
  locals: {
    operandDecoded: "decoded" | "blocked" | "unassessed";
    decoded: ScriptLocals | null;
    diagnostic: StoryCorpusDiagnostic | null;
  };
  instructions: StoryCorpusInstruction[];
  runtimeAdmission: "unassessed";
  storyReachability: "unassessed";
};
export type StoryCorpusGap = {
  id: string;
  family: string;
  code: StoryCorpusDiagnostic["code"];
  reason: string;
  /** Full locations, never a truncated sample or a count standing in for sites. */
  sites: StoryCorpusSite[];
};

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rejected = (error: unknown) => error instanceof Error ? error.message : String(error);
function mnemonics(raw: unknown): unknown[] {
  const value = record(raw).Mnemonics;
  if (!Array.isArray(value)) throw new Error("Story corpus script requires a Mnemonics array");
  return value;
}

/** A lossless, whole-corpus inspection IR. It deliberately cannot certify a
 * runnable game: package membership, operand decoding and plot reachability
 * are separate evidence. No source instruction is omitted or renumbered.
 * Snapshot integrity must be established by the caller's verified loader. */
export function compileStoryCorpus(snapshot: StoryCorpusSnapshot) {
  const sourceSetHash = Hash.parse(snapshot.sourceSetHash);
  const assets = snapshot.assets.map(asset => CorpusAsset.parse(asset))
    .sort((a, b) => compare(a.id, b.id));
  // Validate JSON serializability without altering source values (especially
  // decimal-string Unity identities). The raw bodies are detached from input.
  assets.forEach(asset => canonical(asset.data));
  const analysis = analyzeCorpus(assets, snapshot.tables, snapshot.messages, sourceSetHash);
  const reports = new Map(analysis.scripts.map(script => [script.id, script]));
  const gaps = new Map<string, StoryCorpusGap>();
  const addGap = (family: string, diagnostic: StoryCorpusDiagnostic, site: StoryCorpusSite) => {
    const id = hash({ family, code: diagnostic.code, reason: diagnostic.reason });
    if (!gaps.has(id)) gaps.set(id, { id, family, ...diagnostic, sites: [] });
    gaps.get(id)!.sites.push(structuredClone(site));
  };
  const scripts: StoryCorpusScript[] = assets.filter(asset => asset.kind === "script")
    .map(asset => {
      const report = reports.get(asset.id)!;
      const raw = structuredClone(asset.data), ops = mnemonics(raw);
      const field = report.domain === "field";
      const source = structuredClone(asset.source), maps = [...report.maps];
      const instructions = ops.map((instruction, index): StoryCorpusInstruction => {
        const site: StoryCorpusSite = {
          script: asset.id, index,
          source: { ...source, pointer: `/Mnemonics/${index}` }, maps: [...maps],
        };
        const family = instructionFamily(instruction);
        let decoded: Op | null = null, diagnostic: StoryCorpusDiagnostic | null = null;
        let operandDecoded: StoryCorpusInstruction["operandDecoded"] = "unassessed";
        if (field) {
          try {
            decoded = decodeFieldOp(instruction, {
              script: site.script, index, source: site.source,
            }, snapshot.messages, snapshot.tables, {
              nextMnemonic: index + 1 < ops.length ? String(record(ops[index + 1]).mnemonic) : null,
            });
            if (decoded.kind === "blocked") {
              operandDecoded = "blocked";
              diagnostic = { code: "FIELD_OPERAND_BLOCKED", reason: decoded.reason };
            } else operandDecoded = "decoded";
          } catch (error) {
            operandDecoded = "blocked";
            diagnostic = { code: "FIELD_OPERAND_REJECTED", reason: rejected(error) };
            // A rejected adapter has the same executable stop/address as an
            // explicit unsupported form; no following address shifts.
            decoded = { script: site.script, index, source: site.source, kind: "blocked",
              mnemonic: String(record(instruction).mnemonic), reason: diagnostic.reason };
          }
          if (diagnostic) addGap(family, diagnostic, site);
        }
        return { site, family, raw: instruction, rawPreserved: true,
          operandDecoded, decoded, diagnostic, runtimeAdmission: "unassessed" };
      });
      const locals: StoryCorpusScript["locals"] = {
        operandDecoded: "unassessed", decoded: null, diagnostic: null,
      };
      if (field) {
        try {
          locals.decoded = decodeScriptLocals(raw);
          locals.operandDecoded = "decoded";
        } catch (error) {
          locals.operandDecoded = "blocked";
          locals.diagnostic = { code: "FIELD_LOCALS_REJECTED", reason: rejected(error) };
          addGap("ScriptLocal", locals.diagnostic, {
            script: asset.id, index: -1,
            source: { ...source, pointer: "/ScriptLocal" }, maps: [...maps],
          });
        }
      }
      return { id: asset.id, source, raw, rawHash: hash(raw), rawPreserved: true,
        domain: report.domain as StoryCorpusScript["domain"], maps, locals, instructions,
        runtimeAdmission: "unassessed", storyReachability: "unassessed" };
    });
  const allInstructions = scripts.flatMap(script => script.instructions);
  const sourceInstructions = assets.filter(asset => asset.kind === "script")
    .reduce((count, asset) => count + mnemonics(asset.data).length, 0);
  if (scripts.length !== analysis.counts.scripts || allInstructions.length !== sourceInstructions ||
      sourceInstructions !== analysis.counts.instructions)
    throw new Error("Story corpus instruction/script conservation failed");
  for (const script of scripts) {
    const source = assets.find(asset => asset.id === script.id)!;
    if (hash(source.data) !== script.rawHash || script.instructions.some((instruction, index) =>
      instruction.site.index !== index || hash(instruction.raw) !== hash(mnemonics(source.data)[index])))
      throw new Error("Story corpus raw preservation failed: " + script.id);
  }
  const capabilityGaps = [...gaps.values()].sort((a, b) =>
    compare(a.family, b.family) || compare(a.code, b.code) || compare(a.reason, b.reason));
  const result = {
    formatVersion: 1 as const,
    kind: "story-corpus-v1" as const,
    compilerVersion: "story-corpus-1",
    sourceSetHash,
    manifest: snapshot.manifest ? structuredClone(snapshot.manifest) : null,
    rawPreserved: true as const,
    runtimeAdmission: "unassessed" as const,
    storyReachability: "unassessed" as const,
    counts: {
      scripts: scripts.length,
      fieldScripts: scripts.filter(script => script.domain === "field").length,
      unassessedScripts: scripts.filter(script => script.domain !== "field").length,
      instructions: allInstructions.length,
      rawPreservedInstructions: allInstructions.length,
      operandDecodedInstructions: allInstructions.filter(op => op.operandDecoded === "decoded").length,
      operandBlockedInstructions: allInstructions.filter(op => op.operandDecoded === "blocked").length,
      operandUnassessedInstructions: allInstructions.filter(op => op.operandDecoded === "unassessed").length,
      operandGapGroups: capabilityGaps.length,
      resolvedDependencies: analysis.dependencies.filter(dependency => dependency.resolved).length,
      unresolvedDependencies: analysis.dependencies.filter(dependency => !dependency.resolved).length,
    },
    sourceIndex: assets.map(asset => ({ id: asset.id, kind: asset.kind,
      source: structuredClone(asset.source), dataHash: hash(asset.data) })),
    scripts,
    // This preserves every map binding, dependency candidate and unresolved
    // reference from the existing analysis; no selection or truncation occurs.
    analysis,
    capabilityGaps,
    limitations: [
      "Lossless compilation is an inspection artifact, never a runnable-content admission.",
      "Field decoding is applied only to scripts bound by existing map package/Resident resolution.",
      "Battle/AI and unbound scripts retain full source bodies and remain unassessed by the field adapter.",
      "Gap groups cover exact operand/locals diagnostics only; runtime providers and all story paths remain unassessed.",
      "Every dependency reported by existing corpus analysis is retained; unknown/dynamic dependencies are not guessed.",
      "Source integrity is established by the caller's verified snapshot loader, not inferred from a supplied hash.",
    ],
  };
  return { ...result, contentHash: hash(result) };
}
export type StoryCorpus = ReturnType<typeof compileStoryCorpus>;
