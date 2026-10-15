import { canonical } from "./canonical.js";
import { projectConditionLeaderAffect, type ConditionLeaderAffectPlan } from "./condition-leader.js";
import { fieldPuppetContextFromActors, type FieldActorFactoryBindings } from "./field-actor-factory.js";
import type { FieldCameraMapRange } from "./field-camera.js";
import { prepareNativeFieldActorAppearance, type FieldNativeAnimationKeys } from "./field-native-appearance.js";
import { createNativeFieldActorDraft, prepareNativeFieldActorState, readNativeFieldActors,
  type NativeFieldActor, type NativeFieldActorOwner } from "./field-native-actors.js";
import { FieldPartyActors, type FieldPartyActorRenderStep } from "./field-party-actors.js";
import { resolveFieldPuppetActor, type FieldPuppetActorsPort } from "./field-puppet-actors.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostActor, type FieldPuppetHostProviders,
  type FieldPuppetHostSnapshot } from "./field-puppet-effects.js";
import type { FieldPuppetRosterRead } from "./field-puppet-roster.js";
import type { FieldTransportActorPresentation } from "./field-transport-actors.js";
import type { OwnedConditionAppearanceStep } from "./owned-condition.js";
import type { PartyActorCatalog } from "./party-actors.js";
import type { Character, Point } from "../field/types.js";

/** The existing FieldGame owns every live instance. The activity observation
 * additionally binds Behaviour.enabled and ancestor activity: activeSelf alone
 * cannot supply an unknown source isActiveAndEnabled result. */
export type FieldConditionActorsHost = {
  keepBadStatusVisual: boolean;
  readActors(): NativeFieldActorOwner;
  readPartyActors(): FieldPartyActors;
  readCatalog(): PartyActorCatalog;
  readPuppetContext(): ReturnType<FieldPuppetActorsPort["read"]>;
  readBindings(): FieldActorFactoryBindings;
  readMapRange(): FieldCameraMapRange;
  readCharacters(): Readonly<Record<string, Character>>;
  readAnimationKeys(): FieldNativeAnimationKeys;
  readProviders(): FieldPuppetHostProviders;
  readCamera(): FieldPuppetHostSnapshot["camera"];
  readCameraOffset(): Readonly<Point>;
  readActiveAndEnabled?(existingActorId: string, draftEntity: Readonly<FieldPuppetHostActor>): boolean | "unknown";
  transportationId: number | null;
  transportationPresentation?: FieldTransportActorPresentation;
};
export type FieldConditionActorsAudit = {
  beforeActor: string;
  afterActor: string | null;
  result: ConditionLeaderAffectPlan["result"];
  effects: ConditionLeaderAffectPlan["effects"];
};
export type FieldConditionActorsPublication = {
  validate(): void;
  /** Only prepared writes to the two existing owners; no provider calls. The
   * containing GameState transaction invokes its final Task fence first. */
  commit(): void;
  readonly cameraOffset: Readonly<Point>;
  readonly audit: readonly FieldConditionActorsAudit[];
};

const identities = (roster: Pick<FieldPuppetRosterRead, "party" | "owned">) => ({ party: roster.party,
  owned: roster.owned.map(({ conditionTypes: _, ...member }) => member) });
const serialActors = (actors: NativeFieldActorOwner) => Object.values(actors).map((actor) => ({
  ...actor.native!, entity: { ...actor.native!.entity, animation: actor.native!.entity.animation && {
    state: actor.native!.entity.animation.snapshot(), character: actor.native!.entity.animation.character } },
}));
/** Observation cannot smuggle candidate writes into an otherwise valid plan.
 * Retain nested identity too: equal replacement of animation/pose/fade is a
 * mutation even when its serialized value happens to be unchanged. */
function actorDraftObservation(actors: NativeFieldActorOwner) {
  const refs: object[] = [], seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value); refs.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(actors);
  return { refs, fingerprint: canonical(serialActors(actors)) };
}

