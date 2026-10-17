import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { contentDigest, verifyContent } from "../src/core/content-integrity.js";
import { canonical } from "../src/core/canonical.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import { compileSourceWalkEncounterDependencies } from "../src/compiler/world.js";
import type { BattleRow } from "../src/compiler/battle.js";
import type { SourceWalkEncounterDependencies } from "../src/field/world.js";

type Ref = { url: string; contentHash: string };
type Recipe = { kind: string; id: string; [key: string]: unknown };
type BattleRebinding = { kind: "compiled-battle-rebinding-v1"; url: string; previousHash: string;
  candidateHash: string; compilerDigest: string; sourceContentHash: string; fieldSourceSetHash: string; gameStateHash: string };
type BattleRebindingReport = BattleRebinding & { profile: string;
  sourceIdentityBefore: { physicalSourceCount: number; physicalSourceHash: string };
  sourceIdentityAfter: { physicalSourceCount: number; physicalSourceHash: string } };
type Inputs = { recipePath: string; recipeBytes: Uint8Array | string;
  readCurrentJson: (url: string) => Promise<unknown>; readCandidateJson: (url: string) => Promise<unknown>;
  sourceWalkEvidence?: (map: WorldMapContent) => Promise<SourceWalkEncounterDependencies>;
  battleRebindings?: BattleRebinding[] };
type Result = { recipe: Recipe; report: { kind: string; id: string; recipeSha256: string;
  changes: { pointer: string; role: string; url: string; oldHash: string; newHash: string }[];
  dependencyRebindings: { pointer: string; role: string; url: string; mapId: number; oldHash: string; newHash: string }[];
  sourceIdentities: { role: string; profile: string; physicalSourceHash: string; mediaBindingsHash: string }[];
  sourceEvidenceEnrichments: { role: string; mapId: number; physicalSourceBefore: {count: number}; physicalSourceAfter: {count: number} }[];
  battleCapabilityRebindings: (BattleRebindingReport & { pointer: string; role: string })[] } };
const script = pathToFileURL(resolve(process.cwd(), "scripts/source-recipe-inputs.mjs")).href;
const compiledDir = fileURLToPath(new URL("../", import.meta.url));
const run = async (input: Inputs): Promise<Result> =>
  (await import(script)).resolveSourceRecipeInputs({ ...input, compiledDir });
const resolveBattle = async (input: Pick<Inputs, "readCurrentJson" | "readCandidateJson" | "battleRebindings"> &
  { reference: Ref }): Promise<{ reference: Ref; report: BattleRebindingReport | null }> =>
  (await import(script)).resolveCompiledBattleReference({ ...input, compiledDir });
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const frameworkProfile = (sourceContentHash: string) => ({ kind: "framework-development-v1" as const,
  policy: "omit-anonymous-environment-particles-v1" as const, sourceContentHash, omissions: [] });

/** Real shared content shapes and digest implementation over controlled source
 * fixture data. No source asset, story reachability or executable batch claim. */
async function fixture() {
  const f = sourceNewGameFixture(), oldMap = await seal(f.map), battle = await seal(f.battle);
  const mapURL = "/world/maps/" + oldMap.mapId + ".json";
  const oldWorld: WorldCatalog = await seal({ ...f.world, maps: { ...f.world.maps,
    [oldMap.mapId]: { ...f.world.maps[oldMap.mapId]!, url: mapURL, contentHash: oldMap.contentHash } } });
  const oldEntry = await seal({ ...f.content, mapContentHash: oldMap.contentHash,
    worldCatalogHash: oldWorld.contentHash, battleCatalogHash: battle.contentHash });
  const mapDraft = structuredClone(oldMap), site = mapDraft.scripts.reserved![0]!;
  mapDraft.scripts.reserved![0] = { kind: "nop", script: site.script, index: site.index, source: structuredClone(site.source) };
  const newMap = await seal(mapDraft);
  const newWorld: WorldCatalog = await seal({ ...oldWorld, maps: { ...oldWorld.maps,
    [newMap.mapId]: { ...oldWorld.maps[newMap.mapId]!, contentHash: newMap.contentHash } } });
  const newEntry = await seal({ ...oldEntry, mapContentHash: newMap.contentHash, worldCatalogHash: newWorld.contentHash });
  const urls = { sourceEntry: "/game/source-new-game.json", sourceBattle: "/game/source-catalog.json",
    sourceWorld: "/world/catalog.json", sourceMap: mapURL };
  const current = new Map<string, unknown>([[urls.sourceEntry, oldEntry], [urls.sourceBattle, battle],
    [urls.sourceWorld, oldWorld], [mapURL, oldMap]]);
  const candidate = new Map<string, unknown>([[urls.sourceEntry, newEntry], [urls.sourceBattle, battle],
    [urls.sourceWorld, newWorld], [mapURL, newMap]]);
  const recipe: Recipe = { kind: "initialized-systems-recipe-v1", id: "controlled-source-rebind",
    ...Object.fromEntries(Object.entries(urls).map(([role, url]) => [role, { url,
      contentHash: (current.get(url) as { contentHash: string }).contentHash }])),
    authorData: { unchangedHash: oldMap.contentHash, entrance: 1, instructions: ["Do not replace this hash"] } };
  const input = (): Inputs => ({ recipePath: "content-batches/controlled.recipe.json", recipeBytes: encode(recipe),
    readCurrentJson: async url => current.get(url), readCandidateJson: async url => candidate.get(url) });
  return { current, candidate, recipe, input, urls, oldMap, newMap, oldWorld, newWorld, oldEntry, newEntry, battle };
}

