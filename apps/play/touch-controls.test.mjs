import assert from "node:assert/strict";
import test from "node:test";
import {
  TouchKeyState,
  isTextEntry,
  touchActionLabels,
  distinguishTouchActions,
} from "./touch-controls.js";

test("two fingers retain independent directions and the same key releases only after both fingers", () => {
  const events = [];
  const keys = new TouchKeyState(
    (key) => events.push(["down", key]),
    (key) => events.push(["up", key]),
  );
  keys.press(1, "ArrowRight");
  keys.press(2, "ArrowUp");
  keys.press(3, "ArrowRight");
  keys.release(1);
  assert.deepEqual(events, [
    ["down", "ArrowRight"],
    ["down", "ArrowUp"],
  ]);
  keys.release(2);
  keys.release(3);
  assert.deepEqual(events.slice(2), [
    ["up", "ArrowUp"],
    ["up", "ArrowRight"],
  ]);
  assert.equal(keys.pointers.size, 0);
});

test("interruption releases every unique held input exactly once", () => {
  const released = [];
  const keys = new TouchKeyState(
    () => {},
    (key) => released.push(key),
  );
  keys.press(1, "ArrowDown");
  keys.press(2, "Enter");
  keys.press(3, "ArrowDown");
  keys.clear();
  keys.release(1);
  keys.clear();
  assert.deepEqual(released, ["ArrowDown", "Enter"]);
  assert.equal(keys.pointers.size, 0);
});

test("native account fields and contenteditable targets are excluded from game keys", () => {
  assert.equal(isTextEntry(null), false);
  let selector;
  assert.equal(
    isTextEntry({
      closest(value) {
        selector = value;
        return {};
      },
    }),
    true,
  );
  assert.match(selector, /input, textarea, select/);
  assert.match(selector, /contenteditable/);
});

test("repeated item actions keep their owning item labels while orphan popup buttons stay readable", () => {
  const action = () => ({ tag: "button", children: [], attributes: {}, textContent: "使用" });
  const a = action(),
    b = action(),
    popup = { ...action(), textContent: "确定" };
  const root = {
    tag: "aside",
    children: [
      ["恢复药 ×5", a],
      ["以太药 ×2", b],
    ].map(([name, node]) => ({
      tag: "fieldset",
      children: [{ tag: "legend", textContent: name, children: [] }, node],
    })),
  };
  const first = {},
    second = {},
    third = {};
  const labels = touchActionLabels({
    windows: [root],
    views: new Map([
      [a, { container: first }],
      [b, { container: second }],
      [popup, { container: third }],
    ]),
    label: (node) => node.textContent,
  });
  assert.equal(labels.get(first), "恢复药 ×5 · 使用");
  assert.equal(labels.get(second), "以太药 ×2 · 使用");
  assert.equal(labels.get(third), "确定");
});

test("same-named battle targets remain distinguishable and activate their original target", () => {
  const picked = [];
  const actions = distinguishTouchActions([
    { id: 1, label: "Silver Lobo", activate: () => picked.push(1) },
    { id: 2, label: "Silver Lobo", activate: () => picked.push(2) },
    { id: 3, label: "取消", activate: () => picked.push(3) },
  ]);
  assert.deepEqual(
    actions.map((action) => action.label),
    ["Silver Lobo（1）", "Silver Lobo（2）", "取消"],
  );
  actions[1].activate();
  assert.deepEqual(picked, [2]);
});

test("select controls retain their current setting value in the readable label", () => {
  const select = { tag: "select", attributes: { "aria-label": "ATB 模式" }, children: [] };
  const container = {};
  const labels = touchActionLabels({
    windows: [select],
    views: new Map([[select, { container }]]),
    label: () => "ATB 模式：等待 ▾",
  });
  assert.equal(labels.get(container), "ATB 模式：等待 ▾");
});
