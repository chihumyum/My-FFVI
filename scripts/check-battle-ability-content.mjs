// Full source definitions + bounded execution + naturally owned spell checks.
// No generated ability is granted to a character, inventory or persistent save.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), option = (name, fallback) => {
  const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1];
};
assert.ok(args.every((arg, index) => index % 2 ? !!arg : ['--dist', '--catalog', '--native'].includes(arg)),
  'Usage: check-battle-ability-content.mjs [--dist dist] [--catalog build/game/opening-playable.json] [--native build/runtime/game/GameAssembly.dll]');
const dist = resolve(root, option('--dist', 'dist'));
const load = (name) => import(pathToFileURL(resolve(dist, 'src', name + '.js')));
const [
  { readSnapshot, snapshotFile }, { loadSystemSource }, { loadSystemMessages },
  { compileBattleAbilityContent }, { compileBattleConditionCatalog }, { BattleConditions },
  { projectActionTarget }, { GameState }, { BattleGame }, { encounterContent },
  { projectBattleFieldState }, { hash },
] = await Promise.all([
  load('compiler/integrity'), load('compiler/system-source'), load('compiler/system-messages'),
  load('compiler/battle-ability-content'), load('compiler/conditions'), load('core/battle-conditions'),
  load('core/action-effects'), load('core/game-state'), load('core/battle'), load('core/battle-content'),
  load('core/field-battle-entry'), load('compiler/content'),
]);
const imported = await readSnapshot(resolve(root, 'build/import'));
const project = JSON.parse(snapshotFile(imported, 'project.json'));
const source = await loadSystemSource(root, project.sourceSetHash);
const system = await loadSystemMessages(root, project.sourceSetHash, source.manifest.sources);
const name = (key) => {
  const found = [system.messages[key], source.messages.story_mes_zhc?.[key]].filter((value) => typeof value === 'string');
  return found.length && new Set(found).size === 1 ? found[0] : null;
};
const compiled = compileBattleAbilityContent(source.reader, source.tables, name);
const rawAbility = (id) => {
  const found = source.tables['ability.csv'].filter((row) => Number(row.id) === id);
  assert.equal(found.length, 1); return found[0];
};
const contents = source.tables['content.csv'].filter((row) => Number(row.type_id) === 4);
assert.equal(Object.keys(compiled.abilities).length, source.tables['ability.csv'].length);
assert.equal(compiled.report.total, 1530);
assert.deepEqual(compiled.report.display, { message: 1115, none: 269, 'missing-message': 1, 'missing-content': 145, 'ambiguous-content': 0 });
assert.equal(compiled.entries[431].display.nameKey, 'MSG_MON_ATK_52');
assert.equal(compiled.abilities[431].plan, null);
const { catalog: conditionCatalog } = compileBattleConditionCatalog(source.reader,
  source.tables['condition.csv'].map((row) => Number(row.id)), (key) => name(key) ?? key);
