"""Execute the exact ordinary particle-array instructions on controlled SoA data.

The existing path executes SimulateParticles, KillParticle, element_assign and
array_resize. Newborn tests execute the complete StartModules control flow with
explicit inert initial/module providers, followed by CopyParticlesToUnalignedDst.
No Unity process, allocator, scene, entropy or complete emitter is claimed.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from probe_unity_particle_emitter import Engine, MEM, NATIVE_SHA
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_RSP, UC_X86_REG_RIP, UC_X86_REG_RAX, UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_R8, UC_X86_REG_R9

DEAD = 100.00000762939453
FIELDS = {'px': 0, 'py': 0x20, 'pz': 0x40, 'vx': 0x60, 'vy': 0x80, 'vz': 0xa0,
          'ax': 0xc0, 'ay': 0xe0, 'az': 0x100, 'rotation': 0x220, 'angular': 0x280,
          'size': 0x2a0, 'color': 0x360, 'seed': 0x380, 'agePercent': 0x3c0, 'inverseLifetime': 0x3e0}


class ArrayEngine(Engine):
    def __init__(self, path):
        super().__init__(path)
        self.uc.mem_map(MEM + 0x10000, 0x80000)
        self.trace = []
        self.newborn = False
        self.uc.hook_add(UC_HOOK_CODE, self.code)

    def returned(self, integer=None):
        if integer is not None:
            self.uc.reg_write(UC_X86_REG_RAX, integer)
        sp = self.uc.reg_read(UC_X86_REG_RSP)
        self.uc.reg_write(UC_X86_REG_RIP, self.read(sp, 'Q')[0])
        self.uc.reg_write(UC_X86_REG_RSP, sp + 8)

    def code(self, uc, address, size, user):
        rva = address - self.base
        if rva == 0x17e2f0:
            count = self.read(uc.reg_read(UC_X86_REG_R9), 'Q')[0]
            self.trace.append({'operation': 'kill', 'index': uc.reg_read(UC_X86_REG_R8), 'fromIndex': count - 1})
        elif rva == 0x19cc30:
            self.trace.append({'operation': 'assign', 'index': uc.reg_read(UC_X86_REG_RDX), 'fromIndex': uc.reg_read(UC_X86_REG_R8)})
        elif rva == 0x19c5d0:
            self.trace.append({'operation': 'resize', 'count': uc.reg_read(UC_X86_REG_RDX)})
        elif rva in [0x17e7e0, 0x17ee20, 0x19d340, 0x17fd10, 0x17f970, 0x17faf0]:
            raise ValueError('Unadmitted allocator/subemitter/collision/ring provider ' + hex(rva))
        elif self.newborn and rva in [0x20b2d0, 0x196260, 0x19a860]:
            # All SoA values are explicit inputs at the post-module boundary.
            # delta=0 keeps those values unchanged through StartModules math.
            self.returned()
        elif self.newborn and rva == 0x191370:
            self.returned(integer=0)

    def setup(self, count, ages, *, delta=0):
        self.write(MEM, '65536x')
        self.write(MEM + 0x10000, '524288x')
        self.particles = MEM + 0x6000
        self.update = MEM + 0x8000
        self.write(MEM + 0x50, 'Q', MEM + 0x3000)
        self.write(MEM + 0x1000 + 0x28, '2f', 1, 1)  # Explicit duration/simulationSpeed.
        self.write(self.update, '3Q', MEM, MEM + 0x1000, MEM + 0x2000)
        for offset in range(0, 0x7a0, 0x20):
            pointer = MEM + 0x10000 + (offset // 0x20) * 0x2000
            self.write(self.particles + offset, 'Q', pointer)
            self.write(self.particles + offset + 0x10, 'QQ', count, 4096)
        self.write(self.particles + 0x7b1, 'B', 1)
        self.write(MEM + 0x9000, '4f', *([delta] * 4))
        self.write(MEM + 0x9100, 'Q', count)
        records = []
        for i in range((count + 3) // 4 * 4):
            record = {'seed': i + 1, 'color': (0xff000000 + i), 'agePercent': ages[i] if i < len(ages) else 0,
                'px': i + 1, 'py': i + 2, 'pz': i + 3, 'vx': .25, 'vy': .5, 'vz': .75,
                'ax': 1, 'ay': 2, 'az': 3, 'rotation': i * .125, 'angular': .5, 'size': i + .5, 'inverseLifetime': .5}
            for key, offset in FIELDS.items():
                self.write(self.read(self.particles + offset, 'Q')[0] + i * 4, 'I' if key in ['seed', 'color'] else 'f', record[key])
            records.append(record)
        self.trace.clear()
        return records

    def records(self, count):
        columns = {key: self.read(self.read(self.particles + offset, 'Q')[0], str(count) + ('I' if key in ['seed', 'color'] else 'f')) for key, offset in FIELDS.items()}
        return [{key: values[i] for key, values in columns.items()} for i in range(count)]

    def existing(self, ages, delta):
        self.newborn = False
        before = self.setup(len(ages), ages, delta=delta)[:len(ages)]
        self.call(0x1947d0, [self.update, self.particles, 0, MEM + 0x9100], stack=[('Q', MEM + 0x9000), ('Q', 0)], instruction_budget=2000000)
        count = self.read(self.particles + 0x10, 'Q')[0]
        return {'before': before, 'delta': delta, 'records': self.records(count), 'trace': self.trace.copy(), 'count': count, 'endIndex': self.read(MEM + 0x9100, 'Q')[0]}

    def newborn_case(self, old, count, ages, *, run_death=True):
        self.newborn = True
        start = (old + 3) // 4 * 4
        physical = start + (count + 3) // 4 * 4
        before = self.setup(physical, [0] * start + ages)
        self.write(MEM + 0x2000 + 0x1d0, '2f', .5, .25)
        self.write(MEM + 0xa000, 'Q', count)
        self.write(MEM + 0xd000, '16f', 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
        self.write(MEM + 0xd100, '4f', .25, .25, .25, .25)
        self.write(MEM + 0xd200, '4f', .25, .25, .25, .25)
        if run_death and count:
            self.call(0x1957f0, [self.update, MEM + 0x2000 + 0x1d0, 0, MEM + 0xd300], stack=[
                ('Q', MEM + 0xd000), ('Q', self.particles), ('Q', start), ('Q', MEM + 0xd100),
                ('Q', MEM + 0xd200), ('f', 0), ('Q', count), ('f', 0), ('Q', MEM + 0xa000), ('Q', 0)], instruction_budget=2000000)
        remaining = self.read(MEM + 0xa000, 'Q')[0]
        death_trace = self.trace.copy()
        scratch = self.records(physical)
        self.trace.clear()
        self.call(0x18a500, [self.update, self.particles, start, old], stack=[('Q', remaining), ('Q', 1000)], instruction_budget=2000000)
        final = self.read(self.particles + 0x10, 'Q')[0]
        return {'oldCount': old, 'acceptedCount': count, 'startIndex': start, 'before': before, 'remaining': remaining,
                'scratch': scratch, 'deathTrace': death_trace, 'copyTrace': self.trace.copy(), 'records': self.records(final), 'count': final}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dll', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    e = ArrayEngine(args.dll)
    existing, newborn, copies = [], [], []
    for count in range(8):
        for mask in range(1 << count):
            existing.append(e.existing([DEAD if mask & (1 << i) else 100 for i in range(count)], 0))
    for count in [8, 9, 12, 17, 1000]:
        for pattern in ['none', 'all', 'head', 'tail', 'alternate', 'ends']:
            dead = lambda i: pattern == 'all' or (pattern == 'head' and i < 3) or (pattern == 'tail' and i >= count - 3) or (pattern == 'alternate' and i % 2 == 0) or (pattern == 'ends' and i in [0, count - 1])
            existing.append(e.existing([DEAD if dead(i) else 100 for i in range(count)], 0))
    for count in [1, 3, 4, 5, 9, 17]:
        for delta in [.01, .02, .03, .1]:
            existing.append(e.existing([100 if i % 3 == 0 else (99 if i % 3 == 1 else 25) for i in range(count)], delta))
    for old in range(8):
        for count in [1, 2, 3, 4, 5, 7, 8, 9]:
            padded = (count + 3) // 4 * 4
            patterns = [[], [0], [count - 1], list(range(count)), list(range(padded)), list(range(count, padded)), [i for i in range(padded) if i % 2 == 0]]
            for dead in patterns:
                newborn.append(e.newborn_case(old, count, [DEAD if i in dead else 100 for i in range(padded)]))
            copies.append(e.newborn_case(old, count, [0] * padded, run_death=False))
        copies.append(e.newborn_case(old, 0, [], run_death=False))
    result = {'kind': 'unity-particle-array-instruction-probes-v1', 'nativeSha256': NATIVE_SHA, 'semanticsVerified': False,
              'existing': existing, 'newborn': newborn, 'copies': copies,
              'controlledProviders': ['Preallocated native SoA capacity; no native allocator is executed',
                  'Ring mode 0; no collisions, subemitters, trails or optional callbacks',
                  'Newborn Initial/CalculateInitialValues/PreSimulation are explicit inert providers over post-module test data; delta=0'],
              'notVerified': ['Windows/Unity process execution', 'Complete emitter execution or visual parity']}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({key: len(result[key]) for key in ['existing', 'newborn', 'copies']}))


if __name__ == '__main__':
    main()
