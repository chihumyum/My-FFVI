import test from 'node:test';
import assert from 'node:assert/strict';
import { executePartyInput, partyInputMembers, submitPartyInput, autoPartyInput, cancelPartyInput } from './party-input.js';

function host(memberIds = [1, 2, 3, 5, 6, 7]) {
  return { banks: {}, roster: Object.fromEntries(memberIds.map(id => [id, { id, name: String(id), enabled: true,
    hp: 42, maxHp: 100, row: 'back' }])), partySlots: [[1, 2, 5, 6], [], []], partyIndex: 0,
  data: { programs: {}, fieldAssets: {} }, player: { x: 10, y: 20, visible: false }, events: [],
  event(kind, payload) { this.events.push({ kind, ...payload }); },
  unit() { throw new Error('Menu input must not create a roster member.'); } };
}
const task = () => ({ program: 1, pc: 1, locals: [17], waitFor: null });

test('a unit() lookup is not recruitment, and invalid input leaves the source menu paused', () => {
  const game = host([1, 2]);
  game.roster[1].enabled = undefined; // Initial source party, before a roster operation.
  game.roster[7] = { id: 7, name: 'named but not recruited' };
  game.roster[4] = { id: 4, enabled: false };
  game.partySlots = [[1, 4], [], []];
  assert.deepEqual(partyInputMembers(game).map(unit => unit.id), [1, 2]);
  const caller = task(), before = structuredClone(game.partySlots);
  assert(executePartyInput(game, caller, 'パーティ編成：１パーティ'));
  assert.equal(caller.waitFor, 'party');
  assert.equal(submitPartyInput(game, [[1, 7]]).ok, false);
  assert.deepEqual(game.partySlots, before);
  assert.equal(caller.waitFor, 'party');
  assert(cancelPartyInput(game));
  assert.deepEqual(game.partySlots, before);
  assert.equal(caller.waitFor, null);
});

test('the source count guard selects three, updates only the group count, and does not heal', () => {
  const game = host(), caller = task();
  game.rts = { active: true };
  game.data.programs[1] = { ops: [
    ['SysCall', [], [], ['パーティ編成：１パーティ']], ['FadeOut', [], [], []],
    ['Wait', [], [], []], ['BranchByNumOfMember', [0, 3, 7], [], ['＝']],
  ] };
  game.banks = { ScenarioFlag1: { 203: 1 }, ScenarioVariable: { 4: 2, 5: 3 } };
  const banks = structuredClone(game.banks), pose = { ...game.player };
  assert(executePartyInput(game, caller, 'パーティ編成：１パーティ'));
  assert.equal(game.partySlots[0].length, 4); // Opening the menu is not confirmation.
  assert.equal(game.partySelection.sourceCount, 3);
  assert(autoPartyInput(game).ok);
  assert.deepEqual(game.partySlots, [[1, 2, 5], [], []]);
  assert.equal(game.roster[6].reserve, true);
  assert.equal(game.roster[1].hp, 42);
  banks.ScenarioVariable[5] = 1;
  assert.deepEqual(game.banks, banks);
  assert.deepEqual([game.player.x, game.player.y, game.player.visible], [pose.x, pose.y, pose.visible]);
  assert.equal(caller.locals[0], 1);
  assert.equal(caller.waitFor, null);
  assert.equal(game.rts.active, false);
});

test('source mandatory members and all nonempty unique-party constraints apply to manual input', () => {
  const game = host(), caller = task();
  game.banks.ScenarioFlag1 = { 155: 1, 203: 0 };
  assert(executePartyInput(game, caller, 'パーティ編成：３パーティ'));
  assert.deepEqual(game.partySelection.forced, [2, 7]);
  assert.equal(submitPartyInput(game, [[2, 7], [1], [1]]).ok, false);
  assert.equal(submitPartyInput(game, [[7, 2], [1], [3]]).ok, false);
  assert.equal(submitPartyInput(game, [[2, 7], [], [1]]).ok, false);
  assert(autoPartyInput(game).ok);
  assert.equal(game.partySlots.filter(slot => slot.length).length, 3);
  assert.deepEqual(game.partySlots[0].slice(0, 2), [2, 7]);
  assert.equal(new Set(game.partySlots.flat()).size, game.partySlots.flat().length);
});

test('story include/minimum/count are menu inputs, and final ordering excludes outside reserves', () => {
  const game = host(), caller = task();
  assert(executePartyInput(game, caller, 'パーティ編成：１パーティ', { include: [7], minimum: 2, count: 3 }));
  assert(autoPartyInput(game).ok);
  assert.equal(game.partySlots[0].length, 3);
  assert(game.partySlots[0].includes(7));
  game.partySlots = [[7], [2], [5]];
  assert(executePartyInput(game, task(), 'パーティ編成：ラストバトル'));
  assert.equal(submitPartyInput(game, [[7, 1, 2, 5]]).ok, false);
  assert(submitPartyInput(game, [[5, 7, 2]]).ok);
  assert.deepEqual(game.finalBattleOrder, [5, 7, 2]);
  assert.equal(executePartyInput(game, task(), 'toString'), false);
});
