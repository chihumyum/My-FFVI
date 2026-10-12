// Exercise the actual browser flow functions with real session/loader/storage
// owners and controlled DOM, fetch and audio decode. No browser/device claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const module = (path) => import(pathToFileURL(resolve(compiled, path)).href);
const [{ GameSession }, { GameFlow }, { GameMapLoader }, { CheckpointStorage }, { checkpointFixture }] =
  await Promise.all([
    module("src/core/game-session.js"), module("src/core/game-flow.js"),
    module("src/core/game-map-loader.js"), module("src/core/saved-game.js"),
    module("tests/fixtures/checkpoint-game.js"),
  ]);
const app = await readFile(resolve(root, "apps/game/app.js"), "utf8");
const audioSource = await readFile(resolve(root, "apps/game/audio.js"), "utf8");
const boundAudio = audioSource.replace('"/runtime/core/static-audio.js"',
  JSON.stringify(pathToFileURL(resolve(compiled, "src/core/static-audio.js")).href));
assert.notEqual(boundAudio, audioSource, "Bind the real audio module to the selected runtime");
const { AudioOutput, audioProjection } = await import(
  "data:text/javascript;base64," + Buffer.from(boundAudio).toString("base64"));
function section(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, "Missing browser function boundary: " + start);
  return app.slice(first, last);
}
const browserFunctions = [
  section("function frame(now) {", "function failure(error) {"),
  section("function failure(error) {", "async function init() {"),
  section("async function loadMap(owner) {", "function syncSaveControls() {"),
  section("function returnToTitle() {", "function text(id, value) {"),
  section("async function saveGame() {", "async function loadGame(previous) {"),
  section('$("retry-map").onclick = () => {', '$("return-title").onclick = returnToTitle;'),
].join("\n");

const reportPath = resolve(root, "build/reports/game-map-ui-check.json");
const report = { formatVersion: 1, kind: "controlled-game-map-ui-check", result: "running",
  appSha256: sha(app), audioSha256: sha(audioSource), tests: [],
  limitations: [
    "Actual app frame, map/retry/title/save functions with real core owners; DOM, network and decoder are controlled",
    "Synthetic content and media do not prove a source route, audible playback or browser-device acceptance",
    "Rendering and menu rebinding are observed callbacks, not pixel or visual acceptance",
  ] };
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
const originalFetch = globalThis.fetch;
const bytes = Buffer.from("controlled shared BGM: outgoing field and candidate map");
const track = { file: "/controlled/map-ui.flac", sha256: sha(bytes), sampleRate: 1000,
  frames: 10000, channels: 1, loop: { start: 1000, end: 9000 },
  source: { file: "controlled", assetPath: "map-ui-audio" },
  tableSource: { file: "controlled", assetPath: "bgm-table" } };
