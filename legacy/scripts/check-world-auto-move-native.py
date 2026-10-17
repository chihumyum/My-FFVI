"""Recheck bounded complete native movement bodies against the original PE."""
from pathlib import Path
import argparse,hashlib,json,sys
from capstone import Cs,CS_ARCH_X86,CS_MODE_64

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-root',type=Path,required=True);p.add_argument('--report',type=Path,default=Path('build/reports/world-auto-move-native.json'));a=p.parse_args();root=a.input_root.resolve();sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
 sha=lambda b:hashlib.sha256(b).hexdigest();raw=(root/'build/runtime/game/GameAssembly.dll').read_bytes();symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();assert sha(raw)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc';assert sha(symbols)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3';assert sha(header)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
 pe=PEImage(raw);s=json.loads(symbols)['ScriptMethod'];cs=Cs(CS_ARCH_X86,CS_MODE_64);rows=[];texts={}
 packets=[('source-world-auto-move-family/native-move','638ff008bb7f23daf9cf43ee4be677c84b044023c63435af0bcde213ebebee0f',[0x9d56b0,0x9d4fd0]),('source-world-auto-move-family/native-entity','6d73ece9d5768278ea48cbca3bd605fc37cfea3bca067076bd6a0fc921350fb6',[0xe0e840,0xe17860,0x87a050]),('source-world-auto-move-family/native-player-speed','32db8629e5cd473016b81f3577367450e2c6b3961618bcad6a21d03d9c49805b',[0xe195d0,0x38d7f0]),('source-world-auto-task-proposal/native',None,[0xb404e0,0x2dfb80]),('source-world-auto-task-proposal/native-lifecycle',None,[0x9e88c0])]
 for folder,expected,addresses in packets:
  home=root/'build/wip'/folder;rb=(home/'complete.json').read_bytes();j=json.loads(rb);assert j['status']=='complete'and j['semanticsVerified']is False
  if expected:assert sha(rb)==expected and {int(m['rva'],16)for m in j['methods']}==set(addresses)
  assert j['nativeSha256']==sha(raw)and j['symbolsSha256']==sha(symbols)and j['headerSha256']==sha(header)
  for addr in addresses:
   m=[r for r in j['methods']if int(r['rva'],16)==addr];assert len(m)==1;m=m[0];b=pe.read(addr,int(m['nextSymbolRva'],16)-addr)[2];c=(home/f'{addr:x}.c').read_bytes();assert sha(b)==m['nativeRangeSha256']and sha(c)==m['decompiledSha256'];texts[addr]=c.decode();aliases=[r for r in s if r['Address']==addr];assert aliases
   rows.append({'packet':folder,'rva':hex(addr),'nativeBytes':len(b),'nativeRangeSha256':sha(b),'cSha256':sha(c),'receiptSha256':sha(rb),'allAliases':aliases,'sharedCalls':m['sharedCalls'],'instructions':[{'rva':hex(i.address-pe.image_base),'mnemonic':i.mnemonic,'operands':i.op_str,'bytes':i.bytes.hex()}for i in cs.disasm(b,pe.image_base+addr)]})
 assert '_TargetEntity_k__BackingField' in texts[0x9d56b0]and 'delegateGetZAxisRotateBirdCameraFunc'in texts[0x9d56b0]and '16.0'in texts[0x9d56b0]and '_37_MoveTo.methodPtr'in texts[0x9d56b0]
 assert 'moveTime' in texts[0xe0e840]and '1.4142135'in texts[0xe0e840]and 'GetFieldSpriteMoveSecondsPerCell'in texts[0xe0e840]
 assert 'ChangeEntityMoveMagnificationByCurrentMoveState'in texts[0xe195d0]and 'ImmediatelyBeforeMoveing'in texts[0xe195d0]
 assert 'MoveToAxis'in texts[0x9e88c0]and 'isMoveForward = true'in texts[0x9e88c0]
 report={'kind':'source-world-auto-move-native-check-v1','result':'passed-static-bindings','methods':rows,'nativeBytes':sum(r['nativeBytes']for r in rows),'contract':{'wrapper':'Main Next; r0 float32 seconds,r1/r2 full axis,i0 speedID','task':'parallel timer, source zero/negative duration no MoveTo; busy MoveTo returns without restarting','target':'current CameraFollowing actual TargetEntity; absent native branch returns','position':'source current world position + camera-Z-rotated axis*16, actual virtual MoveTo','duration':'speed table with current native magnification; original input x!=0 && y!=0 multiplies sqrt2','webDifferences':['magnification1 and ordinary directional animation','no Unity player callbacks/pitch/bank/RT','active collision/raycast requires its independent native provider; no silent bypass']},'nativeExecuted':False,'nativeDynamicParity':False,'sourceProgramsExecuted':0}
 out=a.report.resolve();assert 'build'in out.parts;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'methods':len(rows),'nativeBytes':report['nativeBytes'],'sha256':sha(out.read_bytes())}))
if __name__=='__main__':main()
