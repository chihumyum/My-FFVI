"""Read-only bounded Boss wrapper and shared return PE audit; no native execution."""
import argparse, bisect, hashlib, json, struct, sys
from pathlib import Path
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--output', type=Path, default=Path('build/reports/source-boss-native'))
args = parser.parse_args()
root = args.root.resolve()
out = (root / args.output).resolve()
assert out.is_relative_to(root / 'build'), 'Original evidence remains ignored'
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.native.inspect_pe import PEImage

paths = {
    'native': 'build/runtime/game/GameAssembly.dll',
    'symbols': 'build/native/il2cpp/script.json',
    'header': 'build/native/il2cpp/il2cpp_ghidra.h',
    'metadata': 'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat',
}
expected = {
    'native': '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
    'symbols': '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',
    'header': '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718',
    'metadata': '9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45',
}
buffers = {name: (root / path).read_bytes() for name, path in paths.items()}
sha = lambda value: hashlib.sha256(value).hexdigest()
assert {name: sha(data) for name, data in buffers.items()} == expected
symbols = json.loads(buffers['symbols'])
addresses = sorted(set(method['Address'] for method in symbols['ScriptMethod']))
by_address = {}
for method in symbols['ScriptMethod']:
    by_address.setdefault(method['Address'], []).append(method)
metadata = {}
for row in symbols['ScriptMetadata'] + symbols['ScriptMetadataMethod']:
    metadata.setdefault(row['Address'], []).append(row)
strings = {}
for row in symbols['ScriptString']:
    strings.setdefault(row['Address'], []).append(row)
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
image = PEImage(buffers['native'])
methods = []
for start in [0xb50ae0, 0xb55750, 0x2ce1b0, 0x2f7ad0, 0x2cbbf0, 0x2f6850, 0x278b30, 0x4633b0, 0x673db0, 0x4b4ed0, 0x29c480, 0x46d5c0, 0x2dfe30, 0x8e4270]:
    end = next(address for address in addresses if address > start)
    _, _, raw = image.read(start, end - start)
    rows = []
    for instruction in decoder.disasm(raw, start):
        row = {'rva': hex(instruction.address), 'bytes': instruction.bytes.hex(),
               'mnemonic': instruction.mnemonic, 'operands': instruction.op_str}
        if instruction.mnemonic in ['call', 'jmp'] and len(instruction.operands) == 1 and instruction.operands[0].type == capstone.x86.X86_OP_IMM:
            target = instruction.operands[0].imm
            row.update(target=hex(target), targetSymbols=by_address.get(target, []))
        refs = []
        for operand in instruction.operands:
            if operand.type == capstone.x86.X86_OP_MEM and operand.mem.base == capstone.x86.X86_REG_RIP:
                target = instruction.address + instruction.size + operand.mem.disp
                refs.append({'rva': hex(target), 'metadata': metadata.get(target, []), 'strings': strings.get(target, [])})
        if refs:
            row['references'] = refs
        rows.append(row)
    method = {'rva': hex(start), 'endRva': hex(end), 'size': len(raw), 'sha256': sha(raw),
              'raw': raw.hex(), 'symbols': by_address.get(start, []), 'instructions': rows}
    methods.append(method)
    (out / (hex(start)[2:] + '.asm')).write_text('\n'.join(
        f"{row['rva']}: {row['mnemonic']} {row['operands']}" +
        (' ; ' + ', '.join(item['Name'] for item in row['targetSymbols']) if row.get('targetSymbols') else '') +
        (' ; ' + json.dumps(row['references'], ensure_ascii=False) if row.get('references') else '')
        for row in rows) + '\n')
callers = []
for section, address, virtual_size, raw_size, file_offset in image.sections:
    if section not in ['.text', 'il2cpp']: continue
    raw = buffers['native'][file_offset:file_offset + min(virtual_size, raw_size)]
    for index in range(len(raw) - 4):
        if raw[index] != 0xe8: continue
        call = address + index
        target = call + 5 + struct.unpack_from('<i', raw, index + 1)[0]
        if target != 0x673db0: continue
        owner_index = bisect.bisect_right(addresses, call) - 1
        assert owner_index >= 0
        owner = addresses[owner_index]
        _, _, owner_bytes = image.read(owner, call + 5 - owner)
        decoded = list(decoder.disasm(owner_bytes, owner))
        if not any(i.address == call and i.mnemonic == 'call' for i in decoded): continue
        callers.append({'call': hex(call), 'owner': hex(owner), 'methods': by_address.get(owner, []),
                        'priorBytes': raw[max(0,index-32):index+5].hex(),
                        'ownerPrefixSha256': sha(owner_bytes)})
(out / 'flag-callers.json').write_text(json.dumps({'nativeSha256': expected['native'], 'target':'0x673db0',
 'rows':callers, 'scope':'Complete direct-call instruction scan of .text and il2cpp; indirect flag queries are not inferred.',
 'sourceFlag19':'Observed StartInit SetIsAuto(false); other flag consumers remain independent gates.'}, indent=2)+'\n')
assert {name: sha((root / path).read_bytes()) for name, path in paths.items()} == expected
report = {'kind': 'source-boss-encounter-native-static-audit-v1', 'inputs': paths, 'identity': expected,
          'methods': methods, 'counts': {'methods': len(methods), 'bytes': sum(method['size'] for method in methods)},
          'newExports': 0, 'nativeExecuted': False, 'semanticsGranted': False}
(out / 'audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['counts']))