const conditions = new BattleConditions(conditionCatalog);
const scalarCases = [];
for (const row of source.tables['ability.csv']) {
  const id = Number(row.id), definition = compiled.abilities[id], entry = compiled.entries[id];
  assert.deepEqual(entry.source.values, row);
  const matches = contents.filter((content) => Number(content.type_value) === id);
  assert.deepEqual(entry.contents.map((content) => content.values), matches);
  assert.equal(compiled.abilityContentIds[id], matches.length === 1 ? Number(matches[0].id) : null);
  if (entry.display.kind === 'message') assert.equal(definition.name, name(matches[0].mes_id_name));
  else assert.equal(definition.name, '');
  if (!definition.plan) { assert.ok(definition.blockers.length); continue; }
  assert.equal(Number(row.ability_lv), 0);
  assert.equal(definition.cost, Number(row.use_value));
  assert.equal(definition.wait, Number(row.ability_wait));
  assert.equal(definition.power, Number(row.standard_value));
  assert.notEqual(id, 154);
  conditions.validateReferences(definition.program.forbiddenConditionIds);
  conditions.validateActive(entry.conditionDependencies.added);
  conditions.validateReferences(entry.conditionDependencies.recovered);
  // Controlled arithmetic inputs exercise EVERY emitted plan against the actual
  // shared target projector. This does not put these actions on an owned menu.
  const actor = { id: 'controlled-actor', side: 'player', row: 'front', level: 5, magic: 20,
    attack: 20, defense: 20, magicDefense: 20, evasion: 0, magicEvasion: 0,
    physical: { attack: 20, strength: 20, accuracy: 100, criticalRate: 0 },
    attackElements: [], elementResistances: {}, hp: 80, maxHp: 100,
    mp: 999, maxMp: 999, conditionIds: [], conditionResistances: {} };
  const target = structuredClone(actor); target.id = 'controlled-target';
  const effects = definition.plan.effects;
  if (effects.some((effect) => effect.kind === 'recover-max-hp')) {
    target.hp = 0; target.conditionIds = [conditionCatalog.hpZeroConditionId];
  } else if (effects[0]?.kind === 'recover-condition') {
    target.conditionIds = entry.conditionDependencies.recovered.filter((id) => conditionCatalog.behaviors.some((behavior) => behavior.id === id));
  }
  if (definition.plan.targeting.relation === 'self') target.id = actor.id;
  const before = structuredClone({ actor, target });
  const result = projectActionTarget(definition.plan, definition.power, actor, target, conditions,
    (min) => min, 1, definition.cost,
    { actor: 'front', target: 'front', ignoreActorPenalty: false, ignoreTargetPenalty: false });
  conditions.validateActive(result.state.conditionIds);
  assert.deepEqual({ actor, target }, before, 'Target projection must remain pure: ' + id);
  assert.equal(result.effects.length, definition.plan.effects.length);
  scalarCases.push({ id, effects: effects.map((effect) => effect.kind), result });
}
for (const id of [31, 40]) {
  const definition = compiled.abilities[id];
  assert.ok(definition.plan); assert.ok(definition.program.contentFlags.includes(3));
  assert.equal(definition.plan.magic.contentFlags.includes(3), false);
  assert.ok(compiled.entries[id].requirements.includes('no-runic-undead-or-other-value-overrides'));
  assert.ok(compiled.entries[id].requirements.includes('no-reflection-provider'));
}
assert.deepEqual(compiled.entries[763].conditionDependencies.recovered,
  source.tables['condition_group.csv'].filter((row) => Number(row.group_id) === 1).map((row) => Number(row.condition_id)));
for (const id of [59, 360, 1312, 1330]) {
  const definition = compiled.abilities[id];
  if (definition.plan) assert.ok(definition.plan.magic?.contentFlags.includes(2),
    'Native all-target provider needs an equivalent source flag: ' + id);
}
for (const type of [413, 604, 612]) {
  const ids = conditionCatalog.rules.definitions.filter((row) => row.type === type).map((row) => row.id);
  assert.ok(ids.length); for (const id of ids) assert.throws(() => conditions.validateActive([id]), /Unimplemented active/);
}

