"""Bounded source PE audit; no execution or native export."""
import hashlib, json, sys, argparse
from pathlib import Path
import capstone
parser=argparse.ArgumentParser();parser.add_argument('--root',default='.');parser.add_argument('--output',default='build/reports/field-content-invalidations-native');args=parser.parse_args()
root=Path(args.root).resolve();out=(root/args.output).resolve();assert out.is_relative_to(root/'build')
out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat','dumpSha256':'build/native/il2cpp/dump.cs'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={k:(root/p).read_bytes() for k,p in paths.items()}
identity={k:hashlib.sha256(b).hexdigest() for k,b in buffers.items()}
for k,v in expected.items(): assert identity[k]==v,(k,identity[k])
symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));by={}
for m in methods:by.setdefault(m['Address'],[]).append(m)
refs={}
for kind in ['ScriptString','ScriptMetadata','ScriptMetadataMethod']:
 for r in symbols[kind]:refs.setdefault(r['Address'],[]).append({'kind':kind,**r})
pe=PEImage(buffers['nativeSha256']);cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);cs.detail=True
rvas=[0x2c9a30,0x2dfc10,0x9e3d50,0x7b7b60,0x9e4980,0x4a4a40,0x4a4a80,0x9e4d90,0x2efeb0,0x2e39a0,0x9e4660,0x9e4ab0,0x82e0f0]
rows=[]
for start in rvas:
 end=next(a for a in addresses if a>start);section,offset,raw=pe.read(start,end-start)
 instructions=[];listing=[]
 for i in cs.disasm(raw,start):
  row={'rva':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}
  if i.mnemonic in ['call','jmp'] and len(i.operands)==1 and i.operands[0].type==capstone.x86.X86_OP_IMM:
   target=i.operands[0].imm;row.update(targetRva=hex(target),targetSymbols=by.get(target,[]))
  references=[]
  for op in i.operands:
   if op.type==capstone.x86.X86_OP_MEM and op.mem.base==capstone.x86.X86_REG_RIP:
    addr=i.address+i.size+op.mem.disp;references.append({'rva':hex(addr),'references':refs.get(addr,[])})
  if references:row['references']=references
  instructions.append(row)
  s=f'{i.address:08x} {i.mnemonic:<8} {i.op_str}'
  if row.get('targetSymbols'):s+=' ; '+ ' | '.join(r['Name']for r in row['targetSymbols'])
  for reference in references:
   for ref in reference['references']:s+=' ; '+str(ref.get('Name',ref.get('Value')))
  listing.append(s)
 (out/(hex(start)[2:]+'.asm')).write_text('\n'.join(listing)+'\n')
 rows.append({'rva':hex(start),'end':hex(end),'size':len(raw),'fileOffset':offset,'section':section,'sha256':hashlib.sha256(raw).hexdigest(),'symbols':by[start],'hex':raw.hex(),'instructions':instructions})
header=buffers['headerSha256'].decode();structs={}
for name in ['Last_Map_ContentInvalidController_Fields','Last_Map_FieldController_Fields','Last_Data_Master_GameConstantInt_Fields','Last_Data_Master_MasterBase_Fields']:
 marker=name+' {';start=header.index(marker);end=header.index('\n};',start)+3;structs[name]=header[start:end]
dump=buffers['dumpSha256'].decode();types={}
for marker in ['public enum MapConstants.InvalidContentMovingType //','public enum MapConstants.MovingContentType //','public static class External.Telepo //','public class ContentInvalidController //','public interface IMapAccessor // TypeDefIndex: 6758']:
 start=dump.index(marker);end=dump.index('\n}\n',start)+3;types[marker]=dump[start:end]
