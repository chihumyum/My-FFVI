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

test("animated map host uses a separate exact additive v4 declaration and cannot grant source or media edits", async () => {
  const f = await fixture(), marker = "web-field-animated-map-entities-v1";
  for (const [url, value] of f.candidate) f.candidate.set(url, await seal({ ...value,
    developmentProfile: { ...value.developmentProfile, mapAnimatedEntities: marker } }));
  // Restore the dependency chain after the explicitly changed profile hashes.
  const map = f.candidate.get(f.urls.sourceMap)!, world = f.candidate.get(f.urls.sourceWorld)!;
  f.candidate.set(f.urls.sourceWorld, await seal({ ...world, maps: { ...world.maps,
    [map.mapId]: { ...world.maps[map.mapId], contentHash: map.contentHash } } }));
  const entry = f.candidate.get(f.urls.sourceEntry)!;
  f.candidate.set(f.urls.sourceEntry, await seal({ ...entry, mapContentHash: map.contentHash,
    worldCatalogHash: f.candidate.get(f.urls.sourceWorld)!.contentHash }));
  const proof = { ...declaration(), kind: "compiled-framework-profile-upgrade-v4", markers: { ...markers, mapAnimatedEntities: marker } };
  await assert.rejects(f.run({ frameworkProfileUpgrade: declaration() }), /identity\/profile\/media changed/);
  const result = await f.run({ frameworkProfileUpgrade: proof });
  assert.equal(result.report.frameworkProfileUpgrades.length, 3);
  for (const row of result.report.frameworkProfileUpgrades) {
    assert.equal(row.grantsSourceAdmission, false); assert.equal(row.saveMigration, false);
    assert.ok(row.providers.some((p: any) => p.marker === "mapAnimatedEntities" && p.provider === "prepareFieldMapAnimations"));
  }
  const bad = structuredClone(f.candidate.get(f.urls.sourceWorld)!); bad.characters = { ...bad.characters, invented: {} };
  f.candidate.set(f.urls.sourceWorld, await seal(bad));
  await assert.rejects(f.run({ frameworkProfileUpgrade: proof }), /identity|dependency|media changed/i);
});

async function worldAutoProfileFixture(){
 const f=await fixture(),added={mapAnimatedEntities:'web-field-animated-map-entities-v1',worldAutoTasks:'web-flat-world-auto-tasks-v1'};
 for(const[url,value]of f.candidate)f.candidate.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,...added}}));
 const map=f.candidate.get(f.urls.sourceMap)!,world=f.candidate.get(f.urls.sourceWorld)!;
 f.candidate.set(f.urls.sourceWorld,await seal({...world,maps:{...world.maps,[map.mapId]:{...world.maps[map.mapId],contentHash:map.contentHash}}}));
 const entry=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...entry,mapContentHash:map.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 return {...f,proof:{...declaration(),kind:'compiled-framework-profile-upgrade-v5',markers:{...markers,...added}}};
}
test('exact v5 world-auto marker upgrades all pinned content identities and binds the real content/runtime provider',async()=>{
 const f=await worldAutoProfileFixture(),before=canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]});
 await assert.rejects(f.run({frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v4'}}),/framework profile upgrade markers/);
 const result=await f.run({frameworkProfileUpgrade:f.proof});assert.equal(result.report.frameworkProfileUpgrades.length,3);
 for(const row of result.report.frameworkProfileUpgrades){
  assert.equal(row.kind,'compiled-framework-profile-upgrade-v5');assert.equal(row.grantsSourceAdmission,false);assert.equal(row.saveMigration,false);
  assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);assert.equal(row.profileAfter.worldAutoTasks,f.proof.markers.worldAutoTasks);
  const provider=row.providers.find((p:any)=>p.marker==='worldAutoTasks');assert.equal(provider.provider,'worldAutoBinding');assert.match(provider.sha256,/^[a-f0-9]{64}$/);
 }
 assert.equal(canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),before);
 for(const mutate of [(p:any)=>{delete p.markers.worldAutoTasks;},(p:any)=>{p.markers.worldAutoTasks='unknown';},(p:any)=>{p.markers.unverified=true;},
  (p:any)=>{p.kind='compiled-framework-profile-upgrade-v6';}]){const proof=structuredClone(f.proof);mutate(proof);await assert.rejects(f.run({frameworkProfileUpgrade:proof}),/framework profile upgrade/);}
 const bad=structuredClone(f.candidate.get(f.urls.sourceMap)!);bad.map.identity.areaId++;bad.areaId++;
 f.candidate.set(f.urls.sourceMap,await seal(bad));await assert.rejects(f.run({frameworkProfileUpgrade:f.proof}),/identity|dependency|media changed/i);
});
test('v5 world-auto declaration cannot replace an unavailable compiled provider or alter a prior marker',async()=>{
 const f=await worldAutoProfileFixture();await mkdir(resolve(root,'build/wip'),{recursive:true});const isolated=await mkdtemp(resolve(root,'build/wip/world-auto-provider-unavailable-'));
 try{await cp(resolve(compiledDir,'src'),resolve(isolated,'src'),{recursive:true});await writeFile(resolve(isolated,'src/core/field-world-auto-tasks.js'),'export const WEB_FLAT_WORLD_AUTO_TASKS="unavailable";export function worldAutoBinding(){}\n');
  await assert.rejects(f.run({compiledDir:isolated,frameworkProfileUpgrade:f.proof}),/host unavailable: worldAutoTasks/);
 }finally{await rm(isolated,{recursive:true,force:true});}
 for(const[url,value]of f.current)f.current.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,worldAutoTasks:'prior-unknown'}}));
 for(const[role,url]of Object.entries(f.urls))(f.recipe as any)[role].contentHash=f.current.get(url)!.contentHash;
 await assert.rejects(f.run({frameworkProfileUpgrade:f.proof}),/profile mismatch|cannot remove or change marker/);
});

