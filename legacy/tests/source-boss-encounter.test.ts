import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSourceBossEncounterInstruction,compileSourceBattleResultInstruction } from '../src/compiler/source-boss-encounter.js';
import { parseSourceBossEncounterCommand } from '../src/core/source-boss-encounter.js';
import { decodeFieldOp } from '../src/compiler/field.js';
const raw=()=>({type:1,mnemonic:'EncountBoss',operands:{iValues:[506,19,36,0,0,0,0,0],rValues:Array(8).fill(0),sValues:['after','','','','','','','']}});
test('Boss uses one party and preserves the effect focus; it never becomes four lottery slots or a player destination',()=>{
  const original=raw(),before=structuredClone(original),op=compileSourceBossEncounterInstruction(original);
  assert.deepEqual(op,{kind:'source-boss-encounter',command:{kind:'source-boss-encounter',partyId:506,focusCell:{x:19,y:36},continuation:'after'}});
  assert.deepEqual(original,before);assert.equal(decodeFieldOp(original,{script:'x',index:11,source:{file:'controlled',assetPath:'controlled-script'}},{ }).kind,'source-boss-encounter');
  original.operands.iValues[1]=-0x80000000;assert.equal(compileSourceBossEncounterInstruction(original).command.focusCell.x,-0x80000000);
});
test('Boss exact namespace, reserved banks, lengths and positive party identities remain gated',()=>{
  for(const mutate of [(x:ReturnType<typeof raw>)=>{x.type=2;},(x:ReturnType<typeof raw>)=>{x.operands.iValues[3]=1;},(x:ReturnType<typeof raw>)=>{x.operands.rValues[0]=1;},(x:ReturnType<typeof raw>)=>{x.operands.sValues[1]='extra';},(x:ReturnType<typeof raw>)=>{x.operands.iValues.pop();},(x:ReturnType<typeof raw>)=>{x.operands.iValues[0]=0;}]){const x=raw();mutate(x);assert.throws(()=>compileSourceBossEncounterInstruction(x));assert.equal(decodeFieldOp(x,{script:'x',index:11,source:{file:'controlled',assetPath:'controlled-script'}},{}).kind,'blocked');}
});
test('Boss data cannot invoke getters or carry hidden fields',()=>{
  const op=compileSourceBossEncounterInstruction(raw()).command;let calls=0;
  const bad={...op};Object.defineProperty(bad,'partyId',{enumerable:true,get(){calls++;return 1;}});
  assert.throws(()=>parseSourceBossEncounterCommand(bad));assert.equal(calls,0);
  assert.throws(()=>parseSourceBossEncounterCommand({...op,[Symbol('grant')]:true}));
});
test('battle-result query remains exact type1 with all reserved operands checked',()=>{
  const x=raw();x.mnemonic='SysCall';x.operands.iValues.fill(0);x.operands.sValues[0]='戦闘結果取得';
  assert.deepEqual(compileSourceBattleResultInstruction(x),{kind:'source-battle-result'});
  x.operands.iValues[0]=1;assert.throws(()=>compileSourceBattleResultInstruction(x));x.operands.iValues[0]=0;x.type=2;assert.throws(()=>compileSourceBattleResultInstruction(x));
});
