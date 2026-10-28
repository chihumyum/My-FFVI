// PR message-table suffixes are source identifiers, independent of UI locale tags.
export const languages = Object.freeze([
  { id: "en", source: "en", name: "English" },
  { id: "zh-CN", source: "zhc", name: "简体中文" },
  { id: "zh-TW", source: "zht", name: "繁體中文" },
  { id: "ja", source: "ja", name: "日本語" },
  { id: "ko", source: "ko", name: "한국어" },
  { id: "de", source: "de", name: "Deutsch" },
  { id: "fr", source: "fr", name: "Français" },
  { id: "it", source: "it", name: "Italiano" },
  { id: "es", source: "es", name: "Español" },
  { id: "pt", source: "pt", name: "Português" },
  { id: "ru", source: "ru", name: "Русский" },
  { id: "th", source: "th", name: "ไทย" },
]);

export function resolveLanguage(value) {
  const tag = String(value || "")
    .replaceAll("_", "-")
    .toLowerCase();
  if (tag.startsWith("zh")) return /(?:hant|tw|hk|mo)/.test(tag) ? "zh-TW" : "zh-CN";
  return languages.find((language) => language.id === tag.split("-")[0])?.id || null;
}

// PR supplies seven sung-opera recordings. Other text locales retain Japanese vocals.
export const operaAudioLanguage = (id) =>
  ({
    en: "ENG",
    ja: "JPN",
    ko: "KOR",
    de: "DEU",
    fr: "FRE",
    it: "ITA",
    es: "SPA",
  })[id] || "JPN";
