// Source-derived expectations and controlled host probes. No skill ownership,
// field progress, persistent status, or equipment is granted to the real game.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), sourceOnly = args.includes('--source-only');
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const load = (name) => import(pathToFileURL(resolve(root, option('--dist', 'dist'), 'src', name + '.js')));
const outputPath = root + `build/reports/condition-speed-${sourceOnly ? 'source-' : ''}check.json`;
await mkdir(root + 'build/reports', { recursive: true }); await rm(outputPath, { force: true });
execFileSync(process.execPath, [root + 'scripts/check-condition-speed-native.mjs'], { cwd: root, stdio: 'pipe' });
const native = JSON.parse(await readFile(root + 'build/reports/condition-speed-native-check.json', 'utf8'));
assert.equal(native.methods.length, 21); assert.equal(native.rawRanges.length, 9); assert.equal(native.semanticsVerified, false);
const [
  { loadCorpus }, { readSnapshot, snapshotFile }, { loadSystemMessages }, { hash }, { battleTableIndex },
  { compileBattleConditionCatalog }, { compileFieldConditionCatalog }, { compileSpeedBehavior },
  { compileDevelopmentAbility, compileAbilityProgram }, { BattleConditions }, { FieldConditions },
  { conditionProgressCycleSeconds, conditionChantingModifier }, { atbIncrement }, { chantingSeconds },
  { projectActionTarget }, { GameState }, { BattleGame }, { encounterContent },
] = await Promise.all([
  load('compiler/corpus'), load('compiler/integrity'), load('compiler/system-messages'), load('compiler/content'), load('compiler/battle'),
  load('compiler/conditions'), load('compiler/field-conditions'), load('compiler/condition-speed'),
  load('compiler/ability'), load('core/battle-conditions'), load('core/field-conditions'),
  load('core/condition-speed'), load('core/atb'), load('core/battle-timing'),
  load('core/action-effects'), load('core/game-state'), load('core/battle'), load('core/battle-content'),
]);
const corpus = await loadCorpus(root);
const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources);
assert.ok(corpus.manifest.sources.some((s) => s.file === 'GameAssembly.dll' && s.sha256 === native.nativeSha256));
const exported = JSON.parse(snapshotFile(await readSnapshot(root + 'build/battle'), 'battle.json'));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const raw = (table, id) => { const rows = corpus.tables[table].filter((r) => Number(r.id) === id); assert.equal(rows.length, 1); return rows[0]; };
const name = (key) => { assert.equal(typeof system.messages[key], 'string', key); return system.messages[key]; };
const sourceRows = corpus.tables['condition.csv'].filter((r) => [15, 16].includes(Number(r.condition_type)));
assert.deepEqual(sourceRows.map((r) => Number(r.id)), [21, 25, 95]);
const compiled = sourceRows.map((values) => compileSpeedBehavior({ values }, name));
assert.deepEqual(compiled.map((b) => b?.id ?? null), [21, 25, null]);
for (let i = 0; i < 2; i++) {
  const row = sourceRows[i], behavior = compiled[i];
  assert.equal(behavior.speedDelta, Number(row.rate_value1) * (row.condition_type === '15' ? 1 : -1));
  assert.equal(behavior.untilType, Number(row.until_type));
  assert.equal(behavior.name, system.messages[row.mes_id_name]);
}
assert.equal(sourceRows[2].condition_group_id, '1310');
const stopIds = corpus.tables['condition.csv'].filter((r) => r.condition_type === '17').map((r) => Number(r.id));
assert.deepEqual(stopIds, [26]);
const { catalog, sources } = compileBattleConditionCatalog(reader, corpus.tables['condition.csv'].map((r) => Number(r.id)), name);
const conditions = new BattleConditions(catalog);
assert.deepEqual(catalog.behaviors.filter((b) => ['haste', 'slow'].includes(b.kind)), compiled.filter(Boolean));
for (const id of [95, ...stopIds]) assert.throws(() => conditions.validateActive([id]), /Unimplemented active/);
const field = new FieldConditions(compileFieldConditionCatalog(reader, catalog, [6]).catalog);
for (const id of [21, 25, 95, ...stopIds]) assert.throws(() => field.validateActive([id]), /Unimplemented active field/);

