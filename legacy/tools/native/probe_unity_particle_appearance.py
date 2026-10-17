"""Execute final particle Size/Color buffers from the bound UnityPlayer image.

Controlled SoA inputs and static TLS guards replace no appearance instructions.
This is an isolated x64 instruction lane, not a running Unity scene or game.
"""
from __future__ import annotations
import argparse, hashlib, json, struct
from pathlib import Path
from probe_unity_particle_emitter import Engine, MEM, NATIVE_SHA
from inspect_pe import PEImage
from unicorn.x86_const import UC_X86_REG_GS_BASE

GROUPS = [f'ef_ff6_m_{n:03}' for n in [1, 2, 3, 4, 16]]
def f32(v): return struct.unpack('<f', struct.pack('<f', v))[0]

class AppearanceEngine(Engine):
    def __init__(self, path):
        super().__init__(path)
        self.pe = PEImage(self.data)
        self.uc.mem_map(MEM + 0x10000, 0x10000)
        tls = MEM + 0x18000
        self.uc.reg_write(UC_X86_REG_GS_BASE, tls)
        self.write(tls + 0x58, 'Q', tls + 0x100)
        self.write(tls + 0x100, 'Q', tls + 0x200)
        self.write(tls + 0x210, 'i', 0x7fffffff)
        # Source static Color32 multiply/lerp constants after their once-only
        # initialization. Do not emulate the Windows CRT thread lock itself.
        for target, source in [(0x17b46f0, 0x1452080), (0x17b4710, 0x1452080), (0x17b4730, 0x1452090)]:
            self.uc.mem_write(self.base + target, self.pe.read(source, 16)[2])

    def reset(self):
        self.write(MEM, '65536x')

    def soa(self):
        p = MEM + 0x4000
        for off in range(0, 0x700, 0x20):
            self.write(p + off, 'Q', MEM + 0x5000 + off)
        self.write(p + 0x10, 'Q', 4)
        return p

    def curve(self, address, keys, storage):
        self.write(address + 4, 'f', float('inf'))
        self.write(address + 8, 'f', -float('inf'))
        self.write(address + 0x38, 'Q', storage)
        self.write(address + 0x48, 'Q', len(keys))
        self.write(address + 0x58, '2i', 2, 2)
        for i, key in enumerate(keys):
            self.write(storage + i * 28, '4fI2f', key['time'], key['value'], key['inSlope'], key['outSlope'], key.get('weightedMode', 0), key.get('inWeight', 0), key.get('outWeight', 0))

    def gradient(self, address, gradient):
        for i in range(8):
            key = gradient['key' + str(i)]
            self.write(address + i * 16, '4f', key['r'], key['g'], key['b'], key['a'])
            self.write(address + 0x80 + i * 2, 'H', gradient['ctime' + str(i)])
            self.write(address + 0x90 + i * 2, 'H', gradient['atime' + str(i)])
        self.write(address + 0xa0, 'BB', gradient['m_NumColorKeys'], gradient['m_NumAlphaKeys'])
        self.write(address + 0xa4, 'i', gradient['m_Mode'])

    def read_cache(self, at):
        count = self.read(at + 0xc0, 'I')[0]
        return {'times':self.read(at + 0x40, str(count)+'f'), 'colors':self.read(at,str(count)+'I'), 'inverseSpans':self.read(at + 0x80,str(count)+'f')}


def input_bytes(size, gradient):
    keys = size['maxCurve']['m_Curve']
    result = struct.pack('<HfI2i', size['minMaxState'], size['scalar'], len(keys), size['maxCurve']['m_PreInfinity'], size['maxCurve']['m_PostInfinity'])
    for k in keys:
        result += struct.pack('<4fI2f', k['time'], k['value'], k['inSlope'], k['outSlope'], k.get('weightedMode',0), k.get('inWeight',0), k.get('outWeight',0))
    for i in range(8):
        k = gradient['key'+str(i)]; result += struct.pack('<4f',k['r'],k['g'],k['b'],k['a'])
    result += struct.pack('<16H', *[gradient['ctime'+str(i)] for i in range(8)], *[gradient['atime'+str(i)] for i in range(8)])
    result += struct.pack('<BBi', gradient['m_NumColorKeys'],gradient['m_NumAlphaKeys'],gradient['m_Mode'])
    return result

def cache_bytes(optimized, coefficients, cache):
    count = len(cache['times'])
    return struct.pack('<?9fI',optimized,*coefficients,count)+struct.pack('<'+str(count)+'f',*cache['times'])+struct.pack('<'+str(count)+'I',*cache['colors'])+struct.pack('<'+str(count)+'f',*cache['inverseSpans'])

def source_particles(path):
    media = json.loads(path.read_text())
    for group in GROUPS:
        graph = media['groups'][group]
        objects = [o for o in graph['objects'] if o['type'] == 'ParticleSystem' and o['source']['objectId'] in graph['hierarchyIds']]
        if len(objects) != 1: raise ValueError('Ambiguous source emitter')
        yield group, objects[0]


