import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { contentDigest, verifyContent } from "../src/core/content-integrity.js";
import { canonical } from "../src/core/canonical.js";
import { logicalEffectCatalog } from "./fixtures/logical-field-effects.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

const root = process.cwd(), compiledDir = fileURLToPath(new URL("../", import.meta.url));
const script = pathToFileURL(resolve(root, "scripts/source-recipe-inputs.mjs")).href;
const markers = { storyRuntime: "web-field-story-runtime-v1", autoSave: "web-field-autosave-barrier-v1" };
const declaration = () => ({ kind: "compiled-framework-profile-upgrade-v1", compilerDigest: "c".repeat(64), markers: { ...markers } });
type Document = Record<string, any> & { contentHash: string };
type Result = { recipe: Record<string, any>; report: { frameworkProfileUpgrades: Record<string, any>[]; changes: unknown[] } };
async function seal(value: Document): Promise<Document> {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) };
}
const profile = (sourceContentHash: string) => ({ kind: "framework-development-v1",
  policy: "omit-anonymous-environment-particles-v1", sourceContentHash, omissions: [] });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
async function fixture() {
  const source = sourceNewGameFixture(), strictMap = await seal(source.map);
  const mapURL = "/framework/world/maps/" + strictMap.mapId + ".json";
  const oldMap = await seal({ ...strictMap, developmentProfile: profile(strictMap.contentHash) });
  const oldWorld = await seal({ ...source.world, developmentProfile: profile("a".repeat(64)), maps: {
    [oldMap.mapId]: { ...source.world.maps[oldMap.mapId], url: mapURL, contentHash: oldMap.contentHash } } });
  const battle = await seal(source.battle);
  const oldEntry = await seal({ ...source.content, developmentProfile: profile("b".repeat(64)),
    mapContentHash: oldMap.contentHash, worldCatalogHash: oldWorld.contentHash, battleCatalogHash: battle.contentHash });
  const newMap = await seal({ ...oldMap, developmentProfile: { ...oldMap.developmentProfile, ...markers } });
  const newWorld = await seal({ ...oldWorld, developmentProfile: { ...oldWorld.developmentProfile, ...markers },
    maps: { [newMap.mapId]: { ...oldWorld.maps[newMap.mapId], contentHash: newMap.contentHash } } });
  const newEntry = await seal({ ...oldEntry, developmentProfile: { ...oldEntry.developmentProfile, ...markers },
    mapContentHash: newMap.contentHash, worldCatalogHash: newWorld.contentHash });
  const urls = { sourceEntry: "/framework/new-game.json", sourceWorld: "/framework/world/catalog.json", sourceMap: mapURL };
  const current = new Map<string, Document>([[urls.sourceEntry, oldEntry], [urls.sourceWorld, oldWorld], [mapURL, oldMap]]);
  const candidate = new Map<string, Document>([[urls.sourceEntry, newEntry], [urls.sourceWorld, newWorld], [mapURL, newMap]]);
  const recipe = { kind: "controlled-framework-recipe-v1", id: "controlled-profile-upgrade", ...Object.fromEntries(
    Object.entries(urls).map(([role, url]) => [role, { url, contentHash: current.get(url)!.contentHash }])),
    authorData: { originalMapHash: oldMap.contentHash, reason: "Do not update authored recipe bytes" } };
  const run = async (options: Record<string, unknown> = {}): Promise<Result> => (await import(script)).resolveSourceRecipeInputs({
    recipePath: "controlled-profile-upgrade.recipe.json", recipeBytes: encode(recipe), compiledDir,
    readCurrentJson: async (url: string) => current.get(url), readCandidateJson: async (url: string) => candidate.get(url),
    ...options });
  return { current, candidate, recipe, run, urls, oldMap, newMap, oldWorld, newWorld, oldEntry, newEntry };
}

