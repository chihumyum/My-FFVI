import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BattleView, battleMenuWaiting } from "../apps/game/battle-view.js";

// Controlled DOM + real BattleGame. Browser layout and original-game timing
// parity are separate lanes; no fake battle or native UI enum drives the view.
const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = resolve(root, "build/reports/battle-menu-timing-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(reportPath, { force: true });
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--runtime"),
  "Usage: node scripts/check-battle-menu-timing.mjs [--runtime build/test-output]");
const runtime = resolve(root, args[1] ?? "dist");
const { BattleGame } = await import(pathToFileURL(resolve(runtime, "src/core/battle.js")));
const { fixture } = await import(pathToFileURL(resolve(runtime, "tests/fixtures/battle-content.js")));
const { itemFixture } = await import(pathToFileURL(resolve(runtime, "tests/fixtures/items.js")));
const checked = [];

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node === before) return node;
    node.remove();
    const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0);
    this.children.splice(index, 0, node);
    node.parentElement = this;
    return node;
  }
  remove() {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  querySelectorAll(selector) {
    assert.equal(selector, "button:not(:disabled)");
    return this.children.flatMap((child) => [
      ...(child.tagName === "BUTTON" && !child.disabled ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.onclick?.(); }
}

function setup(mode = "wait") {
  const elements = new Map([
    "battle-return", "battle-retry", "party", "battle-ui", "battle-result",
    "battle-result-title", "battle-result-text", "battle-levels", "battle-menu", "battle-action",
  ].map((id) => [id, new Element("div")]));
  globalThis.document = {
    getElementById: (id) => { assert.ok(elements.has(id)); return elements.get(id); },
    createElement: (tag) => new Element(tag),
    activeElement: null,
  };
  const content = fixture();
  content.commands[100].name = "Skills";
  content.commands[200] = { id: 200, kind: "item", name: "Items", abilityIds: [], referencedAbility: null, forbiddenConditionIds: [] };
  content.commands[210] = { id: 210, kind: "ability", name: "Attack", abilityIds: [10], referencedAbility: null, forbiddenConditionIds: [] };
  content.players.forEach((player) => player.commands.push(200, 210));
  content.enemies.forEach((enemy) => { enemy.hp = 9999; });
  content.conditions.rules.definitions.push({ id: 310, type: 10, overlapped: false, eraseGroupId: 3 });
  content.conditions.behaviors.push({ id: 310, kind: "poison", name: "Poison", untilType: 3, hpDivisor: 16 });
  content.players[0].conditionIds = [310];
  const inventory = { definitions: { 10: itemFixture() }, stacks: [{ id: 10, count: 1 }], limit: 99 };
  const battle = new BattleGame(content, 71, undefined, inventory);
  battle.setPreferences({ mode });
  battle.players[0].hp = 40;
  battle.players[1].hp = 40;
  const canvas = new Element("canvas");
  canvas.getContext = () => ({});
  const view = new BattleView(canvas, content, new Map(), () => {}, () => {});
  view.sync(battle, false);
  const buttons = () => elements.get("battle-menu").querySelectorAll("button:not(:disabled)");
  const button = (text) => {
    const matches = buttons().filter((node) => node.textContent === text);
    assert.equal(matches.length, 1, `Expected one enabled button '${text}', got ${buttons().map((b) => b.textContent)}`);
    return matches[0];
  };
  const click = (text) => button(text).click();
  return { content, inventory, battle, view, elements, canvas, buttons, button, click };
}

function inspect(battle) {
  return structuredClone({ units: battle.combatants, action: battle.action,
    pending: battle.pendingActions, clock: battle.conditionClockState("a"), time: battle.time });
}

for (const state of ["none", "command", "ability", "ability-target", "item", "item-target", "special-input", "slot"]) {
  const waiting = battleMenuWaiting(state);
  assert.deepEqual(waiting, {
    uiWaiting: ["ability", "ability-target", "item", "item-target"].includes(state),
    forceWaiting: ["special-input", "slot"].includes(state),
  });
}
for (const state of [0, 1, 4, 9, null, "equipment", "unknown"])
  assert.throws(() => battleMenuWaiting(state), /Unknown Web battle menu state/);
checked.push("eight explicit Web states; native enum/unknown inputs rejected");

for (const mode of ["wait", "active"]) {
  const { battle, view, click } = setup(mode);
  assert.equal(view.menuState, "command");
  const initial = battle.enemies[0].atb;
  battle.advance(100);
  assert.ok(battle.enemies[0].atb > initial, "a ready actor/command page does not wait");
  click("Skills");
  assert.equal(view.menuState, "ability");
  const before = inspect(battle);
  battle.advance(100);
  if (mode === "wait") {
    assert.deepEqual(battle.combatants, before.units);
    assert.deepEqual(battle.conditionClockState("a"), before.clock);
  } else {
    assert.ok(battle.enemies[0].atb > before.units.find((unit) => unit.id === "e1").atb);
    assert.ok(battle.conditionClockState("a")[0].elapsedSeconds > before.clock[0].elapsedSeconds);
  }
  click("Beam");
  assert.equal(view.menuState, "ability-target");
  assert.equal(battle.timingState.gate.progress, mode === "active");
  assert.equal(view.back(), true);
  assert.equal(view.menuState, "ability");
  assert.equal(view.back(), true);
  assert.equal(view.menuState, "command");
  assert.equal(battle.timingState.gate.progress, true);
  assert.equal(view.back(), false);
  checked.push(`${mode}: command, ability, target and two-level back`);
}

{
  const { battle, view, click } = setup();
  click("Items");
  assert.equal(view.menuState, "item");
  assert.equal(battle.timingState.gate.progress, false);
  click("Synthetic potion × 1");
  assert.equal(view.menuState, "item-target");
  click("Synthetic ally");
  assert.equal(battle.inventory[0].available, 0);
  assert.equal(view.selected, "b");
  assert.equal(view.menuState, "command");
  assert.equal(battle.timingState.gate.progress, true);
  battle.advance(410);
  assert.equal(battle.inventory[0].count, 0);
  assert.equal(battle.players[0].hp, 80);
  checked.push("item list/target waits; confirmation reserves once and immediately releases waiting");
}

{
  const { battle, view, click, button } = setup();
  click("Attack");
  assert.equal(view.menuState, "ability-target");
  const stale = button("Enemy 1");
  assert.equal(view.back(), true);
  assert.equal(view.menuState, "command", "single-ability command has no artificial ability list");
  stale.click();
  assert.equal(battle.pendingActions.length, 0);
  checked.push("single-ability target returns to command; detached target handler cannot submit");
}

{
  const { battle, view, click, button } = setup();
  click("Skills"); click("Beam");
  const stale = button("Enemy 1");
  view.sync(battle, true);
  const before = inspect(battle);
  stale.click();
  assert.equal(view.back(), false);
  battle.advance(10000);
  assert.deepEqual(inspect(battle), before);
  view.sync(battle, false);
  assert.equal(view.menuState, "ability-target");
  assert.equal(battle.timingState.input.paused, false);
  assert.equal(battle.timingState.gate.progress, false);
  click("Enemy 1");
  assert.equal(view.menuState, "command");
  checked.push("pause blocks input/time and restores the selected target submenu without catch-up");
}

{
  const { battle, view, click } = setup();
  click("Skills");
  const before = battle.enemies[0].atb;
  battle.setPreferences({ mode: "active" });
  battle.advance(100);
  assert.ok(battle.enemies[0].atb > before);
  battle.setPreferences({ mode: "wait" });
  const now = battle.enemies[0].atb;
  battle.advance(100);
  assert.equal(battle.enemies[0].atb, now);
  assert.equal(view.menuState, "ability");
  checked.push("runtime mode switch takes effect inside a submenu without rebuilding source content");
}

for (const special of ["special-input", "slot"]) {
  const { battle, view, click, buttons } = setup("active");
  click("Skills");
  assert.equal(view.setSpecialInput(special), true);
  assert.equal(view.menuState, special);
  assert.equal(buttons().length, 0);
  const before = inspect(battle);
  battle.advance(200);
  assert.deepEqual(battle.combatants, before.units);
  assert.deepEqual(battle.conditionClockState("a"), before.clock);
  assert.equal(view.back(), false, "only the explicit provider releases special input");
  assert.equal(view.setSpecialInput(null), true);
  assert.equal(view.menuState, "ability");
  assert.equal(battle.timingState.gate.progress, true);
  checked.push(`${special}: explicit force-wait lifecycle also stops active mode`);
}

{
  const { battle, view, click } = setup();
  click("Skills");
  battle.players[0].hp = 0;
  battle.players[0].conditionIds = [305];
  view.sync(battle, false);
  assert.equal(view.selected, "b");
  assert.equal(view.menuState, "command");
  assert.equal(battle.timingState.input.uiWaiting, false);
  checked.push("selected actor death clears waiting and selects another ready actor");
}

{
  const { battle, view, click } = setup();
  click("Items"); click("Synthetic potion × 1");
  assert.equal(battle.commandItem("b", 10, { kind: "single", id: "b" }, 200), true);
  view.sync(battle, false);
  assert.equal(view.menuState, "command");
  assert.equal(battle.timingState.input.uiWaiting, false);
  checked.push("another reservation of the last item invalidates the target submenu and releases waiting");
}

{
  const { battle, view, click } = setup();
  click("Attack"); click("Enemy 1");
  click("Skills");
  battle.advance(500);
  assert.equal(battle.action?.resolved, true);
  assert.ok(battle.enemies[0].hp < 9999);
  assert.equal(battle.conditionClockState("a")[0].elapsedSeconds, 0);
  assert.equal(view.menuState, "ability");
  checked.push("WAIT submenu stops progress while an already queued zero-charge action still executes");
}

{
  const { battle, view, click, content, inventory } = setup();
  click("Skills");
  battle.setClockInput({ ...battle.timingState.input, helpPaused: true, progressEnabled: false });
  view.sync(battle, false);
  assert.equal(battle.timingState.input.helpPaused, true);
  assert.equal(battle.timingState.input.progressEnabled, false);
  view.hide();
  assert.equal(battle.timingState.input.uiWaiting, false);
  assert.equal(view.menuState, "none");
  assert.equal(document.getElementById("battle-menu").attributes.get("data-menu-state"), "none");
  const retry = new BattleGame(content, 71, undefined, inventory);
  retry.setPreferences({ mode: "wait" });
  view.sync(retry, false);
  assert.equal(view.menuState, "command");
  assert.equal(retry.timingState.input.forceWaiting, false);
  assert.equal(retry.timingState.gate.progress, true);
  checked.push("host gates survive render; hide/retry releases stale menu state");
}

// Bind the recovered policy to the same original PE and completed exports used
// by v17. The hashes establish evidence identity, not dynamic equivalence.
const native = JSON.parse((await promisify(execFile)(process.env.PYTHON ?? "python3", [
  "-c", String.raw`
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "tools/native"))
from inspect_pe import PEImage
sha = lambda value: hashlib.sha256(value).hexdigest()
data = (root / "build/runtime/game/GameAssembly.dll").read_bytes()
expected = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc"
assert sha(data) == expected
pe = PEImage(data)
symbols = (root / "build/native/il2cpp/script.json").read_bytes()
header = (root / "build/native/il2cpp/il2cpp_ghidra.h").read_bytes()
methods = []
for batch, rvas in {
 "v17-battle-timing": [0x465560, 0x676ee0],
 "v17-battle-clock-selectors": [0x46d0e0, 0x46d1d0, 0x8e40d0, 0x8e40f0],
}.items():
 base = root / "build/native" / batch
 raw = (base / "complete.json").read_bytes()
 receipt = json.loads(raw)
 assert receipt["status"] == "complete" and receipt["semanticsVerified"] is False
 assert receipt["nativeSha256"] == expected
 assert receipt["symbolsSha256"] == sha(symbols) and receipt["headerSha256"] == sha(header)
 for rva in rvas:
  method, = [m for m in receipt["methods"] if int(m["rva"],16) == rva]
  _, _, raw_bytes = pe.read(rva, int(method["nextSymbolRva"],16)-rva)
  assert sha(raw_bytes) == method["nativeRangeSha256"]
  assert sha((base / (format(rva,"x")+".c")).read_bytes()) == method["decompiledSha256"]
  methods.append({"batch":batch,"receiptSha256":sha(raw),**method})
print(json.dumps({"nativeSha256":expected,"methods":methods,"semanticsVerified":False}))
`, root], { maxBuffer: 1024 * 1024 })).stdout);
const sourceFiles = ["apps/game/battle-view.js", "src/core/battle.ts", "src/core/battle-preferences.ts", "src/core/battle-timing.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) =>
  [file, createHash("sha256").update(await readFile(resolve(root, file))).digest("hex")])));
const runtimeFiles = ["src/core/battle.js", "src/core/battle-preferences.js", "src/core/battle-timing.js", "src/core/condition-poison.js"];
const runtimeHashes = Object.fromEntries(await Promise.all(runtimeFiles.map(async (file) =>
  [file, createHash("sha256").update(await readFile(resolve(runtime, file))).digest("hex")])));
const report = { lane: "controlled-battle-menu-timing", scenarios: checked.length,
  checked, native, sourceHashes, runtimeHashes, originalOrBrowserExecution: false,
  limitations: ["special-input/slot hooks do not enable unsupported ability providers", "speed slots are not exposed", "original runtime and browser acceptance are separate"] };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ scenarios: checked.length, nativeMethods: native.methods.length, checked }, null, 2));
