"""Static bounded packet audit only. Never exports methods or executes the DLL."""
import argparse, hashlib, json, sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source-root',required=True);p.add_argument('--packet',required=True);p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.source_root).resolve();packet=Path(a.packet).resolve();sys.path.insert(0,str(root/'tools/native'))
from inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest()
pins={'nativeSha256':('build/runtime/game/GameAssembly.dll','1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
 'symbolsSha256':('build/native/il2cpp/script.json','5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),
 'headerSha256':('build/native/il2cpp/il2cpp_ghidra.h','71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718')}
for key,(name,expected)in pins.items():assert sha((root/name).read_bytes())==expected,key
pe=PEImage((root/pins['nativeSha256'][0]).read_bytes());symbols=json.loads((root/pins['symbolsSha256'][0]).read_text())['ScriptMethod'];addresses=sorted(set(m['Address']for m in symbols));methods=[]
for proposal,directory in [('native-proposal.json','native-placement'),('native-provider-proposal.json','native-provider')]:
 spec=json.loads((packet/proposal).read_text());receipt=json.loads((packet/directory/'complete.json').read_text());assert receipt['status']=='complete'and receipt['semanticsVerified']is False
 for key,(_,expected)in pins.items():assert spec[key]==receipt[key]==expected
 for item in spec['methods']:
  name=item.get('symbolName',item.get('name'));start=int(item['rva'],16);end=int(item['nextSymbolRva'],16)
  exact=[m for m in symbols if m['Name']==name];assert len(exact)==1 and exact[0]['Address']==start,(name,exact)
  assert next(v for v in addresses if v>start)==end and end-start==item['bytes']
  data=pe.read(start,end-start)[2];assert sha(data)==item['nativeRangeSha256'];complete=next(m for m in receipt['methods']if int(m['rva'],16)==start)
  c=packet/directory/(format(start,'x')+'.c');assert sha(c.read_bytes())==complete['decompiledSha256'];assert complete['nativeRangeSha256']==sha(data)
  methods.append({'name':name,'rva':item['rva'],'end':item['nextSymbolRva'],'bytes':len(data),'rangeSha256':sha(data),'cSha256':sha(c.read_bytes())})
assert len(methods)==10 and sum(m['bytes']for m in methods)==8704
domains=[]
for name,rva in [('Last.Data.User.Corps$$get_CharacterId',0x491610),('Last.Data.User.Corps$$get_Id',0x491670),('Last.Interpreter.Core$$get_Next',0x409ff0)]:
 exact=[m for m in symbols if m['Name']==name];assert len(exact)==1 and exact[0]['Address']==rva
 aliases=[m['Name']for m in symbols if m['Address']==rva];end=next(v for v in addresses if v>rva)
 domains.append({'name':name,'rva':hex(rva),'aliasCount':len(aliases),'rangeSha256':sha(pe.read(rva,end-rva)[2]),'meaning':'Corps CharacterId refers to numeric owned identity'if rva==0x491610 else 'Corps Id is Front1/Back2 row'if rva==0x491670 else 'Core Next result; aliases do not change caller domain'})
literals=json.loads((root/'build/native/il2cpp/stringliteral.json').read_text());assert next(x['value']for x in literals if int(x['address'],16)==0x1fd5a58)=='Dying';assert next(x['value']for x in literals if int(x['address'],16)==0x1ff6890)=='Default'
header=(root/pins['headerSha256'][0]).read_text();v=header.split('struct Last_Entity_Field_FieldEntity_VTable {',1)[1].split('};',1)[0];assert '_23_Hide;'in v and '_51_CueAnimation;'in v
cached=[]
for directory,rva in [('actor-dispatch','aeb570'),('actor-dispatch','aeaf20'),('v20-map-party-entry-init','e0dfd0'),('v20-map-party-entry','879870'),('point-in','30f140')]:
 c=root/'build/native'/directory/(rva+'.c');receipt=json.loads((c.parent/'complete.json').read_text());item=next(m for m in receipt['methods']if int(m['rva'],16)==int(rva,16));assert sha(c.read_bytes())==item['decompiledSha256'];cached.append({'path':str(c.relative_to(root)),'sha256':sha(c.read_bytes())})
result={'kind':'source-multi-corps-static-native-audit-v1','pins':{k:v[1]for k,v in pins.items()},'methods':methods,'domainBindings':domains,'cachedConsumers':cached,
 'contracts':{'placement':'IMapAccessor3 cell->world; IEntityAccessor1 actual party instance; fresh layer from source PointIn1, no player-layer fallback','hidden':'IEntityAccessor0 GetFieldEntity(-1030), vtable23 at class+0x2a0 Hide(0)','phoenix':'vtable51 at class+0x460 CueAnimation(Dying,-1)','separate':'current clone all source indices; clear bank1/2; first two nonempty CharacterId, preserve Corps.Id and index; remove current; IMap43 Refresh(true)','rejoin':'first nonempty source bank cell; original index else first empty current; clear original even if current full; no Refresh'},
 'newExportsByThisAgent':0,'nativeExecution':False,'sourceCampaignComplete':False}
out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'methods':len(methods),'bytes':sum(m['bytes']for m in methods),'outputSha256':sha(out.read_bytes())}))
