"""Read PR's magic-stone integer dictionaries directly from the Windows player.

This supported PR build stores them in MagicStone::.ctor, not CSV. Capstone is
used only to decode constant assignments and Add calls; no native code executes.
"""
import argparse
import json
from pathlib import Path
import struct
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM, X86_OP_REG, X86_OP_MEM


def magic_stones(game):
    data = (game / 'GameAssembly.dll').read_bytes()
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if data[pe:pe+4] != b'PE\0\0':
        raise ValueError('GameAssembly.dll is not PE')
    sections, optional = struct.unpack_from('<H', data, pe+6)[0], struct.unpack_from('<H', data, pe+20)[0]
    base = struct.unpack_from('<Q', data, pe+24+24)[0]
    start = 0x856d80
    offset = None
    for index in range(sections):
        header = pe+24+optional+index*40
        size, rva, raw_size, raw = struct.unpack_from('<IIII', data, header+8)
        if rva <= start < rva+max(size, raw_size):
            offset = raw+start-rva
            break
    if offset is None:
        raise ValueError('Unsupported PR player: no magic-stone constructor')
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    constants, pairs = {}, []
    for instruction in decoder.disasm(data[offset:offset+0xb00], base+start):
        operands = instruction.operands
        if instruction.mnemonic in {'mov', 'movabs'} and len(operands) == 2 and operands[0].type == X86_OP_REG:
            register = instruction.reg_name(operands[0].reg)
            if operands[1].type == X86_OP_IMM:
                constants[register] = operands[1].imm
            elif operands[1].type == X86_OP_REG:
                constants[register] = constants.get(instruction.reg_name(operands[1].reg))
            else:
                constants.pop(register, None)
        elif instruction.mnemonic == 'xor' and len(operands) == 2 and operands[0].type == X86_OP_REG and operands[0].reg == operands[1].reg:
            constants[instruction.reg_name(operands[0].reg)] = 0
        elif instruction.mnemonic == 'lea' and operands[0].type == X86_OP_REG and operands[1].type == X86_OP_MEM:
            memory = operands[1].mem
            register = instruction.reg_name(memory.base)
            value = constants.get({'rdx': 'edx', 'rcx': 'ecx', 'rax': 'eax', 'r8': 'r8d', 'r9': 'r9d'}.get(register, register))
            constants[instruction.reg_name(operands[0].reg)] = None if value is None or memory.index else value+memory.disp
        elif instruction.mnemonic == 'call':
            if operands[0].type == X86_OP_IMM and operands[0].imm == base+0x1359140:
                pair = [constants.get('edx'), constants.get('r8d')]
                if None in pair:
                    raise ValueError(f'Unsupported dictionary operand at {instruction.address:#x}')
                pairs.append(pair)
            for register in ['eax', 'ecx', 'edx', 'r8d', 'r9d']:
                constants.pop(register, None)
        if len(pairs) == 81:
            break
    if len(pairs) != 81 or any([p[0] for p in pairs[n:n+27]] != list(range(62,89)) for n in [0,27,54]):
        raise ValueError('Unsupported PR build: incomplete magic-stone dictionaries')
    return {str(key): {'summonAbilityId': value, 'bonus': {'parameter': pairs[index+27][1], 'value': pairs[index+54][1]}} for index, (key,value) in enumerate(pairs[:27])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--game', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    result = magic_stones(args.game)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result)+'\n')
