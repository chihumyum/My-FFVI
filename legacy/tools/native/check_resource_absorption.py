"""Finite static proof for resource absorption; no game execution or native parity."""
from pathlib import Path
import argparse,bisect,hashlib,json,struct,sys
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
p=argparse.ArgumentParser();p.add_argument('--input-root',type=Path,required=True);p.add_argument('--research-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.input_root.resolve();home=a.research_root.resolve();sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest();native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();metadata=(root/'build/native/il2cpp/dump.cs').read_bytes();assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc';assert sha(symbols)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3';assert sha(header)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
s=json.loads(symbols)['ScriptMethod'];addresses=sorted({m['Address']for m in s});pe=PEImage(native);cs=Cs(CS_ARCH_X86,CS_MODE_64);methods=[];packets=[]
def disassemble(addr,raw):return [{'rva':hex(i.address-pe.image_base),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}for i in cs.disasm(raw,pe.image_base+addr)]
def packet(folder,expected,expected_sha=None):
 rb=(folder/'complete.json').read_bytes();j=json.loads(rb);assert j['status']=='complete'and j['semanticsVerified']is False
 if expected_sha:assert sha(rb)==expected_sha
 for key,b in [('nativeSha256',native),('symbolsSha256',symbols),('headerSha256',header)]:assert j[key]==sha(b)
 assert set(expected)<=set(int(m['rva'],16)for m in j['methods'])
 for addr in expected:
  matches=[m for m in j['methods']if int(m['rva'],16)==addr];assert len(matches)==1;m=matches[0];end=addresses[bisect.bisect(addresses,addr)];assert int(m['nextSymbolRva'],16)==end;raw=pe.read(addr,end-addr)[2];body=(folder/f'{addr:x}.c').read_bytes();assert sha(raw)==m['nativeRangeSha256']and sha(body)==m['decompiledSha256']
  methods.append({'rva':hex(addr),'nativeBytes':len(raw),'nativeRangeSha256':sha(raw),'cSha256':sha(body),'allAliases':[r for r in s if r['Address']==addr],'sharedCalls':m['sharedCalls'],'assembly':disassemble(addr,raw),'decompilerWarnings':[line for line in body.decode().splitlines()if 'WARNING:'in line]})
 packets.append({'path':str(folder),'receiptSha256':sha(rb)})
packet(home/'native-leaves',[0x4f1850,0x4f1b20,0x4f1be0,0x669b00,0x669e80,0x66d200,0x66d650],'83e56f411b2b22ff1d5d8006187fbb7f515717ee87b8d34aef906efd48b2afdd')
packet(home/'native-owner',[0x976dd0,0x976e30,0x976f30,0x977840,0x978600,0x9788a0],'2d25f2e18757c0e62ce1846b5b6c878a55baf230a4717630170d7bf13b40f9bd')
new_bytes=sum(m['nativeBytes']for m in methods);assert len(methods)==13 and new_bytes==13360
packet(root/'build/native/ability-providers',[0x3419c0,0x342080])
# Full source PrevCalc includes a second jump table which Ghidra failed to
# recover. Values1/2 select single recipient, normal overflow (not Value3).
assert struct.unpack('<8I',pe.read(0x978878,32)[2])==(0x97866c,0x97866c,0x978678,0x978678,0x97866c,0x97866c,0x978678,0x978678)
assembly={int(m['rva'],16):'\n'.join(i['mnemonic']+' '+i['operands']for i in m['assembly'])for m in methods}
for text in ['mov dword ptr [rbx + 0x98], 0','mov dword ptr [rbx + 0x9c], 1','jmp rcx']:assert text in assembly[0x978600]
# AbsorptionFunction.Calc was truncated after a GC barrier. Original bytes
# continue through SetStatus/GetMagicStatus, target current clipping, ratio
# creation and storage; a decompiler early return must never become a no-op.
for text in ['call 0x18019d260','mov ecx, 2','mov r8d, 7','cmp esi, eax','divss xmm1','mulss xmm1']:
 assert text in assembly[0x4f1850],text
provider=(root/'build/native/ability-providers/3419c0.c').read_text();classes=(root/'build/native/ability-providers/342080.c').read_text();assert 'case 0x45:'in provider and 'MagicAbsorptionFunction_TypeInfo'in provider and 'case 0x4d:'in provider and 'PhysicsAbsorptionFunction_TypeInfo'in provider and 'case 0xd:'in classes and 'BattleFunction13_TypeInfo'in classes
for name,call in [('669b00','FUN_18006fb10(7'),('66d200','FUN_18004f780(6')]:assert call in (home/'native-leaves'/f'{name}.c').read_text()
short=[]
for addr in [0x985350,0x9853a0,0x985420,0x978460,0x4a4a80]:
 end=addresses[bisect.bisect(addresses,addr)];raw=pe.read(addr,end-addr)[2];short.append({'rva':hex(addr),'nativeBytes':len(raw),'rawHex':raw.hex(),'sha256':sha(raw),'allAliases':[r for r in s if r['Address']==addr],'assembly':disassemble(addr,raw)})
assert 'cmp eax, 0x290'in '\n'.join(i['mnemonic']+' '+i['operands']for i in short[2]['assembly'])
assert any(r['Name']=='Last.Data.Master.Chanting$$get_ForAiTypeId'for r in short[-1]['allAliases'])
text=metadata.decode();assert 'public abstract ICalcResult GetFightStatus();'in text and 'public abstract ICalcResult GetMagicStatus(int baseHitRate = 0'in text and 'public const HitType Zero = 3;'in text
report={'kind':'source-resource-absorption-native-check-v1','result':'passed-static-bindings','inputs':{'nativeSha256':sha(native),'symbolsSha256':sha(symbols),'headerSha256':sha(header),'metadataSha256':sha(metadata)},'newMethods':13,'newNativeBytes':new_bytes,'cachedMethods':2,'packets':packets,'methods':methods,'shortNativeProofs':short,'contract':{'primary':'69->existing magic,77->existing physical; cap value by current caster resource deficit,full caster is Zero3','secondary':'13 values1/2 HP/MP,single,normal; actual target current clips return; Value3 binds Chanting.ForAiType','notAdmitted':['reverse recovery/undead','Soul Saber carrier and nullifying type656','multi-recipient/overflow selectors','other function companions or resource selectors'],'web':'same joint action payment/RNG/reaction/condition transaction; native VFX/audio deferred to existing400/900ms Web stages'},'originalGameExecuted':False,'nativeDynamicParity':False}
out=a.report.resolve();out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'newMethods':13,'newNativeBytes':new_bytes,'cachedMethods':2,'sha256':sha(out.read_bytes())}))
