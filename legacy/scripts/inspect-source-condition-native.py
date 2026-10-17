"""Bounded complete raw-byte / metadata audit. No source executable is run."""
from pathlib import Path
import sys,json,hashlib,struct,re,argparse
import capstone
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=Path.cwd());parser.add_argument('--evidence',type=Path,default=Path('build/native/source-condition-effects-v1'));parser.add_argument('--output',type=Path,default=Path('build/reports/source-condition-native.json'));args=parser.parse_args()
root=args.root.resolve();out=(root/args.evidence).resolve();output=(root/args.output).resolve()
if not output.is_relative_to(root/'build'):raise ValueError('Source-derived report must stay in ignored build/')
output.parent.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
sha=lambda b:hashlib.sha256(b).hexdigest();buffers={k:(root/path).read_bytes()for k,path in paths.items()};assert{k:sha(v)for k,v in buffers.items()}==expected
symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));byaddr={}
for row in methods:byaddr.setdefault(row['Address'],[]).append(row)
request=json.loads((out/'native-request.json').read_text());rvas=[int(r['rva'],16)for r in request['methods']]
cached={0x45c5b0:'condition-silence',0x45c430:'v17-poison-behavior',0x4f1d70:'condition-actions',0x4f2630:'condition-actions',0x4ac5f0:'condition-eligibility',0x3d5e50:'condition-eligibility',0x8597b0:'parameter-specials',0x4afb70:'enemy-parameters',0x536dd0:'initial-party',0x537ca0:'initial-party',0x4ac740:'v18-owned-character-command-filter',0x4cf360:'v20-battle-abilities-release',0x383fc0:'v21-battle-entry-providers',0x4f8890:'revival-dispatch',0x67b590:'v17-battle-timing',0x67a8e0:'v17-battle-clock-selectors'}
rvas.extend(cached)
supportRequest=json.loads((out/'native-support-request.json').read_text());rvas.extend(int(row['rva'],16)for row in supportRequest['methods'])
consumerRequest=json.loads((out/'native-consumer-request.json').read_text());rvas.extend(int(row['rva'],16)for row in consumerRequest['methods'])
rvas.extend([0x3d3ea0,0x4f7720,0x4b4d10,0x4ac6c0,0x45ad50,0x45ad40,0x536b70,0x768ce0,0x15791d0,0x33ad80,0x687260,0x7086c0,0x761000])
for key in ['get_UntilType','get_UntilValue','get_ConditionType']:
 found=[m for m in methods if m['Name']=='Last.Data.Master.Condition$$'+key];assert len(found)==1; rvas.append(found[0]['Address'])
metadataByAddress={};stringByAddress={}
for item in symbols['ScriptMetadata']+symbols['ScriptMetadataMethod']:metadataByAddress.setdefault(item['Address'],[]).append(item)
for item in symbols['ScriptString']:stringByAddress.setdefault(item['Address'],[]).append(item)
image=PEImage(buffers['nativeSha256']);decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True;rows=[]
for start in sorted(set(rvas)):
 end=next(a for a in addresses if a>start);_,_,raw=image.read(start,end-start);instructions=[]
 for ins in decoder.disasm(raw,start):
  row={'rva':hex(ins.address),'bytes':ins.bytes.hex(),'mnemonic':ins.mnemonic,'operands':ins.op_str}
  if ins.mnemonic in ['call','jmp']and len(ins.operands)==1 and ins.operands[0].type==capstone.x86.X86_OP_IMM:
   target=ins.operands[0].imm;row.update(targetRva=hex(target),targetSymbols=byaddr.get(target,[]))
  refs=[]
  for op in ins.operands:
   if op.type==capstone.x86.X86_OP_MEM and op.mem.base==capstone.x86.X86_REG_RIP:
    address=ins.address+ins.size+op.mem.disp;refs.append({'rva':hex(address),'strings':stringByAddress.get(address,[]),
     'metadata':metadataByAddress.get(address,[])})
  if refs:row['references']=refs
  instructions.append(row)
 rows.append({'rva':hex(start),'nextSymbolRva':hex(end),'size':len(raw),'rangeSha256':sha(raw),'symbols':byaddr.get(start,[]),'instructions':instructions})
by={row['rva']:row for row in rows};receipt=json.loads((out/'native/complete.json').read_text());assert receipt['status']=='complete'
assert set(r['rva']for r in receipt['methods'])==set(request['decompileSelection'])
for key in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[key]==expected[key]
for item in receipt['methods']:
 row=by[item['rva']];assert row['rangeSha256']==item['nativeRangeSha256']and row['nextSymbolRva']==item['nextSymbolRva'];assert sha((out/'native'/(item['rva'][2:]+'.c')).read_bytes())==item['decompiledSha256']
supportReceipt=json.loads((out/'native-support/complete.json').read_text());assert supportReceipt['status']=='complete'
assert set(row['rva']for row in supportReceipt['methods'])==set(row['rva']for row in supportRequest['methods'])
for key in ['nativeSha256','symbolsSha256','headerSha256']:assert supportReceipt[key]==expected[key]
for item in supportReceipt['methods']:
 row=by[item['rva']];assert row['rangeSha256']==item['nativeRangeSha256']and row['nextSymbolRva']==item['nextSymbolRva'];assert sha((out/'native-support'/(item['rva'][2:]+'.c')).read_bytes())==item['decompiledSha256']
