import type { BattleAISource } from "../core/battle-ai.js";
import type { SourceFormatFlagImportBinding } from "./source-system-flags.js";
import { bindSourceFormatFlags, decodeSourceSystemFlags } from "./source-system-flags.js";
import { hash } from "./content.js";

type Asset = { kind: string; source: { file: string; assetPath: string; objectId?: string;
  serializedFile: string; sha256: string }; data: unknown };
type Snapshot = { sourceSetHash: string; manifest: { parentSourceSetHash: string; sources: unknown }; assets: readonly Asset[] };
export type BattleSourceFormatImportResolver = (script: { data: unknown; source: BattleAISource }) => SourceFormatFlagImportBinding;

/** Called with loadCorpus/loadSystemSource's hash-verified snapshot. Resolve
 * the actual Format script by its entire physical identity, never by a script
 * label, nearest asset or a caller-provided normalized JSON object. */
export function createBattleSourceFormatImportResolver(snapshot: Snapshot): BattleSourceFormatImportResolver {
  const manifest = { sourceSetHash: snapshot.sourceSetHash, parentSourceSetHash: snapshot.manifest.parentSourceSetHash,
    sources: structuredClone(snapshot.manifest.sources) };
  const assets = snapshot.assets.filter(asset => asset.kind === "script").map(asset =>
    ({ source: structuredClone(asset.source), data: asset.data, rawHash: hash(asset.data) }));
  return script => {
    if (script.source.sourceSetHash !== manifest.parentSourceSetHash)
      throw new Error("Battle Format import belongs to another source set");
    const found = assets.filter(asset => (asset.source.file === script.source.file ||
        asset.source.file.endsWith("/" + script.source.file)) &&
      ["assetPath", "objectId", "serializedFile", "sha256"].every(key =>
        asset.source[key as keyof typeof asset.source] === script.source[key as keyof BattleAISource]));
    if (found.length !== 1 || hash(found[0]!.data) !== found[0]!.rawHash || found[0]!.rawHash !== hash(script.data))
      throw new Error("Missing, ambiguous or changed physical battle Format source");
    const binding = bindSourceFormatFlags(manifest, found[0]!);
    // Validate the raw own-data object and explicit values before exporting the
    // binding. Whole-object omission/null and unknown members remain failures.
    decodeSourceSystemFlags(script.data, binding);
    return binding;
  };
}