def probe(e, media_path):
    sizes, colors, bindings = [], [], []
    ages_sets = [[0, 10, 60, 100], [0.000003, 25, 75, 99.99999], [9.999, 59.999, 89.999, 90], [90.001, 99.99, 100, 100.00000762939453]]
    seeds = [0, 1, 42, 0xffffffff]
    bases = [0xffffffff, 0x80402010, 0x01020304, 0x00ff807f]
    starts = [1, 12, 27.375, 42]
    for group, particle in source_particles(media_path):
        size = particle['data']['SizeModule']['curve']; gradient = particle['data']['ColorModule']['gradient']['maxGradient']
        keys = size['maxCurve']['m_Curve']
        e.reset(); e.curve(MEM + 0x1000, keys, MEM + 0x2000)
        ok = e.call(0x762db0, [MEM + 0x1070, MEM + 0x1000], {2:size['scalar']})
        coefficients = e.read(MEM + 0x1070, '9f')
        e.gradient(MEM + 0x3000, gradient)
        e.call(0x755d00, [MEM + 0x3000, MEM + 0x6000])
        cache = e.read_cache(MEM + 0x6000)
        bindings.append({'group':group, 'source':particle['source'], 'size':size, 'gradient':gradient, 'optimized':bool(ok & 255), 'coefficients':coefficients, 'cache':cache, 'inputSha256':hashlib.sha256(input_bytes(size,gradient)).hexdigest(), 'cacheSha256':hashlib.sha256(cache_bytes(bool(ok&255),coefficients,cache)).hexdigest()})
        for optimized in [False, True]:
            for ages in ages_sets:
                e.reset(); p = e.soa(); module = MEM
                e.curve(MEM + 0x1000, keys, MEM + 0x2000)
                e.call(0x762db0, [MEM + 0x1070, MEM + 0x1000], {2:size['scalar']})
                e.write(module + 0x14, 'H', 1); e.write(module + 0x16, 'B', int(optimized)); e.write(module + 0x1c, 'f', size['scalar'])
                e.write(module + 0x28, 'Q', MEM + 0x1000)
                e.write(MEM + 0x5380, '4I', *seeds); e.write(MEM + 0x53c0, '4f', *ages); e.write(MEM + 0x52a0, '4f', *starts)
                e.write(MEM + 0x5300, '4f', 789, 789, 789, 789)
                e.call(0x1f1190, [module, p, 0, 4])
                first = e.read(MEM + 0x5300, '4f'); e.call(0x1f1190, [module, p, 0, 4])
                sizes.append({'group':group, 'optimized':optimized, 'seeds':seeds, 'agePercent':list(map(f32,ages)), 'startSize':starts, 'value':first, 'repeat':e.read(MEM + 0x5300,'4f'), 'seedsAfter':e.read(MEM + 0x5380,'4I'), 'startAfter':e.read(MEM + 0x52a0,'4f')})
        for ages in ages_sets:
            for original in [bases, [0xffffffff]*4]:
                e.reset(); p = e.soa(); modules = MEM
                e.gradient(MEM + 0x3000, gradient)
                e.write(modules + 0x7f8, 'B', 1); e.write(modules + 0x838, 'H', 1); e.write(modules + 0x810, 'Q', MEM + 0x3000)
                e.write(MEM + 0x5380, '4I', *seeds); e.write(MEM + 0x53c0, '4f', *ages); e.write(MEM + 0x5360, '4I', *original)
                e.write(MEM + 0x6000, '2Q', MEM + 0x7000, 0); e.write(MEM + 0x7000, '4I', *([0]*4))
                e.call(0x19a320, [modules, p, MEM + 0x6000, 0], stack=[('I',0)])
                first = e.read(MEM + 0x7000,'4I'); e.call(0x19a320, [modules, p, MEM + 0x6000, 0], stack=[('I',0)])
                colors.append({'group':group,'seeds':seeds,'agePercent':list(map(f32,ages)),'startColor32':original,'value':first,'repeat':e.read(MEM + 0x7000,'4I'),'seedsAfter':e.read(MEM + 0x5380,'4I'),'startAfter':e.read(MEM + 0x5360,'4I')})
    return {'kind':'unity-particle-appearance-instruction-probes-v1','nativeSha256':NATIVE_SHA,'semanticsVerified':False,'lane':'isolated-x64-instruction-emulation', 'bindings':bindings,'sizes':sizes,'colors':colors,
        'limitations':['No Unity scene or original game executes. Static SIMD constants are initialized from the bound DLL while Windows TLS guards use a controlled initialized context.', 'Source ColorModule is evaluated through the full nonincremental method, with gamma conversion flag explicitly false.', 'Source curve optimized and forced-slow branches execute independently; forced-slow is a controlled diagnostic, not the five source emitters selection.']}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dll',type=Path,required=True);p.add_argument('--media',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();result=probe(AppearanceEngine(a.dll),a.media);a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:len(result[k]) for k in ['bindings','sizes','colors']}))
if __name__=='__main__':main()
