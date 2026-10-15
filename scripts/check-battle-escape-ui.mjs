// Controlled DOM, actual app bindSession handlers, and real flow/session/battle
// owners. A controlled presentation bridge uses the actual asynchronous
// handoff coordinator; full app overlays/media are checked in game-entry-ui.
// This is not browser pixels or source escape probabilities/presentation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { BattleView } from "../apps/game/battle-view.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Usage: check-battle-escape-ui.mjs [--compiled-dir build/test-output]");
const compiled = resolve(root, args[1] ?? "dist");
const load = (path) => import(pathToFileURL(resolve(compiled, path)));
const [{ GameSession }, { GameFlow }, { GameCommands }, { GameBattleHandoff }, { battleAppearanceQuads }, { projectDevelopmentBattleLayout },
  { walkEncounterFixture, walkHost, winWalkEncounter }, { checkpointFixture }] = await Promise.all([
  load("src/core/game-session.js"), load("src/core/game-flow.js"), load("src/core/game-commands.js"), load("src/core/game-battle-handoff.js"),
  load("src/core/battle-appearance.js"), load("src/core/battle-layout.js"),
  load("tests/fixtures/walk-encounter-game.js"), load("tests/fixtures/checkpoint-game.js"),
]);
const app = await readFile(resolve(root, "apps/game/app.js"), "utf8");
const ast = ts.createSourceFile("app.js", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const binding = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "bindSession");
assert.ok(binding, "The check executes the actual app's current binding function");
const bindingSource = app.slice(binding.getStart(ast), binding.end);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const policy = { kind: "framework-battle-escape-v1", id: "synthetic-ui-escape" };
const checked = [];

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.disabled = false; this.hidden = false; this.textContent = ""; this.attributes = new Map();
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node === before) return node;
    node.remove(); const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentElement = this; return node;
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    assert.ok(["button", "button:not(:disabled)"].includes(selector));
    return this.children.flatMap(child => [
      ...(child.tagName === "BUTTON" && (selector === "button" || !child.disabled) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.onclick?.(); }
  getContext() { return {}; }
}

async function fixture({ allowed = true, ready = true, scripted = false, items = 0 } = {}) {
  const f = scripted ? checkpointFixture() : walkEncounterFixture(1);
  if (allowed) f.battle.encounters[1000].escapePolicy = { ...policy };
  f.battle.common.initialAtb.player = ready ? [100, 100] : [0, 0];
  f.battle.common.timing.mode = "wait";
  f.battle.gameState.initialItems = items ? [{ id: 10, count: items }] : [];
  f.battle.common.commands[200] = { id: 200, kind: "item", name: "Items", abilityIds: [],
    referencedAbility: null, forbiddenConditionIds: [] };
  for (const player of f.battle.common.players) player.commands.push(200);
  const game = new GameSession(f.field, f.battle, 314, { battleHandoff: "prepared" }), flow = new GameFlow(game);
  flow.start(); flow.advance(0, walkHost);
  if (scripted) { assert.equal(game.field.startEvent("fight"), true); flow.advance(10, walkHost); }
  else { assert.equal(flow.move("right"), true); flow.advance(240, walkHost); }
  assert.equal(game.battle, null); assert.equal(game.field.stop?.kind, "encounter");
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async () => ({ kind: "battle" }), prepareReturn: async () => ({ kind: "field" }), discard() {},
  });
  assert.equal((await handoff.start()).status, "committed"); flow.advance(0, walkHost);
  assert.ok(game.battle); assert.equal(flow.phase, "battle");
  return { ...f, game, flow, handoff };
}

