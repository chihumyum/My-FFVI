import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { GAME_SKELETON_CHECKS, GAME_SKELETON_GROUPS } from "./game-skeleton-contract.mjs";
import { FRAMEWORK_SUITE_CHECKS } from "./framework-suite-contract.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length > 0 && value.trim() === value;
const passed = value => value === "pass" || value === "passed";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = value => Array.isArray(value) && value.length === 0;
const zeroHash = "0".repeat(64);
// These three existing checkers report per-module bytes under runtimeSha256,
// rather than the whole-runtime digest. Bind the complete declared module set;
// arbitrary or partial dictionaries must never count as runtime evidence.
const moduleRuntimeChecks = {
  "check-game-entry-ui.mjs": ["game-session", "game-flow", "game-commands", "game-entry-loader", "game-content",
    "game-content-refs", "game-package-selection", "game-development-entry", "saved-game", "source-new-game",
    "game-event-save", "field-event-checkpoint", "game-battle-handoff"],
  "check-game-map-ui.mjs": ["game-session", "game-flow", "game-map-loader", "saved-game", "static-audio"],
  "check-event-save.mjs": ["game-event-save", "saved-game", "game-flow", "game-session", "field",
    "field-event-checkpoint", "world-session", "game-content", "game-map-loader", "battle"],
};

export function frameworkContractReport(scope = "skeleton") {
  if (scope === "skeleton") return "build/reports/game-skeleton-check.json";
  if (scope === "full-suite") return "build/reports/framework-systems-check.json";
  throw new Error("Framework scope must be skeleton or full-suite");
}

function contractChecks(scope) {
  return scope === "skeleton" ? GAME_SKELETON_CHECKS.map(check => ({ ...check,
    report: `build/reports/game-skeleton/${check.id}.json`,
  })) : FRAMEWORK_SUITE_CHECKS.map(([id, script, report, countKey]) => ({ id, script,
    report: "build/reports/" + report, countKey,
  }));
}

function assertContract(condition, message) {
  if (!condition) throw new Error(message);
}

function exactIds(values, expected, description) {
  assertContract(Array.isArray(values) && values.length === expected.length,
    `${description} must contain every declared entry exactly once`);
  const ids = values.map(value => value?.id);
  assertContract(new Set(ids).size === ids.length && equal([...ids].sort(), [...expected].sort()),
    `${description} contains missing, duplicate or undeclared identities`);
}

/** Read only nominated local reports, never a path supplied by evidence JSON. */
async function reportBytes(root, path) {
  const base = await realpath(resolve(root, "build/reports"));
  const actual = await realpath(resolve(root, path));
  const child = relative(base, actual);
  assertContract(child.length > 0 && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child),
    "Framework evidence must remain within build/reports");
  return readFile(actual);
}

async function validateChildRuntime(root, compiled, definition, value, runtimeHash) {
  if (typeof value === "string") {
    assertContract(value === runtimeHash, `${definition.id} child report belongs to another runtime`);
    return;
  }
  const modules = moduleRuntimeChecks[definition.script];
  assertContract(modules && object(value) && equal(Object.keys(value).sort(), [...modules].sort()),
    `${definition.id} has an unknown or incomplete module-runtime dictionary`);
  const core = await realpath(resolve(root, compiled, "src/core"));
  for (const name of modules) {
    assertContract(digest(value[name]), `${definition.id} has an invalid module digest for ${name}`);
    const file = await realpath(resolve(core, name + ".js")), path = relative(core, file);
    assertContract(path === name + ".js", `${definition.id} module ${name} escapes the compiled core`);
    assertContract(sha(await readFile(file)) === value[name],
      `${definition.id} module ${name} differs from the compiled runtime`);
  }
}

/** A report is trusted local runner evidence, not an execution signature. Check
 * its entire retained evidence graph instead of promoting a boolean summary.
 * These contracts establish representative framework journeys only; the caller
 * must still apply the unchanged source dependency and route admission rules.
 * Malformed, missing, partial, stale and invalidated reports fail closed. There
 * is deliberately no automatic fallback from skeleton to the full suite. */
