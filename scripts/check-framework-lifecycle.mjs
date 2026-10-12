// Redistributable two-map journey through real shared owners. The authored
// fixture is not source-map coverage, and no gameplay owner or reward is mocked.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--compiled-dir", "--report"].includes(args[i]) && args[i + 1] && !options.has(args[i]),
    "Use --compiled-dir <directory> --report <path>");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist");
const reportPath = resolve(root, options.get("--report") ?? "build/reports/framework-lifecycle-check.json");
const loadModule = (path) => import(pathToFileURL(resolve(compiled, path + ".js")).href);
const report = {
  kind: "controlled-framework-lifecycle-check-v1", result: "running", stages: [],
  evidence: {
    lane: "synthetic-controlled-mechanism",
    owners: ["GameFlow", "GameSession", "WorldSession", "GameState", "BattleGame"],
    boundaries: ["GameContentRepository", "GameMapLoader", "CheckpointStorage"],
    fixtures: ["tests/fixtures/game-flow.ts", "tests/fixtures/checkpoint-game.ts"],
    externalHosts: ["in-memory signed JSON transport", "controlled asynchronous media preparation",
      "in-memory storage", "explicit headless visibility/audio readiness"],
    sourceMapCoverage: false, browserVerified: false, originalGameExecuted: false, fullGameMigration: false,
  },
};
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

