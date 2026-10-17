"""Extract the PR player's colosseum dictionaries without executing native code.

The supported Windows PR build stores these in FF6.ColosseumInfomationData::.ctor.
CSV monster_party remains authoritative for each returned formation and opponent.
"""
import argparse
import json
from pathlib import Path
import struct
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM, X86_OP_REG, X86_OP_MEM


def colosseum(game):
    data = (game / 'GameAssembly.dll').read_bytes()
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    if data[pe:pe+4] != b'PE\0\0':
        raise ValueError('GameAssembly.dll is not PE')
    count = struct.unpack_from('<H', data, pe+6)[0]
    optional = struct.unpack_from('<H', data, pe+20)[0]
    base = struct.unpack_from('<Q', data, pe+48)[0]

    def offset(address):
        for index in range(count):
            size, rva, raw_size, raw = struct.unpack_from(
                '<IIII', data, pe+24+optional+index*40+8)
            if rva <= address < rva+max(size, raw_size):
                return raw+address-rva
        raise ValueError('Unsupported PR player: colosseum constructor missing')

    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    constants, pairs, dictionaries, fields = {}, [], {}, {}
    for instruction in decoder.disasm(
            data[offset(0x750520):offset(0x7538a2)], base+0x750520):
        operands = instruction.operands
        if instruction.mnemonic in {'mov', 'movabs'} and len(operands) == 2:
            target, source = operands
            if target.type == X86_OP_REG:
                register = instruction.reg_name(target.reg)
                if source.type == X86_OP_IMM:
                    constants[register] = source.imm
                elif source.type == X86_OP_REG:
                    constants[register] = constants.get(instruction.reg_name(source.reg))
                else:
                    constants.pop(register, None)
            elif (target.type == X86_OP_MEM and source.type == X86_OP_IMM
                    and instruction.reg_name(target.mem.base) == 'rdi'):
                fields[target.mem.disp] = source.imm
        elif (instruction.mnemonic == 'xor' and len(operands) == 2
              and operands[0].type == X86_OP_REG and operands[0].reg == operands[1].reg):
            constants[instruction.reg_name(operands[0].reg)] = 0
        elif (instruction.mnemonic == 'lea' and operands[0].type == X86_OP_REG
              and operands[1].type == X86_OP_MEM):
            memory = operands[1].mem
            register = instruction.reg_name(memory.base)
            value = constants.get({'rdx': 'edx', 'rcx': 'ecx', 'rax': 'eax',
                                   'r8': 'r8d', 'r9': 'r9d'}.get(register, register))
            constants[instruction.reg_name(operands[0].reg)] = (
                None if value is None or memory.index else value+memory.disp)
            if register == 'rdi' and memory.disp in {0x18, 0x20}:
                dictionaries[memory.disp] = dict(pairs)
                if len(pairs) != 256 or len(dict(pairs)) != 256:
                    raise ValueError('Unsupported PR build: incomplete colosseum dictionary')
                pairs = []
        elif instruction.mnemonic == 'call':
            if operands[0].type == X86_OP_IMM and operands[0].imm == base+0x1359140:
                pair = (constants.get('edx'), constants.get('r8d'))
                if None in pair:
                    raise ValueError('Unsupported PR colosseum dictionary operands')
                pairs.append(pair)
            for register in ['eax', 'ecx', 'edx', 'r8d', 'r9d']:
                constants.pop(register, None)
    if set(dictionaries) != {0x18, 0x20} or fields != {0x10: 372, 0x14: 375, 0x28: 135}:
        raise ValueError('Unsupported PR colosseum constructor layout')
    rewards, formations = dictionaries[0x18], dictionaries[0x20]
    if rewards.keys() != formations.keys():
        raise ValueError('PR colosseum dictionary key mismatch')
    return {
        'wagers': {str(key): {'rewardId': rewards[key], 'formationId': formations[key]}
                   for key in rewards},
        # GetMonsterId RVA0x750370 substitutes party1021 when wager135 and
        # global flags372/375 are respectively set/clear (ScenarioFlag2 116/119).
        'special': {'contentId': fields[0x28], 'formationId': 1021,
                    'requiredFlag': fields[0x10]-256, 'absentFlag': fields[0x14]-256},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--game', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(colosseum(args.game))+'\n')
