"""Audit only the already cached bounded PlayAnim/Tile consumer evidence."""
import argparse, hashlib, json, sys
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--output',type=Path,default=Path('build/reports/play-animation-native.json'))
args=parser.parse_args();root=args.root.resolve();sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
sha=lambda value:hashlib.sha256(value).hexdigest()
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadataSha256':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'}
buffers={key:(root/path).read_bytes() for key,path in paths.items()};assert {key:sha(data) for key,data in buffers.items()}==expected
image=PEImage(buffers['nativeSha256']);symbols=json.loads(buffers['symbolsSha256'])['ScriptMethod'];addresses=sorted({row['Address'] for row in symbols});methods=[];files=[]
for batch,rvas in {'tile-binding':['2c4800','2bf450'],'tile-geometry':['2caa90','2cab50'],'tile-region':['aecbc0','aed0e0','aed270']}.items():
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
# Shared address cannot use the first metadata alias to infer behavior.
_,_,permit=image.read(0x90e830,5);assert permit.hex()=='c6413001c3'
assert any(row['Address']==0x90e830 and row['Name']=='MapTileUVData$$PermitAnimation' for row in symbols)
for tool in [Path(__file__).resolve(),root/'tools/native/inspect_pe.py']:
 data=tool.read_bytes();files.append({'path':str(tool),'sha256':sha(data),'bytes':len(data)})
for key,path in paths.items():assert sha((root/path).read_bytes())==expected[key]
for row in files:assert sha((root/row['path']).read_bytes())==row['sha256']
report={'kind':'source-play-animation-cached-native-audit-v1','result':'passed-static-input-audit','inputs':{k:{'path':paths[k],'sha256':v} for k,v in expected.items()},'files':files,'methods':methods,'rawLeaves':[{'rva':'0x90e830','bytes':5,'rawHex':permit.hex(),'sha256':sha(permit)}],
 'scope':['Puppet finite i1>1, flip0, r1/time-limit=0 and r2/delay=0 only','First Cue(-1)+Play; subsequent completion decrements existing Core.i6 then invokes Entity.Play directly','Core writes i0,i1,i7,i6,r3; r3 retains preceding Core.r0, not operand playback speed','Tile direct Entity PlaySetting/PermitAnimation retains UV elapsed/count; the same Tile owner completes it'],
 'unknown':['Nonzero delay, time limits, explicit flip','Two non-field Resident contexts and existing short-operand source forms','Original game execution and Unity/Web update timing parity'],'newNativeExport':False,'nativeRuntimeVerified':False,'nativeParity':False,'originalGameExecuted':False}
output=root/args.output;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':report['result'],'methods':len(methods),'nativeBytes':sum(m['bytes'] for m in methods)+5,'output':str(output)}))