const source = { file: "controlled", assetPath: "map-ui-event" };
const response = () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function setup({ transition = false, play = false, mediaWait = null } = {}) {
  const fixture = checkpointFixture();
  fixture.field.bgm.tracks[1] = structuredClone(track);
  fixture.field.scripts.depart = [
    { kind: "bgm-play", track: 1, channel: 0, fade: 0, seek: 0, script: "depart", index: 0, source },
    ...(transition ? [{ kind: "change-map", request: { mapId: 2, entrance: 1, continuation: null,
      birdview: false, skipFade: false, skipBgm: false, origin: "script" }, script: "depart", index: 1, source }]
      : [{ kind: "exit", script: "depart", index: 1, source }]),
  ];
  const session = new GameSession(fixture.field, fixture.battle);
  session.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  if (transition || play) { session.field.startEvent("depart"); session.advance(10); }
  const flow = new GameFlow(session); flow.start();
  const audio = new AudioOutput();
  audio.context = { async decodeAudioData() { return { numberOfChannels: 1, duration: 10, sampleRate: 1000 }; } };
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "", attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; }, focus() {} });
    return nodes.get(id);
  };
  const records = { prepared: 0, discarded: 0, viewBindings: 0, scheduledFrames: 0, storageWrites: 0 };
  const mediaStarted = deferred();
  const contents = { world: async () => fixture.world, map: async () => fixture.target, clear() {} };
  const loader = new GameMapLoader(flow, contents, {
    async prepare(field) {
      mediaStarted.resolve();
      if (mediaWait) await mediaWait;
      await audio.prepare(audioProjection(field), field.pendingAudioTracks);
      records.prepared++;
      return { field, draw() {} };
    },
    discard() { records.discarded++; },
  });
  const slot = new Map();
  const storage = new CheckpointStorage({ getItem: (key) => slot.get(key) ?? null,
    setItem: (key, value) => { records.storageWrites++; slot.set(key, value); } });
  const context = vm.createContext({
    $, flow, game: session.field, audio, audioProjection, mapLoader: loader, contents,
    sourceBoot: null, entryLoad: null, mapLoadFailure: null, failed: false, mapOpen: false,
    last: 0, lastMinimapFrame: 0, held: new Map(), loading: new WeakSet(),
    document: { hidden: false }, canvas: $("canvas"), renderer: { draw() {} },
    battleView: { hide() {}, draw() {} }, shopView: { reset() {} }, choiceView: { reset() {} },
    minimapRenderer: { overview() {} },
    sync() {}, syncSaveControls() {}, showLimitations() {}, focus() {},
    setupMapViews() { records.viewBindings++; },
    text(id, value) { $(id).textContent = value; },
    requestAnimationFrame() { records.scheduledFrames++; },
    checkpointStorage: () => storage, refreshSaveInfo: async () => {},
  });
  vm.runInContext(browserFunctions, context, { filename: "controlled-app-flow-functions.js" });
  const loadMap = context.loadMap;
  context.loadMap = (owner) => { context.lastMapPromise = loadMap(owner); return context.lastMapPromise; };
  return { context, session, fixture, flow, audio, loader, records, $, storage, slot, mediaStarted };
}
async function check(name, body) {
  await body();
  report.tests.push({ name, pass: true });
}

