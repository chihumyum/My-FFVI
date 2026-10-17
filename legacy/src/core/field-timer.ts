import type { Evidence, Site } from "../field/types.js";
import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";

/** Explicit Web clock, not native Unity deltaTime/float accumulation parity. */
export const WEB_FIELD_TIMER_POLICY = "web-field-logical-ms-v1" as const;
export type FieldTimerPolicy = typeof WEB_FIELD_TIMER_POLICY;
export type FieldTimerScene = "player" | "battle" | "message" | "event" | "gimmick" |
  "menu" | "transition" | "inactive";
export type FieldTimerSourceSelectors = { display: number; battle: number; message: number; event: number };
export type FieldTimerSetCommand = {
  kind: "set";
  seconds: number;
  displayUI: boolean;
  updateStates: FieldTimerScene[];
  sourceSelectors: FieldTimerSourceSelectors;
  callbackScripts: string[];
};
export type FieldTimerOp = { kind: "field-timer"; command: FieldTimerSetCommand |
  { kind: "finish" | "pause" | "resume" | "change-script-if-expired" } };
/** The caller resolves this exact source name in the admitted map/Resident
 * namespace and verifies its source/content before preparing a start. */
export type FieldTimerStartBinding = {
  sourceSetHash: string;
  mapId: number;
  mapContentHash: string;
  site: Site;
  callback: { name: string; source: Evidence };
};
export type FieldTimerSnapshot = {
  policy: FieldTimerPolicy;
  sourceSetHash: string;
  revision: number;
  sequence: number;
  active: {
    command: FieldTimerSetCommand;
    binding: FieldTimerStartBinding;
    durationMs: number;
    elapsedMs: number;
    paused: boolean;
    expired: boolean;
    dispatched: boolean;
  } | null;
} & ({ kind: "web-field-timer-v1" } | {
  kind: "web-field-timer-v2";
  scenario: FieldScenarioTimerState;
});
export type FieldScenarioTimerCommand = "cid-hp" | "cid-suspend" | "cid-check" | "cid-resume" | "shadow-setup" | "shadow-reset";
export type FieldScenarioTimerOp = { kind: "field-scenario-timer"; command: FieldScenarioTimerCommand };
export type FieldTimerOriginBinding = Omit<FieldTimerStartBinding, "callback">;
export type FieldCidTimerBinding = FieldTimerOriginBinding & {
  kind: "source-cid-counter-v1"; command: "cid-check" | "cid-resume"; value: number;
};
export type FieldShadowTimerBinding = FieldTimerStartBinding & {
  kind: "source-shadow-timer-v1"; seconds: number;
};
export type FieldScenarioTimerBinding = FieldCidTimerBinding | FieldShadowTimerBinding;
type FieldCounterTimer = {
  binding: FieldCidTimerBinding; durationMs: number; elapsedMs: number; paused: boolean; expired: boolean;
};
type FieldShadowTimer = {
  sequence: number; binding: FieldShadowTimerBinding; durationMs: number; elapsedMs: number; expired: boolean;
};
export type FieldShadowTimerCallback = {
  kind: "source-shadow-timer-callback-v1"; sequence: number; binding: FieldShadowTimerBinding;
};
export type FieldScenarioTimerState = {
  /** Mutually exclusive with active: this is the same global timer without a callback. */
  counter: FieldCounterTimer | null;
  shadow: FieldShadowTimer | null;
  removeShadow: boolean;
  callbacks: FieldShadowTimerCallback[];
};
export type FieldTimerCallbackMode = "start-event" | "replace-script";
export type FieldTimerCallbackRequest = {
  kind: "web-field-timer-callback-v1";
  sequence: number;
  revision: number;
  mode: FieldTimerCallbackMode;
  binding: FieldTimerStartBinding;
};
export type FieldTimerProjection = {
  visible: boolean; paused: boolean; expired: boolean;
  remainingMs: number; minutes: number; seconds: number;
};

