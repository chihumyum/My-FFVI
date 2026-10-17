import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContentBatchManifest, planContentBatch } from "../src/compiler/content-batch.js";
import { assessContentBatchAdmission, type ContentBatchAdmissionInput,
  type ContentBatchRouteProgram, type ContentBatchRouteSpec } from "../src/compiler/content-batch-admission.js";
import { parseGameMenuCommand, type GameMenuCommand } from "../src/core/game-menu-command.js";
import { hash } from "../src/compiler/content.js";
import { contentBatchFixture, sealBatchContent } from "./fixtures/content-batch.js";

type Input = ContentBatchManifest["routes"][number]["inputs"][number];
const { batchRouteSpecs }: { batchRouteSpecs(manifest: ContentBatchManifest): ContentBatchRouteSpec[] } =
  await import(pathToFileURL(resolve(process.cwd(), "scripts/content-batch-files.mjs")).href);

const commands: GameMenuCommand[] = [
  { kind: "use-item", itemId: 10, targetId: "tina" },
  { kind: "change-equipment", playerId: "tina", slot: 5, contentId: 1 },
  { kind: "change-party", change: { kind: "swap", from: 0, to: 3 } },
  { kind: "change-party", change: { kind: "set-row", position: 1, row: "back" } },
  { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 4 } },
];
const relay: Input[] = [
  { kind: "menu", command: commands[0]! }, { kind: "save-restore" },
  { kind: "move", direction: "right" }, { kind: "menu", command: commands[4]! },
  { kind: "save-restore" }, { kind: "confirm" },
];

function fixture(inputs: Input[] = structuredClone(relay)) {
  const f = contentBatchFixture();
  f.manifest.routes[0]!.inputs = inputs;
  const plan = planContentBatch(f.manifest, f.packages), routes = batchRouteSpecs(plan.manifest);
  const runtimeHash = hash("controlled public command runtime"), spec = routes[0]!;
  const receipt: ContentBatchAdmissionInput["receipts"][number] = {
    kind: "content-batch-route-receipt-v1", routeId: spec.id,
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: structuredClone(plan.contentHashes), profile: plan.manifest.profile,
    lane: "synthetic-controlled", result: "completed", visitedMapIds: [1, 2],
    completedEncounterIds: [1000], finalMapId: 2, checkpointReady: true, saveRestored: true,
    controls: ["authored unit evidence; not an executed source campaign"], boundary: null,
    ...(spec.program ? { program: structuredClone(spec.program) } : {}),
  };
  const admission: ContentBatchAdmissionInput = {
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: structuredClone(plan.contentHashes), profile: plan.manifest.profile, routes,
    diagnostics: plan.diagnostics.map(({ code, reason }) => ({ code, reason })),
    framework: { status: "passed", runtimeHash }, receipts: [receipt],
  };
  return { f, plan, routes, admission };
}
function blocked(input: ContentBatchAdmissionInput, code: string) {
  const result = assessContentBatchAdmission(input);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some(item => item.code === code), JSON.stringify(result.blockers));
  assert.equal(result.sourceCampaignComplete, false);
  assert.equal(result.originalGameExecuted, false);
  return result;
}

test("menu inputs use the same strict detached command parser as the public gateway", () => {
  const f = contentBatchFixture(), before = structuredClone(commands);
  f.manifest.routes[0]!.inputs = commands.map(command => ({ kind: "menu", command }));
  const manifest = ContentBatchManifest.parse(f.manifest);
  assert.deepEqual(manifest.routes[0]!.inputs, commands.map(command =>
    ({ kind: "menu", command: parseGameMenuCommand(command) })));
  const last = manifest.routes[0]!.inputs.at(-1)!;
  assert.equal(last.kind, "menu");
  if (last.kind === "menu" && last.command.kind === "set-preferences") last.command.preferences.speedIndex = 0;
  assert.deepEqual(commands, before);
});

test("unsupported menu arguments and extra restore fields are not silently dropped", () => {
  const f = contentBatchFixture();
  const invalidCommands: unknown[] = [
    { kind: "equip", playerId: "tina", slot: 0, contentId: 1 },
    { kind: "use-item", itemId: 10 },
    { kind: "use-item", itemId: "10", targetId: "tina" },
    { kind: "use-item", itemId: 0, targetId: "tina" },
    { kind: "use-item", itemId: 10, targetId: " " },
    { kind: "use-item", itemId: 10, targetId: "tina", count: 2 },
    { kind: "change-equipment", playerId: "tina", slot: 0, contentId: 1 },
    { kind: "change-equipment", playerId: "tina", slot: 7, contentId: 1 },
    { kind: "change-equipment", playerId: "tina", slot: 0.5, contentId: 1 },
    { kind: "change-equipment", playerId: "tina", slot: 0, contentId: -1 },
    { kind: "change-party", change: { kind: "swap", from: 0, to: 4 } },
    { kind: "change-party", change: { kind: "set-row", position: 0, row: "rear" } },
    { kind: "change-party", change: { kind: "swap", from: 0, to: 1 }, expected: {} },
    { kind: "set-preferences", preferences: { mode: "auto", speedIndex: 2 } },
    { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 5 } },
    { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 1, ignorePause: true } },
  ];
  for (const command of invalidCommands) {
    assert.throws(() => parseGameMenuCommand(command));
    assert.throws(() => ContentBatchManifest.parse({ ...f.manifest,
      routes: [{ ...f.manifest.routes[0], inputs: [{ kind: "menu", command }] }] }));
  }
  for (const input of [{ kind: "menu" }, { kind: "menu", command: commands[0], bypass: true },
    { kind: "save-restore", url: "/untrusted/save.json" }, { kind: "save-restore", inputCount: 0 }])
    assert.throws(() => ContentBatchManifest.parse({ ...f.manifest,
      routes: [{ ...f.manifest.routes[0], inputs: [input] }] }));
});

