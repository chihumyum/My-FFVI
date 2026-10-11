import { canonical } from "./canonical.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
import { preparePartyActors, type PartyActorCatalog, type PartyActorContext,
  type PartyActorInstance, type PartyActorPlan } from "./party-actors.js";
import type { PartyAppearanceCandidate } from "./party.js";

export type FieldPartyActorCheckpoint = {
  kind: "field-party-actors-v1";
  /** Saved actor state never owns a second copy of the game's party roster. */
  context: PartyActorContext;
  playerAssetCacheId: number | null;
};

const instances = (c: PartyActorContext): PartyActorInstance[] =>
  [c.player, ...c.puppets, ...c.multiParty.map((p) => p.actor),
    c.companion?.actor ?? null, c.companion?.puppet ?? null].filter((a): a is PartyActorInstance => a !== null);
const detachedContext = (context: PartyActorContext) => ({ ...structuredClone(context),
  multiParty: context.multiParty.map((p) => ({ ...structuredClone(p), members: [] })) });

/** Native hidden actors keep source identities without invented coordinates or
 * Web NPC bindings. Only the existing player has a renderer in this host. */
export class FieldPartyActors {
  private state: FieldPartyActorCheckpoint;
  constructor(private readonly catalog: PartyActorCatalog,
    private readonly origin: FieldPartyActorCheckpoint,
    transportationId: number | null) {
    this.state = { ...structuredClone(origin), context: detachedContext(origin.context) };
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
    // These providers have no runtime mutation yet. A restore may not invent a
    // companion, change transport, change condition residents or map geometry.
    for (const key of ["currentTransport", "conditionResidents", "companion", "conditionColliders", "camera"] as const)
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
      if (actor.riding !== initial[index]!.riding ||
        (actor.riding && actor.fieldAssetId !== initial[index]!.fieldAssetId) ||
        (!actor.riding && actor.riderFieldAssetId !== initial[index]!.riderFieldAssetId))
        throw new Error("Unsupported saved native riding transition");
    }
    // The planner validates leader ranges, references and all hidden instances.
    preparePartyActors(this.catalog, [], c, true);
    this.playerMedia(value);
  }
  checkpoint(): FieldPartyActorCheckpoint { return structuredClone(this.state); }
  restore(raw: FieldPartyActorCheckpoint) {
    const next = structuredClone(raw);
    this.validate(next);
    this.state = next;
  }
  playerMedia(state = this.state): { asset: string; mount: string | null } {
    const player = state.context.player;
    const id = player.riding ? player.riderFieldAssetId : player.fieldAssetId;
    const asset = id === null ? null : this.catalog.assets[id];
    const mount = player.riding && player.fieldAssetId !== null ? this.catalog.assets[player.fieldAssetId] : null;
    if (!asset || (player.riding && !mount)) throw new Error("Unresolved playable actor appearance");
    return { asset: asset.asset, mount: mount?.asset ?? null };
  }
  /** A source event can refresh once per target. Build that ordered sequence
   * against an isolated actor state, checking every intermediate media binding
   * before the caller publishes any owned state. Renderer callbacks only run
   * after all preparations succeed, in the same source order. */
  prepareSequence(
    steps: readonly { appearance: PartyAppearanceCandidate; setDummy: boolean }[],
    prepareRenderer: (media: { asset: string; mount: string | null }, plan: PartyActorPlan) => () => void,
  ): () => void {
    const draft = new FieldPartyActors(this.catalog, this.origin, this.state.context.currentTransport?.id ?? null);
    draft.restore(this.checkpoint());
    const publications: (() => void)[] = [];
    for (const step of steps) {
      draft.prepare(step.appearance, (media, plan) => {
        const publish = prepareRenderer(media, plan);
        if (typeof publish !== "function") throw new Error("Invalid party renderer transaction");
        publications.push(publish);
        return () => {};
      }, step.setDummy)();
    }
    const next = draft.checkpoint();
    return () => { this.state = next; for (const publish of publications) publish(); };
  }
  /** All fallible media/animation preparation happens before owned publication. */
  prepare(candidate: PartyAppearanceCandidate,
    prepareRenderer: (media: { asset: string; mount: string | null }, plan: PartyActorPlan) => () => void,
    setDummy = true): () => void {
    if (!candidate || candidate.parties.length !== 3) throw new Error("Missing candidate owned appearance");
    const context = structuredClone(this.state.context);
    context.multiParty.forEach((party, index) => { party.members = structuredClone(candidate.parties[index]!); });
    const plan = preparePartyActors(this.catalog, candidate.activeMembers, context, setDummy);
    if (plan.cameraOffset && (plan.cameraOffset.x !== 0 || plan.cameraOffset.y !== 0))
      throw new Error("Nonzero party camera offset is not supported by this field renderer");
    if (plan.colliderChanges.length)
      throw new Error("Conditional party collision refresh is not supported by this field host");
    if (canonical(plan.companionConditionTypes) !== canonical(this.state.context.companion?.conditionTypes ?? null))
      throw new Error("Companion condition refresh is not supported by this field host");
    const next = this.checkpoint(), actors = instances(next.context);
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
    const publishRenderer = prepareRenderer(this.playerMedia(next), plan);
    if (typeof publishRenderer !== "function") throw new Error("Invalid party renderer transaction");
    return () => { this.state = next; publishRenderer(); };
  }
}
