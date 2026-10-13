import test from "node:test";
import assert from "node:assert/strict";
import { planContentBatch } from "../src/compiler/content-batch.js";
import { CONTENT_BATCH_SYSTEMS, projectContentBatchWorkPlan, type ContentBatchPlan } from "../src/compiler/content-batch-work-plan.js";
import { fieldInstructionRequirements, assessFieldRequirements } from "../src/core/field-content-admission.js";
import type { Op, Site } from "../src/field/types.js";
import type { ContentDependencyDiagnostic } from "../src/compiler/content-dependencies.js";
import { contentBatchFixture } from "./fixtures/content-batch.js";

function plan() {
  const f = contentBatchFixture();
  return planContentBatch(f.manifest, f.packages);
}
const source = { file: "synthetic.bundle", assetPath: "authored/batch-work-plan.json" };
const site = (script: string, index: number): Site => ({ script, index, source: { ...source, pointer: "/ops/" + index } });
const row = (code: string, reason: string, mapId: number, index: number): ContentDependencyDiagnostic =>
  ({ code, reason, mapId, script: "shared", index, source: { ...source, pointer: "/ops/" + index } });

test("a real batch plan projects six shared systems without changing dependency identity or provider readiness", () => {
  const input = plan(), before = structuredClone(input), report = projectContentBatchWorkPlan(input);
  assert.deepEqual(input, before);
  assert.equal(report.kind, "content-batch-work-plan-v1");
  assert.deepEqual(report.workItems.map(item => item.id), CONTENT_BATCH_SYSTEMS);
  assert.equal(report.manifestHash, input.manifestHash); assert.equal(report.dependencyHash, input.dependencyHash);
  assert.deepEqual(report.contentHashes, input.contentHashes);
  assert.equal(report.runtimeAdmission, "unassessed"); assert.equal(report.sourceCampaignComplete, false);
  assert.equal(report.countUnit, "diagnostic-and-provider-records");
  assert.ok(input.dependencies.providerAssessments.some(assessment => assessment.status === "conditional"));
  assert.deepEqual(report.providerAssessments.map(item => item.assessment), input.dependencies.providerAssessments);
  assert.deepEqual(report.providerRequirements.map(item => item.requirement), input.dependencies.providerRequirements);
  assert.equal(report.counts.providerRequirements, input.dependencies.providerRequirements.length);
  assert.equal(report.counts.providerAssessments, input.dependencies.providerAssessments.length);
});

test("unknown codes and blocked source instructions keep their exact reason and every original diagnostic index", () => {
  const input = plan();
  input.diagnostics = [
    { code: "instruction-blocked", reason: "MoveTo: original source behavior is unknown" },
    { code: "future-battle-provider", reason: "BattleGame inventory recovery save / script namespace" },
    { code: "constructor", reason: "A prototype name is not a mapped diagnostic" },
    { code: "script-missing", reason: "This reason says battle, but its explicit code identifies script closure" },
  ];
  const report = projectContentBatchWorkPlan(input);
  assert.deepEqual(report.diagnostics.map(item => item.index), [0, 1, 2, 3]);
  assert.deepEqual(report.diagnostics.map(item => item.diagnostic), input.diagnostics);
  assert.deepEqual(report.diagnostics.map(item => item.owner),
    ["unclassified", "unclassified", "unclassified", "map-event-and-travel"]);
  assert.deepEqual(report.workItems.find(item => item.id === "unclassified")!.diagnosticIndices, [0, 1, 2]);
  assert.equal(report.counts.unclassifiedDiagnostics, 3);
  const allIndices = report.workItems.flatMap(item => item.diagnosticIndices);
  assert.deepEqual(allIndices.sort((a, b) => a - b), [0, 1, 2, 3], "Each diagnostic has exactly one owner");
});

test("location matching preserves duplicate positions and cannot select only the first matching dependency", () => {
  const input = plan(), first = row("script-missing", "shared dependency reason", 1, 5),
    second = row("script-missing", "shared dependency reason", 2, 9);
  input.dependencies.diagnostics = [first, second, structuredClone(first)];
  input.diagnostics = [
    { code: first.code, reason: first.reason },
    structuredClone(second),
    { code: first.code, reason: first.reason },
  ];
  const before = structuredClone(input), report = projectContentBatchWorkPlan(input);
  assert.deepEqual(report.diagnostics[0]!.dependencyLocations.map(item => item.index), [0, 1, 2]);
  assert.deepEqual(report.diagnostics[0]!.dependencyLocations.map(item => item.diagnostic),
    [first, second, first]);
  assert.deepEqual(report.diagnostics[1]!.dependencyLocations, [{ index: 1, diagnostic: second }]);
  assert.deepEqual(report.diagnostics[2]!.dependencyLocations, report.diagnostics[0]!.dependencyLocations);
  assert.equal(report.counts.diagnostics, 3, "Same text or location is not another deduplication pass");
  assert.deepEqual(input, before);
});

test("a known location rejects mismatched or absent location fields while preserving unknown diagnostic provenance", () => {
  const input = plan(), target = row("unknown-source-gap", "same", 1, 5);
  input.dependencies.diagnostics = [
    { code: target.code, reason: target.reason },
    { ...structuredClone(target), source: { ...source, pointer: "/different" } },
    structuredClone(target),
  ];
  input.diagnostics = [target];
  const report = projectContentBatchWorkPlan(input);
  assert.equal(report.diagnostics[0]!.owner, "unclassified");
  assert.deepEqual(report.diagnostics[0]!.dependencyLocations, [{ index: 2, diagnostic: target }]);
  assert.deepEqual(report.diagnostics[0]!.diagnostic, target);
});

