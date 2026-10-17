import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { contentDigest, verifyContent } from "../src/core/content-integrity.js";
import { parseGameContentReleaseIndex, selectGameContentRelease, resolveGameContentReleaseObject, resolveGameContentReleaseMedia,
  gameContentCheckpointIdentity, type GameContentRelease, type GameContentReleaseIndex } from "../src/core/game-content-release.js";
import type { GameCheckpoint } from "../src/core/game-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const h = (value: string): string => value.repeat(64);
const logical = { world: "/packages/synthetic/world.json", entry: "/packages/synthetic/entry.json",
  battle: "/packages/synthetic/battle.json", map: "/world/maps/2.json" };
function release(id: string, version: "old" | "new" = "old"): GameContentRelease {
  const world = h(version === "old" ? "1" : "4"), entry = h(version === "old" ? "2" : "5"),
    battle = h(version === "old" ? "3" : "6");
  return { id: h(id), sourceSetHash: h("a"), refs: { kind: "game-content-refs-v2", profile: "framework",
    world: { url: logical.world, contentHash: world }, source: null, initialized: null,
    development: { entry: { url: logical.entry, contentHash: entry },
      battle: { url: logical.battle, contentHash: battle } } },
    bindings: { [logical.world]: world, [logical.entry]: entry, [logical.battle]: battle, [logical.map]: h("7") },
    mediaBindings: {} };
}
async function indexFixture(): Promise<GameContentReleaseIndex> {
  const payload = { kind: "game-content-release-index-v1" as const, packageId: "synthetic-systems",
    profile: "framework" as const, currentReleaseId: h("9"), objectRoot: "/content-releases" as const,
    releases: [release("8"), release("9", "new")] };
  return { ...payload, contentHash: await contentDigest(payload) };
}
function savedFor(item: GameContentRelease, lane: "source" | "development" | "initialized" = "development",
  location = true): GameCheckpoint {
  const saved = checkpointFixture().game.checkpoint(), entry = lane === "initialized"
    ? item.refs.kind === "game-content-refs-v2" ? item.refs.initialized : null : item.refs[lane];
  assert.ok(entry);
  saved.sourceSetHash = item.sourceSetHash;
  saved.battleCatalogHash = entry.battle.contentHash;
  saved.world.initialHash = entry.entry.contentHash;
  saved.world.location = location ? { catalogHash: item.refs.world.contentHash, mapId: 2, entrance: 1, traveler: null } : null;
  if (lane === "source") saved.origin = { kind: "source-new-game", sourceContentHash: entry.entry.contentHash };
  else if (lane === "initialized") {
    assert.ok(saved.formatVersion !== 4);
    saved.formatVersion = 6;
    saved.origin = { kind: "framework-new-game", entryContentHash: entry.entry.contentHash };
  } else saved.origin = { kind: "development-checkpoint" };
  return saved;
}

test("a verified host index parses detached across realms without rewriting logical references", async () => {
  const original = await indexFixture(), verified = await verifyContent(original, original.contentHash);
  const parsed = parseGameContentReleaseIndex(verified);
  assert.deepEqual(parsed, original);
  assert.deepEqual(parseGameContentReleaseIndex(runInNewContext("JSON.parse(payload)",
    { payload: JSON.stringify(original) })), original);
  assert.deepEqual(parseGameContentReleaseIndex(Object.assign(Object.create(null), original)), original);
  original.releases[0]!.bindings[logical.map] = h("b");
  original.releases[0]!.refs.world.url = "/changed/world.json";
  assert.equal(parsed.releases[0]!.bindings[logical.map], h("7"));
  assert.equal(parsed.releases[0]!.refs.world.url, logical.world);
});

