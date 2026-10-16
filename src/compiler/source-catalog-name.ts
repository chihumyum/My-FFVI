import { MESSAGE_VALUE_PATTERN } from "../core/field-message-template.js";
import { createSourceMessageDictionary, type SourceMessageDictionaryInput } from "./source-message-dictionary.js";
import { compileFieldMessageTemplate } from "./message-template.js";
import { parseSourceCatalogName, type SourceCatalogName } from "../core/source-catalog-name.js";
export type CompiledCatalogName = { name: string; nameSource?: SourceCatalogName };
/** Optional compiler-only method. Ordinary string-name callers cannot turn a
 * dynamic owned name into an unresolved string or a localized default. */
export type CatalogNameResolver = ((key: string) => string) & { sourceCatalogName?(key: string): CompiledCatalogName };
export function createSourceCatalogNameResolver(input: SourceMessageDictionaryInput): CatalogNameResolver & { literalBody(key: string): string } {
  const dictionary = createSourceMessageDictionary(input);
  if (dictionary.binding?.kind !== "battle-event-message-binding-v2")
    throw new Error("Catalog names require the complete source message dictionary binding");
  const binding = dictionary.binding;
  const sourceCatalogName = (key: string): CompiledCatalogName => {
    const { text, dictionary: namespace } = dictionary.body(key);
    if (namespace !== "system_zhc" && (!text || text.trim() !== text || /[<>\\\r\n\u0000-\u001f\u007f]/.test(text)))
      throw new Error("Unsupported source catalog name presentation: " + key);
    // Preserve established literal system labels byte-for-byte, including
    // source punctuation/spacing. Only actual replacement tokens need a view.
    if (![...text.matchAll(MESSAGE_VALUE_PATTERN)].length) return { name: text };
    const template = compileFieldMessageTemplate([text], "", dictionary.characterNames);
    if (!template) return { name: text };
    const nameSource = parseSourceCatalogName({ kind: "source-catalog-name-v1", key,
      dictionary: namespace, template, binding }, text);
    return { name: text, nameSource };
  };
  // Existing ability composers own their presentation/plan diagnostics. A
  // literal raw body preserves that boundary; it cannot substitute an owner.
  const literalBody = (key: string) => {
    const { text } = dictionary.body(key);
    if ([...text.matchAll(MESSAGE_VALUE_PATTERN)].length)
      throw new Error("Source catalog name requires a live owned-name consumer: " + key);
    return text;
  };
  return Object.freeze(Object.assign((key: string) => {
    const result = sourceCatalogName(key);
    if (result.nameSource) throw new Error("Source catalog name requires a live owned-name consumer: " + key);
    return result.name;
  }, { sourceCatalogName, literalBody }));
}
