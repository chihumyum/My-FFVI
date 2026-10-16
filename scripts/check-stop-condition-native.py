from pathlib import Path
import json,sys,hashlib,capstone,argparse,re
parser=argparse.ArgumentParser(description='Bounded Stop condition static native evidence; never executes the DLL.');parser.add_argument('--root',type=Path,default=Path.cwd());parser.add_argument('--evidence',type=Path,required=True);parser.add_argument('--output',type=Path,default=Path('build/reports/stop-condition-native.json'));args=parser.parse_args();root=args.root.resolve();out=(root/args.evidence).resolve();output=(root/args.output).resolve();assert output.is_relative_to(root/'build');sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest()
paths={'nativeSha256':root/'build/runtime/game/GameAssembly.dll','symbolsSha256':root/'build/native/il2cpp/script.json','headerSha256':root/'build/native/il2cpp/il2cpp_ghidra.h'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
buffers={k:p.read_bytes()for k,p in paths.items()};assert{k:sha(v)for k,v in buffers.items()}==expected
s=json.loads(buffers['symbolsSha256']);methods=s['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));pe=PEImage(buffers['nativeSha256']);md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
batches={out/'native-stop-owner':[0x51f620,0x51f760,0x51f890],root/'build/native/condition-lifecycle':[0x33d8a0],root/'build/native/condition-silence':[0x45b450,0x45c5b0,0x455de0],root/'build/native/source-condition-effects-v1/native-support':[0x764830],root/'build/native/source-condition-effects-v1/native-consumers':[0x767900],root/'build/native/v17-poison-cycle':[0x76de60],root/'build/native/v17-poison-behavior':[0x45c430,0x92d200],root/'build/native/v17-battle-timing':[0x45a4d0],root/'build/native/ai-dispatch':[0x15ac950]}
raw=[0x768ce0,0x679430,0x761000,0x7086c0,0x76bab0,0x678120,0x51f080,0x51f260,0x51f440,0x5272d0,0x527350,0x5273d0,0x527450,0x5274d0,0x527550,0x771a50,0x2c8ef0];rows=[]
for start in sorted(set(raw+[r for rr in batches.values()for r in rr])):
 end=next(a for a in addresses if a>start);section,offset,data=pe.read(start,end-start);ins=[]
 for i in md.disasm(data,start):
  item={'rva':hex(i.address),'mnemonic':i.mnemonic,'operands':i.op_str,'bytes':i.bytes.hex()}
  refs=[]
  for op in i.operands:
   if op.type==capstone.x86.X86_OP_MEM and op.mem.base==capstone.x86.X86_REG_RIP:
    address=i.address+i.size+op.mem.disp
    refs.append({'rva':hex(address),'metadata':[x for x in s['ScriptMetadata']+s['ScriptMetadataMethod']if x['Address']==address]})
  if refs:item['references']=refs
  ins.append(item)
 rows.append({'rva':hex(start),'nextSymbolRva':hex(end),'size':len(data),'section':section,'fileOffset':offset,'sha256':sha(data),'symbols':[m for m in methods if m['Address']==start],'instructions':ins})
by={x['rva']:x for x in rows};records=[]
for folder,rr in batches.items():
 receipt=json.loads((folder/'complete.json').read_text());assert receipt['status']=='complete'and receipt['semanticsVerified']==False
 for k,v in expected.items():assert receipt[k]==v
 if folder==out/'native-stop-owner':assert set(m['rva']for m in receipt['methods'])==set(map(hex,rr))
 for r in rr:
  record=next(m for m in receipt['methods']if m['rva']==hex(r));row=by[hex(r)];c=(folder/(hex(r)[2:]+'.c')).read_bytes()
  assert row['nextSymbolRva']==record['nextSymbolRva']and row['sha256']==record['nativeRangeSha256']and sha(c)==record['decompiledSha256']
  records.append({'batch':str(folder.relative_to(root)),**record,'receiptSha256':sha((folder/'complete.json').read_bytes())})

def has(rva,mnemonic,operands):
 assert any(i['mnemonic']==mnemonic and i['operands']==operands for i in by[rva]['instructions']),(rva,mnemonic,operands)
for r in ['0x51f890','0x51f620']:has(r,'jmp','0x51f760');has(r,'call','0x761000')
has('0x51f890','call','0x76bab0');has('0x51f620','call','0x678120')
has('0x7086c0','cmp','dword ptr [rcx + 0x10], 0');has('0x7086c0','setle','al')
has('0x761000','lea','edx, [rdi - 1]');has('0x761000','lea','eax, [rdi + 1]');has('0x761000','call','0xffb570')
for r in ['0x51f080','0x51f260','0x51f440']:
 has(r,'mov','rax, qword ptr [rbx + 0x10]');has(r,'mov','rcx, qword ptr [rax + 0x30]');has(r,'mov','rsi, qword ptr [rcx + 0x28]')
for r in ['0x51f080','0x51f260','0x51f440']:has('0x51f760','call',r)
for offset in ['0x118','0xb8','0xd1']:assert any(i['mnemonic']=='mov'and offset in i['operands']for i in by['0x51f760']['instructions'])
has('0x767900','mulss','xmm6, dword ptr [rax + 0x14]')
for operands in ['dword ptr [rcx + 0x10], 0xbdcccccd','dword ptr [rcx + 0x14], 0x3dcccccd']:has('0x76de60','mov',operands)
has('0x764830','xorps','xmm7, xmm7');has('0x764830','xorps','xmm6, xmm6');has('0x764830','addss','xmm6, dword ptr [rax + 0x14]');has('0x764830','addss','xmm7, dword ptr [rax + 0x10]');has('0x764830','addss','xmm6, xmm7');has('0x764830','mulss','xmm8, xmm6')
assert by['0x2c8ef0']['instructions'][0]['mnemonic']=='ret'
report={'kind':'stop-condition-bounded-static-native-evidence-v2','identity':expected,'methods':rows,'completeCMethods':records,'freshCompleteMethods':3,'freshNativeBytes':sum(by[hex(r)]['size']for r in batches[out/'native-stop-owner']),'originalGameExecuted':False,'semanticsVerified':False,'limits':['Static C and full PE identity verification only; no native runtime parity.','No general Calc/Hit exports; no additional Unity controller exports.','Raw consumer helpers retain every alias and do not grant unknown condition behavior.']}
for k,p in paths.items():assert sha(p.read_bytes())==expected[k]
output.parent.mkdir(parents=True,exist_ok=True);b=json.dumps(report,indent=2)+'\n';output.write_text(b)
print(json.dumps({'CMethods':len(records),'freshCompleteMethods':3,'freshNativeBytes':report['freshNativeBytes'],'allRawMethods':len(rows),'allRawBytes':sum(x['size']for x in rows),'sha256':sha(b.encode())}))
