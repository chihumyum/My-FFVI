import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContentDependencies, type ContentProviderContext } from "../src/compiler/content-dependencies.js";
import { fieldInstructionRequirements, assessFieldRequirements,
  type FieldAdmissionContext } from "../src/core/field-content-admission.js";
import { planContentBatch } from "../src/compiler/content-batch.js";
import type { FieldRecoveryCommand } from "../src/core/field-recovery.js";
import type { Op, Site } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { contentBatchFixture } from "./fixtures/content-batch.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "provider-dependency-fixture" };
const end = { kind: "exit" } as const;
const mp: FieldRecoveryCommand = { kind: "recover-mp", amount: 5, target: 0,
  allowUnableFight: false, allowMineralization: false };
const hp: FieldRecoveryCommand = { ...mp, kind: "recover-hp", allowUnableFight: true };
const recovery = (command: FieldRecoveryCommand): Instruction<Op> =>
  ({ kind: "field-recovery", command, dependencies: [] });
const available: FieldAdmissionContext = { providers: { recovery: "available" }, actorKind: "unknown" };
const missing: FieldAdmissionContext = { providers: { recovery: "missing" }, actorKind: "unknown" };

function fixture() {
  const original = checkpointFixture(), map = structuredClone(original.target), catalog = structuredClone(original.world);
  map.scripts = {}; map.scriptLocals = {}; map.scriptTransitionMetadata = {}; map.initializer = "start";
  const script = (name: string, commands: Instruction<Op>[]) => {
    map.scripts[name] = commands.map((command, index) => ({ ...command, script: name, index,
      source: { ...source, pointer: `/scripts/${name}/${index}` } }));
    map.scriptLocals[name] = null; map.scriptTransitionMetadata![name] = { customAnimations: "none" };
  };
  script("start", [recovery(mp), end]);
  const analyze = (providerContext?: ContentProviderContext) => analyzeContentDependencies({ catalog, maps: [map],
    mapIds: [2], roots: [{ kind: "entry", mapId: 2, entrance: 1, continuation: null }],
    ...(providerContext === undefined ? {} : { providerContext }) });
  return { map, catalog, script, analyze };
}

test("a missing provider keeps the exact instruction code/site while reference closure remains separate", () => {
  const f = fixture(), op = f.map.scripts.start![0]!, requirements = fieldInstructionRequirements(op);
  const runtime = assessFieldRequirements(requirements, missing), planned = f.analyze(missing);
  assert.equal(runtime.status, "blocked"); assert.equal(planned.providerAssessments.length, 1);
  assert.deepEqual(planned.providerRequirements, requirements.map(requirement => ({ ...requirement, mapId: 2 })));
  const assessment = planned.providerAssessments[0]!;
  assert.deepEqual(assessment, { ...runtime, mapId: 2, site: { script: op.script, index: op.index, source: op.source } });
  assert.equal(assessment.diagnostics[0]!.code, "FIELD_RECOVERY_PROVIDER");
  assert.deepEqual(assessment.diagnostics[0]!.site, { script: "start", index: 0, source: op.source });
  assert.deepEqual(planned.diagnostics, []); assert.equal(planned.referenceClosure, "closed");
  assert.equal(planned.runtimeAdmission, "unassessed");
});

test("absent runtime facts remain conditional rather than missing or automatically available", () => {
  const f = fixture(), result = f.analyze();
  assert.equal(result.providerAssessments[0]!.status, "conditional");
  assert.ok(result.providerAssessments[0]!.diagnostics.every(diagnostic => diagnostic.status === "conditional"));
  assert.equal(result.referenceClosure, "closed"); assert.equal(result.runtimeAdmission, "unassessed");
  const ready = f.analyze(available);
  assert.equal(ready.providerAssessments[0]!.status, "ready");
  assert.deepEqual(ready.providerAssessments[0]!.diagnostics, []);
  assert.equal(ready.runtimeAdmission, "unassessed", "an installed provider is not execution or playability evidence");
});

