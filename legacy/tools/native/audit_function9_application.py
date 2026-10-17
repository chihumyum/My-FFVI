"""Read bounded cached native evidence and PE bytes. No Ghidra or DLL execution."""
from pathlib import Path
import argparse
import hashlib
import json
from inspect_pe import PEImage

PINS = {
    'nativeSha256': ('build/runtime/game/GameAssembly.dll', '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
    'symbolsSha256': ('build/native/il2cpp/script.json', '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),
    'headerSha256': ('build/native/il2cpp/il2cpp_ghidra.h', '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'),
}
def sha(data): return hashlib.sha256(data).hexdigest()
def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--source-root', type=Path, required=True)
    args.add_argument('--death-provider', type=Path, required=True)
    args.add_argument('--output', type=Path, required=True)
    opt = args.parse_args()
    opt.output.unlink(missing_ok=True)
    root = opt.source_root
    for path, expected in PINS.values(): assert sha((root/path).read_bytes()) == expected, path
    pe = PEImage((root/PINS['nativeSha256'][0]).read_bytes())
    symbols = json.loads((root/PINS['symbolsSha256'][0]).read_text())['ScriptMethod']
    addresses = sorted({m['Address'] for m in symbols})
    methods, texts = [], {}
    for directory, requested, exact in [
        (opt.death_provider, {0x33bf40}, True),
        (root/'build/native/condition-actions', {0x4f1d70, 0x4f2630}, False),
        (root/'build/native/condition-eligibility', {0x4ac5f0, 0x3d5e50}, False),
        (root/'build/native/condition-hit', {0xa91a90}, False),
        (root/'build/native/condition-silence', {0x33bd40}, False),
        (root/'build/native/revival-lifecycle', {0x5282a0, 0x527eb0}, False),
    ]:
        receipt_bytes = (directory/'complete.json').read_bytes()
        receipt = json.loads(receipt_bytes)
        assert receipt['status'] == 'complete' and receipt['semanticsVerified'] is False
        for key, (_, expected) in PINS.items(): assert receipt[key] == expected
        if exact: assert {int(m['rva'], 0) for m in receipt['methods']} == requested
        for rva in sorted(requested):
            entries = [m for m in receipt['methods'] if int(m['rva'], 0) == rva]
            assert len(entries) == 1
            value = entries[0]
            end = min(a for a in addresses if a > rva)
            assert int(value['nextSymbolRva'], 0) == end
            assert len([m for m in symbols if m['Address'] == rva]) == 1
            native = pe.read(rva, end-rva)[2]
            text = (directory/(hex(rva)[2:]+'.c')).read_bytes()
            assert sha(native) == value['nativeRangeSha256'] and sha(text) == value['decompiledSha256']
            methods.append({**value, 'receiptSha256': sha(receipt_bytes), 'bytes': len(native)})
            texts[rva] = text.decode()
    death = texts[0x33bf40]
    assert '._37_IsUndead.methodPtr' in death and 'if (iVar9 == 3)' in death
    assert death.index('if (iVar9 == 3)') < death.index('get_ProcessProg')
    assert 'AddCondition' in texts[0x4f1d70] and '_Value1_k__BackingField' in texts[0x4f2630]
    assert 'GetAddConditionStatus' in texts[0x3d5e50]
    assert 'if (0xff < accuracyRate)' in texts[0xa91a90] and 'accuracyRate = 0xff;' in texts[0xa91a90]
    assert 'UnableFightConditionFunction__Start' in texts[0x5282a0] and 'UnableFightConditionFunction__Remove' in texts[0x527eb0]
    assert next(m['bytes'] for m in methods if m['rva']=='0x33bf40') == 1024
    report = {'kind': 'source-function9-native-v1', 'pins': {k: v for k, (_, v) in PINS.items()},
              'methods': methods, 'newExportMethods': 1, 'newExportBytes': 1024,
              'nativeExecuted': False, 'semanticsVerified': False}
    opt.output.parent.mkdir(parents=True, exist_ok=True)
    opt.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'methods': len(methods), 'newExportMethods': 1, 'newExportBytes': 1024,
                      'reportSha256': sha(opt.output.read_bytes()), 'nativeExecuted': False}))
if __name__ == '__main__': main()
