import test from "node:test";
import assert from "node:assert/strict";
import { hash, canonical } from "../src/compiler/content.js";
import { compileFrameworkContent } from "../src/compiler/framework-content.js";
import { assessFrameworkNpcAreaMap, assessFrameworkNpcAreaWorld, parseFrameworkNpcAreaTemplate,
  validateFrameworkNpcAreaAssessment, type FrameworkNpcAreaAssessment } from "../src/compiler/framework-npc-area.js";
import { compileFieldNpcActivitySources, deriveFrameworkNpcActivity } from "../src/compiler/field-npc-activity.js";
import { frameworkNpcAreaFixture } from "./fixtures/framework-npc-area.js";

function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...body } = value; return { ...body, contentHash: hash(body) } as T;
}
test("the complete global derivative uses the same v4/v5 host bytes and preserves strict maps, scripts, source diagnostics and owners", async () => {
  const f = await frameworkNpcAreaFixture(), before = hash({ corpus: f.corpus, maps: f.maps, catalog: f.catalog, entry: f.entry }),
    assessments = assessFrameworkNpcAreaWorld(f.corpus, f.catalog, f.maps, f.template),
    legacy = compileFrameworkContent(f.catalog, f.maps, f.entry),
    next = compileFrameworkContent(f.catalog, f.maps, f.entry, { npcAreaAssessments: assessments });
  assert.equal(next.report.npcActivity!.counts.maps, 2); assert(next.report.npcActivity!.counts.derived > 0);
  for (const sourceMap of f.maps) {
    const inventory = compileFieldNpcActivitySources(f.corpus, sourceMap.mapId), expected = inventory.definitions.map(source =>
      deriveFrameworkNpcActivity(source, { ...f.template, kind: "framework-npc-area-declaration-v1", sourceHash: source.contentHash })),
      map = next.maps.find(map => map.mapId === sourceMap.mapId)!, prior = legacy.maps.find(map => map.mapId === sourceMap.mapId)!;
    assert.deepEqual(map.frameworkNpcActivity!.bindings, expected);
    assert.deepEqual(map.frameworkNpcActivity!.diagnostics, inventory.diagnostics);
    assert.deepEqual(map.map, prior.map); assert.deepEqual(map.scripts, sourceMap.scripts); assert.deepEqual(map.blockers, prior.blockers);
    assert.deepEqual(map.sourceWalkEncounters, sourceMap.sourceWalkEncounters);
    assert.equal(map.frameworkNpcActivity!.nativeRulesVerified, false);
    const comparison = structuredClone(map); delete comparison.frameworkNpcActivity; delete comparison.developmentProfile.npcActivity;
    assert.equal(canonical(seal(comparison)), canonical(prior));
  }
  assert.equal(next.catalog.developmentProfile.npcActivity, f.template.policy);
  assert.equal(next.entry.developmentProfile.npcActivity, f.template.policy);
  assert.equal(next.entry.worldCatalogHash, next.catalog.contentHash);
  assert.equal(next.entry.mapContentHash, next.maps.find(map => map.mapId === next.entry.entry.mapId)!.contentHash);
  assert.equal(before, hash({ corpus: f.corpus, maps: f.maps, catalog: f.catalog, entry: f.entry }));
  assert.equal(legacy.report.npcActivity, undefined); assert(legacy.maps.every(map => map.frameworkNpcActivity === undefined));
});