for k,p in paths.items():assert hashlib.sha256((root/p).read_bytes()).hexdigest()==identity[k]
cached=[]
for folder,selected in [('v21-battle-entry-providers',[0x9e4d90,0x2efeb0]),('map-entry',[0x2e39a0]),('v21-battle-entry-condition',[0x9e4660]),('v21-battle-entry-bridge',[0x9e4ab0])]:
 receiptPath=root/'build/native'/folder/'complete.json';receipt=json.loads(receiptPath.read_bytes());assert receipt['status']=='complete'
 for k in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[k]==identity[k]
 for rva in selected:
  match=[m for m in receipt['methods']if m['rva']==hex(rva)];assert len(match)==1;method=match[0]
  current=next(m for m in rows if m['rva']==hex(rva));assert current['sha256']==method['nativeRangeSha256']and current['end']==method['nextSymbolRva']
  cPath=receiptPath.parent/(hex(rva)[2:]+'.c');rawC=cPath.read_bytes();assert hashlib.sha256(rawC).hexdigest()==method['decompiledSha256']
  (out/cPath.name).write_bytes(rawC)
  cached.append({'c':str(cPath.relative_to(root)),'receipt':str(receiptPath.relative_to(root)),'receiptSha256':hashlib.sha256(receiptPath.read_bytes()).hexdigest(),**method})
byRva={row['rva']:row for row in rows}
def exact(rva,at,mnemonic,operands):
 i=next(i for i in byRva[rva]['instructions']if i['rva']==at);assert(i['mnemonic'],i['operands'])==(mnemonic,operands)
exact('0x2c9a30','0x2c9a7b','mov','eax, dword ptr [rax + 0x20]')
exact('0x2c9a30','0x2c9a85','neg','eax')
exact('0x2c9a30','0x2c9a87','sbb','ebx, ebx')
exact('0x2c9a30','0x2c9a89','and','ebx, 2')
exact('0x2c9a30','0x2c9aca','mov','ecx, 0x60')
assert 'Slot: 96\n\tpublic abstract void AddMovingContentsInInvalidList(int invalidType)'in types['public interface IMapAccessor // TypeDefIndex: 6758']
exact('0x2dfc10','0x2dfc14','mov','rcx, qword ptr [rcx + 0x1b0]')
exact('0x2dfc10','0x2dfc27','jmp','0x9e3d50')
exact('0x9e3d50','0x9e3f11','cmp','ebx, 2')
exact('0x9e3d50','0x9e3fc0','lea','r8, [rsi + 0x30]')
exact('0x9e3d50','0x9e4083','lea','r8, [rsi + 0x38]')
exact('0x7b7b60','0x7b7b71','call','0x4a4a80')
exact('0x7b7b60','0x7b7b78','sete','al')
assert any(m['Name']=='Last.Data.Master.GameConstantInt$$get_Value1'for m in byRva['0x4a4a40']['symbols'])
assert any(m['Name']=='Last.Data.Master.GameConstantInt$$get_Value2'for m in byRva['0x4a4a80']['symbols'])
assert any(i.get('targetRva')=='0x9e4d90'for i in byRva['0x2e39a0']['instructions'])
contracts={'operandMapping':'signed i0 zero -> InvalidAll0; nonzero -> InvalidTelepo2. Never EnableAll1.',
 'sourceConsumers':'Add to normal and available-sleeping lists only; no delete and no transportation-list mutation.',
 'constantProjection':'Full ordered movingConstantsList; positive Value1 only; Contains before Add; InvalidTelepo uses actual GameConstantInt.Value2==0.',
 'queryOwner':'SetupCurrentInvalidContent selects one existing list and assigns it as UserData.CurrentlyInvalidContentIds.',
 'mapBoundary':'MapInitialize calls UpdateInvalidTarget; that consumer clears/rebuilds the three lists.',
 'cacheAndCast':'Separate native state and consumers, not admitted by this permission contract.',
 'save':'Native permission serialization is not established. New Web Field save records exact executed bindings without replaying Init; the immutable map remains unchanged.'}
report={'kind':'source-field-escape-permissions-native-audit-v1','result':'passed-byte-identity','identity':identity,'inputs':paths,'rawMethods':rows,'headerStructs':structs,'metadataTypes':types,'nativeExecuted':False,'newExports':0,'cachedCompleteMethods':cached,'sourceContracts':contracts,'semanticsScope':'static-consumer-contract-not-original-execution'}
(out/'native-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'methods':len(rows),'bytes':sum(r['size']for r in rows),'sha256':hashlib.sha256((out/'native-audit.json').read_bytes()).hexdigest()}))
