import test from 'node:test';
import assert from 'node:assert/strict';
import {enemyMagicSource,enemyMagicContent} from './fixtures/enemy-magic-carrier.js';
import {cyclingAI,syntheticAI} from './fixtures/battle-ai.js';
import {BattleGame} from '../src/core/battle.js';
import {baseHpMagicEffect,baseHpMagicValue,calculateBaseHpMagic,parseSourceEnemyBossParameter} from '../src/core/base-hp-magic.js';
import {compileBaseHpMagic,compileSourceEnemyBossParameter} from '../src/compiler/base-hp-magic.js';
import {enemyMagicActorBlocker} from '../src/core/enemy-magic-carrier.js';
import {projectActionTargets} from '../src/core/action-user-conditions.js';
import {battleReaction} from '../src/core/battle-reactions.js';
import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS} from '../src/core/scripted-battle-action.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import {battleEntryRuntimeFixture} from './fixtures/battle-entry-runtime.js';

function source(type=2,values:[number,number,number]=[2,2,50]){
  const f=enemyMagicSource();Object.assign(f.ability,{type_id:String(type),system_id:'3',standard_value:'0',content_flag_group_id:'91'});
  Object.assign(f.group,{function1_value1:String(values[0]),function1_value2:String(values[1]),function1_value3:String(values[2])});
  f.tables['function.csv']![0]!.type_id='33';f.tables['chanting.csv']![0]!.ability_type_id=String(type);
  f.tables['content_flag_group.csv']=[{id:'1',group_id:'91',content_flag_id:'1'},{id:'2',group_id:'91',content_flag_id:'2'},{id:'3',group_id:'91',content_flag_id:'3'}];
  return f;
}
function content(type=2,values:[number,number,number]=[2,2,50]){
  const {content:c}=enemyMagicContent(),f=source(type,values);c.abilities[901]=f.compileAbility().abilities[901]!;
  c.initialAtb.enemy=[0,0];c.enemies[0]!.abilities=[13];c.enemies[0]!.ai=cyclingAI([13]);
  c.enemies[0]!.bossParameter={kind:'source-enemy-boss-parameter-v1',sourceId:c.enemies[0]!.sourceId,bossFlag:0};
  c.players[0]!.abilities.push(901);c.commands[100]!.abilityIds.push(901);
  return{c,f};
}
const snapshot=(b:BattleGame)=>structuredClone({time:b.time,units:b.combatants,action:b.action,queue:b.pendingActions,random:Reflect.get(b,'randomState'),events:b.events});
function until(b:BattleGame,done:()=>boolean){for(let i=0;i<1000&&!done();i++)b.advance(10);assert(done());}
const context=(a:{id:string},t:{id:string},boss=false)=>({actorId:a.id,targets:[{targetId:t.id,parameter:'enemy' as const,boss}]});

