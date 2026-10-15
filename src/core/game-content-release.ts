import { parseGameContentRefs, type GameContentProfile, type GameContentRef,
  type GameContentRefs } from "./game-content-refs.js";
import type { GameCheckpoint } from "./game-session.js";

export type GameContentRelease = {
  id: string;
  /** The checkpoint's parent source-set identity, not its selected map identity. */
  sourceSetHash: string;
  refs: GameContentRefs;
  /** Original JSON URLs remain in historical payloads. The host binds each
   * request to an immutable JSON object without rewriting those payloads. */
  bindings: Record<string, string>;
  /** Only runtime PNG/FLAC URLs, separate from provenance files and JSON. */
  mediaBindings: Record<string, GameContentReleaseMediaBinding>;
};
export type GameContentReleaseMediaBinding = { sha256: string; extension: "png" | "flac" };
export type GameContentReleaseMediaRef = GameContentReleaseMediaBinding & { url: string };
export type GameContentReleaseIndex = {
  kind: "game-content-release-index-v1";
  contentHash: string;
  packageId: string;
  profile: GameContentProfile;
  currentReleaseId: string;
  objectRoot: "/content-releases";
  releases: GameContentRelease[];
};
export type GameContentReleaseSelection =
  | { kind: "current" }
  /** Only a trusted host supplies this selector. Saves cannot supply a release ID. */
  | { kind: "release"; id: string }
  | { kind: "checkpoint"; checkpoint: GameCheckpoint };
export type SelectedGameContentRelease = {
  kind: "selected-game-content-release-v1";
  indexHash: string;
  packageId: string;
  profile: GameContentProfile;
  objectRoot: "/content-releases";
  release: GameContentRelease;
};

const jsonUrl = /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const mediaUrl = /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|flac)$/;
const digest = /^[a-f0-9]{64}$/;

function plainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  if (typeof prototype !== "object" || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (!constructor || !("value" in constructor) || typeof constructor.value !== "function") return false;
  const binding = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
  return binding?.value === prototype &&
    Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object);
}
function record(raw: unknown, expected?: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !plainObject(raw))
    throw new Error("Invalid game content release object");
  const keys = Reflect.ownKeys(raw);
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(raw);
  if (keys.some(key => typeof key !== "string") ||
      Object.values(descriptors).some(value => !("value" in value) || !value.enumerable) ||
      (expected && (keys.length !== expected.length ||
        Object.keys(descriptors).sort().join(",") !== [...expected].sort().join(","))))
    throw new Error("Invalid game content release fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.value]));
}
function list(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("Invalid game content release list");
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(raw);
  const length = descriptors.length?.value as unknown;
  if (!Number.isSafeInteger(length) || typeof length !== "number" || length < 1 ||
      Reflect.ownKeys(raw).length !== length + 1)
    throw new Error("Invalid game content release list");
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const value = descriptors[String(index)];
    if (!value || !("value" in value) || !value.enumerable)
      throw new Error("Invalid game content release list");
    values.push(value.value);
  }
  return values;
}
function hash(raw: unknown): string {
  if (typeof raw !== "string" || !digest.test(raw)) throw new Error("Invalid game content release hash");
  return raw;
}
function sourceIdentity(raw: unknown): string {
  // Existing checkpoint source identities are nonempty strings; do not change
  // their format while selecting an exact historical content package.
  if (typeof raw !== "string" || !raw.length) throw new Error("Invalid game content release source identity");
  return raw;
}
function profile(raw: unknown): GameContentProfile {
  if (raw !== "source" && raw !== "framework") throw new Error("Invalid game content release profile");
  return raw;
}
function packageId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw))
    throw new Error("Invalid game content release package identity");
  return raw;
}
function objectRoot(raw: unknown): "/content-releases" {
  if (raw !== "/content-releases") throw new Error("Invalid game content release object root");
  return raw;
}
function url(raw: unknown): string {
  if (typeof raw !== "string" || !jsonUrl.test(raw)) throw new Error("Invalid game content release JSON URL");
  return raw;
}
function mediaBinding(logicalUrl: string, raw: unknown): GameContentReleaseMediaBinding {
  const match = mediaUrl.exec(logicalUrl);
  const value = record(raw, ["sha256", "extension"]);
  if (!match || (value.extension !== "png" && value.extension !== "flac") || value.extension !== match[1])
    throw new Error("Invalid game content release media URL/extension");
  return { sha256: hash(value.sha256), extension: value.extension };
}
function entryReferences(refs: GameContentRefs): GameContentRef[] {
  return [refs.world, ...[refs.source, refs.development,
    refs.kind === "game-content-refs-v2" ? refs.initialized : null]
    .flatMap(entry => entry ? [entry.entry, entry.battle] : [])];
}
function release(raw: unknown, expectedProfile: GameContentProfile): GameContentRelease {
  const value = record(raw, ["id", "sourceSetHash", "refs", "bindings", "mediaBindings"]);
  const refs = parseGameContentRefs(value.refs);
  if (refs.profile !== expectedProfile) throw new Error("Game content release profile mismatch");
  const bindings = Object.fromEntries(Object.entries(record(value.bindings)).map(([key, identity]) => [url(key), hash(identity)]));
  const mediaBindings = Object.fromEntries(Object.entries(record(value.mediaBindings))
    .map(([key, binding]) => [key, mediaBinding(key, binding)]));
  for (const reference of entryReferences(refs))
    if (!Object.hasOwn(bindings, reference.url) || bindings[reference.url] !== reference.contentHash)
      throw new Error("Game content release reference binding mismatch");
  return { id: hash(value.id), sourceSetHash: sourceIdentity(value.sourceSetHash), refs, bindings, mediaBindings };
}

