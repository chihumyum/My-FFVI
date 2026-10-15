import { canonical } from "./canonical.js";
import type { Point } from "../field/types.js";

/** The source re-seeds Unity's shared RNG from DateTime.Now on every Play.
 * This explicit, field-owned presentation stream is a Web policy, not that
 * global stream or the battle/field-magic/encounter random owner. */
export const WEB_FIELD_CAMERA_SHAKE = "web-field-camera-shake-v1" as const;
export type FieldCameraShakePolicy = { kind: typeof WEB_FIELD_CAMERA_SHAKE; seed: number };
export type FieldShakeCommand = { kind: "stop" } | { kind: "play"; axis: 0 | 1 | 2; strength: 0 | 1;
  intervalScale: number; reexecute: number };
export type FieldShakeOp = { kind: "field-shake"; command: FieldShakeCommand };
export type FieldShakeBinding = { mapId: number; mapContentHash: string; script: string; webPc: number };
export type FieldCameraShakeSnapshot = { kind: typeof WEB_FIELD_CAMERA_SHAKE; sourceSetHash: string;
  policy: FieldCameraShakePolicy; rngState: number; samples: number;
  active: { command: Extract<FieldShakeCommand, { kind: "play" }>; binding: FieldShakeBinding;
    counter: number; scale: Point } | null };
const f = Math.fround, ranges = [[2, 0], [4, 1], [0, 2], [1, 4], [2, 2], [4, 4]] as const;
function keys(raw: unknown, expected: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error("Invalid camera-shake data record");
  const descriptors = Object.getOwnPropertyDescriptors(raw), actual = Reflect.ownKeys(raw), wanted = expected.split(",").sort();
  if (actual.some(key => typeof key !== "string") || actual.length !== wanted.length ||
      (actual as string[]).sort().some((key, i) => key !== wanted[i]) ||
      Object.values(descriptors).some(value => !value.enumerable || !("value" in value)))
    throw new Error("Invalid camera-shake data fields");
}
function integer(value: unknown, minimum: number, maximum = 0x7fffffff): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    throw new Error("Invalid camera-shake integer");
}
function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid camera-shake source hash");
}
function scalar(value: unknown, minimum: number, maximum = Number.MAX_VALUE): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || f(value) !== value || value < minimum || value > maximum)
    throw new Error("Invalid camera-shake float32 value");
}
export function createWebFieldCameraShakePolicy(seed = 0x6d2b79f5): FieldCameraShakePolicy {
  integer(seed, 1, 0xffffffff);
  return Object.freeze({ kind: WEB_FIELD_CAMERA_SHAKE, seed });
}
export function parseFieldCameraShakePolicy(raw: FieldCameraShakePolicy): FieldCameraShakePolicy {
  keys(raw, "kind,seed");
  if (raw.kind !== WEB_FIELD_CAMERA_SHAKE) throw new Error("Camera shake requires its explicit Web presentation policy");
  return createWebFieldCameraShakePolicy(raw.seed);
}
export function parseFieldShakeCommand(raw: FieldShakeCommand): FieldShakeCommand {
  // Inspect descriptors before reading the discriminant; malformed data must
  // not invoke a getter during the instruction's prepare stage.
  if (!raw || typeof raw !== "object") throw new Error("Invalid camera-shake command");
  const kind = Object.getOwnPropertyDescriptor(raw, "kind");
  if (!kind || !("value" in kind)) throw new Error("Invalid camera-shake command kind");
  if (kind.value === "stop") { keys(raw, "kind"); return { kind: "stop" }; }
  keys(raw, "kind,axis,strength,intervalScale,reexecute");
  if (raw.kind !== "play") throw new Error("Invalid camera-shake command kind");
  integer(raw.axis, 0, 2); integer(raw.strength, 0, 1); integer(raw.reexecute, -0x80000000);
  scalar(raw.intervalScale, 0);
  const period = fieldShakePeriod(raw);
  if (!Number.isFinite(period) || period <= 0) throw new Error("Unsupported camera-shake sampling interval");
  return { kind: "play", axis: raw.axis, strength: raw.strength,
    intervalScale: raw.intervalScale, reexecute: raw.reexecute };
}
/** Native duration is an interval between draws, never a total lifetime.
 * r0==0 retains the default; i2 also divides this interval by i2+1. */
export function fieldShakePeriod(command: Extract<FieldShakeCommand, { kind: "play" }>): number {
  const base = f(f(1 / 30) / f(command.strength + 1));
  return command.intervalScale === 0 ? base : f(base * command.intervalScale);
}
function binding(value: FieldShakeBinding): void {
  keys(value, "mapId,mapContentHash,script,webPc"); integer(value.mapId, 1); hash(value.mapContentHash); integer(value.webPc, 0);
  if (typeof value.script !== "string" || !value.script || value.script.trim() !== value.script)
    throw new Error("Invalid camera-shake source script");
}
function nextRandom(state: number): { state: number; value: number } {
  let next = state >>> 0; next ^= next << 13; next ^= next >>> 17; next ^= next << 5;
  return { state: next >>> 0, value: (next >>> 0) / 0x100000000 };
}
function correction(before: number, value: number): number {
  const low = before > 0 ? -1 : before, high = before > 0 ? before : 1;
  return f(low + f(f(high - low) * f(value)));
}
/** IMapAccessor.SetCameraOffset delegates to CameraController.SetOffsetPosition,
 * which rounds the sampled pixel offset, with nearest-even half ties. */
