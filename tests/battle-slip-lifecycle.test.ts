import test from 'node:test';import assert from 'node:assert/strict';
import {ControlledBattleGame as BattleGame} from './fixtures/controlled-battle.js';
import {slipContent} from './fixtures/slip-condition.js';
import {createControlledBattlePeriodicNumberHost,createWebBattlePeriodicNumberHost,WEB_BATTLE_PERIODIC_NUMBERS,type BattlePeriodicNumberHost,type BattlePeriodicNumberRequest} from '../src/core/battle-periodic-number.js';
const until=(b:BattleGame,p:()=>boolean,max=10000)=>{for(let i=0;i<max&&!p();i++)b.advance(10);assert(p());};
function setup(active=true,custom?:BattlePeriodicNumberHost){const f=slipContent(active),requests:Readonly<BattlePeriodicNumberRequest>[]=[];
 const host=custom??createControlledBattlePeriodicNumberHost(r=>requests.push(r)),b=new BattleGame(f.content,314,undefined,undefined,undefined,undefined,undefined,undefined,{periodicNumbers:host});return{...f,b,requests};}
const state=(b:BattleGame)=>structuredClone({time:b.time,units:b.combatants,numbers:b.periodicNumbers,clocks:b.combatants.map(c=>b.slipClockState(c.id)),random:Reflect.get(b,'randomState'),events:b.events,queue:b.pendingActions,action:b.action});
test('missing host rejects activation; marker-only Web host waits for actual draw and core400ms drain',()=>{
 const f=slipContent();assert.throws(()=>new BattleGame(f.content,1),/periodic number consumer/);
 const {b}=setup(true,createWebBattlePeriodicNumberHost());until(b,()=>b.periodicNumbers.length===1);const first=b.periodicNumbers[0]!,hp=b.players[0]!.hp;
 b.advance(10000);assert.equal(b.players[0]!.hp,hp);assert.equal(b.periodicNumbers[0]!.elapsed,0);assert.equal(b.periodicNumbers[0]!.consumption,null);
 const {elapsed,duration,consumption,...request}=first;assert.throws(()=>b.acknowledgePeriodicNumberDraw({...request,amount:request.amount+1}),/Stale/);b.acknowledgePeriodicNumberDraw(request);b.advance(390);assert.equal(b.periodicNumbers.length,1);b.advance(10);assert.equal(b.periodicNumbers.length,0);assert.equal(b.slipClockState('a')[0]!.first,false);
});
test('controlled consumer records actual ticket/epoch/unit/condition with no pixels and identical400ms clock',()=>{
 const {b,requests,source}=setup();until(b,()=>requests.length===1);assert.equal(requests[0]!.unitId,'a');assert.equal(requests[0]!.conditionId,source.conditionId);assert(requests[0]!.epoch>0);assert.equal(b.periodicNumbers[0]!.consumption,null);
 b.advance(10);assert.equal(b.periodicNumbers[0]!.consumption,'controlled-request-consumed');assert.equal(b.periodicNumbers[0]!.elapsed,10);b.advance(390);assert.equal(b.periodicNumbers.length,0);
});
test('actual player constructor uses Vitality and enemy factory uses Level; side spoof is rejected',()=>{
 const f=slipContent();f.content.players[0]!.vitality=1;f.content.players[0]!.level=90;f.content.enemies[0]!.conditionIds=[f.source.conditionId];f.content.enemies[0]!.level=1;f.content.enemies[0]!.vitality=90;
 const r:Readonly<BattlePeriodicNumberRequest>[]=[];const b=new BattleGame(f.content,314,undefined,undefined,undefined,undefined,undefined,undefined,{periodicNumbers:createControlledBattlePeriodicNumberHost(x=>r.push(x))});until(b,()=>r.length===2);assert.equal(r.find(x=>x.unitId==='a')!.amount,1);assert(r.find(x=>x.unitId==='e1')!.amount<=11);
 const owner=b.players[0]!,before=state(b);owner.side='enemy';assert.throws(()=>b.advance(10),/parameter class/);owner.side='player';assert.deepEqual(state(b),before);
});
test('provider prepare/commit/late validation failure rolls HP/RNG/clock/time and revokes candidate leases',()=>{
 for(const stage of ['prepare','commit','validate']as const){let fail=true,committed=false,discarded=0;const base=createControlledBattlePeriodicNumberHost(()=>{}),host:BattlePeriodicNumberHost={policy:WEB_BATTLE_PERIODIC_NUMBERS,prepare(r){if(fail&&stage==='prepare')throw Error('authored prepare');const lease=base.prepare(r);return{...lease,commit(){if(fail&&stage==='commit')throw Error('authored commit');lease.commit();committed=true;},validate(){lease.validate();if(fail&&committed&&stage==='validate')throw Error('authored validate');},discard(){discarded++;lease.discard();}};}};
  const {b}=setup(true,host);let before=state(b),threw=false;for(let i=0;i<1000&&!threw;i++){before=state(b);try{b.advance(10);}catch(error){assert.match(String(error),/authored/);threw=true;}}assert(threw);assert.deepEqual(state(b),before);if(stage!=='prepare')assert.equal(discarded,1);fail=false;committed=false;b.advance(0);assert.equal(b.periodicNumbers.length,1);assert(b.players[0]!.hp<before.units[0]!.hp);
 }
});
test('periodic lethal HP uses common life/drop owner without manufacturing a Final parent or received-hit AI',()=>{
 const {b,source}=setup();b.players[0]!.hp=1;const ai=b.enemies.map(c=>b.enemyAIState(c.id));until(b,()=>b.players[0]!.hp===0);assert(b.conditions.isUnableFight(b.players[0]!.conditionIds));assert(!b.players[0]!.conditionIds.includes(source.conditionId));assert.deepEqual(b.slipClockState('a'),[]);assert.deepEqual(b.enemies.map(c=>b.enemyAIState(c.id)),ai);assert(!b.pendingActions.some(a=>a.kind==='final'));assert.equal(b.periodicNumbers.length,1);
});
test('same instance cure/reapply resets first clock; detached projections cannot authorize completion',()=>{
 const {b,source}=setup();b.advance(400);const before=b.slipClockState('a')[0]!;b.players[1]!.atb=100;assert(b.command('b',902,'a'));until(b,()=>Boolean(b.action?.source.id===902&&b.action.resolved));assert.deepEqual(b.slipClockState('a'),[]);until(b,()=>!b.action);b.players[1]!.atb=100;assert(b.command('b',901,'a'));until(b,()=>Boolean(b.action?.source.id===901&&b.action.resolved));assert(b.players[0]!.conditionIds.includes(source.conditionId));assert(b.slipClockState('a')[0]!.first);assert(b.slipClockState('a')[0]!.elapsedSeconds<before.elapsedSeconds);
});
test('retirement cancels all old leases and old draw cannot touch a same-source new battle epoch',()=>{
 const f=setup(true,createWebBattlePeriodicNumberHost());until(f.b,()=>f.b.periodicNumbers.length===1);const {elapsed,duration,consumption,...request}=f.b.periodicNumbers[0]!;f.b.prepareEventRetirement().commit();assert.throws(()=>f.b.acknowledgePeriodicNumberDraw(request),/Retired/);const next=setup(true,createWebBattlePeriodicNumberHost());until(next.b,()=>next.b.periodicNumbers.length===1);assert.notEqual(next.b.periodicNumbers[0]!.epoch,request.epoch);assert.throws(()=>next.b.acknowledgePeriodicNumberDraw(request),/Stale/);
});

