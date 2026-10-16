"""Audit bounded source Mineralization evidence; never execute a game binary."""
from pathlib import Path
import argparse, hashlib, json, sys, os
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',type=Path,default=Path.cwd())
p.add_argument('--fresh',type=Path,default=Path('build/native/source-mineralization-common'))
p.add_argument('--output',type=Path,default=Path('build/reports/source-mineralization-native.json'))
a=p.parse_args(); root=a.root.resolve(); fresh=(root/a.fresh).resolve(); output=(root/a.output).resolve()
if not output.is_relative_to(root/'build'): raise ValueError('Evidence output must stay in ignored build/')
sys.path.insert(0,str(root)); from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest()
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h'}
pins={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
buffers={k:(root/v).read_bytes()for k,v in paths.items()}; assert{k:sha(v)for k,v in buffers.items()}==pins
methods=json.loads(buffers['symbolsSha256'])['ScriptMethod'];addresses=sorted(set(m['Address']for m in methods));pe=PEImage(buffers['nativeSha256'])
def raw(rva):
 end=next(x for x in addresses if x>rva);sect,off,b=pe.read(rva,end-rva)
 return dict(rva=hex(rva),nextSymbolRva=hex(end),bytes=len(b),section=sect,fileOffset=off,sha256=sha(b),hex=b.hex(),aliases=[m for m in methods if m['Address']==rva],nextAliases=[m for m in methods if m['Address']==end])
records=[]
for folder,rva in [(fresh,0x9261d0),(root/'build/native/v17-battle-timing',0x455780),
 (root/'build/native/v42-battle-unit-life',0x4d2d00),(root/'build/native/v19-character-growth-review',0x769570),
 (root/'build/native/condition-silence',0x45b450)]:
 receipt=(folder/'complete.json').read_bytes();j=json.loads(receipt);assert j['status']=='complete'and{k:j[k]for k in pins}==pins
 if folder==fresh:assert len(j['methods'])==1
 m=next(x for x in j['methods']if int(x['rva'],16)==rva);b=(folder/(f'{rva:x}.c')).read_bytes();r=raw(rva)
 assert m['nextSymbolRva']==r['nextSymbolRva']and m['nativeRangeSha256']==r['sha256']and sha(b)==m['decompiledSha256']
 records.append(dict(directory=os.path.relpath(folder,root),receiptSha256=sha(receipt),sourceRange=r,method=m,cSha256=sha(b)))
start=(fresh/'9261d0.c').read_text()
for text in ['SetActNotPossible(pLVar2,true','SetIsStop(pLVar9,true','afterSlowlyMineralization','0x195','iVar8 == 3','InterruptAddCondition']:
 assert text in start,text
shared=[raw(r)for r in [0x51a030,0x926100,0x262010]]
assert [(r['bytes'],len(r['aliases']))for r in shared]==[(160,2),(208,2),(16,79)]
assert shared[0]['sha256']=='53273ee5135d2ebbad63688db1a51a361018551836b4882a5c948c77c810220f'
assert shared[1]['sha256']=='79a67f749014e18c1fd0f3544e55169cbcd255859ed9664d9fd3075e0c99a7e7'
# Exact source bytes, not a decompiler alias, establish serial6 and the shared
# method ranges. Root's independent lease audit retains their disassembly.
assert shared[2]['hex']=='b806000000c3cccccccccccccccccccc'
assert any(m['Name']=='Serial.FF6.Management.SystemConfigData$$GetSerialType'for m in shared[2]['aliases'])
assert {m['Name']for m in shared[1]['aliases']}=={'Last.Battle.MineralizationConditionFunction$$ActEndUpdate','Last.Battle.MineralizationConditionFunction$$DownStart'}
report=dict(kind='source-mineralization-native-check-v1',pins=pins,completeBodies=records,sharedPeOnly=shared,
 sourceSemantics=['Start sets action-not-possible and animation stop; FF6 serial6 does not enter the serial3 enemy death branch.',
 'Shared ActEndUpdate/DownStart is enemy-only zero HP then CheckAddCondition; source controller ActEndUpdate visits every current unit function.',
 'Game-over and EXP eligibility are separate source predicates. Numeric ExchangeValue/recovery-invalid consumers remain gated.'],
 webPolicy='web-source-mineralization-action-down-boundary-v1',originalGameExecuted=False,semanticsVerified=False)
output.parent.mkdir(parents=True,exist_ok=True);b=(json.dumps(report,indent=2)+'\n').encode();output.write_bytes(b)
print(json.dumps(dict(methods=len(records),sharedRanges=len(shared),sharedBytes=sum(r['bytes']for r in shared),sha256=sha(b))))