test("release shape validation rejects incompatible roots, identities, profiles and incomplete reference pins", async () => {
  const base = await indexFixture();
  const invalid: unknown[] = [
    { ...base, kind: "game-content-release-index-v2" }, { ...base, contentHash: h("A") },
    { ...base, objectRoot: "/another-release-root" }, { ...base, objectRoot: "https://host.test/content-releases" },
    { ...base, packageId: "../other" }, { ...base, currentReleaseId: h("f") },
    { ...base, releaseSelector: h("8") }, { ...base, releases: [] },
  ];
  const duplicate = structuredClone(base); duplicate.releases.push(structuredClone(duplicate.releases[0]!)); invalid.push(duplicate);
  const wrongProfile = structuredClone(base); wrongProfile.releases[0]!.refs.profile = "source"; invalid.push(wrongProfile);
  const missing = structuredClone(base); delete missing.releases[0]!.bindings[logical.battle]; invalid.push(missing);
  const conflicting = structuredClone(base); conflicting.releases[0]!.bindings[logical.entry] = h("f"); invalid.push(conflicting);
  const emptySource = structuredClone(base); emptySource.releases[0]!.sourceSetHash = ""; invalid.push(emptySource);
  const badId = structuredClone(base); badId.releases[0]!.id = "old-release"; invalid.push(badId);
  for (const value of invalid) assert.throws(() => parseGameContentReleaseIndex(value), /release|reference|profile|entry/i);
});

test("index and binding accessors never run; sparse, symbolic and inherited data cannot supply releases", async () => {
  const base = await indexFixture(); let reads = 0;
  const accessor = structuredClone(base);
  Object.defineProperty(accessor.releases[0]!.bindings, logical.map, { enumerable: true, get: () => { reads++; return h("7"); } });
  const listAccessor = structuredClone(base);
  Object.defineProperty(listAccessor.releases, "0", { enumerable: true, get: () => { reads++; return base.releases[0]; } });
  const topAccessor = structuredClone(base);
  Object.defineProperty(topAccessor, "profile", { enumerable: true, get: () => { reads++; return "framework"; } });
  const sparse = structuredClone(base); delete sparse.releases[0];
  const symbol = Object.assign(structuredClone(base), { [Symbol("release")]: base.releases[0] });
  const inherited = Object.assign(Object.create({ releases: base.releases }), base);
  for (const value of [accessor, listAccessor, topAccessor, sparse, symbol, inherited])
    assert.throws(() => parseGameContentReleaseIndex(value), /release|reference/i);
  assert.equal(reads, 0);
});

test("current and explicit host selection return independent historical snapshots, never shared mutable refs", async () => {
  const index = await indexFixture(), before = structuredClone(index);
  const current = selectGameContentRelease(index, { kind: "current" });
  const historical = selectGameContentRelease(index, { kind: "release", id: h("8") });
  assert.equal(current.release.id, h("9")); assert.equal(historical.release.id, h("8"));
  assert.equal(historical.indexHash, index.contentHash); assert.equal(historical.profile, "framework");
  assert.equal(historical.packageId, index.packageId);
  historical.release.refs.world.contentHash = h("f"); historical.release.bindings[logical.world] = h("f");
  assert.deepEqual(index, before); assert.equal(current.release.refs.world.contentHash, h("4"));
  assert.equal(selectGameContentRelease(index, { kind: "release", id: h("8") }).release.refs.world.contentHash, h("1"));
  assert.throws(() => selectGameContentRelease(index, { kind: "release", id: h("e") }), /Unknown.*identity/);
});

test("checkpoint selection intersects entry, battle, parent source and saved world instead of using current", async () => {
  const index = await indexFixture(), saved = savedFor(index.releases[0]!);
  const baseline = structuredClone(saved);
  assert.equal(selectGameContentRelease(index, { kind: "checkpoint", checkpoint: saved }).release.id, h("8"));
  assert.deepEqual(gameContentCheckpointIdentity(saved), { entryLane: "development",
    sourceSetHash: h("a"), entryContentHash: h("2"), battleCatalogHash: h("3"), worldCatalogHash: h("1") });
  for (const change of ["entry", "battle", "source", "world"] as const) {
    const copy = structuredClone(saved);
    if (change === "entry") copy.world.initialHash = h("e");
    if (change === "battle") copy.battleCatalogHash = h("e");
    if (change === "source") copy.sourceSetHash = h("e");
    if (change === "world") copy.world.location!.catalogHash = h("e");
    assert.throws(() => selectGameContentRelease(index, { kind: "checkpoint", checkpoint: copy }), /Unknown.*identity/, change);
  }
  assert.deepEqual(saved, baseline);
});

