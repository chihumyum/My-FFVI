import i18next from "i18next";
import en from "./locales/en.json" with { type: "json" };
import zh from "./locales/zh-CN.json" with { type: "json" };
import { languages, resolveLanguage } from "./languages.js";

export const i18n = i18next.createInstance();
await i18n.init({
  lng: "zh-CN",
  fallbackLng: "en",
  supportedLngs: languages.map(({ id }) => id),
  load: "currentOnly",
  initAsync: false,
  keySeparator: false,
  resources: { en: { translation: en }, "zh-CN": { translation: zh } },
  interpolation: { escapeValue: false }, // All values go to textContent or Pixi Text.
  returnEmptyString: false,
});

export const tr = (key, values) => i18n.t(key, values);
export const language = () => i18n.language;
export async function setLanguage(value) {
  const id = resolveLanguage(value) || "en";
  if (!i18n.hasResourceBundle(id, "translation")) {
    const module = await import(`./locales/${id}.json`, { with: { type: "json" } });
    i18n.addResourceBundle(id, "translation", module.default);
  }
  await i18n.changeLanguage(id);
  return id;
}

export function preferredLanguage(storage, navigatorLanguages = []) {
  let preference;
  try {
    preference = storage?.getItem("ffvi-language");
  } catch {}
  return (
    resolveLanguage(preference) || navigatorLanguages.map(resolveLanguage).find(Boolean) || "en"
  );
}

export const dateLocale = () => language();
