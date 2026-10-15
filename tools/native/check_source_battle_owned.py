"""Recheck bounded/cached owned battle and reserved-script static evidence."""
from pathlib import Path
import argparse
import hashlib
import json
from inspect_pe import PEImage

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root',type=Path,required=True)
    parser.add_argument('--research-root',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    root,research=args.input_root.resolve(),args.research_root.resolve()
    native=(root/'build/runtime/game/GameAssembly.dll').read_bytes()
    assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
    pe=PEImage(native)
    symbols_bytes=(root/'build/native/il2cpp/script.json').read_bytes()
    symbols=json.loads(symbols_bytes)
    header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
    batches=[(research/'native-owned',[0x2649d0,0x26aa40,0x27d830,0x5f28e0,0x5f4e10,0x5f9040,0x5fb430,0x5fb490,0x5fb4f0]),
             (research/'native-queue-owner',[0x278cc0,0x2e1960]),
             (root/'build/native/event-operators',[0x5f2530]),
             (root/'build/native/v16-party-entry',[0x27d1b0]),
             (root/'build/wip/source-gau-lifecycle-family/native-entry',[0x26a870,0x279af0,0x27d6b0,0x281df0,0x28e170,0x290710,0x5f9160,0x6d0dc0,0x871840,0xb42a80]),
             (root/'build/wip/source-post-battle-checks-family/native-owners',[0x28edf0])]
    receipts,methods,texts=[],[],{}
    for folder,requested in batches:
        raw=(folder/'complete.json').read_bytes();receipt=json.loads(raw)
        assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
        assert receipt['nativeSha256']==sha(native) and receipt['symbolsSha256']==sha(symbols_bytes) and receipt['headerSha256']==sha(header)
        receipts.append({'path':str(folder/'complete.json'),'sha256':sha(raw)})
        for rva in requested:
            rows=[r for r in receipt['methods']if int(r['rva'],16)==rva];assert len(rows)==1
            row=rows[0];blob=pe.read(rva,int(row['nextSymbolRva'],16)-rva)[2]
            c=(folder/(format(rva,'x')+'.c')).read_bytes()
            identities=[r for r in symbols['ScriptMethod']if r['Address']==rva];assert len(identities)==1
            assert sha(blob)==row['nativeRangeSha256'] and sha(c)==row['decompiledSha256']
            methods.append({'rva':hex(rva),'nativeBytes':len(blob),'nativeSha256':sha(blob),'cSha256':sha(c),'identity':identities[0]})
            texts[rva]=c.decode()
    assert 'if ((__this->fields).working != false)' in texts[0x5f2530]
    assert 'json == (System_String_o *)0x0' in texts[0x5f2530] and 'reservedScript' in texts[0x5f2530]
    assert 'bool changeAsset' in texts[0x27d1b0] and 'bool recovery,bool isRefitEquip' in texts[0x27d1b0]
    assert 'iVar5 == 4' in texts[0x28edf0] and '__ReserveScript' in texts[0x28edf0]
    assert '_ConditionType_k__BackingField == 0x266' in texts[0x5f9040]
    assert '__GetCharacterIdFromStatusId' in texts[0x27d830] and '__JoinCharacter' in texts[0x27d830]
    aliases=[]
    for rva,size,prefix in [(0x5f1dd0,32,'4883c17033d248c70100000000'),(0x2ca530,48,'4883ec28488b4910')]:
        blob=pe.read(rva,size)[2]
        assert blob.hex().startswith(prefix)
        all_aliases=[r for r in symbols['ScriptMethod']if r['Address']==rva]
        assert len(all_aliases)>1
        aliases.append({'rva':hex(rva),'bytes':size,'sha256':sha(blob),'hex':blob.hex(),'allAliases':all_aliases,'guessedDecompilationAccepted':False})
    literals=[]
    for address,expected in [(0x1fd57f8,'sc_e_0239'),(0x1fd5850,'sc_secede_shadow'),(0x1feb3d8,'handsUpB00'),(0x1feb520,'winR00'),(0x1feb418,'handsUp00'),(0x1feb260,'WalkL01')]:
        rows=[r for r in symbols['ScriptString']if r['Address']==address]
        assert len(rows)==1 and rows[0]['Value']==expected
        literals.append(rows[0])
    report={'kind':'source-battle-owned-static-check-v1','result':'passed','nativeSha256':sha(native),'symbolsSha256':sha(symbols_bytes),'headerSha256':sha(header),
            'receipts':receipts,'methods':methods,'methodCount':len(methods),'nativeBytes':sum(m['nativeBytes']for m in methods),'sharedAliases':aliases,'sourceLiterals':literals,
            'originalNativeExecuted':False,'semanticsVerified':False,'dynamicParity':False}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'result':'passed','methods':len(methods),'nativeBytes':report['nativeBytes'],'aliases':len(aliases)}))

if __name__=='__main__':
    main()
