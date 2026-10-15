import type { BattleRow } from "./battle.js";
import { canonical } from "./content.js";

export type SourceConditionPhysicalFile = { file: string; sha256: string; bytes: number };
export type SourceConditionReadLedger = {
  kind: "source-condition-read-ledger-v1";
  reader: "complete-verified-system-reader";
  sourceSetHash: string;
  parentSourceSetHash: string;
  battleSourceSetHash: string;
  rows: { table: string; row: BattleRow; physicalSource: SourceConditionPhysicalFile }[];
};
type Reader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
  matching(table: string, key: string, value: string | number): BattleRow[];
  unique(table: string, key: string, value: string | number): BattleRow;
};

/** This is an explicitly selected complete reader, never a missing-row fallback
 * for a pinned selected closure. Preserve every actual read's complete raw row
 * and physical bundle identity without changing that closure's source hash. */
export function trackSourceConditionReads(reader: Reader, identity: {
  sourceSetHash: string; parentSourceSetHash: string; battleSourceSetHash: string;
  physicalSources: readonly SourceConditionPhysicalFile[];
}) {
  for (const value of [identity.sourceSetHash, identity.parentSourceSetHash, identity.battleSourceSetHash])
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid condition reader source identity");
  const physical = structuredClone(identity.physicalSources);
  for (const file of physical)
    if (!file.file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
      throw new Error("Invalid condition reader physical source");
  const retained = new Map<string, SourceConditionReadLedger["rows"][number]>();
  const remember = (table: string, row: BattleRow): BattleRow => {
    if (!row.values.id || row.values.id !== row.source.rowId)
      throw new Error("Condition reader row identity mismatch");
    const files = physical.filter(file => file.file === row.source.file || file.file.endsWith("/" + row.source.file));
    if (files.length !== 1) throw new Error("Unbound condition reader physical source: " + table);
    const entry = { table, row: structuredClone(row), physicalSource: structuredClone(files[0]!) };
    const key = canonical({ table, source: row.source });
    const before = retained.get(key);
    if (before && canonical(before) !== canonical(entry)) throw new Error("Condition reader row changed during compilation");
    retained.set(key, entry);
    return row;
  };
  return {
    reader: {
      row: (table: string, id: string | number) => remember(table, reader.row(table, id)),
      unique: (table: string, key: string, value: string | number) => remember(table, reader.unique(table, key, value)),
      group: (table: string, key: string, value: string | number) => reader.group(table, key, value).map(row => remember(table, row)),
      matching: (table: string, key: string, value: string | number) => reader.matching(table, key, value).map(row => remember(table, row)),
    },
    snapshot: (): SourceConditionReadLedger => ({
      kind: "source-condition-read-ledger-v1", reader: "complete-verified-system-reader",
      sourceSetHash: identity.sourceSetHash, parentSourceSetHash: identity.parentSourceSetHash,
      battleSourceSetHash: identity.battleSourceSetHash,
      rows: [...retained.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => structuredClone(value)),
    }),
  };
}
