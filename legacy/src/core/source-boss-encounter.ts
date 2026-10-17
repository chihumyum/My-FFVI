/** Explicit Web handoff for the source Boss command. It omits the native
 * screenshot/intro, not actor placement, the battle, or its result. */
export const WEB_SOURCE_BOSS_ENTRY = "web-source-boss-entry-v1" as const;
export type WebSourceBossEntry = typeof WEB_SOURCE_BOSS_ENTRY;
export type SourceBossEncounterCommand = {
  kind: "source-boss-encounter";
  partyId: number;
  /** Source i1/i2 become ConversionMapRangeCell -> BossEc effect center.
   * They are neither extra lottery slots nor an actor destination. */
  focusCell: { x: number; y: number };
  continuation: string;
};
export type SourceBossEncounterOp = { kind: "source-boss-encounter"; command: SourceBossEncounterCommand };
export type SourceBossEncounterRequest = {
  kind: "source-boss-encounter-request-v1";
  policy: WebSourceBossEntry;
  command: SourceBossEncounterCommand;
};
export function sourceBossDataKeys(value: unknown, names: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid source Boss data object");
  const expected = names.split(",").sort(), keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string") ||
      (keys as string[]).sort().some((key, index) => key !== expected[index]) ||
      Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    throw new Error("Invalid source Boss data fields");
}
export function parseSourceBossEncounterCommand(raw: unknown): SourceBossEncounterCommand {
  sourceBossDataKeys(raw, "kind,partyId,focusCell,continuation");
  sourceBossDataKeys(raw.focusCell, "x,y");
  const integer = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= -0x80000000 && (v as number) <= 0x7fffffff;
  if (raw.kind !== "source-boss-encounter" || !integer(raw.partyId) || raw.partyId <= 0 ||
      !integer(raw.focusCell.x) || !integer(raw.focusCell.y) || typeof raw.continuation !== "string" ||
      !raw.continuation.length || raw.continuation.trim() !== raw.continuation)
    throw new Error("Invalid source Boss command");
  return { kind: "source-boss-encounter", partyId: raw.partyId,
    focusCell: { x: raw.focusCell.x, y: raw.focusCell.y }, continuation: raw.continuation };
}