test("one explicit versioned declaration upgrades the complete framework dependency cohort and audits full identities", async () => {
  const f = await fixture(), proof = declaration();
  const before = canonical({ recipe: f.recipe, current: [...f.current], candidate: [...f.candidate], proof });
  await assert.rejects(f.run(), /Source identity\/profile\/media changed/,
    "Existing pinned recipes do not acquire new hosts without a trusted declaration");
  const result = await f.run({ frameworkProfileUpgrade: proof });
  assert.equal(result.report.frameworkProfileUpgrades.length, 3); assert.equal(result.report.changes.length, 3);
  for (const [role, url] of Object.entries(f.urls)) {
    assert.equal(result.recipe[role].url, url); assert.equal(result.recipe[role].contentHash, f.candidate.get(url)!.contentHash);
    const audit = result.report.frameworkProfileUpgrades.find(row => row.role === role)!;
    assert.equal(audit.kind, proof.kind); assert.equal(audit.compilerDigest, proof.compilerDigest);
    assert.equal(audit.oldHash, f.current.get(url)!.contentHash); assert.equal(audit.newHash, f.candidate.get(url)!.contentHash);
    assert.deepEqual(audit.profileBefore, f.current.get(url)!.developmentProfile);
    assert.deepEqual(audit.profileAfter, f.candidate.get(url)!.developmentProfile);
    assert.deepEqual(audit.addedMarkers.map((row: any) => [row.key, row.previous, row.next]), [
      ["storyRuntime", null, markers.storyRuntime], ["autoSave", null, markers.autoSave] ]);
    assert.deepEqual(audit.comparisonIdentityBefore, audit.comparisonIdentityAfter);
    for (const field of ["sourceSetHash", "parentSourceSetHash", "mediaSourceSetHash", "mapId", "areaId", "mapIdentity", "mapSource",
      "physicalSourceCount", "physicalSourceHash", "mediaCount", "mediaBindingsHash"])
      assert.deepEqual(audit.sourceIdentityBefore[field], audit.sourceIdentityAfter[field], "Whole identity retains " + field);
    assert.equal(audit.providers.length, 2); assert.ok(audit.providers.every((provider: any) => /^[a-f0-9]{64}$/.test(provider.sha256)));
    assert.equal(audit.grantsSourceAdmission, false); assert.equal(audit.saveMigration, false);
  }
  assert.deepEqual(result.recipe.authorData, f.recipe.authorData);
  result.report.frameworkProfileUpgrades[0]!.profileAfter.storyRuntime = "mutated-return";
  result.recipe.sourceMap.contentHash = "d".repeat(64);
  assert.equal(canonical({ recipe: f.recipe, current: [...f.current], candidate: [...f.candidate], proof }), before);
  for (const document of f.candidate.values()) await verifyContent(document);
});

test("missing, unavailable, unknown, non-data or ambiguous declaration markers never authorize upgrade", async () => {
  const f = await fixture(), malformed = [null, {}, { ...declaration(), kind: "framework-profile-upgrade-v2" },
    { ...declaration(), compilerDigest: "missing" }, { ...declaration(), grantSourceAdmission: true },
    { ...declaration(), markers: { storyRuntime: markers.storyRuntime } },
    { ...declaration(), markers: { ...markers, unknownHost: "available" } },
    { ...declaration(), markers: { ...markers, autoSave: "unavailable" } },
    Object.defineProperty(declaration(), "compilerDigest", { enumerable: true, get() { throw new Error("Getter must not run"); } }) ];
  for (const frameworkProfileUpgrade of malformed)
    await assert.rejects(f.run({ frameworkProfileUpgrade }), /framework profile upgrade/);
});

test("a self-declared marker cannot borrow an unavailable compiled provider", async () => {
  const f = await fixture(); await mkdir(resolve(root, "build/wip"), { recursive: true });
  const isolated = await mkdtemp(resolve(root, "build/wip/profile-upgrade-unavailable-"));
  try {
    await cp(resolve(compiledDir, "src"), resolve(isolated, "src"), { recursive: true });
    await writeFile(resolve(isolated, "src/core/field-auto-save.js"),
      'export const WEB_AUTO_SAVE_POLICY = "unavailable"; export function assertFieldEventSaveAdmission() {}\n');
    await assert.rejects(f.run({ compiledDir: isolated, frameworkProfileUpgrade: declaration() }), /host unavailable: autoSave/);
  } finally { await rm(isolated, { recursive: true, force: true }); }
});

