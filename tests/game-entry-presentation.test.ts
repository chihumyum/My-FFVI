import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { GameFlow } from "../src/core/game-flow.js";
import { GameContentRepository } from "../src/core/game-content.js";
import type { GameContentRefs } from "../src/core/game-content-refs.js";

// Actual app initialization and core imports, with controlled DOM/media only.
// This checks title presentation and entry admission, not rendering or story.
const app = await readFile(resolve("apps/game/app.js"), "utf8");
const html = await readFile(resolve("apps/game/index.html"), "utf8");
const { createFieldMessageWindowReadiness } = await import(pathToFileURL(resolve("apps/game/source-message-view.js")).href);
const syntax = ts.createSourceFile("app.js", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const imports = syntax.statements.filter(ts.isImportDeclaration);
const core: Record<string, unknown> = {};
for (const item of imports) {
  assert.ok(ts.isStringLiteral(item.moduleSpecifier));
  const name = item.moduleSpecifier.text;
  if (!name.startsWith("/runtime/core/")) continue;
  const loaded: Record<string, unknown> = await import(new URL("../src/core/" + name.slice("/runtime/core/".length), import.meta.url).href);
  assert.ok(item.importClause?.namedBindings && ts.isNamedImports(item.importClause.namedBindings));
  for (const binding of item.importClause.namedBindings.elements)
    core[binding.name.text] = loaded[(binding.propertyName ?? binding.name).text];
}
let body = app;
for (const item of [...imports].reverse()) body = body.slice(0, item.getStart(syntax)) + body.slice(item.end);
assert.equal((body.match(/init\(\)\.catch\(failure\);/g) ?? []).length, 1);
body = body.replace("init().catch(failure);", "globalThis.ready = init().catch(failure);") + `
globalThis.inspect = () => ({ flow, contents, failed, contentProfile });`;

function refs(kind: "initialized" | "source" | "development"): GameContentRefs {
  const reference = (name: string) => ({ url: `/content-packages/controlled/${name}.json`, contentHash: "a".repeat(64) });
  const entry = { entry: reference("entry"), battle: reference("battle") };
  return { kind: "game-content-refs-v2", profile: kind === "initialized" ? "framework" : "source",
    world: reference("world"), source: kind === "source" ? entry : null,
    development: kind === "development" ? entry : null, initialized: kind === "initialized" ? entry : null };
}

class Element {
  textContent = "";
  value = "";
  title = "";
  hidden: boolean;
  disabled: boolean;
  inert = false;
  style = {};
  attributes = new Map<string, string>();
  onclick?: () => unknown;
  constructor(attributes: string) {
    this.hidden = /\bhidden\b/.test(attributes); this.disabled = /\bdisabled\b/.test(attributes);
    for (const match of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) this.attributes.set(match[1]!, match[2]!);
  }
  setAttribute(name: string, value: unknown) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener() {}
  focus() {}
  getContext() { throw new Error("A title must not draw a field"); }
}

async function title(search: string, references?: GameContentRefs) {
  const nodes = new Map<string, Element>();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi))
    nodes.set(match[3]!, new Element(match[2]!));
  const node = (id: string): Element => { const result = nodes.get(id); assert.ok(result, id); return result; };
  const document = { hidden: false, getElementById: node, addEventListener() {} };
  // These exact nodes were parsed from the actual HTML and mounted in this
  // controlled document. The real readiness factory still queries its current
  // Field owner; no title fixture supplies a ready result or a fake authority.
  for (const [id, element] of nodes) Object.assign(element, { id, ownerDocument: document, isConnected: true });
  const reads: string[] = [], writes: string[] = [], slotsRead: string[] = [];
  class PassiveView { reset() {} }
  class Audio {
    reset() {} async unlock() {} initialize() {}
    async prepare() { throw new Error("No title fixture declares playable media"); }
  }
  const context = vm.createContext({ ...core, createFieldMessageWindowReadiness, structuredClone, URLSearchParams, console,
    location: { search }, document,
    window: { addEventListener() {} }, performance: { now: () => 0 }, requestAnimationFrame() {},
    localStorage: { getItem(key: string) { slotsRead.push(key); return null; },
      setItem(key: string) { writes.push(key); throw new Error("Title must not save state"); } },
    AudioOutput: Audio, ChoiceView: PassiveView,
    InventoryView: PassiveView, EquipmentView: PassiveView, PartyView: PassiveView,
    ShopView: PassiveView, BattleView: PassiveView, Renderer: PassiveView,
    audioProjection() { throw new Error("No game owner exists at title"); },
    async fetch(url: string) {
      reads.push(url);
      if (references && url === `/content-packages/${new URLSearchParams(search).get("package") ?? "systems-initialized"}.json`)
        return { ok: true, json: async () => structuredClone(references) };
      return { ok: false, status: 404 };
    },
  });
  vm.runInContext(body, context, { filename: "actual-game-app.js" });
  await context.ready;
  const inspect = context.inspect as () => { flow: GameFlow; contents: GameContentRepository; failed: boolean; contentProfile: string };
  assert.ok(inspect().flow instanceof GameFlow); assert.ok(inspect().contents instanceof GameContentRepository);
  return { node, reads, writes, slotsRead, inspect };
}

