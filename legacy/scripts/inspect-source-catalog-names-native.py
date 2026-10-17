#!/usr/bin/env python3
"""Recheck the one complete name getter and bounded callsites; never runs Ghidra.
The shared six MessageManager bodies have their existing separate verifier.
Original code bytes and decompilation remain in ignored research artifacts.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import capstone
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.native.inspect_pe import PEImage
PINS = {
    'nativeSha256': ('build/runtime/game/GameAssembly.dll', '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
    'symbolsSha256': ('build/native/il2cpp/script.json', '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),
    'headerSha256': ('build/native/il2cpp/il2cpp_ghidra.h', '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'),
}
sha = lambda b: hashlib.sha256(b).hexdigest()
def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--cache', required=True); parser.add_argument('--output', required=True)
    opt = parser.parse_args(); cache = Path(opt.cache).resolve(); out = Path(opt.output).resolve()
    assert out.is_relative_to(ROOT / 'build'), 'Native evidence must remain ignored'
    blobs = {}
    for key, (name, digest) in PINS.items():
        blobs[key] = (ROOT / name).read_bytes(); assert sha(blobs[key]) == digest, 'Changed native identity ' + key
    pe = PEImage(blobs['nativeSha256']); symbols = json.loads(blobs['symbolsSha256'])['ScriptMethod']
    complete_bytes = (cache / 'complete.json').read_bytes(); complete = json.loads(complete_bytes)
    assert complete['status'] == 'complete' and complete['semanticsVerified'] is False
    for key, (_, digest) in PINS.items(): assert complete[key] == digest
    assert len(complete['methods']) == 1
    m = complete['methods'][0]; assert m['rva'] == '0x1583650' and m['nextSymbolRva'] == '0x1583850'
    native = pe.read(0x1583650, 512)[2]; body = (cache / '1583650.c').read_bytes()
    assert sha(native) == m['nativeRangeSha256'] == '69ece1556613d67bb64082376de885432f047809debaf687fdff68e06447e96d'
    assert sha(body) == m['decompiledSha256'] == '27d799c855700b6777c1b76445aba0c56e15a23be7ac495255e1504ac095bd45'
    aliases = lambda rva: [s for s in symbols if s['Address'] == rva]
    assert any(s['Name'] == 'Last.Battle.BattleEnemyData$$GetMesIdName' for s in aliases(0x1583650))
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    def instructions(rva, size):
        raw = pe.read(rva, size)[2]
        return {'rva': hex(rva), 'bytes': size, 'sha256': sha(raw), 'allAliases': aliases(rva),
                'instructions': [{'rva': hex(d.address), 'mnemonic': d.mnemonic, 'operands': d.op_str} for d in cs.disasm(raw, rva)]}
    callers = [instructions(rva, 208) for rva in (0x550df0, 0x772750)]
    for c in callers:
        rows = c['instructions']
        a = next(i for i, r in enumerate(rows) if r['mnemonic'] == 'call' and r['operands'] == '0x1583650')
        b = next(i for i, r in enumerate(rows) if i > a and r['mnemonic'] == 'call' and r['operands'] == '0x31cae0')
        assert any(r['mnemonic'] == 'mov' and r['operands'] == 'r8b, 1' for r in rows[a:b])
        assert any(r['mnemonic'] == 'mov' and r['operands'] == 'rdx, rax' for r in rows[a:b])
    predicate = instructions(0x158f4a0, 48)
    assert any(r['mnemonic'] == 'call' and r['operands'] == '0x4a4a40' for r in predicate['instructions'])
    assert any(r['mnemonic'] == 'cmp' and r['operands'] == 'eax, 0x1b5' for r in predicate['instructions'])
    assert any(s['Name'] == 'Last.Data.Master.Condition$$get_ConditionType' for s in aliases(0x4a4a40))
    result = {'kind': 'source-catalog-name-native-v1', 'result': 'passed-static-contract-not-native-gameplay',
              'pins': {key: digest for key, (_, digest) in PINS.items()}, 'completeSha256': sha(complete_bytes),
              'getter': m, 'getterAliases': aliases(0x1583650), 'nameLookupCallsites': callers, 'specialConditionPredicate': predicate,
              'conditionGetterAliases': aliases(0x4a4a40), 'completeDecompiledMethods': 1, 'rawVerifiedBytes': 976,
              'sharedMessageManagerMethods': 'separate six-method cached verifier required', 'specialCondition437Implemented': False,
              'sourceExecutions': 0, 'nativeGameplay': False}
    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'result': result['result'], 'methods': 1, 'bytes': 976, 'reportSha256': sha(out.read_bytes())}))
if __name__ == '__main__': main()
