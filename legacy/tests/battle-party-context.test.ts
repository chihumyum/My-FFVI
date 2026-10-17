import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_BATTLE_PARTY_CONTEXT, parseBattlePartyContext, currentBattlePartyReward,
  validateBattlePartyContextBinding, type BattlePartyContext, type BattlePartyDescriptor } from '../src/core/battle-party-context.js';
import { WEB_BATTLE_CHILD_ADMISSION, type BattleChildAdmission } from '../src/core/battle-child-admission.js';
import type { BattleFlagRowSource, SourceBattleFlags } from '../src/core/battle-flags.js';

const source = (table: string, id: number): BattleFlagRowSource => ({ file: 'authored.bundle',
  assetPath: 'Assets/Master/' + table, serializedFile: 'authored', objectId: '90071992547409939', rowId: String(id) });
function descriptor(partyId: number): BattlePartyDescriptor {
  return { partyId, source: source('monster_party.csv', partyId), battleFlagGroupId: 0, flagRows: [],
    backgroundId: 7, bgmId: 0, appearanceProduction: 1, notEscape: 2, getAp: 0, getValue: 3,
    scriptId: 0, patterns: [1, 0, 0, 0, 0, 0] };
}
function fixture() {
  const root = descriptor(1000), child = descriptor(522);
  root.battleFlagGroupId = 77;
  root.flagRows = [{ flagId: 14, source: source('battle_flag_group.csv', 81) },
    { flagId: 19, source: source('battle_flag_group.csv', 82) }];
  child.notEscape = 3; child.getValue = 0;
  const context: BattlePartyContext = { kind: 'source-battle-party-context-v1', policy: WEB_BATTLE_PARTY_CONTEXT,
    rootPartyId: root.partyId, entries: { [root.partyId]: root, [child.partyId]: child } };
  const children: BattleChildAdmission = { kind: 'source-child-party-admission-v1', policy: WEB_BATTLE_CHILD_ADMISSION,
    rootPartyId: root.partyId, context: 'retain-parent-entry', entries: { [child.partyId]: {
      partyId: child.partyId, source: structuredClone(child.source), flagGroupId: child.battleFlagGroupId,
      flagRows: structuredClone(child.flagRows), notEscape: child.notEscape,
      members: [{ sourceId: 549, uniqueId: 3 }], slots: Object.fromEntries(Array.from({ length: 9 }, (_, i) =>
        [String(i + 1), { x: 0, y: 0, group: 1 as const }])), gates: [] } } };
  const flags: SourceBattleFlags = { kind: 'source-battle-flags-v1', entryContext: 'story',
    partySource: structuredClone(root.source), groupId: root.battleFlagGroupId,
    rows: structuredClone(root.flagRows) as SourceBattleFlags['rows'], arDirectoryEligible: false };
  return { context, root, child, children, flags, reward: { kind: 'battle-reward-policy-v1' as const, ap: 0 as const, magicPoints: 3 } };
}

test('source metadata is detached and complete; unfamiliar flags and AP facts grant no reward implementation', () => {
  const f = fixture(); f.child.getAp = 7; f.child.appearanceProduction = 99; f.child.scriptId = 8010;
  f.child.battleFlagGroupId = 31; f.child.flagRows = [{ flagId: 3, source: source('battle_flag_group.csv', 91) },
    { flagId: 9, source: source('battle_flag_group.csv', 92) }];
  const parsed = parseBattlePartyContext(f.context);
  assert.deepEqual(parsed, f.context); assert.equal(parsed.entries[522]!.source.objectId, '90071992547409939');
  assert.throws(() => currentBattlePartyReward(parsed, 522), /Nonzero AP/);
  parsed.entries[522]!.patterns[0] = 99; parsed.entries[522]!.flagRows[0]!.flagId = 7;
  assert.equal(f.child.patterns[0], 1); assert.equal(f.child.flagRows[0]!.flagId, 3);
});

test('the selected descriptor supplies AP/MP independently of entry flags and returns no writable owner', () => {
  const { context } = fixture();
  assert.deepEqual(currentBattlePartyReward(context, 1000), { kind: 'battle-reward-policy-v1', ap: 0, magicPoints: 3 });
  const child = currentBattlePartyReward(context, 522); assert.equal(child.magicPoints, 0);
  child.magicPoints = 999; assert.equal(currentBattlePartyReward(context, 522).magicPoints, 0);
  assert.throws(() => currentBattlePartyReward(context, 523), /Missing current/);
});

