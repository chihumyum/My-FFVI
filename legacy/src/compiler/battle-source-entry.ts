import { compileBattleEntryCatalog, compileNarsheOwnedConditionCheckpoint } from "./battle-entry.js";

type Reader = Parameters<typeof compileBattleEntryCatalog>[0];
type Tables = Parameters<typeof compileBattleEntryCatalog>[1];
type Asset = Parameters<typeof compileBattleEntryCatalog>[2];

/** Capabilities are compiled independently of an entry's initial owned state.
 * Source mode never reads, substitutes, or validates a development seed proof. */
export function compileBattleSourceEntry(
  reader: Reader, tables: Tables, misc: Asset,
  profile: "shared" | "development-checkpoint", scriptRecords: readonly Asset[],
) {
  const providers = compileBattleEntryCatalog(reader, tables, misc);
  const checkpoint = profile === "development-checkpoint"
    ? compileNarsheOwnedConditionCheckpoint(reader, tables, scriptRecords)
    : null;
  return { providers, checkpoint };
}
