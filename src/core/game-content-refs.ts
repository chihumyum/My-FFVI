/** Host-owned package locations and immutable content identities. Saves keep
 * their content identities; they never choose or replace these locations. */
export type GameContentProfile = "source" | "framework";
export type GameContentRef = { url: string; contentHash: string };
export type GameEntryRefs = { entry: GameContentRef; battle: GameContentRef };
export type GameContentRefsV1 = {
  kind: "game-content-refs-v1";
  profile: GameContentProfile;
  world: GameContentRef;
  source: GameEntryRefs | null;
  development: GameEntryRefs | null;
};
export type GameContentRefsV2 = Omit<GameContentRefsV1, "kind"> & {
  kind: "game-content-refs-v2";
  initialized: GameEntryRefs | null;
};
export type GameContentRefs = GameContentRefsV1 | GameContentRefsV2;

function plainObject(raw: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype === null) return true;
  if (typeof prototype !== "object" || Object.getPrototypeOf(prototype) !== null) return false;
  // Standard JSON objects can cross a browser/VM realm. Check the native
  // Object prototype through data descriptors without invoking a constructor
  // getter or requiring this realm's Object.prototype identity.
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (!constructor || !("value" in constructor) || typeof constructor.value !== "function") return false;
  const binding = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
  return binding?.value === prototype &&
    Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object);
}

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !plainObject(raw))
    throw new Error("Invalid game content references object");
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(raw);
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string") ||
      Object.keys(descriptors).sort().join(",") !== [...keys].sort().join(",") ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid game content references fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function reference(raw: unknown): GameContentRef {
  const value = record(raw, ["url", "contentHash"]);
  if (typeof value.url !== "string" ||
      !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/.test(value.url))
    throw new Error("Invalid game content reference URL");
  if (typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash))
    throw new Error("Invalid game content reference hash");
  return { url: value.url, contentHash: value.contentHash };
}

function entryReferences(raw: unknown): GameEntryRefs | null {
  if (raw === null) return null;
  const value = record(raw, ["entry", "battle"]);
  return { entry: reference(value.entry), battle: reference(value.battle) };
}

/** All fields are explicit. No custom reference inherits a default location,
 * entry, profile or pin. The returned tree contains detached plain data. */
export function parseGameContentRefs(raw: unknown): GameContentRefs {
  // Inspect an own data descriptor; a discriminator getter never executes.
  const kind = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "kind") : undefined;
  const initializedVersion = kind && "value" in kind && kind.value === "game-content-refs-v2";
  const value = record(raw, ["kind", "profile", "world", "source", "development",
    ...(initializedVersion ? ["initialized"] : [])]);
  if ((!initializedVersion && value.kind !== "game-content-refs-v1") ||
      (value.profile !== "source" && value.profile !== "framework"))
    throw new Error("Invalid game content references kind/profile");
  const world = reference(value.world), source = entryReferences(value.source),
    development = entryReferences(value.development);
  if (initializedVersion) {
    const initialized = entryReferences(value.initialized);
    if (initialized !== null && value.profile !== "framework")
      throw new Error("Initialized game content references require framework profile");
    if (source === null && development === null && initialized === null)
      throw new Error("Game content references require an entry");
    return { kind: "game-content-refs-v2", profile: value.profile, world, source, development, initialized };
  }
  if (source === null && development === null) throw new Error("Game content references require an entry");
  return { kind: "game-content-refs-v1", profile: value.profile, world, source, development };
}
