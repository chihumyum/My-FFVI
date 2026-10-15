import { sourceBossDataKeys } from "./source-boss-encounter.js";
import { parseSourceBattleControls, type SourceBattleControls } from "./battle-controls.js";

export type BattleFlagRowSource = {
  file: string; assetPath: string; serializedFile: string; objectId: string; rowId: string;
};
/** An immutable source applicability rule, not another battle-state owner.
 * NoARBattle filters the original AR selection catalogs. It does not turn a
 * normal story battle into AR or change its actors, RNG, rewards or queue. */
export type SourceBattleFlags = {
  kind: "source-battle-flags-v1";
  entryContext: "story";
  partySource: BattleFlagRowSource;
  groupId: number;
  rows: { flagId: 14 | 19; source: BattleFlagRowSource }[];
  arDirectoryEligible: false;
};
function positive(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 0x7fffffff)
    throw new Error("Invalid source battle flag identity");
  return raw;
}
function source(raw: unknown, table: string): BattleFlagRowSource {
  sourceBossDataKeys(raw,"file,assetPath,serializedFile,objectId,rowId");
  if (Object.values(raw).some(value => typeof value !== "string" || !value.length))
    throw new Error("Invalid source battle flag row provenance");
  const value = raw as Record<string,string>;
  if (!(value.assetPath === table || value.assetPath!.endsWith("/" + table)) ||
      !/^-?(?:0|[1-9]\d*)$/.test(value.objectId!) || BigInt(value.objectId!) < -(1n << 63n) ||
      BigInt(value.objectId!) >= (1n << 63n) || !/^[1-9]\d*$/.test(value.rowId!) ||
      BigInt(value.rowId!) > 0x7fffffffn)
    throw new Error("Invalid source battle flag row provenance");
  return { file: value.file!, assetPath: value.assetPath!, serializedFile: value.serializedFile!,
    objectId: value.objectId!, rowId: value.rowId! };
}
export function parseSourceBattleFlags(raw: unknown): SourceBattleFlags {
  sourceBossDataKeys(raw,"kind,entryContext,partySource,groupId,rows,arDirectoryEligible");
  if (raw.kind !== "source-battle-flags-v1" || raw.entryContext !== "story" ||
      raw.arDirectoryEligible !== false || !Array.isArray(raw.rows) || !raw.rows.length)
    throw new Error("Unimplemented source battle flag context");
  const seen = new Set<string>(), rows = Array.from(raw.rows, row => {
    sourceBossDataKeys(row,"flagId,source");
    if (row.flagId !== 14 && row.flagId !== 19)
      throw new Error("Unimplemented source battle flag");
    const origin = source(row.source,"battle_flag_group.csv");
    if (seen.has(origin.rowId)) throw new Error("Duplicate source battle flag row");
    seen.add(origin.rowId);
    return { flagId: row.flagId, source: origin } as SourceBattleFlags["rows"][number];
  });
  if (!rows.some(row => row.flagId === 14)) throw new Error("NoARBattle declaration lacks its source flag14");
  return { kind: "source-battle-flags-v1", entryContext: "story", partySource: source(raw.partySource,"monster_party.csv"),
    groupId: positive(raw.groupId), rows, arDirectoryEligible: false };
}
/** Both effects must hold for a mixed original group. A source flag does not
 * grant the missing automatic controller or any future AR battle execution. */
export function assertSourceBattleFlagsControls(plan: SourceBattleFlags, controls: SourceBattleControls | undefined): void {
  if (plan.rows.some(row => row.flagId === 19)) {
    if (controls === undefined) throw new Error("Source flag19 requires the same manual battle controller");
    parseSourceBattleControls(controls);
  }
}