test("legacy movement routes retain their manifest, dependency hash and receipt shapes", () => {
  const { f, plan, routes, admission } = fixture([{ kind: "move", direction: "right" }, { kind: "confirm" }]);
  assert.deepEqual(plan.manifest, f.manifest);
  assert.equal(plan.manifestHash, hash(f.manifest));
  assert.equal(plan.dependencyHash, hash({ contentHashes: plan.contentHashes, dependencies: plan.dependencies,
    encounters: plan.encounters, diagnostics: plan.diagnostics }));
  assert.equal(Object.hasOwn(routes[0]!, "program"), false);
  assert.equal(Object.hasOwn(admission.receipts[0]!, "program"), false);
  assert.equal(assessContentBatchAdmission(admission).status, "passed");
});

test("the route spec counts successful declared inputs, intermediate restores and one mandatory final restore", () => {
  const cases: { inputs: Input[]; expected: ContentBatchRouteProgram }[] = [
    { inputs: structuredClone(relay), expected: { inputCount: 6, menuCount: 2, restoreCount: 3, postRestoreInputCount: 3 } },
    { inputs: [{ kind: "menu", command: commands[0]! }],
      expected: { inputCount: 1, menuCount: 1, restoreCount: 1, postRestoreInputCount: 0 } },
    { inputs: [{ kind: "save-restore" }, { kind: "save-restore" }, { kind: "move", direction: "up" }],
      expected: { inputCount: 3, menuCount: 0, restoreCount: 3, postRestoreInputCount: 1 } },
    { inputs: [{ kind: "confirm" }, { kind: "save-restore" }],
      expected: { inputCount: 2, menuCount: 0, restoreCount: 2, postRestoreInputCount: 0 } },
  ];
  for (const { inputs, expected } of cases) {
    const { plan, routes } = fixture(inputs), before = structuredClone(plan.manifest);
    assert.deepEqual(routes[0]!.program, expected);
    routes[0]!.program!.menuCount = 99;
    routes[0]!.requiredMapIds.push(999);
    routes[0]!.requiredEncounterIds.length = 0;
    assert.deepEqual(plan.manifest, before, "Specs are detached from the declared inputs and coverage");
  }
});

test("extended dependency identity binds command parameters and input order, not only aggregate counts", () => {
  const { f, plan } = fixture(), before = structuredClone(f);
  assert.equal(plan.dependencyHash, hash({ contentHashes: plan.contentHashes, dependencies: plan.dependencies,
    encounters: plan.encounters, diagnostics: plan.diagnostics,
    routePrograms: plan.manifest.routes.map(({ id, inputs }) => ({ id, inputs })) }));
  const reordered = structuredClone(f.manifest);
  [reordered.routes[0]!.inputs[2], reordered.routes[0]!.inputs[3]] =
    [reordered.routes[0]!.inputs[3]!, reordered.routes[0]!.inputs[2]!];
  assert.deepEqual(batchRouteSpecs(reordered)[0]!.program, batchRouteSpecs(f.manifest)[0]!.program);
  assert.notEqual(planContentBatch(reordered, f.packages).dependencyHash, plan.dependencyHash);
  const changed = structuredClone(f.manifest), selected = changed.routes[0]!.inputs[3]!;
  if (selected.kind === "menu" && selected.command.kind === "set-preferences") selected.command.preferences.speedIndex = 0;
  const after = planContentBatch(changed, f.packages);
  assert.notEqual(after.manifestHash, plan.manifestHash);
  assert.notEqual(after.dependencyHash, plan.dependencyHash);
  assert.deepEqual(f, before);
});

