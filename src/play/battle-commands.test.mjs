import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Battle } from "./battle.js";
import { commandMenu } from "./battle-commands.js";

const data = JSON.parse(
  fs.readFileSync(new URL("../../build/web-data/battle.json", import.meta.url)),
);

test("unlearned Setzer can select his equipped PR esper through Magic while character and relic command rules remain intact", () => {
  // Reproduces the observed Setzer10/Ifrit66/abilities[1,2] combination with
  // ordinary fixture MP, rather than depending on an ignored live-save file.
  const unit = { ...data.characters[10], abilities: [1, 2], magicite: 66, mp: 100, maxMp: 100 },
    battle = new Battle({ data, party: [unit], encounterId: 336, random: () => 0.5 }),
    summon = data.magicStones[66].summonAbilityId,
    magic = battle.commandsFor(0).find((menu) => menu.commandId === 7);
  assert.equal(summon, 92);
  assert(magic && !magic.disabled);
  assert.deepEqual(
    magic.actions.map((action) => action.id),
    [summon],
  );
  assert.equal(magic.actions[0].magiciteSummon, true);
  const mp = unit.mp;
  unit.ready = true;
  assert.equal(battle.choose(0, summon, 0), true);
  assert.equal(unit.mp, mp - data.abilities[summon].mp);
  assert.equal(unit.magiciteUsed, true);
  unit.ready = true;
  assert.equal(battle.choose(0, summon, 0), false);

  const menu = (overrides) =>
    commandMenu(
      {
        data,
        players: [{ ...unit, magiciteUsed: false, ...overrides }],
        enemies: [],
        itemsFor: () => [],
      },
      0,
    );
  assert.equal(
    menu({ magicite: 0 }).some((command) => command.commandId === 7),
    false,
  );
  assert.equal(
    menu({ magicite: 999999 }).some((command) => command.commandId === 7),
    false,
  );
  assert.equal(
    menu({ magitek: true }).some((command) => command.commandId === 7),
    false,
  );
  assert.equal(
    menu({ id: 12, commands: data.characters[12].commands, magicite: 0 }).some(
      (command) => command.commandId === 7,
    ),
    false,
  );
  assert.deepEqual(menu({ id: 14, commands: data.characters[14].commands }), []);
  const dualcast = menu({ equipmentEffects: undefined, equipment: [315] });
  assert(dualcast.some((command) => command.commandId === 31));
  assert.equal(
    dualcast.some((command) => command.commandId === 7),
    false,
  );
});
