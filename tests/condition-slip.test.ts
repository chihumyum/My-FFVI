import test from 'node:test'; import assert from 'node:assert/strict';
import { advanceSlipClock, reconcileSlipClocks, slipCycle, slipDamage, writeSlipTimeStop } from '../src/core/condition-slip.js';
import { compileFieldConditionCatalog } from '../src/compiler/field-conditions.js';
import { BattleConditions } from '../src/core/battle-conditions.js';
import { slipSource } from './fixtures/slip-condition.js';
import { battleEventUnitGameOver } from '../src/core/battle-event-context.js';
const clock = () => reconcileSlipClocks([9007],[])[0]!;
test('complete type407 source shape admits ordinary sole Fn9; changed fields and companions remain hard',()=>{
 const f=slipSource();assert.equal(f.compile().catalog.behaviors.find(b=>b.id===f.conditionId)?.kind,'slip');assert(f.compileAbility().abilities[901]!.plan);
 for(const [k,v] of [['until_type','3'],['system_type','1'],['condition_group_id','9'],['game_over_target','1'],['rate_value1','1'],['erase_condition_group_id','1']] as const){const x=slipSource();Reflect.set(x.sleep,k,v);assert(!x.compile().catalog.behaviors.some(b=>b.id===x.conditionId),k);assert.equal(x.compileAbility().abilities[901]!.plan,null);}
 const mixed=slipSource();mixed.group.function2_id='809';mixed.group.function2_value1=String(mixed.conditionId);assert.equal(mixed.compileAbility().abilities[901]!.plan,null);
 const accuracy=slipSource();accuracy.ability.accuracy_rate='120';const high=accuracy.compileAbility().abilities[901]!;assert(high.plan);assert.equal(high.plan.effects[0]!.kind,'add-condition');assert.equal(high.program.rules.accuracy_rate,120);
 const flags=slipSource();flags.tables['content_flag_group.csv']!.push({id:'98',group_id:'91',content_flag_id:'4'});assert.equal(flags.compileAbility().abilities[901]!.plan,null);
});
test('battle-only type407 cannot persist or gain unknown mixed-initial order',()=>{
 const f=slipSource(),engine=new BattleConditions(f.compile().catalog);assert.throws(()=>engine.validateStableLife(20,[f.conditionId]),/cannot persist/);
 assert.throws(()=>engine.validateInitialComposition([f.conditionId,110]),/noncommuting/);assert.deepEqual(engine.battleEnd([f.conditionId,110]),[110]);assert(!compileFieldConditionCatalog(f.reader(),f.compile().catalog,[106]).catalog.behaviors.some(b=>b.id===f.conditionId));
});
test('first/next dynamic float32 thresholds, one tick per Update and discarded excess',()=>{
 assert.equal(slipCycle(2,true),1.5);let c=clock();let n=advanceSlipClock(c,1.49,2,false,false);assert(!n.tick);n=advanceSlipClock(n.clock,.02,2,false,false);assert(n.tick);assert.equal(n.clock.elapsedSeconds,0);assert(!n.clock.first);
 n=advanceSlipClock(n.clock,99,2,false,false);assert(n.tick);assert.equal(n.clock.elapsedSeconds,0);
 const before=advanceSlipClock(clock(),1,1,false,false).clock;assert.equal(advanceSlipClock(before,.01,4,false,false).tick,true);
});
test('actual pending tag, time-stop and game-over block progress without inherited presence; remove/re-add resets',()=>{
 const c=advanceSlipClock(clock(),1,1,false,false).clock;
 for(const [stopped,ended,pending]of [[true,false,false],[false,true,false],[false,false,true]]){
  const input={...c,isTimeStop:stopped!};assert.deepEqual(advanceSlipClock(input,100,1,ended!,pending!).clock,input);
 }
 assert.deepEqual(reconcileSlipClocks([9007],[c]),[c]);const fresh=reconcileSlipClocks([9007],reconcileSlipClocks([],writeSlipTimeStop([c],true)));assert.deepEqual(fresh,[clock()]);
 const rules={conditions:[{id:5,type:5,attackTarget:0,gameOverTarget:1},{id:3,type:3,attackTarget:1,gameOverTarget:0},{id:602,type:602,attackTarget:0,gameOverTarget:0}]};assert(battleEventUnitGameOver(rules,[5]));assert(!battleEventUnitGameOver(rules,[3]));assert.throws(()=>battleEventUnitGameOver(rules,[602]),/602/);
});
test('one inclusive90..110 draw uses exact type4 f32 order and clamps, no poison divisor/affinity',()=>{
 let draws=0;const calc=(v:number,hp:number,r:number)=>slipDamage(v,hp,(min,max)=>{draws++;assert.deepEqual([min,max],[90,110]);return r;});
 assert.equal(calc(0,1,90),1);assert.equal(calc(200,9999,110),127);assert.equal(calc(31,1000,90),13);assert.equal(calc(31,1000,110),17);assert.equal(draws,4);
 assert.throws(()=>calc(1,0,100),/parameter/);assert.throws(()=>calc(1,100,111),/random/);
});
