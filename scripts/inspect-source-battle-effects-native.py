"""Recheck sealed battle effect wrappers/owner lifecycle and exact PE ranges."""
import argparse,bisect,hashlib,json,sys
from pathlib import Path
PINS={'native':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbols':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','header':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','dump':'e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b'}
GROUPS={'native-wrapper':{0xb42ea0,0xb43390},'native-owner':{0x1564ff0,0x1564df0,0x1564d20,0x1564b00,0x15661a0,0x1563930},'native-lifecycle':{0x92b7b0,0x92be30,0x92bc10,0x92bd20,0x92bc60,0x92bda0}}
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--cache',type=Path,default=Path('build/native/source-battle-presentation-v1'));p.add_argument('--output',type=Path,default=Path('build/reports/source-battle-effects-native.json'));a=p.parse_args();root=a.root.resolve();cache=(root/a.cache).resolve();out=(root/a.output).resolve();assert out.is_relative_to(root/'build');out.parent.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest();paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h','dump':'build/native/il2cpp/dump.cs'}
report={'kind':'source-battle-effects-native-static-v1','result':'running','nativeExecuted':False,'nativeParity':False}
try:
 b={k:(root/v).read_bytes() for k,v in paths.items()};assert {k:sha(v) for k,v in b.items()}==PINS,'Native input bytes changed'
 sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
 pe=PEImage(b['native']);symbols=json.loads(b['symbols'])['ScriptMethod'];addresses=sorted({s['Address'] for s in symbols});rows=[]
 for group,targets in GROUPS.items():
  receiptBytes=(cache/group/'complete.json').read_bytes();receipt=json.loads(receiptBytes)
  assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
  assert {int(m['rva'],16) for m in receipt['methods']}==targets and len(receipt['methods'])==len(targets)
  for key in ['native','symbols','header']:assert receipt[key+'Sha256'].lower()==PINS[key]
  for m in receipt['methods']:
   rva=int(m['rva'],16);end=addresses[bisect.bisect_right(addresses,rva)];assert end==int(m['nextSymbolRva'],16)
   sec,off,raw=pe.read(rva,end-rva);code=(cache/group/(format(rva,'x')+'.c')).read_bytes();assert sha(raw)==m['nativeRangeSha256'] and sha(code)==m['decompiledSha256']
   rows.append({'rva':m['rva'],'nextSymbolRva':m['nextSymbolRva'],'bytes':len(raw),'nativeSha256':sha(raw),'cSha256':sha(code),'cBytes':len(code),'cacheGroup':group,'receiptSha256':sha(receiptBytes),'sharedCalls':m['sharedCalls']})
 constants=[]
 for rva,expected,name in [(0x409ff0,bytes.fromhex('33c0c3'),'Core.get_Next'),(0x34c9f0,bytes.fromhex('b801000000c3'),'Core.get_Blank')]:
  sec,off,raw=pe.read(rva,len(expected));assert raw==expected
  aliases=[s for s in symbols if s['Address']==rva];assert any(name.replace('.get_','$$get_') in s['Name'] for s in aliases)
  constants.append({'rva':hex(rva),'rawHex':raw.hex(),'sha256':sha(raw),'boundName':name,'sharedAddress':True,'firstAliasNotAssumed':True})
 assert {k:sha((root/v).read_bytes()) for k,v in paths.items()}==PINS
 report.update(result='passed',identity=PINS,methods=rows,returnConstants=constants,counts={'completeMethods':len(rows),'nativeBytes':sum(r['bytes']for r in rows),'completeCBytes':sum(r['cBytes']for r in rows)},scope='Play wrapper, global sync predicate, current target lookup/PlayEffect list, Load -> Play -> End. i3 nonzero Next0, zero Blank1. Exact Unity prefab/controller/audio/native duration remains unverified; the explicit Web pulse is different presentation.')
except Exception as error:
 report.update(result='failed',error={'type':type(error).__name__,'message':str(error)});out.write_text(json.dumps(report,indent=2)+'\n');raise
out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['counts']))
