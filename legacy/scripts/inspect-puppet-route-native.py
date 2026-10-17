"""Revalidate existing complete Puppet.Route/MoveTo evidence and exact PE leaf bytes.
No original DLL execution, new Ghidra export, or native Search/raycast claim.
"""
import argparse,bisect,hashlib,json,sys
from pathlib import Path
import capstone
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
p.add_argument('--report',type=Path,default=Path('build/reports/source-puppet-route-native.json'))
a=p.parse_args();root=a.root.resolve();sys.path.insert(0,str(root))
from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest()
paths={'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h'}
expected={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
buffers={k:(root/v).read_bytes()for k,v in paths.items()};assert {k:sha(v)for k,v in buffers.items()}==expected
pe=PEImage(buffers['nativeSha256']);methods=json.loads(buffers['symbolsSha256'])['ScriptMethod'];addresses=sorted({m['Address']for m in methods});md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);files=[]
def body(rva):
 end=addresses[bisect.bisect(addresses,rva)];raw=pe.read(rva,end-rva)[2]
 return {'rva':hex(rva),'nextSymbolRva':hex(end),'sha256':sha(raw),'bytes':len(raw),'aliases':[m for m in methods if m['Address']==rva],
  'disassembly':[{'rva':hex(i.address),'hex':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}for i in md.disasm(raw,rva)]}
def cached(folder,rva):
 path=root/'build/native'/folder;receipt_bytes=(path/'complete.json').read_bytes();receipt=json.loads(receipt_bytes)
 assert receipt['status']=='complete' and all(receipt[k]==v for k,v in expected.items())
 rows=[m for m in receipt['methods']if int(m['rva'],16)==rva];assert len(rows)==1;row=rows[0];actual=body(rva);c=(path/f'{rva:x}.c').read_bytes()
 assert actual['sha256']==row['nativeRangeSha256'] and actual['nextSymbolRva']==row['nextSymbolRva'] and sha(c)==row['decompiledSha256']
 for file,data in [(path/'complete.json',receipt_bytes),(path/f'{rva:x}.c',c)]:files.append({'path':str(file.relative_to(root)),'sha256':sha(data),'bytes':len(data)})
 return {**actual,'cached':row,'receipt':str((path/'complete.json').relative_to(root))},c.decode()
route,c=cached('v76-npc-route',0x2c6130);ctor,cc=cached('v41-script-motion',0x2c81f0);move,mc=cached('v41-script-motion',0xe0e5e0);layer=body(0x2c0040);speed=body(0x2c0a30)
assert any(m['Name']=='Last.Interpreter.Instructions.Puppet$$Route'for m in route['aliases'])
assert any(m['Name']=='Last.Interpreter.Instructions.Puppet$$GetChangeLayerValue'for m in layer['aliases'])
calls=[i['operands']for i in route['disassembly']if i['mnemonic']=='call']
for rva in [0xe105a0,0x2c0040,0x444d10,0x2c0a30,0xe0e5e0]:assert hex(rva)in calls
for text in ['m_Items[2]','m_Items[3]','m_Items[0]','MapRouteSearcher__Search','aUStack_58,true','FieldEntity__MoveTo','get_IsMoving']:
 assert text.replace(' ','')in c.replace(' ','').replace('\n','')
assert '_MapConstants_ChangeLayer___TypeInfo,3' in cc.replace(' ','').replace('\n','')
for text in ['*(undefined4 *)(lVar3 + 0x24) = 1','*(undefined4 *)(lVar3 + 0x28) = 2']:assert text in cc
for tool in [Path(__file__).resolve(), root/'tools/native/inspect_pe.py']:
 data=tool.read_bytes();files.append({'path':str(tool),'sha256':sha(data),'bytes':len(data)})
for k,v in paths.items():assert sha((root/v).read_bytes())==expected[k]
for row in files:assert sha((root/row['path']).read_bytes())==row['sha256']
report={'kind':'source-puppet-route-static-native-audit-v1','result':'passed-static-binding-only','inputs':{k:{'path':paths[k],'sha256':v}for k,v in expected.items()},'files':files,'methods':[route,ctor,move],'leaves':[layer,speed],
 'observedProtocol':['Puppet type2 Route; i0/i1 are target map-range cells; i2 source layer request; i3 nullable speed; s0 exact animation','First clock rejects already-moving entity; equal full grid cell advances before search or starting animation','MapRouteSearcher.Search(start,target,true); missing/empty result warns; same FieldEntity.MoveTo(List) starts movement','Following clocks wait for same entity IsMoving=false; no NPC controller or AssignMoveRoute takeover','GetChangeLayerValue uses source cctor layer table [0,1,2], preserve request0; Web requires canonical same-layer Z'],
 'webDeparture':'Explicit web-source-puppet-route-grid-v1 uses bounded nonwrapping cardinal BFS and existing map/entity collision switches; Existing Actor.motion or Task.cameraPath/dummy owns progression, known later obstruction waits, unknown stops; no second transform owner. Native Search/raycast and original-game timing parity remain unassessed.',
 'unknown':['Actual-player movement-state magnification and its MoveTo override','Cross-layer/birdview/noncanonical Z and cyclic search','Source startup/caller actor/animation/transport dependencies remain independently assessed'], 'freshExports':0,'nativeDynamicVerified':False,'nativeParity':False,'originalGameExecuted':False}
out=root/a.report;assert out.resolve().is_relative_to(root/'build'),'Private report only';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'methods':len(report['methods']),'leaves':len(report['leaves']),'report':str(out)}))
