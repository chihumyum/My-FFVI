"""Bind bounded post-battle research to original PE/metadata. Never execute it."""
from pathlib import Path
import argparse, hashlib, json, re, struct, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from inspect_pe import PEImage

def sha(blob): return hashlib.sha256(blob).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root',type=Path,required=True)
    parser.add_argument('--research-root',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args(); root=args.input_root.resolve(); work=args.research_root.resolve()
    native=(root/'build/runtime/game/GameAssembly.dll').read_bytes(); pe=PEImage(native)
    symbols_bytes=(root/'build/native/il2cpp/script.json').read_bytes(); symbols=json.loads(symbols_bytes)
    header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes(); dump=(root/'build/native/il2cpp/dump.cs').read_text()
    metadata=(root/'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat').read_bytes()
    assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
    assert sha(metadata)=='9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'
    batches=[(root/'build/wip/source-post-battle-checks-proposal/native',[0x272e10,0x2829d0]),
      (work/'native-owners',[0x28edf0,0x27cf00,0x5f8d10,0x5fb260,0x5f8360,0x15aed10]),
      (root/'build/wip/source-gau-lifecycle-family/native-entry',[0x871840,0x6d0dc0]),
      (root/'build/native/v21-battle-entry-owned',[0x409a70]),
      (root/'build/native/v16-party-entry',[0xb47660])]
    receipts=[]; methods=[]; bodies={}
    for folder,requested in batches:
        receipt_bytes=(folder/'complete.json').read_bytes(); receipt=json.loads(receipt_bytes)
        assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
        assert receipt['nativeSha256']==sha(native) and receipt['symbolsSha256']==sha(symbols_bytes) and receipt['headerSha256']==sha(header)
        receipts.append({'file':str(folder/'complete.json'),'sha256':sha(receipt_bytes)})
        for address in requested:
            matches=[r for r in receipt['methods'] if int(r['rva'],16)==address];assert len(matches)==1
            row=matches[0]; blob=pe.read(address,int(row['nextSymbolRva'],16)-address)[2]; c=(folder/(format(address,'x')+'.c')).read_bytes()
            aliases=[r for r in symbols['ScriptMethod'] if r['Address']==address];assert len(aliases)==1
            assert sha(blob)==row['nativeRangeSha256'] and sha(c)==row['decompiledSha256']
            bodies[address]=c.decode();methods.append({'rva':hex(address),'name':aliases[0]['Name'],'nativeBytes':len(blob),'nativeRangeSha256':sha(blob),'cFile':str(folder/(format(address,'x')+'.c')),'cSha256':sha(c),'sharedCallsNotAssignedSemantics':row['sharedCalls']})
    assert 'iVar6 == -0x3e9' in bodies[0x272e10] and 'uVar1 == 0x100' in bodies[0x272e10]
    assert '__Set(pLVar7,8,9,0' in bodies[0x272e10] and '__Set(pLVar7,0xb,1,-1' in bodies[0x272e10]
    assert 'iVar3 == 0xd6' in bodies[0x5f8360] and 'iVar3 == 4' in bodies[0x5f8d10]
    assert 'characterNum' in bodies[0x5fb260] and 'isCorpsMember = true' in bodies[0x5fb260]
    assert '__Set(pLVar12,0xb,3,0' in bodies[0x2829d0] and 'iVar9 == 1' in bodies[0x2829d0]
    assert 'Random__Range_10133f0(0,100)' in bodies[0x2829d0] and 'iVar11 < 1' in bodies[0x2829d0]
    assert '__ReserveScript' in bodies[0x28edf0] and '__SecedeShadow' in bodies[0x28edf0]
    assert 'bool isAll' in bodies[0x871840] and 'if (isAll)' in bodies[0x871840]
    d=Cs(CS_ARCH_X86,CS_MODE_64); assembly=lambda address,size:[{'rva':hex(r.address-pe.image_base),'hex':r.bytes.hex(),'instruction':r.mnemonic+' '+r.op_str} for r in d.disasm(pe.read(address,size)[2],pe.image_base+address)]
    context=assembly(0x2ad6d4,0x78)
    assert any(r['instruction']=='call 0x1800505e0' for r in context) and any(r['instruction']=='call 0x1800505f0' for r in context)
    assert sum(r['instruction']=='mov edx, 3' for r in context)==2
    assert sum(r['instruction']=='call 0x180e5f1d0' for r in context)==2
    assert pe.read(0x505e0,16)[2].hex()=='4881c1b8010000488911e971cc1400cc'
    assert pe.read(0x505f0,16)[2].hex()=='4881c1c0010000488911e961cc1400cc'
    meta={r['Address']:r for r in symbols['ScriptMetadata']}; arrays=[]
    for name,offset,reference,values in [
      ('98B7EDA825213E8FF74D369043D45CDC5FCD1C6C',0x4df2a2,0x1fccf20,[97,123,147]),
      ('75D2BC4329FCE5EEB1342BF7EA5821B2491033C4',0x4def52,0x1fcd168,[108,125,158])]:
        assert meta[reference]['Name']=='Field$<PrivateImplementationDetails>.'+name
        assert re.search(re.escape(name)+r' /\*Metadata offset '+hex(offset).upper().replace('0X','0x')+r'\*/',dump)
        blob=metadata[offset:offset+12]; assert hashlib.sha1(blob).hexdigest().upper()==name and list(struct.unpack('<3i',blob))==values
        arrays.append({'fieldName':name,'metadataOffset':hex(offset),'metadataFieldReference':hex(reference),'bytes':blob.hex(),'sha256':sha(blob),'values':values})
    assert 'shadowSecedeStartList; // 0x1B8' in dump and 'shadowSecedeStopList; // 0x1C0' in dump
    raw_shared=[]
    for address,size in [(0x8e07a0,32),(0x4a4810,64),(0x505e0,16),(0x505f0,16)]:
        raw=pe.read(address,size)[2]; raw_shared.append({'rva':hex(address),'rawHex':raw.hex(),'sha256':sha(raw),'allAliases':[r for r in symbols['ScriptMethod'] if r['Address']==address],'assembly':assembly(address,size),'acceptedAliasDecompilation':False})
    assert pe.read(0x8e07a0,7)[2].hex()=='488b8988000000'
    assert any(r['instruction']=='mov eax, dword ptr [rax + 0x20]' for r in assembly(0x4a4810,64))
    report={'kind':'source-post-battle-native-static-v1','result':'passed','nativeSha256':sha(native),'symbolsSha256':sha(symbols_bytes),'headerSha256':sha(header),'metadataSha256':sha(metadata),'dumpSha256':sha(dump.encode()),
      'receipts':receipts,'completeMethods':methods,'methodCount':len(methods),'staticInitializer':{'rva':'0x2a1e70','boundedCallContext':context,'rangeSha256':sha(pe.read(0x2ad6d4,0x78)[2]),'arrays':arrays},'sharedRawCode':raw_shared,
      'limitations':['CursedShield conversion remains gated pending exact SetEquip/stock/parameter transaction.','Shadow reached fixedPreeMptiveState and BattleActLog remain gated; AddLog body does not prove all publication/cancellation call sites.','RemoveShadowInBattle always reserves a field script, including an absent Shadow; no whole instruction no-op.'],
      'nativeExecuted':False,'semanticsVerified':False,'nativeDynamicParity':False}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':'passed','methods':len(methods),'arrays':[a['values'] for a in arrays]}))
if __name__=='__main__': main()
