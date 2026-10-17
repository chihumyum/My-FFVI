"""Bounded static audit; reads original PE, one retained export and existing DataStorage receipt.

No DLL execution or Ghidra export. Original bytes/C stay in ignored reports.
The integer API contract is documented at https://docs.unity.cn/Documentation/ScriptReference/Random.Range.html
Only positive non-overflowing source operands are admitted; generator parity is unassessed.
"""
import argparse,bisect,hashlib,json,sys
from pathlib import Path
import capstone
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--evidence-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.root.resolve();e=a.evidence_dir.resolve();out=a.report.resolve();assert out.is_relative_to(root/'build'),'Report must remain ignored'
 sha=lambda b:hashlib.sha256(b).hexdigest();paths={'nativeSha256':root/'build/runtime/game/GameAssembly.dll','symbolsSha256':root/'build/native/il2cpp/script.json','headerSha256':root/'build/native/il2cpp/il2cpp_ghidra.h'};buffers={k:p.read_bytes()for k,p in paths.items()};hashes={k:sha(v)for k,v in buffers.items()}
 assert hashes=={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
 symbols=json.loads(buffers['symbolsSha256']);methods=symbols['ScriptMethod'];addresses=sorted({m['Address']for m in methods});pe=PEImage(buffers['nativeSha256']);md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
 def verified(folder,rva):
  receipt_bytes=(folder/'complete.json').read_bytes();receipt=json.loads(receipt_bytes);assert receipt['status']=='complete'
  for k,v in hashes.items():assert receipt[k]==v
  found=[m for m in receipt['methods']if int(m['rva'],16)==rva];assert len(found)==1;row=found[0];end=addresses[bisect.bisect(addresses,rva)];raw=pe.read(rva,end-rva)[2];c=(folder/f'{rva:x}.c').read_bytes()
  assert int(row['nextSymbolRva'],16)==end and row['nativeRangeSha256']==sha(raw)and row['decompiledSha256']==sha(c)
  return {'rva':hex(rva),'nextSymbolRva':hex(end),'rangeSha256':sha(raw),'cSha256':sha(c),'receiptSha256':sha(receipt_bytes),'hex':raw.hex(),'disassembly':[{'rva':hex(i.address),'hex':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}for i in md.disasm(raw,rva)]}
 wrapper=verified(e,0xb52970);storage=verified(root/'build/native/event-state',0x82f600)
 ins=wrapper['disassembly'];texts=[i['mnemonic']+' '+i['operands']for i in ins]
 expected=['mov edx, dword ptr [rax + 0x24]','xor r8d, r8d','inc edx','lea ecx, [r8 + 1]','call 0x10133f0'];pos=texts.index(expected[0]);assert texts[pos:pos+5]==expected
 assert 'call 0x82f600' in texts and 'mov r8d, dword ptr [rcx + 0x20]' in texts and 'mov r9d, ebp' in texts
 aliases=[m for m in methods if m['Address']==0x10133f0];assert {m['Name']for m in aliases}=={'UnityEngine.Random$$Range','UnityEngine.Random$$RandomRangeInt'}and all(m['TypeSignature']=='iiii'for m in aliases)
 report={'kind':'source-script-random-static-native-audit-v1','result':'passed-static-binding-only',**hashes,'wrapper':wrapper,'existingDataStorageSet':storage,'randomAliases':aliases,'observedProtocol':{'minInclusive':1,'maxExclusive':'int32(iValues[1]+1)','destination':'DataStorage exact sValues[0] dictionary category, iValues[0] index','nativeFailureOrder':'Random draw precedes bank lookup/write','admittedSourceDomain':'type1; MapLocalVariable/AreaLocalVariable; nonoverflowing positive upper; no reserved payload'},'webDeparture':'Existing GameState.fieldRandom generator and atomic validation-before-publication; not Unity RNG or its draw-before-error semantics','nativeDynamicVerified':False};out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'report':str(out),'sha256':sha(out.read_bytes())}))
if __name__=='__main__':main()
