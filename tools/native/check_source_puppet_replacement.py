"""Check bounded Puppet replacement evidence against original PE; never execute."""
from pathlib import Path
import argparse,hashlib,json
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from inspect_pe import PEImage

def sha(raw):return hashlib.sha256(raw).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-root',type=Path,required=True);p.add_argument('--research-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.input_root.resolve();w=a.research_root.resolve()
 native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();pe=PEImage(native);symbols_raw=(root/'build/native/il2cpp/script.json').read_bytes();symbols=json.loads(symbols_raw);header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
 assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
 batches=[(w/'native-unique',[0x277220,0x279940,0x28f580,0x28f750,0x28fc00,0x28fc60,0x28fda0,0x28ff00,0x290070,0x2900c0,0x290120,0x290260,0x2903c0,0x290410,0x2911e0,0x291720,0x298060,0x298770,0x298850]),(w/'native-owner',[0x5f4ab0]),(root/'build/native/v29-field-hosts',[0x5f2010])]
 methods=[];receipts=[];bodies={}
 for folder,addresses in batches:
  raw=(folder/'complete.json').read_bytes();receipt=json.loads(raw);assert receipt['status']=='complete'and receipt['semanticsVerified']is False
  assert receipt['nativeSha256']==sha(native)and receipt['symbolsSha256']==sha(symbols_raw)and receipt['headerSha256']==sha(header);receipts.append({'file':str(folder/'complete.json'),'sha256':sha(raw)})
  for address in addresses:
   rows=[r for r in receipt['methods']if int(r['rva'],16)==address];assert len(rows)==1;row=rows[0];aliases=[r for r in symbols['ScriptMethod']if r['Address']==address];assert len(aliases)==1
   blob=pe.read(address,int(row['nextSymbolRva'],16)-address)[2];c=(folder/(format(address,'x')+'.c')).read_bytes();assert sha(blob)==row['nativeRangeSha256']and sha(c)==row['decompiledSha256'];bodies[address]=c.decode()
   methods.append({'rva':hex(address),'identity':aliases[0],'bytes':len(blob),'peSha256':sha(blob),'cFile':str(folder/(format(address,'x')+'.c')),'cSha256':sha(c),'sharedCallsNotAssignedSemantics':row['sharedCalls']})
 assert sum(r['bytes']for r in methods if r['rva']!='0x5f2010')==11664
 assert 'GetOwnedCharactersClone' in bodies[0x290410]and '(pLVar7,false' in bodies[0x290410]and 'iVar6 = -iVar5' in bodies[0x290410]and 'iVar6 != exceptCharacterId'in bodies[0x290410]
 assert '__Get(__this_00,8,4' in bodies[0x28f580]and '-0x406 - iVar4'in bodies[0x28f580]
 assert '__Clear'in bodies[0x2911e0]and '0x138'in bodies[0x2911e0]
 owner=bodies[0x5f4ab0];assert owner.index('__Sleep')<owner.index('set_localPosition')and 'iVar12 + 1'in owner and '__get_IsAwake'in owner and '__CopyEntityLayer'in owner
 assert 'FUN_18004e940(0x18' in bodies[0x5f2010]and '0x19'in bodies[0x5f2010]
 asm=Cs(CS_ARCH_X86,CS_MODE_64)
 def dis(address,size):return[{'rva':hex(i.address-pe.image_base),'hex':i.bytes.hex(),'instruction':i.mnemonic+' '+i.op_str}for i in asm.disasm(pe.read(address,size)[2],pe.image_base+address)]
 wrapper=dis(0x277220,160);assert any(i['rva']=='0x2772b4'and i['instruction']=='jmp 0x1805f4ab0'for i in wrapper)
 closure=dis(0x4a4310,48);assert any(i['instruction']=='call 0x18052ffc0'for i in closure)and any(i['instruction']=='cmp eax, dword ptr [rbx + 0x10]'for i in closure)
 metadata={r['Address']:r for r in symbols['ScriptMetadataMethod']};assert metadata[0x1fd16e0]['Name']=='Method$Last.Interpreter.Instructions.SystemCall.Current.ExecPuppetCallbackCommon()'
 assert 'ReplaceEntitySlotCommon>b__0'in metadata[0x2001740]['Name']
 assert metadata[0x1fd16e0]['MethodAddress']==0x277220 and metadata[0x2001740]['MethodAddress']==0x4a4310
 failed=w/'native-initial';assert not(failed/'complete.json').exists()
 report={'kind':'source-puppet-replacement-native-static-v1','result':'passed-static-contract-not-dynamic-parity','nativeSha256':sha(native),'symbolsSha256':sha(symbols_raw),'headerSha256':sha(header),'receipts':receipts,'completeMethods':methods,'methodCount':len(methods),'nativeBytes':sum(r['bytes']for r in methods),'wrapperTail':wrapper,'sharedClosure':{'rva':'0x4a4310','bytes':48,'peSha256':sha(pe.read(0x4a4310,48)[2]),'aliases':[r for r in symbols['ScriptMethod']if r['Address']==0x4a4310],'assembly':closure,'acceptedAliasDecompilation':False},'metadataReferences':[metadata[0x1fd16e0],metadata[0x2001740]],'failedInitialExport':{'path':str(failed),'complete':False,'accepted':False},'nativeExecuted':False,'nativeDynamicParity':False,'limitations':['Shared getter symbols are validated as call/offset evidence, not assigned an arbitrary aliased managed method.','NPC dictionaries/placements and the distinct permanent RTS party/motion protocol remain gates.','The Web session copies integer callback data across map publication; it does not retain Unity process-global actor references.']}
 a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':report['result'],'methods':len(methods),'nativeBytes':report['nativeBytes']}))
if __name__=='__main__':main()
