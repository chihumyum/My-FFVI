import { z } from "zod";

/** Completed declared inputs, including intermediate restore commands. The
 * mandatory final save/restore is counted only in restoreCount. */
export type ContentBatchRouteProgram = {
  inputCount: number;
  menuCount: number;
  restoreCount: number;
  postRestoreInputCount: number;
};

export type ContentBatchRouteSpec = {
  id: string;
  entry: "source-new-game" | "controlled-fixture" | "development-map" | "framework-new-game";
  expectedMapId: number;
  requiredMapIds: number[];
  requiredEncounterIds: number[];
  program?: ContentBatchRouteProgram;
};

export type ContentBatchRouteReceipt = {
  kind: "content-batch-route-receipt-v1";
  routeId: string;
  manifestHash: string;
  dependencyHash: string;
  runtimeHash: string;
  contentHashes: Record<string, string>;
  lane: "source-profile" | "synthetic-controlled" | "source-content-development" | "framework-initialized";
  profile: "source" | "framework";
  result: "completed" | "blocked" | "failed";
  visitedMapIds: number[];
  completedEncounterIds: number[];
  finalMapId: number;
  checkpointReady: boolean;
  saveRestored: boolean;
  controls: string[];
  boundary: unknown | null;
  program?: ContentBatchRouteProgram;
};

export type ContentBatchAdmissionBlocker = { code: string; reason: string };
export type ContentBatchAdmissionInput = {
  manifestHash: string;
  dependencyHash: string;
  runtimeHash: string;
  contentHashes: Record<string, string>;
  profile: "source" | "framework";
  routes: ContentBatchRouteSpec[];
  diagnostics: ContentBatchAdmissionBlocker[];
  framework: { status: "passed" | "incomplete" | "invalidated"; runtimeHash: string };
  receipts: ContentBatchRouteReceipt[];
};
export type ContentBatchAdmissionResult = {
  status: "passed" | "blocked";
  scope: "declared-routes-only";
  blockers: ContentBatchAdmissionBlocker[];
  routes: {
    id: string;
    entry: ContentBatchRouteSpec["entry"];
    status: "passed" | "blocked";
    blockers: ContentBatchAdmissionBlocker[];
  }[];
  sourceCampaignComplete: false;
  originalGameExecuted: false;
};

const text = z.string().min(1).refine((value) => value.trim() === value,
  "Expected explicit text without surrounding whitespace");
const digest = z.string().regex(/^[a-f0-9]{64}$/, "Expected SHA-256 identity");
const identity = z.number().int().min(1).max(0x7fffffff);
const profile = z.enum(["source", "framework"]);
const contentHashes = z.record(text, digest).refine((value) => Object.keys(value).length > 0,
  "Content dependencies must be explicit and nonempty");
const blocker = z.object({ code: text, reason: text }).strict();
const count = z.number().int().nonnegative();
const program = z.object({
  inputCount: count, menuCount: count, restoreCount: count, postRestoreInputCount: count,
}).strict();
const routeSpec = z.object({
  id: text,
  entry: z.enum(["source-new-game", "controlled-fixture", "development-map", "framework-new-game"]),
  expectedMapId: identity,
  requiredMapIds: z.array(identity),
  requiredEncounterIds: z.array(identity),
  program: program.extend({ restoreCount: count.min(1) }).optional(),
}).strict();
const receipt = z.object({
  kind: z.literal("content-batch-route-receipt-v1"),
  routeId: text,
  manifestHash: digest,
  dependencyHash: digest,
  runtimeHash: digest,
  contentHashes,
  lane: z.enum(["source-profile", "synthetic-controlled", "source-content-development", "framework-initialized"]),
  profile,
  result: z.enum(["completed", "blocked", "failed"]),
  visitedMapIds: z.array(identity),
  completedEncounterIds: z.array(identity),
  finalMapId: identity,
  checkpointReady: z.boolean(),
  saveRestored: z.boolean(),
  controls: z.array(text),
  // Missing/undefined is not a successful null boundary. Only JSON belongs in
  // a portable receipt; a class instance or callback is not execution evidence.
  boundary: z.json(),
  program: program.optional(),
}).strict();
const inputSchema = z.object({
  manifestHash: digest,
  dependencyHash: digest,
  runtimeHash: digest,
  contentHashes,
  profile,
  routes: z.array(routeSpec),
  diagnostics: z.array(blocker),
  framework: z.object({
    status: z.enum(["passed", "incomplete", "invalidated"]),
    runtimeHash: digest,
  }).strict(),
  receipts: z.array(receipt),
}).strict();

function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>(), repeated = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/** Assess evidence collected by a trusted runner. Hash equality binds a receipt
 * to declared inputs; it cannot prove that arbitrary supplied JSON was executed.
 * The caller owns dependency discovery and must pass every unresolved diagnostic.
 * Even a passing source-profile route certifies only these declared routes, not
 * unvisited branches, browser/original parity, or a completed source campaign.
 * Malformed input throws; well-formed but insufficient evidence returns blocked.
 */
