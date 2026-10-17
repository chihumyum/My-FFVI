import type { FieldPuppetActorEffect } from "./field-puppet-actors.js";

/** Captured before the source target mutation, queried for activity AFTER its
 * Refresh(false). isActiveAndEnabled is not interchangeable with alpha>0 or a
 * same-actor test. A host must bind enabled/parent-activity eligibility. */
export type ConditionLeaderBefore = {
  actor: string;
  activeAndEnabled: boolean | "unknown";
};
export type ConditionLeaderAffectPlan = {
  result: "flag-disabled" | "previous-inactive" | "transfer";
  effects: FieldPuppetActorEffect[];
};

/** Character.AffectLeaderWithCondition 0xb45540. Alias resolution belongs to
 * the caller's exact source-owned pre/post Refresh contexts. This pure plan
 * neither owns actors/conditions nor resolves an unknown instance by ID. */
export function projectConditionLeaderAffect(input: {
  keepBadStatusVisual: boolean | undefined;
  before: ConditionLeaderBefore | null;
  /** Resolve -1010 from the post-refresh candidate. Undefined is permitted
   * only on a native early-return path; null on the active path is an error. */
  afterActor?: string | null;
}): ConditionLeaderAffectPlan {
  if (typeof input.keepBadStatusVisual !== "boolean")
    throw new Error("Unknown source condition leader visual flag");
  if (!input.keepBadStatusVisual) return { result: "flag-disabled", effects: [] };
  if (!input.before || typeof input.before.actor !== "string" || !input.before.actor)
    throw new Error("Missing captured source condition leader instance");
  if (typeof input.before.activeAndEnabled !== "boolean")
    throw new Error("Unknown source condition leader active/enabled provider");
  if (!input.before.activeAndEnabled) return { result: "previous-inactive", effects: [] };
  if (typeof input.afterActor !== "string" || !input.afterActor)
    throw new Error("Missing post-refresh source condition leader instance");
  const before = input.before.actor, after = input.afterActor;
  // The native method has no identity early return. Even before===after must
  // Hide/Show and Cue(-1), including SetupAnimCommon's same-key next selection.
  // Direct GameObject.layer copy deliberately does not add material refreshes,
  // texture attachment, a direction copy or the Init/Finish lifecycle.
  return { result: "transfer", effects: [
    { kind: "hide", actor: before }, { kind: "show", actor: after },
    { kind: "copy-position", actor: after, from: before, mode: "overwrite" },
    { kind: "copy-layer", actor: after, from: before },
    { kind: "cue", actor: after, from: before },
  ] };
}
