import type { GameCheckpoint } from "./game-session.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { contentDigest, verifyContent } from "./content-integrity.js";

export type SavedGame = {
  formatVersion: 1;
  kind: "web-game-save";
  savedAt: number;
  checkpoint: GameCheckpoint;
  contentHash: string;
};
const maxSaveLength = 4 * 1024 * 1024;
export async function encodeSavedGame(
  checkpoint: GameCheckpoint,
  savedAt: number,
): Promise<string> {
  checkpointInteger(savedAt, 0, 8640000000000000);
  const value = {
    formatVersion: 1 as const,
    kind: "web-game-save" as const,
    savedAt,
    checkpoint: structuredClone(checkpoint),
  };
  const encoded = JSON.stringify({
    ...value,
    contentHash: await contentDigest(value),
  });
  if (encoded.length > maxSaveLength) throw new Error("Oversized save file");
  return encoded;
}
export async function decodeSavedGame(text: string): Promise<SavedGame> {
  if (typeof text !== "string" || text.length > maxSaveLength)
    throw new Error("Invalid or oversized save file");
  const value: SavedGame = JSON.parse(text);
  checkpointKeys(value, "formatVersion,kind,savedAt,checkpoint,contentHash");
  if (value.kind !== "web-game-save" || value.formatVersion !== 1)
    throw new Error("Unsupported save version");
  checkpointInteger(value.savedAt, 0, 8640000000000000);
  await verifyContent(value);
  // Content-dependent validation belongs to GameSession.restore, before host publication.
  return value;
}

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type SaveSlot = { formatVersion: 1; current: string; previous: string | null };
const slotKey = "ffvi-reweb.checkpoint.v1";
function slot(raw: string): SaveSlot {
  const value: SaveSlot = JSON.parse(raw);
  checkpointKeys(value, "formatVersion,current,previous");
  if (
    value.formatVersion !== 1 ||
    typeof value.current !== "string" ||
    (value.previous !== null && typeof value.previous !== "string")
  )
    throw new Error("Unsupported save slot");
  return value;
}

/** One storage write publishes current + prior checkpoint together; failed writes preserve the old slot. */
export class CheckpointStorage {
  constructor(private readonly storage: StoragePort) {}
  async save(checkpoint: GameCheckpoint, savedAt: number): Promise<void> {
    const before = this.storage.getItem(slotKey);
    const current = await encodeSavedGame(checkpoint, savedAt);
    let previous: string | null = null;
    if (before !== null) {
      try {
        previous = slot(before).current;
      } catch {
        previous = before;
      } // Retain unreadable original bytes instead of silently deleting them.
    }
    if (this.storage.getItem(slotKey) !== before)
      throw new Error("Save slot changed while saving");
    this.storage.setItem(
      slotKey,
      JSON.stringify({ formatVersion: 1, current, previous }),
    );
  }
  async load(previous = false): Promise<SavedGame | null> {
    const raw = this.storage.getItem(slotKey);
    if (raw === null) return null;
    const text = previous ? slot(raw).previous : slot(raw).current;
    return text === null ? null : decodeSavedGame(text);
  }
}
