import test from 'node:test'; import assert from 'node:assert/strict';
import { GameSession } from '../src/core/game-session.js'; import { GameFlow } from '../src/core/game-flow.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js'; import { CheckpointStorage } from '../src/core/saved-game.js';
import { WEB_SCRIPTED_BATTLE_ACTIONS } from '../src/core/scripted-battle-action.js';
import { compileScriptedBattleAction } from '../src/compiler/battle-scripted-action.js';
import { checkpointFixture } from './fixtures/checkpoint-game.js';
import { mineralizationContent } from './fixtures/condition-mineralization.js';
const ready = { visible: true, mediaReady: true, overlayOpen: false }, runtime = { battleHandoff: 'prepared' as const, scriptedBattleActions: WEB_SCRIPTED_BATTLE_ACTIONS };
const action = (id: number, actorSide = 1, actor = 1000, targetSide = 2, target = 1) => compileScriptedBattleAction({ type: 1, mnemonic: 'BattleAction', operands: { iValues: [actorSide, actor, id, targetSide, target, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill('') } });
function fixture(cure: boolean, defeat = false) {
  const f = checkpointFixture(), common = f.battle.common, stone = mineralizationContent().content;
  common.conditions = stone.conditions; common.battleEvents = stone.battleEvents!;
  common.abilities[901] = stone.abilities[901]!; common.abilities[902] = stone.abilities[902]!;
  const ops = defeat ? [action(901, 2, 1, 1, 0), { kind: 'exit' as const }] : [action(901, 2, 1, 1, 1000),
    ...(cure ? [action(902, 1, 1001, 1, 1000)] : []), action(10, 1, 1001, 2, 0), { kind: 'exit' as const }];
  f.battle.encounters[1000]!.lifecycle = { kind: 'battle-lifecycle-v1', mode: 'script', scriptId: 1, program: { kind: 'battle-event-v1', source: null, entry: 0, end: ops.length, localNames: [], initialLocals: [], instructions: ops.map(op => ({ mnemonic: op.kind, op })), blockers: [] } };
  return f;
}
for (const cure of [false, true]) test(`actual Field/Session retains positive HP stone ${cure ? 'until scripted cure' : 'through return and Storage'} with one owned lease`, async () => {
  const f = fixture(cure), session = new GameSession(f.field, f.battle, 123, runtime), flow = new GameFlow(session);
  flow.start(); flow.advance(0, ready); assert(session.field.startEvent('fight')); const owner = session.state, before = owner.snapshot();
  let fail = true; const discarded: unknown[] = [], handoff = new GameBattleHandoff(flow, { prepareStart: async () => { if (fail) { fail = false; throw Error('authored media failure'); } return {}; }, prepareReturn: async () => ({}), discard: value => discarded.push(value) });
  assert.equal((await handoff.start()).status, 'failed'); assert.deepEqual(owner.snapshot(), before);
  let release!: (value: object) => void; const waiting = new Promise<object>(yes => { release = yes; });
  const stale = new GameBattleHandoff(flow, { prepareStart: () => waiting, prepareReturn: async () => ({}), discard: value => discarded.push(value) }), pending = stale.start();
  stale.cancel(); assert.equal((await handoff.start()).status, 'committed'); release({ stale: true }); assert.equal((await pending).status, 'cancelled'); assert.equal(discarded.length, 1);
  const b = session.battle!, target = b.players[0]!, initialHp = target.hp;
  for (let i = 0; i < 5000 && !(b.action?.source.id === 901 && b.action.resolved); i++) flow.advance(10, ready);
  assert(target.conditionIds.includes(1911)); assert.equal(target.hp, initialHp); assert(!b.ready.includes(target)); assert.deepEqual(owner.snapshot(), before); assert.throws(() => session.checkpoint());
  for (let i = 0; i < 5000 && b.phase === 'active'; i++) flow.advance(10, ready); assert.equal(b.phase, 'victory');
  assert.equal(target.conditionIds.includes(1911), !cure); assert.equal(target.hp, initialHp);
  assert.equal((await handoff.return()).status, 'committed'); flow.advance(10, ready); assert.strictEqual(session.state, owner); assert.equal(owner.snapshot().completedBattles.length, 1);
  assert.equal(session.players[0]!.conditionIds.includes(1911), !cure);
  const checkpoint = session.checkpoint(), values = new Map<string, string>(); let quota = true;
  const storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (quota) throw Error('quota'); values.set(key, value); } }, 'framework', 'mineralization-' + cure);
  await assert.rejects(storage.save(checkpoint, 1), /quota/); assert.equal(values.size, 0); assert.deepEqual(session.checkpoint(), checkpoint);
  quota = false; await storage.save(checkpoint, 2); const saved = (await storage.load())!, restored = GameSession.restore(saved.checkpoint, f.field, f.battle, undefined, runtime), next = new GameFlow(restored);
  next.start(); next.advance(0, ready); assert.deepEqual(restored.checkpoint(), checkpoint); assert.equal(restored.players[0]!.conditionIds.includes(1911), !cure);
  const stable = restored.state.snapshot(); next.advance(500, ready); assert.deepEqual(restored.state.snapshot(), stable); assert.throws(() => b.advance(10), /Retired/);
});
test('actual all-stone positive-HP defeat preserves entry owner; retry discards the old battle and does not replay its phase', async () => {
  const f = fixture(false, true), session = new GameSession(f.field, f.battle, 123, runtime), flow = new GameFlow(session);
  flow.start(); flow.advance(0, ready); assert(session.field.startEvent('fight')); const before = session.state.snapshot(), handoff = new GameBattleHandoff(flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, 'committed'); const old = session.battle!, hp = old.players.map(p => p.hp);
  for (let i = 0; i < 5000 && old.phase === 'active'; i++) flow.advance(10, ready); assert.equal(old.phase, 'defeat'); assert.deepEqual(old.players.map(p => p.hp), hp); assert.deepEqual(session.state.snapshot(), before);
  assert.equal((await handoff.retry()).status, 'committed'); assert.notStrictEqual(session.battle, old); assert(session.battle!.players.every(p => !p.conditionIds.includes(1911))); assert.deepEqual(session.state.snapshot(), before); assert.throws(() => old.advance(10), /Retired/);
});