test('whole source slot decoding keeps original identities and operands; mixed companion phases never disappear',()=>{
  for(const values of [[2,2,50],[2,2,75],[2,2,94],[2,3,2],[1,6,0],[1,1,0]]as [number,number,number][]){
    const f=source(2,values),a=f.compileAbility().abilities[901]!;assert(a.plan,a.blockers.join('; '));
    const e=baseHpMagicEffect(a.plan,a.program)!;assert.deepEqual(e.rawValues,values);assert.equal(a.program.functions[0]!.functionId,809);
    assert.equal(a.presentation,'source-effect-deferred');assert.equal(a.plan.magic,null);assert.equal(a.power,0);
    f.group.function2_id='809';f.group.function2_value1='2';f.group.function2_value2='2';f.group.function2_value3='50';
    const blocked=f.compileAbility().abilities[901]!;assert.equal(blocked.plan,null);assert.equal(blocked.program.functions.length,2);
    assert(blocked.blockers.some(b=>b.includes('companion')));assert(!blocked.blockers.some(b=>b.includes('unsupported function type 33')));
    for(const fn of blocked.program.functions)assert.equal(compileBaseHpMagic(f.reader(),blocked.program,fn).effect.kind,'base-hp-magic');
  }
});
test('unknown source operands, carrier, Chanting and effect dependencies remain hard failures',()=>{
  for(const mutate of [(f:ReturnType<typeof source>)=>{f.group.function1_value2='7';},(f:ReturnType<typeof source>)=>{f.group.function1_value3='0';},
    (f:ReturnType<typeof source>)=>{f.tables['function.csv']![0]!.series_id='1';},(f:ReturnType<typeof source>)=>{f.ability.ability_lv='1';},(f:ReturnType<typeof source>)=>{f.tables['chanting.csv']=[];},
    (f:ReturnType<typeof source>)=>{f.tables['se_asset.csv']=[];},(f:ReturnType<typeof source>)=>{f.ability.type_id='629';},(f:ReturnType<typeof source>)=>{f.ability.process_prog='unknown';}]){
    const f=source();mutate(f);const a=f.compileAbility().abilities[901]!;assert.equal(a.plan,null);assert(a.blockers.length);
  }
  const f=source(13),a=f.compileAbility().abilities[901]!;assert(a.plan);assert.equal(enemyMagicActorBlocker(a,'enemy'),null);
  assert.match(enemyMagicActorBlocker(a,'player')!,/player\/special/);f.ability.reaction_type='1';assert.equal(f.compileAbility().abilities[901]!.plan,null);
});
test('fixed-base HP modes use the live chosen owner and native truncation, without ordinary damage stats',()=>{
  const actor={hp:101,maxHp:500},target={hp:79,maxHp:1000};
  for(const [values,expected]of [[[2,2,50],39],[[2,3,4],19],[[1,1,0],101],[[1,6,0],399]]as [[number,number,number],number][]){
    const a=source(2,values).compileAbility().abilities[901]!;assert.equal(baseHpMagicValue(baseHpMagicEffect(a.plan!)!,actor,target),expected);
  }
});
test('real queued action pays once, uses current HP, ignores defense/Shell and commits through the old life owner',()=>{
  const {c}=content(),b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;t.hp=101;t.magicDefense=255;
  assert(b.command(a.id,901,t.id));until(b,()=>b.action?.source.id===901&&b.action.resolved);
  assert.equal(t.hp,51);assert.equal(a.mp,5);assert.equal(b.action!.results[0]!.effects[0]!.resource,'hp');
  const old=snapshot(b);b.advance(10);assert.equal(t.hp,51);assert.equal(a.mp,5);assert(old.action!.resolved);
});
test('Boss failure precedes hit RNG, remains a received Miss, and changed/missing actual parameter facts roll back',()=>{
  const {c}=content();c.enemies[0]!.bossParameter!.bossFlag=1;const b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;
  assert(b.command(a.id,901,t.id));until(b,()=>b.action?.source.id===901&&b.action.resolved);assert.equal(t.hp,200);assert.equal(a.mp,5);
  const effect=b.action!.results[0]!.effects[0]!;assert(effect.missed);assert.equal(battleReaction(c.reactions,{actor:a.id,target:t.id,isCounter:false,abilityId:901,systemId:3,primarySlot:1,effects:[effect]})?.counterReady,false);
  for(const change of ['missing','changed']as const){const {c:valid}=content(),g=new BattleGame(valid,314),actor=g.players[0]!,target=g.enemies[0]!;
    assert(g.command(actor.id,901,target.id));until(g,()=>g.action?.elapsed===390);const original=target.bossParameter!;
    if(change==='missing')delete target.bossParameter;else target.bossParameter={...original,bossFlag:1};
    const before=snapshot(g);assert.throws(()=>g.advance(10),/boss parameter|checkpoint/i);assert.deepEqual(snapshot(g),before);
    target.bossParameter=original;g.advance(10);assert.equal(target.hp,100);assert.equal(actor.mp,5);
  }
});
test('fixed-base hit consumes only the native hit draw; fixed flag skips it and Boss skips it before provider',()=>{
  const {c}=content(),b=new BattleGame(c,12),a=b.players[0]!,t=b.enemies[0]!,e=baseHpMagicEffect(c.abilities[901]!.plan!)!;t.hp=101;
  const calls:[number,number][]=[],draw=(min:number,max:number)=>{calls.push([min,max]);return min;};
  let result=calculateBaseHpMagic(e,a,t,[],draw,1,context(a,t));assert.equal(result.amount,50);assert.deepEqual(calls,[]);
  e.contentFlags=[];result=calculateBaseHpMagic(e,a,t,[],draw,1,context(a,t));assert.equal(result.amount,50);assert.deepEqual(calls,[[0,255]]);
  calls.length=0;t.magicEvasion=255;result=calculateBaseHpMagic(e,a,t,[],draw,1,context(a,t));assert(result.missed);assert.equal(calls.length,1);
  calls.length=0;result=calculateBaseHpMagic(e,a,t,[7],draw,1,context(a,t));assert(!result.missed);assert.equal(calls.length,1);
  calls.length=0;result=calculateBaseHpMagic(e,a,t,[],draw,1,context(a,t,true));assert(result.missed);assert.equal(calls.length,0);
  assert.throws(()=>calculateBaseHpMagic(e,a,t,[],draw,1,undefined),/provenance/);
});
test('whole multi-target projection uses the existing atomic frame and retries the same payment and random stream',()=>{
  const {c,f}=content();f.ability.battle_renge_id='4';f.tables['content_flag_group.csv']=[];f.ability.content_flag_group_id='0';
  c.abilities[901]=f.compileAbility().abilities[901]!;c.enemies.push({...structuredClone(c.enemies[0]!),id:'e2'});
  const b=new BattleGame(c,314),a=b.players[0]!;assert(b.command(a.id,901,{kind:'side',side:'enemy'}));until(b,()=>b.action?.elapsed===390);
  const t=b.enemies[1]!,old=t.hp;t.hp=NaN;const before=snapshot(b);assert.throws(()=>b.advance(10));assert.deepEqual(snapshot(b),before);t.hp=old;b.advance(0);
  assert.equal(a.mp,5);assert.deepEqual(b.enemies.map(t=>t.hp),[150,150]);assert(b.action!.resolved);
  const replay=new BattleGame(c,314);assert(replay.command(replay.players[0]!.id,901,{kind:'side',side:'enemy'}));replay.advance(410);
  assert.deepEqual(b.action,replay.action);assert.equal(Reflect.get(b,'randomState'),Reflect.get(replay,'randomState'));
});
test('scripted actions use the shared reaction owner and a late reaction failure rolls back HP, payment and RNG',()=>{
  const {c}=content();c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['CounterAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
  c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  const action=compileScriptedBattleAction({mnemonic:'BattleAction',type:1,operands:{iValues:[1,1000,901,2,1,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
  const ops:BattleEventOp[]=[{kind:'exec-ai'},action,{kind:'wait',seconds:1},{kind:'exit'}];
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:{kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:[],initialLocals:[],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]}};
  const b=new BattleGame(c,314,undefined,undefined,undefined,undefined,undefined,undefined,{scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS});
  until(b,()=>b.action?.source.id===901&&b.action.elapsed===390);const old=b.content.abilities[13]!.plan;b.content.abilities[13]!.plan=null;
  const before=snapshot(b);assert.throws(()=>b.advance(10),/unimplemented ability/);assert.deepEqual(snapshot(b),before);b.content.abilities[13]!.plan=old;b.advance(0);
  assert.equal(b.action!.kind,'event');assert(b.action!.resolved);assert.equal(b.enemies[0]!.hp,100);assert.equal(b.players[0]!.mp,5);
  assert(b.pendingActions.some(action=>action.kind==='counter'));
});
test('source Boss flag belongs to the immutable monster template, with no save or encounter fallback',()=>{
  const f=source();f.tables['monster.csv']=[{id:'700',boss:'2'}];const out=compileSourceEnemyBossParameter(f.reader(),700);
  assert.deepEqual(out.metadata,{kind:'source-enemy-boss-parameter-v1',sourceId:700,bossFlag:2});assert.equal(out.sources.length,1);
  assert.throws(()=>parseSourceEnemyBossParameter({...out.metadata,sourceId:701},700),/binding/);
  f.tables['monster.csv']![0]!.boss='';assert.throws(()=>compileSourceEnemyBossParameter(f.reader(),700));
});
test('actor and target Trance are refused by the actual active-condition owner, including late-frame changes',()=>{
  for(const side of ['actor','target']as const)for(const type of [621,684]){
    const {c}=content();c.conditions.rules.definitions.push({id:1900+type,type,overlapped:false,eraseGroupId:3});
    const b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;assert(b.command(a.id,901,t.id));until(b,()=>b.action?.elapsed===390);
    (side==='actor'?a:t).conditionIds.push(1900+type);const before=snapshot(b);assert.throws(()=>b.advance(10),/behavior|condition/i);assert.deepEqual(snapshot(b),before);
  }
});
test('an actual source inventory owner cannot silently bypass target equipment result conversion',()=>{
  const {content:c,inventory}=battleEntryRuntimeFixture(),f=source(13);f.ability.condition_group_id='0';c.abilities[901]=f.compileAbility().abilities[901]!;
  c.enemies=c.enemies.slice(0,1);c.enemies[0]!.abilities=[901];c.enemies[0]!.ai=cyclingAI([901]);c.initialAtb={player:[0,0],enemy:[100,100]};
  const b=new BattleGame(c,314,undefined,inventory);until(b,()=>b.action?.source.id===901&&b.action.elapsed===390);
  const before=snapshot(b);assert.throws(()=>b.advance(10),/target equipment override/);assert.deepEqual(snapshot(b),before);
});
test('fixed-base zero stays a nullified received result, positive damage caps and groups use source flag2',()=>{
  const {c}=content(504,[1,6,0]),b=new BattleGame(c,12),a=b.players[0]!,t=b.enemies[0]!,effect=baseHpMagicEffect(c.abilities[901]!.plan!)!;
  const draw=()=>{throw Error('Fixed source hit must not draw');};
  const zero=calculateBaseHpMagic(effect,a,t,[],draw,1,context(a,t));assert.equal(zero.amount,0);assert.equal(zero.nullified,true);assert.equal(zero.missed,false);
  assert.equal(battleReaction(c.reactions,{actor:a.id,target:t.id,isCounter:false,abilityId:901,systemId:3,primarySlot:1,effects:[zero]})?.counterReady,true);
  a.maxHp=100000;a.hp=1;assert.equal(calculateBaseHpMagic(effect,a,t,[],draw,1,context(a,t)).amount,9999);
  a.maxHp=80;a.hp=39;effect.contentFlags=[1];assert.equal(calculateBaseHpMagic(effect,a,t,[],draw,2,context(a,t)).amount,20);
  effect.contentFlags=[1,2];assert.equal(calculateBaseHpMagic(effect,a,t,[],draw,2,context(a,t)).amount,41);
});
test('enemy AI and derived commands enter the same fixed-base calculator without a player Type13 permission',()=>{
  for(const derived of [false,true]){const {c}=content(13);c.initialAtb={player:[0,0],enemy:[100,100]};
    const ability=c.abilities[901]!;ability.cost=0;c.enemies[0]!.abilities=[901];c.enemies[0]!.ai=cyclingAI([901]);
    if(derived){const parent=structuredClone(c.abilities[13]!);parent.id=15;parent.program.abilityId=15;parent.power=0;parent.cost=0;parent.wait=0;parent.program.range=7;
      parent.plan!.effects=[{kind:'random-ability',slot:1,rawValues:[46,0,1],groupId:46,fallbackAbilityId:0,retarget:true,
        rows:[{rowId:1,abilityId:901,invocationRate:100,conditionGroupId:0,conditionIds:[]}],primaryResult:{hitType:0,value:0},
        child:{actType:5,useType:1,commandId:null,armType:0,actAbilityType:0,continuousCommandCount:1,isCounter:false}}];
      c.abilities[15]=parent;c.enemies[0]!.abilities.push(15);c.enemies[0]!.ai=cyclingAI([15]);}
    const b=new BattleGame(c,314);assert.equal(b.canUse(b.players[0]!.id,901),false);until(b,()=>b.action?.source.id===901&&b.action.resolved);
    assert.equal(b.action!.kind,derived?'derived':'normal');assert.equal(b.action!.results[0]!.effects[0]!.resource,'hp');assert.equal(b.action!.results[0]!.effects[0]!.missed,false);
  }
});
