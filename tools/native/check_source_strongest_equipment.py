"""Verify bounded strongest-equipment research against the supplied PE; never run it."""
import argparse,hashlib,json
from pathlib import Path
from inspect_pe import PEImage

def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-root',type=Path,required=True);p.add_argument('--research-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();r=a.input_root.resolve();h=a.research_root.resolve()
 pins={'build/runtime/game/GameAssembly.dll':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','build/native/il2cpp/script.json':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','build/native/il2cpp/il2cpp_ghidra.h':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
 for f,s in pins.items():assert sha((r/f).read_bytes())==s
 pe=PEImage((r/'build/runtime/game/GameAssembly.dll').read_bytes());symbols=json.loads((r/'build/native/il2cpp/script.json').read_text());all_methods=symbols['ScriptMethod'];rows=[];texts={};receipts=[]
 batches=[(h/'native-strongest',[0x32e5e0,0x334c20,0x334d40,0x8051f0,0x805230]),(h/'native-selection',[0x32df70,0x804be0,0x804c70,0x804d00]),(h/'native-lookup',[0xb45d40]),(r/'build/native/source-owned-equipment-selectors',[0x297840,0x2978d0,0x297920]),(r/'build/native/equipment-fixed',[0xab5530]),(r/'build/native/v27-empty-equipment',[0x8df660,0x8dfb00]),(r/'build/native/equipment-change',[0x8e07c0,0x8e08c0]),(r/'build/native/equipment-transaction',[0x333110])]
 for folder,requested in batches:
  receipt_bytes=(folder/'complete.json').read_bytes();receipt=json.loads(receipt_bytes);assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
  for k,f in [('nativeSha256','build/runtime/game/GameAssembly.dll'),('symbolsSha256','build/native/il2cpp/script.json'),('headerSha256','build/native/il2cpp/il2cpp_ghidra.h')]:assert receipt[k]==pins[f]
  receipts.append({'file':str(folder/'complete.json'),'sha256':sha(receipt_bytes)})
  for addr in requested:
   match=[m for m in receipt['methods']if int(m['rva'],16)==addr];assert len(match)==1;m=match[0];aliases=[m for m in all_methods if m['Address']==addr];assert len(aliases)==1
   end=min(m['Address']for m in all_methods if m['Address']>addr);assert end==int(m['nextSymbolRva'],16)
   section,offset,raw=pe.read(addr,end-addr);c=(folder/(f'{addr:x}.c')).read_bytes();assert sha(raw)==m['nativeRangeSha256'] and sha(c)==m['decompiledSha256'];texts[addr]=c.decode();rows.append({'file':str(folder/(f'{addr:x}.c')),'fullname':aliases[0]['Name'],'signature':aliases[0]['Signature'],'rva':hex(addr),'nextRva':hex(end),'bytes':len(raw),'section':section,'fileOffset':offset,'rawSha256':sha(raw),'cSha256':sha(c)})
 shared=json.loads((h/'native-selection-proposal.json').read_text())['peOnlyShared'];assert [int(x['rva'],16)for x in shared]==[0x3d0290,0x805240,0x805260,0x805290,0x33b540,0x806470,0x33ae60]
 for q in shared:
  addr=int(q['rva'],16);aliases=[m for m in all_methods if m['Address']==addr];end=min(m['Address']for m in all_methods if m['Address']>addr)
  assert q['nextRva']==hex(end) and q['bytes']==end-addr and q['fullnames']==[x['Name']for x in aliases] and q['signatures']==[x['Signature']for x in aliases]
  sec,off,raw=pe.read(addr,end-addr);assert sha(raw)==q['nativeRangeSha256'] and raw.hex()==q['hex'] and sec==q['section'] and off==q['fileOffset']
 assert '4883ec284885d274088b42184883c428c3' in shared[-1]['hex']
 dump=(r/'build/native/il2cpp/dump.cs').read_bytes();owned=dump.decode().split('public class OwnedItemData //')[1].split('// Methods')[0];assert 'private readonly int <SortId>k__BackingField; // 0x18' in owned
 for addr in [0x8df660,0x8dfb00]:assert '_SortId_k__BackingField = ' in texts[addr] and '__get_SortId_4a4a40' in texts[addr]
 assert '__OrderByDescending_' in texts[0xab5530] and 'get_EquipCount' in texts[0xab5530] and 'CanEquipped' in texts[0xab5530]
 assert '__GetNonEquipItem' in texts[0x334d40] and '__GetDominantArmItems' in texts[0x334d40] and '__GetEquipItems' in texts[0x334d40] and '__SetEquip' in texts[0x334d40]
 assert '__get_HasTwoSwordStyle' in texts[0x32df70] and '__GetDominantArm' in texts[0x32df70] and 'iVar3 == 3' in texts[0x804d00]
 assert 'v == 5' in texts[0x805230] and 'v != 6' in texts[0x805230]
 assert '__GetOwnedCharactersClone' in texts[0xb45d40] and '(__this_01,true' in texts[0xb45d40]
 out={'kind':'source-strongest-equipment-native-check-v1','result':'passed-static-only','pins':pins,'methods':rows,'receipts':receipts,'sharedPeRanges':shared,'dumpSha256':sha(dump),'ownMethods':10,'ownNativeBytes':5552,'cachedMethods':len(rows)-10,'nativeExecuted':False,'semanticsVerified':False,'limits':['No recursive callee exports or shared-address C exports.','GetStrongestEquipSlotPriority prioritizes accessories in the sibling full-equip API; non-accessory API filters them out.','Explicit two-sword/two-hand/job providers and unknown selected effects remain runtime gates.']}
 a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'result':out['result'],'methods':len(rows),'own':10,'cached':len(rows)-10,'sharedPe':len(shared)}))
if __name__=='__main__':main()
