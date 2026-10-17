"""Run bounded UnityPlayer Noise/motion instructions in Unicorn, not a Unity scene.

The exact DLL is verified by Engine. Source masks execute their native initializer;
permutation and gradients are read from that same image, never substituted tables.
"""
from __future__ import annotations
import argparse, hashlib, json, struct
from pathlib import Path
from probe_unity_particle_emitter import Engine, MEM, NATIVE_SHA
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_XMM0, UC_X86_REG_RAX, UC_X86_REG_RDX, UC_X86_REG_RIP, UC_X86_REG_RSP
from inspect_pe import PEImage

def f32(v): return struct.unpack('<f', struct.pack('<f', v))[0]
def rng(seed):
    words=[seed]
    for _ in range(3): words.append((words[-1]*0x6c078965+1)&0xffffffff)
    out=[]
    for _ in range(3):
        x,y,z,w=words; t=(x^(x<<11))&0xffffffff
        value=(w^(w>>19)^t^(t>>8))&0xffffffff
        words=[y,z,w,value]; out.append(f32((value&0x7fffff)*f32(1/0x7fffff)))
    return out

def probe(engine):
    e=engine; pe=PEImage(e.data); e.call(0x6cb30)
    def section(rva,size,fmt):
        raw=pe.read(rva,size)[2]
        return {'rva':hex(rva),'sha256':hashlib.sha256(raw).hexdigest(),'values':list(struct.unpack('<'+fmt,raw))}
    kernel={'permutation':section(0x1455070,2048,'512I'), 'gradients':section(0x176bf90,192,'48f'),
            'mask':e.read(e.base+0x17b4990,'4I'), 'maskInitializer':section(0x6cb30,17,'17B')}
    points=[(0,0,0),(.2,.3,.4),(-.2,-1.3,-7.4),(100.2,50.3,29.4),(256,0,-256),(.99999,1.00001,-.99999)]
    perlin=[]
    for frequency in [.32,1,2,.001]:
      for p in points:
        e.write(MEM+0x100,'12f',*(v for v in p for _ in range(4)))
        e.write(MEM+0x200,'4f',*([frequency]*4))
        e.call(0x209830,[MEM,MEM+0x100,MEM+0x200])
        perlin.append({'position':list(map(f32,p)),'frequency':f32(frequency),'value':e.read(MEM,'8f')})
    noise=[]
    for seed in [0,42,0xffffffff]:
      for scroll in [0,.1,2.75]:
        for damping in [True,False]:
          e.write(MEM,'16384x'); mod=MEM; particles=MEM+0x1000; job=MEM+0x2000
          for off in [0x10,0x110]: e.write(mod+off+4,'H',0);e.write(mod+off+12,'f',1)
          e.write(mod+0x70,'f',.32);e.write(mod+0x75,'B',int(damping));e.write(mod+0x170,'f',scroll)
          # SoA allocations are separated to preserve actual pointer layout.
          positions=[(0,0,0),(.2,.3,.4),(-.2,-1.3,-7.4),(100.2,50.3,29.4)]
          for off in range(0,0x500,0x20):
            at=MEM+0x3000+off; e.write(particles+off,'Q',at);e.write(at,'4f',0,0,0,0)
          for axis in range(3): e.write(MEM+0x3000+axis*0x20,'4f',*(p[axis] for p in positions))
          e.write(MEM+0x3380,'4I',1,2,42,0xffffffff);e.write(MEM+0x33c0,'4f',0,25,75,100)
          e.write(job,'4Q',mod,particles,0,4);e.write(job+0x20,'4f',*rng(seed),0);e.write(job+0x30,'4f',.01,.01,.01,.01)
          e.call(0x1fe0b0,[job])
          noise.append({'systemSeed':seed,'scroll':f32(scroll),'damping':damping,'positions':positions,
                        'value':[e.read(MEM+0x3000+off,'4f') for off in [0xc0,0xe0,0x100]]})
    rotations=[]
    for by_speed in [False,True]:
      for direction in [0,.25,1]:
        e.write(MEM,'16384x');e.write(MEM+8,'2f',1.0471975803375244,-1.0471975803375244)
        e.write(MEM+0x1000+0x380,'Q',MEM+0x3000);e.write(MEM+0x1000+0x7b1,'B',1)
        e.write(MEM+0x3000,'4I',0,1,42,0xffffffff);e.write(MEM+0x4000,'4f',0,.1,-.2,5)
        e.write(MEM+0x5000,'4f',*([direction]*4))
        e.call(0x19e430 if by_speed else 0x1bbd70,[MEM,MEM+0x1000,MEM+0x4000,MEM+0x5000],stack=[('Q',0),('Q',4)])
        rotations.append({'bySpeed':by_speed,'randomizeDirection':direction,'seeds':[0,1,42,0xffffffff],
                          'before':[0,f32(.1),f32(-.2),5],'value':e.read(MEM+0x4000,'4f')})
    curves=[]
    samples=[-1,0,.00001,.05,.1,.199999,.2,.379999,.38,.5,.65,.9,1,1.1]
    media=json.loads(Path('build/v33-field-effect-media/media.json').read_text())
    for group in ['ef_ff6_m_001','ef_ff6_m_002']:
      graph=media['groups'][group]
      particle=next(o for o in graph['objects'] if o['type']=='ParticleSystem' and o['source']['objectId'] in graph['hierarchyIds'])
      for axis in ['x','y','z']:
        for lane in ['minCurve','maxCurve']:
          keys=particle['data']['VelocityModule'][axis][lane]['m_Curve']
          for t in samples:
            e.write(MEM,'16384x');e.write(MEM+4,'f',float('inf'));e.write(MEM+8,'f',-float('inf'))
            e.write(MEM+0x38,'Q',MEM+0x1000);e.write(MEM+0x48,'Q',len(keys));e.write(MEM+0x58,'2i',2,2)
            for i,k in enumerate(keys): e.write(MEM+0x1000+i*28,'4fI2f',k['time'],k['value'],k['inSlope'],k['outSlope'],0,0,0)
            e.call(0x75e4a0,[MEM,0,0],{1:t})
            value=struct.unpack('<f',struct.pack('<I',e.uc.reg_read(UC_X86_REG_XMM0)&0xffffffff))[0]
            curves.append({'group':group,'axis':axis,'lane':lane,'keys':keys,'time':f32(t),'value':value})
    def soa():
        particles=MEM+0x4000
        for off in range(0,0x700,0x20):
            e.write(particles+off,'Q',MEM+0x5000+off);e.write(MEM+0x5000+off,'4f',0,0,0,0)
        e.write(particles+0x10,'Q',4);e.write(particles+0x7b1,'B',1)
        return particles
    def curve(address, keys, storage):
        e.write(address+4,'f',float('inf'));e.write(address+8,'f',-float('inf'))
        e.write(address+0x38,'Q',storage);e.write(address+0x48,'Q',len(keys));e.write(address+0x58,'2i',2,2)
        for i,k in enumerate(keys): e.write(storage+i*28,'4fI2f',k['time'],k['value'],k['inSlope'],k['outSlope'],0,0,0)
    velocities=[];curve_bindings=[]
    for group in ['ef_ff6_m_001','ef_ff6_m_002']:
      graph=media['groups'][group]
      particle=next(o for o in graph['objects'] if o['type']=='ParticleSystem' and o['source']['objectId'] in graph['hierarchyIds'])
      for key in ['minCurve','maxCurve']:
        c=particle['data']['VelocityModule']['x'];keys=c[key]['m_Curve']
        e.write(MEM,'65536x');curve(MEM+0x1000,keys,MEM+0x2000)
        result=e.call(0x762db0,[MEM,MEM+0x1000],{2:c['scalar']})
        curve_bindings.append({'group':group,'axis':'x','lane':key,'keys':len(keys),'optimized':bool(result&0xff)})
      for ages in [[0,20,65,100],[.001,19.9999,38,90]]:
        e.write(MEM,'65536x');p=soa()
        for axis,key in enumerate(['x','y','z']):
            c=particle['data']['VelocityModule'][key];m=MEM+axis*0x40
            e.write(m+4,'H',2);e.write(m+12,'f',c['scalar'])
            for j,k in enumerate(['minCurve','maxCurve']):
                address=MEM+0x1000+axis*0x400+j*0x200
                e.write(m+16+j*8,'Q',address);curve(address,c[k]['m_Curve'],address+0x100)
        e.write(MEM+0x5380,'4I',0,1,42,0xffffffff);e.write(MEM+0x53c0,'4f',*ages)
        e.write(MEM+0x9000,'12f',1,0,0,0,0,1,0,0,0,0,1,0)
        e.call(0x259970,[MEM,MEM+0x40,MEM+0x80,p],stack=[('Q',0),('Q',4),('Q',MEM+0x9000)])
        velocities.append({'group':group,'seeds':[0,1,42,0xffffffff],'agePercent':list(map(f32,ages)),
                           'value':[e.read(MEM+0x5000+off,'4f') for off in [0xc0,0xe0,0x100]]})
    integrations=[]
    for ages,delta in [([0,25,50,99],0),([0,25,50,99],.01),([0,25,50,99],.02),([0,25,50,99],.1),([100,100,100,100],0)]:
        e.write(MEM,'65536x');p=soa()
        e.write(MEM+0x50,'Q',MEM+0x1000);e.write(MEM+0x3000,'3Q',MEM,MEM+0x200,MEM+0x2000)
        e.write(MEM+0x9000,'4f',delta,delta,delta,delta);e.write(MEM+0x9100,'Q',4)
        values={0:[1,2,3,4],0x20:[2,3,4,5],0x40:[3,4,5,6],0x60:[.1,.2,.3,.4],0x80:[.2,.3,.4,.5],0xa0:[.3,.4,.5,.6],
                0xc0:[1,2,3,4],0xe0:[2,3,4,5],0x100:[3,4,5,6],0x220:[1,2,3,4],0x280:[.5,1,2,3],0x3c0:ages,0x3e0:[1,.5,.25,.1]}
        for off,v in values.items():e.write(MEM+0x5000+off,'4f',*v)
        e.call(0x1947d0,[MEM+0x3000,p,0,MEM+0x9100],stack=[('Q',MEM+0x9000),('Q',0)])
        integrations.append({'delta':f32(delta),'before':{hex(off):list(map(f32,v)) for off,v in values.items()},
                             'after':{hex(off):e.read(MEM+0x5000+off,'4f') for off in [0,0x20,0x40,0x220,0x3c0]},'count':e.read(MEM+0x9100,'Q')[0]})
    gravities=[]
    # Explicit controlled read port. Only GetGravity is supplied; Initial.Update
    # itself, including source transform/float32/reset instructions, executes.
    for gravity in [[0,-9.81,0],[.13,-.22,.07],[0,0,0]]:
      for transform in [[1,0,0,0,1,0,0,0,1],[1,.2,.3,.4,.5,.6,.7,.8,.9]]:
        e.write(MEM,'65536x');p=soa();mod=MEM;read=MEM+0x1000;state=MEM+0x2000
        e.write(read+0x28,'f',1);e.write(mod+0x154,'H',0);e.write(mod+0x15c,'f',-.14)
        for i in range(3):e.write(state+0xcc+i*16,'4f',*transform[i*3:i*3+3],0)
        deltas=[.01,.02,.03,0];e.write(MEM+0x9000,'4f',*deltas)
        before={0x60:[1,2,3,4],0x80:[2,3,4,5],0xa0:[3,4,5,6],0xc0:[3,4,5,6],0xe0:[1,2,3,4],0x100:[2,3,4,5],0x280:[1,2,3,4]}
        for off,v in before.items():e.write(MEM+0x5000+off,'4f',*v)
        def getgravity(uc,address,size,user):
            dst=uc.reg_read(UC_X86_REG_RDX);e.write(dst,'4f',*gravity,0);uc.reg_write(UC_X86_REG_RAX,dst)
            sp=uc.reg_read(UC_X86_REG_RSP);uc.reg_write(UC_X86_REG_RIP,e.read(sp,'Q')[0]);uc.reg_write(UC_X86_REG_RSP,sp+8)
        hook=e.uc.hook_add(UC_HOOK_CODE,getgravity,begin=e.base+0x208550,end=e.base+0x208550)
        try:e.call(0x20d920,[mod,read,state,p],stack=[('Q',0),('Q',4),('Q',MEM+0x9000),('Q',1)])
        finally:e.uc.hook_del(hook)
        gravities.append({'gravity':list(map(f32,gravity)),'worldToLocal':list(map(f32,transform)),'multiplier':f32(-.14),'deltas':list(map(f32,deltas)),
                          'before':{hex(off):v for off,v in before.items()},'after':{hex(off):e.read(MEM+0x5000+off,'4f') for off in before}})
    return {'kind':'unity-particle-motion-instruction-probes-v1','nativeSha256':NATIVE_SHA,'semanticsVerified':False,
            'kernel':kernel,'perlin':perlin,'noise':noise,'rotation':rotations,'curves':curves,'curveBindings':curve_bindings,'velocity':velocities,'integration':integrations,'gravity':gravities,
            'limitations':['Controlled native leaf instructions only; no Unity scene or original game is executed.',
                            'Initial.Update uses an explicit controlled GetGravity read port; the Physics scene is not instantiated.',
                            'SimulateParticles vectors retain live particles; source deletion/compaction is a separate lifecycle responsibility.',
                            'Host frame scheduling, particle lifecycle and geometry are separate providers.']}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dll',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args(); result=probe(Engine(a.dll));a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:len(result[k]) for k in ['perlin','noise','rotation','curves','curveBindings','velocity','integration','gravity']}))
if __name__=='__main__':main()
