import { tableInteger } from "./table.js";
import { parseFieldMessageTemplate, MESSAGE_VALUE_PATTERN, type CharacterMessageNameRef,
  type FieldMessageTemplate, type MessageTemplatePart } from "../core/field-message-template.js";

/** Full source rows bind every name tag, independently of which characters
 * are held or have an admitted initialization template in this session. */
function characterBindings(raw: unknown): Map<string, CharacterMessageNameRef> {
  if (!Array.isArray(raw)) throw new Error("Character message name source table is unavailable");
  const bindings = new Map<string, CharacterMessageNameRef>(), rowIds = new Set<number>(), sourceIds = new Set<number>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(row))) throw new Error("Invalid character message name source row");
    const descriptors = Object.getOwnPropertyDescriptors(row);
    if (Object.values(descriptors).some(value => !("value" in value))) throw new Error("Invalid character message name source fields");
    const values = Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.value]));
    if (typeof values.id !== "string" || typeof values.character_id !== "string")
      throw new Error("Invalid character message name source identity fields");
    const rowId = tableInteger(values.id), sourceId = tableInteger(values.character_id);
    if (rowId <= 0 || rowId > 0x7fffffff || sourceId <= 0 || sourceId > 0x7fffffff || rowIds.has(rowId) || sourceIds.has(sourceId) ||
        typeof values.tag_name !== "string" || !/^[\p{L}\p{Mn}\p{Nd}\p{Pc}]+$/u.test(values.tag_name) || bindings.has(values.tag_name))
      throw new Error("Invalid or ambiguous character message name source binding");
    rowIds.add(rowId); sourceIds.add(sourceId);
    bindings.set(values.tag_name, { tag: values.tag_name, sourceId, rowId });
  }
  return bindings;
}

/** Unknown parenthesized parameters are capability failures, not printable
 * literals. Static text keeps its existing output shape and consumes no table. */
export function compileFieldMessageTemplate(pages: readonly string[], speaker: string,
  characterNames?: unknown): FieldMessageTemplate | undefined {
  if (![...pages, speaker].some(text => [...text.matchAll(MESSAGE_VALUE_PATTERN)].length)) return undefined;
  const bindings = characterBindings(characterNames);
  const parts = (text: string): MessageTemplatePart[] => {
    const result: MessageTemplatePart[] = [];
    let start = 0;
    for (const match of text.matchAll(MESSAGE_VALUE_PATTERN)) {
      if (match.index > start) result.push({ kind: "text", text: text.slice(start, match.index) });
      const ref = bindings.get(match[1]!);
      if (!ref) throw new Error("Unsupported message value binding: " + match[1]);
      result.push({ kind: "character-name", ref: { ...ref } });
      start = match.index + match[0].length;
    }
    if (start < text.length) result.push({ kind: "text", text: text.slice(start) });
    return result;
  };
  return parseFieldMessageTemplate({ kind: "field-message-template-v1", pages: pages.map(parts), speaker: parts(speaker) });
}
