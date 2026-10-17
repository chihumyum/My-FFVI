import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assessContentBatchAdmission,
  type ContentBatchAdmissionInput,
  type ContentBatchAdmissionResult,
} from "../src/compiler/content-batch-admission.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function fixture(): ContentBatchAdmissionInput {
  const identities = {
    manifestHash: digest("explicit batch selection"),
    dependencyHash: digest("source dependency closure"),
    runtimeHash: digest("compiled runtime"),
    contentHashes: {
      entry: digest("entry"), world: digest("world"), battle: digest("battle"),
      "map:1": digest("map one"), "map:2": digest("map two"),
    },
  };
  return {
    ...identities,
    profile: "framework",
    routes: [{ id: "two-maps", entry: "source-new-game", expectedMapId: 2,
      requiredMapIds: [1, 2], requiredEncounterIds: [1000] }],
    diagnostics: [],
    framework: { status: "passed", runtimeHash: identities.runtimeHash },
    receipts: [{ ...structuredClone(identities), kind: "content-batch-route-receipt-v1", routeId: "two-maps",
      profile: "framework", lane: "source-profile", result: "completed", visitedMapIds: [1, 2],
      completedEncounterIds: [1000], finalMapId: 2, checkpointReady: true, saveRestored: true,
      controls: ["headless media acknowledgement", "recorded public input sequence"], boundary: null }],
  };
}

function blocked(input: ContentBatchAdmissionInput, code: string): ContentBatchAdmissionResult {
  const result = assessContentBatchAdmission(input);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((item) => item.code === code), JSON.stringify(result.blockers));
  assert.equal(result.sourceCampaignComplete, false);
  assert.equal(result.originalGameExecuted, false);
  return result;
}

test("matching source-profile evidence admits only the declared routes and preserves the supplied inputs", () => {
  for (const profile of ["framework", "source"] as const) {
    const input = fixture();
    input.profile = profile; input.receipts[0]!.profile = profile;
    const before = structuredClone(input);
    const result = assessContentBatchAdmission(input);
    assert.deepEqual(result, { status: "passed", scope: "declared-routes-only", blockers: [],
      routes: [{ id: "two-maps", entry: "source-new-game", status: "passed", blockers: [] }],
      sourceCampaignComplete: false, originalGameExecuted: false });
    assert.deepEqual(input, before);
  }
});

test("controlled entries remain explicitly synthetic even when all declared outcomes pass", () => {
  const input = fixture();
  input.routes[0]!.entry = "controlled-fixture";
  input.receipts[0]!.lane = "synthetic-controlled";
  const result = assessContentBatchAdmission(input);
  assert.equal(result.status, "passed");
  assert.equal(result.routes[0]!.entry, "controlled-fixture");
  assert.equal(result.scope, "declared-routes-only");
  assert.equal(result.sourceCampaignComplete, false);
});

test("multiple declared routes require independent complete evidence, not the union of partial runs", () => {
  const input = fixture();
  input.routes.push({ ...structuredClone(input.routes[0]!), id: "held-out", entry: "controlled-fixture" });
  input.receipts.push({ ...structuredClone(input.receipts[0]!), routeId: "held-out", lane: "synthetic-controlled" });
  assert.equal(assessContentBatchAdmission(input).status, "passed");
  input.receipts[1]!.completedEncounterIds = [];
  const result = blocked(input, "missing-encounter");
  assert.equal(result.routes[0]!.status, "passed");
  assert.equal(result.routes[1]!.status, "blocked");
});

for (const [key, code] of [
  ["manifestHash", "manifest-hash-mismatch"],
  ["dependencyHash", "dependency-hash-mismatch"],
  ["runtimeHash", "runtime-hash-mismatch"],
] as const) test(`a receipt from an older ${key} cannot certify the current batch`, () => {
  const input = fixture();
  input[key] = digest("new " + key);
  if (key === "runtimeHash") input.framework.runtimeHash = input.runtimeHash;
  blocked(input, code);
});

test("rehashing edited script content does not carry the old route acceptance forward", () => {
  const input = fixture();
  const original = { script: [{ kind: "exit" }] };
  input.contentHashes["map:2"] = digest(original);
  input.receipts[0]!.contentHashes["map:2"] = digest(original);
  assert.equal(assessContentBatchAdmission(input).status, "passed");
  input.contentHashes["map:2"] = digest({ script: [{ kind: "blocked", reason: "new dependency" }] });
  input.manifestHash = digest(input.contentHashes);
  input.receipts[0]!.manifestHash = input.manifestHash;
  blocked(input, "content-hash-mismatch");
});

