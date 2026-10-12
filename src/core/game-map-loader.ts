import { canonical } from "./canonical.js";
import type { FieldGame, MapTransitionStop } from "./field.js";
import type { GameContentRepository } from "./game-content.js";
import { GameFlow, type GameFlowTicket } from "./game-flow.js";
import type { GameSession } from "./game-session.js";
import type { PreparedMap } from "./world-session.js";

/** Prepare private presentation resources only. The caller binds a successful
 * result to its UI after the world commit; that binding is not retryable work.
 * A rejected prepare must release anything it allocated before rejecting. */
export type GameMapPresentationHost<T> = {
  prepare(field: FieldGame): Promise<T>;
  discard(presentation: T): void;
};

export type GameMapLoadResult<T> =
  | { status: "committed"; session: GameSession; request: MapTransitionStop;
      field: FieldGame; presentation: T }
  | { status: "failed"; session: GameSession; request: MapTransitionStop;
      error: unknown; cleanupErrors?: readonly unknown[] }
  | { status: "cancelled"; cleanupErrors?: readonly unknown[] };

type Attempt<T> = {
  session: GameSession;
  from: FieldGame;
  request: MapTransitionStop;
  requestKey: string;
  ticket: GameFlowTicket;
  cancelled: boolean;
  committing: boolean;
  prepared: PreparedMap | null;
  presentation: { value: T } | null;
  cleanupErrors: unknown[];
};

/** Coordinates I/O, not gameplay ownership. A failed private preparation keeps
 * the original MapRequest on the same FieldGame so an explicit retry can prepare
 * it again. It never calls WorldSession.fail, restarts a script, or owns a copy
 * of the session. Cancellation releases candidates even if media resolves late. */
export class GameMapLoader<T> {
  private active: Attempt<T> | null = null;

  constructor(
    private readonly flow: GameFlow,
    private readonly contents: Pick<GameContentRepository, "world" | "map">,
    private readonly host: GameMapPresentationHost<T>,
  ) {}

  async load(): Promise<GameMapLoadResult<T>> {
    if (this.active) {
      if (this.active.committing || this.isCurrent(this.active))
        throw new Error("A map load is already in progress");
      this.cancel();
    }
    const session = this.flow.session, from = session.field, request = from.stop;
    if (!this.flow.started || session.battle || request?.kind !== "map-transition")
      throw new Error("Map loading requires a started session with a pending map request");
    const requestKey = canonical(request.request);
    const attempt: Attempt<T> = { session, from, request, requestKey,
      ticket: this.flow.beginOperation("map"), cancelled: false, committing: false,
      prepared: null, presentation: null, cleanupErrors: [] };
    this.active = attempt;

    try {
      const catalog = await this.contents.world();
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      const map = await this.contents.map(request.request.mapId, catalog);
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      attempt.prepared = session.world.prepare(catalog, map);
      // Source/provider preparation is synchronous but can invoke host callbacks.
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      attempt.presentation = { value: await this.host.prepare(attempt.prepared.field) };
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
    } catch (error) {
      return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
    }

    const prepared = attempt.prepared!, presentation = attempt.presentation!.value;
    let committed: boolean;
    attempt.committing = true;
    try { committed = session.world.commit(prepared); }
    catch (error) {
      attempt.committing = false;
      this.release(attempt);
      this.cleanup(attempt);
      // A throwing publication may already have changed an external provider.
      // Preserve the original exception; never suggest replaying this request.
      throw error;
    }
    attempt.committing = false;
    if (!committed) return this.isCurrent(attempt)
      ? this.failed(attempt, new Error("Map state changed during preparation; prepare the pending request again"))
      : this.cancelled(attempt);

    // WorldSession consumed the candidate. Transfer presentation ownership to
    // the caller; no later cancellation may dispose a published presentation.
    attempt.prepared = null;
    attempt.presentation = null;
    this.release(attempt);
    return { status: "committed", session, request, field: prepared.field, presentation };
  }

  cancel(): void {
    const attempt = this.active;
    if (!attempt) return;
    if (attempt.committing) {
      // WorldSession can cancel during its final validation, but refuses once
      // owned publication has begun. Do not revoke the ticket before that check.
      if (attempt.prepared) attempt.session.world.discard(attempt.prepared);
      attempt.cancelled = true;
      attempt.ticket.cancel();
      return;
    }
    attempt.cancelled = true;
    this.release(attempt);
    this.cleanup(attempt);
  }

  private isCurrent(attempt: Attempt<T>): boolean {
    if (this.active !== attempt || attempt.cancelled || !attempt.ticket.isCurrent() ||
        !this.flow.started || this.flow.session !== attempt.session || attempt.session.field !== attempt.from ||
        attempt.from.stop !== attempt.request) return false;
    try { return canonical(attempt.request.request) === attempt.requestKey; }
    catch { return false; }
  }

  private release(attempt: Attempt<T>): void {
    attempt.ticket.finish();
    if (this.active === attempt) this.active = null;
  }

  private cleanup(attempt: Attempt<T>): void {
    // Detach before callbacks: a reentrant cancel or new load cannot release a
    // candidate twice or dispose a resource belonging to the newer attempt.
    const prepared = attempt.prepared, presentation = attempt.presentation;
    attempt.prepared = null;
    attempt.presentation = null;
    if (prepared) {
      try { attempt.session.world.discard(prepared); }
      catch (error) { attempt.cleanupErrors.push(error); }
    }
    if (presentation) {
      try { this.host.discard(presentation.value); }
      catch (error) { attempt.cleanupErrors.push(error); }
    }
  }

  private cancelled(attempt: Attempt<T>): GameMapLoadResult<T> {
    attempt.cancelled = true;
    this.release(attempt);
    this.cleanup(attempt);
    return { status: "cancelled", ...this.diagnostics(attempt) };
  }

  private failed(attempt: Attempt<T>, error: unknown): GameMapLoadResult<T> {
    this.release(attempt);
    this.cleanup(attempt);
    return { status: "failed", session: attempt.session, request: attempt.request,
      error, ...this.diagnostics(attempt) };
  }

  private diagnostics(attempt: Attempt<T>): { cleanupErrors?: readonly unknown[] } {
    return attempt.cleanupErrors.length ? { cleanupErrors: [...attempt.cleanupErrors] } : {};
  }
}
