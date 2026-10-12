// Run the entire current app module, not a copy of its launch/restore logic.
// Core owners, repository validation and audio projection are real; browser
// presentation, network responses, image decode and WebAudio are controlled.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const runtime = (name) => import(pathToFileURL(resolve(compiled, "src/core", name + ".js")).href);
const [{ contentDigest }, { GameSession }, { NewGameFieldEntry }, { FieldFadeState },
  { createSourcePresentationContext }, { CheckpointStorage }, { sourceNewGameFixture }, { checkpointFixture }] =
  await Promise.all([
    runtime("content-integrity"), runtime("game-session"), runtime("new-game-field-entry"),
    runtime("field-fade"), runtime("source-presentation"), runtime("saved-game"),
    import(pathToFileURL(resolve(compiled, "tests/fixtures/source-new-game.js")).href),
    import(pathToFileURL(resolve(compiled, "tests/fixtures/checkpoint-game.js")).href),
  ]);
const app = await readFile(resolve(root, "apps/game/app.js"), "utf8");
const audio = await readFile(resolve(root, "apps/game/audio.js"), "utf8");
const html = await readFile(resolve(root, "apps/game/index.html"), "utf8");
const reportPath = resolve(root, "build/reports/game-entry-ui-check.json");
const report = { formatVersion: 1, kind: "controlled-game-entry-ui-check", result: "running",
  appSha256: sha(app), audioSha256: sha(audio), htmlSha256: sha(html), tests: [],
  limitations: [
    "Entire current app initialization and handlers with real core/repository/storage/audio modules",
    "Content, DOM, fetch, image decode, WebAudio and renderer/menu widgets are controlled fixtures",
    "Event-save scenarios author a Web barrier and control setItem failure or real digest completion; no session or save coordinator is mocked",
    "Widget constructor bindings and publication are checked; this is not browser pixels, audible output or source-story acceptance",
  ] };
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

