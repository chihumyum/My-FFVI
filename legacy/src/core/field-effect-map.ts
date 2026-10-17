import type {OwnedFieldEffectSource} from './field-effect-source-admission.js';
import type {FieldEffectBoardLifetime} from './field-effect-board-lifetime.js';
import { fieldEffectBoardId, type FieldEffectCandidate, type FieldEffectOperation,
  type FieldEffectPrepared, type FieldEffectState, type FieldEffectCatalog, type FieldEffects } from "./field-effects.js";
import { canonical } from "./canonical.js";
import { WEB_LOGICAL_FIELD_EFFECTS } from "./field-logical-effects.js";

type EffectAccess = Pick<FieldEffects, "snapshot" | "catalogSnapshot" | "assertCatalog" | "assertAdmittedCatalog" | "prepare" | "prepareTick" | "boardLifetime">;

/** A map leases boards from the world's manager. It never resets that manager,
 * owns a second player pool, or turns a logical snapshot into a particle save. */
export class FieldEffectMap {
  #access: EffectAccess;
  #retired: FieldEffectState | null = null;
  #publishing = false;
  readonly #ids: Map<string, string>;
  readonly #locals: Map<string, string>;
  constructor(readonly scope: string, access: EffectAccess, localIds: readonly string[],
    readonly logicalPolicy: typeof WEB_LOGICAL_FIELD_EFFECTS | null = null,
    readonly restoreSeed = false) {
    if (new Set(localIds).size !== localIds.length) throw new Error("Duplicate map effect board identity");
    this.#access = access;
    if (logicalPolicy && access.catalogSnapshot().webPolicy?.kind !== logicalPolicy)
      throw new Error("Unbound logical effect map capability");
    this.#ids = new Map(localIds.map((id) => [id, fieldEffectBoardId(scope, id)]));
    this.#locals = new Map([...this.#ids].map(([local, global]) => [global, local]));
  }
  #active(): void {
    if (this.#retired) throw new Error("Retired map cannot mutate the shared field effect manager");
    if (this.#publishing) throw new Error("Map effect publication is already in progress");
  }
  #id(local: string): string {
    const id = this.#ids.get(local);
    if (id === undefined) throw new Error("Unknown map effect board identity " + local);
    return id;
  }
  #project(state: FieldEffectState): FieldEffectState {
    const next = structuredClone(state);
    next.boards = next.boards.filter((board) => this.#locals.has(board.id))
      .map((board) => ({ ...board, id: this.#locals.get(board.id)! }));
    return next;
  }
  captureBoard(local:string):{readonly lifetime:FieldEffectBoardLifetime;validate():void} {
    this.#active();const id=this.#id(local),lifetime=this.#access.boardLifetime(id);
    // Access changes from the disposable candidate to its published owner.
    // Its adopted token must stay the same across that successful handoff.
    return {lifetime,validate:()=>{if(this.#retired)throw Error("Retired map effect board instance");if(this.#access.boardLifetime(id)!==lifetime)throw Error("Stale actual field effect board instance");}};
  }
  snapshot(): FieldEffectState { return this.#retired ? structuredClone(this.#retired) : this.#project(this.#access.snapshot()); }
  /** Empty later maps still inherit allocation history. Until that history and
   * native particle state have a codec they cannot produce a stable save. */
  get hasHistory(): boolean { return this.snapshot().instanceCount !== 0; }
  get active(): boolean { return this.#retired === null; }
  assertCatalog(catalog: FieldEffectCatalog): void {
    this.#access.assertCatalog(catalog);
  }
  assertAdmittedCatalog(source:OwnedFieldEffectSource):void {this.#access.assertAdmittedCatalog(source);}
  prepare(operations: readonly FieldEffectOperation[]): FieldEffectPrepared {
    this.#active();
    const mapped = operations.map((operation): FieldEffectOperation => {
      if ("id" in operation) return { ...operation, id: this.#id(operation.id) };
      if (operation.kind === "setup") return { ...operation, registeredBoards: operation.registeredBoards.map((id) => this.#id(id)) };
      throw new Error("Map effects cannot directly alter manager caches or observations");
    });
    const access = this.#access;
    return this.#prepared(access.prepare(mapped), access);
  }
  #prepared(prepared: FieldEffectPrepared, access: EffectAccess): FieldEffectPrepared {
    const validateLease = () => {
      this.#active();
      if (access !== this.#access) throw new Error("Stale map effect access");
    };
    const validate = () => {
      validateLease();
      prepared.validate();
      validateLease();
    };
    const commitWith = (commitOwned: () => boolean): boolean => {
      validateLease();
      try { return prepared.commitWith(() => {
          // The underlying host callback can invalidate a lease. Recheck only
          // our local binding before publication, never rerun host validation.
          validateLease(); this.#publishing = true;
          return commitOwned();
        });
      } finally { this.#publishing = false; }
    };
    return { get state() { return prepared.state; }, validate, commit: () => { commitWith(() => true); }, commitWith };
  }
  prepareTick(seconds: number): FieldEffectPrepared {
    this.#active();
    const access = this.#access;
    return this.#prepared(access.prepareTick(seconds), access);
  }
  /** Complete the ordinary MapCleanTask phase before any destination create.
   * Cache release does not reset counters; board retirement releases refs. The
   * native coroutine yields after ClearCurrentMap to drain object destruction.
   * Event pools, retained/copy maps and resident FX are not admitted here. */
  prepareRetirement(candidate: FieldEffectCandidate): void {
    this.#active();
    const state = this.#access.snapshot(), boards = state.boards.filter((board) => this.#locals.has(board.id));
    if (boards.length !== state.boards.length) throw new Error("Unowned boards in ordinary map effect retirement");
    const operations: FieldEffectOperation[] = [
      ...boards.map((board): FieldEffectOperation => ({ kind: "release-prefab", assetGroup: board.definition.assetGroup })),
      ...boards.map((board): FieldEffectOperation => ({ kind: "destroy", id: board.id })),
    ];
    if (operations.length) candidate.prepare(operations).commit();
  }
  /** Only the WorldSession publication calls these no-fail local pointer swaps. */
  publish(owner: FieldEffects): void { this.#active(); this.#access = owner; }
  retire(snapshot: FieldEffectState): void { this.#active(); this.#retired = structuredClone(snapshot); }
}
