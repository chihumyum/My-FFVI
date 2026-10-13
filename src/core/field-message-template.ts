/** Character identity is bound by the source compiler, not inferred from a
 * visible party slot or a default localized label. rowId names the source
 * character_default_name.csv record; the live owner resolves tag/sourceId. */
export type CharacterMessageNameRef = { tag: string; sourceId: number; rowId: number };
export type MessageTemplatePart = { kind: "text"; text: string } |
  { kind: "character-name"; ref: CharacterMessageNameRef };
export type FieldMessageTemplate = {
  kind: "field-message-template-v1";
  pages: MessageTemplatePart[][];
  speaker: MessageTemplatePart[];
};
export type ResolvedFieldMessageTemplate = { pages: string[]; speaker: string };

// The native MessageManager regex captures a word inside parentheses. Keep
// C# word categories, including Unicode letters, without case normalization.
export const MESSAGE_VALUE_PATTERN = Object.freeze(/\(([\p{L}\p{Mn}\p{Nd}\p{Pc}]+)\)/gu);
const tagPattern = /^[\p{L}\p{Mn}\p{Nd}\p{Pc}]+$/u;

function object(raw: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error("Invalid message template " + label);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== keys.length || Object.keys(descriptors).sort().join() !== [...keys].sort().join() ||
      Object.values(descriptors).some(value => !("value" in value) || !value.enumerable))
    throw new Error("Invalid message template " + label + " fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.value]));
}
function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("Invalid message template array");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== raw.length + 1 || Object.values(descriptors).some(value => !("value" in value)))
    throw new Error("Invalid message template array fields");
  return Array.from({ length: raw.length }, (_, index) => {
    const value = descriptors[String(index)];
    if (!value?.enumerable) throw new Error("Sparse message template array");
    return value.value;
  });
}
function identity(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 0x7fffffff)
    throw new Error("Invalid message template character identity");
  return raw;
}
function text(raw: unknown, speaker: boolean): string {
  if (typeof raw !== "string" || !raw || /[<>\\\r\u0000-\u0009\u000b-\u001f\u007f]/.test(raw) ||
      speaker && raw.includes("\n") || [...raw.matchAll(MESSAGE_VALUE_PATTERN)].length)
    throw new Error("Unsupported message template text or unresolved value");
  return raw;
}

/** Loaded templates contain data only. A repeated tag must retain the exact
 * same source character and row binding throughout body and speaker. */
export function parseFieldMessageTemplate(raw: unknown): FieldMessageTemplate {
  const value = object(raw, ["kind", "pages", "speaker"], "document");
  if (value.kind !== "field-message-template-v1") throw new Error("Invalid message template kind");
  const bindings = new Map<string, CharacterMessageNameRef>(), rows = new Map<number, string>();
  let references = 0;
  const parts = (rawParts: unknown, speaker: boolean): MessageTemplatePart[] => array(rawParts).map(rawPart => {
    const kind = rawPart && typeof rawPart === "object" ? Object.getOwnPropertyDescriptor(rawPart, "kind")?.value : undefined;
    const part = object(rawPart, kind === "text" ? ["kind", "text"] : ["kind", "ref"], "part");
    if (part.kind === "text") return { kind: "text", text: text(part.text, speaker) };
    if (part.kind !== "character-name") throw new Error("Unknown message template part");
    const input = object(part.ref, ["tag", "sourceId", "rowId"], "name reference");
    if (typeof input.tag !== "string" || !tagPattern.test(input.tag)) throw new Error("Invalid message template name tag");
    const ref = { tag: input.tag, sourceId: identity(input.sourceId), rowId: identity(input.rowId) }, previous = bindings.get(ref.tag);
    if (previous && (previous.sourceId !== ref.sourceId || previous.rowId !== ref.rowId) ||
        rows.has(ref.rowId) && rows.get(ref.rowId) !== ref.tag)
      throw new Error("Conflicting message template name bindings");
    bindings.set(ref.tag, ref); rows.set(ref.rowId, ref.tag); references++;
    return { kind: "character-name", ref };
  });
  const pages = array(value.pages).map(rawPage => parts(rawPage, false));
  const speaker = parts(value.speaker, true);
  if (!pages.length || pages.some(page => !page.length) || !references)
    throw new Error("Empty message template page or missing name reference");
  return { kind: "field-message-template-v1", pages, speaker };
}

/** No binding is cached here. The caller prepares one view from its live
 * owner, validates that view with its window transaction, and publishes once. */
export function fieldMessageNameReferences(template: FieldMessageTemplate): CharacterMessageNameRef[] {
  const value = parseFieldMessageTemplate(template);
  return [...value.pages.flat(), ...value.speaker].flatMap(part =>
    part.kind === "character-name" ? [{ ...part.ref }] : []);
}

/** Reconstruct the decoded source strings for the consuming owner's shape
 * check. These unresolved strings are never a presentation fallback. */
export function fieldMessageTemplateSource(template: FieldMessageTemplate): ResolvedFieldMessageTemplate {
  const value = parseFieldMessageTemplate(template), render = (parts: MessageTemplatePart[]) =>
    parts.map(part => part.kind === "text" ? part.text : "(" + part.ref.tag + ")").join("");
  return { pages: value.pages.map(render), speaker: render(value.speaker) };
}

export function resolveFieldMessageTemplate(template: FieldMessageTemplate, names: readonly string[]): ResolvedFieldMessageTemplate {
  const value = parseFieldMessageTemplate(template), supplied = array(names);
  const resolved = new Map<string, string>();
  let index = 0;
  const render = (parts: MessageTemplatePart[], speaker: boolean): string => parts.map(part => {
    if (part.kind === "text") return part.text;
    const name = text(supplied[index++], speaker), previous = resolved.get(part.ref.tag);
    if (previous !== undefined && previous !== name) throw new Error("Conflicting prepared message names");
    resolved.set(part.ref.tag, name);
    return name;
  }).join("");
  const pages = value.pages.map(page => render(page, false)), speaker = render(value.speaker, true);
  if (index !== supplied.length) throw new Error("Message template name view cardinality mismatch");
  return { pages, speaker };
}