test("origin lanes are exact and a framework source-new-game is not reclassified as strict source", async () => {
  const index = await indexFixture(), item = index.releases[0]!;
  assert.ok(item.refs.kind === "game-content-refs-v2");
  const development = structuredClone(item.refs.development)!;
  item.refs.source = development; item.refs.development = null; item.refs.initialized = null;
  const sourceSaved = savedFor(item, "source");
  assert.equal(selectGameContentRelease(index, { kind: "checkpoint", checkpoint: sourceSaved }).profile, "framework");
  const differentLane = structuredClone(sourceSaved); differentLane.origin = { kind: "development-checkpoint" };
  assert.throws(() => selectGameContentRelease(index, { kind: "checkpoint", checkpoint: differentLane }), /Unknown.*identity/);
  item.refs.initialized = structuredClone(development); item.refs.source = null;
  const initialized = savedFor(item, "initialized");
  assert.equal(gameContentCheckpointIdentity(initialized).entryLane, "initialized");
  assert.equal(selectGameContentRelease(index, { kind: "checkpoint", checkpoint: initialized }).release.id, item.id);
  assert.throws(() => selectGameContentRelease(index, { kind: "checkpoint", checkpoint: sourceSaved }), /Unknown.*identity/);
  const strict = structuredClone(index), strictRelease = strict.releases[0]!;
  strict.profile = "source"; strict.currentReleaseId = strictRelease.id; strict.releases = [strictRelease];
  strictRelease.refs = { kind: "game-content-refs-v1", profile: "source",
    world: structuredClone(strictRelease.refs.world), source: development, development: null };
  const strictSaved = savedFor(strictRelease, "source");
  assert.equal(selectGameContentRelease(strict, { kind: "checkpoint", checkpoint: strictSaved }).profile, "source");
  assert.throws(() => selectGameContentRelease(strict, { kind: "checkpoint", checkpoint: initialized }), /Unknown.*identity/);
});

test("missing saved world identity and duplicate complete identities remain ambiguous", async () => {
  const index = await indexFixture(), old = index.releases[0]!;
  const other = structuredClone(old); other.id = h("9");
  other.refs.world.contentHash = h("4"); other.bindings[logical.world] = h("4");
  index.releases = [old, other];
  const saved = savedFor(old, "development", false);
  assert.equal(gameContentCheckpointIdentity(saved).worldCatalogHash, null);
  assert.throws(() => selectGameContentRelease(index, { kind: "checkpoint", checkpoint: saved }), /Ambiguous.*identity/);
  saved.world.location = { catalogHash: old.refs.world.contentHash, mapId: 2, entrance: 1, traveler: null };
  assert.equal(selectGameContentRelease(index, { kind: "checkpoint", checkpoint: saved }).release.id, old.id);
  const duplicateTuple = structuredClone(old); duplicateTuple.id = h("9"); index.releases[1] = duplicateTuple;
  assert.throws(() => selectGameContentRelease(index, { kind: "checkpoint", checkpoint: saved }), /Ambiguous.*identity/);
});

test("checkpoint extraction rejects new selectors and inconsistent versions or origins before any content resolution", async () => {
  const index = await indexFixture(), original = savedFor(index.releases[0]!);
  const withSelector = { ...original, releaseId: index.currentReleaseId };
  const withUrl = { ...original, world: { ...original.world, url: "/another/world.json" } };
  const wrongOrigin = { ...original, origin: { kind: "source-new-game", sourceContentHash: h("e") } };
  const wrongVersion = { ...original, formatVersion: 6 };
  const unrecognized = { ...original, origin: { kind: "custom-game", entryContentHash: h("2") } };
  for (const invalid of [withSelector, withUrl, wrongOrigin, wrongVersion, unrecognized])
    assert.throws(() => gameContentCheckpointIdentity(invalid as GameCheckpoint), /release|checkpoint|origin/i);
  let reads = 0;
  const accessor = structuredClone(original);
  Object.defineProperty(accessor.origin, "kind", { enumerable: true, get: () => { reads++; return "development-checkpoint"; } });
  assert.throws(() => gameContentCheckpointIdentity(accessor), /release.*fields/);
  assert.equal(reads, 0);
  assert.throws(() => selectGameContentRelease(index, { kind: "checkpoint", checkpoint: original,
    id: h("9") } as unknown as Parameters<typeof selectGameContentRelease>[1]), /release.*fields/);
});