async function walkingFixture() {
  const f = await fixture();
  const row = (table: string, id: number, values: Record<string,string>): BattleRow => ({values,
    source: {file:"controlled-master.bundle",assetPath:table,objectId:"-9007199254740997",serializedFile:"controlled-master",rowId:String(id)} });
  const master = row("map.csv",f.newMap.mapId,{id:String(f.newMap.mapId),monster_set_id:"11",encount_area_grid_id:"0"});
  const set = row("monster_set.csv",11,{id:"11",...Object.fromEntries(Array.from({length:16},(_,i)=>[
    ["monster_set"+(i+1),i===0?"375":"0"],["monster_set"+(i+1)+"_rate","0"]]).flat())});
  const expected = compileSourceWalkEncounterDependencies({row(table,id){
    if(table==="map.csv"&&Number(id)===f.newMap.mapId)return master;
    if(table==="monster_set.csv"&&Number(id)===11)return set;
    throw new Error("Missing controlled table row");
  }},f.newMap.mapId);
  const update = async (raw: WorldMapContent) => {
    const map = await seal(raw),world = await seal({...f.newWorld,maps:{...f.newWorld.maps,
      [map.mapId]:{...f.newWorld.maps[map.mapId]!,contentHash:map.contentHash}}});
    const entry = await seal({...f.newEntry,mapContentHash:map.contentHash,worldCatalogHash:world.contentHash});
    f.candidate.set(f.urls.sourceMap,map);f.candidate.set(f.urls.sourceWorld,world);f.candidate.set(f.urls.sourceEntry,entry);
  };
  await update({...f.newMap,sourceWalkEncounters:expected});
  const input = (): Inputs => ({...f.input(),sourceWalkEvidence:async map=>{
    assert.equal(map.mapId,f.newMap.mapId);return structuredClone(expected);
  }});
  return {...f,expected,update,walkingInput:input};
}

test("new walking source evidence only enriches identities after exact original table-row reconstruction", async () => {
  const f = await walkingFixture(),before=structuredClone({current:f.current,candidate:f.candidate,recipe:f.recipe});
  const result=await run(f.walkingInput());
  assert.equal(result.report.sourceEvidenceEnrichments.length,1);
  const proof=result.report.sourceEvidenceEnrichments[0]!;
  assert.equal(proof.role,"sourceMap");assert.equal(proof.mapId,f.newMap.mapId);
  assert.ok(proof.physicalSourceAfter.count>proof.physicalSourceBefore.count);
  assert.equal((result.recipe.sourceMap as Ref).contentHash,(f.candidate.get(f.urls.sourceMap) as WorldMapContent).contentHash);
  assert.deepEqual({current:f.current,candidate:f.candidate,recipe:f.recipe},before);
});

test("resealed walking rates, table references or unrelated physical assets cannot borrow evidence enrichment", async () => {
  const f=await walkingFixture();
  for(const change of [
    (map:WorldMapContent)=>{map.sourceWalkEncounters!.set!.values.monster_set1_rate="1";map.sourceWalkEncounters!.slots[0]!.rawRate="1";map.sourceWalkEncounters!.slots[0]!.rate=1;},
    (map:WorldMapContent)=>{map.sourceWalkEncounters!.set!.source.objectId="99999";},
  ]) {
    const map={...structuredClone(f.newMap),sourceWalkEncounters:structuredClone(f.expected)};change(map);await f.update(map);
    await assert.rejects(run(f.walkingInput()),/differs from the verified original table rows/);
  }
  const map={...structuredClone(f.newMap),sourceWalkEncounters:structuredClone(f.expected)};
  map.map!.source.objectId="99999";await f.update(map);
  await assert.rejects(run(f.walkingInput()),/Source identity\/profile\/media changed/);
});

