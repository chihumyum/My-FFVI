import { canonical } from "./canonical.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
import { preparePartyActors, type PartyActorCatalog, type PartyActorContext,
  type PartyActorInstance, type PartyActorPlan } from "./party-actors.js";
import type { PartyAppearanceCandidate } from "./party.js";
import { projectFieldTransportActorInstance, validateFieldTransportActorInstance,
  type FieldTransportActorOperation, type FieldTransportActorPresentation } from "./field-transport-actors.js";

export type FieldPartyActorCheckpoint = {
  kind: "field-party-actors-v1";
  /** Saved actor state never owns a second copy of the game's party roster. */
  context: PartyActorContext;
  playerAssetCacheId: number | null;
};
export type FieldPartyActorRenderStep = {
  media: { asset: string; mount: string | null };
  /** Includes every source write in order, including repeated replacements
   * and cameraOffset:null (which means no write, not a reset to zero). */
  plan: PartyActorPlan;
};
export type FieldPartyActorRendererPublication = {
  /** Read-only current-owner check. The containing owned transaction calls
   * this before publishing any of its state. */
  validate(): void;
  /** Synchronous publication of already prepared data; no fallible work,
   * current-roster reads, callbacks or per-plan stale checks belong here. */
  commit(): void;
};
export type FieldPartyActorRendererBatch = {
  /** One detached projection for the whole ordered batch. This host explicitly
   * accepts or rejects every camera write, including nonzero source offsets. */
  prepareBatch(steps: readonly FieldPartyActorRenderStep[]): FieldPartyActorRendererPublication;
};
/** Compatibility path for the existing zero-offset development renderer.
 * Each returned closure must publish prepared data without throwing. Native
 * actor/camera owners must use the batch port, never independent closures. */
export type LegacyFieldPartyActorRenderer = (
  media: FieldPartyActorRenderStep["media"], plan: PartyActorPlan,
) => () => void;
export type FieldPartyActorRenderer = LegacyFieldPartyActorRenderer | FieldPartyActorRendererBatch;
/** Callable compatibility with the existing dispatchers. validate() must run
 * before an outer owned-state commit; invocation also guards direct callers. */
export type FieldPartyActorPublication = (() => void) & { validate(): void };

const instances = (c: PartyActorContext): PartyActorInstance[] =>
  [c.player, ...c.puppets, ...c.multiParty.map((p) => p.actor),
    c.companion?.actor ?? null, c.companion?.puppet ?? null].filter((a): a is PartyActorInstance => a !== null);
const detachedContext = (context: PartyActorContext) => ({ ...structuredClone(context),
  multiParty: context.multiParty.map((p) => ({ ...structuredClone(p), members: [] })) });
function readonlyCopy<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  };
  freeze(copied);
  return copied;
}

/** Asset bookkeeping, never a second owner of native pose, visibility, animation
 * or camera offset. Renderer preparation binds these source IDs to live actors. */
