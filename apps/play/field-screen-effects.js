// PR Misc.ScreenEffect chooses a preset, with i1=0 playing its min->max
// task and i1!=0 reversing it (native b52420/b51c40). Durations are seconds.
export function screenEffectAmount(effect, time) {
  if (!effect) return 0;
  const progress =
    effect.duration > 0 ? Math.max(0, Math.min(1, (time - effect.time) / effect.duration)) : 1;
  return effect.value ? 1 - progress : progress;
}

export function clearMapEffects(presentation, id) {
  if (presentation.mapId === id) return false;
  presentation.mapId = id;
  presentation.screenEffects = {};
  presentation.water = {};
  presentation.waterOrder = 0;
  presentation.tone = null;
  presentation.currentTone = null;
  return true;
}

// Field FadeOut commonly remains set while PR opens its separate battle
// camera. It must still cover the field when returning, never the combat view.
export function sceneFadeAlpha(fade, time, inBattle = false) {
  if (!fade || inBattle) return 0;
  const progress = Math.max(0, Math.min(1, (time - fade.start) / (fade.duration || 0.000001)));
  return Math.max(0, Math.min(1, fade.from + (fade.to - fade.from) * progress));
}
