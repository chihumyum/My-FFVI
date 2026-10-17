import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileFrameworkContent, type FrameworkContentOptions } from "../src/compiler/framework-content.js";
import { canonical } from "../src/compiler/content.js";
import { WEB_LOGICAL_FIELD_EFFECTS } from "../src/core/field-logical-effects.js";
import { sourceGameContentRefsFixture } from "./fixtures/game-content-refs.js";
import { logicalEffectCatalog } from "./fixtures/logical-field-effects.js";
import { flatEffectCatalog } from "./fixtures/flat-field-effects.js";

async function fixture() {
  const f = await sourceGameContentRefsFixture("source", "/world"), maps = [f.map, f.destination];
  const effects = logicalEffectCatalog(f.catalog.sourceSetHash, f.catalog.parentSourceSetHash).catalog;
  const options: FrameworkContentOptions = { logicalFieldEffects: { catalog: effects, declaration: {
    kind: "web-logical-field-effects-declaration-v1", policy: WEB_LOGICAL_FIELD_EFFECTS,
    sourceSetHash: f.catalog.sourceSetHash, parentSourceSetHash: f.catalog.parentSourceSetHash,
    catalogHash: effects.webPolicy!.catalogHash, mapIds: maps.map(map => map.mapId),
    reason: "Controlled explicit Web display deferral; no original particle parity claim.",
  } } };
  return { ...f, maps, effects, options };
}

test("public framework derivation binds every indexed map and entry to one declared catalog without changing strict input", async () => {
  const f = await fixture(), before = canonical({catalog:f.catalog,maps:f.maps,entry:f.content,options:f.options});
  const legacy = compileFrameworkContent(f.catalog,f.maps,f.content);
  const actual = compileFrameworkContent(f.catalog,f.maps,f.content,f.options);
  assert.equal(actual.catalog.developmentProfile.logicalFieldEffects,WEB_LOGICAL_FIELD_EFFECTS);
  assert.equal(actual.entry.developmentProfile.logicalFieldEffects,WEB_LOGICAL_FIELD_EFFECTS);
  assert.equal(actual.entry.worldCatalogHash,actual.catalog.contentHash);
  assert.equal(actual.entry.mapContentHash,actual.catalog.maps[actual.entry.entry.mapId]!.contentHash);
  for(const map of actual.maps) {
    assert.equal(map.developmentProfile.logicalFieldEffects,WEB_LOGICAL_FIELD_EFFECTS);
    assert.deepEqual(map.fieldEffects,f.effects);
    const previous = legacy.maps.find(old => old.mapId === map.mapId)!;
    assert.deepEqual(map.scripts,previous.scripts); assert.deepEqual(map.map,previous.map);
    assert.deepEqual(map.blockers,previous.blockers); assert.deepEqual(map.developmentOmissions,previous.developmentOmissions);
    assert.equal(actual.catalog.maps[map.mapId]!.contentHash,map.contentHash);
  }
  assert.equal(legacy.catalog.developmentProfile.logicalFieldEffects,undefined);
  assert.deepEqual(actual.report.omissions,legacy.report.omissions);
  assert.equal(actual.report.logicalFieldEffects!.additionalOmissions,0);
  assert.equal(canonical({catalog:f.catalog,maps:f.maps,entry:f.content,options:f.options}),before);
  actual.maps[0]!.fieldEffects!.media = {};
  assert.notDeepEqual(actual.maps[0]!.fieldEffects,actual.maps[1]!.fieldEffects,"Each immutable payload owns detached metadata");
  assert.equal(canonical({catalog:f.catalog,maps:f.maps,entry:f.content,options:f.options}),before);
});

test("public framework logical policy rejects partial map declarations, source drift and forged catalog identity", async () => {
  const f = await fixture();
  for(const change of [
    (o:FrameworkContentOptions) => { o.logicalFieldEffects!.declaration.mapIds = [f.maps[0]!.mapId]; },
    (o:FrameworkContentOptions) => { o.logicalFieldEffects!.declaration.mapIds = [f.maps[0]!.mapId,f.maps[0]!.mapId]; },
    (o:FrameworkContentOptions) => { o.logicalFieldEffects!.declaration.sourceSetHash = "foreign"; },
    (o:FrameworkContentOptions) => { o.logicalFieldEffects!.catalog.webPolicy!.catalogHash = "a".repeat(64); },
    (o:FrameworkContentOptions) => { o.logicalFieldEffects!.catalog.webPolicy!.proofs.controlled_effect!.source.sha256 = "bad"; },
    (o:FrameworkContentOptions) => { o.logicalFieldEffects!.declaration.reason = " "; },
  ]) { const options = structuredClone(f.options); change(options);
    assert.throws(() => compileFrameworkContent(f.catalog,f.maps,f.content,options),/logical|Logical/); }
});

test("public map URL linking uses the same single compiled catalog and retains independently loadable strict payloads", async () => {
  const f = await fixture(), payloads = new Map<string,unknown>([["/world/catalog.json",f.catalog],["/game/source-new-game.json",f.content],
    ...f.maps.map(map => [f.catalog.maps[map.mapId]!.url,map] as [string,unknown])]);
  const before = canonical([...payloads]);
  const api = await import(pathToFileURL(resolve(process.cwd(),"scripts/link-source-prerequisites.mjs")).href);
  const linked = await api.linkSourcePrerequisites({root:process.cwd(),compiledDir:fileURLToPath(new URL("..",import.meta.url)),
    payloads,frameworkOptions:f.options});
  const world = linked.inputs.get("/framework/world/catalog.json"), entry = linked.inputs.get("/framework/new-game.json");
  assert.equal(entry.worldCatalogHash,world.contentHash);
  for(const ref of Object.values(world.maps) as {url:string;contentHash:string}[]) {
    const map = linked.payloads.get(ref.url); assert.equal(ref.contentHash,map.contentHash); assert.deepEqual(map.fieldEffects,f.effects);
    assert.equal(map.developmentProfile.logicalFieldEffects,WEB_LOGICAL_FIELD_EFFECTS);
  }
  for(const map of f.maps) assert.deepEqual(linked.payloads.get("/content-packages/source/maps/"+map.mapId+".json"),map);
  assert.equal(canonical([...payloads]),before); assert.equal(linked.report.logicalFieldEffects.groups,1);
});


test("legacy logical derivation cannot silently grant a flat projection policy", async () => {
  const f = await fixture(), legacy = compileFrameworkContent(f.catalog,f.maps,f.content,f.options);
  assert.equal(legacy.catalog.developmentProfile.fieldEffectProjection,undefined);
  assert(legacy.maps.every(map=>map.developmentProfile.fieldEffectProjection===undefined));
  const altered=structuredClone(f.options);
  altered.logicalFieldEffects!.catalog.webPolicy!.boardProjection=flatEffectCatalog().projection;
  assert.throws(()=>compileFrameworkContent(f.catalog,f.maps,f.content,altered),/explicit full-source assessment/);
  assert.deepEqual(compileFrameworkContent(f.catalog,f.maps,f.content,f.options),legacy);
});
