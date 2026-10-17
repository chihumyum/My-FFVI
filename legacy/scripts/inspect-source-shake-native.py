"""Complete bounded static source camera-shake audit. Never runs the original game."""
from pathlib import Path
import argparse,hashlib,json,struct,re,sys
import capstone
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path.cwd());p.add_argument('--output',type=Path,default=Path('build/reports/source-shake-native.json'));a=p.parse_args();root=a.root.resolve();out=(root/a.output).resolve()
if not out.is_relative_to(root/'build'):raise ValueError('Source evidence must stay in ignored build/')
sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h','metadata':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat','dump':'build/native/il2cpp/dump.cs'}
expected={'native':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbols':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','header':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadata':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
sha=lambda b:hashlib.sha256(b).hexdigest();buffers={key:(root/path).read_bytes()for key,path in paths.items()}
assert all(sha(buffers[key])==value for key,value in expected.items());s=json.loads(buffers['symbols']);methods=s['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));byaddr={};meta={}
for m in methods:byaddr.setdefault(m['Address'],[]).append(m)
for m in s['ScriptMetadata']+s['ScriptMetadataMethod']:meta.setdefault(m['Address'],[]).append(m)
names=['Last.Interpreter.Instructions.External.Misc$$Shake','Last.Interpreter.Instructions.External.Misc$$.cctor',
 'Last.Systems.Camera.Shaker$$Initialize','Last.Systems.Camera.Shaker$$Setup','Last.Systems.Camera.Shaker$$Play','Last.Systems.Camera.Shaker$$Stop','Last.Systems.Camera.Shaker$$SetMagnitude','Last.Systems.Camera.Shaker$$StateInitPlay','Last.Systems.Camera.Shaker$$StateInitStop','Last.Systems.Camera.Shaker$$StateUpdatePlay','Last.Systems.Camera.Shaker$$CorrectionRange','Last.Systems.Camera.Shaker$$Update','Last.Systems.Camera.Shaker$$.cctor','Last.Systems.Camera.Shaker$$.ctor','Last.Systems.Camera.ReExecuteShakerSocket$$ReExecuteInFiled','Last.Systems.Camera.ReExecuteShakerSocket$$SetReExecuteInField','Last.Systems.Camera.ReExecuteShakerSocket$$StopReExecuteInFieled','FieldMap$$MapResumeProcessBeforeFadeIn','FieldMap$$DestroyInstance','Last.Map.FieldController$$SetCameraOffset','Last.Systems.Camera.CameraController$$SetOffsetPosition','Last.Interpreter.Instructions.Format.Operands$$.ctor']
requests=[]
for name in names:
 found=[m for m in methods if m['Name']==name];assert len(found)==1;requests.append((found[0]['Address'],name))
img=PEImage(buffers['native']);d=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);d.detail=True;rows=[]
for start,name in requests:
 end=next(x for x in addresses if x>start);_,_,raw=img.read(start,end-start);instructions=[]
 for ins in d.disasm(raw,start):
  item={'rva':hex(ins.address),'bytes':ins.bytes.hex(),'mnemonic':ins.mnemonic,'operands':ins.op_str}
  if ins.mnemonic in ['call','jmp']and len(ins.operands)==1 and ins.operands[0].type==capstone.x86.X86_OP_IMM:
   target=ins.operands[0].imm;item.update(targetRva=hex(target),targetSymbols=byaddr.get(target,[]))
  refs=[]
  for op in ins.operands:
   if op.type==capstone.x86.X86_OP_MEM and op.mem.base==capstone.x86.X86_REG_RIP:
    target=ins.address+ins.size+op.mem.disp;refs.append({'rva':hex(target),'metadata':meta.get(target,[])})
  if refs:item['references']=refs
  instructions.append(item)
 rows.append({'rva':hex(start),'requestedSymbol':name,'allAliases':byaddr[start],'nextSymbolRva':hex(end),'rangeSha256':sha(raw),'bytes':raw.hex(),'size':len(raw),'instructions':instructions})
# Exact array field, not an enum/index guess: .cctor initializes this field.
field='DB17E883A647963A26D973378923EF4649801319';dump=buffers['dump'].decode();line=next(line for line in dump.splitlines()if field in line and 'Metadata offset' in line);offset=int(re.search(r'Metadata offset (0x[0-9a-fA-F]+)',line).group(1),16);raw=buffers['metadata'][offset:offset+24]
assert hashlib.sha1(raw).hexdigest().upper()==field and struct.unpack('<6i',raw)==(0,1,2,3,4,5)
ctor=next(r for r in rows if r['requestedSymbol']==names[1]);fieldSymbol=next(m for m in s['ScriptMetadata']if m['Name']=='Field$<PrivateImplementationDetails>.'+field)
assert any(fieldSymbol in ref['metadata']for ins in ctor['instructions']for ref in ins.get('references',[]))
constantRows=[]
for address,value in [(0x166b614,1/30),(0x162f778,2),(0x162fc80,4),(0x162f62c,1)]:
 _,_,b=img.read(address,4);actual=struct.unpack('<f',b)[0];assert actual==struct.unpack('<f',struct.pack('<f',value))[0];constantRows.append({'rva':hex(address),'bytes':b.hex(),'float32':actual})
# The rounding helper is a compiler/native function without an IL2CPP name.
# Its complete .pdata range, not a guessed next managed symbol, is retained.
pdata=next(section for section in img.sections if section[0]=='.pdata');_,_,table=img.read(pdata[1],pdata[2]);entry=next(row for row in struct.iter_unpack('<III',table)if row[0]<=0x50c20<row[1]);assert entry[0]==0x50c20
_,_,roundBytes=img.read(entry[0],entry[1]-entry[0]);rounding={'rva':hex(entry[0]),'endRva':hex(entry[1]),'unwindRva':hex(entry[2]),'rangeSha256':sha(roundBytes),'bytes':roundBytes.hex(),'size':len(roundBytes),'instructions':[{'rva':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}for i in d.disasm(roundBytes,entry[0])]}
header=buffers['header'].decode();structs={}
for name in ['Last_Systems_Camera_Shaker_Fields','Last_Systems_Camera_ReExecuteShaker_Fields','Last_Systems_Camera_ReExecuteShakerSocket_Fields','Last_Interpreter_Instructions_External_Misc_StaticFields','Last_Interpreter_Instructions_Format_Operands_Fields','Last_Map_FieldController_Fields','Last_Systems_Camera_CameraController_Fields']:
 marker=name+' {';start=header.index(marker);end=header.index('\n};',start)+3;structs[name]=header[start:end]
interface=dump[dump.index('public interface IMapAccessor // TypeDefIndex: 6758'):];interface=interface[:interface.index('\n}\n')+3];assert '// RVA: -1 Offset: -1 Slot: 14\n\tpublic abstract void SetCameraOffset(float x, float y);'in interface
report={'kind':'source-field-shake-native-evidence-v1','inputs':{key:{'path':paths[key],'sha256':sha(buffers[key])}for key in paths},'methods':rows,'roundingHelper':rounding,'headerStructs':structs,'mapAccessorInterface':interface,
 'shakeTypes':{'field':field,'declaration':line,'metadataOffset':hex(offset),'metadataSymbol':fieldSymbol,'bytes':raw.hex(),'values':list(struct.unpack('<6i',raw))},'constants':constantRows,
 'sourceSemantics':{'samplingPeriod':'f32(f32(1/30)/f32(i2+1)) multiplied by f32(r0) only if r0 != 0','lifetime':'until explicit Stop, not duration','types':'2*i1+i2 -> exact initialized six-type array','ranges':[[2,0],[4,1],[0,2],[1,4],[2,2],[4,4]],'reexecute':'i3 nonzero saves callback/type/period; replayed by MapResumeProcessBeforeFadeIn; DestroyInstance clears fieldBox','rng':'StateInitPlay calls DateTime.Now.Millisecond then UnityEngine.Random.InitState','sampling':'strict counter > period; reset counter to zero; at most one x/y draw pair per native Update','camera':'IMapAccessor slot14 -> FieldController.SetCameraOffset -> CameraController.SetOffsetPosition; no player/dummy logical position write','shortStarts':'three-int start lacks consumed i3; constructor does not fill arrays; remains blocked'},
 'webDifferences':['Explicit field-owned xorshift32 stream, not Unity global RNG/DateTime parity.','Fixed-field 10ms scheduler; menu/operation/battle suspend via existing Flow/Session.','New map starts stopped; retained battle return replays the configuration without wall-clock re-seeding.','Source save/Unity serialization and original browser parity are not claimed.'],
 'originalGameExecuted':False,'nativeParity':False,'runtimeAdmission':'unassessed'}
for key,path in paths.items():assert sha((root/path).read_bytes())==sha(buffers[key])
report['contentHash']=sha(json.dumps(report,sort_keys=True,separators=(',',':')).encode());out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'methods':len(rows)+1,'bytes':sum(r['size']for r in rows)+len(roundBytes),'hash':report['contentHash']}))
