// One continuous, explicitly controlled native-owner GameSession journey.
// Source/compiler formula and opcode coverage are checked in their own lanes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--report"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]), "Use --dist/--report <path>");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--dist") ?? "dist");
const output = resolve(root, options.get("--report") ?? "build/reports/script-motion-integration-check.json");
const load = (name) => import(pathToFileURL(resolve(compiled, name + ".js")));
const report = {
  kind: "script-motion-session-integration-v1", result: "running", lane: "controlled-native-owner",
  controlledInputs: ["Synthetic source initializer, actor media, empty collision grid and native factory fixture",
    "Authored concurrent actor/camera scripts compiled by the shared instruction decoder",
    "Headless visible/media-ready/overlay observations and in-memory encoded save",
    "Missing movement animation and unavailable camera Move provider; recovery reloads the prior stable checkpoint",
    "A field-step completion port throws before publication to test native manual-step rollback"],
  doesNotEstablish: ["original-runtime timing parity", "source main-story completion", "pixel or audio equivalence",
    "camera Move, mounted/arc movement or dynamically scaled actual-player script Move admission",
    "new particle or shader capabilities", "full-game migration"],
  stages: [],
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");

try {
  const [{ GameFlow }, { encodeSavedGame, decodeSavedGame }, { fieldCameraWorldToContinuousCell }, fixtureModule] =
    await Promise.all([load("src/core/game-flow"), load("src/core/saved-game"), load("src/core/field-camera"),
      load("tests/fixtures/script-motion-integration")]);
  const { scriptMotionIntegrationFixture, launchScriptMotionIntegration, scriptMotionFlags: flags } = fixtureModule;
  const fixture = scriptMotionIntegrationFixture();
  const flow = new GameFlow(launchScriptMotionIntegration(fixture));
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const game = () => flow.session, field = () => game().field;
  const flag = (ref) => field().eventState.read(ref);
  const tick = (ms = 10, observation = host) => flow.advance(ms, observation);
  const cell = (actor) => ({ x: actor.x, y: actor.y });
  const cameraCell = () => {
    const { x, y } = field().cameraSnapshot.dummy.position;
    return fieldCameraWorldToContinuousCell(fixture.map.cameraHost.mapRange, { x, y });
  };
  const pose = (actor) => ({ cell: cell(actor), layer: actor.layer, direction: actor.direction,
    position: structuredClone(actor.native?.entity.position ?? null), visible: field().isEntityVisible(actor.id),
    animation: actor.animation?.snapshot() ?? null, motion: structuredClone(actor.motion), steps: actor.steps });
  const state = () => ({ time: field().time, owned: game().state.snapshot(), events: field().eventState.snapshot(),
    camera: field().cameraSnapshot, actors: Object.fromEntries(Object.entries(field().actors).map(([id, actor]) => [id, pose(actor)])) });
  const stage = (name, detail = {}) => report.stages.push({ step: report.stages.length + 1, name,
    phase: flow.phase, player: cell(field().player), ...detail });
  const until = (done, label, maxMs = 10000) => {
    for (let elapsed = 0; elapsed <= maxMs; elapsed += 10) {
      assert.equal(field().stop, null, `${label}: ${field().stop?.message}`);
      assert.equal(game().battle, null, "Controlled movement cannot create a battle");
      if (done()) return;
      tick();
    }
    assert.fail(label + " did not complete");
  };
  const stable = () => until(() => game().checkpointReady, "Stable field");
  const restore = async (saved) => {
    const ticket = flow.beginOperation("load"), prior = game(), before = state();
    tick(1000); assert.deepEqual(state(), before, "Loading freezes the current owner");
    const decoded = await decodeSavedGame(await encodeSavedGame(saved, 0));
    const candidate = fixture.restore(decoded.checkpoint);
    assert.equal(game(), prior, "Restore prepares a candidate without replacing the current owner");
    assert.equal(ticket.publish(candidate), true);
    assert.equal(flow.inputReady, false, "The new owner cannot inherit old media readiness");
    assert.equal(ticket.publish(prior), false, "A consumed request cannot replace the restored owner");
    tick(0);
    assert.deepEqual(game().checkpoint(), saved);
  };

  const title = state(); tick(1000);
  assert.equal(flow.phase, "title"); assert.deepEqual(state(), title);
  flow.start(); tick(0); stable();
  assert.equal(game().state.snapshot().initialization, "source-new-game");
  assert.deepEqual(cell(field().player), { x: 3, y: 4 });
  assert.equal(field().cameraSnapshot.target, "player");
  stage("title-source-factory-reserved-script-and-exploration");

  const owner = field().actors, player = field().player, puppet = owner["native:puppet:0"];
  assert.ok(player.native && puppet?.native);
  assert.notEqual(player, puppet, "Source alias -1001 resolves to a distinct party puppet");
  const owned = game().state.snapshot();
  assert.equal(field().startEvent("motion_sync"), true);
  tick(100);
  assert.equal(flow.phase, "event"); assert.equal(field().cameraSnapshot.target, "dummy");
  assert.ok(puppet.x > 3 && puppet.x < 5, "The actor owner must expose its current interpolated position");
  assert.notDeepEqual(cameraCell(), { x: 3, y: 4 }, "The camera track advances in parallel");
  assert.equal(flag(flags.syncStarted), 0, "Synchronous Exec cannot advance its parent early");
  assert.equal(flag(flags.syncCompleted), 0); assert.equal(field().dialogue, null);
  assert.equal(flow.move("right"), false, "Manual exploration input is blocked during a script");
  assert.throws(() => game().checkpoint(), /during battle, movement or an event/);
  assert.equal(field().actors, owner); assert.equal(field().player, player);
  assert.equal(owner["native:puppet:0"], puppet);
  stage("actor-move-and-camera-lerp-concurrently-under-one-owner");

  const paused = state(); assert.equal(flow.pause(true), true); tick(10000);
  assert.equal(flow.phase, "paused"); assert.deepEqual(state(), paused);
  assert.equal(flow.pause(false), true);
  for (const observation of [{ ...host, visible: false }, { ...host, mediaReady: false }, { ...host, overlayOpen: true }]) {
    tick(10000, observation); assert.equal(flow.inputReady, false);
    assert.deepEqual(state(), paused, "A suppressed host frame cannot move any actor/camera or run its next instruction");
  }
  tick(0); assert.deepEqual(state(), paused, "Resume drops suppressed elapsed time");
  stage("pause-hidden-media-and-overlay-freeze-the-whole-session");

  until(() => cameraCell().x === 8 && cameraCell().y === 6, "Camera endpoint");
  assert.equal(flag(flags.syncStarted), 0, "A completed camera track cannot release the slower actor track");
  assert.equal(field().dialogue, null);
  until(() => field().dialogue !== null, "Synchronous choreography message");
  assert.deepEqual(cell(puppet), { x: 6, y: 4 });
  assert.deepEqual(cameraCell(), { x: 8, y: 6 });
  assert.equal(flag(flags.syncStarted), 1); assert.equal(flag(flags.syncCompleted), 0);
  assert.deepEqual(game().state.snapshot(), owned, "Scripted puppet/camera movement does not mutate owned resources");
  assert.equal(flow.confirm(), true); stable();
  assert.deepEqual(cell(field().player), { x: 6, y: 4 });
  assert.equal(field().cameraSnapshot.target, "player");
  assert.equal(flag(flags.syncCompleted), 1);
  assert.equal(field().actors, owner); assert.equal(field().player, player);
  stage("join-waits-for-both-endpoints-and-continues-story-once");

  const oldSteps = field().player.steps;
  assert.equal(flow.move("up"), true); tick(230);
  assert.equal(field().player.steps, oldSteps);
  tick(10); assert.deepEqual(cell(field().player), { x: 6, y: 3 });
  assert.equal(field().player.steps, oldSteps + 1);
  stable();
  const saved = game().checkpoint();
  await restore(saved);
  stage("manual-exploration-save-restore-retains-the-completed-script");

  assert.equal(field().startEvent("motion_async"), true); tick(100);
  assert.equal(flag(flags.asyncStarted), 1, "Asynchronous Exec lets the parent reach Finish immediately");
  assert.equal(flag(flags.asyncCompleted), 0); assert.equal(field().dialogue, null);
  until(() => field().dialogue !== null, "Asynchronous Finish");
  assert.deepEqual(cell(field().actors["native:puppet:0"]), { x: 7, y: 5 });
  assert.deepEqual(cameraCell(), { x: 9, y: 6 });
  assert.equal(flow.confirm(), true); stable();
  assert.deepEqual(cell(field().player), { x: 7, y: 5 });
  assert.equal(flag(flags.asyncCompleted), 1); assert.equal(field().cameraSnapshot.target, "player");
  assert.deepEqual(game().state.snapshot(), owned);
  const recovery = game().checkpoint();
  stage("restored-session-runs-asynchronous-tracks-and-finish");

  assert.equal(field().startEvent("motion_missing_animation"), true);
  const beforeFailure = pose(field().actors["native:puppet:0"]), ownedBeforeFailure = game().state.snapshot();
  for (let n = 0; n < 100 && field().stop === null; n++) tick();
  assert.equal(flow.phase, "blocked");
  assert.match(field().stop.message, /animation|Animation|动画/);
  assert.deepEqual(pose(field().actors["native:puppet:0"]), beforeFailure,
    "Missing movement media cannot publish direction, position, playback or a partial move");
  assert.deepEqual(game().state.snapshot(), ownedBeforeFailure);
  assert.equal(flag(flags.failedCompleted), 0); assert.equal(game().checkpointReady, false);
  await restore(recovery);
  stage("failed-animation-preparation-does-not-half-publish-and-load-recovers");

  assert.equal(field().startEvent("motion_camera_move"), true);
  const cameraBeforeFailure = field().cameraSnapshot, cameraOwnedBeforeFailure = game().state.snapshot();
  for (let n = 0; n < 100 && field().stop === null; n++) tick();
  assert.equal(flow.phase, "blocked");
  assert.match(field().stop.message, /camera|Camera|相机/);
  assert.deepEqual(field().cameraSnapshot, cameraBeforeFailure,
    "An unavailable camera Move provider cannot change the camera owner");
  assert.deepEqual(game().state.snapshot(), cameraOwnedBeforeFailure);
  assert.equal(flag(flags.cameraFailedCompleted), 0);
  await restore(recovery);
  stage("camera-move-remains-explicitly-blocked-without-mutating-camera");

  assert.equal(field().startEvent("motion_actor_conflict"), true);
  const conflictOwned = game().state.snapshot();
  for (let n = 0; n < 100 && field().stop === null; n++) tick();
  assert.equal(flow.phase, "blocked");
  assert.match(field().stop.message, /Concurrent.*movement/);
  assert.deepEqual(game().state.snapshot(), conflictOwned);
  assert.equal(flag(flags.actorConflictCompleted), 0);
  const conflictActor = pose(field().actors["native:puppet:0"]);
  tick(1000); assert.deepEqual(pose(field().actors["native:puppet:0"]), conflictActor);
  await restore(recovery);
  stage("ordinary-actor-move-lerp-arbitration-remains-explicit");

  let completionAttempts = 0;
  field().options.fieldSteps = { prepareStep: () => ({ result: { members: [], damage: [], soundId: null },
    commit: () => { completionAttempts++; throw new Error("Controlled stale field-step publication"); } }) };
  assert.equal(flow.move("right"), true); tick(230);
  const beforeCompletion = pose(field().player), completionOwned = game().state.snapshot();
  tick(10);
  assert.equal(flow.phase, "blocked");
  assert.match(field().stop.message, /Controlled stale field-step publication/);
  assert.equal(completionAttempts, 1);
  assert.deepEqual(pose(field().player), beforeCompletion,
    "A rejected completion keeps the previous native position, movement clock and animation");
  assert.deepEqual(game().state.snapshot(), completionOwned);
  tick(1000); assert.equal(completionAttempts, 1, "The blocked flow cannot repeatedly consume completion effects");
  assert.equal(game().checkpointReady, false);
  await restore(recovery);
  assert.equal(flow.phase, "exploration");
  assert.equal(flow.move("right"), true); tick(240); stable();
  assert.deepEqual(cell(field().player), { x: 8, y: 5 });
  assert.equal(flag(flags.failedCompleted), 0);
  stage("failed-native-step-completion-rolls-back-and-restored-play-continues");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, lane: report.lane, report: output }));
}