function integer(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error("Invalid field timer " + name);
  return value;
}
function digest(value: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid field timer source/content fingerprint");
}
function text(value: string): void {
  if (typeof value !== "string" || !value.length || value.trim() !== value)
    throw new Error("Invalid field timer source script/name");
}
function evidence(value: Evidence): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid field timer source evidence");
  text(value.file); text(value.assetPath);
  if (value.objectId !== undefined && (typeof value.objectId !== "string" || !/^-?\d+$/.test(value.objectId)))
    throw new Error("Field timer source object identity must remain a decimal string");
  canonical(value);
}
function binding(value: FieldTimerStartBinding): void {
  checkpointKeys(value, "sourceSetHash,mapId,mapContentHash,site,callback");
  digest(value.sourceSetHash); digest(value.mapContentHash); integer(value.mapId, "origin map", 1);
  checkpointKeys(value.site, "script,index,source");
  text(value.site.script); integer(value.site.index, "source instruction address"); evidence(value.site.source);
  checkpointKeys(value.callback, "name,source");
  text(value.callback.name); evidence(value.callback.source);
}
export function fieldTimerUpdateStates(selectors: FieldTimerSourceSelectors): FieldTimerScene[] {
  checkpointKeys(selectors, "display,battle,message,event");
  for (const value of Object.values(selectors))
    if (value !== 0 && value !== 1) throw new Error("Unsupported field timer source selector");
  // Source enum: Player=3, Battle=13, Message=8, Event=12, Gimmick=11.
  return ["player", ...(selectors.battle === 0 ? ["battle" as const] : []),
    ...(selectors.message === 1 ? ["message" as const] : []),
    ...(selectors.event === 1 ? ["event" as const, "gimmick" as const] : [])];
}
function command(value: FieldTimerSetCommand): void {
  checkpointKeys(value, "kind,seconds,displayUI,updateStates,sourceSelectors,callbackScripts");
  if (value.kind !== "set" || typeof value.seconds !== "number" || !Number.isFinite(value.seconds) ||
      value.seconds <= 0 || Math.fround(value.seconds) !== value.seconds ||
      !Number.isSafeInteger(Math.ceil(value.seconds * 1000)))
    throw new Error("Unsupported field timer positive duration");
  if (typeof value.displayUI !== "boolean" || value.displayUI !== (value.sourceSelectors.display === 0) ||
      canonical(value.updateStates) !== canonical(fieldTimerUpdateStates(value.sourceSelectors)))
    throw new Error("Field timer source selectors/clock states changed");
  if (!Array.isArray(value.callbackScripts) || value.callbackScripts.length === 0)
    throw new Error("Field timer callback script list is empty or unknown");
  value.callbackScripts.forEach(text);
}
function validate(value: FieldTimerSnapshot): void {
  checkpointKeys(value, "kind,policy,sourceSetHash,revision,sequence,active" + (value.kind === "web-field-timer-v2" ? ",scenario" : ""));
  if (!["web-field-timer-v1", "web-field-timer-v2"].includes(value.kind) || value.policy !== WEB_FIELD_TIMER_POLICY)
    throw new Error("Unsupported field timer checkpoint or Web clock policy");
  digest(value.sourceSetHash); integer(value.revision, "revision"); integer(value.sequence, "sequence");
  if (value.active !== null) {
    const active = value.active;
    checkpointKeys(active, "command,binding,durationMs,elapsedMs,paused,expired,dispatched");
    command(active.command); binding(active.binding);
    if (active.binding.sourceSetHash !== value.sourceSetHash || active.command.callbackScripts.length !== 1 ||
        active.command.callbackScripts[0] !== active.binding.callback.name || value.sequence === 0)
      throw new Error("Field timer active callback/source binding mismatch");
    integer(active.durationMs, "duration", 1); integer(active.elapsedMs, "elapsed time");
    if (active.durationMs !== Math.ceil(active.command.seconds * 1000) || active.elapsedMs > active.durationMs ||
        typeof active.paused !== "boolean" || typeof active.expired !== "boolean" || typeof active.dispatched !== "boolean" ||
        active.expired !== (active.elapsedMs === active.durationMs) || active.dispatched && !active.expired)
      throw new Error("Invalid field timer completion checkpoint");
  }
  if (value.kind === "web-field-timer-v2") validateScenario(value);
}
const increment = (value: number, name: string) => integer(value + 1, name);

