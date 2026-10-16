/** A runtime ownership mode, never a content permission or save capability. */
export const IMMUTABLE_OWNED_FIELD_SOURCE = 'immutable-owned-field-source-v1' as const;
export type ImmutableOwnedFieldSource = typeof IMMUTABLE_OWNED_FIELD_SOURCE;
export function validateFieldSourceSnapshot(value: unknown): void {
  if (value !== undefined && value !== IMMUTABLE_OWNED_FIELD_SOURCE) throw Error('Unknown field source snapshot mode');
}
/** Only data records and arrays have a complete Object.freeze contract. Exotic
 * objects keep writable internal slots despite being frozen; accessors can also
 * change the object between validation and cloning. Reject them explicitly. */
function validateSourceData(input: unknown): void {
  const active = new WeakSet<object>(), done = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object') throw Error('Field source snapshot contains a non-data value');
    if (active.has(value)) throw Error('Cyclic field source snapshot');
    if (done.has(value)) return;
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype && prototype !== null : prototype !== Object.prototype && prototype !== null)
      throw Error('Field source snapshot only accepts plain records and arrays');
    active.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw Error('Field source snapshot contains a symbolic property');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, 'value')) throw Error('Field source snapshot cannot contain accessors');
      visit(descriptor.value);
    }
    active.delete(value); done.add(value);
  };
  visit(input);
}
/** Freeze only a newly detached owned copy. Never freeze or retain the caller.
 * The original and clone are both checked so cloning cannot normalize an
 * unsupported instance into an apparently plain admitted record. */
export function immutableFieldSourceCopy<T>(input: T): T {
  validateSourceData(input);
  const copy = structuredClone(input), seen = new WeakSet<object>();
  validateSourceData(copy);
  // structuredClone normalizes null-prototype dictionaries. Preserve that
  // legal data-record shape on the owned copy without touching the caller.
  const restored = new WeakSet<object>();
  const restoreRecordPrototype = (source: unknown, target: unknown): void => {
    if (source === null || typeof source !== 'object' || target === null || typeof target !== 'object' || restored.has(source)) return;
    restored.add(source);
    if (!Array.isArray(source) && Object.getPrototypeOf(source) === null) Object.setPrototypeOf(target, null);
    for (const key of Object.keys(source)) if (Object.hasOwn(target, key))
      restoreRecordPrototype((source as Record<string, unknown>)[key], (target as Record<string, unknown>)[key]);
  };
  restoreRecordPrototype(input, copy);
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value); for (const item of Object.values(value)) freeze(item); Object.freeze(value);
  };
  freeze(copy); return copy;
}