test("shared provider assessments retain conditional and ready evidence rather than inventing system availability", () => {
  const input = plan(), location = site("recovery", 1);
  const hp = { ...location, kind: "field-recovery", command: { kind: "recover-hp", amount: 2, target: 0,
    allowUnableFight: true, allowMineralization: false }, dependencies: [] } satisfies Op;
  const requirements = fieldInstructionRequirements(hp);
  const conditional = assessFieldRequirements(requirements, {
    providers: { recovery: "available", partyActors: "missing" }, actorKind: "unknown", keepBadStatusVisual: false,
  });
  assert.equal(conditional.status, "conditional");
  input.dependencies.providerRequirements = requirements.map(requirement => ({ ...requirement, mapId: 1 }));
  input.dependencies.providerAssessments = [{ ...conditional, mapId: 1, site: location }];
  const report = projectContentBatchWorkPlan(input), assessment = report.providerAssessments[0]!;
  assert.equal(assessment.assessment.status, "conditional");
  assert.deepEqual(assessment.assessment.diagnostics, conditional.diagnostics);
  assert.deepEqual(assessment.owners, ["map-event-and-travel", "owned-menus-economy-and-growth"]);
  assert.equal(report.counts.providerAssessments, 1);
  assert.equal(report.workItems.filter(item => item.providerAssessmentIndices.includes(0)).length, 2);
  assert.equal(report.runtimeAdmission, "unassessed");
  const available = assessFieldRequirements(requirements, {
    providers: { recovery: "available", partyActors: "available" }, actorKind: "actor",
    refreshRequired: true, keepBadStatusVisual: false,
  });
  assert.equal(available.status, "ready");
  input.dependencies.providerAssessments = [{ ...available, mapId: 1, site: location }];
  const ready = projectContentBatchWorkPlan(input);
  assert.equal(ready.providerAssessments[0]!.assessment.status, "ready");
  assert.deepEqual(ready.providerAssessments[0]!.assessment.diagnostics, []);
  assert.equal(ready.runtimeAdmission, "unassessed"); assert.equal(ready.sourceCampaignComplete, false);
});

test("provider ownership follows typed capabilities and preserves assessment indices without collapsing sites", () => {
  const input = plan(), first = site("same", 3), second = site("same", 4);
  input.dependencies.providerRequirements = [first, second].map(location => ({
    mapId: 1, capability: "eventSaveCompletion", site: location, code: "FIELD_EVENT_SAVE_COMPLETION",
    reason: "Waiting for explicit host completion", when: "deferred",
  }));
  input.dependencies.providerAssessments = [first, second].map(location => ({
    mapId: 1, site: location, status: "conditional", diagnostics: [{
      capability: "eventSaveCompletion", site: location, code: "FIELD_EVENT_SAVE_COMPLETION",
      reason: "Waiting for explicit host completion", status: "conditional",
    }],
  }));
  const report = projectContentBatchWorkPlan(input), saves = report.workItems.find(item => item.id === "save-restore-and-continuation")!;
  assert.deepEqual(saves.providerRequirementIndices, [0, 1]);
  assert.deepEqual(saves.providerAssessmentIndices, [0, 1]);
  assert.deepEqual(report.providerRequirements.map(item => item.index), [0, 1]);
  assert.deepEqual(report.providerAssessments.map(item => item.index), [0, 1]);
  assert.deepEqual(report.providerAssessments.map(item => item.assessment.site), [first, second]);
});

test("repeat projection has stable content-key ordering and detached records even when callers mutate previous output", () => {
  const input = plan(), before = structuredClone(input), first = projectContentBatchWorkPlan(input);
  const reversed: ContentBatchPlan = { ...input,
    contentHashes: Object.fromEntries(Object.entries(input.contentHashes).reverse()) };
  assert.equal(JSON.stringify(projectContentBatchWorkPlan(reversed)), JSON.stringify(first));
  first.providerRequirements[0]!.requirement.site.source.assetPath = "edited-output";
  first.providerAssessments[0]!.assessment.status = "ready";
  first.workItems[0]!.publicInterfaces.push("caller-created-owner");
  const again = projectContentBatchWorkPlan(input);
  assert.deepEqual(input, before);
  assert.notEqual(again.providerRequirements[0]!.requirement.site.source.assetPath, "edited-output");
  assert.ok(again.providerAssessments.some(row => row.assessment.status === "conditional"));
  assert.ok(!again.workItems[0]!.publicInterfaces.includes("caller-created-owner"));
  assert.equal(again.dependencyHash, before.dependencyHash);
});

test("a sparse source array, corrupt binding or preclaimed runtime result cannot produce a green work plan", () => {
  const input = plan(), sparse = structuredClone(input);
  sparse.diagnostics = Array(2);
  assert.throws(() => projectContentBatchWorkPlan(sparse), /complete diagnostic\/provider arrays/);
  assert.throws(() => projectContentBatchWorkPlan({ ...input, dependencyHash: "not-the-original-hash" }), /identities/);
  assert.throws(() => projectContentBatchWorkPlan({ ...input, runtimeAdmission: "ready" } as unknown as ContentBatchPlan), /unassessed/);
  assert.throws(() => projectContentBatchWorkPlan({ ...input, sourceCampaignComplete: true } as unknown as ContentBatchPlan), /unassessed/);
});
