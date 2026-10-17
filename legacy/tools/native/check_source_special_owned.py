"""Verify bounded special-owned native evidence against the original PE; never execute it."""
import argparse,hashlib,json
from pathlib import Path
from inspect_pe import PEImage

def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-root',type=Path,required=True);p.add_argument('--research-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();r=a.input_root.resolve();h=a.research_root.resolve()
 pins={'build/runtime/game/GameAssembly.dll':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','build/native/il2cpp/script.json':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','build/native/il2cpp/il2cpp_ghidra.h':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
 for f,s in pins.items():assert sha((r/f).read_bytes())==s
 pe=PEImage((r/'build/runtime/game/GameAssembly.dll').read_bytes());symbols=json.loads((r/'build/native/il2cpp/script.json').read_text());all_methods=symbols['ScriptMethod'];rows=[];texts={};receipts=[]
 batches=[(h/'native-special-members',[0x27d830,0x27db30,0x27de40,0x5f85d0,0x5f8600]),(r/'build/native/v18-owned-character-entry-confirmed',[0x52c020]),(r/'build/native/initial-party',[0x537ca0]),(r/'build/native/v19-character-growth-entry-confirmed',[0x4ea5d0,0x530180]),(r/'build/native/v19-character-growth-learning',[0x334390]),(r/'build/native/v16-party-entry',[0x27d1b0]),(r/'build/native/v16-party-slots',[0xb540b0]),(r/'build/native/v17-roster-lifecycle',[0xb55b10])]
 for folder,requested in batches:
  receipt_bytes=(folder/'complete.json').read_bytes();receipt=json.loads(receipt_bytes);assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
  for k,f in [('nativeSha256','build/runtime/game/GameAssembly.dll'),('symbolsSha256','build/native/il2cpp/script.json'),('headerSha256','build/native/il2cpp/il2cpp_ghidra.h')]:assert receipt[k]==pins[f]
  receipts.append({'file':str(folder/'complete.json'),'sha256':sha(receipt_bytes)})
  for addr in requested:
   m=[m for m in receipt['methods']if int(m['rva'],16)==addr];assert len(m)==1;m=m[0];aliases=[m for m in all_methods if m['Address']==addr];assert len(aliases)==1
   end=min(m['Address']for m in all_methods if m['Address']>addr);assert end==int(m['nextSymbolRva'],16)
   raw=pe.read(addr,end-addr)[2];c=(folder/(f'{addr:x}.c')).read_bytes();assert sha(raw)==m['nativeRangeSha256'] and sha(c)==m['decompiledSha256'];texts[addr]=c.decode();rows.append({'file':str(folder/(f'{addr:x}.c')),'fullname':aliases[0]['Name'],'rva':hex(addr),'nextRva':hex(end),'bytes':len(raw),'rawSha256':sha(raw),'cSha256':sha(c)})
 assert 'iVar3 == 0x11' in texts[0x5f85d0] and 'iVar3 == 0x12' in texts[0x5f8600]
 assert '__Get(__this_00,8,8' in texts[0x27d830] and '__AddEquippedItem(0xc' in texts[0x27d830] and '__RefitEquip(0xc' in texts[0x27d830]
 assert 'LearningRampage' not in texts[0x27d830]
 for addr,sid in [(0x27db30,'0x11'),(0x27de40,'0x12')]:
  t=texts[addr];assert '__GetOwnedCharactersClone(__this,true' in t and '__set_AdditionalExp' in t and '__SetCharacterStatus' in t and '__SetOwnedCharacter' in t;assert f'({sid},-1,1,true,true,false' in t
 assert '(__this->fields).parameter = pLVar12' in texts[0x52c020] and 'Last_Data_PlayerCharacterParameter___ctor' in texts[0x52c020]
 assert 'Last_Data_ParameterBase___ctor' in texts[0x537ca0] and 'currentAllInCondtionList' in texts[0x537ca0]
 # Generic MasterManager and property aliases are checked as metadata/raw facts,
 # not assigned the decompiler's first shared Ability signature.
 metadata=[]
 for addr in [0x1feb5d8,0x1feb6d0]:
  matches=[x for x in symbols['ScriptMetadataMethod']if x['Address']==addr];assert len(matches)==1;metadata+=matches
 assert 'GetData<ExpTable>' in metadata[0]['Name'] and 'GetData<CharacterStatus>' in metadata[1]['Name']
 dump=(r/'build/native/il2cpp/dump.cs').read_bytes();txt=dump.decode();interface=txt.split('public interface IStatusUpProvider //')[1].split('public interface IUniqueUpdateParameterProvider //')[0]
 assert 'Slot: 1' in interface and 'OwnedCharacterData Execution(' in interface
 out={'kind':'source-special-owned-members-native-check-v1','result':'passed-static-only','pins':pins,'methods':rows,'receipts':receipts,'metadataBindings':metadata,'dumpSha256':sha(dump),'ownMethods':5,'ownNativeBytes':1968,'cachedMethods':len(rows)-5,'nativeExecuted':False,'semanticsVerified':False}
 a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'result':out['result'],'methods':len(rows),'own':5,'cached':len(rows)-5}))
if __name__=='__main__':main()