try {
  let journey;
  await check("map audio failure remains a pending request across real browser frames", async () => {
    journey = setup({ transition: true });
    const { context, session, audio, flow, records } = journey;
    const before = session.state.snapshot(), request = session.field.stop;
    assert.equal(request.kind, "map-transition");
    assert.equal(session.field.bgm.voices.length, 1);
    globalThis.fetch = async () => ({ ok: false });
    await context.loadMap(session);
    assert.equal(context.failed, false);
    assert.equal(context.mapLoadFailure.request, request);
    assert.match(String(context.mapLoadFailure.error?.message), /声音资源载入失败/,
      "The candidate must fail at the controlled media request, not an unrelated dependency");
    assert.throws(() => audio.isReady(track), /声音资源载入失败/);
    assert.equal(flow.busy, false);
    context.frame(16);
    context.frame(32);
    assert.equal(context.failed, false, "Map failure must not enter the global fatal path on a later RAF");
    assert.equal(session.field.stop, request);
    assert.equal(context.mapLoadFailure.request, request);
    assert.deepEqual(session.state.snapshot(), before);
    assert.equal(session.field.eventState.read({ category: "ScenarioFlag1", index: 8 }), 0);
    assert.equal(records.scheduledFrames, 2);
    assert.equal(records.prepared, 0);
    assert.equal(audio.nodes.size, 0);
  });
  await check("the actual retry button resets decode failure and commits the same map request once", async () => {
    const { context, session, flow, audio, records, $ } = journey;
    const oldField = session.field, request = oldField.stop;
    globalThis.fetch = async () => response();
    $("retry-map").onclick();
    await context.lastMapPromise;
    assert.equal(context.failed, false);
    assert.equal(context.mapLoadFailure, null);
    assert.equal(flow.session, session);
    assert.notEqual(session.field, oldField);
    assert.equal(session.field.content.map.identity.mapId, request.request.mapId);
    assert.equal(context.game, session.field);
    assert.equal(context.renderer.field, session.field);
    assert.equal(audio.isReady(track), true);
    assert.equal(records.prepared, 1);
    assert.equal(records.viewBindings, 1);
    assert.equal(records.discarded, 0);
    assert.equal(session.field.eventState.read({ category: "ScenarioFlag1", index: 8 }), 1);
    assert.equal(flow.busy, false);
    const published = session.field;
    $("retry-map").onclick();
    assert.equal(session.field, published);
    assert.equal(records.prepared, 1, "A consumed retry must not replay the map initializer");
    assert.equal(session.field.eventState.read({ category: "ScenarioFlag1", index: 8 }), 1);
  });
  await check("an in-flight I/O operation owns its media error instead of the frame making it fatal", async () => {
    const { context, session, audio, flow, records } = setup({ play: true });
    const ticket = flow.beginOperation("load"), before = session.field.time;
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(() => audio.prepare(audioProjection(session.field)), /声音资源载入失败/);
    context.frame(16);
    context.frame(32);
    assert.equal(context.failed, false);
    assert.equal(ticket.isCurrent(), true);
    assert.equal(session.field.time, before);
    assert.equal(records.scheduledFrames, 2);
    ticket.cancel();
  });
  await check("ordinary active play still reports an actual audio failure through the fatal UI", async () => {
    const { context, session, audio, $, records } = setup({ play: true });
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(() => audio.prepare(audioProjection(session.field)), /声音资源载入失败/);
    context.frame(16);
    assert.equal(context.failed, true);
    assert.equal($("load-error").hidden, false);
    assert.match($("load-error").textContent, /声音资源载入失败/);
    assert.equal($("start").disabled, true);
    assert.equal(records.scheduledFrames, 0, "Fatal errors cannot silently continue the render loop");
  });
  await check("returning to title cancels suspended media and a late map result cannot replace a new owner", async () => {
    const wait = deferred();
    const { context, session, flow, records, mediaStarted } = setup({ transition: true, mediaWait: wait.promise });
    globalThis.fetch = async () => response();
    const pending = context.loadMap(session);
    await mediaStarted.promise;
    assert.equal(flow.busy, true);
    const oldField = session.field, request = oldField.stop;
    context.returnToTitle();
    assert.equal(flow.started, false);
    assert.equal(flow.busy, false);
    const replacement = checkpointFixture().game, renderer = { draw() {} };
    flow.start(replacement);
    context.game = replacement.field; context.renderer = renderer;
    wait.resolve();
    await pending;
    assert.equal(context.failed, false);
    assert.equal(flow.session, replacement);
    assert.equal(context.game, replacement.field);
    assert.equal(context.renderer, renderer);
    assert.equal(session.field, oldField);
    assert.equal(session.field.stop, request);
    assert.equal(records.prepared, 1);
    assert.equal(records.discarded, 1);
    assert.equal(records.viewBindings, 0);
  });
  await check("the actual save handler discards encoding after title cancellation and writes only the current request", async () => {
    const { context, flow, records, storage } = setup();
    assert.equal(flow.session.checkpointReady, true);
    const pending = context.saveGame();
    assert.equal(flow.busy, true);
    context.returnToTitle();
    await pending;
    assert.equal(records.storageWrites, 0);
    assert.equal(await storage.load(), null);
    assert.equal(flow.started, false);
    const next = checkpointFixture().game;
    flow.start(next); context.game = next.field;
    const current = context.saveGame(), duplicate = context.saveGame();
    await Promise.all([current, duplicate]);
    assert.equal(records.storageWrites, 1);
    assert.deepEqual((await storage.load()).checkpoint, next.checkpoint());
    assert.equal(flow.busy, false);
  });
  report.runtimeSha256 = Object.fromEntries(await Promise.all([
    "game-session", "game-flow", "game-map-loader", "saved-game", "static-audio",
  ].map(async (name) => [name, sha(await readFile(resolve(compiled, `src/core/${name}.js`)))])));
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  globalThis.fetch = originalFetch;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: report.tests.length, report: reportPath }));
}
