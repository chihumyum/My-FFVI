import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { batchRouteSpecs } from "./content-batch-files.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir");
const compiled = args[1] ?? "dist", load = name => import(pathToFileURL(resolve(root, compiled, name + ".js")));
const [{ contentBatchFixture, sealBatchContent }, { planContentBatch }, { assessContentBatchAdmission }, { GameContentRepository },
  { GameCommands }, { GameEntryLoader }, { GameBattleHandoff }] = await Promise.all([
  load("tests/fixtures/content-batch"), load("src/compiler/content-batch"), load("src/compiler/content-batch-admission"), load("src/core/game-content"),
  load("src/core/game-commands"), load("src/core/game-entry-loader"), load("src/core/game-battle-handoff"),
]);
const runtimeHash = await runtimeDigest(root, compiled), fixture = contentBatchFixture();
const { packages, manifest } = fixture;
// The old synchronous fixture had player pose identities without their media.
// This checker explicitly declares that authored asset for the prepared lane;
// the runner never invents a missing reference in source or supplied packages.
packages.battle.common.sprites.synthetic = { file: "/synthetic/player.png", width: 16, height: 16 };
packages.battle = sealBatchContent(packages.battle);
const plan = planContentBatch(manifest, packages), { entry, catalog, battle, maps } = packages;
const files = new Map([["/game/content.json", entry], ["/game/battle.json", battle], ["/world/catalog.json", catalog],
  ...maps.map(m => [catalog.maps[m.mapId].url, m])]);
const repository = new GameContentRepository(async url => {
  assert.ok(files.has(url), "Unprovided fixture content " + url); return files.get(url);
});
const route = manifest.routes[0], calls = { entries: [], battleStarts: 0, battleReturns: 0,
  battleCommands: 0, acceptedCommands: 0, staleSettingsRejected: 0 };
// Observe the real shared methods, with their implementations and owners intact.
// This prevents a route's descriptive trace from hiding a direct-command or
// synchronous handoff bypass. Always restore prototypes before negative runs.
const originals = { entry: GameEntryLoader.prototype.begin, start: GameBattleHandoff.prototype.start,
  return: GameBattleHandoff.prototype.return, command: GameCommands.prototype.command,
  settings: GameCommands.prototype.setBattlePreferences };
let run;
try {
  GameEntryLoader.prototype.begin = function (kind) { calls.entries.push(kind); return originals.entry.call(this, kind); };
  GameBattleHandoff.prototype.start = function () { calls.battleStarts++; return originals.start.call(this); };
  GameBattleHandoff.prototype.return = function () { calls.battleReturns++; return originals.return.call(this); };
  GameCommands.prototype.command = function (...args) {
    assert.equal(this.battleReady, true); assert.equal(this.ownsBattle(args[0]), true);
    calls.battleCommands++;
    const accepted = originals.command.apply(this, args);
    if (accepted) calls.acceptedCommands++;
    return accepted;
  };
  GameCommands.prototype.setBattlePreferences = function (...args) {
    const before = this.owner.checkpoint(), accepted = originals.settings.apply(this, args);
    assert.equal(accepted, false, "The only undeclared settings probe is the obsolete owner rejection");
    assert.deepEqual(this.owner.checkpoint(), before);
    calls.staleSettingsRejected++;
    return accepted;
  };
  run = await runContentBatchRoute({ root, compiled, plan, routeId: route.id, repository, runtimeHash });
} finally {
  GameEntryLoader.prototype.begin = originals.entry;
  GameBattleHandoff.prototype.start = originals.start;
  GameBattleHandoff.prototype.return = originals.return;
  GameCommands.prototype.command = originals.command;
  GameCommands.prototype.setBattlePreferences = originals.settings;
}
const base = { manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash, contentHashes: plan.contentHashes,
  profile: manifest.profile, routes: batchRouteSpecs(manifest), diagnostics: plan.diagnostics.map(({ code, reason }) => ({ code, reason })),
  // This is the gate's synthetic input fixture, not a claimed external systems
  // certificate. The containing framework suite exercises the real contracts.
  framework: { status: "passed", runtimeHash }, receipts: [run.receipt] };
const admission = assessContentBatchAdmission(base), tests = [];
const output = resolve(root, "build/reports/content-batch-pipeline-check.json");
const report = { kind: "controlled-content-batch-pipeline-v1", result: "running", plan, run, admission, calls, tests,
  evidence: { lane: "synthetic-controlled", frameworkReceipt: "authored gate fixture",
    sharedInterfaces: ["GameEntryLoader", "GameBattleHandoff/prepared", "GameCommands", "GameMapLoader", "GameEventSaveCoordinator"],
    media: "explicit synthetic player/background/enemy references; headless readiness without image decoding",
    menu: "readiness and stale-owner rejection only; no undeclared successful menu mutation",
    sourceMapCoverage: false, browserVerified: false, originalGameExecuted: false, fullGameMigration: false } };
