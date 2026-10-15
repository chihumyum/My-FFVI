// The actual app module, views and public owners run here. Only browser DOM,
// drawing, transport and media decoding are controlled; this is not a source
// story, original-game or pixel-equivalence check.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const { runtimeDigest } = await import(pathToFileURL(resolve(root, "scripts/runtime-digest.mjs")).href);
const runtimeBefore = await runtimeDigest(root, compiled), checkerBefore = await readFile(new URL(import.meta.url));
const load = (path) => import(pathToFileURL(resolve(compiled, path)).href);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const { GameSession } = await load("src/core/game-session.js");
const { CheckpointStorage } = await load("src/core/saved-game.js");
const { contentDigest } = await load("src/core/content-integrity.js");
const app = await readFile(resolve(root, "apps/game/app.js"), "utf8");
const html = await readFile(resolve(root, "apps/game/index.html"), "utf8");
const uiNames = ["audio", "story-overlay", "source-message-view", "magic-stones-view", "party-view", "source-party-selection-view", "shop-view", "choice-view", "inventory-view", "equipment-view"];
const ui = Object.fromEntries(await Promise.all(uiNames.map(async name =>
  [name, await readFile(resolve(root, "apps/game", name + ".js"), "utf8")])));
const reportPath = resolve(root, "build/reports/initialized-systems-ui-check.json");
const report = { kind: "controlled-initialized-systems-ui-check-v1", result: "running", cases: [],
  appSha256: sha(app), htmlSha256: sha(html), runtimeSha256: runtimeBefore, checkerSha256: sha(checkerBefore),
  viewSha256: Object.fromEntries(Object.entries(ui).map(([key, source]) => [key, sha(source)])),
  evidence: { actualApp: true, actualSession: true, actualRepository: true, actualCommands: true,
    actualCheckpointStorage: true, actualContentHistory: true, actualContentSessions: true,
    originalGameExecuted: false, sourceStoryAdmitted: false },
  conditionActivityPolicy: { kind: "web-flat-condition-leader-activity-v1", nativeParity: false,
    observation: "Actual production factory and scopes are delegated without substituting predicate results." },
  limitations: ["Synthetic content declares its initializer, held domains, prices, abilities and encounters explicitly.",
    "DOM, network, Blob URLs, image decode and WebAudio are controlled. Renderer and BattleView drawing are host doubles.",
    "The synthetic package publishes one verified release index, immutable JSON objects and authored PNG bytes; this grants no source-story admission.",
    "The app publishes and restores the actual owner. No checkpoint, roster, HP or learned-ability state is patched by the driver."] };
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

function stripImports(source, name) {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  let body = source;
  for (const entry of imports.toReversed()) body = body.slice(0, entry.getStart(ast)) + body.slice(entry.end);
  return { body, imports };
}
const appModule = stripImports(app, "app.js"), core = {};
for (const entry of [...appModule.imports, ...stripImports(ui.audio, "audio.js").imports]) {
  const name = entry.moduleSpecifier.text;
  if (!name.startsWith("/runtime/core/")) continue;
  const loaded = await load("src/core/" + name.slice("/runtime/core/".length));
  assert.ok(ts.isNamedImports(entry.importClause.namedBindings));
  for (const binding of entry.importClause.namedBindings.elements)
    core[binding.name.text] = loaded[(binding.propertyName ?? binding.name).text];
}
assert.equal((appModule.body.match(/init\(\)\.catch\(failure\);/g) ?? []).length, 1);
const appBody = appModule.body.replace("init().catch(failure);", "globalThis.__init = init().catch(failure);") + `
globalThis.__app = {
  read: () => ({ flow, commands, game, contents, contentSessions, failed, entryLoad, sourceBoot, partyView, sourcePartySelectionView, shopView,
    battleView, inventoryView, contentProfile, renderer, entryLoader, images, battleLoadAttempt }),
  runtime, frame, sync, reset, startInitializedGame, returnToTitle, pause, saveGame, loadGame
};`;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const walk = (node) => [node, ...node.children.flatMap(walk)];
async function until(predicate, message) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < end, message);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function host(pack, { slots = new Map(), search = "?package=" + pack.packageId } = {}) {
  const calls = { json: [], images: [], media: [], imageBytes: [], objectUrls: [], revokedUrls: [],
    views: [], frames: [], writes: 0, nativeAtDecode: [] };
  const failedUrls = new Set(), heldUrls = new Map(), failedImages = new Set(), heldImages = new Map();
  const listeners = new Map(), nodes = new Map();
  let now = 0;
  const document = { hidden: false, activeElement: null,
    addEventListener(name, callback) { listeners.set(name, callback); },
    createElement(tag) { return new Element(tag); },
    getElementById(id) { assert.ok(nodes.has(id), "Unknown document node: " + id); return nodes.get(id); } };
  class Element {
    constructor(tag, id = "", attributes = "") {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parentElement = null;
      this.dataset = {}; this.attributes = new Map(); this.style = {}; this.className = ""; this.value = "";
      this.text = ""; this.hidden = /\bhidden\b/.test(attributes); this.disabled = /\bdisabled\b/.test(attributes);
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    get childNodes() { return this.children; }
    set textContent(value) { this.replaceChildren(); this.text = String(value); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) { const list = this.parentElement.children;
      list.splice(list.indexOf(this), 1); this.parentElement = null; } }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.text = ""; this.append(...children); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, callback) { this["on" + name] = callback; }
    focus() { document.activeElement = this; this.onfocus?.(); }
    getContext() { return { clearRect() {}, fillRect() {} }; }
    querySelectorAll(selector) {
      const matches = (node) => {
        if (selector === "button:not(:disabled)") return node.tagName === "BUTTON" && !node.disabled;
        if (selector.startsWith("#")) return node.id === selector.slice(1);
        if (selector.startsWith(".")) return node.className.split(/\s+/).includes(selector.slice(1));
        const attribute = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
        assert.ok(attribute, "Unhandled controlled selector: " + selector);
        const key = attribute[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        return node.dataset[key] !== undefined && (attribute[2] === undefined || node.dataset[key] === attribute[2]);
      };
      return this.children.flatMap(walk).filter(matches);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi))
    nodes.set(match[3], new Element(match[1], match[3], match[2]));
  // These static children are the inventory's real index.html IDs. Dynamic
  // menu elements are always created by the actual view implementations.
  for (const id of ["owned-party", "owned-gil", "owned-key-items", "owned-items", "item-targets", "item-status", "equipment-menu", "party-menu"])
    nodes.get("pause").append(nodes.get(id));
  const inertAudioNode = () => ({ connect() {}, disconnect() {}, gain: { value: 0,
    cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } });
  class AudioContext {
    constructor() { this.currentTime = 0; this.destination = {}; }
    async resume() {} async suspend() {}
    createGain() { return inertAudioNode(); }
    createAnalyser() { return { ...inertAudioNode(), getFloatTimeDomainData(value) { value.fill(0); } }; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {} }; }
    async decodeAudioData() { throw new Error("This fixture did not declare an audio stream"); }
  }
  const blobs = new Map();
  class ControlledURL extends URL {
    static createObjectURL(blob) {
      assert.ok(blob instanceof Blob); assert.equal(blob.type, "image/png");
      const url = "blob:controlled-initialized-" + calls.objectUrls.length;
      blobs.set(url, blob); calls.objectUrls.push(url); return url;
    }
    static revokeObjectURL(url) {
      assert.ok(blobs.delete(url), "An image Blob URL must be revoked exactly once");
      calls.revokedUrls.push(url);
    }
  }
  class Image {
    set src(value) { this.file = value; }
    get src() { return this.file; }
    async decode() {
      calls.images.push(this.file);
      let digest = null;
      if (this.file.startsWith("blob:")) {
        const blob = blobs.get(this.file); assert.ok(blob, "Decode requires its live Blob URL");
        const bytes = Buffer.from(await blob.arrayBuffer());
        assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        digest = sha(bytes); calls.imageBytes.push(digest);
      }
      const owner = context.__app?.read().flow.currentSession;
      if (owner) calls.nativeAtDecode.push({ field: owner.field, fingerprint: owner.field.nativeActorStateFingerprint, camera:owner.field.cameraSnapshot });
      const hold = heldImages.get(this.file) ?? heldImages.get(`sha256:${digest}`); if (hold) await hold.promise;
      if (failedImages.has(this.file) || failedImages.has(`sha256:${digest}`))
        throw new Error("Controlled image failure: " + this.file);
      this.sourceSha256 = digest;
      this.width = this.naturalWidth = 32; this.height = this.naturalHeight = 32;
    }
  }
  class Renderer {
    constructor(...args) { this.args = args; calls.views.push(this); }
    draw(game) { this.game = game; } overview() {}
  }
  class BattleView {
    constructor(...args) { this.args = args; this.common = args[1]; this.instance = null; calls.views.push(this); }
    sync(battle) { this.instance = battle; } hide() { this.instance = null; }
    draw() {} keyboard() {} back() { return false; }
  }
  const actualActivityFactory = core.createWebFlatConditionLeaderActivityPort;
  assert.equal(typeof actualActivityFactory, "function", "Actual production app must import its activity factory");
  const activityCalls = [], activityPorts = [], logicalEffectPorts = [];
  const actualLogicalFactory = core.createWebLogicalFieldEffectsHost;
  const observedCore = { ...core, createWebLogicalFieldEffectsHost: () => {
    const port = actualLogicalFactory(); logicalEffectPorts.push(port); return port;
  }, createWebFlatConditionLeaderActivityPort: () => {
    const actualPort = actualActivityFactory();
    const port = Object.freeze({ ...actualPort, prepare(scopeHost) {
      const scope = actualPort.prepare(scopeHost);
      const row = { actors: scopeHost.readActors(), factory: scopeHost.readFactory(), reads: [] };
      activityCalls.push(row);
      return Object.freeze({ validate: () => scope.validate(), isActiveAndEnabled(id, draft) {
        const value = scope.isActiveAndEnabled(id, draft);
        row.reads.push({ id, value }); return value;
      } });
    } });
    activityPorts.push(port); return port;
  } };
  const context = vm.createContext({ ...observedCore, document, Image, AudioContext, Renderer, BattleView,
    window: { addEventListener(name, callback) { listeners.set(name, callback); } },
    location: { search }, URLSearchParams, URL: ControlledURL, Blob, structuredClone, crypto: webcrypto,
    console, performance: { now: () => now }, requestAnimationFrame(callback) { calls.frames.push(callback); },
    localStorage: { getItem: key => slots.get(key) ?? null,
      setItem(key, value) { calls.writes++; slots.set(key, value); } },
    async fetch(url) {
      if (pack.media.has(url)) {
        calls.media.push(url);
        if (failedUrls.has(url)) return { ok: false, status: 503 };
        return { ok: true, arrayBuffer: async () => Uint8Array.from(pack.media.get(url)).buffer };
      }
      calls.json.push(url);
      const hold = heldUrls.get(url); if (hold) await hold.promise;
      if (failedUrls.has(url)) return { ok: false, status: 503 };
      assert.ok(pack.files.has(url), "Unexpected content dependency: " + url);
      return { ok: true, json: async () => structuredClone(pack.files.get(url)) };
    },
  });
  const exports = { audio: ["AudioOutput", "audioProjection"], "story-overlay": ["drawStoryTimer"], "source-message-view": ["fieldMessageView", "syncFieldMessageView"], "magic-stones-view": ["MagicStoneView"],
    "party-view": ["PartyView"], "source-party-selection-view":["SourcePartySelectionView"], "shop-view": ["ShopView"], "choice-view": ["ChoiceView"],
    "inventory-view": ["InventoryView"], "equipment-view": ["EquipmentView"] };
  for (const name of uiNames) {
    const body = stripImports(ui[name], name + ".js").body.replace(/\bexport (?=class |function |const )/g, "");
    vm.runInContext(`Object.assign(globalThis, (() => { ${body}\n return {${exports[name].join(",")}}; })());`, context,
      { filename: "actual-" + name + ".js" });
  }
  vm.runInContext(appBody, context, { filename: "actual-app.js" });
  await context.__init;
  const api = context.__app;
  const healthy = () => assert.equal(api.read().failed, false, nodes.get("load-error").textContent);
  healthy();
  const frame = async (elapsed = 50) => {
    now += elapsed; const callback = calls.frames.shift(); assert.ok(callback, "App lost its RAF loop");
    callback(now); await new Promise(setImmediate); healthy();
  };
  const click = async (node) => {
    assert.ok(node, "Missing actual UI action"); assert.equal(node.disabled, false, "Action disabled: " + node.textContent);
    node.focus(); await node.onclick?.(); await new Promise(setImmediate); healthy();
  };
  const bound = () => {
    const current = api.read(), owner = current.flow.currentSession;
    assert.ok(owner instanceof GameSession, nodes.get("load-error").textContent || "App has no published GameSession");
    assert.equal(current.game, owner.field);
    assert.equal(current.commands.owner, owner);
    assert.equal(current.battleView.common, owner.battleCatalog.common);
    for (const view of [current.inventoryView, current.partyView, current.shopView]) {
      assert.equal(view.owner, owner); assert.equal(view.commands, current.commands);
    }
    assert.equal(current.battleView.args.at(-1).commands, current.commands);
    assert.equal(current.sourceBoot, null, "Initialized entry must not borrow source fade/launch");
    return owner;
  };
  return { api, frame, click, bound, healthy, calls, slots, activityCalls, activityPorts, logicalEffectPorts, failedUrls, heldUrls, failedImages, heldImages,
    $: id => document.getElementById(id),
    find: (id, predicate) => walk(document.getElementById(id)).find(predicate),
    key(code) { listeners.get("keydown")({ code, target: nodes.get("game"), repeat: false, preventDefault() {} });
      listeners.get("keyup")({ code }); },
    visibility(hidden) { document.hidden = hidden; listeners.get("visibilitychange")(); },
  };
}

async function check(name, run) { await run(); report.cases.push({ name, pass: true }); }
async function seal(value) {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) };
}

