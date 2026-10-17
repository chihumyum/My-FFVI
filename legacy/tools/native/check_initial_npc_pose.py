"""Recheck existing complete Wait/Chara/animation evidence; never export or run native code."""
import argparse, hashlib, json, sys
from pathlib import Path
import capstone
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);parser.add_argument('--output',type=Path)
a=parser.parse_args();root=a.root.resolve();output=(a.output or root/'build/reports/source-initial-npc-pose-native.json').resolve()
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest()
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={key:(root/path).read_bytes()for key,path in paths.items()};assert{key:sha(b)for key,b in buffers.items()}==expected
symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));byaddr={}
for m in methods:byaddr.setdefault(m['Address'],[]).append(m)
image=PEImage(buffers['nativeSha256']);decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
scopes=[('npc-controllers',0x5781b0,'FieldNonPlayerControllerManager$$FactoryFieldNonPlayerController'),('v78-npc-controller',0x57bcd0,'FieldNonPlayerController$$Init'),
 ('npc-interaction',0xe18240,'FieldNonPlayer$$Setup'),('v33-native-map-hosts',0xe174d0,'FieldNonPlayer$$Init'),
 ('v20-map-party-entry',0x879870,'FieldCharaEntity$$Init'),('npc-controllers',0x57c7d0,'FieldNonPlayerController$$Setup'),
 ('actor-animation',0xb13390,'SetupAnimCommon'),('actor-animation',0xb14010,'SwitchNextAnimation')]
rows=[];locks=[];texts={}
for folder,rva,suffix in scopes:
 directory=root/'build/native'/folder;receiptBytes=(directory/'complete.json').read_bytes();receipt=json.loads(receiptBytes)
 assert receipt['status']=='complete'and receipt['semanticsVerified']is False
 for key in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[key]==expected[key]
 declarations=[m for m in receipt['methods']if int(m['rva'],16)==rva];assert len(declarations)==1
 declaration=declarations[0];end=next(n for n in addresses if n>rva);_,_,raw=image.read(rva,end-rva)
 assert end==int(declaration['nextSymbolRva'],16);assert sha(raw)==declaration['nativeRangeSha256']
 source=directory/(hex(rva)[2:]+'.c');body=source.read_bytes();assert sha(body)==declaration['decompiledSha256'];texts[rva]=body.decode()
 aliases=byaddr[rva];assert any(suffix in m['Name']for m in aliases),(hex(rva),suffix,aliases)
 instructions=[]
 for ins in decoder.disasm(raw,rva):
  row={'rva':hex(ins.address),'bytes':ins.bytes.hex(),'mnemonic':ins.mnemonic,'operands':ins.op_str}
  if ins.mnemonic in ['call','jmp']and len(ins.operands)==1 and ins.operands[0].type==capstone.x86.X86_OP_IMM:
   target=ins.operands[0].imm;row['targetRva']=hex(target);row['targetSymbols']=byaddr.get(target,[])
  instructions.append(row)
 rows.append({'rva':hex(rva),'nextSymbolRva':hex(end),'size':len(raw),'bytes':raw.hex(),'sha256':sha(raw),'aliases':aliases,
  'receipt':str((directory/'complete.json').relative_to(root)),'receiptSha256':sha(receiptBytes),'body':str(source.relative_to(root)),
  'decompiledSha256':sha(body),'instructions':instructions})
 locks.extend([(directory/'complete.json',sha(receiptBytes)),(source,sha(body))])
# These are operation requirements, not a claim that absent native keys succeed.
assert 'FieldNonPlayerWaitController' in texts[0x5781b0]
assert 'FieldNonPlayer__Setup' in texts[0x57bcd0]
assert 'initStartDirection' in texts[0xe18240]and '_28_Init' in texts[0xe18240]
assert 'FieldCharaEntity__Init' in texts[0xe174d0]
assert 'MapUtility__TransformDirection(startDirection' in texts[0x879870]and '_41_LookAt' in texts[0x879870]
assert 'isTurnAround' in texts[0x57c7d0]and '_41_LookAt' in texts[0x57c7d0]
for rva in [0xb13390,0xb14010]:assert 'next_anim_name' in texts[rva]and 'IsNullOrEmpty' in texts[rva]
for key,path in paths.items():assert sha((root/path).read_bytes())==expected[key]
for file,digest in locks:assert sha(file.read_bytes())==digest
report={'kind':'source-initial-npc-pose-native-audit-v1','result':'passed-static-byte-audit','checkerSha256':sha(Path(__file__).read_bytes()),
 'identity':expected,'inputs':{key:{'path':path,'sha256':expected[key],'bytes':len(buffers[key])}for key,path in paths.items()},
 'files':[{'path':str(file.relative_to(root)),'sha256':digest,'bytes':file.stat().st_size}for file,digest in dict(locks).items()],
 'methods':rows,'scope':{'initialization':'Wait factory -> controller Init -> NPC Setup -> NPC Init -> Chara.Init(startDirection) -> LookAt(source direction)',
 'next':'Existing SetupAnimCommon/SwitchNextAnimation use the actual authored next key; no aliases or invented frames',
 'partyContract':'unchanged independent four-direction qualification'},
 'limits':['Static complete existing receipts/PE bytes only; no original executable, renderer or gameplay parity claim.',
 'Other NPC controllers, custom animations, runtime direction changes and missing initial/next keys retain their own gates.'],
 'newNativeExports':0,'semanticsVerified':False,'originalGameExecuted':False}
output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'methods':len(rows),'bytes':sum(r['size']for r in rows),'result':report['result']}))
