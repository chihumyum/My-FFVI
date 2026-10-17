import { readSnapshot, snapshotFile } from "./integrity.js";
import { record } from "./content.js";
import { bindBattleEventMessageInput } from "./battle-event-message-bindings.js";
import { createSourceMessageDictionary, type SourceMessageDictionaryInput } from "./source-message-dictionary.js";
import { validateFieldEmptyMessage, type FieldEmptyMessageOp } from "../core/field-empty-message.js";
import type { loadSystemSource } from "./system-source.js";

/** Compiler-only complete dictionary authority. No partial messages object or
 * hand-written list of missing keys can grant an empty Field operation. */
class FieldEmptyMessageResolver {
  readonly #dictionary: ReturnType<typeof createSourceMessageDictionary>;
  constructor(input: SourceMessageDictionaryInput) {
    this.#dictionary = createSourceMessageDictionary(input);
    if (this.#dictionary.binding?.kind !== "battle-event-message-binding-v2")
      throw new Error("Field empty messages require the complete bound source dictionaries");
  }
  static compile(resolver: FieldEmptyMessageResolver, raw: unknown): FieldEmptyMessageOp | null {
    if (!resolver || typeof resolver !== "object" || !(#dictionary in resolver))
      throw new Error("Missing complete source Field message lookup authority");
    const m = record(raw), operands = record(m.operands), strings = operands.sValues;
    if (m.type !== 1 || m.mnemonic !== "Msg" || !Array.isArray(strings) || typeof strings[0] !== "string")
      throw new Error("Expected original Field Msg operands");
    const key = strings[0];
    if (key && resolver.#dictionary.hasBody(key)) return null;
    const op: FieldEmptyMessageOp = { kind: "field-empty-message-stop", key,
      reason: key ? "missing-static-row" : "empty-input",
      binding: structuredClone(resolver.#dictionary.binding!) as FieldEmptyMessageOp["binding"],
      operands: structuredClone(operands) as FieldEmptyMessageOp["operands"] };
    validateFieldEmptyMessage(op); return op;
  }
}
Object.freeze(FieldEmptyMessageResolver); Object.freeze(FieldEmptyMessageResolver.prototype);
export type FieldEmptyMessageLookup = FieldEmptyMessageResolver;
export function createFieldEmptyMessageLookup(input: SourceMessageDictionaryInput): FieldEmptyMessageLookup {
  return new FieldEmptyMessageResolver(input);
}
export function compileFieldEmptyMessage(raw: unknown, resolver: FieldEmptyMessageLookup): FieldEmptyMessageOp | null {
  return FieldEmptyMessageResolver.compile(resolver, raw);
}
export async function loadFieldEmptyMessageLookup(root: string, source: Awaited<ReturnType<typeof loadSystemSource>>) {
  const files = await readSnapshot(root + "/build/field"), field = record(JSON.parse(snapshotFile(files, "field.json").toString()));
  const names = source.tables["character_default_name.csv"]!.map(row => source.reader.row("character_default_name.csv", Number(row.id)));
  return createFieldEmptyMessageLookup(bindBattleEventMessageInput(field, source, names));
}
