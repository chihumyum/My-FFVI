import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InventoryView } from "../apps/game/inventory-view.js";
import { EquipmentView } from "../apps/game/equipment-view.js";

// Actual menu views and actual GameSession through a controlled DOM adapter.
// This is neither browser acceptance nor original-game particle verification.
const rootPath = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), index = args.indexOf("--compiled-dir");
const compiled = resolve(rootPath, index < 0 ? "dist" : args[index + 1]);
const { fieldMenuReadyFixture } = await import(pathToFileURL(resolve(compiled, "tests/fixtures/field-menu-ready.js")));

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.dataset = {}; this.className = "";
    this.classList = { add: (value) => { this.className = [...new Set([...this.className.split(" "), value])].filter(Boolean).join(" "); } };
    this.hidden = false; this.disabled = false; this.value = "";
  }
  get childNodes() { return this.children; }
  set textContent(value) { this.value = String(value); this.replaceChildren(); }
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(""); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(...children) {
    for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
  }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    if (selector === "button:not(:disabled)") return this.tagName === "BUTTON" && !this.disabled;
    if (selector === "[data-equipment-focus]") return this.dataset.equipmentFocus !== undefined;
    const focus = /^\[data-equipment-focus="(.+)"\]$/.exec(selector);
    if (focus) return this.dataset.equipmentFocus === focus[1];
    throw new Error("Unsupported controlled selector " + selector);
  }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.onclick?.(); } }
}
globalThis.document = { createElement: (tag) => new Element(tag), activeElement: null };
const checks = [];
function views(game) {
  const inventoryRoot = new Element("div"), equipmentRoot = new Element("div");
  for (const id of ["owned-party", "owned-gil", "owned-key-items", "owned-items", "item-targets", "item-status"]) {
    const node = new Element("div"); node.id = id; inventoryRoot.append(node);
  }
  const inventory = new InventoryView(inventoryRoot, game.battleCatalog.gameState.items, () => {});
  const equipment = new EquipmentView(equipmentRoot);
  const render = () => { inventory.render(game); equipment.render(game); };
  const equipmentButton = (id) => {
    const value = equipmentRoot.querySelector(`[data-equipment-focus="${id}"]`);
    assert.ok(value, "Missing equipment button " + id); return value;
  };
  render();
  return { inventoryRoot, equipmentRoot, inventory, equipment, render, equipmentButton,
    items: () => inventoryRoot.querySelector("#owned-items").children,
    targets: () => inventoryRoot.querySelector("#item-targets").querySelectorAll("button:not(:disabled)") };
}

{
  const { game, control } = fieldMenuReadyFixture(), view = views(game);
  const effects = structuredClone(control.state), commits = control.commits;
  assert.equal(game.checkpointReady, false); assert.equal(game.menuReady, true);
  assert.equal(view.items()[0].disabled, false);
  view.items()[0].click(); view.targets()[0].click();
  assert.equal(game.players.find((p) => p.id === "a").hp, 110);
  assert.deepEqual(game.state.snapshot().items, [{ id: 10, count: 1 }]);
  view.equipmentButton("slot-5").click(); view.equipmentButton("choice-5").click();
  view.equipmentButton("apply").click();
  assert.equal(game.state.snapshot().roster.find((p) => p.id === "a").equipment[4], 5);
  assert.deepEqual(control.state, effects); assert.equal(control.commits, commits);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  checks.push("real item and equipment buttons commit shared owned state while the FX codec still forbids saving");
}
{
  const { game } = fieldMenuReadyFixture(), view = views(game);
  view.items()[0].click(); const oldTarget = view.targets()[0];
  view.equipmentButton("slot-5").click(); view.equipmentButton("choice-5").click();
  const oldApply = view.equipmentButton("apply"), before = game.state.snapshot();
  assert.equal(game.field.move("down"), true); view.render();
  assert.equal(view.items()[0].disabled, true);
  assert.equal(view.equipmentRoot.querySelector(".equipment-choices").children.length, 0);
  assert.match(view.equipmentRoot.textContent, /请回到地图空闲时/);
  oldTarget.onclick(); oldApply.onclick();
  assert.deepEqual(game.state.snapshot(), before);
  checks.push("readiness-only changes invalidate rendered choices and stale item/equipment callbacks cannot transact during movement");
  game.advance(240); view.render();
  assert.equal(view.items()[0].disabled, false);
  assert.equal(view.equipmentButton("choice-5").disabled, false);
  assert.equal(game.checkpointReady, false);
  checks.push("both menus recover from movement without changing owned state or dropping the FX save gate");
}
{
  const { game, world, target, control } = fieldMenuReadyFixture(), view = views(game);
  game.field.previewMap(2, 1); assert.equal(game.world.commit(game.world.prepare(world, target)), true); game.advance(20);
  assert.equal(game.field.fieldEffectsSnapshot, null); assert.equal(control.state.instanceCount, 1);
  view.render(); assert.equal(view.items()[0].disabled, false);
  view.items()[0].click(); view.targets()[0].click();
  view.equipmentButton("slot-5").click(); view.equipmentButton("choice-5").click(); view.equipmentButton("apply").click();
  assert.equal(game.players.find((p) => p.id === "a").hp, 110);
  assert.equal(game.state.snapshot().roster.find((p) => p.id === "a").equipment[4], 5);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  checks.push("the same menus work after map replacement when only shared effect history prevents checkpointing");
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = { lane: "controlled-field-menu-DOM-with-real-GameSession", cases: checks.length, checks,
  sources: Object.fromEntries(await Promise.all(["apps/game/inventory-view.js", "apps/game/equipment-view.js",
    "src/core/field.ts", "src/core/game-session.ts", "tests/fixtures/field-menu-ready.ts"].map(async (path) => [path, sha(await readFile(resolve(rootPath, path)))]))),
  browserVerified: false, nativeVerified: false };
await mkdir(resolve(rootPath, "build/reports"), { recursive: true });
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(resolve(rootPath, "build/reports/field-menu-ready-ui-check.json"), bytes);
console.log(JSON.stringify({ cases: checks.length, reportSha256: sha(bytes), browserVerified: false }, null, 2));
