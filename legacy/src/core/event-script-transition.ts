import { sourceScriptAnimationAsset, type SourceScriptAnimationCatalog, type SourceScriptAnimationContext } from "./source-script-animations.js";
/** Source External.Misc.ChangeScript; unlike Execute, this retains event hosts. */
export type EventScriptTransitionOp = {
  kind: "script-transition";
  targetScript: string;
  /** Native tbr keeps one suspended processing context; this is not a delay. */
  returnToCaller: boolean;
};

/** A content compiler must observe the actual Format.Animations array. An
 * absent declaration never grants the empty-custom-animation capability. */
export type EventScriptTransitionMetadata = { customAnimations: "none" } | SourceScriptAnimationContext;

/** ChangeScript calls ResetAll and Entry(0), then its enclosing Core.Clock
 * consumes Next with ForwardStep. Neither Execute nor an actor lifecycle runs. */
export function prepareEventScriptTransition(
  op: EventScriptTransitionOp,
  input: {
    main: boolean;
    hooked: boolean;
    currentMetadata: EventScriptTransitionMetadata | null | undefined;
    targetMetadata: EventScriptTransitionMetadata | null | undefined;
    targetLength: number;
    animationCatalog?: SourceScriptAnimationCatalog;
  },
): { script: string; pc: number; range: { min: number; max: number } } {
  if (op.kind !== "script-transition" || typeof op.targetScript !== "string" || !op.targetScript.trim() ||
      typeof op.returnToCaller !== "boolean") throw new Error("Invalid source script transition");
  if (!input.main) throw new Error("ChangeScript from a puppet or external task is not implemented");
  if (op.returnToCaller && input.hooked) throw new Error("ChangeScript already has a hooked caller");
  try { sourceScriptAnimationAsset(input.currentMetadata,input.animationCatalog);sourceScriptAnimationAsset(input.targetMetadata,input.animationCatalog); }
  catch { throw new Error("ChangeScript custom-animation context is unknown or unsupported"); }
  if (!Number.isInteger(input.targetLength) || input.targetLength < 2)
    throw new Error("ChangeScript target has no instruction at source continuation index 1");
  return { script: op.targetScript, pc: 1, range: { min: 0, max: input.targetLength - 1 } };
}
