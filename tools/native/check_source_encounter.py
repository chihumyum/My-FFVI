"""Bounded original-PE/symbol/header/metadata audit. Never executes the game."""
import hashlib,json,sys,argparse
from pathlib import Path
import capstone
parser=argparse.ArgumentParser();parser.add_argument('--root',default='.');parser.add_argument('--output',default='build/reports/source-encounter-native');args=parser.parse_args();root=Path(args.root).resolve();out=(root/args.output).resolve();out.mkdir(parents=True,exist_ok=True);inputs=root/'build/native/source-encounter-entry-input'
sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={k:(root/v).read_bytes()for k,v in paths.items()};assert {k:hashlib.sha256(b).hexdigest()for k,b in buffers.items()}==expected
symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted(set(x['Address']for x in methods));byaddr={}
for row in methods:byaddr.setdefault(row['Address'],[]).append(row)
image=PEImage(buffers['nativeSha256']);decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
rvas=[0xb50860,0xb4ebe0,0xb50dd0,0xb555b0,0xb551e0,0xb552d0,0xb552e0,0xb512d0,0xb51b60,0x2ba5f0,0x3750c0,0x2e0990,0x2d9a30,0x2d9950,0x3016c0,0x310bd0]
rows=[]
for start in rvas:
 end=next(a for a in addresses if a>start);_,_,raw=image.read(start,end-start)
 instructions=[]
 for ins in decoder.disasm(raw,start):
  row={'rva':hex(ins.address),'bytes':ins.bytes.hex(),'mnemonic':ins.mnemonic,'operands':ins.op_str}
  if ins.mnemonic in ['call','jmp'] and len(ins.operands)==1 and ins.operands[0].type==capstone.x86.X86_OP_IMM:
   target=ins.operands[0].imm;row['targetRva']=hex(target);row['targetSymbols']=byaddr.get(target,[])
  refs=[]
  for op in ins.operands:
   if op.type==capstone.x86.X86_OP_MEM and op.mem.base==capstone.x86.X86_REG_RIP:
    address=ins.address+ins.size+op.mem.disp
    refs.append({'rva':hex(address),'strings':[r for r in symbols['ScriptString'] if r['Address']==address],
     'metadata':[r for r in symbols['ScriptMetadata']+symbols['ScriptMetadataMethod'] if r['Address']==address]})
  if refs:row['references']=refs
  instructions.append(row)
 rows.append({'rva':hex(start),'nextSymbolRva':hex(end),'symbols':byaddr.get(start,[]),'rangeSha256':hashlib.sha256(raw).hexdigest(),'size':len(raw),'instructions':instructions})

receipt=json.loads((inputs/'entry/complete.json').read_text());assert receipt['status']=='complete'
assert set(m['rva']for m in receipt['methods'])==set(map(hex,[0xb50860,0xb4ebe0,0xb50dd0,0xb555b0]))
by={row['rva']:row for row in rows}
for key in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[key]==expected[key]
for item in receipt['methods']:
 raw=by[item['rva']];assert raw['rangeSha256']==item['nativeRangeSha256'] and raw['nextSymbolRva']==item['nextSymbolRva']
 assert hashlib.sha256((inputs/'entry'/(item['rva'][2:]+'.c')).read_bytes()).hexdigest()==item['decompiledSha256']
cached=json.loads((inputs/'continuation/complete.json').read_text())
for rva in ['0xb512d0','0xb51b60']:
 item=next(m for m in cached['methods']if m['rva']==rva);assert by[rva]['rangeSha256']==item['nativeRangeSha256']
 assert hashlib.sha256((inputs/'continuation'/(rva[2:]+'.c')).read_bytes()).hexdigest()==item['decompiledSha256']
for key,path in paths.items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==expected[key]
report={'kind':'source-encounter-static-evidence-v1','result':'passed-static-byte-audit','identity':expected,'methods':rows,'freshCompleteReceipt':receipt,'cachedCompleteMethods':[m for m in cached['methods']if m['rva']in ['0xb512d0','0xb51b60']],'semanticsVerified':False,'originalGameExecuted':False}
def exact(rva,at,mnemonic,operands):
 instruction=next(i for i in by[rva]['instructions']if i['rva']==at)
 assert (instruction['mnemonic'],instruction['operands'])==(mnemonic,operands)
