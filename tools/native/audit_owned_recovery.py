"""Finite static packet: cached methods, exact PE ranges and delegate identities.

Never start Ghidra, export another method or execute the original DLL.
"""
from pathlib import Path
import argparse
import hashlib
import json
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM
from capstone.x86_const import X86_REG_RIP
from inspect_pe import PEImage

PINS = {
    'nativeSha256': ('build/runtime/game/GameAssembly.dll', '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
    'symbolsSha256': ('build/native/il2cpp/script.json', '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),
    'headerSha256': ('build/native/il2cpp/il2cpp_ghidra.h', '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'),
}
def sha(data): return hashlib.sha256(data).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--export',dest='export',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    opt=parser.parse_args();opt.output.unlink(missing_ok=True);root=opt.source_root
    for path,expected in PINS.values():assert sha((root/path).read_bytes())==expected,path
    pe=PEImage((root/PINS['nativeSha256'][0]).read_bytes());symbols=json.loads((root/PINS['symbolsSha256'][0]).read_text())
    addresses=sorted(set(m['Address'] for m in symbols['ScriptMethod']));md=Cs(CS_ARCH_X86,CS_MODE_64);md.detail=True
    def end(rva):return min(a for a in addresses if a>rva)
    def assembly(rva):
        return [{'rva':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str,
                 'ripReferences':[i.address+i.size+o.mem.disp for o in i.operands if o.type==CS_OP_MEM and o.mem.base==X86_REG_RIP]}
                for i in md.disasm(pe.read(rva,end(rva)-rva)[2],rva)]
    methods,texts,code=[],{},{}
    for folder,requested,exact in [
        (opt.export,{0xb53400,0xb563f0,0x337810,0x292420,0x5fb9d0},True),
        (root/'build/native/v16-party-entry',{0xb47660},False),
        (root/'build/native/v18-field-foot-monitor',{0x870230},False),
        (root/'build/native/v19-character-recovery',{0xb46410,0xb45e60},False),
        (root/'build/native/v19-character-recovery-storage',{0x330ef0,0xb45400},False),
        (root/'build/native/revival-dying',{0x7680e0},False),
    ]:
        receipt_bytes=(folder/'complete.json').read_bytes();receipt=json.loads(receipt_bytes)
        assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
        for key,(_,expected) in PINS.items():assert receipt[key]==expected
        if exact:assert {int(m['rva'],0) for m in receipt['methods']}==requested
        for rva in sorted(requested):
            rows=[m for m in receipt['methods'] if int(m['rva'],0)==rva];assert len(rows)==1;row=rows[0]
            assert int(row['nextSymbolRva'],0)==end(rva)
            assert len([m for m in symbols['ScriptMethod'] if m['Address']==rva])==1
            native=pe.read(rva,end(rva)-rva)[2];c=(folder/(hex(rva)[2:]+'.c')).read_bytes()
            assert sha(native)==row['nativeRangeSha256'] and sha(c)==row['decompiledSha256']
            methods.append({**row,'receiptSha256':sha(receipt_bytes),'bytes':len(native)})
            texts[rva]=c.decode();code[rva]=assembly(rva)
    leaves=[]
    for rva in [0x805300,0x478ff0,0x4df400,0x4dee80,0x4a4a40,0x4a4310,0x52ffc0,0x4acb30]:
        native=pe.read(rva,end(rva)-rva)[2];code[rva]=assembly(rva)
        leaves.append({'rva':hex(rva),'nextSymbolRva':hex(end(rva)),'bytes':len(native),'sha256':sha(native),
                       'aliases':[m['Name'] for m in symbols['ScriptMethod'] if m['Address']==rva],'instructions':code[rva]})
    bindings=[]
    for caller,metadata,target,name in [
        (0xb53400,0x1fd2b30,0xb563f0,'Last.Interpreter.Instructions.External.Misc.<>c__DisplayClass43_0.<SubtractionHP>b__0()'),
        (0x292420,0x1fd1a68,0x5fb9d0,'Last.Interpreter.Instructions.SystemCall.Current.<>c__DisplayClass498_0.<ReviveUnableFightCharacters>b__0()'),
        (0xb563f0,0x2002fd8,0x4a4310,'Last.Interpreter.Instructions.External.Misc.<>c__DisplayClass43_1.<SubtractionHP>b__1()'),
        (0x5fb9d0,0x20017f8,0x4a4310,'Last.Interpreter.Instructions.SystemCall.Current.<>c__DisplayClass498_1.<ReviveUnableFightCharacters>b__1()'),
        (0x5fb9d0,0x2001f00,0x478ff0,'Last.Interpreter.Instructions.SystemCall.Current.<>c.<ReviveUnableFightCharacters>b__498_2()'),
        (0x337810,0x1fff208,0x805300,'Last.Management.OwnedCharacterClient.<>c.<SubtractionHp>b__79_0()'),
    ]:
        rows=[m for m in symbols['ScriptMetadataMethod'] if m['Address']==metadata];assert len(rows)==1;row=rows[0]
        assert row['MethodAddress']==target and row['Name']=='Method$'+name
        references=[i for i in code[caller] if metadata in i['ripReferences']];assert references
        bindings.append({'callerRva':hex(caller),'metadataRva':hex(metadata),'targetRva':hex(target),'name':name,'references':references})
    def has(rva,mnemonic,operand=None):return any(i['mnemonic']==mnemonic and (operand is None or i['operands']==operand) for i in code[rva])
    assert has(0xb53400,'cvtpd2ps') and has(0xb563f0,'cvttss2si')
    assert has(0x337810,'divss') and has(0x337810,'mulss') and has(0x337810,'comiss')
    assert has(0x478ff0,'cmp','eax, 5') and has(0x805300,'cmp','eax, 4')
    assert has(0x4a4310,'call','0x52ffc0') and has(0x4df400,'call','0x4a4a40')
    assert has(0x4acb30,'jmp','0x7680e0')
    assert 'Last_Management_UserDataManager__GetMemberData' in texts[0xb53400] and 'Last_Interpreter_Instructions_External_Corps__CorpsController' in texts[0x292420]
    calls=[i['operands'] for i in code[0x5fb9d0] if i['mnemonic']=='call']
    assert calls.index('0x330ef0')<calls.index('0xb45e60')
    assert ',5,true,' in ''.join(texts[0x5fb9d0].split())
    key=[x for x in symbols['ScriptString'] if x['Address']==0x1fef938];assert len(key)==1 and key[0]['Value']=='RATE_HAVE_NEAR_DEATH'
    assert any(0x1fef938 in i['ripReferences'] for i in code[0x337810])
    report={'kind':'source-owned-recovery-native-v1','pins':{k:h for k,(_,h) in PINS.items()},'methods':methods,'leaves':leaves,'bindings':bindings,
            'newExportMethods':5,'newExportBytes':2784,'recursiveExports':0,'nativeExecuted':False,'semanticsVerified':False}
    opt.output.parent.mkdir(parents=True,exist_ok=True);opt.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'methods':len(methods),'leaves':len(leaves),'delegateBindings':len(bindings),'newExportBytes':2784,'reportSha256':sha(opt.output.read_bytes()),'nativeExecuted':False}))
if __name__=='__main__':main()