const noRng = () => assert.fail('Unexpected speed random draw');
const ordinaryHit = { accuracy: 100, magicEvasion: 0, fixed: false };
let lifecycleProbes = 0, clockProbes = 0, abilityProbes = 0;
for (const [id, opposite] of [[21, 25], [25, 21]]) {
  const before = [53];
  const first = conditions.add(before, {}, id, ordinaryHit, () => 0);
  assert.deepEqual(first.currentIds, [53, id]); lifecycleProbes++;
  assert.equal(conditions.add(first.currentIds, {}, id, ordinaryHit, noRng).missed, true); lifecycleProbes++;
  assert.equal(conditions.add(before, { [id]: 0 }, id, ordinaryHit, noRng).missed, true); lifecycleProbes++;
  const replaced = conditions.add(first.currentIds, {}, opposite, ordinaryHit, () => 0);
  assert.deepEqual(replaced, { currentIds: [53, opposite], added: [opposite], removed: [id], missed: false }); lifecycleProbes++;
  const erase = corpus.tables['erase_condition_group.csv'].filter((r) => r.group_id === raw('condition.csv', opposite).erase_condition_group_id);
  assert.equal(erase.length, 1); assert.equal(Number(erase[0].type_id), 3); assert.equal(Number(erase[0].erase_condition), id); lifecycleProbes++;
  assert.deepEqual(conditions.recover(first.currentIds, [id]).currentIds, before); lifecycleProbes++;
  assert.deepEqual(conditions.settleLife(0, first.currentIds, false).conditionIds, [53, 5]); lifecycleProbes++;
  assert.deepEqual(conditions.battleEnd(first.currentIds), before); lifecycleProbes++;
  assert.deepEqual(conditions.admitAtbAction(first.currentIds, [{ id: 40, type: 2 }]), first.currentIds); lifecycleProbes++;
  assert.deepEqual(before, [53]); lifecycleProbes++;
}
// IEEE single-precision expected values are calculated independently in Python,
// from the original rows/constants, never from compiler/core projections.
const python = String.raw`import json,struct,sys
from pathlib import Path
t=json.loads((Path(sys.argv[1])/'build/import/tables.json').read_text())
f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
c={r['key_name']:int(r['value1']) for r in t['game_constant_int.csv']}
rows={int(r['id']):r for r in t['condition.csv']};out=[]
rules=dict(coefficient=c['ATP_COEFFICIENT'],enemyCoefficient=c['ENEMY_ATP_COEFFICIENT'],total=c['ATB_TOTAL_AMOUNT'],maxHighSpeed=c['MAX_HIGH_SPEED'],maxLowSpeed=c['MAX_LOW_SPEED'])
for ids in [[],[21],[25],[21,25]]:
 types=[int(rows[i]['condition_type']) for i in ids]
 percent=100+sum(int(rows[i]['rate_value1'])*(1 if int(rows[i]['condition_type'])==15 else -1) for i in ids)
 modifier=(2 if 15 in types else 1)*(0.5 if 16 in types else 1)
 for speed in [1,1.3,3]:
  coefficient=8 if 15 in types else 32 if 16 in types else 16
  for enemy in [False,True]:
   agility,weight=41,2
   rate=f(f(f(agility-weight)/f(rules['coefficient']))+1)
   if enemy:rate=f(rate/f(f(rules['enemyCoefficient'])/10))
   clamped=max(100-rules['maxLowSpeed'],min(100+rules['maxHighSpeed'],percent))
   total=1 if not rules['total'] else f(100/f(rules['total']))
   atb=f(f(f(f(f(f(0.01)*30)*rate)*f(speed))*f(f(clamped)/100))*total)
   chant=f(f(f(5)*20)/f(f(f(f(f(agility)*0.5)+20)*modifier)*f(speed)))
   out.append(dict(ids=ids,types=types,speed=speed,enemy=enemy,agility=agility,weight=weight,percent=percent,modifier=modifier,cycle=f(coefficient/f(speed)),atb=atb,chant=chant))
print(json.dumps(dict(rules=rules,probes=out)))`;
const expected = JSON.parse(execFileSync(root + '.venv/bin/python', ['-c', python, root], { encoding: 'utf8' }));
for (const probe of expected.probes) {
  assert.equal(conditions.speedPercent(probe.ids), probe.percent); clockProbes++;
  assert.equal(conditionChantingModifier(probe.types), probe.modifier); clockProbes++;
  assert.equal(conditionProgressCycleSeconds(probe.types, probe.speed), probe.cycle); clockProbes++;
  assert.equal(atbIncrement(expected.rules, { agility: probe.agility, weight: probe.weight, enemy: probe.enemy,
    speedPercent: conditions.speedPercent(probe.ids), battleSpeed: probe.speed, seconds: 0.01 }), probe.atb); clockProbes++;
  assert.equal(chantingSeconds({ actor: 'player', firstAbility: { id: 71, typeId: 1, wait: 5 }, command: null,
    agility: probe.agility, conditionTypes: probe.types, atbSpeed: probe.speed }), probe.chant); clockProbes++;
  assert.equal(conditions.reconcilePoisonState([10, ...probe.ids], [], probe.speed)[0].thresholdSeconds, Math.fround(probe.cycle * 0.5)); clockProbes++;
}
const slow = conditions.reconcileSlowState([10, 25], []);
let elapsed = slow;
for (let i = 0; i < 10; i++) elapsed = conditions.advanceSlow([10, 25], elapsed, 0.01);
assert.ok(elapsed[0].elapsedSeconds > 0); clockProbes++;
assert.deepEqual(conditions.reconcileSlowState([10, 21], elapsed), []); clockProbes++;
const poison = conditions.reconcilePoisonState([10, 21], [], 1);
assert.equal(poison[0].thresholdSeconds, 4); clockProbes++;
assert.deepEqual(conditions.reconcilePoisonState([10, 25], poison, 1), poison); clockProbes++;
const tick = conditions.advancePoison({ conditionIds: [10, 25], state: poison, hp: 160, maxHp: 160,
  elementResistances: {}, seconds: 4, atbSpeed: 1, isTimeStopped: false });
