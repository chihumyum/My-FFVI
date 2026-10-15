"""Bounded static evidence for the complete Function19 calculator lane.
Reads the supplied original DLL only. No original game execution or VFX parity.
"""
import argparse,bisect,hashlib,json,pathlib,sys
import capstone
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage
p=argparse.ArgumentParser();p.add_argument('--root',default=str(pathlib.Path(__file__).resolve().parents[2]));p.add_argument('--evidence-dir');p.add_argument('--report');a=p.parse_args();root=pathlib.Path(a.root).resolve();evidence=pathlib.Path(a.evidence_dir).resolve()if a.evidence_dir else root/'build/native/source-non-damaging-abilities';output=pathlib.Path(a.report).resolve()if a.report else root/'build/reports/non-damaging-ability-native.json';sha=lambda b:hashlib.sha256(b).hexdigest()
native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();metadata=(root/'build/native/il2cpp/dump.cs').read_bytes();s=json.loads(symbols);addresses=sorted({m['Address']for m in s['ScriptMethod']});pe=PEImage(native);decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
def audit(folder,expected):
 rb=(folder/'complete.json').read_bytes();receipt=json.loads(rb);assert receipt['status']=='complete';assert receipt['nativeSha256']==sha(native)and receipt['symbolsSha256']==sha(symbols)and receipt['headerSha256']==sha(header)
 assert {int(m['rva'],16)for m in receipt['methods']}==set(expected)
 rows=[]
 for method in receipt['methods']:
  addr=int(method['rva'],16);end=addresses[bisect.bisect(addresses,addr)];raw=pe.read(addr,end-addr)[2];body=(folder/f'{addr:x}.c').read_bytes();assert method['nextSymbolRva']==hex(end)and method['nativeRangeSha256']==sha(raw)and method['decompiledSha256']==sha(body)
  rows.append({'rva':hex(addr),'bytes':len(raw),'nativeRangeSha256':sha(raw),'cFile':str(folder/f'{addr:x}.c'),'cSha256':sha(body)})
 return{'file':str(folder/'complete.json'),'sha256':sha(rb),'methods':rows}
new=[audit(evidence/'native',[0x66b1c0,0x66b580]),audit(evidence/'native-act',[0x33f780,0x927fd0,0x928020,0x928160])]
# Existing packets are preserved separately; a fresh export is unnecessary.
cache=[]
for folder,addr in [('ability-providers',0x3419c0),('ability-providers',0x342080),('v23-defend-presentation',0x3d8c60)]:
 f=root/'build/native'/folder;rb=(f/'complete.json').read_bytes();j=json.loads(rb);assert j['status']=='complete'and j['nativeSha256']==sha(native)and j['symbolsSha256']==sha(symbols);m=[m for m in j['methods']if int(m['rva'],16)==addr];assert len(m)==1;end=addresses[bisect.bisect(addresses,addr)];raw=pe.read(addr,end-addr)[2];body=(f/f'{addr:x}.c').read_bytes();assert m[0]['nativeRangeSha256']==sha(raw)and m[0]['decompiledSha256']==sha(body);cache.append({'file':str(f/f'{addr:x}.c'),'sha256':sha(body),'receipt':str(f/'complete.json'),'receiptSha256':sha(rb),'rva':hex(addr),'nativeRangeSha256':sha(raw)})
text=metadata.decode();assert 'public const FunctionType Non = 19;'in text and 'public const AbilityType NonAct = 35;'in text and 'public const BattleDamageCalculation.HitType Hit = 0;'in text
provider=(root/'build/native/ability-providers/3419c0.c').read_text();classes=(root/'build/native/ability-providers/342080.c').read_text();factory=(evidence/'native-act/33f780.c').read_text();assert 'case 0x13:'in provider and '_Last_Battle_Function_NonFunction_TypeInfo'in provider;assert 'case 0x13:'in classes and '_Last_Battle_Function_NonFixedMissFunction_TypeInfo'in classes;assert 'case 0x23:'in factory and '_Last_Battle_NonActFunction_TypeInfo'in factory
raw=pe.read(0x66b580,0x100)[2];ins=list(decoder.disasm(raw,0x18066b580));asm='\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}'for i in ins)
# C is truncated by IL2CPP GC-barrier inference. These exact native instructions
# prove SetStatus slot2 -> GetFixedStatus slot13(Hit0) -> this.calcResult+0x20.
for expected in ['mov ecx, 2','call 0x180050880','lea ecx, [r9 + 0xd]','call 0x18004e800','lea rcx, [rsi + 0x20]']:
 assert expected in asm,expected
assert 'xor r9d, r9d'in asm
stubs=[]
for addr,size,expected,role in [(0x2c8ef0,3,'c20000','NonFunction.UpdateParameter'),(0x389c70,3,'32c0c3','NonFixedMiss.IsFixedMiss')]:
 raw=pe.read(addr,size)[2];assert raw.hex()==expected;stubs.append({'rva':hex(addr),'role':role,'rawHex':expected,'sha256':sha(raw)})
# Preserve shared AfterAction aliases and exact bytes without assigning the
# first alias a guessed decompiler signature.
addr=0x91fd30;end=addresses[bisect.bisect(addresses,addr)];raw=pe.read(addr,end-addr)[2];aliases=[m for m in s['ScriptMethod']if m['Address']==addr];assert len(aliases)==3 and any('NonActFunction'in m['Name']for m in aliases)
report={'kind':'non-damaging-ability-native-static-audit-v1','result':'passed-static-binding','inputs':{'nativeSha256':sha(native),'symbolsSha256':sha(symbols),'headerSha256':sha(header),'metadataSha256':sha(metadata)},'newPackets':new,'cachedPackets':cache,'nonCalcRaw':{'rva':'0x66b580','rawHex':pe.read(0x66b580,0x100)[2].hex(),'assembly':asm},'stubs':stubs,'sharedAfterAction':{'rva':hex(addr),'aliases':aliases,'rawHex':raw.hex(),'nativeRangeSha256':sha(raw)},'protocol':{'calculator':'NonFunction -> SetStatus -> GetFixedStatus(Hit0)','parameterUpdate':'source ret body, no parameter mutation','result':'present fixed Hit0/value0/hitCount0, distinct from empty dictionary or Miss','queue':'source NonAct function; existing Web action stages retain continuation and native VFX is explicitly deferred','unknown':'other functions/processes/flags/NonAct companion inputs and native effect timing retained as gates'},'originalGameExecuted':False,'nativeDynamicParity':False}
output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'newMethods':6,'cachedMethods':3,'report':str(output),'sha256':sha(output.read_bytes())}))
