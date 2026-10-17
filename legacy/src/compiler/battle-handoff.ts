import type { SourceBattleEncounter } from "./battle-encounters.js";
import type { BattleRow } from "./battle.js";
import { canonical } from "../core/canonical.js";
import { parseBattleHandoffContent, type BattleHandoffContent, type BattleHandoffDependency,
  type FrameworkBattleHandoffPolicy } from "../core/battle-handoff-content.js";
import { tableInteger } from "./table.js";

export type BattleHandoffMusicLookup = (id: number) =>
  { binding: "bound"; row: BattleRow } | { binding: "unresolved"; reason: string };
type Reader = { row(table: string, id: number): BattleRow;
  /** Only a trusted source reader which can distinguish absence from corrupt
   * identity may return unresolved. Other errors must propagate unchanged. */
  handoffMusic?: BattleHandoffMusicLookup };
export class BattleHandoffDependencyError extends Error {
  constructor(message: string, readonly dependency: { table: string; id: number; field?: string }) { super(message); }
}

/** The caller supplies a verified COMPLETE source table set, not selected
 * capability rows. Missing music declarations are allowed only after checking
 * the whole namespace for malformed/duplicate identities. No lookup exception
 * is interpreted as absence and no alternative music table is consulted. */
export function createBattleHandoffMusicLookup(
  tables: Record<string, Record<string, string>[]>, reader: Pick<Reader, "row">,
): BattleHandoffMusicLookup {
  const table = "battle_bgm_asset.csv", rows = tables[table];
  if (rows === undefined) return () => ({ binding: "unresolved",
    reason: "The complete verified source corpus does not provide battle_bgm_asset.csv" });
  if (!Array.isArray(rows)) throw new Error("Invalid complete battle music source table");
  const indexed = new Map<number, Record<string, string>>();
  for (const value of rows) {
    const id = tableInteger(value.id);
    if (id <= 0 || indexed.has(id)) throw new Error("Invalid or ambiguous complete battle music source identity");
    indexed.set(id, value);
  }
  return id => {
    const expected = indexed.get(id);
    if (!expected) return { binding: "unresolved",
      reason: `The complete verified battle_bgm_asset.csv has ${rows.length} rows and no row ${id}; native music resolution is unverified` };
    const found = reader.row(table, id);
    if (canonical(found.values) !== canonical(expected)) throw new Error("Battle handoff complete-source music row mismatch");
    return { binding: "bound", row: found };
  };
}

/** Opt-in source declarations retain exact row identity and every music
 * reference. Retaining field audio does not turn missing table data into zero. */
export function compileBattleHandoffContent(reader: Reader, encounter: SourceBattleEncounter,
  policy: FrameworkBattleHandoffPolicy | null): BattleHandoffContent {
  const row = (table: BattleHandoffDependency["table"], id: number): BattleRow => {
    try {
      const found = reader.row(table, id);
      if (tableInteger(found.values.id) !== id || found.source.rowId !== String(id))
        throw new Error("Resolved handoff row has a different identity");
      return found;
    } catch (error) { throw new BattleHandoffDependencyError(error instanceof Error ? error.message : String(error), { table, id }); }
  };
  const party = row("monster_party.csv", encounter.partyId);
  if (canonical(party.source) !== canonical(encounter.source))
    throw new BattleHandoffDependencyError("Battle handoff party provenance mismatch", { table: "monster_party.csv", id: encounter.partyId });
  const fields = { backgroundId: "battle_background_asset_id", bgmId: "battle_bgm_asset_id",
    appearanceProduction: "appearance_production", notEscape: "not_escape" } as const;
  for (const [key, field] of Object.entries(fields) as [keyof typeof fields, typeof fields[keyof typeof fields]][]) {
    try {
      if (tableInteger(party.values[field]) !== encounter.metadata[key])
        throw new Error("Battle handoff source metadata mismatch: " + field);
    } catch (error) { throw new BattleHandoffDependencyError(error instanceof Error ? error.message : String(error),
      { table: "monster_party.csv", id: encounter.partyId, field }); }
  }
  const dependencies: BattleHandoffDependency[] = [{ table: "monster_party.csv", id: encounter.partyId,
    binding: "bound", source: { ...party.source } }];
  const background = row("battle_background_asset.csv", encounter.metadata.backgroundId);
  dependencies.push({ table: "battle_background_asset.csv", id: encounter.metadata.backgroundId,
    binding: "bound", source: { ...background.source } });
  if (encounter.metadata.bgmId) {
    const id = encounter.metadata.bgmId;
    let resolution;
    try { resolution = reader.handoffMusic ? reader.handoffMusic(id) : { binding: "bound" as const,
      row: row("battle_bgm_asset.csv", id) }; }
    catch (error) { throw error instanceof BattleHandoffDependencyError ? error : new BattleHandoffDependencyError(
      error instanceof Error ? error.message : String(error), { table: "battle_bgm_asset.csv", id }); }
    if (resolution.binding === "unresolved") {
      if (typeof resolution.reason !== "string" || !resolution.reason.trim())
        throw new BattleHandoffDependencyError("Missing unresolved battle music reason", { table: "battle_bgm_asset.csv", id });
      dependencies.push({ table: "battle_bgm_asset.csv", id, binding: "unresolved", source: null, reason: resolution.reason });
    } else if (resolution.binding === "bound") {
      if (tableInteger(resolution.row.values.id) !== id || resolution.row.source.rowId !== String(id))
        throw new BattleHandoffDependencyError("Resolved handoff music row has a different identity", { table: "battle_bgm_asset.csv", id });
      dependencies.push({ table: "battle_bgm_asset.csv", id, binding: "bound", source: { ...resolution.row.source } });
    } else throw new BattleHandoffDependencyError("Invalid battle music resolution", { table: "battle_bgm_asset.csv", id });
  }
  return parseBattleHandoffContent({ kind: "battle-handoff-content-v1", source: {
    encounterId: encounter.partyId, row: { ...encounter.source }, metadata: {
      backgroundId: encounter.metadata.backgroundId, bgmId: encounter.metadata.bgmId,
      appearanceProduction: encounter.metadata.appearanceProduction, notEscape: encounter.metadata.notEscape,
    }, dependencies,
  }, policy }, encounter.partyId);
}
