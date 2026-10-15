import { checkpointKeys } from "./checkpoint-validation.js";

export type FadeColor = { r: number; g: number; b: number; a: number };
export type FieldFadeDirection = "in" | "out";
export type FieldFadeOp = {
  kind: "field-fade";
  direction: FieldFadeDirection;
  /** Signed float32 seconds: negative is asynchronous; negative zero is not. */
  seconds: number;
  color: FadeColor | null;
};
export type FieldFadeInitial = {
  imageColor: FadeColor;
  rendererColor: FadeColor;
  raycastTarget: boolean;
};
export type FieldFadeTween = {
  startColor: FadeColor;
  targetAlpha: number;
  duration: number;
  elapsed: number;
};
export type FieldFadeSnapshot = FieldFadeInitial & {
  kind: "field-fade-v1";
  tween: FieldFadeTween | null;
};
export type FieldFadeProjection = FieldFadeInitial;

const black = (): FadeColor => ({ r: 0, g: 0, b: 0, a: 1 });
const clearRenderer = (): FadeColor => ({ r: 1, g: 1, b: 1, a: 0 });
/** Authored development profile seed, never an inferred native/new-game default. */
export const DEVELOPMENT_TRANSPARENT_FADE: Readonly<FieldFadeInitial> =
  Object.freeze({
    imageColor: Object.freeze(black()),
    rendererColor: Object.freeze(clearRenderer()),
    raycastTarget: false,
  });

function float(value: number, label: string, max = 1): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    Math.fround(value) !== value
  )
    throw new Error(`Invalid field fade ${label}`);
  return value;
}
function color(value: FadeColor): void {
  checkpointKeys(value, "r,g,b,a");
  for (const component of ["r", "g", "b", "a"] as const)
    float(value[component], "color");
}
/** Color32 conversion uses float32 scale and round-to-even at exact halves. */
function imageChannel(value: number): number {
  const scaled = Math.fround(value * 255),
    lower = Math.floor(scaled);
  const byte =
    scaled - lower === 0.5
      ? lower + (lower % 2)
      : Math.floor(Math.fround(scaled + 0.5));
  return Math.fround(byte / 255);
}
/** Ordinary UI vertex color times the canvas multiplier. Native GPU blend/color-space
 * parity is separate from this deterministic Web overlay projection. */
export function fieldFadeOverlay(
  projection: FieldFadeProjection | null,
): FadeColor | null {
  if (projection === null) return null;
  checkpointKeys(projection, "imageColor,rendererColor,raycastTarget");
  initial(projection);
  const output = {} as FadeColor;
  for (const component of ["r", "g", "b", "a"] as const)
    output[component] = Math.fround(
      imageChannel(projection.imageColor[component]) *
        projection.rendererColor[component],
    );
  return output;
}
function initial(value: FieldFadeInitial): void {
  color(value.imageColor);
  color(value.rendererColor);
  if (typeof value.raycastTarget !== "boolean")
    throw new Error("Invalid field fade raycast state");
}
function delta(value: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isFinite(Math.fround(value))
  )
    throw new Error("Invalid field fade scaled delta seconds");
  return Math.fround(value);
}
function direction(value: FieldFadeDirection): void {
  if (value !== "in" && value !== "out")
    throw new Error("Invalid field fade direction");
}
function lerp(a: number, b: number, ratio: number): number {
  return Math.fround(a + Math.fround(Math.fround(b - a) * ratio));
}
function sample(value: FieldFadeSnapshot, percentage: number): void {
  const tween = value.tween!;
  value.rendererColor = {
    ...tween.startColor,
    a: lerp(
      tween.startColor.a,
      tween.targetAlpha,
      Math.min(1, Math.max(0, percentage)),
    ),
  };
}
/** One Unity ColorTween.MoveNext, including the final resume after its last yield. */
function resume(value: FieldFadeSnapshot, dt: number): void {
  const tween = value.tween;
  if (!tween) return;
  if (tween.elapsed >= tween.duration) {
    sample(value, 1);
    value.tween = null;
    return;
  }
  const elapsed = Math.fround(tween.elapsed + dt);
  if (!Number.isFinite(elapsed))
    throw new Error("Field fade elapsed time overflows float32");
  tween.elapsed = elapsed;
  sample(value, Math.fround(elapsed / tween.duration));
}

/** One deterministic owner for the active ordinary FadeManager host.
 * The renderer projects this state and never writes completion signals.
 * Null means the caller has not supplied a trustworthy initial host state. */