/** Character.Add/RemoveCondition's exact per-target capture -> Refresh(false)
 * -> AffectLeader sequence. All projections share one detached actor draft;
 * unlike Init/Finish, Affect copies only world position and GameObject.layer. */
export function prepareFieldConditionActors(host: FieldConditionActorsHost,
  input: readonly OwnedConditionAppearanceStep[]): FieldConditionActorsPublication {
  if (typeof host.keepBadStatusVisual !== "boolean") throw new Error("Unknown source condition leader visual flag");
  if (!Array.isArray(input) || !input.length) throw new Error("Missing ordered condition actor steps");
  const steps = structuredClone(input);
  for (const step of steps) {
    if (!step || step.setDummy !== false || step.affectLeader !== true || !step.puppetRoster)
      throw new Error("Condition actor refresh requires its exact post-target puppet roster");
  }
  const owner = host.readActors(), party = host.readPartyActors(), catalog = host.readCatalog();
  const old = host.readPuppetContext(), bindings = host.readBindings(), map = host.readMapRange();
  const characters = host.readCharacters(), keys = host.readAnimationKeys();
  const activity = host.readActiveAndEnabled, visual = host.keepBadStatusVisual;
  if (visual && typeof activity !== "function") throw new Error("Source condition leader activity provider is unavailable");
  const currentParty = party.checkpoint(), offset = structuredClone(host.readCameraOffset());
  const characterRefs = Object.entries(characters);
  const sourceFingerprint = () => canonical({ context: host.readPuppetContext(), catalog: host.readCatalog(),
    bindings: host.readBindings(), map: host.readMapRange(), keys: host.readAnimationKeys(),
    characters: host.readCharacters(), camera: host.readCamera(), offset: host.readCameraOffset(),
    transportationId: host.transportationId, transportationPresentation: host.transportationPresentation ?? null,
    keepBadStatusVisual: host.keepBadStatusVisual });
  const sourceBefore = sourceFingerprint();
  const checkSource = () => {
    if (host.readActors() !== owner || host.readPartyActors() !== party || host.readCatalog() !== catalog ||
        host.readBindings() !== bindings || host.readMapRange() !== map || host.readCharacters() !== characters ||
        host.readAnimationKeys() !== keys || host.readActiveAndEnabled !== activity ||
        characterRefs.length !== Object.keys(characters).length ||
        characterRefs.some(([name, character]) => characters[name] !== character) ||
        sourceFingerprint() !== sourceBefore)
      throw new Error("Stale condition actor source context or media");
  };
  const project = () => {
    const actors: Record<string, NativeFieldActor> = Object.fromEntries(Object.values(owner).map((actor) => {
      if (!actor.native || !("steps" in actor) || typeof actor.steps !== "number")
        throw new Error("Condition actor refresh requires the complete native field actor owner");
      const copy = createNativeFieldActorDraft(actor as typeof actor & { steps: number }, map, catalog,
        host.transportationPresentation);
      return [copy.id, copy];
    }));
    const draftParty = new FieldPartyActors(catalog, currentParty, host.transportationId, host.transportationPresentation);
    let roster: FieldPuppetRosterRead = { owned: structuredClone(old.context.owned),
      party: [...old.context.party] as FieldPuppetRosterRead["party"] };
    let cameraOffset: Readonly<Point> = offset;
    const audit: FieldConditionActorsAudit[] = [];
    const context = () => fieldPuppetContextFromActors({ catalog: old.catalog, checkpoint: draftParty.checkpoint(),
      bindings, snapshot: readNativeFieldActors(actors, host.readCamera()), ...roster,
      entities: old.context.entities, restorePartyInstruction: old.context.restorePartyInstruction });
    // Validate the supplied source port against the SAME existing owner; no
    // alternate catalog, resident order or saved-leader projection is invented.
    if (canonical(context()) !== canonical(old.context)) throw new Error("Unbound condition actor source context");
    for (const step of steps) {
      const beforeActor = resolveFieldPuppetActor(old.catalog, context(), -1010).actor;
      if (!beforeActor || !actors[beforeActor]) throw new Error("Missing captured source condition leader instance");
      if (canonical(identities(step.puppetRoster!)) !== canonical(identities(roster)))
        throw new Error("Condition refresh cannot change owned identities or Corps cells");
      draftParty.prepare(step.appearance, { prepareBatch: (render: readonly FieldPartyActorRenderStep[]) => {
        let nextOffset = cameraOffset;
        for (const { plan } of render) if (plan.cameraOffset !== null) {
          const { x, y } = plan.cameraOffset;
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y)))
            throw new Error("Invalid condition refresh camera offset");
          nextOffset = Object.freeze({ x: Math.fround(x), y: Math.fround(y) });
        }
        const appearance = prepareNativeFieldActorAppearance({ readActors: () => actors,
          readCatalog: () => catalog, readCharacters: () => characters, readAnimationKeys: () => keys,
          readProviders: host.readProviders,
          ...(host.transportationPresentation ? { transportationPresentation: host.transportationPresentation } : {}) }, render);
        return { validate: appearance.validate, commit: () => { appearance.commit(); cameraOffset = nextOffset; } };
      } }, false)();
      roster = structuredClone(step.puppetRoster!);
      const observation = visual ? actorDraftObservation(actors) : null;
      const activeAndEnabled = visual ? activity!(beforeActor, actors[beforeActor]!.native.entity) : "unknown";
      if (observation) {
        const after = actorDraftObservation(actors);
        if (observation.fingerprint !== after.fingerprint || observation.refs.length !== after.refs.length ||
            observation.refs.some((ref, index) => ref !== after.refs[index]))
          throw new Error("Source condition leader activity observation mutated its actor draft");
      }
      if (activeAndEnabled !== "unknown" && typeof activeAndEnabled !== "boolean")
        throw new Error("Unknown source condition leader active/enabled provider");
      const afterActor = visual && activeAndEnabled === true
        ? resolveFieldPuppetActor(old.catalog, context(), -1010).actor : null;
      const plan = projectConditionLeaderAffect({ keepBadStatusVisual: visual,
        before: { actor: beforeActor, activeAndEnabled }, afterActor });
      const candidate = projectFieldPuppetActorEffects(plan.effects, readNativeFieldActors(actors, host.readCamera()),
        host.readProviders());
      for (const entity of candidate.actors) {
        const { moving: _, ...values } = entity;
        Object.assign(actors[entity.id]!.native.entity, values);
      }
      audit.push({ beforeActor, afterActor, result: plan.result, effects: plan.effects });
    }
    const checkpoint = draftParty.checkpoint();
    return { actors, checkpoint, cameraOffset, audit,
      fingerprint: canonical({ actors: serialActors(actors), checkpoint, cameraOffset, audit }) };
  };
  const draft = project();
  const native = prepareNativeFieldActorState({ readActors: () => host.readActors(), readCamera: () => null,
    readProviders: host.readProviders }, draft.actors);
  const appearance = party.prepareState(draft.checkpoint);
  let validated = false, consumed = false;
  const validate = () => {
    validated = false;
    if (consumed) throw new Error("Condition actor publication already committed");
    checkSource(); native.validate(); appearance.validate();
    if (project().fingerprint !== draft.fingerprint) throw new Error("Stale condition actor activity or providers");
    // No last provider is allowed to mutate an already checked live owner.
    checkSource(); native.validate(); appearance.validate(); validated = true;
  };
  return { validate, commit: () => {
    if (!validated || consumed) throw new Error("Condition actor publication requires current validation");
    native.commit(); appearance.commit(); consumed = true;
  }, get cameraOffset() { return Object.freeze({ ...draft.cameraOffset }); },
  get audit() { return structuredClone(draft.audit); } };
}
