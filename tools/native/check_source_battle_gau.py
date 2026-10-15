"""Verify complete local Gau research against original PE/metadata; never execute it."""
from pathlib import Path
import argparse, hashlib, json, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from inspect_pe import PEImage

def digest(blob): return hashlib.sha256(blob).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root',type=Path,required=True)
    parser.add_argument('--research-root',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args(); root=args.input_root.resolve(); research=args.research_root.resolve()
    native=(root/'build/runtime/game/GameAssembly.dll').read_bytes(); pe=PEImage(native)
    symbols_file=root/'build/native/il2cpp/script.json'; symbols_bytes=symbols_file.read_bytes(); symbols=json.loads(symbols_bytes)
    header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes(); dump=(root/'build/native/il2cpp/dump.cs').read_text()
    batches=[(research/'native-entry',[0x871840,0xb42a80,0x6d0dc0,0x279af0,0x281df0,0x28e170,0x26a870,0x290710,0x27d6b0,0x5f9160]),
      (root/'build/wip/source-gau-mode-proposal/native',[0x2967a0]),
      (root/'build/native/v21-battle-entry-owned',[0x409a70]),
      (root/'build/native/v16-party-entry',[0xb47660]),
      (root/'build/native/v18-field-foot-monitor',[0x86e820]),
      (root/'build/native/enemy-parameters',[0x4afb70])]
    methods=[]; texts={}; receipts=[]
    for folder,requested in batches:
        path=folder/'complete.json'; receipt_bytes=path.read_bytes(); receipt=json.loads(receipt_bytes)
        assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
        assert receipt['nativeSha256']==digest(native) and receipt['symbolsSha256']==digest(symbols_bytes) and receipt['headerSha256']==digest(header)
        receipts.append({'path':str(path),'sha256':digest(receipt_bytes)})
        for rva in requested:
            matches=[row for row in receipt['methods'] if int(row['rva'],16)==rva]; assert len(matches)==1
            row=matches[0]; blob=pe.read(rva,int(row['nextSymbolRva'],16)-rva)[2]; c_path=folder/(format(rva,'x')+'.c'); c=c_path.read_bytes()
            assert digest(blob)==row['nativeRangeSha256'] and digest(c)==row['decompiledSha256']
            names=[r for r in symbols['ScriptMethod'] if r['Address']==rva]; assert len(names)==1,hex(rva)
            methods.append({'rva':hex(rva),'sourceName':names[0]['Name'],'nativeBytes':len(blob),'nativeSha256':digest(blob),'cFile':str(c_path),'cSha256':digest(c),'sharedCalls':row['sharedCalls']})
            texts[rva]=c.decode()
    assert 'bool isAll' in texts[0x871840] and 'if (isAll)' in texts[0x871840] and 'get_IsEnableCorps' in texts[0x871840]
    assert 'get_characterStatusId' in texts[0x5f9160] and 'iVar3 == 0xc' in texts[0x5f9160]
    assert '_CurrentMode_k__BackingField = 0' in texts[0x4afb70]
    assert '0x164' in texts[0xb42a80] and '__Get(pLVar9,0xb,1' in texts[0xb42a80] and 'pSVar1->m_Items[1]' in texts[0xb42a80]
    assert 'GetMemberData' in texts[0xb47660] and '_corpsList_k__BackingField' in texts[0x86e820]
    assert '__Set(__this_01,0xb,2,iVar7' in texts[0x2967a0] and 'Random__Range_10133f0(0,100)' in texts[0x2967a0]
    accessor=dump.split('public interface IBattleAccessor //')[1].split('public interface IBattleEntityAccessor //')[0]
    assert '// RVA: -1 Offset: -1 Slot: 20\n\tpublic abstract void SetEndEnable(bool isEnabled);' in accessor
    disassembler=Cs(CS_ARCH_X86,CS_MODE_64); instructions=list(disassembler.disasm(pe.read(0x2967a0,0x5a0)[2],pe.image_base+0x2967a0))
    contexts=[]
    for index,row in enumerate(instructions):
        if row.mnemonic=='call' and row.op_str in ['0x18004eb30','0x1810133f0','0x180b47660']:
            contexts.append([{'address':hex(r.address),'bytes':r.bytes.hex(),'mnemonic':r.mnemonic,'operands':r.op_str} for r in instructions[max(0,index-7):index+5]])
    assert len(contexts)==3
    end_context=next(rows for rows in contexts if any(r['operands']=='0x18004eb30' for r in rows))
    assert any(r['mnemonic']=='xor' and r['operands']=='r9d, r9d' for r in end_context)
    aliases=[]
    for rva,size in [(0x350c00,16),(0x491610,32),(0x358b20,16),(0x358b40,16)]:
        rows=[r for r in symbols['ScriptMethod'] if r['Address']==rva]; raw=pe.read(rva,size)[2]
        assert len(rows)>1
        aliases.append({'rva':hex(rva),'rawHex':raw.hex(),'sha256':digest(raw),'allAliases':rows,'acceptedDecompilation':False})
    assert aliases[0]['rawHex'].startswith('c6411001c3')
    report={'kind':'source-gau-lifecycle-static-check-v1','result':'passed','nativeSha256':digest(native),'symbolsSha256':digest(symbols_bytes),
      'headerSha256':digest(header),'dumpSha256':digest(dump.encode()),'receipts':receipts,'methods':methods,'methodCount':len(methods),
      'setGauModeCallContexts':contexts,'interfaceSlot20':'IBattleAccessor.SetEndEnable(false)','sharedSignatures':aliases,
      'sourceExecution':False,'semanticsVerified':False,'nativeDynamicParity':False}
    args.report.parent.mkdir(parents=True,exist_ok=True); args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'result':report['result'],'methods':len(methods),'sharedSignatureGroups':len(aliases)}))
if __name__=='__main__': main()