async function seal(value) {
  const { contentHash: _, ...payload } = JSON.parse(JSON.stringify(value));
  return { ...payload, contentHash: await contentDigest(payload) };
}
async function packages() {
  const fresh = sourceNewGameFixture(), development = checkpointFixture();
  fresh.map.map.textures = { controlled: "/controlled/source-entry.png" };
  const map = await seal(fresh.map);
  fresh.world.maps[String(map.mapId)].contentHash = map.contentHash;
  const catalog = await seal(fresh.world), battle = await seal(fresh.battle);
  const content = await seal({ ...fresh.content, battleCatalogHash: battle.contentHash,
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash });
  development.field.sourceSetHash = battle.common.fieldSourceSetHash;
  development.field.map.textures = { controlled: "/controlled/development-entry.png" };
  const initial = await seal(development.field);
  const files = new Map([
    ["/game/content.json", initial], ["/game/battle.json", battle],
    ["/game/new-game.json", content], ["/world/catalog.json", catalog],
    [catalog.maps[String(map.mapId)].url, map],
  ]);
  return { initial, battle, content, catalog, map, files };
}
const beforeEventSave = { category: "ScenarioFlag1", index: 3 };
const afterEventSave = { category: "ScenarioFlag1", index: 4 };
async function eventPackages() {
  const fixture = checkpointFixture();
  const source = { file: "synthetic", assetPath: "game-entry-event-save" };
  fixture.field.scripts.eventSave = [
    { kind: "flag", ref: beforeEventSave, operation: "set" },
    { kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] },
    { kind: "event-save" },
    { kind: "inventory", command: { kind: "grant-item", id: 10, count: 3 }, result: null, dependencies: [] },
    { kind: "flag", ref: afterEventSave, operation: "set" },
    { kind: "exit" },
  ].map((command, index) => ({ ...command, script: "eventSave", index, source }));
  fixture.field.entry.initialEventValues = [beforeEventSave, afterEventSave].map((ref) => ({ ref, value: 0 }));
  const initial = await seal(fixture.field), battle = await seal(fixture.battle);
  return { initial, battle, files: new Map([["/game/content.json", initial], ["/game/battle.json", battle]]) };
}
function eventProgress(owner) {
  return {
    before: owner.field.eventState.read(beforeEventSave),
    items: owner.state.snapshot().items.find((item) => item.id === 10)?.count ?? 0,
    after: owner.field.eventState.read(afterEventSave),
  };
}
const atBarrier = { before: 1, items: 2, after: 0 };
const afterBarrier = { before: 1, items: 5, after: 1 };
function startEventSave(h) {
  const owner = h.api.read().flow.currentSession;
  assert.ok(owner instanceof GameSession);
  assert.equal(owner.field.startEvent("eventSave"), true);
  assert.equal(owner.field.stop, null);
  assert.ok(owner.eventSaveRequest);
  assert.deepEqual(eventProgress(owner), atBarrier);
  return { owner, request: owner.eventSaveRequest };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function eventually(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((done) => setTimeout(done, 1));
  }
}
// Hold one platform digest, not the encoder or coordinator. The actual hashing
// and checkpoint validation still run, and the global method is always restored.
function holdNextDigest() {
  const subtle = globalThis.crypto.subtle;
  const descriptor = Object.getOwnPropertyDescriptor(subtle, "digest"), original = subtle.digest;
  const started = deferred(), release = deferred(), completed = deferred();
  let held = false;
  Object.defineProperty(subtle, "digest", { configurable: true, writable: true, value: async function (...args) {
    const thisDigest = !held;
    if (thisDigest) { held = true; started.resolve(); await release.promise; }
    try { return await original.apply(this, args); }
    finally { if (thisDigest) completed.resolve(); }
  } });
  return { started: started.promise, completed: completed.promise, release: release.resolve, get held() { return held; },
    restore() {
      release.resolve();
      if (descriptor) Object.defineProperty(subtle, "digest", descriptor);
      else delete subtle.digest;
    } };
}
async function sourceSave(pack) {
  const presentation = createSourcePresentationContext({ kind: "title-new-game",
    titleCleanupComplete: true, openingCallbackStarted: false });
  const entry = new NewGameFieldEntry(pack.content.entry, presentation);
  const initialFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
    rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
  const start = entry.prepareStart(initialFade, { active: true, callbacks: "absent" });
  start.commit(); let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) {
    const next = entry.prepareResume(fade, true); assert.ok(next); next.commit(); fade = next.fade;
  }
  const session = GameSession.prepareNewGame(pack.content, pack.catalog, pack.map, pack.battle, fade, presentation);
  const launch = entry.prepareLaunch(fade, session.newGamePreparation(true));
  session.launchNewGame(launch.launch); launch.commit(); session.advance(10);
  assert.equal(session.checkpointReady, true);
  const slots = new Map();
  await new CheckpointStorage({ getItem: (key) => slots.get(key) ?? null,
    setItem: (key, value) => slots.set(key, value) }).save(session.checkpoint(), 1000);
  return { slots, checkpoint: session.checkpoint() };
}

function stripImports(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  let body = source;
  for (const item of [...imports].reverse()) body = body.slice(0, item.getStart(ast)) + body.slice(item.end);
  return { body, imports };
}
const appModule = stripImports(app, "app.js"), audioModule = stripImports(audio, "audio.js");
const coreBindings = {};
for (const declaration of [...appModule.imports, ...audioModule.imports]) {
  const path = declaration.moduleSpecifier.text;
  if (!path.startsWith("/runtime/core/")) continue;
  const loaded = await import(pathToFileURL(resolve(compiled, "src/core", path.slice("/runtime/core/".length))).href);
  assert.ok(ts.isNamedImports(declaration.importClause.namedBindings), "Only explicit runtime imports are expected");
  for (const binding of declaration.importClause.namedBindings.elements)
    coreBindings[binding.name.text] = loaded[(binding.propertyName ?? binding.name).text];
}
const viewNames = new Set(["InventoryView", "EquipmentView", "PartyView", "ChoiceView", "ShopView", "Renderer", "BattleView"]);
for (const declaration of appModule.imports) {
  const path = declaration.moduleSpecifier.text;
  if (path.startsWith("/runtime/core/") || path === "./audio.js") continue;
  for (const binding of declaration.importClause.namedBindings.elements)
    assert.ok(viewNames.has(binding.name.text), "Declare new browser boundary explicitly: " + binding.name.text);
}
assert.equal((appModule.body.match(/init\(\)\.catch\(failure\);/g) ?? []).length, 1,
  "Capture the real app's one initialization promise without calling init twice");
