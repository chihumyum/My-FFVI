import { canonical } from "./canonical.js";
import type { BattleGame } from "./battle.js";
import type { FieldGame } from "./field.js";
import { GameFlow, type GameFlowTicket } from "./game-flow.js";
import type { GameSession, PreparedSessionBattleStart, PreparedSessionBattleReturn,
  SessionBattleRequest } from "./game-session.js";

export type GameBattleHandoffKind = "start" | "retry" | "return";
export type GameBattleStartPresentation = Readonly<Pick<PreparedSessionBattleStart, "kind" | "request" | "content">>;
export type GameBattleReturnPresentation = Readonly<Pick<PreparedSessionBattleReturn, "kind" | "request" | "content" | "outcome">>;
/** Hosts prepare private resources from detached data. They receive no core
 * transaction methods. A rejected prepare releases its own partial resources;
 * successful resources transfer to the caller only after core publication. */
export type GameBattlePresentationHost<T> = {
  prepareStart(candidate: GameBattleStartPresentation): Promise<T>;
  prepareReturn(candidate: GameBattleReturnPresentation): Promise<T>;
  discard(presentation: T): void;
};
export type GameBattleHandoffResult<T> =
  | { status: "committed"; session: GameSession; kind: GameBattleHandoffKind;
      request: SessionBattleRequest; presentation: T }
  | { status: "failed"; session: GameSession; kind: GameBattleHandoffKind;
      request: SessionBattleRequest; error: unknown; cleanupErrors?: readonly unknown[] }
  | { status: "cancelled"; cleanupErrors?: readonly unknown[] };

type Prepared = PreparedSessionBattleStart | PreparedSessionBattleReturn;
type Attempt<T> = {
  session: GameSession;
  field: FieldGame;
  battle: BattleGame | null;
  request: SessionBattleRequest;
  requestKey: string;
  kind: GameBattleHandoffKind;
  ticket: GameFlowTicket;
  unguard: (() => void) | null;
  cancelled: boolean;
  creating: boolean;
  committing: boolean;
  prepared: Prepared | null;
  contentKey: string | null;
  presentation: { value: T } | null;
  cleanupErrors: unknown[];
};

/** Coordinates readiness and publication, not another gameplay owner. Start,
 * fixed-entry defeat retry and terminal return use the same operation fence.
 * Flow invalidation revokes a private candidate before replacing an owner;
 * a candidate already publishing may refuse cancellation without losing its
 * ticket. Publication exceptions are fatal, never a second settlement prompt. */
export class GameBattleHandoff<T> {
  private attempt: Attempt<T> | null = null;
  constructor(private readonly flow: GameFlow, private readonly host: GameBattlePresentationHost<T>) {
    if (!host || typeof host.prepareStart !== "function" || typeof host.prepareReturn !== "function" ||
        typeof host.discard !== "function") throw new Error("Invalid battle presentation host");
  }
  get busy(): boolean { return this.attempt !== null && this.attempt.ticket.isCurrent(); }
  start(): Promise<GameBattleHandoffResult<T>> { return this.run("start"); }
  retry(): Promise<GameBattleHandoffResult<T>> { return this.run("retry"); }
  return(): Promise<GameBattleHandoffResult<T>> { return this.run("return"); }

