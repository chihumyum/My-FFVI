import test from 'node:test'; import assert from 'node:assert/strict';
import { GameSession } from '../src/core/game-session.js'; import { GameFlow } from '../src/core/game-flow.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js'; import { CheckpointStorage } from '../src/core/saved-game.js';
import { WEB_SCRIPTED_BATTLE_ACTIONS } from '../src/core/scripted-battle-action.js';
import { compileScriptedBattleAction } from '../src/compiler/battle-scripted-action.js';
import { checkpointFixture } from './fixtures/checkpoint-game.js';
import { variableSource, variableAction } from './fixtures/enemy-variable-action.js';
import type { BattleEventOp } from '../src/core/battle-event.js';
const ready = { visible: true, mediaReady: true, overlayOpen: false }, runtime = { battleHandoff: 'prepared' as const, scriptedBattleActions: WEB_SCRIPTED_BATTLE_ACTIONS };
function fixture(defeat = false) {
  const f = checkpointFixture(); f.battle.common.abilities[901] = variableSource().compile().abilities[901]!;
  if (defeat) f.battle.common.abilities[10]!.power = 1000000;
  const finish = compileScriptedBattleAction({ type: 1, mnemonic: 'BattleAction', operands: { iValues: defeat ? [2, 1, 10, 1, 0, 0, 0, 0] : [1, 1001, 10, 2, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill('') } });
  const ops: BattleEventOp[] = [variableAction(), finish, { kind: 'exit' }];
  f.battle.encounters[1000]!.lifecycle = { kind: 'battle-lifecycle-v1', mode: 'script', scriptId: 1, program: { kind: 'battle-event-v1', source: null, entry: 0, end: ops.length,
    localNames: [], initialLocals: [], instructions: ops.map(op => ({ mnemonic: op.kind, op })), blockers: [] } };
  return f;
}
test('actual Field → Session → Battle → return → Storage keeps one owned owner and discards the ephemeral enemy bank', async () => {
  const f = fixture(), session = new GameSession(f.field, f.battle, 123, runtime), flow = new GameFlow(session); flow.start(); flow.advance(0, ready); assert(session.field.startEvent('fight'));
  const owner = session.state, before = owner.snapshot(), handoff = new GameBattleHandoff(flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, 'committed'); const battle = session.battle!, enemy = battle.enemies[0]!;
  for (let i = 0; i < 1000 && enemy.behavior!.variables[0] === 0; i++) flow.advance(10, ready);
  assert.equal(enemy.behavior!.variables[0], 3); assert.deepEqual(owner.snapshot(), before); assert.throws(() => session.checkpoint());
  for (let i = 0; i < 5000 && battle.phase === 'active'; i++) flow.advance(10, ready); assert.equal(battle.phase, 'victory');
  let fail = true; const failing = new GameBattleHandoff(flow, { prepareStart: async () => ({}), prepareReturn: async () => { if (fail) throw Error('return media'); return {}; }, discard() {} });
  assert.equal((await failing.return()).status, 'failed'); assert.deepEqual(owner.snapshot(), before); assert.equal(enemy.behavior!.variables[0], 3);
  fail = false; assert.equal((await failing.return()).status, 'committed'); flow.advance(10, ready); assert.strictEqual(session.state, owner); assert.equal(owner.snapshot().completedBattles.length, 1);
  const checkpoint = session.checkpoint(), values = new Map<string, string>(); let quota = true;
  const storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (quota) throw Error('quota'); values.set(key, value); } }, 'framework', 'enemy-variable');
  await assert.rejects(storage.save(checkpoint, 1), /quota/); assert.deepEqual(session.checkpoint(), checkpoint); quota = false; await storage.save(checkpoint, 2);
  const loaded = (await storage.load())!, restored = GameSession.restore(loaded.checkpoint, f.field, f.battle, undefined, runtime), next = new GameFlow(restored); next.start(); next.advance(0, ready);
  assert.deepEqual(restored.checkpoint(), checkpoint); assert.throws(() => battle.advance(10), /Retired/);
  assert(restored.field.startEvent('fight')); const nextHandoff = new GameBattleHandoff(next, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await nextHandoff.start()).status, 'committed'); const fresh = restored.battle!; assert.notStrictEqual(fresh, battle); assert.notStrictEqual(fresh.enemies[0], enemy); assert.equal(fresh.enemies[0]!.behavior!.variables[0], 0);
  Reflect.get(battle, 'resolve').call(battle, battle.action); assert.equal(fresh.enemies[0]!.behavior!.variables[0], 0);
});
test('actual defeat retry obtains a fresh enemy bank and cannot publish the retired mutation twice', async () => {
  const f = fixture(true), session = new GameSession(f.field, f.battle, 123, runtime), flow = new GameFlow(session); flow.start(); flow.advance(0, ready); assert(session.field.startEvent('fight'));
  const before = session.state.snapshot(), handoff = new GameBattleHandoff(flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, 'committed'); const old = session.battle!; for (let i = 0; i < 5000 && old.phase === 'active'; i++) flow.advance(10, ready);
  assert.equal(old.phase, 'defeat'); assert.equal(old.enemies[0]!.behavior!.variables[0], 3); assert.deepEqual(session.state.snapshot(), before);
  assert.equal((await handoff.retry()).status, 'committed'); const fresh = session.battle!; assert.notStrictEqual(fresh, old); assert.equal(fresh.enemies[0]!.behavior!.variables[0], 0); assert.deepEqual(session.state.snapshot(), before);
  for (let i = 0; i < 1000 && fresh.enemies[0]!.behavior!.variables[0] === 0; i++) flow.advance(10, ready); assert.equal(fresh.enemies[0]!.behavior!.variables[0], 3); assert.throws(() => old.advance(10), /Retired/);
});