for (const variant of ["missing", "extra", "changed"] as const)
  test(`the receipt's ${variant} content dependency is rejected even if the top-level hashes match`, () => {
    const input = fixture(), hashes = input.receipts[0]!.contentHashes;
    if (variant === "missing") delete hashes["map:2"];
    else if (variant === "extra") hashes["map:3"] = digest("third map");
    else hashes.battle = digest("different battle");
    blocked(input, "content-hash-mismatch");
  });

test("content dependency key order and repeated visits do not change the certified route", () => {
  const input = fixture();
  input.receipts[0]!.contentHashes = Object.fromEntries(Object.entries(input.contentHashes).reverse());
  input.receipts[0]!.visitedMapIds = [1, 2, 1, 2];
  input.receipts[0]!.completedEncounterIds = [1000, 1000];
  assert.equal(assessContentBatchAdmission(input).status, "passed");
});

for (const status of ["incomplete", "invalidated"] as const)
  test(`${status} framework contracts block a completed route`, () => {
    const input = fixture(); input.framework.status = status;
    const result = blocked(input, "framework-not-passed");
    assert.equal(result.routes[0]!.status, "passed", "Global failure does not rewrite the observed route outcome");
  });

test("a framework pass from another runtime cannot support current route receipts", () => {
  const input = fixture(); input.framework.runtimeHash = digest("old framework build");
  blocked(input, "framework-runtime-mismatch");
});

test("every dependency diagnostic fails closed, including an unknown code on an unvisited branch", () => {
  const input = fixture();
  input.diagnostics.push({ code: "future-provider-unclassified", reason: "Unknown branch requires a provider" });
  const result = blocked(input, "future-provider-unclassified");
  assert.deepEqual(result.blockers, input.diagnostics);
  result.blockers[0]!.reason = "caller changed output";
  assert.equal(input.diagnostics[0]!.reason, "Unknown branch requires a provider");
});

test("synthetic evidence cannot certify a source entry; source labels cannot disguise a controlled entry", () => {
  const source = fixture(); source.receipts[0]!.lane = "synthetic-controlled";
  blocked(source, "route-lane-mismatch");
  const controlled = fixture(); controlled.routes[0]!.entry = "controlled-fixture";
  blocked(controlled, "route-lane-mismatch");
});

test("source and framework profile evidence cannot be exchanged", () => {
  const input = fixture(); input.receipts[0]!.profile = "source";
  blocked(input, "profile-mismatch");
});

for (const result of ["blocked", "failed"] as const)
  test(`a ${result} run is not completed merely because its visited members match`, () => {
    const input = fixture(); input.receipts[0]!.result = result;
    blocked(input, "route-not-completed");
  });

test("a completed marker cannot hide any non-null boundary, including false or empty values", () => {
  for (const boundary of [{ kind: "unsupported", site: 17 }, { kind: "stable-field" }, {}, [], false, 0, ""]) {
    const input = fixture(); input.receipts[0]!.boundary = boundary;
    blocked(input, "route-boundary");
  }
});

test("missing required maps and encounters remain blockers even with a valid final checkpoint", () => {
  const input = fixture(); input.receipts[0]!.visitedMapIds = [2];
  input.receipts[0]!.completedEncounterIds = [];
  const result = blocked(input, "missing-map");
  assert.ok(result.blockers.some((item) => item.code === "missing-encounter"));
});

test("the expected final map must appear in the trace even when it is absent from requiredMapIds", () => {
  const input = fixture(); input.routes[0]!.requiredMapIds = [1];
  input.receipts[0]!.visitedMapIds = [1];
  blocked(input, "missing-map");
});

test("visiting the destination earlier does not replace finishing there", () => {
  const input = fixture(); input.receipts[0]!.visitedMapIds = [1, 2, 1];
  input.receipts[0]!.finalMapId = 1;
  blocked(input, "wrong-final-map");
});

test("a pending initializer or a save without restore does not complete a route", () => {
  const input = fixture(); input.receipts[0]!.checkpointReady = false;
  input.receipts[0]!.saveRestored = false;
  const result = blocked(input, "checkpoint-not-ready");
  assert.ok(result.blockers.some((item) => item.code === "save-not-restored"));
});

test("an empty route selection never passes by vacuous truth", () => {
  const input = fixture(); input.routes = []; input.receipts = [];
  blocked(input, "no-routes");
});

test("a manifest member cannot be omitted or replaced by evidence for an undeclared route", () => {
  const input = fixture(); input.receipts[0]!.routeId = "different-route";
  const result = blocked(input, "missing-receipt");
  assert.ok(result.blockers.some((item) => item.code === "unexpected-receipt"));
});

