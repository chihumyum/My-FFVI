import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ShopView } from "../apps/game/shop-view.js";

// This tests the actual view module through a controlled DOM adapter. It is
// deliberately separate from the browser and the real GameState source check.
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
  }
  set textContent(text) {
    this.value = text;
    this.children = [];
  }
  get textContent() {
    return (
      this.value + this.children.map((child) => child.textContent).join("")
    );
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parentElement) {
      const children = this.parentElement.children;
      children.splice(children.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  contains(node) {
    return this === node || this.children.some((child) => child.contains(node));
  }
  querySelectorAll(selector) {
    assert.equal(selector, "button:not(:disabled)");
    return this.children.flatMap((child) => [
      ...(child.tagName === "BUTTON" && !child.disabled ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus() {
    document.activeElement = this;
  }
  click() {
    if (!this.disabled) {
      this.focus();
      this.onclick?.();
    }
  }
}
globalThis.document = {
  createElement: (tag) => new Element(tag),
  activeElement: null,
};
const root = new Element("div"),
  checks = [];
const walk = (node) => [node, ...node.children.flatMap(walk)];
const button = (key) => {
  const found = walk(root).find(
    (node) =>
      node.tagName === "BUTTON" && node.getAttribute("data-shop-focus") === key,
  );
  assert.ok(found, "Missing shop button " + key);
  return found;
};
let gil = 100,
  count = 0,
  equipped = 2,
  quoteFailure = false,
  tradeFailure = false,
  tradeCalls = 0,
  closeCalls = 0;
const session = {
  field: { currentShop: { id: 1, groupId: 2, entityId: "shopkeeper" } },
  shopOptions() {
    if (quoteFailure) throw new Error("Unavailable source catalog");
    return {
      name: "Controlled shop",
      gil,
      buy: [
        {
          productId: 10,
          contentId: 2,
          name: "<IC_ITEM>药剂",
          unitPrice: 10,
          count,
          equipped: 0,
          maxCount: Math.min(4 - count, Math.floor(gil / 10)),
        },
      ],
      sell: [
        {
          contentId: 90,
          name: "<IC_SRD>长剑",
          unitPrice: 30,
          count: 2,
          equipped,
          maxCount: 2 - equipped,
        },
        ...(count > 0
          ? [
              {
                contentId: 2,
                name: "药剂",
                unitPrice: 5,
                count,
                equipped: 0,
                maxCount: count,
              },
            ]
          : []),
      ],
    };
  },
  tradeShop(request) {
    tradeCalls++;
    if (tradeFailure) throw new Error("Inventory changed; select again");
    assert.equal(request.kind, "buy");
    assert.equal(request.productId, 10);
    assert.ok(
      request.count > 0 &&
        request.count <= Math.min(4 - count, Math.floor(gil / 10)),
    );
    gil -= request.count * 10;
    count += request.count;
    return { count: request.count };
  },
  closeShop(expectedVisitId) {
    if (this.field.currentShop?.id !== expectedVisitId) return false;
    closeCalls++;
    this.field.currentShop = null;
    return true;
  },
};
const view = new ShopView(root, () => view.render(session));
view.render(session);
assert.equal(root.hidden, false);
assert.equal(document.activeElement, button("tab:buy"));
assert.equal(root.textContent.includes("<IC_ITEM>"), false);
assert.ok(root.textContent.includes("100 Gil"));
checks.push("opening uses owner quotes and strips known icon labels");

button("buy:10").click();
assert.equal(document.activeElement, button("确认购买"));
button("+").click();
assert.equal(document.activeElement, button("+"));
assert.ok(root.textContent.includes("数量 2 / 4"));
const duplicate = button("确认购买");
duplicate.click();
duplicate.click();
duplicate.onclick();
assert.equal(tradeCalls, 1);
assert.equal(gil, 80);
assert.equal(count, 2);
assert.ok(root.textContent.includes("购入 药剂 × 2"));
checks.push(
  "quantity/focus persist and a detached or duplicate confirmation cannot trade twice",
);

button("buy:10").click();
const obsolete = button("确认购买");
gil = 0;
view.render(session);
obsolete.onclick();
assert.equal(tradeCalls, 1);
assert.equal(view.selection, null);
assert.equal(button("buy:10").disabled, true);
checks.push(
  "changed money/stock invalidates a pending quantity and stale confirmation",
);

button("tab:sell").click();
assert.equal(button("sell:90").disabled, true);
assert.ok(root.textContent.includes("装备中 2"));
equipped = 1;
view.render(session);
assert.equal(button("sell:90").disabled, false);
checks.push(
  "sell availability follows the shared equipped count, including unavailable rows",
);

const previousLeave = button("离开商店"),
  previousTab = button("tab:sell");
view.back();
assert.equal(root.hidden, true);
assert.equal(closeCalls, 1);
session.field.currentShop = { id: 2, groupId: 2, entityId: "shopkeeper" };
gil = 100;
view.render(session);
previousLeave.onclick();
previousTab.onclick();
assert.equal(closeCalls, 1);
assert.equal(view.mode, "buy");
assert.equal(session.field.currentShop.id, 2);
checks.push(
  "reopening resets view state and detached prior-visit buttons cannot mutate the new visit",
);

button("buy:10").click();
const pausedConfirm = button("确认购买");
view.render(session, false);
assert.equal(root.hidden, true);
assert.equal(view.back(), false);
pausedConfirm.onclick();
assert.equal(tradeCalls, 1);
assert.equal(root.querySelectorAll("button:not(:disabled)").length, 0);
view.render(session, true);
assert.equal(root.hidden, false);
assert.equal(document.activeElement, button("确认购买"));
checks.push(
  "pause or focus-loss disables every trade and reopening restores keyboard focus",
);

tradeFailure = true;
const rejected = button("确认购买");
rejected.click();
rejected.onclick();
assert.equal(tradeCalls, 2);
assert.equal(gil, 100);
assert.equal(count, 2);
assert.ok(root.textContent.includes("Inventory changed"));
assert.equal(button("确认购买").disabled, false);
tradeFailure = false;
checks.push(
  "failed owner transactions show failure without changing money or retaining a live old button",
);

quoteFailure = true;
view.render(session);
assert.equal(root.querySelectorAll("button:not(:disabled)").length, 1);
assert.ok(root.textContent.includes("Unavailable source catalog"));
quoteFailure = false;
view.render(session);
assert.ok(root.textContent.includes("Controlled shop"));
assert.equal(button("确认购买").disabled, false);
checks.push(
  "unavailable source quote permits only exit and can recover without stale rendered data",
);

const changedField = button("确认购买"),
  beforeCalls = tradeCalls;
session.field = { currentShop: { id: 2, groupId: 2, entityId: "other" } };
changedField.onclick();
assert.equal(tradeCalls, beforeCalls);
view.render(session);
assert.equal(view.selection, null);
assert.equal(view.mode, "buy");
checks.push(
  "a field replacement rejects old callbacks even when numeric visit IDs match",
);

const taskRoot = fileURLToPath(new URL("..", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  lane: "controlled-shop-DOM",
  checks,
  cases: checks.length,
  sourceSha256: sha(await readFile(taskRoot + "apps/game/shop-view.js")),
  browserVerified: false,
  nativeVerified: false,
};
await mkdir(taskRoot + "build/reports", { recursive: true });
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(taskRoot + "build/reports/shop-menu-check.json", bytes);
console.log(
  JSON.stringify(
    { cases: checks.length, reportSha256: sha(bytes), browserVerified: false },
    null,
    2,
  ),
);
