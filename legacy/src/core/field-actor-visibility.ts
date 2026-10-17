/** Fields on the existing native entity; no actor/clock/renderer owner. */
export type FieldActorVisibilityFade = {
  kind: "source-field-actor-fade-v1";
  status: 1 | 2;
  startedAtSeconds: number;
  durationSeconds: number;
  rate: number;
};
export type FieldActorVisibilityState = {
  visible: boolean;
  fadeAlpha: number;
  visibilityFade?: FieldActorVisibilityFade | null;
};
const f = Math.fround;
function finite(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid source actor fade float");
  return f(value);
}
export function cloneFieldActorFade(value: FieldActorVisibilityFade | null): FieldActorVisibilityFade | null {
  if (value === null) return null;
  if (!value || Object.keys(value).sort().join() !== "durationSeconds,kind,rate,startedAtSeconds,status" ||
      value.kind !== "source-field-actor-fade-v1" || ![1, 2].includes(value.status) ||
      finite(value.startedAtSeconds) !== value.startedAtSeconds ||
      finite(value.durationSeconds) !== value.durationSeconds || value.durationSeconds <= 0 ||
      finite(value.rate) !== value.rate)
    throw new Error("Invalid source actor fade state");
  return { ...value };
}
export function actorFadeActive(value: FieldActorVisibilityState): boolean {
  return value.visibilityFade != null;
}
/** FieldEntity.Show/Hide restart at alpha0/1; they do not tween from a prior
 * partial fade. Hide(duration>0) preserves current GameObject activity. */
export function startFieldActorVisibility<T extends FieldActorVisibilityState>(state: T,
  visible: boolean, durationSeconds: number, nowSeconds: number): T {
  if (typeof state.visible !== "boolean" || typeof visible !== "boolean" ||
      !Number.isFinite(state.fadeAlpha) || state.fadeAlpha < 0 || state.fadeAlpha > 1)
    throw new Error("Invalid source actor visibility state");
  const duration = finite(durationSeconds), now = finite(nowSeconds);
  if (duration < 0) throw new Error("Source negative fade duration is not admitted");
  if (state.visibilityFade !== undefined) cloneFieldActorFade(state.visibilityFade);
  const next = { ...state };
  if (duration === 0) {
    next.visible = visible; next.fadeAlpha = visible ? 1 : 0;
    if (Object.hasOwn(next, "visibilityFade")) next.visibilityFade = null;
  } else {
    if (visible) next.visible = true;
    next.fadeAlpha = visible ? 0 : 1;
    next.visibilityFade = { kind: "source-field-actor-fade-v1", status: visible ? 1 : 2,
      startedAtSeconds: now, durationSeconds: duration, rate: 0 };
  }
  return next;
}
/** FieldEntity.Fade is updated by its admitted entity-update mask. Absolute
 * source time remains advancing while an entity is excluded by a message. */
export function tickFieldActorVisibility<T extends FieldActorVisibilityState>(state: T, nowSeconds: number): T {
  const fade = state.visibilityFade == null ? null : cloneFieldActorFade(state.visibilityFade);
  if (!fade) return { ...state };
  const now = finite(nowSeconds), elapsed = f(now - fade.startedAtSeconds);
  const next: T = { ...state, visibilityFade: fade };
  // Native tests the PREVIOUS rate strictly greater than one. The first
  // endpoint sample, and even a subsequent overshoot sample, remain active.
  if (fade.rate > 1) {
    next.fadeAlpha = fade.status === 1 ? 1 : 0;
    next.visibilityFade = null;
    if (fade.status === 2) next.visible = false;
  } else {
    fade.rate = f(elapsed / fade.durationSeconds);
    const rate = f(Math.max(0, Math.min(1, fade.rate)));
    next.fadeAlpha = fade.status === 1 ? rate : f(1 - rate);
  }
  return next;
}
/** InstantTimer records float32 Time.time promoted to double; its delay is
 * the original double, including negative nonzero values. The VM queues all
 * nonzero delays and invokes this only on a later ordinary Update. */
export function sourceVisibilityDelayDue(recordedSeconds: number, delaySeconds: number, nowSeconds: number): boolean {
  if (finite(recordedSeconds) !== recordedSeconds || !Number.isFinite(delaySeconds))
    throw new Error("Invalid source visibility instant timer");
  return finite(nowSeconds) - recordedSeconds >= delaySeconds;
}