/** The existing field/session owner stores this value. These functions never
 * retain mutable state, read wall time or own a second session. */
export function createFieldTimer(policy: FieldTimerPolicy, sourceSetHash: string): FieldTimerSnapshot {
  const result: FieldTimerSnapshot = { kind: "web-field-timer-v1", policy, sourceSetHash,
    revision: 0, sequence: 0, active: null };
  validate(result); return result;
}
export function cloneFieldTimer(snapshot: FieldTimerSnapshot): FieldTimerSnapshot {
  validate(snapshot); return structuredClone(snapshot);
}
/** An active save requires a binding re-established from trusted content;
 * copying the save's self-declared binding into expected is not authorization. */
export function restoreFieldTimer(raw: FieldTimerSnapshot, expected: {
  policy: FieldTimerPolicy; sourceSetHash: string; binding?: FieldTimerStartBinding; scenarioBindings?: FieldScenarioTimerBinding[];
}): FieldTimerSnapshot {
  const snapshot = cloneFieldTimer(raw);
  if (expected.policy !== snapshot.policy || expected.sourceSetHash !== snapshot.sourceSetHash)
    throw new Error("Field timer restore source/policy mismatch");
  if (snapshot.active !== null) {
    if (!expected.binding) throw new Error("Active field timer restore requires a trusted callback binding");
    binding(expected.binding);
    if (canonical(expected.binding) !== canonical(snapshot.active.binding))
      throw new Error("Field timer restore callback/content binding mismatch");
  } else if (expected.binding !== undefined) throw new Error("Empty field timer restore cannot carry an active binding");
  const bindings = fieldScenarioTimerBindings(snapshot);
  if (canonical(bindings) !== canonical(expected.scenarioBindings ?? []))
    throw new Error("Scenario timers require independently trusted origin bindings");
  return snapshot;
}
export function pendingFieldTimerCallback(snapshot: FieldTimerSnapshot,
  mode: FieldTimerCallbackMode = "start-event"): FieldTimerCallbackRequest | null {
  validate(snapshot);
  if (mode !== "start-event" && mode !== "replace-script") throw new Error("Unknown field timer callback mode");
  if (!snapshot.active?.expired || snapshot.active.dispatched) return null;
  return { kind: "web-field-timer-callback-v1", sequence: snapshot.sequence, revision: snapshot.revision,
    mode, binding: structuredClone(snapshot.active.binding) };
}
export function prepareFieldTimerCommand(snapshot: FieldTimerSnapshot, op: FieldTimerOp & Partial<Site>,
  startBinding?: FieldTimerStartBinding): { snapshot: FieldTimerSnapshot; callback: FieldTimerCallbackRequest | null } {
  const next = cloneFieldTimer(snapshot);
  const sourced = "script" in op || "index" in op || "source" in op;
  checkpointKeys(op, sourced ? "kind,command,script,index,source" : "kind,command");
  if (sourced) {
    text(op.script!); integer(op.index!, "source instruction address"); evidence(op.source!);
  }
  if (op.kind !== "field-timer") throw new Error("Invalid field timer operation");
  if (op.command.kind === "set") {
    command(op.command);
    // Native lotScripts permits several names. The current source corpus has
    // one per start; a lottery requires a separately declared RNG policy.
    if (op.command.callbackScripts.length !== 1)
      throw new Error("Field timer multiple callback lottery requires a source RNG provider");
    if (!startBinding) throw new Error("Field timer start requires an exact source callback binding");
    binding(startBinding);
    if (startBinding.sourceSetHash !== snapshot.sourceSetHash ||
        startBinding.callback.name !== op.command.callbackScripts[0] || sourced &&
        canonical(startBinding.site) !== canonical({ script: op.script, index: op.index, source: op.source }))
      throw new Error("Field timer start callback/source binding mismatch");
    next.sequence = increment(next.sequence, "sequence");
    next.revision = increment(next.revision, "revision");
    if (next.kind === "web-field-timer-v2") next.scenario.counter = null;
    next.active = { command: structuredClone(op.command), binding: structuredClone(startBinding),
      durationMs: Math.ceil(op.command.seconds * 1000), elapsedMs: 0,
      paused: false, expired: false, dispatched: false };
  } else {
    checkpointKeys(op.command, "kind");
    if (startBinding !== undefined) throw new Error("Only SetTimer accepts a callback start binding");
    if (op.command.kind === "finish") {
      if (next.active || next.kind === "web-field-timer-v2" && next.scenario.counter) {
        next.active = null;
        if (next.kind === "web-field-timer-v2") next.scenario.counter = null;
        next.sequence = increment(next.sequence, "sequence");
        next.revision = increment(next.revision, "revision");
      }
    } else if (op.command.kind === "pause" || op.command.kind === "resume") {
      // Native manager explicitly returns when the global timer is absent.
      const paused = op.command.kind === "pause";
      const global = globalTimer(next);
      if (global && global.paused !== paused) {
        global.paused = paused;
        next.revision = increment(next.revision, "revision");
      }
    } else if (op.command.kind === "change-script-if-expired") {
      if (!next.active) throw new Error("Timeout script change requires a known active source timer");
      return { snapshot: next, callback: pendingFieldTimerCallback(next, "replace-script") };
    } else throw new Error("Unknown field timer command");
  }
  validate(next); return { snapshot: next, callback: null };
}
export function advanceFieldTimer(snapshot: FieldTimerSnapshot, deltaMs: number,
  scene: FieldTimerScene): FieldTimerSnapshot {
  const next = cloneFieldTimer(snapshot);
  integer(deltaMs, "logical clock delta");
  if (!["player", "battle", "message", "event", "gimmick", "menu", "transition", "inactive"].includes(scene))
    throw new Error("Unknown field timer scene dimension");
  const active = next.active;
  if (active && !active.paused && !active.expired && active.command.updateStates.includes(scene) && deltaMs > 0) {
    active.elapsedMs += Math.min(deltaMs, active.durationMs - active.elapsedMs);
    active.expired = active.elapsedMs === active.durationMs;
    next.revision = increment(next.revision, "revision");
  }
  if (next.kind === "web-field-timer-v2") {
    const counter = next.scenario.counter;
    if (counter && !counter.paused && !counter.expired && scene === "player" && deltaMs > 0) {
      counter.elapsedMs += Math.min(deltaMs, counter.durationMs - counter.elapsedMs);
      counter.expired = counter.elapsedMs === counter.durationMs;
      next.revision = increment(next.revision, "revision");
    }
    const shadow = next.scenario.shadow;
    if (shadow && !shadow.expired && ["player", "battle", "event", "gimmick"].includes(scene) && deltaMs > 0) {
      shadow.elapsedMs += Math.min(deltaMs, shadow.durationMs - shadow.elapsedMs);
      shadow.expired = shadow.elapsedMs === shadow.durationMs;
      next.revision = increment(next.revision, "revision");
    }
  }
  validate(next); return next;
}
/** Caller invokes this only in the same existing-owner transaction that
 * successfully publishes the callback. Failed preparation keeps it pending. */