exact('0xb551e0','0xb55243','cmp','ebx, 4')
exact('0xb551e0','0xb55246','je','0xb5528f')
exact('0xb551e0','0xb5526e','cmp','dword ptr [rcx + rax*4 + 0x20], 0')
exact('0xb552d0','0xb552d0','inc','dword ptr [rcx + 0x18]')
exact('0xb552e0','0xb552e0','cmp','edx, dword ptr [rcx + 0x1c]')
exact('0xb552e0','0xb552e8','mov','dword ptr [rcx + 0x20], edx')
exact('0xb4ebe0','0xb4ecb0','xor','r9d, r9d')
exact('0xb4ebe0','0xb4ecb3','xor','ecx, ecx')
exact('0xb4ebe0','0xb4ece9','mov','ecx, 7')
exact('0x2ba5f0','0x2ba5f2','jmp','0x3750c0')
exact('0x3750c0','0x3750c0','mov','eax, 2')
assert any(any('GetData<MonsterParty>'in md['Name']for md in ref['metadata'])for i in by['0xb4ebe0']['instructions']for ref in i.get('references',[]))
assert any(any(s['Value']=='ZeroEncount'for s in ref['strings'])for i in by['0xb50860']['instructions']for ref in i.get('references',[]))
header=buffers['headerSha256'].decode();structs={}
for name in ['Last_Interpreter_Instructions_External_Misc___c__DisplayClass14_0_Fields','Last_Interpreter_Instructions_External_Misc___c__DisplayClass16_0_Fields','Last_Map_EncountInfo_Fields','Last_Map_FootInformation_Fields','Last_Map_MapAttribute_Fields']:
 start=header.index(name+' {');end=header.index('\n};',start)+3;structs[name]=header[start:end]
dump=(root/'build/native/il2cpp/dump.cs').read_text();interfaces={}
for name,index in [('IEntityAccessor',6760),('IMapAccessor',6758),('IEventAccessor',6731)]:
 marker='public interface '+name+' // TypeDefIndex: '+str(index)
 if marker not in dump:
  if name=='IEventAccessor':start=dump.index('public interface IEventAccessor //')
  else:raise AssertionError(marker)
 else:start=dump.index(marker)
 end=dump.index('\n}\n',start)+3;interfaces[name]=dump[start:end]
assert 'Slot: 0\n\tpublic abstract FieldEntity GetFieldEntity(int entityId)'in interfaces['IEntityAccessor']
assert 'Slot: 7\n\tpublic abstract FieldEntity GetPlayerEntity()'in interfaces['IEntityAccessor']
assert 'Slot: 107\n\tpublic abstract Nullable<FootInformation> GetCurrentFootInformation()'in interfaces['IMapAccessor']
assert 'Slot: 12\n\tpublic abstract void EventEncount(MonsterParty party, bool targetVisibility = True, int battleBgAssetId = 0, int effectId = 0, int colosseumBetItemId = 0)'in interfaces['IEventAccessor']
report.update(headerStructs=structs,sourceInterfaces=interfaces,dumpSha256=hashlib.sha256((root/'build/native/il2cpp/dump.cs').read_bytes()).hexdigest())
report['sourceClockEnums']={}
for marker in ['internal enum Core.Blankings // TypeDefIndex: 7482','public enum Integrator.EndCondition // TypeDefIndex: 7495']:
 start=dump.index(marker);end=dump.index('\n}\n',start)+3;report['sourceClockEnums'][marker]=dump[start:end]
# Publish a receipt only after the additional foot checks below also pass.

# Complete cached source-binding receipts, kept outside tracked code.
footReceipts=[]
for group,rvas in [('foot',['3016c0','2d9950']),('initialization',['310bd0'])]:
 receipt=json.loads((inputs/group/'complete.json').read_text());assert receipt['status']=='complete'
 for key in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[key]==expected[key]
 for rva in rvas:
  item=next(m for m in receipt['methods']if m['rva']=='0x'+rva)
  assert by['0x'+rva]['rangeSha256']==item['nativeRangeSha256'] and by['0x'+rva]['nextSymbolRva']==item['nextSymbolRva']
  assert hashlib.sha256((inputs/group/(rva+'.c')).read_bytes()).hexdigest()==item['decompiledSha256']
  footReceipts.append({'group':group,**item})
exact('0x2e0990','0x2e09c4','mov','rdx, qword ptr [rdi + 0xa0]')
exact('0x2e0990','0x2e09d1','call','0x2d9a30')
exact('0x2e0990','0x2e0a08','cmp','byte ptr [rbx + 0xc], 0')
exact('0x2e0990','0x2e0a0e','mov','edx, dword ptr [rcx + 0x28]')
exact('0x2e0990','0x2e0a11','test','edx, edx')
report.update(stableInput=str(inputs.relative_to(root)),footCachedCompleteMethods=footReceipts,
 consumedProjectionOnly='BG0 for default table regardless of exclusion, or no attribute/no default; full FootInfo unprojected',
 limitations=['Complete method bytes and source-static contracts; original executable was not run.',
 'Unity Random state, full terrain overwrite and source program reachability are not granted.'])
(out/'native-scope.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'rawMethods':len(rows),'rawBytes':sum(row['size']for row in rows),'cachedFootMethods':len(footReceipts)}))
