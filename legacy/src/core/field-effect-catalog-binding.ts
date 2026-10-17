import { canonical } from "./canonical.js";
import type { FieldEffectCatalog } from "./field-effects.js";

type Pin = { value: string } | { error: unknown };
function pin(value: unknown): Pin {
  try { return { value: canonical(value) }; } catch (error) { return { error }; }
}
function pinned(value: Pin): string {
  if ("error" in value) throw value.error;
  return value.value;
}
/** Construct only from an owner's detached private catalog. This stores no
 * caller reference and grants no admission: every comparison still encodes the
 * complete current caller value. Invalid encodings retain the previous lazy
 * comparison failure instead of rejecting otherwise unused media at creation. */
export class FieldEffectCatalogBinding {
  readonly #transforms: Pin;
  readonly #media: Map<string, Pin>;
  constructor(owned: FieldEffectCatalog) {
    this.#transforms = pin(owned.boardTransforms ?? null);
    this.#media = new Map(Object.entries(owned.media).map(([group, definition]) => [group, pin(definition)]));
  }
  assertBoardTransforms(caller: FieldEffectCatalog, message: string): void {
    if (canonical(caller.boardTransforms ?? null) !== pinned(this.#transforms)) throw Error(message);
  }
  assertBinding(other: FieldEffectCatalogBinding): void {
    if (pinned(this.#transforms) !== pinned(other.#transforms)) throw Error("Unbound current map board transform catalog");
    for (const [group, definition] of other.#media) {
      const bound = this.#media.get(group);
      if (!bound || pinned(definition) !== pinned(bound)) throw Error("Unbound map effect media " + group);
    }
  }
  assertCatalog(caller: FieldEffectCatalog): void {
    this.assertBoardTransforms(caller, "Unbound current map board transform catalog");
    for (const [group, definition] of Object.entries(caller.media)) {
      const bound = this.#media.get(group);
      if (!bound || canonical(definition) !== pinned(bound)) throw Error("Unbound map effect media " + group);
    }
  }
}
