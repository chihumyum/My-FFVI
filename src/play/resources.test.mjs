import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlayGame } from './game.js';
import { activeSavePoint } from './resources.js';
import { applyBattleRewards } from './progression.js';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const data = read('build/play/data.json'), battleData = read('build/play/battle.json');
function sourceGame(mapId = 232) {
  const map = read(`build/world/maps/${mapId}.json`).map;
  const game = new PlayGame({ data, battleData, loadMap: async () => map, random: () => .5 });
  Object.assign(game, { map, mapId, tasks: [], groups: new Set(['entity_default']) });
  game.partySlots = [[1, 7], [], []]; game.partyIndex = 0;
  for (const unit of game.party) unit.enabled = true;
  game.refreshActors();
  return game;
}

test('PR save-point camping requires the live source group, exact occupied cell, layer and visibility', () => {
  const game = sourceGame(19);
  const point = game.map.groups.ev_e_0250.entities.find(entity => entity.kind === 9);
  assert.equal(point.id, '56');
  Object.assign(game.player, { x: point.x, y: point.y, layer: point.layer, vehicle: 1 });
  game.fieldSavePoint = true;
  assert.equal(game.canCamp(), false);
  game.groups.add('ev_e_0250'); game.refreshActors();
  assert.equal(activeSavePoint(game).id, point.id);
  assert.equal(game.canCamp(), true);
  game.player.x++;
  assert.equal(game.canCamp(), false);
  game.player.x--; game.player.layer++;
  assert.equal(game.canCamp(), false);
  game.player.layer--; game.actor(Number(point.id)).visible = false;
  assert.equal(game.canCamp(), false);
  game.actor(Number(point.id)).visible = true;
  assert.equal(game.canCamp(), true);
  game.groups.delete('ev_e_0250'); game.refreshActors();
  assert.equal(game.canCamp(), false);
  game.map.worldTerrain = {};
  assert.equal(game.canCamp(), true);
  game.player.vehicle = 5;
  assert.equal(game.canCamp(), false);
});

test('one PR tent spends one owned content17 and executes sc_tnt once, reviving the party without a reusable heal', () => {
  const game = sourceGame();
  const point = game.entities.find(entity => entity.kind === 9);
  Object.assign(game.player, { x: point.x, y: point.y, layer: point.layer, vehicle: 1 });
  for (const unit of game.party) Object.assign(unit, { hp: 0, mp: 0, conditions: [5, 10] });
  game.inventory[17] = 1;
  assert.equal(game.useItem(17, 1), true);
  assert.equal(game.inventory[17], 0);
  assert.equal(game.useItem(17, 1), false);
  assert.equal(game.party[0].hp, 0);
  for (let tick = 0; tick < 100; tick++) game.tick(.1);
  assert.equal(game.busy, false);
  for (const unit of game.party) {
    assert.equal(unit.hp, unit.maxHp);
    assert.equal(unit.mp, unit.maxMp);
    assert.deepEqual(unit.conditions, []);
  }
  assert.equal(game.history.filter(entry => entry.script === 'sc_tnt').length, 1);
  game.inventory[17] = 1;
  assert.equal(game.useItem(17, 1), false);
  assert.equal(game.inventory[17], 1);
  game.party[0].hp = 1;
  game.player.x++;
  assert.equal(game.useItem(17, 1), false);
  assert.equal(game.party[0].hp, 1);
  assert.equal(game.inventory[17], 1);
});

test('PR sleeping bags stay single-target, Phoenix Downs cannot heal live targets, and field magic spends finite MP', () => {
  const game = sourceGame();
  const point = game.entities.find(entity => entity.kind === 9);
  Object.assign(game.player, { x: point.x, y: point.y, layer: point.layer, vehicle: 1 });
  const [terra, celes] = game.party;
  terra.hp = celes.hp = 1; terra.mp = celes.mp = 0;
  game.inventory[16] = 1;
  assert.equal(game.useItem(16, terra.id), true);
  assert.equal(terra.hp, terra.maxHp);
  assert.equal(terra.mp, terra.maxMp);
  assert.equal(celes.hp, 1);
  assert.equal(celes.mp, 0);
  assert.equal(game.inventory[16], 0);
  celes.hp = 0; celes.conditions = [5];
  game.inventory[10] = 2;
  assert.equal(game.useItem(10, celes.id), true);
  assert.equal(celes.hp, Math.max(1, Math.floor(celes.maxHp / 8)));
  assert.equal(game.inventory[10], 1);
  assert.equal(game.useItem(10, celes.id), false);
  assert.equal(game.inventory[10], 1);
  terra.mp = 5;
  assert.equal(game.useAbility(31, terra.id, celes.id), true);
  assert.equal(terra.mp, 0);
  assert.equal(game.useAbility(31, terra.id, celes.id), false);
  assert.equal(terra.mp, 0);
});

