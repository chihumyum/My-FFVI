import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInstruction } from './instructions.js';
import { executeSyscall } from './syscalls.js';

const game = () => ({
  player: { x: 14.5, y: 15.5, layer: 0, direction: 'down' }, camera: {},
  partySlots: [[1, 2], [], []], partyIndex: 0, party: [{ id: 1 }, { id: 2 }],
  roster: { 1: { id: 1 }, 2: { id: 2 }, 3: { id: 3, enabled: true }, 4: { id: 4, enabled: false } },
  actor() { return this.player; }, compare(a, operator, b) { return operator === '＝' ? a === b : a !== b; },
});

test('relative SetPos keeps a separate character on the player reference without copying its layer', () => {
  const g = game(), character = { x: 8, y: 6, layer: 1 }, task = {};
  executeInstruction(g, task, 'SetPos', [1, -1, 0, 1, -1001], [], [], character);
  assert.deepEqual(character, { x: 15, y: 14, layer: 1, motion: null });
  executeInstruction(g, task, 'SetPos', [-1, 7, 0], [], [], character);
  assert.equal(character.x, 15);
  assert.equal(character.y, 7);
  executeInstruction(g, task, 'SetPos', [15, 7, 2], [], [], character);
  assert.equal(character.layer, 1);
});

test('character branch reads presence, roster scope and jump PC from their PR slots', () => {
  const g = game(), t = { pc: 2 };
  executeInstruction(g, t, 'BranchByCharacter', [3, 0, 1, 19]);
  assert.equal(t.pc, 19);
  t.pc = 2;
  executeInstruction(g, t, 'BranchByCharacter', [3, 1, 0, 23]);
  assert.equal(t.pc, 23);
  t.pc = 2;
  executeInstruction(g, t, 'BranchByCharacter', [4, 0, 1, 40]);
  assert.equal(t.pc, 2);
});

test('member count and direction branches use the PR comparison and direction target tables', () => {
  const g = game(), t = { pc: 1 };
  executeInstruction(g, t, 'BranchByNumOfMember', [1, 3, 12], [], ['＝']);
  assert.equal(t.pc, 12);
  executeInstruction(g, t, 'BranchByPlayerDirection', [6, 8, 6, 3]);
  assert.equal(t.pc, 6);
});

test('field battle handoff preserves scripted return codes and restores Vargas party data', () => {
  const g = game(), task = { locals: [] };
  Object.assign(g.roster[1], { hp: 0, mp: 0, conditions: [5], removed: true, hidden: true });
  g.banks = { PlaySystems: { battle0055: [{ id: 1, hp: 73, mp: 12, conditions: [] }] } };
  g.battles = [{ outcome: 'victory', code: 4 }];
  g.unit = id => g.roster[id];
  executeSyscall(g, task, '戦闘結果取得');
  assert.equal(task.locals[0], 4);
  executeSyscall(g, task, 'バトルデータ復元：sc_b_0055');
  assert.equal(g.roster[1].hp, 73);
  assert.equal(g.roster[1].mp, 12);
  assert.deepEqual(g.roster[1].conditions, []);
  assert.equal(g.roster[1].removed, false);
  assert.equal(g.roster[1].hidden, false);
  assert.equal(g.banks.PlaySystems.battle0055, undefined);
});
