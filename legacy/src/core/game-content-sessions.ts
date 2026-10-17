import { GameContentRepository } from "./game-content.js";
import { GameFlow } from "./game-flow.js";
import { GameSession } from "./game-session.js";
import type { SelectedGameContentRelease } from "./game-content-release.js";
import type { WorldCatalog } from "../field/world.js";

export type GameContentSessionContext = {
  repository: GameContentRepository;
  release: SelectedGameContentRelease | null;
};
function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable); Object.freeze(value);
  }
  return value;
}

/** Immutable I/O context per session. The Flow remains the single publication
 * owner: switching currentSession also switches this projection. Registering a
 * private candidate changes no live repository, clock, gameplay state or view.
 * There is no separately committed active-content pointer to drift from it. */
export class GameContentSessions {
  private readonly contexts = new WeakMap<GameSession, GameContentSessionContext>();
  constructor(private readonly flow: GameFlow, readonly current: GameContentRepository) {
    if (!(flow instanceof GameFlow) || !(current instanceof GameContentRepository))
      throw new Error("Game content sessions require the existing Flow and repository");
  }

  registerCandidate(session: GameSession, repository: GameContentRepository,
    release: SelectedGameContentRelease | null = null): void {
    if (!(session instanceof GameSession) || !(repository instanceof GameContentRepository) ||
        release !== null && release.kind !== "selected-game-content-release-v1")
      throw new Error("Invalid private game content candidate");
    if (this.flow.started && this.flow.currentSession === session || this.contexts.has(session))
      throw new Error("Game content candidate is already registered or published");
    this.contexts.set(session, { repository, release: release === null ? null : immutable(structuredClone(release)) });
  }

  contextFor(session: GameSession): GameContentSessionContext {
    const context = this.contexts.get(session);
    if (!context) throw new Error("Game session has no prepared content binding");
    return { repository: context.repository, release: context.release === null ? null : structuredClone(context.release) };
  }
  get repository(): GameContentRepository {
    if (!this.flow.started) return this.current;
    const context = this.contexts.get(this.flow.session);
    if (!context) throw new Error("Game session has no prepared content binding");
    return context.repository;
  }
  get release(): SelectedGameContentRelease | null {
    if (!this.flow.started) return null;
    const context = this.contexts.get(this.flow.session);
    if (!context) throw new Error("Game session has no prepared content binding");
    // This projection is immutable and may be read every audio/render frame.
    // Explicit contextFor snapshots remain detached for tooling consumers.
    return context.release;
  }
  /** Capture the projected repository before awaiting. Existing loader tickets
   * still reject an obsolete response after Flow replaces or retires its owner. */
  world() { const repository = this.repository; return repository.world(); }
  map(mapId: number, catalog?: WorldCatalog) {
    const repository = this.repository; return repository.map(mapId, catalog);
  }
}
