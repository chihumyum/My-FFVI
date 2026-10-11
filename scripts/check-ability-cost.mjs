// Source-bound equipment/owned/menu/payment regression. Extra copies, EXP and
// timing/resource fault inputs are controlled probes, never production grants.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportedOrdinaryWeaponEffects } from './lib/ordinary-weapon-source.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)), args = process.argv.slice(2);
assert.ok(args.every((arg, i) => i % 2 ? !!arg : ['--dist', '--catalog'].includes(arg)),
  'Usage: check-ability-cost.mjs [--dist dist] [--catalog build/game/opening-playable.json]');
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const dist = resolve(root, option('--dist', 'dist'));
const load = (name) => import(pathToFileURL(resolve(dist, 'src', name + '.js')));
const [
  { readSnapshot, snapshotFile }, { loadSystemSource }, { compileEquipmentCatalog },
  { compileEquipmentAbilityCost }, { compileParameterEquipment }, { projectAbilityCost },
  { GameState }, { BattleGame }, { encounterContent }, { projectBattleFieldState }, { hash },
] = await Promise.all([
  load('compiler/integrity'), load('compiler/system-source'), load('compiler/equipment'),
  load('compiler/ability-cost'), load('compiler/parameters'), load('core/ability-cost'),
  load('core/game-state'), load('core/battle'), load('core/battle-content'), load('core/field-battle-entry'), load('compiler/content'),
]);
const imported = await readSnapshot(resolve(root, 'build/import'));
const project = JSON.parse(snapshotFile(imported, 'project.json'));
const source = await loadSystemSource(root, project.sourceSetHash);
const { compileOrdinaryWeaponEffects } = await load('compiler/ordinary-weapon');
const battleExport = JSON.parse(snapshotFile(await readSnapshot(resolve(root, 'build/battle')), 'battle.json'));
const weaponEffects = exportedOrdinaryWeaponEffects(battleExport, source.reader, compileOrdinaryWeaponEffects).catalog;
const published = JSON.parse(await readFile(resolve(root, option('--catalog', 'build/game/opening-playable.json')), 'utf8'));
const { contentHash, ...input } = published; assert.equal(hash(input), contentHash);
const originalPublished = structuredClone(published), system = published.gameState.equipmentSystem;
const raw = (table, id) => {
  const found = source.tables[table].filter((r) => Number(r.id) === id);
  assert.equal(found.length, 1, table + ':' + id); return found[0];
};
const equipmentIds = source.tables['content.csv'].filter((r) => ['2', '3'].includes(r.type_id)).map((r) => Number(r.id));
const characterIds = Object.values(published.gameState.characterInitializations).map((t) => t.initial.sourceId);
const names = new Map(equipmentIds.map((id) => [raw('content.csv', id).mes_id_name, system.catalog.definitions[id].name]));
const decoded = compileEquipmentCatalog(source.reader, equipmentIds, characterIds, (key) => {
  assert.ok(names.has(key)); return names.get(key);
}, Object.fromEntries(characterIds.map((id) => [id, { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false }])), weaponEffects);
assert.deepEqual(system.catalog, decoded.catalog, 'Published equipment catalog must be rebuilt with the complete MP provider');
const sourceCases = [];
for (const id of [304, 305]) {
  const content = raw('content.csv', id), armor = raw('armor.csv', Number(content.type_value));
  const wear = raw('function_group.csv', Number(armor.wear_function_group_id));
  const wearFn = raw('function.csv', Number(wear.function1_id));
  const ability = raw('ability.csv', Number(wear.function1_value1));
  const passiveContents = source.tables['content.csv'].filter((r) => r.type_id === '4' && r.type_value === ability.id);
  assert.equal(passiveContents.length, 1);
  const menu = raw('function_group.csv', Number(ability.menu_function_group_id));
  const menuFn = raw('function.csv', Number(menu.function1_id));
  assert.equal(wearFn.type_id, '62'); assert.equal(menuFn.type_id, '75');
  assert.equal(armor.wear_condition_group_id, '0'); assert.equal(ability.ability_group_id, '0');
  const compiled = compileEquipmentAbilityCost(source.reader, id);
  assert.deepEqual(compiled.provider.ability, { abilityId: Number(ability.id), contentId: Number(passiveContents[0].id), skillLevel: 0 });
  assert.equal(compiled.provider.modifier, menu.function1_value1 === '1' ? 'half' : 'one');
  assert.deepEqual(system.catalog.definitions[id].abilityCost, compiled.provider);
  assert.deepEqual(system.catalog.definitions[id].blockers, []);
  const params = compileParameterEquipment(source.reader, [{ slot: 5, contentId: id }]).equipment[0];
  assert.equal(params.values.weight, Number(armor.weight));
  assert.equal(params.values.vitality, Number(armor.vitality));
  sourceCases.push({ id, content, armor, wear, wearFn, ability, passiveContent: passiveContents[0], menu, menuFn,
    provider: compiled.provider, sources: compiled.sources });
}
const makeState = () => new GameState(published.gameState, published.common.players, contentHash, published.common.conditions);
const baseline = makeState().snapshot();
assert.equal(baseline.equipmentStock.some((entry) => [304, 305].includes(entry.id)), false,
  'Neither MP relic is granted by the published opening');
