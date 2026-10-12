"""Probe source clock/scheduling instructions with explicit external providers.

TimeManager/IsWorldPlaying and CRT math are controlled inputs. Motion, birth and
size calls are recorded without executing those modules. This is not a complete
emitter or original game run; the output records that boundary explicitly.
"""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import struct

from probe_unity_particle_emitter import Engine, MEM, NATIVE_SHA
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_RSP, UC_X86_REG_RIP, UC_X86_REG_RAX, UC_X86_REG_RCX, UC_X86_REG_RDX,
    UC_X86_REG_R8, UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM2, UC_X86_REG_XMM3)


def f(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


class LifecycleEngine(Engine):
    def __init__(self, path):
        super().__init__(path)
        self.trace = []
        self.scratch = []
        self.uc.hook_add(UC_HOOK_CODE, self.code)

    def getf(self, register):
        return struct.unpack('<f', struct.pack('<I', self.uc.reg_read(register) & 0xffffffff))[0]

    def return_from_provider(self, value=None, integer=None):
        if value is not None:
            self.uc.reg_write(UC_X86_REG_XMM0, struct.unpack('<I', struct.pack('<f', value))[0])
        if integer is not None:
            self.uc.reg_write(UC_X86_REG_RAX, integer)
        sp = self.uc.reg_read(UC_X86_REG_RSP)
        target = self.read(sp, 'Q')[0]
        self.uc.reg_write(UC_X86_REG_RSP, sp + 8)
        self.uc.reg_write(UC_X86_REG_RIP, target)

    def code(self, uc, address, size, user):
        rva = address - self.base
        sp = uc.reg_read(UC_X86_REG_RSP)
        if rva == 0x550120:
            self.return_from_provider(integer=MEM + 0xc000)
        elif rva == 0x591d70:
            self.return_from_provider(integer=1)
        elif rva == 0x13f8bec:
            self.return_from_provider(value=f(math.fmod(self.getf(UC_X86_REG_XMM0), self.getf(UC_X86_REG_XMM1))))
        elif rva == 0x13f8b5c:
            self.return_from_provider(value=f(math.ceil(self.getf(UC_X86_REG_XMM0))))
        elif rva == 0x1af7e0:
            # Observe, but execute the real emission instructions and RNG.
            self.scratch.append({'previousTime': self.getf(UC_X86_REG_XMM3), 'currentTime': self.read(sp + 0x28, 'f')[0]})
        elif rva == 0x19a270:
            self.trace.append({'operation': 'simulate-existing', 'delta': self.read(sp + 0x28, 'f')[0]})
            self.return_from_provider()
        elif rva == 0x195e60:
            self.trace.append({'operation': 'birth', 'time': self.getf(UC_X86_REG_XMM2),
                'delta': self.getf(UC_X86_REG_XMM3), 'continuousCount': self.read(sp + 0x28, 'Q')[0],
                'totalCount': self.read(sp + 0x30, 'Q')[0], 'frameOffset': self.read(sp + 0x38, 'f')[0]})
            self.return_from_provider()
        elif rva == 0x19ba50:
            self.trace.append({'operation': 'update-size'})
            self.return_from_provider()
        elif rva == 0x197ec0:
            raise ValueError('Collision/bounds callbacks are not admitted by this clock probe')
        elif rva == 0x19bff0:
            self.trace.append({'operation': 'reserve', 'count': uc.reg_read(UC_X86_REG_RDX)})
            self.return_from_provider()
        elif rva == 0x19c5d0:
            self.write(uc.reg_read(UC_X86_REG_RCX) + 0x10, 'Q', uc.reg_read(UC_X86_REG_RDX))
            self.return_from_provider()

    def setup(self, *, lifetime=5, rate=10, burst=True, seed=42, time=0, accumulated=0, flags=0):
        self.write(MEM, '65536x')
        self.write(MEM + 0x38, 'QQQQ', MEM + 0x6000, MEM + 0x1000, MEM + 0x2000, MEM + 0x3000)
        self.write(MEM + 0x8000, 'QQQfI', MEM, MEM + 0x1000, MEM + 0x2000, accumulated, flags)
        self.write(MEM + 0x1000 + 0x28, 'ffI', 1, 1, seed)
        self.write(MEM + 0x1000 + 0x35, 'BB', 1, 1)
        self.write(MEM + 0x3000 + 0x14, 'H', 3)
        self.write(MEM + 0x3000 + 0x18, 'ff', lifetime / 2, lifetime)
        self.write(MEM + 0x3000 + 0x4a8, 'B', 1)
        emission = MEM + 0x3000 + 0x4b0
        self.write(emission + 0x14, 'f', rate)
        if burst:
            self.write(emission + 0x48, 'i', 1)
            self.write(emission + 0x6c, 'f', 1)
            self.write(emission + 0x80, 'iff', 1, .25, 1)
        self.write(MEM + 0x2000, 'f', accumulated)
        self.write(MEM + 0x2000 + 0x1a4, 'f', time)
        words = [seed]
        for _ in range(3):
            words.append((words[-1] * 0x6c078965 + 1) & 0xffffffff)
        self.write(MEM + 0x2000 + 0x1d8, '4I', *words)
        self.write(MEM + 0xc000 + 0x48, 'ff', .02, .02)
        self.write(MEM + 0xc000 + 0x104, 'f', .03)
        self.trace.clear(); self.scratch.clear()


class PlaySequenceEngine(LifecycleEngine):
    """Execute Play/Simulate/Clear/ResetSeeds; observe the prewarm Update call.

    The active scene object, its transform, allocation and manager notification
    are controlled providers. The source seed reset and prewarm code execute.
    This does not execute the prewarm particles or the Unity scene hierarchy.
    """
    def code(self, uc, address, size, user):
        rva = address - self.base
        if rva == 0x59f1e0:
            self.return_from_provider(integer=1)
        elif rva == 0x1889c0:
            self.return_from_provider(integer=1000)
        elif rva in [0x208a20, 0x208660]:
            self.return_from_provider(integer=0)  # Explicitly empty subemitters.
        elif rva == 0x25d370:
            if self.read(MEM + 0x3000 + 0x11e0, 'B')[0] != 0:
                raise ValueError('Only an empty disabled optional module is supplied')
            self.return_from_provider()
        elif rva == 0x58a7c0:
            if uc.reg_read(UC_X86_REG_RCX) != 0:
                raise ValueError('Unexpected allocation in empty subemitter reset')
            self.return_from_provider()
        elif rva == 0x59fb20:
            self.return_from_provider(integer=MEM + 0xd800)
        elif rva == 0xde1210:
            self.return_from_provider(integer=uc.reg_read(UC_X86_REG_RDX))
        elif rva in [0x197200, 0x193560, 0x186d80, 0x190fd0, 0x197ec0]:
            self.return_from_provider()
        elif rva == 0x18faf0:
            self.trace.append({'operation': 'play', 'prewarm': bool(uc.reg_read(UC_X86_REG_RDX) & 0xff)})
        elif rva == 0x194180:
            self.trace.append({'operation': 'simulate', 'time': self.getf(UC_X86_REG_XMM1),
                'flags': uc.reg_read(UC_X86_REG_R8) & 0xffffffff})
        elif rva == 0x191860:
            self.trace.append({'operation': 'reset-seeds'})
        elif rva == 0x1892a0:
            self.trace.append({'operation': 'clear'})
        elif rva == 0x197e10:
            self.trace.append({'operation': 'update', 'delta': self.getf(UC_X86_REG_XMM1),
                'flags': uc.reg_read(UC_X86_REG_R8) & 0xffffffff,
                'initialTime': self.read(MEM + 0x2000 + 0x1a4, 'f')[0]})
            self.return_from_provider()
        else:
            super().code(uc, address, size, user)

    def setup_play(self, *, manager_seed=42, seed=0, automatic=True, stopped=True, prewarm=True):
        self.setup(seed=seed)
        self.write(MEM + 0x30, 'Q', MEM + 0xd800)
        self.write(MEM + 0x68, 'i', -1)
        self.write(MEM + 0x1000 + 0x34, 'BBB', int(automatic), 1, int(prewarm))
        self.write(MEM + 0x3000 + 0x174, 'I', 1000)
        self.write(MEM + 0x3000 + 0xc98, 'B', 1)  # Source Noise forces incremental.
        self.write(MEM + 0x2000 + 8, 'IBB', 0 if stopped else 1, int(stopped), int(stopped))
        self.write(self.base + 0x17b4498, 'Q', MEM + 0xd000)
        words = [manager_seed]
        for _ in range(3):
            words.append((words[-1] * 0x6c078965 + 1) & 0xffffffff)
        self.write(MEM + 0xd000 + 0xc0, '4I', *words)


class BirthTimingEngine(LifecycleEngine):
    """Execute the complete StartModules timing loop with inert module inputs.

    Initial, velocity and motion callbacks are observed, not implemented here.
    Allocated SoA buffers let the source loop integrate zero velocity and age;
    all controlled lifetimes stay alive. This verifies timing, not module math.
    """
    def __init__(self, path):
        super().__init__(path)
        self.uc.mem_map(MEM + 0x10000, 0x10000)

    def code(self, uc, address, size, user):
        rva = address - self.base
        sp = uc.reg_read(UC_X86_REG_RSP)
        if rva == 0x20b2d0:
            self.return_from_provider()
        elif rva == 0x191370:
            self.return_from_provider(integer=0)
        elif rva == 0x196260:
            self.trace.append({'operation': 'birth-time', 'values': self.read(self.read(sp + 0x30, 'Q')[0], '4f')})
            self.return_from_provider()
        elif rva == 0x19a860:
            self.trace.append({'operation': 'birth-delta', 'values': self.read(self.read(sp + 0x28, 'Q')[0], '4f')})
            self.return_from_provider()
        elif rva == 0x17e2f0:
            raise ValueError('Death/compaction is outside this birth timing probe')
        else:
            super().code(uc, address, size, user)

    def timing(self, *, count, continuous, spacing, fractional, time, delta, start=4):
        self.setup()
        particles = MEM + 0x6000
        self.write(MEM + 0x10000, '65536x')
        for offset in range(0, 0x7a0, 0x20):
            self.write(particles + offset, 'Q', MEM + 0x10000 + offset * 0x20)
        padded = (count + 3) // 4 * 4
        self.write(particles + 0x10, 'Q', start + padded)
        self.write(MEM + 0x2000 + 0x1d0, '2f', spacing, fractional)
        self.write(MEM + 0xa000, 'Q', count)
        self.write(MEM + 0xd000, '16f', 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)
        self.write(MEM + 0xd100, '4f', *([f(f(time) - f(delta))] * 4))
        self.write(MEM + 0xd200, '4f', *([f(time)] * 4))
        self.call(0x1957f0, [MEM + 0x8000, MEM + 0x2000 + 0x1d0, 0, MEM + 0xd300], stack=[
            ('Q', MEM + 0xd000), ('Q', particles), ('Q', start), ('Q', MEM + 0xd100),
            ('Q', MEM + 0xd200), ('f', delta), ('Q', continuous), ('f', 0), ('Q', MEM + 0xa000), ('Q', 0)])
        return {'birthNormalizedTimes': [n for t in self.trace if t['operation'] == 'birth-time' for n in t['values']][:count],
                'birthDeltas': [n for t in self.trace if t['operation'] == 'birth-delta' for n in t['values']][:count]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dll', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    engine = LifecycleEngine(args.dll)
    timesteps, prewarm, schedules, allocations, play_sequences, birth_timings = [], [], [], [], [], []
    for fixed in [False, True]:
        for delta in [0, .000001, .00001, .01, .019, .02, .03, .030001, .04, .1, .19, 3.5, 5.1, 10.1]:
            engine.setup()
            engine.call(0x18e750, [0, int(fixed), 0], {0: delta})
            timesteps.append({'delta': f(delta), 'fixedTimeStep': fixed, 'step': engine.getf(UC_X86_REG_XMM0)})
    for lifetime in [.64, 3.5, 5]:
        for time in [0, .01, .02, .03, .99, 1.25, 12.3]:
            engine.setup(lifetime=lifetime)
            result = engine.call(0x189920, [MEM, MEM + 0xa000], {2: time}, instruction_budget=800000) & 0xff
            if result != 1:
                raise ValueError('Unexpected prewarm rejection')
            prewarm.append({'input': {'maximumLifetime': f(lifetime), 'requestedTime': f(time)},
                'output': {'simulateSeconds': engine.read(MEM + 0xa000, 'f')[0],
                    'initialTime': engine.read(MEM + 0x2000 + 0x1a4, 'f')[0],
                    'scratchIntervals': list(engine.scratch)}})
    for fixed in [False, True]:
        for growth in [False, True]:
            for delta, time, remainder in [(.01, 0, 0), (.019, .5, .001), (.02, .36, 0), (.03, .99, 0),
                    (.030001, .99, .01), (.1, 0, 0), (.19, .99, .005), (.64, .36, 0),
                    (3.5, .5, 0), (5, 0, 0), (5.1, 0, 0), (10.1, 0, 0)]:
                flags = int(fixed) | (0 if growth else 4)
                engine.setup(time=time, accumulated=f(f(delta) + f(remainder)), flags=flags)
                engine.call(0x18e750, [0, int(fixed), 0], {0: delta})
                step = engine.getf(UC_X86_REG_XMM0)
                engine.call(0x1972a0, [MEM + 0x8000, MEM + 0x6000], {2: step}, instruction_budget=800000)
                s = MEM + 0x2000
                output = {'time': engine.read(s + 0x1a4, 'f')[0], 'loops': engine.read(s + 0x38, 'I')[0],
                    'accumulated': engine.read(s, 'f')[0], 'emission': {'spacing': engine.read(s + 0x1d0, 'f')[0],
                    'fractionalCount': engine.read(s + 0x1d4, 'f')[0], 'random': engine.read(s + 0x1d8, '4I')}}
                schedules.append({'input': {'delta': f(delta), 'time': f(time), 'accumulated': f(remainder),
                    'fixedTimeStep': fixed, 'allowCatchUpStepGrowth': growth}, 'step': step,
                    'output': output, 'trace': list(engine.trace)})
    for active in [0, 1, 3, 4, 31, 32, 999, 1000, 1001]:
        for requested in [0, 1, 3, 4, 17, 1001]:
            engine.setup()
            engine.write(MEM + 0x6000 + 0x10, 'Q', active)
            engine.write(MEM + 0x3000 + 0x174, 'I', 1000)
            engine.write(MEM + 0xa000, 'Q', requested)
            start = engine.call(0x186c80, [MEM, MEM + 0x6000, MEM + 0xa000, MEM + 0xa008])
            accepted = engine.read(MEM + 0xa000, 'Q')[0]
            allocations.append({'input': {'activeCount': active, 'maximumParticles': 1000, 'requested': requested},
                'output': {'startIndex': start, 'accepted': accepted,
                    'temporaryCount': engine.read(MEM + 0x6000 + 0x10, 'Q')[0],
                    'reserveCapacity': engine.trace[0]['count'] if engine.trace else None,
                    'finalCount': engine.read(MEM + 0xa008, 'Q')[0] + accepted}})
    player = PlaySequenceEngine(args.dll)
    for automatic in [False, True]:
        for stopped in [False, True]:
            for prewarm_enabled in [False, True]:
                player.setup_play(automatic=automatic, stopped=stopped, prewarm=prewarm_enabled)
                player.call(0x18faf0, [MEM, 1], instruction_budget=1000000)
                play_sequences.append({'input': {'automatic': automatic, 'seed': 0, 'managerSeed': 42,
                    'stopped': stopped, 'prewarm': prewarm_enabled},
                    'trace': list(player.trace), 'seed': player.read(MEM + 0x1000 + 0x30, 'I')[0],
                    'manager': player.read(MEM + 0xd000 + 0xc0, '4I'),
                    'emission': player.read(MEM + 0x2000 + 0x1d8, '4I'),
                    'playing': player.read(MEM + 0x2000 + 8, 'I')[0],
                    'initialTime': player.read(MEM + 0x2000 + 0x1a4, 'f')[0]})
    birth = BirthTimingEngine(args.dll)
    for count in [0, 1, 3, 4, 7, 8]:
        for continuous, spacing, fractional in [(0, 0, 0), (1, 2, .4), (3, .5, .3), (8, .125, .8)]:
            for time, delta in [(0, .02), (.01, .03), (.5, .02), (1, .1)]:
                inp = {'count': count, 'continuous': continuous, 'spacing': f(spacing), 'fractional': f(fractional),
                       'time': f(time), 'delta': f(delta), 'start': 4}
                birth_timings.append({'input': inp, 'output': birth.timing(**inp)})
    output = {'kind': 'unity-particle-lifecycle-instruction-probes-v1', 'semanticsVerified': False,
        'lane': 'isolated-x64-instructions-with-explicit-external-providers', 'nativeSha256': NATIVE_SHA,
        'timesteps': timesteps, 'prewarm': prewarm, 'schedules': schedules, 'allocations': allocations,
        'playSequences': play_sequences,
        'birthTimings': birth_timings,
        'providers': ['TimeManager fields .02/.03 and IsWorldPlaying=true', 'float32 fmodf/ceilf through host CRT math',
            'motion, birth and final size callbacks recorded without executing their modules',
            'particle allocation callback records capacity and updates only the controlled count field',
            'Play: active scene object, empty subemitters/optional module, allocation/transform/bounds/notifications and prewarm Update are controlled providers',
            'StartModules timing: inert Initial/StartVelocity/PreSimulation, zero particle velocities and no optional modules; no death or compaction'],
        'notVerified': ['Original Windows game process', 'Complete emitter state or visual frames',
            'Play scene hierarchy or prewarm particle execution', 'System entropy acquisition', 'Source frame clock acquisition', 'GPU execution']}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'timesteps': len(timesteps), 'prewarm': len(prewarm), 'schedules': len(schedules),
        'allocations': len(allocations), 'playSequences': len(play_sequences), 'birthTimings': len(birth_timings)}))


if __name__ == '__main__':
    main()
