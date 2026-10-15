import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleGame, type Combatant } from '../src/core/battle.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameCommands } from '../src/core/game-commands.js';
import { advanceBattleEvent, createBattleEventState } from '../src/core/battle-event.js';
import { WEB_BATTLE_EVENT_CONTROLS } from '../src/core/battle-controls.js';
import { WEB_SCRIPTED_BATTLE_ACTIONS } from '../src/core/scripted-battle-action.js';
import { WEB_BATTLE_EVENT_MESSAGE_POLICY } from '../src/core/battle-event-message.js';
import { SourceMessageState } from '../src/core/source-message.js';
import { createWebFieldMessageSequencePort } from '../src/core/source-message-sequence.js';
import { battleMessageContent, battleMessageProgram, battleMessageSessionFixture, messageRaw } from './fixtures/battle-event-message.js';

const syscall = (name: string) => { const raw = messageRaw('SysCall'); raw.operands.sValues[0] = name; return raw; };
const ready = { visible: true, mediaReady: true, overlayOpen: false };
function visibilityProgram() {
  return battleMessageProgram([messageRaw('BattleEndEnabled'), syscall('HideBattleUI'), messageRaw('Wait', .05),
    syscall('ShowBattleUI'), syscall('StopAutoBattle'), messageRaw('Wait', .05), messageRaw('Exit')]);
}
test('all common control operands decode exactly; unknown queue cancellation and altered operands stay blocked', () => {
  for (const [name, expected] of [['HideBattleUI', { kind: 'ui-visibility', visible: false }],
    ['ShowBattleUI', { kind: 'ui-visibility', visible: true }], ['StopAutoBattle', { kind: 'stop-auto' }]] as const) {
    const raw = syscall(name);
    assert.deepEqual(battleMessageProgram([raw, messageRaw('Exit')]).instructions[0]!.op, expected);
    for (const key of ['iValues', 'rValues', 'sValues'] as const) {
      const changed = structuredClone(raw); (changed.operands[key] as (string | number)[])[7] = key === 'sValues' ? 'unknown' : 1;
      assert.equal(battleMessageProgram([changed, messageRaw('Exit')]).instructions[0]!.op.kind, 'blocked');
    }
  }
  const blocked = battleMessageProgram([syscall('RemoveAllAct'), messageRaw('Exit')]);
  assert.equal(blocked.instructions[0]!.op.kind, 'blocked');
  assert.throws(() => createBattleEventState(blocked), /staged-action cancellation.*executor state/);
});
test('the detached VM yields one immediate control request and advances without an invented wait', () => {
  const program = battleMessageProgram([syscall('HideBattleUI'), syscall('StopAutoBattle'), syscall('ShowBattleUI'), messageRaw('Exit')]);
  const context = { clock: 1, timeSeconds: .01, started: true, aiCoreAlive: false, actionStaging: false };
  let state = createBattleEventState(program);
  for (const [pc, kind] of ['ui-visibility', 'stop-auto', 'ui-visibility'].entries()) {
    const next = advanceBattleEvent(program, state, context);
    assert.equal(next.requests.length, 1); assert.equal(next.requests[0]!.kind, kind);
    assert.equal(next.requests[0]!.pc, pc); assert.equal(next.state.pc, pc + 1); assert.equal(next.state.wait, null); state = next.state;
  }
  assert.equal(advanceBattleEvent(program, state, context).state.status, 'exited');
});
test('controls require an explicit runtime policy before a battle or owned lease can publish', () => {
  const content = battleMessageContent(visibilityProgram());
  assert.throws(() => new BattleGame(content, 7), /explicit Web battle event control policy/);
  assert.throws(() => new BattleGame(content, 7, undefined, undefined, undefined, undefined, undefined, undefined,
    { controls: 'invented' as typeof WEB_BATTLE_EVENT_CONTROLS }), /Unknown battle event control policy/);
  const f = battleMessageSessionFixture(visibilityProgram()), game = new GameSession(f.field, f.battle, 7, f.runtime);
  game.field.startEvent('fight'); game.advance(10); const before = game.state.snapshot(), request = game.field.stop;
  assert.throws(() => game.prepareBattleStart()!.commit(), /explicit Web battle event control policy/);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, false); assert.equal(game.field.stop, request);
  assert.deepEqual(game.state.snapshot(), before);
});
test('the real Session, Flow and Commands observe one battle UI owner; hidden menus release WAIT and user pause only', () => {
  const f = battleMessageSessionFixture(visibilityProgram()), game = new GameSession(f.field, f.battle, 7,
    { ...f.runtime, battleEventControls: WEB_BATTLE_EVENT_CONTROLS }), flow = new GameFlow(game);
  flow.start(); flow.advance(0, ready); game.field.startEvent('fight'); game.advance(10); game.prepareBattleStart()!.commit();
  const b = game.battle!, commands = new GameCommands(flow, game), owned = game.state.snapshot();
  flow.advance(10, ready); assert.deepEqual(b.uiControls, { visible: false, pauseLocked: true, revision: 1 });
  assert.equal(commands.battleReady, false); assert.equal(b.ready.length, 0); assert.equal(b.canRequestEscape, false);
  assert.equal(flow.pause(true), false); assert.equal(flow.paused, false); assert.equal(b.playerControlMode, 'manual');
  b.setClockInput({ ...b.timingState.input, uiWaiting: true, forceWaiting: true });
  const detached = b.uiControls; detached.visible = true; assert.equal(b.uiControls.visible, false);
  const at = b.time; flow.advance(1000, { ...ready, visible: false }); assert.equal(b.time, at, 'background host gate remains authoritative');
  flow.advance(100, ready); assert.deepEqual(b.uiControls, { visible: true, pauseLocked: false, revision: 2 });
  assert.equal(commands.battleReady, true); assert.equal(flow.pause(true), true); assert.equal(flow.paused, true);
  assert.equal(flow.pause(false), true); assert.deepEqual(game.state.snapshot(), owned);
  assert.throws(() => b.setAutomaticMode(true), /unimplemented Web controller/);
});
function joint(failEffects: boolean) {
  const action = messageRaw('BattleAction'); action.operands.iValues = [1,1000,11,1,1001,1,0,0];
  const pause = messageRaw('BattlePause'); pause.operands.iValues[0] = 1;
  const program = battleMessageProgram([messageRaw('BattleEndEnabled'), syscall('HideBattleUI'), syscall('StopAutoBattle'),
    pause, action, messageRaw('Msg', 0), messageRaw('MsgClose'), syscall('ShowBattleUI'), messageRaw('Exit')]);
  const content = battleMessageContent(program), players: Combatant[] = content.players.map(p =>
    ({ ...structuredClone(p), maxHp: p.hp, maxMp: p.mp, atb: 0, queued: false, behavior: null }));
  players[1]!.hp = 10; const owner = new SourceMessageState(); let fail = failEffects;
  const battle = new BattleGame(content, 91, players, undefined, undefined, undefined, undefined, undefined,
    { controls: WEB_BATTLE_EVENT_CONTROLS, scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS,
      messages: { policy: WEB_BATTLE_EVENT_MESSAGE_POLICY, owner, sequence: createWebFieldMessageSequencePort(),
        prepareEffects() { const validate = () => { if (fail) throw new Error('controlled shared message failure'); };
          return { validate, commit: validate }; } } });
  return { battle, owner, allow: () => { fail = false; } };
}
const snapshot = (f: ReturnType<typeof joint>) => ({ time: f.battle.time, ui: f.battle.uiControls,
  event: f.battle.eventExecution, queue: f.battle.pendingActions, units: structuredClone(f.battle.combatants),
  action: structuredClone(f.battle.action), message: f.owner.snapshot(), revision: f.owner.mutationRevision });
