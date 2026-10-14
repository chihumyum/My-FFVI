import { GameContentRepository, type RestoreSessionContent } from "./game-content.js";
import { parseGameContentRefs, type GameContentProfile, type GameContentRefs } from "./game-content-refs.js";
import { verifyContent } from "./content-integrity.js";
import { canonical } from "./canonical.js";
import type { GameCheckpoint } from "./game-session.js";
import { gameContentCheckpointIdentity, parseGameContentReleaseIndex, resolveGameContentReleaseObject,
  selectGameContentRelease, type SelectedGameContentRelease } from "./game-content-release.js";

export type GameContentHistoryOptions = {
  current: GameContentRepository;
  profile: GameContentProfile;
  loadJson(url: string): Promise<unknown>;
  /** Chosen by the host together. A checkpoint never supplies either value. */
  packageId?: string;
  refs?: GameContentRefs;
};
export type GameContentHistoryRestore = {
  content: RestoreSessionContent;
  repository: GameContentRepository;
  release: SelectedGameContentRelease | null;
};
export type GameContentHistoryCurrent = {
  repository: GameContentRepository;
  /** null is only the explicit legacy host without declared package pins. */
  release: SelectedGameContentRelease | null;
};
export type GameContentHistoryRestoreOptions = { pinCurrent?: boolean };

function currentRestorePin(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid game content history restore options");
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null) {
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (Object.getPrototypeOf(prototype) !== null || !constructor || !("value" in constructor) ||
        typeof constructor.value !== "function" ||
        Object.getOwnPropertyDescriptor(constructor.value, "prototype")?.value !== prototype ||
        Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(Object))
      throw new Error("Invalid game content history restore options");
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).some(key => key !== "pinCurrent") ||
      Object.values(descriptors).some(value => !("value" in value) || !value.enumerable) ||
      descriptors.pinCurrent && typeof descriptors.pinCurrent.value !== "boolean")
    throw new Error("Invalid game content history restore options");
  return descriptors.pinCurrent?.value ?? false;
}

/** Content selection and I/O only. Restore still uses the existing Repository,
 * Session and entry publication boundary. No save is upgraded or reinitialized.
 * A selected repository travels with the private candidate and must be bound
 * to its published session's later map loads, not to another active owner. */
export class GameContentHistory {
  readonly current: GameContentRepository;
  private readonly profile: GameContentProfile;
  private readonly packageId: string | undefined;
  private readonly refs: GameContentRefs | undefined;
  private readonly loadJson: GameContentHistoryOptions["loadJson"];

  constructor(options: GameContentHistoryOptions) {
    if (!(options?.current instanceof GameContentRepository) || typeof options.loadJson !== "function" ||
        options.profile !== "source" && options.profile !== "framework")
      throw new Error("Invalid game content history host");
    if (options.packageId !== undefined && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.packageId))
      throw new Error("Invalid game content history package");
    if ((options.packageId === undefined) !== (options.refs === undefined))
      throw new Error("Game content history requires an explicit package and its references together");
    this.current = options.current; this.profile = options.profile; this.packageId = options.packageId;
    this.refs = options.refs === undefined ? undefined : parseGameContentRefs(options.refs);
    if (this.refs && this.refs.profile !== this.profile)
      throw new Error("Game content history profile mismatch");
    this.loadJson = options.loadJson;
  }

  /** Prepare a fixed current-content context. Selecting a package never falls
   * back to mutable URLs or an older release when its archive is unavailable.
   * This method publishes no owner or active-content pointer; the returned
   * context belongs to the host's existing private entry candidate. */
  async openCurrent(): Promise<GameContentHistoryCurrent> {
    const declared = this.current.declaredReferences, refs = this.refs;
    if (this.packageId === undefined) {
      if (declared !== undefined)
        throw new Error("Declared current content requires a trusted package history");
      return { repository: this.current, release: null };
    }
    if (refs === undefined || declared === undefined || canonical(refs) !== canonical(declared))
      throw new Error("Current repository declared references mismatch");
    const indexPayload = structuredClone(await this.loadJson(`/content-releases/packages/${this.packageId}.json`));
    const index = parseGameContentReleaseIndex(await verifyContent(indexPayload as { contentHash: string }));
    if (index.packageId !== this.packageId || index.profile !== this.profile)
      throw new Error("Game content history namespace/profile mismatch");
    const selected = selectGameContentRelease(index, { kind: "current" });
    if (canonical(selected.release.refs) !== canonical(refs))
      throw new Error("Current game content release references mismatch");
    const repository = new GameContentRepository(async logicalUrl => {
      const reference = resolveGameContentReleaseObject(selected, logicalUrl);
      const payload = structuredClone(await this.loadJson(reference.url));
      return verifyContent(payload as { contentHash: string }, reference.contentHash);
    }, this.profile, refs);
    const world = await repository.world();
    if (world.parentSourceSetHash !== selected.release.sourceSetHash)
      throw new Error("Current game content release source identity mismatch");
    return { repository, release: structuredClone(selected) };
  }

  async restoreSessionContent(checkpoint: GameCheckpoint,
    options: GameContentHistoryRestoreOptions = {}): Promise<GameContentHistoryRestore> {
    const pinCurrent = currentRestorePin(options);
    // Capture before I/O. A later caller mutation cannot change the selected
    // content or reinterpret the checkpoint used by this preparation.
    const saved = structuredClone(checkpoint), identity = gameContentCheckpointIdentity(saved);
    const refs = this.refs;
    const lane = refs === undefined ? undefined : identity.entryLane === "initialized"
      ? refs.kind === "game-content-refs-v2" ? refs.initialized : null : refs[identity.entryLane];
    const currentMatch = refs === undefined || identity.worldCatalogHash !== null && lane !== null && lane !== undefined &&
      lane.entry.contentHash === identity.entryContentHash && lane.battle.contentHash === identity.battleCatalogHash &&
      (identity.worldCatalogHash === null || refs.world.contentHash === identity.worldCatalogHash);
    if (currentMatch) {
      // A current-release I/O, source or capability error remains that error.
      // It does not authorize a search for a different playable definition.
      if (pinCurrent) {
        const selected = await this.openCurrent();
        return { content: await selected.repository.restoreSessionContent(saved), ...selected };
      }
      return { content: await this.current.restoreSessionContent(saved), repository: this.current, release: null };
    }
    if (this.packageId === undefined)
      throw new Error("Checkpoint content version differs and has no trusted package history");
    const indexPayload = structuredClone(await this.loadJson(`/content-releases/packages/${this.packageId}.json`));
    const index = parseGameContentReleaseIndex(await verifyContent(indexPayload as { contentHash: string }));
    if (index.packageId !== this.packageId || index.profile !== this.profile)
      throw new Error("Game content history namespace/profile mismatch");
    const selected = selectGameContentRelease(index, { kind: "checkpoint", checkpoint: saved });
    const repository = new GameContentRepository(async logicalUrl => {
      const reference = resolveGameContentReleaseObject(selected, logicalUrl);
      const payload = structuredClone(await this.loadJson(reference.url));
      return verifyContent(payload as { contentHash: string }, reference.contentHash);
    }, this.profile, selected.release.refs);
    const content = await repository.restoreSessionContent(saved);
    return { content, repository, release: structuredClone(selected) };
  }
}
