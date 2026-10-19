import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "../../src/play/game.js";
import { canEquip, equipmentScore } from "../../src/play/resources.js";
import { createWidget } from "./ui.js";
import { renderPartyMenu } from "./party-menu.js";

const data = JSON.parse(await readFile(new URL("../../build/web-data/data.json", import.meta.url)));
const battleData = JSON.parse(
  await readFile(new URL("../../build/web-data/battle.json", import.meta.url)),
);
function fixture(page) {
  const game = new PlayGame({ data, battleData, loadMap: async () => null });
  game.partySlots = [[1, 5, 15], [], []];
  for (const unit of game.party) unit.enabled = true;
  game.tasks = [];
  game.inventory = {};
  const elements = {
    navigation: createWidget("div"),
    party: createWidget("div"),
    items: createWidget("div"),
  };
  const state = { page };
  const refresh = () => renderPartyMenu(game, elements, refresh, createWidget, state);
  refresh();
  return { game, elements, state, refresh };
}
const all = (node) => [node, ...node.children.flatMap(all)];

test("owned items and equipped selections/options keep PR content IDs for their icons", () => {
  const { game, elements, state, refresh } = fixture("道具");
  game.inventory[2] = 3;
  refresh();
  assert.equal(all(elements.items).find((node) => node.tag === "legend").dataset.contentId, "2");
  state.page = "装备";
  refresh();
  const controls = all(elements.items).filter((node) => node.tag === "select");
  assert.equal(controls.length, 4);
  for (const [slot, control] of controls.entries()) {
    assert.equal(control.dataset.contentId, String(game.party[0].equipment[slot]));
    assert.equal(
      control.children.find((option) => option.value === game.party[0].equipment[slot]).dataset
        .contentId,
      control.dataset.contentId,
    );
  }
  state.page = "设置";
  refresh();
  assert.ok(
    all(elements.items)
      .filter((node) => node.tag === "option")
      .every((node) => !node.dataset.contentId),
    "Settings values are not inventory content IDs",
  );
});

test("already optimal equipment is a successful no-change notice rather than an item-use failure", () => {
  const { game, elements } = fixture("装备");
  const before = structuredClone(game.party[0].equipment);
  all(elements.items)
    .find((node) => node.textContent === "最强装备")
    .click();
  assert.deepEqual(game.party[0].equipment, before);
  assert.match(elements.items.textContent, /已是当前最强装备/);
  assert.doesNotMatch(elements.items.textContent, /当前不能使用/);
});

test("strongest equipment consumes an owned usable PR upgrade and returns the replaced weapon", () => {
  const { game, elements } = fixture("装备");
  const unit = game.party[0],
    old = unit.equipment[0];
  const upgrade = Object.keys(battleData.contents)
    .map(Number)
    .find(
      (id) =>
        battleData.contents[id].type_id === 2 &&
        canEquip(battleData, unit, id, 0) &&
        equipmentScore(battleData, id, 0) > equipmentScore(battleData, old, 0),
    );
  assert.ok(upgrade, "PR fixture must have a real usable upgrade");
  game.inventory[upgrade] = 1;
  all(elements.items)
    .find((node) => node.textContent === "最强装备")
    .click();
  assert.ok(unit.equipment.includes(upgrade));
  assert.equal(game.inventory[upgrade], 0);
  assert.equal(game.inventory[old], 1);
  assert.match(elements.items.textContent, /已换上当前持有的最强装备/);
});

test("visual formation swaps ordinary party slots and front/back controls without changing stats", () => {
  const { game, elements, refresh } = fixture("队列");
  const original = game.party.map((unit) => unit.id);
  const first = game.party[0],
    stats = [first.hp, first.mp, first.attack];
  assert.equal(all(elements.items).filter((node) => node.figure).length, 3);
  all(elements.items)
    .find((node) => node.textContent === `1. ${first.name}`)
    .click();
  assert.equal(
    all(elements.items).find((node) => node.figure?.asset.includes("p001")).figure.animation,
    "WalkL",
  );
  const third = game.party[2];
  all(elements.items)
    .find((node) => node.textContent === `3. ${third.name}`)
    .click();
  assert.deepEqual(
    game.party.map((unit) => unit.id),
    [original[2], original[1], original[0]],
  );
  const before = third.row;
  all(elements.items)
    .find(
      (node) =>
        node.tag === "button" && node.textContent === (before === "back" ? "改为前排" : "改为后排"),
    )
    .click();
  assert.equal(third.row, before === "back" ? "front" : "back");
  assert.deepEqual([first.hp, first.mp, first.attack], stats);
  refresh();
  assert.equal(
    all(elements.items).find(
      (node) => node.figure && node.attributes["aria-label"].startsWith(third.name),
    ).figure.row,
    third.row,
  );
});

test("status distributes identity and full numeric values across explicit columns", () => {
  const { game, elements } = fixture("状态");
  const columns = all(elements.items).find((node) => node.tag === "columns");
  assert.equal(columns.children.length, 3);
  const stats = all(columns).filter((node) => node.tag === "stat");
  assert.equal(
    stats.find((node) => node.textContent === "HP").value,
    `${game.party[0].hp} / ${game.party[0].maxHp}`,
  );
  for (const label of ["力量", "速度", "体力", "魔力", "攻击", "防御", "魔防", "回避", "魔回"])
    assert.ok(stats.some((node) => node.textContent === label));
});
