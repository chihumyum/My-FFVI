import { canonical } from "./canonical.js";
import type { FieldGame, GameEventSaveRequest } from "./field.js";
import { GameFlow, type GameFlowTicket } from "./game-flow.js";
import type { GameSession, PreparedGameEventSave } from "./game-session.js";
import type { CheckpointStorage, PreparedSave } from "./saved-game.js";

export type GameEventSaveResult =
  | { status: "committed"; session: GameSession; request: GameEventSaveRequest; savedAt: number }
  | { status: "failed"; session: GameSession; request: GameEventSaveRequest;
      error: unknown; cleanupErrors?: readonly unknown[] }
  | { status: "cancelled"; cleanupErrors?: readonly unknown[] };

type Attempt = {
  session: GameSession;
  field: FieldGame;
  request: GameEventSaveRequest;
  requestKey: string;
  ticket: GameFlowTicket;
  cancelled: boolean;
  committing: boolean;
  continuation: PreparedGameEventSave | null;
  storage: PreparedSave | null;
  cleanupErrors: unknown[];
};

/** Coordinates the explicit Web event-save protocol, not original AutoSave
 * timing. The session supplies its own post-ACK continuation checkpoint. No
 * script, reward, or mutable gameplay state is copied into a second owner.
 *
 * CheckpointStorage's synchronous commit is atomic on failure. Before that
 * write, errors retain the pending request for a fresh preparation. Once a
 * write succeeds, any ACK/publication failure is fatal and the same request
 * cannot be persisted again. UI binding belongs after a committed result. */
export class GameEventSaveCoordinator {
  private active: Attempt | null = null;
  private readonly persisted = new WeakSet<GameEventSaveRequest>();

  constructor(
    private readonly flow: GameFlow,
    private readonly storage: Pick<CheckpointStorage, "prepareSave">,
  ) {}

  async save(savedAt: number): Promise<GameEventSaveResult> {
    if (this.active) {
      if (this.active.committing || this.isCurrent(this.active))
        throw new Error("An event save is already in progress");
      this.cancel();
    }
    const session = this.flow.currentSession;
    const request = session?.eventSaveRequest;
    if (!this.flow.started || !session || session.battle || !request)
      throw new Error("Event saving requires a started session with a pending event save request");
    if (this.persisted.has(request))
      throw new Error("Event save was written but not acknowledged; reload the saved checkpoint instead of retrying");
    const requestKey = canonical(request);
    const attempt: Attempt = { session, field: session.field, request, requestKey,
      ticket: this.flow.beginOperation("save"), cancelled: false, committing: false,
      continuation: null, storage: null, cleanupErrors: [] };
    this.active = attempt;

    try {
      attempt.continuation = session.prepareEventSave(request);
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      attempt.storage = await this.storage.prepareSave(attempt.continuation.checkpoint, savedAt);
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
    } catch (error) {
      return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
    }

    let writeCalled = false, written = false, publicationReturned = false;
    attempt.committing = true;
    try {
      // The session validates its full gameplay baseline before calling write.
      // Recheck the host ticket inside write too: validation may call providers.
      attempt.continuation!.commitWith(() => {
        if (writeCalled) throw new Error("An event save publication called storage more than once");
        writeCalled = true;
        if (!this.isCurrent(attempt)) throw new Error("Event save owner changed before storage publication");
        attempt.storage!.commit();
        written = true;
        this.persisted.add(request);
        if (!this.isCurrent(attempt)) throw new Error("Event save owner changed after storage publication");
      });
      publicationReturned = true;
      if (!written) {
        // A core protocol violation may already have ACKed. Never classify it
        // as an ordinary preparation failure or automatically replay it.
        throw new Error("Event save continuation acknowledged without writing storage");
      }
      if (!this.hasCurrentOwner(attempt) || session.eventSaveRequest !== null)
        throw new Error("Event save publication did not retain its owner and acknowledge the request");
    } catch (error) {
      attempt.committing = false;
      if (!written && !publicationReturned)
        return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
      this.release(attempt);
      this.cleanup(attempt);
      // Written checkpoints contain the continuation already. Repeating a save
      // after an ACK failure could rotate slots and lose the preceding progress.
      throw error;
    }
    attempt.committing = false;
    attempt.continuation = null;
    attempt.storage = null;
    this.release(attempt);
    return { status: "committed", session, request, savedAt };
  }

  cancel(): void {
    const attempt = this.active;
    if (!attempt) return;
    if (attempt.committing)
      throw new Error("Cannot cancel an event save during synchronous publication");
    attempt.cancelled = true;
    this.release(attempt);
    this.cleanup(attempt);
  }

  private hasCurrentOwner(attempt: Attempt): boolean {
    return this.active === attempt && !attempt.cancelled && attempt.ticket.isCurrent() &&
      this.flow.started && this.flow.currentSession === attempt.session && attempt.session.field === attempt.field;
  }

  private isCurrent(attempt: Attempt): boolean {
    if (!this.hasCurrentOwner(attempt) || attempt.session.eventSaveRequest !== attempt.request) return false;
    try { return canonical(attempt.request) === attempt.requestKey; }
    catch { return false; }
  }

  private release(attempt: Attempt): void {
    attempt.ticket.finish();
    if (this.active === attempt) this.active = null;
  }

  private cleanup(attempt: Attempt): void {
    const continuation = attempt.continuation, storage = attempt.storage;
    attempt.continuation = null;
    attempt.storage = null;
    // Detach before callbacks so cancellation or a newer attempt cannot clean
    // these same candidates twice. Preserve the primary error if cleanup fails.
    for (const candidate of [storage, continuation]) {
      if (candidate) {
        try { candidate.discard(); }
        catch (error) { attempt.cleanupErrors.push(error); }
      }
    }
  }

  private cancelled(attempt: Attempt): GameEventSaveResult {
    attempt.cancelled = true;
    this.release(attempt);
    this.cleanup(attempt);
    return { status: "cancelled", ...this.diagnostics(attempt) };
  }

  private failed(attempt: Attempt, error: unknown): GameEventSaveResult {
    this.release(attempt);
    this.cleanup(attempt);
    return { status: "failed", session: attempt.session, request: attempt.request,
      error, ...this.diagnostics(attempt) };
  }

  private diagnostics(attempt: Attempt): { cleanupErrors?: readonly unknown[] } {
    return attempt.cleanupErrors.length ? { cleanupErrors: [...attempt.cleanupErrors] } : {};
  }
}