assert.equal(tick.hp, 150); assert.equal(tick.state[0].thresholdSeconds, 32); clockProbes += 2;

const functionIds = new Set(corpus.tables['function.csv'].filter((r) => r.type_id === '9').map((r) => r.id));
const groups = corpus.tables['function_group.csv'].filter((r) => [1, 2, 3].some((slot) =>
  functionIds.has(r[`function${slot}_id`]) && ['21', '25', '95'].includes(r[`function${slot}_value1`])));
const groupIds = new Set(groups.map((r) => r.id));
const candidates = corpus.tables['ability.csv'].filter((r) => groupIds.has(r.battle_function_group_id));
assert.deepEqual(candidates.map((r) => Number(r.id)), [65, 71, 79, 80, 190, 311, 313, 446, 532, 536, 540, 581, 593, 645, 658, 661, 662, 663, 721, 729, 1156, 1157, 1239, 1256, 1315, 1352, 1403, 1433, 1440]);
const definitions = candidates.map((row) => compileDevelopmentAbility(reader, Number(row.id), 'source-' + row.id));
const admitted = definitions.filter((d) => d.plan), blocked = definitions.filter((d) => !d.plan);
assert.deepEqual(blocked.map((d) => d.id), [190, 311, 313, 721, 729]);
assert.equal(admitted.length, 24);
const participant = { id: 'controlled-caster', side: 'player', level: 10, attack: 0, magic: 20,
  attackElements: [], defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 0,
  hp: 1000, maxHp: 1000, mp: 200, maxMp: 200, conditionIds: [53], conditionResistances: {}, elementResistances: {} };
for (const d of admitted) {
  const row = raw('ability.csv', d.id), group = raw('function_group.csv', Number(row.battle_function_group_id));
  const conditionId = Number(group.function1_value1), effect = d.plan.effects[0];
  const flagIds = corpus.tables['content_flag_group.csv'].filter((r) => r.group_id === row.content_flag_group_id).map((r) => Number(r.content_flag_id));
  assert.equal(effect.conditionId, conditionId); assert.equal(effect.fixedHit, group.function1_value2 === '1');
  assert.equal(effect.accuracy, flagIds.includes(1) ? 255 : Number(row.accuracy_rate)); abilityProbes++;
  const target = { ...participant, id: d.plan.targeting.relation === 'self' ? participant.id : 'controlled-target' };
  const applied = projectActionTarget(d.plan, d.power, participant, target, conditions, flagIds.includes(1) ? noRng : () => 0, 1, d.cost);
  assert.deepEqual(applied.state.conditionIds, [53, conditionId]); abilityProbes++;
  const resisted = projectActionTarget(d.plan, d.power, participant, { ...target, conditionResistances: { [conditionId]: 0 } }, conditions, noRng, 1);
  assert.equal(resisted.effects[0].missed, true); abilityProbes++;
  const duplicate = projectActionTarget(d.plan, d.power, participant, { ...target, conditionIds: applied.state.conditionIds }, conditions, noRng, 1);
  assert.equal(duplicate.effects[0].missed, true); abilityProbes++;
  assert.deepEqual(target.conditionIds, [53]); abilityProbes++;
}
const report = { kind: 'condition-speed-source', sourceOnly, sourceSetHash: corpus.manifest.parentSourceSetHash,
  nativeReportSha256: hash(native), messageSource: system.source, conditions: sourceRows,
  sources: [...sources, ...definitions.flatMap((d) => compileAbilityProgram(reader, d.id).sources)],
  admittedAbilities: admitted.map((d) => d.id), blockedAbilities: blocked.map((d) => ({ id: d.id, blockers: d.blockers })),
  probes: expected.probes, lifecycleProbes, clockProbes, abilityProbes, publishedProbes: 0, hostProbes: [],
  controlled: ['Numerical resources/target identities/hit draws in pure action probes are authored inputs.',
    'Host speed states and initial ATB zero are controlled battle-local inputs; no skill ownership or saved progress is changed.'],
  originalGameExecuted: false, ownershipGranted: false, semanticsVerified: false };
