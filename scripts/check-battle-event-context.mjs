// Source-bound AI event routing in a controlled BattleGame host. This is not a
// source encounter, asset, reward, acquisition, or original-game parity claim.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let dist = 'dist', inMemory = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--dist' && process.argv[i + 1]) dist = process.argv[++i];
  else if (process.argv[i] === '--in-memory') inMemory = true;
  else throw new Error('Unknown argument: ' + process.argv[i]);
}
const load = (name) => import(pathToFileURL(resolve(root, dist, 'src', name + '.js')));
const [{ readSnapshot, snapshotFile }, { compileOpeningBattle, battleTableIndex },
  { compileOpeningPlayable }, { compileBattleAI, battleAIAbilities },
  { compileBattleEventRules }, { evaluateBattleEventBranch },
  { startBattleAI, planBattleAITurn, BattleAIError }, { initialEnemyBehavior },
  { BattleGame }, { GameState }, { encounterContent }, { projectBattleFieldState }, { hash }] = await Promise.all([
  load('compiler/integrity'), load('compiler/battle'), load('compiler/opening-playable'),
  load('compiler/battle-ai'), load('compiler/battle-event-context'), load('core/battle-event-context'),
  load('core/battle-ai'), load('core/enemy-behavior'), load('core/battle'), load('core/game-state'),
  load('core/battle-content'), load('core/field-battle-entry'), load('compiler/content'),
]);
const exported = JSON.parse(snapshotFile(await readSnapshot(root + 'build/battle'), 'battle.json'));
const tables = JSON.parse(snapshotFile(await readSnapshot(root + 'build/import'), 'tables.json'));
const source = await compileOpeningBattle(root);
const catalog = inMemory ? await compileOpeningPlayable(root, source) :
  JSON.parse(await readFile(root + 'build/game/opening-playable.json', 'utf8'));
assert.equal(catalog.common.sourceContentHash, source.contentHash, 'Published battle catalog needs the current source compiler');
const reader = battleTableIndex(tables, exported.tableSources);
const rawConditions = tables['condition.csv'];
const compiled = compileBattleEventRules(reader, rawConditions.map((r) => Number(r.id)));
const rules = compiled.rules;
const independentRules = rawConditions.map((r) => ({ id: Number(r.id), type: Number(r.condition_type),
  attackTarget: Number(r.attack_target), gameOverTarget: Number(r.game_over_target) }));
assert.deepEqual(rules.conditions, independentRules);
assert.deepEqual(catalog.common.battleEvents, rules, 'Runtime event flags must be bound into the published catalog');
for (const row of compiled.sources)
  assert.deepEqual(source.tables['condition.csv'][row.source.rowId], row, 'Event flags must remain in the source dependency closure');
const byCondition = new Map(independentRules.map((r) => [r.id, r]));
const death = independentRules.find((r) => r.type === 5 && r.id === 5);
assert.ok(death);
assert.equal(death.attackTarget, 1); assert.equal(death.gameOverTarget, 1);
assert.equal(byCondition.get(3).attackTarget, 1); assert.equal(byCondition.get(3).gameOverTarget, 0);
assert.equal(byCondition.get(11).attackTarget, 0); assert.equal(byCondition.get(11).gameOverTarget, 1);

const assets = Object.values(exported.assets).filter((a) => a.source.assetPath.includes('/MonsterAI/'));
assert.equal(assets.length, 430);
const programs = new Map(), branchRows = [], retainedFinalAttack = [], compileDiagnostics = [];
const comparisons = { '＝': (a, b) => a === b, '≠': (a, b) => a !== b,
  '＜': (a, b) => a < b, '＞': (a, b) => a > b, '≦': (a, b) => a <= b, '≧': (a, b) => a >= b };
