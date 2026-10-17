"""Bounded, read-only original PE/metadata audit. No native execution/export."""
import argparse, hashlib, json, re, sys
from pathlib import Path
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--report', type=Path, default=Path('build/reports/source-event-activation-native.json'))
args = parser.parse_args()
root = args.root.resolve()
out = args.report if args.report.is_absolute() else root/args.report
out = out.resolve()
assert out.is_relative_to(root/'build') and out.suffix == '.json', 'Report must stay under ignored build/'
out.parent.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage
sha = lambda b: hashlib.sha256(b).hexdigest()
pins = {
 'nativeSha256': ('build/runtime/game/GameAssembly.dll', '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
 'symbolsSha256': ('build/native/il2cpp/script.json', '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),
 'headerSha256': ('build/native/il2cpp/il2cpp_ghidra.h', '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'),
 'metadataSha256': ('build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat', '9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'),
}
files={k:{'path':p,'sha256':sha((root/p).read_bytes())} for k,(p,_) in pins.items()}
for key,(_,expected) in pins.items(): assert files[key]['sha256']==expected, key
symbols=json.loads((root/pins['symbolsSha256'][0]).read_text()); addresses=sorted({m['Address'] for m in symbols['ScriptMethod']})
pe=PEImage((root/pins['nativeSha256'][0]).read_bytes()); cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64); cs.detail=True
methods=[];codes={}
cached=[('open-trigger',0x9f2c60,'Last.Map.PropertyEvent$$ConvertPropertyToData'),
 ('npc-dispatch',0x7b55f0,'Last.Map.EventActionScript.<EventRunScript>d__14$$MoveNext'),
 ('npc-actions',0x7ad3f0,'Last.Map.EventActionScript$$End'),
 ('npc-dispatch',0x7ad6c0,'Last.Map.EventActionScript$$RunScript')]
for batch,rva,name in cached:
 receipt=json.loads((root/f'build/native/{batch}/complete.json').read_text())
 assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
 for key in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[key]==files[key]['sha256']
 method=next(m for m in receipt['methods'] if int(m['rva'],0)==rva)
 text=(root/f'build/native/{batch}/{rva:x}.c').read_bytes();assert sha(text)==method['decompiledSha256']
 codes[rva]=text.decode()
for rva,name in [(x[1],x[2]) for x in cached]+[
 (0x394bd0,'FieldMap$$UpdateGimmick'),(0x394aa0,'FieldMap$$UpdateEvent'),
 (0x391110,'FieldMap$$IsPlayable'),(0x711830,'Last.Management.SubSceneManagerMainGame$$IsPlayable'),
 (0x878960,'Last.Entity.Field.EventTriggerEntity$$OnTriggerEnterCustom'),
 (0x9f2690,'Last.Map.PropertyEntity$$CheckIfNeedTargetTransportation'),
 (0x9f26a0,'Last.Map.PropertyEntity$$CheckTargetTransportationIds')]:
 aliases=[m for m in symbols['ScriptMethod'] if m['Address']==rva];assert any(m['Name']==name for m in aliases),(hex(rva),name)
 end=next(a for a in addresses if a>rva);section,offset,data=pe.read(rva,end-rva)
 instr=[]
 for i in cs.disasm(data,rva):
  instr.append({'rva':hex(i.address),'mnemonic':i.mnemonic,'operands':i.op_str,
   'targets':[hex(op.imm) for op in i.operands if op.type==capstone.x86.X86_OP_IMM]})
 row={'rva':hex(rva),'size':len(data),'name':name,'aliases':aliases,'sha256':sha(data),'bytes':data.hex(),'instructions':instr}
 if rva in codes:
  batch=next(x[0] for x in cached if x[1]==rva);receipt=json.loads((root/f'build/native/{batch}/complete.json').read_text())
  method=next(m for m in receipt['methods'] if int(m['rva'],0)==rva)
  assert row['sha256']==method['nativeRangeSha256'];row['cachedC']={'path':f'build/native/{batch}/{rva:x}.c','sha256':method['decompiledSha256']}
 methods.append(row)
def calls(rva):
 return [(i['mnemonic'],i['operands']) for i in next(m for m in methods if int(m['rva'],0)==rva)['instructions'] if i['mnemonic'] in ['call','jmp']]
assert calls(0x394bd0)==calls(0x394aa0), 'Gimmick/Event FieldMap consumers differ'
assert '_Gimmick_k__BackingField = (property->fields)._gimmick_k__BackingField' in codes[0x9f2c60]
assert re.search(r'isGimmick = .*_Gimmick_k__BackingField',codes[0x7b55f0])
assert '0xc - (uint)(bVar3 != false)' in codes[0x7b55f0]
assert re.search(r'case 0:[\s\S]*endChangeState[\s\S]*pLVar2,3',codes[0x7ad3f0])
metadata=(root/pins['metadataSha256'][0]).read_bytes();blob=metadata[0x4df538:0x4df538+68]
assert hashlib.sha1(blob).hexdigest()=='bf3cd46b7965b900ce188af1bda4f3a57adb0646'
states=[int.from_bytes(blob[i:i+4],'little',signed=True) for i in range(0,68,4)]
assert states[11]==states[12]==3
dump=(root/'build/native/il2cpp/dump.cs').read_text();assert 'State Gimmick = 11;' in dump and 'State Event = 12;' in dump
report={'kind':'source-field-event-activation-native-audit-v1','result':'passed','files':files,'methods':methods,
 'counts':{'methods':len(methods),'nativeBytes':sum(m['size'] for m in methods),'freshExports':0},
 'stateEntityAttribute':{'metadataOffset':'0x4df538','sha1':hashlib.sha1(blob).hexdigest(),'values':states},
 'established':['PropertyEvent preserves the boolean Gimmick flag separately from script/action identity.',
  'RunScript selects scene11 for gimmick and scene12 otherwise after accepted script registration.',
  'The complete FieldMap UpdateGimmick and UpdateEvent methods have the identical call/jump consumer sequence.',
  'Both scene11 and scene12 select entity mask3; ordinary completed Exit returns to player scene3.',
  'Transportation list getters are recorded but their contact observers are not admitted by this increment.'],
 'notEstablished':['Original dynamic parity or native timing','Transport/landing/kind21 activation','Action0 null dispatch','Overlapping trigger ordering','Unknown raw geometry and downstream source programs'],
 'sourceAdmission':'unassessed','originalGameExecuted':False}
out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':'passed','counts':report['counts'],'reportSha256':sha(out.read_bytes())}))
