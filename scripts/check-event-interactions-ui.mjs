import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ChoiceView } from "../apps/game/choice-view.js";
import { GameSession } from "../dist/src/core/game-session.js";
import { GameFlow } from "../dist/src/core/game-flow.js";
import { contentDigest, verifyContent } from "../dist/src/core/content-integrity.js";
import { eventInteractionField, interactionScript } from "../dist/tests/fixtures/event-interactions.js";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const read = async (path) => verifyContent(JSON.parse(await readFile(rootPath + path, "utf8")));
const sourceField = await read("/build/game/narshe.json"), catalog = await read("/build/game/opening-playable.json");
const field = eventInteractionField(sourceField);
const { contentHash: discarded, ...payload } = field;
field.contentHash = await contentDigest(payload);
await verifyContent(field);

// Controlled DOM, real ChoiceView, GameFlow and GameSession. Rendered-browser
// evidence is collected separately using the optional local harness below.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = new Map(); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  focus() { document.activeElement = this; this.onfocus?.(); }
  click() { if (!this.disabled) this.onclick?.(); }
}
globalThis.document = { createElement: (tag) => new Element(tag), activeElement: null, hidden: false };
const root = new Element("section"), flow = new GameFlow(new GameSession(field, catalog)), checks = [];
let notifications = 0;
const view = new ChoiceView(root, () => notifications++);
const host = { visible: true, mediaReady: true, overlayOpen: false };
const game = () => flow.session;
const count = () => game().state.snapshot().items.find((row) => row.id === 2)?.count ?? 0;
const tick = (ms = 10) => { flow.advance(ms, host); view.render(flow); assert.equal(game().field.stop, null); };
const check = (name, fn) => { fn(); checks.push(name); };
const key = (code, repeat = false) => {
  let prevented = false;
  const handled = view.keyboard({ code, repeat, preventDefault() { prevented = true; } });
  return { handled, prevented };
};
const until = (condition) => {
  for (let i = 0; i < 200; i++) { if (condition()) return; tick(); }
  assert.fail("Interaction did not reach the expected boundary");
};
const begin = () => {
  flow.start(new GameSession(field, catalog)); tick(0);
  assert.equal(game().field.startEvent(interactionScript), true);
  until(() => game().field.dialogue !== null);
  assert.equal(flow.confirm(), true); view.render(flow);
  assert.equal(flow.phase, "choice");
};

