"""Execute selected source DLL instructions in Unicorn, not the Windows game.

No OS calls, entropy or Unity scene runtime are provided. Controlled input structs
exercise only the recovered leaf RNG, clock and constant-emission functions.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct

from inspect_pe import PEImage
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn.x86_const import (UC_X86_REG_RSP, UC_X86_REG_RIP, UC_X86_REG_RCX, UC_X86_REG_RDX,
    UC_X86_REG_R8, UC_X86_REG_R9, UC_X86_REG_RAX, UC_X86_REG_XMM0,
    UC_X86_REG_XMM1, UC_X86_REG_XMM2, UC_X86_REG_XMM3)

NATIVE_SHA = '7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845'
MEM = 0x20000000
STACK = 0x30000000
STOP = 0x40000000


class Engine:
    def __init__(self, path: Path):
        self.data = path.read_bytes()
        if hashlib.sha256(self.data).hexdigest() != NATIVE_SHA:
            raise ValueError('This probe is bound to the inspected UnityPlayer build')
        pe = PEImage(self.data); self.base = pe.image_base
        self.uc = Uc(UC_ARCH_X86, UC_MODE_64)
        end = max(s[1] + max(s[2], s[3]) for s in pe.sections)
        self.uc.mem_map(pe.image_base, (end + 0xfff) & ~0xfff)
        for _, rva, _, size, offset in pe.sections:
            self.uc.mem_write(pe.image_base + rva, self.data[offset:offset+size])
        for address in [MEM, STACK, STOP]: self.uc.mem_map(address, 0x10000)

    def write(self, address, fmt, *values):
        self.uc.mem_write(address, struct.pack('<' + fmt, *values))

    def read(self, address, fmt):
        return list(struct.unpack('<' + fmt, self.uc.mem_read(address, struct.calcsize('<' + fmt))))

    def call(self, rva, integers=(), floats=None, stack=()):
        sp = STACK + 0x8008
        self.write(sp, 'Q', STOP)
        self.uc.reg_write(UC_X86_REG_RSP, sp)
        for reg, value in zip([UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_R8, UC_X86_REG_R9], integers):
            self.uc.reg_write(reg, value)
        for reg in [UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM2, UC_X86_REG_XMM3]: self.uc.reg_write(reg, 0)
        for index, value in (floats or {}).items():
            reg = [UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM2, UC_X86_REG_XMM3][index]
            self.uc.reg_write(reg, struct.unpack('<I', struct.pack('<f', value))[0])
        for i, (fmt, value) in enumerate(stack): self.write(sp + 0x28 + i * 8, fmt, value)
        self.uc.emu_start(self.base + rva, STOP, count=100000)
        if self.uc.reg_read(UC_X86_REG_RIP) != STOP:
            raise RuntimeError('Native instruction probe did not complete within its budget')
        return self.uc.reg_read(UC_X86_REG_RAX)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dll', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(); engine = Engine(args.dll)
    rng = []
    for seed in [0, 1, 42, 0x12345678, 0x80000000, 0xffffffff]:
        engine.write(MEM + 0x100, 'I', seed)
        engine.call(0x764ce0, [MEM, MEM + 0x100])
        initial = engine.read(MEM, '16I'); steps = []
        for i in range(24):
            as_float = bool(i & 1)
            engine.call(0x18e050 if as_float else 0x18d790, [MEM, MEM + 0x200])
            steps.append({'asFloat': as_float, 'values': engine.read(MEM + 0x200, '4f' if as_float else '4I'), 'state': engine.read(MEM, '16I')})
        rng.append({'seed': seed, 'state': initial, 'steps': steps})

    clock = []
    for looping in [False, True]:
        for time, delta, loops in [(0, .01, 0), (.99, .03, 1), (.5, 2.7, 3), (.75, .25, 0xffffffff), (0, 0, 0)]:
            engine.write(MEM, '512x'); engine.write(MEM + 0x1000, '256x')
            engine.write(MEM + 0x1a4, 'f', time); engine.write(MEM + 0x38, 'I', loops)
            engine.write(MEM + 0x1000 + 0x28, 'f', 1); engine.write(MEM + 0x1000 + 0x35, 'B', int(looping))
            engine.call(0x1b0d30, [MEM, MEM + 0x1000], {2: delta})
            clock.append({'input': {'time': time, 'delta': delta, 'loops': loops, 'looping': looping, 'duration': 1},
                          'output': {'time': engine.read(MEM + 0x1a4, 'f')[0], 'loops': engine.read(MEM + 0x38, 'I')[0]}})

    emissions = []
    cases = [(rate, probability, cycles) for rate in [0, 8, 10, 14] for probability in [0, .25, 1] for cycles in [1, 3]]
    for rate, probability, cycles in cases:
        # One synthetic native EmissionData struct with source layout, not a
        # claim that the engine has loaded a complete scene or asset instance.
        seed = 42
        engine.write(MEM, '8192x')
        words = [seed]
        for _ in range(3): words.append((words[-1] * 0x6c078965 + 1) & 0xffffffff)
        engine.write(MEM + 8, '4I', *words)
        data = MEM + 0x1000
        engine.write(data + 0xc, 'H', 0); engine.write(data + 0x14, 'f', rate)
        engine.write(data + 0x48, 'i', 1); engine.write(data + 0x58, 'f', 0)
        engine.write(data + 0x64, 'H', 0); engine.write(data + 0x6c, 'f', 1)
        engine.write(data + 0x80, 'i', cycles); engine.write(data + 0x84, 'f', .25); engine.write(data + 0x88, 'f', probability)
        intervals = [(0, 0), (0, .01), (.01, .04), (.04, .25), (.25, .26), (.26, .8), (.8, .02), (.02, .27), (.99, 0), (0, .2)]
        results = []
        for previous, current in intervals:
            count = engine.call(0x1af7e0, [MEM, MEM + 0x500, data], {3: previous}, [('f', current), ('f', 1)])
            results.append({'previousTime': previous, 'currentTime': current,
                'totalCount': count, 'continuousCount': engine.read(MEM + 0x500, 'Q')[0],
                'fractionalCount': engine.read(MEM + 4, 'f')[0], 'spacing': engine.read(MEM, 'f')[0], 'random': engine.read(MEM + 8, '4I')})
        emissions.append({'seed': seed, 'rate': rate, 'probability': probability, 'cycles': cycles, 'interval': .25, 'results': results})
    output = {'kind': 'unity-particle-instruction-probes-v1', 'semanticsVerified': False,
              'lane': 'isolated-x64-instruction-emulation', 'nativeSha256': NATIVE_SHA,
              'rng': rng, 'clock': clock, 'emissions': emissions,
              'notVerified': ['Windows/Unity process execution', 'system entropy', 'engine timestep', 'prewarm', 'Cone/Noise/motion', 'complete prefab execution']}
    args.out.parent.mkdir(parents=True, exist_ok=True); args.out.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'rngSteps': sum(len(x['steps']) for x in rng), 'clockCases': len(clock), 'emissionIntervals': sum(len(x['results']) for x in emissions)}))


if __name__ == '__main__': main()
