import {FieldScreenPresentationState,fieldScreenPresentationBinding,type FieldScreenPresentationSnapshot,type WebFieldScreenPresentation}from"./field-screen-presentation.js";
import type { FieldContent, Op, Site } from "../field/types.js";
import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { cloneFieldTimer, restoreFieldTimer, WEB_FIELD_TIMER_POLICY,
  fieldScenarioTimerBindings, validateScenarioTimerBinding, SOURCE_SHADOW_CALLBACK,
  type FieldScenarioTimerBinding, type FieldScenarioTimerOp, type FieldTimerOriginBinding, type FieldTimerSnapshot, type FieldTimerStartBinding } from "./field-timer.js";
import { FieldColorFilterState, type FieldColorFilterSnapshot, type FieldScreenEffectsBinding } from "./field-screen-effects.js";
import { FieldCameraShakeState, type FieldCameraShakeSnapshot, type FieldCameraShakePolicy,
  type FieldShakeBinding, type FieldShakeCommand } from "./field-camera-shake.js";

export const WEB_FIELD_STORY_RUNTIME = "web-field-story-runtime-v1" as const;
export type FieldStoryRuntimeSnapshot = { timer: FieldTimerSnapshot; colorFilter: FieldColorFilterSnapshot | null } & (
  { kind: typeof WEB_FIELD_STORY_RUNTIME } |
  { kind: "web-field-story-runtime-v2"; cameraShake: FieldCameraShakeSnapshot } |
  { kind: "web-field-story-runtime-v3"; cameraShake: FieldCameraShakeSnapshot | null; screenPresentation:FieldScreenPresentationSnapshot });
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
export function bindFieldStoryShake(content: FieldContent, script: string, webPc: number,
  command: Extract<FieldShakeCommand, { kind: "play" }>): FieldShakeBinding {
  const original = content.scripts[script]?.[webPc], mapId = content.map.identity?.mapId;
  if (!mapId || !original || original.kind !== "field-shake" || canonical(original.command) !== canonical(command))
    throw new Error("Camera-shake origin differs from trusted map/Resident code");
  return { mapId, mapContentHash: content.contentHash, script, webPc };
}
export function restoreFieldStoryShake(raw: FieldCameraShakeSnapshot, content: FieldContent,
  policy: FieldCameraShakePolicy): FieldCameraShakeState {
  return FieldCameraShakeState.restore(raw, content.parentSourceSetHash, policy, (binding, command) => {
    if (canonical(bindFieldStoryShake(content, binding.script, binding.webPc, command)) !== canonical(binding))
      throw new Error("Saved camera shake requires its exact trusted map and original command");
  });
}
/** A successful map replacement retires the old camera callback. The explicit
 * Web policy starts a new map without an old shake/stream. Preparing or
 * discarding that candidate never changes the source FieldGame. */
