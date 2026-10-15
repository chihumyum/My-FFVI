import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, hash } from "../src/compiler/content.js";
import { compileFrameworkContent } from "../src/compiler/framework-content.js";
import { assessFrameworkNpcAreaWorld, parseFrameworkNpcAreaTemplate } from "../src/compiler/framework-npc-area.js";
import { frameworkNpcAreaFixture } from "./fixtures/framework-npc-area.js";
import type { WorldMapContent } from "../src/field/world.js";
const script = pathToFileURL(resolve(process.cwd(), "scripts/framework-npc-area-evidence.mjs")).href;
const resolver = pathToFileURL(resolve(process.cwd(), "scripts/source-recipe-inputs.mjs")).href;
const compiledDir = fileURLToPath(new URL("../", import.meta.url));
function seal<T extends { contentHash: string }>(raw: T): T {
  const { contentHash: _, ...body } = structuredClone(raw); return { ...body, contentHash: hash(body) } as T;
}
async function fixture(presentationFamilies = false) {
  const f = await frameworkNpcAreaFixture({presentationFamilies}), api = await import(script),
    all = assessFrameworkNpcAreaWorld(f.corpus, f.catalog, f.maps, f.template),
    old = compileFrameworkContent(f.catalog, f.maps, f.entry, presentationFamilies ? {mapAnimatedEntities:"web-field-animated-map-entities-v1"} : {}),
    candidate = compileFrameworkContent(f.catalog, f.maps, f.entry, { npcAreaAssessments: all,
      ...(presentationFamilies ? {mapAnimatedEntities:"web-field-animated-map-entities-v1" as const} : {}) }),
    proof = api.createFrameworkNpcAreaAddition({ compilerDigest: "e".repeat(64), assessments: all,
      catalog: candidate.catalog, entry: candidate.entry });
  const urls = { sourceEntry: "/framework/new-game.json", sourceWorld: "/framework/world/catalog.json",
    sourceMap: "/framework/world/maps/" + f.firstMap + ".json" },
    current = new Map<string, unknown>([[urls.sourceEntry, old.entry], [urls.sourceWorld, old.catalog],
      ...old.maps.map(map => ["/framework/world/maps/" + map.mapId + ".json", map] as [string, unknown])]),
    next = new Map<string, unknown>([[urls.sourceEntry, candidate.entry], [urls.sourceWorld, candidate.catalog],
      ...candidate.maps.map(map => ["/framework/world/maps/" + map.mapId + ".json", map] as [string, unknown])]),
    recipe = { kind: "initialized-systems-recipe-v1", id: "controlled-global-area", ...Object.fromEntries(
      Object.entries(urls).map(([role, url]) => [role, { url, contentHash: (current.get(url) as { contentHash: string }).contentHash }])) };
  let reads = 0;
  // This explicit controlled source corpus uses the same complete pure
  // assessment as production. The filesystem reader is separately exercised
  // by the actual original-map cohort, not replaced in production.
  const evidence = async (p: typeof proof, mapId: number | null = null) => {
    parseFrameworkNpcAreaTemplate(p.template);
    assert.deepEqual(p.maps.map((row: { mapId: number }) => row.mapId), f.maps.map(map => map.mapId));
    if (mapId === null) return { template: f.template };
    reads++;
    const sourceMap = f.maps.find(map => map.mapId === mapId)!;
    const assessment = all.find(row => row.record.mapId === mapId)!;
    assert.equal(p.maps.find((row: { mapId: number }) => row.mapId === mapId).assessmentHash, assessment.contentHash);
    return { sourceMap, assessment };
  };
  const run = (addition: unknown = proof, reader: unknown = evidence) => import(resolver).then(module => module.resolveSourceRecipeInputs({
    compiledDir, recipePath: "content-batches/controlled-global-area.recipe.json", recipeBytes: JSON.stringify(recipe),
    readCurrentJson: async (url: string) => current.get(url), readCandidateJson: async (url: string) => next.get(url),
    ...(addition === null ? {} : { frameworkNpcAreaAddition: addition }), frameworkNpcAreaEvidence: reader,
  }));
  return { ...f, api, all, old, candidate, proof, urls, current, next, recipe, evidence, run, reads: () => reads };
}
test("the explicit complete Area addition rebinds framework references while strict data and source bytes stay independent", async () => {
  const f = await fixture(), before = structuredClone({ current: f.current, next: f.next, recipe: f.recipe, proof: f.proof });
  await assert.rejects(f.run(null), /Source identity\/profile\/media changed/);
  await assert.rejects(f.run(f.proof, null), /Missing trusted NPC Area evidence/);
  const result = await f.run();
  assert.equal(result.report.frameworkNpcAreaAdditions.length, 3);
  assert.equal(result.recipe.sourceMap.contentHash, f.candidate.maps.find(map => map.mapId === f.firstMap)!.contentHash);
  const mapAudit = result.report.frameworkNpcAreaAdditions.find((row: { map: unknown }) => row.map);
  assert(mapAudit.map.derived > 0); assert.equal(mapAudit.runtimeAdmission, "unassessed"); assert.equal(mapAudit.nativeParity, false);
  assert(mapAudit.sourceIdentityAfter.physicalSourceCount > mapAudit.sourceIdentityBefore.physicalSourceCount);
  assert.equal(f.reads(), 1);
  assert.deepEqual({ current: f.current, next: f.next, recipe: f.recipe, proof: f.proof }, before);
});
test("complete assessment receipts cannot omit failed records, grant a strict profile or hide media and source mutations", async () => {
  const f = await fixture(), source = f.candidate.maps.find(map => map.mapId === f.firstMap)!;
  const checkMap = async (change: (map: WorldMapContent) => void, pattern: RegExp) => {
    const changed = structuredClone(source); change(changed); f.next.set(f.urls.sourceMap, seal(changed));
    await assert.rejects(f.run(), pattern); f.next.set(f.urls.sourceMap, source);
  };
  await checkMap(map => { map.frameworkNpcActivity!.bindings = []; }, /complete original derivation/);
  await checkMap(map => { map.frameworkNpcActivity!.diagnostics.push({code:"fake", reason:"unknown omitted", source:map.map!.source}); }, /complete original derivation/);
  await checkMap(map => { delete map.developmentProfile; }, /framework profile|Source identity\/profile\/media|strictly equal/);
  await checkMap(map => { map.map!.source.objectId = "9007199254741123"; }, /Source identity\/profile\/media/);
  await checkMap(map => { map.map!.textures.unproved = "/world-media/unproved.png"; }, /Source identity\/profile\/media/);
  const missing = structuredClone(f.proof); missing.maps.pop();
  await assert.rejects(f.run(missing), /deep-equal|equal|complete/i);
  const stale = structuredClone(f.proof); stale.maps[0].assessmentHash = "0".repeat(64);
  await assert.rejects(f.run(stale), /equal/);
});
test("proof input parsing rejects own accessor, custom array iteration and changed policies without invoking them", async () => {
  const f = await fixture(); let invoked = 0;
  const hidden = structuredClone(f.proof); Object.defineProperty(hidden.template, "random", { enumerable: true,
    get() { invoked++; return "web-xorshift32-v1"; } });
  assert.throws(() => f.api.parseFrameworkNpcAreaAddition(hidden), /own data/); assert.equal(invoked, 0);
  const array = structuredClone(f.proof); Object.setPrototypeOf(array.maps, { [Symbol.iterator]() { invoked++; return [][Symbol.iterator](); } });
  assert.throws(() => f.api.parseFrameworkNpcAreaAddition(array)); assert.equal(invoked, 0);
  const changed = structuredClone(f.proof); changed.template.random = "unity";
  await assert.rejects(f.run(changed), /policy|marker|equal|explicit/);
  assert.equal(canonical(f.api.parseFrameworkNpcAreaAddition(f.proof)), canonical(f.proof));
});


test("NPC addition preserves v101 animation and route policies/catalogs without borrowing their independent source grants", async () => {
  const f=await fixture(true),source=f.candidate.maps.find(map=>map.mapId===f.firstMap)!,before=structuredClone(source.npcRoutes);
  const result=await f.run();assert.equal(result.report.frameworkNpcAreaAdditions.length,3);
  assert.equal(source.developmentProfile.mapAnimatedEntities,"web-field-animated-map-entities-v1");
  assert.deepEqual(source.npcRoutes,before);assert.equal(result.report.sourceMapAnimationAdditions.length,0);
  assert.equal(result.report.sourceNpcRouteAdditions.length,0);
  const invalid=structuredClone(source);delete invalid.developmentProfile.mapAnimatedEntities;
  f.next.set(f.urls.sourceMap,seal(invalid));await assert.rejects(f.run(),/Source identity\/profile\/media/);
  const route=structuredClone(source);route.npcRoutes!.routes["1"]!.instructions[0]!.raw.delay_sec=.25;
  f.next.set(f.urls.sourceMap,seal(route));await assert.rejects(f.run(),/NPC route source addition requires|Source identity/);
  assert.deepEqual(source.npcRoutes,before);
});