test('Stop Start/Remove writes then-current type407 function; later new instance never inherits presence',async()=>{
 const {stopConditionContent}=await import('./fixtures/stop-condition.js');const {slipSource}=await import('./fixtures/slip-condition.js');
 for(const beforeStop of [true,false]){
  const {content}=stopConditionContent(),f=slipSource();f.ability.id='909';f.tables['content.csv']![0]!.type_value='909';
  const cc=f.compile().catalog;content.conditions.rules.definitions.push(...cc.rules.definitions.filter(c=>c.id===f.conditionId));content.conditions.behaviors.push(...cc.behaviors.filter(c=>c.id===f.conditionId));
  content.conditions.rules.eraseRules.push(...cc.rules.eraseRules.filter(c=>c.groupId===6).map((r,i)=>({...r,id:50000+i})));
  content.abilities[909]=f.compileAbility().abilities[909]!;content.players[1]!.abilities.push(909);content.commands[100]!.abilityIds.push(909);
  content.battleEvents={conditions:content.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  const b=new BattleGame(content,314,undefined,undefined,undefined,undefined,undefined,undefined,{periodicNumbers:createControlledBattlePeriodicNumberHost(()=>{})});
  const cast=(id:number)=>{until(b,()=>!b.action);b.players[1]!.atb=100;assert(b.command('b',id,'a'));until(b,()=>Boolean(b.action?.source.id===id&&b.action.resolved));};
  if(beforeStop)cast(909);cast(901);if(!beforeStop)cast(909);const c=b.slipClockState('a')[0]!;assert.equal(c.isTimeStop,beforeStop);
  b.advance(100);assert.equal(b.slipClockState('a')[0]!.elapsedSeconds===c.elapsedSeconds,beforeStop);
  cast(902);assert.equal(b.slipClockState('a')[0]!.isTimeStop,false);const elapsed=b.slipClockState('a')[0]!.elapsedSeconds;b.advance(10);assert(b.slipClockState('a')[0]!.elapsedSeconds>elapsed);
 }
});

test('failed-frame reservation never reuses an externally captured request on retry: public old draw is rejected',()=>{
 let fail=true,committed=false;const captured:Readonly<BattlePeriodicNumberRequest>[]=[],base=createWebBattlePeriodicNumberHost(),host:BattlePeriodicNumberHost={policy:WEB_BATTLE_PERIODIC_NUMBERS,prepare(request){captured.push(request);const lease=base.prepare(request);return{...lease,commit(){lease.commit();committed=true;},validate(){lease.validate();if(fail&&committed)throw Error('authored late request failure');}};}};
 const {b}=setup(true,host);for(let i=0;i<300;i++)b.advance(10);const before=state(b);assert.throws(()=>b.advance(10),/authored late request failure/);assert.deepEqual(state(b),before);const failed=captured[0]!;
 fail=false;committed=false;b.advance(0);assert.equal(captured.length,2);const current=captured[1]!;assert.notEqual(current.ticket,failed.ticket);assert.equal(current.epoch,failed.epoch);assert.equal(current.amount,failed.amount);assert.throws(()=>b.acknowledgePeriodicNumberDraw(failed),/Stale/);assert.equal(b.periodicNumbers[0]!.consumption,null);
 b.advance(10);assert.equal(b.periodicNumbers[0]!.consumption,null);b.acknowledgePeriodicNumberDraw(current);b.advance(10);assert.equal(b.periodicNumbers[0]!.consumption,'drawn');
});
test('two concurrent periodic deaths drain actual separate numbers before defeat, with no manufactured Final or actions',()=>{
 const f=slipContent();for(const p of f.content.players){p.conditionIds=[f.source.conditionId];p.hp=1;}const requests:Readonly<BattlePeriodicNumberRequest>[]=[];
 const b=new BattleGame(f.content,314,undefined,undefined,undefined,undefined,undefined,undefined,{periodicNumbers:createControlledBattlePeriodicNumberHost(r=>requests.push(r))});until(b,()=>requests.length===2);assert(b.players.every(p=>p.hp===0));assert.equal(new Set(requests.map(r=>r.ticket)).size,2);assert.equal(new Set(requests.map(r=>r.unitId)).size,2);assert.equal(b.phase,'active');assert.equal(b.finalAttackExecution.length,0);assert.equal(b.pendingActions.length,0);b.advance(400);assert.equal(b.phase,'defeat');assert.equal(b.periodicNumbers.length,0);
});
test('late same-frame action failure rolls periodic damage, source fee, RNG, action and clocks back together',()=>{
 const {b}=setup();b.advance(2600);b.players[1]!.atb=100;assert(b.command('b',901,'e1'));b.advance(400);assert.equal(b.time,3000);assert.equal(b.action?.elapsed,390);const before=state(b),advance=Reflect.get(b,'advanceEvent');Reflect.set(b,'advanceEvent',()=>{throw Error('authored shared action failure');});assert.throws(()=>b.advance(10),/authored shared action failure/);assert.deepEqual(state(b),before);Reflect.set(b,'advanceEvent',advance);b.advance(0);assert(b.action?.resolved);assert(b.players[1]!.mp<before.units[1]!.mp);assert(b.players[0]!.hp<before.units[0]!.hp);assert(b.periodicNumbers.length);
});
