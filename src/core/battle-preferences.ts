/** Player preferences are runtime input, separate from source content and its
 * digest. Configured speed slots remain unsupported until their source mapping
 * is recovered; the current development profile supplies the ATB scalar. */
export type BattlePreferences = { mode: "active" | "wait" };

export function parseBattlePreferences(value: unknown): BattlePreferences {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("mode" in value) ||
    (value.mode !== "active" && value.mode !== "wait")
  )
    throw new Error("Invalid battle preferences");
  return { mode: value.mode };
}
