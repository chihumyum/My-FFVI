import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MagicStoneView } from "../apps/game/magic-stones-view.js";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), options = new Map();
for (let index = 0; index < args.length; index += 2) {
  assert.ok(["--dist", "--report"].includes(args[index]) && args[index + 1] && !options.has(args[index]));
  options.set(args[index], args[index + 1]);
}
const compiled = resolve(rootPath, options.get("--dist") ?? "dist");
const load = path => import(pathToFileURL(resolve(compiled, path)));
const { magicStonesSessionFixture } = await load("tests/fixtures/magic-stones-session.js");
const { checkpointFixture } = await load("tests/fixtures/checkpoint-game.js");
const { magicStoneCatalogFixture } = await load("tests/fixtures/magic-stones.js");
const { GameSession } = await load("src/core/game-session.js");
const { GameFlow } = await load("src/core/game-flow.js");
const { GameCommands } = await load("src/core/game-commands.js");

// Controlled DOM only. All capability, ownership, mutation, persistence and
// input-admission decisions below use the actual session and command gateway.
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = new Map(); this.disabled = false; this.hidden = false; this.text = "";
  }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  remove() { if (this.parentElement) { const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.text = ""; this.append(...children); }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) {
    assert.equal(selector, "[data-magic-stone-focus]");
    return this.children.flatMap(child => [...(child.dataset.magicStoneFocus ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.onclick?.(); } }
}
globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
const walk = node => [node, ...node.children.flatMap(walk)];
const host = { visible: true, mediaReady: true, overlayOpen: false };
const cases = [], observations = [];
const check = (name, run) => { run(); cases.push(name); };
const snapshot = game => game.state.snapshot();
const member = (game, id) => snapshot(game).roster.find(member => member.id === id);
function mount(game, playerId, gateway = true) {
  const flow = new GameFlow(game); flow.start(game, { paused: true }); flow.observeHost(host);
  const commands = new GameCommands(flow, game), root = new Element("section"); let changes = 0;
  const view = new MagicStoneView(root, () => changes++, gateway ? { commands, owner: game } : {});
  view.render(game, playerId);
  const find = key => { const found = walk(root).find(element => element.dataset.magicStoneFocus === key);
    assert.ok(found, "Missing actual magic stone control: " + key); return found; };
  return { game, playerId, flow, commands, root, view, find, changes: () => changes };
}
function fixture(held = true) {
  const f = magicStonesSessionFixture(), game = f.make();
  const playerId = f.playerIds[0], otherId = f.playerIds[1], stoneId = f.stoneIds[0];
  assert.ok(playerId && otherId && stoneId);
  assert.equal(snapshot(game).initialization, "source-new-game");
  assert.notEqual(snapshot(game).nativeState, null);
  assert.deepEqual(snapshot(game).nativeState.ownedMagicStones, []);
  if (held) grant(game, stoneId);
  return { ...f, game, playerId, otherId, stoneId };
}
function grant(game, id) {
  // An explicit test acquisition through the shared inventory owner; the UI
  // never grants an item and this does not claim an original story acquisition.
  const transaction = game.state.fieldInventory.prepare({ kind: "grant-magic-stone", id, count: 1 });
  transaction.commit();
}

check("legacy content hides the component without introducing a native domain or held inventory", () => {
  const f = checkpointFixture(), before = snapshot(f.game), h = mount(f.game, before.roster[0].id);
  assert.equal(h.root.hidden, true); assert.equal(h.root.children.length, 0);
  assert.deepEqual(snapshot(f.game), before);
});
check("a catalog alone does not authorize magic stone ownership in a native-null development owner", () => {
  const f = checkpointFixture(); f.battle.gameState.magicStones = magicStoneCatalogFixture();
  const game = new GameSession(f.field, f.battle, 314), before = snapshot(game), h = mount(game, before.roster[0].id);
  assert.equal(before.nativeState, null); assert.equal(game.magicStoneMenu(h.playerId).available, false);
  assert.equal(h.root.hidden, true); assert.deepEqual(snapshot(game), before);
});
check("a fresh capable native owner displays an empty held list without granting or learning", () => {
  const f = fixture(false), before = snapshot(f.game), h = mount(f.game, f.playerId);
  assert.equal(h.root.hidden, false); assert.ok(h.root.textContent.includes("尚未取得魔石"));
  assert.equal(walk(h.root).filter(element => element.dataset.magicStone).length, 0);
  h.find("remove").onclick(); assert.deepEqual(snapshot(f.game), before); assert.equal(h.changes(), 0);
});
check("only actually acquired stones are displayed with learning rates and future level bonuses", () => {
  const f = fixture(), before = snapshot(f.game), h = mount(f.game, f.playerId);
  const model = f.game.magicStoneMenu(f.playerId), stone = model.stones[0];
  assert.deepEqual(walk(h.root).filter(element => element.dataset.magicStone).map(element => Number(element.dataset.magicStone)), [f.stoneId]);
  assert.equal(h.find(`stone-${f.stoneId}`).disabled, false);
  assert.ok(h.root.textContent.includes(stone.name));
  for (const skill of stone.learning) {
    assert.ok(h.root.textContent.includes(`每魔法点 +${skill.rate}%`));
    assert.ok(h.root.textContent.includes(skill.skillLevel === 100 ? "已习得" : `学习 ${skill.skillLevel}%`));
  }
  assert.ok(h.root.textContent.includes("升级奖励")); assert.ok(h.root.textContent.includes("战斗召唤尚未开放"));
  assert.equal(walk(h.root).some(element => element.tagName === "BUTTON" && element.textContent.includes("召唤")), false);
  assert.deepEqual(snapshot(f.game), before);
});
check("an unknown selected character cannot use enabled-looking held data to mutate another owner", () => {
  const f = fixture(), before = snapshot(f.game), h = mount(f.game, "missing-owner");
  assert.equal(f.game.magicStoneMenu("missing-owner").canEquip, false);
  assert.equal(h.find(`stone-${f.stoneId}`).disabled, true); h.find(`stone-${f.stoneId}`).onclick();
  assert.deepEqual(snapshot(f.game), before); assert.equal(h.changes(), 0);
});
check("the actual gateway equips once; a repeated retained click cannot undo it or grant a skill", () => {
  const f = fixture(), h = mount(f.game, f.playerId), before = snapshot(f.game), old = h.find(`stone-${f.stoneId}`);
  old.click(); const after = snapshot(f.game);
  assert.equal(member(f.game, f.playerId).magicStoneId, f.stoneId);
  assert.deepEqual(after.nativeState.ownedMagicStones, before.nativeState.ownedMagicStones);
  assert.deepEqual(member(f.game, f.playerId).abilities.owned, before.roster.find(member => member.id === f.playerId).abilities.owned);
  for (const field of ["hp", "mp", "maxHp", "maxMp", "level", "exp"])
    assert.equal(member(f.game, f.playerId)[field], before.roster.find(member => member.id === f.playerId)[field]);
  old.onclick(); assert.deepEqual(snapshot(f.game), after); assert.equal(h.changes(), 1);
  assert.ok(h.root.textContent.includes("魔石已装备"));
});
check("the current stone click and explicit remove both use the same owned unequip transaction", () => {
  const f = fixture(), h = mount(f.game, f.playerId);
  h.find(`stone-${f.stoneId}`).click(); h.find(`stone-${f.stoneId}`).click();
  assert.equal(member(f.game, f.playerId).magicStoneId, 0); assert.ok(h.root.textContent.includes("魔石已卸下"));
  h.find(`stone-${f.stoneId}`).click(); const remove = h.find("remove"); remove.click();
  const after = snapshot(f.game); remove.onclick(); assert.deepEqual(snapshot(f.game), after);
  assert.deepEqual(after.nativeState.ownedMagicStones, [f.stoneId]); assert.equal(h.changes(), 4);
});
check("held transfers affect the two original owners once and reject a stale first-owner button", () => {
  const f = fixture(), first = mount(f.game, f.playerId);
  first.find(`stone-${f.stoneId}`).click(); const old = first.find(`stone-${f.stoneId}`);
  const second = mount(f.game, f.otherId);
  assert.ok(second.root.textContent.includes(member(f.game, f.playerId).name));
  second.find(`stone-${f.stoneId}`).click();
  assert.equal(member(f.game, f.playerId).magicStoneId, 0); assert.equal(member(f.game, f.otherId).magicStoneId, f.stoneId);
  const after = snapshot(f.game); old.onclick(); assert.deepEqual(snapshot(f.game), after);
  assert.ok(first.root.textContent.includes("魔石或角色状态已变化"));
  assert.equal(snapshot(f.game).roster.filter(member => member.magicStoneId === f.stoneId).length, 1);
  observations.push({ operation: "transfer", from: f.playerId, to: f.otherId, contentId: f.stoneId });
});
check("the entire held menu baseline is rechecked when another stone is acquired after render", () => {
  const f = fixture(), h = mount(f.game, f.playerId), old = h.find(`stone-${f.stoneId}`);
  assert.ok(f.stoneIds[1]); grant(f.game, f.stoneIds[1]); const after = snapshot(f.game);
  old.onclick(); assert.deepEqual(snapshot(f.game), after); assert.equal(h.changes(), 0);
  assert.ok(h.root.textContent.includes("魔石或角色状态已变化"));
  h.find(`stone-${f.stoneId}`).click(); assert.equal(member(f.game, f.playerId).magicStoneId, f.stoneId);
});
check("switching the viewed actor revokes old callbacks even after returning to the same actor", () => {
  const f = fixture(), h = mount(f.game, f.playerId), old = h.find(`stone-${f.stoneId}`), before = snapshot(f.game);
  h.view.render(f.game, f.otherId); old.onclick(); h.view.render(f.game, f.playerId); old.onclick();
  assert.deepEqual(snapshot(f.game), before); assert.equal(h.changes(), 0);
});
check("explicit disabled renders and reset revoke retained actions", () => {
  const f = fixture(), h = mount(f.game, f.playerId), old = h.find(`stone-${f.stoneId}`), before = snapshot(f.game);
  h.view.render(f.game, f.playerId, { disabled: true }); old.onclick(); h.find(`stone-${f.stoneId}`).onclick();
  assert.deepEqual(snapshot(f.game), before);
  h.view.render(f.game, f.playerId); old.onclick(); assert.deepEqual(snapshot(f.game), before);
  const fresh = h.find(`stone-${f.stoneId}`); h.view.reset(); fresh.onclick();
  assert.equal(h.root.hidden, true); assert.equal(h.root.children.length, 0); assert.deepEqual(snapshot(f.game), before);
});
check("live host and I/O gates reject buttons retained without a UI rerender", () => {
  const f = fixture(), h = mount(f.game, f.playerId), old = h.find(`stone-${f.stoneId}`), before = snapshot(f.game);
  for (const unavailable of [{ ...host, visible: false }, { ...host, mediaReady: false }, { ...host, overlayOpen: true }]) {
    h.flow.observeHost(unavailable); old.onclick(); assert.deepEqual(snapshot(f.game), before);
  }
  h.flow.observeHost(host); const ticket = h.flow.beginOperation("load"); old.onclick();
  assert.deepEqual(snapshot(f.game), before); ticket.cancel(); h.flow.returnToTitle(); old.onclick();
  assert.deepEqual(snapshot(f.game), before); assert.equal(h.changes(), 0);
});
check("publishing another session never redirects an old owner's magic stone action", () => {
  const f = fixture(), h = mount(f.game, f.playerId), old = h.find(`stone-${f.stoneId}`);
  const next = f.make(), before = snapshot(f.game), nextBefore = snapshot(next);
  h.flow.start(next, { paused: true }); h.flow.observeHost(host); old.onclick();
  assert.deepEqual(snapshot(f.game), before); assert.deepEqual(snapshot(next), nextBefore);
  assert.equal(h.commands.menuReady, false); assert.equal(h.changes(), 0);
});
check("the explicit session fallback uses real mutations and rejects callbacks after reset", () => {
  const f = fixture(), h = mount(f.game, f.playerId, false), old = h.find(`stone-${f.stoneId}`);
  old.click(); assert.equal(member(f.game, f.playerId).magicStoneId, f.stoneId);
  const after = snapshot(f.game); old.onclick(); h.view.reset(); old.onclick(); assert.deepEqual(snapshot(f.game), after);
  assert.equal(h.changes(), 1);
});
check("battle-earned partial learning is read from the same owner and survives restore before mastery", () => {
  const f = fixture(), h = mount(f.game, f.playerId);
  h.find(`stone-${f.stoneId}`).click(); const old = h.find(`stone-${f.stoneId}`);
  const skillId = f.game.magicStoneMenu(f.playerId).stones.find(stone => stone.contentId === f.stoneId).learning[0].abilityId;
  f.win(f.game);
  const partial = member(f.game, f.playerId).abilities.owned.find(ability => ability.abilityId === skillId);
  assert.equal(partial.skillLevel, 50);
  const afterBattle = snapshot(f.game); old.onclick(); assert.deepEqual(snapshot(f.game), afterBattle);
  assert.ok(h.root.textContent.includes("学习 50%"));
  const checkpoint = f.game.checkpoint(), restored = f.restore(checkpoint);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  const next = mount(restored, f.playerId); assert.ok(next.root.textContent.includes("学习 50%"));
  const partialButton = next.find(`stone-${f.stoneId}`);
  f.win(restored); const mastered = snapshot(restored); partialButton.onclick();
  assert.deepEqual(snapshot(restored), mastered);
  assert.equal(member(restored, f.playerId).abilities.owned.find(ability => ability.abilityId === skillId).skillLevel, 100);
  assert.ok(next.root.textContent.includes("已习得"));
  next.find("remove").click();
  assert.equal(member(restored, f.playerId).magicStoneId, 0);
  assert.equal(member(restored, f.playerId).abilities.owned.find(ability => ability.abilityId === skillId).skillLevel, 100);
  observations.push({ operation: "learn-save-restore", abilityId: skillId, partial: 50, mastered: 100 });
});

const report = { kind: "magic-stones-ui-check-v1", result: "passed", cases, observations,
  lane: "controlled-DOM-real-source-initialized-session-flow-and-commands",
  browserVerified: false, semanticsVerified: false, originalGameExecuted: false,
  viewSha256: createHash("sha256").update(await readFile(resolve(rootPath, "apps/game/magic-stones-view.js"))).digest("hex"),
  scope: "Authored native-state/new-game fixture and explicit test acquisition through the shared inventory owner; the UI grants nothing",
  doesNotEstablish: ["original story acquisition", "native menu parity", "browser layout or media decode", "battle summon execution"] };
const output = resolve(rootPath, options.get("--report") ?? "build/reports/magic-stones-ui-check.json");
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, checks: cases.length, report: output }));
