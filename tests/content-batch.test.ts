import test from "node:test";
import assert from "node:assert/strict";
import { planContentBatch } from "../src/compiler/content-batch.js";
import { contentBatchFixture, sealBatchContent } from "./fixtures/content-batch.js";

test("a batch binds actual payloads, compiled encounter dependencies and public-input routes", () => {
  const f = contentBatchFixture(), before = JSON.stringify(f), plan = planContentBatch(f.manifest, f.packages);
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(plan.dependencies.encounterIds, [1000]);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(plan.runtimeAdmission, "unassessed");
  assert.equal(plan.sourceCampaignComplete, false);
  assert.deepEqual(planContentBatch(f.manifest, { ...f.packages, maps: [...f.packages.maps].reverse() }), plan);
});

test("changed payloads require fresh hashes and invalidate the bound plan even when rehashed", () => {
  const f = contentBatchFixture(), before = planContentBatch(f.manifest, f.packages);
  f.packages.maps[1]!.scripts.init![0] = { ...f.packages.maps[1]!.scripts.init![0]!, kind: "wait", seconds: 0.1 };
  assert.throws(() => planContentBatch(f.manifest, f.packages), /payload/);
  f.packages.maps[1] = sealBatchContent(f.packages.maps[1]!);
  f.packages.catalog.maps[2]!.contentHash = f.packages.maps[1]!.contentHash;
  f.packages.catalog = sealBatchContent(f.packages.catalog);
  const after = planContentBatch(f.manifest, f.packages);
  assert.notEqual(after.dependencyHash, before.dependencyHash);
  assert.equal(after.manifestHash, before.manifestHash);
});

test("adding maps or encounters without continuous required routes cannot receive batch coverage", () => {
  const f = contentBatchFixture(); f.manifest.routes[0]!.requiredEncounterIds = [];
  f.manifest.routes[0]!.requiredMapIds = [1];
  const plan = planContentBatch(f.manifest, f.packages);
  assert.ok(plan.diagnostics.some(d => d.code === "BATCH_MAP_WITHOUT_ROUTE"));
  assert.ok(plan.diagnostics.some(d => d.code === "BATCH_ENCOUNTER_WITHOUT_ROUTE"));
});

test("unknown manifest fields, hidden starting scripts and changed profiles are rejected", () => {
  const f = contentBatchFixture();
  assert.throws(() => planContentBatch({ ...f.manifest, approved: true }, f.packages));
  assert.throws(() => planContentBatch({ ...f.manifest, profile: "framework" }, f.packages), /profile/);
  f.packages.entry.scripts.hidden = [];
  f.packages.entry = sealBatchContent(f.packages.entry);
  assert.throws(() => planContentBatch(f.manifest, f.packages), /map\/scripts/);
});

test("a development walking policy cannot enter a source batch or hide outside its map graph", () => {
  const f = contentBatchFixture();
  f.packages.entry.walkEncounters = { kind: "framework-walk-encounters-v1", id: "synthetic", minSteps: 1, maxSteps: 2,
    transportationIds: [1], parties: [{ partyId: 1000, weight: 1 }] };
  f.packages.entry = sealBatchContent(f.packages.entry);
  assert.throws(() => planContentBatch(f.manifest, f.packages), /profile/);
  f.manifest.profile = "framework";
  const profile = { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: "a".repeat(64), omissions: [] };
  f.packages.maps = f.packages.maps.map(map => sealBatchContent({ ...map, developmentProfile: profile }));
  f.packages.catalog.developmentProfile = profile;
  for (const map of f.packages.maps) f.packages.catalog.maps[map.mapId]!.contentHash = map.contentHash;
  f.packages.catalog = sealBatchContent(f.packages.catalog);
  f.packages.entry = sealBatchContent({ ...f.packages.entry, developmentProfile: profile });
  assert.throws(() => planContentBatch(f.manifest, f.packages), /map\/scripts/);
});