test('PR formation get_value supplies real learning points for Kirin Cure instead of the zero get_ap field', () => {
  const game = sourceGame();
  game.partySlots = [[3], [], []];
  const cyan = game.party[0]; cyan.enabled = true;
  game.inventory[63] = 1;
  assert.equal(game.equipMagicite(cyan.id, 63), true);
  const hp = cyan.hp, mp = cyan.mp;
  for (let battle = 0; battle < 7; battle++)
    applyBattleRewards(battleData, [cyan], { outcome: 'victory', exp: 0, ap: battleData.parties[124].ap });
  assert.equal(cyan.magicLearning[31], 100);
  assert.ok(cyan.abilities.includes(31));
  assert.equal(cyan.hp, hp);
  assert.equal(cyan.mp, mp);
});

test('field Imp follows PR forbidden spell conditions and self-negation while Float spends ordinary MP', () => {
  const game = sourceGame();
  const terra = game.party[0];
  terra.abilities = [...terra.abilities, 74, 75];
  terra.conditions = [13]; terra.hp = 1;
  const startMp = terra.mp;
  assert.equal(game.useAbility(31, terra.id), false);
  assert.equal(terra.mp, startMp);
  assert.equal(terra.hp, 1);
  assert.equal(game.useAbility(75, terra.id), true);
  assert.deepEqual(terra.conditions, []);
  assert.equal(terra.mp, startMp - battleData.abilities[75].mp);
  assert.equal(game.useAbility(74, terra.id), true);
  assert.deepEqual(terra.conditions, [17]);
  assert.equal(terra.mp, startMp - battleData.abilities[75].mp - battleData.abilities[74].mp);
  assert.equal(game.useAbility(75, terra.id), true);
  assert.deepEqual(terra.conditions, [17, 13]);
  assert.equal(game.useAbility(31, terra.id), false);
  assert.equal(terra.hp, 1);
});

test('a zero-HP zombie needs actual Holy Water and cannot waste an ordinary Phoenix Down', () => {
  const game = sourceGame();
  const terra = game.party[0];
  terra.hp = 0; terra.conditions = [15];
  game.inventory[10] = 1; game.inventory[11] = 1;
  assert.equal(game.useItem(10, terra.id), false);
  assert.equal(game.inventory[10], 1);
  assert.equal(game.useItem(11, terra.id), true);
  assert.equal(game.inventory[11], 0);
  assert.equal(terra.hp, Math.max(1, Math.floor(terra.maxHp / 8)));
  assert.deepEqual(terra.conditions, []);
});

test('the PR South Figaro equipment chest grants its declared sword once through ordinary facing input and persists its treasure flag', () => {
  const game = sourceGame(53);
  const chest = game.entities.find(entity => entity.kind === 7 && entity.treasure?.contentId === 105);
  assert.ok(chest);
  Object.assign(game.player, { x: chest.x, y: chest.y + 1, layer: chest.layer, direction: 'up' });
  assert.equal(game.confirm(), true);
  assert.equal(game.inventory[105], 1);
  assert.equal(game.banks.TreasureFlag1?.[35] || 0, 0);
  assert.equal(game.busy, true);
  game.confirm();
  assert.equal(game.banks.TreasureFlag1[35], 1);
  const saved = JSON.parse(JSON.stringify(game.snapshot()));
  assert.equal(saved.banks.TreasureFlag1[35], 1);
  assert.equal(saved.inventory[105], 1);
  assert.equal(game.confirm(), true);
  assert.equal(game.inventory[105], 1);
  game.confirm();
  assert.equal(game.inventory[105], 1);
});

test('TreasureBox operands select a source entity, not an item, and honor the silent after-script grant', () => {
  const game = sourceGame(53);
  game.data = { ...data, programs: { ...data.programs, treasureFixture: { name: 'treasure-fixture',
    ops: [['TreasureBox', [8, 1, 1, 0, 0, 0, 0, 0], [], []]] } } };
  const task = { program: 'treasureFixture', pc: 0, actor: null, locals: [], children: [], stack: [], scriptFrames: [] };
  game.step(task);
  assert.equal(game.inventory[105], 1);
  assert.equal(game.inventory[8] || 0, 0);
  assert.equal(game.banks.TreasureFlag1[35], 1);
  assert.equal(game.dialogue, null);
  task.pc = 0; game.step(task);
  assert.equal(game.inventory[105], 1);
});