export function acknowledgeFieldTimerCallback(snapshot: FieldTimerSnapshot,
  request: FieldTimerCallbackRequest): FieldTimerSnapshot {
  checkpointKeys(request, "kind,sequence,revision,mode,binding");
  const pending = pendingFieldTimerCallback(snapshot, request.mode);
  if (!pending || canonical(pending) !== canonical(request))
    throw new Error("Stale, duplicate or mismatched field timer callback publication");
  const next = cloneFieldTimer(snapshot);
  next.active!.dispatched = true;
  next.revision = increment(next.revision, "revision");
  return next;
}
export function fieldTimerProjection(snapshot: FieldTimerSnapshot): FieldTimerProjection {
  validate(snapshot);
  const active = globalTimer(snapshot), remainingMs = active ? active.durationMs - active.elapsedMs : 0;
  // Explicit Web countdown presentation: ceiling seconds, never renderer time.
  const totalSeconds = Math.ceil(remainingMs / 1000);
  return { visible: snapshot.active?.command.displayUI ?? false, paused: active?.paused ?? false,
    expired: active?.expired ?? false, remainingMs, minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

/** Exact Current.cctor int[7,2], FieldInfo A5764BFD0108F32AECEDD11C5E3FEE997A5868AA.
 * Source coordinates are parameters; there is no per-map exception. */
export const SOURCE_SHADOW_OK_LINE: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([112, 23] as const), Object.freeze([112, 24] as const), Object.freeze([113, 24] as const),
  Object.freeze([113, 25] as const), Object.freeze([114, 24] as const), Object.freeze([114, 25] as const), Object.freeze([115, 25] as const),
]);
export const SOURCE_SHADOW_CALLBACK = "sc_secede_shadow" as const;
function originBinding(value: FieldTimerOriginBinding): void {
  digest(value.sourceSetHash); digest(value.mapContentHash); integer(value.mapId, "origin map", 1);
  checkpointKeys(value.site, "script,index,source"); text(value.site.script);
  integer(value.site.index, "origin instruction address"); evidence(value.site.source);
}
export function validateScenarioTimerBinding(value: FieldScenarioTimerBinding): void {
  if (value.kind === "source-cid-counter-v1") {
    checkpointKeys(value, "kind,sourceSetHash,mapId,mapContentHash,site,command,value"); originBinding(value);
    if (!["cid-check", "cid-resume"].includes(value.command) || !Number.isInteger(value.value) || value.value <= 0 || value.value > 2147483647 ||
        value.command === "cid-check" && (value.value < 30 || value.value > 255)) throw new Error("Invalid source Cid counter origin/value");
  } else if (value.kind === "source-shadow-timer-v1") {
    checkpointKeys(value, "kind,sourceSetHash,mapId,mapContentHash,site,callback,seconds"); originBinding(value);
    checkpointKeys(value.callback, "name,source"); evidence(value.callback.source);
    if (value.callback.name !== SOURCE_SHADOW_CALLBACK || !Number.isFinite(value.seconds) || value.seconds <= 0 || Math.fround(value.seconds) !== value.seconds ||
        !Number.isSafeInteger(Math.ceil(value.seconds * 1000))) throw new Error("Invalid source Shadow callback/duration");
  } else throw new Error("Unknown source scenario timer binding");
}
function counterDuration(binding: FieldCidTimerBinding): number { return Math.ceil(Math.fround(binding.value) * 1000); }
function validateScenario(value: Extract<FieldTimerSnapshot, {kind: "web-field-timer-v2"}>): void {
  const state = value.scenario; checkpointKeys(state, "counter,shadow,removeShadow,callbacks");
  if (typeof state.removeShadow !== "boolean" || state.removeShadow && !state.shadow || !Array.isArray(state.callbacks))
    throw new Error("Invalid Shadow timer removal/callback queue");
  const counter = state.counter;
  if (counter) {
    checkpointKeys(counter, "binding,durationMs,elapsedMs,paused,expired"); validateScenarioTimerBinding(counter.binding);
    if (value.active || counter.binding.kind !== "source-cid-counter-v1" || counter.binding.sourceSetHash !== value.sourceSetHash || counter.durationMs !== counterDuration(counter.binding))
      throw new Error("Cid counter cannot allocate a second global timer");
    integer(counter.durationMs, "counter duration", 1); integer(counter.elapsedMs, "counter elapsed");
    if (counter.elapsedMs > counter.durationMs || typeof counter.paused !== "boolean" || typeof counter.expired !== "boolean" || counter.expired !== (counter.elapsedMs === counter.durationMs))
      throw new Error("Invalid Cid counter clock");
  }
  const shadow = state.shadow;
  if (shadow) {
    checkpointKeys(shadow, "sequence,binding,durationMs,elapsedMs,expired"); validateScenarioTimerBinding(shadow.binding);
    integer(shadow.sequence, "Shadow generation", 1); integer(shadow.durationMs, "Shadow duration", 1); integer(shadow.elapsedMs, "Shadow elapsed");
    if (shadow.binding.kind !== "source-shadow-timer-v1" || shadow.binding.sourceSetHash !== value.sourceSetHash || shadow.sequence > value.sequence ||
        shadow.durationMs !== Math.ceil(shadow.binding.seconds * 1000) || shadow.elapsedMs > shadow.durationMs ||
        typeof shadow.expired !== "boolean" || shadow.expired !== (shadow.elapsedMs === shadow.durationMs)) throw new Error("Invalid Shadow timer clock");
  }
  let previous = 0;
  for (const callback of state.callbacks) {
    checkpointKeys(callback, "kind,sequence,binding"); validateScenarioTimerBinding(callback.binding); integer(callback.sequence, "callback generation", 1);
    if (callback.kind !== "source-shadow-timer-callback-v1" || callback.binding.kind !== "source-shadow-timer-v1" || callback.binding.sourceSetHash !== value.sourceSetHash ||
        callback.sequence <= previous || callback.sequence > value.sequence || shadow && callback.sequence >= shadow.sequence)
      throw new Error("Invalid or reordered source Shadow callback queue");
    previous = callback.sequence;
  }
}
function globalTimer(snapshot: FieldTimerSnapshot) { return snapshot.active ?? (snapshot.kind === "web-field-timer-v2" ? snapshot.scenario.counter : null); }
export function fieldTimerRemainingSeconds(snapshot: FieldTimerSnapshot): number | null {
  validate(snapshot); const active = globalTimer(snapshot);
  return active ? Math.fround((active.durationMs - active.elapsedMs) / 1000) : null;
}
export function fieldScenarioTimerBindings(snapshot: FieldTimerSnapshot): FieldScenarioTimerBinding[] {
  validate(snapshot); if (snapshot.kind === "web-field-timer-v1") return [];
  return structuredClone([...(snapshot.scenario.counter ? [snapshot.scenario.counter.binding] : []),
    ...(snapshot.scenario.shadow ? [snapshot.scenario.shadow.binding] : []), ...snapshot.scenario.callbacks.map(entry => entry.binding)]);
}
function withScenario(snapshot: FieldTimerSnapshot): Extract<FieldTimerSnapshot, {kind: "web-field-timer-v2"}> {
  const next = cloneFieldTimer(snapshot);
  return next.kind === "web-field-timer-v2" ? next : { ...next, kind: "web-field-timer-v2", scenario: {counter: null, shadow: null, removeShadow: false, callbacks: []} };
}
export function prepareFieldScenarioTimer(snapshot: FieldTimerSnapshot, op: FieldScenarioTimerOp & Site,
  value?: number, startBinding?: FieldScenarioTimerBinding): {snapshot: FieldTimerSnapshot; variable2?: number} {
  checkpointKeys(op, "kind,command,script,index,source");
  if (op.kind !== "field-scenario-timer" || !["cid-hp", "cid-suspend", "cid-check", "cid-resume", "shadow-setup", "shadow-reset"].includes(op.command))
    throw new Error("Unknown source scenario timer operation");
  const next = withScenario(snapshot), active = globalTimer(next), remaining = fieldTimerRemainingSeconds(next);
  const clear = () => { if (globalTimer(next)) { next.active = null; next.scenario.counter = null; next.sequence = increment(next.sequence, "sequence"); next.revision = increment(next.revision, "revision"); } };
  const verify = (expectedKind: FieldScenarioTimerBinding["kind"]) => {
    if (!startBinding) throw new Error("Source scenario timer requires a trusted origin");
    validateScenarioTimerBinding(startBinding);
    if (startBinding.kind !== expectedKind || startBinding.sourceSetHash !== snapshot.sourceSetHash ||
        canonical(startBinding.site) !== canonical({script: op.script, index: op.index, source: op.source}))
      throw new Error("Source scenario timer origin/site mismatch");
  };
  if (op.command === "cid-hp" || op.command === "cid-suspend") {
    const variable2 = active && !active.expired ? Math.trunc(remaining!) : 0;
    if (op.command === "cid-suspend" && active && !active.expired) clear();
    validate(next); return {snapshot: next, variable2};
  }
  if (op.command === "cid-check" || op.command === "cid-resume") {
    if (!Number.isInteger(value) || value! < -2147483648 || value! > 2147483647) throw new Error("Unknown Cid ScenarioVariable2");
    if (op.command === "cid-check" && (value! < 30 || value! > 255)) clear();
    else if (op.command === "cid-check" || value !== 0) {
      // Native negative-duration construction is not recovered: preserve that reached boundary.
      if (value! < 0) throw new Error("Cid negative counter duration requires its native Timer constructor provider");
      verify("source-cid-counter-v1"); const binding = startBinding as FieldCidTimerBinding;
      if (binding.command !== op.command || binding.value !== value) throw new Error("Cid source counter value changed");
      next.active = null; next.sequence = increment(next.sequence, "sequence"); next.revision = increment(next.revision, "revision");
      next.scenario.counter = {binding: structuredClone(binding), durationMs: counterDuration(binding), elapsedMs: 0, paused: false, expired: false};
    }
  } else if (op.command === "shadow-setup") {
    if (remaining !== null && remaining > 5 && !next.scenario.shadow) {
      verify("source-shadow-timer-v1"); const binding = startBinding as FieldShadowTimerBinding;
      if (binding.seconds !== Math.fround(remaining - 5)) throw new Error("Shadow source timer duration changed");
      next.sequence = increment(next.sequence, "sequence"); next.revision = increment(next.revision, "revision");
      next.scenario.shadow = {sequence: next.sequence, binding: structuredClone(binding), durationMs: Math.ceil(binding.seconds * 1000), elapsedMs: 0, expired: false};
    }
  } else if (next.scenario.shadow && !next.scenario.removeShadow) {
    next.scenario.removeShadow = true; next.revision = increment(next.revision, "revision");
  }
  validate(next); return {snapshot: next};
}
/** Evaluate at the actual shared timer tick, including Battle. The explicit Web
 * publication policy waits for the existing Field root boundary, without
 * re-sampling a flag or cell after the deadline. */