/** Shape validation is not authentication or content verification. The host
 * verifies and selects the index before handing its detached data to this API.
 * Declared media pins do not prove files exist or that the closure is complete. */
export function parseGameContentReleaseIndex(raw: unknown): GameContentReleaseIndex {
  const value = record(raw, ["kind", "contentHash", "packageId", "profile", "currentReleaseId", "objectRoot", "releases"]);
  if (value.kind !== "game-content-release-index-v1") throw new Error("Unknown game content release index kind");
  const expectedProfile = profile(value.profile);
  const releases = list(value.releases).map(item => release(item, expectedProfile));
  if (new Set(releases.map(item => item.id)).size !== releases.length)
    throw new Error("Duplicate game content release identity");
  const currentReleaseId = hash(value.currentReleaseId);
  if (!releases.some(item => item.id === currentReleaseId)) throw new Error("Unknown current game content release");
  return { kind: value.kind, contentHash: hash(value.contentHash), packageId: packageId(value.packageId),
    profile: expectedProfile, currentReleaseId, objectRoot: objectRoot(value.objectRoot), releases };
}

export type GameContentCheckpointIdentity = {
  entryLane: "source" | "development" | "initialized";
  sourceSetHash: string;
  entryContentHash: string;
  battleCatalogHash: string;
  worldCatalogHash: string | null;
};
/** Extract identity without treating a successful projection as owned/runtime
 * checkpoint validation. Current-content preflight and history use one gate. */
