"""Audit only the already cached bounded NPC property/registration consumer evidence."""
import argparse, hashlib, json, sys
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--output',type=Path,default=Path('build/reports/flat-npc-native.json'))
args=parser.parse_args();root=args.root.resolve();sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
sha=lambda value:hashlib.sha256(value).hexdigest()
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={key:(root/path).read_bytes() for key,path in paths.items()};assert {key:sha(data) for key,data in buffers.items()}==expected
image=PEImage(buffers['nativeSha256']);symbols=json.loads(buffers['symbolsSha256'])['ScriptMethod'];addresses=sorted({row['Address'] for row in symbols});methods=[];files=[]
for batch,rvas in {'npc-actions':['9f3240'],'npc-interaction':['e17c80','e171f0'],'v33-field-pools-targets':['3083c0']}.items():
 folder=root/'build/native'/batch;receipt_bytes=(folder/'complete.json').read_bytes();receipt=json.loads(receipt_bytes)
 assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
 assert all(receipt[k]==v for k,v in expected.items() if k!='metadataSha256')
 files.append({'path':str((folder/'complete.json').relative_to(root)),'sha256':sha(receipt_bytes),'bytes':len(receipt_bytes)})
 for rva in rvas:
  rows=[row for row in receipt['methods'] if row['rva']=='0x'+rva];assert len(rows)==1;row=rows[0]
  start=int(rva,16);end=next(address for address in addresses if address>start);assert int(row['nextSymbolRva'],16)==end
  _,_,raw=image.read(start,end-start);body=(folder/(rva+'.c')).read_bytes()
  assert sha(raw)==row['nativeRangeSha256'] and sha(body)==row['decompiledSha256']
  methods.append({'batch':batch,**row,'bytes':len(raw)})
  files.append({'path':str((folder/(rva+'.c')).relative_to(root)),'sha256':sha(body),'bytes':len(body)})
for tool in [Path(__file__).resolve(),root/'tools/native/inspect_pe.py']:
 data=tool.read_bytes();files.append({'path':str(tool),'sha256':sha(data),'bytes':len(data)})
for key,path in paths.items():assert sha((root/path).read_bytes())==expected[key]
for row in files:assert sha((root/row['path']).read_bytes())==row['sha256']
report={'kind':'source-flat-npc-cached-native-audit-v1','result':'passed-static-input-audit','inputs':{k:{'path':paths[k],'sha256':v} for k,v in expected.items()},'files':files,'methods':methods,
 'scope':['PropertyNpc maps nullable all_layers to AllLayers=false and nullable collision to Collision=true when absent','FieldNonPlayer.SetProperty reads the existing AllLayers flag into AllLayerTarget independently from actor logical layer','FieldNonPlayer.Init retains source position/layer/direction','MapManager creates the same source entity before separate Birdview entity registration'],
 'unknown':['Original Birdview perspective/altitude/shadow lifecycle and native raycast/observer equivalence','Area movement, stencil and other retained source providers','Original game execution and Unity/Web visual parity'],'newNativeExport':False,'nativeRuntimeVerified':False,'nativeParity':False,'originalGameExecuted':False}
output=root/args.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':report['result'],'methods':len(methods),'nativeBytes':sum(m['bytes'] for m in methods),'output':str(output)}))
