// A continuous, authored Web event-save journey through production owners.
// Source AutoSave is intentionally not mapped to this persistence protocol.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const load = (path) => import(pathToFileURL(resolve(compiled, `${path}.js`)).href);
const [{ GameEventSaveCoordinator }, { GameFlow }, { GameSession }, { GameContentRepository }, { GameMapLoader },
  { CheckpointStorage }, { contentDigest }, { afterEventSave, eventSaveReadyHost: ready, gameEventSaveFixture }] =
  await Promise.all([
    load("src/core/game-event-save"), load("src/core/game-flow"), load("src/core/game-session"),
    load("src/core/game-content"), load("src/core/game-map-loader"), load("src/core/saved-game"), load("src/core/content-integrity"),
    load("tests/fixtures/game-event-save"),
  ]);
const reportPath = resolve(root, "build/reports/event-save-check.json");
const report = { kind: "controlled-event-save-journey-v1", result: "running", tests: [],
  evidence: {
    mode: "explicit-web-development-protocol",
    owners: ["GameFlow", "GameSession", "WorldSession", "FieldGame", "GameState", "BattleGame"],
    interfaces: ["GameEventSaveCoordinator", "CheckpointStorage", "GameContentRepository", "GameMapLoader"],
    controlled: ["authored event-save content", "in-memory storage", "delayed encoding and atomic quota failure", "headless host readiness"],
    sourceAutoSaveAdmitted: false, sourceStoryCoverage: false, browserVerified: false,
    originalGameExecuted: false, fullGameMigration: false,
  } };
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function seal(raw) {
  const { contentHash: _, ...payload } = structuredClone(raw);
  return { ...payload, contentHash: await contentDigest(payload) };
}