function host(f) {
  const ids = ["battle-return", "battle-retry", "party", "battle-ui", "battle-result", "battle-result-title",
    "battle-result-text", "battle-levels", "battle-menu", "battle-action", "pause", "welcome", "stop", "dialogue",
    "map-overview", "minimap-button", "menu-button", "equipment-menu", "party-menu", "source-party-selection", "shop-menu"];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const document = { hidden: false, activeElement: null,
    getElementById(id) { assert.ok(elements.has(id), id); return elements.get(id); },
    createElement(tag) { return new Element(tag); } };
  globalThis.document = document;
  const canvas = new Element("canvas"), failures = [], faults = { syncError: null };
  const emptyView = { reset() {}, render() {} };
  let context, pending = Promise.resolve();
  const sync = () => {
    if (faults.syncError) throw faults.syncError;
    const view = context.__binding.read().battleView;
    if (!view) return;
    if (f.flow.currentSession?.battle) view.sync(f.flow.currentSession.battle, !f.flow.inputReady || document.hidden);
    else view.hide();
  };
  context = vm.createContext({ BattleView, GameCommands, battleAppearanceQuads, projectDevelopmentBattleLayout,
    document, canvas, flow: f.flow, battleHandoff: f.handoff, images: new Map(), held: new Map(),
    choiceView: emptyView,
    EquipmentView: class { reset() {} render() {} },
    PartyView: class { reset() {} render() {} },
    SourcePartySelectionView: class { reset() {} render() {} },
    ShopView: class { reset() {} render() {} },
    InventoryView: class { render() {} },
    sync, syncSaveControls() {}, showLimitations() {},
    failure(error) { failures.push(error); }, focus() { canvas.focus(); },
    // Actual bindSession callbacks call this explicit controlled presentation
    // bridge. Preparation/lease/settlement all run through the real coordinator;
    // only readiness and the workbench's existing error marker are controlled.
    loadBattle(owner, kind) {
      assert.equal(owner, f.flow.currentSession);
      const terminal = owner.battle;
      pending = (async () => {
        try {
          const result = await (kind === "return" ? f.handoff.return() : kind === "retry" ? f.handoff.retry() : f.handoff.start());
          if (result.status === "cancelled") return;
          if (result.status === "failed") {
            assert.equal(result.session, owner);
            assert.equal(result.request, owner.field.stop);
            assert.equal(owner.battle, terminal);
            assert.equal(owner.state.inBattle, true);
            context.__binding.read().battleView.showReturnError(terminal);
            return;
          }
          sync(); canvas.focus();
        } catch (error) { failures.push(error); }
      })();
      return pending;
    },
    $: id => document.getElementById(id),
  });
  vm.runInContext(`let game, renderer, minimapRenderer, overviewRenderer, battleView, inventoryView,
      equipmentView, partyView, sourcePartySelectionView, shopView, commands;
    let menuCommandsReady = null;
    let mapLoadFailure = null, battleLoadAttempt = null, mapOpen = false, last = 0, lastMinimapFrame = 0, failed = false;
    ${bindingSource}
    globalThis.__binding = { bindSession, read: () => ({ game, battleView }) };`, context,
    { filename: "actual-app-bind-session.js" });
  const bind = (game = f.game) => { context.__binding.bindSession(game, { field: {}, minimap: {}, overview: {} }); sync(); };
  bind();
  const buttons = () => elements.get("battle-menu").querySelectorAll("button");
  const button = text => {
    const matches = buttons().filter(node => node.textContent === text);
    assert.equal(matches.length, 1, `Expected one ${text}; got ${buttons().map(node => node.textContent)}`);
    return matches[0];
  };
  return { ...f, document, canvas, failures, faults, bind, sync, buttons, button,
    wait: () => pending, view: () => context.__binding.read().battleView, $: id => document.getElementById(id) };
}
function settle(h) {
  for (let i = 0; i < 200 && h.game.battle?.phase === "active"; i++) {
    h.flow.advance(10, walkHost); h.sync();
  }
  assert.equal(h.game.battle?.phase, "escaped");
  assert.deepEqual(h.failures, []);
}