export function gameContentCheckpointIdentity(checkpoint: GameCheckpoint): GameContentCheckpointIdentity {
  const raw: unknown = checkpoint;
  const preliminary = record(raw);
  if (preliminary.kind !== "game-checkpoint" ||
      (preliminary.formatVersion !== 4 && preliminary.formatVersion !== 5 && preliminary.formatVersion !== 6))
    throw new Error("Unsupported game content release checkpoint");
  const saved = record(raw, ["kind", "formatVersion", "sourceSetHash", "battleCatalogHash", "origin",
    "seed", "encounterSerial", "remainder", "battlePreferences", "owned", "world",
    ...(preliminary.formatVersion === 4 ? [] : ["walkEncounters"])]);
  const worldKind = record(saved.world).kind;
  const logical = worldKind === "idle-world-v11" || worldKind === "event-world-v2";
  const world = record(saved.world, ["kind", "initialHash", "location", "field", ...(logical ? ["logicalEffects"] : [])]);
  if (!["idle-world-v10", "event-world-v1", "idle-world-v11", "event-world-v2"].includes(String(world.kind)))
    throw new Error("Unsupported game content release world checkpoint");
  if (logical) {
    // Identity selection is only a preflight. The trusted entry/catalog and
    // WorldSession still validate the full logical owner state before restore.
    const effects = record(world.logicalEffects, ["kind", "catalogHash", "scope", "nextScope", "state"]);
    if (effects.kind !== "web-logical-field-effects-checkpoint-v1" ||
        typeof effects.scope !== "string" || !/^(?:0|[1-9]\d*)$/.test(effects.scope) ||
        typeof effects.nextScope !== "number" || !Number.isSafeInteger(effects.nextScope) || effects.nextScope < 1)
      throw new Error("Invalid game content release logical effect checkpoint");
    hash(effects.catalogHash);
  }
  const entryHash = hash(world.initialHash), origin = record(saved.origin);
  let lane: GameContentCheckpointIdentity["entryLane"];
  if (origin.kind === "framework-new-game") {
    const value = record(saved.origin, ["kind", "entryContentHash"]);
    if (saved.formatVersion !== 6 || hash(value.entryContentHash) !== entryHash)
      throw new Error("Game content release checkpoint origin mismatch");
    lane = "initialized";
  } else if (origin.kind === "source-new-game") {
    const value = record(saved.origin, ["kind", "sourceContentHash"]);
    if (saved.formatVersion === 6 || hash(value.sourceContentHash) !== entryHash)
      throw new Error("Game content release checkpoint origin mismatch");
    lane = "source";
  } else if (origin.kind === "development-checkpoint") {
    record(saved.origin, ["kind"]);
    if (saved.formatVersion === 6) throw new Error("Game content release checkpoint origin mismatch");
    lane = "development";
  } else {
    throw new Error("Unknown game content release checkpoint origin");
  }
  let worldHash: string | null = null;
  if (world.location !== null) {
    const location = record(world.location, ["catalogHash", "mapId", "entrance", "traveler"]);
    if (typeof location.mapId !== "number" || !Number.isInteger(location.mapId) ||
        location.mapId < 1 || location.mapId > 0x7fffffff ||
        typeof location.entrance !== "number" || !Number.isInteger(location.entrance) ||
        location.entrance < 0 || location.entrance > 0x7fffffff)
      throw new Error("Invalid game content release saved map identity");
    worldHash = hash(location.catalogHash);
  }
  return { entryLane: lane, sourceSetHash: sourceIdentity(saved.sourceSetHash), entryContentHash: entryHash,
    battleCatalogHash: hash(saved.battleCatalogHash), worldCatalogHash: worldHash };
}

/** Select only from the host's verified index. A checkpoint contributes an
 * identity tuple, never a release selector, profile or fetch URL. Full owned,
 * map and runtime validation still belongs to Repository and GameSession. */