test("extended programs preserve trusted content reference bindings and the source purity gate", () => {
  const { f } = fixture();
  const refs = { kind: "game-content-refs-v1" as const, profile: f.manifest.profile,
    world: { url: "/content-packages/world.json", contentHash: f.packages.catalog.contentHash }, source: null,
    development: { entry: { url: "/game/controlled-field.json", contentHash: f.packages.entry.contentHash },
      battle: { url: "/game/controlled-battle.json", contentHash: f.packages.battle.contentHash } } };
  const plan = planContentBatch({ ...f.manifest, contentRefs: refs }, f.packages);
  assert.equal(plan.dependencyHash, hash({ contentHashes: plan.contentHashes, dependencies: plan.dependencies,
    encounters: plan.encounters, diagnostics: plan.diagnostics, contentRefs: refs,
    routePrograms: plan.manifest.routes.map(({ id, inputs }) => ({ id, inputs })) }));
  assert.throws(() => planContentBatch({ ...f.manifest,
    contentRefs: { ...refs, world: { ...refs.world, contentHash: "f".repeat(64) } } }, f.packages), /reference\/hash/);
  f.packages.battle.encounters[1000]!.escapePolicy = { kind: "framework-battle-escape-v1", id: "unsupported-source-policy" };
  f.packages.battle = sealBatchContent(f.packages.battle);
  assert.throws(() => planContentBatch(f.manifest, f.packages), /source profile.*escape/);
});

test("matching program evidence is pure and certifies only the declared synthetic route", () => {
  const { admission } = fixture(), before = structuredClone(admission);
  const result = assessContentBatchAdmission(admission);
  assert.equal(result.status, "passed");
  assert.equal(result.scope, "declared-routes-only");
  assert.equal(result.sourceCampaignComplete, false);
  assert.equal(result.originalGameExecuted, false);
  assert.deepEqual(admission, before);
});

test("a legacy completed receipt cannot replace an extended program receipt", () => {
  const { admission } = fixture();
  delete admission.receipts[0]!.program;
  blocked(admission, "missing-route-program");
});

test("one terminal restore cannot certify intermediate restores or continued gameplay", () => {
  const { admission } = fixture();
  admission.receipts[0]!.program = { inputCount: 1, menuCount: 0, restoreCount: 1, postRestoreInputCount: 0 };
  const result = blocked(admission, "route-program-mismatch");
  assert.equal(result.routes[0]!.blockers.filter(b => b.code === "route-program-mismatch").length, 4);
});

for (const key of ["inputCount", "menuCount", "restoreCount", "postRestoreInputCount"] as const)
  test(`both missing and extra completed ${key} counts fail closed`, () => {
    for (const delta of [-1, 1]) {
      const { admission } = fixture();
      admission.receipts[0]!.program![key] += delta;
      blocked(admission, "route-program-mismatch");
    }
  });

test("an unsolicited receipt program cannot widen an unchanged legacy route", () => {
  const { admission } = fixture([{ kind: "confirm" }]);
  admission.receipts[0]!.program = { inputCount: 1, menuCount: 0, restoreCount: 1, postRestoreInputCount: 0 };
  blocked(admission, "unexpected-route-program");
});

test("partial blocked programs can report zero restores without becoming completed", () => {
  const { admission } = fixture();
  admission.receipts[0]!.result = "blocked";
  admission.receipts[0]!.saveRestored = false;
  admission.receipts[0]!.program = { inputCount: 0, menuCount: 0, restoreCount: 0, postRestoreInputCount: 0 };
  const result = blocked(admission, "route-not-completed");
  assert.ok(result.blockers.some(item => item.code === "save-not-restored"));
  assert.ok(result.blockers.some(item => item.code === "route-program-mismatch"));
});

test("program count fields are strict required integers and a declared program includes final restore", () => {
  for (const lane of ["routes", "receipts"] as const) {
    for (const key of ["inputCount", "menuCount", "restoreCount", "postRestoreInputCount"] as const) {
      for (const value of [-1, 0.5, "1", true, Number.MAX_SAFE_INTEGER + 1]) {
        const raw = structuredClone(fixture().admission) as any;
        raw[lane][0].program[key] = value;
        assert.throws(() => assessContentBatchAdmission(raw));
      }
      const raw = structuredClone(fixture().admission) as any;
      delete raw[lane][0].program[key];
      assert.throws(() => assessContentBatchAdmission(raw));
    }
    for (const program of [null, false, {}, { ...fixture().admission.routes[0]!.program, ignored: true }]) {
      const raw = structuredClone(fixture().admission) as any;
      raw[lane][0].program = program;
      assert.throws(() => assessContentBatchAdmission(raw));
    }
  }
  const { admission } = fixture(); admission.routes[0]!.program!.restoreCount = 0;
  assert.throws(() => assessContentBatchAdmission(admission));
});

test("correct program totals do not bypass stale runtime, missing coverage or unresolved dependencies", () => {
  const runtime = fixture().admission; runtime.receipts[0]!.runtimeHash = hash("another runtime");
  blocked(runtime, "runtime-hash-mismatch");
  const coverage = fixture().admission; coverage.receipts[0]!.completedEncounterIds = [];
  blocked(coverage, "missing-encounter");
  const dependency = fixture().admission;
  dependency.diagnostics.push({ code: "UNRESOLVED_SOURCE_PROVIDER", reason: "Source provider remains unknown" });
  blocked(dependency, "UNRESOLVED_SOURCE_PROVIDER");
});
