import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { languages, resolveLanguage } from "./languages.js";
import { tr, setLanguage, preferredLanguage } from "./i18n.js";
import { localizeGame, localizeSave } from "./localized-data.js";
import { Battle } from "./battle.js";
import { BattleEvents } from "./battle-events.js";

test("language tags and persisted preference select only supported PR languages", () => {
  assert.equal(resolveLanguage("zh-Hant-HK"), "zh-TW");
  assert.equal(resolveLanguage("zh-Hans-SG"), "zh-CN");
  assert.equal(resolveLanguage("pt-BR"), "pt");
  assert.equal(resolveLanguage("en_GB"), "en");
  assert.equal(resolveLanguage("nl"), null);
  const storage = { getItem: () => "ja" };
  assert.equal(preferredLanguage(storage, ["en-US"]), "ja");
  assert.equal(
    preferredLanguage(
      {
        getItem() {
          throw Error("blocked");
        },
      },
      ["nl", "ko-KR"],
    ),
    "ko",
  );
});

test("all twelve authored catalogs have matching keys and interpolation arguments", async () => {
  const catalogs = await Promise.all(
    languages.map(async ({ id }) => [
      id,
      JSON.parse(await readFile(new URL(`./locales/${id}.json`, import.meta.url))),
    ]),
  );
  const reference = catalogs.find(([id]) => id === "en")[1];
  const keys = Object.keys(reference).sort();
  const argumentsOf = (value) =>
    [...value.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]).sort();
  for (const [id, catalog] of catalogs) {
    assert.deepEqual(Object.keys(catalog).sort(), keys, id);
    for (const key of keys) {
      assert.ok(catalog[key].trim(), `${id}: ${key}`);
      assert.deepEqual(argumentsOf(catalog[key]), argumentsOf(reference[key]), `${id}: ${key}`);
    }
    await setLanguage(id);
    assert.equal(tr("title.new_game"), catalog["title.new_game"]);
    assert.ok(tr("app.party_value", { v0: 3 }).includes("3"));
  }
  await setLanguage("zh-CN");
});

test("switching languages preserves custom names, combat values, choices and stored saves", async () => {
  await setLanguage("en");
  const battle = {
    characters: { 1: { name: "蒂娜" }, 2: { name: "洛克" } },
    monsters: { 7: { name: "怪物" } },
    itemNames: {},
    contentNames: {},
  };
  const data = {};
  const catalog = {
    language: "en",
    messages: { choice: "Proceed" },
    speakers: {},
    mapNames: { 3: "Town" },
    characterAliases: { 1: ["蒂娜", "Terra"], 2: ["洛克", "Locke"] },
    battleNames: {
      characters: { 1: "Terra", 2: "Locke" },
      monsters: { 7: "Enemy" },
      contentNames: { 4: "Potion" },
    },
  };
  const game = {
    roster: {
      1: { id: 1, name: "蒂娜", hp: 37 },
      2: { id: 2, name: "My hero", hp: 81, customName: true },
    },
    battle: {
      players: [{ id: 1, side: "player", hp: 37 }],
      enemies: [{ id: 7, side: "enemy", hp: 19 }],
    },
    dialogue: { uiKey: "game.choose", choiceKeys: ["choice"], choices: ["继续"], text: "请选择：" },
    shop: { stock: [{ id: 4, name: "药水", price: 50 }] },
    text(key) {
      return data.messages[key];
    },
  };
  localizeGame(data, battle, catalog, game);
  assert.equal(game.roster[1].name, "Terra");
  assert.equal(game.roster[2].name, "My hero");
  assert.equal(game.roster[1].hp, 37);
  assert.equal(game.battle.enemies[0].hp, 19);
  assert.equal(game.battle.enemies[0].name, "Enemy");
  assert.deepEqual(game.shop.stock[0], { id: 4, name: "Potion", price: 50 });
  assert.deepEqual(game.dialogue.choices, ["Proceed"]);
  assert.equal(game.dialogue.text, "Choose:");
  const record = {
    map: "城镇",
    snapshot: { mapId: 3, roster: game.roster },
    party: [
      { id: 1, name: "蒂娜" },
      { id: 2, name: "My hero" },
    ],
  };
  const original = structuredClone(record),
    display = localizeSave(record, catalog);
  assert.equal(display.map, "Town");
  assert.equal(display.party[0].name, "Terra");
  assert.equal(display.party[1].name, "My hero");
  assert.deepEqual(record, original);
  await setLanguage("zh-CN");
});

test("Bahamut reels and Chaser survival use stable definitions instead of translated names", () => {
  const performed = [];
  const host = {
    data: {
      magicStones: { 85: { name: "バハムート", summonAbilityId: 112 } },
      abilities: { 112: { id: 112, name: "Localized summon", target: "enemy" } },
    },
    slots: { index: 0, stopped: [1, 1] },
    slotSymbols: () => [1, 1, 1],
    players: [{}],
    enemies: [{}],
    eligibleTarget: () => true,
    perform(actor, target, ability) {
      performed.push(ability.id);
    },
    addLog() {},
    consumeTurn() {},
    checkEnd() {},
  };
  Battle.prototype.stopSlot.call(host, 0);
  assert.deepEqual(performed, [112]);
  const enemy = { name: "チェイサー", aiName: "sc_ai_0A0_Chaser", hp: 100 };
  const battle = {
    data: { eventPrograms: { scene: { name: "scene", locals: [0, 0], ops: [] } } },
    formation: { script: "scene" },
    enemies: [enemy],
    players: [],
    banks: {},
  };
  const events = new BattleEvents(battle);
  events.syscall("チェイサー消滅チェック", [], []);
  assert.equal(events.locals[1], 0);
  enemy.hp = 0;
  events.syscall("チェイサー消滅チェック", [], []);
  assert.equal(events.locals[1], 1);
});