test('binding joins root, complete child directory and original row identities without removing child gates', () => {
  const f = fixture(); f.children.entries[522]!.gates.push({ code: 'authored-unresolved', reason: 'Unknown original consumer', dependency: null });
  const before = structuredClone(f); validateBattlePartyContextBinding(f.context, 1000, f.reward, f.children, f.flags);
  assert.deepEqual(f, before); assert.equal(f.children.entries[522]!.gates.length, 1);
  assert.throws(() => validateBattlePartyContextBinding(f.context, 522, f.reward, f.children, f.flags), /root binding/);
  assert.throws(() => validateBattlePartyContextBinding(f.context, 1000, { ...f.reward, magicPoints: 4 }, f.children, f.flags), /root reward/);
  assert.throws(() => validateBattlePartyContextBinding(f.context, 1000, f.reward), /complete.*directory/);
  const rootOnly = { ...f.context, entries: { 1000: f.root } };
  validateBattlePartyContextBinding(rootOnly, 1000, f.reward, undefined, f.flags);
});

test('missing, extra and rebound child descriptors never expand the nominated source cut', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { delete f.context.entries[522]; },
    (f: ReturnType<typeof fixture>) => { f.context.entries[523] = descriptor(523); },
    (f: ReturnType<typeof fixture>) => { f.child.source.objectId = '90071992547409941'; },
    (f: ReturnType<typeof fixture>) => { f.child.notEscape = 2; },
    (f: ReturnType<typeof fixture>) => { f.child.battleFlagGroupId = 77; f.child.flagRows = [structuredClone(f.root.flagRows[0]!)]; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => validateBattlePartyContextBinding(f.context, 1000, f.reward, f.children, f.flags), /directory|child source/);
  }
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.root.source.objectId = '90071992547409941'; },
    (f: ReturnType<typeof fixture>) => { f.root.battleFlagGroupId = 78; },
    (f: ReturnType<typeof fixture>) => { f.root.flagRows.reverse(); },
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => validateBattlePartyContextBinding(f.context, 1000, f.reward, f.children, f.flags), /entry flag/);
  }
});

test('physical row, decimal object, flag group and six-pattern identities are strict', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.context.rootPartyId = 999; },
    (f: ReturnType<typeof fixture>) => { f.root.source.rowId = '522'; },
    (f: ReturnType<typeof fixture>) => { f.root.source.assetPath = 'Assets/Master/script.csv'; },
    (f: ReturnType<typeof fixture>) => { f.root.source.objectId = '9223372036854775808'; },
    (f: ReturnType<typeof fixture>) => { f.root.source.objectId = '090071992547409939'; },
    (f: ReturnType<typeof fixture>) => { f.root.source.objectId = '-0'; },
    (f: ReturnType<typeof fixture>) => { f.root.battleFlagGroupId = 0; },
    (f: ReturnType<typeof fixture>) => { f.child.battleFlagGroupId = 77; },
    (f: ReturnType<typeof fixture>) => { f.root.flagRows.push(structuredClone(f.root.flagRows[0]!)); },
    (f: ReturnType<typeof fixture>) => { f.root.patterns.pop(); },
    (f: ReturnType<typeof fixture>) => { delete f.root.patterns[2]; },
    (f: ReturnType<typeof fixture>) => { f.context.entries['0522'] = f.child; delete f.context.entries[522]; },
  ]) { const f = fixture(); change(f); assert.throws(() => parseBattlePartyContext(f.context)); }
  for (const value of [-1, -0, NaN, Infinity, 1.5, 0x80000000]) {
    const f = fixture(); f.child.getValue = value; assert.throws(() => parseBattlePartyContext(f.context), /integer/);
  }
});

test('unknown fields, accessor reads, symbols and sparse collections cannot manufacture a context declaration', () => {
  const f = fixture(), extra = { ...f.context, currentPartyId: 522 };
  assert.throws(() => parseBattlePartyContext(extra), /fields/);
  assert.throws(() => parseBattlePartyContext({ ...f.context, policy: 'unknown' }), /declaration/);
  const access = structuredClone(f.context); let reads = 0;
  Object.defineProperty(access.entries[522]!, 'getValue', { enumerable: true, get() { reads++; return 3; } });
  assert.throws(() => parseBattlePartyContext(access), /fields/); assert.equal(reads, 0);
  const symbol = structuredClone(f.context); Object.defineProperty(symbol, Symbol('runtime'), { value: true, enumerable: true });
  assert.throws(() => parseBattlePartyContext(symbol), /fields/);
  const collection = structuredClone(f.context); Object.defineProperty(collection.entries[522]!.patterns, 'runtime', { value: true });
  assert.throws(() => parseBattlePartyContext(collection), /collection fields/);
});