  private async run(kind: GameBattleHandoffKind): Promise<GameBattleHandoffResult<T>> {
    if (this.attempt) {
      if (this.attempt.creating || this.attempt.committing || this.isCurrent(this.attempt))
        throw new Error("A battle handoff is already in progress");
      this.cancel();
    }
    const session = this.flow.currentSession;
    if (!this.flow.started || !session) throw new Error("Battle handoff requires a started GameSession owner");
    const field = session.field, request = field.stop;
    if (request?.kind !== "encounter" || kind === "start" && session.battle ||
        kind === "retry" && session.battle?.phase !== "defeat" ||
        kind === "return" && !["victory", "escaped"].includes(session.battle?.phase ?? ""))
      throw new Error("Battle handoff requires its pending encounter or terminal battle");
    const attempt: Attempt<T> = { session, field, battle: session.battle, request: request as SessionBattleRequest,
      requestKey: canonical(request), kind, ticket: this.flow.beginOperation(kind === "return" ? "battle-return" : "battle-entry"),
      unguard: null, cancelled: false, creating: false, committing: false, prepared: null,
      contentKey: null, presentation: null, cleanupErrors: [] };
    this.attempt = attempt;
    // No host disposal occurs inside Flow's invalidation guard. It only asks
    // the core candidate to revoke private work; a publishing refusal leaves
    // the Flow operation and current owner intact.
    attempt.unguard = attempt.ticket.onInvalidate(() => { attempt.prepared?.discard(); });
    try {
      attempt.creating = true;
      try {
        attempt.prepared = kind === "start" ? session.prepareBattleStart()
          : kind === "retry" ? session.prepareBattleRetry() : session.prepareBattleReturn();
      } finally { attempt.creating = false; }
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      if (!attempt.prepared) throw new Error("Battle handoff candidate is unavailable");
      attempt.contentKey = canonical(attempt.prepared.content);
      this.validateCandidateIdentity(attempt);
      const candidate = attempt.prepared;
      attempt.presentation = { value: candidate.kind === "return"
        ? await this.host.prepareReturn(Object.freeze({ kind: candidate.kind, outcome: candidate.outcome,
          request: candidate.request, content: candidate.content }))
        : await this.host.prepareStart(Object.freeze({ kind: candidate.kind,
          request: candidate.request, content: candidate.content })) };
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      this.validateCandidateIdentity(attempt);
      candidate.validate();
      if (!this.isCurrent(attempt)) return this.cancelled(attempt);
      this.validateCandidateIdentity(attempt);
    } catch (error) {
      return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
    }

    const prepared = attempt.prepared!, presentation = attempt.presentation!.value;
    let committed: boolean;
    attempt.committing = true;
    try { committed = prepared.commit(); }
    catch (error) {
      attempt.committing = false;
      // Core construction and final validation still belong to preparation.
      // The sticky publication fact survives a core catch/cleanup, so partial
      // owned writes can never become a retryable preparation result.
      if (prepared.publicationStarted || this.hasCurrentOwner(attempt) && attempt.session.battle !== attempt.battle) {
        this.release(attempt); this.cleanup(attempt);
        throw error;
      }
      return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
    }
    attempt.committing = false;
    if (!committed && (prepared.publicationStarted ||
        this.hasCurrentOwner(attempt) && attempt.session.battle !== attempt.battle)) {
      this.release(attempt); this.cleanup(attempt);
      throw new Error("Battle handoff started publication without confirming its owned transaction");
    }
    if (!committed) return this.isCurrent(attempt)
      ? this.failed(attempt, new Error("Battle state changed during preparation; prepare the pending request again"))
      : this.cancelled(attempt);
    const published = kind === "return" ? session.battle === null && !session.state.inBattle
      : session.battle !== null && session.battle !== attempt.battle && session.state.inBattle;
    if (!this.hasCurrentOwner(attempt) || !published) {
      this.release(attempt); this.cleanup(attempt);
      throw new Error("Battle handoff owner changed after publication");
    }
    attempt.prepared = null; attempt.presentation = null;
    this.release(attempt);
    return { status: "committed", session, kind, request: attempt.request, presentation };
  }

  cancel(): void {
    const attempt = this.attempt;
    if (!attempt) return;
    // Run the candidate guard before changing any cancellation flag. A core
    // publishing refusal must not accidentally unlock the current operation.
    attempt.ticket.cancel();
    attempt.cancelled = true;
    // A synchronous factory has not returned its candidate yet. A commit also
    // still uses its candidate. Their running stack performs the final cleanup.
    if (attempt.creating || attempt.committing) return;
    this.release(attempt); this.cleanup(attempt);
  }
  private hasCurrentOwner(attempt: Attempt<T>): boolean {
    return this.attempt === attempt && !attempt.cancelled && attempt.ticket.isCurrent() &&
      this.flow.started && this.flow.currentSession === attempt.session && attempt.session.field === attempt.field;
  }
  private isCurrent(attempt: Attempt<T>): boolean {
    if (!this.hasCurrentOwner(attempt) || attempt.session.battle !== attempt.battle || attempt.field.stop !== attempt.request)
      return false;
    try { return canonical(attempt.request) === attempt.requestKey; }
    catch { return false; }
  }
  private validateCandidateIdentity(attempt: Attempt<T>): void {
    const candidate = attempt.prepared;
    if (!candidate || candidate.kind !== attempt.kind || canonical(candidate.request) !== attempt.requestKey ||
        canonical(candidate.content) !== attempt.contentKey)
      throw new Error("Battle handoff candidate identity changed during preparation");
  }
  private release(attempt: Attempt<T>): void {
    attempt.unguard?.(); attempt.unguard = null;
    attempt.ticket.finish();
    if (this.attempt === attempt) this.attempt = null;
  }
  private cleanup(attempt: Attempt<T>): void {
    const prepared = attempt.prepared, presentation = attempt.presentation;
    attempt.prepared = null; attempt.presentation = null;
    if (prepared) {
      try { prepared.discard(); }
      catch (error) { attempt.cleanupErrors.push(error); }
    }
    if (presentation) {
      try { this.host.discard(presentation.value); }
      catch (error) { attempt.cleanupErrors.push(error); }
    }
  }
  private cancelled(attempt: Attempt<T>): GameBattleHandoffResult<T> {
    attempt.cancelled = true;
    this.release(attempt); this.cleanup(attempt);
    return { status: "cancelled", ...this.diagnostics(attempt) };
  }
  private failed(attempt: Attempt<T>, error: unknown): GameBattleHandoffResult<T> {
    this.release(attempt); this.cleanup(attempt);
    return { status: "failed", session: attempt.session, kind: attempt.kind,
      request: attempt.request, error, ...this.diagnostics(attempt) };
  }
  private diagnostics(attempt: Attempt<T>): { cleanupErrors?: readonly unknown[] } {
    return attempt.cleanupErrors.length ? { cleanupErrors: [...attempt.cleanupErrors] } : {};
  }
}