{
  const h = host(await fixture({ ready: false })), battle = h.game.battle;
  assert.equal(battle.ready.length, 0); assert.equal(h.button("撤退").disabled, false);
  const old = h.button("撤退").onclick;
  h.button("撤退").click();
  assert.equal(battle.escapePending, true); assert.equal(h.view().menuState, "none");
  assert.equal(h.$("battle-action").textContent, "正在撤退…");
  assert.equal(h.buttons().length, 0); assert.ok([...h.view().rows.values()].every(row => row.button.disabled));
  old(); assert.equal(h.flow.requestEscape(), false);
  h.flow.pause(true); h.sync(); h.flow.advance(1000, walkHost);
  assert.equal(battle.phase, "active"); assert.equal(battle.escapePending, true);
  assert.equal(h.view().back(), false); assert.equal(h.view().setSpecialInput("slot"), false);
  h.flow.pause(false); h.sync(); settle(h);
  checked.push("not-ready actors can request once; pending locks ordinary input, releases WAIT and respects pause");
}
{
  const h = host(await fixture()), battle = h.game.battle;
  h.button("Synthetic command").click();
  assert.equal(h.view().menuState, "ability"); assert.equal(battle.timingState.input.uiWaiting, true);
  const stale = h.button("Beam").onclick;
  assert.equal(h.flow.requestEscape(), true); h.sync();
  stale(); assert.equal(battle.pendingActions.length, 0);
  assert.equal(battle.timingState.input.uiWaiting, false);
  assert.equal(battle.timingState.input.forceWaiting, false);
  settle(h);
  checked.push("an external eligible retreat clears an existing WAIT submenu and detached action callbacks cannot enqueue");
}
for (const settings of [{ allowed: false }, { scripted: true }]) {
  const h = host(await fixture(settings));
  assert.equal(h.flow.canEscape, false); assert.equal(h.button("撤退").disabled, true);
  h.button("撤退").onclick(); assert.equal(h.game.battle.escapePending, false);
  assert.equal(h.game.battle.phase, "active");
  checked.push(settings.scripted ? "scripted battle retains its continuation and cannot retreat" :
    "an encounter without explicit development escape policy stays disabled");
}
{
  const h = host(await fixture()), battle = h.game.battle, stale = h.button("撤退").onclick;
  h.flow.pause(true); stale(); assert.equal(battle.escapePending, false);
  h.flow.pause(false);
  for (const state of [{ ...walkHost, visible: false }, { ...walkHost, mediaReady: false }, { ...walkHost, overlayOpen: true }]) {
    h.flow.advance(0, state); stale(); assert.equal(battle.escapePending, false);
  }
  h.flow.advance(0, walkHost); h.document.hidden = true;
  // Actual app visibilitychange revokes the Flow host immediately. This
  // binding-only harness reports that fact explicitly; visibility restoration
  // still requires a fresh ready observation rather than inheriting readiness.
  h.flow.observeHost({ visible: false, mediaReady: false, overlayOpen: false });
  stale(); assert.equal(battle.escapePending, false); h.document.hidden = false;
  h.flow.advance(0, walkHost);
  const operation = h.flow.beginOperation("save"); stale(); assert.equal(battle.escapePending, false); operation.cancel();
  h.flow.returnToTitle(); stale(); assert.equal(battle.escapePending, false);
  checked.push("actual app request handler rechecks pause, visibility, media, overlay, I/O and title without a redraw");
}
{
  const h = host(await fixture()), oldBattle = h.game.battle, stale = h.button("撤退").onclick;
  const next = await fixture(); h.flow.start(next.game); h.flow.advance(0, walkHost);
  stale(); assert.equal(oldBattle.escapePending, false); assert.equal(next.game.battle.escapePending, false);
  h.bind(next.game); stale(); assert.equal(next.game.battle.escapePending, false);
  h.button("撤退").click(); assert.equal(next.game.battle.escapePending, true);
  checked.push("old session and detached view callbacks cannot withdraw a new owner's battle");
}
{
  const h = host(await fixture({ items: 2 })), battle = h.game.battle, field = h.game.field;
  const before = h.game.state.snapshot(), position = [field.player.x, field.player.y];
  h.button("Items").click(); h.button("Synthetic potion × 2").click();
  h.button(battle.players[0].name).click();
  h.flow.advance(410, walkHost); h.sync();
  assert.equal(battle.inventory.find(item => item.id === 10).count, 1);
  assert.ok(battle.action, "The active item action has spent its resource but not finished presentation");
  h.button("撤退").click(); assert.equal(battle.escapePending, true);
  h.flow.advance(10, walkHost); h.sync(); assert.equal(battle.phase, "active");
  settle(h);
  const ending = battle.players.map(unit => ({ id: unit.id, hp: unit.hp, mp: unit.mp, row: unit.row }));
  assert.equal(battle.reward, null);
  assert.equal(h.$("battle-result-title").textContent, "已撤离战斗");
  assert.match(h.$("battle-result-text").textContent, /保留当前状态.*物品.*不获得胜利奖励/);
  assert.equal(h.$("battle-levels").textContent, "");
  assert.equal(h.$("battle-return").hidden, false); assert.equal(h.$("battle-return").textContent, "继续前行");
  assert.equal(h.$("battle-retry").hidden, true);
  const returnClick = h.$("battle-return").onclick;
  h.flow.pause(true); returnClick(); assert.equal(h.game.battle, battle); h.flow.pause(false);
  h.document.hidden = true;
  h.flow.observeHost({ visible: false, mediaReady: false, overlayOpen: false });
  returnClick(); assert.equal(h.game.battle, battle); h.document.hidden = false;
  h.flow.advance(0, walkHost);
  returnClick(); assert.equal(h.game.battle, battle); assert.equal(h.flow.phase, "battle-return");
  await h.wait(); assert.equal(h.game.battle, null); assert.equal(h.flow.phase, "exploration");
  assert.equal(h.game.field, field); assert.deepEqual([field.player.x, field.player.y], position);
  const after = h.game.state.snapshot();
  assert.equal(after.items.find(item => item.id === 10).count, 1);
  assert.equal(after.gil, before.gil); assert.deepEqual(h.game.completedEncounters, []);
  assert.deepEqual(after.roster.map(unit => [unit.id, unit.exp]), before.roster.map(unit => [unit.id, unit.exp]));
  for (const unit of ending) {
    const saved = after.roster.find(player => player.id === unit.id);
    assert.equal(saved.hp, unit.hp); assert.equal(saved.mp, unit.mp);
  }
  assert.equal(h.game.checkpointReady, true);
  const saved = h.game.checkpoint(); returnClick();
  assert.deepEqual(h.game.checkpoint(), saved); assert.equal(h.flow.continueEscape(), false);
  checked.push("active action completes before retreat; escaped result returns once with current HP/MP and item consumption but no rewards");
}
for (const phase of ["escaped", "victory"]) {
  const h = host(await fixture()), battle = h.game.battle, field = h.game.field;
  if (phase === "escaped") { h.button("撤退").click(); settle(h); }
  else { winWalkEncounter(h.flow); h.sync(); assert.equal(battle.phase, "victory"); }
  const receipt = () => phase === "escaped" ? battle.previewEscape() : battle.previewVictory();
  const before = h.game.state.snapshot(), result = structuredClone(receipt()), stop = field.stop;
  const prepare = field.prepareEncounterReturn;
  let attempts = 0;
  field.prepareEncounterReturn = function (...args) {
    attempts++;
    if (attempts === 1) throw new Error("Controlled return preparation failure");
    assert.equal(h.view().returnError, null, "A retry clears only the view error before asking the owner again");
    return prepare.apply(this, args);
  };
  const returnClick = h.$("battle-return").onclick;
  returnClick(); await h.wait();
  assert.deepEqual(h.failures, [], "An unchanged terminal battle is still retryable, not a fatal app failure");
  assert.equal(h.game.battle, battle); assert.equal(h.game.state.inBattle, true);
  assert.equal(battle.phase, phase); assert.equal(field.stop, stop);
  assert.deepEqual(h.game.state.snapshot(), before); assert.deepEqual(receipt(), result);
  assert.equal(h.$("battle-result").hidden, false);
  assert.match(h.$("battle-result-text").textContent, /返回地图失败，战斗结果仍保留，请重试。/);
  assert.equal(h.$("battle-return").textContent, "重试返回");
  h.sync(); assert.equal(h.$("battle-return").textContent, "重试返回", "A regular frame retains the retry message");
  returnClick(); await h.wait();
  assert.equal(attempts, 2); assert.equal(h.game.battle, null); assert.equal(h.game.state.inBattle, false);
  assert.equal(h.flow.phase, "exploration"); assert.equal(h.view().returnError, null);
  const saved = h.game.checkpoint(); returnClick();
  assert.deepEqual(h.game.checkpoint(), saved); assert.equal(attempts, 2); assert.deepEqual(h.failures, []);
  checked.push(`${phase}: failed return preparation preserves owned state, terminal receipt and field stop; retry publishes once`);
}
{
  const h = host(await fixture()); h.button("撤退").click(); settle(h);
  const error = new Error("Controlled presentation failure after publication");
  h.faults.syncError = error;
  h.$("battle-return").click(); await h.wait();
  assert.equal(h.game.battle, null); assert.equal(h.game.state.inBattle, false);
  assert.deepEqual(h.failures, [error], "A post-publication UI error must use the fatal path");
  assert.equal(h.view().returnError, null);
  checked.push("post-publication sync failure is fatal and never offered as a retryable settlement");
}
{
  const h = host(await fixture()), workbench = new BattleView(h.canvas, h.game.battle.content, new Map(), () => {}, () => {});
  workbench.sync(h.game.battle, false);
  assert.ok(h.buttons().every(button => button.textContent !== "撤退"));
  assert.throws(() => new BattleView(h.canvas, h.game.battle.content, new Map(), () => {}, () => {},
    undefined, undefined, { request() { return true; } }), /Invalid battle escape actions/);
  checked.push("workbench without an escape owner omits retreat and malformed callback contracts reject");
}

const report = { kind: "controlled-battle-escape-ui", result: "passed", scenarios: checked.length, checked,
  appSha256: hash(app), battleViewSha256: hash(await readFile(resolve(root, "apps/game/battle-view.js"))),
  evidence: "Actual app bindSession handlers and BattleView with real started GameFlow/GameSession/BattleGame/GameBattleHandoff; asynchronous controlled ready host and explicit error-presentation bridge; synthetic ordinary walk encounter",
  browserRendering: false, sourceEscapeSemantics: false };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/battle-escape-ui-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ scenarios: checked.length, result: "passed" }));