test("declared source pins rebind a new compiled program and dependency closure without editing callers", async () => {
  const f = await fixture(), linked = "/content-packages/source/maps/" + f.newMap.mapId + ".json";
  const linkedWorld = await seal({ ...f.newWorld, maps: { ...f.newWorld.maps,
    [f.newMap.mapId]: { ...f.newWorld.maps[f.newMap.mapId]!, url: linked } } });
  const linkedEntry = await seal({ ...f.newEntry, worldCatalogHash: linkedWorld.contentHash });
  f.candidate.set(f.urls.sourceWorld, linkedWorld); f.candidate.set(f.urls.sourceEntry, linkedEntry);
  f.candidate.set(linked, f.newMap);
  const before = structuredClone({ recipe: f.recipe, current: f.current, candidate: f.candidate });
  const raw = encode(f.recipe), output = await run({ ...f.input(), recipeBytes: raw });
  assert.equal(output.report.kind, "source-recipe-inputs-v1"); assert.equal(output.report.id, f.recipe.id);
  assert.equal(output.report.recipeSha256, hashBytes(raw));
  assert.deepEqual(output.report.changes.map(change => change.pointer),
    ["/sourceEntry/contentHash", "/sourceWorld/contentHash", "/sourceMap/contentHash"]);
  assert.equal((output.recipe.sourceMap as Ref).contentHash, f.newMap.contentHash);
  assert.equal((output.recipe.sourceBattle as Ref).contentHash, f.battle.contentHash);
  assert.deepEqual(output.recipe.authorData, f.recipe.authorData, "Unrelated matching hash is not globally replaced");
  assert.equal(output.report.sourceIdentities.length, 4);
  for (const role of Object.keys(f.urls)) assert.equal((output.recipe[role] as Ref).url, (f.recipe[role] as Ref).url);
  (output.recipe.sourceMap as Ref).contentHash = "e".repeat(64);
  assert.deepEqual({ recipe: f.recipe, current: f.current, candidate: f.candidate }, before);
  assert.equal(hashBytes(raw), output.report.recipeSha256);
  for (const value of f.candidate.values()) await verifyContent(value as { contentHash: string });
  f.candidate.set(linked, f.oldMap);
  await assert.rejects(run(f.input()), /Linked map\/recipe alias mismatch/);
});

test("current expected hashes and both payload bodies must verify before rebind", async () => {
  const f = await fixture(), wrongPin = structuredClone(f.recipe);
  (wrongPin.sourceMap as Ref).contentHash = "f".repeat(64);
  await assert.rejects(run({ ...f.input(), recipeBytes: encode(wrongPin) }), /identity mismatch/);
  const tampered = structuredClone(f.newMap); tampered.name = "Unsealed mutation";
  f.candidate.set(f.urls.sourceMap, tampered);
  await assert.rejects(run(f.input()), /payload changed/);
  f.candidate.delete(f.urls.sourceMap);
  await assert.rejects(run(f.input()), /Missing content/);
  f.candidate.set(f.urls.sourceMap, await seal({ ...f.newMap, kind: "world-development" as WorldMapContent["kind"] }));
  await assert.rejects(run(f.input()), /kind mismatch/);
});

test("same logical URL cannot change source, parent, media, physical map, area or profile identity", async () => {
  const f = await fixture();
  const mutations: ((map: WorldMapContent) => void)[] = [
    map => { map.sourceSetHash = "another-corpus"; },
    map => { map.parentSourceSetHash = "another-build"; },
    map => { map.mediaSourceSetHash = "another-media"; },
    map => { map.map!.source.objectId = "9999"; },
    map => { map.mapId++; map.map!.identity!.mapId++; },
    map => { map.areaId++; map.map!.identity!.areaId++; },
    map => { map.developmentProfile = frameworkProfile(f.oldMap.contentHash); },
    map => { map.map!.textures.changed = "/world-media/different.png"; },
  ];
  for (const mutate of mutations) {
    const map = structuredClone(f.newMap); mutate(map); f.candidate.set(f.urls.sourceMap, await seal(map));
    await assert.rejects(run(f.input()), /Source identity\/profile\/media changed/);
  }
});

