import { webIndexURL } from "./data.js";
const characterTokens = {
  TINA: 1,
  LOCK: 2,
  ROCK: 2,
  KAIEN: 3,
  SHADOW: 4,
  EDGAR: 5,
  MASH: 6,
  CELES: 7,
  STRAGUS: 8,
  RELM: 9,
  SETZER: 10,
  MOG: 11,
  GAU: 12,
  GOGO: 13,
  UMARO: 14,
};
export function presentText(game, value) {
  return String(value ?? "").replace(/\(([A-Z]+)\)/g, (token, key) => {
    const id = characterTokens[key];
    return id ? game.roster[id]?.name || game.battleData.characters[id]?.name || token : token;
  });
}
// Specific PR UI assets and selected RectTransforms, rather than a Unity UI VM.
export async function loadPresentation(repository, renderer, ui) {
  const index = (repository.index ||= await repository.json(webIndexURL().href));
  renderer.setAssets(index.assets.images, repository.baseURL);
  if (!index.presentation) return;
  const presentation = structuredClone(await repository.json(index.presentation));
  const font = presentation.fonts?.find((f) => f.primary) || presentation.fonts?.[0];
  if (font) {
    try {
      const url = new URL(index.assets.fonts?.[font.url] || font.url, repository.baseURL);
      const face = new FontFace(font.family, `url("${url.href}")`);
      await face.load();
      document.fonts.add(face);
      presentation.fontFamily = font.family;
    } catch (error) {
      console.warn("[UI guess] PR/CJK font unavailable; system fallback:", error.message);
    }
  }
  for (const guess of presentation.warnings || presentation.guesses || [])
    console.warn("[UI guess]", guess);
  console.warn(
    "[UI guess] Message uses its authored PR size at the bottom margin; battle combines the authored touch command/player windows with a separate list above the HUD. LayoutGroup/animated positions are adapted explicitly.",
  );
  ui.setPresentation(presentation);
  return presentation;
}
