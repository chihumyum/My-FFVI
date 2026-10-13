import type { Direction } from "../field/types.js";
import type { FieldChoiceAnswer } from "./field-choice.js";
import { GameSession } from "./game-session.js";

export type GameFlowPhase = "title" | "loading" | "paused" | "exploration" | "event" | "dialogue" | "choice" | "shop" |
  "battle-entry" | "battle-return" | "battle" | "victory" | "defeat" | "escaped" | "transition" | "blocked";
export type GameFlowOperation = "new-game" | "load" | "save" | "map" | "battle-entry" | "battle-return";
export type GameFlowHostState = { visible: boolean; mediaReady: boolean; overlayOpen: boolean };
export type GameFlowStartOptions = { paused?: boolean };
export type GameFlowTicket = {
  isCurrent(): boolean;
  /** Before cancellation or owner replacement; throwing preserves the ticket.
   * Successful completion via finish does not invoke these guards. */
  onInvalidate(guard: () => void): () => void;
  finish(): boolean;
  cancel(): void;
  publish(session: GameSession, options?: GameFlowStartOptions): boolean;
};
type FlowOperation = { kind: GameFlowOperation; invalidating: boolean; guards: Set<() => void> };

function pauseOption(options: GameFlowStartOptions): boolean {
  if (!options || (options.paused !== undefined && typeof options.paused !== "boolean")) throw new Error("Invalid game flow start options");
  return options.paused ?? false;
}
function requireSession(session: unknown): asserts session is GameSession {
  if (!(session instanceof GameSession)) throw new Error("Game flow requires a GameSession owner");
}

/** Host flow owns only title/pause/I/O arbitration. World, field, battle and
 * durable state stay on the supplied GameSession; phase is always derived.
 * An empty title needs no session or gameplay content. The first owner is
 * installed by start or an active new-game/load ticket, never fabricated here.
 * Tickets do not own an I/O resource: the adapter must dispose its candidate
 * if publication is rejected. No renderer or browser global is read here. */
export class GameFlow {
  private owner: GameSession | null;
  private hasStarted = false;
  private isPaused = false;
  private operation: FlowOperation | null = null;
  private host: GameFlowHostState | null = null;