try {
  const [{ GameSession }, { GameFlow }, { GameContentRepository, fieldMediaUrls },
    { GameMapLoader }, { CheckpointStorage }, { contentDigest, verifyContent }, { gameFlowFixture, readyHost }] =
    await Promise.all([
      loadModule("src/core/game-session"), loadModule("src/core/game-flow"), loadModule("src/core/game-content"),
      loadModule("src/core/game-map-loader"), loadModule("src/core/saved-game"),
      loadModule("src/core/content-integrity"), loadModule("tests/fixtures/game-flow"),
    ]);
  const f = gameFlowFixture(), source = { file: "synthetic", assetPath: "framework-lifecycle" };
  const script = (name, commands) => commands.map((command, index) => ({ ...command, script: name, index, source }));
  const seal = async (raw) => {
    const { contentHash: _, ...payload } = JSON.parse(JSON.stringify(raw));
    return verifyContent({ ...payload, contentHash: await contentDigest(payload) });
  };
  const fieldDraft = structuredClone(f.field);
  fieldDraft.entry.initialEventValues = [{ ref: { category: "ScenarioFlag1", index: 8 }, value: 0 }];
  // Candidate B initialization changes owned and event state together. Failed
  // media cannot publish either, and restore cannot execute this grant again.
  const mapBDraft = structuredClone(f.target);
  const entry = mapBDraft.map.entities.find((entity) => entity.kind === 0);
  assert.ok(entry);
  mapBDraft.map.entities = [entry];
  mapBDraft.map.groups = { entity_default: { ...mapBDraft.map.groups.entity_default, entities: [entry] } };
  mapBDraft.scripts.init = script("init", [
    { kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] },
    { kind: "flag", ref: { category: "ScenarioFlag1", index: 8 }, operation: "flip" },
    { kind: "exit" },
  ]);
  mapBDraft.scripts.returnA = script("returnA", [{ kind: "change-map", request: {
    mapId: 1, entrance: 1, continuation: null, birdview: false,
    skipFade: false, skipBgm: false, origin: "script",
  } }]);
  const mapADraft = structuredClone(mapBDraft);
  mapADraft.mapId = 1; mapADraft.name = "A"; mapADraft.map.id = "A";
  mapADraft.map.identity = { mapId: 1, areaId: mapADraft.areaId };
  mapADraft.scripts = { ...structuredClone(fieldDraft.scripts), enterA: script("enterA", [
    { kind: "flag", ref: { category: "ScenarioFlag1", index: 9 }, operation: "set" },
    { kind: "exit" },
  ]) };
  mapADraft.initializer = "enterA";
  const [field, battle, mapA, mapB] = await Promise.all([
    seal(fieldDraft), seal(f.battle), seal(mapADraft), seal(mapBDraft),
  ]);
  const worldDraft = structuredClone(f.world);
  worldDraft.maps = Object.fromEntries([mapA, mapB].map((map) => [String(map.mapId), {
    ...f.world.maps[2], url: "/world/maps/" + map.mapId + ".json", contentHash: map.contentHash,
    name: map.name, areaId: map.areaId,
  }]));
  const catalog = await seal(worldDraft), files = new Map([
    ["/game/content.json", field], ["/game/battle.json", battle], ["/world/catalog.json", catalog],
    ["/world/maps/1.json", mapA], ["/world/maps/2.json", mapB],
  ]), reads = [];
  const contents = new GameContentRepository(async (url) => {
    reads.push(url); assert.ok(files.has(url), "Missing controlled content " + url); return files.get(url);
  });
  const opening = await contents.opening();
  const initial = new GameSession(opening.field, opening.battle, 314, controlledAudioRuntime());
  const flow = new GameFlow(initial), originalState = initial.state, originalWorld = initial.world;
  const current = () => flow.session;
  const owned = () => current().state.snapshot();
  const count = () => owned().items.find((item) => item.id === 10)?.count ?? 0;
  const tick = (ms = 10) => flow.advance(ms, readyHost);
  const stage = (name, details = {}) => report.stages.push({ name, mapId: current().field.content.map.identity.mapId,
    phase: flow.phase, gil: current().gil, itemCount: count(), completedEncounters: [...current().completedEncounters], ...details });
  const stable = () => {
    for (let i = 0; i < 1000; i++) {
      assert.equal(current().battle, null); assert.equal(current().field.stop, null);
      if (current().checkpointReady) return;
      if (current().field.dialogue) assert.equal(flow.confirm(), true);
      tick();
    }
    assert.fail("Controlled continuation did not reach stable exploration");
  };
  assert.equal(flow.phase, "title");
  const title = initial.checkpoint(); tick(1000); assert.deepEqual(initial.checkpoint(), title);
  flow.start(); tick(0); assert.equal(flow.phase, "exploration");
  stage("repository-opening-and-title-start");

  let failMedia = false, releaseFailure, preparationStarted;
  let resourceId = 0;
  const resources = new Set(), discarded = [], preparations = [];
  const media = {
    async prepare(candidate) {
      preparations.push({ mapId: candidate.content.map.identity.mapId, hash: candidate.content.contentHash });
      const urls = fieldMediaUrls(candidate.content); assert.ok(urls.length > 0);
      if (failMedia) {
        failMedia = false;
        assert.equal(candidate.flags.ScenarioFlag1[8], true, "Destination effects already exist in the private candidate");
        preparationStarted();
        await new Promise((resolve) => { releaseFailure = resolve; });
        throw new Error("Controlled map media preparation failed");
      }
      const value = Object.freeze({ id: ++resourceId, urls, fieldHash: candidate.content.contentHash });
      resources.add(value); return value;
    },
    discard(value) {
      assert.equal(resources.delete(value), true, "A presentation is disposed once");
      discarded.push(value.id);
    },
  };
  let presentation = await media.prepare(initial.field);
  const acceptPresentation = (next) => { media.discard(presentation); presentation = next; };
  const loader = new GameMapLoader(flow, contents, media);
  const fromA = initial.field, beforeOwned = owned();
  assert.equal(fromA.startEvent("leave"), true);
  const request = fromA.stop; assert.equal(request.kind, "map-transition");
  const beforeEvents = fromA.eventState.snapshot(), beforeTime = fromA.time;
  failMedia = true;
  const reachedPreparation = new Promise((resolve) => { preparationStarted = resolve; });
  const failedAttempt = loader.load();
  await Promise.race([reachedPreparation, failedAttempt.then(() => assert.fail("Load ended before media preparation"))]);
  assert.equal(flow.busy, true); assert.equal(flow.phase, "transition");
  assert.equal(flow.move("right"), false); tick(60000);
  assert.equal(fromA.time, beforeTime); assert.deepEqual(owned(), beforeOwned);
  assert.deepEqual(fromA.eventState.snapshot(), beforeEvents);
  releaseFailure();
  const failed = await failedAttempt;
  assert.equal(failed.status, "failed"); assert.match(String(failed.error), /Controlled map media/);
  assert.equal(current(), initial); assert.equal(initial.field, fromA); assert.equal(initial.field.stop, request);
  assert.equal(initial.state, originalState); assert.equal(initial.world, originalWorld);
  assert.deepEqual(owned(), beforeOwned); assert.deepEqual(fromA.eventState.snapshot(), beforeEvents);
  assert.equal(flow.busy, false); assert.equal(count(), 0);
  assert.equal(initial.world.transitions.length, 0); assert.equal(resources.size, 1);
  stage("A-to-B-media-failure-retains-request-and-all-owners", { error: String(failed.error) });

  const enteredB = await loader.load();
  assert.equal(enteredB.status, "committed"); assert.equal(enteredB.session, initial);
  assert.equal(current(), initial); assert.equal(current().state, originalState); assert.equal(current().world, originalWorld);
  assert.notEqual(initial.field, fromA); assert.equal(initial.field, enteredB.field);
  acceptPresentation(enteredB.presentation); tick(0); stable();
  assert.equal(initial.field.content.map.identity.mapId, 2);
  assert.equal(count(), 2); assert.equal(initial.field.flags.ScenarioFlag1[8], true);
  assert.equal(initial.world.transitions.length, 1); assert.equal(resources.size, 1);
  assert.deepEqual(preparations.map((p) => p.mapId), [1, 2, 2]);
  assert.equal(reads.filter((url) => url === "/world/maps/2.json").length, 1, "Media retry reuses validated content");
  stage("same-request-retry-publishes-B-initialization-once");

  const beforeBattle = owned();
  assert.equal(initial.field.startEvent("fight"), true); tick();
  assert.equal(flow.phase, "battle"); assert.equal(initial.state.inBattle, true);
  assert.equal(initial.menuReady, false); assert.throws(() => initial.checkpoint(), /Cannot save/);
  // Real enemy AI supplies the later menu target. No HP or reward overwrites.
  for (let n = 0; n < 2000 && initial.battle.players.every((p) => p.hp === p.maxHp); n++) tick();
  assert.equal(flow.phase, "battle");
  assert.ok(initial.battle.players.some((p) => p.hp > 0 && p.hp < p.maxHp));
  let commands = 0;
  for (let n = 0; n < 20000 && flow.phase === "battle"; n++) {
    for (const actor of initial.battle.ready) {
      const target = initial.battle.targets(actor.id, 10)[0];
      if (target && initial.battle.command(actor.id, 10, target.id)) commands++;
    }
    tick();
  }
  assert.equal(flow.phase, "victory"); assert.ok(commands > 0);
  assert.deepEqual(owned(), beforeBattle, "Unconfirmed victory leaves the shared owner unchanged");
  const reward = structuredClone(initial.battle.reward);
  assert.equal(reward.gil, 14); assert.equal(reward.each, 9);
  stage("B-battle-enemy-damage-and-command-victory", { commands, reward: { gil: reward.gil, each: reward.each } });
  assert.equal(flow.continueVictory(), true); const afterReward = owned();
  assert.equal(flow.continueVictory(), false); assert.deepEqual(owned(), afterReward); stable();
  assert.equal(current(), initial); assert.equal(current().state, originalState); assert.equal(current().world, originalWorld);
  assert.equal(current().gil, beforeBattle.gil + 14); assert.deepEqual(current().completedEncounters, [1000]);
  assert.equal(current().field.flags.ScenarioFlag1[1], true); assert.equal(count(), 2);
  for (const member of owned().roster)
    assert.equal(member.exp, beforeBattle.roster.find((p) => p.id === member.id).exp + 9);
  stage("victory-returns-to-B-with-one-reward-and-experience-update");

  assert.equal(initial.menuReady, true);
  const injured = owned().roster.find((p) => p.hp > 0 && p.hp < p.maxHp);
  assert.ok(injured); assert.ok(initial.state.menuItemTargets(10).includes(injured.id));
  assert.equal(initial.useMenuItem(10, injured.id), true); assert.equal(count(), 1);
  assert.equal(owned().roster.find((p) => p.id === injured.id).hp, Math.min(injured.maxHp, injured.hp + 50));
  initial.setBattlePreferences({ mode: "wait", speedIndex: 3 });
  stage("B-menu-consumes-one-item-and-updates-persistent-preference", { target: injured.id });

  const bytes = new Map(); let failWrite = false;
  const storage = new CheckpointStorage({ getItem: (key) => bytes.get(key) ?? null,
    setItem: (key, value) => { if (failWrite) throw new Error("Controlled save write failed"); bytes.set(key, value); } }, "framework");
  const checkpoint = initial.checkpoint();
  const cancelledSave = flow.beginOperation("save"), discardedSave = await storage.prepareSave(checkpoint, 1);
  assert.equal(bytes.size, 0); discardedSave.discard(); cancelledSave.cancel();
  assert.throws(() => discardedSave.commit(), /consumed|discarded/); assert.equal(bytes.size, 0);
  const save = flow.beginOperation("save"), preparedSave = await storage.prepareSave(checkpoint, 2);
  tick(60000); assert.deepEqual(initial.checkpoint(), checkpoint); assert.equal(save.isCurrent(), true);
  assert.equal(bytes.size, 0); preparedSave.commit(); assert.equal(save.finish(), true);
  assert.throws(() => preparedSave.commit(), /consumed|discarded/);
  const savedBytes = [...bytes], failedSave = flow.beginOperation("save");
  const failedSaveCandidate = await storage.prepareSave(checkpoint, 3); failWrite = true;
  assert.throws(() => failedSaveCandidate.commit(), /Controlled save write/);
  failWrite = false; failedSave.cancel(); failedSaveCandidate.discard();
  assert.deepEqual([...bytes], savedBytes); assert.deepEqual(initial.checkpoint(), checkpoint);
  stage("prepared-save-discard-publication-and-write-failure-preserve-progress");

  assert.equal(flow.move("down"), true); tick(240);
  assert.notDeepEqual(initial.checkpoint(), checkpoint);
  const load = flow.beginOperation("load"), saved = await storage.load(); assert.ok(saved);
  assert.deepEqual(saved.checkpoint, checkpoint);
  const dependencies = await contents.restoreWorld(saved.checkpoint);
  assert.equal(dependencies.map.mapId, 2);
  const restored = GameSession.restore(saved.checkpoint, opening.field, opening.battle, dependencies, controlledAudioRuntime());
  assert.deepEqual(restored.checkpoint(), checkpoint);
  const restoredPresentation = await media.prepare(restored.field);
  assert.equal(current(), initial, "Preparing restore must not replace the live owner");
  assert.equal(load.publish(restored), true); acceptPresentation(restoredPresentation);
  assert.equal(load.publish(initial), false); assert.notEqual(current(), initial);
  assert.equal(flow.move("right"), false); tick(0);
  assert.equal(count(), 1); assert.deepEqual(current().checkpoint(), checkpoint);
  assert.equal(flow.continueVictory(), false); assert.equal(current().gil, beforeBattle.gil + 14);
  assert.equal(current().field.flags.ScenarioFlag1[8], true, "Restore did not rerun B's flip/grant initializer");
  assert.deepEqual(current().battlePreferences, { mode: "wait", speedIndex: 3 });
  stage("repository-bound-restore-keeps-B-progress-without-initialization-or-reward-replay");

  const restoredState = restored.state, restoredWorld = restored.world, finalOwned = owned();
  assert.equal(restored.field.startEvent("returnA"), true);
  const enteredA = await loader.load(); assert.equal(enteredA.status, "committed");
  assert.equal(enteredA.session, restored); assert.equal(current(), restored);
  assert.equal(restored.state, restoredState); assert.equal(restored.world, restoredWorld);
  acceptPresentation(enteredA.presentation); tick(0); stable();
  assert.equal(current().field.content.map.identity.mapId, 1); assert.deepEqual(owned(), finalOwned);
  assert.equal(current().field.flags.ScenarioFlag1[1], true); assert.equal(current().field.flags.ScenarioFlag1[8], true);
  assert.equal(current().field.flags.ScenarioFlag1[9], true); assert.equal(count(), 1);
  assert.deepEqual(current().completedEncounters, [1000]); assert.equal(flow.continueVictory(), false);
  assert.equal(current().checkpointReady, true); assert.equal(resources.size, 1);
  assert.deepEqual(restored.world.transitions.map(({ from, to }) => [from, to]), [[2, 1]]);
  stage("restored-session-B-to-A-keeps-owned-progress-and-can-save");
  media.discard(presentation); assert.equal(resources.size, 0);

  report.content = { fieldHash: field.contentHash, battleHash: battle.contentHash,
    worldHash: catalog.contentHash, mapHashes: { A: mapA.contentHash, B: mapB.contentHash } };
  report.contentReads = reads;
  report.presentation = { preparations, acquired: resourceId, discarded, retained: resources.size };
  report.runtime = await Promise.all(["game-flow", "game-session", "game-content", "game-map-loader", "saved-game"].map(async (name) => ({
    module: "src/core/" + name + ".js",
    sha256: createHash("sha256").update(await readFile(resolve(compiled, "src/core", name + ".js"))).digest("hex"),
  })));
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, evidence: report.evidence, report: reportPath }, null, 2));
}
