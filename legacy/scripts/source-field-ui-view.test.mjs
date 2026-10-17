import test from "node:test";
import assert from "node:assert/strict";
import { SourceFieldUiView } from "../apps/game/source-field-ui-view.js";
function dom() {
  const document = { createElement: () => new Element() };
  class Element {
    constructor() { this.parentNode = null; this.children = []; this.dataset = {}; this.ownerDocument = document; this.textContent = ""; this.hidden = false; this.attributes = new Map(); }
    get isConnected() { return this === root || this.parentNode?.isConnected === true; }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    setAttribute(key, value) { this.attributes.set(key, value); }
  }
  const root = new Element(); return { root, document };
}
test("actual DOM consumer renders only supplied current projection, replaces text safely, and never clocks or changes location", () => {
  const { root } = dom(), view = new SourceFieldUiView(root), state = { mainGameState: 11, view: "navi", title: { area: "Region", title: "Town" } },
    field = Object.freeze({ get sourceFieldUiSnapshot() { return structuredClone(state); } });
  const before = JSON.stringify(state); assert.deepEqual(view.render(field), { source: true, event: false, view: "navi" });
  assert.equal(view.title.hidden, false); assert.equal(view.area.textContent, "Region"); assert.equal(view.location.textContent, "Town");
  assert.equal(root.dataset.sourceMainGameState, "11"); assert.equal(JSON.stringify(state), before);
  view.render(field, true); assert.equal(view.title.hidden, true);
  view.render(null); assert.equal(view.area.textContent, ""); assert.equal(view.title.hidden, true); assert.equal(root.dataset.sourceMapView, "unknown");
  view.title.parentNode = null; assert.throws(() => view.render(field), /detached or replaced/);
});
test("an unattached or substituted DOM host cannot be used as a Field UI surface", () => {
  assert.throws(() => new SourceFieldUiView({ isConnected: false }), /attached/);
  const { root } = dom(), view = new SourceFieldUiView(root); view.area.parentNode = null;
  assert.throws(() => view.render(null), /detached or replaced/);
});