export async function readFrameworkContractEvidence(root, { scope = "skeleton", runtimeHash, compiled = "dist" }) {
  const report = frameworkContractReport(scope);
  if (!digest(runtimeHash)) throw new Error("Expected current runtime SHA-256");
  const evidence = { kind: "framework-contract-evidence-v1", scope, status: "incomplete",
    runtimeHash: zeroHash, report, sha256: null, evidenceHash: null, checks: [], diagnostics: [],
    sourceCampaignComplete: false, originalGameExecuted: false };
  const fail = (code, reason) => evidence.diagnostics.push({ code, reason });
  let aggregate;
  try {
    const bytes = await reportBytes(root, report);
    evidence.sha256 = sha(bytes); aggregate = JSON.parse(bytes);
    assertContract(object(aggregate), "Framework report must be an object");
    if (digest(aggregate.runtimeSha256)) evidence.runtimeHash = aggregate.runtimeSha256;
    const contract = scope === "skeleton" ? aggregate.skeletonContracts : aggregate.frameworkContracts;
    if (contract?.status === "invalidated" || evidence.runtimeHash !== runtimeHash) {
      evidence.status = "invalidated";
      fail("framework-evidence-runtime", "Framework evidence was invalidated or belongs to another runtime");
    }
    assertContract(aggregate.kind === (scope === "skeleton" ? "game-skeleton-check-v1" :
      "framework-system-integration-suite-v1"), "Unexpected framework evidence kind");
    assertContract(aggregate.result === "passed" && contract?.status === "passed",
      "Framework execution and contract status must both be passed");
    assertContract(digest(aggregate.runtimeSha256), "Framework report has no runtime identity");
    assertContract(aggregate.originalGameExecuted === false && aggregate.fullGameMigration === false,
      "Framework evidence must preserve its limited verification scope");
    const definitions = contractChecks(scope);
    exactIds(aggregate.checks, definitions.map(check => check.id), "Framework checks");
    if (scope === "skeleton") {
      assertContract(aggregate.readyForDeclaredContentBatches === true, "Skeleton readiness is incomplete");
      assertContract(typeof aggregate.compiledDirectory === "string" &&
        resolve(root, aggregate.compiledDirectory) === resolve(root, compiled),
      "Skeleton evidence used another compiled directory");
      exactIds(contract.groups, GAME_SKELETON_GROUPS.map(group => group.id), "Skeleton groups");
      for (const definition of GAME_SKELETON_GROUPS) {
        const group = contract.groups.find(item => item.id === definition.id);
        assertContract(group.status === "passed" && empty(group.missing) && equal(group.required, definition.required),
          `Skeleton group ${definition.id} has incomplete or changed requirements`);
      }
    } else {
      // The explicit legacy scope keeps the producer's existing child formats,
      // including reports whose success is represented only by completed cases.
      assertContract(empty(contract.missing), "Full-suite checks are incomplete");
    }
    for (const definition of definitions) {
      try {
        const check = aggregate.checks.find(item => item.id === definition.id);
        assertContract(check.report === definition.report, `${definition.id} report path differs from its contract`);
        assertContract(digest(check.sha256), `${definition.id} has no child report digest`);
        assertContract(Number.isSafeInteger(check.cases) && check.cases > 0, `${definition.id} has no exercised cases`);
        assertContract(scope === "skeleton" ? check.status === "passed" && check.script === "scripts/" + definition.script :
          check.result === "passed", `${definition.id} is incomplete or names another checker`);
        const bytes = await reportBytes(root, definition.report);
        assertContract(sha(bytes) === check.sha256, `${definition.id} child report changed after execution`);
        const child = JSON.parse(bytes);
        assertContract(object(child), `${definition.id} child report must be an object`);
        if (scope === "skeleton") {
          assertContract(child.kind === definition.kind, `${definition.id} returned another report kind`);
          assertContract(passed(child.result) && check.reportedResult === child.result,
            `${definition.id} did not report successful execution`);
        } else if (Object.hasOwn(child, "result")) {
          assertContract(passed(child.result), `${definition.id} did not report successful execution`);
        }
        if (Object.hasOwn(child, "status")) assertContract(passed(child.status), `${definition.id} status is not passed`);
        if (Object.hasOwn(child, "runtimeSha256"))
          await validateChildRuntime(root, compiled, definition, child.runtimeSha256, runtimeHash);
        const cases = definition.countKey.split(".").reduce((value, key) => value?.[key], child);
        assertContract(Array.isArray(cases) && cases.length === check.cases && cases.length > 0,
          `${definition.id} case count differs from its executed report`);
        if (scope === "skeleton") {
          const names = cases.map(item => {
            assertContract(object(item) && text(item.name), `${definition.id} has an unnamed scenario`);
            if (definition.marker) assertContract(item[definition.marker] === true,
              `${definition.id} has an unfinished scenario`);
            // Stage-only reports have no mandatory per-stage marker, but an
            // explicit failure can never be hidden behind aggregate success.
            for (const key of ["result", "status"]) if (Object.hasOwn(item, key))
              assertContract(passed(item[key]), `${definition.id} has an unsuccessful scenario`);
            for (const key of ["pass", "passed"]) if (typeof item[key] === "boolean")
              assertContract(item[key], `${definition.id} has an unsuccessful scenario`);
            return item.name;
          });
          assertContract(new Set(names).size === names.length && equal(check.scenarios, names),
            `${definition.id} scenario summary is duplicate, missing or changed`);
        } else {
          assertContract(cases.every(item => text(item) || (object(item) && Object.keys(item).length > 0)),
            `${definition.id} has empty legacy case evidence`);
          for (const item of cases.filter(object)) {
            for (const key of ["result", "status"]) if (Object.hasOwn(item, key))
              assertContract(passed(item[key]), `${definition.id} has an unsuccessful case`);
            for (const key of ["pass", "passed"]) if (typeof item[key] === "boolean")
              assertContract(item[key], `${definition.id} has an unsuccessful case`);
          }
        }
        evidence.checks.push({ id: check.id, report: definition.report, sha256: check.sha256, cases: cases.length });
      } catch (error) { fail("framework-evidence-check", `${definition.id}: ${error.message}`); }
    }
  } catch (error) { fail("framework-evidence-report", error.message); }
  evidence.evidenceHash = sha(JSON.stringify({ report, sha256: evidence.sha256, checks: evidence.checks }));
  if (evidence.diagnostics.length === 0) evidence.status = "passed";
  return evidence;
}

/** Re-read evidence after route execution. Even a different valid replacement
 * report must not retroactively authorize a run begun under other evidence. */
export function finishFrameworkContractEvidence(before, after, runtimeHash, afterRuntimeHash) {
  const diagnostics = [...before.diagnostics, ...after.diagnostics]
    .filter((item, index, values) => values.findIndex(other => equal(other, item)) === index);
  const changed = before.evidenceHash !== after.evidenceHash || before.scope !== after.scope ||
    runtimeHash !== afterRuntimeHash;
  if (changed) diagnostics.push({ code: "framework-evidence-changed",
    reason: "Runtime or retained framework evidence changed during the batch run" });
  return { framework: { status: changed || before.status === "invalidated" || after.status === "invalidated"
    ? "invalidated" : before.status === "passed" && after.status === "passed" ? "passed" : "incomplete",
  runtimeHash: before.runtimeHash }, diagnostics };
}
