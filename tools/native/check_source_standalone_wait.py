"""Verify the bounded retained standalone-wait export against original PE bytes.

This reads local evidence only. It neither runs the game nor invokes Ghidra.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import capstone

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    root, evidence, output = args.root.resolve(), args.evidence_dir.resolve(), args.report.resolve()
    assert output.is_relative_to(root / 'build'), 'Report must remain ignored'
    digest = lambda b: hashlib.sha256(b).hexdigest()
    native = (root / 'build/runtime/game/GameAssembly.dll').read_bytes()
    symbols_bytes = (root / 'build/native/il2cpp/script.json').read_bytes()
    header = (root / 'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
    dump = (root / 'build/native/il2cpp/dump.cs').read_bytes()
    receipt_bytes = (evidence / 'complete.json').read_bytes()
    receipt = json.loads(receipt_bytes)
    assert receipt['status'] == 'complete' and receipt['semanticsVerified'] is False
    for key, value in [('nativeSha256', native), ('symbolsSha256', symbols_bytes), ('headerSha256', header)]:
        assert receipt[key] == digest(value), key
    symbols = json.loads(symbols_bytes)['ScriptMethod']
    rva = 0x2a1120
    methods = [m for m in symbols if m['Address'] == rva]
    assert len(methods) == 1 and methods[0]['Name'] == 'Last.Interpreter.Instructions.SystemCall.Current$$WaitMillisecondsInStandalone'
    assert len(receipt['methods']) == 1
    entry = receipt['methods'][0]
    assert int(entry['rva'], 16) == rva and int(entry['nextSymbolRva'], 16) == 0x2a1230
    pe = PEImage(native)
    raw = pe.read(rva, 0x110)[2]
    c_bytes = (evidence / '2a1120.c').read_bytes()
    assert digest(raw) == entry['nativeRangeSha256'] and digest(c_bytes) == entry['decompiledSha256']
    disassembler = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    disassembler.detail = True
    instructions = list(disassembler.disasm(raw, rva))
    assembly = [i.mnemonic + ' ' + i.op_str for i in instructions]
    for expected in ['call 0x82da70', 'lea edx, [r9 + 0xa]', 'lea r8d, [r9 + 7]', 'call 0x82ecc0',
                     'call 0x82e510', 'call 0x82e550', 'subsd xmm6, xmm0', 'comisd xmm6, xmm0', 'jb 0x2a1212']:
        assert expected in assembly, expected
    division = next(i for i in instructions if i.mnemonic == 'divsd')
    address = division.address + division.size + division.operands[1].mem.disp
    assert struct.unpack('<d', pe.read(address, 8)[2])[0] == 1000
    text = dump.decode()
    assert 'kWaitMillisecondsInStandalone = "PC版のみミリ秒指定で待機";' in text
    assert 'kMapLocalVariable = 10;' in text
    body = dict(kind='source-standalone-wait-static-native-audit-v1', result='passed-static-only',
                nativeSha256=digest(native), symbolsSha256=digest(symbols_bytes), headerSha256=digest(header),
                dumpSha256=digest(dump), receiptSha256=digest(receipt_bytes), method=entry,
                originalGameExecuted=False, nativeDynamicVerified=False,
                protocol=dict(readOnce='DataStorage category10 MapLocalVariable index7',
                              writes='same Core r0=milliseconds/1000,r1=entryTime',
                              firstClock='always yield', laterClock='entryTime-r1 < r0 yields; otherwise next'),
                webClock='existing FieldGame 10ms logical clock; no native dynamic parity claim')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(body, indent=2) + '\n')
    print(json.dumps(dict(result=body['result'], methods=1, nativeBytes=len(raw), report=str(output))))


if __name__ == '__main__':
    main()