test("additive proof cannot remove, change, fabricate or relocate an existing marker/profile", async () => {
  for (const change of ["remove", "unknown", "change-existing", "new-profile", "remove-profile"] as const) {
    const f = await fixture(), old = structuredClone(f.oldMap), next = structuredClone(f.newMap);
    if (change === "remove") { old.developmentProfile.storyRuntime = markers.storyRuntime; delete next.developmentProfile.storyRuntime; }
    if (change === "unknown") next.developmentProfile.storyRuntime = "guessed-story-runtime-v1";
    if (change === "change-existing") old.developmentProfile.storyRuntime = "old-but-unknown-host";
    if (change === "new-profile") delete old.developmentProfile;
    if (change === "remove-profile") delete next.developmentProfile;
    f.current.set(f.urls.sourceMap, await seal(old));
    (f.recipe as any).sourceMap.contentHash = f.current.get(f.urls.sourceMap)!.contentHash;
    f.candidate.set(f.urls.sourceMap, await seal(next));
    await assert.rejects(f.run({ frameworkProfileUpgrade: declaration() }), /profile upgrade|development profile mismatch|identity\/profile\/media changed/);
  }
});

test("upgrade never normalizes unrelated profile, source, physical map, evidence, media or index differences", async () => {
  const changes = [
    (map: Document) => { map.developmentProfile.transportation = "walking-magitek-framework-v1"; },
    (map: Document) => { map.developmentProfile.extraHost = "silently-added"; },
    (map: Document) => { map.developmentProfile.omissions = [{ kind: "invented" }]; },
    (map: Document) => { map.sourceSetHash = "foreign-corpus"; },
    (map: Document) => { map.parentSourceSetHash = "foreign-parent"; },
    (map: Document) => { map.mediaSourceSetHash = "foreign-media"; },
    (map: Document) => { map.map.identity.areaId++; map.areaId++; },
    (map: Document) => { map.map.source.objectId = "9007199254740999"; },
    (map: Document) => { map.map.groups.entity_default.source.objectId = "9007199254740999"; },
    (map: Document) => { map.map.textures.extra = "/world-media/extra.png"; },
    (map: Document) => { map.cameraHost.sources[0].sha256 = "f".repeat(64); },
  ];
  for (const change of changes) {
    const f = await fixture(), map = structuredClone(f.newMap); change(map);
    f.candidate.set(f.urls.sourceMap, await seal(map));
    const before = canonical([...f.candidate]);
    await assert.rejects(f.run({ frameworkProfileUpgrade: declaration() }), /identity\/profile\/media changed|[Oo]mission|identity mismatch/);
    assert.equal(canonical([...f.candidate]), before);
  }
  const f = await fixture(), world = structuredClone(f.newWorld); world.maps[9999] = { ...world.maps[f.newMap.mapId] };
  f.candidate.set(f.urls.sourceWorld, await seal(world));
  await assert.rejects(f.run({ frameworkProfileUpgrade: declaration() }), /World map physical index changed/);
});

test("upgrade cannot override pinned hashes, payload validation, source entry semantics or declared sibling bindings", async () => {
  for (const change of ["pin", "unsealed", "entry", "sibling"] as const) {
    const f = await fixture();
    if (change === "pin") (f.recipe as any).sourceMap.contentHash = "d".repeat(64);
    if (change === "unsealed") f.candidate.get(f.urls.sourceMap)!.name = "late unsealed mutation";
    if (change === "entry") f.candidate.set(f.urls.sourceEntry, await seal({ ...f.newEntry,
      entry: { ...f.newEntry.entry, entrance: f.newEntry.entry.entrance + 1 } }));
    if (change === "sibling") f.candidate.set(f.urls.sourceEntry, await seal({ ...f.newEntry, worldCatalogHash: f.oldWorld.contentHash }));
    await assert.rejects(f.run({ frameworkProfileUpgrade: declaration() }), /identity mismatch|payload changed|initialization semantics changed|Entry\/world dependency mismatch/);
  }
});

