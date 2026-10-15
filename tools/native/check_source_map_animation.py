"""Bounded original-PE/symbol/header/metadata audit. Never executes the game."""
import hashlib,json,sys,argparse
from pathlib import Path
import capstone
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);parser.add_argument('--input',type=Path);parser.add_argument('--output',type=Path)
a=parser.parse_args();root=a.root.resolve();out=(a.output or root/'build/reports/source-map-animation-native').resolve();out.mkdir(parents=True,exist_ok=True)
inputs=(a.input or root/'build/native/source-map-animation-inputs').resolve();manifest=json.loads((inputs/'manifest.json').read_text());assert manifest['kind']=='source-map-animation-native-inputs-v1'
for f in manifest['files']:
 assert not Path(f['file']).is_absolute()and '..'not in Path(f['file']).parts
 assert hashlib.sha256((inputs/f['file']).read_bytes()).hexdigest()==f['sha256']
sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={k:(root/v).read_bytes()for k,v in paths.items()};assert {k:hashlib.sha256(b).hexdigest()for k,b in buffers.items()}==expected
symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted(set(x['Address']for x in methods));byaddr={}
for row in methods:byaddr.setdefault(row['Address'],[]).append(row)
image=PEImage(buffers['nativeSha256']);decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
rvas=[0x2f6390,0x9f20f0,0xe12110,0xe12cd0,0xe13090,0xe130a0,0x43de80,0xaeb200,0xaec930,0x305420,0x30c400,0x3820a0,0xb13390,0xb14010]
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
by={r['rva']:r for r in rows}
def exact(method,at,mnemonic,operands):
 row=next(x for x in by[method]['instructions']if x['rva']==at)
 assert(row['mnemonic'],row['operands'])==(mnemonic,operands),(method,at,row)
exact('0x2f6390','0x2f6390','add','rcx, 0x128')
exact('0x2f6390','0x2f6397','mov','qword ptr [rcx], rdx')
exact('0xe12110','0xe12142','mov','rsi, qword ptr [rdi + 0x128]')
exact('0xe12110','0xe12232','cmp','byte ptr [rsi + 0x108], 0')
exact('0xe12110','0xe1225d','call','0xb121f0')
exact('0xe13090','0xe13090','xor','edx, edx')
exact('0xe13090','0xe13092','jmp','0xaec930')
exact('0x43de80','0x43df30','call','0x1098f50')
# RSI holds PropertyDefaultAnimEntity throughout the property reads. Direction
# lives at +0x1c; source Init never loads it, while acceptDirection +0xac does.
assert not any('rsi + 0x1c]'in i['operands']for i in by['0xe12110']['instructions'])
assert any('rsi + 0xac]'in i['operands']for i in by['0xe12110']['instructions'])
loader=(inputs/'1/30c400.c').read_text();assert 'JsonUtility' in loader and 'AnimAssetDatas' in loader
assert any(m['Address']==0x1fc09f8 and 'AnimAssetDatas' in m.get('Name','')for m in symbols['ScriptMetadataMethod'])
for method in ['6/b13390.c','6/b14010.c']:assert 'IsNullOrEmpty' in (inputs/method).read_text() and 'next_anim_name' in (inputs/method).read_text()
assert {int(m['rva'],16)for m in manifest['methods']}==set(rvas)-{0x2f6390}
complete=[]
for declaration in manifest['methods']:
 folder=inputs/Path(declaration['receipt']).parent;targets=[int(declaration['rva'],16)]
 receipt=json.loads((folder/'complete.json').read_text());assert receipt['status']=='complete'and receipt['semanticsVerified']is False
 for key,value in expected.items():
  if key!='metadataSha256':assert receipt[key]==value
 for rva in targets:
  item=next(row for row in receipt['methods']if row['rva']==hex(rva));filename=hex(rva)[2:]+'.c'
  assert hashlib.sha256((folder/filename).read_bytes()).hexdigest()==item['decompiledSha256']
  assert by[hex(rva)]['rangeSha256']==item['nativeRangeSha256']
  complete.append({'receipt':str((folder/'complete.json').relative_to(inputs)),'body':str((folder/filename).relative_to(inputs)),**item})
for key,path in paths.items():assert hashlib.sha256((root/path).read_bytes()).hexdigest()==expected[key]
for f in manifest['files']:assert hashlib.sha256((inputs/f['file']).read_bytes()).hexdigest()==f['sha256']
report={'checkerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'inputManifestSha256':hashlib.sha256((inputs/'manifest.json').read_bytes()).hexdigest(),'kind':'source-map-animated-entity-static-bytes-v1','result':'passed-static-audit','identity':expected,'methods':rows,
 'completeMethods':complete,'semanticsVerified':False,'originalGameExecuted':False,
 'scope':['PropertyDefaultAnimEntity import','FieldMapObjectAnimDefault Init/Default playback/update','Mapobject asset/name domain','kind10 factory creation','native AnimAssetDatas loader/string defaults and no-successor consumption'],
 'unknown':['native building/stencil/split presentation','kind6 direction7','native stopped initial sprite frame'],
 'webPolicy':'web-field-animated-map-entities-v1','animationImport':{'fixedLoader':'MapManager.GetSpriteAnimStructure -> TextAsset.text -> JsonUtility.FromJson<AnimAssetDatas>','metadataMethodAddress':'0x1fc09f8','field':{'class':'AnimAssetData','name':'next_anim_name','type':'System.String','offset':'0x30'},'officialAPI':'https://docs.unity3d.com/2019.4/Documentation/ScriptReference/JsonUtility.FromJson.html','rule':'Missing field default(T), constructor/field initializers not run; missing string null; existing consumer treats null as no-successor.','scope':'Only raw physical source binding; no world-state defaulting'}}
(out/'native-scope.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'methods':len(rows),'completeMethods':len(complete),'bytes':sum(r['size']for r in rows),'semanticsVerified':False}))