export function settleFieldShadowTimerTick(snapshot: FieldTimerSnapshot, sample?: {flag: number; cell?: {x: number; y: number}}): FieldTimerSnapshot {
  const next = cloneFieldTimer(snapshot);
  if (next.kind === "web-field-timer-v1") return next;
  const shadow = next.scenario.shadow;
  if (shadow?.expired) {
    if (!sample || !Number.isInteger(sample.flag) || sample.flag === 1 && (!sample.cell || !Number.isFinite(sample.cell.x) || !Number.isFinite(sample.cell.y)))
      throw new Error("Shadow timer callback requires its actual flag and player cell");
    if (sample.flag === 1 && SOURCE_SHADOW_OK_LINE.some(([x,y]) => x === Math.trunc(sample.cell!.x) && y === Math.trunc(sample.cell!.y)))
      next.scenario.callbacks.push({kind: "source-shadow-timer-callback-v1", sequence: shadow.sequence, binding: structuredClone(shadow.binding)});
    next.scenario.shadow = null; next.revision = increment(next.revision, "revision");
  }
  if (next.scenario.removeShadow) {
    if (next.scenario.shadow) { next.scenario.shadow = null; next.revision = increment(next.revision, "revision"); }
    next.scenario.removeShadow = false;
  }
  validate(next); return next;
}
export function pendingFieldShadowCallback(snapshot: FieldTimerSnapshot): FieldShadowTimerCallback | null {
  validate(snapshot); return snapshot.kind === "web-field-timer-v2" ? structuredClone(snapshot.scenario.callbacks[0] ?? null) : null;
}
export function acknowledgeFieldShadowCallback(snapshot: FieldTimerSnapshot, request: FieldShadowTimerCallback): FieldTimerSnapshot {
  const next = cloneFieldTimer(snapshot), pending = pendingFieldShadowCallback(next);
  if (next.kind !== "web-field-timer-v2" || !pending || canonical(pending) !== canonical(request)) throw new Error("Stale or duplicate Shadow timer callback");
  next.scenario.callbacks.shift(); next.revision = increment(next.revision, "revision"); validate(next); return next;
}
