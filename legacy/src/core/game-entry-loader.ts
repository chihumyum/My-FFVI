import { GameFlow, type GameFlowStartOptions, type GameFlowTicket } from "./game-flow.js";
import { GameSession } from "./game-session.js";

export type GameEntryKind = "new-game" | "load";
export type GameEntryCandidate<T> = {
  session: GameSession;
  presentation: T;
  options?: GameFlowStartOptions;
};
export type GameEntryPrepareContext = { isCurrent(): boolean };
export type GameEntryResult<T> =
  | { status: "committed"; kind: GameEntryKind; session: GameSession; presentation: T }
  | { status: "failed"; kind: GameEntryKind; error: unknown; cleanupErrors?: readonly unknown[] }
  | { status: "cancelled"; kind: GameEntryKind; cleanupErrors?: readonly unknown[] };
export type GameEntryAttempt<T> = {
  readonly kind: GameEntryKind;
  isCurrent(): boolean;
  prepare(factory: (context: GameEntryPrepareContext) => GameEntryCandidate<T> | Promise<GameEntryCandidate<T>>): Promise<GameEntryResult<T>>;
  /** Frame-driven source providers use the same publication boundary after
   * their existing fade and private launch have completed. */
  commit(candidate: GameEntryCandidate<T>): GameEntryResult<T>;
  cancel(): void;
};
export type GameEntryPresentationHost<T> = { discard(presentation: T): void };

type Attempt<T> = {
  kind: GameEntryKind;
  ticket: GameFlowTicket;
  owner: GameSession | null;
  started: boolean;
  paused: boolean;
  submitted: boolean;
  preparing: boolean;
  publishing: boolean;
  settled: boolean;
  unguard: (() => void) | null;
  presentation: { value: T } | null;
  transferred: { session: GameSession; presentation: T } | null;
  received: WeakSet<object>;
  cleanupErrors: unknown[];
};

function fields(value: unknown): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid game entry candidate");
  if (Object.getOwnPropertySymbols(value).length) throw new Error("Invalid game entry candidate fields");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value")))
    throw new Error("Game entry candidate requires data fields");
  return descriptors;
}

/** Shares the existing Flow ticket for entry preparation and replacement.
 * It owns private presentation disposal, never gameplay state or source fade.
 * A successful result transfers presentation to the caller; binding that view
 * happens after publication and cannot be handled as a retryable load failure.
 * Factories release partial allocations themselves if they reject before
 * returning a complete candidate. */
export class GameEntryLoader<T> {
  private active: Attempt<T> | null = null;

  constructor(private readonly flow: GameFlow, private readonly host: GameEntryPresentationHost<T>) {
    if (!host || typeof host.discard !== "function") throw new Error("Invalid game entry presentation host");
  }
  get busy(): boolean { return this.active !== null && this.isCurrent(this.active); }

  begin(kind: GameEntryKind): GameEntryAttempt<T> {
    if (kind !== "new-game" && kind !== "load") throw new Error("Unknown game entry kind");
    if (this.active) {
      if (this.isCurrent(this.active) || this.active.publishing)
        throw new Error("A game entry preparation is already in progress");
      this.cancelAttempt(this.active);
    }
    const attempt: Attempt<T> = { kind, ticket: this.flow.beginOperation(kind), owner: this.flow.currentSession,
      started: this.flow.started, paused: this.flow.paused, submitted: false, preparing: false, publishing: false,
      settled: false, unguard: null, presentation: null, transferred: null, received: new WeakSet(), cleanupErrors: [] };
    this.active = attempt;
    attempt.unguard = attempt.ticket.onInvalidate(() => {
      // Flow.publish runs invalidation guards too. Only our own publication
      // of already captured data transfers this candidate instead of revoking it.
      if (!attempt.publishing) this.revoke(attempt);
    });
    return Object.freeze({ kind, isCurrent: () => this.isCurrent(attempt),
      prepare: (factory: (context: GameEntryPrepareContext) => GameEntryCandidate<T> | Promise<GameEntryCandidate<T>>) =>
        this.prepare(attempt, factory),
      commit: (candidate: GameEntryCandidate<T>) => {
        if (attempt.preparing) throw new Error("Cannot commit while game entry preparation is pending");
        attempt.submitted = true;
        return this.publish(attempt, candidate);
      },
      cancel: () => this.cancelAttempt(attempt),
    });
  }
  cancel(): void { if (this.active) this.cancelAttempt(this.active); }