test("entry initialization remains exact and every declared sibling dependency must match", async () => {
  const f = await fixture();
  for (const mutate of [
    (entry: typeof f.newEntry) => { entry.entry.entrance++; },
    (entry: typeof f.newEntry) => { entry.puppetCatalog.characteristics = !entry.puppetCatalog.characteristics; },
    (entry: typeof f.newEntry) => { entry.factory = { ...entry.factory, unexpected: true } as typeof entry.factory; },
  ]) {
    const entry = structuredClone(f.newEntry); mutate(entry);
    f.candidate.set(f.urls.sourceEntry, await seal(entry));
    await assert.rejects(run(f.input()), /initialization semantics changed/);
  }
  f.candidate.set(f.urls.sourceEntry, f.oldEntry);
  await assert.rejects(run(f.input()), /Entry\/world dependency mismatch/);
  f.candidate.set(f.urls.sourceEntry, f.newEntry);
  f.candidate.set(f.urls.sourceMap, f.oldMap);
  await assert.rejects(run(f.input()), /Map\/world dependency mismatch/);
});

test("unknown, missing, ambiguous and noncanonical reference forms never authorize replacement", async () => {
  const f = await fixture();
  const recipes: Recipe[] = [
    { ...f.recipe, extraReference: f.recipe.sourceMap },
    { ...f.recipe, sourceMap: { ...(f.recipe.sourceMap as Ref), trusted: true } },
    { ...f.recipe, sourceMap: { url: f.urls.sourceMap } },
    { ...f.recipe, sourceMaps: { world: f.recipe.sourceMap } },
    { ...f.recipe, sourceMaps: { world: f.recipe.sourceMap, location: f.recipe.sourceMap, other: f.recipe.sourceMap } },
    { ...f.recipe, sourceMaps: { world: f.recipe.sourceMap,
      location: { ...(f.recipe.sourceMap as Ref), contentHash: "e".repeat(64) } } },
    { ...f.recipe, sourceMap: { ...(f.recipe.sourceMap as Ref), url: "/world/../game/map.json" } },
    { ...f.recipe, sourceMap: { ...(f.recipe.sourceMap as Ref), url: "/content-batches/other/map.json" } },
    { kind: "unknown", id: "no-refs" },
  ];
  for (const recipe of recipes) await assert.rejects(run({ ...f.input(), recipeBytes: encode(recipe) }));
  const repeated = JSON.stringify(f.recipe).replace('"id":', '"id":"earlier","id":');
  await assert.rejects(run({ ...f.input(), recipeBytes: repeated }), /duplicate recipe key/);
});

test("battle and base-field hashes stay fixed while only the framework source dependency hash may change", async () => {
  const f = await fixture(), ordinary = "/content-batches/ordinary-battles/battle.json";
  const oldWorld = await seal({ ...f.oldWorld, developmentProfile: frameworkProfile("a".repeat(64)) });
  const newWorld = await seal({ ...f.newWorld, developmentProfile: frameworkProfile("b".repeat(64)) });
  const baseField = await seal({ contentHash: "", kind: "field-development", sourceSetHash: f.oldMap.sourceSetHash,
    parentSourceSetHash: f.oldMap.parentSourceSetHash, map: structuredClone(f.oldMap.map), scripts: f.oldMap.scripts });
  const urls = { baseField: "/game/base.json", battle: ordinary, baseWorld: "/framework/world/catalog.json" };
  const current = new Map<string, unknown>([[urls.baseField, baseField], [urls.battle, f.battle], [urls.baseWorld, oldWorld]]);
  const candidate = new Map(current); candidate.set(urls.baseWorld, newWorld);
  const recipe = { kind: "systems-playground-recipe-v1", id: "controlled-framework", ...Object.fromEntries(
    Object.entries(urls).map(([role, url]) => [role, { url, contentHash: (current.get(url) as Ref).contentHash }])) };
  const input = { recipePath: "controlled.recipe.json", recipeBytes: encode(recipe),
    readCurrentJson: async (url: string) => current.get(url), readCandidateJson: async (url: string) => candidate.get(url) };
  const result = await run(input); assert.equal(result.report.changes.length, 1);
  assert.equal(result.report.sourceIdentities.find(identity => identity.role === "baseWorld")!.profile, "framework");
  candidate.set(urls.battle, await seal({ ...f.battle, common: { ...f.battle.common, limitations: ["Changed"] } }));
  await assert.rejects(run(input), /retain battle content unchanged/);
  candidate.set(urls.battle, f.battle);
  candidate.set(urls.baseField, await seal({ ...baseField, scripts: {} }));
  await assert.rejects(run(input), /retain baseField content unchanged/);
  candidate.set(urls.baseField, baseField);
  candidate.set(urls.baseWorld, await seal({ ...newWorld, developmentProfile: {
    ...newWorld.developmentProfile, transportation: "walking-magitek-framework-v1" } }));
  await assert.rejects(run(input), /Source identity\/profile\/media changed/);
});

