import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GameContentRepository } from "../dist/src/core/game-content.js";
import { parseGameContentRefs } from "../dist/src/core/game-content-refs.js";
import { planContentBatch } from "../dist/src/compiler/content-batch.js";
import { assessContentBatchAdmission } from "../dist/src/compiler/content-batch-admission.js";
import { contentBatchFixture } from "../dist/tests/fixtures/content-batch.js";
import { readSourceBatch, batchRouteSpecs } from "./content-batch-files.mjs";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), tests = [];
const output = resolve(root, "build/reports/content-packages-check.json");
const report = { kind: "game-content-packages-check-v1", result: "running", tests,
  actualPackages: [], syntheticJourney: null, sourceBatch: null,
  browserVerified: false, originalGameExecuted: false, sourceGameplayAdmitted: false, fullGameMigration: false };
const json = async path => JSON.parse(await readFile(resolve(root, path), "utf8"));
await mkdir(resolve(root, "build/reports"), { recursive: true });
try {
  report.runtimeSha256 = await runtimeDigest(root);
  for (const id of ["source", "framework", "development"]) {
    const refs = parseGameContentRefs(await json(`build/content-packages/${id}.json`)), calls = [];
    const repository = new GameContentRepository(async url => {
      calls.push(url);
      assert.match(url, /^\/(content-packages|world|framework)\/[a-zA-Z0-9/_-]+\.json$/);
      return json("build" + url);
    }, refs.profile, refs);
    const catalog = await repository.world(); assert.equal(catalog.contentHash, refs.world.contentHash);
    if (refs.source) {
      const entry = await repository.sourceNewGame();
      assert.equal(entry.content.contentHash, refs.source.entry.contentHash);
      assert.equal(entry.battle.contentHash, refs.source.battle.contentHash);
    } else {
      const before = [...calls]; await assert.rejects(repository.sourceNewGame(), /entry is unavailable/);
      assert.deepEqual(calls, before);
    }
    const opening = await repository.opening();
    assert.equal(opening.field.contentHash, refs.development.entry.contentHash);
    assert.equal(opening.battle.contentHash, refs.development.battle.contentHash);
    assert.ok(calls.every(url => !url.startsWith("/game/")), "Package roles must not use a compatibility fallback");
    report.actualPackages.push({ id, profile: refs.profile, refs, requests: calls });
    tests.push({ name: `actual-${id}-package-role-pins-and-no-legacy-roots`, passed: true });
  }

  const actual = await readSourceBatch(root, "content-batches/framework-opening.json");
  assert.ok(actual.plan.manifest.contentRefs);
  assert.equal(actual.plan.contentHashes.entry, actual.plan.manifest.contentRefs.source.entry.contentHash);
  assert.equal(actual.plan.contentHashes.world, actual.plan.manifest.contentRefs.world.contentHash);
  report.sourceBatch = { manifestHash: actual.plan.manifestHash, dependencyHash: actual.plan.dependencyHash,
    contentHashes: actual.plan.contentHashes, referenceClosure: actual.plan.dependencies.referenceClosure,
    diagnostics: actual.plan.diagnostics.length, admission: "not-granted" };
  tests.push({ name: "actual-source-batch-uses-the-same-host-references-and-retains-source-gaps", passed: true });

  // One authored continuous route exercises references at every owner seam.
  // It is neither a real source story nor an external systems certificate.
  const f = contentBatchFixture(), { packages, manifest } = f;
  packages.battle.common.sprites.synthetic = { file: "/synthetic/player.png", width: 16, height: 16 };
  const { sealBatchContent } = await import("../dist/tests/fixtures/content-batch.js");
  packages.battle = sealBatchContent(packages.battle);
  const refs = parseGameContentRefs({ kind: "game-content-refs-v1", profile: "source",
    world: { url: "/content-packages/controlled/world.json", contentHash: packages.catalog.contentHash }, source: null,
    development: { entry: { url: "/content-packages/controlled/entry.json", contentHash: packages.entry.contentHash },
      battle: { url: "/content-packages/controlled/battle.json", contentHash: packages.battle.contentHash } } });
  const files = new Map([[refs.world.url, packages.catalog], [refs.development.entry.url, packages.entry],
    [refs.development.battle.url, packages.battle],
    ...packages.maps.map(map => [packages.catalog.maps[map.mapId].url, map])]);
  const requested = [], reader = async url => {
    requested.push(url); assert.ok(files.has(url), "Undeclared package request: " + url); return files.get(url);
  };
  const selected = { ...manifest, contentRefs: refs }, plan = planContentBatch(selected, packages);
  const run = await runContentBatchRoute({ root, plan, routeId: selected.routes[0].id,
    repository: new GameContentRepository(reader, "source", refs), runtimeHash: report.runtimeSha256 });
  assert.equal(run.receipt.result, "completed", JSON.stringify(run));
  assert.deepEqual(run.receipt.visitedMapIds, [1, 2]); assert.deepEqual(run.receipt.completedEncounterIds, [1000]);
  assert.equal(run.execution.committedStarts, 1); assert.equal(run.execution.committedReturns, 1);
  assert.equal(run.execution.loadsCommitted, 1); assert.equal(run.execution.staleCommandChannelsRejected, 1);
  assert.equal(run.trace.find(step => step.kind === "victory").gilAward, 14);
  assert.ok(requested.every(url => url !== "/game/content.json" && url !== "/game/battle.json" && url !== "/world/catalog.json"));
  const admission = assessContentBatchAdmission({ manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash,
    runtimeHash: report.runtimeSha256, contentHashes: plan.contentHashes, profile: manifest.profile,
    routes: batchRouteSpecs(selected), diagnostics: plan.diagnostics,
    framework: { status: "passed", runtimeHash: report.runtimeSha256 }, receipts: [run.receipt] });
  assert.equal(admission.status, "passed");
  report.syntheticJourney = { run, admission, requests: requested, evidence: "authored controlled content and systems gate input" };
  tests.push({ name: "custom-roots-event-save-prepared-battle-reward-map-and-restore-through-public-owners", passed: true });

  const before = [...requested], wrong = new GameContentRepository(reader, "source",
    { ...refs, world: { ...refs.world, contentHash: "0".repeat(64) } });
  const rejected = await runContentBatchRoute({ root, plan, routeId: selected.routes[0].id,
    repository: wrong, runtimeHash: report.runtimeSha256 });
  assert.equal(rejected.receipt.result, "failed"); assert.deepEqual(rejected.trace, []);
  assert.deepEqual(rejected.receipt.completedEncounterIds, []); assert.equal(rejected.receipt.saveRestored, false);
  assert.deepEqual(requested.slice(before.length), [refs.world.url]);
  tests.push({ name: "wrong-host-pin-rejects-before-entry-without-fallback-or-rewards", passed: true });
  assert.equal(await runtimeDigest(root), report.runtimeSha256, "Runtime changed during package integration");
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: tests.length, report: "build/reports/content-packages-check.json" }));
}
