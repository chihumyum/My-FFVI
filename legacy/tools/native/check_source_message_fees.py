"""Bounded static audit; reads original PE, two retained exports and existing DataStorage receipt.

No DLL execution or Ghidra export. Original bytes/C stay in ignored reports.
Only the source service-fee and message replacement chain is inspected; native dynamic parity is unassessed.
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
 wrapper=verified(e,0xb527f0);predicate=verified(e,0x2cad10);storage=verified(root/'build/native/v21-treasure-task',0x31e680)
 ins=wrapper['disassembly'];texts=[i['mnemonic']+' '+i['operands']for i in ins]
 assert 'call 0x4a4f60' in texts and 'call 0x31e680' in texts and 'call 0xcc4050' in texts
 decimal={'rva':'0xcc4050','symbolAliases':[m for m in methods if m['Address']==0xcc4050],'formattingSemantics':'unassessed; Web explicitly chooses plain nonnegative decimal'}
 ptexts=[i['mnemonic']+' '+i['operands']for i in predicate['disassembly']]
 assert 'call 0x4a4a80' in ptexts and any('0x20]' in t for t in ptexts)
 bindings={key:[m for m in methods if m['Address']==rva and m['Name'].startswith('Last.Data.Master.Product$$')]for key,rva in [('groupGetter',0x4a4a80),('coefficientGetter',0x4a4f60)]}
 assert any(m['Name']=='Last.Data.Master.Product$$get_GroupId'for m in bindings['groupGetter'])
 assert any(m['Name']=='Last.Data.Master.Product$$get_Coefficient'for m in bindings['coefficientGetter'])
 product=[m for m in symbols['ScriptMetadataMethod']if m['Address']==0x1fc14b0];tag=[m for m in symbols['ScriptString']if m['Address']==0x1fd7608]
 assert len(product)==1 and product[0]['Name']=='Method$Last.Data.Master.MasterManager.GetList<Product>()' and tag==[{'Address':0x1fd7608,'Value':'KINGAKU'}]
 report={'kind':'source-message-fees-static-native-audit-v1','result':'passed-static-binding-only',**hashes,'wrapper':wrapper,'predicate':predicate,'existingMessageManagerSetValue':storage,'unlabelledFormattingHelper':decimal,'productGetters':bindings,'genericProductList':product,'tagString':tag,'observedProtocol':{'selection':'FirstOrDefault Product.GroupId == iValues[0]','value':'Product.Coefficient -> unlabelled string formatting helper 0xcc4050 -> MessageManager.SetValue(KINGAKU)','ownedGilMutation':False,'ambiguity':'Web rejects missing or ambiguous service groups instead of relying on native dictionary order'},'webDeparture':'source-bound nonnegative ordinary fees only; plain decimal formatting; stable replacement persistence and inactive-window checkpoint are explicit Web codecs; native save behavior unassessed','nativeDynamicVerified':False};out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'report':str(out),'sha256':sha(out.read_bytes())}))
if __name__=='__main__':main()
