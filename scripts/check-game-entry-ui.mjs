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
  { createSourcePresentationContext }, { CheckpointStorage }, { sourceNewGameFixture }, { checkpointFixture },
  { contentBatchProgramFixture }, { compileDevelopmentMapEntry }] =
  await Promise.all([
    runtime("content-integrity"), runtime("game-session"), runtime("new-game-field-entry"),
    runtime("field-fade"), runtime("source-presentation"), runtime("saved-game"),
    import(pathToFileURL(resolve(compiled, "tests/fixtures/source-new-game.js")).href),
    import(pathToFileURL(resolve(compiled, "tests/fixtures/checkpoint-game.js")).href),
    import(pathToFileURL(resolve(compiled, "tests/fixtures/content-batch-program.js")).href),
    import(pathToFileURL(resolve(compiled, "src/compiler/development-map-entry.js")).href),
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
    "Development-map checks use two authored synthetic maps; helper observation delegates to the real implementation and establishes no source-region coverage",
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
  const developmentBattle = await seal(fresh.developmentBattle ?? fresh.battle);
  const content = await seal({ ...fresh.content, battleCatalogHash: battle.contentHash,
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash });
  development.field.sourceSetHash = battle.common.fieldSourceSetHash;
  development.field.map.textures = { controlled: "/controlled/development-entry.png" };
  const initial = await seal(development.field);
  const files = new Map([
    ["/game/content.json", initial], ["/game/battle.json", developmentBattle],
    ["/game/source-catalog.json", battle],
    ["/game/new-game.json", content], ["/world/catalog.json", catalog],
    [catalog.maps[String(map.mapId)].url, map],
  ]);
  return { initial, battle, content, catalog, map, files };
}
function referencedPackages(pack, { source = true, development = true, id = "custom" } = {}) {
  const prefix = `/content-packages/${id}`, files = new Map(pack.files);
  const reference = (name, payload) => {
    const url = `${prefix}/${name}.json`; files.set(url, payload);
    return { url, contentHash: payload.contentHash };
  };
  const refs = { kind: "game-content-refs-v1", profile: "source", world: reference("world", pack.catalog),
    source: source ? { entry: reference("source-entry", pack.content), battle: reference("source-battle", pack.battle) } : null,
    development: development ? { entry: reference("development-entry", pack.initial),
      battle: reference("development-battle", pack.files.get("/game/battle.json")) } : null };
  for (const url of ["/game/content.json", "/game/battle.json", "/game/new-game.json",
    "/game/source-catalog.json", "/world/catalog.json"]) files.delete(url);
  files.set(`/content-packages/${id}.json`, refs);
  return { ...pack, refs, files, packageId: id };
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
async function battlePackages() {
  const fixture = checkpointFixture();
  fixture.field.map.textures = { controlled: "/controlled/development-entry.png" };
  fixture.battle.common.sprites.synthetic = { file: "/controlled/battle-preparation.png", width: 32, height: 32 };
  const initial = await seal(fixture.field), battle = await seal(fixture.battle);
  return { initial, battle, files: new Map([["/game/content.json", initial], ["/game/battle.json", battle]]) };
}
/** Authored two-map content, not a source-region fixture. Distinct media prove
 * the app prepares its relocated map instead of the retained baseline map. */
async function developmentMapPackages() {
  const { packages } = contentBatchProgramFixture();
  const { developmentProfile: _profile, ...baseline } = structuredClone(packages.entry);
  baseline.map.textures = { controlled: "/controlled/development-baseline-map.png" };
  const baseField = await seal(baseline), battle = await seal(packages.battle);
  const target = structuredClone(packages.maps[1]);
  target.map.textures = { controlled: "/controlled/development-target-map.png" };
  const map = await seal(target), world = structuredClone(packages.catalog);
  world.maps[String(map.mapId)].contentHash = map.contentHash;
  const catalog = await seal(world), initial = await compileDevelopmentMapEntry({ baseField, baseBattle: battle, catalog, map, entrance: 1 });
  const prefix = "/content-packages/development-map", refs = {
    kind: "game-content-refs-v1", profile: "framework",
    world: { url: `${prefix}/world.json`, contentHash: catalog.contentHash }, source: null,
    development: { entry: { url: `${prefix}/entry.json`, contentHash: initial.contentHash },
      battle: { url: `${prefix}/battle.json`, contentHash: battle.contentHash } },
  };
  const files = new Map([["/content-packages/development-map.json", refs], [refs.world.url, catalog],
    [refs.development.entry.url, initial], [refs.development.battle.url, battle], [catalog.maps[String(map.mapId)].url, map]]);
  return { initial, battle, catalog, map, baseField, refs, files };
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
  read: () => ({ flow, commands, entryLoader, contents, contentReady, contentProfile, game, sourceBoot, entryLoad, failed, battleView, inventoryView, renderer, images, battleLoadAttempt }),
  reset, startSourceGame, loadGame, returnToTitle, loadBattle, cancelBattleLoad, frame
};`;
const audioBody = audioModule.body.replace(/\bexport (?=class |function )/g, "");

async function host(pack, { slots = new Map(), failBinding = false, search = "" } = {}) {
  const calls = { json: [], images: [], audio: [], audioDecodes: [], audioStarts: [], views: [],
    frameCallbacks: [], writes: 0, writeAttempts: 0, audioContexts: 0, developmentEntries: [] };
  const storageFault = { error: null };
  const failedUrls = new Set(), failedImages = new Set(), heldUrls = new Map(), heldImages = new Map();
  const failedAudioDecodes = new Set();
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
  const inertNode = () => ({ connect() {}, disconnect() {}, gain: { value: 0,
    cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } });
  class AudioContext {
    constructor() { calls.audioContexts++; this.currentTime = 0; this.destination = {}; }
    createGain() { return inertNode(); }
    createAnalyser() { return { ...inertNode(), getFloatTimeDomainData(wave) { wave.fill(0); } }; }
    createBufferSource() {
      return { connect() {}, disconnect() {}, stop() {}, start(_when, offset) {
        calls.audioStarts.push({ sha256: this.buffer.sourceSha256, offset });
      } };
    }
    async resume() {} async suspend() {}
    async decodeAudioData(raw) {
      const digest = sha(Buffer.from(raw)), fixture = [...(pack.audio?.values() ?? [])]
        .find(value => value.track.sha256 === digest);
      assert.ok(fixture, "No synthetic startup audio dependency was declared");
      record("audioDecodes", digest);
      if (failedAudioDecodes.has(digest)) throw new Error("Controlled audio decode failure: " + digest);
      return { numberOfChannels: fixture.track.channels, duration: fixture.track.frames / fixture.track.sampleRate,
        sampleRate: fixture.track.sampleRate, sourceSha256: digest };
    }
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
    constructor(...args) {
      if (failBinding && name === "EquipmentView") throw new Error("Controlled published view binding failure");
      this.args = args; this.common = args[1]; this.name = name; calls.views.push(this);
    }
    render() {} reset() {} hide() { if (this.name === "BattleView") this.instance = null; }
    sync(battle) { if (this.name === "BattleView") this.instance = battle; }
    draw() {} overview() {} keyboard() {} back() { return false; }
  };
  const observedCore = { ...coreBindings, prepareGameDevelopmentEntry: async (...parameters) => {
    const candidate = await coreBindings.prepareGameDevelopmentEntry(...parameters);
    calls.developmentEntries.push({ baselineMap: parameters[0].map.identity.mapId,
      destinationMap: candidate.field.content.map.identity.mapId,
      entryHash: parameters[0].contentHash, initialItems: candidate.state.snapshot().items });
    return candidate;
  } };
  const context = vm.createContext({ ...observedCore, ...bindings, document, Image, AudioContext,
    window: { addEventListener(name, fn) { listeners.set(name, fn); } },
    location: { search }, URLSearchParams, Map, WeakSet, Set, structuredClone, crypto: webcrypto,
    console, performance: { now: () => now },
    requestAnimationFrame(fn) { calls.frameCallbacks.push(fn); },
    localStorage: { getItem: (key) => slots.get(key) ?? null,
      setItem(key, value) {
        calls.writeAttempts++;
        if (storageFault.error) throw storageFault.error;
        calls.writes++; slots.set(key, value);
      } },
    async fetch(url) {
      const binary = pack.audio?.get(url);
      record(binary ? "audio" : "json", url);
      const wait = heldUrls.get(url); if (wait) await wait.promise;
      if (failedUrls.has(url)) return { ok: false, status: 503 };
      if (binary) return { ok: true, arrayBuffer: async () => Uint8Array.from(binary.bytes).buffer };
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
    for (const name of ["InventoryView", "EquipmentView", "PartyView", "ShopView", "BattleView"]) {
      const view = calls.views.filter(view => view.name === name).at(-1);
      assert.equal(view.args.at(-1).owner, owner, name + " must bind the exact published owner");
      assert.equal(view.args.at(-1).commands, state.commands, name + " must share the same command channel");
    }
  }
  return { api, ready, frame, sourceStarted, boundToCurrent, observed, calls, slots, storageFault,
    visibility(hidden) { document.hidden = hidden; listeners.get("visibilitychange")(); },
    key(code) {
      listeners.get("keydown")({ code, target: nodes.get("game"), repeat: false, preventDefault() {} });
      listeners.get("keyup")({ code });
    },
    failedUrls, failedImages, failedAudioDecodes, heldUrls, heldImages, $: (id) => document.getElementById(id) };
}
async function check(name, body) { await body(); report.tests.push({ name, pass: true }); }
function stored(h) {
  return new CheckpointStorage({ getItem: (key) => h.slots.get(key) ?? null,
    setItem() { throw new Error("The test's save inspector must never write"); } }, h.api.read().contentProfile);
}
async function moveInApp(h, code) {
  const owner = h.api.read().flow.session, before = { x: owner.field.player.x, y: owner.field.player.y };
  h.key(code);
  assert.ok(owner.field.player.motion, "The actual key handler must start admitted movement");
  for (let i = 0; i < 10 && owner.field.player.motion; i++) await h.frame(50);
  assert.equal(owner.field.player.motion, null);
  assert.notDeepEqual({ x: owner.field.player.x, y: owner.field.player.y }, before);
}
async function eventSaveFinished(h) {
  await eventually(() => !h.api.read().flow.busy && h.$("event-saving").hidden,
    "The app did not finish and acknowledge its event save");
  assert.equal(h.api.read().failed, false, h.$("load-error").textContent);
}

// Node can resolve package imports that the unbundled browser cannot. Verify
// the served dependency graph before the controlled DOM exercises the app.
async function nativeBrowserModules() {
  const pending = ["/game/app.js"], seen = new Set(), modules = [];
  while (pending.length) {
    const url = pending.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    const file = url.startsWith("/game/") ? resolve(root, "apps/game", url.slice(6))
      : url.startsWith("/runtime/core/") ? resolve(compiled, "src/core", url.slice(14)) : null;
    assert.ok(file, "Unserved browser module: " + url);
    const source = await readFile(file, "utf8"), imports = [];
    const ast = ts.createSourceFile(url, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        imports.push(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.equal(node.arguments.length, 1, "Unverified dynamic browser import: " + url);
        imports.push(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const specifier of imports) {
      assert.ok(ts.isStringLiteral(specifier), "Unverified computed browser import: " + url);
      const spec = specifier.text;
      assert.ok(/^(?:\.{1,2}\/|\/)/.test(spec) && !spec.startsWith("//"),
        "Unbundled browser cannot resolve " + JSON.stringify(spec) + " from " + url);
      const target = new URL(spec, "http://browser-module.test" + url);
      assert.equal(target.search + target.hash, "", "Unverified browser module URL: " + spec);
      pending.push(target.pathname);
    }
    modules.push({ url, sha256: sha(source) });
  }
  return modules.sort((a, b) => a.url.localeCompare(b.url));
}

try {
  await check("the actual served browser module graph resolves without Node package lookup", async () => {
    report.browserModules = await nativeBrowserModules();
    assert.ok(report.browserModules.some(module => module.url === "/runtime/core/battle-event.js"));
  });
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
  await check("a nominated content package loads only its references before publishing any game owner", async () => {
    const p = referencedPackages(await packages()), h = await host(p, { search: "?package=custom" });
    await h.ready();
    assert.deepEqual(h.calls.json, ["/content-packages/custom.json"]);
    assert.deepEqual(h.calls.images, []); assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.api.read().contentReady, true); assert.equal(h.api.read().contentProfile, "source");
    assert.equal(h.$("start").textContent, "进入开发片段");
  });
  await check("source-only package starts and restores through its pinned roots without a development fallback", async () => {
    const p = referencedPackages(await packages(), { development: false }), saved = await sourceSave(p);
    const h = await host(p, { search: "?package=custom", slots: saved.slots }); await h.ready();
    assert.equal(h.$("start").hidden, true); assert.equal(h.$("start").disabled, true);
    await h.api.reset(); assert.deepEqual(h.calls.json, ["/content-packages/custom.json"]);
    await h.$("source-start").onclick(); const old = await h.sourceStarted(); h.boundToCurrent();
    await h.$("load-start").onclick();
    assert.notEqual(h.api.read().flow.currentSession, old); h.boundToCurrent();
    assert.equal(h.api.read().flow.paused, true);
    assert.deepEqual(h.api.read().flow.session.checkpoint(), saved.checkpoint);
    const wanted = new Set(["/content-packages/custom.json", p.refs.world.url,
      p.refs.source.entry.url, p.refs.source.battle.url, p.catalog.maps[p.map.mapId].url]);
    assert.ok(h.calls.json.every(url => wanted.has(url)), "No legacy root may satisfy a missing custom dependency");
    assert.equal(h.calls.writeAttempts, 0);
  });
  await check("development-only package uses the same entry and save flow while its source entry stays unavailable", async () => {
    const p = referencedPackages(await packages(), { source: false }), h = await host(p, { search: "?package=custom" });
    await h.ready(); assert.equal(h.$("source-start").hidden, true); assert.equal(h.$("source-start").disabled, true);
    await h.api.startSourceGame(); assert.deepEqual(h.calls.json, ["/content-packages/custom.json"]);
    await h.$("start").onclick(); const old = h.api.read().flow.session; h.boundToCurrent();
    h.$("menu-button").onclick(); await h.$("save-game").onclick();
    const checkpoint = old.checkpoint(); await h.$("load-game").onclick();
    assert.notEqual(h.api.read().flow.session, old); assert.equal(h.api.read().flow.paused, true);
    assert.deepEqual(h.api.read().flow.session.checkpoint(), checkpoint); h.boundToCurrent();
    assert.deepEqual(new Set(h.calls.json), new Set(["/content-packages/custom.json",
      p.refs.development.entry.url, p.refs.development.battle.url]));
  });
  await check("invalid package identity cannot load a default entry or touch saved bytes", async () => {
    const p = await packages(), slots = new Map([["untouched", "original"]]);
    const h = await host(p, { search: "?package=../source", slots });
    await assert.rejects(h.ready(), /Invalid content package identity/);
    assert.deepEqual(h.calls.json, []); assert.equal(h.api.read().flow.currentSession, null);
    await h.api.reset(); await h.api.startSourceGame();
    assert.deepEqual(h.calls.json, []); assert.deepEqual([...slots], [["untouched", "original"]]);
  });
  await check("explicit profile conflict and malformed references reject the package before gameplay", async () => {
    for (const malformed of [false, true]) {
      const p = referencedPackages(await packages());
      if (malformed) p.files.set("/content-packages/custom.json", { ...p.refs, world: { ...p.refs.world, url: "//other/world.json" } });
      const h = await host(p, { search: malformed ? "?package=custom" : "?package=custom&profile=framework" });
      await assert.rejects(h.ready(), malformed ? /Invalid game content reference URL/ : /Content package profile mismatch/);
      assert.deepEqual(h.calls.json, ["/content-packages/custom.json"]);
      assert.equal(h.api.read().flow.currentSession, null); assert.equal(h.calls.writeAttempts, 0);
    }
  });
  await check("a custom entry revision fails its host pin and retains the current owner, pause and saved progress", async () => {
    const p = referencedPackages(await packages(), { source: false }), h = await host(p, { search: "?package=custom" });
    await h.ready(); await h.$("start").onclick(); h.$("menu-button").onclick(); await h.$("save-game").onclick();
    const old = h.api.read().flow.session, checkpoint = old.checkpoint(), bytes = [...h.slots];
    const changed = structuredClone(p.initial); changed.entry.player.x += 1;
    p.files.set(p.refs.development.entry.url, await seal(changed)); h.api.read().contents.clear();
    await h.api.reset();
    assert.equal(h.api.read().flow.session, old); assert.equal(h.api.read().flow.paused, true);
    assert.deepEqual(old.checkpoint(), checkpoint); assert.deepEqual([...h.slots], bytes);
    assert.match(h.$("entry-error").textContent, /Content identity mismatch/);
    assert.ok(h.calls.json.every(url => url === "/content-packages/custom.json" ||
      url === p.refs.development.entry.url || url === p.refs.development.battle.url));
  });
  await check("a synthetic development-map title reads only its trusted references and keeps source start unavailable", async () => {
    const p = await developmentMapPackages(), h = await host(p, { search: "?package=development-map" });
    await h.ready();
    assert.deepEqual(h.calls.json, ["/content-packages/development-map.json"]);
    assert.equal(h.api.read().contentProfile, "framework"); assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.$("source-start").hidden, true); assert.equal(h.$("source-start").disabled, true);
    assert.deepEqual(h.calls.developmentEntries, []); assert.deepEqual(h.calls.images, []);
  });
  await check("the actual app uses the public development helper and prepares the destination renderer and media", async () => {
    const p = await developmentMapPackages(), h = await host(p, { search: "?package=development-map" });
    await h.ready(); await h.$("start").onclick(); h.boundToCurrent();
    const owner = h.api.read().flow.session;
    assert.equal(owner.field.content.map.identity.mapId, p.map.mapId);
    assert.notEqual(owner.field.content.map.identity.mapId, p.baseField.map.identity.mapId);
    assert.equal(owner.state.initialization, "development-checkpoint");
    assert.equal(h.calls.developmentEntries.length, 1);
    assert.deepEqual(h.calls.developmentEntries[0], { baselineMap: 1, destinationMap: 2,
      entryHash: p.initial.contentHash, initialItems: [{ id: 10, count: 1 }] });
    assert.equal(h.api.read().renderer.args[1], owner.field.content);
    assert.equal(h.calls.images.includes("/controlled/development-target-map.png"), true);
    assert.equal(h.calls.images.includes("/controlled/development-baseline-map.png"), false);
    const wanted = new Set(["/content-packages/development-map.json", p.refs.world.url,
      p.refs.development.entry.url, p.refs.development.battle.url, p.catalog.maps[2].url]);
    assert.ok(h.calls.json.every(url => wanted.has(url)), "No opening or source fallback may initialize a development map");
  });
  await check("development-map initialization reaches the actual pause menu and save with the derived entry origin", async () => {
    const p = await developmentMapPackages(), h = await host(p, { search: "?package=development-map" });
    await h.ready(); await h.$("start").onclick(); await h.frame(0);
    const owner = h.api.read().flow.session;
    assert.equal(owner.field.entrySynchronized, true); assert.equal(owner.menuReady, true); assert.equal(owner.checkpointReady, true);
    assert.equal(owner.field.eventState.read({ category: "ScenarioFlag1", index: 9 }), 1);
    assert.deepEqual(owner.state.snapshot().items, [{ id: 10, count: 1 }]);
    h.$("menu-button").onclick();
    assert.equal(h.api.read().flow.paused, true); assert.equal(h.api.read().commands.menuReady, true);
    assert.equal(h.$("pause").hidden, false); assert.equal(h.$("save-game").disabled, false);
    await h.$("save-game").onclick(); const saved = await stored(h).load(); assert.ok(saved);
    assert.deepEqual(saved.checkpoint, owner.checkpoint());
    assert.equal(saved.checkpoint.origin.kind, "development-checkpoint");
    assert.equal(saved.checkpoint.world.initialHash, p.initial.contentHash);
    assert.equal(saved.checkpoint.world.location.mapId, 2);
    assert.equal(saved.checkpoint.world.location.catalogHash, p.catalog.contentHash);
  });
  await check("saving away from PointIn and moving again restores that exact position without another relocation or initializer", async () => {
    const p = await developmentMapPackages(), h = await host(p, { search: "?package=development-map" });
    await h.ready(); await h.$("start").onclick(); await h.frame(0);
    await moveInApp(h, "ArrowDown");
    const old = h.api.read().flow.session;
    assert.deepEqual([old.field.player.x, old.field.player.y], [1, 2]);
    h.$("menu-button").onclick(); await h.$("save-game").onclick();
    const saved = await stored(h).load(), bytes = [...h.slots], writes = h.calls.writes; assert.ok(saved);
    h.$("resume").onclick(); await moveInApp(h, "ArrowDown");
    assert.deepEqual([old.field.player.x, old.field.player.y], [1, 3]);
    h.$("menu-button").onclick(); await h.$("load-game").onclick(); h.boundToCurrent();
    const restored = h.api.read().flow.session;
    assert.notEqual(restored, old); assert.equal(h.api.read().flow.paused, true);
    assert.deepEqual([restored.field.player.x, restored.field.player.y], [1, 2]);
    assert.notDeepEqual([restored.field.player.x, restored.field.player.y], [p.initial.developmentEntry.pointIn.x, p.initial.developmentEntry.pointIn.y]);
    assert.deepEqual(restored.checkpoint(), saved.checkpoint);
    assert.deepEqual(restored.state.snapshot().items, [{ id: 10, count: 1 }]);
    assert.equal(restored.field.eventState.read({ category: "ScenarioFlag1", index: 9 }), 1);
    assert.equal(h.calls.developmentEntries.length, 1, "Restore must use the save origin, not the start relocation helper");
    assert.deepEqual([...h.slots], bytes); assert.equal(h.calls.writes, writes);
    const time = restored.field.time; await h.frame(50);
    assert.equal(restored.field.time, time, "The loaded owner remains paused until Continue");
  });
  await check("a development-map world pin failure keeps the published owner, pause and stored bytes", async () => {
    const p = await developmentMapPackages(), h = await host(p, { search: "?package=development-map" });
    await h.ready(); await h.$("start").onclick(); await h.frame(0);
    h.$("menu-button").onclick(); await h.$("save-game").onclick();
    const old = h.api.read().flow.session, checkpoint = old.checkpoint(), bytes = [...h.slots], calls = h.calls.developmentEntries.length;
    const altered = structuredClone(p.catalog); altered.limitations.push("Controlled changed world");
    p.files.set(p.refs.world.url, await seal(altered)); h.api.read().contents.clear();
    await h.$("restart").onclick();
    assert.equal(h.api.read().flow.session, old); assert.equal(h.api.read().flow.paused, true);
    assert.equal(h.api.read().failed, false); assert.deepEqual(old.checkpoint(), checkpoint);
    assert.deepEqual([...h.slots], bytes); assert.equal(h.calls.developmentEntries.length, calls);
    assert.match(h.$("entry-error").textContent, /Content identity mismatch/); h.boundToCurrent();
  });
  await check("a development-map pin failure on restore preserves the live owner instead of reentering the scene", async () => {
    const p = await developmentMapPackages(), h = await host(p, { search: "?package=development-map" });
    await h.ready(); await h.$("start").onclick(); await h.frame(0);
    h.$("menu-button").onclick(); await h.$("save-game").onclick();
    const old = h.api.read().flow.session, checkpoint = old.checkpoint(), bytes = [...h.slots];
    const altered = structuredClone(p.map); altered.name = "Controlled changed destination";
    p.files.set(p.catalog.maps[2].url, await seal(altered)); h.api.read().contents.clear();
    await h.$("load-game").onclick();
    assert.equal(h.api.read().flow.session, old); assert.equal(h.api.read().flow.paused, true);
    assert.equal(h.api.read().failed, false); assert.deepEqual(old.checkpoint(), checkpoint);
    assert.deepEqual([...h.slots], bytes); assert.equal(h.calls.developmentEntries.length, 1);
    assert.match(h.$("entry-error").textContent, /存档.*版本不同/); h.boundToCurrent();
  });
  await check("signed but invalid embedded world or map pins reject a development-map start without fallback or store writes", async () => {
    for (const pin of ["worldHash", "mapHash"]) {
      const p = await developmentMapPackages(), bad = structuredClone(p.initial);
      bad.developmentEntry[pin] = "0".repeat(64);
      p.initial = await seal(bad); p.refs.development.entry.contentHash = p.initial.contentHash;
      p.files.set(p.refs.development.entry.url, p.initial);
      const slots = new Map([["untouched", "original"]]), h = await host(p, { search: "?package=development-map", slots });
      await h.ready(); await h.$("start").onclick();
      assert.equal(h.api.read().flow.currentSession, null); assert.equal(h.api.read().flow.phase, "title");
      assert.equal(h.api.read().failed, false); assert.match(h.$("entry-error").textContent, /dependency identity mismatch/);
      assert.deepEqual(h.calls.developmentEntries, []); assert.deepEqual(h.calls.images, []);
      assert.deepEqual([...slots], [["untouched", "original"]]); assert.equal(h.calls.writeAttempts, 0);
    }
  });
  await check("cancelled development-map media cannot publish its relocated private owner after another start", async () => {
    const p = await developmentMapPackages(), slots = new Map([["untouched", "original"]]),
      h = await host(p, { search: "?package=development-map", slots }), held = deferred();
    await h.ready(); h.heldImages.set("/controlled/development-target-map.png", held);
    const pending = h.$("start").onclick(); await h.observed("images", "/controlled/development-target-map.png");
    assert.equal(h.calls.developmentEntries.length, 1); assert.equal(h.api.read().flow.currentSession, null);
    h.$("cancel-entry-load").onclick(); assert.equal(h.api.read().flow.phase, "title");
    held.resolve(); h.heldImages.clear(); await pending;
    assert.equal(h.api.read().flow.currentSession, null); assert.deepEqual([...slots], [["untouched", "original"]]);
    await h.$("start").onclick(); await h.frame(0); h.boundToCurrent();
    assert.equal(h.calls.developmentEntries.length, 2);
    assert.equal(h.api.read().flow.session.field.content.map.identity.mapId, 2);
    assert.deepEqual(h.api.read().flow.session.state.snapshot().items, [{ id: 10, count: 1 }]);
    assert.deepEqual([...slots], [["untouched", "original"]]); assert.equal(h.calls.writeAttempts, 0);
  });
  await check("battle media is deferred until the selected encounter and a failed decode retains its request for one explicit retry", async () => {
    const h = await host(await battlePackages()); await h.ready(); await h.$("start").onclick();
    const owner = h.api.read().flow.session, before = owner.state.snapshot();
    assert.equal(h.calls.images.includes("/controlled/battle-preparation.png"), false);
    h.failedImages.add("/controlled/battle-preparation.png");
    assert.equal(owner.field.startEvent("fight"), true); const request = owner.field.stop;
    await h.frame(10);
    await eventually(() => h.api.read().battleLoadAttempt?.error, "Battle media failure was not exposed");
    assert.equal(owner.battle, null); assert.equal(owner.state.inBattle, false);
    assert.equal(owner.field.stop, request); assert.deepEqual(owner.state.snapshot(), before);
    assert.equal(h.$("battle-loading").hidden, false); assert.equal(h.$("retry-battle-load").disabled, false);
    const attempts = h.calls.images.filter(url => url === "/controlled/battle-preparation.png").length;
    await h.frame(50); await h.frame(50);
    assert.equal(h.calls.images.filter(url => url === "/controlled/battle-preparation.png").length, attempts,
      "RAF cannot repeatedly retry failed preparation");
    h.failedImages.delete("/controlled/battle-preparation.png"); h.$("retry-battle-load").onclick();
    await eventually(() => !h.api.read().flow.busy && owner.battle, "Explicit battle preparation retry did not publish");
    assert.equal(owner.battle.content.encounterId, 1000); assert.equal(h.$("battle-loading").hidden, true);
    assert.deepEqual(owner.state.snapshot(), before); assert.equal(owner.state.inBattle, true);
  });
  await check("an unrelated library image failure does not enter this encounter's preparation dependency set", async () => {
    const pack = await battlePackages(), unrelated = "/controlled/unrelated-enemy.png";
    const expanded = structuredClone(pack.battle);
    expanded.common.sprites.unused = { file: unrelated, width: 64, height: 64 };
    pack.files.set("/game/battle.json", await seal(expanded));
    const h = await host(pack); h.failedImages.add(unrelated);
    await h.ready(); await h.$("start").onclick();
    const owner = h.api.read().flow.currentSession;
    assert.equal(owner.field.startEvent("fight"), true); await h.frame(10);
    await eventually(() => !h.api.read().flow.busy && owner.battle, "Encounter waited for unrelated media");
    assert.equal(h.calls.images.includes(unrelated), false);
    assert.equal(owner.battle.content.encounterId, 1000);
    assert.equal(h.api.read().failed, false); h.boundToCurrent();
  });
  await check("battle audio decode failure keeps RAF alive and explicit repair retries the same owned field voice", async () => {
    const pack = await battlePackages(), bytes = Uint8Array.from([11, 29, 47, 61]), digest = sha(bytes);
    const track = { ...pack.initial.bgm.tracks[1], file: "/controlled/battle-audio.bin", sha256: digest, loop: null };
    pack.initial.bgm.tracks[1] = track;
    const script = "audioFight", source = { file: "synthetic", assetPath: "battle-audio-handoff" };
    pack.initial.scripts[script] = [
      { kind: "bgm-play", track: 1, channel: 0, fade: 0, seek: 1.25, script, index: 0, source },
      { kind: "encounter", party: 1000, continuation: "after", script, index: 1, source },
    ];
    pack.initial = await seal(pack.initial); pack.files.set("/game/content.json", pack.initial);
    pack.audio = new Map([[track.file, { bytes, track }]]);
    const h = await host(pack); await h.ready(); await h.$("start").onclick();
    const owner = h.api.read().flow.session, before = owner.state.snapshot();
    h.failedAudioDecodes.add(digest);
    assert.equal(owner.field.startEvent(script), true); const request = owner.field.stop;
    const fieldTime = owner.field.time, audioBefore = owner.field.bgm.snapshot();
    await h.frame(10);
    await eventually(() => h.api.read().battleLoadAttempt?.error, "Audio preparation failure was not exposed");
    assert.equal(h.api.read().failed, false); assert.equal(owner.field.stop, request);
    assert.equal(owner.battle, null); assert.equal(owner.state.inBattle, false); assert.deepEqual(owner.state.snapshot(), before);
    assert.match(String(h.api.read().battleLoadAttempt.error), /Controlled audio decode failure/);
    assert.equal(h.$("battle-loading").hidden, false); assert.equal(h.$("retry-battle-load").disabled, false);
    await h.frame(50); await h.frame(50);
    assert.equal(owner.field.time, fieldTime); assert.deepEqual(owner.field.bgm.snapshot(), audioBefore);
    assert.deepEqual(h.calls.audio, [track.file]); assert.deepEqual(h.calls.audioDecodes, [digest]);
    h.failedAudioDecodes.delete(digest); h.$("retry-battle-load").onclick();
    await eventually(() => !h.api.read().flow.busy && owner.battle, "Repair did not prepare the same encounter's audio");
    assert.equal(owner.field.stop, request); assert.equal(owner.battle.content.encounterId, 1000);
    assert.equal(owner.field.time, fieldTime); assert.deepEqual(owner.field.bgm.snapshot(), audioBefore);
    assert.deepEqual(h.calls.audio, [track.file, track.file]); assert.deepEqual(h.calls.audioDecodes, [digest, digest]);
    assert.equal(h.calls.audioContexts, 1); assert.equal(owner.state.inBattle, true); assert.deepEqual(owner.state.snapshot(), before);
    assert.equal(h.$("battle-loading").hidden, true); await h.frame(10);
    assert.equal(h.api.read().failed, false); assert.equal(h.calls.audioStarts.length, 1);
    assert.equal(h.calls.audioStarts[0].sha256, digest);
    assert.ok(Math.abs(h.calls.audioStarts[0].offset - (1.25 + (owner.field.bgm.time - audioBefore.time) / 1000)) < 1e-9,
      "The existing field clock, including its seek, remains the audio position owner");
    h.boundToCurrent();
  });
  await check("title cancellation of an unresolved battle image frees the lease and late completion cannot replace the next session", async () => {
    const h = await host(await battlePackages()); await h.ready(); await h.$("start").onclick();
    const owner = h.api.read().flow.session, before = owner.state.snapshot(), wait = deferred();
    h.heldImages.set("/controlled/battle-preparation.png", wait);
    assert.equal(owner.field.startEvent("fight"), true); const request = owner.field.stop;
    await h.frame(10); await h.observed("images", "/controlled/battle-preparation.png");
    assert.equal(owner.battle, null); assert.equal(owner.state.inBattle, true);
    const time = owner.field.time; await h.frame(50); assert.equal(owner.field.time, time);
    h.$("battle-load-title").onclick();
    assert.equal(owner.state.inBattle, false); assert.equal(owner.field.stop, request);
    assert.deepEqual(owner.state.snapshot(), before); assert.equal(h.api.read().flow.phase, "title");
    await h.$("start").onclick(); const next = h.api.read().flow.session;
    assert.notEqual(next, owner); wait.resolve(); h.heldImages.clear();
    await eventually(() => h.calls.images.includes("/controlled/battle-preparation.png"), "Held image was not attempted");
    await new Promise(setImmediate); await h.frame(10);
    assert.equal(h.api.read().flow.session, next); assert.equal(next.battle, null);
    assert.equal(owner.battle, null); assert.deepEqual(owner.state.snapshot(), before); h.boundToCurrent();
  });
  await check("return media failure keeps the terminal battle and one receipt until explicit retry, then the field save is stable", async () => {
    const h = await host(await battlePackages()); await h.ready(); await h.$("start").onclick();
    const owner = h.api.read().flow.session;
    assert.equal(owner.field.startEvent("fight"), true); await h.frame(10);
    await eventually(() => !h.api.read().flow.busy && owner.battle, "Battle entry did not complete");
    const before = owner.state.snapshot();
    for (let i = 0; i < 1500 && owner.battle.phase === "active"; i++) {
      for (const actor of owner.battle.ready) {
        const target = owner.battle.targets(actor.id, 10)[0];
        if (target) owner.battle.command(actor.id, 10, target.id);
      }
      await h.frame(50);
    }
    assert.equal(owner.battle.phase, "victory"); const terminal = owner.battle;
    h.api.read().images.delete("synthetic.png"); h.failedImages.add("synthetic.png");
    await h.api.loadBattle(owner, "return");
    assert.equal(owner.battle, terminal); assert.equal(owner.state.inBattle, true);
    assert.deepEqual(owner.state.snapshot(), before); assert.equal(owner.completedEncounters.length, 0);
    assert.equal(h.$("battle-loading").hidden, false);
    h.failedImages.delete("synthetic.png"); h.$("retry-battle-load").onclick();
    await eventually(() => !h.api.read().flow.busy && owner.battle === null, "Field return retry did not complete");
    assert.equal(owner.state.inBattle, false); assert.equal(owner.completedEncounters.length, 1);
    const awarded = owner.state.snapshot(); assert.equal(owner.continueVictory(), false);
    assert.deepEqual(owner.state.snapshot(), awarded);
    // Handoff resets the RAF origin; the first frame anchors the clock and
    // the next logical frame resumes the held field continuation.
    await h.frame(10); await h.frame(10);
    assert.equal(owner.checkpointReady, true); assert.equal(owner.checkpoint().owned.completedBattles.length, 1);
    assert.equal(h.$("battle-loading").hidden, true); assert.equal(h.api.read().failed, false);
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
    assert.equal(h.$("load-error").hidden, false);
    assert.equal(h.$("entry-loading").hidden, true);
    assert.equal(h.$("source-start").disabled, false);
    assert.equal(h.calls.json.filter((url) => url === "/game/content.json").length, 1);
    await h.$("source-start").onclick();
    await h.sourceStarted(); h.boundToCurrent();
  });
  await check("a widget binding failure after entry publication is fatal and cannot replay the entry", async () => {
    const h = await host(await packages(), { failBinding: true }); await h.ready();
    await h.api.reset();
    const { flow, entryLoader, failed } = h.api.read();
    assert.equal(failed, true); assert.equal(entryLoader.busy, false);
    assert.ok(flow.currentSession instanceof GameSession, "A published owner is not rolled back or fabricated again");
    assert.equal(flow.started, false); assert.equal(flow.phase, "title");
    assert.equal(h.$("start").disabled, true); assert.equal(h.$("source-start").disabled, true);
    assert.equal(h.$("load-error").hidden, false);
    assert.match(h.$("load-error").textContent, /Controlled published view binding failure/);
    const owner = flow.currentSession, requests = h.calls.json.length;
    await h.api.reset();
    assert.equal(flow.currentSession, owner); assert.equal(h.calls.json.length, requests);
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
  await check("all application command surfaces share the published owner and lose readiness immediately on hiding", async () => {
    const h = await host(await packages()); await h.ready(); await h.api.reset(); await h.frame();
    h.boundToCurrent(); h.$("menu-button").onclick();
    const { flow, commands } = h.api.read(), before = flow.session.checkpoint();
    assert.equal(commands.menuReady, true);
    h.visibility(true);
    assert.equal(commands.menuReady, false, "Visibility revokes the channel before another RAF");
    assert.equal(commands.settingsReady, false);
    assert.equal(commands.setBattlePreferences({ mode: "wait", speedIndex: 0 }), false);
    assert.deepEqual(flow.session.checkpoint(), before);
    h.visibility(false);
    assert.equal(commands.menuReady, false, "A returning tab needs a fresh media readiness observation");
    await h.frame(); assert.equal(commands.menuReady, true);
    assert.deepEqual(flow.session.checkpoint(), before);
  });
  await check("paused restore publishes through the entry loader and obsolete command channels cannot change either owner", async () => {
    const h = await host(await packages()); await h.ready(); await h.api.reset(); await h.frame();
    h.$("menu-button").onclick();
    const old = h.api.read().flow.session, previousCommands = h.api.read().commands;
    await h.$("save-game").onclick();
    const before = old.checkpoint();
    const pending = h.api.loadGame(false);
    assert.equal(h.api.read().entryLoader.busy, true);
    assert.equal(previousCommands.setBattlePreferences({ mode: "wait", speedIndex: 0 }), false);
    await pending; h.boundToCurrent();
    const { flow, commands, entryLoader } = h.api.read();
    assert.equal(entryLoader.busy, false); assert.notEqual(flow.session, old);
    assert.equal(flow.paused, true); assert.equal(commands.menuReady, false);
    await h.frame(); assert.equal(commands.menuReady, true);
    assert.equal(previousCommands.setBattlePreferences({ mode: "wait", speedIndex: 0 }), false);
    assert.deepEqual(old.checkpoint(), before); assert.deepEqual(flow.session.checkpoint(), before);
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
    assert.equal(h.$("entry-error").hidden, false);
    assert.equal(h.$("entry-loading").hidden, true);
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
    "game-session", "game-flow", "game-commands", "game-entry-loader", "game-content", "game-content-refs", "game-development-entry", "saved-game", "source-new-game", "game-event-save", "field-event-checkpoint", "game-battle-handoff",
  ].map(async (name) => [name, sha(await readFile(resolve(compiled, `src/core/${name}.js`)))])));
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: report.tests.length, report: reportPath }));
}