test("duplicate route identities do not share one receipt", () => {
  const input = fixture(); input.routes.push(structuredClone(input.routes[0]!));
  const result = blocked(input, "duplicate-route-id");
  assert.ok(result.routes.every((route) => route.status === "blocked"));
});

test("duplicate receipts are not selected by first match or merged into a complete run", () => {
  const input = fixture(); input.receipts.push(structuredClone(input.receipts[0]!));
  input.receipts[0]!.visitedMapIds = [1]; input.receipts[1]!.visitedMapIds = [2];
  blocked(input, "duplicate-receipt-id");
});

test("duplicate required member identities are rejected instead of counted twice", () => {
  const input = fixture(); input.routes[0]!.requiredMapIds = [1, 2, 2];
  input.routes[0]!.requiredEncounterIds = [1000, 1000];
  const result = blocked(input, "duplicate-required-map");
  assert.ok(result.blockers.some((item) => item.code === "duplicate-required-encounter"));
});

test("unrelated extra receipts still block rather than silently widening or narrowing the batch", () => {
  const input = fixture(); input.receipts.push({ ...structuredClone(input.receipts[0]!), routeId: "not-selected" });
  blocked(input, "unexpected-receipt");
});

const malformed: { name: string; change(value: any): void }[] = [
  { name: "string checkpoint boolean", change: (v) => { v.receipts[0].checkpointReady = "true"; } },
  { name: "numeric restore boolean", change: (v) => { v.receipts[0].saveRestored = 1; } },
  { name: "missing restore outcome", change: (v) => { delete v.receipts[0].saveRestored; } },
  { name: "malformed manifest digest", change: (v) => { v.manifestHash = "passed"; } },
  { name: "malformed receipt digest", change: (v) => { v.receipts[0].runtimeHash = "A".repeat(64); } },
  { name: "malformed content digest", change: (v) => { v.contentHashes.world = null; } },
  { name: "empty dependency identities", change: (v) => { v.contentHashes = {}; } },
  { name: "unknown profile", change: (v) => { v.profile = "development"; } },
  { name: "unknown lane", change: (v) => { v.receipts[0].lane = "pass"; } },
  { name: "unknown result", change: (v) => { v.receipts[0].result = "passed"; } },
  { name: "unknown framework status", change: (v) => { v.framework.status = "unknown"; } },
  { name: "unknown receipt kind", change: (v) => { v.receipts[0].kind = "world-check"; } },
  { name: "unknown entry", change: (v) => { v.routes[0].entry = "preview-map"; } },
  { name: "empty route identity", change: (v) => { v.routes[0].id = ""; } },
  { name: "padded receipt identity", change: (v) => { v.receipts[0].routeId = " two-maps "; } },
  { name: "non-array routes", change: (v) => { v.routes = { length: 1 }; } },
  { name: "non-array visited members", change: (v) => { v.receipts[0].visitedMapIds = { 0: 1, 1: 2 }; } },
  { name: "sparse visited members", change: (v) => { v.receipts[0].visitedMapIds = Array(2); } },
  { name: "string map identity", change: (v) => { v.routes[0].expectedMapId = "2"; } },
  { name: "zero map identity", change: (v) => { v.receipts[0].finalMapId = 0; } },
  { name: "fractional encounter identity", change: (v) => { v.receipts[0].completedEncounterIds = [1.5]; } },
  { name: "unsafe map identity", change: (v) => { v.routes[0].requiredMapIds = [Number.MAX_SAFE_INTEGER + 1]; } },
  { name: "missing explicit boundary", change: (v) => { delete v.receipts[0].boundary; } },
  { name: "undefined boundary", change: (v) => { v.receipts[0].boundary = undefined; } },
  { name: "non-JSON boundary", change: (v) => { v.receipts[0].boundary = () => null; } },
  { name: "invalid controls", change: (v) => { v.receipts[0].controls = [false]; } },
  { name: "blank diagnostic", change: (v) => { v.diagnostics = [{ code: "unknown", reason: " " }]; } },
  { name: "extra input property", change: (v) => { v.ignoreFailures = true; } },
  { name: "extra route property", change: (v) => { v.routes[0].optional = true; } },
  { name: "extra receipt property", change: (v) => { v.receipts[0].waiver = true; } },
  { name: "extra framework property", change: (v) => { v.framework.allowStale = true; } },
  { name: "extra diagnostic property", change: (v) => { v.diagnostics = [{ code: "missing", reason: "dependency", ignore: true }]; } },
];
test("malformed JSON is rejected before any admission decision, without coercion or dropped fields", async (t) => {
  for (const item of malformed) await t.test(item.name, () => {
    const value = fixture(); item.change(value);
    assert.throws(() => assessContentBatchAdmission(value));
  });
});
