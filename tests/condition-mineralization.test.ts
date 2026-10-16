import test from 'node:test'; import assert from 'node:assert/strict';
import { mineralizationContent, mineralizationSource } from './fixtures/condition-mineralization.js';
import { BattleGame } from '../src/core/battle.js';
import { BattleConditions } from '../src/core/battle-conditions.js';
import { WEB_MINERALIZATION_PHASES } from '../src/core/condition-mineralization.js';
import { battleEventUnitGameOver } from '../src/core/battle-event-context.js';
import { projectActionTargets } from '../src/core/action-user-conditions.js';
const snap = (b: BattleGame) => structuredClone({ units: b.combatants, time: b.time, action: b.action,
  pending: b.pendingActions, random: Reflect.get(b, 'randomState'), events: b.events, phase: b.phase, reward: b.reward });
function until(b: BattleGame, p: () => boolean) { for (let i = 0; i < 5000 && !p(); i++) b.advance(10); assert(p()); }

test('Mineralization positively binds independent game-over, ordinary-target and persistent fields plus temporary resistance', () => {
  const f = mineralizationSource(), a = f.compileAbility().abilities[901]!, c = f.compile().catalog,
    conditions = new BattleConditions(c), behavior = c.behaviors.find(b => b.id === 1911)!;
  assert(a.plan, a.blockers.join(';')); assert.equal(behavior.kind, 'mineralization');
  if (behavior.kind !== 'mineralization') throw Error('shape');
  assert.equal(behavior.phasePolicy, WEB_MINERALIZATION_PHASES);
  assert.deepEqual(conditions.effectiveResistances([1911], {}, 'enemy'), { 6: 1 });
  assert.equal(conditions.isUnableFight([1911]), false); assert.equal(conditions.isGameOver([1911]), true);
  assert.deepEqual(conditions.settleLife(63, [1911], false), { hp: 63, conditionIds: [1911] });
  assert.deepEqual(conditions.battleEnd([1911]), [1911]); conditions.validateStableLife(63, [1911]);
  assert.equal(conditions.mineralizationPhaseHp('player', 63, [1911]), 63);
  assert.equal(conditions.mineralizationPhaseHp('enemy', 63, [1911]), 0);
  assert.throws(() => conditions.validateActive([1999]), /Unimplemented/);
  assert.throws(() => conditions.eventListChange([], 1911, 'add', 'enemy'), /explicit life\/control\/instance/);
});
test('changed lifecycle scalar, missing resistance/asset or missing explicit phase declaration cannot gain behavior', () => {
  for (const mutate of [(f: ReturnType<typeof mineralizationSource>) => { f.stone.attack_target = '1'; },
    (f: ReturnType<typeof mineralizationSource>) => { f.stone.game_over_target = '0'; },
    (f: ReturnType<typeof mineralizationSource>) => { f.stone.until_type = '2'; },
    (f: ReturnType<typeof mineralizationSource>) => { f.tables['condition_group.csv'] = []; },
    (f: ReturnType<typeof mineralizationSource>) => { f.tables['icon.csv'] = []; }]) {
    const f = mineralizationSource(); mutate(f); const a = f.compileAbility().abilities[901]!;
    assert.equal(a.plan, null); assert(a.blockers.length);
  }
  const c = mineralizationSource().compile().catalog, b = c.behaviors.find(b => b.kind === 'mineralization')!;
  Reflect.deleteProperty(b, 'phasePolicy'); assert.throws(() => new BattleConditions(c), /Mineralization/);
});
test('Start keeps enemy HP until completed action boundary; existing death conflict and rewards run once afterward', () => {
  const { content } = mineralizationContent(), b = new BattleGame(content, 314), p = b.players[0]!, e = b.enemies[0]!;
  assert(b.command(p.id, 901, e.id)); until(b, () => Boolean(b.action?.resolved));
  assert.deepEqual(e.conditionIds, [1911]); assert.equal(e.hp, 200);
  const gauge = e.atb; b.advance(10); assert.equal(e.atb, gauge, 'Start suspends without inventing a gauge reset');
  assert.equal(b.conditions.isUnableFight(e.conditionIds), false); assert.equal(b.phase, 'active');
  until(b, () => b.phase === 'victory'); assert.equal(e.hp, 0); assert(e.conditionIds.includes(5));
  assert.equal(b.reward!.exp, 9); assert.equal(b.reward!.gil, 7); const reward = structuredClone(b.reward);
  b.advance(1000); assert.deepEqual(b.reward, reward); assert.equal(p.mp, 6);
});
test('positive HP stone player stays targetable, has no actions, and a real cure restores the same owner', () => {
  const { content } = mineralizationContent(); content.players[0]!.conditionIds = [1911];
  const b = new BattleGame(content, 314), p = b.players[0]!, caster = b.players[1]!, hp = p.hp;
  assert(!b.ready.includes(p)); assert(!b.canUse(p.id, 901)); assert(b.targetChoices(caster.id, 902).some(c => c.targetIds.includes(p.id)));
  assert.equal(battleEventUnitGameOver(content.battleEvents!, p.conditionIds), true);
  assert(b.command(caster.id, 902, p.id)); until(b, () => Boolean(b.action?.resolved));
  assert.equal(p.hp, hp); assert.deepEqual(p.conditionIds, []); assert.strictEqual(b.players[0], p); assert(b.ready.includes(p));
});
test('all positive HP stone players defeat independently of Main completion; no enemy or player HP is guessed at Start', () => {
  const { content } = mineralizationContent(); for (const p of content.players) p.conditionIds = [1911];
  const b = new BattleGame(content, 314), initial = b.players.map(p => p.hp); b.advance(10);
  assert.equal(b.phase, 'defeat'); assert.deepEqual(b.players.map(p => p.hp), initial); assert.equal(b.reward, null);
});
test('lifecycle admission cannot silently enable numeric recovery/damage/absorption on a newly active stone domain', () => {
  const { content } = mineralizationContent(); content.players[0]!.conditionIds = [1911];
  const b = new BattleGame(content, 314), target = b.players[0]!, actor = b.players[1]!, before = snap(b);
  for (const kind of ['physical', 'magic', 'recovery', 'absorb-resource', 'base-hp-magic'])
    assert.throws(() => b.conditions.validateMineralizationEffects([kind], [target.conditionIds]), /Unresolved Mineralization/);
  assert.throws(() => projectActionTargets(content.abilities[10]!.plan!, 10, actor, [target], b.conditions,
    () => assert.fail('an unclosed consumer must reject before RNG')), /Unresolved Mineralization/);
  assert.deepEqual(snap(b), before);
});
test('late settlement failure rolls back the action/down phase, death, rewards and random before one successful retry', () => {
  const { content } = mineralizationContent(); content.enemies[0]!.exp = 10000; content.experience.push({ level: 3, exp: 100 });
  content.growth.g = [{ level: 3, hp: 2, mp: 1 }];
  const b = new BattleGame(content, 314), p = b.players[0]!, e = b.enemies[0]!;
  assert(b.command(p.id, 901, e.id)); until(b, () => b.action?.elapsed === 890);
  const old = content.growth.g!; content.growth.g = []; const before = snap(b);
  assert.throws(() => b.advance(10), /growth dependency/); assert.deepEqual(snap(b), before);
  assert.equal(e.hp, 200); assert(e.conditionIds.includes(1911)); assert.equal(p.mp, 6); content.growth.g = old;
  until(b, () => b.phase === 'victory'); assert.equal(e.hp, 0); assert.equal(p.mp, 6);
});
