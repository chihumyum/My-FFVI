from pathlib import Path
import json,hashlib,struct,re,bisect,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
import argparse
p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--input',default='build/native/source-mob-controls-inputs');p.add_argument('--output',default='build/reports/source-mob-native');args=p.parse_args();root=Path(args.root).resolve();out=(root/args.output).resolve();out.mkdir(parents=True,exist_ok=True);inputs=(root/args.input).resolve();sha=lambda b:hashlib.sha256(b).hexdigest()
paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h','metadata':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat','dump':'build/native/il2cpp/dump.cs'};raws={k:(root/p).read_bytes()for k,p in paths.items()}
assert sha(raws['native'])=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
assert sha(raws['symbols'])=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'
assert sha(raws['header'])=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
assert sha(raws['metadata'])=='9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'
symbols=json.loads(raws['symbols']);methods=symbols['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));pe=PEImage(raws['native']);d=Cs(CS_ARCH_X86,CS_MODE_64)
def assembly(rva,size):return[{'rva':hex(i.address),'bytes':i.bytes.hex(),'instruction':i.mnemonic+' '+i.op_str}for i in d.disasm(pe.read(rva,size)[2],rva)]
verified=[]
for folder,expected in [(inputs/'wrappers',{0xb48300,0xb48b60}),(inputs/'color',{0xe0faa0,0xe0ffc0,0xaec210,0xaec900,0x87a6a0,0x87aeb0}),(inputs/'update',{0xaec930}),(inputs/'constructor',{0xe103a0}),(inputs/'base-update',{0xe10020})]:
 rb=(folder/'complete.json').read_bytes();receipt=json.loads(rb);assert receipt['status']=='complete';assert receipt['nativeSha256']==sha(raws['native']) and receipt['symbolsSha256']==sha(raws['symbols'])and receipt['headerSha256']==sha(raws['header'])
 assert expected.issubset({int(m['rva'],16)for m in receipt['methods']})
 for item in receipt['methods']:
  if int(item['rva'],16) not in expected: continue
  rva=int(item['rva'],16);end=addresses[bisect.bisect(addresses,rva)];blob=pe.read(rva,end-rva)[2];cb=(folder/f'{rva:x}.c').read_bytes();assert item['nextSymbolRva']==hex(end)and item['nativeRangeSha256']==sha(blob)and item['decompiledSha256']==sha(cb)
  named=[m for m in methods if m['Address']==rva];assert len(named)==1
  verified.append({'receipt':str(folder/'complete.json'),'receiptSha256':sha(rb),'rva':hex(rva),'identity':named[0],'bytes':len(blob),'rangeSha256':sha(blob),'cSha256':sha(cb),'cBytes':len(cb)})
update=(inputs/'update/aec930.c').read_text();assert 'isColorFade == false' in update and '_46_UpdateColorRenderer' in update and '_44_UpdateFadeRenderer' in update
assert 'SetColorFade' not in (inputs/'base-update/e10020.c').read_text()
# Slot45 is distinct from Show22/Hide23. Windows x64 bool argument2 lives dl,
# float argument3 lives xmm2, and each virtual slot occupies16 bytes.
header=raws['header'].decode();start=header.index('struct Last_Entity_Field_FieldEntity_VTable {');end=header.index('\n};',start)+3;vtable=header[start:end];assert 'VirtualInvokeData _45_SetColorFade;'in vtable
hide=assembly(0xb48300,0x7c0);restore=assembly(0xb48b60,0x190)
assert any(i['rva']=='0xb4894e'and i['instruction']=='mov dl, 1'for i in hide)
assert any(i['rva']=='0xb48950'and i['instruction']=='call qword ptr [rax + 0x400]'for i in hide)
assert any(i['rva']=='0xb48c6a'and i['instruction']=='xor edx, edx'for i in restore)
assert any(i['rva']=='0xb48c6c'and i['instruction']=='call qword ptr [rax + 0x400]'for i in restore)
assert 0x130+45*16==0x400
name='7376166856956D01E290C1A839AD1F530195B01E';addr=0x1fcd1b8;offset=0x4def0a;blob=raws['metadata'][offset:offset+12]
assert next(r for r in symbols['ScriptMetadata']if r['Address']==addr)['Name']=='Field$<PrivateImplementationDetails>.'+name
assert re.search(name+r' /\*Metadata offset 0x4DEF0A\*/',raws['dump'].decode())
assert hashlib.sha1(blob).hexdigest().upper()==name and list(struct.unpack('<3i',blob))==[900,901,902]
ctor=assembly(0xb49150,160);assert any(i['rva']=='0xb491af'and i['instruction']=='mov edx, 3'for i in ctor);assert any(i['instruction']=='call 0xe5f1d0'for i in ctor)
p={'kind':'source-mob-native-static-contract-v2','result':'passed-static-not-native-execution','inputs':{k:{'path':paths[k],'sha256':sha(v),'bytes':len(v)}for k,v in raws.items()},'methods':verified,'methodCount':len(verified),'nativeBytes':sum(v['bytes']for v in verified),'wrapperAssembly':{'hide':hide,'restore':restore},'fieldEntityVTable':vtable,'staticInitializer':{'rva':'0xb49150','bytes':160,'sha256':sha(pe.read(0xb49150,160)[2]),'assembly':ctor,'defaultExclusions':{'field':name,'referenceRva':hex(addr),'metadataOffset':hex(offset),'bytes':blob.hex(),'values':[900,901,902],'sha256':sha(blob)}},'criticalContract':'SetColorFade(bool,float) slot45, not Show/Hide or activeSelf. Preserve exact chosen source entities and retained hidden-list membership.','nativeExecuted':False,'nativeDynamicParity':False}
(out/'native-verification.json').write_text(json.dumps(p,indent=2)+'\n');print(json.dumps({'methods':p['methodCount'],'nativeBytes':p['nativeBytes'],'sha256':sha((out/'native-verification.json').read_bytes())}))
