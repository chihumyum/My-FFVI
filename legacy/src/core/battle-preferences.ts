/** Player preferences are runtime input, separate from source content and its
 * digest. Source ConfigSaveData stores a zero-based speed index. */
export type BattlePreferences = { mode: "active" | "wait"; speedIndex: number };

/** ConfigSaveData constructor 0x389dd0. */
export const defaultBattleSpeedIndex = 2;

/** GetBattleSpeedByConfigValue 0x7643b0 and the FF6 key-input configuration
 * setter 0x779750 agree. Invalid persisted indices are rejected, rather than
 * borrowing the native low-level helper's fallback for unsupported values. */
export function battleAtbSpeed(speedIndex: number): number {
  switch (speedIndex) {
    case 0: return 0.5;
    case 1: return 0.75;
    case 2: return 1;
    case 3: return 1.5;
    case 4: return 2;
    default: throw new Error("Invalid battle speed index");
  }
}

export function parseBattlePreferences(value: unknown): BattlePreferences {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "mode,speedIndex" ||
    !("mode" in value) ||
    (value.mode !== "active" && value.mode !== "wait") ||
    !("speedIndex" in value) || typeof value.speedIndex !== "number" ||
    !Number.isInteger(value.speedIndex) || value.speedIndex < 0 || value.speedIndex > 4
  )
    throw new Error("Invalid battle preferences");
  return { mode: value.mode, speedIndex: value.speedIndex };
}
