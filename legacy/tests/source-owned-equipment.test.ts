import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSourceOwnedEquipmentInstruction } from '../src/compiler/source-owned-equipment.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { fieldInstructionRequirements } from '../src/core/field-content-admission.js';
import { sourceEquipmentTargets, type SourceEquipmentCommand } from '../src/core/source-owned-equipment.js';
import { emptyPartyState } from '../src/core/party.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { equipmentGameFixture } from './fixtures/equipment-game.js';
import { readyHost } from './fixtures/game-flow.js';
import type { Op } from '../src/field/types.js';
const source = { file: 'synthetic', assetPath: 'source-owned-equipment-contract' };
const all: SourceEquipmentCommand = { kind: 'remove-equipment-members', scope: 'all' };
const reserve: SourceEquipmentCommand = { kind: 'remove-equipment-members', scope: 'reserve' };
const raw = (selector: string) => ({ type: 1, mnemonic: 'SysCall', operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: [selector, ...Array(7).fill('')] } });
function setup({ reverseClamp = false } = {}) {
  const f = equipmentGameFixture();
  if (reverseClamp) {
    f.catalog.gameState.equipmentSystem!.catalog.definitions[501]!.parameter!.values.hp = 30;
    f.catalog.gameState.equipmentSystem!.catalog.definitions[401]!.parameter!.values.hp = -20;
    f.catalog.common.players[1]!.hp = 100;
  }
  for (const scope of ['all', 'reserve'] as const) f.field.scripts['remove-' + scope] = [
    { ...compileSourceOwnedEquipmentInstruction(raw(scope === 'all' ? '全員の装備を外す' : '控えメンバーの装備を外す')), script: 'remove-' + scope, index: 0, source },
    { kind: 'flag', ref: { category: 'ScenarioFlag1', index: 3 }, operation: 'set', script: 'remove-' + scope, index: 1, source },
    { kind: 'exit', script: 'remove-' + scope, index: 2, source },
  ];
  const game = new GameSession(f.field, f.catalog, 314), flow = new GameFlow(game); flow.start(); flow.advance(0, readyHost);
  return { ...f, game, flow };
}
function execute(f: ReturnType<typeof setup>, scope: 'all' | 'reserve') {
  f.flow.session.field.startEvent('remove-' + scope);
  f.flow.advance(10, readyHost);
  assert.equal(f.flow.session.field.stop, null);
  assert.equal(f.flow.session.field.menuReady, true);
}
test('source decodes removal and parameterized strongest selectors through the same equipment port', () => {
  for (const [selector, scope] of [['全員の装備を外す', 'all'], ['控えメンバーの装備を外す', 'reserve']]) {
    const typed = compileSourceOwnedEquipmentInstruction(raw(selector!)); assert.equal(typed.command.kind, "remove-equipment-members"); assert.equal((typed.command as Extract<SourceEquipmentCommand,{kind:"remove-equipment-members"}>).scope, scope);
    const op = decodeFieldOp(raw(selector!), { script: 'probe', index: 0, source }, {}, {});
    assert.equal(op.kind, 'source-owned-equipment');
    assert.deepEqual(fieldInstructionRequirements(op).map(r => r.capability), ['rosterEquipment']);
  }
  for (const [selector, sourceId] of [['最強装備：ティナ', 1], ['最強装備：エドガー', 5]] as const) {
    assert.deepEqual(compileSourceOwnedEquipmentInstruction(raw(selector)), { kind: 'source-owned-equipment', command: { kind: 'strongest-non-accessories', sourceId } });
    const op = decodeFieldOp(raw(selector), { script: 'probe', index: 0, source }, {}, {});
    assert.equal(op.kind, 'source-owned-equipment');
    assert.deepEqual(fieldInstructionRequirements(op).map(r => r.capability), ['rosterEquipment']);
  }
  for (const change of [(r: ReturnType<typeof raw>) => r.operands.iValues[7] = 1, (r: ReturnType<typeof raw>) => r.operands.rValues[0] = 1, (r: ReturnType<typeof raw>) => r.operands.sValues[1] = 'extra']) {
    const value = raw('全員の装備を外す'); change(value); assert.throws(() => compileSourceOwnedEquipmentInstruction(value), /operand banks/);
  }
});
test('source targets enabled held order, excludes Umaro and defines reserve using only the selected Corps', () => {
  const roster = [{ id: 'a', sourceId: 1, ownedId: 20, enabled: true }, { id: 'b', sourceId: 2, ownedId: 3, enabled: true },
    { id: 'disabled', sourceId: 5, ownedId: 9, enabled: false }, { id: 'umaro', sourceId: 14, ownedId: 1, enabled: true }];
  const party = emptyPartyState(); party.selectedSlot = 1; party.slots[1][0]!.id = 'a'; party.slots[1][2]!.id = 'disabled'; party.slots[2][3]!.id = 'b';
  assert.deepEqual(sourceEquipmentTargets(roster, party, all), ['a', 'b']);
  assert.deepEqual(sourceEquipmentTargets(roster, party, reserve), ['b']);
  party.selectedSlot = 2; assert.deepEqual(sourceEquipmentTargets(roster, party, reserve), ['a']);
});
test('real Field and Flow remove all six slots per owner, clamp in source reverse order and preserve total inventory', () => {
  const f = setup({ reverseClamp: true }), before = f.game.state.snapshot();
  const ticket = f.game.state.fieldRoster.prepareEquipment!(all);
  assert.deepEqual(ticket.targets, ['a', 'b']);
  assert.deepEqual(ticket.changes.filter(c => c.targetId === 'a').map(c => c.slot), [5, 4, 3, 2, 1]);
  execute(f, 'all');
  const after = f.game.state.snapshot(); assert.deepEqual(after.equipmentStock, before.equipmentStock);
  assert.deepEqual(after.roster.map(p => p.equipment), [[1, 1, 3, 4, 5, 5], [1, 1, 3, 4, 5, 5]]);
  assert.equal(after.roster[0]!.maxHp, 120); assert.equal(after.roster[0]!.hp, 100);
  assert.deepEqual(after.party, before.party); assert.deepEqual(after.releasedJobIds, before.releasedJobIds);
  assert.throws(ticket.validate, /Stale/);
});
test('reserve unloads an enabled owner in a different saved party and keeps the current Corps intact', () => {
  const f = setup(), changed = f.game.state.snapshot(); changed.party.slots[0][1]!.id = null; changed.party.slots[2][3]!.id = 'b'; f.game.state.restore(changed);
  execute(f, 'reserve'); const after = f.game.state.snapshot();
  assert.deepEqual(after.roster[0]!.equipment, changed.roster[0]!.equipment);
  assert.deepEqual(after.roster[1]!.equipment, [1, 1, 3, 4, 5, 5]);
  assert.deepEqual(after.equipmentStock, changed.equipmentStock); assert.deepEqual(after.party, changed.party);
});
test('live preparation is atomic, retries once after cancellation and rejects reentry, async publication or stale revisions', () => {
  const f = setup(), before = f.game.state.snapshot(), ticket = f.game.state.fieldRoster.prepareEquipment!(all);
  assert.throws(() => ticket.commitWith(() => { throw Error('controlled cancellation'); }), /cancellation/); assert.deepEqual(f.game.state.snapshot(), before);
  assert.throws(() => ticket.commitWith(() => f.game.state.fieldInventory.prepare({ kind: 'grant-gil', amount: 1 }).commit()), /publication is in progress/);
  assert.throws(() => ticket.commitWith(async () => {}), /synchronous/); assert.deepEqual(f.game.state.snapshot(), before);
  ticket.commitWith(() => { assert.deepEqual(f.game.state.snapshot(), before); }); const committed = f.game.state.snapshot();
  assert.throws(() => ticket.commitWith(() => {}), /Stale/); assert.deepEqual(f.game.state.snapshot(), committed);
  const stale = f.game.state.fieldRoster.prepareEquipment!(all); f.game.state.fieldInventory.prepare({ kind: 'grant-gil', amount: 1 }).commit(); assert.throws(stale.validate, /Stale/);
});
test('a missing actual empty item cancels the entire multi-owner removal without granting a static default', () => {
  const f = setup(), changed = f.game.state.snapshot(); changed.equipmentStock.find(s => s.id === 3)!.count = 0; f.game.state.restore(changed);
  const before = f.game.state.snapshot(); assert.throws(() => f.game.state.fieldRoster.prepareEquipment!(all), /Missing owned empty/); assert.deepEqual(f.game.state.snapshot(), before);
});
test('private map draft rejects cancellation, reentry, old generation and rebound tickets while preserving one owner', () => {
  const f = setup(), before = f.game.state.snapshot(), draft = f.game.state.prepareFieldState(), ticket = draft.ports.roster.prepareEquipment!(all);
  assert.throws(() => ticket.commitWith(() => { throw Error('candidate cancelled'); }), /cancelled/);
  assert.deepEqual(f.game.state.snapshot(), before);
  assert.throws(() => ticket.commitWith(() => draft.ports.inventory.prepare({ kind: 'grant-gil', amount: 1 }).commit()), /Stale|publication/);
  ticket.commitWith(() => {}); assert.deepEqual(f.game.state.snapshot(), before); assert.throws(ticket.validate, /Stale/);
  const retained = draft.ports.roster.prepareEquipment!(all); assert.equal(draft.commit(), true); assert.throws(retained.validate, /Stale/);
  const after = f.game.state.snapshot(); assert.deepEqual(after.roster[0]!.equipment, [1, 1, 3, 4, 5, 5]);
  draft.ports.roster.prepareEquipment!(all).commitWith(() => {}); assert.deepEqual(f.game.state.snapshot(), after);
});
test('actual Storage restores the completed field event and continues through the same Session and Flow APIs', async () => {
  const f = setup(); execute(f, 'all'); const checkpoint = f.game.checkpoint(), values = new Map<string, string>();
  const store = new CheckpointStorage({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } }, 'framework', 'source-equipment-contract');
  await store.save(checkpoint, 100); const saved = await store.load(); assert.ok(saved);
  const restored = GameSession.restore(saved.checkpoint, f.field, f.catalog); assert.deepEqual(restored.checkpoint(), checkpoint);
  const flow = new GameFlow(restored); flow.start(); flow.advance(0, readyHost);
  restored.field.startEvent('remove-reserve'); flow.advance(10, readyHost); assert.equal(restored.field.stop, null); assert.equal(restored.field.menuReady, true);
  assert.deepEqual(restored.state.snapshot().equipmentStock, checkpoint.owned.equipmentStock);
  await store.save(restored.checkpoint(), 200); assert.equal((await store.load(true))!.savedAt, 100);
});