export class FieldPartyActors {
  private state: FieldPartyActorCheckpoint;
  private readonly catalog: PartyActorCatalog;
  private readonly origin: FieldPartyActorCheckpoint;
  private revision = 0;
  private publishing = false;
  constructor(catalog: PartyActorCatalog,
    origin: FieldPartyActorCheckpoint,
    transportationId: number | null,
    private readonly transportationPresentation?: FieldTransportActorPresentation) {
    this.catalog = structuredClone(catalog);
    this.origin = { ...structuredClone(origin), context: detachedContext(origin.context) };
    this.state = structuredClone(this.origin);
    if (origin.context.currentTransport?.id !== transportationId)
      throw new Error("Party appearance transportation is not bound to this field");
    this.validate(this.state);
  }
  private validate(value: FieldPartyActorCheckpoint) {
    checkpointKeys(value, "kind,context,playerAssetCacheId");
    if (value.kind !== "field-party-actors-v1") throw new Error("Unknown field party appearance checkpoint");
    const c = value.context, base = this.origin.context;
    checkpointKeys(c, "leaderIndex,player,puppets,currentTransport,conditionResidents,companion,multiParty,conditionColliders,camera");
    if (value.playerAssetCacheId !== null) {
      checkpointInteger(value.playerAssetCacheId, 1, 0x7fffffff);
      if (!this.catalog.assets[value.playerAssetCacheId]) throw new Error("Unknown player appearance cache");
    }
    // The explicit framework transportation host can change a source-bound
    // transport identity. Other providers remain bound to this map's origin.
    if (this.transportationPresentation !== "framework-development" && canonical(c.currentTransport) !== canonical(base.currentTransport))
      throw new Error("Unsupported saved appearance provider change: currentTransport");
    for (const key of ["conditionResidents", "companion", "conditionColliders", "camera"] as const)
      if (canonical(c[key]) !== canonical(base[key])) throw new Error("Unsupported saved appearance provider change: " + key);
    if (!Array.isArray(c.multiParty) || c.multiParty.length !== 3 ||
      !Array.isArray(c.puppets) || c.puppets.length !== base.puppets.length)
      throw new Error("Saved native actor inventory changed");
    for (const [index, party] of c.multiParty.entries()) {
      checkpointKeys(party, "leaderIndex,members,actor");
      if (!Array.isArray(party.members) || party.members.length) throw new Error("Duplicate saved party ownership");
      if (party.leaderIndex !== base.multiParty[index]!.leaderIndex)
        throw new Error("Unsupported saved per-party leader change");
    }
    const actors = instances(c), initial = instances(base);
    if (canonical(actors.map((a) => a.id)) !== canonical(initial.map((a) => a.id)))
      throw new Error("Saved native actor identities changed");
    for (const [index, actor] of actors.entries()) {
      checkpointKeys(actor, "id,fieldAssetId,riderFieldAssetId,riding");
      for (const id of [actor.fieldAssetId, actor.riderFieldAssetId]) {
        if (id === null) continue;
        checkpointInteger(id, 1, 0x7fffffff);
        if (!this.catalog.assets[id]) throw new Error("Unknown saved field appearance asset");
      }
      validateFieldTransportActorInstance(this.catalog, actor);
      if (this.transportationPresentation !== "framework-development" && (actor.riding !== initial[index]!.riding ||
        (actor.riding && actor.fieldAssetId !== initial[index]!.fieldAssetId) ||
        (!actor.riding && actor.riderFieldAssetId !== initial[index]!.riderFieldAssetId)))
        throw new Error("Unsupported saved native riding transition");
      if (actor.riding && !this.catalog.transportations.some((t) => t.fieldAssetId === actor.fieldAssetId))
        throw new Error("Unknown saved transportation outer asset");
    }
    // The planner validates leader ranges, references and all hidden instances.
    preparePartyActors(this.catalog, [], c, true);
    this.playerMedia(value);
  }
  checkpoint(): FieldPartyActorCheckpoint { return structuredClone(this.state); }
  restore(raw: FieldPartyActorCheckpoint) {
    if (this.publishing) throw new Error("Cannot restore party appearance during publication");
    const next = structuredClone(raw);
    this.validate(next);
    this.state = next;
    this.revision++;
  }
  /** Publish bookkeeping already produced by source refreshes on a private
   * actor draft. This does not run renderer effects or initialize actors. */
  prepareState(raw: FieldPartyActorCheckpoint): FieldPartyActorRendererPublication {
    if (this.publishing) throw new Error("Cannot prepare party appearance during publication");
    const next = structuredClone(raw), revision = this.revision;
    this.validate(next);
    let validated = false, committed = false;
    return {
      validate: () => {
        validated = false;
        if (committed || this.publishing || revision !== this.revision)
          throw new Error("Stale party appearance state");
        validated = true;
      },
      commit: () => {
        if (!validated || committed) throw new Error("Party appearance state requires current validation");
        this.state = next; this.revision++; committed = true;
      },
    };
  }
  /** Bookkeeping half of a containing actor/controller transaction. The caller
   * projects the SAME ordered operations onto native actors and validates both
   * publications before committing either. No renderer callback runs here. */
  prepareTransportation(input: {
    operations: readonly FieldTransportActorOperation[];
    currentTransport?: PartyActorContext["currentTransport"];
  }): FieldPartyActorRendererPublication & { readonly checkpoint: FieldPartyActorCheckpoint } {
    if (this.transportationPresentation !== "framework-development")
      throw new Error("Transportation changes require explicit framework-development presentation");
    if (!input || !Array.isArray(input.operations)) throw new Error("Missing party transportation candidate");
    const next = this.checkpoint(), actors = instances(next.context);
    for (const op of input.operations) {
      const actor = actors.find((a) => a.id === op.actorId);
      if (!actor) throw new Error("Transportation bookkeeping references an absent party actor");
      Object.assign(actor, projectFieldTransportActorInstance(actor, [op], this.catalog, this.transportationPresentation));
    }
    if (Object.hasOwn(input, "currentTransport")) {
      if (input.currentTransport === undefined) throw new Error("Unknown transportation identity");
      next.context.currentTransport = structuredClone(input.currentTransport);
    }
    const publication = this.prepareState(next);
    return { ...publication, get checkpoint() { return structuredClone(next); } };
  }
  playerMedia(state = this.state): { asset: string; mount: string | null } {
    const player = state.context.player;
    const id = player.riding ? player.riderFieldAssetId : player.fieldAssetId;
    const asset = id === null ? null : this.catalog.assets[id];
    const mount = player.riding && player.fieldAssetId !== null ? this.catalog.assets[player.fieldAssetId] : null;
    if (!asset || (player.riding && !mount)) throw new Error("Unresolved playable actor appearance");
    return { asset: asset.asset, mount: mount?.asset ?? null };
  }
  /** A source event refreshes once per target, including storage no-ops. Project
   * each step against the previous candidate, then let one renderer transaction
   * stage the complete sequence before any owned/context/native publication. */
  prepareSequence(
    steps: readonly { appearance: PartyAppearanceCandidate; setDummy: boolean }[],
    renderer: FieldPartyActorRenderer,
  ): FieldPartyActorPublication {
    if (!Array.isArray(steps)) throw new Error("Missing ordered party appearance steps");
    if (this.publishing) throw new Error("Cannot prepare party appearance during publication");
    const revision = this.revision;
    let next = this.checkpoint();
    const rendered: FieldPartyActorRenderStep[] = [];
    for (const step of steps) {
      if (!step || typeof step.setDummy !== "boolean") throw new Error("Unknown party appearance dummy request");
      const prepared = this.prepareStep(next, step.appearance, step.setDummy);
      next = prepared.next;
      rendered.push(prepared.render);
    }
    const publication = this.prepareRenderer(rendered, renderer);
    let consumed = false;
    const validate = () => {
      if (consumed || this.publishing || revision !== this.revision)
        throw new Error("Stale or repeated party appearance transaction");
      publication.validate();
      if (revision !== this.revision) throw new Error("Party appearance changed during renderer validation");
    };
    const publish = () => {
      validate();
      consumed = true;
      this.publishing = true;
      try {
        // A renderer rejection cannot install this checkpoint. The accepted
        // batch commit is a no-throw write; arbitrary external effects cannot
        // be rolled back by this asset-bookkeeping owner.
        publication.commit();
        this.state = next;
        this.revision++;
      } finally { this.publishing = false; }
    };
    return Object.assign(publish, { validate });
  }
  /** All fallible media/animation preparation happens before owned publication. */
  prepare(candidate: PartyAppearanceCandidate,
    renderer: FieldPartyActorRenderer,
    setDummy = true): FieldPartyActorPublication {
    return this.prepareSequence([{ appearance: candidate, setDummy }], renderer);
  }
  private prepareStep(state: FieldPartyActorCheckpoint, candidate: PartyAppearanceCandidate,
    setDummy: boolean): { next: FieldPartyActorCheckpoint; render: FieldPartyActorRenderStep } {
    if (!candidate || candidate.parties.length !== 3) throw new Error("Missing candidate owned appearance");
    const context = structuredClone(state.context);
    context.multiParty.forEach((party, index) => { party.members = structuredClone(candidate.parties[index]!); });
    const plan = preparePartyActors(this.catalog, candidate.activeMembers, context, setDummy);
    if (plan.colliderChanges.length)
      throw new Error("Conditional party collision refresh is not supported by this field host");
    if (canonical(plan.companionConditionTypes) !== canonical(state.context.companion?.conditionTypes ?? null))
      throw new Error("Companion condition refresh is not supported by this field host");
    const next = structuredClone(state), actors = instances(next.context);
    for (const change of plan.changes) {
      const actor = actors.find((a) => a.id === change.actorId);
      if (!actor) throw new Error("Party appearance references an absent native actor");
      if (change.mode === "rider") {
        if (!actor.riding) throw new Error("Native rider replacement without a riding entity");
        actor.riderFieldAssetId = change.asset.id;
      } else {
        if (actor.riding) throw new Error("Native ride clearing requires a transportation host");
        actor.fieldAssetId = change.asset.id;
      }
    }
    next.context.leaderIndex = plan.savedLeaderIndex;
    if (plan.playerAssetCache) next.playerAssetCacheId = plan.playerAssetCache.id;
    this.validate(next);
    return { next, render: { media: this.playerMedia(next), plan } };
  }
  private prepareRenderer(steps: readonly FieldPartyActorRenderStep[],
    renderer: FieldPartyActorRenderer): FieldPartyActorRendererPublication {
    if (typeof renderer === "function") {
      for (const { plan } of steps) {
        if (plan.cameraOffset && (plan.cameraOffset.x !== 0 || plan.cameraOffset.y !== 0))
          throw new Error("Nonzero party camera offset is not supported by this field renderer");
      }
      const callbacks = steps.map((step) => {
        const { media, plan } = structuredClone(step);
        const publish = renderer(media, plan);
        if (typeof publish !== "function") throw new Error("Invalid party renderer transaction");
        return publish;
      });
      return { validate() {}, commit() { for (const publish of callbacks) publish(); } };
    }
    if (!renderer || typeof renderer.prepareBatch !== "function")
      throw new Error("Missing party batch renderer capability");
    if (steps.length === 0) return { validate() {}, commit() {} };
    const publication = renderer.prepareBatch(readonlyCopy(steps));
    if (!publication || typeof publication.validate !== "function" || typeof publication.commit !== "function")
      throw new Error("Invalid party batch renderer transaction");
    // Validate while still preparing as well as at publication admission. The
    // outer owner may then revalidate immediately before its own commit.
    const accepted = { validate: publication.validate.bind(publication), commit: publication.commit.bind(publication) };
    accepted.validate();
    return accepted;
  }
}
