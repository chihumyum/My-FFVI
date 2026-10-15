import { checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";
import { FieldFadeState, type FadeColor } from "./field-fade.js";

export type FieldScreenEffectsBinding = { kind: "web-field-screen-effects-v1"; sourceSetHash: string; host: "ordinary-field" };
export type FieldColorFadeOp = { kind: "field-color-fade"; seconds: number; color: FadeColor;
  policy: "web-field-screen-effects-v1" };
export type FieldFlashOp = { kind: "field-flash"; seconds: number; color: FadeColor | null;
  policy: "web-field-screen-effects-v1" };
export type FieldScreenEffectOp = FieldColorFadeOp | FieldFlashOp;
export type FieldColorFilterSnapshot = { kind: "web-field-color-filter-v1"; binding: FieldScreenEffectsBinding;
  color: FadeColor; tween: { start: FadeColor; target: FadeColor; duration: number; elapsed: number } | null };
export const WEB_CLEAR_COLOR_FILTER: Readonly<FadeColor> = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

function validateBinding(value: FieldScreenEffectsBinding): void {
  checkpointKeys(value, "kind,sourceSetHash,host");
  if (value.kind !== "web-field-screen-effects-v1" || value.host !== "ordinary-field" ||
      typeof value.sourceSetHash !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSetHash))
    throw new Error("Unsupported or unbound Web screen-effects profile");
}
function color(value: FadeColor): void {
  checkpointKeys(value, "r,g,b,a");
  for (const key of ["r", "g", "b", "a"] as const)
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1 || Math.fround(value[key]) !== value[key])
      throw new Error("Unsupported screen-effects color");
}
function seconds(value: number, nonnegative = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)) ||
      nonnegative && value < 0) throw new Error("Unsupported screen-effects duration");
  return Math.fround(value);
}
function validateOp(op: FieldScreenEffectOp): void {
  if (!op || (op.kind !== "field-color-fade" && op.kind !== "field-flash") || op.policy !== "web-field-screen-effects-v1")
    throw new Error("Missing screen-effects Web policy");
  seconds(op.seconds);
  if (op.color !== null) color(op.color);
  else if (op.kind === "field-color-fade") throw new Error("ColorFade requires explicit RGBA");
}
function sample(tween: NonNullable<FieldColorFilterSnapshot["tween"]>): FadeColor {
  const ratio = Math.fround(Math.min(1, tween.elapsed / tween.duration));
  const out = {} as FadeColor;
  for (const key of ["r", "g", "b", "a"] as const)
    out[key] = Math.fround(tween.start[key] + Math.fround(Math.fround(tween.target[key] - tween.start[key]) * ratio));
  return out;
}

/** A single ColorFilter projection owned by FieldGame. The source wrapper
 * targets CommonCamera.ColorFilterEntity, not FadeManager. This declared Web
 * linear RGBA overlay does not grant the source shader, camera or bird host. */