export function assessContentBatchAdmission(raw: ContentBatchAdmissionInput): ContentBatchAdmissionResult {
  const input = inputSchema.parse(raw);
  const blockers: ContentBatchAdmissionBlocker[] = input.diagnostics.map((item) => ({ ...item }));
  const add = (code: string, reason: string) => { blockers.push({ code, reason }); };
  if (input.framework.status !== "passed")
    add("framework-not-passed", `Framework contracts are ${input.framework.status}`);
  if (input.framework.runtimeHash !== input.runtimeHash)
    add("framework-runtime-mismatch", "Framework evidence belongs to another runtime");
  if (input.routes.length === 0)
    add("no-routes", "An explicit nonempty set of routes is required");

  const repeatedRoutes = new Set(duplicates(input.routes.map((item) => item.id)));
  const routeIds = new Set(input.routes.map((item) => item.id));
  const receiptGroups = new Map<string, typeof input.receipts>();
  for (const value of input.receipts) {
    const group = receiptGroups.get(value.routeId) ?? [];
    group.push(value); receiptGroups.set(value.routeId, group);
  }
  for (const [id, group] of receiptGroups) {
    if (!routeIds.has(id)) add("unexpected-receipt", `Receipt refers to undeclared route ${id}`);
    if (group.length > 1 && !routeIds.has(id))
      add("duplicate-receipt-id", `Multiple receipts refer to undeclared route ${id}`);
  }

  const routes: ContentBatchAdmissionResult["routes"] = input.routes.map((spec) => {
    const failures: ContentBatchAdmissionBlocker[] = [];
    const fail = (code: string, reason: string) => { failures.push({ code, reason }); };
    if (repeatedRoutes.has(spec.id)) fail("duplicate-route-id", `Route identity ${spec.id} is not unique`);
    if (spec.entry === "development-map" && input.profile !== "framework")
      fail("development-route-profile", "Development map routes require the framework profile");
    if (spec.entry === "framework-new-game" && input.profile !== "framework")
      fail("initialized-route-profile", "Initialized framework routes require the framework profile");
    for (const id of duplicates(spec.requiredMapIds))
      fail("duplicate-required-map", `Required map ${id} is listed more than once`);
    for (const id of duplicates(spec.requiredEncounterIds))
      fail("duplicate-required-encounter", `Required encounter ${id} is listed more than once`);
    const evidence = receiptGroups.get(spec.id) ?? [];
    if (evidence.length === 0) fail("missing-receipt", "No continuous route receipt was supplied");
    else if (evidence.length !== 1)
      fail("duplicate-receipt-id", "A route needs one complete receipt; separate runs cannot be combined");
    else {
      const found = evidence[0]!;
      for (const key of ["manifestHash", "dependencyHash", "runtimeHash"] as const)
        if (found[key] !== input[key])
          fail(key === "manifestHash" ? "manifest-hash-mismatch" :
            key === "dependencyHash" ? "dependency-hash-mismatch" : "runtime-hash-mismatch",
          `Receipt ${key} differs from the nominated batch`);
      if (found.profile !== input.profile)
        fail("profile-mismatch", "Receipt belongs to another content profile");
      const keys = [...new Set([...Object.keys(input.contentHashes), ...Object.keys(found.contentHashes)])].sort();
      for (const key of keys)
        if (!Object.hasOwn(input.contentHashes, key) || !Object.hasOwn(found.contentHashes, key) ||
            input.contentHashes[key] !== found.contentHashes[key])
          fail("content-hash-mismatch", `Content dependency ${key} is missing, extra or changed`);
      const expectedLane = spec.entry === "source-new-game" ? "source-profile" :
        spec.entry === "development-map" ? "source-content-development" :
        spec.entry === "framework-new-game" ? "framework-initialized" : "synthetic-controlled";
      if (found.lane !== expectedLane)
        fail("route-lane-mismatch", `${spec.entry} requires ${expectedLane} evidence`);
      if (found.result !== "completed")
        fail("route-not-completed", `Route ended as ${found.result}`);
      if (found.boundary !== null)
        fail("route-boundary", "An unresolved route boundary remains");
      for (const id of new Set([...spec.requiredMapIds, spec.expectedMapId]))
        if (!found.visitedMapIds.includes(id)) fail("missing-map", `Required map ${id} was not visited`);
      for (const id of spec.requiredEncounterIds)
        if (!found.completedEncounterIds.includes(id))
          fail("missing-encounter", `Required encounter ${id} was not completed`);
      if (found.finalMapId !== spec.expectedMapId)
        fail("wrong-final-map", `Expected final map ${spec.expectedMapId}, received ${found.finalMapId}`);
      if (!found.checkpointReady)
        fail("checkpoint-not-ready", "The route did not finish at a stable checkpoint");
      if (!found.saveRestored)
        fail("save-not-restored", "The route did not save and restore its continuation");
      if (spec.program !== undefined) {
        if (found.program === undefined)
          fail("missing-route-program", "No completed input/restore counts were supplied for the declared program");
        else for (const key of ["inputCount", "menuCount", "restoreCount", "postRestoreInputCount"] as const)
          if (found.program[key] !== spec.program[key])
            fail("route-program-mismatch", `Completed ${key} differs from the declared program`);
      } else if (found.program !== undefined)
        fail("unexpected-route-program", "Program evidence cannot widen a route without a declared program");
    }
    blockers.push(...failures.map((failure) => ({ code: failure.code, reason: `${spec.id}: ${failure.reason}` })));
    return { id: spec.id, entry: spec.entry, status: failures.length ? "blocked" : "passed", blockers: failures };
  });

  return { status: blockers.length ? "blocked" : "passed", scope: "declared-routes-only", blockers, routes,
    sourceCampaignComplete: false, originalGameExecuted: false };
}