async function birdActorProfileFixture() {
  const f = await worldAutoProfileFixture(), birdViewActors = 'web-flat-bird-view-actors-v1';
  for (const [url, value] of f.candidate) f.candidate.set(url, await seal({ ...value,
    developmentProfile: { ...value.developmentProfile, birdViewActors } }));
  const map = f.candidate.get(f.urls.sourceMap)!, world = f.candidate.get(f.urls.sourceWorld)!;
  f.candidate.set(f.urls.sourceWorld, await seal({ ...world, maps: { ...world.maps,
    [map.mapId]: { ...world.maps[map.mapId], contentHash: map.contentHash } } }));
  const entry = f.candidate.get(f.urls.sourceEntry)!;
  f.candidate.set(f.urls.sourceEntry, await seal({ ...entry, mapContentHash: map.contentHash,
    worldCatalogHash: f.candidate.get(f.urls.sourceWorld)!.contentHash }));
  return { ...f, proof: { ...f.proof, kind: 'compiled-framework-profile-upgrade-v6', markers: { ...f.proof.markers, birdViewActors } } };
}
test('exact v6 BirdView actor proof binds complete entry/world/map identities and cannot widen a previous declaration', async () => {
  const f = await birdActorProfileFixture(), before = canonical({ recipe: f.recipe, current: [...f.current], candidate: [...f.candidate] });
  const result = await f.run({ frameworkProfileUpgrade: f.proof });
  assert.equal(result.report.frameworkProfileUpgrades.length, 3);
  for (const row of result.report.frameworkProfileUpgrades) {
    assert.equal(row.kind, f.proof.kind); assert.equal(row.grantsSourceAdmission, false); assert.equal(row.saveMigration, false);
    assert.deepEqual(row.comparisonIdentityBefore, row.comparisonIdentityAfter);
    assert.equal(row.profileAfter.birdViewActors, f.proof.markers.birdViewActors);
    const provider = row.providers.find((p: any) => p.marker === 'birdViewActors');
    assert.equal(provider.module, 'src/core/field-bird-view-actors.js'); assert.equal(provider.provider, 'fieldBirdViewActorBinding');
    assert.match(provider.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(canonical({ recipe: f.recipe, current: [...f.current], candidate: [...f.candidate] }), before);
  for (const version of [1, 2, 3, 4, 5]) await assert.rejects(f.run({ frameworkProfileUpgrade: { ...f.proof,
    kind: 'compiled-framework-profile-upgrade-v' + version } }), /framework profile upgrade/);
  for (const mutate of [(p: any) => { delete p.markers.birdViewActors; }, (p: any) => { p.markers.birdViewActors = 'unknown'; },
    (p: any) => { delete p.markers.worldAutoTasks; }, (p: any) => { p.markers.worldAutoMove = 'guessed'; },
    (p: any) => { p.kind = 'compiled-framework-profile-upgrade-v7'; }]) {
    const proof = structuredClone(f.proof); mutate(proof); await assert.rejects(f.run({ frameworkProfileUpgrade: proof }), /framework profile upgrade/);
  }
});
test('v6 requires its compiled actual binding provider and preserves full source script/geometry checks', async () => {
  const f = await birdActorProfileFixture(); await mkdir(resolve(root, 'build/wip'), { recursive: true });
  const isolated = await mkdtemp(resolve(root, 'build/wip/bird-actor-provider-unavailable-'));
  try {
    await cp(resolve(compiledDir, 'src'), resolve(isolated, 'src'), { recursive: true });
    await writeFile(resolve(isolated, 'src/core/field-bird-view-actors.js'),
      'export const WEB_FLAT_BIRD_VIEW_ACTORS="web-flat-bird-view-actors-v1";\n');
    await assert.rejects(f.run({ compiledDir: isolated, frameworkProfileUpgrade: f.proof }), /host unavailable: birdViewActors/);
  } finally { await rm(isolated, { recursive: true, force: true }); }
  const bad = structuredClone(f.candidate.get(f.urls.sourceMap)!); bad.scripts = { injected: [{ kind: 'exit' }] };
  f.candidate.set(f.urls.sourceMap, await seal(bad));
  await assert.rejects(f.run({ frameworkProfileUpgrade: f.proof }), /identity|dependency|media changed/i);
});

async function worldAutoMoveProfileFixture() {
  const f = await birdActorProfileFixture(), worldAutoMove = 'web-flat-world-auto-move-v1';
  for (const [url, value] of f.candidate) f.candidate.set(url, await seal({ ...value,
    developmentProfile: { ...value.developmentProfile, worldAutoMove } }));
  const map = f.candidate.get(f.urls.sourceMap)!, world = f.candidate.get(f.urls.sourceWorld)!;
  f.candidate.set(f.urls.sourceWorld, await seal({ ...world, maps: { ...world.maps,
    [map.mapId]: { ...world.maps[map.mapId], contentHash: map.contentHash } } }));
  const entry = f.candidate.get(f.urls.sourceEntry)!;
  f.candidate.set(f.urls.sourceEntry, await seal({ ...entry, mapContentHash: map.contentHash,
    worldCatalogHash: f.candidate.get(f.urls.sourceWorld)!.contentHash }));
  return { ...f, proof: { ...f.proof, kind: 'compiled-framework-profile-upgrade-v7', markers: { ...f.proof.markers, worldAutoMove } } };
}
test('exact v7 movement profile retains previous marker shapes and binds the actual following-entity provider', async () => {
  const f = await worldAutoMoveProfileFixture(), before = canonical({ recipe: f.recipe, current: [...f.current], candidate: [...f.candidate] });
  const result = await f.run({ frameworkProfileUpgrade: f.proof });
  assert.equal(result.report.frameworkProfileUpgrades.length, 3);
  for (const row of result.report.frameworkProfileUpgrades) {
    assert.equal(row.kind, f.proof.kind); assert.equal(row.grantsSourceAdmission, false); assert.equal(row.saveMigration, false);
    assert.deepEqual(row.comparisonIdentityBefore, row.comparisonIdentityAfter);
    assert.equal(row.profileAfter.worldAutoMove, f.proof.markers.worldAutoMove);
    const provider = row.providers.find((p: any) => p.marker === 'worldAutoMove');
    assert.equal(provider.module, 'src/core/field-world-auto-move.js'); assert.equal(provider.provider, 'worldAutoMoveBinding');
    const { createHash } = await import('node:crypto'), { readFile } = await import('node:fs/promises');
    assert.equal(provider.sha256, createHash('sha256').update(await readFile(resolve(compiledDir, provider.module))).digest('hex'));
  }
  assert.equal(canonical({ recipe: f.recipe, current: [...f.current], candidate: [...f.candidate] }), before);
  for (const version of [1, 2, 3, 4, 5, 6]) await assert.rejects(f.run({ frameworkProfileUpgrade: { ...f.proof,
    kind: 'compiled-framework-profile-upgrade-v' + version } }), /framework profile upgrade/);
  for (const mutate of [(p: any) => { delete p.markers.worldAutoMove; }, (p: any) => { p.markers.worldAutoMove = 'unknown'; },
    (p: any) => { delete p.markers.birdViewActors; }, (p: any) => { delete p.markers.worldAutoTasks; },
    (p: any) => { p.markers.invented = true; }, (p: any) => { p.kind = 'compiled-framework-profile-upgrade-v8'; }]) {
    const proof = structuredClone(f.proof); mutate(proof); await assert.rejects(f.run({ frameworkProfileUpgrade: proof }), /framework profile upgrade/);
  }
});
test('v7 rejects a missing real provider and does not authorize source geometry, media or script changes', async () => {
  const f = await worldAutoMoveProfileFixture(); await mkdir(resolve(root, 'build/wip'), { recursive: true });
  const isolated = await mkdtemp(resolve(root, 'build/wip/world-auto-move-provider-unavailable-'));
  try {
    await cp(resolve(compiledDir, 'src'), resolve(isolated, 'src'), { recursive: true });
    await writeFile(resolve(isolated, 'src/core/field-world-auto-move.js'),
      'export const WEB_FLAT_WORLD_AUTO_MOVE="web-flat-world-auto-move-v1";\n');
    await assert.rejects(f.run({ compiledDir: isolated, frameworkProfileUpgrade: f.proof }), /host unavailable: worldAutoMove/);
  } finally { await rm(isolated, { recursive: true, force: true }); }
  for (const mutate of [(v: any) => { v.scripts = { injected: [{ kind: 'exit' }] }; },
    (v: any) => { v.map.identity.areaId++; v.areaId++; }, (v: any) => { v.media = { injected: '/unverified.png' }; }]) {
    const bad = structuredClone(f.candidate.get(f.urls.sourceMap)!); mutate(bad);
    const old = f.candidate.get(f.urls.sourceMap)!; f.candidate.set(f.urls.sourceMap, await seal(bad));
    await assert.rejects(f.run({ frameworkProfileUpgrade: f.proof }), /identity|dependency|media changed/i);
    f.candidate.set(f.urls.sourceMap, old);
  }
});

async function mobColorProfileFixture() {
 const f=await worldAutoMoveProfileFixture(),mobColorFilter='web-flat-mob-color-filter-v1';
 for(const[url,value]of f.candidate)f.candidate.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,mobColorFilter}}));
 const map=f.candidate.get(f.urls.sourceMap)!,world=f.candidate.get(f.urls.sourceWorld)!;
 f.candidate.set(f.urls.sourceWorld,await seal({...world,maps:{...world.maps,[map.mapId]:{...world.maps[map.mapId],contentHash:map.contentHash}}}));
 const entry=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...entry,mapContentHash:map.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 return {...f,proof:{...f.proof,kind:'compiled-framework-profile-upgrade-v8',markers:{...f.proof.markers,mobColorFilter}}};
}
test('exact v8 Mob marker binds complete v7 dependency cohort without widening previous declarations or granting source/save authority',async()=>{
 const f=await mobColorProfileFixture(),before=canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),result=await f.run({frameworkProfileUpgrade:f.proof});
 assert.equal(result.report.frameworkProfileUpgrades.length,3);
 for(const row of result.report.frameworkProfileUpgrades){assert.equal(row.kind,f.proof.kind);assert.equal(row.grantsSourceAdmission,false);assert.equal(row.saveMigration,false);assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);
  const provider=row.providers.find((p:any)=>p.marker==='mobColorFilter');assert.equal(provider.module,'src/core/field-mob-controls.js');assert.equal(provider.provider,'fieldMobColorBinding');assert.match(provider.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),before);
 for(const version of[1,2,3,4,5,6,7])await assert.rejects(f.run({frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v'+version}}),/framework profile upgrade/);
 for(const mutate of[(p:any)=>{delete p.markers.mobColorFilter},(p:any)=>{p.markers.mobColorFilter='unknown'},(p:any)=>{delete p.markers.worldAutoMove},(p:any)=>{p.kind='compiled-framework-profile-upgrade-v9'},(p:any)=>{p.markers.future=true}]){const proof=structuredClone(f.proof);mutate(proof);await assert.rejects(f.run({frameworkProfileUpgrade:proof}),/framework profile upgrade/);}
});
test('v8 requires the actual compiled Mob binding and cannot normalize foreign source scripts or geometry',async()=>{
 const f=await mobColorProfileFixture();await mkdir(resolve(root,'build/wip'),{recursive:true});const isolated=await mkdtemp(resolve(root,'build/wip/mob-filter-provider-unavailable-'));
 try{await cp(resolve(compiledDir,'src'),resolve(isolated,'src'),{recursive:true});await writeFile(resolve(isolated,'src/core/field-mob-controls.js'),'export const WEB_FLAT_MOB_COLOR_FILTER="web-flat-mob-color-filter-v1";\n');await assert.rejects(f.run({compiledDir:isolated,frameworkProfileUpgrade:f.proof}),/host unavailable: mobColorFilter/);}finally{await rm(isolated,{recursive:true,force:true});}
 const bad=structuredClone(f.candidate.get(f.urls.sourceMap)!);bad.scripts={injected:[{kind:'exit'}]};f.candidate.set(f.urls.sourceMap,await seal(bad));await assert.rejects(f.run({frameworkProfileUpgrade:f.proof}),/identity|dependency|media changed/i);
});

async function screenPresentationProfileFixture(){
 const f=await mobColorProfileFixture(),screenPresentation='web-field-screen-presentation-2d-v1';
 for(const[url,value]of f.candidate)f.candidate.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,screenPresentation}}));
 const map=f.candidate.get(f.urls.sourceMap)!,world=f.candidate.get(f.urls.sourceWorld)!;
 f.candidate.set(f.urls.sourceWorld,await seal({...world,maps:{...world.maps,[map.mapId]:{...world.maps[map.mapId],contentHash:map.contentHash}}}));
 const entry=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...entry,mapContentHash:map.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 return {...f,proof:{...f.proof,kind:'compiled-framework-profile-upgrade-v9',markers:{...f.proof.markers,screenPresentation}}};
}
test('exact v9 screen presentation binds its actual provider and preserves all previous exact declaration shapes',async()=>{
 const f=await screenPresentationProfileFixture(),before=canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),result=await f.run({frameworkProfileUpgrade:f.proof});
 assert.equal(result.report.frameworkProfileUpgrades.length,3);
 for(const row of result.report.frameworkProfileUpgrades){assert.equal(row.kind,f.proof.kind);assert.equal(row.grantsSourceAdmission,false);assert.equal(row.saveMigration,false);assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);
  const provider=row.providers.find((p:any)=>p.marker==='screenPresentation');assert.equal(provider.module,'src/core/field-screen-presentation.js');assert.equal(provider.provider,'fieldScreenPresentationBinding');assert.match(provider.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),before);
 for(const version of[1,2,3,4,5,6,7,8])await assert.rejects(f.run({frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v'+version}}),/framework profile upgrade/);
 for(const mutate of[(p:any)=>{delete p.markers.screenPresentation;},(p:any)=>{p.markers.screenPresentation='unknown';},(p:any)=>{delete p.markers.mobColorFilter;},(p:any)=>{delete p.markers.storyRuntime;},(p:any)=>{p.markers.callback='forged';}]){const proof=structuredClone(f.proof);mutate(proof);await assert.rejects(f.run({frameworkProfileUpgrade:proof}),/framework profile upgrade/);}
});
test('v9 cannot supply a missing compiled screen owner or alter source script bodies',async()=>{
 const f=await screenPresentationProfileFixture();await mkdir(resolve(root,'build/wip'),{recursive:true});const isolated=await mkdtemp(resolve(root,'build/wip/screen-owner-provider-unavailable-'));
 try{await cp(resolve(compiledDir,'src'),resolve(isolated,'src'),{recursive:true});await writeFile(resolve(isolated,'src/core/field-screen-presentation.js'),'export const WEB_FIELD_SCREEN_PRESENTATION="web-field-screen-presentation-2d-v1";export class FieldScreenPresentationState{};export const fieldScreenPresentationBinding=undefined;\n');await assert.rejects(f.run({compiledDir:isolated,frameworkProfileUpgrade:f.proof}),/host unavailable: screenPresentation/);}finally{await rm(isolated,{recursive:true,force:true});}
 const bad=structuredClone(f.candidate.get(f.urls.sourceMap)!);bad.scripts={injected:[{kind:'exit'}]};f.candidate.set(f.urls.sourceMap,await seal(bad));await assert.rejects(f.run({frameworkProfileUpgrade:f.proof}),/identity|dependency|media changed/i);
});

async function skyboxProfileFixture(){
 const f=await screenPresentationProfileFixture(),{loadFieldSkyboxCatalog}=await import('../src/compiler/field-skybox.js'),{fieldSkyboxDefinition}=await import('../src/core/field-skybox.js'),catalog=await loadFieldSkyboxCatalog(root),skyboxPresentation='web-flat-skybox-panorama-v1';
 for(const records of[f.current,f.candidate])for(const[url,value]of records){let next:Document={...value,sourceSetHash:catalog.sourceSetHash,parentSourceSetHash:catalog.parentSourceSetHash};if(url===f.urls.sourceMap){next.name='Map_40000';next.entryView={mapId:next.mapId,isWorld:true,loopType:0,sources:{map:{file:'authored-map.csv',assetPath:'map.csv',objectId:'11',sha256:'a'.repeat(64),pointer:'/id/'+next.mapId},area:{file:'authored-area.csv',assetPath:'area.csv',objectId:'13',sha256:'b'.repeat(64),pointer:'/id/'+next.areaId}}};}if(records===f.candidate)next.developmentProfile={...next.developmentProfile,skyboxPresentation};records.set(url,await seal(next));}
 const map=f.candidate.get(f.urls.sourceMap)!;map.map.skybox=fieldSkyboxDefinition(catalog,map as any);f.candidate.set(f.urls.sourceMap,await seal(map));
 for(const records of[f.current,f.candidate]){const m=records.get(f.urls.sourceMap)!,w=records.get(f.urls.sourceWorld)!;records.set(f.urls.sourceWorld,await seal({...w,maps:{...w.maps,[m.mapId]:{...w.maps[m.mapId],contentHash:m.contentHash}}}));const e=records.get(f.urls.sourceEntry)!;records.set(f.urls.sourceEntry,await seal({...e,mapContentHash:m.contentHash,worldCatalogHash:records.get(f.urls.sourceWorld)!.contentHash}));}
 for(const[role,url]of Object.entries(f.urls))(f.recipe as any)[role].contentHash=f.current.get(url)!.contentHash;
 return{...f,catalog,proof:{...f.proof,kind:'compiled-framework-profile-upgrade-v10',markers:{...f.proof.markers,skyboxPresentation},skyboxCatalog:catalog}};
}
test('exact v10 binds verified full Skybox catalog and current world-map applicability while previous versions retain exact shapes',async()=>{
 const f=await skyboxProfileFixture(),before=canonical({current:[...f.current],candidate:[...f.candidate]}),result=await f.run({frameworkProfileUpgrade:f.proof});assert.equal(result.report.frameworkProfileUpgrades.length,3);const row=result.report.frameworkProfileUpgrades.find(r=>r.role==='sourceMap')!;assert.equal(row.skyboxPresentation.catalogHash,f.catalog.contentHash);assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);assert.equal(row.grantsSourceAdmission,false);assert.equal(row.saveMigration,false);assert.equal(row.providers.find((p:any)=>p.marker==='skyboxPresentation').provider,'fieldSkyboxBinding');assert.equal(canonical({current:[...f.current],candidate:[...f.candidate]}),before);
 for(const v of[1,2,3,4,5,6,7,8,9])await assert.rejects(f.run({frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v'+v}}),/framework profile upgrade/);
 for(const mutate of[(p:any)=>{delete p.markers.skyboxPresentation},(p:any)=>{delete p.markers.screenPresentation},(p:any)=>{delete p.skyboxCatalog},(p:any)=>{p.markers.skyboxPresentation='unknown'}]){const p=structuredClone(f.proof);mutate(p);await assert.rejects(f.run({frameworkProfileUpgrade:p}),/framework profile upgrade/);}
});
test('v10 cannot normalize foreign catalog, source applicability, pixels, geometry, source script or existing provider changes',async()=>{
 for(const mutate of[(m:any)=>{m.map.skybox.catalog.images[Object.keys(m.map.skybox.catalog.images)[0]!].sha256='0'.repeat(64)},(m:any)=>{m.map.skybox.mapId++},(m:any)=>{m.map.width++},(m:any)=>{m.scripts={injected:[{kind:'exit'}]}}]){const f=await skyboxProfileFixture(),m=structuredClone(f.candidate.get(f.urls.sourceMap)!);mutate(m);f.candidate.set(f.urls.sourceMap,await seal(m));await assert.rejects(f.run({frameworkProfileUpgrade:f.proof}),/Skybox|geometry|identity|dependency|media changed/i);}
 const f=await skyboxProfileFixture(),p=structuredClone(f.proof);p.skyboxCatalog.models.data[0]!.rotate=false;const {hash}=await import('../src/compiler/content.js'),{contentHash:_,...body}=p.skyboxCatalog;p.skyboxCatalog.contentHash=hash(body);await assert.rejects(f.run({frameworkProfileUpgrade:p}),/exact verified source catalog/);
 const existing=structuredClone(f.current.get(f.urls.sourceMap)!);existing.map.skybox=structuredClone(f.candidate.get(f.urls.sourceMap)!.map.skybox);existing.map.skybox.offset=1;f.current.set(f.urls.sourceMap,await seal(existing));(f.recipe as any).sourceMap.contentHash=f.current.get(f.urls.sourceMap)!.contentHash;await assert.rejects(f.run({frameworkProfileUpgrade:f.proof}),/replace a prior provider/);
});

async function boardTransformProfileFixture(){
 const f=await skyboxProfileFixture(),{hash}=await import('../src/compiler/content.js'),flat=await import('../src/compiler/framework-field-effect-flat-projection.js'),transform=await import(pathToFileURL(resolve(compiledDir,'src/compiler/framework-field-effect-transforms.js')).href),helpers=await import(pathToFileURL(resolve(root,'scripts/framework-field-effect-transform-evidence.mjs')).href),flatHelpers=await import(pathToFileURL(resolve(root,'scripts/framework-field-effect-flat-evidence.mjs')).href);
 const source=f.candidate.get(f.urls.sourceMap)!,logical=logicalEffectCatalog(source.sourceSetHash,source.parentSourceSetHash).catalog,mapSources=[{mapId:source.mapId,sourceMapHash:source.developmentProfile.sourceContentHash}],sourceMapSetHash=hash({sourceSetHash:source.sourceSetHash,parentSourceSetHash:source.parentSourceSetHash,maps:mapSources}),shared={sourceSetHash:source.sourceSetHash,parentSourceSetHash:source.parentSourceSetHash,sourceMapSetHash,mapSources,objects:[],bindings:[],nativeParity:false,reason:'Controlled empty-board complete source scope; no original map execution.'};
 const flatBody={kind:'framework-field-effect-flat-assessment-v1',projection:{...shared,kind:'web-source-field-effect-flat-v1',logicalCatalogHash:logical.webPolicy!.catalogHash}},flatAssessment={...flatBody,contentHash:hash(flatBody)},base=flat.projectFrameworkFieldEffectCatalog(logical,flatAssessment as any),body={kind:'framework-field-effect-transform-assessment-v1',projection:{...shared,kind:helpers.FIELD_EFFECT_TRANSFORMS,logicalCatalogHash:base.webPolicy!.catalogHash}},assessment={...body,contentHash:hash(body)},catalog=transform.projectFrameworkFieldEffectTransformCatalog(base,assessment);
 for(const[url,value]of f.candidate)f.candidate.set(url,await seal({...value,...(url===f.urls.sourceMap?{fieldEffects:catalog}:{}),developmentProfile:{...value.developmentProfile,logicalFieldEffects:'web-logical-all-loop-field-effects-v1',fieldEffectTransforms:helpers.FIELD_EFFECT_TRANSFORMS,fieldEffectProjection:'web-source-field-effect-flat-v1'}}));
 const map=f.candidate.get(f.urls.sourceMap)!,world=f.candidate.get(f.urls.sourceWorld)!;f.candidate.set(f.urls.sourceWorld,await seal({...world,maps:{...world.maps,[map.mapId]:{...world.maps[map.mapId],contentHash:map.contentHash}}}));
 const entry=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...entry,mapContentHash:map.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 const catalogWorld=f.candidate.get(f.urls.sourceWorld)!,catalogEntry=f.candidate.get(f.urls.sourceEntry)!,proof={...f.proof,kind:'compiled-framework-profile-upgrade-v11',logicalFieldEffects:logical,fieldEffectTransformCatalog:assessment,markers:{...f.proof.markers,logicalFieldEffects:'web-logical-all-loop-field-effects-v1',fieldEffectTransforms:helpers.FIELD_EFFECT_TRANSFORMS}},flatProof=flatHelpers.createFrameworkFieldEffectFlatAddition({compilerDigest:proof.compilerDigest,assessment:flatAssessment,catalog:catalogWorld,entry:catalogEntry}),addition=helpers.createFrameworkFieldEffectTransformAddition({compilerDigest:proof.compilerDigest,assessment,flatAssessment,catalog:catalogWorld,entry:catalogEntry,projectedCatalogHash:hash(catalog)}),sourceMap={contentHash:map.developmentProfile.sourceContentHash};
 const options={frameworkProfileUpgrade:proof,frameworkFieldEffectFlatAddition:flatProof,frameworkFieldEffectFlatEvidence:async()=>({assessment:flatAssessment,catalog:base,logical,sourceMap}),frameworkFieldEffectTransformAddition:addition,frameworkFieldEffectTransformEvidence:async()=>({assessment,catalog,legacy:base,sourceMap})};
 return{...f,proof,assessment,base,fullCatalog:catalog,options};
}
test('exact v11 separately validates full transforms before unchanged legacy flat/logical comparisons and rebinds the complete cohort',async()=>{
 const f=await boardTransformProfileFixture(),before=canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),r=await f.run(f.options),report=r.report as any;assert.equal(report.frameworkProfileUpgrades.length,3);assert.equal(report.frameworkFieldEffectTransformAdditions.length,3);assert.equal(report.frameworkFieldEffectFlatAdditions.length,3);
 for(const row of report.frameworkProfileUpgrades){assert.equal(row.kind,'compiled-framework-profile-upgrade-v11');assert.equal(row.grantsSourceAdmission,false);assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);assert.equal(row.providers.find((p:any)=>p.marker==='fieldEffectTransforms').provider,'fieldEffectTransformsBinding');}
 assert.equal(canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),before);assert.equal(r.recipe.sourceMap.contentHash,f.candidate.get(f.urls.sourceMap)!.contentHash);
});
test('v11 requires its own verified provider/full source proof and never widens v1-v10 or arbitrary map/script/asset changes',async()=>{
 const f=await boardTransformProfileFixture();for(const version of[1,2,3,4,5,6,7,8,9,10])await assert.rejects(f.run({...f.options,frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v'+version}}));
 for(const mutation of[(o:any)=>{delete o.frameworkFieldEffectTransformAddition},(o:any)=>{delete o.frameworkFieldEffectTransformEvidence},(o:any)=>{delete o.frameworkFieldEffectFlatAddition},(o:any)=>{delete o.frameworkProfileUpgrade.markers.fieldEffectTransforms},(o:any)=>{o.frameworkProfileUpgrade.fieldEffectTransformCatalog.projection.reason='changed'},(o:any)=>{o.frameworkFieldEffectTransformAddition.projectedCatalogHash='0'.repeat(64)}]){const o={...f.options,frameworkProfileUpgrade:structuredClone(f.proof),frameworkFieldEffectTransformAddition:structuredClone(f.options.frameworkFieldEffectTransformAddition)};mutation(o);await assert.rejects(f.run(o));}
 for(const mutation of[(m:any)=>{m.map.width++},(m:any)=>{m.map.source.objectId='9007199254740995'},(m:any)=>{m.scripts={injected:[{kind:'exit'}]}},(m:any)=>{m.fieldEffects.media={}}]){const old=f.candidate.get(f.urls.sourceMap)!,m=structuredClone(old);mutation(m);f.candidate.set(f.urls.sourceMap,await seal(m));await assert.rejects(f.run(f.options));f.candidate.set(f.urls.sourceMap,old);}
 await mkdir(resolve(root,'build/wip'),{recursive:true});const isolated=await mkdtemp(resolve(root,'build/wip/board-transform-provider-unavailable-'));try{await cp(resolve(compiledDir,'src'),resolve(isolated,'src'),{recursive:true});await writeFile(resolve(isolated,'src/core/field-effect-transforms.js'),'export const WEB_FIELD_EFFECT_TRANSFORMS="web-source-logical-board-transforms-v1";\n');await assert.rejects(f.run({...f.options,compiledDir:isolated}),/host unavailable: fieldEffectTransforms/);}finally{await rm(isolated,{recursive:true,force:true});}
});

async function vehicleProfileFixture(){
 const f=await boardTransformProfileFixture(),vehicleLifecycle='web-source-vehicle-lifecycle-v1';
 for(const records of[f.current,f.candidate])for(const[url,value]of records)records.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,transportation:'walking-magitek-framework-v1'}}));
 for(const[url,value]of f.candidate)f.candidate.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,vehicleLifecycle}}));
 const map=f.candidate.get(f.urls.sourceMap)!,world=f.candidate.get(f.urls.sourceWorld)!;f.candidate.set(f.urls.sourceWorld,await seal({...world,maps:{...world.maps,[map.mapId]:{...world.maps[map.mapId],contentHash:map.contentHash}}}));
 const entry=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...entry,mapContentHash:map.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 for(const records of[f.current]){const m=records.get(f.urls.sourceMap)!,w=records.get(f.urls.sourceWorld)!;records.set(f.urls.sourceWorld,await seal({...w,maps:{...w.maps,[m.mapId]:{...w.maps[m.mapId],contentHash:m.contentHash}}}));const e=records.get(f.urls.sourceEntry)!;records.set(f.urls.sourceEntry,await seal({...e,mapContentHash:m.contentHash,worldCatalogHash:records.get(f.urls.sourceWorld)!.contentHash}));}
 for(const[role,url]of Object.entries(f.urls))(f.recipe as any)[role].contentHash=f.current.get(url)!.contentHash;
 const proof={...f.proof,kind:'compiled-framework-profile-upgrade-v12',markers:{...f.proof.markers,vehicleLifecycle}};
 const options={...f.options,frameworkProfileUpgrade:proof};for(const key of['frameworkFieldEffectTransformAddition','frameworkFieldEffectFlatAddition']as const){options[key]={...options[key],catalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash,entryHash:f.candidate.get(f.urls.sourceEntry)!.contentHash};}
 return{...f,proof,options};
}
test('v12 binds the real vehicle lifecycle host and preserves every earlier exact profile declaration',async()=>{
 const f=await vehicleProfileFixture(),before=canonical({current:[...f.current],candidate:[...f.candidate]}),r=await f.run(f.options);assert.equal(r.report.frameworkProfileUpgrades.length,3);
 for(const row of r.report.frameworkProfileUpgrades){assert.equal(row.kind,'compiled-framework-profile-upgrade-v12');assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);assert.equal(row.saveMigration,false);assert.equal(row.providers.find((p:any)=>p.marker==='vehicleLifecycle').provider,'fieldVehicleLifecycleBinding');}
 assert.equal(canonical({current:[...f.current],candidate:[...f.candidate]}),before);
 for(const version of[1,2,3,4,5,6,7,8,9,10,11])await assert.rejects(f.run({...f.options,frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v'+version}}),/framework profile upgrade/);
 for(const mutation of[(p:any)=>{delete p.markers.vehicleLifecycle},(p:any)=>{p.markers.vehicleLifecycle='unknown'},(p:any)=>{delete p.markers.fieldEffectTransforms},(p:any)=>{p.unknownPhase='boarding-ready'}]){const p=structuredClone(f.proof);mutation(p);await assert.rejects(f.run({...f.options,frameworkProfileUpgrade:p}),/framework profile upgrade/);}
});
test('v12 cannot provide missing vehicle owners, erase unrelated blockers or change source scripts/parking',async()=>{
 const f=await vehicleProfileFixture();await mkdir(resolve(root,'build/wip'),{recursive:true});const isolated=await mkdtemp(resolve(root,'build/wip/vehicle-owner-provider-unavailable-'));
 try{await cp(resolve(compiledDir,'src'),resolve(isolated,'src'),{recursive:true});await writeFile(resolve(isolated,'src/core/field-vehicle-lifecycle.js'),'export const WEB_SOURCE_VEHICLE_LIFECYCLE="web-source-vehicle-lifecycle-v1";\n');await assert.rejects(f.run({...f.options,compiledDir:isolated}),/host unavailable: vehicleLifecycle/);}finally{await rm(isolated,{recursive:true,force:true});}
 for(const mutate of[(m:any)=>{m.scripts={injected:[{kind:'exit'}]}},(m:any)=>{m.map.width++},(m:any)=>{m.vehicleParking=[]},(m:any)=>{m.blockers.push({reason:'made-up',source:m.map.source})}]){const old=f.candidate.get(f.urls.sourceMap)!,m=structuredClone(old);mutate(m);f.candidate.set(f.urls.sourceMap,await seal(m));await assert.rejects(f.run(f.options));f.candidate.set(f.urls.sourceMap,old);}
});

test('v12 source comparison proves the exact whole map/index blocker projection before accepting a foot action',async()=>{
 const f=await vehicleProfileFixture(),{compileEntityGroup}=await import('../src/compiler/entity-group.js'),p={action_id:2,direction:0,entity_id:555,gimmick:false,interactive_icon_type:3,link_object_id:0,object_id:0,object_type:21,script_id:882,target_transportation_ids:'31,72'},g=compileEntityGroup('entity_default',{source:{file:'controlled-foot.bundle',assetPath:'controlled/entity_default.json'},data:{layers:[{name:'BottomObject',objects:[{id:737,gid:998,name:'controlled source foot',width:16,height:16,x:48,y:64,visible:true,rotation:0,type:'',properties:Object.entries(p).map(([name,value])=>({name,value,type:typeof value==='boolean'?'bool':typeof value==='number'?'int':'string'}))}]}]}},{'action.csv':[{id:'2',action_name:'RunScript'}],'script.csv':[{id:'882',script_name:'original_source_action'}],'transportation.csv':[{id:'31',type_id:'8',asset_id:'73'},{id:'72',type_id:'8',asset_id:'74'}]});assert.equal(g.entities.length,1);assert(g.entities[0]!.vehicleAction);
 for(const records of[f.current,f.candidate]){const map=structuredClone(records.get(f.urls.sourceMap)!);map.map.groups.entity_default.entities.push(...structuredClone(g.entities));if(map.map.entities!==map.map.groups.entity_default.entities)map.map.entities.push(...structuredClone(g.entities));if(records===f.current){map.blockers.push(...g.blockers);map.map.groups.entity_default.blockers.push(...g.blockers);}records.set(f.urls.sourceMap,await seal(map));const m=records.get(f.urls.sourceMap)!,world=records.get(f.urls.sourceWorld)!;records.set(f.urls.sourceWorld,await seal({...world,maps:{...world.maps,[m.mapId]:{...world.maps[m.mapId],contentHash:m.contentHash,blockers:structuredClone(m.blockers),geometryReady:m.blockers.length===0,defaultGroupReady:m.map.groups.entity_default.blockers.length===0}}}));const e=records.get(f.urls.sourceEntry)!;records.set(f.urls.sourceEntry,await seal({...e,mapContentHash:m.contentHash,worldCatalogHash:records.get(f.urls.sourceWorld)!.contentHash}));}
 for(const[role,url]of Object.entries(f.urls))(f.recipe as any)[role].contentHash=f.current.get(url)!.contentHash;
 for(const key of['frameworkFieldEffectTransformAddition','frameworkFieldEffectFlatAddition']as const)Object.assign(f.options[key],{catalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash,entryHash:f.candidate.get(f.urls.sourceEntry)!.contentHash});
 const result=await f.run(f.options),map=result.report.frameworkProfileUpgrades.find(r=>r.role==='sourceMap')!;assert.equal(map.vehicleActions.count,1);assert.equal(map.vehicleActions.nativeParity,false);assert.deepEqual(map.comparisonIdentityBefore,map.comparisonIdentityAfter);assert.equal(f.current.get(f.urls.sourceMap)!.blockers[0].reason,'Unsupported entity kind 21');assert.equal(f.candidate.get(f.urls.sourceMap)!.blockers.length,0);
 const old=f.current.get(f.urls.sourceMap)!,bad=structuredClone(old);bad.map.groups.entity_default.entities.find((e:any)=>e.kind===21).vehicleAction.properties.gimmick=true;f.current.set(f.urls.sourceMap,await seal(bad));(f.recipe as any).sourceMap.contentHash=f.current.get(f.urls.sourceMap)!.contentHash;await assert.rejects(f.run(f.options));
});

async function parkingUploadProfileFixture(){
 const f=await vehicleProfileFixture(),transportationParkingUpload='web-source-transport-parking-upload-v1';
 for(const[url,value]of f.candidate)f.candidate.set(url,await seal({...value,developmentProfile:{...value.developmentProfile,transportationParkingUpload}}));
 const m=f.candidate.get(f.urls.sourceMap)!,w=f.candidate.get(f.urls.sourceWorld)!;f.candidate.set(f.urls.sourceWorld,await seal({...w,maps:{...w.maps,[m.mapId]:{...w.maps[m.mapId],contentHash:m.contentHash}}}));
 const e=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...e,mapContentHash:m.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 const proof={...f.proof,kind:'compiled-framework-profile-upgrade-v13',markers:{...f.proof.markers,transportationParkingUpload}},options={...f.options,frameworkProfileUpgrade:proof};
 for(const key of['frameworkFieldEffectTransformAddition','frameworkFieldEffectFlatAddition']as const)Object.assign(options[key],{catalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash,entryHash:f.candidate.get(f.urls.sourceEntry)!.contentHash});
 return{...f,proof,options};
}

async function mapTransformsProfileFixture(){
 const f=await parkingUploadProfileFixture(),{loadFieldSceneryWorldCatalog}=await import('../src/compiler/field-background.js'),{loadFieldWaterWorldCatalog}=await import('../src/compiler/field-map-transforms.js');
 const fieldSceneryCatalog=await loadFieldSceneryWorldCatalog(root),fieldWaterCatalog=await loadFieldWaterWorldCatalog(root),fieldLayerScrolling='web-field-layer-scrolling-v1',mapTransforms='web-flat-field-map-transforms-v1';
 for(const[url,value]of f.candidate){const next=structuredClone(value);next.developmentProfile={...next.developmentProfile,fieldLayerScrolling,mapTransforms};if(url===f.urls.sourceMap){if(fieldWaterCatalog.maps[String(next.mapId)]){next.map.scenery=fieldSceneryCatalog.maps[String(next.mapId)];next.map.water=fieldWaterCatalog.maps[String(next.mapId)];}}f.candidate.set(url,await seal(next));}
 const m=f.candidate.get(f.urls.sourceMap)!,w=f.candidate.get(f.urls.sourceWorld)!;f.candidate.set(f.urls.sourceWorld,await seal({...w,maps:{...w.maps,[m.mapId]:{...w.maps[m.mapId],contentHash:m.contentHash}}}));const e=f.candidate.get(f.urls.sourceEntry)!;f.candidate.set(f.urls.sourceEntry,await seal({...e,mapContentHash:m.contentHash,worldCatalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash}));
 const proof={...f.proof,kind:'compiled-framework-profile-upgrade-v15',markers:{...f.proof.markers,fieldLayerScrolling,mapTransforms},fieldSceneryCatalog,fieldWaterCatalog},options={...f.options,frameworkProfileUpgrade:proof};for(const key of['frameworkFieldEffectTransformAddition','frameworkFieldEffectFlatAddition']as const)Object.assign(options[key],{catalogHash:f.candidate.get(f.urls.sourceWorld)!.contentHash,entryHash:f.candidate.get(f.urls.sourceEntry)!.contentHash});return{...f,proof,options};
}
test('v15 global markers bind complete live catalogs and real modules while unknown controlled map resources remain gated',async()=>{
 const f=await mapTransformsProfileFixture();await assert.rejects(f.run(f.options),/Scenery upgrade lacks complete source map provider|Missing complete map water provider/);delete (f.recipe as Record<string,unknown>).sourceMap;const before=canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),result=await f.run(f.options);assert.equal(result.report.frameworkProfileUpgrades.length,2);
 for(const row of result.report.frameworkProfileUpgrades){assert.equal(row.kind,'compiled-framework-profile-upgrade-v15');assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);assert.equal(row.providers.find((p:any)=>p.marker==='mapTransforms').provider,'fieldMapTransformsBinding');assert.equal(row.grantsSourceAdmission,false);assert.equal(row.saveMigration,false);}
 assert.equal(canonical({recipe:f.recipe,current:[...f.current],candidate:[...f.candidate]}),before);
});
test('v15 cannot widen old declarations, grant unknown map resources, change source identity or omit the real consumer',async()=>{
 const f=await mapTransformsProfileFixture();for(const change of[(p:any)=>{p.kind='compiled-framework-profile-upgrade-v14'},(p:any)=>{delete p.fieldWaterCatalog},(p:any)=>{p.markers.mapTransforms='unknown'},(p:any)=>{delete p.markers.fieldLayerScrolling}]){const proof=structuredClone(f.proof);change(proof);await assert.rejects(f.run({...f.options,frameworkProfileUpgrade:proof}));}
 await assert.rejects(f.run(f.options),/Scenery upgrade lacks complete source map provider|Missing complete map water provider/);delete (f.recipe as Record<string,unknown>).sourceMap;const previous=f.candidate.get(f.urls.sourceWorld)!,foreign=structuredClone(previous);foreign.parentSourceSetHash='0'.repeat(64);f.candidate.set(f.urls.sourceWorld,await seal(foreign));await assert.rejects(f.run(f.options));f.candidate.set(f.urls.sourceWorld,previous);
 await mkdir(resolve(root,'build/wip'),{recursive:true});const isolated=await mkdtemp(resolve(root,'build/wip/map-transform-provider-unavailable-'));try{await cp(resolve(compiledDir,'src'),resolve(isolated,'src'),{recursive:true});await writeFile(resolve(isolated,'src/core/field-map-transforms.js'),'export const WEB_FIELD_MAP_TRANSFORMS="web-flat-field-map-transforms-v1";\n');await assert.rejects(f.run({...f.options,compiledDir:isolated}),/host unavailable: mapTransforms/);}finally{await rm(isolated,{recursive:true,force:true});}
});
test('parking v13 binds its actual batch owner and cannot be granted by any old declaration or unrelated candidate edit',async()=>{
 const f=await parkingUploadProfileFixture(),r=await f.run(f.options);assert.equal(r.report.frameworkProfileUpgrades.length,3);
 for(const row of r.report.frameworkProfileUpgrades){assert.equal(row.kind,'compiled-framework-profile-upgrade-v13');assert.equal(row.providers.find((p:any)=>p.marker==='transportationParkingUpload').provider,'fieldTransportationParkingBinding');assert.deepEqual(row.comparisonIdentityBefore,row.comparisonIdentityAfter);assert.equal(row.saveMigration,false);}
 for(let version=1;version<=12;version++)await assert.rejects(f.run({...f.options,frameworkProfileUpgrade:{...f.proof,kind:'compiled-framework-profile-upgrade-v'+version}}));
 for(const change of[(p:any)=>delete p.markers.vehicleLifecycle,(p:any)=>delete p.markers.transportationParkingUpload,(p:any)=>p.markers.transportationParkingUpload='unknown']){const bad=structuredClone(f.proof);change(bad);await assert.rejects(f.run({...f.options,frameworkProfileUpgrade:bad}));}
 const original=f.candidate.get(f.urls.sourceMap)!,bad=structuredClone(original);bad.vehicleParking=[];f.candidate.set(f.urls.sourceMap,await seal(bad));await assert.rejects(f.run(f.options));
});
