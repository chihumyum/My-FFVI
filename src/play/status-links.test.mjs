import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Battle } from "./battle.js";
import { createCharacter, raiseLevel, applyTestBoost } from "./progression.js";
import { setCondition } from "./ability-effects.js";
import { statusLinkFor, pruneStatusLinks } from "./status-links.js";

const data = JSON.parse(
  fs.readFileSync(new URL("../../build/web-data/battle.json", import.meta.url)),
);
const character = (id) => {
  const unit = createCharacter(data, id);
  raiseLevel(data, unit, 30, { magicite: false });
  unit.hp = unit.maxHp;
  unit.mp = unit.maxMp;
  unit.commands = [1];
  return unit;
};
function fixture() {
  const warnings = [];
  const battle = new Battle({
    data: {
      ...data,
      aiPrograms: {},
      eventPrograms: {},
      parties: {
        99999: {
          members: [
            { monsterId: 1, slot: 0 },
            { monsterId: 1, slot: 1 },
          ],
        },
      },
      monsters: {
        1: {
          id: 1,
          name: "non-Goddess caster",
          hp: 20000,
          maxHp: 20000,
          level: 30,
          attack: 20,
          magic: 20,
        },
      },
    },
    party: [character(1), character(2)],
    encounterId: 99999,
    random: () => 0.1,
    warn: (message) => warnings.push(message),
  });
  return {
    battle,
    caster: battle.enemies[0],
    target: battle.players[0],
    other: battle.players[1],
    warnings,
  };
}

test("source Charm blocks manual commands and forces a real reverse-side action at the ordinary turn cost", () => {
  const { battle, caster, target, other } = fixture();
  battle.perform(caster, target, data.abilities[343]);
  assert.equal(statusLinkFor(battle, target, 630)?.owner, caster);
  target.ready = true;
  assert.deepEqual(battle.commandsFor(0), []);
  assert.equal(battle.choose(0, 1, { side: "enemy", index: 0 }), false);
  const before = { hp: other.hp, caster: caster.hp, turns: battle.turns };
  const draws = [0, 0.99];
  battle.random = () => (draws.length ? draws.shift() : 0.1);
  assert(battle.forcedTurn(target));
  assert(other.hp < before.hp);
  assert.equal(caster.hp, before.caster);
  assert.equal(target.ready, false);
});

test("only the explicit story-test boost rejects PR Charm and LoveToken; ordinary casts retain their real links", () => {
  for (const boosted of [false, true])
    for (const [abilityId, conditionId, type] of [
      [343, 70, 630],
      [336, 86, 674],
    ]) {
      const { battle, caster, target } = fixture();
      target.conditionImmunities = [9];
      if (boosted) {
        applyTestBoost(target);
        applyTestBoost(target);
        assert.deepEqual(target.conditionImmunities, [9, 70, 86]);
      }
      battle.perform(caster, target, data.abilities[abilityId]);
      assert.equal(target.conditions.includes(conditionId), !boosted);
      assert.equal(Boolean(statusLinkFor(battle, target, type)), !boosted);
      if (!boosted) assert.deepEqual(target.conditionImmunities, [9]);
    }
});

test("involuntary Charm magic consumes its real MP once and reverses its target affiliation", () => {
  const { battle, caster, target, other } = fixture();
  target.commands = [7];
  target.abilities = [40];
  battle.perform(caster, target, data.abilities[343]);
  const before = { mp: target.mp, hp: other.hp };
  const draws = [0, 0.99];
  battle.random = () => (draws.length ? draws.shift() : 0.1);
  target.ready = true;
  battle.forcedTurn(target);
  assert.equal(target.mp, before.mp - data.abilities[40].mp);
  assert(other.hp < before.hp);
});

test("Charm executes Row's real state effect instead of selecting a Slots placeholder", () => {
  const { battle, caster, target } = fixture();
  target.commands = [20];
  target.abilities = [];
  target.magicite = null;
  battle.perform(caster, target, data.abilities[343]);
  target.row = "front";
  target.ready = true;
  const turns = battle.turns;
  assert(battle.forcedTurn(target));
  assert.equal(target.row, "back");
  assert.equal(battle.turns, turns + 1);
  assert.equal(target.ready, false);
  assert.equal(battle.slots, undefined);
});

test("one Charm caster cannot bind two victims, while LoveToken uses the actual current pair", () => {
  const { battle, caster, target, other } = fixture();
  battle.perform(caster, target, data.abilities[343]);
  battle.perform(caster, other, data.abilities[343]);
  assert(statusLinkFor(battle, target, 630));
  assert.equal(statusLinkFor(battle, other, 630), undefined);
  assert(!other.conditions.includes(70));
  battle.perform(caster, target, data.abilities[336]);
  battle.perform(caster, other, data.abilities[336]);
  assert.equal(statusLinkFor(battle, target, 674), undefined);
  assert.equal(statusLinkFor(battle, other, 674)?.owner, caster);
  assert(!target.conditions.includes(86));
});