export function fieldStoryRuntimeForNewMap(snapshot: FieldStoryRuntimeSnapshot): FieldStoryRuntimeSnapshot {
  if(snapshot.kind==="web-field-story-runtime-v3")return {...structuredClone(snapshot),cameraShake:null};
  return { kind: WEB_FIELD_STORY_RUNTIME, timer: structuredClone(snapshot.timer), colorFilter: structuredClone(snapshot.colorFilter) };
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
/** All metadata still required by this one owner, including callbacks awaiting
 * safe publication after their named timer has retired. */
export function fieldTimerRequiredOrigins(timer: FieldTimerSnapshot): FieldTimerOriginBinding[] {
  const values: FieldTimerOriginBinding[] = [...(timer.active ? [timer.active.binding] : []), ...fieldScenarioTimerBindings(timer)];
  return values.filter((value, index) => values.findIndex(other => other.mapContentHash === value.mapContentHash && other.mapId === value.mapId) === index);
}
export function bindFieldScenarioTimerOrigin(origin: FieldTimerOriginContent, sourceSetHash: string,
  op: FieldScenarioTimerOp & Site, captured: number): FieldScenarioTimerBinding {
  const original = origin.scripts[op.script]?.[op.index];
  if (!original || canonical(original) !== canonical(op)) throw new Error("Scenario timer origin instruction changed");
  const base = {sourceSetHash, mapId: origin.mapId, mapContentHash: origin.mapContentHash,
    site: {script: op.script, index: op.index, source: structuredClone(op.source)}};
  let binding: FieldScenarioTimerBinding;
  if (op.command === "cid-check" || op.command === "cid-resume")
    binding = {...base, kind: "source-cid-counter-v1", command: op.command, value: captured};
  else if (op.command === "shadow-setup") {
    const callback = origin.scripts[SOURCE_SHADOW_CALLBACK];
    if (!callback?.length) throw new Error("Shadow timer callback is missing from its exact trusted map/Resident namespace");
    binding = {...base, kind: "source-shadow-timer-v1", seconds: captured,
      callback: {name: SOURCE_SHADOW_CALLBACK, source: structuredClone(callback[0]!.source)}};
  } else throw new Error("Scenario timer command cannot allocate a timer");
  validateScenarioTimerBinding(binding); return binding;
}
/** A saved timer can identify required content, but cannot supply that content. */
export function restoreFieldStoryRuntime(raw: FieldStoryRuntimeSnapshot, content: FieldContent,
  origin?: FieldTimerOriginContent, cameraShakePolicy?: FieldCameraShakePolicy, screenPolicy?:WebFieldScreenPresentation, origins?: readonly FieldTimerOriginContent[]): FieldStoryRuntimeSnapshot {
  const hasScreen = raw.kind === "web-field-story-runtime-v3",hasShake = raw.kind === "web-field-story-runtime-v2" || hasScreen;
  checkpointKeys(raw, "kind,timer,colorFilter" + (hasShake ? ",cameraShake" : "") + (hasScreen?",screenPresentation":""));
  if (raw.kind !== WEB_FIELD_STORY_RUNTIME && !hasShake || !hasFieldStoryRuntime(content))
    throw new Error("Story runtime checkpoint cannot grant its content policy");
  const saved = cloneFieldTimer(raw.timer), active = saved.active;
  const resolve = (binding: FieldTimerOriginBinding): FieldTimerOriginContent => {
    const metadata = binding.mapContentHash === content.contentHash ? fieldTimerOriginContent(content)
      : [origin, ...(origins ?? [])].find(value => value?.mapId === binding.mapId && value.mapContentHash === binding.mapContentHash);
    if (!metadata || metadata.mapId !== binding.mapId || metadata.mapContentHash !== binding.mapContentHash)
      throw new Error("Active story timer requires its trusted origin content");
    return metadata;
  };
  let binding: FieldTimerStartBinding | undefined;
  if (active) {
    const metadata = resolve(active.binding);
    const op = metadata.scripts[active.binding.site.script]?.[active.binding.site.index];
    if (op?.kind !== "field-timer" || canonical(op.command) !== canonical(active.command))
      throw new Error("Saved story timer command differs from trusted source");
    binding = bindFieldStoryTimerOrigin(metadata, content.parentSourceSetHash, op);
  }
  const scenarioBindings = fieldScenarioTimerBindings(saved).map(savedBinding => {
    const metadata = resolve(savedBinding), op = metadata.scripts[savedBinding.site.script]?.[savedBinding.site.index];
    if (op?.kind !== "field-scenario-timer") throw new Error("Saved scenario timer instruction differs from trusted source");
    return bindFieldScenarioTimerOrigin(metadata, content.parentSourceSetHash, op,
      savedBinding.kind === "source-cid-counter-v1" ? savedBinding.value : savedBinding.seconds);
  });
  const timer = restoreFieldTimer(saved, { scenarioBindings, policy: WEB_FIELD_TIMER_POLICY, sourceSetHash: content.parentSourceSetHash,
    ...(binding ? { binding } : {}) });
  const colorFilter = FieldColorFilterState.restore(raw.colorFilter, fieldScreenEffectsBinding(content)).snapshot();
  if (hasScreen) {
    const binding=fieldScreenPresentationBinding(content,screenPolicy);if(!binding)throw new Error("Screen presentation checkpoint cannot supply trusted content/runtime policy");
    const screenPresentation=FieldScreenPresentationState.restore(raw.screenPresentation,binding).snapshot();
    if(raw.cameraShake&&!cameraShakePolicy)throw new Error("Camera-shake checkpoint cannot supply its Web policy");
    const cameraShake=raw.cameraShake?restoreFieldStoryShake(raw.cameraShake,content,cameraShakePolicy!).snapshot()!:null;
    return {kind:"web-field-story-runtime-v3",timer,colorFilter,cameraShake,screenPresentation};
  }
  if (hasShake) {
    if (!cameraShakePolicy) throw new Error("Camera-shake checkpoint cannot supply its Web policy");
    const cameraShake = restoreFieldStoryShake(raw.cameraShake, content, cameraShakePolicy).snapshot()!;
    return { kind: "web-field-story-runtime-v2", timer, colorFilter, cameraShake };
  }
  return { kind: WEB_FIELD_STORY_RUNTIME, timer, colorFilter };
}
