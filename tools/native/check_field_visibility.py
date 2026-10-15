"""Bounded original-PE/symbol/header/metadata audit. Never executes the game."""
import hashlib,json,sys,argparse
from pathlib import Path
import capstone
parser=argparse.ArgumentParser();parser.add_argument('--root',default='.');parser.add_argument('--output',default='build/reports/field-visibility-native');args=parser.parse_args();root=Path(args.root).resolve();out=(root/args.output).resolve();out.mkdir(parents=True,exist_ok=True);inputs=root/'build/native/v98-visibility-input'
sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={k:(root/v).read_bytes()for k,v in paths.items()};assert {k:hashlib.sha256(b).hexdigest()for k,b in buffers.items()}==expected
symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted(set(x['Address']for x in methods));byaddr={}
for row in methods:byaddr.setdefault(row['Address'],[]).append(row)
image=PEImage(buffers['nativeSha256']);decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
rvas=[0x833980,0x833930,0x5f16b0,0x5f29c0,0x5f5880,0x5f4e90,0x5f4fd0,0xe0da10,0xe0d920,0xe0d9d0,0xaeca90,0xe0fc60,0xe1ceb0,0x87b180,0xe102e0,0xed2f50,0xed2970,0xed3150,0xe10020,0xaec930,0xb124d0,0x5f3930,0x5f2530,0x5f1df0,0x5f4aa0,0x2c8ef0,0xe0fe40,0xe0dee0,0x2c7f70,0x2c8190,0x2c1060,0x2c5fa0,0x2cabc0,0xb48300,0xb48b60]
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
header=buffers['headerSha256'].decode()
structs={}
for name in ['Last_Interpreter_InstantTimer_Fields','Last_Interpreter_Integrator_Fields','Last_Entity_Field_FieldEntity_Fields','Last_Entity_Field_FieldSpriteEntity_Fields','Last_Entity_Field_FieldCharaEntity_Fields','Last_Entity_Field_FieldRideOnEntity_Fields']:
 start=header.index('struct '+name+' {')if 'struct '+name+' {'in header else header.index(name+' {');end=header.index('\n};',start)+3;structs[name]=header[start:end]
by={row['rva']:row for row in rows}
def exact(method,at,mnemonic,operands):
 row=next(x for x in by[method]['instructions']if x['rva']==at)
 assert row['mnemonic']==mnemonic and row['operands']==operands,(method,at,row)
exact('0x833980','0x8339b2','cvtss2sd','xmm1, xmm0')
exact('0x833980','0x8339bd','movsd','qword ptr [rbx + 0x10], xmm1')
exact('0x833930','0x833947','subsd','xmm1, qword ptr [rbx + 0x10]')
exact('0x833930','0x83394c','comisd','xmm1, xmmword ptr [rbx + 0x18]')
exact('0x833930','0x833951','jae','0x83395b')
exact('0x5f16b0','0x5f171e','xor','edx, edx')
exact('0x5f16b0','0x5f1737','jmp','0x1455f70')
exact('0x5f5880','0x5f59eb','call','0xbc8100')
exact('0x5f5880','0x5f59f0','lea','rcx, [rbp + 0xd0]')
exact('0x5f4fd0','0x5f502c','sub','edi, 1')
exact('0x5f4fd0','0x5f506f','call','0x833930')
exact('0x5f4fd0','0x5f5091','call','0x1457e70')
exact('0x5f4fd0','0x5f509d','jns','0x5f5040')
exact('0x5f4fd0','0x5f509f','cmp','byte ptr [rbx + 0x18], 0')
exact('0xe0da10','0xe0da97','comiss','xmm0, xmm1')
exact('0xe0da10','0xe0da9a','ja','0xe0dac3')
exact('0xe0da10','0xe0daa6','subss','xmm6, dword ptr [rbx + 0xf0]')
exact('0xe0da10','0xe0daae','divss','xmm6, dword ptr [rbx + 0xe8]')
exact('0xe0fc60','0xe0fcec','movss','dword ptr [rsp + 0x2c], xmm6')
exact('0xaec930','0xaeca14','call','0xe0da10')
exact('0xaeca90','0xaecaae','call','0xe0fc60')
exact('0xaeca90','0xaecac6','jmp','0xe102e0')
# Re-validate full decompiler receipts. Their PIC warnings stay visible; the
# constructor timer-list allocation is established by complete raw bytes above.
cached={'v28-puppet-lifecycle':['5f4fd0'],
 'event-script-transition-lifecycle-v40':['5f4e90'],
 'v28-field-visibility-collision':['87b180'],
 'v30-camera-visibility':['e102e0'],
 'v18-field-transport-final':['aec930'],
 'actor-animation':['b124d0'], 'v28-visibility-fade-host':['e0fe40','e0dee0'], 'mob':['b48300','b48b60']}
complete=[]
for batch,items in [*cached.items(),('new-bounded-export',[hex(r)[2:]for r in [0x833980,0x833930,0x5f16b0,0x5f29c0,0x5f5880,0xe0da10,0xe0d920,0xe0d9d0]])]:
 folder=inputs/'timer'if batch=='new-bounded-export'else inputs/batch
 receipt=json.loads((folder/'complete.json').read_text())
 assert receipt['status']=='complete'and receipt['semanticsVerified']is False
 for key,value in expected.items():
  if key!='metadataSha256':assert receipt[key]==value
 for rva in items:
  item=next(row for row in receipt['methods']if row['rva']=='0x'+rva)
  assert hashlib.sha256((folder/(rva+'.c')).read_bytes()).hexdigest()==item['decompiledSha256']
  assert by['0x'+rva]['rangeSha256']==item['nativeRangeSha256']
  assert by['0x'+rva]['nextSymbolRva']==item['nextSymbolRva']
  complete.append({'batch':batch,**item})
for key,path in paths.items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==expected[key]
report={'kind':'visibility-timer-static-bytes-v1','result':'passed-static-audit','identity':expected,'methods':rows,'completeMethods':complete,'headerStructs':structs,'semanticsVerified':False,'originalGameExecuted':False,'sourceFiles':paths,'stableInput':str(inputs.relative_to(root))}
(out/'native-scope.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'methods':len(rows),'completeMethods':len(complete),'bytes':sum(r['size']for r in rows),'semanticsVerified':False}))
