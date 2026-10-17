"""Execute source activation/deactivation control with explicit scene services.

Play/Simulate/Clear/ResetSeeds execute, while module Awake, scene activity,
transforms, job fences, manager registration and prewarm particles are supplied
or observed. This isolates activation order; it is not a Unity game process.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from probe_unity_particle_lifecycle import PlaySequenceEngine
from probe_unity_particle_emitter import MEM, NATIVE_SHA
from unicorn.x86_const import UC_X86_REG_RDX


class HostEngine(PlaySequenceEngine):
    active = True

    def code(self, uc, address, size, user):
        rva = address - self.base
        if rva == 0x59f1e0:
            self.return_from_provider(integer=int(self.active))
        elif rva in [0x206cb0, 0xda6130, 0x1bcba0, 0x25bd00, 0x1aece0]:
            self.trace.append({'operation': 'module-awake', 'rva': hex(rva)})
            self.return_from_provider()
        elif rva == 0x196ce0:
            self.trace.append({'operation': 'sync-jobs'})
            self.return_from_provider()
        elif rva == 0x190fd0:
            self.trace.append({'operation': 'remove-from-manager'})
            self.return_from_provider()
        elif rva == 0x187710:
            self.trace.append({'operation': 'awake', 'mode': uc.reg_read(UC_X86_REG_RDX) & 0xffffffff})
        elif rva == 0x18abd0:
            self.trace.append({'operation': 'deactivate'})
        else:
            super().code(uc, address, size, user)

    def setup_host(self, seed, automatic, active, play_on_awake):
        self.setup_play(manager_seed=42, seed=seed, automatic=automatic)
        self.active = active
        self.write(MEM + 0x1000 + 0x37, 'B', int(play_on_awake))
        self.write(MEM + 0xd000 + 0x20, 'QQQ', MEM + 0xe000, 0, 0)

    def snapshot(self):
        return {'manager': list(self.read(MEM + 0xd000 + 0xc0, '4I')),
            'seed': self.read(MEM + 0x1000 + 0x30, 'I')[0],
            'particleCount': self.read(MEM + 0x6000 + 0x10, 'Q')[0],
            'stopped': list(self.read(MEM + 0x2000 + 0xc, 'BB')),
            'time': self.read(MEM + 0x2000 + 0x1a4, 'f')[0]}


def run(path):
    engine = HostEngine(path)
    cases = []
    for automatic in [False, True]:
        for active in [False, True]:
            for mode in [0, 1, 2, 16]:
                engine.setup_host(7, automatic, active, True)
                before = engine.snapshot()
                engine.call(0x187710, [MEM, mode], instruction_budget=800000)
                cases.append({'input': {'seed': 7, 'automatic': automatic, 'active': active, 'mode': mode},
                    'before': before, 'after': engine.snapshot(), 'trace': list(engine.trace)})
    sequences = []
    for automatic in [False, True]:
        engine.setup_host(7, automatic, True, True)
        stages = []
        for operation, rva in [('awake', 0x187710), ('deactivate', 0x18abd0), ('awake', 0x187710)]:
            engine.trace.clear()
            engine.call(rva, [MEM, 1], instruction_budget=800000)
            stages.append({'operation': operation, 'state': engine.snapshot(), 'trace': list(engine.trace)})
        sequences.append({'automatic': automatic, 'stages': stages})
    return {'nativeSha256': NATIVE_SHA, 'semanticsVerified': False, 'cases': cases, 'sequences': sequences,
        'providers': ['Active scene object', 'Module Awake initialization callbacks', 'Empty job fences and manager registry',
            'Transform/scene notifications', 'Prewarm Update recorded rather than particle simulation'],
        'notVerified': ['Scene hierarchy activation dispatch', 'Instantiation call order', 'Particle simulation', 'Original game execution']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dll', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = run(args.dll)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'cases': len(result['cases']), 'sequences': len(result['sequences'])}))
