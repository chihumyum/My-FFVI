"""Recheck finite cached evidence. Never exports/disassembles/executes native code."""
import argparse,hashlib,json,pathlib,struct
parser=argparse.ArgumentParser();parser.add_argument('--evidence-root',required=True);parser.add_argument('--output',required=True);a=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];home=pathlib.Path(a.evidence_root).resolve();out=pathlib.Path(a.output).resolve();assert out.is_relative_to(root/'build/reports')
sha=lambda b:hashlib.sha256(b).hexdigest()
proposal=json.loads((home/'shadow-direct-provider-proposal.json').read_text());buffers={}
for key,pin in {**proposal['pins'],**proposal['extraPins']}.items():
 buffers[key]=pathlib.Path(pin['path']).read_bytes();assert sha(buffers[key])==pin['sha256']
rows=json.loads(buffers['symbols'])['ScriptMethod'];addresses=sorted(set(r['Address']for r in rows));dll=buffers['dll'];pe=struct.unpack_from('<I',dll,0x3c)[0];count=struct.unpack_from('<H',dll,pe+6)[0];olen=struct.unpack_from('<H',dll,pe+20)[0]
def read(rva,size):
 for j in range(count):
  pos=pe+24+olen+j*40;vs,rv,rs,offset=struct.unpack_from('<IIII',dll,pos+8)
  if rv<=rva and rva+size<=rv+rs:return dll[offset+rva-rv:offset+rva-rv+size]
 raise ValueError('PE span out of bounds')
verified=[]
for folder,expected,count_bytes in [('native-timers',8,3440),('native-shadow-direct',2,480)]:
 b=(home/folder/'complete.json').read_bytes();receipt=json.loads(b);assert receipt['status']=='complete' and len(receipt['methods'])==expected
 assert receipt['nativeSha256']==sha(buffers['dll']) and receipt['symbolsSha256']==sha(buffers['symbols']) and receipt['headerSha256']==sha(buffers['header'])
 total=0
 for method in receipt['methods']:
  start=int(method['rva'],16);end=int(method['nextSymbolRva'],16);assert next(v for v in addresses if v>start)==end
  aliases=[r for r in rows if r['Address']==start];assert len(aliases)==1
  raw=read(start,end-start);assert sha(raw)==method['nativeRangeSha256'];c=(home/folder/(method['rva'][2:]+'.c')).read_bytes();assert sha(c)==method['decompiledSha256']
  verified.append({'rva':hex(start),'next':hex(end),'bytes':len(raw),'symbol':aliases[0]['Name'],'peSha256':sha(raw),'cSha256':sha(c)});total+=len(raw)
 assert total==count_bytes
prefix=read(0x2a1e70,4096);assert sha(prefix)=='4d898457e7b0875ac6ccdc4675b0b64f0156979bdcbcfe2efcfc0736d9ea5474'
assert (home/'shadow-static-prefix.bin').read_bytes()==prefix
assembly=(home/'shadow-static-prefix.asm').read_bytes();assert sha(assembly)=='5412ba201d56dfeddfc2225ccf21d6199d901a1daab7be8b032b0ecc6e32347d'
for marker in ['1802a252a:','1802a2532:','1802a253f:','0x181fcab48','1802a254f:','1802a2565:','1802a256c:']:assert marker in assembly.decode()
selector='A5764BFD0108F32AECEDD11C5E3FEE997A5868AA';field=[r for r in json.loads(buffers['symbols'])['ScriptMetadata']if r['Address']==0x1fcab48];assert len(field)==1 and field[0]['Name']=='Field$<PrivateImplementationDetails>.'+selector
assert '__StaticArrayInitTypeSize=56 '+selector+' /*Metadata offset 0x4DF33E*/' in buffers['dump'].decode()
raw=buffers['metadata'][0x4df33e:0x4df376];assert len(raw)==56 and hashlib.sha1(raw).hexdigest().upper()==selector
assert sha(raw)=='4d5c8ebd2903e8d29fc3a85bdf36f0e0e6d7b84c9351494308c077b29d77ac7d'
values=struct.unpack('<14i',raw);cells=[list(values[i:i+2])for i in range(0,14,2)];assert cells==[[112,23],[112,24],[113,24],[113,25],[114,24],[114,25],[115,25]]
# Cached wrappers/manager calls supply these semantics; their callees are not recursively claimed.
for filename,markers in {'native-timers/26e220.c':['get_RemainingSeconds'], 'native-timers/29cf80.c':['get_RemainingSeconds'],
 'native-timers/26f5f0.c':['0xe2'], 'native-timers/297970.c':['AddGimmickTimer','fVar6 - 5.0'],
 'native-timers/5f9660.c':['0xc0','RunScript'], 'native-shadow-direct/865820.c':['ContainsKey','get_Item'],
 'native-shadow-direct/865b60.c':['reservedRemoveGimmickTimerKeyList']}.items():
 text=(home/filename).read_text()
 for marker in markers:assert marker in text,(filename,marker)
report={'kind':'source-scenario-timers-native-static-v1','result':'passed-static-not-dynamic-parity','pins':{k:sha(v)for k,v in buffers.items()},'methods':verified,'methodCount':10,'peMethodBytes':3920,'cctorPrefixBytes':4096,'metadataConstantBytes':56,'shadowOkLine':{'field':selector,'offset':'0x4df33e','dimensions':[7,2],'cells':cells,'sha256':sha(raw)},'nativeExecuted':False,'newNativeExports':0,'recursiveClaims':False,'limitations':['Explicit Web logical milliseconds and safe-root publication are not native float/Unity抢占 parity.','Unknown negative Cid Timer construction remains an exact reached gate.']}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'methodCount':10,'peMethodBytes':3920,'cctorPrefixBytes':4096,'metadataConstantBytes':56,'sha256':sha(out.read_bytes())}))
