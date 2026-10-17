"""Exact local UnityPlayer birth inspection and isolated instruction probes.

No Unity process, OS entropy, or fabricated particle scheduling is supplied.
All output belongs in ignored local evidence directories.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import struct

from inspect_unity_particles import (PEImage, Cs, CS_ARCH_X86, CS_MODE_64,
    X86_OP_IMM, directories, public_symbols, local_symbols, native_body, sha)
from probe_unity_particle_emitter import NATIVE_SHA, Engine, MEM
from unicorn.x86_const import UC_X86_REG_GS_BASE


class BirthEngine(Engine):
    """Controlled native storage; every arithmetic instruction remains original."""
    def __init__(self, path: Path):
        super().__init__(path)
        self.uc.mem_map(MEM + 0x10000, 0x80000)
        self.pe = PEImage(self.data)
        # This pure dynamic initializer writes the actual kRotationOrderLUT.
        self.call(0x80c10)
        # Initial.Start's local color rounding constant is initialized by a
        # CRT thread guard. Supply its exact initialized value and a completed
        # guard; no thread/CRT/OS execution is claimed by these leaf probes.
        tls = MEM + 0x88000
        self.uc.reg_write(UC_X86_REG_GS_BASE, tls)
        self.write(tls + 0x58, 'Q', tls + 0x100)
        self.write(tls + 0x100, 'Q', tls + 0x200)
        self.write(tls + 0x210, 'i', 0x7fffffff)
        self.uc.mem_write(self.base + 0x17b49a0, self.pe.read(0x1452080, 16)[2])

    def setup(self, source: dict, seed: int):
        self.write(MEM, '65536x')
        initial, particles, matrix, time = MEM, MEM + 0x1000, MEM + 0x2000, MEM + 0x2100
        # Structure-of-array storage: each fixed source pointer receives a
        # private, aligned 32-float buffer. Unused native optional arrays exist
        # but all optional cache/storage flags remain explicitly zero.
        for offset in range(0, 0x7a0, 0x20):
            self.write(particles + offset, 'Q', MEM + 0x3000 + offset * 0x10)
        self.write(matrix, '16f', 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)
        for key, offset in [('startLifetime',0x10),('startSpeed',0x30),('startSize',0x90),('startRotation',0x130)]:
            curve = source['InitialModule'][key]
            if curve['minMaxState'] not in [0,3]: raise ValueError('Probe curve mode is not admitted')
            self.write(initial + offset + 4, 'H', curve['minMaxState'])
            self.write(initial + offset + 8, '2f', curve['minScalar'], curve['scalar'])
        c = source['InitialModule']['startColor']
        if c['minMaxState'] != 0: raise ValueError('Probe color mode is not admitted')
        self.write(initial + 0x78, '4f', *[c['maxColor'][key] for key in ['r','g','b','a']])
        self.write(initial + 0x88, 'H', 0)
        self.write(initial + 0x1c0, 'I', 0xffffffff)
        self.write(initial + 0x1c4, '3f', 1,1,1)
        self.write(initial + 0x1e8, 'f', 1)
        self.write(initial + 0x1ec, 'I', 0x7f800000)
        shape, state, readonly, emission, parent = [MEM + n for n in [0x18000,0x19000,0x1a000,0x1b000,0x1c000]]
        self.write(shape, '20480x')
        s = source['ShapeModule']
        for offset, value in [(0x18,s['radius']['value']),(0x50,s['angle']),(0x58,s['radiusThickness']),(0x70,s['arc']['value']),(0x78,s['arc']['spread'])]:
            self.write(shape + offset, 'f', value)
        self.write(shape + 0x10, 'I', s['type']); self.write(shape + 0x74, 'I', s['arc']['mode'])
        for offset, key in [(0xa8,'m_Position'),(0xb4,'m_Rotation'),(0xc0,'m_Scale')]:
            self.write(shape + offset, '3f', *[s[key][axis] for axis in ['x','y','z']])
        for offset,key in [(0x140,'randomDirectionAmount'),(0x144,'sphericalDirectionAmount'),(0x148,'randomPositionAmount')]:
            self.write(shape + offset,'f',s[key])
        self.write(shape + 0x14c,'B',int(s['alignToDirection']))
        self.write(state + 0x148,'3f',1,1,1)
        self.write(emission,'2f',1,0); self.write(parent + 0x50,'Q',initial)
        self.write(MEM + 0xf000,'I',seed)
        self.call(0x764ce0,[initial+0x180,MEM+0xf000]); self.call(0x764ce0,[shape+0x240,MEM+0xf000])
        self.addresses = initial,particles,matrix,time,shape,state,readonly,emission,parent

    def birth(self, start: int, count: int, normalized_time: float):
        initial,particles,matrix,time,shape,state,readonly,emission,parent = self.addresses
        padded = ((count + 3) // 4) * 4
        self.write(particles + 0x10,'Q',start+padded)
        self.write(time,'4f',*[normalized_time]*4)
        self.call(0x20b2d0,[initial,particles,matrix,start],stack=[('Q',time)])
        self.call(0xda9940,[shape,readonly,state,particles],stack=[('Q',emission),('Q',matrix),('Q',start),('Q',0),('Q',count)])
        self.call(0x196260,[parent,particles,start,start+padded],stack=[('Q',matrix),('Q',time),('Q',1),('Q',0)])
        def values(offset,fmt='f'):
            pointer=self.read(particles+offset,'Q')[0]
            return self.read(pointer+4*start,str(padded)+fmt)
        columns={key:values(offset,'I' if key in ['seed','packedColor'] else 'f') for key,offset in [
            ('px',0),('py',0x20),('pz',0x40),('vx',0x60),('vy',0x80),('vz',0xa0),('rotation',0x220),
            ('size',0x2a0),('packedColor',0x360),('seed',0x380),('normalizedAge',0x3c0),('inverseLifetime',0x3e0)]}
        result=[]
        for i in range(padded):
            result.append({'index':start+i,'seed':columns['seed'][i],'position':[columns[k][i] for k in ['px','py','pz']],
                'velocity':[columns[k][i] for k in ['vx','vy','vz']], 'rotation':columns['rotation'][i], 'size':columns['size'][i],
                'packedColor':columns['packedColor'][i], 'normalizedAge':columns['normalizedAge'][i], 'inverseLifetime':columns['inverseLifetime'][i]})
        return {'startIndex':start,'count':count,'paddedCount':padded,'normalizedEmitterTime':normalized_time,
                'particles':result,'random':{'initial':self.read(initial+0x180,'16I'),'shape':self.read(shape+0x240,'16I')}}


def run_probes(path: Path, media_path: Path) -> dict:
    media=json.loads(media_path.read_text()); engine=BirthEngine(path); cases=[]
    names=['ef_ff6_m_001','ef_ff6_m_002','ef_ff6_m_003','ef_ff6_m_004','ef_ff6_m_016']
    if list(media['groups']) != names: raise ValueError('Unexpected source effect set')
    for name in names:
        graph=media['groups'][name]
        sources=[o for o in graph['objects'] if o['type']=='ParticleSystem' and o['source']['objectId'] in graph['hierarchyIds']]
        if len(sources)!=1: raise ValueError('Expected one source emitter')
        source=sources[0]
        for seed in [0,1,42,0x12345678,0x80000000,0xffffffff]:
            engine.setup(source['data'],seed)
            steps=[engine.birth(start,count,time) for start,count,time in [(0,0,0),(0,1,0),(4,3,.125),(8,4,.5),(12,5,.75),(20,8,1)]]
            cases.append({'asset':name,'source':source['source'],'seed':seed,'steps':steps})
    controlled=[]
    graph=media['groups'][names[2]]
    source=next(o for o in graph['objects'] if o['type']=='ParticleSystem' and o['source']['objectId'] in graph['hierarchyIds'])['data']
    for index,(angle,radius,rotation,color) in enumerate([(0,0,[0,0,0],[-1,.5,1.5,.25]),(55,3,[30,-20,70],[.1,.2,.3,.4]),(90,1,[-360,180,45],[1,1,1,1])]):
        p=copy.deepcopy(source);s=p['ShapeModule'];s['angle']=angle;s['radius']['value']=radius
        s['m_Rotation']=dict(zip(['x','y','z'],rotation));p['InitialModule']['startColor']['maxColor']=dict(zip(['r','g','b','a'],color))
        if index==0:
            for key,value in [('startLifetime',-2),('startSize',-1),('startRotation',0)]:
                p['InitialModule'][key]['minMaxState']=0;p['InitialModule'][key]['scalar']=value
        engine.setup(p,42)
        controlled.append({'label':'explicit-controlled-extension-'+str(index),'seed':42,'initial':p['InitialModule'],'shape':s,'steps':[engine.birth(0,8,.25)]})
    return {'kind':'unity-particle-birth-instruction-probes-v1','semanticsVerified':False,
            'lane':'isolated-x64-instruction-emulation','nativeSha256':NATIVE_SHA,
            'media':str(media_path),'mediaSha256':sha(media_path.read_bytes()),'cases':cases,'controlledCases':controlled,
            'controlledInputs':['Known fixed seeds (not source system entropy)','Aligned capacity/storage; no AddNewParticles allocator',
                'Unit simulation scale, local identity transform, fresh inherited defaults','Completed CRT local-color-constant guard',
                'No optional particle cache arrays','Initial/Shape/CalculateInitialValues only; no motion or age integration'],
            'notVerified':['Original Windows/Unity process execution','Every x86 CPU reciprocal-estimate bit pattern',
                'Birth scheduling and deletion/compaction','Complete prefab rendering']}


def shape_dispatch_body(pe: PEImage, symbols: list[dict]) -> dict:
    """The exact Shape::Start switch has a source-bounded 19-entry RVA table.

    The generic inspector correctly refuses unknown indirect branches. This
    one exception is established by the preceding cmp/ja and mov/add/jmp raw
    sequence, not a guessed whole-function .pdata extent.
    """
    rva, limit, branch, table = 0xda9940, 0xdaafb0, 0xda9f95, 0xdaaf60
    raw = pe.read(0xda9f6b, 44)[2]
    if raw.hex() != '83f8120f87a10f00004c89ac24a80a0000488d157d6025ff4c89bc24b00a00008b8c8260afda004803caffe1':
        raise ValueError('Shape dispatch instructions changed')
    targets = struct.unpack('<19I', pe.read(table, 19 * 4)[2])
    if any(not rva <= target < table for target in targets):
        raise ValueError('Shape switch target leaves its PDB function')
    decoder = Cs(CS_ARCH_X86, CS_MODE_64); decoder.detail = True
    pending, seen, end, tails, calls = [rva], set(), rva, set(), []
    while pending:
        pc = pending.pop()
        while pc not in seen:
            if not rva <= pc < table:
                raise ValueError('Shape control flow leaves code range')
            inst = next(decoder.disasm(pe.read(pc, 16)[2], pc, count=1), None)
            if inst is None: raise ValueError('Undecodable Shape instruction')
            seen.add(pc); end = max(end, pc + inst.size)
            if inst.mnemonic == 'call' and inst.operands[0].type == X86_OP_IMM:
                target = inst.operands[0].imm
                calls.append({'rva': hex(pc), 'targetRva': hex(target),
                              'aliases': sorted({s['name'] for s in symbols if s['rva'] == target})})
            if inst.mnemonic.startswith('ret'): break
            if inst.mnemonic.startswith('j'):
                if inst.operands[0].type != X86_OP_IMM:
                    if pc != branch or inst.mnemonic != 'jmp': raise ValueError('Unknown Shape indirect branch')
                    pending.extend(targets); break
                target = inst.operands[0].imm
                if rva <= target < table: pending.append(target)
                else: tails.add(target)
                if inst.mnemonic == 'jmp': break
            pc += inst.size
    end = max(end, table + len(targets) * 4)
    if end > limit: raise ValueError('Shape body crosses the next PDB function')
    at, size = directories(pe, 3)
    entries = [struct.unpack('<III', pe.read(at+i, 12)[2]) for i in range(0, size, 12)]
    data = pe.read(rva, end-rva)[2]
    return {'rva': hex(rva), 'endRva': hex(end), 'size': len(data), 'sha256': sha(data),
            'boundary': 'pdb-bounded-explicit-switch-control-flow',
            'aliases': sorted({s['name'] for s in symbols if s['rva'] == rva}),
            'runtimeFunctionRanges': [{'rva': hex(a), 'endRva': hex(b), 'unwindRva': hex(c)} for a,b,c in entries if rva <= a < end],
            'tailTargets': [hex(a) for a in sorted(tails)], 'directCalls': calls,
            'switch': {'branchRva': hex(branch), 'tableRva': hex(table), 'instructionSha256': sha(raw),
                       'targets': [hex(t) for t in targets]}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dll', type=Path, required=True)
    parser.add_argument('--inspect', type=Path, help='Verified base inspection; retain its exact DLL/PDB identity')
    parser.add_argument('--publics', type=Path)
    parser.add_argument('--locals', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--media', type=Path, default=Path('build/v33-field-effect-media/media.json'))
    args = parser.parse_args()
    pe = PEImage(args.dll.read_bytes())
    if sha(pe.data) != NATIVE_SHA: raise ValueError('Birth probes require the reviewed UnityPlayer build')
    if args.inspect:
        data = json.loads(args.inspect.read_text())
        if data['kind'] != 'unity-particle-native-inspection-v1' or data['native']['sha256'] != NATIVE_SHA or data['semanticsVerified'] is not False or \
           data['pdb']['guid'] != '4420B376-89DD-4CFE-AEC8-2300F4A999D2' or data['pdb']['age'] != 1 or \
           data['pdb']['sha256'] != 'c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85':
            raise ValueError('Unbound base inspection')
        symbols = public_symbols(args.publics.read_text(), pe) + local_symbols(args.locals.read_text(), pe)
        data['methods'] = [shape_dispatch_body(pe, symbols)] + [native_body(pe, rva, symbols) for rva in [0xda6ef0,0xda7d90,0x185510,0xda91d0,0x206f90]]
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(data, indent=2) + '\n')
        print(json.dumps({'methods': len(data['methods']), 'out': str(args.out)}))
    else:
        data=run_probes(args.dll,args.media)
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(data,indent=2)+'\n')
        print(json.dumps({'cases':len(data['cases']),'batches':sum(len(c['steps']) for c in data['cases']),'out':str(args.out)}))


if __name__ == '__main__': main()
