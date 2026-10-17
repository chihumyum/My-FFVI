from pathlib import Path
import sys,json,hashlib,bisect
import argparse
a=argparse.ArgumentParser();a.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);a.add_argument('--output',type=Path);args=a.parse_args();root=args.root.resolve();sys.path.insert(0,str(root/'tools/native'));from inspect_pe import PEImage
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
output=args.output or root/'build/reports/source-script-animations-native.json';sha=lambda b:hashlib.sha256(b).hexdigest();native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc';assert sha(symbols)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3';assert sha(header)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
s=json.loads(symbols);addresses=sorted(set(s['Addresses']));pe=PEImage(native);cs=Cs(CS_ARCH_X86,CS_MODE_64);cache=[('actor-animation',[0xb13390,0xb14010,0xb13f40,0xb140f0,0xb124d0,0xb12130]),('actor-dispatch',[0xb117b0]),('event-operators',[0x5f2530]),('event-script-transition-v40',[0x5f1df0]),('event-script-transition-lifecycle-v40',[0x5f4e90]),('v28-puppet-lifecycle',[0x5f4fd0])];rows=[]
for folder,rvas in cache:
 p=root/'build/native'/folder;receipt=json.loads((p/'complete.json').read_bytes());assert receipt['status']=='complete'
 for key,data in [('nativeSha256',native),('symbolsSha256',symbols),('headerSha256',header)]:assert receipt[key]==sha(data)
 for r in rvas:
  matches=[m for m in receipt['methods'] if int(m['rva'],16)==r];assert len(matches)==1;m=matches[0];end=addresses[bisect.bisect_right(addresses,r)];assert int(m['nextSymbolRva'],16)==end;code=pe.read(r,end-r)[2];c=(p/f'{r:x}.c').read_bytes();assert sha(code)==m['nativeRangeSha256'];assert sha(c)==m['decompiledSha256'];rows.append({'rva':hex(r),'name':m['name'],'nextRva':hex(end),'bytes':len(code),'peSha256':sha(code),'cSha256':sha(c),'receipt':str(p/'complete.json'),'receiptSha256':sha((p/'complete.json').read_bytes())})
short=[]
for r in [0xb118d0,0xb14340]:
 end=addresses[bisect.bisect_right(addresses,r)];code=pe.read(r,end-r)[2];ins=[{'rva':hex(i.address),'mnemonic':i.mnemonic,'operands':i.op_str,'raw':i.bytes.hex()}for i in cs.disasm(code,r)];short.append({'rva':hex(r),'nextRva':hex(end),'bytes':len(code),'peSha256':sha(code),'allAliases':[m for m in s['ScriptMethod']if m['Address']==r],'instructions':ins})
assert any(i['mnemonic']=='lea' and i['operands']=='rcx, [rdi + 0x70]'for i in short[1]['instructions']);assert all('[rdi + 0x70]'not in i['operands'] for i in short[0]['instructions'])
report={'kind':'source-custom-animation-cached-native-boundary-verification-v1','nativeSha256':sha(native),'symbolsSha256':sha(symbols),'headerSha256':sha(header),'cachedBodies':rows,'shortLifecyclePE':short,'newGhidraExports':0,'allCachedBytes':sum(m['bytes']for m in rows),'newShortPEBytes':sum(m['bytes']for m in short),'originalGameExecuted':False,'semanticsScope':['Initial selection base then actor cache then current CustomAnimAsset; requested custom name first original definition.','Setup alternation and SwitchNext resolve successor in base AnimAssetDatas, not current custom.','Zero AnimTime GetSpriteIndex selects0; mode0 stops next positive update.','ctor initializes+0x70 custom dictionary; Init rebuilds+0x10 sprite dictionary without clearing+0x70.']}
getter=pe.read(0x5f12c0,144)[2];assert sha(getter)=='77e29ad87a9dae5133ab4c50bbd47b5b2aaa2c22b026044477c55e8d63ae8c72'
report['customGetter']={'rva':'0x5f12c0','bytes':144,'peSha256':sha(getter)};output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'cachedMethods':len(rows),'cachedBytes':report['allCachedBytes'],'shortMethods':len(short),'shortPE':report['newShortPEBytes']}))
