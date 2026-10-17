"""Read-only bounded BattleAction binding audit. No native execution/export.
Original DLL, decompiled bodies and raw source remain ignored inputs. This proves
static operand/owner links; Web scheduler/target eligibility and RNG are policies.
"""
import argparse,bisect,hashlib,json,sys
from pathlib import Path
import capstone
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tools.native.inspect_pe import PEImage

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--evidence-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();root=a.root.resolve();e=a.evidence_dir.resolve();out=a.report.resolve();assert out.is_relative_to(root/'build')
 sha=lambda b:hashlib.sha256(b).hexdigest();paths={'nativeSha256':root/'build/runtime/game/GameAssembly.dll','symbolsSha256':root/'build/native/il2cpp/script.json','headerSha256':root/'build/native/il2cpp/il2cpp_ghidra.h'};buffers={k:p.read_bytes()for k,p in paths.items()};hashes={k:sha(v)for k,v in buffers.items()}
 assert hashes=={'nativeSha256':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbolsSha256':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','headerSha256':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
 methods=json.loads(buffers['symbolsSha256'])['ScriptMethod'];addresses=sorted({m['Address']for m in methods});pe=PEImage(buffers['nativeSha256']);md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
 scopes={'native':[0xb41780,0xb43300,0x1565150,0x1565310,0x1562bc0,0x1562a00,0x15623b0,0x1564a90],'native-targets':[0x15639e0,0x1563350,0xb43170],'native-cost':[0x15a7c50]};rows=[]
 for name,expected in scopes.items():
  folder=e/name;rb=(folder/'complete.json').read_bytes();receipt=json.loads(rb);assert receipt['status']=='complete'
  for k,v in hashes.items():assert receipt[k]==v
  assert sorted(int(m['rva'],16)for m in receipt['methods'])==sorted(expected)
  for rva in expected:
   found=[m for m in receipt['methods']if int(m['rva'],16)==rva];assert len(found)==1;row=found[0];end=addresses[bisect.bisect(addresses,rva)];raw=pe.read(rva,end-rva)[2];cb=(folder/f'{rva:x}.c').read_bytes();assert int(row['nextSymbolRva'],16)==end and row['nativeRangeSha256']==sha(raw)and row['decompiledSha256']==sha(cb)
   rows.append({'scope':name,'rva':hex(rva),'nextSymbolRva':hex(end),'rangeSha256':sha(raw),'cSha256':sha(cb),'receiptSha256':sha(rb),'symbolAliases':[m for m in methods if m['Address']==rva],'disassembly':[{'rva':hex(i.address),'hex':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}for i in md.disasm(raw,rva)]})
 by={r['rva']:r for r in rows};texts=lambda r:[i['mnemonic']+' '+i['operands']for i in by[hex(r)]['disassembly']]
 assert any('0x15623b0' in t for r in [0x1565150,0x1565310,0x1562bc0,0x1562a00]for t in texts(r))
 create=(e/'native/15623b0.c').read_text();assert '3,' in create and 'BattleActData' in create
 cost=(e/'native-cost/15a7c50.c').read_text();assert 'isExecuteMp = true' in cost
 report={'kind':'source-scripted-battle-actions-static-native-v1','result':'passed-static-binding-only',**hashes,'methods':rows,'counts':{'newMethods':len(rows),'sourceOperandSites':63,'sourceParameterForms':53},'observedProtocol':{'caster':'i0=1 player characterStatusId i1; i0=2 enemy unique slot i1','target':'player caster: i3=2 enemy else player; enemy caster: i3=1 player else enemy; i4<=0 whole current side, positive exact source id','ability':'i2 master id; ActType.Event=3, null command, direct captured unit targets','wait':'i5=0 yield then global IsNowAttackStaging poll on subsequent interpreter clock; i5=1 immediate continuation','mp':'BattleActData isExecuteMp=true; use existing ability cost/payment owner'},'webPolicy':{'kind':'web-source-scripted-battle-actions-v1','queue':'existing BattleGame reaction/interrupt queue; no duplicate action owner','clock':'existing fixed Web battle step, not certified Unity component ordering','targets':'captured current instance IDs; existing active/life and condition rules; uninspected native all-enemy predicate/PlayerIsNotTarget special branches not claimed','rng':'existing BattleGame generator, not Unity/native RNG'},'nativeDynamicVerified':False,'sourceCampaignComplete':False};out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':report['result'],'report':str(out),'sha256':sha(out.read_bytes())}))
if __name__=='__main__':main()
