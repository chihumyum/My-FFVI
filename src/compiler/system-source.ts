import { battleTableIndex } from "./battle.js";
import { loadCorpus } from "./corpus.js";
import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";

/** Reuse the supplied table identities without compiling an encounter. The
 * corpus supplies complete rows/scripts; the table export supplies Unity paths. */
export async function loadSystemSource(root: string, parentSourceSetHash: string) {
  const [corpus, tableFiles] = await Promise.all([
    loadCorpus(root), readSnapshot(root + "/build/battle"),
  ]);
  const exported = record(JSON.parse(snapshotFile(tableFiles, "battle.json").toString()));
  if (corpus.manifest.parentSourceSetHash !== parentSourceSetHash ||
      exported.parentSourceSetHash !== parentSourceSetHash ||
      hash(exported.sources) !== exported.sourceSetHash || !Array.isArray(exported.sources))
    throw new Error("System source manifest mismatch");
  const files = exported.sources.map(record);
  const sources = Object.fromEntries(Object.entries(record(exported.tableSources)).map(([table, raw]) => {
    const value = record(raw);
    for (const key of ["file", "assetPath", "objectId", "serializedFile"])
      if (typeof value[key] !== "string" || !value[key]) throw new Error("Missing source table provenance");
    if (!/^-?\d+$/.test(value.objectId as string) || files.filter((f) =>
      f.file === value.file || (typeof f.file === "string" && f.file.endsWith("/" + value.file))).length !== 1)
      throw new Error("Unbound source table provenance");
    return [table, { file: value.file as string, assetPath: value.assetPath as string,
      objectId: value.objectId as string, serializedFile: value.serializedFile as string }];
  }));
  return { ...corpus, reader: battleTableIndex(corpus.tables, sources) };
}