export function selectGameContentRelease(index: GameContentReleaseIndex,
  selection: GameContentReleaseSelection): SelectedGameContentRelease {
  const trusted = parseGameContentReleaseIndex(index), request = record(selection);
  let matches: GameContentRelease[];
  if (request.kind === "current") {
    record(selection, ["kind"]);
    matches = trusted.releases.filter(item => item.id === trusted.currentReleaseId);
  } else if (request.kind === "release") {
    const value = record(selection, ["kind", "id"]), id = hash(value.id);
    matches = trusted.releases.filter(item => item.id === id);
  } else if (request.kind === "checkpoint") {
    const value = record(selection, ["kind", "checkpoint"]);
    const saved = gameContentCheckpointIdentity(value.checkpoint as GameCheckpoint);
    matches = trusted.releases.filter(item => {
      const refs = saved.entryLane === "initialized"
        ? item.refs.kind === "game-content-refs-v2" ? item.refs.initialized : null
        : item.refs[saved.entryLane];
      return refs !== null && item.sourceSetHash === saved.sourceSetHash &&
        refs.entry.contentHash === saved.entryContentHash && refs.battle.contentHash === saved.battleCatalogHash &&
        (saved.worldCatalogHash === null || item.refs.world.contentHash === saved.worldCatalogHash);
    });
  } else {
    throw new Error("Unknown game content release selection");
  }
  if (!matches.length) throw new Error("Unknown game content release identity");
  if (matches.length !== 1) throw new Error("Ambiguous game content release identity");
  return { kind: "selected-game-content-release-v1", indexHash: trusted.contentHash,
    packageId: trusted.packageId, profile: trusted.profile, objectRoot: trusted.objectRoot, release: matches[0]! };
}

/** Resolve only an explicitly bound logical JSON URL. The returned pin must be
 * verified by the host reader; this API does not load or rewrite an object. */
export function resolveGameContentReleaseObject(selected: SelectedGameContentRelease,
  logicalUrl: string): GameContentRef {
  const { root, content } = selectedMetadata(selected), logical = url(logicalUrl);
  const contentHash = hash(boundValue(content.bindings, logical, "JSON"));
  return { url: root + "/objects/" + contentHash + ".json", contentHash };
}

/** The selected index was fully parsed once. Recheck the fixed metadata and
 * requested own binding without rescanning every map/media on each read. */
function selectedMetadata(selected: SelectedGameContentRelease): {
  root: "/content-releases"; content: Record<string, unknown>;
} {
  const value = record(selected, ["kind", "indexHash", "packageId", "profile", "objectRoot", "release"]);
  if (value.kind !== "selected-game-content-release-v1") throw new Error("Unknown selected game content release kind");
  hash(value.indexHash); packageId(value.packageId);
  const content = record(value.release, ["id", "sourceSetHash", "refs", "bindings", "mediaBindings"]);
  hash(content.id); sourceIdentity(content.sourceSetHash);
  const refs = parseGameContentRefs(content.refs);
  if (refs.profile !== profile(value.profile)) throw new Error("Game content release profile mismatch");
  for (const reference of entryReferences(refs))
    if (hash(boundValue(content.bindings, reference.url, "JSON")) !== reference.contentHash)
      throw new Error("Game content release reference binding mismatch");
  return { root: objectRoot(value.objectRoot), content };
}
function boundValue(raw: unknown, logicalUrl: string, kind: "JSON" | "media"): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !plainObject(raw))
    throw new Error("Invalid game content release binding object");
  const value = Object.getOwnPropertyDescriptor(raw, logicalUrl);
  if (!value) throw new Error("Unbound game content release " + kind + " URL: " + logicalUrl);
  if (!("value" in value) || !value.enumerable) throw new Error("Invalid game content release binding fields");
  return value.value;
}

/** File SHA-256 is independent of JSON contentHash. Media bytes are verified
 * by the host before presentation; an absent pin cannot use a current asset. */
export function resolveGameContentReleaseMedia(selected: SelectedGameContentRelease,
  logicalUrl: string): GameContentReleaseMediaRef {
  const { root, content } = selectedMetadata(selected);
  if (typeof logicalUrl !== "string" || !mediaUrl.test(logicalUrl))
    throw new Error("Invalid game content release media URL");
  const binding = mediaBinding(logicalUrl, boundValue(content.mediaBindings, logicalUrl, "media"));
  return { url: root + "/media/" + binding.sha256 + "." + binding.extension, ...binding };
}
