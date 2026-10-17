"""Static bounded screen contracts; original PE, all aliases, no native execution."""
from pathlib import Path
import argparse,hashlib,json,sys,struct
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from capstone.x86 import X86_OP_MEM,X86_REG_RIP

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.input_root.resolve();sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
 sha=lambda b:hashlib.sha256(b).hexdigest();raw=(root/'build/runtime/game/GameAssembly.dll').read_bytes();sb=(root/'build/native/il2cpp/script.json').read_bytes();hb=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();expected=['1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'];assert[sha(raw),sha(sb),sha(hb)]==expected
 pe=PEImage(raw);symbols=json.loads(sb);cs=Cs(CS_ARCH_X86,CS_MODE_64);cs.detail=True;rows=[];code={};preset_references=[]
 for folder in ['native-contract','native-preset']:
  home=root/'build/wip/source-screen-effect-family'/folder;rb=(home/'complete.json').read_bytes();packet=json.loads(rb);assert packet['status']=='complete' and packet['semanticsVerified']is False;assert[packet[k]for k in ['nativeSha256','symbolsSha256','headerSha256']]==expected
  assert len(packet['methods'])==(20 if folder=='native-contract' else 1)
  for m in packet['methods']:
   addr=int(m['rva'],16);b=pe.read(addr,int(m['nextSymbolRva'],16)-addr)[2];c=(home/f'{addr:x}.c').read_bytes();assert sha(b)==m['nativeRangeSha256']and sha(c)==m['decompiledSha256'];aliases=[s for s in symbols['ScriptMethod']if s['Address']==addr];assert aliases;code[addr]=c.decode();instructions=[]
   for i in cs.disasm(b,pe.image_base+addr):
    instructions.append({'rva':hex(i.address-pe.image_base),'mnemonic':i.mnemonic,'operands':i.op_str,'bytes':i.bytes.hex()})
    if addr==0x9f74c0:
     for op in i.operands:
      if op.type==X86_OP_MEM and op.mem.base==X86_REG_RIP:
       ref=i.address+i.size+op.mem.disp-pe.image_base;matches=[]
       for category in ['ScriptString','ScriptMetadataMethod']:
        matches.extend([{'category':category,**s}for s in symbols[category]if s['Address']==ref])
       number=struct.unpack('<f',pe.read(ref,4)[2])[0]if ref in [0x162f614,0x162f62c,0x165e474,0x162fea0]else None
       if matches or number is not None:preset_references.append({'instructionRva':hex(i.address-pe.image_base),'referenceRva':hex(ref),'metadata':matches,'float32':number})
   rows.append({'packet':folder,**m,'nativeBytes':len(b),'completeReceiptSha256':sha(rb),'allAliases':aliases,'instructions':instructions})
 assert len(rows)==21 and sum(r['nativeBytes']for r in rows)==11808
 for addr,need in [(0xb51c40,['0x5c,_Last_Map_IMapAccessor_TypeInfo','0x5d,_Last_Map_IMapAccessor_TypeInfo','180409ff0']),(0xb52420,['ScreenEffectCommon']),(0x7e08f0,['Lerp']),(0x297480,['SetMainGameMonochromeColor','SetMainGameFilterColor']),(0x28ed40,['SetMainGameMonochromeColor']),(0xb54180,['IBackdropColor_TypeInfo,3','IBackdropColor_TypeInfo,0']),(0xb554c0,['IBackdropColor_TypeInfo,1'])]:
  for text in need:assert text in code[addr],(hex(addr),text)
 methods=[m for r in preset_references for m in r['metadata']];assert any(m.get('Name')=='Method$Common.Easing.EaseInQuad()'for m in methods);assert any(m.get('Name')=='Method$Common.Easing.EaseInExpo()'for m in methods)
 for name in ['amplitude','sepia_ratio','blur_ratio','ScreenEffect_Normal_Wave']:assert any(m.get('Value')==name for m in methods),name
 assert set(r['float32']for r in preset_references if r['float32']is not None)=={.5,1.,struct.unpack('<f',struct.pack('<f',4.2))[0],5.}
 out=a.report.resolve();assert'build'in out.parts;out.parent.mkdir(parents=True,exist_ok=True);report={'kind':'source-screen-presentation-native-check-v1','result':'passed-static-bindings','nativeSha256':sha(raw),'symbolsSha256':sha(sb),'headerSha256':sha(hb),'methods':rows,'nativeBytes':11808,'presetReferences':preset_references,'decompilerLimitations':['cctor9f74c0 Ghidra early return after GC barrier is invalid; complete2064 PE instructions and RIP metadata establish all four presets.'],'contract':{'wrappers':'ScreenEffect/sepia all Main.Next; playing is task setter, not bool query','presets':{'1':{'sepia_ratio':[0,1],'easing':'EaseInQuad'},'3':{'amplitude':[0,5],'blur_ratio':[0,1],'easing':'EaseInQuad','raster':True},'2':'texture ScreenEffect_Normal_Wave and warp callback remain unsupported'},'monochrome':'white color; filter white alpha40/255; remove alpha0','backdrop':'separate IBackdropColor current/background camera color, not FadeManager image overlay','nativeGlobalBattleClock':'not recovered; explicit Web Field-only pause policy'},'nativeExecuted':False,'nativeDynamicParity':False,'sourceProgramsExecuted':0};out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'methods':21,'nativeBytes':11808,'sha256':sha(out.read_bytes())}))
if __name__=='__main__':main()