if (!sourceOnly) {
  const source = JSON.parse(await readFile(root + 'build/game/opening-battle.json', 'utf8'));
  const published = JSON.parse(await readFile(resolve(root, option('--catalog', 'build/game/opening-playable.json')), 'utf8'));
  const originalPublished = structuredClone(published);
  for (const value of [source, published]) { const { contentHash, ...rest } = value; assert.equal(contentHash, hash(rest)); }
  assert.equal(published.common.profile, 'narshe-playability-v25');
  assert.equal(published.common.sourceContentHash, source.contentHash);
  assert.equal(source.nativeProfile.sha256, native.nativeSha256);
  for (const d of definitions) {
    assert.deepEqual(published.common.abilities[d.id].plan, d.plan);
    assert.deepEqual(published.common.abilities[d.id].blockers, d.blockers); report.publishedProbes++;
  }
  assert.deepEqual(published.common.conditions.behaviors.filter((b) => ['haste', 'slow'].includes(b.kind)), compiled.filter(Boolean));
  assert.deepEqual(published.common.atb, expected.rules); report.publishedProbes += 2;
  const state = new GameState(published.gameState, published.common.players, published.contentHash, published.common.conditions);
  const before = state.snapshot(), entry = Number(Object.keys(published.encounters)[0]);
  assert.ok(before.roster.every((p) => !p.abilities.owned.some((a) => [65, 71, 79, 80].includes(a.abilityId) && a.skillLevel === 100)));
  const lease = state.openBattle(entry), units = state.battlePlayers(lease), inventory = state.battleInventory(lease);
  for (const ids of [[], [21], [25], [10, 21], [10, 25]]) {
    const content = structuredClone(encounterContent(published, entry)), candidates = structuredClone(units);
    content.initialAtb.player = [0, 0];
    candidates[0].conditionIds.push(...ids);
    const battle = new BattleGame(content, 0x2515, candidates, inventory, state.battleProgression(lease));
    const actor = battle.players[0];
    const sourcePercent = 100 + ids.filter((id) => [21, 25].includes(id)).reduce((sum, id) =>
      sum + Number(raw('condition.csv', id).rate_value1) * (raw('condition.csv', id).condition_type === '15' ? 1 : -1), 0);
    battle.advance(10);
    assert.equal(actor.atb, atbIncrement(expected.rules, { agility: actor.agility, weight: actor.weight, enemy: false,
      speedPercent: sourcePercent, battleSpeed: published.common.timing.atbSpeed, seconds: 0.01 }));
    assert.deepEqual(battle.slowClockState(actor.id), ids.includes(25) ? [{ conditionId: 25, elapsedSeconds: Math.fround(0.01) }] : []);
    const poison = battle.conditionClockState(actor.id);
    if (ids.includes(10)) assert.equal(poison[0].thresholdSeconds, ids.includes(21) ? 4 : 16);
    const gauge = actor.atb, slow = battle.slowClockState(actor.id);
    battle.setPreferences({ mode: 'wait' });
    battle.setClockInput({ paused: false, helpPaused: false, progressEnabled: true, uiWaiting: true, forceWaiting: false });
    battle.advance(200);
    assert.equal(actor.atb, gauge); assert.deepEqual(battle.slowClockState(actor.id), slow); assert.deepEqual(battle.conditionClockState(actor.id), poison);
    report.hostProbes.push({ controlledConditionIds: ids, sourceId: actor.sourceId, speedPercent: sourcePercent, gauge, slow, poison });
  }
  assert.deepEqual(state.snapshot(), before);
  assert.deepEqual(published, originalPublished);
  report.contentHash = published.contentHash; report.sourceContentHash = source.contentHash;
}
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceOnly, conditions: 2, blockedConditions: 1, admittedAbilities: admitted.length,
  blockedAbilities: blocked.length, lifecycleProbes, clockProbes, abilityProbes, publishedProbes: report.publishedProbes,
  hostProbes: report.hostProbes.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
