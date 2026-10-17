import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContentBatchManifest, planContentBatch } from "../src/compiler/content-batch.js";
import { assessContentBatchAdmission, type ContentBatchRouteSpec,
  type ContentBatchAdmissionInput } from "../src/compiler/content-batch-admission.js";
import { hash } from "../src/compiler/content.js";
import { contentBatchFixture } from "./fixtures/content-batch.js";
import { shopEconomyLoopFixture } from "./fixtures/shop-economy-loop.js";

const { batchRouteSpecs }: { batchRouteSpecs(manifest: ContentBatchManifest): ContentBatchRouteSpec[] } =
  await import(pathToFileURL(resolve(process.cwd(), "scripts/content-batch-files.mjs")).href);
type Input = ContentBatchManifest["routes"][number]["inputs"][number];
const shopInputs: Input[] = [
  { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 2 } },
  { kind: "shop", groupId: 7, request: { kind: "sell", contentId: 10, count: 1 } },
  { kind: "leave-shop", groupId: 7 },
];

test("shop inputs retain product versus content identity and remain detached field commands", () => {
  const fixture = shopEconomyLoopFixture(), before = structuredClone(shopInputs);
  fixture.manifest.routes[0]!.inputs = structuredClone(shopInputs);
  const parsed = ContentBatchManifest.parse(fixture.manifest);
  assert.deepEqual(parsed.routes[0]!.inputs, shopInputs);
  const buy = parsed.routes[0]!.inputs[0]!;
  if (buy.kind === "shop" && buy.request.kind === "buy") buy.request.productId = 1002;
  assert.deepEqual(shopInputs, before);
  assert.deepEqual(fixture.manifest.routes[0]!.inputs, before);
  assert.throws(() => ContentBatchManifest.parse({ ...fixture.manifest, routes: [{
    ...fixture.manifest.routes[0], inputs: [{ kind: "menu", command: shopInputs[0] }],
  }] }));
});

test("shop declaration rejects missing identity, coercion, extra fields and invalid quantities", () => {
  const fixture = shopEconomyLoopFixture();
  const invalid: unknown[] = [
    { kind: "shop", request: { kind: "buy", productId: 1001, count: 1 } },
    { kind: "shop", groupId: 0, request: { kind: "buy", productId: 1001, count: 1 } },
    { kind: "shop", groupId: "7", request: { kind: "buy", productId: 1001, count: 1 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", contentId: 10, count: 1 } },
    { kind: "shop", groupId: 7, request: { kind: "sell", productId: 1001, count: 1 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 0 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: -1 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 0.5 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: "1" } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 0x80000000, count: 1 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 0x80000000 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 1, unitPrice: 0 } },
    { kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 1 }, bypass: true },
    { kind: "leave-shop" }, { kind: "leave-shop", groupId: 0 },
    { kind: "leave-shop", groupId: 7, confirmFarewell: true },
  ];
  for (const input of invalid) assert.throws(() => ContentBatchManifest.parse({
    ...fixture.manifest, routes: [{ ...fixture.manifest.routes[0], inputs: [input] }],
  }));
});

test("shop-only programs bind all field commands without turning them into menu mutations", () => {
  const fixture = shopEconomyLoopFixture();
  fixture.manifest.routes[0]!.inputs = structuredClone(shopInputs);
  const plan = planContentBatch(fixture.manifest, fixture.packages);
  assert.deepEqual(batchRouteSpecs(plan.manifest)[0]!.program,
    { inputCount: 3, menuCount: 0, restoreCount: 1, postRestoreInputCount: 0 });
  assert.equal(plan.dependencyHash, hash({ contentHashes: plan.contentHashes, dependencies: plan.dependencies,
    encounters: plan.encounters, diagnostics: plan.diagnostics,
    routePrograms: plan.manifest.routes.map(({ id, inputs }) => ({ id, inputs })) }));
  for (const inputs of [
    [shopInputs[1]!, shopInputs[0]!, shopInputs[2]!],
    [{ kind: "shop", groupId: 8, request: { kind: "buy", productId: 1001, count: 2 } }, ...shopInputs.slice(1)],
    [{ kind: "shop", groupId: 7, request: { kind: "buy", productId: 1001, count: 3 } }, ...shopInputs.slice(1)],
  ]) {
    const changed = structuredClone(fixture.manifest);
    changed.routes[0]!.inputs = inputs as Input[];
    const next = planContentBatch(changed, fixture.packages);
    assert.deepEqual(batchRouteSpecs(next.manifest)[0]!.program, batchRouteSpecs(plan.manifest)[0]!.program);
    assert.notEqual(next.manifestHash, plan.manifestHash);
    assert.notEqual(next.dependencyHash, plan.dependencyHash);
  }
});

test("shop inputs after restore count as continued gameplay and all legacy routes keep their hash shape", () => {
  const fixture = shopEconomyLoopFixture();
  fixture.manifest.routes[0]!.inputs = [{ kind: "save-restore" }, ...structuredClone(shopInputs)];
  assert.deepEqual(batchRouteSpecs(fixture.manifest)[0]!.program,
    { inputCount: 4, menuCount: 0, restoreCount: 2, postRestoreInputCount: 3 });
  const legacy = contentBatchFixture(), plan = planContentBatch(legacy.manifest, legacy.packages);
  assert.equal(plan.manifestHash, hash(legacy.manifest));
  assert.equal(plan.dependencyHash, hash({ contentHashes: plan.contentHashes, dependencies: plan.dependencies,
    encounters: plan.encounters, diagnostics: plan.diagnostics }));
  assert.equal(Object.hasOwn(batchRouteSpecs(plan.manifest)[0]!, "program"), false);
});

test("a completed shop receipt cannot replace declared transactions with only the final restore", () => {
  const fixture = shopEconomyLoopFixture();
  fixture.manifest.routes[0]!.inputs = structuredClone(shopInputs);
  const plan = planContentBatch(fixture.manifest, fixture.packages), runtimeHash = hash("authored shop unit evidence");
  const receipt: ContentBatchAdmissionInput["receipts"][number] = {
    kind: "content-batch-route-receipt-v1", routeId: plan.manifest.routes[0]!.id,
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: plan.contentHashes, profile: plan.manifest.profile, lane: "synthetic-controlled", result: "completed",
    visitedMapIds: [1, 2], completedEncounterIds: [1000, 1001], finalMapId: 2,
    checkpointReady: true, saveRestored: true, controls: ["Unit evidence, not a gameplay execution"], boundary: null };
  const input: ContentBatchAdmissionInput = { manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: plan.contentHashes, profile: plan.manifest.profile, routes: batchRouteSpecs(plan.manifest),
    diagnostics: [], framework: { status: "passed", runtimeHash }, receipts: [receipt] };
  assert.ok(assessContentBatchAdmission(input).blockers.some(item => item.code === "missing-route-program"));
  assert.ok(assessContentBatchAdmission({ ...input, receipts: [{ ...receipt, program: {
    inputCount: 0, menuCount: 0, restoreCount: 1, postRestoreInputCount: 0,
  } }] }).blockers.some(item => item.code === "route-program-mismatch"));
});