export class FieldColorFilterState {
  private value: FieldColorFilterSnapshot | null;
  private readonly binding: FieldScreenEffectsBinding;
  constructor(binding: FieldScreenEffectsBinding, initialColor: FadeColor | null) {
    validateBinding(binding);
    if (initialColor !== null) color(initialColor);
    this.binding = structuredClone(binding);
    this.value = initialColor === null ? null : { kind: "web-field-color-filter-v1", binding: structuredClone(binding),
      color: structuredClone(initialColor), tween: null };
  }
  get known(): boolean { return this.value !== null; }
  get active(): boolean { return this.value?.tween != null; }
  get projection(): FadeColor | null { return this.value === null ? null : structuredClone(this.value.color); }
  snapshot(): FieldColorFilterSnapshot | null { return structuredClone(this.value); }
  fork(): FieldColorFilterState { return FieldColorFilterState.restore(this.snapshot(), this.binding); }
  static restore(snapshot: FieldColorFilterSnapshot | null, expected: FieldScreenEffectsBinding): FieldColorFilterState {
    validateBinding(expected);
    const state = new FieldColorFilterState(expected, null);
    if (snapshot === null) return state;
    checkpointKeys(snapshot, "kind,binding,color,tween");
    validateBinding(snapshot.binding);
    if (snapshot.kind !== "web-field-color-filter-v1" || canonical(snapshot.binding) !== canonical(expected))
      throw new Error("Screen-effects checkpoint profile mismatch");
    color(snapshot.color);
    if (snapshot.tween !== null) {
      const tween = snapshot.tween;
      checkpointKeys(tween, "start,target,duration,elapsed"); color(tween.start); color(tween.target);
      const duration = seconds(tween.duration, true), elapsed = seconds(tween.elapsed, true);
      if (duration !== tween.duration || elapsed !== tween.elapsed || duration <= 0 || elapsed >= duration ||
          canonical(sample(tween)) !== canonical(snapshot.color)) throw new Error("Invalid color-filter tween checkpoint");
    }
    state.value = structuredClone(snapshot);
    return state;
  }
  start(op: FieldColorFadeOp): "next" | "wait" {
    validateOp(op);
    if (op.kind !== "field-color-fade") throw new Error("Expected ColorFade");
    if (!this.value) throw new Error("Unknown initial color-filter host state");
    const requested = seconds(op.seconds), duration = Math.abs(requested), next = this.snapshot()!;
    if (duration === 0) { next.color = structuredClone(op.color); next.tween = null; }
    else next.tween = { start: structuredClone(next.color), target: structuredClone(op.color), duration, elapsed: 0 };
    this.value = next;
    return requested <= 0 ? "next" : "wait";
  }
  poll(): "next" | "wait" {
    if (!this.value) throw new Error("Unknown initial color-filter host state");
    return this.active ? "wait" : "next";
  }
  advance(deltaSeconds: number): void {
    const dt = seconds(deltaSeconds, true);
    if (!this.value?.tween) return;
    const next = this.snapshot()!, tween = next.tween!;
    const elapsed = Math.fround(tween.elapsed + dt);
    if (!Number.isFinite(elapsed)) throw new Error("Color-filter elapsed time overflow");
    tween.elapsed = Math.min(tween.duration, elapsed);
    next.color = sample(tween);
    if (tween.elapsed >= tween.duration) { next.color = structuredClone(tween.target); next.tween = null; }
    this.value = next;
  }
}

/** This is only the existing field task's two-phase cursor. It never advances
 * or owns the FadeManager; the field host advances that same fader once. */
export type FieldFlashTask = { kind: "field-flash-task-v1"; phase: "out" | "in" | "done"; op: FieldFlashOp };
const flashOwners = new WeakMap<FieldFlashTask, FieldFadeState>();
export function startFieldFlash(fader: FieldFadeState, op: FieldFlashOp, frameDeltaSeconds = 0): FieldFlashTask {
  validateOp(op);
  if (op.kind !== "field-flash") throw new Error("Expected Flash");
  // Flash ignores FaderCommon's negative-duration Next during stage starts;
  // its own wrapper always polls both stages on subsequent clocks.
  fader.start({ kind: "field-fade", direction: "out", color: op.color, seconds: Math.abs(seconds(op.seconds)) }, frameDeltaSeconds);
  const task: FieldFlashTask = { kind: "field-flash-task-v1", phase: "out", op: structuredClone(op) };
  flashOwners.set(task, fader);
  return task;
}
export function pollFieldFlash(fader: FieldFadeState, task: FieldFlashTask, frameDeltaSeconds = 0): "next" | "wait" {
  if (!task || flashOwners.get(task) !== fader) throw new Error("Flash task belongs to another fader");
  validateOp(task.op); seconds(frameDeltaSeconds, true);
  if (task.phase === "done") return "next";
  if (task.phase !== "out" && task.phase !== "in") throw new Error("Unsupported Flash phase");
  if (fader.poll(task.phase) === "wait") return "wait";
  if (task.phase === "in") { task.phase = "done"; return "next"; }
  fader.start({ kind: "field-fade", direction: "in", color: task.op.color,
    seconds: Math.abs(seconds(task.op.seconds)) }, frameDeltaSeconds);
  task.phase = "in";
  return "wait";
}
