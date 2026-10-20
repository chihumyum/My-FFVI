import assert from "node:assert/strict";
import test from "node:test";
import { TouchKeyState, isTextEntry } from "./touch-controls.js";

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
