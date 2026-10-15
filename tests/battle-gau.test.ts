import test from 'node:test';
import assert from 'node:assert/strict';
import { planBattleGauMode,parseBattleGauEntry,readBattleEnemyMode,type BattleGauEntry } from '../src/core/battle-gau.js';
import { emptyPartyState } from '../src/core/party.js';
import { BattleGame } from '../src/core/battle.js';
import { compileBattleEvent } from '../src/compiler/battle-event.js';
import type { BattleEventOp,BattleEventProgram } from '../src/core/battle-event.js';
import { fixture } from './fixtures/battle-content.js';
import { participantFixture } from './fixtures/battle-participant-game.js';
import { syntheticAI } from './fixtures/battle-ai.js';
import { enemyBattleDefinition } from '../src/core/battle-participants.js';
export function gauEntry():BattleGauEntry{
  const party=emptyPartyState();party.slots[0][0].id='a';party.slots[0][1].id='b';
  return {kind:'source-battle-gau-entry-v1',catalogHash:'1'.repeat(64),
    roster:[{id:'a',sourceId:1000,ownedId:1,enabled:true},{id:'b',sourceId:1001,ownedId:2,enabled:true},
      {id:'held-gau',sourceId:12,ownedId:3,enabled:false}],party,
    field:{mapId:123,transportationId:1,isSavePoint:null,beastFieldController:true,footAttributeType:31},fixedPreemptiveState:0};
}
export function gauProgram(ops:BattleEventOp[]):BattleEventProgram{
  return {kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:['AI','EnemyMode','GauMode'],initialLocals:[0,0,9],blockers:[],
    instructions:ops.map(op=>({mnemonic:op.kind,op:structuredClone(op)}))};
}
function liveProgram(ops:BattleEventOp[]):BattleEventProgram{
  const label=ops.length;return gauProgram([...ops,{kind:'nop'},{kind:'blank'},{kind:'jump',target:label}]);
}
test('Gau dispatch reads all owned records, selected Corps only, independent enable flag and preserves non-writing branches',()=>{
  const noRandom=()=>{throw Error('unexpected random draw');};
  const f=gauEntry(),before=structuredClone(f);
  const absent=structuredClone(f);absent.roster.pop();absent.field.footAttributeType=null;
  assert.equal(planBattleGauMode(absent,[],noRandom).modeWrite,null);
  const riding=structuredClone(f);riding.field.transportationId=6;riding.field.beastFieldController=null;riding.field.footAttributeType=null;
  assert.equal(planBattleGauMode(riding,[],noRandom).modeWrite,null);
  const member=structuredClone(f);member.party.slots[0][2].id='held-gau';
  assert.equal(planBattleGauMode(member,[],noRandom).modeWrite,1);
  const reserve=structuredClone(f);reserve.roster[2]!.enabled=true;reserve.fixedPreemptiveState=null;
  assert.equal(planBattleGauMode(reserve,[],noRandom).modeWrite,null);
  for(const fixed of [2,4,5] as const)assert.equal(planBattleGauMode({...f,fixedPreemptiveState:fixed},[],noRandom).modeWrite,null);
  const full=structuredClone(f);for(let i=2;i<4;i++){const id='other'+i;full.roster.push({id,sourceId:90+i,ownedId:i+2,enabled:true});full.party.slots[0][i]!.id=id;}
  full.party.slots[1][0].id='held-gau';assert.equal(planBattleGauMode(full,[],noRandom).modeWrite,null);
  assert.deepEqual(f,before);
});
test('Gau return uses one shared 0..99 draw at the exact threshold and preserves duplicate current enemy master identities',()=>{
  for(const value of [0,69,70,99]){
    const calls:number[][]=[],f=gauEntry(),before=structuredClone(f),plan=planBattleGauMode(f,[7,7,19],(min,max)=>{calls.push([min,max]);return value;});
    assert.deepEqual(calls,[[0,99]]);assert.equal(plan.modeWrite,value<=69?2:null);
    assert.deepEqual(plan.encounteredEnemyIds,value<=69?[7,7,19]:null);assert.equal(plan.endEnabled,value<=69?false:null);assert.deepEqual(f,before);
  }
});
test('unknown source field/fixed state, malformed ownership and missing entry are specific gates, not false or a fresh mode zero',()=>{
  const f=gauEntry(),noRandom=()=>{throw Error('unexpected random draw');};
  assert.throws(()=>planBattleGauMode(undefined,[],noRandom),/complete source/);
  assert.throws(()=>planBattleGauMode({...f,field:{...f.field,footAttributeType:null}},[],noRandom),/BeastField/);
  assert.throws(()=>planBattleGauMode({...f,fixedPreemptiveState:null},[],noRandom),/fixedPreeMptiveState/);
  assert.throws(()=>parseBattleGauEntry({...f,roster:[...f.roster,f.roster[0]!]}),/Ambiguous/);
  assert.throws(()=>planBattleGauMode(f,[0],()=>0));assert.throws(()=>planBattleGauMode(f,[1],()=>100));
});
test('GetEnemyMode reads the current unique-slot parameter before its conditional local[1] write',()=>{
  const rows=[{uniqueId:8,mode:-7},{uniqueId:2,mode:5}];
  assert.equal(readBattleEnemyMode(8,0,0,rows),-7);assert.equal(readBattleEnemyMode(2,0,-7,rows),-7);
  assert.throws(()=>readBattleEnemyMode(9,0,17,rows),/missing/);assert.throws(()=>readBattleEnemyMode(8,0,0,[...rows,rows[0]!]));
});
test('source decoder handles the whole operand families and retains specific leap/replacement/join/reserve/appearance gates',()=>{
  const command=(mnemonic:string,ints:number[]=[],selector='')=>({type:1,mnemonic,operands:{iValues:Array.from({length:8},(_,i)=>ints[i]??0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}});
  const compile=(raw:ReturnType<typeof command>[])=>compileBattleEvent({Name:'authored',Title:{main:'',sub:''},Mnemonics:raw,Segments:[{Label:'Main',EntryPoint:0,Count:raw.length}],ScriptLocal:['a','b','c'],ScriptLocalValue:[0,0,9],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]},null);
  const raw=[command('SysCall',[],'ガウバトルモード設定'),command('GetEnemyMode',[9,-3])],before=structuredClone(raw),program=compile(raw);
  assert.deepEqual(program.instructions.map(row=>row.op),[{kind:'set-gau-mode'},{kind:'get-enemy-mode',uniqueId:9,expected:-3}]);assert.deepEqual(raw,before);
  for(const selector of ['とびこむで離脱','敵パーティをガウに','バトル加入：ガウ','メンバー加入：ガウ','ガウ初回予約','ガウ登場アニメ']){
    const op=compile([command('SysCall',[],selector)]).instructions[0]!.op;assert.equal(op.kind,'blocked');if(op.kind==='blocked')assert.match(op.reason,/Gau/);
  }
  const bad=command('GetEnemyMode',[9]);bad.operands.iValues[7]=1;assert.equal(compile([bad]).instructions[0]!.op.kind,'blocked');
});
test('BattleGame GetEnemyMode observes the same live AI ModeSet owner and original noncompact slots',()=>{
  const ai=(mode:number)=>syntheticAI([['ModeSet',[mode]],['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['EndTable'],['JumpBattleAI',[1]]]);
  const c=participantFixture([]);c.enemies[0]!.ai=ai(5);c.enemies[1]!.ai=ai(8);
  for(const unit of c.enemies)c.participants!.enemyDefinitions[unit.sourceId]=enemyBattleDefinition(unit);
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:liveProgram([{kind:'exec-ai'},
    {kind:'get-enemy-mode',uniqueId:8,expected:0},{kind:'get-enemy-mode',uniqueId:2,expected:0},{kind:'get-enemy-mode',uniqueId:2,expected:8}])};
  const game=new BattleGame(c,8);game.advance(10);assert.equal(game.eventExecution.state!.locals[1],5);
  assert.equal(game.enemies[0]!.behavior!.mode,5);assert.equal(game.enemies[1]!.behavior!.mode,8);
});
test('Gau mode preserves an existing VM value on the real non-Beast branch and captures entry facts by value',()=>{
  const c=fixture();c.contentHash='1'.repeat(64);const entry=gauEntry();entry.field.footAttributeType=0;
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:liveProgram([{kind:'blank'},{kind:'set-gau-mode'}])};
  const game=new BattleGame(c,8,undefined,undefined,undefined,undefined,undefined,undefined,{gau:entry});
  entry.field.footAttributeType=31;game.advance(10);assert.equal(game.eventExecution.state!.locals[2],9);
  assert.equal(game.gauLifecycle.journal[0]!.modeWrite,null);assert.equal(game.gauLifecycle.encounteredEnemyIds,null);
  assert.throws(()=>new BattleGame(c,8),/complete source-owned/);
});
test('Gau current-member mode writes only local[2]; unknown future query rolls back time, RNG, mode/list and existing unit owners',()=>{
  const c=fixture();c.contentHash='1'.repeat(64);c.players[0]!.sourceId=12;const entry=gauEntry();entry.roster[0]!.sourceId=12;entry.roster.pop();
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:liveProgram([{kind:'set-gau-mode'}])};
  const game=new BattleGame(c,8,undefined,undefined,undefined,undefined,undefined,undefined,{gau:entry});game.advance(10);
  assert.equal(game.eventExecution.state!.locals[2],1);assert.equal(game.eventExecution.state!.locals[1],0);
  const bad=fixture();bad.contentHash='1'.repeat(64);bad.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,
    program:gauProgram([{kind:'blank'},{kind:'set-gau-mode'},{kind:'get-enemy-mode',uniqueId:9,expected:0},{kind:'exit'}])};
  const failing=new BattleGame(bad,8,undefined,undefined,undefined,undefined,undefined,undefined,{gau:gauEntry()}),
    before={state:failing.eventExecution,gau:failing.gauLifecycle,time:failing.time,random:Reflect.get(failing,'randomState')},units=[...failing.combatants];
  assert.throws(()=>failing.advance(10),/unique-slot/);assert.deepEqual(failing.eventExecution,before.state);assert.deepEqual(failing.gauLifecycle,before.gau);
  assert.equal(failing.time,before.time);assert.equal(Reflect.get(failing,'randomState'),before.random);assert(failing.combatants.every((unit,i)=>unit===units[i]));
});
test('Gau return consumes the existing BattleGame random stream once and publishes its list/end gate in the same owner',()=>{
  const c=fixture();c.contentHash='1'.repeat(64);
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:liveProgram([{kind:'set-gau-mode'}])};
  const bare=structuredClone(c);bare.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:liveProgram([])};
  const game=new BattleGame(c,8,undefined,undefined,undefined,undefined,undefined,undefined,{gau:gauEntry()}),peer=new BattleGame(bare,8),
    integer=Reflect.get(peer,'randomInt') as (min:number,max:number)=>number,draw=integer.call(peer,0,99);
  assert.equal(Reflect.get(game,'randomState'),Reflect.get(peer,'randomState'));
  assert.equal(game.eventExecution.state!.locals[2],draw<=69?2:9);assert.equal(game.eventExecution.controls.endEnabled,draw>69);
  assert.deepEqual(game.gauLifecycle.encounteredEnemyIds,draw<=69?game.enemies.map(unit=>unit.sourceId):null);
  assert.equal(game.gauLifecycle.journal.length,1);assert.equal(game.players.length,peer.players.length);
});