test("unlisted initialized source batches get generic movement, dialogue and persistence guidance", async () => {
  for (const id of ["source-cluster-a", "unlisted-region-b"]) {
    const host = await title(`?package=${id}`, refs("initialized"));
    assert.equal(host.inspect().failed, false);
    assert.equal(host.inspect().flow.currentSession, null);
    assert.deepEqual(host.reads, [`/content-packages/${id}.json`]);
    assert.equal(host.node("welcome-title").textContent, "来源地点 · 内容批次");
    assert.equal(host.node("start").textContent, "进入来源地点");
    assert.match(host.node("systems-playground-help").textContent, /方向键.*交谈.*保存/);
    assert.match(host.node("welcome-scope").textContent, /完整剧情和部分玩法仍在迁移/);
    const instructions = ["welcome-title", "welcome-description", "welcome-scope", "systems-playground-help"]
      .map(key => host.node(key).textContent).join(" ");
    assert.doesNotMatch(instructions, /训练|起点上方|右侧是商店|领取魔石/);
    assert.equal(host.node("source-start").hidden, true);
    assert.equal(host.node("source-start").disabled, true);
    assert.ok(host.slotsRead.every(key => key === `ffvi-reweb.framework.package.${id}.checkpoint.v1`));
    assert.deepEqual(host.writes, []);
  }
});

test("neutral title wording grants no initializer or archive fallback when actual entry preparation fails", async () => {
  const host = await title("?package=unlisted-region", refs("initialized"));
  await host.node("start").onclick!();
  assert.equal(host.inspect().flow.currentSession, null);
  assert.equal(host.inspect().failed, false, "Missing content remains a retryable entry failure");
  assert.equal(host.inspect().flow.busy, false);
  assert.equal(host.node("entry-loading-message").textContent, "正在准备来源地点…");
  assert.deepEqual(host.reads, ["/content-packages/unlisted-region.json", "/content-releases/packages/unlisted-region.json"]);
  assert.deepEqual(host.writes, []);
});

test("only the two explicit systems packages keep training-specific title guidance", async () => {
  for (const search of ["", "?package=systems-initialized"]) {
    const host = await title(search, refs("initialized"));
    assert.equal(host.node("start").textContent, "开始系统演示");
    assert.equal(host.node("welcome-title").textContent, "游戏系统演示");
    assert.match(host.node("systems-playground-help").textContent, /起点上方是战斗训练.*右侧是商店.*领取魔石/);
    assert.equal(host.node("systems-playground-link").getAttribute("aria-current"), "page");
  }
  const legacy = await title("?package=systems-playground", refs("development"));
  assert.equal(legacy.inspect().failed, false);
  assert.equal(legacy.node("welcome-title").textContent, "游戏系统演示");
  assert.match(legacy.node("welcome-description").textContent, /第一战/);
  assert.equal(legacy.node("start").textContent, "开始系统演示");
});

test("existing travel and Figaro descriptions and the four static links remain available", async () => {
  const travel = await title("?package=world-travel", refs("initialized"));
  assert.equal(travel.node("welcome-title").textContent, "世界旅行演示");
  assert.equal(travel.node("start").textContent, "开始世界旅行");
  const figaro = await title("?package=figaro-initialized", refs("initialized"));
  assert.equal(figaro.node("welcome-title").textContent, "费加罗 · 来源内容批次");
  assert.match(figaro.node("systems-playground-help").textContent, /两张地图保留原出口/);
  for (const [id, href] of [
    ["systems-playground-link", "/game/?package=systems-initialized"],
    ["world-travel-link", "/game/?package=world-travel"],
    ["source-content-link", "/game/?package=figaro-initialized"],
    ["source-sample-link", "/game/?profile=source"],
  ] as const) {
    assert.equal(figaro.node(id).getAttribute("href"), href);
    assert.equal(figaro.node(id).hidden, false);
  }
});

test("source and development capabilities, explicit preview and profile mismatch retain their entry gates", async () => {
  const source = await title("?package=source-cluster", refs("source"));
  assert.equal(source.node("start").hidden, true); assert.equal(source.node("source-start").hidden, false);
  const development = await title("?package=development-cluster", refs("development"));
  assert.equal(development.node("start").textContent, "进入开发片段");
  assert.equal(development.node("source-start").hidden, true);
  const preview = await title("?map=23&entrance=1");
  assert.equal(preview.node("welcome-title").textContent, "地图开发预览");
  assert.deepEqual(preview.reads, []);
  const wrong = await title("?package=unlisted-region&profile=source", refs("initialized"));
  assert.equal(wrong.inspect().failed, true); assert.equal(wrong.inspect().flow.currentSession, null);
  assert.match(wrong.node("load-error").textContent, /profile mismatch/);
  assert.deepEqual(wrong.writes, []);
});