  private isCurrent(attempt: Attempt<T>): boolean {
    return this.active === attempt && !attempt.settled && attempt.ticket.isCurrent() &&
      this.flow.currentSession === attempt.owner && this.flow.started === attempt.started && this.flow.paused === attempt.paused;
  }
  private async prepare(attempt: Attempt<T>, factory: (context: GameEntryPrepareContext) =>
    GameEntryCandidate<T> | Promise<GameEntryCandidate<T>>): Promise<GameEntryResult<T>> {
    if (attempt.submitted) throw new Error("Game entry preparation has already been submitted");
    attempt.submitted = true;
    if (!this.isCurrent(attempt)) return this.cancelled(attempt);
    if (typeof factory !== "function") return this.failed(attempt, new Error("Invalid game entry preparation factory"));
    attempt.preparing = true;
    try {
      const candidate = await factory(Object.freeze({ isCurrent: () => this.isCurrent(attempt) }));
      return this.publish(attempt, candidate);
    } catch (error) {
      if (attempt.transferred) throw error;
      return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
    } finally { attempt.preparing = false; }
  }
  private publish(attempt: Attempt<T>, raw: GameEntryCandidate<T>): GameEntryResult<T> {
    // An obsolete frame may submit its completed candidate. Adopt and dispose
    // it once, but never dispose a previously transferred view on repeated commit.
    if (raw && typeof raw === "object" && attempt.received.has(raw)) return this.cancelledResult(attempt);
    if (raw && typeof raw === "object") attempt.received.add(raw);
    let candidate: { session: GameSession; presentation: T; options: GameFlowStartOptions };
    try {
      const presentation = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "presentation") : undefined;
      const sessionField = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "session") : undefined;
      if (attempt.transferred && presentation && sessionField && Object.hasOwn(presentation, "value") &&
          Object.hasOwn(sessionField, "value") && presentation.value === attempt.transferred.presentation &&
          sessionField.value === attempt.transferred.session)
        return this.cancelledResult(attempt);
      if (presentation && Object.hasOwn(presentation, "value")) attempt.presentation = { value: presentation.value as T };
      const descriptors = fields(raw), keys = Object.keys(descriptors).sort().join(",");
      if (keys !== "presentation,session" && keys !== "options,presentation,session")
        throw new Error("Invalid game entry candidate fields");
      const session = descriptors.session!.value;
      if (!(session instanceof GameSession)) throw new Error("Game entry requires a GameSession owner");
      let paused = false;
      if (descriptors.options) {
        const options = fields(descriptors.options.value), optionKeys = Object.keys(options);
        if (optionKeys.some(key => key !== "paused") ||
            options.paused && options.paused.value !== undefined && typeof options.paused.value !== "boolean")
          throw new Error("Invalid game entry start options");
        paused = options.paused?.value ?? false;
      }
      candidate = { session, presentation: descriptors.presentation!.value as T, options: { paused } };
      if (attempt.transferred && attempt.transferred.session === session && attempt.transferred.presentation === candidate.presentation) {
        attempt.presentation = null;
        return this.cancelledResult(attempt);
      }
    } catch (error) { return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt); }
    if (!this.isCurrent(attempt)) return this.cancelled(attempt);
    attempt.publishing = true;
    let committed: boolean;
    try { committed = attempt.ticket.publish(candidate.session, candidate.options); }
    catch (error) {
      attempt.publishing = false;
      // Flow publication has no callbacks after its owner write. If a host
      // violates that contract and throws afterwards, never dispose the live
      // view or classify the changed owner as a retryable preparation failure.
      if (this.flow.currentSession === candidate.session &&
          (candidate.session !== attempt.owner || !attempt.ticket.isCurrent() && this.flow.started)) {
        this.transfer(attempt, candidate);
        throw error;
      }
      return this.isCurrent(attempt) ? this.failed(attempt, error) : this.cancelled(attempt);
    }
    attempt.publishing = false;
    if (!committed) return this.cancelled(attempt);
    this.transfer(attempt, candidate);
    return { status: "committed", kind: attempt.kind, session: candidate.session, presentation: candidate.presentation };
  }
  private transfer(attempt: Attempt<T>, candidate: { session: GameSession; presentation: T }): void {
    attempt.transferred = candidate;
    attempt.presentation = null;
    attempt.settled = true;
    this.release(attempt);
  }
  private release(attempt: Attempt<T>): void {
    attempt.unguard?.(); attempt.unguard = null;
    attempt.ticket.finish();
    if (this.active === attempt) this.active = null;
  }
  private discard(attempt: Attempt<T>): void {
    const presentation = attempt.presentation;
    attempt.presentation = null;
    if (presentation) {
      try { this.host.discard(presentation.value); }
      catch (error) { attempt.cleanupErrors.push(error); }
    }
  }
  private revoke(attempt: Attempt<T>): void {
    attempt.settled = true;
    attempt.unguard?.(); attempt.unguard = null;
    if (this.active === attempt) this.active = null;
    this.discard(attempt);
  }
  private cancelAttempt(attempt: Attempt<T>): void {
    if (attempt.settled) return;
    if (attempt.publishing) throw new Error("Game entry publication is in progress");
    attempt.ticket.cancel();
    this.revoke(attempt);
  }
  private diagnostics(attempt: Attempt<T>): { cleanupErrors?: readonly unknown[] } {
    return attempt.cleanupErrors.length ? { cleanupErrors: [...attempt.cleanupErrors] } : {};
  }
  private cancelledResult(attempt: Attempt<T>): GameEntryResult<T> {
    return { status: "cancelled", kind: attempt.kind, ...this.diagnostics(attempt) };
  }
  private cancelled(attempt: Attempt<T>): GameEntryResult<T> {
    attempt.settled = true;
    this.discard(attempt); this.release(attempt);
    return this.cancelledResult(attempt);
  }
  private failed(attempt: Attempt<T>, error: unknown): GameEntryResult<T> {
    attempt.settled = true;
    this.discard(attempt); this.release(attempt);
    return { status: "failed", kind: attempt.kind, error, ...this.diagnostics(attempt) };
  }
}
