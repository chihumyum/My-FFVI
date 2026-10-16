import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleEvents } from './battle-events.js';

function host(program, enemies = []) {
  const player = { id: 2, side: 'player', hp: 100, maxHp: 100, mp: 20, conditions: [] };
  return { data: { eventPrograms: { event: program }, abilities: {}, conditions: {} }, formation: { script: 'event' },
    players: [player], enemies, banks: {}, elapsed: 0, warning() {}, addLog() {},
    perform() { throw new Error('A presentation-only ability must not become Fight.'); } };
}

test('GetEnemyMode uses PR unique slots and preserves a local that fails the expected-value guard', () => {
  const battle = host({ name: 'event', locals: [0, 0], ops: [] }, [
    { monsterId: 334, slot: 0, hp: 100, aiState: { mode: 8 } },
    { monsterId: 260, slot: 8, hp: 11600, aiState: { mode: 3 } },
  ]);
  const events = new BattleEvents(battle);
  events.execute(['GetEnemyMode', [9, 1]]);
  assert.equal(events.locals[1], 0);
  events.execute(['GetEnemyMode', [9, 0]]);
  assert.equal(events.locals[1], 3);
});

test('event change-animation functions do no damage and source condition/flag changes persist', () => {
  const battle = host({ name: 'event', locals: [0, 0], ops: [] });
  battle.data.abilities[5000] = { id: 5000, functionId: 19 };
  battle.data.conditions[80] = { condition_type: 666 };
  const events = new BattleEvents(battle);
  events.execute(['BattleAction', [1, 2, 5000, 1, 2]]);
  events.execute(['BattleCondition', [1, 2, 80, 1]]);
  events.execute(['SetFlag', [52], [], ['ScenarioFlag1']]);
  assert.equal(battle.players[0].hp, 100);
  assert.equal(battle.players[0].disguise, 1);
  assert.deepEqual(battle.players[0].conditions, [80]);
  assert.equal(battle.banks.ScenarioFlag1[52], 1);
});

test('Vargas ordinary damage preserves the scene defeat condition and Sabin selects the real Blitz', () => {
  const battle = host({ name: 'event', locals: [0, 0, 0, 0],
    ops: [['SysCall', [], [], ['バルガスチェック']]] }, [
    { monsterId: 260, slot: 8, hp: 11600, aiState: { mode: 0 } },
  ]);
  const sabin = { id: 6, hp: 100, side: 'player' };
  battle.players[0].removed = true; battle.players[0].hidden = true; battle.players.push(sabin);
  const events = new BattleEvents(battle);
  assert.equal(events.beforeDamage(sabin, battle.enemies[0], { id: 1 }, 99999), 11599);
  assert.deepEqual(events.autoCommand(sabin), { abilityId: 132, targetIndex: 0 });
  events.execute(['BattleCondition', [2, 9, 5, 1]]);
  assert.equal(battle.enemies[0].hp, 0);
});

test('Ultros position bodies hide, carry shared HP on a source swap and all finish when the active body falls', () => {
  const enemies = [2, 4, 8].map((slot, index) => ({ id: 302, monsterId: 302, slot, hp: index === 1 ? 37 : 100,
    maxHp: 100, hidden: index !== 1, conditions: index === 1 ? [] : [67], aiState: { vars: Array(15).fill(0) } }));
  const battle = host({ name: 'event', ops: [] }, enemies), events = new BattleEvents(battle);
  battle.data.conditions[67] = { condition_type: 625 };
  enemies[1].aiState.vars[9] = 3;
  events.syscall('オルトロス移動チェック');
  assert.equal(events.locals[1], 1);
  events.syscall('オルトロス移動アクションOut');
  assert.equal(events.paused, true);
  assert.equal(enemies[1].hidden, true);
  events.syscall('オルトロス移動アクションIn');
  assert.equal(enemies[0].hidden, false);
  assert.equal(enemies[0].hp, 37);
  events.syscall('オルトロス移動後処理');
  assert.equal(events.paused, false);
  assert.equal(enemies[0].aiState.vars[9], 0);
  enemies[0].hp = 0;
  events.syscall('オルトロスバトル終了時処理');
  assert(enemies.every(unit => unit.hp === 0));
  assert.equal(events.locals[0], 1);
  assert.equal(events.forcedOutcome, null);
});
