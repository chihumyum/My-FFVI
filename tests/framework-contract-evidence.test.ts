import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assessContentBatchAdmission, type ContentBatchAdmissionInput } from "../src/compiler/content-batch-admission.js";

type Scope = "skeleton" | "full-suite";
type Evidence = {
  kind: string; scope: Scope; status: "passed" | "incomplete" | "invalidated";
  runtimeHash: string; evidenceHash: string; checks: { id: string; cases: number }[];
  diagnostics: { code: string; reason: string }[];
};
type CheckDefinition = { id: string; script: string; kind: string; countKey: string; marker: string | null };
type Group = { id: string; label: string; required: string[] };
const helper: {
  frameworkContractReport(scope?: Scope): string;
  readFrameworkContractEvidence(root: string, options: { scope?: Scope; runtimeHash: string; compiled?: string }): Promise<Evidence>;
  finishFrameworkContractEvidence(before: Evidence, after: Evidence, runtimeHash: string, afterRuntimeHash: string): {
    framework: ContentBatchAdmissionInput["framework"]; diagnostics: { code: string; reason: string }[];
  };
} = await import(pathToFileURL(resolve(process.cwd(), "scripts/framework-contract-evidence.mjs")).href);
const { GAME_SKELETON_CHECKS: checks, GAME_SKELETON_GROUPS: groups }: {
  GAME_SKELETON_CHECKS: CheckDefinition[]; GAME_SKELETON_GROUPS: Group[];
} = await import(pathToFileURL(resolve(process.cwd(), "scripts/game-skeleton-contract.mjs")).href);
const { FRAMEWORK_SUITE_CHECKS: fullChecks }: { FRAMEWORK_SUITE_CHECKS: [string, string, string, string][] } =
  await import(pathToFileURL(resolve(process.cwd(), "scripts/framework-suite-contract.mjs")).href);
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const runtimeHash = sha("controlled unit runtime");
type JsonObject = Record<string, any>;
// Actual check-game-entry-ui report schema, not a whole-runtime digest string.
const entryModules = ["game-session", "game-flow", "game-commands", "game-entry-loader", "game-content",
  "game-content-refs", "game-package-selection", "game-development-entry", "saved-game", "source-new-game",
  "game-event-save", "field-event-checkpoint", "game-battle-handoff"];
async function moduleHashes(root: string, names: string[], compiled = "dist") {
  const core = resolve(root, compiled, "src/core"); await mkdir(core, { recursive: true });
  return Object.fromEntries(await Promise.all(names.map(async name => {
    const bytes = `export const fixtureModule = ${JSON.stringify(name)};\n`;
    await writeFile(resolve(core, name + ".js"), bytes);
    return [name, sha(bytes)];
  })));
}