test('hidden controls leave the real forced-action queue and shared source message manager active', () => {
  const f = joint(false), b = f.battle, mp = b.players[0]!.mp; let hiddenAction = false, hiddenMessage = false;
  for (let n = 0; n < 4000 && b.eventExecution.state!.status !== 'exited'; n++) {
    if (f.owner.projection?.acceptsInput) b.confirmMessage(); b.advance(10);
    hiddenAction ||= !b.uiControls.visible && b.action?.kind === 'event'; hiddenMessage ||= !b.uiControls.visible && f.owner.active;
  }
  assert.equal(hiddenAction, true); assert.equal(hiddenMessage, true); assert.equal(b.eventExecution.state!.status, 'exited');
  assert.equal(b.players[0]!.mp, mp - 2); assert(b.players[1]!.hp > 10); assert.equal(b.pendingActions.length, 0);
  assert.deepEqual(b.uiControls, { visible: true, pauseLocked: false, revision: 2 }); assert.equal(f.owner.active, false);
});
test('a late shared-frame failure rolls back UI, manual controls, queue, message and PC before retry', () => {
  const f = joint(true), before = snapshot(f);
  assert.throws(() => f.battle.advance(10), /controlled shared message failure/); assert.deepEqual(snapshot(f), before);
  f.allow(); f.battle.advance(0); assert.equal(f.battle.uiControls.revision, 1); assert.equal(f.owner.active, true);
  assert.equal(f.battle.pendingActions.length, 1, 'failed attempt did not leave a duplicate forced action');
});
test('a real hidden-control defeat can retry; cancellation preserves the old view and successful retry resets the new owner', () => {
  const p = battleMessageProgram([syscall('HideBattleUI'), messageRaw('Wait', .01), syscall('ShowBattleUI'),
    syscall('HideBattleUI'), messageRaw('ExecBattleAI'), messageRaw('Nop'), messageRaw('Blank'),
    messageRaw('SyncBattleAI'), messageRaw('Nop'), messageRaw('Exit')]);
  p.instructions[8]!.op = { kind: 'branch', index: 0, operator: '＝', right: { kind: 'immediate', value: 0 }, target: 5 };
  const f = battleMessageSessionFixture(p);
  // The authored entry has one-HP players. No live battle or owned snapshot is patched.
  for (const player of f.battle.common.players) player.hp = 1;
  const game = new GameSession(f.field, f.battle, 11, { ...f.runtime, battleEventControls: WEB_BATTLE_EVENT_CONTROLS }),
    flow = new GameFlow(game); flow.start(); flow.advance(0, ready); game.field.startEvent('fight'); game.advance(10);
  game.prepareBattleStart()!.commit(); const old = game.battle!, commands = new GameCommands(flow, game), owned = game.state.snapshot();
  for (let n = 0; n < 30000 && old.phase === 'active'; n++) flow.advance(10, ready);
  assert.equal(old.phase, 'defeat'); assert.deepEqual(old.uiControls, { visible: false, pauseLocked: true, revision: 3 });
  assert.equal(commands.canRetryBattle(old), true); assert.equal(flow.pause(true), true); flow.pause(false); flow.advance(0, ready);
  const cancelled = game.prepareBattleRetry()!; cancelled.discard(); assert.equal(game.battle, old);
  assert.deepEqual(old.uiControls, { visible: false, pauseLocked: true, revision: 3 }); assert.deepEqual(game.state.snapshot(), owned);
  assert.equal(game.prepareBattleRetry()!.commit(), true); const current = game.battle!; assert.notEqual(current, old);
  assert.deepEqual(current.uiControls, { visible: false, pauseLocked: true, revision: 1 }, 'source entry Hide executes on the new initial VM, not on old UI state');
  assert.equal(current.time, 0);
  assert.equal(commands.ownsBattle(old), false); assert.equal(commands.canRetryBattle(old), false);
  assert.deepEqual(game.state.snapshot(), owned); flow.advance(20, ready); assert.equal(current.uiControls.revision, 3);
});
