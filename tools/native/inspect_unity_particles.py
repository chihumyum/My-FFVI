"""Bind local UnityPlayer ICalls and native bodies to its exact official PDB.

This never loads the DLL. PDB names are evidence of identity, not proof of a
function's behavior. All generated artifacts belong in ignored build outputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import uuid

from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM
from inspect_pe import PEImage


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def directories(pe: PEImage, index: int) -> tuple[int, int]:
    at = struct.unpack_from('<I', pe.data, 60)[0] + 24 + 112 + index * 8
    return struct.unpack_from('<II', pe.data, at)


def codeview(pe: PEImage) -> dict:
    at, size = directories(pe, 6)
    if size % 28:
        raise ValueError('Malformed debug directory')
    records = []
    for offset in range(0, size, 28):
        entry = struct.unpack('<IIHHIIII', pe.read(at + offset, 28)[2])
        if entry[4] != 2:
            continue
        raw = pe.read(entry[6], entry[5])[2]
        if not raw.startswith(b'RSDS') or len(raw) < 25:
            raise ValueError('Unsupported CodeView record')
        guid = str(uuid.UUID(bytes_le=bytes(raw[4:20]))).upper()
        age = struct.unpack_from('<I', raw, 20)[0]
        original = raw[24:].split(b'\0', 1)[0].decode('utf-8')
        name = original.replace('\\', '/').split('/')[-1]
        records.append({'guid': guid, 'age': age, 'name': name,
                        'recordRva': hex(entry[6]), 'recordSha256': sha(raw),
                        'symbolUrl': f'https://symbolserver.unity3d.com/{name}/{guid.replace("-", "")}{age:X}/{name}'})
    if len(records) != 1:
        raise ValueError('Expected one unambiguous RSDS record')
    return records[0]


def public_symbols(text: str, pe: PEImage) -> list[dict]:
    values = []
    for m in re.finditer(r'S_PUB32[^\n]*`([^`]+)`\s*flags = ([^,\n]+), addr = (\d+):(\d+)', text):
        name, flags, segment, offset = m.groups()
        segment, offset = int(segment), int(offset)
        if not 1 <= segment <= len(pe.sections):
            continue  # No PE-backed address; never attribute it to the last section.
        section = pe.sections[segment - 1]
        if offset >= min(section[2], section[3]):
            continue
        values.append({'name': name, 'rva': section[1] + offset, 'flags': flags.strip()})
    if not values:
        raise ValueError('No PE-backed PDB publics')
    return values


def local_symbols(text: str, pe: PEImage) -> list[dict]:
    values = []
    pattern = r'S_[LG]PROC32[^\n]*`(.+)`\s*parent = \d+, end = \d+, addr = (\d+):(\d+), code size = (\d+)'
    for m in re.finditer(pattern, text):
        name, segment, offset, size = m.groups()
        segment, offset, size = int(segment), int(offset), int(size)
        if not 1 <= segment <= len(pe.sections):
            continue
        rva = pe.sections[segment - 1][1] + offset
        pe.read(rva, size)
        values.append({'name': name, 'rva': rva, 'flags': 'function', 'codeSize': size})
    return values


def icalls(pe: PEImage) -> list[dict]:
    section = next(s for s in pe.sections if s[0] == '.text')
    raw = pe.read(section[1], min(section[2], section[3]))[2]
    result = []
    for m in re.finditer(b'\x48\x8d\x15', raw):
        i = m.start()
        if raw[i + 7:i + 10] != b'\x48\x8d\x0d' or raw[i + 14:i + 15] != b'\xe8':
            continue
        origin = section[1] + i
        target = origin + 7 + struct.unpack_from('<i', raw, i + 3)[0]
        name_rva = origin + 14 + struct.unpack_from('<i', raw, i + 10)[0]
        registrar = origin + 19 + struct.unpack_from('<i', raw, i + 15)[0]
        try:
            name = pe.read(name_rva, 256)[2].split(b'\0', 1)[0].decode('ascii')
        except (ValueError, UnicodeDecodeError):
            continue
        if not name.startswith('UnityEngine.ParticleSystem'):
            continue
        result.append({'name': name, 'functionRva': hex(target), 'nameRva': hex(name_rva),
                       'registrationRva': hex(origin), 'registrarRva': hex(registrar),
                       'registrationHex': raw[i:i + 19].hex(), 'registrationSha256': sha(raw[i:i + 19])})
    return result


def native_body(pe: PEImage, rva: int, symbols: list[dict]) -> dict:
    at, size = directories(pe, 3)
    if size % 12:
        raise ValueError('Malformed exception directory')
    entries = [struct.unpack('<III', pe.read(at + i, 12)[2]) for i in range(0, size, 12)]
    matches = [e for e in entries if e[0] == rva]
    if len(matches) > 1:
        raise ValueError('Ambiguous runtime function')
    local_sizes = {s['codeSize'] for s in symbols if s['rva'] == rva and 'codeSize' in s}
    if len(local_sizes) > 1:
        raise ValueError('Conflicting PDB procedure lengths')
    # .pdata may split one function into multiple chained-unwind ranges, so
    # hashing just its first entry would miss cold branches. Traverse the local
    # CFG, bounded by the next distinct PDB function; never follow called code.
    next_symbols = [s['rva'] for s in symbols if s['flags'] == 'function' and s['rva'] > rva]
    limit = rva + next(iter(local_sizes)) if local_sizes else min(min(next_symbols, default=rva + 1048576), rva + 1048576)
    code = pe.read(rva, limit - rva)[2]
    decoder = Cs(CS_ARCH_X86, CS_MODE_64); decoder.detail = True
    pending, seen, end, tail_targets, calls = [rva], set(), rva, set(), []
    while pending:
        pc = pending.pop()
        while pc not in seen:
            if not rva <= pc < limit:
                raise ValueError(f'Control flow leaves source function at {hex(pc)}')
            inst = next(decoder.disasm(code[pc-rva:pc-rva+16], pc, count=1), None)
            if inst is None:
                raise ValueError('Undecodable instruction')
            seen.add(pc); end = max(end, pc + inst.size)
            if inst.mnemonic == 'call' and inst.operands and inst.operands[0].type == X86_OP_IMM:
                target = inst.operands[0].imm
                calls.append({'rva': hex(pc), 'targetRva': hex(target),
                              'aliases': sorted({s['name'] for s in symbols if s['rva'] == target})})
            if inst.mnemonic.startswith('ret'):
                break
            if inst.mnemonic.startswith('j'):
                if not inst.operands or inst.operands[0].type != X86_OP_IMM:
                    raise ValueError('Indirect branch requires explicit analysis')
                destination = inst.operands[0].imm
                if rva <= destination < limit:
                    pending.append(destination)
                else:
                    tail_targets.add(destination)
                if inst.mnemonic == 'jmp':
                    break
            pc += inst.size
    if local_sizes:
        end = limit
    boundary = 'pdb-procedure-length' if local_sizes else 'pdb-bounded-control-flow'
    data = pe.read(rva, end - rva)[2]
    aliases = sorted({s['name'] for s in symbols if s['rva'] == rva and s['flags'] == 'function'})
    if not aliases:
        raise ValueError(f'No exact function public at {hex(rva)}')
    return {'rva': hex(rva), 'endRva': hex(end), 'size': len(data), 'sha256': sha(data),
            'boundary': boundary, 'aliases': aliases,
            'runtimeFunctionRanges': [{'rva': hex(a), 'endRva': hex(b), 'unwindRva': hex(c)} for a, b, c in entries if rva <= a < end],
            'tailTargets': [hex(a) for a in sorted(tail_targets)], 'directCalls': calls}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dll', type=Path, required=True)
    parser.add_argument('--pdb', type=Path, required=True)
    parser.add_argument('--llvm-pdbutil', default='/opt/homebrew/opt/llvm/bin/llvm-pdbutil')
    parser.add_argument('--publics', type=Path, help='Reuse llvm-pdbutil dump --publics output')
    parser.add_argument('--locals', type=Path, help='Reuse llvm-pdbutil dump --symbols output')
    parser.add_argument('--rva', type=lambda s: int(s, 0), action='append', default=[])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    data = args.dll.read_bytes(); pe = PEImage(data); identity = codeview(pe)
    summary = subprocess.check_output([args.llvm_pdbutil, 'dump', '--summary', str(args.pdb)], text=True)
    guid_match = re.search(r'GUID:\s*\{?([0-9A-Fa-f-]{36})', summary)
    age_match = re.search(r'Age:\s*(\d+)', summary)
    if not guid_match or not age_match or guid_match[1].upper() != identity['guid'] or int(age_match[1]) != identity['age']:
        raise ValueError('PDB GUID/age does not match the local DLL')
    raw_symbols = subprocess.check_output([args.llvm_pdbutil, 'dump', '--publics', str(args.pdb)], text=True)
    symbols = public_symbols(raw_symbols, pe)
    if args.publics and public_symbols(args.publics.read_text(), pe) != symbols:
        raise ValueError('Cached publics differ from the matching PDB')
    if args.locals:
        fresh_locals = local_symbols(subprocess.check_output([args.llvm_pdbutil, 'dump', '--symbols', str(args.pdb)], text=True), pe)
        if local_symbols(args.locals.read_text(), pe) != fresh_locals:
            raise ValueError('Cached local procedures differ from the matching PDB')
        symbols += fresh_locals
    versions = sorted({m.decode('ascii') for m in re.findall(rb'2019\.4\.20f1(?:_[0-9a-f]{12})?', data)})
    calls = icalls(pe)
    for call in calls:
        call['aliases'] = sorted(s['name'] for s in symbols if s['rva'] == int(call['functionRva'], 16))
    output = {'kind': 'unity-particle-native-inspection-v1', 'semanticsVerified': False,
              'native': {'file': args.dll.name, 'sha256': sha(data), 'imageBase': hex(pe.image_base), 'versions': versions},
              'pdb': {**identity, 'sha256': sha(args.pdb.read_bytes()), 'publicFunctionCount': sum(s['flags'] == 'function' for s in symbols)},
              'icalls': calls, 'methods': [native_body(pe, rva, symbols) for rva in args.rva]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'output': str(args.out), 'icalls': len(calls), 'methods': len(output['methods']), 'pdbGuid': identity['guid']}))


if __name__ == '__main__':
    main()
