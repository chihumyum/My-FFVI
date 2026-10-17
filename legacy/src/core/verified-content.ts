import { immutableFieldSourceCopy } from "./field-source-snapshot.js";
import { verifyContent } from "./content-integrity.js";

/** Definition ownership only; never a save, runtime host or mutable owner. */
const creationKey = Symbol("owned verified content creation");
class VerifiedDocument<T extends { contentHash: string }> {
  readonly #value: T;
  constructor(value: T, key: symbol) {
    if (key !== creationKey) throw new Error("Verified documents can only be created by full capture and verification");
    this.#value = value; Object.freeze(this);
  }
  static value<T extends { contentHash: string }>(input: VerifiedContent<T>): T {
    if (input === null || typeof input !== "object" || !(#value in input))
      throw new Error("A genuine verified content document is required");
    return input.#value;
  }
}
// A cap exposes its prototype.constructor through ordinary reflection. That
// must not let a caller replace the static brand reader or constructor link.
Object.freeze(VerifiedDocument.prototype);
Object.freeze(VerifiedDocument);
export type VerifiedContent<T extends { contentHash: string }> = VerifiedDocument<T>;

/** Capture before the first await. Verification always hashes the full owned
 * payload; a header, outside object identity or failed request is never cached. */
export async function captureVerifiedContent<T extends { contentHash: string }>(
  value: T, expected?: string,
): Promise<VerifiedContent<T>> {
  const owned = immutableFieldSourceCopy(value);
  await verifyContent(owned, expected);
  return new VerifiedDocument(owned, creationKey);
}

/** Internal definition read. The result is deeply frozen data, despite legacy
 * content interfaces describing mutable arrays. It contains no live state. */
export function verifiedContentValue<T extends { contentHash: string }>(value: VerifiedContent<T>): T {
  return VerifiedDocument.value(value);
}