await mkdir(resolve(root, "build/reports"), { recursive: true });
try {
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run));
  assert.equal(admission.status, "passed", JSON.stringify(admission));
  assert.deepEqual(run.receipt.visitedMapIds, [1, 2]); assert.deepEqual(run.receipt.completedEncounterIds, [1000]);
  assert.equal(run.trace.find(step => step.kind === "victory").gilAward, 14); assert.ok(run.commands > 0);
  assert.ok(run.trace.some(step => step.kind === "event-save")); assert.ok(run.checkpointHash);
  tests.push({ name: "walk-trigger-event-save-prepared-battle-map-menu-readiness-save-restore", passed: true });
  assert.deepEqual(calls.entries, ["new-game", "load"]);
  assert.equal(run.execution.entry, "GameEntryLoader"); assert.equal(run.execution.entriesCommitted, 1);
  assert.equal(run.execution.loadsCommitted, 1);
  const restored = run.trace.find(step => step.kind === "save-restore");
  assert.equal(restored.entry, "GameEntryLoader"); assert.equal(restored.paused, true);
  tests.push({ name: "actual-entry-and-paused-restore-use-one-entry-loader", passed: true });
  assert.equal(calls.battleStarts, 1); assert.equal(run.execution.battleHandoff, "prepared");
  assert.equal(run.execution.preparedStarts, 1); assert.equal(run.execution.committedStarts, 1);
  const preparing = run.trace.find(step => step.kind === "battle-preparation" && step.operation === "start");
  assert.equal(preparing.phase, "battle-entry"); assert.equal(preparing.activeBattle, false);
  assert.equal(preparing.elapsedDropped, true); assert.ok(preparing.mediaUrls.length > 0);
  tests.push({ name: "real-prepared-start-retains-the-lease-without-publishing-or-advancing-battle", passed: true });
  assert.equal(calls.acceptedCommands, run.commands); assert.ok(calls.battleCommands > 0);
  assert.equal(run.execution.commands, "GameCommands"); assert.equal(calls.staleSettingsRejected, 1);
  assert.equal(run.execution.staleCommandChannelsRejected, 1); assert.equal(restored.staleCommandsRejected, true);
  const menu = run.trace.find(step => step.kind === "menu-ready");
  assert.equal(menu.ownerBound, true); assert.equal(menu.commandReady, true); assert.equal(menu.mutation, "none");
  tests.push({ name: "battle-inputs-use-owner-bound-commands-and-old-owner-is-rejected-after-restore", passed: true });
  assert.equal(calls.battleReturns, 2, "One return plus one rejected duplicate confirmation");
  assert.equal(run.execution.preparedReturns, 1); assert.equal(run.execution.committedReturns, 1);
  assert.equal(run.execution.duplicateReturnsRejected, 1);
  const returning = run.trace.find(step => step.kind === "battle-preparation" && step.operation === "return");
  assert.equal(returning.phase, "battle-return"); assert.equal(returning.terminalBattleRetained, true);
  assert.equal(returning.ownedUnchanged, true); assert.equal(returning.elapsedDropped, true);
  const victory = run.trace.find(step => step.kind === "victory");
  assert.equal(victory.completedBattles, 1); assert.equal(victory.duplicateReturnRejected, true);
  assert.equal(run.trace.filter(step => step.kind === "victory").length, 1);
  tests.push({ name: "prepared-return-and-duplicate-confirmation-publish-one-owned-reward-receipt", passed: true });
  const reject = (name, value) => { assert.equal(assessContentBatchAdmission(value).status, "blocked"); tests.push({ name, passed: true }); };
  reject("old-runtime-receipt", { ...base, runtimeHash: "0".repeat(64) });
  reject("no-route-evidence", { ...base, receipts: [] });
  reject("mid-route-boundary-is-not-completion", { ...base, receipts: [{ ...run.receipt, result: "blocked", boundary: { kind: "unsupported" } }] });
  reject("incomplete-coverage", { ...base, receipts: [{ ...run.receipt, visitedMapIds: [2] }] });
  reject("restore-is-mandatory", { ...base, receipts: [{ ...run.receipt, saveRestored: false }] });
  const changed = structuredClone(packages);
  changed.maps[1].name = "Changed content"; changed.maps[1] = sealBatchContent(changed.maps[1]);
  changed.catalog.maps[2].contentHash = changed.maps[1].contentHash; changed.catalog = sealBatchContent(changed.catalog);
  const next = planContentBatch(manifest, changed);
  reject("rehashed-content-invalidates-previous-route", { ...base, dependencyHash: next.dependencyHash, contentHashes: next.contentHashes });
  const substitutedWorld = sealBatchContent({ ...catalog, limitations: [...catalog.limitations, "Changed shared provider package"] });
  const otherRepository = new GameContentRepository(async url => url === "/world/catalog.json" ? substitutedWorld : files.get(url));
  const mismatched = await runContentBatchRoute({ root, compiled, plan, routeId: route.id, repository: otherRepository, runtimeHash });
  assert.equal(mismatched.receipt.result, "failed");
  assert.match(mismatched.receipt.boundary.reason, /Route dependency changed: world/);
  assert.deepEqual(mismatched.trace, [], "Wrong provider package is rejected before gameplay starts");
  reject("actual-repository-world-cannot-borrow-planned-hash", { ...base, receipts: [mismatched.receipt] });
  const editedRoute = structuredClone(plan); editedRoute.manifest.routes[0].inputs = [];
  const edited = await runContentBatchRoute({ root, compiled, plan: editedRoute, routeId: route.id, repository, runtimeHash });
  assert.equal(edited.receipt.result, "failed"); assert.match(edited.receipt.boundary.reason, /manifest payload changed/);
  assert.deepEqual(edited.trace, []);
  reject("edited-route-cannot-borrow-manifest-identity", { ...base, receipts: [edited.receipt] });
  const missingBattle = structuredClone(packages);
  delete missingBattle.battle.encounters[1000];
  missingBattle.battle = sealBatchContent(missingBattle.battle);
  const unavailablePlan = planContentBatch(manifest, missingBattle);
  const unavailableRepository = new GameContentRepository(async url => url === "/game/battle.json"
    ? missingBattle.battle : files.get(url));
  const unavailable = await runContentBatchRoute({ root, compiled, plan: unavailablePlan,
    routeId: route.id, repository: unavailableRepository, runtimeHash });
  assert.equal(unavailable.receipt.result, "blocked");
  assert.equal(unavailable.receipt.boundary.kind, "battle-entry");
  assert.equal(unavailable.receipt.boundary.status, "failed");
  assert.match(unavailable.receipt.boundary.reason, /Battle content is unavailable/);
  assert.deepEqual(unavailable.receipt.completedEncounterIds, []);
  assert.equal(unavailable.execution.committedStarts, 0); assert.equal(unavailable.execution.committedReturns, 0);
  assert.equal(unavailable.receipt.saveRestored, false);
  assert.equal(unavailable.trace.some(step => step.kind === "victory"), false);
  tests.push({ name: "missing-encounter-stops-at-prepared-entry-without-reward-or-time-limit-success", passed: true });
  const missingMedia = structuredClone(packages);
  delete missingMedia.battle.common.sprites.synthetic;
  missingMedia.battle = sealBatchContent(missingMedia.battle);
  const missingMediaPlan = planContentBatch(manifest, missingMedia);
  const missingMediaRepository = new GameContentRepository(async url => url === "/game/battle.json"
    ? missingMedia.battle : files.get(url));
  const unprepared = await runContentBatchRoute({ root, compiled, plan: missingMediaPlan,
    routeId: route.id, repository: missingMediaRepository, runtimeHash });
  assert.equal(unprepared.receipt.result, "blocked"); assert.equal(unprepared.receipt.boundary.kind, "battle-entry");
  assert.match(unprepared.receipt.boundary.reason, /Missing battle media reference: synthetic/);
  assert.equal(unprepared.execution.committedStarts, 0); assert.equal(unprepared.execution.committedReturns, 0);
  assert.deepEqual(unprepared.receipt.completedEncounterIds, []); assert.equal(unprepared.receipt.saveRestored, false);
  assert.equal(unprepared.trace.some(step => step.kind === "victory"), false);
  tests.push({ name: "required-media-identity-cannot-bypass-prepared-entry-or-publish-rewards", passed: true });
  await assert.rejects(runContentBatchRoute({ root, compiled, plan, routeId: "absent", repository, runtimeHash }), /one identity/);
  tests.push({ name: "undeclared-route-id-rejected", passed: true });
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed during batch check");
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ result: report.result, tests: tests.length, report: output })); }
