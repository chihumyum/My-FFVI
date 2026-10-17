import { hash, record } from "./content.js";
import type { BattleRow } from "./battle.js";
import type { BattleEventMessageInput } from "./battle-event-message.js";
import { parseBattleEventMessageBinding } from "../core/battle-event-message.js";
import { bindSystemMessages } from "./system-messages.js";
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
    if ([raw.file, raw.assetPath, raw.objectId].some(v => typeof v !== "string" || !v))
      throw new Error("Invalid battle message object identity");
    const matches = physical.filter(p => p.file === raw.file || typeof p.file === "string" && p.file.endsWith("/" + raw.file));
    if (matches.length !== 1) throw new Error("Ambiguous battle message physical source");
    return { file: String(matches[0]!.file), assetPath: String(raw.assetPath), objectId: String(raw.objectId),
      serializedFile: typeof raw.serializedFile === "string" ? raw.serializedFile : null, sha256: String(matches[0]!.sha256) };
  };
  const source = (table: string, corpusBound = true) => {
    const refs = (field.messageSources as unknown[]).map(record).filter(r => typeof r.assetPath === "string" && r.assetPath.endsWith("/" + table + ".txt"));
    if (refs.length !== 1) throw new Error("Unbound battle message object: " + table);
    if (corpusBound && hash(record(field.messages)[table]) !== hash(corpus.messages[table])) throw new Error("Battle message text/source mismatch: " + table);
    return bindFile(refs[0]!);
  };
  const full = corpus.tables["character_default_name.csv"];
  if (!full?.length || names.length !== full.length || hash(names.map(row => row.values)) !== hash(full))
    throw new Error("Battle message character-name rows/source mismatch");
  if (new Set(names.map(row => hash(row.source))).size !== names.length ||
      new Set(names.map(row => hash({ ...row.source, rowId: "" }))).size !== 1)
    throw new Error("Ambiguous battle message character-name table");
  const system = bindSystemMessages(field, String(corpus.manifest.parentSourceSetHash),
    physical.map(p => ({ file: String(p.file), sha256: String(p.sha256) })));
  const messages: Record<string,unknown> = { ...structuredClone(corpus.messages), system_zhc: structuredClone(system.messages),
      etc_text_zhc: structuredClone(record(record(field.messages).etc_text_zhc)) };
  for (const [table, values] of Object.entries(messages)) {
    if (!Object.keys(record(values)).length || Object.entries(record(values)).some(([key, value]) => !key || typeof value !== "string"))
      throw new Error("Invalid battle message dictionary: " + table);
  }
  const bodies = new Map<string, string>();
  for (const table of ["story_mes_zhc", "system_zhc", "etc_text_zhc"])
    for (const key of Object.keys(record(messages[table]))) {
      if (bodies.has(key)) throw new Error("Duplicate battle message body key across dictionaries: " + key);
      bodies.set(key, table);
    }
  const row = (role: string, bound: ReturnType<typeof bindFile>, values: unknown) => ({
    role, source: bound, contentHash: hash(values), rowCount: Array.isArray(values) ? values.length : Object.keys(record(values)).length });
  const binding = parseBattleEventMessageBinding({ kind: "battle-event-message-binding-v2",
    routing: "native-shared-message-dictionaries-v1",
    sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    sources: [row("body", source("story_mes_zhc"), messages.story_mes_zhc), row("speaker", source("story_cha_zhc"), messages.story_cha_zhc),
      row("character-names", bindFile(names[0]!.source), full), row("system-body", bindFile(system.source), messages.system_zhc),
      row("etcetera-body", source("etc_text_zhc", false), messages.etc_text_zhc)] });
  return { messages, characterNames: structuredClone(full), binding };
}
