"""Controlled execution of this build's particle geometry instructions.

This is x64 instruction emulation, not a Unity process or GPU acceptance run.
Inputs are explicitly laid out temporary/SoA buffers. No geometry calculation
is replaced by a Python implementation. Injected services supply a read-only
PlayerSettings object and accept free(nullptr); nonnull frees are rejected.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct

from probe_unity_particle_emitter import Engine, MEM, STACK, STOP, NATIVE_SHA
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_RAX, UC_X86_REG_RSP, UC_X86_REG_RIP, UC_X86_REG_GS_BASE, UC_X86_REG_RCX

IDENTITY = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.]


class GeometryEngine(Engine):
    def __init__(self, path: Path):
        super().__init__(path)
        # _alloca_probe reads the Windows TIB stack limit; supply mapped stack
        # bounds rather than replacing the stack-probing instructions.
        self.uc.mem_map(0x10000000, 0x1000)
        self.uc.reg_write(UC_X86_REG_GS_BASE, 0x10000000)
        self.write(0x10000010, 'Q', STACK)
        self.calls = []
        self.settings = MEM + 0xe000
        def service(uc, address, size, _):
            if address in [self.base + 0x591940, self.base + 0x58a7c0]:
                # GetPlayerSettings native object registry: explicit input,
                # not an override of its color-space getter or format logic.
                if address == self.base + 0x58a7c0:
                    if uc.reg_read(UC_X86_REG_RCX) != 0:
                        raise ValueError('Geometry requested a real allocation/free')
                else:
                    uc.reg_write(UC_X86_REG_RAX, self.settings)
                sp = uc.reg_read(UC_X86_REG_RSP)
                uc.reg_write(UC_X86_REG_RIP, self.read(sp, 'Q')[0])
                uc.reg_write(UC_X86_REG_RSP, sp + 8)
        self.uc.hook_add(UC_HOOK_CODE, service, begin=self.base + 0x591940, end=self.base + 0x591940)
        self.uc.hook_add(UC_HOOK_CODE, service, begin=self.base + 0x58a7c0, end=self.base + 0x58a7c0)
        # Exact static initializer for math::rsqrte_magicnumber. This avoids
        # treating its zero-initialized PE BSS value as the engine runtime value.
        self.call(0x78920)

    def trs(self, position, rotation):
        out, p, q, scale = [MEM + n for n in [0xc000, 0xc100, 0xc200, 0xc300]]
        self.write(p, '3f', *position); self.write(q, '4f', *rotation); self.write(scale, '3f', 1, 1, 1)
        self.call(0x7599d0, [out, p, q, scale])
        return self.read(out, '16f')

    def indices(self, count):
        self.write(MEM, '32768x')
        job, mapped, data, output = [MEM + n for n in [0, 0x100, 0x1000, 0x3000]]
        self.write(job, '2Q', mapped, data)
        self.write(mapped + 8, 'Q', output); self.write(mapped + 0x14, 'I', count * 6)
        self.call(0xd7c720, [job, 0])
        return self.read(output, str(count * 6) + 'H')

    def billboard(self, rotations, sizes, centers):
        self.write(MEM, '16384x')
        positions, rotation, basis, half, a, b, output = [MEM + n for n in [0, 0x100, 0x200, 0x300, 0x400, 0x500, 0x600]]
        self.write(positions, '12f', *[centers[p][axis] for axis in range(3) for p in range(4)])
        self.write(rotation + 0x20, '4f', *rotations)
        self.write(basis, '36f', *[float(axis == column) for column in range(3) for axis in range(3) for _ in range(4)])
        self.write(half, '8f', *[s / 2 for s in sizes], *[s / 2 for s in sizes])
        self.call(0xd5dea0, [positions, rotation, basis, half], stack=[('Q', a), ('Q', b), ('Q', output)])
        values = self.read(output, '48f')
        return [[[values[v * 12 + axis * 4 + p] for axis in range(3)] for v in range(4)] for p in range(4)]

    def template(self, particles, max_size, emitter=IDENTITY, camera=IDENTITY):
        self.write(MEM, '32768x')
        ref, temp, renderer, modules, soa, buffers, output = [MEM + n for n in [0, 0x100, 0x400, 0x800, 0x1800, 0x2100, 0x4000]]
        self.write(ref, 'Q', output)
        cm, em, aux = MEM + 0x3400, MEM + 0x3500, MEM + 0x3600
        self.write(cm, '16f', *camera); self.write(em, '16f', *emitter); self.write(aux, '4f', 0, 0, 0, 0)
        self.call(0xd89590, [temp, cm, aux, em], stack=[('Q', aux)])
        self.write(temp + 0x114, '3f', 1, 1, 1)
        self.write(temp + 0x120, '4f', 0, 0, 0, max_size)
        self.write(temp + 0x134, 'f', 1)
        self.write(renderer + 0x43, 'B', 1)
        self.write(soa + 0x10, 'Q', len(particles))
        # Source arrays are separate. The +0x380 buffer is a random seed, not
        # final RGBA; final colors belong to the RenderJob temporary buffers.
        lanes = {0: [p['position'][0] for p in particles], 0x20: [p['position'][1] for p in particles],
                 0x40: [p['position'][2] for p in particles], 0x220: [p['rotation'] for p in particles],
                 0x2a0: [p['size'] for p in particles], 0x3c0: [p['age'] for p in particles]}
        cursor = MEM + 0x2800
        for offset in [0, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0, 0x100, 0x220, 0x2a0, 0x380, 0x3c0]:
            self.write(soa + offset, 'Q', cursor)
            self.write(cursor, '4f', *(lanes.get(offset, []) + [0] * 4)[:4])
            cursor += 0x20
        colors = MEM + 0x2f00
        self.write(colors, '4I', *([p['color32'] for p in particles] + [0] * 4)[:4])
        self.write(buffers, '3Q', colors, 0, 0)
        self.call(0xd5bfd0, [output, temp, renderer, modules], stack=[('Q', soa), ('Q', buffers)])
        result = []
        for p in range(len(particles)):
            vertices = []
            for v in range(4):
                at = output + (p * 4 + v) * 36
                values = self.read(at, '6fI2f')
                vertices.append({'position': values[:3], 'normal': values[3:6], 'color32': values[6], 'uv': values[7:]})
            result.append(vertices)
        return {'vertices': result, 'cameraBasis': self.read(temp + 0x40, '16f')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dll', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(); engine = GeometryEngine(args.dll)
    billboards = []
    for rotations in [[0, .1, -.1, 1], [-10, 3.1415927, -3.1415927, 6.2831855], [100, -100, .7853982, 1.5707964]]:
        sizes = [2, 4, 0, 10]; centers = [[1, 2, 3], [10, -20, 0], [-1, -2, -3], [0, 0, 0]]
        billboards.append({'rotations': rotations, 'sizes': sizes, 'centers': centers,
                           'vertices': engine.billboard(rotations, sizes, centers)})
    templates = []
    for maximum in [16, 64, 128]:
        particles = [dict(position=[p, p * 2, p - 1], rotation=rotation, size=size, age=age, color32=color)
                     for p, (rotation, size, age, color) in enumerate([(0, 4, 0, 0xff336699), (.5, maximum * 2, .5, 0x80ffffff), (-.5, 1e-8, 1, 0x12345678), (1, 5, 100, 0xffffffff)])]
        templates.append({'particles': particles, 'maxSize': maximum, 'emitter': IDENTITY, 'camera': IDENTITY,
                          'output': engine.template(particles, maximum)})
    emitter = engine.trs([10, 200, 30], [0, 0, -.026176923885941505, .9996573328971863])
    camera = [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., -1., 0., -10., -200., 10., 1.]
    for count in [0, 1, 2, 3, 4]:
        particles = [dict(position=[10.5 + p, -2.5 * p, -3 + p], rotation=[.1, -.1, 100, -100][p],
                          size=[128, 1e-8, 0, 3][p], age=[0, 1, 99, 99][p], color32=0x12345678 + p) for p in range(count)]
        templates.append({'particles': particles, 'maxSize': 64, 'emitter': emitter, 'camera': camera,
                          'parent': [10, 200, 30], 'emitterRotation': [0, 0, -.026176923885941505, .9996573328971863],
                          'output': engine.template(particles, 64, emitter, camera)})
    formats = []
    for active in [0, 1]:
        engine.write(engine.settings + 0x20c, 'I', active)
        for requested in [False, True]:
            value = engine.call(0x690340, [0, int(requested)])
            srgb = engine.call(0x682b40, [value]) & 255
            formats.append({'activeColorSpace': active, 'requestedSRGB': requested, 'graphicsFormat': value, 'isSRGBFormat': bool(srgb)})
    result = {'kind': 'unity-particle-geometry-instruction-probes-v1', 'nativeSha256': NATIVE_SHA,
              'lane': 'isolated-x64-instruction-emulation', 'billboards': billboards, 'templates': templates, 'formats': formats,
              'indices': [{'count': n, 'values': engine.indices(n)} for n in [0, 1, 2, 5]],
              'notVerified': ['Unity process execution', 'GPU rasterization', 'live source emitter state']}
    args.out.parent.mkdir(parents=True, exist_ok=True); args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'billboardParticles': len(billboards) * 4, 'templates': len(templates), 'formats': len(formats)}))


if __name__ == '__main__': main()