  constructor(session?: GameSession) {
    if (session !== undefined) requireSession(session);
    this.owner = session ?? null;
  }
  get currentSession(): GameSession | null { return this.owner; }
  get hasSession(): boolean { return this.owner !== null; }
  get session(): GameSession {
    if (!this.owner) throw new Error("Game flow has no GameSession owner");
    return this.owner;
  }
  get started(): boolean { return this.hasStarted; }
  get paused(): boolean { return this.isPaused; }
  get busy(): boolean { return this.operation !== null; }
  /** Shared input admission for UI surfaces that dispatch to a session-owned
   * subsystem directly, such as the battle command menu. */
  get inputReady(): boolean { return this.hostAllowsInput; }
  /** Pause-menu mutations use the same host facts and operation arbitration,
   * while gameplay input remains suppressed throughout the pause. */
  get menuInputReady(): boolean { return this.hostReady && this.isPaused; }
  get phase(): GameFlowPhase {
    if (this.operation) return this.operation.kind === "map" ? "transition"
      : this.operation.kind === "battle-entry" || this.operation.kind === "battle-return" ? this.operation.kind : "loading";
    if (!this.hasStarted || !this.owner) return "title";
    if (this.isPaused) return "paused";
    const battle = this.owner.battle;
    if (battle) return battle.phase === "active" ? "battle" : battle.phase;
    const field = this.owner.field;
    if (this.owner.encounterPreparationError) return "blocked";
    if (field.stop?.kind === "map-transition") return "transition";
    if (field.stop?.kind === "unsupported") return "blocked";
    // An encounter stop is the pending FieldGame -> BattleGame handoff, not
    // a terminal blocker. GameSession needs its next logical tick to resolve it.
    if (field.stop?.kind === "encounter") return "event";
    if (field.choice) return "choice";
    if (field.dialogue) return "dialogue";
    if (field.currentShop) return "shop";
    return field.busy ? "event" : "exploration";
  }
  start(session?: GameSession, options: GameFlowStartOptions = {}): void {
    const next = session === undefined ? this.owner : session;
    // Validate before invalidating a pending load, including an empty title's
    // first load. A failed explicit start must leave that operation retryable.
    requireSession(next); const paused = pauseOption(options);
    this.invalidateOperation();
    this.owner = next; this.hasStarted = true; this.isPaused = paused;
    // A new owner cannot inherit readiness for the previous owner's media.
    this.host = null;
  }
  returnToTitle(): void {
    this.invalidateOperation(); this.hasStarted = false; this.isPaused = false; this.host = null;
  }
  pause(value: boolean): boolean {
    if (typeof value !== "boolean") throw new Error("Invalid game flow pause value");
    if (!this.hasStarted || !this.owner || this.operation) return false;
    this.isPaused = value; return true;
  }
  beginOperation(kind: GameFlowOperation): GameFlowTicket {
    if (!["new-game", "load", "save", "map", "battle-entry", "battle-return"].includes(kind))
      throw new Error("Unknown game flow operation");
    if (this.operation) throw new Error("A game flow operation is already in progress");
    if (!this.owner && (kind === "save" || kind === "map" || kind === "battle-entry" || kind === "battle-return"))
      throw new Error("Game flow save/map/battle operation requires a GameSession owner");
    const operation: FlowOperation = { kind, invalidating: false, guards: new Set() }; this.operation = operation;
    const isCurrent = () => this.operation === operation;
    const finish = (): boolean => {
      if (!isCurrent()) return false;
      if (operation.invalidating) throw new Error("Cannot finish a game flow operation during invalidation");
      this.operation = null; operation.guards.clear(); return true;
    };
    return Object.freeze({
      isCurrent, finish,
      onInvalidate: (guard: () => void): (() => void) => {
        if (typeof guard !== "function") throw new Error("Invalid game flow invalidation guard");
        if (!isCurrent()) return () => {};
        if (operation.invalidating) throw new Error("Cannot register a game flow guard during invalidation");
        operation.guards.add(guard);
        return () => { operation.guards.delete(guard); };
      },
      cancel: () => { this.invalidateOperation(operation); },
      publish: (session: GameSession, options: GameFlowStartOptions = {}): boolean => {
        if (!isCurrent()) return false;
        if (operation.invalidating) throw new Error("Cannot publish a game flow owner during invalidation");
        requireSession(session); const paused = pauseOption(options);
        // Option evaluation cannot let an obsolete asynchronous ticket replace
        // an owner installed by a later operation or explicit start.
        if (!isCurrent()) return false;
        this.runInvalidationGuards(operation);
        if (!isCurrent()) return false;
        this.operation = null; this.owner = session;
        operation.guards.clear();
        this.hasStarted = true; this.isPaused = paused; this.host = null;
        return true;
      },
    });
  }
  private runInvalidationGuards(operation: FlowOperation): void {
    if (this.operation !== operation) return;
    if (operation.invalidating) throw new Error("Reentrant game flow operation invalidation");
    const owner = this.owner;
    operation.invalidating = true;
    try {
      for (const guard of [...operation.guards]) {
        if (!operation.guards.has(guard)) continue;
        guard();
        if (this.operation !== operation || this.owner !== owner)
          throw new Error("Game flow owner changed during operation invalidation");
      }
    } finally { operation.invalidating = false; }
  }
  private invalidateOperation(expected?: FlowOperation): boolean {
    const operation = this.operation;
    if (!operation || expected !== undefined && expected !== operation) return false;
    this.runInvalidationGuards(operation);
    if (this.operation !== operation) return false;
    this.operation = null; operation.guards.clear(); return true;
  }
  private get hostReady(): boolean {
    return this.owner !== null && !this.owner.eventSaveRequest && this.hasStarted && !this.operation && !!this.host?.visible &&
      this.host.mediaReady && !this.host.overlayOpen;
  }
  private get hostAllowsInput(): boolean { return this.hostReady && !this.isPaused; }
  /** Visibility/readiness changes can revoke input immediately without an
   * advance(0) that might execute an event or consume a pending handoff. */
  observeHost(host: GameFlowHostState): void {
    if (!host || [host.visible, host.mediaReady, host.overlayOpen].some((value) => typeof value !== "boolean"))
      throw new Error("Incomplete game flow host state");
    this.host = { visible: host.visible, mediaReady: host.mediaReady, overlayOpen: host.overlayOpen };
  }
  advance(ms: number, host: GameFlowHostState): void {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) throw new Error("Invalid game flow elapsed time");
    this.observeHost(host);
    const owner = this.owner;
    if (!this.hostAllowsInput || !owner) return;
    if (!owner.battle && (owner.field.stop?.kind === "map-transition" || owner.field.stop?.kind === "unsupported")) return;
    // Suppressed elapsed time is dropped, never accumulated into a resume jump.
    owner.advance(ms);
  }
  move(direction: Direction): boolean {
    if (!["up", "right", "down", "left"].includes(direction)) throw new Error("Invalid game flow direction");
    const owner = this.owner;
    if (!this.hostAllowsInput || !owner || owner.battle) return false;
    return owner.field.move(direction);
  }
  /** True means eligible input was dispatched; the field owner decides whether
   * a nearby object or a waiting dialogue actually accepts the confirmation. */
  confirm(): boolean {
    const owner = this.owner;
    if (!this.hostAllowsInput || !owner || owner.battle || owner.field.stop || owner.field.choicePending) return false;
    owner.field.confirm(); return true;
  }
  choose(requestId: string, answer: FieldChoiceAnswer): boolean {
    const owner = this.owner;
    if (!this.hostAllowsInput || !owner || owner.battle || owner.field.stop) return false;
    return owner.field.choose(requestId, answer);
  }
  continueVictory(): boolean {
    const owner = this.owner;
    return this.hostAllowsInput && owner?.battle?.phase === "victory" ? owner.continueVictory() : false;
  }
  get canEscape(): boolean { return this.hostAllowsInput && !!this.owner?.canEscape; }
  requestEscape(): boolean { return this.canEscape ? this.owner!.requestEscape() : false; }
  continueEscape(): boolean {
    return this.hostAllowsInput && this.owner?.battle?.phase === "escaped" ? this.owner.continueEscape() : false;
  }
  retryBattle(): boolean {
    const owner = this.owner;
    return this.hostAllowsInput && owner?.battle?.phase === "defeat" ? owner.retryBattle() : false;
  }
  retryEncounterPreparation(): boolean {
    return this.hostAllowsInput ? this.owner!.retryEncounterPreparation() : false;
  }
}
