import assert from "node:assert/strict";
import test from "node:test";
import { planContentBatch } from "../src/compiler/content-batch.js";
import { CONTENT_BATCH_SYSTEMS } from "../src/compiler/content-batch-work-plan.js";
import { projectContentBatchWorkSet, type ContentBatchWorkSetInput } from "../src/compiler/content-batch-work-set.js";
import { contentBatchFixture } from "./fixtures/content-batch.js";

function input(): ContentBatchWorkSetInput {
  const batch = (id: string) => {
    const f = contentBatchFixture(); f.manifest.id = id + "-route";
    const plan = planContentBatch(f.manifest, f.packages);
    plan.diagnostics.push({ code: "future-source-controller", reason: "Same retained unknown in each source batch" });
    return { packageId: id, label: id + " source locations", recipePath: "content-batches/" + id + ".recipe.json",
      recipeSha256: "c".repeat(64), plan };
  };
  return { selection: { id: "source-selection", sha256: "a".repeat(64) }, runtimeSha256: "b".repeat(64),
    batches: [batch("west"), batch("east")] };
}

test("one work set preserves every selected batch and unknown source record under common systems", () => {
  const raw = input(), before = structuredClone(raw), work = projectContentBatchWorkSet(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(work.workItems.map(item => item.id), CONTENT_BATCH_SYSTEMS);
  assert.deepEqual(work.batches.map(batch => batch.packageId), ["west", "east"]);
  assert.equal(work.counts.diagnostics, raw.batches.reduce((n, batch) => n + batch.plan.diagnostics.length, 0));
  const unknown = work.workItems.find(item => item.id === "unclassified")!;
  assert.ok(unknown.diagnosticLocations.some(item => item.packageId === "west"));
  assert.ok(unknown.diagnosticLocations.some(item => item.packageId === "east"));
  for (const item of work.workItems.flatMap(group => group.diagnosticLocations)) {
    const batch = work.batches.find(batch => batch.packageId === item.packageId)!;
    assert.equal(batch.work.batchId, item.batchId);
    assert.equal(batch.work.diagnostics[item.index]!.index, item.index);
  }
  assert.equal(work.workItems.flatMap(item => item.diagnosticLocations).length, work.counts.diagnostics);
  assert.deepEqual(work.batches[0]!.work.providerAssessments.map(row => row.assessment),
    raw.batches[0]!.plan.dependencies.providerAssessments);
  assert.equal(work.runtimeAdmission, "unassessed"); assert.equal(work.sourceCampaignComplete, false);
});

test("work set identity binds selected order, actual recipe bytes, runtime and all retained batch details", () => {
  const raw = input(), first = projectContentBatchWorkSet(raw);
  assert.deepEqual(projectContentBatchWorkSet(raw), first);
  for (const edit of [
    (next: ContentBatchWorkSetInput) => { next.runtimeSha256 = "d".repeat(64); },
    (next: ContentBatchWorkSetInput) => { next.selection.sha256 = "d".repeat(64); },
    (next: ContentBatchWorkSetInput) => { next.batches[0]!.recipeSha256 = "d".repeat(64); },
    (next: ContentBatchWorkSetInput) => { next.batches.reverse(); },
    (next: ContentBatchWorkSetInput) => { next.batches[0]!.plan.diagnostics[0]!.reason += " changed"; },
  ]) {
    const next = structuredClone(raw); edit(next);
    assert.notEqual(projectContentBatchWorkSet(next).contentHash, first.contentHash);
  }
  first.batches[0]!.work.diagnostics[0]!.diagnostic.reason = "caller mutation";
  assert.deepEqual(raw, input());
});

test("ambiguous ownership, missing input identities and admitted plans cannot become a collection work set", () => {
  for (const edit of [
    (next: ContentBatchWorkSetInput) => { next.batches[1]!.packageId = next.batches[0]!.packageId; },
    (next: ContentBatchWorkSetInput) => { next.batches[1]!.recipePath = next.batches[0]!.recipePath; },
    (next: ContentBatchWorkSetInput) => { next.batches[1]!.plan.manifest.id = next.batches[0]!.plan.manifest.id; },
    (next: ContentBatchWorkSetInput) => { next.batches[0]!.recipePath = "content-batches/../private.recipe.json"; },
    (next: ContentBatchWorkSetInput) => { next.runtimeSha256 = "unknown"; },
    (next: ContentBatchWorkSetInput) => { next.batches = []; },
    (next: ContentBatchWorkSetInput) => { next.batches[0]!.plan.sourceCampaignComplete = true as false; },
  ]) {
    const raw = input(); edit(raw);
    assert.throws(() => projectContentBatchWorkSet(raw));
  }
});
