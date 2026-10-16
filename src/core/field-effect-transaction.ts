import {projectFieldEffectBoardLifetimes,type FieldEffectBoardLifetime} from './field-effect-board-lifetime.js';
import type { FieldEffectCatalog, FieldEffectObservation, FieldEffectOperation, FieldEffectPlan,
  FieldEffectPrepared, FieldEffectPublication, FieldEffectState } from "./field-effects.js";

export type FieldEffectCandidateOrigin = { state: FieldEffectState; catalog: FieldEffectCatalog };
/** One plan per source operation retains intermediate players, board references
 * and media for create/destroy/recreate within a single local preparation. */
export type FieldEffectCandidateBatch = {
  catalog: FieldEffectCatalog; plans: FieldEffectPlan[];
  /** Aligned with plans. In particular retain the original tick delta; it
   * cannot be reconstructed from rounded shader elapsed-time differences. */
  operations: FieldEffectOperation[];
};
export type FieldEffectCandidateHost = {
  /** Check the generation captured by beginCandidate, including particle/RNG
   * state. Advancing the live host invalidates this private branch. */
  validate(): void;
  prepare(batch: Readonly<FieldEffectCandidateBatch>): FieldEffectPublication;
  /** Read a private simulation of origin plus this committed journal. Repeated
   * queries of the same journal/delta must not consume additional time or RNG.
   * An observation is not committed until its tick appears in a later journal.
   * The live scene is not an observer for an unpublished destination. */
  observe?(batch: Readonly<FieldEffectCandidateBatch>, deltaSeconds: number): FieldEffectObservation[];
  /** No-fail cleanup of unpublished private resources. Must not affect the live host. */
  discard?(): void;
};
/** These are explicit Web preparation budgets, not native game limits. */
export type FieldEffectCandidateLimits = { maxPreparations?: number; maxOperations?: number };
export type FieldEffectCandidatePrepared = FieldEffectPrepared;
type CandidateOwner = {
  validate(): void;
  lifetimes():ReadonlyMap<string,FieldEffectBoardLifetime>;
  project(state: FieldEffectState, catalog: FieldEffectCatalog, operations: readonly FieldEffectOperation[]): FieldEffectPlan;
  publish(state: FieldEffectState, catalog: FieldEffectCatalog,lifetimes:ReadonlyMap<string,FieldEffectBoardLifetime>, commit: () => void, commitOwned: () => boolean): boolean;
};

/** A disposable branch of FieldEffects, not another live manager. Only seal's
 * final publication may change its owner or the external particle host. */
export class FieldEffectCandidate {
  #state: FieldEffectState;
  #boardLifetimes:Map<string,FieldEffectBoardLifetime>;
  readonly #catalog: FieldEffectCatalog;
  readonly #host: FieldEffectCandidateHost;
  readonly #owner: CandidateOwner;
  readonly #maxPreparations: number;
  readonly #maxOperations: number;
  #phase: "open" | "sealed" | "publishing" | "published" | "discarded" = "open";
  #plans: FieldEffectPlan[] = [];
  #operationJournal: FieldEffectOperation[] = [];
  #revision = 0;
  #preparations = 0;
  #operations = 0;
  #callingHost = false;
  #localPublishing = false;

