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
export type PreparedSave = {
  /** Synchronously publish once, provided the slot still has its captured bytes. */
  commit(): void;
  /** Discarding is idempotent and never modifies the storage slot. */
  discard(): void;
  cancel(): void;
};
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
  private readonly slotKey: string;
  constructor(private readonly storage: StoragePort, profile: "source" | "framework" = "source") {
    if (profile !== "source" && profile !== "framework") throw new Error("Unknown save profile");
    this.slotKey = profile === "framework" ? "ffvi-reweb.framework.checkpoint.v1" : "ffvi-reweb.checkpoint.v1";
  }
  async save(checkpoint: GameCheckpoint, savedAt: number): Promise<void> {
    const prepared = await this.prepareSave(checkpoint, savedAt);
    prepared.commit();
  }
  /** Encoding does not authorize publication. A host can check its operation
   * ticket after this promise resolves and discard an obsolete candidate. */
  async prepareSave(checkpoint: GameCheckpoint, savedAt: number): Promise<PreparedSave> {
    const before = this.storage.getItem(this.slotKey);
    const current = await encodeSavedGame(checkpoint, savedAt);
    let previous: string | null = null;
    if (before !== null) {
      try {
        previous = slot(before).current;
      } catch {
        previous = before;
      } // Retain unreadable original bytes instead of silently deleting them.
    }
    const encoded = JSON.stringify({ formatVersion: 1, current, previous });
    let active = true;
    const discard = (): void => { active = false; };
    return Object.freeze({
      commit: (): void => {
        if (!active) throw new Error("Prepared save has already been consumed or discarded");
        // Consume before accessing the port: a reentrant or failed storage write
        // cannot reuse a preparation authorized by an earlier host operation.
        active = false;
        if (this.storage.getItem(this.slotKey) !== before)
          throw new Error("Save slot changed while saving");
        this.storage.setItem(this.slotKey, encoded);
      },
      discard,
      cancel: discard,
    });
  }
  async load(previous = false): Promise<SavedGame | null> {
    const raw = this.storage.getItem(this.slotKey);
    if (raw === null) return null;
    const text = previous ? slot(raw).previous : slot(raw).current;
    return text === null ? null : decodeSavedGame(text);
  }
}
