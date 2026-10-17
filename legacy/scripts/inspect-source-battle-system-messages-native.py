"""Verify complete source message dictionary methods and preserve shared aliases."""
import argparse,bisect,hashlib,json,sys
from pathlib import Path
PINS={'native':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbols':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','header':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','dump':'e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b'}
GROUPS={'native-play':{0x31f3d0},'native-get-message':{0x31cae0},'native':{0x31cc30,0x31ce70},'native-load':{0x33aa30},'native-parse':{0x31d230}}
LITERALS={0x1fcd868:'system',0x1fcbd28:'system_{0}',0x1fcbcc0:'story',0x1fcbca0:'story_mes_{0}',0x1fcbc78:'etcetera',0x1fcbc20:'etc_text_{0}',0x1fcbc00:'story_cha_{0}'}
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--cache',type=Path,default=Path('build/native/source-battle-system-messages-v1'));p.add_argument('--output',type=Path,default=Path('build/reports/source-battle-system-messages-native.json'));a=p.parse_args();root=a.root.resolve();cache=(root/a.cache).resolve();out=(root/a.output).resolve();assert out.is_relative_to(root/'build');out.parent.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest();paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h','dump':'build/native/il2cpp/dump.cs'}
report={'kind':'source-battle-system-messages-native-static-v1','result':'running','nativeExecuted':False,'nativeParity':False,'firstSharedAliasAssumed':False}
try:
 data={k:(root/v).read_bytes() for k,v in paths.items()};assert {k:sha(v)for k,v in data.items()}==PINS,'Native input bytes changed'
 sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
 pe=PEImage(data['native']);symbols=json.loads(data['symbols']);methods=symbols['ScriptMethod'];addresses=sorted({s['Address']for s in methods});rows=[];allShared={}
 for group,targets in GROUPS.items():
  receiptBytes=(cache/group/'complete.json').read_bytes();receipt=json.loads(receiptBytes);assert receipt['status']=='complete'and receipt['semanticsVerified'] is False
  for key in ['native','symbols','header']:assert receipt[key+'Sha256'].lower()==PINS[key]
  selected=[m for m in receipt['methods']if int(m['rva'],16)in targets];assert len(selected)==len(targets)
  for m in selected:
   rva=int(m['rva'],16);end=addresses[bisect.bisect_right(addresses,rva)];assert end==int(m['nextSymbolRva'],16)
   sec,off,raw=pe.read(rva,end-rva);code=(cache/group/(format(rva,'x')+'.c')).read_bytes();assert sha(raw)==m['nativeRangeSha256']and sha(code)==m['decompiledSha256']
   calls=[]
   for address in sorted(set(m['sharedCalls'])):
    aliases=[s for s in methods if s['Address']==int(address,16)];assert aliases,'Unresolved shared call address'
    value={'rva':address,'aliases':aliases,'firstAliasNotAssumed':True};calls.append(value);allShared[address]=value
   aliases=[s for s in methods if s['Address']==rva];assert aliases
   rows.append({'rva':m['rva'],'nextSymbolRva':m['nextSymbolRva'],'bytes':len(raw),'nativeSha256':sha(raw),'cSha256':sha(code),'cBytes':len(code),'cacheGroup':group,'receiptSha256':sha(receiptBytes),'allMethodAliases':aliases,'sharedCalls':calls})
 actual={s['Address']:s['Value']for s in symbols['ScriptString']if s['Address']in LITERALS};assert actual==LITERALS
 assert {k:sha((root/v).read_bytes())for k,v in paths.items()}==PINS
 report.update(result='passed',identity=PINS,methods=rows,allSharedCalls=list(allShared.values()),loadAssetLiterals=[{'rva':hex(k),'value':v}for k,v in LITERALS.items()],counts={'completeMethods':len(rows),'nativeBytes':sum(r['bytes']for r in rows),'completeCBytes':sum(r['cBytes']for r in rows),'sharedAddresses':len(allShared),'allSharedAliases':sum(len(v['aliases'])for v in allShared.values())},contracts={'body':'LoadAsset selects system/story/etcetera; Parse fills the same messageDictionary; GetMessage reads it with existing replacement rules','speaker':'LoadAsset selects story_cha; GetSpeaker and GetSpeakerMessageId each warn and return String.Empty when the key is absent','duplicates':'Native Parse warns and retains an existing key. The Web compiler separately rejects ambiguous cross-table duplicates; current source has no intersections','window':'The complete Play calls shared GetMessage/GetSpeakerMessageId and existing MessageWindowManager; no new Window or message-ID conditional','limits':'Static complete-body and physical-range recheck, not native execution or game parity.'})
except Exception as error:
 report.update(result='failed',error={'type':type(error).__name__,'message':str(error)});out.write_text(json.dumps(report,indent=2)+'\n');raise
out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['counts']))
