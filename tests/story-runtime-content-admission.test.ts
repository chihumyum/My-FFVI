import test from "node:test";
import assert from "node:assert/strict";
import { fieldInstructionRequirements, assessFieldRequirements } from "../src/core/field-content-admission.js";
import { analyzeContentDependencies } from "../src/compiler/content-dependencies.js";
import { projectContentBatchWorkPlan } from "../src/compiler/content-batch-work-plan.js";
import { planContentBatch } from "../src/compiler/content-batch.js";
import { compileFieldTimerInstruction } from "../src/compiler/field-timer.js";
import { contentBatchFixture, sealBatchContent } from "./fixtures/content-batch.js";
import type { Op, Site } from "../src/field/types.js";
import type { WorldMapContent } from "../src/field/world.js";

const source = { file: "synthetic.bundle", assetPath: "Assets/Synthetic/story-host.json",
  objectId: "-9127841932506724402", pointer: "/Mnemonics/0", extra: { values: [1, 2] } };
const timer = (names: string[] = ["after"]): Op => ({ script: "journey", index: 0, source: structuredClone(source),
  ...compileFieldTimerInstruction({ mnemonic: "SetTimer", type: 1,
    operands: { iValues: [0, 0, 0, 1, 0, 0, 0, 0], rValues: [300, 0, 0, 0, 0, 0, 0, 0],
      sValues: [...names, ...Array(8 - names.length).fill("")] } }) });
const screen = (kind: "field-color-fade" | "field-flash"): Op => ({ kind, script: "journey", index: 1,
  source: structuredClone(source), seconds: 1, color: { r: 0, g: 0, b: 0, a: 1 },
  policy: "web-field-screen-effects-v1" });
function assign(map: WorldMapContent, name: string, ops: Op[]): void {
  map.scripts[name] = ops.map((op, index) => ({ ...structuredClone(op), script: name, index }));
  map.scriptLocals[name] = null;
  (map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
}
const exit = (): Op => ({ kind: "exit", script: "after", index: 0, source: structuredClone(source) });
function fixture(names = ["after"]) {
  const f = contentBatchFixture(), map = f.packages.maps[0]!;
  assign(map, "journey", [timer(names), screen("field-color-fade"), screen("field-flash"), ...map.scripts.journey!]);
  return { f, map, graph: () => analyzeContentDependencies({ catalog: f.packages.catalog, maps: f.packages.maps,
    roots: [{ kind: "script", mapId: map.mapId, script: "journey" }], mapIds: f.manifest.mapIds }) };
}

test("every timer command requires a declared live story clock; defaults, absence and presence remain separate", () => {
  for (const kind of ["set", "finish", "pause", "resume", "change-script-if-expired"] as const) {
    const op = kind === "set" ? timer() : { ...timer(), command: { kind } } as Op;
    const requirements = fieldInstructionRequirements(op);
    assert.deepEqual(requirements.map(row => row.capability), ["storyTimer"]);
    assert.equal(requirements[0]!.code, "FIELD_STORY_TIMER_PROVIDER");
    assert.deepEqual(requirements[0]!.site, { script: op.script, index: op.index, source: op.source });
    assert.equal(assessFieldRequirements(requirements, { actorKind: "unknown", providers: {} }).status, "conditional");
    assert.equal(assessFieldRequirements(requirements, { actorKind: "unknown", providers: { storyTimer: "missing" } }).status, "blocked");
    assert.equal(assessFieldRequirements(requirements, { actorKind: "unknown", providers: { storyTimer: "available" } }).status, "ready");
  }
  assert.throws(() => fieldInstructionRequirements({ ...timer(), command: { kind: "unknown" } } as unknown as Op),
    /timer requirement command/);
});

test("ColorFade and Flash have an independent screen owner requirement and retain original decimal source identities", () => {
  for (const kind of ["field-color-fade", "field-flash"] as const) {
    const op = screen(kind), requirements = fieldInstructionRequirements(op);
    assert.deepEqual(requirements.map(row => row.capability), ["screenEffects"]);
    assert.equal(requirements[0]!.code, "FIELD_SCREEN_EFFECTS_PROVIDER");
    assert.equal(requirements[0]!.site.source.objectId, "-9127841932506724402");
    assert.equal(assessFieldRequirements(requirements, { actorKind: "unknown", providers: { storyTimer: "available" } }).status, "conditional");
    assert.equal(assessFieldRequirements(requirements, { actorKind: "unknown", providers: { screenEffects: "missing" } }).status, "blocked");
    assert.equal(assessFieldRequirements(requirements, { actorKind: "unknown", providers: { screenEffects: "available" } }).status, "ready");
  }
});

test("a storyRuntime content marker cannot manufacture provider observations during dependency planning", () => {
  const { f, map, graph } = fixture();
  map.developmentProfile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: "a".repeat(64), omissions: [], storyRuntime: "web-field-story-runtime-v1" };
  const result = graph();
  const rows = result.providerAssessments.filter(row => row.site.script === "journey" && row.site.index < 3);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.status === "conditional"));
  const observed = analyzeContentDependencies({ catalog: f.packages.catalog, maps: f.packages.maps,
    roots: [{ kind: "script", mapId: map.mapId, script: "journey" }], mapIds: f.manifest.mapIds,
    providerContext: { providers: { storyTimer: "available", screenEffects: "available" }, actorKind: "unknown" } });
  assert.ok(observed.providerAssessments.filter(row => row.site.script === "journey" && row.site.index < 3)
    .every(row => row.status === "ready"));
  assert.equal(observed.runtimeAdmission, "unassessed", "provider facts do not grant plot/route acceptance");
});

