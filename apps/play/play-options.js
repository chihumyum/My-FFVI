import { tr } from "../../src/play/i18n.js";
export const playOptionLabels = {
  get story() {
    return tr("play_options.automatic_story_progression");
  },
  get skipDialogue() {
    return tr("play_options.skip_dialogue_automatically");
  },
  get fastForward() {
    return tr("play_options.fast_forward");
  },
  get autoBattle() {
    return tr("play_options.auto_battle");
  },
  get invincible() {
    return tr("play_options.invincibility");
  },
  get showLocation() {
    return tr("play_options.current_location");
  },
};
const storageKey = "ffvi-play-options";
export function readPlayOptions(storage = localStorage) {
  let saved;
  try {
    saved = JSON.parse(storage.getItem(storageKey));
  } catch {}
  // Moving the player is always an explicit action after opening a page.
  return Object.fromEntries(
    Object.keys(playOptionLabels).map((key) => [key, key !== "story" && saved?.[key] === true]),
  );
}
export function savePlayOptions(options, storage = localStorage) {
  try {
    storage.setItem(storageKey, JSON.stringify(options));
  } catch {}
}
export function simulationRepeats(options, { boosted = false, realtime = false } = {}) {
  return options.fastForward && !realtime ? (boosted ? 16 : 4) : 1;
}