const context = (otherConditions, playerConditions = [], otherRemoved = false) => ({
  rules, selfId: 'subject', finalAttackFirstTargetSide: null, units: [
    { id: 'player', side: 'player', conditionIds: playerConditions, removed: false },
    { id: 'subject', side: 'enemy', conditionIds: [], removed: false },
    { id: 'companion', side: 'enemy', conditionIds: otherConditions, removed: otherRemoved },
  ],
});
const samples = [context([]), context([5]), context([3]), context([11]), context([], [5]), context([], [], true)];
for (const asset of assets) {
  const files = exported.sources.filter((s) => s.file === asset.source.file || s.file.endsWith('/' + asset.source.file));
  assert.equal(files.length, 1);
  const identity = { ...asset.source, sha256: files[0].sha256, sourceSetHash: source.parentSourceSetHash,
    battleSourceSetHash: source.sourceSetHash };
  let program;
  try { program = compileBattleAI(asset.data, identity); }
  catch (error) {
    assert.ok(!(asset.data.Mnemonics ?? []).some((m) => ['IsOnlyAlive', 'IsUnitAliveCount'].includes(m.mnemonic)),
      'A source event instruction must not disappear behind a program-schema diagnostic');
    compileDiagnostics.push({ source: identity, reason: String(error.message) });
    continue;
  }
  programs.set(asset.source.assetPath.split('/').at(-1), program);
  for (const [pc, raw] of asset.data.Mnemonics.entries()) {
    const op = program.instructions[pc].op;
    if (raw.mnemonic === 'FinalAttackAct') {
      assert.equal(op.kind, 'blocked', 'Population routing must not admit unresolved final attacks');
      retainedFinalAttack.push({ source: identity, pc });
    }
    if (!['IsOnlyAlive', 'IsUnitAliveCount'].includes(raw.mnemonic)) continue;
    const i = raw.operands.iValues, s = raw.operands.sValues;
    if (raw.mnemonic === 'IsOnlyAlive') {
      assert.deepEqual(op, { kind: 'only-alive', target: i[0] });
    } else {
      assert.deepEqual(op, { kind: 'unit-alive-count', side: i[0] === 1 ? 'player' : 'enemy',
        value: i[1], operator: s[0], target: i[2] });
      assert.ok(comparisons[s[0]], 'Source count comparison is independently covered');
    }
    const results = samples.map((sample) => {
      // Expectations read the raw table, not the compiled helper or HP aliases.
      let expected;
      if (raw.mnemonic === 'IsOnlyAlive') {
        const other = sample.units[2];
        expected = other.removed || other.conditionIds.some((id) => ['1', '3'].includes(
          rawConditions.find((r) => r.id === String(id)).attack_target));
      } else {
        const side = i[0] === 1 ? 'player' : 'enemy';
        const count = sample.units.filter((unit) => unit.side === side && !unit.conditionIds.some((id) =>
          rawConditions.find((r) => r.id === String(id)).game_over_target === '1')).length;
        expected = comparisons[s[0]](count, i[1]);
      }
      assert.equal(evaluateBattleEventBranch(op, sample), expected);
      return expected;
    });
    branchRows.push({ source: identity, pc, mnemonic: raw.mnemonic, op, results });
  }
}
assert.equal(branchRows.filter((r) => r.mnemonic === 'IsOnlyAlive').length, 79);
assert.equal(branchRows.filter((r) => r.mnemonic === 'IsUnitAliveCount').length, 23);
assert.equal(retainedFinalAttack.length, 54);

