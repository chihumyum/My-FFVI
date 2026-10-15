import { hash, record } from "./content.js";
import type { BattleRow } from "./battle.js";
import type { BattleEventMessageInput } from "./battle-event-message.js";
import { parseBattleEventMessageBinding } from "../core/battle-event-message.js";
/** Reuse the already verified field message export and full system reader.
 * Every source value is compared with the verified corpus, never a public or
 * previous battle catalog. Field exports omit the CAB name: preserve null,
 * retaining the exact file/path/objectId/SHA instead of inventing that field. */
export function bindBattleEventMessageInput(field: Record<string, unknown>, corpus: {
  sourceSetHash: string; manifest: Record<string, unknown>; messages: Record<string, unknown>;
  tables: Record<string, Record<string, string>[]>;
}, names: readonly BattleRow[]): BattleEventMessageInput {
  const physical = (corpus.manifest.sources as unknown[]).map(record), fieldFiles = (field.sources as unknown[]).map(record);
  if (field.parentSourceSetHash !== corpus.manifest.parentSourceSetHash || hash(field.sources) !== field.sourceSetHash ||
      hash(corpus.manifest.sources) !== corpus.sourceSetHash || !Array.isArray(field.messageSources))
    throw new Error("Battle message source manifest mismatch");
  for (const f of fieldFiles) if (!physical.some(p => p.file === f.file && p.sha256 === f.sha256))
    throw new Error("Foreign battle message source file");
  const bindFile = (raw: Record<string, unknown>) => {
    const matches = physical.filter(p => p.file === raw.file || typeof p.file === "string" && p.file.endsWith("/" + raw.file));
    if (matches.length !== 1) throw new Error("Ambiguous battle message physical source");
    return { file: String(matches[0]!.file), assetPath: String(raw.assetPath), objectId: String(raw.objectId),
      serializedFile: typeof raw.serializedFile === "string" ? raw.serializedFile : null, sha256: String(matches[0]!.sha256) };
  };
  const source = (table: string) => {
    const refs = (field.messageSources as unknown[]).map(record).filter(r => typeof r.assetPath === "string" && r.assetPath.endsWith("/" + table + ".txt"));
    if (refs.length !== 1) throw new Error("Unbound battle message object: " + table);
    if (hash(record(field.messages)[table]) !== hash(corpus.messages[table])) throw new Error("Battle message text/source mismatch: " + table);
    return bindFile(refs[0]!);
  };
  const full = corpus.tables["character_default_name.csv"];
  if (!full?.length || names.length !== full.length || hash(names.map(row => row.values)) !== hash(full))
    throw new Error("Battle message character-name rows/source mismatch");
  if (new Set(names.map(row => hash(row.source))).size !== names.length ||
      new Set(names.map(row => hash({ ...row.source, rowId: "" }))).size !== 1)
    throw new Error("Ambiguous battle message character-name table");
  const binding = parseBattleEventMessageBinding({ kind: "battle-event-message-binding-v1",
    sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    sources: [{ role: "body", source: source("story_mes_zhc") }, { role: "speaker", source: source("story_cha_zhc") },
      { role: "character-names", source: bindFile(names[0]!.source) }] });
  return { messages: structuredClone(corpus.messages), characterNames: structuredClone(full), binding };
}
