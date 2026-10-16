"""Bounded, read-only static evidence; never start Ghidra or execute the DLL."""
from pathlib import Path
import argparse
import hashlib
import json
import sys
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
    args.add_argument('--derived', type=Path, required=True)
    args.add_argument('--provider', type=Path, required=True)
    args.add_argument('--output', type=Path, required=True)
    opt = args.parse_args()
    opt.output.unlink(missing_ok=True)
    root = opt.source_root
    for path, expected in PINS.values(): assert sha((root/path).read_bytes()) == expected, path
    pe = PEImage((root/PINS['nativeSha256'][0]).read_bytes())
    symbols = json.loads((root/PINS['symbolsSha256'][0]).read_text())['ScriptMethod']
    addresses = sorted({m['Address'] for m in symbols})
    methods = []
    texts = {}
    for directory, requested, exact in [
        (opt.derived, {0x4f5190, 0x4f5410}, True),
        (opt.provider, {0x3d78d0}, True),
        (root/'build/native/revival-chain', {0x4f4760}, False),
        (root/'build/native/magic-core', {0xa94480}, False),
        (root/'build/native/enemy-parameters', {0x4afb70}, False),
        (root/'build/native/ability-providers', {0x3419c0, 0x342080}, False),
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
    # These are finite direct PE leaves, including all shared aliases. No
    # generic first-alias semantic name is used to infer a getter's field.
    leaves = []
    for rva, expected in [(0x4afb00, bytes.fromhex('83b974010000000f97c0c3')),
                          (0x53e820, None), (0x478ff0, None), (0xaa3a99, None), (0x3d5ac0, None)]:
        end = min(a for a in addresses if a > rva)
        size = 0x17 if rva == 0xaa3a99 else end-rva
        data = pe.read(rva, size)[2]
        if expected: assert data.startswith(expected)
        if rva == 0x53e820: assert bytes.fromhex('8b80b4000000') in data
        leaves.append({'rva': hex(rva), 'bytes': size, 'sha256': sha(data),
                       'aliases': [m['Name'] for m in symbols if m['Address'] == rva]})
    assert 'case 0x21:' in texts[0x3419c0] and 'BaseValueFixedHPMagicFunction_TypeInfo' in texts[0x3419c0]
    assert 'case 0x21:' in texts[0x342080] and 'BattleFunction4_TypeInfo' in texts[0x342080]
    assert 'BaseValueFixedHPFunction__Calc' in texts[0x4f5190] and '._39_IsBoss.methodPtr' in texts[0x4f5190]
    assert 'currentHP - iVar5' in texts[0x4f5410]
    compact = ''.join(texts[0x3d78d0].split())
    assert ',1,0,contentFlagGroupId,false,false,false,false,false,false,0,' in compact
    assert 'if (fixType == 1)' in texts[0xa94480] and 'iStack_128 = standardValue;' in texts[0xa94480]
    assert 'bossFlag = iVar5' in texts[0x4afb70]
    report = {'kind': 'source-base-hp-magic-native-v1', 'pins': {k: v for k, (_, v) in PINS.items()},
              'methods': methods, 'leaves': leaves, 'newExportMethods': 3, 'newExportBytes': 2336,
              'nativeExecuted': False, 'semanticsVerified': False}
    opt.output.parent.mkdir(parents=True, exist_ok=True)
    opt.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'methods': len(methods), 'newExportMethods': 3, 'newExportBytes': 2336,
                      'reportSha256': sha(opt.output.read_bytes()), 'nativeExecuted': False}))
if __name__ == '__main__': main()
