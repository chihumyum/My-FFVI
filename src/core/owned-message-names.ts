import type { CharacterMessageNameRef } from "./field-message-template.js";

/** These are projections of the existing owned roster and its initializer
 * bindings, never a second mutable registry or a default-name catalog. */
export type OwnedMessageNameMember = { id: string; sourceId: number; name: string };
export type OwnedMessageNameBinding = { id: string; sourceId: number; tag: string };
export type OwnedMessageNameSource = {
  roster: readonly OwnedMessageNameMember[];
  bindings: readonly OwnedMessageNameBinding[];
  characterNames: Readonly<Record<string, string>>;
};
export type PreparedFieldMessageNames = {
  /** Ordered exactly like the references, including repeated occurrences.
   * The owner returns a detached view on every read. */
  readonly names: readonly string[];
  validate(): void;
};
export type FieldMessageNamesPort = {
  prepare(refs: readonly CharacterMessageNameRef[]): PreparedFieldMessageNames;
};

function record(raw: unknown, expected?: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error("Invalid owned message name record");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== Object.keys(descriptors).length ||
      Object.values(descriptors).some(d => !("value" in d) || !d.enumerable) ||
      expected !== undefined && Object.keys(descriptors).sort().join() !== [...expected].sort().join())
    throw new Error("Invalid owned message name fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]));
}
function dense(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("Invalid owned message name array");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== raw.length + 1 ||
      Object.values(descriptors).some(d => !("value" in d)))
    throw new Error("Invalid owned message name array fields");
  return Array.from({ length: raw.length }, (_, index) => {
    const value = descriptors[String(index)];
    if (!value || !value.enumerable) throw new Error("Sparse owned message name array");
    return value.value;
  });
}
function text(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("Missing owned message name text");
  return raw;
}
function integer(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || Object.is(raw, -0) || raw < 1 || raw > 0x7fffffff)
    throw new Error("Invalid owned message name source identity");
  return raw;
}
function unique(values: readonly (string | number)[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error("Duplicate owned message name " + label);
}

/** Resolve only current held characters. Source row provenance belongs to the
 * compiled message reference; the owned initializer independently establishes
 * tag/source identity. An unheld template or localized default is no fallback.
 * All input is validated before producing values, and no input is mutated. */
export function projectOwnedMessageNames(source: OwnedMessageNameSource,
  references: readonly CharacterMessageNameRef[]): string[] {
  const input = record(source, ["roster", "bindings", "characterNames"]);
  const roster = dense(input.roster).map(raw => {
    const value = record(raw, ["id", "sourceId", "name"]);
    return { id: text(value.id), sourceId: integer(value.sourceId), name: text(value.name) };
  });
  unique(roster.map(member => member.id), "owner identity");
  unique(roster.map(member => member.sourceId), "source identity");
  const bindings = dense(input.bindings).map(raw => {
    const value = record(raw, ["id", "sourceId", "tag"]);
    return { id: text(value.id), sourceId: integer(value.sourceId), tag: text(value.tag) };
  });
  unique(bindings.map(binding => binding.id), "bound owner");
  unique(bindings.map(binding => binding.sourceId), "bound source");
  unique(bindings.map(binding => binding.tag), "tag");
  const names = record(input.characterNames);
  for (const value of Object.values(names)) text(value);
  if (Object.keys(names).length !== bindings.length)
    throw new Error("Owned message name binding mismatch");
  for (const binding of bindings) {
    const owner = roster.find(member => member.id === binding.id);
    if (!owner || owner.sourceId !== binding.sourceId || !Object.hasOwn(names, binding.tag) ||
        names[binding.tag] !== owner.name)
      throw new Error("Owned message name binding mismatch");
  }
  const refs = dense(references).map(raw => {
    const value = record(raw, ["tag", "sourceId", "rowId"]);
    return { tag: text(value.tag), sourceId: integer(value.sourceId), rowId: integer(value.rowId) };
  });
  return refs.map(ref => {
    const owner = roster.find(member => member.sourceId === ref.sourceId);
    if (!owner) throw new Error("Missing owned message character: " + ref.sourceId);
    const binding = bindings.find(value => value.id === owner.id && value.sourceId === ref.sourceId);
    if (!binding || binding.tag !== ref.tag)
      throw new Error("Owned message name source/tag mismatch: " + ref.tag);
    return owner.name;
  });
}