check("title has no active selection surface", () => { view.render(flow); assert.equal(root.hidden, true); });
begin();
const initialSelection = game().field.eventState.snapshot().selected;
check("default highlight retains the prompt without writing an answer", () => {
  assert.equal(root.hidden, false); assert.equal(view.selected, 1);
  assert.equal(game().field.messageWindow.key, "FRAMEWORK_SUPPLIES");
  assert.equal(game().field.dialogue, null); tick(1000);
  assert.equal(game().field.eventState.snapshot().selected, initialSelection);
  assert.equal(game().checkpointReady, false); assert.equal(flow.confirm(), false);
  assert.equal(flow.move("up"), false); assert.throws(() => game().checkpoint());
});
const firstButton = view.buttons[0], firstRequest = game().field.choice.id;
check("source-disabled cancel and out-of-range choices leave the question pending", () => {
  assert.equal(flow.choose(firstRequest, "cancel"), false);
  assert.equal(flow.choose(firstRequest, -1), false);
  assert.equal(flow.choose(firstRequest, 2), false);
  assert.equal(game().field.eventState.snapshot().selected, initialSelection);
});
check("pause and asynchronous operation gates reject retained callbacks", () => {
  flow.pause(true); view.render(flow); firstButton.onclick(); assert.equal(root.hidden, true);
  assert.equal(game().field.eventState.snapshot().selected, initialSelection);
  flow.pause(false); tick(0);
  const ticket = flow.beginOperation("save"); firstButton.onclick();
  assert.equal(game().field.eventState.snapshot().selected, initialSelection); ticket.finish(); tick(0);
});
check("hidden document and renderer disabled state reject retained callbacks", () => {
  document.hidden = true; firstButton.onclick(); document.hidden = false;
  view.render(flow, { disabled: true }); firstButton.onclick();
  assert.equal(game().field.eventState.snapshot().selected, initialSelection); view.render(flow);
});
const beforeItems = count();
check("keyboard chooses once and resumes only on the normal event clock", () => {
  assert.deepEqual(key("ArrowUp"), { handled: true, prevented: true }); assert.equal(view.selected, 0);
  key("Enter", true); assert.ok(game().field.choice);
  key("Enter"); assert.equal(game().field.eventState.snapshot().selected, 0);
  assert.equal(notifications, 1); assert.equal(game().field.choice, null);
  assert.equal(game().field.choicePending, true); assert.equal(flow.confirm(), false);
  assert.equal(count(), beforeItems); firstButton.onclick(); assert.equal(notifications, 1);
  until(() => game().field.dialogue?.key === "FRAMEWORK_GRANTED");
  assert.equal(count(), beforeItems + 2);
});
flow.confirm(); view.render(flow);
const secondRequest = game().field.choice.id;
check("a following multi-choice question rejects the previous request and callback", () => {
  assert.notEqual(secondRequest, firstRequest); assert.equal(view.buttons.length, 3); assert.equal(view.selected, 0);
  firstButton.onclick(); assert.equal(flow.choose(firstRequest, 0), false);
  assert.equal(game().field.choice.id, secondRequest);
  key("ArrowUp"); assert.equal(view.selected, 2);
  key("Space"); assert.equal(notifications, 2);
  until(() => game().field.dialogue?.key === "FRAMEWORK_RECORDED");
  assert.equal(game().field.eventState.read({ category: "ScenarioVariable", index: 15 }), 2);
});
flow.confirm(); until(() => game().checkpointReady);
check("chosen branch, granted inventory and event register restore together", () => {
  const saved = game().checkpoint(), restored = GameSession.restore(saved, field, catalog);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.field.choice, null);
  assert.equal(restored.field.eventState.snapshot().selected, 2);
  assert.equal(restored.field.eventState.read({ category: "ScenarioVariable", index: 15 }), 2);
  assert.equal(restored.state.snapshot().items.find((row) => row.id === 2).count, beforeItems + 2);
});
begin();
const previousOwnerButton = view.buttons[0];
check("owner replacement rejects old buttons even before the view renders", () => {
  const replaced = game(); flow.start(new GameSession(field, catalog)); flow.advance(0, host);
  previousOwnerButton.onclick(); assert.equal(replaced.field.choicePending, true);
  assert.equal(count(), beforeItems);
});
begin();
check("the default decline branch grants nothing and returns to a stable field", () => {
  key("Enter"); until(() => game().field.dialogue?.key === "FRAMEWORK_DECLINED");
  flow.confirm(); until(() => game().checkpointReady);
  assert.equal(count(), beforeItems); assert.equal(game().field.eventState.snapshot().selected, 1);
  assert.equal(root.hidden, true);
});
begin();
const titleButton = view.buttons[0];
check("returning to title invalidates inputs immediately", () => {
  flow.returnToTitle(); titleButton.onclick(); view.render(flow);
  assert.equal(root.hidden, true); assert.ok(game().field.choice);
});

const report = { kind: "event-interaction-ui-check-v1", lane: "controlled-DOM-and-real-session", result: "passed",
  sourceFieldHash: sourceField.contentHash, controlledFieldHash: field.contentHash, battleCatalogHash: catalog.contentHash,
  checks, doesNotEstablish: ["original-runtime parity", "story reachability", "rendered browser acceptance", "full-game migration"] };
await mkdir(rootPath + "/build/reports", { recursive: true });
await writeFile(rootPath + "/build/reports/event-interaction-ui-check.json", JSON.stringify(report, null, 2) + "\n");
await writeFile(rootPath + "/build/reports/event-interaction-ui-field.json", JSON.stringify(field) + "\n");
console.log(JSON.stringify({ result: report.result, checks: checks.length, fieldHash: field.contentHash }));
