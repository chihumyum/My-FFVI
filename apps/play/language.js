import { tr, i18n, language, setLanguage, preferredLanguage } from "../../src/play/i18n.js";
import { languages } from "../../src/play/languages.js";

export function translateDOM(root = document) {
  const nodes = [
    ...(root.matches?.("[data-i18n]") ? [root] : []),
    ...root.querySelectorAll(
      "[data-i18n], [data-i18n-aria-label], [data-i18n-title], [data-i18n-placeholder], [data-i18n-alt]",
    ),
  ];
  for (const node of nodes) {
    if (node.dataset.i18n) node.textContent = tr(node.dataset.i18n);
    for (const attribute of ["aria-label", "title", "placeholder", "alt"])
      if (node.hasAttribute(`data-i18n-${attribute}`))
        node.setAttribute(attribute, tr(node.getAttribute(`data-i18n-${attribute}`)));
  }
  document.documentElement.lang = language();
}

export async function initializeLanguage() {
  await setLanguage(preferredLanguage(localStorage, navigator.languages || [navigator.language]));
  translateDOM();
}

export function mountLanguageControl(change) {
  const wrapper = document.createElement("label");
  wrapper.className = "language-control";
  const label = document.createElement("span");
  label.dataset.i18n = "language.label";
  const select = document.createElement("select");
  select.id = "game-language";
  select.dataset.i18nAriaLabel = "language.label";
  for (const { id, name } of languages) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    select.append(option);
  }
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  wrapper.append(label, select, status);
  (document.querySelector(".touch-toolbar") || document.body).append(wrapper);
  select.value = language();
  select.onchange = async () => {
    const before = language();
    select.disabled = true;
    status.textContent = tr("language.loading");
    try {
      await change(select.value);
      try {
        localStorage.setItem("ffvi-language", language());
      } catch {}
      status.textContent = "";
    } catch (error) {
      select.value = before;
      status.textContent = tr("language.failed", { error: error.message });
      console.warn("[localization]", error);
    } finally {
      select.disabled = false;
    }
  };
  translateDOM(wrapper);
  const translate = () => {
    translateDOM();
    select.value = language();
  };
  i18n.on("languageChanged", translate);
  return () => {
    i18n.off("languageChanged", translate);
    wrapper.remove();
  };
}
