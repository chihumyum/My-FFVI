import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentCatalog, fixtureEquipmentGrants } from './fixtures/equipment.js';
import { ownedCharacterFixture } from './fixtures/owned-character.js';
import { fixtureWeaponEffects } from './fixtures/equipment.js';
import { compileOwnedCharacterInitialization } from '../src/compiler/owned-character.js';
import { initialEquipmentStock, previewEquipmentChange, validateEquipmentLoadout, validateEquipmentState } from '../src/core/equipment.js';

function physicalState() {
  const catalog = equipmentCatalog();
  catalog.kind = 'source-equipment-state-v2';
  const owner = Object.values(catalog.characters)[0]!;
  const ordinary = Object.values(catalog.definitions).find(d => !d.empty && d.kind === 'weapon' && d.parts[0])!;
  ordinary.jobIds = [owner.jobId + 99];
  const equipment = [...owner.emptySlots];
  equipment[owner.dominantArm - 1] = ordinary.id;
  const member = { id: 'source-initial-owner', sourceId: owner.sourceId, equipment };
  const stock = initialEquipmentStock(catalog, [member], fixtureEquipmentGrants(catalog));
  return { catalog, owner, ordinary, member, stock };
}

test('source physical equipment survives job mismatch while legacy existing-state admission stays strict', () => {
  const f = physicalState();
  validateEquipmentState(f.catalog, [f.member], f.stock);
  const legacy = { ...f.catalog, kind: 'equipment-development-v1' as const };
  assert.throws(() => validateEquipmentState(legacy, [f.member], f.stock), /job mismatch/);
  assert.equal(JSON.stringify(f.catalog).includes('source-initial-owner'), false);
});

test('player incoming selection never receives the FixedEquip source-state permission', () => {
  const f = physicalState(), before = structuredClone(f);
  assert.throws(() => previewEquipmentChange(f.catalog, [f.member], f.stock, f.member.id,
    f.owner.dominantArm, f.ordinary.id), /job mismatch/);
  const unequipped = previewEquipmentChange(f.catalog, [f.member], f.stock, f.member.id,
    f.owner.dominantArm, f.owner.emptySlots[f.owner.dominantArm - 1]!);
  assert.throws(() => previewEquipmentChange(f.catalog, unequipped.roster, unequipped.stock, f.member.id,
    f.owner.dominantArm, f.ordinary.id), /job mismatch/);
  assert.deepEqual(f, before);
});

test('source state still refuses unknown effect, incompatible parts, hand conflict, stock and malformed eligibility', () => {
  for (const kind of ['effects', 'parts', 'hands', 'stock', 'job-metadata', 'owner-job'] as const) {
    const f = physicalState();
    if (kind === 'effects') f.ordinary.blockers.push('unresolved source effect');
    if (kind === 'parts') f.ordinary.parts.fill(false);
    if (kind === 'hands') f.member.equipment[2 - f.owner.dominantArm] = f.ordinary.id;
    if (kind === 'stock') f.stock.find(s => s.id === f.ordinary.id)!.count = 0;
    if (kind === 'job-metadata') f.ordinary.jobIds = [0];
    if (kind === 'owner-job') f.owner.jobId = 0;
    assert.throws(() => validateEquipmentState(f.catalog, [f.member], f.stock),
      /effects|slot mismatch|hand conflict|owned count|job eligibility|equipment integer/, kind);
  }
  const f = physicalState();
  assert.throws(() => validateEquipmentLoadout({ ...f.catalog, kind: 'forged' as never }, f.member), /Unsupported equipment catalog/);
});

test('source initializer opts into the new physical contract without altering source rows or legacy call shape', () => {
  const f = ownedCharacterFixture(), before = structuredClone(f.tables);
  f.tables['job_group.csv']![0]!.job12_accept = '0';
  const original = structuredClone(f.tables);
  assert.throws(() => compileOwnedCharacterInitialization(f.reader(), f.tables, 2, k => k, fixtureWeaponEffects()), /job mismatch/);
  const compiled = compileOwnedCharacterInitialization(f.reader(), f.tables, 2, k => k, fixtureWeaponEffects(), 'source-equipment-state-v2');
  assert.deepEqual(compiled.template.initial.equipment,
    Array.from({ length: 6 }, (_, i) => Number(f.tables['character_status.csv']![0]!['content_id' + (i + 1)])));
  assert.deepEqual(f.tables, original);
  assert.notDeepEqual(original, before);
});
