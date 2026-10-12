import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PartyView } from "../apps/game/party-view.js";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--field", "--catalog", "--report"].includes(args[i]) && args[i + 1] && !options.has(args[i]));
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(rootPath, options.get("--dist") ?? "dist");
const load = (path) => import(pathToFileURL(resolve(compiled, path)));
const { partyMenuFixture } = await load("tests/fixtures/party-menu.js");
const { GameSession } = await load("src/core/game-session.js");
const { verifyContent } = await load("src/core/content-integrity.js");

// Controlled DOM exercises the actual view and session. It is not a rendered
// browser or original-game execution, and never supplies a missing actor host.
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = new Map(); this.disabled = false; this.value = "";
  }
  set textContent(value) { this.value = String(value); this.replaceChildren(); }
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(""); }
  append(...children) {
    for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
    }
  }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) {
    assert.equal(selector, "[data-party-focus]");
    return this.children.flatMap((child) => [...(child.dataset.partyFocus ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  focus() { document.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.onclick?.(); } }
}
globalThis.document = { createElement: (tag) => new Element(tag), activeElement: null };
const root = new Element("section"), checks = [];
let notifications = 0;
const view = new PartyView(root, () => { notifications++; });
const walk = (node) => [node, ...node.children.flatMap(walk)];
const find = (key) => {
  const node = walk(root).find((element) => element.dataset.partyFocus === key);
  assert.ok(node, "Missing menu button: " + key); return node;
};
const check = (name, run) => { run(); checks.push(name); };
const fixture = partyMenuFixture(), game = fixture.game;
view.render(game);

check("sorting uses the real session and refreshes the playable actor", () => {
  find("swap-0-1").click();
  assert.deepEqual(game.state.activeParty.map((p) => p.id), ["b", "a"]);
  assert.equal(game.field.player.asset, "bravo");
  assert.equal(notifications, 1);
});
check("row changes retain owned identity and persist through a complete checkpoint", () => {
  find("row-0").click();
  assert.equal(game.state.activeParty[0].row, "back");
  const saved = game.checkpoint();
  assert.deepEqual(GameSession.restore(saved, fixture.field, fixture.battle).checkpoint(), saved);
});
check("retained buttons cannot overwrite a newer party baseline", () => {
  const stale = find("swap-0-1");
  find("row-1").click();
  const before = game.checkpoint(), count = notifications;
  stale.onclick();
  assert.deepEqual(game.checkpoint(), before); assert.equal(notifications, count);
  assert.ok(root.textContent.includes("编队已变化，请重新选择。"));
});
check("I/O disabled state also rejects retained callbacks", () => {
  const retained = find("swap-0-1"), before = game.checkpoint();
  view.render(game, { disabled: true });
  assert.equal(find("swap-0-1").disabled, true);
  retained.onclick(); assert.deepEqual(game.checkpoint(), before);
  view.render(game);
});
check("session replacement invalidates old callbacks even when parties have identical names", () => {
  const retained = find("swap-0-1"), replacement = partyMenuFixture().game;
  const before = replacement.checkpoint();
  view.render(replacement); retained.onclick();
  assert.deepEqual(replacement.checkpoint(), before);
  view.render(game);
});
check("a missing replacement bitmap leaves owned and actor state unchanged with a short error", () => {
  const bad = partyMenuFixture(); delete bad.field.characters.bravo;
  const before = bad.game.checkpoint(); view.render(bad.game); find("swap-0-1").click();
  assert.deepEqual(bad.game.checkpoint(), before);
  assert.ok(root.textContent.includes("当前无法调整编队，原编队已保留。"));
  assert.equal(root.textContent.includes("Missing party appearance"), false);
});

const readVerified = async (path) => verifyContent(JSON.parse(await readFile(resolve(rootPath, path), "utf8")));
const field = await readVerified(options.get("--field") ?? "build/game/narshe.json");
const catalog = await readVerified(options.get("--catalog") ?? "build/game/opening-playable.json");
const sourceGame = new GameSession(field, catalog), before = sourceGame.state.snapshot();
assert.equal(catalog.common.fieldSourceSetHash, field.sourceSetHash);
const sourceChanges = [];
view.render(sourceGame);
check("published development checkpoint exposes only its actual owned roster and skill progress", () => {
  assert.equal(sourceGame.partyMenu().editable, true);
  assert.deepEqual(sourceGame.partyMenu().roster.map((p) => p.id), before.roster.map((p) => p.id));
  for (const member of before.roster) {
    const details = sourceGame.characterMenu(member.id);
    assert.equal(details.abilities.length, member.abilities.owned.length);
    assert.deepEqual(details.abilities.map((row) => [row.id, row.skillLevel]),
      member.abilities.owned.map((row) => [row.abilityId, row.skillLevel]));
    assert.equal(details.level, member.level); assert.equal(details.exp, member.exp);
  }
  assert.equal(walk(root).filter((element) => element.dataset.partyAbility).length, before.roster[0].abilities.owned.length);
  assert.ok(walk(root).filter((element) => element.dataset.partyAbility).every((element) => element.tagName === "LI" &&
    !element.children.some((child) => child.tagName === "BUTTON")), "Ability records must not grant a field cast action");
});
check("published menu changes the actual mounted leader without touching inventory or ability ownership", () => {
  const oldAsset = sourceGame.field.player.asset, oldMount = sourceGame.field.player.mount;
  const actualPrepare = sourceGame.field.prepareMenuPartyAppearance.bind(sourceGame.field);
  let observedNewOwner = false;
  sourceGame.field.prepareMenuPartyAppearance = (appearance) => {
    const publication = actualPrepare(appearance);
    return Object.assign(() => {
      observedNewOwner = sourceGame.state.activeParty[0].id === before.party.slots[before.party.selectedSlot][1].id;
      publication();
    }, { validate: publication.validate });
  };
  find("swap-0-1").click();
  sourceGame.field.prepareMenuPartyAppearance = actualPrepare;
  assert.equal(observedNewOwner, true, "Actual actor publication ran after the owned revision update and accepted it");
  assert.notEqual(sourceGame.field.player.asset, oldAsset);
  assert.equal(sourceGame.field.player.mount, oldMount);
  assert.deepEqual(sourceGame.state.snapshot().roster, before.roster);
  assert.deepEqual(sourceGame.state.snapshot().equipmentStock, before.equipmentStock);
  sourceChanges.push({ kind: "leader-swap", asset: sourceGame.field.player.asset, mount: sourceGame.field.player.mount });
});
check("published rear row and empty-cell order restore and enter battle with current positions", () => {
  find("row-0").click();
  find("swap-2-3").click();
  const saved = sourceGame.checkpoint(), restored = GameSession.restore(saved, field, catalog);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.state.activeParty[0].row, "back");
  assert.deepEqual(restored.state.activeParty.map((p) => p.index), [0, 1, 3]);
  const encounterId = Number(Object.keys(catalog.encounters)[0]);
  // This is a controlled battle handoff, not a claim that this map script ran.
  restored.field.stop = { kind: "encounter", message: "Controlled party menu entry", site: null,
    party: encounterId, continuation: null };
  restored.advance(10);
  assert.ok(restored.battle, restored.field.stop?.message);
  assert.deepEqual(restored.battle.players.map((p) => [p.id, p.row]), restored.state.activeParty.map((p) => [p.id, p.row]));
  sourceChanges.push({ kind: "restored-entry", encounterId, participants: restored.battle.players.map((p) => ({ id: p.id, row: p.row })) });
});
check("published mounted leader moved into the empty position updates the actual field owner and restore", () => {
  const sparse = new GameSession(field, catalog), initial = sparse.state.activeParty;
  const firstAsset = sparse.field.player.asset;
  assert.equal(sparse.changeParty({ expected: sparse.partyMenu().expected,
    change: { kind: "swap", from: 0, to: 3 } }), true);
  assert.deepEqual(sparse.state.activeParty.map((p) => [p.id, p.index]),
    [[initial[1].id, 1], [initial[2].id, 2], [initial[0].id, 3]]);
  assert.equal(sparse.field.partyActorCheckpoint.context.leaderIndex, 1);
  assert.notEqual(sparse.field.player.asset, firstAsset);
  const saved = sparse.checkpoint();
  assert.deepEqual(GameSession.restore(saved, field, catalog).checkpoint(), saved);
  sourceChanges.push({ kind: "leader-to-empty", asset: sparse.field.player.asset,
    leaderIndex: sparse.field.partyActorCheckpoint.context.leaderIndex });
});

const report = {
  kind: "party-menu-ui-check-v1", result: "passed", checks: checks.length, cases: checks,
  lane: "controlled-DOM-and-actual-development-content", semanticsVerified: false,
  fieldHash: field.contentHash, battleCatalogHash: catalog.contentHash, profile: catalog.common.profile,
  viewSha256: createHash("sha256").update(await readFile(resolve(rootPath, "apps/game/party-view.js"))).digest("hex"),
  sourceChanges,
  doesNotEstablish: ["browser rendering", "original runtime parity", "reserve-party selection permission", "new ability execution support"],
};
const output = resolve(rootPath, options.get("--report") ?? "build/reports/party-menu-ui-check.json");
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks: checks.length, result: report.result, report: output, semanticsVerified: false }));