async function battleCapabilityFixture() {
  const f = await fixture();
  const before: typeof f.battle = await seal({ ...f.battle, common: { ...f.battle.common,
    sourceContentHash: "a".repeat(64), fieldSourceSetHash: "b".repeat(64),
    sprites: { ...f.battle.common.sprites, controlled: { file: "/battle/controlled.png", width: 16, height: 16 } } } });
  const after = await seal({ ...before, common: { ...before.common,
    limitations: [...before.common.limitations, "Controlled compiler capability metadata"],
    conditions: { ...before.common.conditions, source: { file: "controlled-condition.bundle", assetPath: "condition.csv",
      objectId: "-9007199254740997", serializedFile: "controlled-condition", sha256: "e".repeat(64) } } } });
  const proof: BattleRebinding = { kind: "compiled-battle-rebinding-v1", url: f.urls.sourceBattle,
    previousHash: before.contentHash, candidateHash: after.contentHash, compilerDigest: "c".repeat(64),
    sourceContentHash: before.common.sourceContentHash, fieldSourceSetHash: before.common.fieldSourceSetHash,
    gameStateHash: await contentDigest(before.gameState) };
  f.current.set(f.urls.sourceBattle, before); f.candidate.set(f.urls.sourceBattle, after);
  f.current.set(f.urls.sourceEntry, await seal({ ...f.oldEntry, battleCatalogHash: before.contentHash }));
  f.candidate.set(f.urls.sourceEntry, await seal({ ...f.newEntry, battleCatalogHash: after.contentHash }));
  (f.recipe.sourceBattle as Ref).contentHash = before.contentHash;
  (f.recipe.sourceEntry as Ref).contentHash = (f.current.get(f.urls.sourceEntry) as Ref).contentHash;
  const input = (): Inputs => ({ ...f.input(), battleRebindings: [proof] });
  return { ...f, before, after, proof, authorizedInput: input };
}

test("an exact compiler proof rebinds catalog capabilities and siblings while preserving both source identities", async () => {
  const f = await battleCapabilityFixture(), raw = encode(f.recipe);
  const original = canonical({ current: [...f.current], candidate: [...f.candidate], recipe: f.recipe, proof: f.proof });
  await assert.rejects(run(f.input()), /retain sourceBattle content unchanged/);
  const output = await run({ ...f.authorizedInput(), recipeBytes: raw });
  assert.equal((output.recipe.sourceBattle as Ref).contentHash, f.after.contentHash);
  assert.equal((output.recipe.sourceEntry as Ref).contentHash, (f.candidate.get(f.urls.sourceEntry) as Ref).contentHash);
  assert.equal(output.report.recipeSha256, hashBytes(raw));
  assert.equal(output.report.battleCapabilityRebindings.length, 1);
  const report = output.report.battleCapabilityRebindings[0]!;
  assert.equal(report.pointer, "/sourceBattle"); assert.equal(report.role, "sourceBattle");
  assert.equal(report.previousHash, f.before.contentHash); assert.equal(report.candidateHash, f.after.contentHash);
  assert.equal(report.compilerDigest, f.proof.compilerDigest); assert.equal(report.gameStateHash, f.proof.gameStateHash);
  assert.ok(report.sourceIdentityAfter.physicalSourceCount > report.sourceIdentityBefore.physicalSourceCount);
  assert.notEqual(report.sourceIdentityBefore.physicalSourceHash, report.sourceIdentityAfter.physicalSourceHash);
  assert.equal(output.report.sourceIdentities.find(row => row.role === "sourceBattle")!.physicalSourceHash,
    report.sourceIdentityBefore.physicalSourceHash, "Old evidence is not normalized to candidate evidence");
  report.sourceIdentityAfter.physicalSourceCount = -1;
  assert.equal(canonical({ current: [...f.current], candidate: [...f.candidate], recipe: f.recipe, proof: f.proof }), original);
  assert.equal(hashBytes(raw), output.report.recipeSha256);
  f.candidate.set(f.urls.sourceEntry, await seal({ ...f.newEntry, battleCatalogHash: f.before.contentHash }));
  await assert.rejects(run(f.authorizedInput()), /Entry\/battle dependency mismatch/);
});

