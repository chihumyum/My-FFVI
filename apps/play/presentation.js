import { webIndexURL } from "./data.js";
import { language } from "../../src/play/i18n.js";
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
  return String(value ?? "")
    .replace(/\(FULL_SPACE\)/g, "　")
    .replace(/\(([A-Z]+)\)/g, (token, key) => {
      const id = characterTokens[key];
      return id ? game.roster[id]?.name || game.battleData.characters[id]?.name || token : token;
    });
}
export async function loadBattlePresentation(repository, renderer) {
  const index = repository.index || (await repository.json(webIndexURL().href));
  if (index.battlePresentation)
    renderer.setBattlePresentation(await repository.json(index.battlePresentation));
  if (index.fieldPresentation)
    renderer.setFieldPresentation(await repository.json(index.fieldPresentation));
  if (index.shaders) renderer.setShaderCatalog(await repository.json(index.shaders));
  if (index.effects)
    renderer.setEffectCatalog(await repository.json(index.effects), (file) =>
      repository.json(file),
    );
}
// Specific PR UI assets and selected RectTransforms, rather than a Unity UI VM.
export async function loadPresentation(repository, renderer, ui) {
  const index = (repository.index ||= await repository.json(webIndexURL().href));
  renderer.setAssets(index.assets.images, repository.baseURL);
  if (!index.presentation) return;
  const presentation = structuredClone(await repository.json(index.presentation));
  const catalog = await repository.locale();
  repository.currentLocale = catalog;
  if (presentation.titleLogos?.[language()])
    presentation.sprites.titleLogo = presentation.titleLogos[language()];
  if (catalog?.language !== "zh-CN" && catalog?.mapNames) presentation.mapNames = catalog.mapNames;
  const font = presentation.fonts?.find((f) => f.primary) || presentation.fonts?.[0];
  if (font) {
    const url = new URL(index.assets.fonts?.[font.url] || font.url, repository.baseURL);
    repository.onProgress?.({ url: url.href, state: "loading" });
    try {
      const face = new FontFace(font.family, `url("${url.href}")`);
      await face.load();
      document.fonts.add(face);
      presentation.fontFamily = font.family;
      repository.onProgress?.({ url: url.href, state: "complete" });
    } catch (error) {
      repository.onProgress?.({ url: url.href, state: "failed" });
      renderer.diagnostics?.record("font-load-failed", {
        entityId: "ui:font",
        resource: font.url,
        reason: error.message,
      });
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
