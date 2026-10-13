import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PartyView } from "../apps/game/party-view.js";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), options = new Map();
for (let index = 0; index < args.length; index += 2) {
  assert.ok(["--dist", "--report"].includes(args[index]) && args[index + 1] && !options.has(args[index]));
  options.set(args[index], args[index + 1]);
}
const compiled = resolve(rootPath, options.get("--dist") ?? "dist");
const load = path => import(pathToFileURL(resolve(compiled, path)));
const { characterLearningSessionFixture } = await load("tests/fixtures/character-learning-session.js");
const { GameSession } = await load("src/core/game-session.js");
const { GameFlow } = await load("src/core/game-flow.js");
const { GameCommands } = await load("src/core/game-commands.js");

// This is the existing controlled DOM harness, with actual owner/Flow/gateway
// objects. It neither decodes images nor establishes browser/native behavior.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = new Map(); this.disabled = false; this.text = ""; this.value = ""; }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  remove() { if (this.parentElement) { const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.text = ""; this.append(...children); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) { assert.equal(selector, "[data-party-focus]");
    return this.children.flatMap(child => [...(child.dataset.partyFocus ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.onclick?.(); } }
}
globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
const walk = node => [node, ...node.children.flatMap(walk)];
const host = { visible: true, mediaReady: true, overlayOpen: false };
const cases = [], observations = [];
const check = (name, run) => { run(); cases.push(name); };

