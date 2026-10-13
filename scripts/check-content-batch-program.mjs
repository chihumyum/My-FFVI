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
const [{ contentBatchProgramFixture }, { planContentBatch, ContentBatchManifest }, { assessContentBatchAdmission },
  { GameContentRepository }, { GameEntryLoader }, { GameCommands }, { GameBattleHandoff }, { contentDigest }] = await Promise.all([
  load("tests/fixtures/content-batch-program"), load("src/compiler/content-batch"), load("src/compiler/content-batch-admission"),
  load("src/core/game-content"), load("src/core/game-entry-loader"), load("src/core/game-commands"),
  load("src/core/game-battle-handoff"), load("src/core/content-integrity"),
]);
const output = resolve(root, "build/reports/content-batch-program-check.json"), tests = [];
const report = { kind: "controlled-content-batch-program-v1", result: "running", tests,
  evidence: { lane: "synthetic-controlled", sourceCampaignComplete: false, browserVerified: false,
    originalGameExecuted: false, fullGameMigration: false,
    initialState: "authored equipment, inventory grants, flags, meters and enemy definitions",
    execution: "walking triggers, public declared menu commands, prepared handoff and real checkpoint storage/restore",
    media: "explicit synthetic references; headless readiness, no decoding or audible acceptance" } };
await mkdir(resolve(root, "build/reports"), { recursive: true });

function repositoryFor(packages) {
  const { entry, battle, catalog, maps } = packages;
  const files = new Map([["/game/content.json", entry], ["/game/battle.json", battle], ["/framework/world/catalog.json", catalog],
    ...maps.map(map => [catalog.maps[map.mapId].url, map])]);
  return new GameContentRepository(async url => {
    assert.ok(files.has(url), "Unprovided program fixture content " + url);
    return files.get(url);
  }, "framework");
}

/** Observe actual shared methods; every call retains its implementation and
 * owner. Failure probes change the host's I/O outcome, never gameplay state. */
async function execute(fixture, runtimeHash, fault = null) {
  const plan = planContentBatch(fixture.manifest, fixture.packages), repository = repositoryFor(fixture.packages);
  const calls = { entries: [], menus: [], acceptedBattleCommands: 0, starts: 0, returns: 0, staleSettingsRejected: 0 }, owners = [];
  const originals = { begin: GameEntryLoader.prototype.begin, menu: GameCommands.prototype.menu,
    command: GameCommands.prototype.command, settings: GameCommands.prototype.setBattlePreferences,
    start: GameBattleHandoff.prototype.start, return: GameBattleHandoff.prototype.return };
  if (fault === "restore-error") repository.restoreSessionContent = async () => { throw new Error("Controlled restore media/content failure"); };
  let cancelled = false;
  try {
    GameEntryLoader.prototype.begin = function (kind) {
      calls.entries.push(kind);
      const attempt = originals.begin.call(this, kind), prepare = attempt.prepare;
      return { ...attempt, prepare: async factory => {
        const result = await prepare(async context => {
          const candidate = await factory(context);
          if (fault === "restore-cancel" && kind === "load" && !cancelled) { cancelled = true; attempt.cancel(); }
          return candidate;
        });
        if (result.status === "committed") owners.push(result.session);
        return result;
      } };
    };
    GameCommands.prototype.menu = function (command) {
      assert.equal(this.menuReady, true);
      const before = this.owner.checkpoint(), accepted = originals.menu.call(this, command), after = this.owner.checkpoint();
      calls.menus.push({ command: structuredClone(command), accepted, ownerIndex: owners.indexOf(this.owner), before, after });
      return accepted;
    };
    GameCommands.prototype.command = function (...parameters) {
      assert.equal(this.battleReady, true); assert.equal(this.ownsBattle(parameters[0]), true);
      const accepted = originals.command.apply(this, parameters);
      if (accepted) calls.acceptedBattleCommands++;
      return accepted;
    };
    GameCommands.prototype.setBattlePreferences = function (preferences) {
      const before = this.owner.checkpoint(), accepted = originals.settings.call(this, preferences);
      if (!accepted) { assert.deepEqual(this.owner.checkpoint(), before); calls.staleSettingsRejected++; }
      return accepted;
    };
    GameBattleHandoff.prototype.start = function () { calls.starts++; return originals.start.call(this); };
    GameBattleHandoff.prototype.return = function () { calls.returns++; return originals.return.call(this); };
    const run = await runContentBatchRoute({ root, compiled, plan, routeId: fixture.manifest.routes[0].id, repository, runtimeHash });
    return { plan, run, calls, owners };
  } finally {
    GameEntryLoader.prototype.begin = originals.begin; GameCommands.prototype.menu = originals.menu;
    GameCommands.prototype.command = originals.command; GameCommands.prototype.setBattlePreferences = originals.settings;
    GameBattleHandoff.prototype.start = originals.start; GameBattleHandoff.prototype.return = originals.return;
  }
}
function gate(value, runtimeHash) {
  return { manifestHash: value.plan.manifestHash, dependencyHash: value.plan.dependencyHash, runtimeHash,
    contentHashes: value.plan.contentHashes, profile: value.plan.manifest.profile,
    routes: batchRouteSpecs(value.plan.manifest), diagnostics: value.plan.diagnostics.map(({ code, reason }) => ({ code, reason })),
    framework: { status: "passed", runtimeHash }, receipts: [value.run.receipt] };
}
const stack = (owned, id) => owned.items.find(item => item.id === id)?.count ?? 0;
const member = (owned, id) => owned.roster.find(unit => unit.id === id);