test("HP refresh conditions are not inferred from helper script flags or an available provider", () => {
  const f = fixture();
  f.script("start", [{ kind: "script-transition", targetScript: "helper", returnToCaller: true }, end]);
  f.script("helper", [{ kind: "nop" }, recovery(hp), end]);
  f.map.scriptSystemFlags = { start: null, helper: { keepBadStatusVisual: false } };
  const context: FieldAdmissionContext = { providers: { recovery: "available", partyActors: "available" },
    actorKind: "unknown", refreshRequired: true };
  const planned = f.analyze(context), result = planned.providerAssessments.find(row => row.site.script === "helper")!;
  assert.equal(result.status, "conditional");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.capability === "conditionVisual" && diagnostic.status === "conditional"));
  assert.equal(result.site.index, 1); assert.deepEqual(planned.diagnostics, []);
  const trustedRoot = f.analyze({ ...context, keepBadStatusVisual: false });
  assert.equal(trustedRoot.providerAssessments.find(row => row.site.script === "helper")!.status, "ready");
  const unsupportedRoot = f.analyze({ ...context, keepBadStatusVisual: true });
  assert.equal(unsupportedRoot.providerAssessments.find(row => row.site.script === "helper")!.status, "blocked");
});

test("unknown refresh necessity is conditional and explicit no-refresh does not require actor presentation", () => {
  const f = fixture(); f.script("start", [recovery(hp), end]);
  const context: FieldAdmissionContext = { providers: { recovery: "available", partyActors: "missing" }, actorKind: "unknown" };
  const unknown = f.analyze(context);
  assert.equal(unknown.providerAssessments[0]!.status, "conditional");
  const needed = f.analyze({ ...context, refreshRequired: true, keepBadStatusVisual: false });
  assert.equal(needed.providerAssessments[0]!.status, "blocked");
  assert.ok(needed.providerAssessments[0]!.diagnostics.some(diagnostic => diagnostic.capability === "partyActors"));
  const skipped = f.analyze({ ...context, refreshRequired: false });
  assert.equal(skipped.providerAssessments[0]!.status, "ready");
});

test("MP and HP with the death-removal flag disabled do not acquire phantom refresh requirements", () => {
  const f = fixture(); f.script("start", [recovery(mp), recovery({ ...hp, allowUnableFight: false }), end]);
  const context: FieldAdmissionContext = { providers: { recovery: "available", partyActors: "missing" },
    actorKind: "unknown", refreshRequired: true, keepBadStatusVisual: true };
  const planned = f.analyze(context);
  assert.equal(planned.providerAssessments.length, 2);
  assert.ok(planned.providerRequirements.every(requirement => requirement.capability === "recovery"));
  assert.ok(planned.providerAssessments.every(assessment => assessment.status === "ready"));
});

test("unknown runtime actor binding stays conditional even if a specific motion provider is available", () => {
  const f = fixture(); f.script("start", [{ kind: "field-script-motion", command: {
    kind: "move", animation: "", direction: "left", speedId: 1, steps: 1,
  } }, end]);
  const context: FieldAdmissionContext = { providers: { actorMotion: "available", cameraMotion: "missing", effectMotion: "missing" },
    actorKind: "unknown" };
  const planned = f.analyze(context);
  assert.equal(planned.providerAssessments[0]!.status, "conditional");
  assert.ok(planned.providerAssessments[0]!.diagnostics.some(diagnostic => diagnostic.capability === "scriptMotion"));
  assert.equal(planned.referenceClosure, "closed"); assert.equal(planned.runtimeAdmission, "unassessed");
});

test("trusted per-instruction contexts are detached and cannot alter package data or another site's facts", () => {
  const f = fixture(); f.script("start", [recovery(mp), recovery(mp), end]);
  const before = structuredClone(f.map), calls: number[] = [];
  const planned = f.analyze(instruction => {
    assert.equal(instruction.mapId, 2); assert.equal(instruction.script, "start"); calls.push(instruction.index);
    instruction.op.source.assetPath = "tool-mutated-copy";
    return instruction.index === 0 ? missing : available;
  });
  assert.deepEqual(calls, [0, 1]); assert.deepEqual(f.map, before);
  const first = planned.providerAssessments.find(row => row.site.index === 0)!;
  const second = planned.providerAssessments.find(row => row.site.index === 1)!;
  assert.equal(first.status, "blocked"); assert.equal(second.status, "ready");
  assert.equal(first.site.source.assetPath, source.assetPath);
  assert.equal(first.diagnostics[0]!.site.source.assetPath, source.assetPath);
});

