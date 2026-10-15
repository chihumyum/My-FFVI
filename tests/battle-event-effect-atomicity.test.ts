import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleGame } from '../src/core/battle.js';
import { SourceMessageState } from '../src/core/source-message.js';
import { createWebFieldMessageSequencePort } from '../src/core/source-message-sequence.js';
import { WEB_BATTLE_EVENT_MESSAGE_POLICY } from '../src/core/battle-event-message.js';
import { createWebBattleEventEffectHost, WEB_BATTLE_EVENT_EFFECTS, type BattleEventEffectHost } from '../src/core/battle-event-effect.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { battleMessageContent, battleMessageProgram, battleMessageSessionFixture, messageRaw } from './fixtures/battle-event-message.js';
import { authoredBattleEffect as effect } from './fixtures/battle-event-effect.js';
const increment = { kind: 'calc' as const, index: 0, operator: '＋' as const, right: { kind: 'immediate' as const, value: 1 } };
function joint(newResources = false) {
  const program = battleMessageProgram([messageRaw('BattlePause'), messageRaw('Nop'), messageRaw('Nop'),
    messageRaw('Nop'), messageRaw('Msg', -1, 'ASYNC'), messageRaw('Nop'), messageRaw('Exit')]);
  program.instructions[0]!.op = { kind: 'pause', enabled: true };
  program.instructions[1]!.op = effect(1);
  program.instructions[2]!.op = effect(1, 1001);
  program.instructions[3]!.op = newResources ? increment : { kind: 'sync-battle-effect' };
  program.instructions[5]!.op = increment;
  program.instructions.unshift({ mnemonic: 'BattleEndFlag', op: { kind: 'end-enabled', enabled: false } }); program.end++;
  const owner = new SourceMessageState();
  let battle!: BattleGame, mask = 3, failCommit = false, discarded = 0;
  const cleanupStates: unknown[] = [], cleanupReentrancy: string[] = [], base = createWebBattleEventEffectHost();
  const attempt = (write: () => void) => { try { write(); cleanupReentrancy.push('accepted'); } catch(error) { cleanupReentrancy.push((error as Error).message); } };
  const host: BattleEventEffectHost = { policy: WEB_BATTLE_EVENT_EFFECTS, prepare(request) {
    const resource = base.prepare(request);
    return { ...resource, discard() { discarded++; cleanupStates.push(state());
      attempt(() => battle.advance(10)); attempt(() => { battle.confirmMessage(); });
      throw Error('authored cleanup failure'); } };
  } };
  battle = new BattleGame(battleMessageContent(program), 99, undefined, undefined, undefined, undefined, undefined, undefined, {
    effects: host, messages: { policy: WEB_BATTLE_EVENT_MESSAGE_POLICY, owner, sequence: createWebFieldMessageSequencePort(),
      prepareEffects(effects) {
        const before = mask, next = effects[0]!.group === 8 ? 9 : 3;
        const validate = () => { assert.equal(mask, before); };
        return { validate, commit() { validate(); if (failCommit) throw Error('authored message commit failure'); mask = next; } };
      } },
  });
  function state() { return { time: battle.time, units: structuredClone(battle.combatants), event: battle.eventExecution,
    effects: battle.effectPresentation, journal: battle.effectExecution, action: structuredClone(battle.action),
    pending: battle.pendingActions, message: owner.snapshot(), revision: owner.mutationRevision, mask }; }
  return { battle, owner, state, cleanupStates, cleanupReentrancy, discarded: () => discarded, fail() { failCommit = true; }, allow() { failCommit = false; } };
}
test('same-frame Msg and VM publication survive every throwing completed-lease cleanup; later leases still clean up', () => {
  const f = joint(), b = f.battle;
  b.advance(310); assert.equal(b.effectPresentation.length, 2); assert.equal(f.owner.active, false);
  const beforeRevision = f.owner.mutationRevision;
  assert.doesNotThrow(() => b.advance(10)); const published = f.state();
  assert.equal(published.time, 320); assert.equal(published.event.state!.locals[0], 1);
  assert.equal(f.owner.active, true); assert.equal(published.mask, 9); assert.equal(f.owner.mutationRevision, beforeRevision + 1);
  assert.equal(b.effectPresentation.length, 0); assert.equal(f.discarded(), 2); assert.deepEqual(f.cleanupStates, [published, published]);
  assert.equal(f.cleanupReentrancy.length, 4); assert(f.cleanupReentrancy.every(message => /Reentrant/.test(message)));
  assert.deepEqual(b.effectCleanupFailures, [{ reason: 'complete', time: 320 }, { reason: 'complete', time: 320 }]);
  const detached = b.effectCleanupFailures; detached.length = 0; assert.equal(b.effectCleanupFailures.length, 2);
  b.advance(10); assert.equal(b.time, 330); assert.equal(b.eventExecution.state!.locals[0], 1); assert.equal(f.discarded(), 2);
});
test('message commit failure restores every battle/message owner before throwing candidate cleanup and preserves the original error', () => {
  const f = joint(true), before = f.state(); f.fail(); assert.throws(() => f.battle.advance(10), /authored message commit failure/);
  assert.deepEqual(f.state(), before); assert.equal(f.discarded(), 2); assert.deepEqual(f.cleanupStates, [before, before]);
  assert.equal(f.cleanupReentrancy.length, 4); assert(f.cleanupReentrancy.every(message => /Reentrant/.test(message)));
  assert.deepEqual(f.battle.effectCleanupFailures, [{ reason: 'rollback', time: 0 }, { reason: 'rollback', time: 0 }]);
  f.allow(); f.battle.advance(0); assert.equal(f.owner.active, true); assert.equal(f.battle.eventExecution.state!.locals[0], 2);
  assert.equal(f.battle.effectExecution.filter(e => e.action === 'request').length, 2);
});
test('failed message retirement leaves effects owned and makes no cleanup call until a joint successful retirement', () => {
  const f = joint(true); f.battle.advance(10); const before = f.state(); f.fail(); const refused = f.battle.prepareEventRetirement();
  assert.throws(() => refused.commit(), /authored message commit failure/); assert.deepEqual(f.state(), before); assert.equal(f.discarded(), 0);
  f.allow(); assert.doesNotThrow(() => f.battle.prepareEventRetirement().commit()); assert.equal(f.owner.active, false);
  assert.equal(f.battle.effectPresentation.length, 0); assert.equal(f.discarded(), 2); assert.equal(f.battle.effectCleanupFailures.length, 2);
  assert.throws(() => f.battle.advance(10), /Retired/);
});
const ready = { visible: true, mediaReady: true, overlayOpen: false };
function session() {
  const p = battleMessageProgram();
  for (const i of p.instructions) if (i.op.kind === 'jump' || i.op.kind === 'call' || i.op.kind === 'branch' || i.op.kind === 'variable-branch') i.op.target++;
  p.instructions.unshift({ mnemonic: 'PlayBattleEffect', op: effect(1) }); p.end++;
  const f = battleMessageSessionFixture(p); let readyResource = false, discards = 0;
  const host: BattleEventEffectHost = { policy: WEB_BATTLE_EVENT_EFFECTS, prepare() {
    return { validate() {}, status() { return readyResource ? 'ready' : 'loading'; }, commit() {}, discard() { discards++; throw Error('authored retirement cleanup failure'); } };
  } };
  const runtime = { ...f.runtime, battleEventEffects: host }, game = new GameSession(f.field, f.battle, 314, runtime), flow = new GameFlow(game);
  flow.start(); flow.advance(0, ready); assert(game.field.startEvent('fight')); game.advance(10); assert.equal(game.prepareBattleStart()!.commit(), true); game.advance(10);
  return { game, discards: () => discards, lateReady() { readyResource = true; } };
}
function finish(game: GameSession) {
  for (let n = 0; n < 30000 && game.battle?.phase === 'active'; n++) {
    if (game.battle.sourceMessage?.projection?.acceptsInput) game.battle.confirmMessage();
    if (!game.battle.messageInputPending) for (const actor of game.battle.ready) {
      const t = game.battle.targets(actor.id, 10)[0]; if (t) game.battle.command(actor.id, 10, t.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, 'victory');
}
for (const mode of ['retry', 'return'] as const) test(`real Session ${mode} publishes despite cleanup failure; old completion cannot touch a new battle or window`, () => {
  const f = session(), game = f.game, old = game.battle!, owner = game.field.sourceMessage;
  assert.equal(old.sourceMessage, owner); assert.equal(owner.active, true);
  if (mode === 'retry') {
    // Authored terminal failure fixture, never a source-story result.
    for (const player of old.players) { player.hp = 0; player.conditionIds = [305]; }
    game.advance(10); assert.equal(old.phase, 'defeat'); assert.equal(game.prepareBattleRetry()!.commit(), true);
  } else {
    finish(game); assert.equal(old.effectPresentation.length, 1); assert.equal(game.prepareBattleReturn()!.commit(), true); game.advance(10);
    assert(game.field.startEvent('fight')); game.advance(10); assert.equal(game.prepareBattleStart()!.commit(), true);
  }
  const fresh = game.battle!, before = { owned: game.state.snapshot(), window: owner.snapshot(), revision: owner.mutationRevision, event: fresh.eventExecution };
  assert.notEqual(fresh, old); assert.equal(owner.active, false); assert.equal(f.discards(), 1);
  assert.deepEqual(old.effectCleanupFailures, [{ reason: 'retire', time: old.time }]);
  f.lateReady(); assert.throws(() => old.advance(10), /Retired/); assert.throws(() => old.confirmMessage(), /Retired/);
  assert.deepEqual({ owned: game.state.snapshot(), window: owner.snapshot(), revision: owner.mutationRevision, event: fresh.eventExecution }, before);
  game.advance(10); assert.equal(fresh.effectPresentation.length, 1); assert.equal(owner.active, true);
  assert.equal(fresh.effectCleanupFailures.length, 0); assert.equal(f.discards(), 1);
});
