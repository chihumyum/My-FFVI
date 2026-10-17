"""Extract the local build's bounded native Rage dictionary into ignored JSON.

The author tree contains extraction logic and digests only. The 252 game data
pairs remain an output under build/, never a redistributable Python constant.
"""
from pathlib import Path
import argparse
import hashlib
import json
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from inspect_pe import PEImage

NATIVE_SHA = '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
PREFIX_SHA = '2887292293db18b7bad8f2d84fd190186a3bb7c273124695afae82853265ba23'
RANGE_SHA = '78d1fc8de4845e53173045b7f31988928414236fcd8be73d2f5cddcca9c2e5a2'
SETTER_SHA = '24871d5524e1a7ce07034ab66a0805437f71e87fa75818982b933ef27b1f8482'
PAIRS_SHA = '36a9a7abc572f08410fd0f1588c55af0a16039ca5cdcbc89b93cfe5d559674c7'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def extract(native):
    if sha(native) != NATIVE_SHA:
        raise ValueError('Unsupported native build')
    pe = PEImage(native)
    prefix, span, setter = (pe.read(rva, size)[2] for rva, size in
                            [(0x2abcea, 33), (0x2abd0b, 6580), (0x50170, 16)])
    if [sha(prefix), sha(span), sha(setter)] != [PREFIX_SHA, RANGE_SHA, SETTER_SHA]:
        raise ValueError('Native dictionary construction, range or Current static setter changed')
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    ops = list(cs.disasm(span, pe.image_base + 0x2abd0b))
    if not ops or ops[-1].address + ops[-1].size != pe.image_base + 0x2ad6bf:
        raise ValueError('Incomplete bounded native dictionary')
    if ops[-1].mnemonic != 'call' or ops[-1].op_str != hex(pe.image_base + 0x50170):
        raise ValueError('Missing Current static+1a8 dictionary publication')
    pairs, calls = [], []
    for index, op in enumerate(ops):
        if op.mnemonic != 'call' or op.op_str != hex(pe.image_base + 0x4e5f0):
            continue
        context = ops[max(0, index - 5):index]
        values = {}
        for row in context:
            if row.mnemonic == 'mov':
                dst, _, value = row.op_str.partition(', ')
                if dst in ['edx', 'r8d']:
                    values[dst] = int(value, 0)
        if set(values) != {'edx', 'r8d'} or not any(row.mnemonic == 'mov' and row.op_str == 'rcx, rbx' for row in context):
            raise ValueError('Unclosed dictionary Add argument flow')
        pairs.append([values['edx'], values['r8d']])
        calls.append(hex(op.address - pe.image_base))
    if len(pairs) != 252 or sha(json.dumps(pairs, separators=(',', ':')).encode()) != PAIRS_SHA:
        raise ValueError('Native Rage mapping changed')
    return {'kind': 'source-native-rage-map-v1', 'nativeSha256': NATIVE_SHA,
            'construction': {'rva': 0x2abcea, 'bytes': 33, 'sha256': PREFIX_SHA},
            'range': {'rva': 0x2abd0b, 'bytes': 6580, 'sha256': RANGE_SHA},
            'setter': {'rva': 0x50170, 'bytes': 16, 'sha256': SETTER_SHA},
            'pairsSha256': PAIRS_SHA, 'pairs': pairs, 'addCallRvas': calls,
            'nativeExecuted': False, 'dynamicParity': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Original data must stay in an ignored build product, not an author path.
    output = args.output.resolve()
    if 'build' not in output.parts or output.suffix != '.json':
        raise ValueError('Native mapping output must be build/*.json')
    value = extract(args.native.read_bytes())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps({'result': 'passed-static-extraction', 'pairs': len(value['pairs']),
                      'outputSha256': sha(output.read_bytes()), 'nativeExecuted': False}))

if __name__ == '__main__':
    main()
