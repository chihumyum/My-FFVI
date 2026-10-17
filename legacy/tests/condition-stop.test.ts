import test from 'node:test';import assert from 'node:assert/strict';
import {stopConditionRecoveryDuration,projectControlRecovery,createControlRecoveryState,type StopBehavior} from '../src/core/condition-control.js';
import {BattleConditions} from '../src/core/battle-conditions.js';import {compileFieldConditionCatalog} from '../src/compiler/field-conditions.js';
import {writePoisonTimeStop,reconcilePoisonClocks,advancePoisonClocks} from '../src/core/condition-poison.js';
import {stopConditionSource} from './fixtures/stop-condition.js';
const stop:StopBehavior={id:8123,kind:'stop',name:'Stop',untilType:7,untilValue:30};
test('ordinary Stop binds complete source master/carrier and leaves unrelated until/flags/companions hard',()=>{
 const f=stopConditionSource(),catalog=f.compile().catalog,a=f.compileAbility().abilities[901]!;
 assert.equal(catalog.behaviors.find(b=>b.id===f.conditionId)?.kind,'stop');assert(a.plan,a.blockers.join(';'));
 assert(a.ordinaryConditionPresentation);assert.equal(a.ordinaryConditionPresentation.effectAssetId,808);
 for(const[key,value]of [['until_type','9'],['overlapped_type','1'],['battle_effect_shadow_cloning','0'],['parameter_group_id','1'],['rate_value1','1']]as const){const p=stopConditionSource();Reflect.set(p.sleep,key,value);assert(!p.compile().catalog.behaviors.some(b=>b.id===p.conditionId),key);assert.equal(p.compileAbility().abilities[901]!.plan,null);}
 const mixed=stopConditionSource();mixed.group.function2_id='809';mixed.group.function2_value1='1907';assert.equal(mixed.compileAbility().abilities[901]!.plan,null);
 const missing=stopConditionSource();missing.tables['battle_effect_asset.csv']=[];assert.throws(()=>missing.compile(),/Missing|Unresolved table row/);
});
test('Stop cannot persist in Field/owned state or inherit initial multi-condition admission',()=>{
 const f=stopConditionSource(),catalog=f.compile().catalog,engine=new BattleConditions(catalog);
 assert.throws(()=>engine.validateStableLife(20,[f.conditionId]),/cannot persist/);
 assert.throws(()=>engine.validateInitialComposition([f.conditionId,110]),/noncommuting/);
 const field=compileFieldConditionCatalog(f.reader(),catalog,[106]);assert(!field.catalog.behaviors.some(b=>b.id===f.conditionId));
 assert.deepEqual(engine.battleEnd([f.conditionId,110]),[110]);
});
test('Until7 consumes one common recovery draw, has strict boundary and never uses physical-hit local time',()=>{
 let draws=0;const run=(elapsed:number,delta:number,progress=true,normalAttackAdded=false)=>projectControlRecovery(stop,{...createControlRecoveryState(stop,null),elapsedSeconds:elapsed},{progress,normalAttackAdded,durationSeconds:delta,targetedUnitGameOver:null},()=>{draws++;return 100;});
 assert.deepEqual(run(29,1).naturalRemovals,[]);assert.equal(draws,1);assert.deepEqual(run(30,Math.fround(.01)).naturalRemovals,['elapsed-time']);assert.equal(draws,2);
 assert.deepEqual(run(40,0,false).naturalRemovals,[]);assert.equal(draws,2);assert.equal(run(29,1,true,true).state.elapsedSeconds,29);assert.equal(draws,2);
 assert.equal(run(0,Math.fround(-.01)).state.elapsedSeconds,Math.fround(-.01));
});
test('Stop signed float32 duration keeps source Haste/Slow sum and zero fallback',()=>{
 const d=Math.fround(.01),base=Math.fround(d*2),coef=Math.fround(.1);
 assert.equal(stopConditionRecoveryDuration([],d,2),base);assert.equal(stopConditionRecoveryDuration([15],d,2),Math.fround(base*coef));
 assert.equal(stopConditionRecoveryDuration([16],d,2),Math.fround(base*-coef));assert.equal(stopConditionRecoveryDuration([15,16],d,2),base);
 assert.equal(stopConditionRecoveryDuration([15,15],d,2),Math.fround(base*Math.fround(coef+coef)));
 assert.throws(()=>stopConditionRecoveryDuration([627],d,0),/speed/);
});
test('Poison Stop writes attach to reconciled instances and cannot follow remove/readd row identity',()=>{
 const defs=[{id:110,hpDivisor:16}],initial=reconcilePoisonClocks(defs,[110],[],1,[10]),paused=writePoisonTimeStop(defs,[110],initial,true);
 const advance=(state:typeof initial)=>advancePoisonClocks(defs,{conditionIds:[110],state,hp:160,maxHp:160,elementResistances:{},seconds:2,atbSpeed:1,isTimeStopped:false},[10]);
 assert.equal(initial[0]!.isTimeStop,false);assert.deepEqual(advance(paused).state,paused);
 const removed=reconcilePoisonClocks(defs,[],paused,1,[]),next=reconcilePoisonClocks(defs,[110],removed,1,[10]);
 assert.equal(next[0]!.isTimeStop,false);assert.equal(advance(next).state[0]!.elapsedSeconds,2);
 const resumed=writePoisonTimeStop(defs,[110],paused,false);assert.equal(advance(resumed).state[0]!.elapsedSeconds,2);
 assert.throws(()=>writePoisonTimeStop(defs,[110],[],true),/instances/);
});
