// Source expectations are read independently from raw tables and the PE-bound
// initializer arrays. Host probes use controlled local snapshots, never grants
// to the user's real save or unowned spell selections.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), sourceOnly = args.includes('--source-only');
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const load = (name) => import(pathToFileURL(resolve(root, option('--dist', 'dist'), 'src', name + '.js')));
const outputPath = root + `build/reports/condition-blind-${sourceOnly ? 'source-' : ''}check.json`;
await mkdir(root + 'build/reports', { recursive: true }); await rm(outputPath, { force: true });
execFileSync(process.execPath, [root + 'scripts/check-condition-blind-native.mjs'], { cwd: root, stdio: 'pipe' });
const native = JSON.parse(await readFile(root + 'build/reports/condition-blind-native-check.json', 'utf8'));
assert.equal(native.methods.length, 14); assert.equal(native.rawRanges.length, 1); assert.equal(native.arrays.length, 4);
const [
  { loadCorpus }, { readSnapshot, snapshotFile }, { loadSystemMessages }, { hash }, { battleTableIndex },
  { compileBattleConditionCatalog }, { compileFieldConditionCatalog }, { compileBlindBehavior },
  { compileDevelopmentAbility, compileAbilityProgram }, { BattleConditions }, { FieldConditions },
  { calculatePhysical }, { calculateMagic }, { projectActionTarget }, { GameState }, { BattleGame }, { encounterContent },
] = await Promise.all([
  load('compiler/corpus'), load('compiler/integrity'), load('compiler/system-messages'), load('compiler/content'), load('compiler/battle'),
  load('compiler/conditions'), load('compiler/field-conditions'), load('compiler/condition-blind'),
  load('compiler/ability'), load('core/battle-conditions'), load('core/field-conditions'),
  load('core/physical'), load('core/magic'), load('core/action-effects'), load('core/game-state'), load('core/battle'), load('core/battle-content'),
]);
const corpus = await loadCorpus(root);
const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources);
assert.ok(corpus.manifest.sources.some((s) => s.file === 'GameAssembly.dll' && s.sha256 === native.nativeSha256));
const exported = JSON.parse(snapshotFile(await readSnapshot(root + 'build/battle'), 'battle.json'));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const raw = (table, id) => { const rows = corpus.tables[table].filter((r) => Number(r.id) === id); assert.equal(rows.length, 1); return rows[0]; };
const name = (key) => { assert.equal(typeof system.messages[key], 'string', key); return system.messages[key]; };
const sourceRows = corpus.tables['condition.csv'].filter((r) => r.condition_type === '9');
assert.deepEqual(sourceRows.map((r) => Number(r.id)), [9, 89]);
const compiled = sourceRows.map((values) => compileBlindBehavior({ values }, name));
assert.deepEqual(compiled.map((b) => b?.id ?? null), [9, null]);
const blind = raw('condition.csv', 9), effect = raw('battle_effect_asset.csv', Number(blind.battle_effect_asset_id));
assert.equal(compiled[0].effectAssetId, Number(effect.id)); assert.equal(compiled[0].iconId, Number(blind.icon_id));
assert.equal(compiled[0].name, name(blind.mes_id_name)); assert.equal(compiled[0].untilType, Number(blind.until_type));
assert.equal(blind.condition_group_id, '0'); assert.equal(sourceRows[1].condition_group_id, '1304');
assert.deepEqual([Number(effect.id), Number(effect.position_type), Number(effect.se_asset_id)], [70, 5, 274]);
const { catalog, sources } = compileBattleConditionCatalog(reader, corpus.tables['condition.csv'].map((r) => Number(r.id)), name);
const conditions = new BattleConditions(catalog);
assert.deepEqual(catalog.behaviors.filter((b) => b.kind === 'blind'), compiled.filter(Boolean));
assert.throws(() => conditions.validateActive([89]), /Unimplemented active/);
assert.ok(sources.some((r) => r.source.assetPath.endsWith('/battle_effect_asset.csv') && r.values.id === effect.id));
assert.ok(sources.some((r) => r.source.assetPath.endsWith('/se_asset.csv') && r.values.id === effect.se_asset_id));
const field = new FieldConditions(compileFieldConditionCatalog(reader, catalog, [1, 6]).catalog);
field.validateActive([9]); assert.throws(() => field.validateActive([89]), /Unimplemented active/);
const sourceMisc = corpus.assets.filter((a) => a.data && typeof a.data === 'object' && 'change_character_condition_list' in a.data);
assert.equal(sourceMisc.length, 1);
assert.deepEqual(sourceMisc[0].data.change_character_condition_list.map((r) => Number(r.condition_type)), [665, 666, 677]);
assert.ok(sourceMisc[0].data.change_character_condition_list.every((r) => Number(r.condition_type) !== 9));

