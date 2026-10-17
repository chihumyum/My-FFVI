import test from 'node:test'; import assert from 'node:assert/strict';
import { compileFieldConditionCatalog } from '../src/compiler/field-conditions.js';
import { FieldConditions } from '../src/core/field-conditions.js';
import { mineralizationSource, mineralizationContent } from './fixtures/condition-mineralization.js';
import { GameSession } from '../src/core/game-session.js'; import { GameFlow } from '../src/core/game-flow.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { WEB_SCRIPTED_BATTLE_ACTIONS } from '../src/core/scripted-battle-action.js';
import { WEB_BATTLE_EVENT_CONTROLS } from '../src/core/battle-controls.js';
import { compileScriptedBattleAction } from '../src/compiler/battle-scripted-action.js';
import { checkpointFixture } from './fixtures/checkpoint-game.js'; import { fixtureParty } from './fixtures/party.js';
import type { BattleEventOp } from '../src/core/battle-event.js';
import { WEB_BATTLE_FORCED_SAVE } from '../src/core/battle-forced-save.js';
test('source-bound Battle Stone preserves Field master references without granting an active provider or rereading Battle assets', () => {
  const f = mineralizationSource(), battle = f.compile().catalog, before = structuredClone({ tables: f.tables, battle }), compiled = compileFieldConditionCatalog(f.reader(), battle, [106]);
  assert.deepEqual(compiled.catalog.definitions, battle.rules.definitions.map(({ id, type }) => ({ id, type })));
  assert(compiled.catalog.definitions.some(d => d.id === 1911 && d.type === 11)); assert(!compiled.catalog.behaviors.some(b => b.id === 1911));
  const field = new FieldConditions(compiled.catalog); assert.throws(() => field.validateActive([1911]), /Unimplemented active field/);
  assert.deepEqual(compiled.catalog.behaviors, [{ id: 4, kind: 'none' }, { id: 5, kind: 'none' }, { id: 6, kind: 'none' }, { id: 53, kind: 'none' }, { id: 110, kind: 'poison', hpDivisor: 32, soundId: 0 }]);
  assert(compiled.sources.some(r => r.source.assetPath.endsWith('/condition.csv') && r.source.rowId === '1911'));
  const ordinaryReader = f.reader(), row = ordinaryReader.row.bind(ordinaryReader), narrowReader = { ...ordinaryReader,
    row: (table: string, id: string | number) => { assert(!['battle_effect_asset.csv', 'icon.csv', 'se_asset.csv'].includes(table)); return row(table, id); } };
  assert.deepEqual(compileFieldConditionCatalog(narrowReader, battle, [106]).catalog, compiled.catalog);
  assert.deepEqual({ tables: f.tables, battle }, before);
  const forged = structuredClone(compiled.catalog); forged.behaviors.push({ id: 1911, kind: 'none' }); assert.throws(() => new FieldConditions(forged), /Unsupported field/);
});
test('malformed source, dependency bindings and forged domain metadata reject instead of silently withholding a condition', () => {
  for (const change of ['source-field', 'source-identity', 'definition-type', 'behavior-policy', 'resistance'] as const) {
    const f = mineralizationSource(), catalog = f.compile().catalog; let reader = f.reader();
    if (change === 'source-field') f.stone.field_se_asset_id = '1';
    if (change === 'source-identity') { const row = reader.row.bind(reader); reader = { ...reader, row: (table, id) => { const value = row(table, id); return table === 'condition.csv' && Number(id) === 1911 ? { ...value, source: { ...value.source, rowId: 'wrong' } } : value; } }; }
    if (change === 'definition-type') catalog.rules.definitions.find(d => d.id === 1911)!.type = 999;
    if (change === 'behavior-policy') Object.assign(catalog.behaviors.find(b => b.id === 1911)!, { phasePolicy: 'unknown' });
    if (change === 'resistance') catalog.behaviors.find(b => b.id === 1911)!.resistanceProvider!.groupId++;
    assert.throws(() => compileFieldConditionCatalog(reader, catalog, [106]), /Mineralization|table row/);
  }
  const f = mineralizationSource(), catalog = f.compile().catalog; Object.assign(catalog.behaviors[0]!, { kind: 'future-unsupported-behavior' });
  assert.throws(() => compileFieldConditionCatalog(f.reader(), catalog, [106]), /Field-domain projection/);
  const missing = mineralizationSource(), sourceBattle = missing.compile().catalog; missing.tables['icon.csv'] = [];
  assert.throws(() => missing.compile(), /table row/); // Battle dependency owner retains the hard gate.
  assert.doesNotThrow(() => compileFieldConditionCatalog(missing.reader(), sourceBattle, [106]));
});
const ready = { visible: true, mediaReady: true, overlayOpen: false }, runtime = { battleHandoff: 'prepared' as const, scriptedBattleActions: WEB_SCRIPTED_BATTLE_ACTIONS, battleEventControls: WEB_BATTLE_EVENT_CONTROLS };
const action = (id: number, actorSide = 1, actor = 1000, targetSide = 2, target = 1) => compileScriptedBattleAction({ type: 1, mnemonic: 'BattleAction', operands: { iValues: [actorSide, actor, id, targetSide, target, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill('') } });
function setup(cure = false, forced: boolean | 'saved' = false, reserve = false) {
  const f = checkpointFixture(), stone = mineralizationContent(); f.battle.common.conditions = stone.content.conditions; f.battle.common.battleEvents = stone.content.battleEvents!;
  f.battle.common.abilities[901] = stone.content.abilities[901]!; f.battle.common.abilities[902] = stone.content.abilities[902]!;
  f.battle.gameState.fieldConditions = compileFieldConditionCatalog(stone.source.reader(), stone.content.conditions, [106]).catalog;
  if (forced === 'saved') f.battle.encounters[1000]!.forcedSavePolicy = { kind: WEB_BATTLE_FORCED_SAVE };
  if (reserve) f.battle.gameState.initialParty = fixtureParty(['a']);
  const ops: BattleEventOp[] = reserve ? [{ kind: 'force-return' }, { kind: 'exit' }] : [action(901, 2, 1, 1, 1000),
    ...(cure ? [action(902, 1, 1001, 1, 1000)] : []), ...(forced ? [{ kind: forced === 'saved' ? 'force-save-return' : 'force-return' } as const] : [action(10, 1, 1001, 2, 0)]), { kind: 'exit' }];
  f.battle.encounters[1000]!.lifecycle = { kind: 'battle-lifecycle-v1', mode: 'script', scriptId: 1, program: { kind: 'battle-event-v1', source: null, entry: 0, end: ops.length, localNames: [], initialLocals: [], instructions: ops.map(op => ({ mnemonic: op.kind, op })), blockers: [] } };
  const session = new GameSession(f.field, f.battle, 123, runtime), flow = new GameFlow(session); flow.start(); flow.advance(0, ready);
  if (reserve) { const owned = session.state.snapshot(); owned.roster.find(p => p.id === 'b')!.conditionIds = [1911]; session.state.restore(owned); }
  return { ...f, session, flow };
}
async function battle(f: ReturnType<typeof setup>) {
  assert(f.session.field.startEvent('fight')); const handoff = new GameBattleHandoff(f.flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, 'committed'); const battle = f.session.battle!;
  for (let i = 0; i < 5000 && battle.phase === 'active'; i++) f.flow.advance(10, ready);
  return { battle, handoff };
}
test('actual prepared victory cannot publish unknown Field Stone; repeated failure retains the original state, battle and lease', async () => {
  const f = setup(), owner = f.session.state, before = owner.snapshot(), { battle: b, handoff } = await battle(f); assert.equal(b.phase, 'victory');
  const hp = b.players[0]!.hp; assert(hp > 0); assert(b.players[0]!.conditionIds.includes(1911));
  for (let i = 0; i < 2; i++) { const result = await handoff.return(); assert.equal(result.status, 'failed'); assert.deepEqual(owner.snapshot(), before); assert.strictEqual(f.session.battle, b); assert.equal(b.players[0]!.hp, hp); assert(b.players[0]!.conditionIds.includes(1911)); }
  assert.throws(() => f.session.prepareBattleReturn(), /Unimplemented active field/); assert.throws(() => f.session.checkpoint()); assert.equal(owner.snapshot().completedBattles.length, 0);
});
test('a real scripted cure permits the existing return; media failure and retry commit one receipt without a second owner', async () => {
  const f = setup(true), owner = f.session.state, before = owner.snapshot(), { battle: b } = await battle(f); assert(!b.players[0]!.conditionIds.includes(1911));
  let fail = true; const handoff = new GameBattleHandoff(f.flow, { prepareStart: async () => ({}), prepareReturn: async () => { if (fail) throw Error('return media'); return {}; }, discard() {} });
  assert.equal((await handoff.return()).status, 'failed'); assert.deepEqual(owner.snapshot(), before); fail = false;
  assert.equal((await handoff.return()).status, 'committed'); assert.strictEqual(f.session.state, owner); assert.equal(owner.snapshot().completedBattles.length, 1); assert(!owner.snapshot().roster[0]!.conditionIds.includes(1911)); assert.throws(() => b.advance(10), /Retired/);
});
test('forced no-save validates the actual old owned conditions and discards battle Stone without pretending it was cured', async () => {
  const f = setup(false, true), before = f.session.state.snapshot(), { battle: b, handoff } = await battle(f); assert.equal(b.phase, 'forced'); assert(b.players[0]!.conditionIds.includes(1911));
  assert.equal((await handoff.return()).status, 'committed'); const after = f.session.state.snapshot(); assert.deepEqual({ ...after, completedBattles: [] }, before); assert.equal(after.completedBattles.length, 1); assert(b.players[0]!.conditionIds.includes(1911));
});
test('actual saved forced return checks the retained Battle resources and rejects unknown Field Stone before publishing its receipt', async () => {
  const f = setup(false, 'saved'), owner = f.session.state, before = owner.snapshot(), { battle: b, handoff } = await battle(f);
  assert.equal(b.phase, 'forced'); assert.equal(b.previewForcedReturn()!.resultType, 6); assert(b.players[0]!.hp > 0); assert(b.players[0]!.conditionIds.includes(1911));
  for (let i = 0; i < 2; i++) { assert.equal((await handoff.return()).status, 'failed'); assert.deepEqual(owner.snapshot(), before); assert.strictEqual(f.session.battle, b); }
  assert.throws(() => f.session.prepareBattleReturn(), /Unimplemented active field/); assert.equal(owner.snapshot().completedBattles.length, 0);
});
test('a referenced condition on an unused roster member is retained and does not masquerade as an active moving-party provider', async () => {
  const f = setup(false, true, true), { handoff } = await battle(f); assert.equal((await handoff.return()).status, 'committed');
  assert(f.session.state.snapshot().roster.find(p => p.id === 'b')!.conditionIds.includes(1911)); f.session.state.fieldSteps.prepareStep(106).commit();
});