test("the ordinary base reference helper shares exact proof admission and returns detached unchanged references", async () => {
  const f = await battleCapabilityFixture(), url = "/game/opening-playable.json";
  const reference = { url, contentHash: f.before.contentHash }, proof = { ...f.proof, url };
  const readCurrentJson = async (actual: string) => { assert.equal(actual, url); return f.before; };
  const unchanged = await resolveBattle({ reference, readCurrentJson, readCandidateJson: readCurrentJson });
  assert.deepEqual(unchanged.reference, reference); assert.notEqual(unchanged.reference, reference);
  assert.equal(unchanged.report, null);
  const input = { reference, readCurrentJson, readCandidateJson: async (actual: string) => {
    assert.equal(actual, url); return f.after;
  } };
  await assert.rejects(resolveBattle(input), /retain battle content unchanged/);
  const output = await resolveBattle({ ...input, battleRebindings: [proof] });
  assert.deepEqual(output.reference, { url, contentHash: f.after.contentHash });
  assert.equal(output.report!.compilerDigest, proof.compilerDigest);
  output.reference.contentHash = "f".repeat(64); output.report!.compilerDigest = "f".repeat(64);
  assert.equal(reference.contentHash, f.before.contentHash); assert.equal(proof.compilerDigest, f.proof.compilerDigest);
  await assert.rejects(resolveBattle({ ...input, battleRebindings: [f.proof] }), /retain battle content unchanged/,
    "A source catalog proof cannot authorize a different logical catalog URL");
});

test("compiled catalog proof never authorizes source, owner, profile or media changes", async () => {
  const f = await battleCapabilityFixture();
  const cases: { mutate: (value: typeof f.after) => void; error: RegExp }[] = [
    { mutate: value => { value.common.sourceContentHash = "d".repeat(64); }, error: /source content mismatch/ },
    { mutate: value => { value.common.fieldSourceSetHash = "d".repeat(64); }, error: /field source mismatch/ },
    { mutate: value => { value.gameState.initialGil++; }, error: /owned initializer mismatch/ },
    { mutate: value => { value.gameState.sourceNewGame!.gil++; }, error: /owned initializer mismatch/ },
    { mutate: value => { value.common.profile = "foreign" as typeof value.common.profile; }, error: /common profile changed/ },
    { mutate: value => { Object.assign(value, { developmentProfile: frameworkProfile(f.before.contentHash) }); },
      error: /source\/profile\/media identity changed/ },
    { mutate: value => { Object.assign(value, { parentSourceSetHash: "d".repeat(64) }); },
      error: /source\/profile\/media identity changed/ },
    { mutate: value => { value.common.sprites.changed = { file: "/battle/different.png", width: 16, height: 16 }; },
      error: /media bindings changed/ },
    { mutate: value => { const key = Object.keys(value.common.sprites)[0]!; value.common.sprites[key]!.width++; },
      error: /media bindings changed/ },
  ];
  for (const entry of cases) {
    const value = structuredClone(f.after); entry.mutate(value); const after = await seal(value);
    f.candidate.set(f.urls.sourceBattle, after);
    const proof = { ...f.proof, candidateHash: after.contentHash }, original = canonical({ after, proof });
    await assert.rejects(run({ ...f.input(), battleRebindings: [proof] }), entry.error);
    assert.equal(canonical({ after, proof }), original);
  }
});

test("wrong, ambiguous or malformed compiler proof cannot weaken old pins or payload validation", async () => {
  const f = await battleCapabilityFixture(), original = canonical({ proof: f.proof, recipe: f.recipe });
  for (const key of ["previousHash", "candidateHash", "sourceContentHash", "fieldSourceSetHash", "gameStateHash"] as const)
    await assert.rejects(run({ ...f.input(), battleRebindings: [{ ...f.proof, [key]: "d".repeat(64) }] }), /mismatch/);
  const malformed: unknown[] = [
    [{ ...f.proof, compilerDigest: "not-a-digest" }], [{ ...f.proof, url: "/game/../source-catalog.json" }],
    [{ ...f.proof, sourceAdmission: true }], [{ ...f.proof, kind: "guessed-proof" }], [f.proof, f.proof],
    new Array(1), [Object.defineProperty({ ...f.proof }, "compilerDigest", { enumerable: true, get() {
      throw new Error("Getter must not be read");
    } })],
  ];
  for (const battleRebindings of malformed)
    await assert.rejects(run({ ...f.input(), battleRebindings: battleRebindings as BattleRebinding[] }),
      /compiled battle|Battle rebindings/);
  assert.equal(canonical({ proof: f.proof, recipe: f.recipe }), original);
  const badPin = structuredClone(f.recipe); (badPin.sourceBattle as Ref).contentHash = "d".repeat(64);
  await assert.rejects(run({ ...f.authorizedInput(), recipeBytes: encode(badPin) }), /identity mismatch/);
  const unsealed = structuredClone(f.after); unsealed.common.limitations.push("Late mutation");
  f.candidate.set(f.urls.sourceBattle, unsealed);
  await assert.rejects(run(f.authorizedInput()), /payload changed/);
});