const ordinaryHit = { accuracy: 100, magicEvasion: 0, fixed: false }, noRng = () => assert.fail('Unexpected random draw');
let lifecycleProbes = 0, abilityProbes = 0, numericProbes = 0;
assert.deepEqual(conditions.add([53], {}, 9, ordinaryHit, () => 0).currentIds, [53, 9]); lifecycleProbes++;
assert.equal(conditions.add([53, 9], {}, 9, ordinaryHit, noRng).missed, true); lifecycleProbes++;
for (const resistance of [0, 1, 2]) {
  assert.equal(conditions.add([53], { 9: resistance }, 9, ordinaryHit, noRng).missed, true); lifecycleProbes++;
}
assert.deepEqual(conditions.recover([53, 9], [9, 89]).currentIds, [53]); lifecycleProbes++;
const death = raw('condition.csv', 5), retained = corpus.tables['erase_condition_group.csv'].filter((r) => r.group_id === death.erase_condition_group_id);
assert.ok(retained.every((r) => r.type_id === '5')); assert.ok(!retained.some((r) => r.erase_condition === blind.id));
assert.deepEqual(conditions.settleLife(0, [53, 9], false).conditionIds, [53, 5]); lifecycleProbes++;
assert.deepEqual(conditions.battleEnd([53, 9, 21]), [53, 9]); lifecycleProbes++;
for (const transportation of [1, 6]) {
  const result = field.projectStep([{ id: 'controlled', hp: 10, maxHp: 100, conditionIds: [9] }], transportation);
  assert.deepEqual(result, { members: [{ id: 'controlled', hp: 10, maxHp: 100, conditionIds: [9] }], damage: [], soundId: null }); lifecycleProbes++;
}

// Read raw function carriers; do not use successful compiler counts as the
// expected dependency set or treat all enemy/command qualifications as unlocked.
const candidates = corpus.tables['ability.csv'].filter((r) => {
  if (Number(r.battle_function_group_id) === 0) return false;
  const group = raw('function_group.csv', Number(r.battle_function_group_id));
  return [1, 2, 3].some((slot) => Number(group[`function${slot}_id`]) > 0 &&
    Number(raw('function.csv', Number(group[`function${slot}_id`])).type_id) === 9 &&
    [9, 89].includes(Number(group[`function${slot}_value1`])));
});
const definitions = candidates.map((r) => compileDevelopmentAbility(reader, Number(r.id), `Controlled source ability ${r.id}`));
const admitted = definitions.filter((d) => d.plan), blocked = definitions.filter((d) => !d.plan);
assert.equal(candidates.length, 15); assert.equal(admitted.length, 12); assert.deepEqual(blocked.map((d) => d.id), [304, 1231, 1253]);
const participant = { id: 'controlled-caster', side: 'player', level: 10, attack: 40, magic: 20,
  physical: { attack: 40, strength: 30, accuracy: 100, criticalRate: 3 }, attackElements: [],
  defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 0, hp: 1000, maxHp: 1000,
  mp: 200, maxMp: 200, conditionIds: [53, 9], conditionResistances: {}, elementResistances: {} };
