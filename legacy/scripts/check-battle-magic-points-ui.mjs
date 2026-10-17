// Controlled DOM with actual BattleView, PartyView, GameSession and BattleGame.
// The fixture is authored and redistributable; this is neither a browser pixel
// check nor evidence that the complete source esper-learning system runs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BattleView } from "../apps/game/battle-view.js";
import { PartyView } from "../apps/game/party-view.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Usage: check-battle-magic-points-ui.mjs [--compiled-dir build/test-output]");
const compiled = resolve(root, args[1] ?? "dist");
const load = (path) => import(pathToFileURL(resolve(compiled, path)));
const [{ GameSession }, { GameFlow }, { GameBattleHandoff }, { characterLearningSessionFixture }, { checkpointFixture }] = await Promise.all([
  load("src/core/game-session.js"), load("src/core/game-flow.js"), load("src/core/game-battle-handoff.js"),
  load("tests/fixtures/character-learning-session.js"),
  load("tests/fixtures/checkpoint-game.js"),
]);

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = new Map(); this.disabled = false; this.hidden = false; this.value = "";
    this.classList = { toggle() {} };
  }
  set textContent(value) { this.value = String(value); this.replaceChildren(); }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(""); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
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
    assert.ok(["button", "button:not(:disabled)", "[data-party-focus]"].includes(selector));
    const matches = node => selector === "[data-party-focus]" ? node.dataset.partyFocus !== undefined
      : node.tagName === "BUTTON" && (selector === "button" || !node.disabled);
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  focus() { document.activeElement = this; }
  getContext() { return {}; }
}
const ids = ["battle-return", "battle-retry", "party", "battle-ui", "battle-result", "battle-result-title",
  "battle-result-text", "battle-levels", "battle-menu", "battle-action"];
const elements = new Map(ids.map(id => [id, new Element()]));
globalThis.document = { activeElement: null,
  getElementById(id) { assert.ok(elements.has(id), id); return elements.get(id); },
  createElement(tag) { return new Element(tag); },
};
const element = id => document.getElementById(id), menuRoot = new Element("section");
const partyView = new PartyView(menuRoot);
const checked = [];
const learningLines = () => menuRoot.textContent.match(/魔法学习值 \d+ \/ 128/g) ?? [];
const record = async (name, run) => { await run(); checked.push(name); };
const frame = { visible: true, mediaReady: true, overlayOpen: false };

function fixture(magicPoints) {
  const f = characterLearningSessionFixture();
  f.battle.encounters[1000].rewardPolicy = { kind: "battle-reward-policy-v1", ap: 0, magicPoints };
  const initial = f.make();
  const game = GameSession.restore(initial.checkpoint(), initial.field.content, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } },
    { battleHandoff: "prepared" });
  const flow = new GameFlow(game); flow.start(); flow.advance(0, frame);
  const handoff = new GameBattleHandoff(flow, {
    async prepareStart() { return {}; }, async prepareReturn() { return {}; }, discard() {},
  });
  return { ...f, game, flow, handoff };
}
async function win(f) {
  assert.equal(f.game.field.startEvent("learning"), true); f.flow.advance(10, frame);
  assert.equal(f.game.battle, null);
  assert.equal((await f.handoff.start()).status, "committed");
  const battle = f.game.battle;
  assert.ok(battle);
  for (let i = 0; i < 50; i++) f.flow.advance(10, frame);
  assert.equal(battle.command(f.id, 10, "e1", 100), true);
  for (let i = 0; i < 200 && battle.phase === "active"; i++) f.flow.advance(10, frame);
  assert.equal(battle.phase, "victory"); assert.ok(battle.reward);
  return battle;
}
async function settle(f) {
  assert.equal(f.game.continueVictory(), false);
  assert.equal((await f.handoff.return()).status, "committed"); f.flow.advance(10, frame);
  assert.equal(f.game.battle, null); assert.equal(f.game.checkpointReady, true);
}

