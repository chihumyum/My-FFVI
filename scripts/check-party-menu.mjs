import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BattleView } from "../apps/game/battle-view.js";

// Controlled DOM adapter for this presentational module; no native/browser proof.
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
      toggle: (name, force) =>
        force ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  append(...nodes) {
    for (const node of nodes) this.insertBefore(node, null);
  }
  insertBefore(node, before) {
    if (node === before) return node;
    node.remove();
    const index =
      before === null ? this.children.length : this.children.indexOf(before);
    if (index < 0) throw new Error("Reference node is not a child");
    this.children.splice(index, 0, node);
    node.parentElement = this;
    return node;
  }
  remove() {
    if (this.parentElement) {
      const parent = this.parentElement;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  contains(node) {
    return node === this || this.children.some((c) => c.contains(node));
  }
  querySelectorAll(selector) {
    assert.equal(selector, "button:not(:disabled)");
    return this.children.flatMap((c) => [
      ...(c.tagName === "BUTTON" && !c.disabled ? [c] : []),
      ...c.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus() {
    document.activeElement = this;
  }
  click() {
    if (!this.disabled) this.onclick?.();
  }
}
const elements = new Map();
for (const id of [
  "battle-return",
  "battle-retry",
  "party",
  "battle-ui",
  "battle-result",
  "battle-result-title",
  "battle-result-text",
  "battle-levels",
  "battle-menu",
  "battle-action",
])
  elements.set(id, new Element("div"));
globalThis.document = {
  getElementById: (id) => {
    assert.ok(elements.has(id));
    return elements.get(id);
  },
  createElement: (tag) => new Element(tag),
  activeElement: null,
};
const player = (id, name) => ({
  id,
  name,
  hp: 100,
  maxHp: 100,
  atb: 100,
  conditionIds: [],
  commands: [],
  abilities: [],
});
const a = player("a", "A"),
  b = player("b", "B"),
  c = player("c", "C"),
  d = player("d", "D");
const canvas = new Element("canvas");
canvas.getContext = () => ({});
const content = { players: [a, b, c], commands: {}, abilities: {} };
const view = new BattleView(
  canvas,
  content,
  new Map(),
  () => {},
  () => {},
);
const battle = {
  content,
  players: [a, b, c],
  ready: [a, b, c],
  phase: "active",
  events: [],
  reward: null,
  conditions: { name: (id) => "condition " + id },
  inventory: [],
  items: {},
};
const rows = () =>
  elements
    .get("party")
    .children.map(
      (node) =>
        [...view.rows].find(([, row]) => row.button === node)?.[0] ?? "stale",
    );
view.sync(battle, false);
const removedA = view.rows.get("a").button,
  removedC = view.rows.get("c").button;
view.selected = "c";
view.actionSource = { kind: "ability", id: 99 };
view.commandId = 10;
battle.players = [b];
battle.ready = [b];
view.sync(battle, false);
assert.deepEqual(
  rows(),
  ["b"],
  "single-member battle must remove previous party rows",
);
assert.deepEqual([...view.rows.keys()], ["b"]);
assert.equal(removedA.disabled, true);
assert.equal(removedC.disabled, true);
assert.equal(removedA.parentElement, null);
assert.equal(removedC.parentElement, null);
assert.equal(view.selected, "b");
assert.equal(view.actionSource, null);
assert.equal(view.commandId, null);
assert.equal(view.rows.get("b").button.classList.contains("selected"), true);
removedC.click();
assert.equal(view.selected, "b", "detached rows cannot select nonparticipants");

battle.players = [c, a];
battle.ready = [c, a];
view.sync(battle, false);
assert.deepEqual(rows(), ["c", "a"]);
const currentC = view.rows.get("c").button,
  currentA = view.rows.get("a").button;
battle.players = [a, c];
battle.ready = [a, c];
view.sync(battle, false);
assert.deepEqual(
  rows(),
  ["a", "c"],
  "reordering a party must reorder actual DOM nodes",
);
assert.equal(view.rows.get("c").button, currentC);
assert.equal(view.rows.get("a").button, currentA);

view.selected = "c";
view.actionSource = { kind: "ability", id: 99 };
view.commandId = 10;
battle.ready = [a];
c.hp = 0;
view.sync(battle, false);
assert.equal(view.selected, "a");
assert.equal(view.actionSource, null);
assert.equal(view.commandId, null);
assert.equal(currentC.disabled, true);
assert.equal(currentC.classList.contains("selected"), false);
assert.equal(currentC.classList.contains("fallen"), true);
assert.equal(currentA.classList.contains("selected"), true);
battle.ready = [];
view.sync(battle, false);
assert.equal(view.selected, null);
assert.ok(elements.get("party").children.every((node) => node.disabled));

const next = { ...battle, players: [d], ready: [d] };
view.commandId = 30;
view.actionSource = { kind: "ability", id: 99 };
view.sync(next, false);
assert.deepEqual(
  rows(),
  ["d"],
  "participant need not occur in constructor content.players",
);
assert.equal(view.rows.get("d").name.textContent, "D");
assert.equal(view.selected, "d");
assert.equal(view.actionSource, null);
assert.equal(view.commandId, null);
next.phase = "victory";
view.sync(next, false);
assert.equal(view.selected, null);
assert.equal(view.rows.get("d").button.disabled, true);
assert.equal(elements.get("battle-ui").hidden, true);
const report = {
  lane: "controlled-party-menu-dom",
  controlledDomScenarios: 6,
  checked: [
    "single-member removal",
    "party reorder",
    "readiness cleanup",
    "empty ready set",
    "new battle/new participant",
    "result-phase cleanup",
  ],
  sourceSha256: createHash("sha256")
    .update(
      await readFile(new URL("../apps/game/battle-view.js", import.meta.url)),
    )
    .digest("hex"),
  originalOrBrowserExecution: false,
};
await mkdir(new URL("../build/reports/", import.meta.url), { recursive: true });
await writeFile(
  new URL(
    "../build/reports/systems-v16-party-menu-check.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