const published = JSON.parse(await readFile(resolve(root, option('--catalog', 'build/game/opening-playable.json')), 'utf8'));
const { contentHash, ...body } = published; assert.equal(hash(body), contentHash);
assert.equal(hash(published.common.abilities), hash(compiled.abilities), 'Published battle uses the complete source dictionary');
assert.deepEqual(published.common.abilityContentIds, compiled.abilityContentIds);
for (const [id, modifier, abilityId] of [[304, 'half', 291], [305, 'one', 292]]) {
  const equipment = published.gameState.equipmentSystem.catalog.definitions[id];
  assert.deepEqual(equipment.blockers, []);
  assert.equal(equipment.abilityCost.modifier, modifier);
  assert.equal(equipment.abilityCost.ability.abilityId, abilityId);
  assert.equal(compiled.abilities[abilityId].plan, null, 'A passive does not become an executable command');
}
const entryId = Number(Object.keys(published.encounters)[0]);
const make = () => {
  const state = new GameState(published.gameState, published.common.players, contentHash, published.common.conditions);
  // Explicit controlled field-state transition: remove source 607 through its
  // real owned transaction. No owned ability/command/skill level is modified.
  const ownedBefore = state.snapshot().roster.map(({ id, abilities }) => ({ id, abilities }));
  state.fieldOwnedConditions.prepare({ kind: 'remove-condition', conditionType: 607, target: 0 }).commit();
  assert.deepEqual(state.snapshot().roster.map(({ id, abilities }) => ({ id, abilities })), ownedBefore);
  const content = encounterContent(published, entryId);
  const exclusions = projectBattleFieldState(published.common.battleEntry,
    { mapId: 3, transportationId: 6, isSavePoint: null, beastFieldController: null, footAttributeType: null },
    published.gameState.fieldConditions.transportations);
  assert.ok(exclusions.invalidContentIds);
  content.qualificationContext = { ...content.qualificationContext, invalidContentIds: exclusions.invalidContentIds };
  const lease = state.openBattle(content.encounterId, content.rewardPolicy), ownerBefore = state.snapshot();
  const battle = new BattleGame(content, 0x61, state.battlePlayers(lease), state.battleInventory(lease), state.battleProgression(lease));
  return { state, content, lease, battle, ownerBefore, ownedBefore };
};
const ownedCases = [];
for (const abilityId of [31, 40]) {
  const { state, content, lease, battle, ownerBefore } = make();
  const actor = battle.players.find((player) => player.sourceId === 1); assert.ok(actor);
  const owner = ownerBefore.roster.find((player) => player.id === actor.id);
  for (const id of [31, 40]) assert.equal(owner.abilities.owned.find((a) => a.abilityId === id).skillLevel, 100);
  assert.equal(owner.abilities.owned.find((a) => a.abilityId === 34).skillLevel, 0);
  const menu = battle.commandMenu(actor.id).find((command) => command.id === 7);
  assert.ok(menu.available); assert.deepEqual(menu.abilityIds, [31, 40]);
  assert.equal(battle.canUse(actor.id, 34, 7), false, 'A compiled revival plan must not grant its unlearned ability');
  assert.equal(battle.canUse(actor.id, abilityId, 7), true);
  // Preserve real source player stats and costs; start the actor ready and
  // enemy gauges at zero to isolate the first ordinary player action.
  actor.atb = 100;
  for (const enemy of battle.enemies) enemy.atb = 0;
  const target = abilityId === 31 ? actor : battle.enemies[0];
  if (abilityId === 31) { actor.hp = Math.max(1, actor.maxHp - 20); actor.conditionIds = conditions.updateDying(actor.hp, actor.maxHp, actor.conditionIds); }
  const initialHp = target.hp, initialMp = actor.mp;
  assert.equal(battle.command(actor.id, abilityId, target.id, 7), true);
  let resolution = null;
  for (let i = 0; i < 1500 && !resolution; i++) {
    battle.advance(10);
    if (battle.action?.actor === actor.id && battle.action.source.kind === 'ability' &&
        battle.action.source.id === abilityId && battle.action.resolved) resolution = structuredClone(battle.action);
  }
  assert.ok(resolution);
  assert.equal(actor.mp, initialMp - Number(rawAbility(abilityId).use_value));
  if (abilityId === 31) assert.ok(target.hp > initialHp); else assert.ok(target.hp < initialHp);
  const resolvedHp = target.hp;
  battle.advance(1000);
  assert.equal(actor.mp, initialMp - Number(rawAbility(abilityId).use_value), 'MP is not paid again at action completion');
  assert.deepEqual(state.snapshot(), ownerBefore, 'The live lease does not publish battle mutations');
  const probe = { abilityId, sourceId: actor.sourceId, commandId: 7, hpBefore: initialHp, hpAfter: resolvedHp,
    mpBefore: initialMp, mpAfter: actor.mp, resolved: 1, resolution,
    ownedAbilityIds: menu.abilityIds, blockedUnlearnedAbility: 34 };
  state.cancelBattle(lease); assert.deepEqual(state.snapshot(), ownerBefore);
  ownedCases.push(probe);
}