const field = JSON.parse(await readFile(root + 'build/game/narshe.json', 'utf8'));
function ownedProbe() {
  const content = structuredClone(encounterContent(catalog, 3));
  assert.ok(content);
  const entry = projectBattleFieldState(content.battleEntry, { mapId: field.map.identity?.mapId ?? null,
    transportationId: field.entry.transportationId, isSavePoint: null,
    beastFieldController: null, footAttributeType: null }, catalog.gameState.fieldConditions.transportations);
  assert.deepEqual(entry.blockers, []);
  content.qualificationContext = { ...content.qualificationContext, invalidContentIds: entry.invalidContentIds };
  const state = new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  const lease = state.openBattle(3, content.rewardPolicy), players = state.battlePlayers(lease), inventory = state.battleInventory(lease);
  const initial = new BattleGame(content, 1, players, inventory);
  content.players = players.map((player) => {
    const menu = initial.commandMenu(player.id).filter((command) => command.available);
    const result = { ...player, hp: 10000, conditionIds: [], commands: menu.map((command) => command.id),
      abilities: [...new Set(menu.flatMap((command) => command.abilityIds))] };
    delete result.battleRequirements;
    return result;
  });
  state.cancelBattle(lease);
  content.qualificationContext.mode = 'development-static';
  content.drops = null;
  content.limitations.push('Controlled enemy-event host: source AI kept whole; borrowed enemy media/stats and high player HP; no story/reward admission.');
  return { content, inventory };
}
const aiContext = (battle, subject) => ({
  self: { hp: subject.hp, mp: subject.mp, monsterId: subject.sourceId, behavior: subject.behavior },
  conditionIds: subject.conditionIds, players: battle.players, enemies: battle.enemies,
  events: { rules, selfId: subject.id, finalAttackFirstTargetSide: null,
    units: battle.combatants.map((c) => ({ id: c.id, side: c.side, conditionIds: [...c.conditionIds], removed: false })) },
});
const hostChecks = [];
for (const [name, expectedBefore, expectedAfter] of [
  ['sc_ai_01C_Fidor.json', [1, 405], [405]],
  ['sc_ai_0C7_Sergeant.json', [1], [1, 573]],
]) {
  const program = programs.get(name); assert.ok(program);
  assert.deepEqual(program.blockers, []);
  assert.deepEqual(program.instructions.filter((i) => i.op.kind === 'blocked'), []);
  const { content, inventory } = ownedProbe();
  const subject = content.enemies[0], companion = content.enemies[1];
  assert.ok(subject && companion);
  content.enemies = [subject, companion];
  const aiRow = tables['monster_ai_script.csv'].filter((row) => row.script_name + '.json' === name);
  assert.equal(aiRow.length, 1);
  const monsterRows = tables['monster.csv'].filter((row) => row.script_id === aiRow[0].id);
  assert.ok(monsterRows.length > 0);
  subject.sourceId = Number(monsterRows[0].id);
  subject.ai = structuredClone(program); subject.abilities = battleAIAbilities(program);
  subject.name = 'Controlled event subject: ' + name;
  companion.name = 'Controlled event companion';
  subject.hp = subject.mp = 10000;
  companion.hp = 1;
  content.initialAtb = { player: [100, 100], enemy: [0, 0] };
  for (const id of subject.abilities) assert.ok(content.abilities[id]?.plan, 'Source ability must already have a complete plan: ' + id);
  const playerId = content.players[0].id, attack = content.players[0].abilities.find((id) => id === 218);
  assert.ok(attack, 'Use a naturally available opening action, never insert an unowned action');
  const run = (split) => {
    const battle = new BattleGame(content, 37, undefined, inventory), enemy = battle.enemies[0];
    const before = planBattleAITurn(program, battle.enemyAIState(enemy.id), aiContext(battle, enemy));
    assert.equal(before.acts.find((a) => a.selected).pc, 5);
    assert.deepEqual(before.acts.find((a) => a.selected).abilities, expectedBefore);
    let firstAction = null;
    for (let tick = 0; tick < 12000 && !firstAction; tick++) {
      battle.advance(10);
      if (battle.action?.actor === enemy.id && battle.action.resolved) firstAction = structuredClone(battle.action);
    }
    assert.ok(firstAction, 'The whole source AI must execute while its companion is alive');
    assert.ok(expectedBefore.includes(firstAction.source.id));
    assert.equal(firstAction.source.id, 1, 'The controlled seed exercises the ordinary pre-transition action');
    assert.equal(battle.enemies[1].hp, 1);
    assert.equal(battle.command(playerId, attack, companion.id), true);
    for (let tick = 0; tick < 2000 && battle.enemies[1].hp > 0; tick++) battle.advance(10);
    assert.equal(battle.enemies[1].hp, 0, 'A real resolved action must change the formation state');
    assert.ok(battle.enemies[1].conditionIds.includes(death.id));
    const after = planBattleAITurn(program, battle.enemyAIState(enemy.id), aiContext(battle, enemy));
    assert.equal(after.acts.find((a) => a.selected).pc, 15);
    assert.deepEqual(after.acts.find((a) => a.selected).abilities, expectedAfter);
    const transitionTime = battle.time;
    for (const dt of (split ? Array(4000).fill(10) : [40000])) battle.advance(dt);
    assert.equal(battle.phase, 'active');
    const actions = battle.events.filter((e) => e.time > transitionTime && e.text.startsWith(enemy.name + ' ·'));
    assert.ok(actions.length > 0, 'The source AI must execute after its event transition');
    assert.ok(actions.every((e) => expectedAfter.some((id) => e.text === enemy.name + ' · ' + content.abilities[id].name)),
      'After transition, executed actions must belong to the source phase table');
    return { before: { pc: 5, abilities: expectedBefore }, after: { pc: 15, abilities: expectedAfter },
      firstAction, transitionTime, postTransitionActions: actions,
      units: battle.combatants, events: battle.events, ai: battle.enemyAIState(enemy.id),
      action: battle.action, pending: battle.pendingActions, time: battle.time };
  };
  const result = run(false); assert.deepEqual(result, run(true), 'Event transitions must be frame-partition deterministic');
  const missing = structuredClone(content); delete missing.battleEvents;
  assert.throws(() => new BattleGame(missing, 37, undefined, inventory),
    (e) => e instanceof BattleAIError && e.pc === 3 && /unit context/.test(e.message));
  // Preserve the full original source; the confusion route is not rewritten.
  const confused = { self: { hp: 10000, mp: 10000, monsterId: subject.sourceId, behavior: initialEnemyBehavior() },
    conditionIds: [12], players: [{ level: 6 }], enemies: [{ level: 1 }], events: context([5]) };
  const init = startBattleAI(program, confused); confused.self.behavior = init.behavior;
  const route = planBattleAITurn(program, init.state, confused);
  assert.equal(route.acts.find((a) => a.selected).pc, 10);
  hostChecks.push({ source: program.source, programHash: hash(program), sourceMonsterCandidates: monsterRows.map((r) => Number(r.id)),
    controlledHost: true, sourceEncounterPlayable: false, before: result.before, after: result.after,
    companionKilledByAbility: attack, sourceAIExecuted: true, framePartitionReplay: true,
    firstAction: result.firstAction.source, transitionTime: result.transitionTime,
    postTransitionActions: result.postTransitionActions,
    missingRulesBlockedAtPc: 3, originalConfusionBranchPc: 10,
    finalStateHash: hash(result), activeConditionsStillSeparatelyGated: true });
}

