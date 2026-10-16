"""Recheck only existing bounded source exports. No native process or export."""
import argparse,hashlib,json,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--output',required=True);a=p.parse_args();root=Path(a.root).resolve();sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
pins={'nativeSha256':('build/runtime/game/GameAssembly.dll','1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),'symbolsSha256':('build/native/il2cpp/script.json','5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),'headerSha256':('build/native/il2cpp/il2cpp_ghidra.h','71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718')}
sha=lambda b:hashlib.sha256(b).hexdigest();buffers={k:(root/path).read_bytes() for k,(path,digest) in pins.items()}
for k,(path,digest) in pins.items():assert sha(buffers[k])==digest,k
symbols=json.loads(buffers['symbolsSha256']);addresses=sorted(set(m['Address'] for m in symbols['ScriptMethod']));image=PEImage(buffers['nativeSha256'])
selected={'ai-control':['81b120','828fe0'],'ai-state':['82d2c0'],'ai-selection':['b552f0','15b9b90','15b9d50'],'ai-reactions':['15b8e90','15b8ea0','15b8fd0','15b8fc0','81fd50','820c00'],'ai-received-context':['15b7520','15b8460']}
methods=[];receipts=[];texts={}
for group,rvas in selected.items():
 path=root/'build/native'/group/'complete.json';raw=path.read_bytes();receipt=json.loads(raw);assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
 for key,(_,digest) in pins.items():assert receipt[key]==digest
 receipts.append({'path':str(path),'sha256':sha(raw),'bytes':len(raw)})
 for token in rvas:
  rva=int(token,16);matches=[m for m in receipt['methods'] if int(m['rva'],16)==rva];assert len(matches)==1
  row=matches[0];end=next(n for n in addresses if n>rva);assert int(row['nextSymbolRva'],16)==end
  section,offset,data=image.read(rva,end-rva);assert sha(data)==row['nativeRangeSha256'];cpath=path.parent/(token+'.c');c=cpath.read_bytes();assert sha(c)==row['decompiledSha256'];assert b'Last_' in c and b'RVA' in c
  methods.append({**row,'file':str(cpath),'bytes':end-rva,'decompiledBytes':len(c),'section':section,'offset':offset,'aliases':[m['Name'] for m in symbols['ScriptMethod'] if m['Address']==rva]});texts[token]=c.decode()
 assert path.read_bytes()==raw
for token,fragments in {'15b8e90':['isReadyReceiveAbility = true'],'15b8fd0':['isReadyActCounter = true','attackUnitData','*ppLVar4 = user'],'15b8ea0':['isReadyFinalAttack = true','IsUnableFight','notFinalAttackConditionTypes'],'15b8fc0':['isReadyActNormal = true'],'15b9d50':['isReadyActNormal = false','isReadyActCounter = false','isReadyFinalAttack = false','isReadyReceiveAbility = false'],'15b8460':['recevieAbility','*ppLVar1 = (Last_Data_Master_Ability_o *)0x0'],'15b7520':['recevieAbility','*ppLVar10 = ability'],'828fe0':['_clockCount_k__BackingField == 1'],'15b9b90':['isReadyActNormal == false','IsStackActInterruptByFirstAttack']}.items():
 for fragment in fragments:assert fragment in texts[token],(token,fragment)
for key,(path,digest) in pins.items():assert sha((root/path).read_bytes())==digest
report={'kind':'source-ai-reaction-continuation-native-evidence-v1','result':'passed','identity':{k:v[1] for k,v in pins.items()},'methods':methods,'receipts':receipts,'nativeExports':0,'originalGameExecuted':False,'nativeTimingVerified':False,'interpretation':{'flags':'received/counter/Final writes are independent and clear together at source Sync; do not restart pending normal PC','webTransaction':'One existing 10 ms executor waits for its private received candidates. Resource effects/RNG/tickets publish only after all routes return to Sync. Relative Unity frame order remains unknown.','unknowns':['FirstAttack interrupt qualification remains unresolved','Final source message execution remains a reached gate','unimplemented recovery, item and HitType providers remain reached gates']}}
out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':'passed','methods':len(methods),'bytes':sum(m['bytes'] for m in methods),'sha256':sha(out.read_bytes())}))