// Redistributable authored image bytes. The app verifies their digest before
// the controlled Image host decodes them; no original image is substituted.
function controlledPng() {
  const chunk = (name, bytes) => {
    const body = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(32); header.writeUInt32BE(32, 4);
  header[8] = 8; header[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 32 }, () => [72, 104, 136, 255]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 32 }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

// Fixture composition and assertions follow below. They exercise the same
// pinned initialized entry as the app; no legacy owner is patched into one.
async function packages(packageId = "controlled-initialized-ui", sourceEncounters = false, cameraShake = false) {
  const { frameworkNewGameFixture } = await load("tests/fixtures/framework-new-game.js");
  const { compileFrameworkNewGame } = await load("src/compiler/framework-new-game.js");
  const { itemFixture } = await load("tests/fixtures/items.js");
  const f = await frameworkNewGameFixture();
  const png = controlledPng(), pngHash = sha(png);
  for (const character of Object.values(f.world.characters)) for (const sprite of Object.values(character.sprites)) {
    sprite.file = "/controlled/initialized-actor.png"; sprite.sha256 = pngHash;
  }
  for (const sprite of Object.values(f.battle.common.sprites)) sprite.file = "/controlled/initialized-battle.png";
  const source = { file: "synthetic", assetPath: "initialized-systems-ui" };
  const playerId = f.battle.common.players[0].id;
  const stoneId = Number(Object.keys(f.battle.gameState.magicStones.stones)[0]);
  const skill = f.battle.gameState.magicStones.stones[stoneId].learning.find(entry =>
    f.battle.gameState.fieldAbilities.abilities[entry.abilityId]?.plan);
  assert.ok(skill, "Declare a learnable field ability in the controlled initializer fixture");
  const entry = Object.values(f.battle.encounters)[0];
  f.battle.common.sprites[entry.background] = { file: "/controlled/initialized-battle.png", width: 32, height: 32 };
  const itemId = 10, productId = 1001, groupId = 7;
  const owned = f.battle.gameState;
  owned.items[itemId] = itemFixture(itemId);
  owned.shops = { kind: "ordinary-shops-v1", pricing: "unit-price-times-count",
    itemLimit: owned.limits.item, gilLimit: owned.limits.gil,
    groups: [{ id: groupId, name: "Authored supply counter", productIds: [productId] }],
    products: [{ id: productId, groupId, contentId: itemId, buy: 10, limit: 0 }],
    contents: [
      ...Object.values(owned.items).map(item => ({ id: item.id, kind: "item", name: item.name,
        buy: 10, sell: 5, sellable: !item.important })),
      ...Object.values(owned.equipmentSystem.catalog.definitions).map(gear => ({ id: gear.id, kind: "equipment",
        name: gear.name, buy: 40, sell: 20, sellable: !gear.empty })),
    ] };
  f.battle.common.battleEntry.items.push({ id: itemId, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 1 });
  const point = f.map.partyEntry.pointIns[0];
  const site = (name, commands) => commands.map((command, index) => ({ ...command, script: name, index, source }));
  const scripts = {
    "ui-init": site("ui-init", [{ kind: "exit" }]),
    "ui-acquire": site("ui-acquire", [
      { kind: "inventory", command: { kind: "grant-magic-stone", id: stoneId, count: 1 }, result: null, dependencies: [] },
      { kind: "exit" },
    ]),
    "ui-practice": site("ui-practice", [{ kind: "encounter", party: entry.encounterId, continuation: "ui-return" }]),
    "ui-return": site("ui-return", [{ kind: "exit" }]),
  };
  if(packageId==='controlled-source-party-selection') {
    scripts['ui-acquire']=site('ui-acquire',[{kind:'source-party-selection',command:{kind:'source-party-selection',mode:'two'}},{kind:'wait',seconds:.03},{kind:'exit'}]);
  }
  if (cameraShake) {
    const parent = sha("declared-controlled-shake-ui-source-parent");
    f.map.parentSourceSetHash = f.world.parentSourceSetHash = parent;
    f.sourceMap = await seal({ ...f.sourceMap, parentSourceSetHash: parent });
    f.sourceEntry = await seal({ ...f.sourceEntry, parentSourceSetHash: parent, mapContentHash: f.sourceMap.contentHash });
    f.map.developmentProfile.storyRuntime = f.world.developmentProfile.storyRuntime = "web-field-story-runtime-v1";
    const { compileFieldShakeInstruction } = await load("src/compiler/field-shake.js");
    const shake = compileFieldShakeInstruction({ type: 1, mnemonic: "Shake", operands: {
      iValues: [1, 2, 1, 30, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
    scripts["ui-init"] = site("ui-init", [shake, { kind: "exit" }]);
  }
  const sourceBoss=packageId==="controlled-source-boss-ui";
  if (sourceEncounters||sourceBoss) {
    const { decodeFieldOp } = await load("src/compiler/field.js");
    const raw = (mnemonic, iValues, s0 = "") => ({ type: mnemonic === "SetPos" ? 2 : 1, mnemonic,
      operands: { iValues: [...iValues, ...Array(8 - iValues.length).fill(0)], rValues: Array(8).fill(0),
        sValues: [s0, "", "", "", "", "", "", ""] } });
    const compile = (instruction, name, index) => decodeFieldOp(instruction, { script: name, index, source }, {});
    const single = compile(raw(sourceBoss?"EncountBoss":"Encount", sourceBoss?[entry.encounterId,point.x+3,point.y]:[entry.encounterId], "ui-return"), "ui-practice", 2);
    const pool = compile(raw(sourceBoss?"EncountBoss":"Encount",sourceBoss?[entry.encounterId,point.x+3,point.y]:[entry.encounterId, entry.encounterId, entry.encounterId, entry.encounterId, 7], "ui-return"), "ui-source-pool", 0);
    assert.equal(single.kind, sourceBoss?"source-boss-encounter":"source-encounter"); assert.equal(pool.kind, sourceBoss?"source-boss-encounter":"source-encounter");
    if(sourceBoss){scripts["ui-return"]=site("ui-return",[compile(raw("SysCall",[],"戦闘結果取得"),"ui-return",0),{kind:"wait",seconds:.02},{kind:"exit"}]);for(const encounter of Object.values(f.battle.encounters))encounter.controls={kind:"source-battle-controls-v1",policy:core.WEB_MANUAL_BATTLE_CONTROLS??"web-manual-battle-controls-v1",initialMode:"manual",offAutoBattle:true};}
    scripts["ui-practice"] = site("ui-practice", [{ kind: "puppet", slot: 0, actor: "0", target: 5 },
      { kind: "exec-puppets", asynchronous: false }, single, { kind: "exit" }, { kind: "exit" },
      compile(raw("SetPos", [point.x + 3, point.y]), "ui-practice", 5), { kind: "exit" }]);
    scripts["ui-source-pool"] = site("ui-source-pool", [pool, { kind: "exit" }]);
  }
  const entity = (id, kind, dx, dy) => ({ id, kind, x: point.x + dx, y: point.y + dy, layer: point.layer,
    width: 1, height: 1, direction: "down", asset: null, script: null, collision: null, destinationLayer: null, source });
  const clerk = { ...entity("ui-counter", 5, 0, -1), mapObject: {
    collision: true, acceptDirection: 15, talkMounts: [""], soundId: 0,
    interaction: { kind: "shop", groupId, start: null, close: null },
  } };
  const entities = f.map.map.entities.filter(entity => entity.kind === 0);
  entities.push(clerk, { ...entity("ui-acquire", 2, 1, 0), script: "ui-acquire" },
    { ...entity("ui-practice", 2, 2, 0), script: "ui-practice" });
  if (sourceEncounters||sourceBoss) entities.push({ ...entity("ui-source-pool", 2, 4, 0), script: "ui-source-pool" });
  f.map.map.entities = entities;
  f.map.map.groups = { entity_default: { name: "entity_default", entities, blockers: [], source } };
  f.map.map.textures = { controlled: "/controlled/initialized-field.png" };
  f.map.scripts = scripts; f.map.scriptLocals = sourceBoss?Object.fromEntries(Object.keys(scripts).map(name=>[name,{labels:["result"],values:[-1]}])):{}; f.map.initializer = "ui-init";
  // The ordinary actor lifecycle remains explicit for every authored root.
  const context = Object.values(f.map.scriptPuppetContexts)[0];
  assert.ok(context);
  f.map.scriptPuppetContexts = Object.fromEntries(Object.keys(scripts).map(name =>
    [name, { ...context, scriptHash: sha(name) }]));
  delete f.map.walkEncounters;

  if (packageId === "controlled-animated-map-entities") {
    const definitionSource={file:"synthetic-animated.bundle",assetPath:"Root/entities.json",pointer:"/layers/0/objects/0"};
    const media=structuredClone(Object.values(f.world.characters)[0]);media.animations.Default.mode=1;
    f.world.characters.animated=media;f.map.characterAssets.push("animated");
    const definition={kind:"source-field-animated-map-entity-v1",group:"entity_default",entityId:"500",sourceEntityId:500,source:definitionSource,sourceDirection:15,
      geometry:{x:point.x*16,y:point.y*16,width:16,height:16,layer:point.layer},
      asset:{id:188,asset:"animated",animationAsset:"ANIMATED",source:definitionSource},playOnAwake:true,collision:true,front:true,split:false,building:false,affected:true,zOffset:1};
    Object.assign(clerk,{id:"500",kind:10,asset:"animated",direction:null,source:definitionSource,mapAnimation:definition});
    f.map.developmentProfile.mapAnimatedEntities="web-field-animated-map-entities-v1";
    f.world.developmentProfile.mapAnimatedEntities="web-field-animated-map-entities-v1";
  }
  if(packageId === "controlled-flat-npc") {
    for(const value of [f.map,f.world,f.sourceMap,f.sourceEntry]){value.sourceSetHash=sha("controlled-flat-npc-corpus");value.parentSourceSetHash=sha("controlled-flat-npc-parent");}
    f.sourceMap=await seal(f.sourceMap);f.sourceEntry=await seal({...f.sourceEntry,mapContentHash:f.sourceMap.contentHash});
    const {compileFieldNativeNpc}=await load("src/compiler/field-native-npc.js");
    const source={file:"synthetic-flat-npc.bundle",assetPath:"Room/entities.json",pointer:"/layers/0/objects/0"},
      asset=Object.keys(f.world.characters)[0],raw={x:point.x*16,y:point.y*16,width:16,height:16,properties:Object.entries({
        object_type:6,entity_id:500,asset_id:77,direction:4,move_type:0,all_layers:true,birdview_puppet:false,
        affected:false,visible_minimap:false,collision:true,turn_around:false,move_while_display_message:false
      }).map(([name,value])=>({name,value}))};
    const properties=Object.fromEntries(raw.properties.map(p=>[p.name,p.value]));
    Object.assign(clerk,{id:"500",kind:6,layer:1,asset,direction:"down",source,
      npc:{...clerk.mapObject,moveType:0,pushed:false,eyeContact:false,turnAround:false},
      nativeNpcBlockers:["Native NPC birdview/cross-layer provider is unresolved"]});delete clerk.mapObject;
    const definition=compileFieldNativeNpc({group:"entity_default",object:raw,entity:clerk,properties,
      tables:{"mapobject.csv":[{id:"77",asset_name:asset,shadow_type:"0"}]},flatProjection:"web-source-npc-flat-projection-v1"}).definition;
    assert.ok(definition);f.map.map.groups.entity_default.blockers.push({reason:"Unsupported cross-layer or birdview NPC",source});
    f.map.developmentProfile.npcProjection="web-source-npc-flat-projection-v1";f.world.developmentProfile.npcProjection="web-source-npc-flat-projection-v1";
    f.map.frameworkNpcFlat={kind:"web-source-npc-flat-host-v1",policy:"web-source-npc-flat-projection-v1",
      sourceMapHash:f.map.developmentProfile.sourceContentHash,sourceSetHash:f.map.sourceSetHash,parentSourceSetHash:f.map.parentSourceSetHash,
      bindings:[{entity:structuredClone(clerk),rawObject:raw,definition,allLayerTarget:true,birdviewPuppet:false}],diagnostics:[],nativeParity:false};
  }
  if(packageId === "controlled-finite-animation") {
    const {compileFieldFiniteAnimationInstruction} = await load("src/compiler/field-play-animation.js");
    scripts["ui-acquire"] = site("ui-acquire", [compileFieldFiniteAnimationInstruction({type:2,mnemonic:"PlayAnim",operands:{
      iValues:[0,3,0,0,0,0,0,0],rValues:[.25,0,0,0,0,0,0,0],sValues:["Default","","","","","","",""]}}),
      {kind:"inventory",command:{kind:"grant-item",id:itemId,count:1},result:null,dependencies:[]},{kind:"exit"}]);
  }
  if(packageId === "controlled-ordinary-presentation") {
    const {compileFrameworkOrdinaryPresentation}=await load("src/compiler/framework-ordinary-presentation.js"),
      {ordinaryFieldCompositionRenderHost}=await load("src/core/field-native-composition.js"),
      [tileSource,packageSource]=f.map.actorView.sources.map(row=>structuredClone(row.source)),geometry=f.map.map;
    geometry.source=structuredClone(tileSource);geometry.layers=[{name:"BottomLayer",width:geometry.width,height:geometry.height,
      opacity:1,data:Array(geometry.width*geometry.height).fill(0)}];
    f.map.entryView={mapId:f.map.mapId,isWorld:false,loopType:0,sources:{map:source,area:source}};
    f.map.partyEntry.loopType=0;f.map.cameraHost.loop={horizontal:false,vertical:false};
    const issue={reason:"Source actor water/group material provider is unresolved",source:tileSource};
    f.map.actorViewBlockers=[issue];f.map.nativeCompositionBlockers=[issue];
    f.map.developmentProfile.fieldPresentation=f.world.developmentProfile.fieldPresentation="framework-ordinary-field-flat-v1";
    const tilemap={source:tileSource,data:{width:geometry.width,height:geometry.height,tilewidth:16,tileheight:16,orientation:"orthogonal",infinite:false,properties:[],
      layers:[{type:"group",name:"TileGroup",visible:true,opacity:1,properties:[{name:"body_threshold",type:"int",value:12}],
        layers:geometry.layers.map(row=>({...structuredClone(row),type:"tilelayer",visible:true,properties:[]}))}]}},
      mapPackage={source:packageSource,data:{map:[{tilemap:posix.relative(posix.dirname(packageSource.assetPath),tileSource.assetPath).replace(/\.json$/,"")}],texture:[]}};
    f.map.frameworkPresentation=compileFrameworkOrdinaryPresentation({map:await seal(f.map),sources:[{file:tileSource.file,sha256:tileSource.sha256}],tilemap,mapPackage,
      renderHost:ordinaryFieldCompositionRenderHost()});
  }
  if(["controlled-scripted-battle-action","controlled-non-damaging-battle-action","controlled-battle-event-controls","controlled-battle-effect"].includes(packageId)) {
    const {compileScriptedBattleAction}=await load("src/compiler/battle-scripted-action.js");
    const op=compileScriptedBattleAction({type:1,mnemonic:"BattleAction",operands:{
      iValues:[1,f.battle.common.players[0].sourceId,10,2,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill("")}});
    let nonDamagingOp;
    if(packageId === "controlled-non-damaging-battle-action") {
      const {battleAbilityContentFixture}=await load("tests/fixtures/battle-ability-content.js"),
        {compileBattleAbilityContent}=await load("src/compiler/battle-ability-content.js"),rows=battleAbilityContentFixture();
      Object.assign(rows.ability,{type_id:"35",system_id:"2",battle_renge_id:"5",standard_value:"0",use_value:"0",ability_wait:"0",battle_effect_asset_id:"0"});
      rows.tables["function.csv"][0].type_id="19";rows.group.function1_value1=rows.group.function1_value2="0";rows.tables["content.csv"]=[];
      f.battle.common.abilities[901]=compileBattleAbilityContent(rows.reader(),rows.tables,rows.resolveName).abilities[901];
      nonDamagingOp=compileScriptedBattleAction({type:1,mnemonic:"BattleAction",operands:{iValues:[1,f.battle.common.players[0].sourceId,901,2,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill("")}});
    }
    f.battle.common.battleEvents={conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
    entry.lifecycle={kind:"battle-lifecycle-v1",mode:"script",scriptId:1,program:{kind:"battle-event-v1",source:{file:"synthetic-scripted-action.bundle",assetPath:"sc_b_controlled_action.json",serializedFile:"synthetic",objectId:"1",sha256:sha("controlled-action"),sourceSetHash:sha("controlled-action-corpus"),battleSourceSetHash:sha("controlled-action-battle")},entry:0,end:3,
      localNames:["after"],initialLocals:[0],instructions:[{mnemonic:"BattleAction",op},{mnemonic:"Calc",op:{kind:"calc",index:0,operator:"＋",right:{kind:"immediate",value:1}}},{mnemonic:"Exit",op:{kind:"exit"}}],blockers:[]}};
    if(packageId === "controlled-battle-effect") {
      const {prefixAuthoredBattleEffect}=await load("tests/fixtures/battle-event-effect.js");
      entry.lifecycle.program=prefixAuthoredBattleEffect(entry.lifecycle.program,f.battle.common.players[0].sourceId);
    }
    if(nonDamagingOp) { entry.lifecycle.program.instructions.unshift({mnemonic:"BattleAction",op:nonDamagingOp});entry.lifecycle.program.end++; }
    if(packageId === "controlled-battle-event-controls") {
      entry.lifecycle.program.instructions.unshift(
        {mnemonic:"Wait",op:{kind:"wait",seconds:.2}},
        {mnemonic:"SysCall",op:{kind:"ui-visibility",visible:false}},
        {mnemonic:"Wait",op:{kind:"wait",seconds:.3}},
        {mnemonic:"SysCall",op:{kind:"ui-visibility",visible:true}},
        {mnemonic:"SysCall",op:{kind:"stop-auto"}});
      entry.lifecycle.program.end=entry.lifecycle.program.instructions.length;
    }
  }
  f.map = await seal(f.map); f.battle = await seal(f.battle);
  f.world.maps[String(f.map.mapId)].contentHash = f.map.contentHash;
  f.world = await seal(f.world);
  // Declare the same authored capability metadata in both fixture catalogs.
  // The actual initializer and its owned seed are unchanged; the compiler must
  // verify the common owner rather than accepting a patched entry envelope.
  f.sourceBattle = await seal({ ...f.sourceBattle, gameState: structuredClone(f.battle.gameState) });
  f.sourceEntry = await seal({ ...f.sourceEntry, battleCatalogHash: f.sourceBattle.contentHash });
  f.content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap: f.sourceMap, world: f.world, map: f.map, battle: f.battle, entrance: point.id });
  const prefix = "/content-packages/" + packageId;
  const refs = { kind: "game-content-refs-v2", profile: "framework",
    world: { url: prefix + "/world.json", contentHash: f.world.contentHash }, source: null, development: null,
    initialized: { entry: { url: prefix + "/entry.json", contentHash: f.content.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: f.battle.contentHash } } };
  const files = new Map([["/content-packages/" + packageId + ".json", refs],
    [refs.world.url, f.world], [refs.initialized.entry.url, f.content],
    [refs.initialized.battle.url, f.battle], [f.world.maps[String(f.map.mapId)].url, f.map]]);
  // The first-map save has no committed world location. Even matching current
  // roots therefore need a unique trusted release; never patch the saved map
  // identity or bypass History to make this UI fixture restore.
  const bindings = Object.fromEntries([...files].filter(([, value]) => /^[a-f0-9]{64}$/.test(value.contentHash))
    .map(([url, value]) => [url, value.contentHash]));
  const mediaBindings = Object.fromEntries([...core.fieldMediaUrls({ map: f.map.map,
    characters: f.world.characters, minimap: f.map.minimap }),
    ...Object.values(f.battle.common.sprites).map(sprite => sprite.file)]
    .map(url => [url, { sha256: pngHash, extension: "png" }]));
  const release = { id: await contentDigest({ packageId, refs, bindings, mediaBindings }),
    sourceSetHash: f.content.parentSourceSetHash, refs, bindings, mediaBindings };
  const indexUrl = `/content-releases/packages/${packageId}.json`;
  const index = await seal({ kind: "game-content-release-index-v1", packageId, profile: "framework",
    objectRoot: "/content-releases", currentReleaseId: release.id, releases: [release] });
  for (const [url, hash] of Object.entries(bindings)) files.set(`/content-releases/objects/${hash}.json`, files.get(url));
  files.set(indexUrl, index);
  const media = new Map(Object.keys(mediaBindings).map(url => [url, png]));
  media.set(`/content-releases/media/${pngHash}.png`, png);
  return { ...f, packageId, refs, files, media, release, indexUrl, pngHash, playerId, stoneId, skill, itemId, productId, groupId,
    attackId: 10, attackCommandId: 100, encounterId: entry.encounterId,
    fieldImage: "/controlled/initialized-field.png" };
}
async function start(h) {
  await h.click(h.$("start"));
  const owner = h.bound();
  for (let i = 0; i < 20 && !owner.checkpointReady; i++) await h.frame();
  await h.frame();
  assert.equal(owner.checkpointReady, true, owner.field.stop?.message);
  return owner;
}
async function move(h, direction) {
  const owner = h.bound(), before = { x: owner.field.player.x, y: owner.field.player.y };
  h.$("game").focus();
  h.key({ right: "ArrowRight", left: "ArrowLeft", up: "ArrowUp", down: "ArrowDown" }[direction]);
  assert.ok(owner.field.player.motion, "Real input must start an owned field step");
  for (let i = 0; i < 60 && owner.field.player.motion; i++) await h.frame();
  assert.equal(owner.field.player.motion, null);
  assert.notDeepEqual({ x: owner.field.player.x, y: owner.field.player.y }, before);
  await h.frame();
}
async function pauseMenu(h) { if (!h.api.read().flow.paused) await h.click(h.$("menu-button")); await h.frame(); }
async function resume(h) { await h.click(h.$("resume")); await h.frame(); }
const learned = (owner, pack) => owner.magicStoneMenu(pack.playerId).stones
  .find(stone => stone.contentId === pack.stoneId)?.learning.find(skill => skill.abilityId === pack.skill.abilityId)?.skillLevel;
function button(h, rootId, name) {
  const found = h.find(rootId, node => node.tagName === "BUTTON" && node.textContent === name);
  assert.ok(found, "Missing actual button: " + name); return found;
}
async function win(h, pack) {
  const owner = h.bound();
  for (let i = 0; i < 40 && !owner.battle; i++) await h.frame();
  assert.ok(owner.battle, JSON.stringify({ preparation: owner.encounterPreparationError,
    hostError: h.api.read().battleLoadAttempt?.error?.stack, stop: owner.field.stop,
    busy: owner.field.busy, player: { x: owner.field.player.x, y: owner.field.player.y }, phase: h.api.read().flow.phase }));
  const battle = owner.battle, ledger = owner.state.snapshot().completedBattles.length;
  for (let i = 0; i < 2000 && battle.phase === "active"; i++) {
    const commands = h.api.read().commands;
    for (const actor of battle.ready) {
      const target = battle.enemies.find(enemy => enemy.hp > 0);
      if (target) commands.command(battle, actor.id, pack.attackId, target.id, pack.attackCommandId);
    }
    await h.frame();
  }
  assert.equal(battle.phase, "victory");
  h.api.read().battleView.args[3](); // The actual app's captured terminal callback.
  for (let i = 0; i < 40 && (owner.battle || !owner.checkpointReady); i++) await h.frame();
  assert.equal(owner.battle, null); assert.equal(owner.checkpointReady, true);
  assert.equal(owner.state.snapshot().completedBattles.length, ledger + 1);
  assert.equal(h.bound(), owner); return owner;
}

async function conditionActivityPackages(packageId = "controlled-condition-activity") {
  const { worldLoopSessionFixture } = await load("tests/fixtures/world-loop-session.js");
  const { compileFrameworkNewGame } = await load("src/compiler/framework-new-game.js");
  const f = await worldLoopSessionFixture();
  const png = controlledPng(), pngHash = sha(png);
  for (const character of Object.values(f.world.characters)) for (const sprite of Object.values(character.sprites)) {
    sprite.file = "/controlled/condition-actor.png"; sprite.sha256 = pngHash;
  }
  for (const sprite of Object.values(f.battle.common.sprites)) sprite.file = "/controlled/condition-battle.png";
  const source = { file: "synthetic", assetPath: "condition-activity-ui" };
  const maps = [];
  for (const original of [f.map, f.worldMap]) {
    const map = structuredClone(original), name = map.initializer;
    const prior = map.scripts[name].filter(op => op.kind !== "exit");
    map.scripts[name] = [...prior, { kind: "owned-condition", command: { kind: "remove-condition", conditionType: 607, target: 0 }, dependencies: [] },
      { kind: "exit" }].map((op, index) => ({ ...op, script: name, index, source }));
    Object.assign(map.scriptPuppetContexts[name], { keepBadStatusVisual: true, keepPlayerPuppet: true });
    (map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: true };
    const probe = "condition-ui-probe";
    map.scripts[probe] = [
      { kind: "owned-condition", command: { kind: "remove-condition", conditionType: 607, target: 0 }, dependencies: [] },
      { kind: "exit" },
    ].map((op, index) => ({ ...op, script: probe, index, source }));
    map.scriptPuppetContexts[probe] = { ...map.scriptPuppetContexts[name], scriptHash: sha(probe) };
    map.scriptSystemFlags[probe] = { keepBadStatusVisual: true };
    (map.scriptLocals ??= {})[probe] = null;
    const point = map.partyEntry.pointIns[0];
    const entity = { id: "activity-ui-probe", kind: 2, objectId: 9801, x: point.x - 1, y: point.y,
      layer: point.layer, width: 1, height: 1, direction: "up", asset: null, script: probe,
      collision: null, destinationLayer: null, source };
    map.map.entities.push(entity); map.map.groups.entity_default.entities.push(structuredClone(entity));
    map.map.textures = { controlled: "/controlled/condition-field-" + map.mapId + ".png" };
    if(packageId === "controlled-field-view-change") {
      const {compileFieldViewChangeInstruction}=await load("src/compiler/field-view-change.js");
      const op=compileFieldViewChangeInstruction({type:1,mnemonic:"ChangeView",operands:{iValues:[1,0,0,0,0,0,0,0],rValues:[.016,0,0,0,0,0,0,0],sValues:Array(8).fill("")}});
      map.scripts[name].splice(map.scripts[name].length-1,0,{...op,script:name,index:map.scripts[name].length-1,source});
    }
    maps.push(await seal(map));
  }
  const [map, target] = maps;
  for (const current of maps) f.world.maps[String(current.mapId)].contentHash = current.contentHash;
  const world = await seal(f.world), battle = await seal(f.battle);
  const content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap: f.sourceMap, world, map, battle, entrance: map.partyEntry.pointIns[0].id });
  const prefix = "/content-packages/" + packageId;
  const refs = { kind: "game-content-refs-v2", profile: "framework",
    world: { url: prefix + "/world.json", contentHash: world.contentHash }, source: null, development: null,
    initialized: { entry: { url: prefix + "/entry.json", contentHash: content.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: battle.contentHash } } };
  const files = new Map([["/content-packages/" + packageId + ".json", refs],
    [refs.world.url, world], [refs.initialized.entry.url, content], [refs.initialized.battle.url, battle],
    ...maps.map(value => [world.maps[String(value.mapId)].url, value])]);
  const bindings = Object.fromEntries([...files].filter(([, value]) => /^[a-f0-9]{64}$/.test(value.contentHash))
    .map(([url, value]) => [url, value.contentHash]));
  const mediaBindings = Object.fromEntries([...new Set([...maps.flatMap(value => core.fieldMediaUrls({ map: value.map,
    characters: world.characters, minimap: value.minimap })), ...Object.values(battle.common.sprites).map(sprite => sprite.file)])]
    .map(url => [url, { sha256: pngHash, extension: "png" }]));
  const release = { id: await contentDigest({ packageId, refs, bindings, mediaBindings }),
    sourceSetHash: content.parentSourceSetHash, refs, bindings, mediaBindings };
  const indexUrl = `/content-releases/packages/${packageId}.json`;
  const index = await seal({ kind: "game-content-release-index-v1", packageId, profile: "framework",
    objectRoot: "/content-releases", currentReleaseId: release.id, releases: [release] });
  for (const [url, hash] of Object.entries(bindings)) files.set(`/content-releases/objects/${hash}.json`, files.get(url));
  files.set(indexUrl, index);
  const media = new Map(Object.keys(mediaBindings).map(url => [url, png]));
  media.set(`/content-releases/media/${pngHash}.png`, png);
  return { ...f, content, world, battle, map, worldMap: target, maps, packageId, refs, files, media, release, indexUrl, pngHash,
    targetTexture: target.map.textures.controlled };
}
async function logicalEffectsPackages(packageId = "controlled-logical-effects", flatBirdview = false) {
  const { logicalWorldEffectsFixture } = await load("tests/fixtures/logical-world-effects.js");
  const { compileFrameworkNewGame } = await load("src/compiler/framework-new-game.js");
  const f = await logicalWorldEffectsFixture({flatBirdview}), png = controlledPng(), pngHash = sha(png);
  for (const character of Object.values(f.world.characters)) for (const sprite of Object.values(character.sprites)) {
    sprite.file = "/controlled/logical-actor.png"; sprite.sha256 = pngHash;
  }
  for (const sprite of Object.values(f.battle.common.sprites)) sprite.file = "/controlled/logical-battle.png";
  const maps = [];
  for (const original of f.maps) {
    const value = structuredClone(original);
    value.map.textures = { controlled: "/controlled/logical-field-" + value.mapId + ".png" };
    maps.push(await seal(value));
  }
  const [map, target] = maps, worldDraft = structuredClone(f.world);
  for (const value of maps) worldDraft.maps[String(value.mapId)].contentHash = value.contentHash;
  const world = await seal(worldDraft), battle = await seal(f.battle), content = await compileFrameworkNewGame({
    sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world, map, battle,
    entrance: map.partyEntry.pointIns[0].id });
  const prefix = "/content-packages/" + packageId, refs = { kind: "game-content-refs-v2", profile: "framework",
    world: { url: prefix + "/world.json", contentHash: world.contentHash }, source: null, development: null,
    initialized: { entry: { url: prefix + "/entry.json", contentHash: content.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: battle.contentHash } } };
  const files = new Map([["/content-packages/" + packageId + ".json", refs], [refs.world.url, world],
    [refs.initialized.entry.url, content], [refs.initialized.battle.url, battle],
    ...maps.map(value => [world.maps[String(value.mapId)].url, value])]);
  const bindings = Object.fromEntries([...files].filter(([, value]) => /^[a-f0-9]{64}$/.test(value.contentHash))
    .map(([url, value]) => [url, value.contentHash]));
  const mediaBindings = Object.fromEntries([...new Set([...maps.flatMap(value => core.fieldMediaUrls({ map: value.map,
    characters: world.characters, minimap: value.minimap })), ...Object.values(battle.common.sprites).map(sprite => sprite.file)])]
    .map(url => [url, { sha256: pngHash, extension: "png" }]));
  const release = { id: await contentDigest({ packageId, refs, bindings, mediaBindings }),
    sourceSetHash: content.parentSourceSetHash, refs, bindings, mediaBindings };
  const indexUrl = `/content-releases/packages/${packageId}.json`, index = await seal({
    kind: "game-content-release-index-v1", packageId, profile: "framework", objectRoot: "/content-releases",
    currentReleaseId: release.id, releases: [release] });
  for (const [url, hash] of Object.entries(bindings)) files.set(`/content-releases/objects/${hash}.json`, files.get(url));
  files.set(indexUrl, index);
  const media = new Map(Object.keys(mediaBindings).map(url => [url, png]));
  media.set(`/content-releases/media/${pngHash}.png`, png);
  return { ...f, content, world, battle, map, worldMap: target, maps, packageId, refs, files, media,
    release, indexUrl, pngHash };
}
async function worldTransportPackages(packageId = "controlled-world-transport") {
  const { worldTransportSessionFixture } = await load("tests/fixtures/world-transport-session.js");
  const { compileFrameworkNewGame } = await load("src/compiler/framework-new-game.js");
  const f = await worldTransportSessionFixture(), png = controlledPng(), pngHash = sha(png);
  for(const encounter of Object.values(f.battle.encounters))
    f.battle.common.sprites[encounter.background]={file:"/controlled/world-transport-battle.png",width:32,height:32};
  for (const character of Object.values(f.world.characters)) for (const sprite of Object.values(character.sprites)) {
    sprite.file = "/controlled/world-transport-actor.png"; sprite.sha256 = pngHash;
  }
  for (const sprite of Object.values(f.battle.common.sprites)) sprite.file = "/controlled/world-transport-battle.png";
  const maps = [];
  for (const original of f.maps) {
    const value = structuredClone(original);
    value.map.textures = { controlled: "/controlled/world-transport-field-" + value.mapId + ".png" };
    maps.push(await seal(value));
  }
  const [map, target] = maps, worldDraft = structuredClone(f.world);
  for (const value of maps) worldDraft.maps[String(value.mapId)].contentHash = value.contentHash;
  const world = await seal(worldDraft), battle = await seal(f.battle), content = await compileFrameworkNewGame({
    sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world, map, battle,
    entrance: map.partyEntry.pointIns[0].id });
  const prefix = "/content-packages/" + packageId, refs = { kind: "game-content-refs-v2", profile: "framework",
    world: { url: prefix + "/world.json", contentHash: world.contentHash }, source: null, development: null,
    initialized: { entry: { url: prefix + "/entry.json", contentHash: content.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: battle.contentHash } } };
  const files = new Map([["/content-packages/" + packageId + ".json", refs], [refs.world.url, world],
    [refs.initialized.entry.url, content], [refs.initialized.battle.url, battle],
    ...maps.map(value => [world.maps[String(value.mapId)].url, value])]);
  const bindings = Object.fromEntries([...files].filter(([, value]) => /^[a-f0-9]{64}$/.test(value.contentHash))
    .map(([url, value]) => [url, value.contentHash]));
  const mediaBindings = Object.fromEntries([...new Set([...maps.flatMap(value => core.fieldMediaUrls({ map: value.map,
    characters: world.characters, minimap: value.minimap })), ...Object.values(battle.common.sprites).map(sprite => sprite.file)])]
    .map(url => [url, { sha256: pngHash, extension: "png" }]));
  const release = { id: await contentDigest({ packageId, refs, bindings, mediaBindings }),
    sourceSetHash: content.parentSourceSetHash, refs, bindings, mediaBindings };
  const indexUrl = `/content-releases/packages/${packageId}.json`, index = await seal({
    kind: "game-content-release-index-v1", packageId, profile: "framework", objectRoot: "/content-releases",
    currentReleaseId: release.id, releases: [release] });
  for (const [url, hash] of Object.entries(bindings)) files.set(`/content-releases/objects/${hash}.json`, files.get(url));
  files.set(indexUrl, index);
  const media = new Map(Object.keys(mediaBindings).map(url => [url, png]));
  media.set(`/content-releases/media/${pngHash}.png`, png);
  return { ...f, content, world, battle, map, worldMap: target, maps, packageId, refs, files, media,
    release, indexUrl, pngHash, attackId:10, attackCommandId:100 };
}
function assertActivity(h, field) {
  assert.equal(h.activityPorts.length, 1, "Whole actual app creates one runtime activity port");
  assert.equal(h.api.runtime.conditionLeaderActivity, h.activityPorts[0]);
  assert.equal(Reflect.get(field, "options").conditionLeaderActivity, h.activityPorts[0]);
  const scopes = h.activityCalls.filter(row => row.actors === field.actors);
  assert.ok(scopes.length > 0, "The actual field condition transaction must invoke the production port");
  assert.ok(scopes.some(row => row.reads.some(read => read.value === true)),
    "Source KeepBadStatusVisual=true must execute a real active native leader branch");
  return { scopes: scopes.length, predicateReads: scopes.flatMap(row => row.reads) };
}
async function activityIdle(h, owner = h.bound()) {
  for (let i = 0; i < 100 && !owner.checkpointReady && !owner.field.stop; i++) await h.frame();
  assert.equal(owner.field.stop, null, owner.field.stop?.message);
  assert.equal(owner.checkpointReady, true); return owner;
}
try {
  await check("bare title selects the systems package and exposes honest independent entry links", async () => {
    const pack = await packages("systems-initialized"), h = await host(pack, { search: "" });
    assert.deepEqual(h.calls.json, ["/content-packages/systems-initialized.json"]);
    assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.$("start").textContent, "开始系统演示");
    assert.equal(h.$("source-start").hidden, true); assert.equal(h.$("source-start").disabled, true);
    assert.equal(h.$("systems-playground-link").getAttribute("aria-current"), "page");
    for (const [id, href] of [["systems-playground-link", "/game/?package=systems-initialized"],
      ["world-travel-link", "/game/?package=world-travel"], ["source-sample-link", "/game/?profile=source"]]) {
      assert.equal(h.$(id).hidden, false);
      assert.ok(html.includes(`id="${id}" href="${href}"`));
    }
    assert.match(html, /原迁移样本（未完成）/);
    assert.match(h.$("welcome-scope").textContent, /不代表原剧情/);
    await start(h); assert.equal(h.api.read().sourceBoot, null);
  });
  await check("default and explicit systems titles restore one slot while travel and source slots stay isolated", async () => {
    const pack = await packages("systems-initialized"), h = await host(pack, { search: "" });
    const owner = await start(h); await pauseMenu(h); await h.click(h.$("save-game"));
    const saved = owner.checkpoint(), oldCommands = h.api.read().commands;
    await h.click(h.$("return-title"));
    const explicit = await host(pack, { slots: h.slots });
    assert.equal(explicit.$("load-start").hidden, false);
    await explicit.click(explicit.$("load-start"));
    const restored = explicit.bound();
    assert.notEqual(restored, owner); assert.deepEqual(restored.checkpoint(), saved);
    assert.equal(saved.world.location, null);
    assert.ok(explicit.calls.json.includes(pack.indexUrl));
    assert.ok(explicit.calls.json.includes(`/content-releases/objects/${pack.content.contentHash}.json`));
    assert.equal(explicit.api.read().contentSessions.release.release.id, pack.release.id);
    assert.notEqual(explicit.api.read().contentSessions.repository, explicit.api.read().contents);
    assert.ok(explicit.calls.imageBytes.length > 0);
    assert.ok(explicit.calls.imageBytes.every(hash => hash === pack.pngHash));
    assert.deepEqual(explicit.calls.revokedUrls.toSorted(), explicit.calls.objectUrls.toSorted());
    assert.equal(oldCommands.menu({ kind: "change-magic-stone", playerId: pack.playerId, contentId: 0 }), false);

    const travelPack = await packages("world-travel"), travel = await host(travelPack, { slots: h.slots });
    assert.equal(travel.$("start").textContent, "开始世界旅行");
    assert.equal(travel.$("source-start").hidden, true);
    assert.equal(travel.$("world-travel-link").getAttribute("aria-current"), "page");
    assert.equal(travel.$("load-start").hidden, true);
    await start(travel); await pauseMenu(travel); await travel.click(travel.$("save-game"));
    const inspector = { getItem: key => h.slots.get(key) ?? null,
      setItem() { throw new Error("Inspector cannot write"); } };
    const systemsSave = await new CheckpointStorage(inspector, "framework", "systems-initialized").load();
    assert.deepEqual(systemsSave.checkpoint, saved);
    assert.equal((await new CheckpointStorage(inspector, "framework", "world-travel").load()).checkpoint.origin.entryContentHash,
      travelPack.content.contentHash);
    assert.equal(await new CheckpointStorage(inspector, "source").load(), null);
    assert.equal(h.slots.size, 2);
  });
  await check("initialized-only title has no owner and offers its declared start without legacy/source fallback", async () => {
    const pack = await packages(), h = await host(pack);
    assert.deepEqual(h.calls.json, ["/content-packages/" + pack.packageId + ".json"]);
    assert.equal(h.api.read().flow.currentSession, null);
    assert.equal(h.$("start").hidden, false); assert.equal(h.$("start").disabled, false);
    assert.equal(h.$("start").textContent, "进入来源地点");
    assert.equal(h.$("source-start").hidden, true); assert.equal(h.$("source-start").disabled, true);
    assert.equal(h.$("restart").hidden, false); assert.equal(h.$("retry").hidden, false);
    await h.frame(); assert.equal(h.api.read().flow.currentSession, null);
    assert.deepEqual(h.calls.images, []);
  });
  await check("real initialized entry publishes one fresh owner after media and binds every view to the same commands", async () => {
    const pack = await packages(), h = await host(pack), owner = await start(h);
    const snapshot = owner.state.snapshot(), checkpoint = owner.checkpoint();
    assert.equal(snapshot.initialization, "source-new-game"); assert.ok(snapshot.nativeState);
    assert.deepEqual(snapshot.nativeState.ownedMagicStones, []);
    assert.equal(checkpoint.formatVersion, 6);
    assert.deepEqual(checkpoint.origin, { kind: "framework-new-game", entryContentHash: pack.content.contentHash });
    assert.equal(h.calls.json.some(url => url.startsWith("/game/")), false);
    assert.ok(h.api.read().images.has(pack.fieldImage));
    assert.equal(h.api.read().contentSessions.release.release.id, pack.release.id);
    assert.equal(owner.magicStoneMenu(pack.playerId).available, true);
    report.entry = { contentHash: pack.content.contentHash, battleHash: pack.battle.contentHash,
      worldHash: pack.world.contentHash, mapHash: pack.map.contentHash, origin: checkpoint.origin };
  });
  await check("shop, acquired stone, partial learning, save/restore and mastery use the same owners and public UI/commands", async () => {
    const pack = await packages(), h = await host(pack), owner = await start(h), before = owner.state.snapshot();
    h.$("game").focus(); h.key("Space"); await h.frame();
    assert.equal(owner.field.currentShop?.groupId, pack.groupId);
    const product = h.find("shop-menu", node => node.getAttribute("data-shop-focus") === "buy:" + pack.productId);
    await h.click(product); await h.click(button(h, "shop-menu", "+"));
    await h.click(button(h, "shop-menu", "确认购买"));
    assert.equal(owner.state.snapshot().items.find(item => item.id === pack.itemId)?.count, 2);
    await h.click(button(h, "shop-menu", "出售"));
    const selling = h.find("shop-menu", node => node.getAttribute("data-shop-focus") === "sell:" + pack.itemId);
    await h.click(selling); await h.click(button(h, "shop-menu", "确认出售"));
    assert.equal(owner.state.snapshot().items.find(item => item.id === pack.itemId)?.count, 1);
    assert.equal(owner.state.snapshot().gil, before.gil - 20 + 5);
    await h.click(button(h, "shop-menu", "离开商店")); await h.frame();
    await move(h, "right");
    assert.deepEqual(owner.state.snapshot().nativeState.ownedMagicStones, [pack.stoneId]);
    await pauseMenu(h);
    const equip = h.find("party-menu", node => node.dataset.magicStoneFocus === "stone-" + pack.stoneId);
    await h.click(equip); assert.equal(owner.magicStoneMenu(pack.playerId).currentContentId, pack.stoneId);
    await resume(h); await move(h, "right"); await win(h, pack);
    assert.equal(learned(owner, pack), 50);
    await pauseMenu(h);
    assert.ok(h.$("party-menu").textContent.includes("学习 50%"));
    const stale = h.find("party-menu", node => node.dataset.magicStoneFocus === "stone-" + pack.stoneId);
    const oldCommands = h.api.read().commands, savedOwned = owner.state.snapshot();
    await h.click(h.$("save-game")); assert.ok(h.calls.writes > 0);
    await h.click(h.$("load-game")); await h.frame();
    const restored = h.bound(); assert.notEqual(restored, owner);
    assert.deepEqual(restored.state.snapshot(), savedOwned);
    assert.equal(h.api.read().flow.paused, true);
    assert.equal(oldCommands.menu({ kind: "change-magic-stone", playerId: pack.playerId, contentId: 0 }), false);
    stale.onclick(); assert.deepEqual(owner.state.snapshot(), savedOwned); assert.deepEqual(restored.state.snapshot(), savedOwned);
    await resume(h); await move(h, "left"); await move(h, "right"); await win(h, pack);
    assert.equal(learned(restored, pack), 100);
    await pauseMenu(h); assert.ok(h.$("party-menu").textContent.includes("已习得"));
    assert.equal(h.bound(), restored);
    const storage = new CheckpointStorage({ getItem: key => h.slots.get(key) ?? null,
      setItem() { throw new Error("Inspector cannot write"); } }, "framework", pack.packageId);
    assert.equal((await storage.load()).checkpoint.origin.kind, "framework-new-game");
    assert.equal(h.slots.size > 0, true);
  });
  await check("first-entry download failure leaves no owner and retry can publish the initialized entry", async () => {
    const pack = await packages(), h = await host(pack);
    h.failedUrls.add(`/content-releases/objects/${pack.refs.initialized.entry.contentHash}.json`);
    await h.click(h.$("start"));
    assert.equal(h.api.read().flow.currentSession, null); assert.equal(h.api.read().flow.busy, false);
    assert.equal(h.$("load-error").hidden, false);
    h.failedUrls.clear(); await start(h);
  });
  await check("media failure preserves the previous paused owner and retry replaces it only after preparation", async () => {
    const pack = await packages(), h = await host(pack), owner = await start(h);
    await pauseMenu(h); const before = owner.state.snapshot();
    // Evict only a presentation cache value to exercise the actual decoder.
    h.api.read().images.clear();
    h.failedImages.add(`sha256:${pack.pngHash}`);
    await h.click(h.$("restart"));
    assert.equal(h.api.read().flow.currentSession, owner); assert.equal(h.api.read().flow.paused, true);
    assert.deepEqual(owner.state.snapshot(), before);
    h.failedImages.clear(); await h.click(h.$("restart"));
    const fresh = h.bound(); assert.notEqual(fresh, owner);
  });
  await check("cancelled late media completion cannot publish, unlock or replace the next initialized attempt", async () => {
    const pack = await packages(), h = await host(pack), held = deferred();
    h.heldImages.set(`sha256:${pack.pngHash}`, held);
    const old = h.$("start").onclick();
    await until(() => h.calls.imageBytes.includes(pack.pngHash), "First attempt never prepared media");
    await h.click(h.$("cancel-entry-load"));
    assert.equal(h.api.read().flow.currentSession, null); assert.equal(h.api.read().flow.busy, false);
    h.heldImages.delete(`sha256:${pack.pngHash}`);
    const owner = await start(h); const before = owner.state.snapshot();
    held.resolve(); await old;
    h.healthy(); assert.equal(h.bound(), owner); assert.deepEqual(owner.state.snapshot(), before);
  });
  await check("cancelled late read rejection preserves the previous paused owner and its command binding", async () => {
    const pack = await packages(), h = await host(pack), owner = await start(h), held = deferred();
    await pauseMenu(h); const before = owner.state.snapshot(), commands = h.api.read().commands;
    h.api.read().contents.clear();
    const entryUrl = `/content-releases/objects/${pack.refs.initialized.entry.contentHash}.json`;
    h.heldUrls.set(entryUrl, held);
    const count = h.calls.json.filter(url => url === entryUrl).length;
    const old = h.$("restart").onclick();
    await until(() => h.calls.json.filter(url => url === entryUrl).length > count,
      "Replacement attempt never requested entry");
    await h.click(h.$("cancel-entry-load"));
    h.heldUrls.delete(entryUrl);
    held.reject(new Error("Controlled obsolete read failure")); await old;
    h.healthy(); assert.equal(h.bound(), owner); assert.deepEqual(owner.state.snapshot(), before);
    assert.equal(h.api.read().commands, commands); assert.equal(h.api.read().flow.paused, true);
    assert.equal(h.$("load-error").hidden, true);
  });
  await check("returning to title revokes stale menu commands without erasing the owned domain", async () => {
    const pack = await packages(), h = await host(pack), owner = await start(h);
    await move(h, "right"); await pauseMenu(h);
    const old = h.find("party-menu", node => node.dataset.magicStoneFocus === "stone-" + pack.stoneId);
    const commands = h.api.read().commands, before = owner.state.snapshot();
    await h.click(h.$("return-title"));
    old.onclick(); assert.equal(commands.menu({ kind: "change-magic-stone", playerId: pack.playerId, contentId: pack.stoneId }), false);
    assert.deepEqual(owner.state.snapshot(), before); assert.equal(h.api.read().flow.started, false);
    assert.equal(h.$("start").disabled, false);
  });
  await check("production activity port survives actual app start, media rollback, map retry, save/load and continuation", async () => {
    const pack = await conditionActivityPackages(), h = await host(pack), owner = await start(h), first = owner.field;
    const firstAudit = assertActivity(h, first), before = owner.state.snapshot();
    const initialItemCount = pack.plan.owned.items.find(item => item.id === 701)?.count ?? 0;
    assert.equal(before.items.find(item => item.id === 701).count, initialItemCount + 1);
    const initialCommands = h.api.read().commands, port = h.api.runtime.conditionLeaderActivity;
    h.api.read().images.clear(); h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h, "right");
    for (let i = 0; i < 30 && h.$("retry-map").hidden; i++) await h.frame();
    assert.equal(h.$("retry-map").hidden, false);
    assert.equal(owner.field, first); assert.equal(h.bound(), owner);
    assert.deepEqual(owner.state.snapshot(), before, "Failed candidate must not publish initializer inventory or condition state");
    const decoded = h.calls.nativeAtDecode.filter(row => row.field === first).at(-1);
    assert.ok(decoded); assert.equal(first.nativeActorStateFingerprint, decoded.fingerprint, "Failed private media must not half-publish current native actors");
    assert.equal(h.api.runtime.conditionLeaderActivity, port);
    h.failedImages.clear(); await h.click(h.$("retry-map"));
    for (let i = 0; i < 100 && owner.field === first; i++) await h.frame();
    await activityIdle(h, owner); const second = owner.field;
    assert.notEqual(second, first); assert.equal(second.content.map.identity.mapId, pack.worldMap.mapId);
    const secondAudit = assertActivity(h, second);
    const settled = owner.state.snapshot();
    assert.equal(settled.items.find(item => item.id === 701).count, initialItemCount + 2);
    await pauseMenu(h); await h.click(h.$("save-game"));
    const bytes = [...h.slots.entries()]; assert.ok(bytes.length > 0);
    await h.click(h.$("load-game")); const restored = h.bound();
    assert.notEqual(restored, owner); assert.deepEqual(restored.state.snapshot(), settled);
    assert.equal(restored.field.content.map.identity.mapId, pack.worldMap.mapId);
    assert.equal(h.api.runtime.conditionLeaderActivity, port);
    assert.equal(Reflect.get(restored.field, "options").conditionLeaderActivity, port);
    assert.equal(initialCommands.menuReady, false);
    const count = h.activityCalls.length; await resume(h); await move(h, "left"); await activityIdle(h, restored);
    const restoredAudit = assertActivity(h, restored.field);
    assert.ok(h.activityCalls.length > count, "Post-restore real movement must execute the retained original condition probe");
    assert.deepEqual(restored.state.snapshot(), settled, "Recovery/checkpoint continuation cannot replay map grants");
    report.lifecycle = { first: firstAudit, second: secondAudit, restored: restoredAudit,
      appPortCount: h.activityPorts.length, storageWrites: h.calls.writes,
      firstMapId: first.content.map.identity.mapId, secondMapId: second.content.map.identity.mapId,
      restoredMapId: restored.field.content.map.identity.mapId, sourceStoryReachability: false };
  });
  await check("source single-slot and probability-pool entry keep actual app ownership across media failure, cancellation, retry and restore", async () => {
    const pack = await packages("controlled-source-encounter-ui", true), h = await host(pack), owner = await start(h);
    const policy = core.WEB_SOURCE_ENCOUNTER_POLICY;
    assert.equal(h.api.runtime.sourceEncounterPolicy, policy);
    assert.equal(Reflect.get(owner.field, "options").sourceEncounter.policy, policy);
    await move(h, "right"); // Real map trigger; no source event is invoked by the harness.
    h.api.read().images.clear(); h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h, "right");
    for (let i = 0; i < 80 && h.$("retry-battle-load").hidden; i++) await h.frame();
    assert.equal(h.$("retry-battle-load").hidden, false);
    const request = owner.field.stop; assert.equal(request.kind, "encounter");
    assert.deepEqual([...request.sourceEncounter.command.slots], [pack.encounterId, 0, 0, 0]);
    assert.equal(request.sourceEncounter.command.effectId, 0);
    const captured = structuredClone(request), before = owner.state.snapshot(),
      player = owner.field.player, entity = player.native.entity, beforeNative = owner.field.nativeActorStateFingerprint;
    assert.deepEqual(entity.position, request.sourceEncounter.foot.player.position);
    assert.notDeepEqual(entity.position, owner.field.cameraSnapshot.dummy.position);
    assert.equal(owner.battle, null); assert.equal(owner.state.inBattle, false);
    h.failedImages.clear(); const held = deferred(), count = h.calls.imageBytes.length;
    h.heldImages.set(`sha256:${pack.pngHash}`, held);
    await h.click(h.$("retry-battle-load"));
    await until(() => h.calls.imageBytes.length > count, "Source battle retry never prepared media");
    const waitingTime = owner.field.time;
    for (let i = 0; i < 8; i++) await h.frame();
    assert.equal(owner.field.time, waitingTime, "Actual RAF frames must not advance a field owned by battle media preparation");
    assert.equal(owner.field.nativeActorStateFingerprint, beforeNative);
    assert.deepEqual(owner.state.snapshot(), before); assert.deepEqual(request, captured);
    await h.click(h.$("cancel-battle-load")); held.resolve();
    await until(() => h.calls.objectUrls.length === h.calls.revokedUrls.length,
      "Cancelled image work did not release its Blob URLs");
    await new Promise(setImmediate); h.healthy();
    assert.equal(h.bound(), owner); assert.equal(owner.field.stop, request);
    assert.deepEqual(request, captured); assert.deepEqual(owner.state.snapshot(), before);
    assert.equal(owner.field.nativeActorStateFingerprint, beforeNative);
    assert.equal(owner.state.inBattle, false); assert.equal(owner.battle, null);
    h.heldImages.clear(); h.api.read().images.clear();
    const successfulMedia = deferred(), retryCount = h.calls.imageBytes.length;
    h.heldImages.set(`sha256:${pack.pngHash}`, successfulMedia);
    await h.click(h.$("retry-battle-load"));
    await until(() => h.calls.imageBytes.length > retryCount || !h.api.read().battleLoadAttempt?.running,
      "Successful source retry never prepared media");
    assert.ok(h.calls.imageBytes.length > retryCount,
      "Source retry completed before media: " + (h.api.read().battleLoadAttempt?.error?.stack ?? "no pending error"));
    const retryTime = owner.field.time;
    for (let i = 0; i < 8; i++) await h.frame();
    assert.equal(owner.field.time, retryTime, "Successful media preparation must retain the same source-entry fence across RAF frames");
    assert.equal(owner.field.nativeActorStateFingerprint, beforeNative);
    assert.deepEqual(owner.state.snapshot(), before); assert.deepEqual(request, captured);
    successfulMedia.resolve(); h.heldImages.clear();
    await until(() => !!owner.battle || !h.api.read().battleLoadAttempt?.running,
      "Successful source retry did not finish its held media preparation");
    h.healthy(); assert.ok(owner.battle, h.api.read().battleLoadAttempt?.error?.stack ?? "Source retry did not publish");
    assert.equal(h.bound(), owner); assert.equal(owner.field.player, player); assert.equal(player.native.entity, entity);
    assert.deepEqual(entity.position, owner.field.cameraSnapshot.dummy.position);
    assert.deepEqual(request, captured); await win(h, pack);
    const settled = owner.state.snapshot(), oldCommands = h.api.read().commands;
    assert.equal(settled.completedBattles.length, 1);
    await pauseMenu(h); await h.click(h.$("save-game")); await h.click(h.$("load-game"));
    const restored = h.bound(); assert.notEqual(restored, owner); assert.deepEqual(restored.state.snapshot(), settled);
    assert.equal(h.api.runtime.sourceEncounterPolicy, policy);
    assert.equal(Reflect.get(restored.field, "options").sourceEncounter.policy, policy);
    assert.equal(oldCommands.menuReady, false);
    // Existing source Finish/Start returns to the retained leader's cell;
    // restore preserves that actual result rather than re-running entry sync.
    assert.equal(restored.field.player.x, pack.map.partyEntry.pointIns[0].x + 2);
    await resume(h); await move(h, "right"); await move(h, "right");
    for (let i = 0; i < 40 && !restored.battle; i++) await h.frame();
    const poolRequest = restored.field.stop; assert.equal(poolRequest.kind, "encounter");
    assert.deepEqual([...poolRequest.sourceEncounter.command.slots], Array(4).fill(pack.encounterId));
    assert.equal(poolRequest.sourceEncounter.command.effectId, 7);
    assert.equal(poolRequest.sourceEncounter.policy, policy);
    assert.equal(oldCommands.command(restored.battle, pack.playerId, pack.attackId, restored.battle.enemies[0].id, pack.attackCommandId), false);
    await win(h, pack); assert.equal(restored.state.snapshot().completedBattles.length, 2);
    report.sourceEncounterLifecycle = { policy, appRuntimeBound: true, mediaFailureRetainedOwner: true,
      cancelledWithoutSync: true, mediaWaitRafFrames: 16, mediaWaitFieldClockUnchanged: true,
      sourceSingleSlots: captured.sourceEncounter.command.slots,
      sourcePoolSlots: poolRequest.sourceEncounter.command.slots, effectId: poolRequest.sourceEncounter.command.effectId,
      storageWrites: h.calls.writes, completedBattles: restored.state.snapshot().completedBattles.length,
      originalGameExecuted: false, sourceStoryReachability: false, nativeRngParity: false };
  });
  await check("Boss entry and committed terminal result keep actual app ownership across media failure, cancellation, retry and restore", async () => {
    const pack = await packages("controlled-source-boss-ui"), h = await host(pack), owner = await start(h);
    const policy = core.WEB_SOURCE_BOSS_ENTRY;
    assert.equal(h.api.runtime.sourceBossEntry, policy);
    assert.equal(Reflect.get(owner.field, "options").sourceBossEntry, policy);
    await move(h, "right"); // Real map trigger; no source event is invoked by the harness.
    h.api.read().images.clear(); h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h, "right");
    for (let i = 0; i < 80 && h.$("retry-battle-load").hidden; i++) await h.frame();
    assert.equal(h.$("retry-battle-load").hidden, false);
    const request = owner.field.stop; assert.equal(request.kind, "encounter");
    assert.equal(request.sourceBoss.command.partyId,pack.encounterId);assert.deepEqual({...request.sourceBoss.command.focusCell},{x:pack.map.partyEntry.pointIns[0].x+3,y:pack.map.partyEntry.pointIns[0].y});
    const captured = structuredClone(request), before = owner.state.snapshot(),
      player = owner.field.player, entity = player.native.entity, beforeNative = owner.field.nativeActorStateFingerprint;
    const playerPosition=structuredClone(entity.position);
    assert.notDeepEqual(entity.position, owner.field.cameraSnapshot.dummy.position);
    assert.equal(owner.battle, null); assert.equal(owner.state.inBattle, false);
    h.failedImages.clear(); const held = deferred(), count = h.calls.imageBytes.length;
    h.heldImages.set(`sha256:${pack.pngHash}`, held);
    await h.click(h.$("retry-battle-load"));
    await until(() => h.calls.imageBytes.length > count, "Source battle retry never prepared media");
    const waitingTime = owner.field.time;
    for (let i = 0; i < 8; i++) await h.frame();
    assert.equal(owner.field.time, waitingTime, "Actual RAF frames must not advance a field owned by battle media preparation");
    assert.equal(owner.field.nativeActorStateFingerprint, beforeNative);
    assert.deepEqual(owner.state.snapshot(), before); assert.deepEqual(request, captured);
    await h.click(h.$("cancel-battle-load")); held.resolve();
    await until(() => h.calls.objectUrls.length === h.calls.revokedUrls.length,
      "Cancelled image work did not release its Blob URLs");
    await new Promise(setImmediate); h.healthy();
    assert.equal(h.bound(), owner); assert.equal(owner.field.stop, request);
    assert.deepEqual(request, captured); assert.deepEqual(owner.state.snapshot(), before);
    assert.equal(owner.field.nativeActorStateFingerprint, beforeNative);
    assert.equal(owner.state.inBattle, false); assert.equal(owner.battle, null);
    h.heldImages.clear(); h.api.read().images.clear();
    const successfulMedia = deferred(), retryCount = h.calls.imageBytes.length;
    h.heldImages.set(`sha256:${pack.pngHash}`, successfulMedia);
    await h.click(h.$("retry-battle-load"));
    await until(() => h.calls.imageBytes.length > retryCount || !h.api.read().battleLoadAttempt?.running,
      "Successful source retry never prepared media");
    assert.ok(h.calls.imageBytes.length > retryCount,
      "Source retry completed before media: " + (h.api.read().battleLoadAttempt?.error?.stack ?? "no pending error"));
    const retryTime = owner.field.time;
    for (let i = 0; i < 8; i++) await h.frame();
    assert.equal(owner.field.time, retryTime, "Successful media preparation must retain the same source-entry fence across RAF frames");
    assert.equal(owner.field.nativeActorStateFingerprint, beforeNative);
    assert.deepEqual(owner.state.snapshot(), before); assert.deepEqual(request, captured);
    successfulMedia.resolve(); h.heldImages.clear();
    await until(() => !!owner.battle || !h.api.read().battleLoadAttempt?.running,
      "Successful source retry did not finish its held media preparation");
    h.healthy(); assert.ok(owner.battle, h.api.read().battleLoadAttempt?.error?.stack ?? "Source retry did not publish");
    assert.equal(h.bound(), owner); assert.equal(owner.field.player, player); assert.equal(player.native.entity, entity);
    assert.deepEqual(entity.position,playerPosition,"Boss must not inherit ordinary camera-to-player synchronization");
    assert.deepEqual(request, captured); await win(h, pack);
    const settled = owner.state.snapshot(), oldCommands = h.api.read().commands;
    assert.equal(settled.completedBattles.length, 1);assert.equal(owner.prepareCommittedBattleResult().value,1);assert.equal(owner.battle,null);
    await pauseMenu(h); await h.click(h.$("save-game")); await h.click(h.$("load-game"));
    const restored = h.bound(); assert.notEqual(restored, owner); assert.deepEqual(restored.state.snapshot(), settled);
    assert.equal(h.api.runtime.sourceBossEntry, policy);
    assert.equal(Reflect.get(restored.field, "options").sourceBossEntry, policy);
    assert.equal(oldCommands.menuReady, false);
    // Existing source Finish/Start returns to the retained leader's cell;
    // restore preserves that actual result rather than re-running entry sync.
    assert.equal(restored.field.player.x, pack.map.partyEntry.pointIns[0].x + 2);
    await resume(h); await move(h, "right"); await move(h, "right");
    for (let i = 0; i < 40 && !restored.battle; i++) await h.frame();
    const poolRequest = restored.field.stop; assert.equal(poolRequest.kind, "encounter");
    assert.equal(poolRequest.sourceBoss.command.partyId,pack.encounterId);assert.equal(poolRequest.sourceBoss.policy,policy);
    assert.equal(oldCommands.command(restored.battle, pack.playerId, pack.attackId, restored.battle.enemies[0].id, pack.attackCommandId), false);
    await win(h, pack); assert.equal(restored.state.snapshot().completedBattles.length, 2);
    report.sourceBossLifecycle = { policy, appRuntimeBound: true, mediaFailureRetainedOwner: true,
      cancelledWithoutSync: true, mediaWaitRafFrames: 16, mediaWaitFieldClockUnchanged: true,
      focusCell:captured.sourceBoss.command.focusCell, terminalPolicy:h.api.runtime.sourceBattleResult,actualManualController:true,
      storageWrites: h.calls.writes, completedBattles: restored.state.snapshot().completedBattles.length,
      originalGameExecuted: false, sourceStoryReachability: false, nativeIntroParity: false };
  });
  await check("production camera-shake policy survives actual app frames, menu restore and prepared battle retry", async () => {
    const pack = await packages("controlled-camera-shake-ui", true, true), h = await host(pack), owner = await start(h),
      policy = h.api.runtime.cameraShake;
    assert.equal(policy.kind, "web-field-camera-shake-v1");
    assert.equal(Reflect.get(owner.field, "options").cameraShake, policy);
    const state = () => owner.field.storyRuntimeSnapshot.cameraShake;
    assert.equal(owner.field.storyRuntimeSnapshot.kind, "web-field-story-runtime-v2");
    for (let i = 0; i < 6; i++) await h.frame();
    assert.ok(state().samples > 0); const initialStream = structuredClone(state());
    const logical = structuredClone(owner.field.cameraSnapshot);
    const pixels = owner.field.cameraProjection({ aspect: 1.5, orthographicSize: 80, isClamp: true, effectOffset: { x: 0, y: 0 } });
    assert.deepEqual(pixels.cameraPosition, { x: pixels.position.x + owner.field.cameraShakeOffset.x,
      y: pixels.position.y + owner.field.cameraShakeOffset.y });
    assert.deepEqual(owner.field.cameraSnapshot, logical);
    await move(h, "right"); h.api.read().images.clear(); h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h, "right");
    for (let i = 0; i < 80 && h.$("retry-battle-load").hidden; i++) await h.frame();
    assert.equal(h.$("retry-battle-load").hidden, false); const pending = structuredClone(state()), owned = owner.state.snapshot();
    h.failedImages.clear(); const media = deferred(), count = h.calls.imageBytes.length;
    h.heldImages.set(`sha256:${pack.pngHash}`, media); await h.click(h.$("retry-battle-load"));
    await until(() => h.calls.imageBytes.length > count || !h.api.read().battleLoadAttempt?.running, "Shake entry did not request real media");
    assert.ok(h.calls.imageBytes.length > count, h.api.read().battleLoadAttempt?.error?.stack);
    for (let i = 0; i < 8; i++) await h.frame();
    assert.deepEqual(state(), pending); assert.deepEqual(owner.state.snapshot(), owned); assert.equal(owner.battle, null);
    media.resolve(); h.heldImages.clear();
    await until(() => !!owner.battle || !h.api.read().battleLoadAttempt?.running, "Shake battle retry did not publish");
    assert.ok(owner.battle, h.api.read().battleLoadAttempt?.error?.stack); assert.deepEqual(state(), pending);
    await win(h, pack); assert.equal(owner.state.snapshot().completedBattles.length, 1);
    assert.ok(state().active); assert.equal(state().active.command.reexecute, 30);
    await pauseMenu(h); const saved = owner.checkpoint(), savedState = structuredClone(state());
    for (let i = 0; i < 8; i++) await h.frame(); assert.deepEqual(state(), savedState);
    await h.click(h.$("save-game")); await h.click(h.$("load-game")); const restored = h.bound();
    assert.notEqual(restored, owner); assert.deepEqual(restored.checkpoint(), saved);
    assert.equal(h.api.runtime.cameraShake, policy); assert.equal(Reflect.get(restored.field, "options").cameraShake, policy);
    await resume(h); for (let i = 0; i < 4; i++) await h.frame();
    assert.ok(restored.field.storyRuntimeSnapshot.cameraShake.samples > savedState.samples);
    assert.deepEqual(state(), savedState, "Retired source owner cannot keep drawing through actual RAF frames");
    report.cameraShakeLifecycle = { policy, actualApp: true, nativeParity: false, initialSamples: initialStream.samples,
      pendingSamples: pending.samples, mediaWaitFrames: 8, savedSamples: savedState.samples,
      restoredSamples: restored.field.storyRuntimeSnapshot.cameraShake.samples, completedBattles: 1, storageWrites: h.calls.writes,
      renderer: "controlled-drawing-host; actual FieldCameraHost effect projection inspected", originalGameExecuted: false };
  });
  await check("production logical-effects port survives actual app initialization, rollback, map retry, save/load and source-shaped VM continuation", async () => {
    const pack = await logicalEffectsPackages(), h = await host(pack), owner = await start(h), first = owner.field;
    const port = h.api.runtime.fieldEffects, firstState = first.fieldEffectsSnapshot;
    assert.equal(port.policy, "web-logical-all-loop-field-effects-v1");
    assert.equal(Reflect.get(first, "options").fieldEffects, port);
    assert.equal(first.fieldEffectsDisplayPolicy, port.policy);
    assert.equal(firstState.instanceCount, 1); assert.equal(firstState.players[0].playing, true);
    const owned = owner.state.snapshot();
    h.api.read().images.clear(); h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h, "right");
    for (let i = 0; i < 30 && h.$("retry-map").hidden; i++) await h.frame();
    assert.equal(h.$("retry-map").hidden, false); assert.equal(owner.field, first);
    const failedFx = first.fieldEffectsSnapshot;
    assert.equal(failedFx.instanceCount, 1); assert.equal(failedFx.players[0].cameraId, 1);
    assert.deepEqual(owner.state.snapshot(), owned);
    h.failedImages.clear(); await h.click(h.$("retry-map"));
    for (let i = 0; i < 100 && owner.field === first; i++) await h.frame();
    await activityIdle(h, owner); const second = owner.field;
    assert.notEqual(second, first); assert.equal(second.fieldEffectsSnapshot.instanceCount, 2);
    assert.equal(second.fieldEffectsSnapshot.players[0].cameraId, 2);
    assert.equal(Reflect.get(second, "options").fieldEffectMap.logicalPolicy, port.policy);
    assert.equal(Reflect.get(owner.world, "owned").current.fieldEffects, port);
    await pauseMenu(h); const saved = owner.checkpoint(); await h.click(h.$("save-game"));
    await h.click(h.$("load-game")); const restored = h.bound();
    assert.notEqual(restored, owner); assert.deepEqual(restored.checkpoint(), saved);
    assert.equal(h.api.runtime.fieldEffects, port); assert.equal(Reflect.get(restored.world, "owned").current.fieldEffects, port);
    assert.equal(h.logicalEffectPorts.length, 1); assert.equal(h.logicalEffectPorts[0], port);
    await resume(h); assert.equal(restored.field.startEvent("fx-play"), true);
    for (let i = 0; i < 100 && restored.field.busy && !restored.field.stop; i++) await h.frame();
    assert.equal(restored.field.stop, null); assert.equal(restored.field.busy, false);
    const after = restored.field.fieldEffectsSnapshot;
    assert.equal(after.instanceCount, 2); assert.equal(after.players[0].cameraId, 2);
    assert.equal(after.players[0].playing, false); assert.equal(after.players[0].loopCount, 1);
    assert.equal(after.boards[0].activeSelf, false);
    report.logicalEffectsLifecycle = { policy: port.policy, nativeParity: false, display: "deferred",
      first: firstState, failed: failedFx, saved: saved.world.logicalEffects, restoredAfterVm: after,
      storageWrites: h.calls.writes, actualAppFactory: true, originalStoryReachability: false };
  });

  await check("explicit Birdview effect display deferral preserves actual app owner through rollback, source VM, map retry and storage", async () => {
    const pack = await logicalEffectsPackages("controlled-flat-birdview-effects",true), h = await host(pack), owner = await start(h), first = owner.field;
    const port = h.api.runtime.fieldEffects, firstState = first.fieldEffectsSnapshot;
    assert.equal(port.policy, "web-logical-all-loop-field-effects-v1");
    assert.equal(Reflect.get(first, "options").fieldEffects, port);
    assert.equal(first.fieldEffectsDisplayPolicy, port.policy);
    assert.equal(firstState.boards[0].definition.birdviewPuppet,true);
    assert.equal(firstState.boards[0].flatProjection.mapId,pack.map.mapId);
    assert.equal(first.content.developmentProfile.fieldEffectProjection,"web-source-field-effect-flat-v1");
    assert.equal(firstState.instanceCount, 1); assert.equal(firstState.players[0].playing, true);
    const owned = owner.state.snapshot();
    h.api.read().images.clear(); h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h, "right");
    for (let i = 0; i < 30 && h.$("retry-map").hidden; i++) await h.frame();
    assert.equal(h.$("retry-map").hidden, false); assert.equal(owner.field, first);
    const failedFx = first.fieldEffectsSnapshot;
    assert.equal(failedFx.instanceCount, 1); assert.equal(failedFx.players[0].cameraId, 1);
    assert.deepEqual(owner.state.snapshot(), owned);
    h.failedImages.clear(); await h.click(h.$("retry-map"));
    for (let i = 0; i < 100 && owner.field === first; i++) await h.frame();
    await activityIdle(h, owner); const second = owner.field;
    assert.equal(second.fieldEffectsSnapshot.boards[0].flatProjection.mapId,pack.worldMap.mapId);
    assert.notEqual(second, first); assert.equal(second.fieldEffectsSnapshot.instanceCount, 2);
    assert.equal(second.fieldEffectsSnapshot.players[0].cameraId, 2);
    assert.equal(Reflect.get(second, "options").fieldEffectMap.logicalPolicy, port.policy);
    assert.equal(Reflect.get(owner.world, "owned").current.fieldEffects, port);
    await pauseMenu(h); const saved = owner.checkpoint(); await h.click(h.$("save-game"));
    await h.click(h.$("load-game")); const restored = h.bound();
    assert.notEqual(restored, owner); assert.deepEqual(restored.checkpoint(), saved);
    assert.equal(h.api.runtime.fieldEffects, port); assert.equal(Reflect.get(restored.world, "owned").current.fieldEffects, port);
    assert.equal(h.logicalEffectPorts.length, 1); assert.equal(h.logicalEffectPorts[0], port);
    await resume(h); assert.equal(restored.field.startEvent("fx-play"), true);
    for (let i = 0; i < 100 && restored.field.busy && !restored.field.stop; i++) await h.frame();
    assert.equal(restored.field.stop, null); assert.equal(restored.field.busy, false);
    const after = restored.field.fieldEffectsSnapshot;
    assert.equal(after.instanceCount, 2); assert.equal(after.players[0].cameraId, 2);
    assert.equal(after.players[0].playing, false); assert.equal(after.players[0].loopCount, 1);
    assert.equal(after.boards[0].activeSelf, false);
    report.flatFieldEffectsLifecycle = { policy: port.policy, nativeParity: false, display: "deferred",
      first: firstState, failed: failedFx, saved: saved.world.logicalEffects, restoredAfterVm: after,
      storageWrites: h.calls.writes, actualAppFactory: true, originalStoryReachability: false };
  });

  await check("animated map entity uses actual app/native owner, interaction commands, pause/save/restore without Default replay",async()=>{
    const pack=await packages("controlled-animated-map-entities"),h=await host(pack),owner=await start(h),actor=owner.field.actors["500"],entity=actor.native.entity,animation=actor.animation;
    assert.equal(entity.character,false);assert.equal(actor.direction,null);assert.equal(actor.native.scope.kind,"map-animated");
    assert.equal(owner.field.interactionTarget()?.id,"500");const before=animation.snapshot();await h.frame(80);
    assert.equal(owner.field.actors["500"],actor);assert.equal(actor.native.entity,entity);assert.equal(actor.animation,entity.animation);assert.notDeepEqual(actor.animation.snapshot(),before);
    h.$("game").focus();h.key("Space");await h.frame();assert.equal(owner.field.currentShop.groupId,pack.groupId);
    await h.click(button(h,"shop-menu","离开商店"));await h.frame();await pauseMenu(h);
    const saved=owner.checkpoint(),playback=structuredClone(actor.animation.snapshot());await h.click(h.$("save-game"));await h.click(h.$("load-game"));
    const restored=h.bound();assert.notEqual(restored,owner);assert.deepEqual(restored.field.actors["500"].animation.snapshot(),playback);assert.deepEqual(restored.checkpoint(),saved);
    assert.equal(restored.field.actors["500"].direction,null);assert.equal(restored.field.actors["500"].native.entity.character,false);assert.equal(h.api.read().flow.paused,true);
    await resume(h);await h.frame(80);assert.equal(restored.field.stop,null);assert.equal(owner.field.actors["500"],actor);
    await move(h,"right");await move(h,"right");
    for(let tick=0;tick<60&&!restored.battle;tick++)await h.frame();assert.ok(restored.battle);
    const battleActor=restored.field.actors["500"],battleEntity=battleActor.native.entity,battlePlayback=structuredClone(battleActor.animation.snapshot());
    for(let tick=0;tick<5;tick++)await h.frame();assert.deepEqual(battleActor.animation.snapshot(),battlePlayback);
    await win(h,pack);assert.equal(restored.field.actors["500"],battleActor);assert.equal(battleActor.native.entity,battleEntity);
    assert.equal(restored.state.snapshot().completedBattles.length,1);assert.equal(restored.continueVictory(),false);
    report.animatedMapEntityLifecycle={actualApp:true,actualRepository:true,actualCommands:true,actorId:"500",policy:"web-field-animated-map-entities-v1",sourceDirection:15,savedPlayback:playback,storageWrites:h.calls.writes,battleAnimationPaused:true,onceBattleSettlement:true,sourceStoryReachability:false,nativeParity:false};
  });
  await check("production retained Magitek world policy shares map rollback, battle return and save/load owners", async () => {
    const pack=await worldTransportPackages(),h=await host(pack),owner=await start(h),first=owner.field;
    const policy=h.api.runtime.retainedWorldTransportation;
    assert.equal(policy,"web-retained-walking-magitek-world-entry-v1");
    assert.equal(Reflect.get(owner.world,"owned").current.retainedWorldTransportation,policy);
    assert.equal(first.startEvent("board"),true);await activityIdle(h,owner);
    assert.equal(first.transportationId,6);const parked=structuredClone(owner.state.snapshot().nativeState.ownedTransportations);
    const oldInner=first.partyActorCheckpoint.context.player.riderFieldAssetId;
    assert.notEqual(oldInner,38);h.api.read().images.clear();h.failedImages.add(`sha256:${pack.pngHash}`);
    await move(h,"right");for(let i=0;i<40&&h.$("retry-map").hidden;i++)await h.frame();
    assert.equal(h.$("retry-map").hidden,false);assert.equal(owner.field,first);
    assert.deepEqual(owner.state.snapshot().nativeState.ownedTransportations,parked);
    h.failedImages.clear();await h.click(h.$("retry-map"));
    for(let i=0;i<100&&owner.field===first;i++)await h.frame();await activityIdle(h,owner);
    assert.equal(owner.field.content.map.identity.mapId,pack.worldMap.mapId);assert.equal(owner.field.transportationId,6);
    assert.equal(owner.field.partyActorCheckpoint.context.player.fieldAssetId,38);
    assert.notEqual(owner.field.partyActorCheckpoint.context.player.riderFieldAssetId,38);
    assert.deepEqual(owner.state.snapshot().nativeState.ownedTransportations,parked);
    assert.equal(owner.field.startEvent("world-fight"),true);await win(h,pack);
    assert.equal(owner.state.snapshot().completedBattles.length,1);assert.equal(owner.field.transportationId,6);
    await pauseMenu(h);const saved=owner.checkpoint();await h.click(h.$("save-game"));await h.click(h.$("load-game"));
    const restored=h.bound();assert.notEqual(restored,owner);assert.deepEqual(restored.checkpoint(),saved);
    assert.equal(Reflect.get(restored.world,"owned").current.retainedWorldTransportation,policy);
    await resume(h);const worldField=restored.field;assert.equal(worldField.startEvent("world-return"),true);
    for(let i=0;i<100&&restored.field===worldField;i++)await h.frame();await activityIdle(h,restored);
    assert.equal(restored.field.content.map.identity.mapId,pack.map.mapId);assert.equal(restored.field.transportationId,6);
    assert.deepEqual(restored.state.snapshot().nativeState.ownedTransportations,parked);
    report.retainedWorldTransportationLifecycle={policy,actualApp:true,actualRepository:true,actualMapLoader:true,
      actualBattleHandoff:true,mediaFailureRetainedOwner:true,completedBattles:1,sourceStoryReachability:false,nativeParity:false,
      parkingRecords:parked,storageWrites:h.calls.writes};
  });
  await check("explicit flat NPC uses the actual app renderer, cross-layer shop interaction and the original saved actor layer",async()=>{
    const pack=await packages("controlled-flat-npc"),h=await host(pack),owner=await start(h),actor=owner.field.actors["500"],entity=actor.native.entity;
    assert.equal(owner.field.player.layer,0);assert.equal(actor.layer,1);assert.equal(entity.layer,10);
    h.$("game").focus();h.key("Space");await h.frame();assert.equal(owner.field.currentShop?.groupId,pack.groupId);
    await h.click(button(h,"shop-menu","离开商店"));await h.frame();assert.equal(owner.field.actors["500"],actor);assert.equal(actor.native.entity,entity);
    await pauseMenu(h);await h.click(h.$("save-game"));const before=owner.checkpoint(),oldCommands=h.api.read().commands;
    await h.click(h.$("load-game"));await h.frame();const restored=h.bound();assert.notEqual(restored,owner);assert.equal(restored.field.actors["500"].layer,1);
    assert.deepEqual(restored.field.actors["500"].native.entity.position,entity.position);assert.equal(restored.field.content.developmentProfile.npcProjection,"web-source-npc-flat-projection-v1");
    assert.equal(oldCommands.menu({kind:"set-preferences",preferences:{mode:"wait",speedIndex:1}}),false);
    await resume(h);h.$("game").focus();h.key("Space");await h.frame();assert.equal(restored.field.currentShop?.groupId,pack.groupId);
    await h.click(button(h,"shop-menu","离开商店"));await h.frame();assert.equal(restored.field.actors["500"].layer,1);
    report.flatNpcLifecycle={actualApp:true,actualRepository:true,actualCommands:true,actualRenderer:true,before:before.world.field.kind,sourceLayer:1,playerLayer:0,nativeParity:false};
  });
  await check("finite source operand playback uses actual app input/RAF, pauses with visibility and saves only after its one continuation",async()=>{
    const pack=await packages("controlled-finite-animation"),h=await host(pack),owner=await start(h);
    const count=()=>owner.state.snapshot().items.find(row=>row.id===pack.itemId)?.count??0,before=count();
    await move(h,"right");assert.ok(owner.field.finiteAnimationExecutions.length);assert.equal(owner.field.checkpointReady,false);
    const actor=owner.field.player,entity=actor.native.entity,paused={time:owner.field.time,animation:actor.animation.snapshot(),trace:owner.field.finiteAnimationExecutions};
    h.visibility(true);await h.frame(80);assert.deepEqual({time:owner.field.time,animation:actor.animation.snapshot(),trace:owner.field.finiteAnimationExecutions},paused);
    h.visibility(false);await resume(h);for(let i=0;i<600&&owner.field.busy&&!owner.field.stop;i++)await h.frame(40);
    assert.equal(owner.field.stop,null);assert.equal(owner.field.busy,false);assert.equal(owner.field.player,actor);assert.equal(actor.native.entity,entity);
    assert.deepEqual(owner.field.finiteAnimationExecutions.map(row=>row.phase),["started","replayed","replayed","completed"]);assert.equal(count(),before+1);
    assert.equal(h.api.read().renderer.game,owner.field);await pauseMenu(h);const saved=owner.checkpoint();
    await h.click(h.$("save-game"));await h.click(h.$("load-game"));const restored=h.bound();assert.notEqual(restored,owner);assert.deepEqual(restored.checkpoint(),saved);
    assert.deepEqual(restored.field.finiteAnimationExecutions,[]);await resume(h);await h.frame(80);
    assert.equal(restored.state.snapshot().items.find(row=>row.id===pack.itemId)?.count??0,before+1);
    assert.deepEqual(restored.field.finiteAnimationExecutions,[]);report.finiteAnimationLifecycle={actualApp:true,actualRepository:true,actualCommands:true,actualRAF:true,
      completedRepeatInstructions:1,actualPlayCalls:3,storageWrites:h.calls.writes,pausedByVisibility:true,sourceStoryReachability:false,nativeParity:false};
  });
  await check("explicit ordinary alternative uses actual app startup, source triggers, storage and native binding while strict diagnostics survive",async()=>{
    const pack=await packages("controlled-ordinary-presentation"),h=await host(pack),owner=await start(h),field=owner.field;
    assert.equal(field.player.native.entity.viewBinding.properties.kind,"framework-flat-field-view-projection-v1");
    assert.equal(pack.map.actorViewBlockers[0].reason,"Source actor water/group material provider is unresolved");
    assert.equal(pack.map.frameworkPresentation.view.policy,"framework-ordinary-field-flat-v1");
    const count=()=>h.bound().state.snapshot().nativeState.ownedMagicStones.length,before=count();await move(h,"right");
    for(let i=0;i<40&&field.busy;i++)await h.frame();assert.equal(count(),before+1);assert.equal(owner.field,field);
    assert.equal(h.api.read().renderer.game,field);await pauseMenu(h);const saved=owner.checkpoint();
    await h.click(h.$("save-game"));await h.click(h.$("load-game"));const restored=h.bound();assert.notEqual(restored,owner);
    assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.field.player.native.entity.viewBinding.properties.kind,"framework-flat-field-view-projection-v1");
    await resume(h);await h.frame();assert.equal(h.api.read().renderer.game,restored.field);assert.equal(count(),before+1);
    report.ordinaryPresentationLifecycle={actualApp:true,actualRepository:true,actualCommands:true,actualRAF:true,actualStorage:true,
      retainedStrictDiagnostics:pack.map.actorViewBlockers,policy:pack.map.frameworkPresentation.view.policy,storageWrites:h.calls.writes,
      sourceStoryReachability:false,nativeParity:false};
  });
  await check("shared battle control requests hide actual app controls, preserve host pause, then settle forced action and restore",async()=>{
    const pack=await packages("controlled-battle-event-controls"),h=await host(pack),owner=await start(h);
    assert.equal(h.api.runtime.battleEventControls,core.WEB_BATTLE_EVENT_CONTROLS);
    await move(h,"right");await move(h,"right");for(let i=0;i<80&&!owner.battle;i++)await h.frame();
    const battle=owner.battle;assert.ok(battle);const oldPause=h.$("menu-button").onclick;
    for(let i=0;i<20&&battle.uiControls.visible;i++)await h.frame();
    assert.equal(battle.uiControls.visible,false);assert.equal(h.$("menu-button").hidden,true);assert.equal(h.$("menu-button").disabled,true);
    assert.equal(h.api.read().commands.battleReady,false);oldPause();h.key("Escape");assert.equal(h.api.read().flow.paused,false);
    const time=battle.time;h.visibility(true);await h.frame(1000);assert.equal(battle.time,time);h.visibility(false);
    for(let i=0;i<120&&battle.phase==="active";i++)await h.frame();
    assert.equal(battle.uiControls.visible,true);assert.equal(battle.uiControls.pauseLocked,false);assert.equal(battle.playerControlMode,"manual");
    assert.equal(h.$("menu-button").hidden,false);assert.equal(battle.phase,"victory");await win(h,pack);
    const settled=owner.state.snapshot();assert.equal(settled.completedBattles.length,1);await pauseMenu(h);
    const saved=owner.checkpoint();await h.click(h.$("save-game"));await h.click(h.$("load-game"));
    assert.deepEqual(h.bound().checkpoint(),saved);await resume(h);assert.deepEqual(h.bound().state.snapshot(),settled);
    report.battleEventControls={actualApp:true,actualHeaderVisibility:true,actualFlowAndCommandQualification:true,
      preservedHostPause:true,onceForcedActionSettlement:true,actualStorage:true,sourceStoryReachability:false,browserRendering:false};
  });
  await check("source-shaped scripted action uses actual app queue, effect, VM continuation, owned settlement and Storage",async()=>{
    const pack=await packages("controlled-scripted-battle-action"),h=await host(pack),owner=await start(h);
    assert.equal(h.api.runtime.scriptedBattleActions,core.WEB_SCRIPTED_BATTLE_ACTIONS);
    await move(h,"right");await move(h,"right");
    for(let i=0;i<80&&!owner.battle;i++)await h.frame();assert.ok(owner.battle,h.api.read().battleLoadAttempt?.error?.stack);
    const battle=owner.battle,before=owner.state.snapshot(),hp=battle.enemies.map(enemy=>enemy.hp);
    assert.equal(battle.pendingActions.some(action=>action.kind==="event")||battle.action?.kind==="event",true);
    assert.deepEqual(battle.enemies.map(enemy=>enemy.hp),hp);let staged=false,effect=false;
    for(let i=0;i<120&&battle.phase==="active";i++){await h.frame();staged ||= battle.action?.kind==="event";
      effect ||= !!battle.action?.results.length;}
    assert.equal(staged,true);assert.equal(effect,true);assert.equal(battle.phase,"victory");assert.equal(battle.eventExecution.state.locals[0],1);
    assert.equal(owner.state.snapshot().completedBattles.length,before.completedBattles.length);
    await win(h,pack);const settled=owner.state.snapshot();assert.equal(settled.completedBattles.length,1);
    await pauseMenu(h);const saved=owner.checkpoint();await h.click(h.$("save-game"));await h.click(h.$("load-game"));const restored=h.bound();
    assert.notEqual(restored,owner);assert.deepEqual(restored.checkpoint(),saved);await resume(h);for(let i=0;i<8;i++)await h.frame();
    assert.deepEqual(restored.state.snapshot(),settled);assert.equal(restored.battle,null);
    report.scriptedBattleActionLifecycle={policy:h.api.runtime.scriptedBattleActions,actualQueue:true,actualEffect:true,actualVmContinuation:true,
      actualStorage:true,onceSettlement:true,storageWrites:h.calls.writes,sourceStoryReachability:false,nativeDynamicParity:false};
  });
  await check("non-damaging source ability preserves actual app action stages and no HP change, then settles and restores once",async()=>{
    const pack=await packages("controlled-non-damaging-battle-action"),h=await host(pack),owner=await start(h);
    await move(h,"right");await move(h,"right");for(let i=0;i<80&&!owner.battle;i++)await h.frame();
    assert.ok(owner.battle,h.api.read().battleLoadAttempt?.error?.stack);const battle=owner.battle,
      before=battle.combatants.map(unit=>({id:unit.id,hp:unit.hp,mp:unit.mp,conditions:[...unit.conditionIds]}));
    let resolved=false;for(let i=0;i<120&&!resolved;i++){await h.frame();const action=battle.action;
      resolved=action?.source.id===901&&action.resolved;if(resolved){assert.equal(action.results[0].effects[0].resource,"none");assert.equal(action.results[0].effects[0].calcResult.hitType,0);
        assert.deepEqual(battle.combatants.map(unit=>({id:unit.id,hp:unit.hp,mp:unit.mp,conditions:unit.conditionIds})),before);}}
    assert.equal(resolved,true);for(let i=0;i<160&&battle.phase==="active";i++)await h.frame();assert.equal(battle.phase,"victory");
    await win(h,pack);const settled=owner.state.snapshot();assert.equal(settled.completedBattles.length,1);await pauseMenu(h);const stable=owner.checkpoint();
    await h.click(h.$("save-game"));await h.click(h.$("load-game"));const restored=h.bound();assert.deepEqual(restored.checkpoint(),stable);await resume(h);for(let i=0;i<8;i++)await h.frame();assert.deepEqual(restored.state.snapshot(),settled);
    report.nonDamagingBattleAction={sourceEffectPolicy:battle.content.abilities[901].nonDamagingPresentation,actualApp:true,actualQueue:true,fixedHit:true,unchangedParameters:true,onceSettlement:true,actualStorage:true,sourceStoryReachability:false,nativeDynamicParity:false};
  });
  await check("battle effect global join and the actual Web app clock precede real action, once settlement and Storage",async()=>{
    const pack=await packages("controlled-battle-effect"),h=await host(pack),owner=await start(h),field=owner.field;
    assert.equal(h.api.runtime.battleEventEffects,"web-source-battle-effects-pulse-v1");
    await move(h,"right");await move(h,"right");for(let i=0;i<80&&!owner.battle;i++)await h.frame();
    assert.ok(owner.battle,h.api.read().battleLoadAttempt?.error?.stack);const battle=owner.battle,owned=owner.state.snapshot(),hp=battle.combatants.map(u=>({id:u.id,hp:u.hp,mp:u.mp}));
    let played=false;for(let i=0;i<20&&!battle.effectExecution.some(e=>e.action==="complete");i++){await h.frame();played ||= battle.effectPresentation.some(e=>e.phase==="playing");
      if(battle.effectPresentation.length)assert.deepEqual(battle.combatants.map(u=>({id:u.id,hp:u.hp,mp:u.mp})),hp);}
    assert.equal(played,true);assert.equal(battle.effectExecution.filter(e=>e.action==="request").length,1);
    for(let i=0;i<180&&battle.phase==="active";i++)await h.frame();assert.equal(battle.phase,"victory");assert.equal(battle.eventExecution.state.locals[0],1);
    assert.equal(owner.state.snapshot().completedBattles.length,owned.completedBattles.length);await win(h,pack);assert.equal(owner.field,field);
    const settled=owner.state.snapshot();assert.equal(settled.completedBattles.length,1);assert.throws(()=>battle.advance(10),/Retired/);
    await pauseMenu(h);const saved=owner.checkpoint();await h.click(h.$("save-game"));await h.click(h.$("load-game"));const restored=h.bound();
    assert.notEqual(restored,owner);assert.deepEqual(restored.checkpoint(),saved);await resume(h);for(let i=0;i<8;i++)await h.frame();assert.deepEqual(restored.state.snapshot(),settled);
    report.battleEffectLifecycle={policy:h.api.runtime.battleEventEffects,actualApp:true,actualBattleGame:true,globalJoin:true,onceRequest:true,actualStorage:true,onceSettlement:true,webPulseMilliseconds:300,sourceStoryReachability:false,nativeDynamicParity:false};
  });
  await check("source party selection uses actual app candidate editing, captured commands and the same native/owned Storage owner",async()=>{
    const pack=await packages('controlled-source-party-selection'),h=await host(pack),owner=await start(h),field=owner.field;
    const before=owner.state.snapshot(),actor=field.player,entity=actor.native.entity;
    await move(h,'right');await h.frame();assert.equal(h.api.read().flow.phase,'party-selection');
    const panel=h.$('source-party-selection'),getSelects=()=>walk(panel).filter(n=>n.tagName==='SELECT');
    assert.equal(panel.hidden,false);assert.equal(getSelects().length,8);assert.deepEqual(owner.state.snapshot(),before);
    const time=field.time;await h.frame(100);assert.equal(field.time,time);
    let selects=getSelects();selects[0].value=before.roster[1].id;selects[0].onchange();
    selects=getSelects();selects[4].value=before.roster[0].id;selects[4].onchange();
    const confirm=button(h,'source-party-selection','确认编队'),retained=confirm.onclick;
    await h.click(confirm);for(let i=0;i<30&&!owner.checkpointReady;i++)await h.frame(20);
    assert(owner.checkpointReady,field.stop?.message);assert.equal(field.player,actor);assert.equal(actor.native.entity,entity);
    assert.equal(owner.state.snapshot().party.slots[0][0].id,before.roster[1].id);
    assert.equal(owner.state.snapshot().party.slots[1][0].id,before.roster[0].id);
    await pauseMenu(h);await h.click(h.$('save-game'));const saved=owner.checkpoint();await h.click(h.$('load-game'));
    const restored=h.bound();assert.notEqual(restored,owner);assert.deepEqual(restored.checkpoint(),saved);
    retained();assert.deepEqual(restored.checkpoint(),saved);assert.deepEqual(owner.state.snapshot().roster,before.roster);
    report.sourcePartySelection={actualApp:true,actualCommands:true,actualNativeOwner:true,detachedUi:true,storageWrites:h.calls.writes,sourceStoryReachability:false,nativeParity:false};
  });
  await check("source ChangeView uses the actual app policy across delayed media failure/retry, world entry and Storage restore",async()=>{
    const pack=await conditionActivityPackages("controlled-field-view-change"),h=await host(pack),owner=await start(h),first=owner.field;
    assert.equal(h.api.runtime.viewChange,"web-flat-field-view-change-v2");assert.equal(first.currentView,null);
    assert.equal(first.viewChangeJournal.at(-1).requestedViewType,1);assert.equal(first.viewChangeJournal.at(-1).branchReturn,true);
    const before=owner.state.snapshot(),commands=h.api.read().commands;
    h.api.read().images.clear();h.failedImages.add(`sha256:${pack.pngHash}`);await move(h,"right");
    for(let i=0;i<30&&h.$("retry-map").hidden;i++)await h.frame();
    assert.equal(h.$("retry-map").hidden,false);assert.equal(owner.field,first);const decoded=h.calls.nativeAtDecode.filter(row=>row.field===first).at(-1);assert.ok(decoded);assert.deepEqual(first.cameraSnapshot,decoded.camera);assert.deepEqual(owner.state.snapshot(),before);
    h.failedImages.clear();const media=deferred(),imageCount=h.calls.imageBytes.length;h.heldImages.set(`sha256:${pack.pngHash}`,media);
    await h.click(h.$("retry-map"));await until(()=>h.calls.imageBytes.length>imageCount,"View map retry never prepared real media");
    const waiting=first.cameraSnapshot,waitingTime=first.time;for(let i=0;i<8;i++)await h.frame();
    assert.equal(owner.field,first);assert.equal(first.time,waitingTime);assert.deepEqual(first.cameraSnapshot,waiting);assert.deepEqual(owner.state.snapshot(),before);
    media.resolve();h.heldImages.clear();for(let i=0;i<100&&(owner.field===first||!owner.checkpointReady);i++)await h.frame();
    assert.notEqual(owner.field,first);assert(owner.checkpointReady,owner.field.stop?.message);assert.equal(owner.field.currentView.mapViewType,1);
    assert.equal(owner.field.partyActorCheckpoint.context.camera.mapViewType,1);assert.equal(owner.field.content.entry.viewPlan.mapViewType,0);
    const saved=owner.checkpoint();await pauseMenu(h);await h.click(h.$("save-game"));await h.click(h.$("load-game"));const restored=h.bound();
    assert.notEqual(restored,owner);assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.field.currentView.mapViewType,1);assert.equal(commands.menuReady,false);
    await resume(h);await move(h,"left");await activityIdle(h,restored);assert.equal(restored.field.currentView.mapViewType,1);
    report.viewChange={actualApp:true,actualStorage:true,appPolicy:h.api.runtime.viewChange,nonworldBranchReturn:true,worldCurrentView:1,immutableEntryView:0,mediaFailureRollback:true,storageWrites:h.calls.writes,nativeParity:false};
  });
  assert.equal(await runtimeDigest(root, compiled), runtimeBefore, "Runtime changed during actual app checks");
  assert.equal(sha(await readFile(new URL(import.meta.url))), sha(checkerBefore), "App checker changed during checks");
  report.runtimeRevalidated = true;
  report.result = "pass";
} catch (error) {
  report.result = "fail"; report.error = error.stack ?? String(error); throw error;
} finally {
  report.caseCount = report.cases.length;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, cases: report.caseCount, report: reportPath }));
}