test("unpinned development strings remain unchanged without invented pins, reads or mutations", async () => {
  const recipe: Recipe = { kind: "development-content-batch-recipe-v1", id: "controlled-legacy",
    baseField: "game/narshe.json", battle: "content-batches/ordinary-battles/battle.json",
    world: "framework/world/catalog.json", manifest: { routes: [{ inputs: [{ kind: "save-restore" }] }] } };
  const bytes = encode(recipe), old = canonical(recipe);
  const failRead = async () => { throw new Error("Unpinned strings must not become automatic references"); };
  const result = await run({ recipePath: "legacy.recipe.json", recipeBytes: bytes,
    readCurrentJson: failRead, readCandidateJson: failRead });
  assert.equal(canonical(result.recipe), old); assert.notEqual(result.recipe, recipe);
  assert.deepEqual(result.report.changes, []); assert.deepEqual(result.report.sourceIdentities, []);
  assert.equal(result.report.recipeSha256, hashBytes(bytes));
  result.recipe.world = "changed"; assert.equal(canonical(recipe), old);
});

async function omissionFixture(changeStrict?: (map: WorldMapContent) => void) {
  const f = await fixture(), source = { ...f.oldMap.map!.source, pointer: "/layers/0/objects/1" };
  const strictDraft = structuredClone(f.oldMap);
  const entity = { ...strictDraft.map!.entities[0]!, id: "entity_default:0:1", objectId: 0, kind: 11, source };
  strictDraft.map!.entities = [...strictDraft.map!.entities, entity];
  strictDraft.map!.groups!.entity_default!.entities = [...strictDraft.map!.entities];
  const beforeStrict = await seal(strictDraft), nextDraft = structuredClone(beforeStrict);
  nextDraft.scripts = structuredClone(f.newMap.scripts); changeStrict?.(nextDraft);
  const afterStrict = await seal(nextDraft);
  const omission = (map: WorldMapContent) => ({ kind: "field-effect" as const, mapId: map.mapId,
    group: "entity_default", entityId: entity.id, source: structuredClone(source),
    sourceMapContentHash: map.contentHash, reason: "Controlled explicit presentation omission" });
  const profile = (map: WorldMapContent) => ({ ...frameworkProfile(map.contentHash), omissions: [omission(map)] });
  const derive = async (strict: WorldMapContent) => {
    const map = structuredClone(strict);
    map.map!.entities = map.map!.entities.filter(value => value.id !== entity.id);
    map.map!.groups!.entity_default!.entities = map.map!.groups!.entity_default!.entities.filter(value => value.id !== entity.id);
    return seal({ ...map, developmentProfile: profile(strict) });
  };
  const beforeMap = await derive(beforeStrict), afterMap = await derive(afterStrict);
  const mapURL = "/framework/world/maps/" + f.oldMap.mapId + ".json";
  const world = async (map: WorldMapContent, strict: WorldMapContent) => seal({ ...f.oldWorld,
    developmentProfile: profile(strict), maps: { [map.mapId]: { ...f.oldWorld.maps[map.mapId]!, url: mapURL, contentHash: map.contentHash } } });
  const beforeWorld = await world(beforeMap, beforeStrict), afterWorld = await world(afterMap, afterStrict);
  const beforeEntry = await seal({ ...f.oldEntry, developmentProfile: profile(beforeStrict),
    mapContentHash: beforeMap.contentHash, worldCatalogHash: beforeWorld.contentHash });
  const afterEntry = await seal({ ...f.oldEntry, developmentProfile: profile(afterStrict),
    mapContentHash: afterMap.contentHash, worldCatalogHash: afterWorld.contentHash });
  const urls = { sourceEntry: "/framework/new-game.json", sourceWorld: "/framework/world/catalog.json", sourceMap: mapURL };
  const strictURL = "/world/maps/" + beforeStrict.mapId + ".json";
  const current = new Map<string, unknown>([[urls.sourceEntry, beforeEntry], [urls.sourceWorld, beforeWorld],
    [mapURL, beforeMap], [strictURL, beforeStrict]]);
  const candidate = new Map<string, unknown>([[urls.sourceEntry, afterEntry], [urls.sourceWorld, afterWorld],
    [mapURL, afterMap], [strictURL, afterStrict]]);
  const recipe: Recipe = { kind: "controlled-framework-recipe-v1", id: "controlled-omission-pins",
    ...Object.fromEntries(Object.entries(urls).map(([role, url]) => [role,
      { url, contentHash: (current.get(url) as { contentHash: string }).contentHash }])) };
  const input = (): Inputs => ({ recipePath: "controlled-omissions.recipe.json", recipeBytes: encode(recipe),
    readCurrentJson: async url => current.get(url), readCandidateJson: async url => candidate.get(url) });
  return { current, candidate, recipe, input, urls, strictURL, beforeStrict, afterStrict, beforeMap, afterMap, beforeEntry, afterEntry };
}