const native = resolve(root, option('--native', 'build/runtime/game/GameAssembly.dll'));
const receipt = JSON.parse((await promisify(execFile)(resolve(root, '.venv/bin/python'), ['-c', String.raw`
import json, hashlib, struct, sys
from pathlib import Path
root,dll=Path(sys.argv[1]),Path(sys.argv[2]);sys.path.insert(0,str(root/'tools/native'));from inspect_pe import PEImage
sha=lambda value:hashlib.sha256(value).hexdigest()
data=dll.read_bytes();pe=PEImage(data)
symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
assert sha(data)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
methods=[]
for batch,addresses in {
 'v23-ordinary-magic':[0x4a5020,0x74bd00,0x15ae7b0,0x342630,0x8fdc70],
 'v23-ordinary-magic-providers':[0x922500,0x85b3d0],
 'magic-core':[0x3d8de0,0x3d9af0,0xa94480,0x66a000],
}.items():
 folder=root/'build/native'/batch;complete=json.loads((folder/'complete.json').read_text())
 assert complete['status']=='complete' and complete['nativeSha256']==sha(data)
 assert complete['symbolsSha256']==sha(symbols) and complete['headerSha256']==sha(header)
 for rva in addresses:
  found=[m for m in complete['methods'] if int(m['rva'],16)==rva];assert len(found)==1
  m=found[0];end=int(m['nextSymbolRva'],16);value=pe.read(rva,end-rva)[2]
  assert sha(value)==m['nativeRangeSha256']
  c=(folder/(hex(rva)[2:]+'.c')).read_bytes();assert sha(c)==m['decompiledSha256']
  methods.append({'batch':batch,'rva':hex(rva),'nativeRangeSha256':sha(value),'decompiledSha256':sha(c)})
raw=[]
for rva,size,role in [(0x3db3dd,0x48,'all-target correction array initialization'),
                       (0x85fc30,0x40,'MP passive equipment selector reads owned content identity')]:
 section,offset,value=pe.read(rva,size)
 raw.append({'rva':hex(rva),'size':size,'section':section,'fileOffset':offset,'nativeRangeSha256':sha(value),'role':role})
assert raw[0]['nativeRangeSha256']=='0fcd02fc806a3a8ba5f79c2173584ea178e53b7cd36eee26b648b28d27f8302a'
s=json.loads(symbols);field=[v for v in s['ScriptMetadata'] if v['Address']==0x1fcc748]
assert len(field)==1 and field[0]['Name']=='Field$<PrivateImplementationDetails>.6435D3003710B9C9B0CD2230DBFB567A4120EBA9'
assert any(v['Address']==0x85fc30 and v['Name']=='Serial.FF6.Management.PassiveContentProvider.<>c$$<GetMPDiameter>b__4_0' for v in s['ScriptMethod'])
assert any(v['Address']==0x8e07a0 and v['Name']=='Last.Data.User.OwnedItemData$$get_ContentId' for v in s['ScriptMethod'])
metadata=(root/'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat').read_bytes()
value=metadata[0x4dede6:0x4dede6+16]
assert hashlib.sha1(value).hexdigest()==field[0]['Name'].split('.')[-1].lower()
ids=list(struct.unpack('<4i',value));assert ids==[59,360,1312,1330]
print(json.dumps({'nativeSha256':sha(data),'symbolsSha256':sha(symbols),'headerSha256':sha(header),
 'metadataSha256':sha(metadata),'semanticsVerified':False,'methods':methods,'rawRanges':raw,
 'notCorrectionAllMagicDamage':{'field':field[0]['Name'],'metadataOffset':'0x4dede6','values':ids}}))
`, root, native], { maxBuffer: 4 * 1024 * 1024 })).stdout);
const report = { kind: 'source-catalog-bounded-execution-and-owned-spells', contentHash,
  sourceSetHash: source.sourceSetHash, parentSourceSetHash: project.sourceSetHash,
  messageSource: system.source, catalog: compiled.report, entries: compiled.entries,
  scalarCases, ownedCases, nativeReceipt: receipt,
  originalGameExecuted: false, playableCoverage: false,
  controlledInputs: ['Pure target projections use explicit synthetic numerical states; they grant no skills.',
    'Owned spell probes remove 607 through the real owner transaction and isolate ready/AI gauges; story and field rendering are not executed.',
    'The published game catalog and owned initialization remain unchanged.'],
};
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/battle-ability-content-native-check.json'), JSON.stringify(receipt, null, 2) + '\n');
await writeFile(resolve(root, 'build/reports/battle-ability-content-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: compiled.report.total, boundedHostPlans: compiled.report.boundedHostPlans,
  blocked: compiled.report.blocked, display: compiled.report.display, scalarCases: scalarCases.length,
  ownedCases, nativeMethods: receipt.methods.length, nativeRawRanges: receipt.rawRanges.length, passed: true }, null, 2));