for (const d of admitted) {
  const original = raw('ability.csv', d.id), group = raw('function_group.csv', Number(original.battle_function_group_id));
  const id = Number(group.function1_value1), definition = d.plan.effects[0];
  assert.equal(id, 9); assert.equal(definition.conditionId, id); assert.equal(definition.accuracy, Number(original.accuracy_rate));
  assert.equal(definition.fixedHit, group.function1_value2 === '1'); abilityProbes++;
  const target = { ...participant, id: 'controlled-target', conditionIds: [53, 25], magicEvasion: 64 };
  const miss = projectActionTarget(d.plan, d.power, participant, target, conditions, () => 128, 1);
  assert.deepEqual(miss.state.conditionIds, [53, 25]); abilityProbes++; // no Slow target boost in Function9
  const hit = projectActionTarget(d.plan, d.power, participant, target, conditions, () => 127, 1);
  assert.deepEqual(hit.state.conditionIds, [53, 25, 9]); abilityProbes++;
}

const plus = native.arrays.find((a) => a.name === 'HitRatePlusConditions').values;
const minus = native.arrays.find((a) => a.name === 'HitRateMinusConditions').values;
function expectedAccuracy(initial, targetTypes) {
  if (initial >= 255) return 255;
  let value = initial;
  if (targetTypes.some((t) => plus.includes(t))) value = Math.min(255, Math.floor(value * 5 / 4));
  if (targetTypes.some((t) => minus.includes(t))) value = Math.min(255, Math.floor(value * 3 / 4));
  return value;
}
const targetCases = [[], [9], [25], [10], [4], [21], [9, 25, 10], [9, 21, 4, 10]];
for (const accuracy of [0, 1, 3, 80, 100, 203, 204, 254, 255, 300]) for (const actorBlind of [false, true])
  for (const ids of targetCases) for (const evasion of [0, 64, 128, 255]) for (const guaranteed of [false, true]) {
    const types = ids.map((id) => Number(raw('condition.csv', id).condition_type));
    const initialPhysical = guaranteed ? 255 : actorBlind ? Math.floor(Math.min(255, accuracy) / 2) : Math.min(255, accuracy);
    const adjustedPhysical = expectedAccuracy(initialPhysical, types), adjustedMagic = expectedAccuracy(guaranteed ? 255 : Math.min(255, accuracy), types);
    const expectedHit = (rate) => rate === 255 || Math.trunc((128 - evasion) * 2 * rate / 256) > Math.floor(128 * 100 / 256);
    const ranges = [], physical = calculatePhysical({ rows: { actor: 'front', target: 'front', ignoreActorPenalty: false, ignoreTargetPenalty: false },
      rules: { normalAttack: true, multiplyPercent: null, contentFlags: guaranteed ? [1] : [] }, power: 0,
      actor: { side: 'player', level: 10, attack: 40, strength: 30, accuracy, criticalRate: 3, attackElements: [], conditionTypes: actorBlind ? [9] : [] },
      target: { side: 'enemy', defense: 64, evasion, elementResistances: {}, conditionTypes: types }, targetCount: 1 },
    (min, max) => { ranges.push([min, max]); return max === 31 ? 31 : max === 255 ? 128 : 99; });
    assert.equal(physical.missed, !expectedHit(adjustedPhysical));
    assert.equal(physical.amount, physical.missed ? 0 : 73);
    assert.deepEqual(ranges, [[0, 31], ...(adjustedPhysical < 255 ? [[0, 255]] : []), ...(physical.missed ? [] : [[0, 99]])]); numericProbes++;
    const magicRanges = [], magic = calculateMagic({ rules: { accuracy, contentFlags: guaranteed ? [1] : [], forceDefense: false, elements: [] },
      power: 30, actor: { side: 'player', level: 10, magic: 20 },
      target: { side: 'enemy', magicDefense: 64, magicEvasion: evasion, elementResistances: {}, conditionTypes: types }, recovery: false, targetCount: 1 },
    (min, max) => { magicRanges.push([min, max]); return max === 255 ? 128 : 31; });
    assert.equal(magic.missed, !expectedHit(adjustedMagic)); assert.equal(magic.amount, magic.missed ? 0 : 229);
    assert.deepEqual(magicRanges, [...(!guaranteed && accuracy < 255 ? [[0, 255]] : []), ...(magic.missed ? [] : [[0, 31]])]); numericProbes++;
  }