test("framework entry and omissions rebind only verified strict-map hashes while source policy stays exact", async () => {
  const f = await omissionFixture(), original = canonical([...f.current]), candidate = canonical([...f.candidate]);
  const result = await run(f.input());
  assert.equal(result.report.changes.length, 3);
  assert.deepEqual(result.report.dependencyRebindings.map(change => change.pointer), [
    "/sourceEntry/developmentProfile/omissions/0/sourceMapContentHash",
    "/sourceWorld/developmentProfile/omissions/0/sourceMapContentHash",
    "/sourceMap/developmentProfile/omissions/0/sourceMapContentHash",
  ]);
  for (const change of result.report.dependencyRebindings) {
    assert.equal(change.url, f.strictURL); assert.equal(change.mapId, f.beforeStrict.mapId);
    assert.equal(change.oldHash, f.beforeStrict.contentHash); assert.equal(change.newHash, f.afterStrict.contentHash);
  }
  assert.equal((result.recipe.sourceEntry as Ref).url, f.urls.sourceEntry);
  assert.equal(canonical([...f.current]), original); assert.equal(canonical([...f.candidate]), candidate);
  assert.equal(f.afterMap.developmentProfile.omissions[0]!.sourceMapContentHash, f.afterStrict.contentHash,
    "The comparison projection does not normalize the actual candidate payload");
});

test("omission rebinding rejects fabricated pins, removed members, changed reasons and missing strict entities", async () => {
  for (const field of ["hash", "reason", "source", "removed", "missing-field"] as const) {
    const f = await omissionFixture(), bad = structuredClone(f.afterMap);
    if (field === "hash") bad.developmentProfile.omissions[0]!.sourceMapContentHash = "f".repeat(64);
    if (field === "reason") bad.developmentProfile.omissions[0]!.reason = "Different policy";
    if (field === "source") bad.developmentProfile.omissions[0]!.source.pointer = "/layers/0/objects/2";
    if (field === "removed") bad.developmentProfile.omissions = [];
    if (field === "missing-field") delete (bad.developmentProfile.omissions[0] as Partial<typeof bad.developmentProfile.omissions[0]>).reason;
    f.candidate.set(f.urls.sourceMap, await seal(bad));
    const before = canonical([...f.candidate]);
    await assert.rejects(run(f.input()), /[Oo]mission/); assert.equal(canonical([...f.candidate]), before);
  }
  const missingEntity = await omissionFixture(map => {
    map.map!.groups!.entity_default!.entities = map.map!.groups!.entity_default!.entities.filter(entity => entity.kind !== 11);
    map.map!.entities = map.map!.entities.filter(entity => entity.kind !== 11);
  });
  await assert.rejects(run(missingEntity.input()), /[Oo]mission source/);
  const changedSource = await omissionFixture(map => { map.parentSourceSetHash = "foreign-parent"; });
  await assert.rejects(run(changedSource.input()), /Omission source identity/);
  const forgedCurrent = await omissionFixture(), beforeEntry = structuredClone(forgedCurrent.beforeEntry);
  beforeEntry.developmentProfile.omissions[0]!.sourceMapContentHash = "e".repeat(64);
  const sealed = await seal(beforeEntry); forgedCurrent.current.set(forgedCurrent.urls.sourceEntry, sealed);
  (forgedCurrent.recipe.sourceEntry as Ref).contentHash = sealed.contentHash;
  await assert.rejects(run(forgedCurrent.input()), /Omission source map dependency mismatch/);
});
