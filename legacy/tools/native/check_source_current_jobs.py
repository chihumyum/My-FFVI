"""Recheck the bounded FF6 current-job owner and inherited provider slots. No execution."""
from pathlib import Path
import argparse, hashlib, json, re
from inspect_pe import PEImage

def sha(b): return hashlib.sha256(b).hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args();r=a.input_root.resolve()
    dll=(r/'build/runtime/game/GameAssembly.dll').read_bytes();sb=(r/'build/native/il2cpp/script.json').read_bytes();hb=(r/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes();db=(r/'build/native/il2cpp/dump.cs').read_bytes();symbols=json.loads(sb);dump=db.decode();header=hb.decode();pe=PEImage(dll)
    assert sha(dll)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
    assert sha(sb)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'
    assert sha(hb)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
    by={}
    for m in symbols['ScriptMethod']:by.setdefault(m['Address'],[]).append(m)
    methods=[]
    for address,folder in [(0x337c10,'v18-owned-character-finalizers'),(0x86b650,'v17-roster-lifecycle'),(0x86c0d0,'v17-roster-lifecycle'),(0x330050,'v17-roster-initialization-small')]:
        root=r/'build/native'/folder;receipt=json.loads((root/'complete.json').read_bytes());assert receipt['status']=='complete';assert receipt['nativeSha256']==sha(dll) and receipt['symbolsSha256']==sha(sb) and receipt['headerSha256']==sha(hb)
        matches=[m for m in receipt['methods']if int(m['rva'],0)==address];assert len(matches)==1 and len(by[address])==1;row=matches[0];end=min(n for n in by if n>address);assert int(row['nextSymbolRva'],0)==end
        raw=pe.read(address,end-address)[2];c=(root/f'{address:x}.c').read_bytes();assert sha(raw)==row['nativeRangeSha256'] and sha(c)==row['decompiledSha256']
        methods.append({'rva':hex(address),'nextSymbolRva':hex(end),'bytes':len(raw),'allAliases':by[address],'fullPESha256':sha(raw),'cFile':str(root/f'{address:x}.c'),'fullCSha256':sha(c),'receiptSha256':sha((root/'complete.json').read_bytes())})
    expected={0x6caad0:'488b49104885c97411488b014c8b88d801000048ffa0d0010000c3cccccccccc',0x6c8540:'488b49104885c97411488b014c8b80a801000048ffa0a0010000c3cccccccccc',0x5cca50:'488b89c00000004885c9740c4883c110488911e9f807bdffc3cccccccccccccc',0x5ccbb0:'488b89280100004885c9740c4883c110488911e99806bdffc3cccccccccccccc',0x2c8ef0:'c20000cccccccccccccccccccccccccc'};raws=[]
    for address,hexbytes in expected.items():
        end=min(n for n in by if n>address);raw=pe.read(address,end-address)[2];assert raw.hex()==hexbytes
        raws.append({'rva':hex(address),'nextSymbolRva':hex(end),'bytes':len(raw),'fullPE':raw.hex(),'sha256':sha(raw),'allAliases':by[address],'aliasChosenForC':False})
    assert len(by[0x6c8540])==2 and len(by[0x2c8ef0])==3487
    job=dump[dump.index('public class JobInfomationData : JobInfomationData'):];job=job[:job.index('// Namespace:',100)];assert 'ChangeParameter' not in job
    assert not re.search(r'class\s+\S+\s*:\s*NameReplaceData\b',dump)
    assert 'private NameReplaceData serialData; // 0x10' in dump
    for value in ['VirtualInvokeData _10_ChangeParameter;','VirtualInvokeData _7_UpdateMemberNameTag;','struct Serial_FF6_Management_JobInfomationData_VTable']:assert value in header
    assert re.search(r'RVA: 0x2C8EF0[^\n]*\n\s*public virtual void ChangeParameter',dump)
    assert re.search(r'RVA: 0x2C8EF0[^\n]*\n\s*public virtual void UpdateMemberNameTag',dump)
    result={'kind':'source-current-job-owner-static-native-v1','result':'passed','nativeSha256':sha(dll),'symbolsSha256':sha(sb),'headerSha256':sha(hb),'dumpSha256':sha(db),'completeCachedMethods':methods,'completeCachedBytes':sum(m['bytes']for m in methods),'boundedTypedProvidersAndInheritedBody':raws,'facts':['AddReleaseJob validates actual master and visits all held even if already global.','RemoveReleaseJob removes global only. Personal jobs remain.','SwitchJob validates master, unreleased return, actual ownedId selection, JobId assignment, ChangeParameter then NameReplace.','FF6 inherits empty JobInformation slot10; complete metadata has no concrete NameReplace override of empty slot7. Null-provider return and typed nonnull virtual dispatch are distinct proven branches.'],'nativeExecuted':False,'newExports':0,'sourceBodiesExecuted':0}
    a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':'passed','cachedMethods':len(methods),'cachedBytes':result['completeCachedBytes'],'boundedPEBodies':len(raws)}))
if __name__=='__main__':main()