test("existing v4 and event identities project without claiming compatibility or accepting an invalid map location", async () => {
  const index = await indexFixture(), original = savedFor(index.releases[0]!);
  assert.ok("walkEncounters" in original);
  const { walkEncounters: _, ...old } = original;
  const v4: GameCheckpoint = { ...old, formatVersion: 4 };
  assert.equal(selectGameContentRelease(index, { kind: "checkpoint", checkpoint: v4 }).release.id, h("8"));
  const event = structuredClone(original); event.world.kind = "event-world-v1";
  assert.equal(gameContentCheckpointIdentity(event).entryContentHash, h("2"));
  for (const mapId of [0, -1, 2.5, 0x80000000]) {
    const invalid = structuredClone(original); invalid.world.location!.mapId = mapId;
    assert.throws(() => gameContentCheckpointIdentity(invalid), /saved map identity/);
  }
  // This helper reads only origin/content identity. Full event/owned validation
  // still belongs to the existing content-dependent restoration transaction.
  event.owned.completedBattles.push({ serial: 999, encounterId: 123, outcome: "victory" });
  assert.equal(gameContentCheckpointIdentity(event).battleCatalogHash, h("3"));
});

test("JSON resolution requires an exact binding and cannot treat a media path or external URL as archived content", async () => {
  const selected = selectGameContentRelease(await indexFixture(), { kind: "release", id: h("8") });
  const resolved = resolveGameContentReleaseObject(selected, logical.map);
  assert.deepEqual(resolved, { url: "/content-releases/objects/" + h("7") + ".json", contentHash: h("7") });
  resolved.contentHash = h("f");
  assert.equal(resolveGameContentReleaseObject(selected, logical.map).contentHash, h("7"));
  for (const invalid of ["/unknown/map.json", "/world/maps/../2.json", "/world/maps/%32.json",
    "//other.test/map.json", "https://other.test/map.json", "/media/map.png", logical.map + "?v=2"])
    assert.throws(() => resolveGameContentReleaseObject(selected, invalid), /JSON URL/);
  const changedRoot = { ...selected, objectRoot: "/another-root" };
  assert.throws(() => resolveGameContentReleaseObject(changedRoot as typeof selected, logical.map), /object root/);
});

test("historical object pins load the unchanged world body and its original map URL after current logical content changes", async () => {
  const mapBody = { kind: "synthetic-map-v1", mapId: 2, marker: "historical" };
  const map = { ...mapBody, contentHash: await contentDigest(mapBody) };
  const worldBody = { kind: "synthetic-world-v1", maps: { "2": { url: logical.map, contentHash: map.contentHash } } };
  const world = { ...worldBody, contentHash: await contentDigest(worldBody) };
  const index = await indexFixture(), old = index.releases[0]!;
  old.refs.world.contentHash = world.contentHash;
  old.bindings[logical.world] = world.contentHash; old.bindings[logical.map] = map.contentHash;
  const selected = selectGameContentRelease(index, { kind: "checkpoint", checkpoint: savedFor(old) });
  const objects = new Map<string, unknown>([
    ["/content-releases/objects/" + world.contentHash + ".json", world],
    ["/content-releases/objects/" + map.contentHash + ".json", map],
  ]);
  const requested: string[] = [];
  async function read<T extends { contentHash: string }>(logicalUrl: string): Promise<T> {
    const pin = resolveGameContentReleaseObject(selected, logicalUrl); requested.push(pin.url);
    return verifyContent(structuredClone(objects.get(pin.url)) as T, pin.contentHash);
  }
  const restoredWorld = await read<typeof world>(logical.world);
  const restoredMap = await read<typeof map>(restoredWorld.maps["2"].url);
  assert.deepEqual(restoredWorld, world); assert.deepEqual(restoredMap, map);
  assert.equal(restoredWorld.maps["2"].url, logical.map);
  assert.deepEqual(requested, [...objects.keys()]);
  objects.set(requested[1]!, { ...map, marker: "tampered" });
  await assert.rejects(read(logical.map), /payload changed/);
});

