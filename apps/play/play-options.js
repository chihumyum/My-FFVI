export const playOptionLabels = {
  story: "自动推进剧情",
  skipDialogue: "自动跳过对话",
  fastForward: "快速推进",
  autoBattle: "自动战斗",
  invincible: "无敌模式",
  showLocation: "当前位置",
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
