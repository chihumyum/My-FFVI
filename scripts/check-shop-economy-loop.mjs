// Continuous authored gameplay evidence through the same entry, shop, menu,
// battle and checkpoint owners as the app. No native/story acceptance claim.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { batchRouteSpecs } from "./content-batch-files.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
let compiled = "dist", reportFile = "build/reports/shop-economy-loop-check.json";
for (let i = 0; i < args.length; i++) {
  assert.ok(["--compiled-dir", "--report"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--"));
  if (args[i] === "--compiled-dir") compiled = args[++i]; else reportFile = args[++i];
}
const load = name => import(pathToFileURL(resolve(root, compiled, name + ".js")));
const [{ shopEconomyLoopFixture }, { planContentBatch }, { assessContentBatchAdmission }, { GameContentRepository },
  { GameEntryLoader }, { GameCommands }, { GameSession }, { GameFlow }, { contentDigest }] = await Promise.all([
  load("tests/fixtures/shop-economy-loop"), load("src/compiler/content-batch"), load("src/compiler/content-batch-admission"),
  load("src/core/game-content"), load("src/core/game-entry-loader"), load("src/core/game-commands"),
  load("src/core/game-session"), load("src/core/game-flow"), load("src/core/content-integrity"),
]);
const output = resolve(root, reportFile), tests = [], cases = [];
const report = { kind: "shop-economy-loop-check-v1", result: "running", tests, cases,
  evidence: { lane: "synthetic-controlled", sourceCampaignComplete: false, browserVerified: false,
    semanticsVerified: false, originalGameExecuted: false, fullGameMigration: false,
    initialState: "existing authored two-character/equipment baseline; no driver grants, HP or coordinate writes",
    execution: "ordinary shop NPC, declared field transactions, menus, prepared battle return and real checkpoint restore",
    media: "explicit synthetic references and headless readiness; no image decoding or audible acceptance" } };
const host = { visible: true, mediaReady: true, overlayOpen: false };
const item = (owned, id) => owned.items.find(row => row.id === id)?.count ?? 0;
const equipment = (owned, id) => owned.equipmentStock.find(row => row.id === id)?.count ?? 0;
const member = (owned, id) => owned.roster.find(row => row.id === id);
await mkdir(resolve(output, ".."), { recursive: true });

function repositoryFor(packages) {
  const { entry, battle, catalog, maps } = packages;
  const files = new Map([["/game/content.json", entry], ["/game/battle.json", battle], ["/framework/world/catalog.json", catalog],
    ...maps.map(map => [catalog.maps[map.mapId].url, map])]);
  return new GameContentRepository(async url => {
    assert.ok(files.has(url), "Unprovided authored economy content " + url);
    return files.get(url);
  }, "framework");
}

/** Observe real public operations without replacing their implementation. */
async function execute(fixture, runtimeHash, restoreFailure = false) {
  const plan = planContentBatch(fixture.manifest, fixture.packages), repository = repositoryFor(fixture.packages);
  const owners = [], initial = [], calls = { trades: [], leaves: [], menus: [] };
  const originals = { begin: GameEntryLoader.prototype.begin, trade: GameCommands.prototype.tradeShop,
    leave: GameCommands.prototype.closeShop, menu: GameCommands.prototype.menu };
  if (restoreFailure) repository.restoreSessionContent = async () => { throw new Error("Controlled economy restore failure"); };
  try {
    GameEntryLoader.prototype.begin = function (kind) {
      const attempt = originals.begin.call(this, kind), prepare = attempt.prepare;
      return { ...attempt, prepare: async factory => {
        const result = await prepare(factory);
        if (result.status === "committed") {
          owners.push(result.session); initial.push(result.session.checkpoint());
        }
        return result;
      } };
    };
    GameCommands.prototype.tradeShop = function (request) {
      const field = this.owner.field, shop = field.currentShop, before = this.owner.state.snapshot();
      assert.equal(this.shopReady, true); assert.ok(shop);
      let result;
      try { result = originals.trade.call(this, request); }
      catch (error) { assert.deepEqual(this.owner.state.snapshot(), before); throw error; }
      const after = this.owner.state.snapshot();
      assert.equal(this.owner.field, field); assert.deepEqual(field.currentShop, shop);
      calls.trades.push({ request: structuredClone(request), shop, before, after, result, ownerIndex: owners.indexOf(this.owner) });
      return result;
    };
    GameCommands.prototype.closeShop = function () {
      const field = this.owner.field, shop = field.currentShop, before = this.owner.state.snapshot();
      const result = originals.leave.call(this);
      assert.deepEqual(this.owner.state.snapshot(), before, "Leaving a shop cannot award or consume resources");
      calls.leaves.push({ shop, result, farewell: field.dialogue?.key ?? null, checkpointReady: this.owner.checkpointReady });
      return result;
    };
    GameCommands.prototype.menu = function (command) {
      const before = this.owner.checkpoint(), result = originals.menu.call(this, command), after = this.owner.checkpoint();
      calls.menus.push({ command: structuredClone(command), result, before, after, ownerIndex: owners.indexOf(this.owner) });
      return result;
    };
    const run = await runContentBatchRoute({ root, compiled, plan, routeId: fixture.manifest.routes[0].id, repository, runtimeHash });
    return { plan, run, calls, owners, initial };
  } finally {
    GameEntryLoader.prototype.begin = originals.begin; GameCommands.prototype.tradeShop = originals.trade;
    GameCommands.prototype.closeShop = originals.leave; GameCommands.prototype.menu = originals.menu;
  }
}
function admission(value, runtimeHash) {
  return { manifestHash: value.plan.manifestHash, dependencyHash: value.plan.dependencyHash, runtimeHash,
    contentHashes: value.plan.contentHashes, profile: value.plan.manifest.profile,
    routes: batchRouteSpecs(value.plan.manifest), diagnostics: value.plan.diagnostics.map(({ code, reason }) => ({ code, reason })),
    framework: { status: "passed", runtimeHash }, receipts: [value.run.receipt] };
}
function passed(name) { tests.push({ name, passed: true }); }

try {
  const runtimeHash = await runtimeDigest(root, compiled), complete = await execute(shopEconomyLoopFixture(), runtimeHash);
  const { plan, run, calls, owners, initial } = complete;
  report.plan = plan; report.run = run; report.calls = calls; report.runtimeHash = runtimeHash;
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt));
  assert.equal(assessContentBatchAdmission(admission(complete, runtimeHash)).status, "passed");
  assert.deepEqual(run.receipt.program, { inputCount: 15, menuCount: 3, restoreCount: 2, postRestoreInputCount: 3 });
  assert.deepEqual(run.receipt.visitedMapIds, [1, 2]); assert.deepEqual(run.receipt.completedEncounterIds, [1000, 1001]);
  assert.equal(owners.length, 3); assert.equal(initial[0].owned.gil, 90); assert.equal(item(initial[0].owned, 10), 0);
  assert.equal(equipment(initial[0].owned, 202), 0);
  passed("shared-entry-shop-menus-two-battles-and-two-restores-complete");

  assert.deepEqual(calls.trades.map(call => [call.request.kind, call.result.contentId, call.result.count]),
    [["buy", 10, 3], ["sell", 10, 1], ["buy", 202, 1]]);
  assert.deepEqual(calls.trades.map(call => call.after.gil), [60, 65, 45]);
  assert.deepEqual(calls.trades.map(call => item(call.after, 10)), [3, 2, 2]);
  assert.equal(equipment(calls.trades[2].after, 202), 1);
  assert.ok(calls.trades.every(call => call.shop.groupId === 7 && call.result.groupId === 7 && call.ownerIndex === 0));
  assert.equal(new Set(calls.trades.map(call => call.shop.id)).size, 1);
  assert.equal(calls.leaves.length, 1); assert.equal(calls.leaves[0].result, true);
  assert.equal(calls.leaves[0].farewell, "ECONOMY_CLOSE"); assert.equal(calls.leaves[0].checkpointReady, false);
  assert.ok(run.trace.filter(step => step.kind === "shop-command").every(step => step.ownerBound && step.accepted));
  passed("declared-buy-sell-and-leave-retain-one-live-request-and-ordinary-prices");

  const gear = calls.menus[0], potion = calls.menus[1], preferences = calls.menus[2];
  assert.equal(gear.command.kind, "change-equipment"); assert.equal(member(gear.before.owned, "a").equipment[1], 201);
  assert.equal(member(gear.after.owned, "a").equipment[1], 202);
  assert.deepEqual(gear.after.owned.equipmentStock, gear.before.owned.equipmentStock);
  assert.equal(potion.command.kind, "use-item"); assert.equal(item(potion.before.owned, 10), 2);
  assert.equal(item(potion.after.owned, 10), 1); assert.ok(member(potion.after.owned, "a").hp > member(potion.before.owned, "a").hp);
  assert.equal(member(potion.before.owned, "a").equipment[1], 202);
  assert.equal(preferences.ownerIndex, 1); assert.deepEqual(preferences.after.battlePreferences, { mode: "wait", speedIndex: 3 });
  assert.ok(calls.menus.every(call => call.result === true));
  const final = owners[2].checkpoint(), predecessor = owners[1].checkpoint();
  assert.equal(final.owned.gil, 59); assert.equal(item(final.owned, 10), 1); assert.equal(equipment(final.owned, 202), 1);
  assert.equal(member(final.owned, "a").equipment[1], 202);
  assert.deepEqual(final.owned.roster.map(unit => unit.exp), [8, 8]);
  assert.deepEqual(final.owned.completedBattles.map(value => [value.serial, value.encounterId, value.outcome]),
    [[0, 1000, "victory"], [1, 1001, "victory"]]);
  assert.deepEqual(final, predecessor); assert.equal(await contentDigest(final), run.checkpointHash);
  assert.equal(run.execution.committedReturns, 2); assert.equal(run.execution.duplicateReturnsRejected, 2);
  assert.equal(run.execution.staleCommandChannelsRejected, 2);
  passed("purchased-stock-equipment-consumption-rewards-and-growth-survive-restores-once");

  const firstBattle = run.trace.findIndex(step => step.kind === "battle"), leave = run.trace.findIndex(step =>
    step.kind === "shop-command" && step.input.kind === "leave-shop");
  const relay = run.trace.findIndex(step => step.kind === "save-restore" && !step.final), secondBattle = run.trace.findIndex(step =>
    step.kind === "battle" && step.id === 1001);
  assert.ok(leave < firstBattle && firstBattle < relay && relay < secondBattle);
  assert.equal(run.trace.filter(step => step.kind === "save-restore").length, 2);
  assert.notEqual(owners[0].state, owners[1].state); assert.notEqual(owners[1], owners[2]);
  passed("farewell-completes-before-gameplay-and-mid-restore-continues-to-next-battle");

  for (const [name, inputs, boundary, reason] of [
    ["undeclared-shop", [{ kind: "confirm" }], "shop-input-not-declared", undefined],
    ["ordinary-menu-does-not-close-shop", [{ kind: "confirm" }, { kind: "menu", command: {
      kind: "set-preferences", preferences: { mode: "wait", speedIndex: 3 } } }], "shop-input-not-declared", undefined],
    ["wrong-group-trade", [{ kind: "confirm" }, { kind: "shop", groupId: 8,
      request: { kind: "buy", productId: 1001, count: 1 } }], "rejected-shop-input", "shop-group-mismatch"],
    ["wrong-group-leave", [{ kind: "confirm" }, { kind: "leave-shop", groupId: 8 }], "rejected-shop-input", "shop-group-mismatch"],
    ["wrong-phase-trade", [{ kind: "shop", groupId: 7,
      request: { kind: "buy", productId: 1001, count: 1 } }], "rejected-shop-input", "no-open-shop"],
    ["wrong-phase-leave", [{ kind: "leave-shop", groupId: 7 }], "rejected-shop-input", "no-open-shop"],
  ]) {
    const fixture = shopEconomyLoopFixture(); fixture.manifest.routes[0].inputs = inputs;
    const value = await execute(fixture, runtimeHash);
    assert.equal(value.run.receipt.result, "blocked"); assert.equal(value.run.receipt.boundary.kind, boundary);
    if (reason) assert.equal(value.run.receipt.boundary.reason, reason);
    assert.equal(value.calls.trades.length, 0); assert.equal(value.calls.leaves.length, 0);
    assert.deepEqual(value.owners[0].state.snapshot(), value.initial[0].owned);
    assert.equal(assessContentBatchAdmission(admission(value, runtimeHash)).status, "blocked");
    cases.push({ name, receipt: value.run.receipt });
  }
  passed("undeclared-wrong-group-and-wrong-phase-inputs-block-without-resource-writes");

  for (const [name, request] of [["unaffordable-buy", { kind: "buy", productId: 1001, count: 99 }],
    ["sell-equipped-copy", { kind: "sell", contentId: 101, count: 1 }]]) {
    const fixture = shopEconomyLoopFixture(); fixture.manifest.routes[0].inputs = [{ kind: "confirm" },
      { kind: "shop", groupId: 7, request }];
    const value = await execute(fixture, runtimeHash);
    assert.equal(value.run.receipt.result, "failed"); assert.equal(value.run.receipt.boundary.kind, "exception");
    assert.deepEqual(value.owners[0].state.snapshot(), value.initial[0].owned);
    assert.equal(assessContentBatchAdmission(admission(value, runtimeHash)).status, "blocked");
    cases.push({ name, receipt: value.run.receipt });
  }
  passed("unavailable-quantity-and-equipped-stock-reject-entire-transactions");

  const failed = await execute(shopEconomyLoopFixture(), runtimeHash, true);
  assert.equal(failed.run.receipt.result, "blocked"); assert.equal(failed.run.receipt.boundary.kind, "save-restore");
  assert.equal(failed.owners.length, 1); assert.equal(failed.run.execution.loadsCommitted, 0);
  assert.equal(failed.owners[0].state.snapshot().gil, 52); assert.equal(item(failed.owners[0].state.snapshot(), 10), 1);
  assert.deepEqual(failed.owners[0].state.snapshot().completedBattles.map(value => value.encounterId), [1000]);
  assert.equal(member(failed.owners[0].state.snapshot(), "a").equipment[1], 202);
  assert.equal(assessContentBatchAdmission(admission(failed, runtimeHash)).status, "blocked");
  cases.push({ name: "restore-failure-retains-economy-progress", receipt: failed.run.receipt });
  passed("failed-restore-retains-published-trades-equipment-consumption-and-single-reward");

  // A genuine owner replacement while an old shop is open. Both sessions use
  // the same group IDs; the old gateway must still reject rather than redirect.
  const fixture = shopEconomyLoopFixture(), repository = repositoryFor(fixture.packages), flow = new GameFlow();
  const entries = new GameEntryLoader(flow, { discard: () => {} });
  const started = await entries.begin("new-game").prepare(async () => {
    const { field, battle } = await repository.opening();
    return { session: new GameSession(field, battle, 314), presentation: null };
  });
  assert.equal(started.status, "committed"); flow.advance(0, host);
  const oldOwner = flow.session, oldCommands = new GameCommands(flow, oldOwner), saved = oldOwner.checkpoint();
  const openShop = () => {
    assert.equal(flow.confirm(), true);
    for (let i = 0; !flow.session.field.currentShop; i++) {
      assert.ok(i < 100, "Ordinary shop greeting did not complete");
      if (flow.session.field.dialogue) assert.equal(flow.confirm(), true);
      flow.advance(10, host);
    }
  };
  openShop(); const oldShop = oldOwner.field.currentShop, oldState = oldOwner.state.snapshot();
  const pending = entries.begin("load");
  assert.equal(oldCommands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
  assert.equal(oldCommands.closeShop(), false); assert.deepEqual(oldOwner.state.snapshot(), oldState);
  assert.deepEqual(oldOwner.field.currentShop, oldShop); pending.cancel(); flow.observeHost(host);
  assert.equal(oldCommands.shopReady, true);
  flow.observeHost({ ...host, visible: false });
  assert.equal(oldCommands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
  assert.equal(oldCommands.closeShop(), false); flow.observeHost(host);
  const loaded = await entries.begin("load").prepare(async () => {
    const packages = await repository.restoreSessionContent(saved);
    return { session: GameSession.restore(saved, packages.initial, packages.battle, packages.world), presentation: null };
  });
  assert.equal(loaded.status, "committed"); flow.advance(0, host); openShop();
  const newOwner = flow.session, newCommands = new GameCommands(flow, newOwner), before = newOwner.state.snapshot(), shop = newOwner.field.currentShop;
  assert.notEqual(newOwner, oldOwner); assert.equal(shop.groupId, oldShop.groupId); assert.equal(newCommands.shopReady, true);
  assert.equal(oldCommands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
  assert.equal(oldCommands.closeShop(), false); assert.deepEqual(newOwner.state.snapshot(), before);
  assert.deepEqual(newOwner.field.currentShop, shop); assert.deepEqual(oldOwner.state.snapshot(), oldState);
  assert.equal(newCommands.tradeShop({ kind: "buy", productId: 1001, count: 1 }).countAfter, 1);
  assert.equal(newCommands.closeShop(), true); assert.equal(newCommands.closeShop(), false);
  const farewellState = newOwner.state.snapshot();
  assert.equal(newCommands.tradeShop({ kind: "buy", productId: 1001, count: 1 }), null);
  assert.deepEqual(newOwner.state.snapshot(), farewellState);
  passed("inflight-background-old-owner-and-farewell-gate-shop-writes-and-repeated-close");

  const base = admission(complete, runtimeHash);
  const missing = structuredClone(base); delete missing.receipts[0].program;
  assert.ok(assessContentBatchAdmission(missing).blockers.some(value => value.code === "missing-route-program"));
  const partial = structuredClone(base); partial.receipts[0].program.inputCount -= calls.trades.length + calls.leaves.length;
  assert.ok(assessContentBatchAdmission(partial).blockers.some(value => value.code === "route-program-mismatch"));
  assert.equal(await runtimeDigest(root, compiled), runtimeHash);
  passed("declared-shop-inputs-bind-route-evidence-and-cannot-be-replaced-by-final-save");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: tests.length, report: output, ...(report.error ? { error: report.error } : {}) }));
}