async function fixture(t: { after(fn: () => Promise<void>): void }, scope: Scope = "skeleton") {
  const root = await mkdtemp(resolve(tmpdir(), "framework-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path: string, value: unknown) => {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), bytes); return sha(bytes);
  };
  const children = new Map<string, JsonObject>();
  const report: JsonObject = { kind: scope === "skeleton" ? "game-skeleton-check-v1" : "framework-system-integration-suite-v1",
    result: "passed", runtimeSha256: runtimeHash, originalGameExecuted: false, fullGameMigration: false, checks: [] };
  if (scope === "skeleton") {
    report.compiledDirectory = "dist";
    report.readyForDeclaredContentBatches = true;
    report.skeletonContracts = { status: "passed", groups: groups.map(group => ({ ...structuredClone(group), status: "passed", missing: [] })) };
    for (const definition of checks) {
      const names = [definition.id + " first actual case", definition.id + " retry case"];
      const child = { kind: definition.kind, result: "passed", runtimeSha256: runtimeHash,
        [definition.countKey]: names.map(name => ({ name, ...(definition.marker ? { [definition.marker]: true } : {}) })) };
      children.set(definition.id, child);
      const path = `build/reports/game-skeleton/${definition.id}.json`;
      report.checks.push({ id: definition.id, script: "scripts/" + definition.script, status: "passed", report: path,
        sha256: await write(path, child), cases: names.length, scenarios: names, reportedResult: "passed" });
    }
  } else {
    report.frameworkContracts = { status: "passed", missing: [] };
    for (const [id, , artifact, key] of fullChecks) {
      const child: JsonObject = { result: "passed" };
      const parts = key.split("."); let target = child;
      for (const part of parts.slice(0, -1)) target = target[part] = {};
      target[parts.at(-1)!] = [{ name: id + " legacy exercise", pass: true }];
      children.set(id, child);
      const path = "build/reports/" + artifact;
      report.checks.push({ id, report: path, sha256: await write(path, child), cases: 1, result: "passed" });
    }
  }
  const publish = () => write(helper.frameworkContractReport(scope), report);
  const publishChild = async (id: string, rebind = true) => {
    const check = report.checks.find((item: JsonObject) => item.id === id);
    const hash = await write(check.report, children.get(id));
    if (rebind) { check.sha256 = hash; await publish(); }
  };
  await publish();
  return { root, scope, report, children, publish, publishChild,
    read: () => helper.readFrameworkContractEvidence(root, { scope, runtimeHash }) };
}

test("default evidence reads every skeleton group, retained child and exercised case", async t => {
  const f = await fixture(t);
  assert.equal(checks.length, 7); assert.equal(groups.length, 6);
  const found = await helper.readFrameworkContractEvidence(f.root, { runtimeHash });
  assert.equal(found.scope, "skeleton"); assert.equal(found.status, "passed");
  assert.equal(found.checks.length, checks.length); assert.equal(found.checks.reduce((sum, check) => sum + check.cases, 0), 14);
  assert.deepEqual(found.diagnostics, []);
  assert.equal(helper.finishFrameworkContractEvidence(found, await f.read(), runtimeHash, runtimeHash).framework.status, "passed");
});

test("actual entry-report module dictionary verifies all thirteen nominated compiled files", async t => {
  const f = await fixture(t), compiled = "build/entry-runtime";
  f.report.compiledDirectory = compiled;
  f.children.get("entry-session")!.runtimeSha256 = await moduleHashes(f.root, entryModules, compiled);
  await f.publishChild("entry-session");
  const found = await helper.readFrameworkContractEvidence(f.root, { runtimeHash, compiled });
  assert.equal(found.status, "passed", JSON.stringify(found.diagnostics));
  assert.equal(found.checks.length, 7);
  assert.notEqual((await f.read()).status, "passed", "The reader cannot substitute another compiled directory");
});

test("module dictionaries reject different digests and files modified after a valid read", async t => {
  const f = await fixture(t), child = f.children.get("entry-session")!;
  const hashes = await moduleHashes(f.root, entryModules);
  child.runtimeSha256 = { ...hashes, "game-session": sha("another game-session file") };
  await f.publishChild("entry-session");
  const mismatch = await f.read();
  assert.notEqual(mismatch.status, "passed");
  assert.ok(mismatch.diagnostics.some(item => item.reason.includes("module game-session differs")));
  child.runtimeSha256 = hashes; await f.publishChild("entry-session");
  const before = await f.read(); assert.equal(before.status, "passed");
  await writeFile(resolve(f.root, "dist/src/core/game-flow.js"), "export const replaced = true;\n");
  const after = await f.read(); assert.notEqual(after.status, "passed");
  assert.ok(after.diagnostics.some(item => item.reason.includes("module game-flow differs")));
  assert.equal(helper.finishFrameworkContractEvidence(before, after, runtimeHash, runtimeHash).framework.status, "invalidated");
});

test("unknown, partial and malformed module dictionaries are never skipped", async t => {
  const f = await fixture(t), child = f.children.get("entry-session")!;
  const hashes = await moduleHashes(f.root, entryModules);
  const incomplete = { ...hashes }; delete incomplete["game-flow"];
  const invalid = [null, [], {}, incomplete, { ...hashes, "not-a-core-module": sha("extra") },
    { ...hashes, "../game-flow": hashes["game-flow"] }, { ...hashes, "game-flow": "not-a-sha" }];
  for (const value of invalid) {
    child.runtimeSha256 = value; await f.publishChild("entry-session");
    assert.notEqual((await f.read()).status, "passed");
  }
  child.runtimeSha256 = hashes; await f.publishChild("entry-session");
  const unrelated = f.children.get("continuous-playground")!;
  unrelated.runtimeSha256 = hashes; await f.publishChild("continuous-playground");
  assert.notEqual((await f.read()).status, "passed", "Unknown checker dictionaries need an explicit contract");
});

test("module byte validation refuses a missing file or a symlink outside the nominated core", async t => {
  const f = await fixture(t), child = f.children.get("entry-session")!;
  child.runtimeSha256 = await moduleHashes(f.root, entryModules); await f.publishChild("entry-session");
  const path = resolve(f.root, "dist/src/core/game-session.js"), bytes = await readFile(path);
  await rm(path); assert.notEqual((await f.read()).status, "passed");
  const outside = resolve(f.root, "same-bytes-outside-core.js");
  await writeFile(outside, bytes); await symlink(outside, path);
  const found = await f.read(); assert.notEqual(found.status, "passed");
  assert.ok(found.diagnostics.some(item => item.reason.includes("escapes the compiled core")));
});

test("explicit full-suite compatibility also verifies its three existing module-dictionary reports", async t => {
  const f = await fixture(t, "full-suite");
  const dictionaries: [string, string[]][] = [
    ["session-entry-ui", entryModules],
    ["host-io-recovery", ["game-session", "game-flow", "game-map-loader", "saved-game", "static-audio"]],
    ["event-save-continuation", ["game-event-save", "saved-game", "game-flow", "game-session", "field",
      "field-event-checkpoint", "world-session", "game-content", "game-map-loader", "battle"]],
  ];
  for (const [id, modules] of dictionaries) {
    f.children.get(id)!.runtimeSha256 = await moduleHashes(f.root, modules); await f.publishChild(id);
  }
  assert.equal((await f.read()).status, "passed");
  await writeFile(resolve(f.root, "dist/src/core/field.js"), "changed compiled field\n");
  assert.notEqual((await f.read()).status, "passed");
});

test("aggregate success does not authorize partial, invalidated or another report contract", async t => {
  const f = await fixture(t), baseline = structuredClone(f.report);
  const mutations: ((value: JsonObject) => void)[] = [
    r => { r.kind = "framework-system-integration-suite-v1"; },
    r => { r.result = "running"; }, r => { r.result = "failed"; },
    r => { r.skeletonContracts.status = "invalidated"; },
    r => { r.skeletonContracts.status = "incomplete"; },
    r => { r.readyForDeclaredContentBatches = false; },
    r => { delete r.runtimeSha256; }, r => { r.runtimeSha256 = sha("old runtime"); },
    r => { r.compiledDirectory = "another-dist"; },
    r => { r.originalGameExecuted = true; },
  ];
  for (const change of mutations) {
    Object.keys(f.report).forEach(key => { delete f.report[key]; }); Object.assign(f.report, structuredClone(baseline));
    change(f.report); await f.publish(); assert.notEqual((await f.read()).status, "passed");
  }
});

test("every exact group and checker is required once without deleting a group's dependencies", async t => {
  const f = await fixture(t), baseline = structuredClone(f.report);
  const mutations: ((value: JsonObject) => void)[] = [
    r => { r.checks.pop(); }, r => { r.checks[1] = r.checks[0]; }, r => { r.checks.push(r.checks[0]); },
    r => { r.checks[0].id = "unrelated-check"; },
    r => { r.skeletonContracts.groups.pop(); },
    r => { r.skeletonContracts.groups[1] = r.skeletonContracts.groups[0]; },
    r => { r.skeletonContracts.groups[0].required.pop(); },
    r => { r.skeletonContracts.groups[0].status = "partial"; },
    r => { r.skeletonContracts.groups[0].missing = ["entry-session"]; },
  ];
  for (const change of mutations) {
    Object.assign(f.report, structuredClone(baseline)); change(f.report); await f.publish();
    assert.notEqual((await f.read()).status, "passed");
  }
});

test("aggregate case counts, names, scripts and report paths must agree with retained evidence", async t => {
  const f = await fixture(t), baseline = structuredClone(f.report);
  const mutations: ((value: JsonObject) => void)[] = [
    c => { c.status = "not-run"; }, c => { c.cases = 0; }, c => { c.cases = 999; }, c => { c.cases = "2"; },
    c => { c.scenarios = ["forged stage", "also forged"]; }, c => { delete c.scenarios; },
    c => { c.script = "scripts/check-unrelated.mjs"; }, c => { c.report = "../elsewhere.json"; },
    c => { c.reportedResult = "failed"; }, c => { c.sha256 = sha("another child"); },
  ];
  for (const change of mutations) {
    Object.assign(f.report, structuredClone(baseline)); change(f.report.checks[0]); await f.publish();
    assert.notEqual((await f.read()).status, "passed");
  }
});

test("rehashed children still require the correct contract and completed named cases", async t => {
  const f = await fixture(t), id = checks[0]!.id, baseline = structuredClone(f.children.get(id)!);
  const mutations: ((value: JsonObject) => void)[] = [
    c => { c.kind = "different-kind"; }, c => { c.result = "failed"; }, c => { c.status = "invalidated"; },
    c => { c.runtimeSha256 = sha("another compiled runtime"); },
    c => { c.tests = []; }, c => { c.tests[0].pass = false; }, c => { delete c.tests[0].pass; },
    c => { c.tests[0].name = ""; }, c => { c.tests[0].name = c.tests[1].name; },
    c => { c.tests[0].status = "running"; },
  ];
  for (const change of mutations) {
    const child = structuredClone(baseline); change(child); f.children.set(id, child); await f.publishChild(id);
    assert.notEqual((await f.read()).status, "passed");
  }
});

test("stage-only evidence cannot hide an explicit failed stage", async t => {
  const f = await fixture(t), child = f.children.get("battle-roundtrip")!;
  child.stages[0].passed = false; await f.publishChild("battle-roundtrip");
  assert.notEqual((await f.read()).status, "passed");
});

test("missing, malformed, changed and external child bytes never grant admission", async t => {
  const f = await fixture(t), id = checks[0]!.id, path = resolve(f.root, f.report.checks[0].report);
  const bytes = await readFile(path);
  await writeFile(path, Buffer.concat([bytes, Buffer.from("\n")]));
  assert.notEqual((await f.read()).status, "passed");
  await rm(path); assert.notEqual((await f.read()).status, "passed");
  await writeFile(path, "{invalid"); f.report.checks[0].sha256 = sha("{invalid"); await f.publish();
  assert.notEqual((await f.read()).status, "passed");
  await rm(path); const outside = resolve(f.root, "outside-reports.json"); await writeFile(outside, bytes); await symlink(outside, path);
  f.report.checks[0].sha256 = sha(bytes); await f.publish();
  assert.notEqual((await f.read()).status, "passed");
  assert.ok((await f.read()).diagnostics.some(item => item.reason.includes(id)));
});

test("evidence uses the nominated compiled runtime rather than just a matching label", async t => {
  const f = await fixture(t);
  f.report.compiledDirectory = "build/isolated"; await f.publish();
  assert.notEqual((await f.read()).status, "passed");
  assert.equal((await helper.readFrameworkContractEvidence(f.root, { runtimeHash, compiled: "build/isolated" })).status, "passed");
  assert.equal((await helper.readFrameworkContractEvidence(f.root, { runtimeHash: sha("changed"), compiled: "build/isolated" })).status, "invalidated");
});

test("full suite is an explicit compatibility scope with all declared child evidence", async t => {
  const f = await fixture(t, "full-suite");
  assert.equal((await f.read()).status, "passed");
  assert.equal((await f.read()).checks.length, fullChecks.length);
  assert.equal((await helper.readFrameworkContractEvidence(f.root, { runtimeHash })).status, "incomplete");
  f.report.checks.pop(); await f.publish(); assert.notEqual((await f.read()).status, "passed");
});

test("full-suite child hash failures and incomplete contracts are not accepted as compatibility", async t => {
  const f = await fixture(t, "full-suite");
  const child = f.children.get(fullChecks[0]![0])!; child.stages[0].pass = false;
  await f.publishChild(fullChecks[0]![0]); assert.notEqual((await f.read()).status, "passed");
  child.stages[0].pass = true; await f.publishChild(fullChecks[0]![0]);
  f.report.frameworkContracts.missing = [fullChecks[0]![0]]; await f.publish();
  assert.notEqual((await f.read()).status, "passed");
});

test("runtime changes and even valid report replacements during a route invalidate its gate", async t => {
  const f = await fixture(t), before = await f.read();
  f.report.finishedAt = "a separate run"; await f.publish();
  const after = await f.read(); assert.equal(after.status, "passed");
  const changed = helper.finishFrameworkContractEvidence(before, after, runtimeHash, runtimeHash);
  assert.equal(changed.framework.status, "invalidated");
  assert.ok(changed.diagnostics.some(item => item.code === "framework-evidence-changed"));
  assert.equal(helper.finishFrameworkContractEvidence(after, after, runtimeHash, sha("new runtime")).framework.status, "invalidated");
});

test("a late child edit fails revalidation even if the aggregate has not changed", async t => {
  const f = await fixture(t), before = await f.read();
  f.children.get(checks[0]!.id)!.tests[0].pass = false; await f.publishChild(checks[0]!.id, false);
  const result = helper.finishFrameworkContractEvidence(before, await f.read(), runtimeHash, runtimeHash);
  assert.notEqual(result.framework.status, "passed"); assert.ok(result.diagnostics.length > 0);
});

test("framework evidence does not remove source closure or continuous route requirements", async t => {
  const f = await fixture(t), evidence = await f.read();
  const ready = helper.finishFrameworkContractEvidence(evidence, evidence, runtimeHash, runtimeHash);
  const input: ContentBatchAdmissionInput = {
    manifestHash: sha("manifest"), dependencyHash: sha("dependency"), runtimeHash,
    contentHashes: { field: sha("field") }, profile: "source", framework: ready.framework,
    routes: [{ id: "source-route", entry: "source-new-game", expectedMapId: 1, requiredMapIds: [1], requiredEncounterIds: [] }],
    diagnostics: [{ code: "SOURCE_DEPENDENCY_MISSING", reason: "unresolved source dependency" }], receipts: [],
  };
  const result = assessContentBatchAdmission(input);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some(item => item.code === "SOURCE_DEPENDENCY_MISSING"));
  assert.ok(result.blockers.some(item => item.code === "missing-receipt"));
  assert.equal(result.sourceCampaignComplete, false); assert.equal(result.originalGameExecuted, false);
});