try {
  const runtimeHash = await runtimeDigest(root, compiled), completed = await execute(contentBatchProgramFixture(), runtimeHash);
  const { plan, run, calls, owners } = completed, base = gate(completed, runtimeHash);
  report.plan = plan; report.run = run; report.calls = calls;
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run));
  assert.equal(assessContentBatchAdmission(base).status, "passed");
  assert.deepEqual(run.receipt.visitedMapIds, [1, 2]); assert.deepEqual(run.receipt.completedEncounterIds, [1000, 1001]);
  assert.deepEqual(run.receipt.program, { inputCount: 8, menuCount: 4, restoreCount: 2, postRestoreInputCount: 3 });
  tests.push({ name: "declared-program-completes-two-maps-two-battles-and-both-restores", passed: true });

  assert.deepEqual(calls.entries, ["new-game", "load", "load"]); assert.equal(owners.length, 3);
  assert.notEqual(owners[0], owners[1]); assert.notEqual(owners[1], owners[2]);
  assert.notEqual(owners[0].state, owners[1].state); assert.notEqual(owners[1].world, owners[2].world);
  assert.equal(run.execution.loadsCommitted, 2); assert.equal(calls.staleSettingsRejected, 2);
  assert.equal(run.execution.staleCommandChannelsRejected, 2);
  const restores = run.trace.filter(step => step.kind === "save-restore");
  assert.deepEqual(restores.map(step => [step.final, step.continued, step.paused]), [[false, true, false], [true, false, true]]);
  assert.ok(restores.every(step => step.ownerRebound && step.staleCommandsRejected));
  const midIndex = run.trace.indexOf(restores[0]), mapIndex = run.trace.findIndex(step => step.kind === "map"),
    secondBattleIndex = run.trace.findIndex(step => step.kind === "battle" && step.id === 1001);
  assert.ok(midIndex < mapIndex && mapIndex < secondBattleIndex);
  assert.equal(calls.menus.find(call => call.command.kind === "change-party").ownerIndex, 1);
  tests.push({ name: "mid-restore-rebinds-every-owner-and-continues-menu-map-and-second-battle", passed: true });

  assert.deepEqual(calls.menus.map(call => call.command.kind), ["use-item", "change-equipment", "set-preferences", "change-party"]);
  assert.ok(calls.menus.every(call => call.accepted));
  const potion = calls.menus[0];
  assert.ok(member(potion.before.owned, "a").hp < member(potion.before.owned, "a").maxHp, "Battle, not driver, injured the actor");
  assert.ok(member(potion.after.owned, "a").hp > member(potion.before.owned, "a").hp);
  assert.equal(stack(potion.before.owned, 10), 2); assert.equal(stack(potion.after.owned, 10), 1);
  const gear = calls.menus[1];
  assert.equal(member(gear.before.owned, "a").equipment[0], 101); assert.equal(member(gear.after.owned, "a").equipment[0], 1);
  assert.deepEqual(gear.after.owned.equipmentStock, gear.before.owned.equipmentStock, "Changing occupancy preserves owned equipment Count");
  const freeWeapon = owned => owned.equipmentStock.find(item => item.id === 101).count -
    owned.roster.flatMap(unit => unit.equipment).filter(id => id === 101).length;
  assert.equal(freeWeapon(gear.before.owned), 0); assert.equal(freeWeapon(gear.after.owned), 1);
  const preferences = calls.menus[2];
  assert.deepEqual(preferences.before.battlePreferences, { mode: "active", speedIndex: 2 });
  assert.deepEqual(preferences.after.battlePreferences, { mode: "wait", speedIndex: 3 });
  const party = calls.menus[3];
  assert.equal(party.before.owned.party.slots[0][0].row, "front"); assert.equal(party.after.owned.party.slots[0][0].row, "back");
  assert.ok(run.trace.filter(step => step.kind === "menu-command").every(step => step.ownerBound && step.pauseRestored));
  tests.push({ name: "four-declared-menu-kinds-publish-real-inventory-equipment-preferences-and-party-effects", passed: true });

  const initialOwner = owners[0].checkpoint(), middleOwner = owners[1].checkpoint(), finalOwner = owners[2].checkpoint();
  assert.equal(initialOwner.owned.gil, 97); assert.equal(finalOwner.owned.gil, 104);
  assert.deepEqual(initialOwner.owned.completedBattles.map(receipt => receipt.encounterId), [1000]);
  assert.deepEqual(finalOwner.owned.completedBattles.map(receipt => [receipt.serial, receipt.encounterId, receipt.outcome]),
    [[0, 1000, "victory"], [1, 1001, "victory"]]);
  assert.deepEqual(finalOwner, middleOwner, "Final restore must preserve its predecessor exactly");
  assert.equal(stack(initialOwner.owned, 10), 1); assert.equal(stack(finalOwner.owned, 10), 2, "Destination grant executes once");
  assert.deepEqual(initialOwner.owned.roster.map(unit => unit.exp), [4, 4]);
  assert.deepEqual(finalOwner.owned.roster.map(unit => unit.exp), [8, 8]);
  assert.equal(member(finalOwner.owned, "a").equipment[0], 1); assert.equal(finalOwner.owned.party.slots[0][0].row, "back");
  assert.deepEqual(finalOwner.battlePreferences, { mode: "wait", speedIndex: 3 });
  assert.equal(await contentDigest(finalOwner), run.checkpointHash);
  for (const index of [8, 9, 10]) assert.equal(owners[2].field.eventState.read({ category: "ScenarioFlag1", index }), 1);
  assert.equal(calls.starts, 2); assert.equal(calls.returns, 4);
  assert.equal(run.execution.committedStarts, 2); assert.equal(run.execution.committedReturns, 2);
  assert.equal(run.execution.duplicateReturnsRejected, 2); assert.equal(calls.acceptedBattleCommands, run.commands);
  tests.push({ name: "reward-consumption-equipment-and-initializer-are-not-replayed-by-either-restore", passed: true });

  const reject = (name, input, code) => {
    const result = assessContentBatchAdmission(input); assert.equal(result.status, "blocked");
    if (code) assert.ok(result.routes.flatMap(route => route.blockers).some(blocker => blocker.code === code), JSON.stringify(result));
    tests.push({ name, passed: true });
  };
  const noProgram = structuredClone(base); delete noProgram.receipts[0].program;
  reject("extended-evidence-cannot-omit-input-program", noProgram, "missing-route-program");
  const unfinished = structuredClone(base); unfinished.receipts[0].program.postRestoreInputCount = 0;
  reject("early-restore-cannot-certify-the-unexecuted-remainder", unfinished, "route-program-mismatch");
  const extraRestore = structuredClone(base); extraRestore.receipts[0].program.restoreCount++;
  reject("manufactured-restore-count-is-not-evidence", extraRestore, "route-program-mismatch");
  const noFinal = structuredClone(base); noFinal.receipts[0].saveRestored = false;
  reject("mid-restore-does-not-replace-mandatory-final-restore", noFinal);

  const rejectedFixture = contentBatchProgramFixture();
  rejectedFixture.manifest.routes[0].inputs[2].command.contentId = 101;
  const rejected = await execute(rejectedFixture, runtimeHash);
  assert.equal(rejected.run.receipt.result, "blocked"); assert.equal(rejected.run.receipt.boundary.kind, "rejected-player-input");
  assert.equal(rejected.run.receipt.boundary.inputIndex, 2);
  assert.deepEqual(rejected.run.receipt.program, { inputCount: 2, menuCount: 1, restoreCount: 0, postRestoreInputCount: 0 });
  assert.equal(rejected.run.receipt.saveRestored, false); assert.equal(rejected.owners.length, 1);
  assert.deepEqual(rejected.calls.menus[1].before, rejected.calls.menus[1].after);
  reject("valid-but-rejected-menu-input-stops-without-fake-completion", gate(rejected, runtimeHash));

  for (const fault of ["restore-error", "restore-cancel"]) {
    const failed = await execute(contentBatchProgramFixture(), runtimeHash, fault);
    assert.equal(failed.run.receipt.result, "blocked", JSON.stringify(failed.run));
    assert.equal(failed.run.receipt.boundary.kind, "save-restore");
    assert.equal(failed.run.receipt.boundary.status, fault === "restore-error" ? "failed" : "cancelled");
    assert.equal(failed.owners.length, 1); assert.equal(failed.run.execution.loadsCommitted, 0);
    assert.deepEqual(failed.run.receipt.completedEncounterIds, [1000]);
    assert.deepEqual(failed.run.receipt.program, { inputCount: 4, menuCount: 3, restoreCount: 0, postRestoreInputCount: 0 });
    const retained = failed.run.trace.find(step => step.kind === "save-restore-failed");
    assert.equal(retained.ownerRetained, true); assert.equal(retained.paused, false);
    assert.equal(await contentDigest(failed.owners[0].checkpoint()), retained.checkpointHash);
    assert.equal(stack(failed.owners[0].state.snapshot(), 10), 1);
    assert.deepEqual(failed.owners[0].state.snapshot().completedBattles.map(receipt => receipt.encounterId), [1000]);
    assert.equal(failed.run.receipt.saveRestored, false);
    reject(fault + "-retains-old-owner-and-does-not-run-later-inputs-or-rewards", gate(failed, runtimeHash));
  }
  const malformed = contentBatchProgramFixture().manifest;
  malformed.routes[0].inputs[1].command.extra = true;
  assert.throws(() => ContentBatchManifest.parse(malformed));
  tests.push({ name: "malformed-menu-program-is-rejected-before-an-owner-exists", passed: true });
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed during program check");
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: tests.length, report: output }));
}
