"""Recheck finite cached Fn9/11/12 bodies and PE ranges; never execute native code."""
from pathlib import Path
import argparse,bisect,hashlib,json,sys
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.root.resolve();out=a.report.resolve()
assert out.is_relative_to(root/'build');sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest();native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();dump=(root/'build/native/il2cpp/dump.cs').read_bytes()
assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc';assert sha(symbols)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3';assert sha(header)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
methods=json.loads(symbols)['ScriptMethod'];addresses=sorted({m['Address']for m in methods});pe=PEImage(native);decoder=Cs(CS_ARCH_X86,CS_MODE_64);rows=[];packets=[]
def packet(name,expected_hash,requested):
 folder=root/'build/native'/name;raw=(folder/'complete.json').read_bytes();receipt=json.loads(raw);assert sha(raw)==expected_hash and receipt['status']=='complete'
 for key,value in [('nativeSha256',native),('symbolsSha256',symbols),('headerSha256',header)]:assert receipt[key]==sha(value)
 for addr in requested:
  entry=next(m for m in receipt['methods']if int(m['rva'],16)==addr);end=addresses[bisect.bisect(addresses,addr)];assert int(entry['nextSymbolRva'],16)==end
  raw=pe.read(addr,end-addr)[2];body=(folder/f'{addr:x}.c').read_bytes();assert sha(raw)==entry['nativeRangeSha256'] and sha(body)==entry['decompiledSha256']
  rows.append({'rva':hex(addr),'rangeBytes':len(raw),'nativeRangeSha256':sha(raw),'cSha256':sha(body),'allAliases':[m for m in methods if m['Address']==addr],
   'assembly':[{'rva':hex(i.address-pe.image_base),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}for i in decoder.disasm(raw,pe.image_base+addr)]})
 packets.append({'path':str(folder),'receiptSha256':expected_hash,'requestedMethods':[hex(x)for x in requested]})
packet('condition-actions','e1087ef76418ddc030d53bd173289b94125a4215802bc122a165457efafd2773',[0x4f1d70,0x4f2630,0x66e250,0x66e910,0x66eac0,0x66f4d0])
packet('condition-eligibility','9c660a8133457bf1cdfd4b8361ca53bb2519747d6099e700a55f876bb0b321a9',[0x4f2570,0x4f25d0,0x76af00,0x3d9760])
packet('revival-lifecycle','70e02626b2f22ffe3a7848df2f4c2364278bc27bb2b2dd34373e4a7c10e3aeee',[0x66e6a0,0x66f1b0])
packet('ability-providers','dd9a70a80a9bfd3fd93a263c541c60f108ddaf968345764618c2d1c182c8e433',[0x3419c0,0x342080])
def c(folder,addr):return(root/'build/native'/folder/f'{addr:x}.c').read_text()
single=c('condition-actions',0x66e250);multi=c('condition-actions',0x66eac0);missing=c('condition-eligibility',0x3d9760)
assert 'IsUnitHaveRecoveryCondition'in single and 'uVar14 = 0xd;'in single and 'uVar14 = 0xc;'in single and 'iVar5 == 0x122'in single
assert 'uVar23 = 0;'in multi and 'uVar23 = 2;'in multi and 'FUN_18004e800(0xd'in multi and 'iVar13 == 0x122'in multi
assert 'GetFixedStatus(__this,2,'in missing
text=dump.decode();interface=text.split('public interface ICalcControllerProvider ')[1].split('// Namespace:')[0]
assert 'Slot: 12\n\tpublic abstract ICalcResult GetRecoveryCondition'in interface and 'Slot: 13\n\tpublic abstract ICalcResult GetFixedStatus'in interface
assert 'public const HitType Hit = 0;'in text and 'public const HitType Miss = 2;'in text
assert 'overrideFunctionToUndead = true'in c('revival-lifecycle',0x66e6a0) and 'overrideFunctionToUndead'in c('revival-lifecycle',0x66f1b0)
report={'kind':'ordinary-condition-cached-native-v1','result':'passed-static-cached-bindings','inputs':{'nativeSha256':sha(native),'symbolsSha256':sha(symbols),'headerSha256':sha(header),'dumpSha256':sha(dump)},'methods':rows,'packets':packets,'methodCount':len(rows),'nativeBytes':sum(r['rangeBytes']for r in rows),
 'contract':{'Fn9':'direct condition row; fixed hit differs from resistance bypass; existing active lifecycle required','Fn11':'current requested condition produces fixed Hit0, ordinary absent condition reaches GetRecoveryCondition->Miss2','Fn12':'Any current requested condition produces Hit0, otherwise Miss2; preserve original group order/repeats','preservedHardGates':['life/undead override and source override branches','unknown incoming active lifecycle','mixed functions and nonzero process data','unknown resources/actor/phase'],'web':'original effect/SE deferred; same source action payment/target/RNG/reaction/condition transaction'},'nativeDynamicParity':False,'originalGameExecuted':False,'newNativeExports':0}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'methods':report['methodCount'],'nativeBytes':report['nativeBytes'],'sha256':sha(out.read_bytes())}))