test("already upgraded inputs are no-op audited and never downgraded to old runtime markers", async () => {
  const f = await fixture();
  for (const [role, url] of Object.entries(f.urls)) {
    f.current.set(url, structuredClone(f.candidate.get(url)!));
    (f.recipe as any)[role].contentHash = f.current.get(url)!.contentHash;
  }
  const result = await f.run({ frameworkProfileUpgrade: declaration() });
  assert.deepEqual(result.report.frameworkProfileUpgrades, []); assert.deepEqual(result.report.changes, []);
  assert.equal(result.recipe.sourceMap.contentHash, f.newMap.contentHash);
});


test("logical profile v2 audits the exact shared catalog addition while preserving every other source identity", async () => {
  const f = await fixture(), effects = logicalEffectCatalog(f.newMap.sourceSetHash,f.newMap.parentSourceSetHash).catalog;
  const logical = "web-logical-all-loop-field-effects-v1";
  const map = await seal({...f.newMap,fieldEffects:effects,developmentProfile:{...f.newMap.developmentProfile,logicalFieldEffects:logical}});
  const world = await seal({...f.newWorld,developmentProfile:{...f.newWorld.developmentProfile,logicalFieldEffects:logical},
    maps:{[map.mapId]:{...f.newWorld.maps[map.mapId],contentHash:map.contentHash}}});
  const entry = await seal({...f.newEntry,developmentProfile:{...f.newEntry.developmentProfile,logicalFieldEffects:logical},
    mapContentHash:map.contentHash,worldCatalogHash:world.contentHash});
  f.candidate.set(f.urls.sourceMap,map);f.candidate.set(f.urls.sourceWorld,world);f.candidate.set(f.urls.sourceEntry,entry);
  const proof = {...declaration(),kind:"compiled-framework-profile-upgrade-v2",markers:{...markers,logicalFieldEffects:logical},logicalFieldEffects:effects};
  await assert.rejects(f.run({frameworkProfileUpgrade:declaration()}),/identity\/profile\/media changed/);
  const output = await f.run({frameworkProfileUpgrade:proof}), audit = output.report.frameworkProfileUpgrades.find(row => row.role === "sourceMap")!;
  assert.equal(audit.providers.length,3);assert.equal(audit.logicalFieldEffects.catalogHash,effects.webPolicy!.catalogHash);
  assert.deepEqual(audit.logicalFieldEffects.candidateCatalog,effects);
  assert.deepEqual(audit.comparisonIdentityBefore,audit.comparisonIdentityAfter);
  assert.notEqual(audit.sourceIdentityBefore.physicalSourceHash,audit.sourceIdentityAfter.physicalSourceHash,
    "New catalog evidence is audited honestly rather than described as unchanged physical evidence");
  assert.equal(output.recipe.sourceMap.contentHash,map.contentHash);
  for(const mutate of [
    (x:Document) => { x.map.source.objectId = "456"; },
    (x:Document) => { x.map.textures.extra = "/world-media/extra.png"; },
    (x:Document) => { x.fieldEffects.media.controlled_effect.orthographicSize++; },
    (x:Document) => { x.developmentProfile.transportation = "walking-magitek-framework-v1"; },
  ]) { const bad = structuredClone(map);mutate(bad);f.candidate.set(f.urls.sourceMap,await seal(bad));
    await assert.rejects(f.run({frameworkProfileUpgrade:proof}),/identity\/profile\/media changed|same compiled logical catalog/); }
});

