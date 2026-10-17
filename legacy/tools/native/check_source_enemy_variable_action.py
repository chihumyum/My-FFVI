"""Audit finite Function23 source evidence without executing a game binary."""
from pathlib import Path
import argparse, hashlib, json, os, sys
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, default=Path.cwd())
p.add_argument('--phase', type=Path, required=True)
p.add_argument('--fallback', type=Path, required=True)
p.add_argument('--target-result', type=Path, required=True)
p.add_argument('--output', type=Path, default=Path('build/reports/source-enemy-variable-native.json'))
a = p.parse_args(); root = a.root.resolve(); output = (root / a.output).resolve()
if not output.is_relative_to(root / 'build'): raise ValueError('Evidence output must stay in ignored build/')
sys.path.insert(0, str(root)); from tools.native.inspect_pe import PEImage
sha = lambda b: hashlib.sha256(b).hexdigest()
paths = {'nativeSha256': 'build/runtime/game/GameAssembly.dll', 'symbolsSha256': 'build/native/il2cpp/script.json', 'headerSha256': 'build/native/il2cpp/il2cpp_ghidra.h'}
pins = {'nativeSha256': '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc', 'symbolsSha256': '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3', 'headerSha256': '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
buffers = {k: (root / v).read_bytes() for k, v in paths.items()}; assert {k: sha(v) for k, v in buffers.items()} == pins
symbols = json.loads(buffers['symbolsSha256']); methods = symbols['ScriptMethod']; addresses = sorted(set(m['Address'] for m in methods)); pe = PEImage(buffers['nativeSha256'])
def raw(rva):
    end = next(x for x in addresses if x > rva); section, offset, b = pe.read(rva, end - rva)
    return dict(rva=hex(rva), nextSymbolRva=hex(end), bytes=len(b), section=section, fileOffset=offset, sha256=sha(b), hex=b.hex(), aliases=[m for m in methods if m['Address'] == rva], nextAliases=[m for m in methods if m['Address'] == end])
records = []; sources = {}
def complete(folder, rvas, exact=False):
    folder = (root / folder).resolve(); b = (folder / 'complete.json').read_bytes(); receipt = json.loads(b)
    assert receipt['status'] == 'complete' and {k: receipt[k] for k in pins} == pins
    if exact: assert {int(m['rva'], 16) for m in receipt['methods']} == set(rvas)
    for rva in rvas:
        entry = next(m for m in receipt['methods'] if int(m['rva'], 16) == rva); c = (folder / f'{rva:x}.c').read_bytes(); source = raw(rva)
        assert entry['nextSymbolRva'] == source['nextSymbolRva'] and entry['nativeRangeSha256'] == source['sha256'] and entry['decompiledSha256'] == sha(c)
        assert c.startswith(f'/* RVA 0x{rva:x};'.encode()); sources[rva] = c.decode()
        records.append(dict(directory=os.path.relpath(folder, root), receiptSha256=sha(b), sourceRange=source, method=entry, cSha256=sha(c)))
complete(a.phase, [0x756460, 0x4f7af0], True)
complete(a.fallback, [0x9053b0], True)
complete(a.target_result, [0x3da960, 0xaa0a60], True)
complete(Path('build/native/ability-providers'), [0x759140, 0x75deb0, 0x755940, 0x75dac0, 0x3419c0, 0x342080])
complete(Path('build/native/ability-functions'), [0x97c3f0, 0x97c4a0, 0x97cab0, 0x97c300, 0x66c630])
complete(Path('build/native/revival-dispatch'), [0x4f7ab0, 0x4f7060, 0x4f8890])
complete(Path('build/native/revival-target-recovery'), [0x4f7d60])
complete(Path('build/native/condition-lifecycle'), [0x3d59f0])
keys = {0x201e290: 'SET_VARIABLE_CALC', 0x201e2f8: 'ADD_VARIABLE_CALC', 0x201e2b0: 'ADD_VARIABLE_CALC_TWO_DIMENTIONAL'}
for address, key in keys.items():
    assert [s['Value'] for s in symbols['ScriptString'] if s['Address'] == address] == [key]
    assert f'_DAT_18{address:07x}' in sources[0x759140]
assert 'CurrentVariableArray' in buffers['headerSha256'].decode()
assert sources[0x759140].count('+ 0x168') >= 3
assert 'HitCalcAlwaysNon' in sources[0x759140] and 'ICalcAttackDic' in sources[0x759140]
assert '__this_00,0,-1,0,' in sources[0x756460]
assert 'Last_Battle_Function_BattleBasicFunction__HitCalc' in sources[0x97c4a0]
assert 'Last_Battle_Function_BattleBasicFunction__MainCalc' in sources[0x4f7d60]
assert 'func_0x00018066cc80' in sources[0x4f7ab0]
assert 'case 0x17:' in sources[0x3419c0] and '_Last_Battle_Function_UniqueFunction_TypeInfo' in sources[0x3419c0]
# The UniqueFunction Calc decompiler warned and removed the tail after a GC
# write barrier. Audit its complete source PE instead of trusting that deletion.
calc = raw(0x9053b0)
assert calc['bytes'] == 448 and calc['sha256'] == 'a954b9e17264b8f94b506ca17122b098846782d8edc3922ec53dd53ff3a36ba3'
assert 'Removing unreachable block' in sources[0x9053b0]
shared = [raw(rva) for rva in [0x4f7040, 0x4cafa0, 0x66cc80]]
assert shared[0]['hex'] == '488b51104533c0e9140d0000cccccccc'
assert shared[1]['hex'] == '488bc2c3cccccccccccccccccccccccc'
assert shared[2]['hex'] == '48c744243000000000e9a2f9ffffcccc'
# Exactly six string comparisons lie on the unmatched generic-key path. Each
# source RIP load/call/zero branch is bound to the complete own body bytes.
import struct, re
checks = [(0xaa0c9e, 0x1fec0e0, 0xaa0ca8, 0xaa0caf, 0xaa136c),
          (0xaa136f, 0x1fec0b0, 0xaa1379, 0xaa1380, 0xaa196b),
          (0xaa196e, 0x1fec080, 0xaa1978, 0xaa197f, 0xaa1cb5),
          (0xaa1cb8, 0x1fec050, 0xaa1cc2, 0xaa1cc9, 0xaa2aec),
          (0xaa2aef, 0x1febff8, 0xaa2af9, 0xaa2b00, 0xaa34e0),
          (0xaa34e3, 0x1febfe8, 0xaa34ed, 0xaa34f4, 0xaa3526)]
source_commands = []; strings = {s['Address']: s['Value'] for s in symbols['ScriptString']}
for load, address, call, jump, destination in checks:
    b = pe.read(load, 7)[2]; assert b[:3] == bytes.fromhex('488b15') and load + 7 + struct.unpack('<i', b[3:])[0] == address
    b = pe.read(call, 5)[2]; assert b[0] == 0xe8 and call + 5 + struct.unpack('<i', b[1:])[0] == 0x1092f10
    assert any(m['Name'] == 'System.String$$Equals' for m in methods if m['Address'] == 0x1092f10)
    b = pe.read(jump, 6)[2]
    if b[0] == 0x74: assert jump + 2 + struct.unpack('<b', b[1:2])[0] == destination
    else: assert b[:2] == bytes.fromhex('0f84') and jump + 6 + struct.unpack('<i', b[2:])[0] == destination
    source_commands.append(strings[address])
assert source_commands == ['BAKU', 'RAND_CONDITION', 'PAIR_SKILL', 'PAIR_SKILL_RAND', 'KICK', 'ff6_ability_sketch']
assert set(source_commands).isdisjoint(keys.values())
assert len(re.findall(r'System_String__Equals\(command,', sources[0xaa0a60])) == 6
assert pe.read(0xaa3526, 5)[2].hex() == 'bb02000000'  # unmatched → HitType.Miss
assert pe.read(0x3dab08, 5)[2].hex() == 'c644243800'  # recovery=false
miss = raw(0x4551d0)
assert miss['bytes'] == 256 and pe.read(0x4552a2, 6)[2].hex() == '83f8020f94c0'
assert 'vtable)._9_IsMiss.methodPtr' in sources[0x4f8890]
report = dict(kind='source-enemy-variable-native-check-v1', pins=pins, completeBodies=records, sharedPeOnly=shared, updateSkipPe=miss,
    exactGenericKeys={hex(k): v for k, v in keys.items()}, variableOwner='actual attacker EnemyCharacterParameter.CurrentVariableArray at +0x168',
    signedBankCells=15, targetFallback=dict(comparedCommands=source_commands, value=0, hitType=2, hitCount=0, conditions=[], recovery=False,
        extraRandomDraws=0, updateParameter='skipped by inherited IsMiss comparing exact hitType2', primaryReceivedResult='separate original slot1'),
    decompilerWarningsPreserved=True, originalGameExecuted=False, semanticsVerified=False)
output.parent.mkdir(parents=True, exist_ok=True); b = (json.dumps(report, indent=2) + '\n').encode(); output.write_bytes(b)
print(json.dumps(dict(methods=len(records), sharedRanges=len(shared), sharedBytes=sum(r['bytes'] for r in shared), updateSkipPeBytes=256, sha256=sha(b))))
