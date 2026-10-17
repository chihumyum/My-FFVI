import { canonical } from "./canonical.js";
import { parseBattleEventMessageBinding, type BattleEventMessageBinding } from "./battle-event-message.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { fieldMessageNameReferences, fieldMessageTemplateSource, parseFieldMessageTemplate,
  resolveFieldMessageTemplate, MESSAGE_VALUE_PATTERN, type FieldMessageTemplate } from "./field-message-template.js";
import type { FieldMessageNamesPort } from "./owned-message-names.js";
export type SourceCatalogName = { kind: "source-catalog-name-v1"; key: string;
  dictionary: "story_mes_zhc" | "system_zhc" | "etc_text_zhc";
  template: FieldMessageTemplate; binding: Extract<BattleEventMessageBinding, {kind:"battle-event-message-binding-v2"}> };
/** Content/source hashes are checked by the trusted content loader. This
 * data-only validator does not re-read original files or claim a signature. */
export function parseSourceCatalogName(raw: unknown, text: string): SourceCatalogName {
  checkpointKeys(raw, "kind,key,dictionary,template,binding");
  const value = raw as SourceCatalogName, binding = parseBattleEventMessageBinding(value.binding),
    template = parseFieldMessageTemplate(value.template), source = fieldMessageTemplateSource(template);
  if (value.kind !== "source-catalog-name-v1" || typeof value.key !== "string" || !value.key ||
      !["story_mes_zhc", "system_zhc", "etc_text_zhc"].includes(value.dictionary) ||
      binding.kind !== "battle-event-message-binding-v2" || template.kind !== "field-message-template-v1" ||
      source.pages.length !== 1 || source.pages[0] !== text || source.speaker !== "" || template.speaker.length !== 0 ||
      /[<>\\\r\n\u0000-\u001f\u007f]/.test(text))
    throw new Error("Invalid source catalog name template/binding");
  return structuredClone(value);
}
export function prepareSourceCatalogName(text: string, raw: SourceCatalogName | undefined, names?: FieldMessageNamesPort) {
  if (raw === undefined) {
    if ([...text.matchAll(MESSAGE_VALUE_PATTERN)].length) throw new Error("Unresolved source catalog name requires its compiled template");
    return { name: text, validate() {} };
  }
  const before = canonical(raw), value = parseSourceCatalogName(raw, text);
  if (!names || typeof names.prepare !== "function") throw new Error("Source catalog name requires the actual held-name owner");
  const view = names.prepare(fieldMessageNameReferences(value.template));
  if (!view || typeof view.validate !== "function") throw new Error("Invalid source catalog name view");
  const resolved = resolveFieldMessageTemplate(value.template, view.names);
  if (!resolved.pages[0] || /[<>\\\r\n\u0000-\u001f\u007f]/.test(resolved.pages[0])) throw new Error("Unsupported resolved catalog name");
  view.validate();
  return { name: resolved.pages[0], validate: () => {
    if (canonical(raw) !== before) throw new Error("Source catalog name content changed during preparation");
    view.validate();
  } };
}