const periodicMarkers = { worldMap: "framework-world-map-flat-v1", fieldPresentation: "framework-ordinary-field-flat-v1" };
async function periodicFixture(logical = false) {
  const f = await fixture(), effects = logical ? logicalEffectCatalog(f.newMap.sourceSetHash, f.newMap.parentSourceSetHash).catalog : undefined;
  const added = { ...periodicMarkers, ...(effects ? { logicalFieldEffects: "web-logical-all-loop-field-effects-v1" } : {}) };
  const map = await seal({ ...f.newMap, ...(effects ? { fieldEffects: effects } : {}), developmentProfile: { ...f.newMap.developmentProfile, ...added } });
  const world = await seal({ ...f.newWorld, developmentProfile: { ...f.newWorld.developmentProfile, ...added },
    maps: { [map.mapId]: { ...f.newWorld.maps[map.mapId], contentHash: map.contentHash } } });
  const entry = await seal({ ...f.newEntry, developmentProfile: { ...f.newEntry.developmentProfile, ...added },
    worldCatalogHash: world.contentHash, mapContentHash: map.contentHash });
  f.candidate.set(f.urls.sourceMap, map); f.candidate.set(f.urls.sourceWorld, world); f.candidate.set(f.urls.sourceEntry, entry);
  const proof = { ...declaration(), kind: "compiled-framework-profile-upgrade-v3", markers: { ...markers, ...added },
    ...(effects ? { logicalFieldEffects: effects } : {}) };
  return { ...f, proof, map, world, entry };
}
test("profile v3 audits exact periodic markers with and without the existing logical catalog upgrade", async () => {
  for (const logical of [false, true]) {
    const f = await periodicFixture(logical), before = canonical([...f.candidate]);
    await assert.rejects(f.run({ frameworkProfileUpgrade: declaration() }), /Source identity\/profile\/media changed/);
    const result = await f.run({ frameworkProfileUpgrade: f.proof });
    assert.equal(result.report.frameworkProfileUpgrades.length, 3);
    for (const audit of result.report.frameworkProfileUpgrades) {
      assert.equal(audit.kind, "compiled-framework-profile-upgrade-v3");
      assert.equal(audit.providers.length, logical ? 5 : 4);
      assert.deepEqual(audit.comparisonIdentityBefore, audit.comparisonIdentityAfter);
      assert.deepEqual(audit.profileAfter, f.candidate.get(audit.url)!.developmentProfile);
    }
    assert.equal(canonical([...f.candidate]), before);
  }
});
test("v3 cannot normalize geometry, topology, media, source, unknown profiles or existing marker changes", async () => {
  for (const mutate of [
    (map: Document) => { map.map.width++; },
    (map: Document) => { map.map.topology = { range: { x: 0, y: 0, width: 1, height: 1 }, loop: { horizontal: true, vertical: true } }; },
    (map: Document) => { map.map.textures.extra = "/world-media/new.png"; },
    (map: Document) => { map.map.source.objectId = "9007199254740999"; },
    (map: Document) => { map.developmentProfile.newHost = "unknown"; },
    (map: Document) => { map.developmentProfile.worldMap = "unknown"; },
  ]) { const f = await periodicFixture(), bad = structuredClone(f.map); mutate(bad);
    f.candidate.set(f.urls.sourceMap, await seal(bad));
    await assert.rejects(f.run({ frameworkProfileUpgrade: f.proof }), /identity\/profile\/media changed|periodic geometry or presentation changed|development profile mismatch|unavailable|unknown/i);
  }
  const f = await periodicFixture(), prior = await seal({ ...f.oldMap, developmentProfile: { ...f.oldMap.developmentProfile, worldMap: "old-policy" } });
  f.current.set(f.urls.sourceMap, prior); (f.recipe as any).sourceMap.contentHash = prior.contentHash;
  await assert.rejects(f.run({ frameworkProfileUpgrade: f.proof }), /cannot remove or change marker|development profile mismatch/);
});
test("v3 exact declaration cannot authorize absent, unknown or unavailable periodic providers", async () => {
  const f = await periodicFixture();
  for (const proof of [{ ...f.proof, markers: { ...markers, worldMap: periodicMarkers.worldMap } },
    { ...f.proof, markers: { ...f.proof.markers, worldMap: "unavailable" } },
    { ...f.proof, rules: "external" }, { ...f.proof, kind: "compiled-framework-profile-upgrade-v4" }])
    await assert.rejects(f.run({ frameworkProfileUpgrade: proof }), /framework profile upgrade/);
  await mkdir(resolve(root, "build/wip"), { recursive: true });
  const isolated = await mkdtemp(resolve(root, "build/wip/periodic-provider-unavailable-"));
  try {
    await cp(resolve(compiledDir, "src"), resolve(isolated, "src"), { recursive: true });
    await writeFile(resolve(isolated, "src/core/field-presentation.js"), 'export const WEB_PERIODIC_WORLD_PRESENTATION="unavailable"; export function resolveFieldPresentation() {}\n');
    await assert.rejects(f.run({ compiledDir: isolated, frameworkProfileUpgrade: f.proof }), /host unavailable: worldMap/);
  } finally { await rm(isolated, { recursive: true, force: true }); }
});