export class FieldFadeState {
  private value: FieldFadeSnapshot | null;
  private revision=0;
  private frameReservation:object|null=null;
  get mutationRevision(){return this.revision;}
  private requireWritable(){if(this.frameReservation)throw new Error("Global fade owner is reserved by a frame transaction");}
  /** A private simulation-frame branch, never a second live fade manager.
   * Reserving the actual owner prevents callback writes during publication. */
  prepareFrame(){
    this.requireWritable();const token={},revision=this.revision,state=this.fork();
    this.frameReservation=token;let closed=false;
    const validate=()=>{if(closed||this.frameReservation!==token||this.revision!==revision)throw new Error("Stale global fade frame transaction");};
    return {state,validate,discard:()=>{validate();closed=true;this.frameReservation=null;},prepareCommit:()=>{
      validate();const candidateRevision=state.revision,value=state.snapshot();
      const finalValidate=()=>{validate();if(state.revision!==candidateRevision)throw new Error("Global fade candidate changed after preparation");};
      return {validate:finalValidate,commit:()=>{finalValidate();this.value=value;this.revision++;closed=true;this.frameReservation=null;}};
    }};
  }
  constructor(seed: FieldFadeInitial | null) {
    if (seed !== null) {
      checkpointKeys(seed, "imageColor,rendererColor,raycastTarget");
      initial(seed);
    }
    this.value =
      seed === null
        ? null
        : { ...structuredClone(seed), kind: "field-fade-v1", tween: null };
  }
  get active(): boolean {
    return this.value?.tween !== null && this.value !== null;
  }
  get known(): boolean {
    return this.value !== null;
  }
  get projection(): FieldFadeProjection | null {
    if (!this.value) return null;
    const { imageColor, rendererColor, raycastTarget } = this.value;
    return structuredClone({ imageColor, rendererColor, raycastTarget });
  }
  /** Internal candidate state; active snapshots are not stable-save payloads. */
  snapshot(): FieldFadeSnapshot | null {
    return structuredClone(this.value);
  }
  /** Clone an in-flight global fade for an isolated map candidate. */
  fork(): FieldFadeState {
    const copy = new FieldFadeState(null);
    copy.value = this.snapshot();
    copy.revision = this.revision;
    return copy;
  }
  /** Stable saves may contain an opaque black screen, but no live coroutine. */
  static restore(snapshot: FieldFadeSnapshot | null): FieldFadeState {
    if (snapshot === null) return new FieldFadeState(null);
    checkpointKeys(
      snapshot,
      "kind,imageColor,rendererColor,raycastTarget,tween",
    );
    if (snapshot.kind !== "field-fade-v1" || snapshot.tween !== null)
      throw new Error("Unsupported active or invalid field fade checkpoint");
    initial(snapshot);
    const restored = new FieldFadeState(null);
    restored.value = structuredClone(snapshot);
    return restored;
  }
  start(op: FieldFadeOp, frameDeltaSeconds = 0): "next" | "wait" {
    this.requireWritable();
    direction(op.direction);
    const dt = delta(frameDeltaSeconds),
      seconds = Math.fround(op.seconds);
    if (
      op.kind !== "field-fade" ||
      typeof op.seconds !== "number" ||
      !Number.isFinite(seconds)
    )
      throw new Error("Invalid field fade instruction");
    if (op.color !== null) color(op.color);
    if (!this.value) throw new Error("Unknown initial field fade host state");
    const next = this.snapshot()!;
    next.imageColor = structuredClone(
      op.color ?? (op.direction === "out" ? black() : next.imageColor),
    );
    const targetAlpha = op.direction === "in" ? 0 : next.imageColor.a;
    // CrossFadeAlpha compares the full black target before starting an Alpha-only tween.
    const same =
      next.rendererColor.r === 0 &&
      next.rendererColor.g === 0 &&
      next.rendererColor.b === 0 &&
      next.rendererColor.a === targetAlpha;
    next.tween = same
      ? null
      : {
          startColor: { ...next.rendererColor },
          targetAlpha,
          duration: Math.abs(seconds),
          elapsed: 0,
        };
    // StartCoroutine performs its first MoveNext immediately in the calling frame.
    resume(next, dt);
    if (op.direction === "out") next.raycastTarget = true;
    this.value = next; this.revision++;
    return seconds < 0 ? "next" : "wait";
  }
  poll(mode: FieldFadeDirection): "next" | "wait" {
    direction(mode);
    if (!this.value) throw new Error("Unknown initial field fade host state");
    return this.value.rendererColor.a ===
      (mode === "in" ? 0 : this.value.imageColor.a)
      ? "next"
      : "wait";
  }
  /** Scaled seconds supplied by the host. Web runs manager Update before its coroutine step;
   * this explicit scheduling policy is not original frame-order acceptance. */
  advance(deltaSeconds: number): void {
    this.requireWritable();
    const dt = delta(deltaSeconds);
    if (!this.value) return;
    const next = this.snapshot()!;
    if (next.rendererColor.a === 0) {
      next.rendererColor = clearRenderer();
      next.raycastTarget = false;
    }
    resume(next, dt);
    this.value = next; this.revision++;
  }
}
