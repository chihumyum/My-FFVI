"""Validate cached complete native bodies and original PE lifecycle bytes; never execute the game."""
from pathlib import Path
import argparse, hashlib, json, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

REQUIRED = {'native':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
 'symbols':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',
 'header':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718',
 'dump':'e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b'}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input-root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--report',type=Path,default=Path('build/reports/world-auto-tasks-native.json'));args=parser.parse_args()
 root=args.input_root.resolve();sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
 sha=lambda b:hashlib.sha256(b).hexdigest();home=root/'build/wip/source-world-auto-task-proposal'
 paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h','dump':'build/native/il2cpp/dump.cs'}
 buffers={k:(root/v).read_bytes()for k,v in paths.items()};assert {k:sha(v)for k,v in buffers.items()}==REQUIRED
 verified=(home/'native-verification.json').read_bytes();assert sha(verified)=='565afa19c8fb88b4d018e82a7a09d5e981fdd893dcbf1e89e172b11e044ec536'
 pe=PEImage(buffers['native']);symbols=json.loads(buffers['symbols']);methods=[];machine={};cs=Cs(CS_ARCH_X86,CS_MODE_64)
 for folder,expected in [('native',[0xb40b60,0xb40720,0xb402c0,0xb404e0,0xb40940,0x2e2c40,0x2dfb20,0x2dfb50,0x2dfaf0,0x2dfac0,0x2dfb80,0x2dfbb0,0x2dfbe0,0x2ece10,0x2d8f60]),('native-lifecycle',[0x9d54f0,0x9d5b30,0x9d52c0,0x9e6790,0x9e6560,0x9e88c0,0x9e8e90,0x8646f0,0x8645e0])]:
  receipt=(home/folder/'complete.json').read_bytes();data=json.loads(receipt);assert data['status']=='complete'and data['semanticsVerified']is False
  assert {int(m['rva'],16)for m in data['methods']}==set(expected)
  assert data['nativeSha256']==REQUIRED['native']and data['symbolsSha256']==REQUIRED['symbols']and data['headerSha256']==REQUIRED['header']
  for m in data['methods']:
   rva=int(m['rva'],16);raw=pe.read(rva,int(m['nextSymbolRva'],16)-rva)[2];c=(home/folder/(format(rva,'x')+'.c')).read_bytes()
   assert sha(raw)==m['nativeRangeSha256']and sha(c)==m['decompiledSha256']
   aliases=[s for s in symbols['ScriptMethod']if s['Address']==rva];assert aliases
   row={'rva':m['rva'],'nativeBytes':len(raw),'nativeRangeSha256':sha(raw),'cSha256':sha(c),'allAliases':aliases,'sharedCalls':m['sharedCalls'],'receiptSha256':sha(receipt)};methods.append(row)
   if rva in [0x9d54f0,0x9d52c0]:machine[rva]=[{'rva':hex(i.address-pe.image_base),'mnemonic':i.mnemonic,'operands':i.op_str,'hex':i.bytes.hex()}for i in cs.disasm(raw,pe.image_base+rva)]
 init={int(i['rva'],16):i for i in machine[0x9d54f0]};destroy={int(i['rva'],16):i for i in machine[0x9d52c0]}
 assert init[0x9d5565]['operands']=='r8d, r8d'and init[0x9d556e]['operands']=='edx, [r8 + 1]'and init[0x9d5572]['operands']=='0x180864cf0'
 assert destroy[0x9d52ed]['operands']=='0x180864360'
 for rva,offset in [(0x9d5586,0x50),(0x9d559a,0x58),(0x9d55ab,0x60),(0x9d55bc,0x68),(0x9d55cd,0x70),(0x9d55de,0x78)]:assert init[rva]['operands']==f'rcx, [rdi + {hex(offset)}]'
 for rva,offset in [(0x9d5301,0x50),(0x9d530f,0x58),(0x9d531d,0x60),(0x9d532b,0x68),(0x9d5339,0x70),(0x9d5347,0x78)]:assert destroy[rva]['operands']==f'rcx, [rbx + {hex(offset)}]'
 assert all(i['mnemonic']!='ret'for i in machine[0x9d54f0]if int(i['rva'],16)<0x9d55e5)
 report={'kind':'world-auto-tasks-native-static-check-v1','result':'passed','inputs':REQUIRED,'cachedVerificationSha256':sha(verified),'methods':methods,
  'lifecycleOriginalPe':{'init':machine[0x9d54f0],'destroy':machine[0x9d52c0],'parallelTaskMachineType':1,'clearsAllSixDelegates':True,
    'decompilerLimitation':'Cached Init/Destroy incorrectly stop at GC barriers with PIC/unreachable warnings; full PE instruction streams continue. The original bytes prove construction/cleanup, not the truncated C early return.'},
  'review':{'wrappers':'All five wrappers return MainCore Next; explicit i0=1 forwards r2 as start and r1 as endpoint/increment, else getters capture current at Add.',
    'queue':'Start visits all ITask.Start; native parallel Update visits list order. Repeated-Start and fixed Web frame rules remain explicitly authored, not native scheduling parity.',
    'scalar':'Rotation is captured start plus clamped-progress increment; altitude/upDown interpolate. Zero/negative duration never forces a setter endpoint.',
    'unclosed':['40 AddAirShipMoveTask spatial/speed/actual following owner','68 MoveBirdView separate entity height and joined Move lifecycle','Native bank/pitch/animation, particles, render-target and aircraft control']},
  'nativeExecution':False,'nativeParity':False,'sourceWorldCompilations':0}
 assert {k:sha((root/v).read_bytes())for k,v in paths.items()}==REQUIRED
 output=args.report.resolve();assert 'build'in output.parts;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':'passed','methods':len(methods),'nativeBytes':sum(m['nativeBytes']for m in methods),'sha256':sha(output.read_bytes())}))
if __name__=='__main__':main()