test("LoveToken redirects eligible single physical damage, excluding undodgeable and area hits", () => {
  const { battle, caster, target, other } = fixture();
  battle.perform(caster, target, data.abilities[336]);
  const before = { caster: caster.hp, target: target.hp };
  battle.perform(other, caster, data.abilities[1]);
  assert.equal(caster.hp, before.caster);
  assert(target.hp < before.target);
  const guardHp = target.hp;
  battle.perform(other, caster, { ...data.abilities[1], flags: [1] });
  assert(caster.hp < before.caster);
  assert.equal(target.hp, guardHp);
  const casterHp = caster.hp;
  battle.perform(other, caster, { ...data.abilities[1], all: true }, 2);
  assert(caster.hp < casterHp);
  assert.equal(target.hp, guardHp);
});

test("LoveToken resolves HawkEye against the bodyguard and keeps actual Dice undodgeable", () => {
  const { battle, caster, target, other } = fixture();
  other.equipment = [167];
  other.weaponEffects = [];
  other.attack = 100;
  caster.floating = true;
  target.floating = false;
  battle.perform(caster, target, data.abilities[336]);
  const before = target.hp;
  battle.random = () => 0.1;
  battle.perform(other, caster, data.abilities[1]);
  const coveredDamage = before - target.hp;
  const { battle: reference, caster: enemy, target: guard, other: attacker } = fixture();
  Object.assign(attacker, { equipment: [167], weaponEffects: [], attack: 100 });
  guard.floating = false;
  reference.random = () => 0.1;
  reference.perform(attacker, guard, data.abilities[1]);
  assert.equal(coveredDamage, guard.maxHp - guard.hp);
  assert(enemy.hp > 0);
  assert(target.hp > 0);
  assert(statusLinkFor(battle, target, 674));

  other.equipment = [
    Object.values(data.contents).find(
      (row) => row.type_id === 2 && data.weapons[row.type_value]?.process_prog === "DICE",
    ).id,
  ];
  const hp = { caster: caster.hp, guard: target.hp };
  battle.perform(other, caster, data.abilities[1]);
  assert(caster.hp < hp.caster);
  assert.equal(target.hp, hp.guard);
});

test("sleeping, confused, stopped, captured or hidden LoveToken recipients cannot cover", () => {
  for (const condition of [7, 12, 17, 627].map(
    (type) => Object.values(data.conditions).find((row) => row.condition_type === type).id,
  )) {
    const { battle, caster, target, other } = fixture();
    battle.perform(caster, target, data.abilities[336]);
    setCondition(battle, target, condition, true, { force: true });
    const hp = caster.hp;
    battle.perform(other, caster, data.abilities[1]);
    assert(caster.hp < hp, `unavailable guard condition ${condition} covered`);
  }
  const { battle, caster, target, other } = fixture();
  battle.perform(caster, target, data.abilities[336]);
  target.hidden = true;
  const hp = caster.hp;
  battle.perform(other, caster, data.abilities[1]);
  assert(caster.hp < hp);
});

test("both ends of either link clear on KO, petrification, zombie, escape, replacement and battle end", () => {
  for (const abilityId of [343, 336])
    for (const end of ["owner", "target"])
      for (const cause of [5, 11, 15, "escape", "replace"]) {
        const { battle, caster, target } = fixture();
        battle.perform(caster, target, data.abilities[abilityId]);
        const unit = end === "owner" ? caster : target;
        if (typeof cause === "number") setCondition(battle, unit, cause, true, { force: true });
        else if (cause === "escape") unit.escaped = true;
        else if (end === "owner") battle.enemies.splice(0, 1);
        else battle.players.splice(0, 1);
        pruneStatusLinks(battle);
        assert.equal(battle.statusLinks.length, 0, `${abilityId}/${end}/${cause}`);
        assert(!target.conditions.includes(abilityId === 343 ? 70 : 86));
      }
  const { battle, caster, target } = fixture();
  battle.perform(caster, target, data.abilities[343]);
  battle.perform(caster, target, data.abilities[336]);
  setCondition(battle, target, 24, true);
  for (const enemy of battle.enemies) enemy.hp = 0;
  battle.checkEnd();
  assert.equal(battle.phase, "victory");
  assert.equal(battle.statusLinks.length, 0);
  assert.deepEqual(target.conditions, []);
  assert.deepEqual(target.conditionUntil, {});
});

test("real Nelapa source opens Doom once, respects immunity and removes Doom/Reflect timers on finish", () => {
  const party = [character(1), character(2)];
  party[1].conditionImmunities = [14];
  const battle = new Battle({
    data: { ...data, aiPrograms: {} },
    party,
    encounterId: 452,
    random: () => 0.5,
  });
  battle.tick(0.25, false);
  assert(party[0].conditions.includes(14));
  assert(!party[1].conditions.includes(14));
  const until = party[0].conditionUntil[14];
  assert(until > battle.elapsed + 39 && until <= battle.elapsed + 40);
  for (let n = 0; n < 12; n++) battle.tick(0.25, false);
  assert.equal(party[0].conditionUntil[14], until);
  setCondition(battle, party[0], 24, true);
  battle.enemies[0].hp = 0;
  for (let n = 0; n < 50 && battle.phase === "active"; n++) battle.tick(0.25, false);
  assert.equal(battle.phase, "victory");
  assert(party.every((unit) => !unit.conditions.includes(14) && !unit.conditions.includes(24)));
  assert(party.every((unit) => Object.keys(unit.conditionUntil).length === 0));
});