try {
  const fixture = gameEventSaveFixture();
  fixture.field.scripts.leave = [{ kind: "change-map", request: {
    mapId: 2, entrance: 1, continuation: null, birdview: false,
    skipFade: true, skipBgm: true, origin: "script",
  }, script: "leave", index: 0, source: { file: "synthetic", assetPath: "game-event-save" } }];
  const [field, battle, map] = await Promise.all([seal(fixture.field), seal(fixture.battle), seal(fixture.target)]);
  fixture.world.maps[2].contentHash = map.contentHash;
  const catalog = await seal(fixture.world);
  const files = new Map([["/game/content.json", field], ["/game/battle.json", battle],
    ["/world/catalog.json", catalog], [catalog.maps[2].url, map]]), reads = [];
  const contents = new GameContentRepository(async (url) => {
    reads.push(url); assert.ok(files.has(url), "Undeclared content dependency: " + url); return files.get(url);
  });
  const opening = await contents.opening(), session = new GameSession(opening.field, opening.battle, 314, controlledAudioRuntime());
  const originalOwners = { field: session.field, owned: session.state, world: session.world };
  session.field.eventState.write(afterEventSave, 0);
  session.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  const flow = new GameFlow(); flow.start(session); flow.advance(0, ready);
  const values = new Map(); let writes = 0, failWrite = false;
  const storage = new CheckpointStorage({ getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { if (failWrite) throw new Error("Controlled storage quota exceeded"); writes++; values.set(key, value); } }, "framework");
  const count = (owner) => owner.state.snapshot().items.find((item) => item.id === 10)?.count ?? 0;
  const stage = (name, owner = session, details = {}) => report.tests.push({ name, pass: true,
    itemCount: count(owner), pendingSave: owner.eventSaveRequest !== null, storageWrites: writes, ...details });
  const sameOwners = () => {
    assert.equal(session.field, originalOwners.field); assert.equal(session.state, originalOwners.owned);
    assert.equal(session.world, originalOwners.world);
  };

  await storage.save(session.checkpoint(), 100);
  const originalSlot = [...values];
  assert.equal(count(session), 0); assert.equal(session.checkpointReady, true);
  stage("verified-content-start-and-stable-prior-checkpoint");

  assert.equal(session.field.startEvent("saveFlow"), true);
  const request = session.eventSaveRequest; assert.ok(request);
  assert.equal(count(session), 2); assert.equal(session.field.eventState.read(afterEventSave), 0);
  assert.equal(flow.inputReady, false); assert.equal(session.checkpointReady, false);
  const beforeTime = session.field.time, beforeState = session.state.snapshot();
  session.advance(1000); flow.advance(1000, ready);
  assert.equal(session.field.time, beforeTime); assert.deepEqual(session.state.snapshot(), beforeState);
  stage("prior-grant-reaches-identity-stable-save-barrier", session, { requestId: request.id });

  const entered = deferred(), release = deferred(); let delayed = true, discards = 0;
  const coordinator = new GameEventSaveCoordinator(flow, { prepareSave: async (...args) => {
    const prepared = await storage.prepareSave(...args);
    if (delayed) { delayed = false; entered.resolve(); await release.promise; }
    return { ...prepared, discard() { discards++; prepared.discard(); } };
  } });
  const obsolete = coordinator.save(200); await entered.promise;
  assert.equal(flow.busy, true); flow.advance(1000, ready); sameOwners();
  assert.equal(session.field.time, beforeTime); assert.equal(count(session), 2);
  coordinator.cancel(); flow.returnToTitle();
  const laterTicket = flow.beginOperation("new-game");
  release.resolve(); assert.equal((await obsolete).status, "cancelled");
  assert.equal(laterTicket.isCurrent(), true); assert.equal(discards, 1);
  assert.deepEqual([...values], originalSlot); assert.equal(session.eventSaveRequest, request);
  laterTicket.cancel(); flow.start(session); flow.advance(0, ready);
  stage("cancelled-encoding-retains-request-and-cannot-write-or-finish-new-ticket");

  failWrite = true;
  const failure = await coordinator.save(300);
  assert.equal(failure.status, "failed"); assert.equal(failure.request, request);
  assert.equal(session.eventSaveRequest, request); assert.equal(flow.busy, false);
  assert.deepEqual([...values], originalSlot); assert.equal(count(session), 2); sameOwners();
  stage("atomic-storage-failure-preserves-prior-slot-and-retryable-barrier");

  failWrite = false;
  const committed = await coordinator.save(400);
  assert.equal(committed.status, "committed"); assert.equal(committed.request, request);
  assert.equal(session.eventSaveRequest, null); assert.equal(writes, 2); sameOwners();
  assert.equal(count(session), 2); assert.equal(session.field.eventState.read(afterEventSave), 0);
  const saved = await storage.load(); assert.ok(saved);
  assert.equal(saved.checkpoint.world.kind, "event-world-v1");
  assert.equal(saved.checkpoint.world.field.kind, "event-field-v1");
  assert.equal((await storage.load(true)).savedAt, 100);
  stage("retry-writes-continuation-once-and-acks-without-running-following-reward");

  await assert.rejects(coordinator.save(401), /pending event save request/);
  assert.equal(writes, 2); assert.equal(count(session), 2);
  flow.advance(10, ready); assert.equal(count(session), 5);
  assert.equal(session.field.eventState.read(afterEventSave), 1); assert.equal(session.checkpointReady, true);
  const continued = session.checkpoint();
  stage("duplicate-save-is-rejected-and-the-next-tick-runs-only-the-continuation");

  const loaded = await contents.restoreSessionContent(saved.checkpoint);
  const restored = GameSession.restore(saved.checkpoint, loaded.initial, loaded.battle, loaded.world, controlledAudioRuntime());
  const restoredFlow = new GameFlow(), publish = restoredFlow.beginOperation("load");
  assert.equal(publish.publish(restored), true);
  assert.equal(restored.eventSaveRequest, null); assert.equal(count(restored), 2);
  assert.equal(restored.field.eventState.read(afterEventSave), 0);
  restoredFlow.advance(10, ready);
  assert.equal(count(restored), 5); assert.equal(restored.eventSaveRequest, null);
  assert.deepEqual(restored.checkpoint(), continued); assert.equal(writes, 2);
  stage("repository-restore-resumes-after-save-without-repeating-save-or-prior-grant", restored);

  assert.equal(restoredFlow.move("down"), true); restoredFlow.advance(500, ready);
  assert.equal(restored.field.player.y, 2); assert.equal(restored.menuReady, true);
  assert.equal(restored.checkpointReady, true); assert.equal(count(restored), 5);
  assert.equal(restored.eventSaveRequest, null);
  stage("restored-continuation-returns-to-exploration-and-menu", restored);

  const tick = (ms = 10) => restoredFlow.advance(ms, ready);
  const stable = () => {
    for (let i = 0; i < 1000 && !restored.checkpointReady; i++) {
      assert.equal(restored.battle, null); assert.equal(restored.field.stop, null);
      if (restored.field.dialogue) restoredFlow.confirm();
      tick();
    }
    assert.equal(restored.checkpointReady, true);
  };
  const beforeBattle = restored.state.snapshot();
  assert.equal(restored.field.startEvent("fight"), true); tick();
  assert.equal(restoredFlow.phase, "battle");
  assert.equal(restored.menuReady, false); assert.equal(restored.eventSaveRequest, null);
  assert.throws(() => restored.checkpoint(), /Cannot save/);
  // Reuse the existing battle fixture and public command/target APIs. These are
  // player inputs only; no damage, enemy HP or reward implementation is copied.
  let commands = 0;
  for (let i = 0; i < 20000 && restoredFlow.phase === "battle"; i++) {
    for (const actor of restored.battle.ready) {
      const target = restored.battle.targets(actor.id, 10)[0];
      if (target && restored.battle.command(actor.id, 10, target.id)) commands++;
    }
    tick();
  }
  assert.equal(restoredFlow.phase, "victory"); assert.ok(commands > 0);
  assert.deepEqual(restored.state.snapshot(), beforeBattle);
  assert.equal(restored.battle.reward.gil, 14); assert.equal(restored.battle.reward.each, 9);
  stage("restored-event-progress-enters-and-wins-an-existing-data-driven-battle", restored, { commands });

  assert.equal(restoredFlow.continueVictory(), true);
  const rewarded = restored.state.snapshot();
  assert.equal(restoredFlow.continueVictory(), false);
  assert.deepEqual(restored.state.snapshot(), rewarded); stable();
  assert.equal(restored.gil, beforeBattle.gil + 14);
  assert.deepEqual(restored.completedEncounters, [1000]);
  for (const member of restored.state.snapshot().roster)
    assert.equal(member.exp, beforeBattle.roster.find((old) => old.id === member.id).exp + 9);
  assert.equal(restored.field.flags.ScenarioFlag1[1], true); assert.equal(count(restored), 5);
  stage("victory-publishes-one-reward-and-growth-and-returns-to-field", restored);

  const mapOwners = { field: restored.field, owned: restored.state, world: restored.world };
  const mapLoader = new GameMapLoader(restoredFlow, contents, {
    prepare: async (candidate) => ({ field: candidate }), discard() {},
  });
  assert.equal(restored.field.startEvent("leave"), true);
  const mapResult = await mapLoader.load();
  assert.equal(mapResult.status, "committed"); assert.equal(mapResult.session, restored);
  assert.equal(mapResult.presentation.field, restored.field);
  assert.notEqual(restored.field, mapOwners.field); assert.equal(restored.state, mapOwners.owned);
  assert.equal(restored.world, mapOwners.world); tick(0); stable();
  assert.equal(restored.field.content.map.identity.mapId, 2);
  assert.equal(restored.field.flags.ScenarioFlag1[8], true);
  assert.equal(restored.field.flags.ScenarioFlag1[1], true);
  assert.deepEqual(restored.state.snapshot(), rewarded); assert.equal(restored.world.transitions.length, 1);
  stage("common-map-loader-publishes-next-map-on-the-same-owned-and-world-owners", restored);

  const ticket = restoredFlow.beginOperation("save"), finalCheckpoint = restored.checkpoint();
  const stableSave = await storage.prepareSave(finalCheckpoint, 500);
  assert.equal(ticket.isCurrent(), true); stableSave.commit(); ticket.finish();
  const finalSave = await storage.load(), dependencies = await contents.restoreSessionContent(finalSave.checkpoint);
  const finalSession = GameSession.restore(finalSave.checkpoint, dependencies.initial, dependencies.battle, dependencies.world, controlledAudioRuntime());
  assert.deepEqual(finalSession.checkpoint(), finalCheckpoint);
  assert.equal(finalSession.eventSaveRequest, null); assert.equal(count(finalSession), 5);
  assert.equal(finalSession.field.content.map.identity.mapId, 2);
  assert.equal(finalSession.field.flags.ScenarioFlag1[8], true, "Restore cannot replay the destination flip initializer");
  assert.equal(finalSession.gil, beforeBattle.gil + 14); assert.deepEqual(finalSession.completedEncounters, [1000]);
  assert.equal(finalSession.continueVictory(), false); assert.deepEqual(finalSession.state.snapshot(), rewarded);
  assert.equal(writes, 3); assert.equal((await storage.load(true)).savedAt, 400);
  stage("ordinary-stable-save-remains-compatible-after-event-continuation", finalSession);

  report.contentReads = reads;
  report.runtimeSha256 = Object.fromEntries(await Promise.all([
    "game-event-save", "saved-game", "game-flow", "game-session", "field", "field-event-checkpoint", "world-session", "game-content", "game-map-loader", "battle",
  ].map(async (name) => [name, createHash("sha256").update(await readFile(resolve(compiled, `src/core/${name}.js`))).digest("hex")])));
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.tests.length, report: reportPath }));
}