const report = { kind: 'battle-event-context-source-check', catalogMode: inMemory ? 'compiled-in-memory' : 'published',
  sourceSetHash: source.parentSourceSetHash, battleSourceSetHash: source.sourceSetHash,
  sourceContentHash: source.contentHash, catalogContentHash: catalog.contentHash,
  rules: { count: rules.conditions.length, sources: compiled.sources.map((row) => row.source), hash: hash(rules) },
  files: assets.length, eventFiles: new Set(branchRows.map((r) => r.source.assetPath)).size,
  decodedBranches: branchRows.length, independentPredicateCases: branchRows.length * samples.length,
  branchRows, hostChecks, retainedFinalAttack, compileDiagnostics,
  limitations: [
    'Static DLL and source data only; the original game was not executed.',
    'Only IsOnlyAlive and IsUnitAliveCount were added. Removed-unit/final-attack scheduling, type602 exception, and other AI instructions remain gated.',
    'Whole Fidor/Sergeant programs run with controlled borrowed stats/media; this does not admit their actual encounters or unrecovered statuses.',
    'The current BattleGame has a fixed unit collection and no ActType.FinalAttack; current/candidate condition IDs are the sole life predicate inputs.',
  ], originalGameExecuted: false };
await mkdir(root + 'build/reports', { recursive: true });
await writeFile(root + 'build/reports/battle-event-context-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ files: assets.length, rules: rules.conditions.length, decodedBranches: branchRows.length,
  predicateCases: report.independentPredicateCases, fullAIHostTransitions: hostChecks.length,
  retainedFinalAttack: retainedFinalAttack.length, compileDiagnostics: compileDiagnostics.length,
  catalogMode: report.catalogMode, originalGameExecuted: false }));
