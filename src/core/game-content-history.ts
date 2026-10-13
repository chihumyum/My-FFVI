import { GameContentRepository, type RestoreSessionContent } from "./game-content.js";
import { parseGameContentRefs, type GameContentProfile, type GameContentRefs } from "./game-content-refs.js";
import { verifyContent } from "./content-integrity.js";
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

  async restoreSessionContent(checkpoint: GameCheckpoint): Promise<GameContentHistoryRestore> {
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
