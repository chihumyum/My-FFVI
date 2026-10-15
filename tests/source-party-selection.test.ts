import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSourcePartySelection,previewSourcePartySelection } from '../src/core/source-party-selection.js';
import { compileSourcePartySelectionInstruction,sourcePartySelectionSelectors } from '../src/compiler/source-party-selection.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { emptyPartyState } from '../src/core/party.js';
const read=()=>({party:emptyPartyState(),roster:[{id:'seven',sourceId:7,enabled:true},{id:'two',sourceId:2,enabled:true},{id:'other',sourceId:4,enabled:true},{id:'disabled',sourceId:8,enabled:false}]});
const raw=(selector:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}});
test('all five selectors retain namespace/reserved/terminal gates at the actual decoder',()=>{
  const site={script:'full',index:19,source:{file:'synthetic',assetPath:'synthetic',pointer:'/19'}};
  for(const [index,selector] of sourcePartySelectionSelectors.entries()) {
    const op=decodeFieldOp(raw(selector),site,{});
    assert.equal(op.kind,index===4?'blocked':'source-party-selection');
    for(const type of [0,2,3])assert.equal(decodeFieldOp({...raw(selector),type},site,{}).kind,'blocked');
    const invalid=raw(selector);invalid.operands.rValues[7]=.1;
    assert.throws(()=>compileSourcePartySelectionInstruction(invalid),/reserved/);
  }
});
test('enabled source IDs sort the candidate list, provider uses owned order and opera is exact',()=>{
  const current=read(),before=structuredClone(current);
  const regular=projectSourcePartySelection({kind:'source-party-selection',mode:'one'},current,i=>i===155?1:0);
  assert.deepEqual(regular.members.map(m=>m.id),['two','other','seven']);
  assert.deepEqual(regular.forced,['seven','two']);
  assert.deepEqual(regular.initial.slots[0].map(c=>c.id),['seven','two',null,null]);
  const opera=projectSourcePartySelection({kind:'source-party-selection',mode:'opera'},current,()=>{throw Error('unused');});
  assert.deepEqual(opera.forced,['seven','two']);assert.deepEqual(current,before);
  assert.throws(()=>projectSourcePartySelection({kind:'source-party-selection',mode:'opera'},{...current,roster:current.roster.slice(1)},()=>0),/opera member/);
  assert.throws(()=>projectSourcePartySelection({kind:'source-party-selection',mode:'one'},current,()=>NaN),/Unknown/);
});
test('confirm validates every saved group, duplicates, enabled identities, fixed members and exact model provenance',()=>{
  const current=read(),model=projectSourcePartySelection({kind:'source-party-selection',mode:'two'},current,()=>0);
  const slots=emptyPartyState().slots;slots[0][0].id='two';slots[1][2].id='seven';
  assert.deepEqual(previewSourcePartySelection(model,current,{kind:'confirm',slots}),{selectedSlot:0,slots});
  for(const mutate of [(s:typeof slots)=>{s[1][2].id='two';},(s:typeof slots)=>{s[1][2].id=null;},
    (s:typeof slots)=>{s[2][0].id='other';},(s:typeof slots)=>{s[0][0].row='back';},(s:typeof slots)=>{s[1][2].id='disabled';}]) {
    const next=structuredClone(slots);mutate(next);assert.throws(()=>previewSourcePartySelection(model,current,{kind:'confirm',slots:next}));
  }
  assert.throws(()=>previewSourcePartySelection(structuredClone(model),current,{kind:'cancel'}),/untrusted/);
  model.slotCount=1;assert.throws(()=>previewSourcePartySelection(model,current,{kind:'cancel'}),/Modified/);
});