consumerReceipt=json.loads((out/'native-consumers/complete.json').read_text());assert consumerReceipt['status']=='complete'
assert set(row['rva']for row in consumerReceipt['methods'])==set(row['rva']for row in consumerRequest['methods'])
for key in ['nativeSha256','symbolsSha256','headerSha256']:assert consumerReceipt[key]==expected[key]
for item in consumerReceipt['methods']:
 row=by[item['rva']];assert row['rangeSha256']==item['nativeRangeSha256']and row['nextSymbolRva']==item['nextSymbolRva'];assert sha((out/'native-consumers'/(item['rva'][2:]+'.c')).read_bytes())==item['decompiledSha256']
cachedRecords=[]
for start,folder in cached.items():
 cachedReceipt=json.loads((root/'build/native'/folder/'complete.json').read_text());assert cachedReceipt['status']=='complete'
 for key in ['nativeSha256','symbolsSha256','headerSha256']:assert cachedReceipt[key]==expected[key]
 item=next(m for m in cachedReceipt['methods']if m['rva']==hex(start));assert by[hex(start)]['rangeSha256']==item['nativeRangeSha256'];assert by[hex(start)]['nextSymbolRva']==item['nextSymbolRva']
 assert sha((root/'build/native'/folder/(hex(start)[2:]+'.c')).read_bytes())==item['decompiledSha256'];cachedRecords.append({'folder':folder,**item})
header=buffers['headerSha256'].decode();structs={}
for name in ['Last_Data_Master_Condition_Fields','Last_Battle_BattleConditionFunction_Fields','Last_Battle_SleepConditionFunction_Fields','Last_Battle_FF6ConfusionConditionFunction_Fields','Last_Battle_TemptationConditionFunction_Fields','Last_Battle_DoomConditionFunction_Fields','Last_Battle_Function_AddConditionFunction_Fields','Last_Data_PlayerCharacterParameter_Fields','Last_Data_CharacterParameterBase_Fields','Last_Battle_FF6ActSelectConfusion_StaticFields','Serial_FF6_Management_ParameterProvider_StaticFields']:
 marker=name+' {';start=header.index(marker);end=header.index('\n};',start)+3;structs[name]=header[start:end]
dump=(root/'build/native/il2cpp/dump.cs').read_bytes();text=dump.decode();enums={}
for marker in ['public enum ConditionUntilType //','public enum AbilityRangeType //','public enum ConditionType //']:
 start=text.index(marker);end=text.index('\n}\n',start)+3;enums[marker]=text[start:end]
staticArrays=[]
for fieldName,offset,count,owner in [('B6A9EDAFBE89B7FA33FCBA6C2444F0BB9B7D8B42',0x4df480,3,'0x6af5e0'),('DA450BD6147D4FB1B9C38F945011E0B6F61E5B32',0x4df6ad,18,'0x156bc70')]:
 marker=' '+fieldName+' /*Metadata offset '+hex(offset).upper().replace('X','x')+'*/'
 # Bind dump field offset plus hashed original data; the field name is the SHA1
 # of its complete initialized bytes and the .cctor references its exact symbol.
 matching=[line for line in text.splitlines()if fieldName in line and 'Metadata offset' in line];assert len(matching)==1 and int(re.search(r'Metadata offset (0x[0-9A-Fa-f]+)',matching[0]).group(1),16)==offset
 raw=buffers['metadataSha256'][offset:offset+count*4];assert hashlib.sha1(raw).hexdigest().upper()==fieldName
 symbolsForField=[m for m in symbols['ScriptMetadata']if m['Name']=='Field$<PrivateImplementationDetails>.'+fieldName];assert len(symbolsForField)==1
 assert any(symbolsForField[0]in ref['metadata']for ins in by[owner]['instructions']for ref in ins.get('references',[]))
 staticArrays.append({'field':fieldName,'metadataSymbol':symbolsForField[0],'metadataOffset':hex(offset),'count':count,'bytes':raw.hex(),'sha256':sha(raw),'int32':list(struct.unpack('<'+str(count)+'i',raw)),'dumpDeclaration':matching[0],'cctorRva':owner})
_,_,jump=image.read(0x4f7934,60);magicTargets=list(struct.unpack('<15I',jump));magicIds=[125+i for i,target in enumerate(magicTargets)if target==0x4f78ca]+[261]
assert magicIds==[125,126,128,129,131,133,135,136,137,138,139,261]
magicJump={'rva':'0x4f7934','count':15,'bytes':jump.hex(),'sha256':sha(jump),'targetRvas':[hex(value)for value in magicTargets],'abilityIds':magicIds,'callerRva':'0x4f7720'}
report={'kind':'source-condition-action-native-evidence-v1','identity':expected,'methods':rows,'completeFreshMethods':receipt,'supportCompleteMethods':supportReceipt,'consumerCompleteMethods':consumerReceipt,'staticArrays':staticArrays,'isMagicFF6JumpTable':magicJump,'cachedCompleteMethods':cachedRecords,
 'headerStructs':structs,'enums':enums,'dumpSha256':sha(dump),'sharedSignaturesPreserved':request['sharedMethodsKeptRaw'],
 'originalGameExecuted':False,'semanticsVerified':False,'limitations':['Fresh C text is not source or runtime parity. Exact raw bytes, all shared aliases and complete range receipts are retained.',
 'Lifecycle wrappers alone do not close ActSelect control, Until consumers, status refresh or live unit/caster ownership.']}
for key,path in paths.items():assert sha((root/path).read_bytes())==expected[key]
report['contentHash']=sha(json.dumps(report,sort_keys=True,separators=(',',':')).encode());output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'rawMethods':len(rows),'rawBytes':sum(r['size']for r in rows),'freshComplete':len(receipt['methods'])+len(supportReceipt['methods'])+len(consumerReceipt['methods']),'cachedComplete':len(cachedRecords),'hash':report['contentHash']}))
