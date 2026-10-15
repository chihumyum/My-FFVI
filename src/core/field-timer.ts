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
  kind: "web-field-timer-v1";
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
  checkpointKeys(value, "kind,policy,sourceSetHash,revision,sequence,active");
  if (value.kind !== "web-field-timer-v1" || value.policy !== WEB_FIELD_TIMER_POLICY)
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
  policy: FieldTimerPolicy; sourceSetHash: string; binding?: FieldTimerStartBinding;
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
    next.active = { command: structuredClone(op.command), binding: structuredClone(startBinding),
      durationMs: Math.ceil(op.command.seconds * 1000), elapsedMs: 0,
      paused: false, expired: false, dispatched: false };
  } else {
    checkpointKeys(op.command, "kind");
    if (startBinding !== undefined) throw new Error("Only SetTimer accepts a callback start binding");
    if (op.command.kind === "finish") {
      if (next.active) {
        next.active = null;
        next.sequence = increment(next.sequence, "sequence");
        next.revision = increment(next.revision, "revision");
      }
    } else if (op.command.kind === "pause" || op.command.kind === "resume") {
      // Native manager explicitly returns when the global timer is absent.
      const paused = op.command.kind === "pause";
      if (next.active && next.active.paused !== paused) {
        next.active.paused = paused;
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
  const active = snapshot.active, remainingMs = active ? active.durationMs - active.elapsedMs : 0;
  // Explicit Web countdown presentation: ceiling seconds, never renderer time.
  const totalSeconds = Math.ceil(remainingMs / 1000);
  return { visible: active?.command.displayUI ?? false, paused: active?.paused ?? false,
    expired: active?.expired ?? false, remainingMs, minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}
