// Actual views and the shared command owner in a controlled DOM. These authored
// fixtures exercise input/ownership boundaries, not browser pixels or story reachability.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InventoryView } from "../apps/game/inventory-view.js";
import { EquipmentView } from "../apps/game/equipment-view.js";
import { PartyView } from "../apps/game/party-view.js";
import { ShopView } from "../apps/game/shop-view.js";
import { BattleView } from "../apps/game/battle-view.js";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--dist" && args[1],
  "Usage: check-game-commands-ui.mjs [--dist <directory>]");
const dist = resolve(root, args[1] ?? "dist"), load = path => import(pathToFileURL(resolve(dist, path)).href);
const output = resolve(root, "build/reports/game-commands-ui-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(output, { force: true });

const [{ GameSession }, { GameFlow }, { GameCommands }, { partyMenuFixture },
  { playerSessionFixture }, { fixtureRosterLifecycle }, { gameFlowFixture }] = await Promise.all([
  load("src/core/game-session.js"), load("src/core/game-flow.js"), load("src/core/game-commands.js"),
  load("tests/fixtures/party-menu.js"), load("tests/fixtures/battle-player-game.js"),
  load("tests/fixtures/roster-lifecycle.js"),
  load("tests/fixtures/game-flow.js"),
]);

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = new Map(); this.classes = new Set(); this.text = "";
    this.disabled = false; this.hidden = false; this.open = false;
    this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, force) => {
        const next = force ?? !this.classes.has(name);
        if (next) this.classes.add(name); else this.classes.delete(name);
        return next;
      }, contains: name => this.classes.has(name) };
  }
  get childNodes() { return this.children; }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(" "); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node === before) return node;
    node.remove(); const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentElement = this; return node;
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children, index = siblings.indexOf(this);
    assert.ok(index >= 0); siblings.splice(index, 1); this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.text = ""; this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.onclick?.(); } }
  getContext() { return {}; }
}
function matches(node, selector) {
  if (selector === "button") return node.tagName === "BUTTON";
  if (selector === "button:not(:disabled)") return node.tagName === "BUTTON" && !node.disabled;
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
  const attr = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
  assert.ok(attr, "Unsupported controlled selector: " + selector);
  const key = attr[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return node.dataset[key] !== undefined && (attr[2] === undefined || node.dataset[key] === attr[2]);
}
const walk = node => [node, ...node.children.flatMap(walk)];
const by = (node, predicate, message) => { const found = walk(node).find(predicate); assert.ok(found, message); return found; };
const textButton = (node, label) => by(node, child => child.tagName === "BUTTON" && child.textContent === label, "Missing button " + label);
const focusButton = (node, key, value) => by(node, child => child.tagName === "BUTTON" && child.dataset[key] === value, "Missing button " + value);
function documentFor() {
  const ids = ["battle-return", "battle-retry", "party", "battle-ui", "battle-result", "battle-result-title",
    "battle-result-text", "battle-levels", "battle-menu", "battle-action"];
  const nodes = new Map(ids.map(id => [id, Object.assign(new Element(), { id })]));
  globalThis.document = { activeElement: null, createElement: tag => new Element(tag),
    getElementById: id => { assert.ok(nodes.has(id), id); return nodes.get(id); } };
  return nodes;
}
const host = (flow, value = {}) => flow.observeHost({ visible: true, mediaReady: true, overlayOpen: false, ...value });
const report = { kind: "shared-game-commands-ui-v1", result: "running", tests: [],
  lane: "controlled-DOM-with-real-five-views-GameFlow-GameCommands-GameSession",
  browserVerified: false, nativeVerified: false, semanticsVerified: false,
  originalGameExecuted: false, sourceGameplayVerified: false,
  limitations: ["Authored fixture stock, shop interaction and battle command; no source story or ownership is fabricated",
    "DOM interaction checks do not inspect browser rendering", "Presentation clock reporting remains distinct from user commands"] };
const check = (name, run) => { const details = run(); report.tests.push({ name, result: "passed", ...(details ?? {}) }); };

function menuFixture() {
  const f = partyMenuFixture();
  const saved = f.game.checkpoint();
  saved.owned.items = [{ id: 10, count: 8 }];
  saved.owned.roster[0].hp = 50;
  // Current resources are explicit controlled checkpoint state. Maximum HP
  // remains derived from the unchanged equipment/growth catalog and is checked
  // by the real restore owner before any UI interaction.
  return { ...f, game: GameSession.restore(saved, f.field, f.battle) };
}
function inventoryRoot() {
  const node = new Element("section");
  node.append(...["owned-party", "owned-gil", "owned-key-items", "owned-items", "item-targets", "item-status"]
    .map(id => Object.assign(new Element(), { id })));
  return node;
}

try {
  documentFor();
  const f = menuFixture(), game = f.game, flow = new GameFlow();
  flow.start(game, { paused: true }); host(flow);
  const commands = new GameCommands(flow, game), channels = { commands, owner: game };
  const roots = { inventory: inventoryRoot(), equipment: new Element("section"), party: new Element("section") };
  let notifications = 0;
  const inventory = new InventoryView(roots.inventory, game.battleCatalog.gameState.items, () => notifications++, channels);
  const equipment = new EquipmentView(roots.equipment, () => notifications++, channels);
  const party = new PartyView(roots.party, () => notifications++, channels);
  const potionTarget = () => {
    inventory.render(game);
    textButton(roots.inventory, "Synthetic potion × " + game.state.snapshot().items.find(row => row.id === 10).count).click();
    return by(roots.inventory.querySelector("#item-targets"), node => node.tagName === "BUTTON" &&
      node.textContent.startsWith(game.players.find(player => player.id === "a").name + " · HP"), "Missing potion target");
  };
  let retainedItem, retainedEquipment, retainedParty;
  check("inventory, equipment and party controls publish through the actual paused-menu command owner", () => {
    assert.equal(commands.menuReady, true);
    retainedItem = potionTarget();
    const before = game.state.snapshot(); retainedItem.click();
    const after = game.state.snapshot();
    assert.equal(after.items.find(row => row.id === 10).count, before.items.find(row => row.id === 10).count - 1);
    assert.equal(after.roster.find(player => player.id === "a").hp, 100);
    equipment.render(game);
    const choice = game.state.equipmentChoices("a", 1).find(row => row.changes.length && row.id !== game.state.snapshot().roster[0].equipment[0]);
    assert.ok(choice);
    focusButton(roots.equipment, "equipmentFocus", "choice-" + choice.id).click();
    retainedEquipment = textButton(roots.equipment, "应用换装"); retainedEquipment.click();
    assert.equal(game.state.snapshot().roster[0].equipment[0], choice.id);
    party.render(game);
    retainedParty = focusButton(roots.party, "partyFocus", "row-0"); retainedParty.click();
    assert.equal(game.state.activeParty[0].row, "back");
    assert.equal(notifications, 3);
    return { itemId: 10, targetOwner: "a", equipmentId: choice.id, row: "back" };
  });
  const retainedMenu = [retainedItem, retainedEquipment, retainedParty];
  const rejectMenus = () => {
    const before = game.state.snapshot(), count = notifications;
    for (const node of retainedMenu) node.onclick();
    assert.deepEqual(game.state.snapshot(), before); assert.equal(notifications, count);
  };
  check("in-flight, hidden, unready and exploration states reject retained menu mutations", () => {
    const ticket = flow.beginOperation("load"); rejectMenus(); ticket.cancel();
    host(flow, { visible: false }); rejectMenus();
    host(flow, { mediaReady: false }); rejectMenus();
    host(flow); flow.pause(false); rejectMenus(); flow.pause(true);
    return { fences: ["operation", "hidden", "media-unready", "menu-closed"] };
  });
  check("old menu callbacks and cross-owner rerenders cannot redirect requests after loading a new session", () => {
    const next = menuFixture().game, beforeOld = game.state.snapshot(), beforeNext = next.state.snapshot();
    flow.start(next, { paused: true }); host(flow);
    rejectMenus();
    inventory.render(next); equipment.render(next); party.render(next);
    rejectMenus();
    assert.deepEqual(game.state.snapshot(), beforeOld); assert.deepEqual(next.state.snapshot(), beforeNext);
    const freshRoot = inventoryRoot(), freshCommands = new GameCommands(flow, next);
    const fresh = new InventoryView(freshRoot, next.battleCatalog.gameState.items, () => {}, { commands: freshCommands, owner: next });
    fresh.render(next); textButton(freshRoot, "Synthetic potion × 8").click();
    by(freshRoot.querySelector("#item-targets"), node => node.tagName === "BUTTON" && node.textContent.startsWith(next.players[0].name + " · HP"), "Missing fresh target").click();
    assert.equal(next.state.snapshot().items[0].count, 7);
    assert.deepEqual(game.state.snapshot(), beforeOld);
  });

  documentFor();
  const sf = gameFlowFixture({ shop: true }), shopGame = sf.game, shopFlow = sf.flow;
  shopFlow.start(shopGame); host(shopFlow);
  assert.equal(shopFlow.confirm(), true); assert.equal(shopFlow.confirm(), true);
  assert.equal(shopGame.field.currentShop?.groupId, 7);
  const shopCommands = new GameCommands(shopFlow, shopGame), shopRoot = new Element("section");
  let trades = 0;
  const shop = new ShopView(shopRoot, () => trades++, { commands: shopCommands, owner: shopGame });
  shop.render(shopGame);
  let quote, leave;
  check("real shop buy and close use the shared command owner without false transaction success", () => {
    focusButton(shopRoot, "shopFocus", "buy:1001").click();
    quote = textButton(shopRoot, "确认购买");
    const before = shopGame.state.snapshot(); quote.click();
    const after = shopGame.state.snapshot();
    assert.equal(after.gil, before.gil - 30);
    assert.equal(after.items.find(row => row.id === 10).count, (before.items.find(row => row.id === 10)?.count ?? 0) + 1);
    assert.equal(trades, 1);
    leave = textButton(shopRoot, "离开商店");
  });
  check("shop callbacks and Escape back cannot trade or close during I/O or background suppression", () => {
    focusButton(shopRoot, "shopFocus", "buy:1001").click();
    const pendingQuote = textButton(shopRoot, "确认购买"), before = shopGame.state.snapshot(), request = shopGame.field.currentShop;
    const reject = () => {
      pendingQuote.onclick(); leave.onclick(); assert.equal(shop.back(), false);
      assert.deepEqual(shopGame.state.snapshot(), before); assert.deepEqual(shopGame.field.currentShop, request);
      assert.equal(trades, 1);
    };
    const ticket = shopFlow.beginOperation("load"); reject(); ticket.cancel();
    host(shopFlow, { visible: false }); reject(); host(shopFlow);
    assert.equal(shop.back(), true); // Only cancels presentation selection.
    textButton(shopRoot, "离开商店").click();
    assert.equal(shopGame.field.currentShop, null); assert.equal(trades, 2);
    quote.onclick(); leave.onclick(); assert.deepEqual(shopGame.state.snapshot(), before);
  });
  check("a replaced owner cannot receive an old shop callback or keyboard close", () => {
    assert.equal(shopFlow.confirm(), true); // Complete the actual farewell first.
    assert.equal(shopFlow.confirm(), true); assert.equal(shopFlow.confirm(), true);
    assert.ok(shopGame.field.currentShop);
    shop.render(shopGame); focusButton(shopRoot, "shopFocus", "buy:1001").click();
    const old = textButton(shopRoot, "确认购买"), next = menuFixture().game;
    const oldBefore = shopGame.state.snapshot(), nextBefore = next.state.snapshot();
    shopFlow.start(next); host(shopFlow); old.onclick(); assert.equal(shop.back(), false);
    assert.deepEqual(shopGame.state.snapshot(), oldBefore); assert.deepEqual(next.state.snapshot(), nextBefore);
  });

  const elements = documentFor(), bf = playerSessionFixture([]);
  bf.battle.gameState.initialItems = [{ id: 10, count: 3 }];
  bf.battle.common.commands[101] = { id: 101, name: "Synthetic items", kind: "item", abilityIds: [],
    referencedAbility: null, forbiddenConditionIds: [] };
  for (const player of bf.battle.common.players) player.commands.push(101);
  bf.battle.gameState.rosterLifecycle = fixtureRosterLifecycle(bf.battle.common.players);
  const battleGame = new GameSession(bf.field, bf.battle, 6403), battleFlow = new GameFlow();
  battleFlow.start(battleGame); host(battleFlow);
  assert.equal(battleGame.field.startEvent("fight"), true); battleGame.advance(10);
  const battle = battleGame.battle; assert.ok(battle);
  const battleCommands = new GameCommands(battleFlow, battleGame), canvas = new Element("canvas");
  let returns = 0, retries = 0;
  const battleView = new BattleView(canvas, battle.content, new Map(),
    () => { returns++; battleGame.continueVictory(); }, () => { retries++; battleGame.retryBattle(); },
    undefined, undefined, undefined, { commands: battleCommands, owner: battleGame });
  const menu = elements.get("battle-menu"), sync = paused => battleView.sync(battleGame.battle, paused ?? false);
  sync();
  let targetButton, oldRow, queuedActor;
  check("battle ability controls queue through the exact active battle command owner", () => {
    textButton(menu, "Synthetic command").click(); textButton(menu, "Heal · MP 2").click();
    queuedActor = battleView.selected;
    targetButton = textButton(menu, battle.players[0].name);
    oldRow = battleView.rows.get(queuedActor).button;
    const before = battle.pendingActions.length; targetButton.click();
    assert.equal(battle.pendingActions.length, before + 1);
    assert.equal(battle.pendingActions.at(-1).actor, queuedActor);
    assert.equal(battle.pendingActions.at(-1).source.kind, "ability");
  });
  check("battle item controls use the same input gate and preserve the item carrier", () => {
    assert.ok(battleView.selected);
    textButton(menu, "Synthetic items").click();
    textButton(menu, "Synthetic potion × 3").click();
    const actor = battleView.selected, before = battle.pendingActions.length;
    textButton(menu, battle.players[0].name).click();
    assert.equal(battle.pendingActions.length, before + 1);
    assert.equal(battle.pendingActions.at(-1).actor, actor);
    assert.equal(battle.pendingActions.at(-1).source.kind, "item");
  });
  check("background and I/O reject battle actions while exact-owner clock cleanup still works", () => {
    const pending = structuredClone(battle.pendingActions), owned = battleGame.state.snapshot();
    const reject = () => {
      targetButton.onclick(); oldRow.onclick(); assert.equal(battleView.back(), false);
      assert.deepEqual(battle.pendingActions, pending); assert.deepEqual(battleGame.state.snapshot(), owned);
    };
    const ticket = battleFlow.beginOperation("load"); reject(); ticket.cancel();
    host(battleFlow, { visible: false }); reject();
    battleView.sync(battle, true); assert.equal(battle.timingState.input.paused, true);
    assert.equal(battle.timingState.input.uiWaiting, false);
    host(battleFlow); battleView.sync(battle, false);
    assert.equal(battle.timingState.input.paused, false);
  });
  check("terminal buttons cannot settle during I/O or background, then return once and reject the next battle", () => {
    for (let frame = 0; frame < 20000 && battle.phase === "active"; frame++) {
      for (const actor of battle.ready) {
        const selection = battle.targetChoices(actor.id, 10)[0]?.selection;
        if (selection) battleCommands.command(battle, actor.id, 10, selection);
      }
      battleGame.advance(10); battleView.sync(battle, false);
    }
    assert.equal(battle.phase, "victory");
    const terminal = elements.get("battle-return").onclick, before = battleGame.state.snapshot();
    const ticket = battleFlow.beginOperation("load"); terminal(); ticket.cancel();
    host(battleFlow, { visible: false }); terminal();
    assert.equal(returns, 0); assert.deepEqual(battleGame.state.snapshot(), before);
    host(battleFlow); terminal(); assert.equal(returns, 1); assert.equal(battleGame.battle, null);
    battleGame.advance(10);
    assert.equal(battleGame.field.startEvent("fight"), true); battleGame.advance(10);
    const nextBattle = battleGame.battle; assert.ok(nextBattle && nextBattle !== battle);
    battleView.sync(nextBattle, false);
    const nextBefore = { pending: structuredClone(nextBattle.pendingActions), owned: battleGame.state.snapshot(), selected: battleView.selected };
    targetButton.onclick(); oldRow.onclick(); terminal();
    assert.deepEqual(nextBattle.pendingActions, nextBefore.pending);
    assert.deepEqual(battleGame.state.snapshot(), nextBefore.owned); assert.equal(battleView.selected, nextBefore.selected);
    assert.equal(returns, 1); assert.equal(retries, 0); assert.equal(oldRow.parentElement, null);
  });

  report.viewDigests = Object.fromEntries(await Promise.all(["inventory", "equipment", "party", "shop", "battle"].map(async name =>
    [name, createHash("sha256").update(await readFile(resolve(root, `apps/game/${name}-view.js`))).digest("hex")])));
  report.result = "passed";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: report.tests.length, report: output,
    browserVerified: false, nativeVerified: false }));
} catch (error) {
  report.result = "failed"; report.error = error.message;
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  throw error;
}