test("one unbound Area NPC remains an explicit complete failed record while the rest are derived, never a Wait fallback", async () => {
  const f = await frameworkNpcAreaFixture(), object = (f.corpus.assets.find(asset => asset.data && typeof asset.data === "object" &&
    "layers" in asset.data && JSON.stringify(asset.data).includes('"move_type"'))!.data as { layers: { objects: { properties: { name: string; value: unknown }[] }[] }[] })
    .layers.flatMap(layer => layer.objects).find(object => object.properties.some(p => p.name === "move_type" && p.value === 2))!;
  object.properties.find(property => property.name === "link_object_id")!.value = 99999;
  const sourceHash = hash(f.corpus), assessments = assessFrameworkNpcAreaWorld(f.corpus, f.catalog, f.maps, f.template),
    next = compileFrameworkContent(f.catalog, f.maps, f.entry, { npcAreaAssessments: assessments });
  assert.equal(next.report.npcActivity!.counts.blocked, 1);
  const failed = assessments.flatMap(row => row.record.sources).find(source => source.bindingBlockers.length > 0)!;
  assert(failed); assert.equal(failed.properties.link_object_id, 99999);
  assert(assessments.flatMap(row => row.record.diagnostics).some(row => row.code === "framework-npc-area-derivation"));
  assert(!assessments.flatMap(row => row.host.bindings).some(binding => canonical(binding.source.source) === canonical(failed.source)));
  assert.equal(sourceHash, hash(f.corpus));
  // A complete failed assessment is not a runnable fallback. Real fresh
  // Session/native group preparation must retain its unresolved movement gate.
  let prepared = false;
  try { const blocked = f.make(next); prepared = true;
    assert.equal(blocked.field.stop?.kind, "unsupported");
    assert.match(JSON.stringify(blocked.field.stop), /movement controller 2|native NPC|活动|movement/i);
    assert.equal(Object.keys(blocked.field.npcActivitySnapshot).length, 0);
  } catch (error) {
    if (prepared) throw error;
    assert.match(String(error), /movement controller 2|native NPC|blocked|活动|movement/i);
  }
  for (const source of f.maps) assert.deepEqual(next.maps.find(map => map.mapId === source.mapId)!.blockers,
    compileFrameworkContent(f.catalog, f.maps, f.entry).maps.find(map => map.mapId === source.mapId)!.blockers);
});

test("missing, duplicate, sparse, foreign and stale whole-world inputs cannot replace a complete source assessment", async () => {
  const f = await frameworkNpcAreaFixture(), all = assessFrameworkNpcAreaWorld(f.corpus, f.catalog, f.maps, f.template);
  assert.throws(() => assessFrameworkNpcAreaWorld(f.corpus, f.catalog, f.maps.slice(1), f.template), /complete/);
  assert.throws(() => assessFrameworkNpcAreaWorld(f.corpus, f.catalog, [f.maps[0]!, f.maps[0]!], f.template), /index/);
  const sparse = [...f.maps]; delete sparse[0];
  assert.throws(() => assessFrameworkNpcAreaWorld(f.corpus, f.catalog, sparse, f.template), /Sparse/);
  const foreign = structuredClone(f.maps[0]!); foreign.sourceSetHash = "c".repeat(64);
  assert.throws(() => assessFrameworkNpcAreaMap(f.corpus, seal(foreign), f.template), /matching strict/);
  assert.throws(() => compileFrameworkContent(f.catalog, f.maps, f.entry, { npcAreaAssessments: all.slice(1) }), /coverage/);
  const bad = structuredClone(all[0]!); bad.record.sourceMapHash = "e".repeat(64);
  assert.throws(() => validateFrameworkNpcAreaAssessment(f.maps[0]!, seal(bad)), /binding/);
  assert.throws(() => compileFrameworkContent(f.catalog, f.maps, f.entry, { npcAreaAssessments: [all[0]!, all[0]!] }), /coverage/);
});

test("policy/program/record tampering is rejected and outputs are detached from trusted assessment data", async () => {
  const f = await frameworkNpcAreaFixture(), all = assessFrameworkNpcAreaWorld(f.corpus, f.catalog, f.maps, f.template),
    first = all.find(row => row.host.bindings.length)!;
  for (const mutate of [
    (a: FrameworkNpcAreaAssessment) => { a.host.bindings[0]!.program.sourceSpeedEnum = 6; },
    (a: FrameworkNpcAreaAssessment) => { a.record.counts.derived = 0; },
    (a: FrameworkNpcAreaAssessment) => { a.host.bindings.push(structuredClone(a.host.bindings[0]!)); a.record.counts.derived++; },
  ]) {
    const value = structuredClone(first); mutate(value);
    assert.throws(() => validateFrameworkNpcAreaAssessment(f.maps.find(map => map.mapId === first.record.mapId)!, seal(value)), /source|inventory|binding|associations/);
  }
  const next = compileFrameworkContent(f.catalog, f.maps, f.entry, { npcAreaAssessments: all });
  next.maps.find(map => map.mapId === first.record.mapId)!.frameworkNpcActivity!.bindings[0]!.program.moveSteps++;
  assert.notEqual(next.maps.find(map => map.mapId === first.record.mapId)!.frameworkNpcActivity!.bindings[0]!.program.moveSteps,
    first.host.bindings[0]!.program.moveSteps);
  let reads = 0;
  assert.throws(() => parseFrameworkNpcAreaTemplate({ ...f.template, get random() { reads++; return "web-xorshift32-v1"; } }), /fields/);
  assert.equal(reads, 0);
  assert.throws(() => parseFrameworkNpcAreaTemplate({ ...f.template, random: "unity" }), /explicit/);
});
