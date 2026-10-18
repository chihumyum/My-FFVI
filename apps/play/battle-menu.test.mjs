import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Battle } from "../../src/play/battle.js";
import { createBattleMenu } from "./battle-menu.js";
import { createWidget } from "./ui.js";

const data = JSON.parse(
  await readFile(new URL("../../build/web-data/battle.json", import.meta.url)),
);
function fixture() {
  const party = [1, 31].map((id) => structuredClone(data.characters[id]));
  Object.assign(party[0], { abilities: [31, 40], mp: 100, maxMp: 100 });
  const battle = new Battle({ data, party, encounterId: 3, random: () => 0.5 });
  for (const unit of battle.players) unit.ready = false;
  battle.players[0].ready = true;
  const commands = createWidget("div"),
    targets = createWidget("div"),
    status = createWidget("div");
  const menu = createBattleMenu({ commands, targets, status, createElement: createWidget });
  const selectSpell = (id) => {
    menu.update(battle);
    commands.children.find((button) => button.textContent === "魔法")?.click();
    menu.update(battle);
    commands.children
      .find((button) => button.textContent.startsWith(data.abilities[id].name))
      .click();
  };
  return { battle, menu, commands, targets, selectSpell };
}

test("a battlefield click sends a selected spell to that enemy, without a target-menu click", () => {
  const { battle, menu, targets, selectSpell } = fixture();
  selectSpell(40);
  const hp = battle.enemies.map((unit) => unit.hp);
  assert(menu.canSelectTarget("enemy", 1));
  assert.equal(menu.selectTarget("enemy", 1), true);
  assert.equal(
    battle.enemies[0].hp,
    hp[0],
    "clicking the second enemy must not default to the first",
  );
  assert(battle.enemies[1].hp < hp[1]);
  assert.equal(targets.children.length, 0);
  assert.equal(menu.canSelectTarget("enemy", 0), false);
});

test("battlefield targeting also heals a clicked ally and Escape cancels without consuming a turn", () => {
  const { battle, menu, targets, selectSpell } = fixture();
  battle.players[1].hp = 10;
  selectSpell(31);
  const mp = battle.players[0].mp;
  assert.equal(menu.handleKey({ key: "Escape" }), true);
  assert.equal(targets.children.length, 0);
  assert.equal(battle.players[0].mp, mp);
  assert.equal(battle.players[0].ready, true);
  selectSpell(31);
  assert(menu.canSelectTarget("player", 1));
  assert.equal(menu.selectTarget("player", 1), true);
  assert(battle.players[1].hp > 10);
  assert(battle.players[0].mp < mp);
});

test("hidden or removed enemies cannot receive a battlefield target click", () => {
  const { battle, menu, selectSpell, targets } = fixture();
  selectSpell(40);
  battle.enemies[1].hidden = true;
  assert.equal(menu.canSelectTarget("enemy", 1), false);
  assert.equal(menu.selectTarget("enemy", 1), false);
  assert(targets.children.length > 0, "an invalid click keeps selection open");
  assert.equal(battle.players[0].ready, true);
});

test("group spells expose both sides before individual targets and battlefield clicks preserve all-target mode", () => {
  const { battle, menu, targets, selectSpell } = fixture();
  selectSpell(40);
  const labels = targets.children.map((node) => node.textContent);
  assert(
    labels.indexOf("敌方全体") <
      labels.indexOf(
        battle.players[0].name + ` HP ${battle.players[0].hp}/${battle.players[0].maxHp}`,
      ),
  );
  const hp = battle.enemies.map((unit) => unit.hp),
    mp = battle.players[0].mp;
  assert.equal(menu.handleKey({ key: "Shift" }), true);
  assert(targets.children.some((node) => node.textContent.startsWith("目标：全体")));
  assert(menu.selectTarget("enemy", 1));
  assert(battle.enemies.every((unit, i) => unit.hp < hp[i]));
  assert.equal(battle.players[0].mp, mp - data.abilities[40].mp, "one cast pays MP once");
});

test("all-target mode also heals the whole party, and cancelling resets the next spell", () => {
  const { battle, menu, targets, selectSpell } = fixture();
  for (const unit of battle.players) unit.hp = 1;
  selectSpell(31);
  targets.children.find((node) => node.dataset.targetScope).click();
  assert(menu.selectTarget("player", 1));
  assert(battle.players.every((unit) => unit.hp > 1));
  battle.players[0].ready = true;
  selectSpell(40);
  menu.handleKey({ key: "Shift" });
  menu.handleKey({ key: "Escape" });
  selectSpell(40);
  const hp = battle.enemies.map((unit) => unit.hp);
  menu.selectTarget("enemy", 0);
  assert(battle.enemies[0].hp < hp[0]);
  assert.equal(battle.enemies[1].hp, hp[1]);
});
