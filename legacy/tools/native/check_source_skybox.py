"""Check the bounded Skybox wrapper/owner/curve evidence; never run Ghidra/game."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import capstone
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage

PACKETS = {
    'native-skybox': [0x293c00,0x293d60,0x2ef720,0x9649e0],
    'native-skybox-owner': [0x2e2970,0x9dbe00,0x9dc430,0x9dcbc0,0x9dd940,0x9dc2d0,0x9dbf10,0x2ef750,0x26a4e0,0x26a610,0x26a740],
    'native-skybox-curves': [0xb16a00,0xb10f60,0xb01250,0xb01560,0xb16d40,0xb16d00,0xb16a70],
}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--evidence-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.root.resolve();out=a.report.resolve();assert out.is_relative_to(root/'build');sha=lambda b:hashlib.sha256(b).hexdigest()
    native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();symbols=(root/'build/native/il2cpp/script.json').read_bytes();header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();pe=PEImage(native);symbol=json.loads(symbols);rows=[];receipts=[]
    assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
    for packet,expected in PACKETS.items():
        directory=a.evidence_dir.resolve()/packet;raw=(directory/'complete.json').read_bytes();r=json.loads(raw);assert r['status']=='complete' and r['semanticsVerified'] is False;assert sorted(int(m['rva'],16)for m in r['methods'])==sorted(expected)
        for key,b in [('nativeSha256',native),('symbolsSha256',symbols),('headerSha256',header)]:assert r[key]==sha(b)
        for m in r['methods']:
            start,end=int(m['rva'],16),int(m['nextSymbolRva'],16);assert [v for v in symbol['ScriptMethod']if v['Address']==start];assert min(v['Address']for v in symbol['ScriptMethod']if v['Address']>start)==end
            original=pe.read(start,end-start)[2];body=(directory/f'{start:x}.c').read_bytes();assert sha(original)==m['nativeRangeSha256'];assert sha(body)==m['decompiledSha256'];rows.append(dict(packet=packet,**m,nativeBytes=len(original)))
        receipts.append(dict(packet=packet,sha256=sha(raw)))
    assert len(rows)==22 and sum(r['nativeBytes']for r in rows)==6224
    strings=[v for v in symbol['ScriptString']if v['Address']==0x1fd59d0];assert strings==[{'Address':0x1fd59d0,'Value':'Map_40000_other'}]
    dis=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);dis.detail=True;op=list(dis.disasm(pe.read(0x293d60,896)[2],0x293d60));asm=[i.mnemonic+' '+i.op_str for i in op];assert 'movaps xmm2, xmm6' in asm,'Ghidra KeyFrame value0 must not replace the actual xmm6 input'
    c=(a.evidence_dir/'native-skybox/293d60.c').read_text();imperial=(a.evidence_dir/'native-skybox/293c00.c').read_text()
    for text in ['Core__set_r0','Core__get_r0','UnityEngine_Time__get_time','115.0','func_0x000180409ff0(0)','func_0x00018034c9f0(0)']:assert text in c,text
    for text in ['37.0','Lerp(-4.0,-134.0','Core__set_r0','return 1','return 0']:assert text in imperial,text
    # Cached InitMap proof, with its complete source symbol/PE interval.
    cached=root/'build/native/v19-transport-lifecycle';receipt=json.loads((cached/'complete.json').read_bytes());m=next(m for m in receipt['methods']if int(m['rva'],16)==0x2e3d30);start,end=int(m['rva'],16),int(m['nextSymbolRva'],16);raw=pe.read(start,end-start)[2];body=(cached/'2e3d30.c').read_bytes();assert sha(raw)==m['nativeRangeSha256'] and sha(body)==m['decompiledSha256'];assert b'SetSkyboxSprites' in body and b'isAreaTypeWorld' in body
    report=dict(kind='source-skybox-static-native-audit-v1',result='passed-static-only',nativeSha256=sha(native),symbolsSha256=sha(symbols),headerSha256=sha(header),methods=rows,nativeBytes=6224,receipts=receipts,cachedInit=dict(method=m,bytes=len(raw),receiptSha256=sha((cached/'complete.json').read_bytes())),literal=strings[0],protocol=dict(firstClock='UnityTime float32 into the actual Task Core.General r0',eachClock='Clamp01/float32 Lerp and SetSkyboxOffset; Wait until ratio1',opening='115 seconds, 0 -> -100; secondary source model literal; 920 keys alternate0/.75 at0.125 sec, final.75 retained',imperial='37 seconds, -4 -> -134; no new blend curve'),caveat='Ghidra KeyFrame call falsely shows value0; original PE passes xmm6. Forward jump aliases are not mistaken for complete callee bodies.',webDifferences=['Field-only logical clock and battle pause','reserved top-third 2D source full-texture panorama','no recovered Unity 3D/fog/shader/effect306'],originalGameExecuted=False,nativeDynamicVerified=False)
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(result=report['result'],methods=len(rows),nativeBytes=6224,cachedInitBytes=len(raw),report=str(out))))
if __name__=='__main__':main()
