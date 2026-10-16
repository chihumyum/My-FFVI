import test from 'node:test'; import assert from 'node:assert/strict';
import { variableSource, variableContent, variableMagicSource, variableAction } from './fixtures/enemy-variable-action.js';
import { enemyVariableActorBlocker, projectEnemyVariableAction, validateSourceEnemyVariableMetadata } from '../src/core/enemy-variable-action.js';
import { initialEnemyBehavior } from '../src/core/enemy-behavior.js';
import { BattleGame } from '../src/core/battle.js';
import { WEB_SCRIPTED_BATTLE_ACTIONS } from '../src/core/scripted-battle-action.js';
import { FieldFadeState, DEVELOPMENT_TRANSPARENT_FADE } from '../src/core/field-fade.js';
import { WEB_BATTLE_GLOBAL_FADE } from '../src/core/battle-global-fade.js';
import { fixture } from './fixtures/battle-content.js';
import { cyclingAI, syntheticAI } from './fixtures/battle-ai.js';
import { enemyPartyFixture } from './fixtures/battle-party-game.js';
import { participantProgram } from './fixtures/battle-participant-game.js';
import { enemyBattleDefinition } from '../src/core/battle-participants.js';
import { mineralizationContent } from './fixtures/condition-mineralization.js';
const game = (held = false) => new BattleGame(variableContent(held).content, 123, undefined, undefined, undefined, undefined, undefined, undefined, { scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS });
const snap = (b: BattleGame) => structuredClone({ units: b.combatants, time: b.time, phase: b.phase, action: b.action, pending: b.pendingActions,
  received: b.pendingReactionExecution, ai: b.enemies.map(e => b.enemyAIState(e.id)), event: b.eventExecution, events: b.events, random: Reflect.get(b, 'randomState') });