test("all timer lottery candidates form exact origin-map script edges and unknown callbacks cannot borrow another map's name", () => {
  const { f, map, graph } = fixture(["one", "two", "missing", "other-only"]);
  assign(map, "one", [{ kind: "encounter", script: "one", index: 0, source,
    party: 42, continuation: "after" }]);
  assign(map, "two", [{ kind: "blocked", script: "two", index: 0, source,
    mnemonic: "Mystery", reason: "retained callback gap" }]);
  assign(f.packages.maps[1]!, "other-only", [exit()]);
  const result = graph(), edges = result.edges.filter(edge => edge.from === "map:1/script:journey/instruction:0" && edge.kind === "script");
  assert.deepEqual(edges.map(edge => edge.reference).sort(), ["missing", "one", "other-only", "two"]);
  assert.deepEqual(edges.filter(edge => edge.resolution === "missing").map(edge => edge.reference).sort(), ["missing", "other-only"]);
  assert.ok(result.diagnostics.some(row => row.code === "timer-callback-lottery-unimplemented" && row.script === "journey" && row.index === 0));
  assert.ok(result.diagnostics.some(row => row.code === "instruction-blocked" && row.script === "two"));
  assert.ok(result.encounterIds.includes(42), "Unsupported lottery does not discard its valid callback dependencies");
  assert.equal(result.referenceClosure, "incomplete");
  assert.ok(edges.every(edge => (edge.site as Site).source.objectId === "-9127841932506724402"));
});

test("timer callback cycles terminate without dropping conditional script bodies or inventing prototype aliases", () => {
  const { map, graph } = fixture(["repeat", "toString"]);
  assign(map, "repeat", [{ ...timer(["journey"]), script: "repeat" }, exit()]);
  const result = graph();
  assert.ok(result.edges.some(edge => edge.kind === "script" && edge.reference === "repeat" && edge.resolution === "resolved"));
  assert.ok(result.edges.some(edge => edge.kind === "script" && edge.reference === "toString" && edge.resolution === "missing"));
  assert.ok(result.edges.length < 50);
  assert.equal(result.providerRequirements.filter(row => row.capability === "storyTimer").length, 2);
});

test("existing work-plan projection groups timer and screen contracts with exact owners and all original record locations", () => {
  const { f, map } = fixture(["after", "missing"]);
  f.packages.entry.scripts = structuredClone(map.scripts);
  f.packages.entry.map = structuredClone(map.map!);
  f.packages.entry = sealBatchContent(f.packages.entry);
  f.packages.maps = f.packages.maps.map(sealBatchContent);
  for (const item of f.packages.maps) f.packages.catalog.maps[String(item.mapId)]!.contentHash = item.contentHash;
  f.packages.catalog = sealBatchContent(f.packages.catalog);
  const input = planContentBatch(f.manifest, f.packages), before = structuredClone(input);
  const work = projectContentBatchWorkPlan(input);
  const providerRows = work.providerRequirements.filter(row => row.requirement.capability === "storyTimer" || row.requirement.capability === "screenEffects");
  assert.equal(providerRows.length, 3);
  assert.ok(providerRows.every(row => row.owner === "map-event-and-travel"));
  const lottery = work.diagnostics.find(row => row.diagnostic.code === "timer-callback-lottery-unimplemented")!;
  assert.equal(lottery.owner, "map-event-and-travel");
  assert.ok(lottery.dependencyLocations.length > 0);
  assert.deepEqual(input, before);
  assert.equal(work.runtimeAdmission, "unassessed");
  providerRows[0]!.requirement.site.source.assetPath = "changed-output";
  assert.deepEqual(input, before, "Work records remain detached from the real prepared plan");
});
