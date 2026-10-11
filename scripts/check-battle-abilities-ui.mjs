// Controlled DOM with a real BattleGame; browser rendering is a separate lane.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BattleView } from "../apps/game/battle-view.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : "dist";
const module = (path) => import(pathToFileURL(resolve(root, outDir, path + ".js")));
const { BattleGame } = await module("src/core/battle");
const { battleEntryRuntimeFixture } = await module("tests/fixtures/battle-entry-runtime");
class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.parentElement = null;
    this.textContent = ""; this.disabled = false; this.hidden = false;
    this.classList = { toggle() {} };
  }
  setAttribute() {}
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    node.remove();
    const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentElement = this;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  querySelectorAll(selector) {
    assert.equal(selector, "button:not(:disabled)");
    return this.children.flatMap((child) => [
      ...(child.tag === "button" && !child.disabled ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.onclick?.(); }
}
const elements = new Map(["battle-return", "battle-retry", "party", "battle-ui", "battle-result", "battle-result-title",
  "battle-result-text", "battle-levels", "battle-menu", "battle-action"].map((id) => [id, new Element("div")]));
globalThis.document = {
  getElementById: (id) => { assert.ok(elements.has(id)); return elements.get(id); },
  createElement: (tag) => new Element(tag), activeElement: null,
};
const { content, inventory } = battleEntryRuntimeFixture();
content.players[0].ownedAbilities.abilities.commandIds.push(999);
content.abilities[11].name = "<IC_WMGC>Heal";
const battle = new BattleGame(content, 71, undefined, inventory);
const canvas = new Element("canvas"); canvas.getContext = () => ({});
const view = new BattleView(canvas, content, new Map(), () => {}, () => {});
const menu = elements.get("battle-menu");
const allButtons = (node = menu) => node.children.flatMap((child) => [...(child.tag === "button" ? [child] : []), ...allButtons(child)]);
const button = (name) => {
  const found = allButtons().find((b) => b.textContent === name);
  assert.ok(found, `Missing button ${name}: ${allButtons().map((b) => b.textContent)}`);
  return found;
};
const checked = [];
view.sync(battle, false);
assert.equal(button("指令 999 · 暂不可用").disabled, true);
assert.match(button("指令 999 · 暂不可用").title, /Unknown owned command/);
assert.ok(allButtons().every((b) => !b.textContent.includes("COMMAND_26")), "source-unreleased Magitek hidden");
checked.push("unknown owned command stays visible disabled; source-unreleased command is hidden");
button("SYNTHETIC_COMMAND_7").click();
assert.equal(view.menuState, "ability");
assert.equal(button("Beam").disabled, false);
assert.equal(button("Unsupported").disabled, true);
assert.ok(allButtons().every((b) => !b.textContent.startsWith("Heal")));
checked.push("ability list uses current learned state and preserves unsupported effects");
battle.players[0].ownedAbilities.abilities.owned.find((a) => a.abilityId === 11).skillLevel = 100;
view.sync(battle, false);
assert.equal(button("Heal · MP 2").disabled, false);
assert.equal(content.abilities[11].name, "<IC_WMGC>Heal", "display projection preserves source name markup");
assert.match(view.rows.get(battle.players[0].id).hp.textContent, /MP 8 \/ 8/);
button("Heal · MP 2").click();
assert.equal(view.menuState, "ability-target");
battle.players[0].conditionIds = [306];
view.sync(battle, false);
assert.equal(view.commandId, null);
assert.equal(view.actionSource, null);
assert.equal(button("SYNTHETIC_COMMAND_7").disabled, true);
checked.push("new learning appears without rebuilding the battle; changed eligibility clears selected target");
battle.players[0].conditionIds = [];
delete content.abilities[10];
delete content.abilities[11];
view.sync(battle, false);
assert.equal(button("SYNTHETIC_COMMAND_7 · 暂不可用").disabled, true);
assert.match(button("SYNTHETIC_COMMAND_7 · 暂不可用").title, /effects/);
checked.push("missing executable ability data disables the source command without a missing-name crash");
content.qualificationContext.mode = "development-static";
battle.players[0].commands = [100]; battle.players[0].abilities = [12];
view.sync(battle, false);
assert.equal(allButtons().length, 1);
assert.equal(allButtons()[0].textContent, "Synthetic command");
assert.equal(allButtons()[0].disabled, true);
assert.equal(menu.children.some((n) => n.tag === "small"), false);
checked.push("explicit development mode retains legacy menu without a permanent development notice");
const report = { lane: "controlled-dom-real-battle-owned-qualification", scenarios: checked.length, checked,
  browserRendering: false, originalGameExecution: false };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/battle-abilities-ui-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