export function projectFieldShakeCameraOffset(value: Point): Point {
  const round = (n: number) => { const low = Math.floor(n), fraction = n - low;
    const result = fraction === 0.5 ? low % 2 === 0 ? low : low + 1 : Math.round(n);
    return result === 0 ? 0 : result; };
  return { x: round(value.x), y: round(value.y) };
}

/** Only the current FieldGame owns this scalar presentation state. Position,
 * camera targets, map scroll, actors and general registers are never copied
 * into it. Fixed 10 ms updates are the declared Web scheduler; native render
 * delta timing and DateTime/Unity-RNG parity remain unclaimed. */
export class FieldCameraShakeState {
  private value: FieldCameraShakeSnapshot | null = null;
  private readonly policy: FieldCameraShakePolicy;
  constructor(private readonly sourceSetHash: string, policy: FieldCameraShakePolicy) {
    hash(sourceSetHash); this.policy = parseFieldCameraShakePolicy(policy);
  }
  get projection(): Point {
    const active = this.value?.active;
    if (!active) return { x: 0, y: 0 };
    const range = ranges[active.command.axis * 2 + active.command.strength]!;
    return projectFieldShakeCameraOffset({ x: f(range[0] * active.scale.x), y: f(range[1] * active.scale.y) });
  }
  snapshot(): FieldCameraShakeSnapshot | null { return structuredClone(this.value); }
  fork(): FieldCameraShakeState {
    const result = new FieldCameraShakeState(this.sourceSetHash, this.policy);
    result.value = this.snapshot(); return result;
  }
  start(raw: FieldShakeCommand, origin: FieldShakeBinding | null): void {
    const command = parseFieldShakeCommand(raw);
    if (command.kind === "play") { if (!origin) throw new Error("Missing camera-shake source binding"); binding(origin); }
    const next: FieldCameraShakeSnapshot = this.snapshot() ?? { kind: WEB_FIELD_CAMERA_SHAKE,
      sourceSetHash: this.sourceSetHash, policy: { ...this.policy }, rngState: this.policy.seed, samples: 0, active: null };
    // Setup always changes to Stop first. Its callback clears the prior visual
    // offset, then Play resets scale/time before the next simulation sample.
    next.active = command.kind === "stop" ? null : { command, binding: structuredClone(origin!),
      counter: 0, scale: { x: 0, y: 0 } };
    this.value = next;
  }
  advance(): void {
    if (!this.value?.active) return;
    const next = this.snapshot()!, active = next.active!;
    active.counter = f(active.counter + f(0.01));
    // One draw pair at most; native discards overshoot and uses strict >.
    if (active.counter > fieldShakePeriod(active.command)) {
      if (next.samples >= Number.MAX_SAFE_INTEGER) throw new Error("Camera-shake sample counter exhausted");
      active.counter = 0;
      const x = nextRandom(next.rngState), y = nextRandom(x.state);
      next.rngState = y.state; next.samples++;
      active.scale = { x: correction(active.scale.x, x.value), y: correction(active.scale.y, y.value) };
    }
    this.value = next;
  }
  /** FieldMap's resume callback replays the retained type/interval. The Web
   * stream is preserved rather than re-seeded from wall time; a nonretained
   * field shake is stopped on return. This is an explicit scene policy. */
  afterBattle(): FieldCameraShakeState {
    const next = this.fork(), active = next.value?.active;
    if (active) {
      if (active.command.reexecute !== 0) { active.counter = 0; active.scale = { x: 0, y: 0 }; }
      else next.value!.active = null;
    }
    return next;
  }
  static restore(raw: FieldCameraShakeSnapshot, sourceSetHash: string, policy: FieldCameraShakePolicy,
    validateBinding: (binding: FieldShakeBinding, command: Extract<FieldShakeCommand, { kind: "play" }>) => void): FieldCameraShakeState {
    const result = new FieldCameraShakeState(sourceSetHash, policy);
    keys(raw, "kind,sourceSetHash,policy,rngState,samples,active"); hash(raw.sourceSetHash);
    if (raw.kind !== WEB_FIELD_CAMERA_SHAKE || raw.sourceSetHash !== sourceSetHash ||
        canonical(parseFieldCameraShakePolicy(raw.policy)) !== canonical(result.policy))
      throw new Error("Camera-shake checkpoint policy/source mismatch");
    integer(raw.rngState, 1, 0xffffffff); integer(raw.samples, 0, Number.MAX_SAFE_INTEGER);
    if (raw.active !== null) {
      keys(raw.active, "command,binding,counter,scale");
      const command = parseFieldShakeCommand(raw.active.command);
      if (command.kind !== "play") throw new Error("Invalid active camera-shake command");
      binding(raw.active.binding); scalar(raw.active.counter, 0, fieldShakePeriod(command));
      keys(raw.active.scale, "x,y"); scalar(raw.active.scale.x, -1, 1); scalar(raw.active.scale.y, -1, 1);
      validateBinding(structuredClone(raw.active.binding), command);
    }
    result.value = structuredClone(raw); return result;
  }
}