const matrix = [];
const entryId = Number(Object.keys(published.encounters)[0]);
function setup(slots, { grow = false } = {}) {
  const state = makeState(), sourceOwner = state.snapshot().roster.find((p) => p.sourceId === 1);
  assert.ok(sourceOwner);
  // Explicit controlled grants through the existing real inventory port. No
  // source owned skill or actor command list is added or replaced.
  for (const id of [304, 305]) state.fieldInventory.prepare({ kind: 'grant-equipment', id, count: 2 }).commit();
  state.fieldOwnedConditions.prepare({ kind: 'remove-condition', conditionType: 607, target: 0 }).commit();
  const empty = system.catalog.characters[sourceOwner.sourceId].emptySlots;
  for (const [i, id] of slots.entries()) state.changeEquipment(sourceOwner.id, i + 5, id ?? empty[i + 4]);
  const equipped = state.snapshot(), owner = equipped.roster.find((p) => p.id === sourceOwner.id);
  for (const id of [304, 305]) {
    const provider = system.catalog.definitions[id].abilityCost;
    assert.equal(owner.abilities.owned.filter((a) => a.abilityId === provider.ability.abilityId).length, slots.filter((v) => v === id).length);
  }
  assert.equal(owner.abilities.owned.find((a) => a.abilityId === 31).skillLevel, 100);
  assert.equal(owner.abilities.owned.find((a) => a.abilityId === 40).skillLevel, 100);
  if (grow) {
    const lease = state.openBattle(entryId), players = state.battlePlayers(lease), original = state.snapshot();
    const actor = players.find((p) => p.id === owner.id), plan = published.gameState.characterGrowth[actor.id];
    const targetLevel = actor.level + 2;
    const amount = plan.experience.find((r) => r.level === targetLevel).totalExp - actor.exp;
    assert.ok(amount > 0);
    const progression = state.battleProgression(lease);
    for (const player of players) Object.assign(player, progression(player, player.id === actor.id ? amount : 0, []));
    const result = { players, gil: 0, consumedItems: [], awardedExperience: players.map((p) => ({ id: p.id, amount: p.id === actor.id ? amount : 0 })), observedAbilityIds: [] };
    const commit = state.prepareVictory(lease, result);
    assert.deepEqual(state.snapshot(), original); commit();
    const grown = state.snapshot().roster.find((p) => p.id === actor.id);
    assert.equal(grown.level, targetLevel);
    assert.deepEqual(grown.abilities.owned.filter((a) => [291, 292].includes(a.abilityId)),
      owner.abilities.owned.filter((a) => [291, 292].includes(a.abilityId)));
    const increments = plan.growth.filter((r) => r.level > owner.level && r.level <= grown.level);
    assert.equal(grown.growth.additional.hp - owner.growth.additional.hp, increments.reduce((n, r) => n + r.hp, 0));
  }
  const save = state.snapshot(), restored = makeState(); restored.restore(save); assert.deepEqual(restored.snapshot(), save);
  const content = encounterContent(published, entryId);
  const exclusions = projectBattleFieldState(published.common.battleEntry,
    { mapId: 3, transportationId: 6, isSavePoint: null, beastFieldController: null, footAttributeType: null },
    published.gameState.fieldConditions.transportations);
  content.qualificationContext = { ...content.qualificationContext, invalidContentIds: exclusions.invalidContentIds };
  const lease = restored.openBattle(entryId), inventory = restored.battleInventory(lease);
  const battle = new BattleGame(content, 0x681, restored.battlePlayers(lease), inventory, restored.battleProgression(lease));
  const actor = battle.players.find((p) => p.id === owner.id);
  actor.atb = 100; for (const enemy of battle.enemies) enemy.atb = 0;
  assert.equal(battle.canUse(actor.id, 34, 7), false, 'Unlearned revival remains unselectable');
  assert.equal(battle.commandMenu(actor.id).some((command) => command.abilityIds.some((id) => [291, 292].includes(id))), false);
  return { state: restored, ownerId: owner.id, lease, battle, actor, save, inventory, content };
}
function runAction(probe, abilityId, fail = false) {
  const { state, lease, battle, actor, save } = probe;
  const target = abilityId === 31 ? actor : battle.enemies[0];
  if (abilityId === 31) {
    actor.hp = Math.max(1, actor.maxHp - 20);
    actor.conditionIds = battle.conditions.updateDying(actor.hp, actor.maxHp, actor.conditionIds);
  }
  const startingMp = actor.mp, cost = battle.abilityCost(actor.id, abilityId).mp;
  actor.mp = cost - 1;
  assert.equal(battle.canUse(actor.id, abilityId, 7), false);
  assert.equal(battle.command(actor.id, abilityId, target.id, 7), false);
  assert.equal(actor.mp, cost - 1);
  actor.mp = startingMp;
  assert.equal(battle.canUse(actor.id, abilityId, 7), true);
  const beforeCommand = actor.mp;
  assert.equal(battle.command(actor.id, abilityId, target.id, 7), true);
  assert.equal(actor.mp, beforeCommand, 'Queueing reserves no MP');
  let caught = false, resolved = null;
  const validDefense = target.magicDefense;
  if (fail) target.magicDefense = 256; // Deliberate numerical-provider fault.
  for (let i = 0; i < 1500 && !resolved; i++) {
    const before = structuredClone(battle.combatants), time = battle.time;
    try { battle.advance(10); }
    catch (error) {
      assert.equal(fail && !caught, true); assert.match(String(error), /outside supported/);
      assert.deepEqual(battle.combatants, before); assert.equal(battle.time, time);
      assert.equal(battle.players.find((p) => p.id === actor.id).mp, startingMp);
      caught = true;
      battle.enemies.find((p) => p.id === target.id).magicDefense = validDefense;
      battle.advance(0);
    }
    if (battle.action?.actor === actor.id && battle.action.source.id === abilityId && battle.action.resolved)
      resolved = structuredClone(battle.action);
  }
  assert.ok(resolved); assert.equal(caught, fail);
  assert.equal(battle.players.find((p) => p.id === actor.id).mp, startingMp - cost);
  battle.advance(1000);
  assert.equal(battle.players.find((p) => p.id === actor.id).mp, startingMp - cost, 'Completion pays no second fee');
  assert.deepEqual(state.snapshot(), save, 'A running battle keeps effects private');
  state.cancelBattle(lease); assert.deepEqual(state.snapshot(), save);
  return { abilityId, cost, before: startingMp, after: startingMp - cost, caught, results: resolved.results };
}
for (const slots of [[null, null], [304, null], [304, 304], [305, null], [305, 305], [304, 305], [305, 304]]) {
  const costs = [];
  for (const abilityId of [31, 40]) {
    const probe = setup(slots, { grow: true });
    const base = Number(raw('ability.csv', abilityId).use_value);
    const expected = base === 0 ? 0 : slots.includes(305) ? 1 : slots.includes(304) ? Math.ceil(base / 2) : base;
    assert.equal(probe.battle.abilityCost(probe.actor.id, abilityId).mp, expected);
    assert.equal(projectAbilityCost({ id: abilityId, cost: base }, { side: 'player', catalog: system.catalog,
      loadout: probe.inventory.qualification.members.find((p) => p.id === probe.actor.id) }).mp, expected);
    const result = runAction(probe, abilityId);
    costs.push(result);
  }
  matrix.push({ slots, costs });
}
const rollback = runAction(setup([304, 305]), 40, true);
const clean = runAction(setup([304, 305]), 40);
assert.deepEqual(rollback.results, clean.results, 'Repairing and retrying a failed frame preserves the RNG result');
const invalidSave = setup([304, 304]); invalidSave.state.cancelBattle(invalidSave.lease);
const malformed = structuredClone(invalidSave.save), malformedOwner = malformed.roster.find((p) => p.id === invalidSave.ownerId);
malformedOwner.abilities.owned.splice(malformedOwner.abilities.owned.findIndex((a) => a.abilityId === 291), 1);
assert.throws(() => invalidSave.state.restore(malformed), /passive|equipment|Equipment/);
assert.deepEqual(invalidSave.state.snapshot(), invalidSave.save);
invalidSave.state.changeEquipment(invalidSave.ownerId, 5, system.catalog.characters[1].emptySlots[4]);
assert.equal(invalidSave.state.snapshot().roster.find((p) => p.id === invalidSave.ownerId).abilities.owned.filter((a) => a.abilityId === 291).length, 1);
assert.deepEqual(published, originalPublished);
const report = { kind: 'source-equipment-mp-cost-and-owned-integration', contentHash,
  sourceSetHash: source.sourceSetHash, equipmentDefinitions: equipmentIds.length,
  executableEquipment: Object.values(decoded.catalog.definitions).filter((d) => !d.blockers.length).length,
  sourceCases, matrix, rollback, nativeReceipt: 'ability-cost-native-check.json',
  controlledInputs: ['Two copies of each relic supplied through the real inventory grant port only inside this process.',
    'Remove source 607 through the owned transaction; add controlled EXP for two real source levels; preserve naturally owned spells.',
    'Ready player ATB and zero enemy gauges isolate action timing; invalid enemy magicDefense=256 deliberately tests atomic rollback.',
    'No published initialization, stored user save, source skill ownership or source table is modified.'],
  originalGameExecuted: false, playableCoverage: false,
};
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/ability-cost-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ equipmentDefinitions: report.equipmentDefinitions, executableEquipment: report.executableEquipment,
  sourceProviders: sourceCases.length, loadouts: matrix.length, actions: matrix.reduce((n, row) => n + row.costs.length, 0),
  failedFrameRetried: rollback.caught, originalGameExecuted: false, passed: true }));
