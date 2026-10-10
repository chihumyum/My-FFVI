import { canonical } from "./canonical.js";

/** Verify the payload itself, not just a claimed digest copied into its header. */
export async function verifyContent<T extends { contentHash: string }>(
  value: T,
  expected?: string,
): Promise<T> {
  const { contentHash, ...payload } = value;
  if (
    !/^[a-f0-9]{64}$/.test(contentHash) ||
    (expected !== undefined && expected !== contentHash)
  )
    throw new Error("Content identity mismatch");
  const bytes = new TextEncoder().encode(canonical(payload));
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== contentHash) throw new Error("Content payload changed");
  return value;
}
