// Static native/source-bound Magitek lifecycle probes; not dynamic native parity.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), option = (key, fallback) => {
  const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1];
};
assert.ok(args.every((arg, index) => index % 2 ? !!arg : ['--compiled', '--native'].includes(arg)),
  'Usage: check-battle-appearance.mjs [--compiled dist] [--native build/runtime/game/GameAssembly.dll]');
const compiled = resolve(root, option('--compiled', 'dist'));
const native = resolve(root, option('--native', 'build/runtime/game/GameAssembly.dll'));
const load = (path) => import(pathToFileURL(resolve(compiled, 'src', path)));
const [{ readSnapshot, snapshotFile }, { compileBattleAppearance }, appearance,
  { loadSystemSource }, { compileBattleConditionCatalog }, { BattleConditions }] = await Promise.all([
  load('compiler/integrity.js'), load('compiler/battle-appearance.js'), load('core/battle-appearance.js'),
  load('compiler/system-source.js'), load('compiler/conditions.js'), load('core/battle-conditions.js'),
]);
const sha = (data) => createHash('sha256').update(data).digest('hex');
const [base, mediaFiles] = await Promise.all([readSnapshot(resolve(root, 'build/import')), readSnapshot(resolve(root, 'build/battle'))]);
const project = JSON.parse(snapshotFile(base, 'project.json'));
const media = JSON.parse(snapshotFile(mediaFiles, 'battle.json'));
assert.equal(media.parentSourceSetHash, project.sourceSetHash);
for (const sprite of Object.values(media.sprites)) assert.equal(sha(snapshotFile(mediaFiles, sprite.file)), sprite.sha256);
const source = await loadSystemSource(root, project.sourceSetHash);
const misc = Object.values(media.assets).filter((asset) => asset.source.assetPath.endsWith('/serial_misc_assets.json'));
assert.equal(misc.length, 1);
const result = compileBattleAppearance(source.reader, { tables: source.tables, misc: misc[0], sprites: media.sprites, sourceIds: media.characterIds });
assert.deepEqual(result.blockers, []);
const row = (table, id) => { const found = source.tables[table].filter((value) => Number(value.id) === id); assert.equal(found.length, 1); return found[0]; };
const constants = new Map(source.tables['game_constant_int.csv'].map((r) => [r.key_name, Number(r.value1)]));
const rawCondition = source.tables['condition.csv'].filter((value) => Number(value.condition_type) === 607);
assert.equal(rawCondition.length, 1); const conditionId = Number(rawCondition[0].id);
assert.equal(result.catalog.conditionId, conditionId);
assert.equal(Number(rawCondition[0].battle_effect_asset_id), 0);
assert.equal(source.tables['battle_effect_asset.csv'].some((r) => Number(r.id) === 0), false);
const { catalog: conditions } = compileBattleConditionCatalog(source.reader, source.tables['condition.csv'].map((r) => Number(r.id)), (key) => key);
const engine = new BattleConditions(conditions);
assert.equal(engine.name(conditionId), '');
const cases = [];
for (const id of media.characterIds) {
  const actor = result.actors[id], character = row('character_status.csv', id), asset = row('character_asset.csv', Number(character.character_asset_id));
  assert.equal(actor.characterAssetId, Number(asset.id)); assert.equal(actor.sizeType, Number(asset.size_type));
  const ordinary = appearance.createBattleAppearanceState(actor);
  const mounted = appearance.reconcileBattleAppearance(result.catalog, actor, ordinary, [conditionId]);
  const expectedSize = Number(asset.size_type) + constants.get('CHARACTER_MADOU_ASSET_POSTURE');
  assert.equal(mounted.nowCharaSize, expectedSize);
  for (const key of ['default', 'down', 'dying', 'IdleR00', 'dyingR00']) {
    const raw = misc[0].data.battle_anim_alias_table.filter((alias) => alias.key === key); assert.equal(raw.length, 1);
    const { projection } = appearance.projectBattleAppearanceFrame(result.catalog, actor, mounted, { key, bodyFrame: 0, armorFrame: 0 }, media.sprites);
    assert.equal(media.sprites[projection.body.sprite].name, raw[0].names[0]);
    assert.equal(media.sprites[projection.armor.sprite].name, raw[0].magic_armor_table.anim_names[0]);
    assert.ok(projection.body.sprite.toLowerCase().includes('/' + asset.asset_name.toLowerCase() + '/'));
    assert.ok(projection.armor.sprite.toLowerCase().includes('/bc_ff6_p022/'));
    assert.deepEqual(projection.body.textureOffset, { x: Math.fround(raw[0].magic_armor_table.chara_offsets[0].x), y: Math.fround(raw[0].magic_armor_table.chara_offsets[0].y) });
    assert.deepEqual(projection.body.position, raw[0].magic_armor_table.chara_position[0]);
    assert.equal(projection.body.width, 32); assert.equal(projection.body.height, 32);
    assert.equal(projection.armor.width, 32); assert.equal(projection.armor.height, 40);
  }
  // The independently read native conflict group preserves 607 through death.
  const death = row('condition.csv', conditions.hpZeroConditionId);
  const preserve = source.tables['erase_condition_group.csv'].filter((r) => Number(r.group_id) === Number(death.erase_condition_group_id) && Number(r.condition_id) === conditions.hpZeroConditionId && Number(r.type_id) === 5);
  assert.ok(preserve.some((r) => Number(r.erase_condition) === conditionId));
  const dead = engine.settleLife(0, [conditionId], false);
  assert.ok(dead.conditionIds.includes(conditionId));
  assert.deepEqual(appearance.reconcileBattleAppearance(result.catalog, actor, mounted, dead.conditionIds), mounted);
  const revived = engine.recover(dead.conditionIds, [conditions.hpZeroConditionId]);
  assert.ok(revived.currentIds.includes(conditionId));
  assert.deepEqual(appearance.reconcileBattleAppearance(result.catalog, actor, mounted, revived.currentIds), mounted);
  assert.ok(engine.battleEnd(dead.conditionIds).includes(conditionId));
  const removed = appearance.reconcileBattleAppearance(result.catalog, actor, mounted, []);
  assert.equal(removed.magitek, null); assert.equal(removed.nowCharaSize, Number(asset.size_type));
  const before = structuredClone(mounted), missing = { ...media.sprites };
  delete missing[result.catalog.armorSprites.WalkL_01];
  assert.throws(() => appearance.projectBattleAppearanceFrame(result.catalog, actor, mounted, { key: 'default', bodyFrame: 0, armorFrame: 0 }, missing), /Missing.*media/);
  assert.deepEqual(mounted, before);
  cases.push({ sourceId: id, characterAssetId: actor.characterAssetId, ordinarySize: actor.sizeType, magitekSize: expectedSize,
    lifecycle: 'start-death-revival-battle-end-remove', requiredPoses: 5 });
}
const receipt = JSON.parse((await promisify(execFile)(resolve(root, '.venv/bin/python'), ['-c', String.raw`
import json, hashlib, sys, bisect
from pathlib import Path
root,dll=Path(sys.argv[1]),Path(sys.argv[2]);sys.path.insert(0,str(root/'tools/native'));from inspect_pe import PEImage
sha=lambda value:hashlib.sha256(value).hexdigest()
data=dll.read_bytes();pe=PEImage(data)
symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
assert sha(data)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
assert sha(symbols)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'
assert sha(header)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
selected={
 'v22-battle-appearance':[0x92c440,0x92c3b0,0x45b3d0,0x45bc70,0x158d160,0x683380,0x8fa7b0,0x1587400],
 'v22-battle-appearance-render':[0xaa5b30,0x51c6d0,0x51c5b0,0x51cba0,0x682e70,0x51cc60],
 'v22-battle-appearance-mesh':[0x8aa590],
 'v20-battle-abilities-context':[0x922070],
 'v21-battle-entry-condition':[0x921fc0],
 'v20-battle-abilities-release':[0x6827f0,0x682df0,0x158cc40],
}
methods=[]
for batch,addresses in selected.items():
 folder=root/'build/native'/batch;complete=json.loads((folder/'complete.json').read_text())
 assert complete['status']=='complete' and complete['nativeSha256']==sha(data)
 assert complete['symbolsSha256']==sha(symbols) and complete['headerSha256']==sha(header)
 for rva in addresses:
  matches=[m for m in complete['methods'] if int(m['rva'],16)==rva];assert len(matches)==1
  m=matches[0];end=int(m['nextSymbolRva'],16)
  raw=pe.read(rva,end-rva)[2];assert sha(raw)==m['nativeRangeSha256']
  c=(folder/(hex(rva)[2:]+'.c')).read_bytes();assert sha(c)==m['decompiledSha256']
  methods.append({'batch':batch,'rva':hex(rva),'end':hex(end),'nativeRangeSha256':sha(raw),'decompiledSha256':sha(c)})
# Source-owned mesh generation, shared no-op Update, effect getter and type predicate.
all_symbols=json.loads(symbols);starts=sorted(set(m['Address'] for m in all_symbols['ScriptMethod']))
raw=[]
for rva in [0x924140,0x923c30,0x923880,0x389c90,0x2c8ef0,0x4a5c30,0x4def20]:
 end=starts[bisect.bisect_right(starts,rva)];value=pe.read(rva,end-rva)[2]
 if rva==0x2c8ef0:assert value[:3]==bytes.fromhex('c20000')
 raw.append({'rva':hex(rva),'end':hex(end),'nativeRangeSha256':sha(value)})
strings={s['Address']:s['Value'] for s in all_symbols['ScriptString']}
assert strings[0x2005e50]=='_MainTex' and strings[0x1ff0270]=='bc_ff6_p022'
# Validate sampling metadata against exact original Unity path/ID, not compiler defaults.
import UnityPy
battle=json.loads((root/'build/battle/battle.json').read_text()); groups={}
for key,s in battle['sprites'].items():
 if '/Chara/Battle/' in key:groups.setdefault(s['source']['file'],[]).append((key,s))
geometry=0
for file,sprites in groups.items():
 path=root/'build/runtime/game/FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64'/file
 declared=[s for s in battle['sources'] if s['file'].endswith('/'+file)];assert len(declared)==1 and sha(path.read_bytes())==declared[0]['sha256']
 env=UnityPy.load(str(path))
 by_key={}
 for key,obj in env.container.items():
  if obj.type.name=='Sprite':by_key[key]=obj
 for key,s in sprites:
  obj=by_key[key];assert str(obj.path_id)==s['source']['objectId']
  native_sprite=obj.read();texture=native_sprite.m_RD.texture.deref_parse_as_object();settings=texture.m_TextureSettings
  assert s['pixelsPerUnit']==native_sprite.m_PixelsToUnits==1
  assert s['textureWrap']==[settings.m_WrapU,settings.m_WrapV]==[1,1]
  assert s['filterMode']==settings.m_FilterMode==0
  assert s['width']==texture.m_Width and s['height']==texture.m_Height
  assert s['pivot']==[native_sprite.m_Pivot.x,native_sprite.m_Pivot.y]==[.5,0]
  geometry+=1
print(json.dumps({'nativeSha256':sha(data),'semanticsVerified':False,'methods':methods,'rawRanges':raw,'originalSpriteGeometry':geometry}))
`, root, native], { maxBuffer: 16 * 1024 * 1024 })).stdout);
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/battle-appearance-native-check.json'), JSON.stringify(receipt, null, 2)+'\n');
const report = { kind: 'static-source-and-deterministic-mechanism', sourceSetHash: media.sourceSetHash,
  nativeSemanticsVerified: false, conditionId, actors: cases.length, cases,
  aliases: Object.keys(result.catalog.aliases).length, nativeMethods: receipt.methods.length,
  nativeRawRanges: receipt.rawRanges.length, originalSpriteGeometry: receipt.originalSpriteGeometry,
  limitations: result.limitations };
await writeFile(resolve(root, 'build/reports/battle-appearance-check.json'), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({ actors: cases.length, aliases: report.aliases, nativeMethods: report.nativeMethods,
  nativeRawRanges: report.nativeRawRanges, originalSpriteGeometry: report.originalSpriteGeometry, passed: true }));