const report = { kind: 'condition-blind-source', sourceOnly, sourceSetHash: corpus.manifest.parentSourceSetHash,
  nativeReportSha256: hash(native), messageSource: system.source, conditions: sourceRows, effect,
  fieldAppearance: { source: sourceMisc[0].source, rules: sourceMisc[0].data.change_character_condition_list },
  sources: [...sources, ...definitions.flatMap((d) => compileAbilityProgram(reader, d.id).sources)],
  admittedAbilities: admitted.map((d) => d.id), blockedAbilities: blocked.map((d) => ({ id: d.id, blockers: d.blockers })),
  lifecycleProbes, abilityProbes, numericProbes, publishedProbes: 0, hostProbes: [],
  controlled: ['Scalar numerical inputs, live conditions, target identities and RNG draws are explicit authored probes.',
    'Host snapshots seed Blind and eye-drop stock only on isolated GameState instances; no formal skill ownership or user save changes.'],
  originalGameExecuted: false, semanticsVerified: false, particlePresentationImplemented: false };

if (!sourceOnly) {
  const source = JSON.parse(await readFile(root + 'build/game/opening-battle.json', 'utf8'));
  const published = JSON.parse(await readFile(resolve(root, option('--catalog', 'build/game/opening-playable.json')), 'utf8'));
  const original = structuredClone(published);
  for (const value of [source, published]) { const { contentHash, ...rest } = value; assert.equal(contentHash, hash(rest)); }
  assert.equal(published.common.profile, 'narshe-playability-v30');
  assert.equal(published.common.sourceContentHash, source.contentHash); assert.equal(source.nativeProfile.sha256, native.nativeSha256);
  for (const d of definitions) { assert.deepEqual(published.common.abilities[d.id].plan, d.plan); assert.deepEqual(published.common.abilities[d.id].blockers, d.blockers); report.publishedProbes++; }
  assert.deepEqual(published.common.conditions.behaviors.filter((b) => b.kind === 'blind'), compiled.filter(Boolean)); report.publishedProbes++;
  const create = () => new GameState(published.gameState, published.common.players, published.contentHash, published.common.conditions);
  const state = create(), initial = state.snapshot(), snapshot = structuredClone(initial), target = snapshot.roster[0];
  target.conditionIds.push(9);
  const contentId = 13, item = raw('item.csv', Number(raw('content.csv', contentId).type_value));
  const group = raw('function_group.csv', Number(item.menu_function_group_id)), recoveryGroup = Number(group.function1_value1);
  const recoveryIds = corpus.tables['condition_group.csv'].filter((r) => Number(r.group_id) === recoveryGroup).map((r) => Number(r.condition_id));
  assert.deepEqual(recoveryIds, [9, 89]);
  const existing = snapshot.items.find((i) => i.id === contentId);
  if (existing) existing.count = 2; else snapshot.items.push({ id: contentId, count: 2 });
  state.restore(snapshot);
  const saved = state.snapshot(), restored = create(); restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved); report.hostProbes.push('save retains ordinary Blind');
  assert.ok(state.menuItemTargets(contentId).includes(target.id));
  assert.equal(state.useMenuItem(contentId, target.id), true);
  assert.deepEqual(state.snapshot().roster[0].conditionIds, initial.roster[0].conditionIds);
  assert.equal(state.snapshot().items.find((i) => i.id === contentId).count, 1);
  assert.equal(state.useMenuItem(contentId, target.id), false); report.hostProbes.push('Eye Drops clears status-only change and consumes once');
  const entry = Number(Object.keys(published.encounters)[0]), lease = restored.openBattle(entry);
  const units = restored.battlePlayers(lease), inventory = restored.battleInventory(lease);
  assert.ok(units[0].conditionIds.includes(9));
  const battle = new BattleGame(encounterContent(published, entry), 0x269, units, inventory, restored.battleProgression(lease));
  assert.ok(battle.players[0].conditionIds.includes(9));
  restored.cancelBattle(lease); assert.deepEqual(restored.snapshot(), saved); report.hostProbes.push('real frozen lease derives Blind and cancellation preserves state');
  assert.deepEqual(published, original); report.contentHash = published.contentHash;
}
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceOnly, admittedConditions: 1, blockedConditions: 1, admittedAbilities: admitted.length,
  blockedAbilities: blocked.length, lifecycleProbes, abilityProbes, numericProbes, publishedProbes: report.publishedProbes,
  hostProbes: report.hostProbes.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
