"""Validate bounded cached native evidence, never export or modify Ghidra.
Recreate the 28-method packet with tools/native/ExportMethods.java using the
RVA list below, then pass its ignored directory via --evidence-dir. Shared
PreExecuteSetup is raw-only; OnDestroy C omits a reachable restore branch.
"""
import argparse,hashlib,json,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--evidence-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.root.resolve();sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
sha=lambda b:hashlib.sha256(b).hexdigest()
identities={k:{'path':v,'sha256':sha((root/v).read_bytes())}for k,v in {'nativeSha256':'build/runtime/game/GameAssembly.dll','symbolsSha256':'build/native/il2cpp/script.json','headerSha256':'build/native/il2cpp/il2cpp_ghidra.h','metadataSha256':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat'}.items()}
pe=PEImage((root/identities['nativeSha256']['path']).read_bytes());methods=[]
expected={0x2eeb70,0x579470,0x57fc70,0x57f8a0,0x57f970,0x9f5090,0x361470,0x361520,0x361a00,0x361b70,0x3609b0,0x3610b0,0x3607e0,0x361250,0x9f17b0,0x9f18b0,0x9f18c0,0x9f19c0,0x7a7bd0,0x7a7c10,0x7a9960,0x9f8110,0x9f8360,0x2f8610,0x2f8690,0x9f1b10,0x9f7f80,0x9e2890}
for directory,selection in [(a.evidence_dir,expected),(root/'build/native/v76-npc-route',None),(root/'build/native/v78-npc-controller',{0x57bcd0})]:
 receiptbytes=(directory/'complete.json').read_bytes();receipt=json.loads(receiptbytes);assert receipt['status']=='complete'
 for key in ['nativeSha256','symbolsSha256','headerSha256']:assert receipt[key]==identities[key]['sha256'],(directory,key)
 selected=[]
 for method in receipt['methods']:
  start=int(method['rva'],16)
  if selection is not None and start not in selection:continue
  selected.append(start);end=int(method['nextSymbolRva'],16);_,_,raw=pe.read(start,end-start);assert len(raw)==end-start and sha(raw)==method['nativeRangeSha256']
  c=directory/(method['rva'][2:].lower()+'.c');assert sha(c.read_bytes())==method['decompiledSha256']
  methods.append({'directory':str(directory),'receiptSha256':sha(receiptbytes),**method,'rawBytes':len(raw)})
 if selection is not None:assert set(selected)==selection,(directory,set(selected)^selection)
_,_,leaf=pe.read(0x50a290,16);assert leaf.hex()=='c7412800000000c3cccccccccccccccc'
_,_,destroy=pe.read(0x57f8a0,0xd0);assert destroy[0x63:0x6a].hex()=='448b9388000000';assert destroy[0xa8:0xaf].hex()=='448996e0000000';assert destroy[0xbe:0xc3].hex()=='e9edc9ffff'
report={'kind':'source-assigned-route-native-audit-v1','identities':identities,'methods':methods,'rawLeaves':[{'rva':'0x50a290','sha256':sha(leaf),'hex':leaf.hex(),'meaning':'elapsed float +0x28 := 0; shared raw leaf, no C export claimed'}],'onDestroyRawBranch':{'rva':'0x57f8a0','sha256':sha(destroy),'oldMoveTypeLoad':'0x57f903 +0x88','propertyStore':'0x57f948 +0xe0','tailCall':'0x57f95e -> 0x57c350','decompilerOmittedReachableBranch':True},'nativeExecuted':False,'strictSearchRaycastParity':False,'originalGamePlayability':False}
a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'methods':len(methods),'rawLeaf':1,'nativeExecuted':False}))
