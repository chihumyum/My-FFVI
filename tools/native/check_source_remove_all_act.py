"""Audit bounded RemoveAllAct evidence against original PE and exact metadata.

The existing Web action stages are the explicit execution policy. This audit
never executes the native game and does not certify native frame ordering.
"""
from pathlib import Path
import argparse, hashlib, json, re
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from inspect_pe import PEImage

def sha(data): return hashlib.sha256(data).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root',type=Path,required=True)
    parser.add_argument('--research-root',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args();root=args.input_root.resolve();work=args.research_root.resolve()
    native=(root/'build/runtime/game/GameAssembly.dll').read_bytes();pe=PEImage(native)
    symbols_bytes=(root/'build/native/il2cpp/script.json').read_bytes();symbols=json.loads(symbols_bytes)
    header=(root/'build/native/il2cpp/il2cpp_ghidra.h').read_bytes()
    assert sha(native)=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'
    assert sha(symbols_bytes)=='5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3'
    assert sha(header)=='71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'
    batches=[
      (root/'build/wip/source-battle-ui-control-family/native-syscalls',[0x28d4f0]),
      (root/'build/wip/source-battle-ui-control-family/native-owners',[0x15a8860,0x15a8590,0x15b00d0,0x15b0160,0x15aff90,0x15b0020]),
      (work/'native-executor',[0x15a8b40,0x15a9f60,0x15ad7b0,0x15a81a0]),
      (root/'build/native/ai-queue',[0x15aa520,0x15aa590,0x15adee0]),
      (root/'build/native/ai-dispatch',[0x15a8f40,0x15aa1c0,0x15ace70,0x6773f0])]
    receipts=[];methods=[];bodies={}
    for folder,requested in batches:
        data=(folder/'complete.json').read_bytes();receipt=json.loads(data)
        assert receipt['status']=='complete' and receipt['semanticsVerified'] is False
        assert receipt['nativeSha256']==sha(native) and receipt['symbolsSha256']==sha(symbols_bytes) and receipt['headerSha256']==sha(header)
        receipts.append({'file':str(folder/'complete.json'),'sha256':sha(data)})
        for address in requested:
            rows=[r for r in receipt['methods'] if int(r['rva'],16)==address];assert len(rows)==1;row=rows[0]
            aliases=[r for r in symbols['ScriptMethod'] if r['Address']==address];assert len(aliases)==1
            blob=pe.read(address,int(row['nextSymbolRva'],16)-address)[2];c=(folder/(format(address,'x')+'.c')).read_bytes()
            assert sha(blob)==row['nativeRangeSha256'] and sha(c)==row['decompiledSha256']
            bodies[address]=c.decode();methods.append({'rva':hex(address),'name':aliases[0]['Name'],'nativeBytes':len(blob),'nativeRangeSha256':sha(blob),'cFile':str(folder/(format(address,'x')+'.c')),'cSha256':sha(c),'sharedCallsNotAssignedSemantics':row['sharedCalls']})
    wrapper=bodies[0x28d4f0];assert wrapper.index('__ClearPlyerAct')<wrapper.index('__ClearEnemyAct')<wrapper.index('return 0')
    player=bodies[0x15a8860];enemy=bodies[0x15a8590]
    assert player.index('*ppLVar1 = (Last_Battle_BattleActData_o *)0x0')<player.index('___RemoveAll_')<player.index('fixedPlayerBattleActDataStack')<player.index('(pSVar2,0)')
    assert 'battleActDataStackInterrupt' in player and player.count('___RemoveAll_')==2
    # Enemy's second RemoveAll is tail-call expanded in this complete C body.
    assert 'battleActDataStackInterrupt' in enemy and enemy.count('___RemoveAll_')==1
    assert 'pLVar2->m_Items[(int)index]' in enemy and 'pSVar3->fields)._size' in enemy
    for address in [0x15b00d0,0x15b0160]:assert '_AttackUnitData_k__BackingField' in bodies[address] and '_BattlePlayerData_TypeInfo' in bodies[address]
    for address in [0x15aff90,0x15b0020]:assert '_AttackUnitData_k__BackingField' in bodies[address] and '_Last_Battle_BattleEnemyData_TypeInfo' in bodies[address]
    # The state-registration site identifies callbacks through exact Method$
    # metadata, independent of the first FieldMap generic shared alias.
    refs={r['Address']:r for r in symbols['ScriptMetadataMethod']}
    states=[(0,0x1fddb70,0x15aa520,0x1fdd9d0,0x15adee0,None,None),
      (1,0x1fddb30,0x15aa590,0x1fdd9a8,0x15adfc0,None,None),
      (2,0x1fddc78,0x15a9f60,0x1fddae0,0x15ad7b0,None,None),
      (3,0x1fddc30,0x15aa0d0,0x1fddad0,0x15ad8e0,None,None),
      (4,0x1fddc20,0x15aa160,0x1fdda78,0x15ad9d0,None,None),
      (6,0x1fddbd0,0x15aa190,0x1fdda40,0x15adad0,None,None),
      (5,0x1fddbb0,0x15aa1c0,0x1fdda20,0x15add00,0x1fddca0,0x15a8f40)]
    state_rows=[];creation=bodies[0x15a8b40]
    for state,enter,enter_address,update,update_address,exit_ref,exit_address in states:
        callbacks={}
        for role,reference,address in [('enter',enter,enter_address),('update',update,update_address),('exit',exit_ref,exit_address)]:
            if reference is None:callbacks[role]=None;continue
            row=refs[reference];assert row['MethodAddress']==address
            assert ('_DAT_18'+format(reference,'x')) in creation
            callbacks[role]={'metadataReference':hex(reference),'methodAddress':hex(address),'name':row['Name']}
        null_exit='__this_01' if exit_ref else '0'
        assert re.search(r'\(pLVar11,'+str(state)+r',pMVar12,pMVar13,'+null_exit+r',_DAT_181fc6b48\)',creation)
        state_rows.append({'state':state,'callbacks':callbacks})
    assert player.index('(pSVar2,0)')<player.index('+ 0x48)')<player.index('(pLVar5->fields).current = pLVar8')<player.index('+ 0xa0)')
    assert bodies[0x15aa520].index('nowState == 0')<bodies[0x15aa520].index('battleActDataStackInterrupt')<bodies[0x15aa520].index('isStopStartAct == false')
    for address in [0x15a81a0,0x15ace70]:assert '__get_characterStatusId' in bodies[address] and 'fixedPlayerBattleActDataStack' in bodies[address]
    assert bodies[0x15a9f60].index('__ViewMessage')<bodies[0x15a9f60].index('__CheckAndSetLearningAbility')<bodies[0x15a9f60].index('__AddLog')<bodies[0x15a9f60].index('._7_unknown.methodPtr')
    assert '__CheckExecutedCountAct.methodPtr' in bodies[0x15a8f40] or '._27_CheckExecutedCountAct.methodPtr' in bodies[0x15a8f40]
    assert bodies[0x15a8f40].index('inStagingBattleActData')<bodies[0x15a8f40].index('pLVar5 == (Last_Battle_BattleActData_o *)0x0')
    decoder=Cs(CS_ARCH_X86,CS_MODE_64)
    def assembly(address,size):return [{'rva':hex(i.address-pe.image_base),'hex':i.bytes.hex(),'instruction':i.mnemonic+' '+i.op_str}for i in decoder.disasm(pe.read(address,size)[2],pe.image_base+address)]
    raw_shared=[]
    # Shared generic bodies are included as raw bytes plus every symbol alias;
    # none is granted semantics by selecting one decompiler display name.
    for address,size in [(0xf9bf00,96),(0x10dff80,64),(0x10e0020,64),(0x13700e0,64),(0x15a8490,32),(0x15adcb0,32)]:
        blob=pe.read(address,size)[2];raw_shared.append({'rva':hex(address),'size':size,'rawHex':blob.hex(),'sha256':sha(blob),'allAliases':[r for r in symbols['ScriptMethod'] if r['Address']==address],'assembly':assembly(address,size),'acceptedAliasDecompilation':False})
    report={'kind':'source-remove-all-act-native-static-v1','result':'passed','nativeSha256':sha(native),'symbolsSha256':sha(symbols_bytes),'headerSha256':sha(header),'receipts':receipts,'completeMethods':methods,'methodCount':len(methods),'stateCallbacks':state_rows,'sharedRawCode':raw_shared,
      'contract':{'sourceOrder':['clear staging unconditionally','filter player normal/interrupt queues','clear source-character keyed fixed-player dictionary','old state exit then state0 entry','filter enemy normal/interrupt queues'],
        'webDifference':'Existing Web controls V1 and 400/900ms action stages cancel both side filters atomically before idle; native intermediate InitNone dispatch/Finishing callbacks are not certified Web equivalence.',
        'commitFence':'Prior committed fees, damage, conditions, items and RNG are preserved; uncommitted actions release reservations; cancellation is not ordinary ATB completion.',
        'actionLogCaution':'Native AddLog is at InitActionState before act-function Start. No new Shadow participation-log admission follows from this family.'},
      'nativeExecuted':False,'semanticsVerified':False,'nativeDynamicParity':False}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':'passed','methods':len(methods),'stateRegistrations':len(states)}))
if __name__=='__main__':main()
