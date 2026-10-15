import type { FieldContent, Op } from "../field/types.js";
import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { cloneFieldTimer, restoreFieldTimer, WEB_FIELD_TIMER_POLICY,
  type FieldTimerSnapshot, type FieldTimerStartBinding } from "./field-timer.js";
import { FieldColorFilterState, type FieldColorFilterSnapshot, type FieldScreenEffectsBinding } from "./field-screen-effects.js";

export const WEB_FIELD_STORY_RUNTIME = "web-field-story-runtime-v1" as const;
export type FieldStoryRuntimeSnapshot = { kind: typeof WEB_FIELD_STORY_RUNTIME;
  timer: FieldTimerSnapshot; colorFilter: FieldColorFilterSnapshot | null };
/** Verified immutable source content, never state or a permission in a save. */
export type FieldTimerOriginContent = { mapId: number; mapContentHash: string; scripts: Record<string, Op[]> };
export function fieldTimerOriginContent(content: FieldContent): FieldTimerOriginContent {
  const mapId = content.map.identity?.mapId;
  if (!Number.isInteger(mapId) || !mapId) throw new Error("Story timer requires a source map identity");
  return { mapId, mapContentHash: content.contentHash, scripts: structuredClone(content.scripts) };
}
export function fieldScreenEffectsBinding(content: FieldContent): FieldScreenEffectsBinding {
  return { kind: "web-field-screen-effects-v1", sourceSetHash: content.parentSourceSetHash, host: "ordinary-field" };
}
export function hasFieldStoryRuntime(content: FieldContent): boolean {
  return content.developmentProfile?.kind === "framework-development-v1" &&
    content.developmentProfile.storyRuntime === WEB_FIELD_STORY_RUNTIME;
}
/** Resolve the source's exact callback, retaining the original code address. */
export function bindFieldStoryTimer(content: FieldContent, op: Extract<Op, { kind: "field-timer" }>): FieldTimerStartBinding {
  return bindFieldStoryTimerOrigin(fieldTimerOriginContent(content), content.parentSourceSetHash, op);
}
export function bindFieldStoryTimerOrigin(origin: FieldTimerOriginContent, sourceSetHash: string,
  op: Extract<Op, { kind: "field-timer" }>): FieldTimerStartBinding {
  if (op.command.kind !== "set" || op.command.callbackScripts.length !== 1)
    throw new Error("Story timer needs one source-bound callback; lottery is not admitted");
  const original = origin.scripts[op.script]?.[op.index];
  if (!original || canonical(original) !== canonical(op)) throw new Error("Story timer origin instruction changed");
  const name = op.command.callbackScripts[0]!, callback = origin.scripts[name];
  if (!callback?.length) throw new Error("Story timer callback is missing from its exact map/Resident namespace");
  return { sourceSetHash, mapId: origin.mapId, mapContentHash: origin.mapContentHash,
    site: { script: op.script, index: op.index, source: structuredClone(op.source) },
    callback: { name, source: structuredClone(callback[0]!.source) } };
}
/** A saved timer can identify required content, but cannot supply that content. */
export function restoreFieldStoryRuntime(raw: FieldStoryRuntimeSnapshot, content: FieldContent,
  origin?: FieldTimerOriginContent): FieldStoryRuntimeSnapshot {
  checkpointKeys(raw, "kind,timer,colorFilter");
  if (raw.kind !== WEB_FIELD_STORY_RUNTIME || !hasFieldStoryRuntime(content))
    throw new Error("Story runtime checkpoint cannot grant its content policy");
  const saved = cloneFieldTimer(raw.timer), active = saved.active;
  let binding: FieldTimerStartBinding | undefined;
  if (active) {
    const metadata = active.binding.mapContentHash === content.contentHash ? fieldTimerOriginContent(content) : origin;
    if (!metadata || metadata.mapId !== active.binding.mapId || metadata.mapContentHash !== active.binding.mapContentHash)
      throw new Error("Active story timer requires its trusted origin content");
    const op = metadata.scripts[active.binding.site.script]?.[active.binding.site.index];
    if (op?.kind !== "field-timer" || canonical(op.command) !== canonical(active.command))
      throw new Error("Saved story timer command differs from trusted source");
    binding = bindFieldStoryTimerOrigin(metadata, content.parentSourceSetHash, op);
  }
  const timer = restoreFieldTimer(saved, { policy: WEB_FIELD_TIMER_POLICY, sourceSetHash: content.parentSourceSetHash,
    ...(binding ? { binding } : {}) });
  const colorFilter = FieldColorFilterState.restore(raw.colorFilter, fieldScreenEffectsBinding(content)).snapshot();
  return { kind: WEB_FIELD_STORY_RUNTIME, timer, colorFilter };
}
