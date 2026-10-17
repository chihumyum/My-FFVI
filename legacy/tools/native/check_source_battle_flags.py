"""Exact-source static audit of the common battle flag applicability family.

Reads original PE bytes, complete bounded native packets and typed metadata.
Does not execute native code, produce new Ghidra exports or grant an encounter.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--packet', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage
sha = lambda value: hashlib.sha256(value).hexdigest()
paths = {
    'native': ('build/runtime/game/GameAssembly.dll', '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
    'symbols': ('build/native/il2cpp/script.json', '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'),
    'header': ('build/native/il2cpp/il2cpp_ghidra.h', '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'),
    'dump': ('build/native/il2cpp/dump.cs', 'e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b'),
    'metadata': ('build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat', '9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45'),
}
buffers = {key: (root / path).read_bytes() for key, (path, expected) in paths.items()}
assert all(sha(buffers[key]) == expected for key, (_, expected) in paths.items())
symbols = json.loads(buffers['symbols'])
methods = {}
for method in symbols['ScriptMethod']:
    methods.setdefault(method['Address'], []).append(method)
addresses = sorted(methods)
image = PEImage(buffers['native'])
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True

def raw_range(start):
    end = next(rva for rva in addresses if rva > start)
    return end, image.read(start, end - start)[2]

packet = args.packet.resolve()
receipt_file = packet / 'complete.json'
receipt_bytes = receipt_file.read_bytes()
receipt = json.loads(receipt_bytes)
assert receipt['status'] == 'complete'
assert receipt['nativeSha256'] == paths['native'][1]
assert receipt['symbolsSha256'] == paths['symbols'][1]
assert receipt['headerSha256'] == paths['header'][1]
assert {int(row['rva'], 16) for row in receipt['methods']} == {0x612af0, 0x841db0, 0x674210}
packets = []
for row in receipt['methods']:
    rva = int(row['rva'], 16)
    end, raw = raw_range(rva)
    c_file = packet / (format(rva, 'x') + '.c')
    c_bytes = c_file.read_bytes()
    assert int(row['nextSymbolRva'], 16) == end
    assert sha(raw) == row['nativeRangeSha256']
    assert sha(c_bytes) == row['decompiledSha256']
    packets.append({'rva': hex(rva), 'bytes': len(raw), 'nativeRangeSha256': sha(raw),
                    'cFile': str(c_file), 'cSha256': sha(c_bytes)})

# This physical predicate has three IL2CPP aliases, including two flag lambdas
# and an unrelated equipment method. Read the PE instructions and exact lambda
# metadata, never assign the first alias's type to the shared address.
end, predicate = raw_range(0x626770)
decoded = list(decoder.disasm(predicate, 0x626770))
assert [(i.mnemonic, i.op_str) for i in decoded[:3]] == [('cmp', 'edx, 0xe'), ('sete', 'al'), ('ret', '')]
assert {m['Name'] for m in methods[0x626770]} == {
    'Serial.FF6.Management.CharacterInfomationData$$IsChangeEquipmentOnlyAccessory',
    'Last.UI.Common.ArBattleTopController.<>c$$<InitMonsterPartyList>b__52_3',
    'Last.UI.Touch.LibraryInfoController.<>c$$<SetData>b__20_3',
}
metadata = {row['Address']: row for row in symbols['ScriptMetadataMethod']}
bindings = []
for address, contains in [(0x1ff81b0, 'InitMonsterPartyList'), (0x1feefa0, 'SetData')]:
    row = metadata[address]
    assert row['MethodAddress'] == 0x626770 and contains in row['Name']
    bindings.append(row)
any_binding = metadata[0x1fce9b8]
assert any_binding['Name'] == 'Method$System.Linq.Enumerable.Any<BattleFlagType>()'
assert any_binding['MethodAddress'] == 0xb83e10
bindings.append(any_binding)
# The decompiler labels the shared master-array getter with an unrelated first
# alias. Bind MonsterParty's actual signature and master index independently.
assert any(m['Name'] == 'Last.Data.Master.MonsterParty$$get_BattleFlagGroupId' for m in methods[0x4a6030])
assert 'private const int _index_battle_flag_group_id = 12;' in buffers['dump'].decode()
getter_end, getter_bytes = raw_range(0x4a6030)
getter_instructions = list(decoder.disasm(getter_bytes, 0x4a6030))
assert any(i.mnemonic == 'mov' and i.op_str == 'eax, dword ptr [rax + 0x50]' for i in getter_instructions)

# Cached complete direct-query scan is revalidated against this exact PE and
# each owning body. Indirect queries are explicitly outside this scan's proof.
callers_file = root / 'build/reports/source-boss-native/flag-callers.json'
callers_bytes = callers_file.read_bytes()
callers = json.loads(callers_bytes)
assert callers['nativeSha256'] == paths['native'][1] and callers['target'] == '0x673db0'
queries = []
for row in callers['rows']:
    owner, call = int(row['owner'], 16), int(row['call'], 16)
    _, _, prefix = image.read(owner, call + 5 - owner)
    assert sha(prefix) == row['ownerPrefixSha256']
    instructions = list(decoder.disasm(prefix, owner))
    instruction = next(i for i in instructions if i.address == call)
    assert instruction.mnemonic == 'call' and instruction.operands[0].imm == 0x673db0
    selector = None
    for candidate in instructions[max(0, instructions.index(instruction) - 6):instructions.index(instruction)]:
        if candidate.mnemonic == 'mov' and candidate.op_str.startswith('edx, ') and candidate.operands[1].type == capstone.x86.X86_OP_IMM:
            selector = candidate.operands[1].imm
        elif candidate.mnemonic == 'lea' and candidate.op_str.startswith('edx, [r8 + '):
            # All such cached calls explicitly zero r8d immediately beforehand.
            prior = instructions[instructions.index(candidate) - 1]
            prior2 = instructions[instructions.index(candidate) - 2]
            assert any(i.mnemonic == 'xor' and i.op_str == 'r8d, r8d' for i in [prior, prior2])
            selector = candidate.operands[1].mem.disp
    assert selector is not None
    queries.append({'owner': hex(owner), 'call': hex(call), 'selector': selector, 'symbols': methods[owner]})
assert len(queries) == 35 and not any(row['selector'] == 14 for row in queries)
assert [row['selector'] for row in queries if row['owner'] == '0x4633b0'] == [17, 19]
cached_audit_file = root / 'build/reports/source-boss-native/audit.json'
cached_audit_bytes = cached_audit_file.read_bytes()
cached_audit = json.loads(cached_audit_bytes)
assert cached_audit['identity']['native'] == paths['native'][1]
cached_methods = []
for rva in [0x4633b0, 0x46d5c0, 0x8e4270]:
    row = next(m for m in cached_audit['methods'] if int(m['rva'], 16) == rva)
    finish, raw = raw_range(rva)
    assert sha(raw) == row['sha256'] and raw.hex() == row['raw'] and row['size'] == len(raw)
    cached_methods.append({'rva': hex(rva), 'bytes': len(raw), 'sha256': sha(raw)})

report = {
    'kind': 'source-battle-flags-native-static-audit-v1', 'result': 'passed-static-binding',
    'inputs': {key: {'file': str(root / path), 'sha256': expected, 'bytes': len(buffers[key])}
               for key, (path, expected) in paths.items()},
    'packet': {'file': str(receipt_file), 'sha256': sha(receipt_bytes), 'methods': packets},
    'sharedPredicate': {'rva': '0x626770', 'endRva': hex(end), 'sha256': sha(predicate),
                        'aliases': methods[0x626770], 'metadataBindings': bindings,
                        'instructions': [{'rva': hex(i.address), 'mnemonic': i.mnemonic, 'operands': i.op_str} for i in decoded]},
    'directFlagQueries': {'file': str(callers_file), 'sha256': sha(callers_bytes), 'rows': queries,
                          'scope': 'Complete cached direct calls to IsMatchBattleFlagTypes in .text/il2cpp; not an assertion about every possible indirect consumer.'},
    'masterGetter': {'rva': '0x4a6030', 'endRva': hex(getter_end), 'sha256': sha(getter_bytes),
                      'aliases': methods[0x4a6030], 'masterIndex': 12, 'masterArrayItemOffset': '0x50'},
    'cachedControllerAudit': {'file': str(cached_audit_file), 'sha256': sha(cached_audit_bytes), 'methods': cached_methods},
    'semantics': {'flag14': 'AR menu/directory eligibility exclusion. It is not a normal-battle owned write or a permanent prohibition on every possible forced native AR API.',
                  'flag19': 'Existing source StartInit requires SetIsAuto(false); later native toggling is a separate controller capability.',
                  'owner': 'Immutable source applicability content plus existing BattleGame manual controller. No new owned or mutable flag owner.'},
    'nativeExecuted': False, 'nativeDynamicParity': False, 'sourceStoryReachability': False,
}
assert all(sha((root / path).read_bytes()) == expected for path, expected in paths.values())
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'result': report['result'], 'methods': len(packets), 'directFlagQueries': len(queries),
                  'output': str(args.output), 'sha256': sha(args.output.read_bytes())}))
