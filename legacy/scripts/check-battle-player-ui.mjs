// Actual BattleView + GameSession in a controlled DOM. The authored player
// fixture verifies UI ownership contracts, not browser pixels or native parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BattleView } from "../apps/game/battle-view.js";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Usage: check-battle-player-ui.mjs [--compiled-dir <directory>]");
const compiled = resolve(root, args[1] ?? "dist"), load = path => import(pathToFileURL(resolve(compiled, path)).href);
const output = resolve(root, "build/reports/battle-player-ui-check.json");
const report = { kind: "controlled-battle-player-ui-v1", result: "running", checks: [],
  lane: "controlled-DOM-with-real-BattleView-GameSession-BattleGame",
  browserVerified: false, nativeVerified: false, originalGameExecuted: false, fullGameMigration: false,
  limitations: ["Authored held actors and saved groups; no original story or native waiting-owned selector is admitted",
    "DOM ownership and interaction checks do not render or inspect a browser",
    "All-entered rewards and preserved entry party are explicit Web fixture policies"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(output, { force: true });

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.disabled = false; this.hidden = false; this.attributes = new Map(); this.text = "";
    this.classes = new Set();
    this.classList = { toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name) };
  }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(""); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node === before) return node;
    node.remove(); const index = before === null ? this.children.length : this.children.indexOf(before);
    assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentElement = this; return node;
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this); assert.ok(index >= 0);
    this.parentElement.children.splice(index, 1); this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    assert.ok(["button", "button:not(:disabled)"].includes(selector));
    return this.children.flatMap(node => [
      ...(node.tagName === "BUTTON" && (selector === "button" || !node.disabled) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) this.onclick?.(); }
  getContext() { return {}; }
}
const ids = ["battle-return", "battle-retry", "party", "battle-ui", "battle-result", "battle-result-title",
  "battle-result-text", "battle-levels", "battle-menu", "battle-action"];
const check = (name, run) => { const details = run(); report.checks.push({ name, result: "passed", ...(details ?? {}) }); };

