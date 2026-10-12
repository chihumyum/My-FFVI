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