function until(b: BattleGame, p: () => boolean) { for (let i = 0; i < 1000 && !p(); i++) b.advance(10); assert(p()); }
test('complete source Function23 binds the actual phase while retaining the primary and every original operand', () => {
  const f = variableSource(), original = structuredClone(f.tables), r = f.compile(), a = r.abilities[901]!;
  assert(a.plan); assert.equal(a.program.functions.length, 2); assert.deepEqual(a.program.process.values, [999, 0, 3]);
  assert.deepEqual(a.plan.effects.map(e => e.kind), ['non-damaging']); assert(a.enemyVariableAction);
  assert.equal(enemyVariableActorBlocker(a, 'enemy'), null); assert.match(enemyVariableActorBlocker(a, 'player')!, /actual attacker/);
  assert.deepEqual(f.tables, original); assert(r.entries[901]!.sources.some(s => s.rowId === '823'));
  f.ability.id = '902'; assert(f.compile().abilities[902]!.plan, 'ID does not select this shared protocol');
  for (const change of [(f: ReturnType<typeof variableSource>) => { f.group.function2_value1 = '1'; },
    (f: ReturnType<typeof variableSource>) => { f.group.function3_id = '801'; },
    (f: ReturnType<typeof variableSource>) => { f.ability.data_b = '-1'; },
    (f: ReturnType<typeof variableSource>) => { f.ability.process_prog = 'CRANE_BATTLE_VARIABLE_CALC'; },
    (f: ReturnType<typeof variableSource>) => { f.group.function2_id = '0'; }]) {
    const f = variableSource(); change(f); assert.equal(f.compile().abilities[901]!.plan, null);
  }
  const forged = structuredClone(a); forged.enemyVariableAction!.sourceProgram.process.values[2]++;
  assert.throws(() => validateSourceEnemyVariableMetadata(forged.program, forged.enemyVariableAction!), /Unbound/);
  delete forged.enemyVariableAction; assert.match(enemyVariableActorBlocker(forged, 'enemy')!, /Missing/);
});
test('SET/ADD/TWO use direct fifteen-cell attacker indexes and ordered signed int32 arithmetic without mutating the input', () => {
  for (const key of ['SET_VARIABLE_CALC', 'ADD_VARIABLE_CALC', 'ADD_VARIABLE_CALC_TWO_DIMENTIONAL']) {
    const a = variableSource(key, key.endsWith('DIMENTIONAL') ? 14 : -999, 14, 2).compile().abilities[901]!, bank = initialEnemyBehavior();
    bank.variables[14] = 2147483647; const before = structuredClone(bank), result = projectEnemyVariableAction(a, { id: 'owned-enemy', side: 'enemy', behavior: bank })!;
    assert.deepEqual(bank, before); assert.equal(result.after.variables[14], key === 'SET_VARIABLE_CALC' ? 2 : key.endsWith('DIMENTIONAL') ? -2147483645 : -2147483647);
    assert.deepEqual(result.attackerCalculation, { value: 0, hitType: -1, hitCount: 0, conditions: null, recovery: false });
    assert.deepEqual(result.targetCalculation, { value: 0, hitType: 2, hitCount: 0, conditions: [], recovery: false });
    assert.equal(result.ownerId, 'owned-enemy'); assert.throws(() => projectEnemyVariableAction(a, { id: 'p', side: 'player', behavior: bank }), /actual attacker/);
    assert.throws(() => projectEnemyVariableAction(a, { id: 'e', side: 'enemy', behavior: null }), /owner/);
  }
  for (const index of [-1, 15]) assert.equal(variableSource('ADD_VARIABLE_CALC', 0, index).compile().abilities[901]!.plan, null);
});
test('real source action writes once and keeps its attacker dictionary separate from primary Hit and event continuation', () => {
  const b = game(), actor = b.enemies[0]!; assert.equal(actor.behavior!.variables[0], 0);
  until(b, () => !!b.action?.resolved); assert.equal(actor.behavior!.variables[0], 3);
  assert.equal(b.action!.results.length, 1); assert.equal(b.action!.results[0]!.effects[0]!.resource, 'none');
  assert.equal(b.action!.enemyVariableResult!.attackerCalculation.hitType, -1); assert.equal(b.action!.enemyVariableResult!.after.variables[0], 3);
  until(b, () => b.eventExecution.state!.locals[0] === 1); b.advance(100); assert.equal(actor.behavior!.variables[0], 3); assert.equal(b.eventExecution.state!.locals[0], 1);
});
test('receiver Blank keeps its independent AI bank; late failure, pause and stale actor preserve the attacker mutation', () => {
  const b = game(true), actor = b.enemies[0]!; until(b, () => !!b.pendingReactionExecution); assert.equal(actor.behavior!.variables[0], 0);
  const held = snap(b); b.setClockInput({ ...b.timingState.input, paused: true }); b.advance(500); assert.deepEqual(snap(b), held); b.setClockInput({ ...b.timingState.input, paused: false });
  b.advance(10); const receiver = b.enemies[1]!, instruction = receiver.ai!.instructions[7]!, saved = instruction.op; instruction.op = { kind: 'blocked', reason: 'late variable receiver failure' };
  const before = snap(b), owners = [...b.combatants]; assert.throws(() => b.advance(10), /late variable receiver failure/); assert.deepEqual(snap(b), before); assert(b.combatants.every((u, i) => u === owners[i]));
  instruction.op = saved; const old = receiver.ai; receiver.ai = structuredClone(old); assert.throws(() => b.advance(0), /Stale prepared/); receiver.ai = old;
  b.advance(0); assert.equal(b.pendingReactionExecution, null); assert.equal(actor.behavior!.variables[0], 3); assert.equal(receiver.behavior!.variables[0], 1);
  assert.equal(b.action!.enemyVariableResult!.after.variables[0], 3, 'original phase result remains detached from later AI mutation');
});
test('shared-host failure after the variable commit rolls bank, AI context, costs and RNG back for one retry', () => {
  const c = variableContent(true).content, owner = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE); let fail = false;
  const prepare = owner.prepareFrame.bind(owner); owner.prepareFrame = () => { const frame = prepare(); return { ...frame, prepareCommit() { const write = frame.prepareCommit(); return { ...write, validate() { write.validate(); if (fail) throw Error('late host variable failure'); } }; } }; };
  const b = new BattleGame(c, 127, undefined, undefined, undefined, undefined, undefined, undefined, { scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS, fade: { policy: WEB_BATTLE_GLOBAL_FADE, owner } });
  until(b, () => !!b.pendingReactionExecution); b.advance(10); const before = snap(b), fade = owner.snapshot(); fail = true;
  assert.throws(() => b.advance(10), /late host variable failure/); assert.deepEqual(snap(b), before); assert.deepEqual(owner.snapshot(), fade);
  fail = false; b.advance(0); assert.equal(b.enemies[0]!.behavior!.variables[0], 3); assert.equal(b.enemies[1]!.behavior!.variables[0], 1); assert.equal(b.pendingReactionExecution, null);
});
test('retirement drops a held mutation and stale completion cannot publish to a replacement owner', () => {
  const b = game(true); until(b, () => !!b.pendingReactionExecution); const action = b.action!, actor = b.enemies[0]!, retire = b.prepareEventRetirement();
  retire.validate(); retire.commit(); assert.equal(b.pendingReactionExecution, null); Reflect.get(b, 'resolve').call(b, action);
  assert.equal(actor.behavior!.variables[0], 0); assert.equal(action.resolved, false); assert.throws(() => b.advance(10), /Retired/);
});
test('a multi-target primary, second-target failure and retry perform a single variable phase and a single MP payment', () => {
  const f = variableMagicSource(); f.ability.battle_renge_id = '4';
  const content = fixture(); content.abilities[901] = f.compileAbility().abilities[901]!; content.players.forEach(p => p.hp = 5000);
  content.enemies = content.enemies.slice(0, 1); Object.assign(content.enemies[0]!, { abilities: [901], ai: cyclingAI([901]), mp: 20, hp: 5000 }); content.initialAtb.enemy = [100, 100];
  const b = new BattleGame(content, 314), enemy = b.enemies[0]!; b.advance(400); const target = b.players[1]!, defense = target.magicDefense; target.magicDefense = NaN;
  const before = snap(b); assert.throws(() => b.advance(10)); assert.deepEqual(snap(b), before); assert.equal(enemy.behavior!.variables[0], 0); assert.equal(enemy.mp, 20);
  target.magicDefense = defense; b.advance(0); assert(b.action?.resolved); assert.equal(b.action!.results.length, 2); assert.equal(enemy.behavior!.variables[0], 3); assert.equal(enemy.mp, 17);
  const clean = new BattleGame(content, 314); clean.advance(410); assert.deepEqual(snap(b), snap(clean));
});
test('the variable phase is independent of primary miss and a source self Hit never wakes a received-AI route', () => {
  const f = variableMagicSource(); f.ability.accuracy_rate = '0';
  const c = fixture(); c.abilities[901] = f.compileAbility().abilities[901]!; c.players.forEach(p => p.magicEvasion = 255);
  c.enemies = c.enemies.slice(0, 1); Object.assign(c.enemies[0]!, { abilities: [901], ai: cyclingAI([901]), mp: 20, hp: 5000 }); c.initialAtb.enemy = [100, 100];
  const b = new BattleGame(c, 314); b.advance(410); assert(b.action?.resolved); assert.equal(b.action!.results[0]!.effects[0]!.missed, true); assert.equal(b.enemies[0]!.behavior!.variables[0], 3);
  const self = variableContent(); self.content.enemies[0]!.ai = syntheticAI([['Nop'], ['SyncAI'], ['StartTable', [0]], ['Act', [13]], ['EndTable'], ['Blank'], ['JumpBattleAI', [0]]]);
  assert(self.content.lifecycle?.mode === 'script'); self.content.lifecycle.program.instructions.unshift({ mnemonic: 'exec-ai', op: { kind: 'exec-ai' } }); self.content.lifecycle.program.end++;
  const own = new BattleGame(self.content, 315, undefined, undefined, undefined, undefined, undefined, undefined, { scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS });
  until(own, () => !!own.action?.resolved); assert.equal(own.pendingReactionExecution, null); assert.equal(own.enemies[0]!.behavior!.variables[0], 3);
});
test('self lethal Final observes the newly staged bank; its held AI tail cannot overwrite or double-apply Function23', () => {
  const f = variableContent(true), c = f.content; c.enemies = c.enemies.slice(0, 1); c.enemies[0]!.hp = 1;
  c.enemies[0]!.ai = syntheticAI([['Nop'], ['SyncAI'], ['StartTable', [0]], ['Act', [13]], ['EndTable'], ['FinalAttackAct', [13]],
    ['Blank'], ['Blank'], ['ValueCalc', [0, 1], [], ['＋']], ['JumpBattleAI', [0]]]);
  c.abilities[901]!.power = 1000000; assert(c.lifecycle?.mode === 'script');
  c.lifecycle.program.instructions[3]!.op = variableAction();
  const b = new BattleGame(c, 317, undefined, undefined, undefined, undefined, undefined, undefined, { scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS });
  until(b, () => !!b.pendingReactionExecution); assert.equal(b.enemies[0]!.behavior!.variables[0], 0); assert.equal(b.pendingReactionExecution!.receivers[0]!.finalReady, true);
  b.advance(10); b.advance(10); assert.equal(b.pendingReactionExecution, null); assert.equal(b.enemies[0]!.behavior!.variables[0], 4);
  assert.equal(b.action!.enemyVariableResult!.after.variables[0], 3); assert.equal(b.finalAttackExecution.length, 1);
});
test('an older unpublished normal AI wake is an explicit atomic gate rather than a bank overwrite', () => {
  const { content: c } = variableContent(); c.initialAtb.enemy = [100, 100]; c.enemies[0]!.ai = syntheticAI([
    ['Nop'], ['SyncAI'], ['VariableAssign', [0, 7]], ['StartTable', [0]], ['Act', [13]],
    ...Array.from({ length: 100 }, () => ['Blank'] as ['Blank']), ['EndTable'], ['JumpBattleAI', [0]]]);
  assert(c.lifecycle?.mode === 'script'); const ops = c.lifecycle.program.instructions;
  ops.splice(0, 0, { mnemonic: 'exec-ai', op: { kind: 'exec-ai' } });
  ops[2] = { mnemonic: 'wait', op: { kind: 'wait', seconds: 0.01 } }; c.lifecycle.program.end++;
  const b = new BattleGame(c, 319, undefined, undefined, undefined, undefined, undefined, undefined, { scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS });
  until(b, () => !!b.action && b.action.elapsed === 390); assert(b.enemyAIState('e1')!.continuation); assert.equal(b.enemies[0]!.behavior!.variables[0], 0);
  const before = snap(b); assert.throws(() => b.advance(10), /earlier unpublished AI wake/); assert.deepEqual(snap(b), before);
});
test('a held variable parent, failed complete-party publication and new generation cannot share a retired bank', () => {
  const c = enemyPartyFixture(), magic = variableMagicSource(), next = variableSource(); next.ability.id = '902';
  c.abilities[901] = magic.compileAbility().abilities[901]!; c.abilities[902] = next.compile().abilities[902]!;
  c.enemies[0]!.mp = 20; c.enemies.forEach(e => e.hp = 5000); c.initialAtb.enemy = [0, 0];
  c.enemies[1]!.ai = syntheticAI([['Nop'], ['SyncAI'], ['StartTable', [0]], ['Act', [13]], ['EndTable'],
    ['Blank'], ['Blank'], ['ValueCalc', [0, 1], [], ['＋']], ['JumpBattleAI', [0]]]);
  for (const enemy of c.enemies) c.participants!.enemyDefinitions[enemy.sourceId] = enemyBattleDefinition(enemy);
  const ops = [{ kind: 'exec-ai' as const }, { kind: 'end-enabled' as const, enabled: false }, { kind: 'pause' as const, enabled: true },
    variableAction(901, 2, 8, 2), { kind: 'change-enemy-party' as const, partyId: 513, hidden: false }, variableAction(902),
    { kind: 'wait' as const, seconds: 100 }, { kind: 'exit' as const }];
  c.lifecycle = { kind: 'battle-lifecycle-v1', mode: 'script', scriptId: 1, program: participantProgram(ops) };
  const b = new BattleGame(c, 323, undefined, undefined, undefined, undefined, undefined, undefined, { scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS });
  until(b, () => !!b.pendingReactionExecution); const oldActor = b.enemies[0]!, oldReceiver = b.enemies[1]!, oldAction = b.action!;
  assert.equal(oldActor.behavior!.variables[0], 0); b.advance(20); assert.equal(oldActor.behavior!.variables[0], 3); assert.equal(oldReceiver.behavior!.variables[0], 1);
  Object.defineProperty(b.events, 'push', { configurable: true, value() { if (b.enemyPartyExecution.partyId === 513) throw Error('late generation publication'); return Array.prototype.push.apply(this, arguments as never); } });
  let before: ReturnType<typeof snap> | null = null;
  for (let i = 0; i < 200; i++) { const state = snap(b); try { b.advance(10); } catch (error) { assert.match(String(error), /late generation publication/); before = state; break; } }
  assert(before); assert.deepEqual(snap(b), before); assert.equal(b.enemyPartyExecution.partyId, 1000); assert.strictEqual(b.enemies[0], oldActor); assert.equal(oldActor.behavior!.variables[0], 3);
  delete (b.events as unknown as { push?: unknown }).push; b.advance(0); assert.equal(b.enemyPartyExecution.partyId, 513);
  const fresh = b.enemies[0]!; assert(fresh); assert.notStrictEqual(fresh, oldActor); assert.equal(fresh.behavior!.variables[0], 0);
  until(b, () => !!b.action?.resolved && b.action.source.id === 902); assert.equal(fresh.behavior!.variables[0], 3); assert.equal(oldActor.behavior!.variables[0], 3);
  const stable = snap(b); Reflect.get(b, 'resolve').call(b, oldAction); assert.deepEqual(snap(b), stable);
});
test('a variable companion cannot bypass the retained Mineralization numeric gate or publish its bank on failure', () => {
  const c = mineralizationContent().content, f = variableMagicSource(); f.ability.battle_renge_id = '4'; c.abilities[901] = f.compileAbility().abilities[901]!;
  c.players[0]!.conditionIds = [1911]; Object.assign(c.enemies[0]!, { abilities: [901], ai: cyclingAI([901]), mp: 20 }); c.initialAtb.enemy = [100, 100];
  const b = new BattleGame(c, 327); b.advance(400); const before = snap(b);
  assert.throws(() => b.advance(10), /Mineralization numeric\/other effect consumer/); assert.deepEqual(snap(b), before);
  assert.equal(b.enemies[0]!.behavior!.variables[0], 0); assert.equal(b.enemies[0]!.mp, 20);
});