function fixture() {
  const f = characterLearningSessionFixture();
  const held = f.battle.gameState.characterInitializations[f.id].initial.abilities.owned
    .find(ability => ability.skillLevel === 100 && ability.contentId > 0);
  assert.ok(held, "The existing controlled initializer owns a learned skill");
  const commandId = f.battle.gameState.characterInitializations[f.id].initial.abilities.commandIds[0];
  const command = f.battle.common.battleAbilities.commands.find(command => command.id === commandId);
  assert.ok(command);
  // The field effect/catalog is authored test input. The existing owned skill,
  // native-state ledger, equipment and growth are preserved without a grant.
  const blocked = f.battle.gameState.characterInitializations[f.id].initial.abilities.owned
    .find(ability => ability.skillLevel === 100 && ability.abilityId !== held.abilityId);
  const catalog = {
    kind: "field-abilities-v1", rules: { kind: "field-ability-rules-v1", profile: "framework",
      random: { kind: "web-field-random-v1", seed: 0x71f6c0de } },
    commands: [{ ...structuredClone(command), abilityTypes: [604], blockers: [] }],
    abilities: { [held.abilityId]: { id: held.abilityId, contentId: held.contentId, name: "受控恢复技能",
      typeId: 604, menuFunctionGroupId: 70001, menuRange: 6, cost: 5, power: 1,
      program: { groupId: 70001, range: 6, functions: [
        { slot: 1, functionId: 1, type: 1, series: 0, values: [2, 2, 0] },
        { slot: 2, functionId: 23, type: 23, series: 0, values: [0, 0, 0] }],
        process: { key: "None", values: [0, 0, 0] }, forbiddenConditionIds: [], contentFlags: [1] },
      plan: { kind: "field-ability-plan-v1", modes: ["single", "all"],
        effects: [{ slot: 1, kind: "recovery", resource: "hp", calculation: "magic" },
          { slot: 2, kind: "field-unique-none", resultType: 2 }],
        magic: { accuracy: 255, contentFlags: [1], forceDefense: false, elements: [] } }, blockers: [] } },
  };
  if (blocked) catalog.abilities[blocked.abilityId] = { id: blocked.abilityId, contentId: blocked.contentId,
    name: "受控未实现技能", typeId: 604, menuFunctionGroupId: 70002, menuRange: 1, cost: 5, power: 0,
    program: { groupId: 70002, range: 1, functions: [
      { slot: 1, functionId: 28, type: 28, series: 0, values: [5001, 0, 0] }],
      process: { key: "None", values: [0, 0, 0] },
      forbiddenConditionIds: [], contentFlags: [] }, plan: null, blockers: ["Controlled field program is unavailable"] };
  f.battle.gameState.fieldAbilities = catalog;
  const fresh = f.make(), checkpoint = fresh.checkpoint();
  const member = checkpoint.owned.roster.find(member => member.id === f.id);
  member.hp = Math.trunc(member.maxHp / 2);
  const restore = saved => GameSession.restore(saved, fresh.field.content, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  return { ...f, held, blocked, catalog, restore, game: restore(checkpoint) };
}
function menu(f) {
  const game = f.game, flow = new GameFlow(game); flow.start(game, { paused: true }); flow.observeHost(host);
  const commands = new GameCommands(flow, game), root = new Element("section"); let changed = 0;
  const view = new PartyView(root, () => { changed++; }, { commands, owner: game }); view.render(game);
  const find = key => { const item = walk(root).find(item => item.dataset.partyFocus === key);
    assert.ok(item, "Missing actual menu control: " + key); return item; };
  const select = (kind = "single") => { find(`field-ability-${f.held.abilityId}`).click();
    find(`field-target-${kind === "all" ? "all" : f.id}`).click(); return find("field-cast-confirm"); };
  return { ...f, game, flow, commands, root, view, find, select, changed: () => changed };
}
const member = h => h.game.state.snapshot().roster.find(member => member.id === h.id);

check("owned skill and fee previews plus target selection/cancel are read-only with zero random draws", () => {
  const h = menu(fixture()), before = h.game.checkpoint();
  assert.ok(h.find(`field-ability-${h.held.abilityId}`).textContent.includes("MP 5"));
  assert.equal(h.find(`field-ability-${h.held.abilityId}`).disabled, false);
  h.select(); assert.deepEqual(h.game.checkpoint(), before);
  const old = h.find("field-cast-confirm"); h.find("field-cast-cancel").click(); old.onclick();
  assert.deepEqual(h.game.checkpoint(), before); assert.equal(h.changed(), 0);
});
check("single cast goes through the actual gateway and pays once with effects and the owned random stream", () => {
  const h = menu(fixture()), before = h.game.state.snapshot(), confirm = h.select();
  confirm.click(); const after = h.game.state.snapshot();
  assert.ok(after.roster[0].hp > before.roster[0].hp);
  assert.equal(after.roster[0].mp, before.roster[0].mp - 5);
  assert.ok(after.fieldRandom.draws > before.fieldRandom.draws);
  for (const key of ["abilities", "equipment", "growth", "ownedId", "ownedJobs"])
    assert.deepEqual(after.roster[0][key], before.roster[0][key]);
  confirm.onclick(); assert.deepEqual(h.game.state.snapshot(), after); assert.equal(h.changed(), 1);
  observations.push({ selection: "single", abilityId: h.held.abilityId, hpBefore: before.roster[0].hp,
    hpAfter: after.roster[0].hp, mpBefore: before.roster[0].mp, mpAfter: after.roster[0].mp,
    draws: after.fieldRandom.draws - before.fieldRandom.draws });
});
check("an explicit all-party choice retains its identity even for this one-member controlled party", () => {
  const h = menu(fixture()), before = h.game.state.snapshot();
  h.select("all"); assert.deepEqual(h.view.abilityDraft.selection, { kind: "all" });
  assert.deepEqual(h.view.abilityDraft.targetIds, [h.id]);
  h.find("field-cast-confirm").click();
  assert.ok(member(h).hp > before.roster[0].hp); assert.equal(member(h).mp, before.roster[0].mp - 5);
  assert.equal(h.changed(), 1);
});
check("blocked field programs stay visible and never become an action through a retained disabled callback", () => {
  const h = menu(fixture()), before = h.game.checkpoint(); assert.ok(h.blocked);
  const button = h.find(`field-ability-${h.blocked.abilityId}`);
  assert.equal(button.disabled, true); assert.ok(h.root.textContent.includes("Controlled field program is unavailable"));
  button.onclick(); assert.deepEqual(h.game.checkpoint(), before); assert.equal(h.view.abilityDraft, null);
});
check("a changed MP owner is requalified before confirmation without another draw or payment", () => {
  const h = menu(fixture()), old = h.select(), saved = h.game.state.snapshot(); saved.roster[0].mp = 0;
  h.game.state.restore(saved); const before = h.game.checkpoint(); old.onclick();
  assert.deepEqual(h.game.checkpoint(), before); assert.equal(h.changed(), 0);
  assert.equal(h.find(`field-ability-${h.held.abilityId}`).disabled, true);
});
check("the all-three-group party baseline cannot be silently updated by an old field confirmation", () => {
  const h = menu(fixture()), old = h.select("all");
  const party = h.game.partyMenu();
  assert.equal(h.commands.changeParty({ expected: party.expected,
    change: { kind: "set-row", position: 0, row: party.cells[0].row === "front" ? "back" : "front" } }), true);
  const before = h.game.checkpoint(); old.onclick(); assert.deepEqual(h.game.checkpoint(), before);
  assert.ok(h.root.textContent.includes("技能或目标已变化，请重新选择。"));
});
check("background admission immediately rejects a captured field confirmation and resumes through the real host", () => {
  const h = menu(fixture()), old = h.select(), before = h.game.checkpoint();
  h.flow.observeHost({ visible: false, mediaReady: false, overlayOpen: false }); old.onclick();
  assert.deepEqual(h.game.checkpoint(), before); assert.equal(h.changed(), 0);
  h.flow.observeHost(host); h.view.render(h.game); h.find("field-cast-confirm").click(); assert.equal(h.changed(), 1);
});
check("an in-flight restore operation rejects field commands before any owner publication", () => {
  const h = menu(fixture()), old = h.select(), before = h.game.checkpoint();
  const ticket = h.flow.beginOperation("load"); old.onclick(); assert.deepEqual(h.game.checkpoint(), before);
  ticket.cancel();
  assert.deepEqual(h.game.checkpoint(), before); assert.equal(h.changed(), 0);
});
check("complete restore preserves casting state and future random draws while revoking old owner callbacks", () => {
  const h = menu(fixture()); h.select().click(); const saved = h.game.checkpoint(), old = h.select();
  const expected = h.restore(saved), restored = h.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
  h.flow.start(restored, { paused: true }); h.flow.observeHost(host); old.onclick();
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(h.game.checkpoint(), saved);
  const fresh = { ...h, game: restored }, next = menu(fresh); next.select().click();
  assert.equal(expected.useMenuAbility({ actorId: h.id, abilityId: h.held.abilityId,
    selection: { kind: "single", id: h.id } }), true);
  assert.deepEqual(restored.state.snapshot(), expected.state.snapshot());
  assert.equal(h.commands.menuReady, false);
});
check("a status-changing field effect prepares the actual actor before publishing owned state or randomness", () => {
  const h = menu(fixture()), saved = h.game.checkpoint();
  const dying = h.battle.common.conditions.rules.definitions.find(row => row.type === 4); assert.ok(dying);
  saved.owned.roster[0].hp = 10; saved.owned.roster[0].conditionIds = [dying.id];
  const game = h.restore(saved), next = menu({ ...h, game }); let prepares = 0;
  game.field.prepareMenuPartyAppearance = () => { prepares++; throw new Error("Controlled appearance preparation failure"); };
  const before = game.checkpoint(); next.select().click();
  assert.equal(prepares, 1); assert.deepEqual(game.checkpoint(), before); assert.equal(next.changed(), 0);
  assert.ok(next.root.textContent.includes("地图角色状态尚未就绪"));
});

const report = { kind: "field-abilities-ui-check-v1", result: "passed", tests: cases,
  lane: "controlled-DOM-real-session-flow-and-commands", browserVerified: false, semanticsVerified: false,
  originalGameExecuted: false, observations,
  viewSha256: createHash("sha256").update(await readFile(resolve(rootPath, "apps/game/party-view.js"))).digest("hex"),
  scope: "Authored field program on existing synthetic owned initialization; no skill grant or source story claim",
  doesNotEstablish: ["browser rendering", "image decode", "native preview RNG parity", "source-story reachability",
    "all original field abilities", "one-member all choice as original target UI parity"] };
const output = resolve(rootPath, options.get("--report") ?? "build/reports/field-abilities-ui-check.json");
await mkdir(resolve(output, ".."), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, checks: cases.length, report: output }));
