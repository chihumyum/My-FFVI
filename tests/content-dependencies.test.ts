import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContentDependencies, type ContentDependencyRoot } from "../src/compiler/content-dependencies.js";
import type { FieldEntity, Op, Site } from "../src/field/types.js";
import type { WorldMapContent } from "../src/field/world.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "content-dependency-fixture" };
const entry = (mapId: number, continuation: string | null = null): ContentDependencyRoot =>
  ({ kind: "entry", mapId, entrance: 1, continuation });
const rootScript = (mapId: number, script: string): ContentDependencyRoot => ({ kind: "script", mapId, script });
const exit = { kind: "exit" } as const;
const change = (mapId: number, continuation: string | null): Instruction<Op> => ({ kind: "change-map",
  request: { mapId, entrance: 1, continuation, birdview: false, skipFade: false, skipBgm: false, origin: "script" } });
function script(map: WorldMapContent, name: string, instructions: Instruction<Op>[]): void {
  map.scripts[name] = instructions.map((op, index) => ({ ...op, script: name, index, source }));
  map.scriptLocals[name] = null;
  (map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
}
function fixture() {
  const original = checkpointFixture(), catalog = structuredClone(original.world);
  catalog.maps = {};
  const maps = [2, 3].map((id) => {
    const map = structuredClone(original.target);
    map.mapId = id; map.contentHash = `map-hash-${id}`; map.name = `map-${id}`;
    map.map!.identity = { mapId: id, areaId: map.areaId };
    const point = structuredClone(map.map!.groups!.entity_default!.entities.find((entity) => entity.kind === 0)!);
    map.map!.entities = [point];
    map.map!.groups = { entity_default: { name: "entity_default", source, entities: [point], blockers: [] } };
    map.scripts = {}; map.scriptLocals = {}; map.scriptTransitionMetadata = {};
    map.initializer = "init";
    script(map, "init", [exit]);
    catalog.maps[id] = { name: map.name, areaId: map.areaId, contentHash: map.contentHash,
      url: `/world/maps/${id}.json`, geometryReady: true, defaultGroupReady: true, blockers: [] };
    return map;
  });
  const a = maps[0]!, b = maps[1]!;
  const analyze = (roots: ContentDependencyRoot[] = [entry(2)], mapIds = [2, 3]) =>
    analyzeContentDependencies({ catalog, maps, roots, mapIds });
  const entity = (id: string): FieldEntity => ({ ...structuredClone(a.map!.entities[0]!), id,
    objectId: 0, kind: 5, asset: null, script: null });
  return { catalog, maps, a, b, analyze, entity };
}
const codes = (result: ReturnType<typeof analyzeContentDependencies>) => result.diagnostics.map((diagnostic) => diagnostic.code);

test("walking encounter tables contribute every candidate to the batch closure without event scripts", () => {
  const f = fixture();
  f.a.walkEncounters = { kind: "framework-walk-encounters-v1", id: "controlled-walking", minSteps: 2, maxSteps: 8,
    transportationIds: [1], parties: [{ partyId: 20, weight: 80 }, { partyId: 21, weight: 1 }] };
  const graph = f.analyze();
  assert.deepEqual(graph.encounterIds, [20, 21]);
  assert.equal(graph.edges.filter(edge => edge.kind === "encounter").length, 2);
  f.a.walkEncounters.parties[1]!.weight = 0;
  assert.ok(codes(f.analyze()).includes("walk-encounter-policy-invalid"));
});

test("source encounter closure keeps all weighted physical slots and the original continuation", () => {
  const f = fixture();
  script(f.a, "init", [{ kind: "source-encounter", command: { kind: "source-encounter", slots: [63, 63, 63, 47],
    effectId: 7, continuation: "return", footCapture: "before-player-sync" } }]);
  script(f.a, "return", [exit]);
  const graph = f.analyze(); assert.equal(graph.referenceClosure, "closed");
  assert.deepEqual(graph.encounterIds, [47, 63]);
  const edges = graph.edges.filter(edge => edge.kind === "encounter");
  assert.equal(edges.length, 4, "Weighted duplicates must remain four original dependency sites");
  assert.deepEqual(edges.map(edge => edge.site && "source" in edge.site ? edge.site.source.pointer : null),
    [0, 1, 2, 3].map(index => `/Mnemonics/0/operands/iValues/${index}`));
  assert.ok(graph.edges.some(edge => edge.kind === "script" && edge.target === "map:2/script:return"));
  const invalid = structuredClone(f.a.scripts.init![0]!);
  if (invalid.kind !== "source-encounter") throw new Error("Fixture source encounter missing");
  invalid.command.slots = [63, 0, 47, 0]; f.a.scripts.init = [invalid];
  const rejected = f.analyze(); assert.ok(codes(rejected).includes("source-encounter-command-invalid"));
  assert.deepEqual(rejected.encounterIds, [47, 63], "Unknown selection does not discard source dependency candidates");
  assert.equal(rejected.referenceClosure, "incomplete"); assert.equal(rejected.runtimeAdmission, "unassessed");
});

test("entry selects continuation OR initializer, while null/empty continuation uses the initializer", () => {
  const f = fixture();
  script(f.a, "init", [{ kind: "blocked", mnemonic: "Unknown", reason: "controlled gap" }]);
  script(f.a, "selected", [exit]);
  const selected = f.analyze([entry(2, "selected")]);
  assert.equal(selected.referenceClosure, "closed");
  assert.equal(selected.runtimeAdmission, "unassessed");
  assert.ok(selected.edges.some((edge) => edge.kind === "entrance" && edge.resolution === "resolved"));
  assert.ok(!selected.edges.some((edge) => edge.kind === "script" && edge.reference === "init"));
  for (const continuation of [null, ""]) assert.ok(codes(f.analyze([entry(2, continuation)])).includes("instruction-blocked"));
  f.a.initializer = null;
  assert.equal(f.analyze().referenceClosure, "closed", "An explicitly absent initializer is not an unresolved script");
});

test("script aliases are map local; another map cannot fill a missing or prototype alias", () => {
  const f = fixture();
  script(f.a, "start", [{ kind: "script-transition", targetScript: "shared", returnToCaller: false }, exit]);
  script(f.b, "shared", [{ kind: "nop" }, exit]);
  const result = f.analyze([rootScript(2, "start")]);
  assert.ok(result.edges.some((edge) => edge.kind === "script" && edge.reference === "shared" && edge.resolution === "missing"));
  assert.deepEqual(result.requiredMapIds, [2]);
  assert.ok(codes(f.analyze([rootScript(2, "toString")])).includes("script-missing"));
  script(f.a, "shared", [{ kind: "nop" }, exit]);
  assert.equal(f.analyze([rootScript(2, "start")]).referenceClosure, "closed");
});

test("group/entity/encounter return and cross-map continuations form one finite recursive closure", () => {
  const f = fixture(), npc = { ...f.entity("talker"), script: "fight", asset: "hero" };
  f.a.map!.groups!.later = { name: "later", source, entities: [npc], blockers: [] };
  script(f.a, "init", [{ kind: "entities", group: "later" }, exit]);
  script(f.a, "fight", [{ kind: "encounter", party: 42, continuation: "after" }, exit]);
  script(f.a, "after", [change(3, "resume"), exit]);
  script(f.b, "init", [{ kind: "blocked", mnemonic: "Unused", reason: "not the selected entry" }]);
  script(f.b, "resume", [{ kind: "script-transition", targetScript: "back", returnToCaller: true }, exit]);
  script(f.b, "back", [{ kind: "nop" }, change(2, "init"), exit]);
  const result = f.analyze();
  assert.equal(result.referenceClosure, "closed");
  assert.deepEqual(result.encounterIds, [42]); assert.deepEqual(result.requiredMapIds, [2, 3]);
  assert.ok(result.edges.some((edge) => edge.target === "map:3/script:resume"));
  assert.ok(!result.edges.some((edge) => edge.target === "map:3/script:init"));
  assert.ok(result.limitations.some((limitation) => /battle catalog/.test(limitation)));
  assert.ok(result.edges.length < 30, "Cycles must terminate without discarding their edges");
});

test("an explicit non-default initial group contributes its trigger, encounter and blocked return", () => {
  const f = fixture();
  f.a.map!.initialGroups = ["entity_default", "event_active"];
  f.a.map!.groups!.event_active = { name: "event_active", source, blockers: [],
    entities: [{ ...f.entity("journey-trigger"), kind: 2, script: "journey" }] };
  script(f.a, "journey", [{ kind: "encounter", party: 1000, continuation: "after" }, exit]);
  script(f.a, "after", [{ kind: "blocked", mnemonic: "UnknownEnd", reason: "controlled return gap" }]);
  const result = f.analyze();
  assert.ok(result.edges.some((edge) => edge.kind === "entity-group" &&
    edge.reference === "event_active" && edge.resolution === "resolved"));
  for (const name of ["journey", "after"])
    assert.ok(result.edges.some((edge) => edge.target === `map:2/script:${name}`));
  assert.deepEqual(result.encounterIds, [1000]);
  assert.ok(result.edges.some((edge) => edge.kind === "encounter" && edge.target === "encounter:1000"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "instruction-blocked" &&
    diagnostic.mapId === 2 && diagnostic.script === "after" && diagnostic.index === 0));
  assert.equal(result.referenceClosure, "incomplete");
  assert.equal(result.runtimeAdmission, "unassessed");
});

test("outside-batch destinations stay explicit even when their packages were supplied", () => {
  const f = fixture(); script(f.a, "init", [change(3, null)]);
  script(f.b, "init", [{ kind: "encounter", party: 99, continuation: "missing" }]);
  const result = f.analyze([entry(2)], [2]);
  assert.deepEqual(result.requiredMapIds, [2, 3]); assert.deepEqual(result.encounterIds, []);
  assert.ok(result.edges.some((edge) => edge.kind === "map" && edge.reference === 3 && edge.resolution === "outside-batch"));
  assert.ok(codes(result).includes("map-outside-batch")); assert.equal(result.referenceClosure, "incomplete");
});

test("missing compiled map and missing destination entrance are independent unresolved references", () => {
  const f = fixture(); script(f.a, "init", [change(3, null)]);
  const noPackage = analyzeContentDependencies({ catalog: f.catalog, maps: [f.a], roots: [entry(2)], mapIds: [2, 3] });
  assert.ok(codes(noPackage).includes("map-missing"));
  f.b.map!.groups!.entity_default!.entities = [];
  assert.ok(codes(f.analyze()).includes("entrance-missing"));
});

test("ambiguous PointIn and missing default groups never select a first match", () => {
  const f = fixture(), group = f.a.map!.groups!.entity_default!;
  group.entities.push({ ...structuredClone(group.entities[0]!), id: "second-entrance" });
  const result = f.analyze();
  assert.ok(result.edges.some((edge) => edge.kind === "entrance" && edge.resolution === "ambiguous" && edge.target === null));
  delete f.a.map!.groups!.entity_default;
  assert.ok(codes(f.analyze()).includes("entity-group-missing"));
});

test("both conditional branches and all four directional targets are inspected without evaluating state", () => {
  const f = fixture();
  script(f.a, "init", [
    { kind: "branch", left: { category: "ScenarioFlag1", index: 30 }, operator: "＝", right: { kind: "immediate", value: 1 }, target: 3 },
    { kind: "entities", group: "left-missing" }, { kind: "jump", target: 5 }, { kind: "nop" },
    { kind: "entities", group: "right-missing" }, { kind: "branch-player-direction", targets: [0, 1, 2, 100] }, exit,
  ]);
  const result = f.analyze();
  for (const name of ["left-missing", "right-missing"])
    assert.ok(result.edges.some((edge) => edge.reference === name && edge.resolution === "missing"));
  assert.ok(result.edges.some((edge) => edge.kind === "instruction" && edge.reference === 100 && edge.resolution === "missing"));
  assert.ok(result.edges.some((edge) => edge.kind === "instruction" && edge.reference === 0 && edge.resolution === "resolved"));
});

test("Call/character branch need a next instruction and puppet entry needs an Exit", () => {
  for (const command of [
    { kind: "call", target: 1 },
    { kind: "branch-character", sourceId: 1, scope: "current-party", presence: "present", target: 1 },
  ] satisfies Instruction<Op>[]) {
    const f = fixture(); script(f.a, "init", [command, exit]);
    assert.ok(codes(f.analyze()).includes("instruction-target-invalid"));
  }
  const f = fixture(); script(f.a, "init", [{ kind: "puppet", actor: "-1001", slot: 0, target: 0 }, { kind: "nop" }]);
  assert.ok(codes(f.analyze()).includes("instruction-target-invalid"));
});

test("blocked instructions, map/group/provider gaps and interaction failures remain diagnostics", () => {
  const f = fixture();
  f.a.blockers.push({ reason: "map controlled gap", source });
  f.a.actorViewBlockers = [{ reason: "view controlled gap", source }];
  f.a.map!.groups!.entity_default!.blockers.push({ reason: "group controlled gap", source });
  f.a.map!.groups!.entity_default!.entities.push({ ...f.entity("broken"),
    mapObject: { collision: true, acceptDirection: 15, talkMounts: [""], soundId: 0,
      interaction: { kind: "blocked", reason: "unknown interaction" } } });
  script(f.a, "init", [{ kind: "blocked", mnemonic: "SysCall", reason: "unresolved selector" },
    { kind: "field-recovery", command: { kind: "recover-mp", amount: 5, target: 0,
      allowUnableFight: false, allowMineralization: false }, dependencies: [] }, change(3, "missing")]);
  const result = f.analyze();
  for (const code of ["map-capability-blocked", "map-provider-blocked", "entity-group-blocked", "interaction-blocked", "instruction-blocked", "script-missing"])
    assert.ok(codes(result).includes(code), code);
  assert.deepEqual(result.requiredMapIds, [2, 3], "A blocked opcode must not discard later known references");
  assert.equal(result.providerAssessments.find(assessment => assessment.site.script === "init" && assessment.site.index === 1)!.status,
    "conditional", "Provider facts stay separate from existing source/reference failures");
});

test("entity trigger and interaction references expand while an explicit null RunScript stays absent", () => {
  const f = fixture();
  const properties = { collision: false, acceptDirection: 15, talkMounts: [""], soundId: 0 };
  f.a.map!.groups!.entity_default!.entities.push(
    { ...f.entity("door"), kind: 3, destination: { mapId: 3, entrance: 1 } },
    { ...f.entity("interaction"), mapObject: { ...properties, interaction: { kind: "script", script: "dialogue" } } },
    { ...f.entity("empty-interaction"), mapObject: { ...properties, interaction: { kind: "script", script: null } } },
  );
  script(f.a, "dialogue", [exit]);
  const result = f.analyze();
  assert.equal(result.referenceClosure, "closed"); assert.deepEqual(result.requiredMapIds, [2, 3]);
  assert.ok(result.edges.some((edge) => edge.target === "map:2/script:dialogue"));
  assert.ok(!result.edges.some((edge) => edge.kind === "script" && edge.reference === ""));
});

test("transition metadata and encounter return are distinct from decoded instruction success", () => {
  const f = fixture();
  script(f.a, "init", [{ kind: "script-transition", targetScript: "child", returnToCaller: false }, exit]);
  script(f.a, "child", [{ kind: "nop" }, { kind: "encounter", party: 7, continuation: "" }, exit]);
  f.a.scriptTransitionMetadata!.child = null; delete f.a.scriptLocals.child;
  const result = f.analyze();
  assert.deepEqual(result.encounterIds, [7]);
  for (const code of ["script-transition-metadata", "script-transition-locals", "script-missing"])
    assert.ok(codes(result).includes(code));
  assert.equal(result.referenceClosure, "incomplete"); assert.equal(result.runtimeAdmission, "unassessed");
});

test("unreferenced maps, scripts and groups are not promoted to root dependencies", () => {
  const f = fixture();
  f.b.blockers.push({ source, reason: "unused map" });
  script(f.a, "unused", [{ kind: "blocked", mnemonic: "Unused", reason: "unused story variant" }]);
  f.a.map!.groups!.unused = { name: "unused", source, entities: [], blockers: [{ source, reason: "unused group" }] };
  const result = f.analyze();
  assert.equal(result.referenceClosure, "closed"); assert.deepEqual(result.requiredMapIds, [2]);
  assert.deepEqual(result.mapIds, [2, 3]);
});

test("catalog/map identity and duplicate declarations reject the whole analysis", () => {
  for (const patch of [
    { contentHash: "other" }, { sourceSetHash: "other" }, { parentSourceSetHash: "other" },
    { mediaSourceSetHash: "other" }, { areaId: 9 }, { mapId: 500 },
  ]) {
    const f = fixture(); Object.assign(f.a, patch);
    assert.throws(() => f.analyze(), /identity mismatch/);
  }
  const f = fixture();
  assert.throws(() => analyzeContentDependencies({ catalog: f.catalog, maps: [...f.maps, f.a], roots: [entry(2)], mapIds: [2, 3] }), /duplicate dependency map/);
  assert.throws(() => f.analyze([entry(2)], [2, 2]), /duplicate dependency batch/);
  assert.throws(() => f.analyze([entry(2)], [0]), /Invalid.*batch/);
  f.a.map!.identity!.mapId = 3;
  assert.throws(() => f.analyze(), /identity mismatch/);
});

test("ordering is deterministic and all returned input-derived data is detached", () => {
  const f = fixture(); script(f.a, "init", [change(3, null), exit]);
  const roots = [entry(3), entry(2)], expected = f.analyze(roots);
  const reordered = analyzeContentDependencies({ catalog: f.catalog, maps: [...f.maps].reverse(), roots: [...roots].reverse(), mapIds: [3, 2] });
  assert.deepEqual(reordered, expected);
  const withSite = expected.edges.find((edge) => edge.site && "source" in edge.site)!;
  (withSite.site as Site).source.assetPath = "changed output";
  expected.roots[0]!.mapId = 999; expected.mapIds.push(999);
  assert.equal(f.a.scripts.init![0]!.source.assetPath, source.assetPath);
  assert.deepEqual(f.analyze(roots), reordered);
});