try {
  const [{ GameSession }, { playerSessionFixture }] = await Promise.all([
    load("src/core/game-session.js"), load("tests/fixtures/battle-player-game.js"),
  ]);
  function harness(fixture, seed) {
    const elements = new Map(ids.map(id => [id, new Element()]));
    globalThis.document = { activeElement: null,
      getElementById(id) { assert.ok(elements.has(id), id); return elements.get(id); },
      createElement: tag => new Element(tag) };
    const game = new GameSession(fixture.field, fixture.battle, seed);
    assert.equal(game.field.startEvent("fight"), true); game.advance(10);
    const battle = game.battle; assert.ok(battle);
    battle.setPreferences({ mode: "wait", speedIndex: 2 });
    const canvas = new Element("canvas"), view = new BattleView(canvas, battle.content, new Map(),
      () => game.continueVictory(), () => game.retryBattle());
    const element = id => elements.get(id), buttons = () => element("battle-menu").querySelectorAll("button");
    const button = name => {
      const found = buttons().find(node => node.textContent === name);
      assert.ok(found, `Missing ${name}: ${buttons().map(node => node.textContent).join(", ")}`); return found;
    };
    const sync = (paused = false) => view.sync(battle, paused);
    const until = condition => {
      for (let frame = 0; frame < 400 && !condition(); frame++) { game.advance(10); sync(); }
      assert.ok(condition(), "Player transition did not complete within the controlled frame bound");
    };
    const roster = () => {
      assert.deepEqual([...view.rows.keys()].sort(), battle.players.map(player => player.id).sort());
      assert.deepEqual(element("party").children, battle.players.map(player => view.rows.get(player.id).button));
      for (const player of battle.players) {
        const row = view.rows.get(player.id);
        assert.equal(row.name.textContent, `${player.name} · ${player.row === "back" ? "后排" : "前排"}`);
        assert.equal(row.hp.textContent, `HP ${player.hp} / ${player.maxHp}\nMP ${player.mp} / ${player.maxMp}`);
      }
    };
    sync(); return { fixture, game, battle, view, canvas, element, buttons, button, sync, until, roster };
  }
  const probe = h => ({ selected: h.view.selected, actionSource: structuredClone(h.view.actionSource),
    commandId: h.view.commandId, specialInput: h.view.specialInput, revision: h.view.revision,
    units: structuredClone(h.battle.combatants), action: structuredClone(h.battle.action),
    pending: h.battle.pendingActions, players: h.battle.playerExecution,
    events: structuredClone(h.battle.events), timing: h.battle.timingState });
  const rejectRetained = (h, node) => {
    const before = probe(h); node.onclick(); assert.deepEqual(probe(h), before);
  };
  const menu = (h, state, uiWaiting, forceWaiting = false) => {
    assert.equal(h.view.menuState, state);
    assert.equal(h.element("battle-menu").attributes.get("data-menu-state"), state);
    assert.equal(h.battle.timingState.input.uiWaiting, uiWaiting);
    assert.equal(h.battle.timingState.input.forceWaiting, forceWaiting);
  };

  const h = harness(playerSessionFixture([
    { kind: "wait", seconds: 0.04 }, { kind: "add-player", sourceId: 33 },
    { kind: "wait", seconds: 0.06 }, { kind: "change-player-group", group: 1 },
    { kind: "wait", seconds: 0.06 }, { kind: "change-player-group", group: 0 },
    { kind: "add-player", sourceId: 33 },
  ]), 5731);
  let firstGuest, retiredPartyButton, retiredTarget, oldCommand, oldAbility;
  check("joining an owned reserve fills the saved hole and updates actual party rows in slot order", () => {
    h.roster(); assert.deepEqual(h.battle.players.map(player => player.id), ["a", "b"]);
    const initialA = h.view.rows.get("a"), initialB = h.view.rows.get("b");
    h.button("Synthetic command").click(); menu(h, "ability", true);
    oldCommand = h.button("返回"); oldAbility = h.button("Heal · MP 2");
    h.until(() => h.battle.players.some(player => player.sourceId === 33));
    firstGuest = h.battle.players.find(player => player.sourceId === 33);
    assert.equal(firstGuest.id, "player:dynamic:1"); assert.equal(firstGuest.row, "back");
    assert.equal(h.battle.playerOwnedId(firstGuest.id), "guest:33");
    assert.deepEqual(h.battle.players.map(player => player.id), ["a", firstGuest.id, "b"]);
    assert.equal(h.view.rows.get("a"), initialA); assert.equal(h.view.rows.get("b"), initialB);
    h.roster(); menu(h, "ability", true);
    assert.equal(h.element("battle-menu").contains(oldAbility), false);
    rejectRetained(h, oldCommand); rejectRetained(h, oldAbility);
    return { owners: h.battle.players.map(player => h.battle.playerOwnedId(player.id)) };
  });
  check("a changed group removes old rows and target callbacks and releases the retired actor's UI wait", () => {
    retiredPartyButton = h.view.rows.get(firstGuest.id).button;
    h.button("Heal · MP 2").click(); menu(h, "ability-target", true);
    retiredTarget = h.button(firstGuest.name);
    const ownedSnapshot = h.game.state.snapshot();
    h.until(() => h.battle.players.map(player => h.battle.playerOwnedId(player.id)).join(",") === "c,d");
    h.roster(); menu(h, "command", false);
    assert.equal(retiredPartyButton.disabled, true); assert.equal(retiredPartyButton.parentElement, null);
    assert.equal(h.element("battle-menu").contains(retiredTarget), false);
    rejectRetained(h, retiredPartyButton); rejectRetained(h, retiredTarget);
    assert.equal(h.battle.command("a", 10, "e1"), false);
    assert.equal(h.battle.command(firstGuest.id, 11, h.battle.players[0].id, 100), false);
    assert.deepEqual(h.game.state.snapshot(), ownedSnapshot);
    return { removedInstances: ["a", firstGuest.id, "b"] };
  });
  check("reentry creates new runtime identities and clears a retired actor's special force wait", () => {
    assert.equal(h.view.setSpecialInput("slot"), true); menu(h, "slot", false, true);
    const retiredGroupButtons = [...h.view.rows.values()].map(row => row.button);
    const oldIds = h.battle.players.map(player => player.id);
    h.until(() => h.battle.players.some(player => h.battle.playerOwnedId(player.id) === "a"));
    menu(h, "command", false); assert.equal(h.view.specialInput, null);
    for (const node of retiredGroupButtons) {
      assert.equal(node.disabled, true); assert.equal(node.parentElement, null); rejectRetained(h, node);
    }
    h.until(() => h.battle.players.some(player => player.sourceId === 33));
    h.roster(); menu(h, "command", false);
    const guest = h.battle.players.find(player => player.sourceId === 33);
    assert.notEqual(guest.id, firstGuest.id);
    assert.ok(h.battle.players.every(player => player.id.startsWith("player:dynamic:")));
    assert.ok(!h.battle.players.some(player => oldIds.includes(player.id)));
    rejectRetained(h, retiredPartyButton); rejectRetained(h, retiredTarget);
    assert.equal(h.battle.command("a", 10, "e1"), false);
    return { activeInstances: h.battle.players.map(player => player.id), returningGuest: guest.id };
  });
  check("fresh target controls queue the new actor and target IDs while retained controls remain inert", () => {
    const actorId = h.view.selected, guest = h.battle.players.find(player => player.sourceId === 33);
    h.button("Synthetic command").click(); h.button("Heal · MP 2").click();
    menu(h, "ability-target", true);
    const target = h.button(guest.name); assert.notEqual(target, retiredTarget);
    rejectRetained(h, retiredTarget); rejectRetained(h, oldCommand);
    const before = h.battle.pendingActions.length; target.click();
    assert.equal(h.battle.pendingActions.length, before + 1);
    const queued = h.battle.pendingActions.at(-1);
    assert.equal(queued.actor, actorId); assert.deepEqual(queued.targetIds, [guest.id]);
    assert.ok(!["a", "b", firstGuest.id].includes(queued.actor));
    assert.ok(!queued.targetIds.includes(firstGuest.id));
    menu(h, "command", false); rejectRetained(h, retiredTarget);
    return { actor: queued.actor, target: guest.id };
  });
  check("hiding the view releases every UI waiting input without publishing owned state", () => {
    h.button("Synthetic command").click(); menu(h, "ability", true);
    const before = h.game.state.snapshot(); h.view.hide();
    assert.equal(h.view.instance, null); assert.equal(h.view.selected, null);
    assert.equal(h.battle.timingState.input.uiWaiting, false);
    assert.equal(h.battle.timingState.input.forceWaiting, false);
    assert.equal(h.element("battle-ui").hidden, true);
    assert.equal(h.element("battle-result").hidden, true);
    assert.deepEqual(h.game.state.snapshot(), before);
  });

  const f = playerSessionFixture();
  f.battle.common.growth.g.push({ level: 3, hp: 5, mp: 1 });
  f.battle.common.experience.push({ level: 3, exp: 1 });
  const results = harness(f, 5732), leased = results.game.state.snapshot();
  check("victory displays each dynamic and retired owned upgrade name from the real result receipt", () => {
    for (let frame = 0; frame < 20000 && results.battle.phase === "active"; frame++) {
      for (const actor of results.battle.ready) {
        const target = results.battle.targets(actor.id, 10)[0];
        if (target) results.battle.command(actor.id, 10, target.id);
      }
      results.game.advance(10);
    }
    assert.equal(results.battle.phase, "victory");
    const reward = structuredClone(results.battle.reward), receipt = results.battle.previewVictory();
    assert.equal(reward.levels.length, 5);
    assert.ok(results.battle.players.every(player => player.id.startsWith("player:dynamic:")));
    assert.ok(!results.battle.players.some(player => ["c", "d"].includes(results.battle.playerOwnedId(player.id))));
    assert.ok(results.battle.playerExecution.entries.some(entry => entry.removed && entry.ownedId === "c"));
    const expected = reward.levels.map(level => {
      const owned = f.battle.common.players.find(player => player.id === level.id); assert.ok(owned);
      assert.equal(results.battle.resultPlayerName(level.id), owned.name);
      return `${owned.name}  Lv ${level.from} → ${level.to}`;
    }).join(" · ");
    results.sync();
    assert.equal(results.element("battle-levels").textContent, expected);
    assert.equal(results.element("battle-result").hidden, false);
    assert.equal(results.element("battle-ui").hidden, true); menu(results, "none", false);
    assert.doesNotMatch(expected, /undefined|player:dynamic:/);
    results.sync(true); assert.equal(results.element("battle-result").hidden, true);
    results.sync(); assert.equal(results.element("battle-levels").textContent, expected);
    assert.deepEqual(results.battle.reward, reward); assert.deepEqual(results.battle.previewVictory(), receipt);
    assert.deepEqual(results.game.state.snapshot(), leased);
    assert.throws(() => results.battle.resultPlayerName("missing-owned"), /Unknown battle result player/);
    return { upgradedOwners: reward.levels.map(level => level.id), renderedLevels: reward.levels.length };
  });
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  report.inputs = {};
  for (const [key, path] of [["battleView", resolve(root, "apps/game/battle-view.js")],
    ["battleGame", resolve(compiled, "src/core/battle.js")], ["gameSession", resolve(compiled, "src/core/game-session.js")],
    ["playerFixture", resolve(compiled, "tests/fixtures/battle-player-game.js")]])
    report.inputs[key] = sha(await readFile(path));
  report.result = "passed";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, checks: report.checks.length, browserVerified: false }));
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error);
  await writeFile(output, JSON.stringify(report, null, 2) + "\n"); throw error;
}