test("new provider diagnostics preserve every existing source blocker and outside-batch edge", () => {
  const f = fixture(); f.script("start", [recovery(mp),
    { kind: "blocked", mnemonic: "UnknownSource", reason: "existing source gap" },
    { kind: "change-map", request: { mapId: 3, entrance: 1, continuation: null, birdview: false,
      skipFade: false, skipBgm: false, origin: "script" } }, end]);
  f.catalog.maps[3] = { ...f.catalog.maps[2]!, contentHash: "outside-map", url: "/map-3.json" };
  f.map.cameraHostBlockers = [{ source, reason: "existing camera gap" }];
  const unknown = f.analyze(), absent = f.analyze(missing), installed = f.analyze(available);
  assert.deepEqual(absent.edges, unknown.edges); assert.deepEqual(installed.edges, unknown.edges);
  assert.deepEqual(absent.diagnostics, unknown.diagnostics); assert.deepEqual(installed.diagnostics, unknown.diagnostics);
  assert.ok(absent.diagnostics.some(diagnostic => diagnostic.code === "instruction-blocked"));
  assert.ok(absent.diagnostics.some(diagnostic => diagnostic.code === "map-provider-blocked"));
  assert.ok(absent.diagnostics.some(diagnostic => diagnostic.code === "map-outside-batch"));
  assert.ok(absent.edges.some(edge => edge.kind === "map" && edge.reference === 3 && edge.resolution === "outside-batch"));
  assert.equal(absent.referenceClosure, "incomplete"); assert.equal(absent.providerAssessments[0]!.status, "blocked");
});

test("provider reporting shares the old visited-script scope and scans both conditional branches", () => {
  const f = fixture(); f.script("start", [
    { kind: "branch", left: { category: "ScenarioFlag1", index: 2 }, operator: "＝",
      right: { kind: "immediate", value: 1 }, target: 3 },
    recovery(mp), { kind: "jump", target: 4 }, recovery(hp), end,
  ]);
  f.script("unreferenced", [recovery(hp), end]);
  const planned = f.analyze();
  assert.ok(planned.providerRequirements.length >= 2);
  assert.deepEqual(planned.providerAssessments.map(row => row.site.index).sort(), [1, 3]);
  assert.ok(planned.providerRequirements.every(requirement => requirement.site.script === "start"));
  assert.equal(planned.runtimeAdmission, "unassessed");
});

test("provider report order is stable and its requirements, assessments and sites are detached", () => {
  const f = fixture(); f.script("start", [recovery(mp), recovery(hp), end]);
  const context: FieldAdmissionContext = { providers: { recovery: "missing", partyActors: "missing" },
    actorKind: "unknown", refreshRequired: true };
  const original = f.analyze(context), again = f.analyze({ ...context,
    providers: { partyActors: "missing", recovery: "missing" } });
  assert.deepEqual(original, again);
  original.providerRequirements[0]!.site.source.assetPath = "edited";
  original.providerAssessments[0]!.diagnostics[0]!.reason = "edited";
  context.providers.recovery = "available";
  assert.equal(again.providerRequirements[0]!.site.source.assetPath, source.assetPath);
  assert.notEqual(again.providerAssessments[0]!.diagnostics[0]!.reason, "edited");
  assert.equal(f.map.scripts.start![0]!.source.assetPath, source.assetPath);
});

test("batch plans include provider requirements while keeping strict route admission unassessed", () => {
  const f = contentBatchFixture(), plan = planContentBatch(f.manifest, f.packages);
  assert.ok(plan.dependencies.providerRequirements.some(requirement => requirement.capability === "inventory"));
  assert.ok(plan.dependencies.providerAssessments.some(assessment => assessment.status === "conditional"));
  assert.equal(plan.runtimeAdmission, "unassessed"); assert.equal(plan.sourceCampaignComplete, false);
  assert.deepEqual(plan.diagnostics, []);
  assert.throws(() => planContentBatch({ ...f.manifest, providerContext: available }, f.packages), /unrecognized|unknown|providerContext/i);
});