  /** Construct through FieldEffects.fork so the source owner is revision-bound. */
  constructor(origin: FieldEffectCandidateOrigin, host: FieldEffectCandidateHost,
    owner: CandidateOwner, limits: FieldEffectCandidateLimits = {}) {
    const limit = (value: number | undefined, fallback: number) => {
      const n = value ?? fallback;
      if (!Number.isSafeInteger(n) || n < 1 || n > 65536) throw new Error("Invalid field effect candidate budget");
      return n;
    };
    this.#maxPreparations = limit(limits.maxPreparations, 1024);
    this.#maxOperations = limit(limits.maxOperations, 4096);
    this.#state = structuredClone(origin.state); this.#catalog = structuredClone(origin.catalog);
    this.#host = host; this.#owner = owner;this.#boardLifetimes=new Map(owner.lifetimes());
    this.#validateOrigin();
  }
  boardLifetime(id:string):FieldEffectBoardLifetime {
    if(this.#phase!=="open"&&this.#phase!=="sealed")throw Error("Retired field effect candidate lifetime");this.#validateOrigin();
    const token=this.#boardLifetimes.get(id);if(!token||!this.#state.boards.some(board=>board.id===id))throw Error("Retired or missing field effect board lifetime");return token;
  }
  snapshot(): FieldEffectState { return structuredClone(this.#state); }
  catalogSnapshot(): FieldEffectCatalog { return structuredClone(this.#catalog); }
  #callHost<T>(callback: () => T): T {
    if (this.#callingHost) throw new Error("Reentrant field effect candidate host");
    this.#callingHost = true;
    try { return callback(); } finally { this.#callingHost = false; }
  }
  #validateOrigin(): void {
    this.#owner.validate();
    this.#callHost(() => this.#host.validate());
    this.#owner.validate();
  }
  #requireOpen(): void {
    if (this.#phase !== "open" || this.#callingHost || this.#localPublishing) throw new Error("Field effect candidate is closed or busy");
    this.#validateOrigin();
  }
  #budget(operations: number): void {
    if (this.#preparations >= this.#maxPreparations || this.#operations + operations > this.#maxOperations)
      throw new Error("Field effect candidate preparation budget exceeded");
  }
  #batch(): FieldEffectCandidateBatch {
    return structuredClone({ catalog: this.#catalog, plans: this.#plans, operations: this.#operationJournal });
  }
  #prepare(operations: readonly FieldEffectOperation[]): FieldEffectPrepared {
    this.#requireOpen(); this.#budget(operations.length);
    const revision = this.#revision;
    const plans: FieldEffectPlan[] = [];
    const journal = structuredClone(operations);
    let next = this.snapshot();
    for (const operation of journal) {
      const plan = this.#owner.project(next, this.#catalog, [operation]);
      plans.push(plan); next = plan.after;
    }
    const lifetimes=projectFieldEffectBoardLifetimes(this.#boardLifetimes,journal);
    this.#requireOpen();
    this.#preparations++; this.#operations += operations.length;
    let used = false;
    const validate = () => {
      this.#requireOpen();
      if (used || this.#revision !== revision) throw new Error("Stale field effect candidate preparation");
    };
    const commitWith = (commitOwned: () => boolean): boolean => {
      validate(); used = true;
      // Allocate the complete journal before another owner is changed. Private
      // Ready/group changes may compose here without invoking the live host.
      const nextPlans = [...this.#plans, ...plans], nextJournal = [...this.#operationJournal, ...journal];
      this.#localPublishing = true;
      try {
        if (commitOwned() !== true) return false;
        this.#state = next;this.#boardLifetimes=lifetimes; this.#plans = nextPlans; this.#operationJournal = nextJournal; this.#revision++;
        return true;
      } finally { this.#localPublishing = false; }
    };
    return { get state() { return structuredClone(next); }, validate,
      commit: () => { commitWith(() => true); }, commitWith };
  }
  prepare(operations: readonly FieldEffectOperation[]): FieldEffectPrepared {
    // Caller-authored or live-host observations cannot authorize private ticks.
    if (operations.some((operation) => operation.kind === "tick"))
      throw new Error("Field effect candidate ticks require prepareTick and a private observer");
    return this.#prepare(operations);
  }
  prepareTick(deltaSeconds: number): FieldEffectPrepared {
    this.#requireOpen(); this.#budget(1);
    if (!Number.isFinite(deltaSeconds) || !Number.isFinite(Math.fround(deltaSeconds)) || deltaSeconds < 0)
      throw new Error("Invalid field effect candidate delta");
    if (typeof this.#host.observe !== "function") throw new Error("Field effect candidate playback observer is unavailable");
    const revision = this.#revision;
    const observations = this.#callHost(() => this.#host.observe!(this.#batch(), deltaSeconds));
    this.#requireOpen();
    if (this.#revision !== revision) throw new Error("Stale field effect candidate observation");
    return this.#prepare([{ kind: "tick", deltaSeconds, observations }]);
  }
  seal(): FieldEffectCandidatePrepared {
    this.#requireOpen();
    this.#phase = "sealed";
    let publication: FieldEffectPublication;
    try {
      publication = this.#callHost(() => this.#host.prepare(this.#batch()));
      this.#validateOrigin();
    } catch (error) { this.#discard(); throw error; }
    const state = this.snapshot();
    const validate = () => {
      if (this.#phase !== "sealed" || this.#callingHost) throw new Error("Stale field effect candidate publication");
      this.#validateOrigin();
      this.#callHost(() => publication.validate());
      this.#validateOrigin();
    };
    const commitWith = (commitOwned: () => boolean): boolean => {
      validate();
      this.#phase = "publishing";
      let hostCommitStarted = false;
      try {
        const committed = this.#owner.publish(state, this.#catalog,this.#boardLifetimes, () => {
          hostCommitStarted = true;
          this.#callHost(() => publication.commit());
        }, commitOwned);
        if (committed) this.#phase = "published";
        else this.#discard();
        return committed;
      } catch (error) {
        if (!hostCommitStarted) this.#discard();
        // Opaque host commit is required not to fail. If it did start, its
        // uncertain resources cannot be treated as unpublished and discarded.
        // The commit is consumed; the live owner also becomes unusable.
        else this.#phase = "discarded";
        throw error;
      }
    };
    return { get state() { return structuredClone(state); }, validate,
      commit: () => { commitWith(() => true); }, commitWith };
  }
  #discard(): void {
    if (this.#phase === "discarded") return;
    this.#phase = "discarded";
    this.#callHost(() => this.#host.discard?.());
  }
  discard(): void {
    if (this.#phase === "discarded") return;
    if (this.#phase === "published" || this.#phase === "publishing" || this.#callingHost || this.#localPublishing)
      throw new Error("Cannot discard a published or busy field effect candidate");
    this.#discard();
  }
}
