import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { Battle } from "../../src/play/battle.js";
import { createCharacter, learnNaturalAbilities } from "../../src/play/progression.js";
import { setCondition } from "../../src/play/ability-effects.js";
import { effectiveCommandIds, configureGogo, blitzInputs } from "../../src/play/battle-commands.js";
const data = JSON.parse(await fs.readFile("build/web-data/battle.json", "utf8")),
  results = [];
function fixture(id, { veldt = false } = {}) {
  const unit = createCharacter(data, id, true);
  learnNaturalAbilities(unit);
  const d = { ...data, eventPrograms: {}, aiPrograms: {} };
  const b = new Battle({
    data: d,
    party: [unit],
    encounterId: 451,
    inventory: { 1: 10, 61: 10 },
    isVeldt: veldt,
    context: { settings: { atbMode: "wait" } },
  });
  unit.ready = true;
  unit.atb = 100;
  return {
    b,
    unit,
    ready() {
      unit.ready = true;
      unit.atb = 100;
    },
  };
}
async function check(name, run) {
  try {
    await run();
    results.push({ name, result: "passed" });
  } catch (error) {
    results.push({ name, result: "failed", error: error.message });
  }
}
await check("PR zero-ability commands remain visible; Gau has no Attack", () => {
  const { b } = fixture(12);
  assert(!b.commandsFor(0).some((c) => c.commandId === 1));
  assert(b.commandsFor(0).some((c) => c.commandId === 23));
  assert(b.commandsFor(0).some((c) => c.commandId === 3));
});
await check("all five command replacement pairs come from PR wear Function61", () => {
  for (const [from, to] of [
    [10, 11],
    [1, 30],
    [18, 19],
    [20, 21],
    [7, 31],
  ]) {
    const f = Object.values(data.functions).find(
      (f) => f.function1_id === 61 && f.function1_value1 === from && f.function1_value2 === to,
    );
    assert(f);
    const u = { id: 2, commands: [from], equipmentEffects: [{ id: 61, values: [from, to, 0] }] };
    assert(effectiveCommandIds(data, u).includes(to));
    assert(!effectiveCommandIds(data, u).includes(from));
  }
});
await check("Lore is learned on witnessing an enemy ability, but not while blinded", () => {
  const { b, unit } = fixture(8);
  unit.loreAbilities = [];
  b.perform(b.enemies[0], unit, data.abilities[145]);
  assert(unit.loreAbilities.includes(145));
  unit.loreAbilities = [];
  setCondition(b, unit, 9, true, { force: true });
  b.perform(b.enemies[0], unit, data.abilities[145]);
  assert(!unit.loreAbilities.includes(145));
});
await check("Rage uses PR monster groups and removes manual control", () => {
  const { b, unit } = fixture(12);
  unit.rages = [1];
  assert(b.choose(0, "rage:1", { side: "player", index: 0 }));
  assert.equal(unit.rageMonster, 1);
  assert.equal(b.commandsFor(0).length, 0);
  const hp = b.enemies[0].hp;
  b.tick(3);
  assert(b.enemies[0].hp < hp);
});
await check("dance is learned from the PR background learning row", () => {
  const { b, unit } = fixture(11);
  b.formation = { ...b.formation, backgroundId: 1, ap: 0 };
  unit.danceAbilities = [];
  b.enemies[0].hp = 0;
  b.checkEnd();
  assert(unit.danceAbilities.includes(164));
});
await check("Morph grants Revert while active and expires at a finite duration", () => {
  const { b, unit } = fixture(1);
  unit.commands.push(8);
  assert(b.choose(0, 6, { side: "player", index: 0 }));
  assert(unit.trance);
  assert(b.commandsFor(0).some((c) => c.commandId === 9));
  b.tick(140);
  assert(!unit.trance);
  assert(!b.commandsFor(0).some((c) => c.commandId === 9));
});
await check("Blitz rejects a wrong sequence and executes a valid source action", () => {
  const { b, unit, ready } = fixture(6);
  const hp = b.enemies[0].hp;
  assert(b.submitBlitz(0, 132, ["↑"], { side: "enemy", index: 0 }));
  assert.equal(hp, b.enemies[0].hp);
  ready();
  assert(b.submitBlitz(0, 132, blitzInputs[132], { side: "enemy", index: 0 }));
  assert(b.enemies[0].hp < hp);
  assert(!unit.ready);
});
await check("Bushido charges before a later learned level may execute", () => {
  const { b, ready } = fixture(3);
  assert(b.beginBushido(0));
  assert(!b.releaseBushido(0, 131, { side: "enemy", index: 0 }));
  b.tick(5);
  ready();
  assert(b.releaseBushido(0, 131, { side: "enemy", index: 0 }));
});
await check("Dualcast spends the actual combined MP and executes both source spells", () => {
  const { b, unit } = fixture(1);
  unit.abilities.push(40, 41);
  unit.equipmentEffects = [{ id: 61, values: [7, 31, 0] }];
  const mp = unit.mp,
    hp = b.enemies[0].hp;
  assert(
    b.chooseDualcast(0, [
      { id: 40, target: { side: "enemy", index: 0 } },
      { id: 41, target: { side: "enemy", index: 0 } },
    ]),
  );
  assert.equal(unit.mp, mp - data.abilities[40].mp - data.abilities[41].mp);
  assert(b.enemies[0].hp < hp);
  assert(!unit.ready);
});
await check("Gogo has three configurable commands; Umaro acts without manual commands", () => {
  const g = fixture(13);
  assert(configureGogo(data, g.unit, [15, 14, 10]));
  assert(g.b.commandsFor(0).some((c) => c.commandId === 15));
  const u = fixture(14);
  assert.equal(u.b.commandsFor(0).length, 0);
  const hp = u.b.enemies[0].hp;
  u.b.tick(3);
  assert(u.b.enemies[0].hp < hp);
});
await check("Wait pauses time in a submenu while Active continues", () => {
  const { b } = fixture(2);
  b.setInput("list");
  b.tick(1);
  assert.equal(b.elapsed, 0);
  b.context.settings.atbMode = "active";
  b.tick(1);
  assert(b.elapsed > 0.9);
});
await check("row is a formal command and changes the actual participant", () => {
  const { b, unit } = fixture(2);
  assert(b.choose(0, 4, { side: "player", index: 0 }));
  assert.equal(unit.row, "back");
});
await check("manual Revert preserves spent Trance gauge instead of resetting it", () => {
  const { b, unit, ready } = fixture(1);
  unit.commands.push(8);
  b.choose(0, 6, { side: "player", index: 0 });
  b.tick(30);
  ready();
  assert(b.choose(0, 7, { side: "player", index: 0 }));
  assert(unit.tranceGauge > 0 && unit.tranceGauge < 255);
  const remaining = unit.tranceGauge;
  ready();
  b.choose(0, 6, { side: "player", index: 0 });
  assert.equal(unit.tranceStartGauge, remaining);
});
await check("Gogo Tools uses configured commands and actual reusable PR inventory", () => {
  const { b, unit } = fixture(13);
  unit.customCommands = [14, 7, 3];
  const content = Object.values(data.contents).find(
    (c) => c.type_id === 1 && data.items[c.type_value]?.machine_flag,
  );
  b.inventory[content.id] = 1;
  const tools = b.commandsFor(0).find((c) => c.commandId === 14);
  assert(tools.actions.length > 0);
  assert(!tools.disabled);
});
await check("Rage keeps stronger equipment resistances", () => {
  const { b, unit } = fixture(12);
  unit.affinities = { 2: 3 };
  unit.elementResistances = unit.affinities;
  unit.rages = [1];
  b.choose(0, "rage:1", { side: "player", index: 0 });
  assert.equal(unit.affinities[2], 3);
});
await check("a fallen controller releases the controlled enemy", () => {
  const { b, unit } = fixture(9);
  unit.controlledEnemyIndex = 0;
  setCondition(b, b.enemies[0], 85, true, { force: true });
  unit.hp = 0;
  b.players.push({ id: 2, side: "player", hp: 100, maxHp: 100, atb: 0, conditions: [] });
  b.tick(0.1);
  assert(!b.enemies[0].conditions.includes(85));
  assert.equal(unit.controlledEnemyIndex, null);
});
await check("Mimic replays an actual item effect without consuming inventory again", () => {
  const { b, unit, ready } = fixture(13);
  b.inventory[2] = 10;
  unit.hp = unit.maxHp - 100;
  assert(b.choose(0, "item:2", { side: "player", index: 0 }));
  const count = b.inventory[2];
  unit.hp = unit.maxHp - 200;
  ready();
  assert(b.choose(0, 17, { side: "player", index: 0 }));
  assert(unit.hp > unit.maxHp - 200);
  assert.equal(b.inventory[2], count);
});
await check("Veldt Rage learning waits for a real Leap-and-return cycle", () => {
  const a = fixture(12, { veldt: true });
  a.unit.rages = [];
  a.b.enemies[0].monsterId = 2;
  a.b.enemies[0].hp = 0;
  a.b.checkEnd();
  assert.equal(a.unit.rages.length, 0);
  const z = fixture(12, { veldt: true });
  z.unit.rages = [];
  z.unit.pendingRages = [2];
  z.unit.veldtLeapt = false;
  z.b.enemies[0].hp = 0;
  z.b.checkEnd();
  assert(z.unit.rages.includes(2));
  assert.equal(z.unit.pendingRages.length, 0);
});
await fs.mkdir("build/play", { recursive: true });
await fs.writeFile("build/play/commands-check.json", JSON.stringify({ results }, null, 2));
for (const r of results) console.log(r.result, r.name, r.error ?? "");
if (results.some((r) => r.result === "failed")) process.exitCode = 1;