test("shape parsing is distinct from the host's index integrity check", async () => {
  const index = await indexFixture();
  index.releases[0]!.bindings[logical.map] = h("f");
  assert.equal(parseGameContentReleaseIndex(index).releases[0]!.bindings[logical.map], h("f"));
  await assert.rejects(verifyContent(index), /payload changed/);
});

test("media bindings are explicit own data with canonical matching PNG/FLAC extensions", async () => {
  const base = await indexFixture();
  const good = structuredClone(base);
  good.releases[0]!.mediaBindings = {
    "/imports/textures/tile.png": { sha256: h("b"), extension: "png" },
    "/audio/bgm/map.flac": { sha256: h("c"), extension: "flac" },
  };
  const parsed = parseGameContentReleaseIndex(good);
  good.releases[0]!.mediaBindings["/imports/textures/tile.png"]!.sha256 = h("d");
  assert.equal(parsed.releases[0]!.mediaBindings["/imports/textures/tile.png"]!.sha256, h("b"));
  const noMedia = structuredClone(base) as unknown as { releases: Record<string, unknown>[] };
  delete noMedia.releases[0]!.mediaBindings;
  assert.throws(() => parseGameContentReleaseIndex(noMedia), /release.*fields/);
  for (const [key, binding] of [
    ["/audio/file.flac", { sha256: h("b"), extension: "png" }],
    ["/audio/file.mp3", { sha256: h("b"), extension: "flac" }],
    ["/audio/file.flac?v=1", { sha256: h("b"), extension: "flac" }],
    ["/audio/../file.flac", { sha256: h("b"), extension: "flac" }],
    ["https://other.test/file.png", { sha256: h("b"), extension: "png" }],
    ["/image/file.png", { sha256: h("B"), extension: "png" }],
  ] as const) {
    const bad = structuredClone(base);
    bad.releases[0]!.mediaBindings = { [key]: binding } as typeof bad.releases[0]["mediaBindings"];
    assert.throws(() => parseGameContentReleaseIndex(bad), /release.*(URL|hash)/);
  }
  let reads = 0;
  const accessor = structuredClone(base);
  Object.defineProperty(accessor.releases[0]!.mediaBindings, "/image/file.png",
    { enumerable: true, get: () => { reads++; return { sha256: h("b"), extension: "png" }; } });
  assert.throws(() => parseGameContentReleaseIndex(accessor), /release.*fields/);
  assert.equal(reads, 0);
});

test("historical media resolves by file SHA and cannot fall back to the current release or an undeclared file", async () => {
  const index = await indexFixture(), png = "/imports/textures/tile.png", flac = "/audio/bgm/map.flac";
  index.releases[0]!.mediaBindings = { [png]: { sha256: h("b"), extension: "png" },
    [flac]: { sha256: h("c"), extension: "flac" } };
  index.releases[1]!.mediaBindings = { [png]: { sha256: h("d"), extension: "png" } };
  const old = selectGameContentRelease(index, { kind: "checkpoint", checkpoint: savedFor(index.releases[0]!) });
  const current = selectGameContentRelease(index, { kind: "current" });
  assert.deepEqual(resolveGameContentReleaseMedia(old, png),
    { url: "/content-releases/media/" + h("b") + ".png", sha256: h("b"), extension: "png" });
  assert.equal(resolveGameContentReleaseMedia(old, flac).url, "/content-releases/media/" + h("c") + ".flac");
  assert.equal(resolveGameContentReleaseMedia(current, png).sha256, h("d"));
  assert.throws(() => resolveGameContentReleaseMedia(current, flac), /Unbound.*media URL/);
  assert.throws(() => resolveGameContentReleaseObject(old, png), /JSON URL/);
  assert.throws(() => resolveGameContentReleaseMedia(old, logical.map), /media URL/);
  const ref = resolveGameContentReleaseMedia(old, png); ref.sha256 = h("f");
  assert.equal(resolveGameContentReleaseMedia(old, png).sha256, h("b"));
  index.releases[0]!.mediaBindings[png]!.sha256 = h("e");
  assert.equal(resolveGameContentReleaseMedia(old, png).sha256, h("b"));
  Object.defineProperty(old.release.mediaBindings, flac, { enumerable: true, get: () => { throw new Error("must not read"); } });
  assert.throws(() => resolveGameContentReleaseMedia(old, flac), /binding fields/);
});