const appBody = appModule.body.replace("init().catch(failure);", "globalThis.__init = init().catch(failure);") + `
globalThis.__entry = {
  read: () => ({ flow, game, sourceBoot, entryLoad, failed, battleView, inventoryView, renderer }),
  reset, startSourceGame, loadGame, returnToTitle, frame
};`;
const audioBody = audioModule.body.replace(/\bexport (?=class |function )/g, "");

async function host(pack, { slots = new Map() } = {}) {
  const calls = { json: [], images: [], views: [], frameCallbacks: [], writes: 0, writeAttempts: 0, audioContexts: 0 };
  const storageFault = { error: null };
  const failedUrls = new Set(), failedImages = new Set(), heldUrls = new Map(), heldImages = new Map();
  const observedRequests = new Map();
  const nodes = new Map(), listeners = new Map();
  let now = 0;
  function record(kind, value) {
    calls[kind].push(value);
    observedRequests.get(`${kind}:${value}`)?.resolve();
  }
  async function observed(kind, value) {
    if (calls[kind].includes(value)) return;
    const key = `${kind}:${value}`, signal = observedRequests.get(key) ?? deferred();
    observedRequests.set(key, signal);
    let timer;
    try {
      await Promise.race([signal.promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The app did not request ${kind}: ${value}`)), 5000);
      })]);
    } finally { clearTimeout(timer); }
  }
  const document = { hidden: false, activeElement: null,
    addEventListener(name, fn) { listeners.set(name, fn); },
    getElementById(id) { assert.ok(nodes.has(id), "Unknown DOM identity: " + id); return nodes.get(id); },
    createElement(tag) { return node(tag); } };
  function node(tag, id = "", attributes = "") {
    return { tagName: tag.toUpperCase(), id, hidden: /\bhidden\b/.test(attributes),
      disabled: /\bdisabled\b/.test(attributes), children: [], textContent: "", value: "", dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, setAttribute(name, value) { this[name] = value; },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = [...children]; },
      focus() { document.activeElement = this; }, contains(target) { return target === this || this.children.includes(target); },
      getContext() { return { fillRect() {}, clearRect() {}, fillStyle: "" }; },
    };
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi))
    nodes.set(match[3], node(match[1], match[3], match[2]));
  const inertNode = () => ({ connect() {}, disconnect() {}, gain: { value: 0 } });
  class AudioContext {
    constructor() { calls.audioContexts++; this.currentTime = 0; this.destination = {}; }
    createGain() { return inertNode(); }
    createAnalyser() { return { ...inertNode(), getFloatTimeDomainData(wave) { wave.fill(0); } }; }
    async resume() {} async suspend() {}
    async decodeAudioData() { throw new Error("No synthetic startup audio dependency was declared"); }
  }
  class Image {
    set src(value) { this.file = value; }
    get src() { return this.file; }
    async decode() {
      record("images", this.file);
      const wait = heldImages.get(this.file); if (wait) await wait.promise;
      if (failedImages.has(this.file)) throw new Error("Controlled image decode failure: " + this.file);
      this.width = this.naturalWidth = 32; this.height = this.naturalHeight = 32;
    }
  }
  const bindings = {};
  for (const name of viewNames) bindings[name] = class {
    constructor(...args) { this.args = args; this.common = args[1]; this.name = name; calls.views.push(this); }
    render() {} reset() {} hide() {} sync() {} draw() {} overview() {} keyboard() {} back() { return false; }
  };
  const context = vm.createContext({ ...coreBindings, ...bindings, document, Image, AudioContext,
    window: { addEventListener(name, fn) { listeners.set(name, fn); } },
    location: { search: "" }, URLSearchParams, Map, WeakSet, Set, structuredClone, crypto: webcrypto,
    console, performance: { now: () => now },
    requestAnimationFrame(fn) { calls.frameCallbacks.push(fn); },
    localStorage: { getItem: (key) => slots.get(key) ?? null,
      setItem(key, value) {
        calls.writeAttempts++;
        if (storageFault.error) throw storageFault.error;
        calls.writes++; slots.set(key, value);
      } },
    async fetch(url) {
      record("json", url);
      const wait = heldUrls.get(url); if (wait) await wait.promise;
      if (failedUrls.has(url)) return { ok: false, status: 503 };
      assert.ok(pack.files.has(url), "Unexpected content dependency: " + url);
      return { ok: true, json: async () => structuredClone(pack.files.get(url)) };
    },
  });
  vm.runInContext(audioBody, context, { filename: "actual-audio.js" });
  vm.runInContext(appBody, context, { filename: "actual-app.js" });
  const api = context.__entry;
  async function ready() {
    await context.__init;
    assert.equal(api.read().failed, false, nodes.get("load-error").textContent);
  }
  async function frame(elapsed = 50) {
    now += elapsed;
    const callback = calls.frameCallbacks.shift();
    assert.ok(callback, "The actual app must retain its RAF loop");
    callback(now);
    await new Promise(setImmediate);
    assert.equal(api.read().failed, false, nodes.get("load-error").textContent);
  }
  async function sourceStarted() {
    for (let i = 0; i < 30 && (api.read().sourceBoot || !api.read().flow.started); i++) await frame();
    assert.equal(api.read().sourceBoot, null);
    const owner = api.read().flow.currentSession;
    assert.ok(owner instanceof GameSession);
    assert.equal(owner.state.initialization, "source-new-game");
    if (owner.field.busy) await frame();
    return owner;
  }
  function boundToCurrent() {
    const state = api.read(), owner = state.flow.currentSession;
    assert.ok(owner);
    assert.equal(state.game, owner.field);
    assert.equal(state.battleView.common, owner.battleCatalog.common,
      "BattleView must consume the newly published session catalog");
    assert.equal(state.inventoryView.args[1], owner.battleCatalog.gameState.items);
  }
  return { api, ready, frame, sourceStarted, boundToCurrent, observed, calls, slots, storageFault,
    failedUrls, failedImages, heldUrls, heldImages, $: (id) => document.getElementById(id) };
}
async function check(name, body) { await body(); report.tests.push({ name, pass: true }); }
function stored(h) {
  return new CheckpointStorage({ getItem: (key) => h.slots.get(key) ?? null,
    setItem() { throw new Error("The test's save inspector must never write"); } });
}
async function eventSaveFinished(h) {
  await eventually(() => !h.api.read().flow.busy && h.$("event-saving").hidden,
    "The app did not finish and acknowledge its event save");
  assert.equal(h.api.read().failed, false, h.$("load-error").textContent);
}

try {
  await check("the actual title initializes and renders with no session or content/media requests", async () => {
    const h = await host(await packages()); await h.ready();
    assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.api.read().flow.phase, "title");
    assert.deepEqual(h.calls.json, []); assert.deepEqual(h.calls.images, []);
    assert.equal(h.calls.views.filter((view) => view.name === "BattleView").length, 0);
    await h.frame(); await h.frame();
    assert.deepEqual(h.calls.json, []); assert.deepEqual(h.calls.images, []);
    assert.equal(h.$("source-start").disabled, false);
    assert.equal(h.$("start").disabled, false);
  });
  await check("an unavailable legacy checkpoint does not participate in source startup", async () => {
    const h = await host(await packages()); await h.ready(); h.failedUrls.add("/game/content.json");
    await h.$("source-start").onclick();
    await h.sourceStarted(); h.boundToCurrent();
    assert.equal(h.calls.json.includes("/game/content.json"), false);
    assert.equal(h.calls.images.includes("/controlled/development-entry.png"), false);
  });
  await check("a failed explicit development selection leaves the title usable for source startup", async () => {
    const h = await host(await packages()); await h.ready(); h.failedUrls.add("/game/content.json");
    await h.$("start").onclick();
    assert.equal(h.api.read().failed, false);
    assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.api.read().flow.busy, false);
    assert.equal(h.$("source-start").disabled, false);
    assert.equal(h.calls.json.filter((url) => url === "/game/content.json").length, 1);
    await h.$("source-start").onclick();
    await h.sourceStarted(); h.boundToCurrent();
  });
  await check("source media failure preserves the current owner and repairing media permits a clean retry", async () => {
    const h = await host(await packages()); await h.ready(); await h.$("start").onclick();
    h.boundToCurrent();
    const old = h.api.read().flow.currentSession, checkpoint = old.checkpoint(), battleView = h.api.read().battleView;
    h.failedImages.add("/controlled/source-entry.png");
    await h.api.startSourceGame();
    assert.equal(h.api.read().failed, false);
    assert.equal(h.api.read().flow.currentSession, old);
    assert.equal(h.api.read().battleView, battleView);
    assert.deepEqual(old.checkpoint(), checkpoint);
    assert.equal(h.api.read().flow.busy, false);
    h.failedImages.clear();
    await h.api.startSourceGame();
    const next = await h.sourceStarted(); h.boundToCurrent();
    assert.notEqual(next, old);
    assert.deepEqual(old.checkpoint(), checkpoint);
  });
  await check("source-origin restore is independent of legacy content and binds the restored catalog", async () => {
    const pack = await packages(), saved = await sourceSave(pack);
    const h = await host(pack, { slots: new Map(saved.slots) }); await h.ready();
    assert.deepEqual(h.calls.json, [], "Checking a local save header must not preload gameplay packages");
    h.failedUrls.add("/game/content.json");
    await h.api.loadGame(false); h.boundToCurrent();
    assert.equal(h.api.read().flow.paused, true);
    assert.deepEqual(h.api.read().flow.currentSession.checkpoint(), saved.checkpoint);
    assert.equal(h.calls.json.includes("/game/content.json"), false);
  });
  await check("failed restore media preserves the old session and stored bytes, then succeeds on retry", async () => {
    const pack = await packages(), saved = await sourceSave(pack), slots = new Map(saved.slots);
    const h = await host(pack, { slots }); await h.ready(); await h.$("start").onclick();
    const old = h.api.read().flow.currentSession, checkpoint = old.checkpoint(), before = [...slots];
    h.failedImages.add("/controlled/source-entry.png");
    await h.api.loadGame(false);
    assert.equal(h.api.read().failed, false);
    assert.equal(h.api.read().flow.currentSession, old);
    assert.deepEqual(old.checkpoint(), checkpoint); assert.deepEqual([...slots], before);
    assert.equal(h.api.read().flow.busy, false);
    h.failedImages.clear(); await h.api.loadGame(false); h.boundToCurrent();
    assert.notEqual(h.api.read().flow.currentSession, old);
    assert.deepEqual(h.api.read().flow.currentSession.checkpoint(), saved.checkpoint);
    assert.deepEqual([...slots], before);
  });
  await check("cancelled source media cannot publish over a later development session", async () => {
    const h = await host(await packages()); await h.ready();
    const wait = deferred(); h.heldImages.set("/controlled/source-entry.png", wait);
    const pending = h.api.startSourceGame();
    await h.observed("images", "/controlled/source-entry.png");
    h.api.returnToTitle();
    await h.api.reset();
    const current = h.api.read().flow.currentSession;
    assert.equal(current.state.initialization, "development-checkpoint");
    wait.resolve(); await pending; await h.frame();
    assert.equal(h.api.read().flow.currentSession, current); h.boundToCurrent();
    assert.equal(h.api.read().sourceBoot, null);
  });
  await check("cancelled restore content cannot publish or bind widgets after returning to title", async () => {
    const pack = await packages(), saved = await sourceSave(pack), h = await host(pack, { slots: new Map(saved.slots) });
    await h.ready(); const wait = deferred(); h.heldUrls.set("/game/new-game.json", wait);
    const pending = h.api.loadGame(false);
    await h.observed("json", "/game/new-game.json");
    h.api.returnToTitle(); wait.resolve(); await pending; await h.frame();
    assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.api.read().flow.phase, "title");
    assert.equal(h.calls.views.filter((view) => view.name === "BattleView").length, 0);
    assert.equal(h.calls.images.length, 0);
    assert.equal(h.calls.writes, 0);
  });
  await check("the visible cancel button keeps the outgoing owner and pause state while rejecting late media", async () => {
    const h = await host(await packages()); await h.ready(); await h.$("start").onclick();
    h.$("menu-button").onclick();
    const old = h.api.read().flow.currentSession, checkpoint = old.checkpoint(), view = h.api.read().battleView;
    const wait = deferred(); h.heldImages.set("/controlled/source-entry.png", wait);
    const pending = h.api.startSourceGame(); await h.observed("images", "/controlled/source-entry.png");
    assert.equal(h.$("entry-loading").hidden, false);
    assert.equal(h.api.read().flow.busy, true);
    await h.frame(); await h.frame();
    assert.deepEqual(old.checkpoint(), checkpoint, "Loading must not advance the outgoing session");
    h.$("cancel-entry-load").onclick();
    assert.equal(h.$("entry-loading").hidden, true);
    assert.equal(h.api.read().flow.busy, false);
    assert.equal(h.api.read().flow.currentSession, old);
    assert.equal(h.api.read().flow.paused, true);
    wait.resolve(); await pending; await h.frame();
    assert.equal(h.api.read().flow.currentSession, old);
    assert.equal(h.api.read().battleView, view); h.boundToCurrent();
    assert.deepEqual(old.checkpoint(), checkpoint);
    assert.equal(h.calls.writes, 0);
  });
  await check("the app RAF automatically saves one barrier and ACK waits for the next logical clock", async () => {
    const h = await host(await eventPackages()); await h.ready(); await h.$("start").onclick();
    const { owner, request } = startEventSave(h);
    assert.equal(h.calls.writeAttempts, 0, "Starting the script must not bypass the app persistence host");
    await h.frame(10); await eventSaveFinished(h);
    assert.equal(h.api.read().flow.currentSession, owner);
    assert.equal(owner.eventSaveRequest, null);
    assert.deepEqual(eventProgress(owner), atBarrier, "ACK must not execute the post-save reward");
    assert.equal(h.calls.writes, 1); assert.equal(h.calls.writeAttempts, 1);
    const saved = await stored(h).load(); assert.ok(saved);
    assert.equal(saved.checkpoint.world.kind, "event-world-v1");
    const field = saved.checkpoint.world.field;
    assert.equal(field.kind, "event-field-v1");
    assert.deepEqual(field.execution.barrier, { script: request.site.script, pc: 2 });
    assert.equal(field.execution.main.pc, 3, "The persisted PC consumes the barrier exactly once");
    assert.equal(saved.checkpoint.owned.items.find((item) => item.id === 10)?.count, 2);
    await h.frame(10);
    assert.deepEqual(eventProgress(owner), afterBarrier);
    assert.equal(owner.checkpointReady, true);
    await h.frame(50); assert.equal(h.calls.writeAttempts, 1);
  });
  await check("quota failure shows retry and preserves the same request, rewards and previous save bytes", async () => {
    const h = await host(await eventPackages()); await h.ready(); await h.$("start").onclick();
    await h.$("save-game").onclick();
    const previous = await stored(h).load(), before = [...h.slots]; assert.ok(previous);
    const writeBaseline = h.calls.writes, attemptBaseline = h.calls.writeAttempts;
    h.storageFault.error = new Error("Controlled setItem quota exceeded");
    const { owner, request } = startEventSave(h);
    await h.frame(10);
    await eventually(() => !h.$("retry-event-save").hidden && !h.api.read().flow.busy,
      "The app did not offer retry for a recoverable storage failure");
    assert.equal(h.$("event-saving").hidden, false);
    assert.equal(h.$("retry-event-save").disabled, false);
    assert.match(h.$("event-save-message").textContent, /quota exceeded/);
    assert.equal(owner.eventSaveRequest, request); assert.deepEqual(eventProgress(owner), atBarrier);
    assert.deepEqual([...h.slots], before); assert.equal(h.calls.writes, writeBaseline);
    assert.equal(h.calls.writeAttempts, attemptBaseline + 1);
    await h.frame(50); await h.frame(50);
    assert.equal(h.calls.writeAttempts, attemptBaseline + 1, "RAF must not silently retry a failed request");
    assert.equal(owner.eventSaveRequest, request); assert.deepEqual(eventProgress(owner), atBarrier);
    h.storageFault.error = null;
    await h.$("retry-event-save").onclick(); await eventSaveFinished(h);
    assert.equal(h.api.read().flow.currentSession, owner);
    assert.equal(owner.eventSaveRequest, null); assert.deepEqual(eventProgress(owner), atBarrier);
    assert.equal(h.calls.writes, writeBaseline + 1); assert.equal(h.calls.writeAttempts, attemptBaseline + 2);
    assert.deepEqual((await stored(h).load(true)).checkpoint, previous.checkpoint);
    await h.frame(10); assert.deepEqual(eventProgress(owner), afterBarrier);
    await h.frame(50); assert.equal(h.calls.writes, writeBaseline + 1);
  });
  await check("returning to title while real encoding is pending prevents every late storage write", async () => {
    const h = await host(await eventPackages()); await h.ready(); await h.$("start").onclick();
    await h.$("save-game").onclick();
    const before = [...h.slots], writeBaseline = h.calls.writes, attemptBaseline = h.calls.writeAttempts;
    const { owner, request } = startEventSave(h), digest = holdNextDigest();
    try {
      await h.frame(10);
      assert.equal(digest.held, true, "Actual checkpoint encoding must have reached the controlled digest");
      assert.equal(h.api.read().flow.busy, true);
      assert.equal(h.$("event-saving").hidden, false);
      assert.equal(h.$("event-save-title").disabled, false);
      h.$("event-save-title").onclick();
      assert.equal(h.api.read().flow.phase, "title");
      assert.equal(h.api.read().flow.busy, false);
      assert.equal(h.$("event-saving").hidden, true);
      digest.release(); await digest.completed; await new Promise(setImmediate);
      await h.frame(50); await h.frame(50);
      assert.equal(h.api.read().flow.phase, "title");
      assert.equal(h.api.read().flow.currentSession, owner, "A title does not fabricate a replacement owner");
      assert.equal(owner.eventSaveRequest, request); assert.deepEqual(eventProgress(owner), atBarrier);
      assert.deepEqual([...h.slots], before);
      assert.equal(h.calls.writes, writeBaseline); assert.equal(h.calls.writeAttempts, attemptBaseline);
    } finally { digest.restore(); }
  });
  await check("loading an event checkpoint retains pause and resumes after the barrier without a second save or grant", async () => {
    const h = await host(await eventPackages()); await h.ready(); await h.$("start").onclick();
    const { owner: old } = startEventSave(h);
    await h.frame(10); await eventSaveFinished(h);
    const saved = await stored(h).load(), bytes = [...h.slots]; assert.ok(saved);
    const writeBaseline = h.calls.writes, attemptBaseline = h.calls.writeAttempts;
    await h.$("load-game").onclick(); h.boundToCurrent();
    const owner = h.api.read().flow.currentSession;
    assert.notEqual(owner, old); assert.equal(h.api.read().flow.paused, true);
    assert.equal(h.$("pause").hidden, false); assert.equal(h.$("event-saving").hidden, true);
    assert.equal(owner.eventSaveRequest, null); assert.equal(owner.field.busy, true);
    assert.deepEqual(eventProgress(owner), atBarrier);
    const time = owner.field.time;
    await h.frame(50); await h.frame(50);
    assert.equal(owner.field.time, time, "Restoring must not resume the event behind the pause overlay");
    assert.deepEqual(eventProgress(owner), atBarrier);
    assert.deepEqual([...h.slots], bytes); assert.equal(h.calls.writeAttempts, attemptBaseline);
    h.$("resume").onclick();
    assert.equal(h.api.read().flow.paused, false);
    assert.deepEqual(eventProgress(owner), atBarrier, "The Continue click must not pump the event synchronously");
    await h.frame(10);
    assert.deepEqual(eventProgress(owner), afterBarrier); assert.equal(owner.checkpointReady, true);
    assert.deepEqual(eventProgress(old), atBarrier, "Restoring does not continue or mutate the outgoing owner");
    await h.frame(50);
    assert.equal(owner.eventSaveRequest, null); assert.equal(h.$("event-saving").hidden, true);
    assert.equal(h.calls.writes, writeBaseline); assert.equal(h.calls.writeAttempts, attemptBaseline);
  });
  report.runtimeSha256 = Object.fromEntries(await Promise.all([
    "game-session", "game-flow", "game-content", "saved-game", "source-new-game", "game-event-save", "field-event-checkpoint",
  ].map(async (name) => [name, sha(await readFile(resolve(compiled, `src/core/${name}.js`)))])));
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: report.tests.length, report: reportPath }));
}
