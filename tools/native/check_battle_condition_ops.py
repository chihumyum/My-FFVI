"""Verify bounded BattleCondition packets and source metadata without executing the game."""
from pathlib import Path
import argparse, bisect, hashlib, json, re, sys
sys.dont_write_bytecode = True
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

p = argparse.ArgumentParser()
p.add_argument('--root', type=Path, required=True)
p.add_argument('--evidence', type=Path, required=True)
p.add_argument('--report', type=Path, required=True)
a = p.parse_args(); root = a.root.resolve(); evidence = a.evidence.resolve(); out = a.report.resolve()
assert out.is_relative_to(root / 'build')
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage
sha = lambda data: hashlib.sha256(data).hexdigest()
native = (root / 'build/runtime/game/GameAssembly.dll').read_bytes()
symbols = (root / 'build/native/il2cpp/script.json').read_bytes()
header = (root / 'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
dump = (root / 'build/native/il2cpp/dump.cs').read_bytes()
assert sha(native) == '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
assert sha(symbols) == '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'
assert sha(header) == '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
assert sha(dump) == 'e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b'
data = json.loads(symbols); methods = data['ScriptMethod']; addresses = sorted(set(m['Address'] for m in methods))
pe = PEImage(native); decoder = Cs(CS_ARCH_X86, CS_MODE_64); packets = []; rows = []

def packet(folder, digest, targets, lane):
    raw = (folder / 'complete.json').read_bytes(); receipt = json.loads(raw)
    assert sha(raw) == digest and receipt['status'] == 'complete'
    for key, blob in [('nativeSha256', native), ('symbolsSha256', symbols), ('headerSha256', header)]:
        assert receipt[key] == sha(blob)
    selected = []
    for address in targets:
        entry = next(m for m in receipt['methods'] if int(m['rva'], 16) == address)
        end = addresses[bisect.bisect(addresses, address)]; raw = pe.read(address, end-address)[2]
        body = (folder / f'{address:x}.c').read_bytes()
        assert end == int(entry['nextSymbolRva'],16)
        assert sha(raw) == entry['nativeRangeSha256'] and sha(body) == entry['decompiledSha256']
        row = {'rva':hex(address), 'endRva':hex(end), 'nativeBytes':len(raw), 'nativeSha256':sha(raw),
          'cSha256':sha(body), 'lane':lane, 'allAliases':[m for m in methods if m['Address']==address],
          'assembly':[{'rva':hex(i.address-pe.image_base),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}
            for i in decoder.disasm(raw, pe.image_base+address)]}
        rows.append(row); selected.append(hex(address))
    packets.append({'folder':str(folder),'receiptSha256':digest,'methods':selected,'lane':lane})

packet(evidence/'native-wrapper','66b0125bf53e2b44f928295670ccb3d3a9faf44a2e44327f44f544406fac0a31',[0xb42580],'new-bounded')
packet(evidence/'native-dispatch','04c1f8e43c4ca2422ac6343229dc99544cda1abb7f0f0da2f12f1d7f1662cd63',[0xb434b0],'new-bounded')
# The remaining exact receipt is derived only after the complete packet was
# independently verified; keep it explicit rather than trusting fresh C text.
packet(evidence/'native-owner','65869e052ed13860ff8ac410d7dc690e4b7f5e0d940fe1d631531fcc98cc0b81',[0x1562110,0x1562000,0x15655f0,0x15654e0,0x458520],'new-bounded')
packet(root/'build/wip/source-scripted-battle-action-family/native-targets','47a3f60b1b4063bba22b9c5628dd2de3cbc6c95b209b017125353779fe3f2411',[0xb43170,0x1563350,0x15639e0],'cached-target-providers')

cctor = next(row for row in rows if row['rva']=='0xb434b0')
slots = [int(row['operands'].split(', ')[1],16) for row in cctor['assembly']
    if row['mnemonic']=='mov' and row['operands'].startswith('r8d, 0x')]
assert slots == [30,31,28,29]
interface = dump.decode().split('public interface IBattleAccessor ')[1].split('// Namespace:')[0]
slot_names = ['RecoveryConditionPlayer','RecoveryConditionEnemy','AddConditionByPlayer','AddConditionByEnemy']
for slot, name in zip(slots, slot_names):
    assert re.search(r'Slot: '+str(slot)+r'\s+public abstract void '+name+r'\(', interface)
assert 'Slot: 33\n\tpublic abstract bool IsEndDownAnimation' in interface
assert 'Slot: 27\n\tpublic abstract bool SetNoActEnemy' in interface
method = next(m for m in data['ScriptMetadataMethod'] if m['Address']==0x1feb688)
assert method['Name']=='Method$Last.Data.Master.MasterManager.GetData<Condition>()'
for address in [0x1562110,0x1562000]:
    body=(evidence/'native-owner'/f'{address:x}.c').read_text()
    assert 'CurrentConditionList' in body and 'List_AssetLoader___Add' in body
    assert not any(token in body for token in ['ConflictCondition','InterruptAddCondition','IsAddable'])
for address in [0x15655f0,0x15654e0]:
    body=(evidence/'native-owner'/f'{address:x}.c').read_text()
    assert 'CurrentConditionList' in body and 'List_BattlePlayerData___Remove' in body
    assert 'InterruptRemoveCondition' not in body
report={'kind':'battle-condition-op-native-contract-v1','result':'passed-static-bounded-evidence','inputs':{
    'nativeSha256':sha(native),'symbolsSha256':sha(symbols),'headerSha256':sha(header),'dumpSha256':sha(dump)},
  'packets':packets,'methods':rows,'methodCount':len(rows),'newCompleteMethods':7,'originalPeBytes':sum(r['nativeBytes'] for r in rows),
  'dispatch':{'slots':slots,'methods':slot_names,'mappingProof':'whole original PE, not the truncated cctor C','getDataMethod':method},
  'contract':{'i2':'Condition master rowId, not ConditionType','i3_0':'Recovery, Remove one current master occurrence','i3_1':'Add, direct ordered append',
    'noImplicitSkillStages':['hit','resistance','IsAddable','Conflict','InterruptAdd/Remove'],
    'enemyRow5':'separate IsEndDownAnimation and previous enemy no-act restoration; retained gate',
    'web':'explicit immediate supported owner phase; duplicate and unknown lifecycle gates retained'},
  'originalGameExecuted':False,'nativeDynamicParity':False,'semanticsVerified':False}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':report['result'],'methods':len(rows),'sha256':sha(out.read_bytes())}))