const positive = fixture(5);
await record("the character menu displays a known owned zero without inventing learning progress", () => {
  assert.equal(positive.game.characterMenu(positive.id).magicLearningValue, 0);
  const before = positive.game.state.snapshot();
  partyView.render(positive.game);
  assert.deepEqual(learningLines(), ["魔法学习值 0 / 128"]);
  assert.match(menuRoot.textContent, /MP \d+\/\d+/);
  assert.deepEqual(positive.game.state.snapshot(), before);
});
const positiveBattle = await win(positive);
const battleView = new BattleView(new Element("canvas"), positiveBattle.content, new Map(), () => {}, () => {});
await record("a real victory receipt displays magic-learning points separately from spendable MP", () => {
  assert.equal(positiveBattle.reward.magicPoints, 5);
  const before = positive.game.state.snapshot(), receipt = structuredClone(positiveBattle.reward);
  battleView.sync(positiveBattle, false);
  const result = element("battle-result-text").textContent;
  assert.match(result, /(?:^|\n)5 魔法学习点(?:\n|$)/);
  assert.match(result, /EXP.*Gil/);
  assert.doesNotMatch(result, /5 MP/);
  assert.equal(battleView.rows.get(positive.id).hp.textContent,
    `HP ${positiveBattle.players[0].hp} / ${positiveBattle.players[0].maxHp}\nMP ${positiveBattle.players[0].mp} / ${positiveBattle.players[0].maxMp}`);
  battleView.sync(positiveBattle, true); battleView.sync(positiveBattle, false);
  assert.equal(element("battle-result-text").textContent, result);
  assert.deepEqual(positiveBattle.reward, receipt); assert.deepEqual(positive.game.state.snapshot(), before);
  assert.equal(positive.game.characterMenu(positive.id).magicLearningValue, 0,
    "Rendering a reward must not settle it into the owner");
});
await record("settlement changes the owned value once and repeated menu rendering never accumulates it", async () => {
  await settle(positive);
  assert.equal(positive.game.characterMenu(positive.id).magicLearningValue, 5);
  const before = positive.game.state.snapshot();
  partyView.render(positive.game); partyView.render(positive.game, { disabled: true }); partyView.render(positive.game);
  assert.deepEqual(learningLines(), ["魔法学习值 5 / 128"]);
  assert.deepEqual(positive.game.state.snapshot(), before);
  assert.equal(positive.game.continueVictory(), false);
});

const zero = fixture(0), zeroBattle = await win(zero);
await record("a different zero-reward battle clears the previous positive result instead of retaining it", async () => {
  assert.equal(zeroBattle.reward.magicPoints, 0);
  battleView.sync(zeroBattle, false);
  assert.doesNotMatch(element("battle-result-text").textContent, /魔法学习点/);
  assert.match(element("battle-result-text").textContent, /EXP.*Gil/);
  await settle(zero);
  partyView.render(zero.game);
  assert.deepEqual(learningLines(), ["魔法学习值 0 / 128"]);
});

const full = fixture(128), fullBattle = await win(full);
await record("the result and settled character menu display the supported 128 boundary", async () => {
  assert.equal(fullBattle.reward.magicPoints, 128);
  battleView.sync(fullBattle, false);
  assert.match(element("battle-result-text").textContent, /(?:^|\n)128 魔法学习点(?:\n|$)/);
  await settle(full); partyView.render(full.game);
  assert.equal(full.game.characterMenu(full.id).magicLearningValue, 128);
  assert.deepEqual(learningLines(), ["魔法学习值 128 / 128"]);
});

await record("switching between framework sessions with the same character id does not leak values", () => {
  assert.equal(full.id, positive.id);
  partyView.render(positive.game);
  assert.deepEqual(learningLines(), ["魔法学习值 5 / 128"]);
  partyView.render(zero.game);
  assert.deepEqual(learningLines(), ["魔法学习值 0 / 128"]);
});
await record("a session without source-owned initialization omits learning values and preserves ordinary MP", () => {
  const f = checkpointFixture(), game = new GameSession(f.field, f.battle, 31);
  const id = game.partyMenu().cells.find(cell => cell.id !== null).id;
  assert.equal(game.characterMenu(id).magicLearningValue, null);
  const before = game.state.snapshot();
  partyView.render(game);
  assert.deepEqual(learningLines(), []); assert.doesNotMatch(menuRoot.textContent, /魔法学习值|null|undefined/);
  assert.match(menuRoot.textContent, /MP \d+\/\d+/);
  assert.deepEqual(game.state.snapshot(), before);
});
await record("a real checkpoint restores the owned value and menu reset reads only that new owner", () => {
  const saved = positive.game.checkpoint();
  const restored = GameSession.restore(saved, positive.game.field.content, positive.battle,
    { catalog: positive.world, map: positive.map, source: { content: positive.content, initialMap: positive.map } });
  assert.equal(restored.characterMenu(positive.id).magicLearningValue, 5);
  partyView.reset(); partyView.render(restored);
  assert.deepEqual(learningLines(), ["魔法学习值 5 / 128"]);
  assert.deepEqual(restored.checkpoint(), saved);
});

const sha = value => createHash("sha256").update(value).digest("hex");
const report = { kind: "controlled-battle-magic-points-ui", result: "passed", scenarios: checked.length, checked,
  evidence: "Actual BattleView and PartyView with real prepared GameSession, started GameFlow, GameBattleHandoff, BattleGame, owned settlement and restore; authored framework fixture with ready controlled presentation host",
  viewSha256: {
    battle: sha(await readFile(resolve(root, "apps/game/battle-view.js"))),
    party: sha(await readFile(resolve(root, "apps/game/party-view.js"))),
  },
  browserRendering: false, originalRuntimeParity: false, completeEsperLearning: false };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/battle-magic-points-ui-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ scenarios: checked.length, result: report.result }));
