import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";

/** System item names live in the verified message bundle exported with field
 * media. The story corpus alone contains no system_zhc table. */
export function bindSystemMessages(
  field: Record<string, unknown>,
  parentSourceSetHash: string,
  expectedSources: readonly { file: string; sha256: string }[],
) {
  if (field.formatVersion !== 1 || field.adapterVersion !== "field-0.1.1" ||
      field.parentSourceSetHash !== parentSourceSetHash || !Array.isArray(field.sources) ||
      field.sourceSetHash !== hash(field.sources) || !Array.isArray(field.messageSources))
    throw new Error("System message source manifest mismatch");
  const files = field.sources.map(record);
  for (const file of files)
    if (!expectedSources.some((s) => s.file === file.file && s.sha256 === file.sha256))
      throw new Error("Foreign system message source file");
  const refs = field.messageSources.map(record).filter((r) =>
    typeof r.assetPath === "string" && r.assetPath.endsWith("/system_zhc.txt"));
  if (refs.length !== 1) throw new Error("Missing or ambiguous system message object");
  const ref = refs[0]!;
  if (typeof ref.file !== "string" || typeof ref.objectId !== "string" || !/^-?\d+$/.test(ref.objectId))
    throw new Error("Invalid system message object identity");
  const bound = files.filter((s) => s.file === ref.file ||
    typeof s.file === "string" && s.file.endsWith("/" + ref.file));
  if (bound.length !== 1) throw new Error("Unbound system message object");
  const messages = record(record(field.messages).system_zhc);
  if (!Object.keys(messages).length || Object.values(messages).some((v) => typeof v !== "string"))
    throw new Error("Invalid system message table");
  return { messages, source: { file: ref.file, assetPath: ref.assetPath as string,
    objectId: ref.objectId, sourceSetHash: field.sourceSetHash as string,
    sha256: bound[0]!.sha256 as string } };
}

export async function loadSystemMessages(root: string, parentSourceSetHash: string,
  expectedSources: readonly { file: string; sha256: string }[]) {
  const files = await readSnapshot(root + "/build/field");
  return bindSystemMessages(record(JSON.parse(snapshotFile(files, "field.json").toString())),
    parentSourceSetHash, expectedSources);
}
