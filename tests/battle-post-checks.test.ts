import test from 'node:test';
import assert from 'node:assert/strict';
import { planCursedShieldCheck,planShadowSecedeLot,SHADOW_SECEDE_FLAGS } from '../src/core/battle-post-checks.js';
import { EventState,UnknownEventValue } from '../src/core/event-state.js';
import { battleEventSharedSnapshot } from '../src/core/battle-event-shared.js';
import { BattleGame } from '../src/core/battle.js';
import { compileBattleEvent } from '../src/compiler/battle-event.js';
import { parseBattleEventProgram,type BattleEventOp,type BattleEventProgram } from '../src/core/battle-event.js';
import { emptyPartyState } from '../src/core/party.js';
import type { BattleGauEntry } from '../src/core/battle-gau.js';
import { battleEntryRuntimeFixture } from './fixtures/battle-entry-runtime.js';
import { fixture } from './fixtures/battle-content.js';
function shared(){return EventState.initialized();}
function variable(state:EventState,index:number,value:number){state.write({category:'ScenarioVariable',index},value);}
function gear(){
  const f=battleEntryRuntimeFixture(),q=f.inventory.qualification!,catalog=f.content.battleEntry!;
  for(const id of [213,214]){
    q.equipmentCatalog.definitions[id]={...structuredClone(q.equipmentCatalog.definitions[201]!),id};
    catalog.items.push({id,type:3,listType:1,throwFlag:0,battleFunctionGroupId:0});
  }
  return f;
}
function shadowEntry():BattleGauEntry{
  const party=emptyPartyState();party.slots[0][0].id='a';party.slots[0][1].id='b';
  return {kind:'source-battle-gau-entry-v1',catalogHash:'1'.repeat(64),
    roster:[{id:'a',sourceId:4,ownedId:19,enabled:false},{id:'b',sourceId:37,ownedId:31,enabled:true}],party,
    field:{mapId:12,transportationId:1,isSavePoint:null,beastFieldController:true,footAttributeType:0},fixedPreemptiveState:0};
}
function program(ops:BattleEventOp[]):BattleEventProgram{
  const label=ops.length;
  return {kind:'battle-event-v1',source:null,entry:0,end:ops.length+3,localNames:['AI','Other','Gau','Shadow'],initialLocals:[0,0,9,7],blockers:[],
    instructions:[...ops,{kind:'nop'} as const,{kind:'blank'} as const,{kind:'jump',target:label} as const].map(op=>({mnemonic:op.kind,op}))};
}
test('CursedShield sentinel reads no equipment or counter and a proven no-shield branch never reads the unknown counter',()=>{
  const absent=shared();variable(absent,2,-1001);const reads:number[]=[];
  assert.deepEqual(planCursedShieldCheck(ref=>{reads.push(ref.index);return absent.read(ref);},[],undefined,undefined),{counter:null});assert.deepEqual(reads,[2]);
  const f=gear(),state=new EventState(),read:number[]=[];variable(state,2,0);
  assert.deepEqual(planCursedShieldCheck(ref=>{read.push(ref.index);return state.read(ref);},f.content.players,f.inventory.qualification,f.content.battleEntry),{counter:null});
  assert.deepEqual(read,[2]);assert.throws(()=>planCursedShieldCheck(ref=>state.read(ref),f.content.players,undefined,f.content.battleEntry),/actual borrowed/);
});
test('CursedShield counts each actual player once, preserves int32 and gates the exact 256 equipment conversion atomically',()=>{
  const f=gear(),q=f.inventory.qualification!,state=shared(),before=structuredClone(q);
  q.members[0]!.equipment[0]=213;q.members[0]!.equipment[1]=213;
  variable(state,9,254);assert.deepEqual(planCursedShieldCheck(ref=>state.read(ref),f.content.players,q,f.content.battleEntry),{counter:255});
  q.members[1]!.equipment[1]=213;
  assert.throws(()=>planCursedShieldCheck(ref=>state.read(ref),f.content.players,q,f.content.battleEntry),/256 conversion/);assert.equal(state.read({category:'ScenarioVariable',index:9}),254);
  variable(state,9,256);assert.deepEqual(planCursedShieldCheck(ref=>state.read(ref),f.content.players,q,f.content.battleEntry),{counter:258});
  q.members[1]!.equipment=before.members[1]!.equipment;variable(state,9,0x7fffffff);
  assert.equal(planCursedShieldCheck(ref=>state.read(ref),f.content.players,q,f.content.battleEntry).counter,-0x80000000);
  delete q.equipmentCatalog.definitions[213];assert.throws(()=>planCursedShieldCheck(ref=>state.read(ref),f.content.players,q,f.content.battleEntry),/exact source content/);
});
test('Shadow lottery follows the native ordered flag pairs and defers later owned/Corps providers until eligible',()=>{
  const entry=shadowEntry(),state=shared(),no=()=>{throw Error('unexpected late provider');},read:number[]=[];
  assert.equal(planShadowSecedeLot(entry,ref=>{read.push(ref.index);return state.read(ref);},no,no,no),0);
  assert.deepEqual(read,SHADOW_SECEDE_FLAGS.flatMap(pair=>[pair.start,pair.stop]));
  const unknown=new EventState();unknown.write({category:'ScenarioFlag1',index:97},0);
  assert.throws(()=>planShadowSecedeLot(entry,ref=>unknown.read(ref),no,no,no),UnknownEventValue);
  const beast=structuredClone(entry);beast.field.footAttributeType=31;
  assert.equal(planShadowSecedeLot(beast,no,no,no,no),0);
  assert.throws(()=>planShadowSecedeLot({...entry,field:{...entry.field,footAttributeType:null}},no,no,no,no),/BeastField/);
  state.write({category:'ScenarioFlag1',index:123},1);const absent=structuredClone(entry);absent.roster.shift();absent.party.slots[0][0].id=null;
  assert.equal(planShadowSecedeLot(absent,ref=>state.read(ref),no,no,no),0);
  assert.equal(planShadowSecedeLot(entry,ref=>state.read(ref),()=>['b'],no,no),0);
  assert.equal(planShadowSecedeLot(entry,ref=>state.read(ref),()=>['a'],no,no),0);
});
test('Shadow eligibility uses selected owned identity, exact fixed state, an actual Fight log and one conditional 1 percent shared draw',()=>{
  const entry=shadowEntry(),state=shared(),calls:number[][]=[];state.write({category:'ScenarioFlag1',index:97},1);
  const read=()=>[{actorSide:'player' as const,ownedId:'a',commandId:1}];
  for(const draw of [0,1,99]){
    calls.length=0;assert.equal(planShadowSecedeLot(entry,ref=>state.read(ref),()=>['a','b'],read,(min,max)=>{calls.push([min,max]);return draw;}),draw===0?1:0);
    assert.deepEqual(calls,[[0,99]]);
  }
  const no=()=>{throw Error('unexpected random');};
  for(const fixed of [2,4,5] as const)assert.equal(planShadowSecedeLot({...entry,fixedPreemptiveState:fixed},ref=>state.read(ref),()=>['a','b'],no,no),0);
  assert.throws(()=>planShadowSecedeLot({...entry,fixedPreemptiveState:null},ref=>state.read(ref),()=>['a','b'],no,no),/fixedPreeMptiveState/);
  assert.equal(planShadowSecedeLot(entry,ref=>state.read(ref),()=>['a','b'],()=>[{actorSide:'enemy',ownedId:'a',commandId:1},{actorSide:'player',ownedId:'a',commandId:2}],no),0);
});
test('post-battle selectors retain full operands and Shadow departure stays blocked even without a current Shadow',()=>{
  const raw=(selector:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}}),
    compile=(m:ReturnType<typeof raw>[])=>compileBattleEvent({Name:'authored',Title:{main:'',sub:''},Mnemonics:m,Segments:[{Label:'Main',EntryPoint:0,Count:m.length}],ScriptLocal:['a','b','c','d'],ScriptLocalValue:[0,0,0,7],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]},null);
  const source=[raw('血塗られた盾'),raw('シャドウ離脱抽選'),raw('バトルでシャドウ離脱')],before=structuredClone(source),p=compile(source);
  assert.deepEqual(p.instructions.slice(0,2).map(row=>row.op),[{kind:'cursed-shield-check'},{kind:'shadow-secede-lot'}]);
  const leave=p.instructions[2]!.op;assert.equal(leave.kind,'blocked');if(leave.kind==='blocked')assert.match(leave.reason,/unconditional Integrator ReserveScript/);
  assert.deepEqual(source,before);source[0]!.operands.iValues[7]=1;assert.equal(compile(source).instructions[0]!.op.kind,'blocked');
  const malformed=program([{kind:'shadow-secede-lot'}]);malformed.localNames.pop();malformed.initialLocals.pop();assert.throws(()=>parseBattleEventProgram(malformed),/ScriptLocalVariable\[3\]/);
});
test('BattleGame commits the shared counter only to its borrowed draft and rolls it back with a later failed operation',()=>{
  const f=gear(),q=f.inventory.qualification!,sharedOwner=shared();variable(sharedOwner,9,10);q.members[0]!.equipment[1]=213;
  q.equipmentStock.push({id:213,count:1,equipped:1});
  f.content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:program([{kind:'blank'},{kind:'cursed-shield-check'}])};
  const game=new BattleGame(f.content,8,undefined,f.inventory,undefined,undefined,battleEventSharedSnapshot(sharedOwner));game.advance(10);
  assert.equal(game.eventSharedReturn!.candidate.global[9],11);assert.equal(sharedOwner.read({category:'ScenarioVariable',index:9}),10);assert.equal(q.members[0]!.equipment[1],213);
  const fail=structuredClone(f.content);fail.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:program([{kind:'blank'},{kind:'cursed-shield-check'},{kind:'get-enemy-mode',uniqueId:9,expected:0}])};
  const failing=new BattleGame(fail,8,undefined,f.inventory,undefined,undefined,battleEventSharedSnapshot(sharedOwner)),before={event:failing.eventExecution,shared:failing.eventSharedReturn,time:failing.time,random:Reflect.get(failing,'randomState')},units=[...failing.combatants];
  assert.throws(()=>failing.advance(10),/unique-slot/);assert.deepEqual(failing.eventExecution,before.event);assert.deepEqual(failing.eventSharedReturn,before.shared);
  assert.equal(failing.time,before.time);assert.equal(Reflect.get(failing,'randomState'),before.random);assert(failing.combatants.every((unit,i)=>unit===units[i]));
});
test('BattleGame Shadow no-lot resets local 3 and a reached unknown native provider restores the same VM banks, RNG and players',()=>{
  const content=fixture();content.contentHash='1'.repeat(64);content.players[0]!.sourceId=4;content.players[1]!.sourceId=37;content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:program([{kind:'blank'},{kind:'shadow-secede-lot'}])};
  const entry=shadowEntry(),state=shared(),game=new BattleGame(content,8,undefined,undefined,undefined,undefined,battleEventSharedSnapshot(state),undefined,{gau:entry});
  game.advance(10);assert.equal(game.eventExecution.state!.locals[3],0);
  state.write({category:'ScenarioFlag1',index:97},1);entry.fixedPreemptiveState=null;
  const failing=new BattleGame(content,8,undefined,undefined,undefined,undefined,battleEventSharedSnapshot(state),undefined,{gau:entry}),before={event:failing.eventExecution,shared:failing.eventSharedReturn,time:failing.time,random:Reflect.get(failing,'randomState')};
  assert.throws(()=>failing.advance(10),/fixedPreeMptiveState/);assert.deepEqual(failing.eventExecution,before.event);assert.deepEqual(failing.eventSharedReturn,before.shared);
  assert.equal(failing.time,before.time);assert.equal(Reflect.get(failing,'randomState'),before.random);
});
