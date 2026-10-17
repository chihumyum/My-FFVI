import test from 'node:test';
import assert from 'node:assert/strict';
import {BattleGame} from '../src/core/battle.js';
import {compileBattleEventEffect} from '../src/compiler/battle-event-effect.js';
import {compileBattleEvent} from '../src/compiler/battle-event.js';
import {advanceBattleEvent,createBattleEventState,type BattleEventOp,type BattleEventProgram} from '../src/core/battle-event.js';
import {createWebBattleEventEffectHost,WEB_BATTLE_EVENT_EFFECTS,type BattleEventEffectHost} from '../src/core/battle-event-effect.js';
import {fixture} from './fixtures/battle-content.js';
import {effectRowSource as source,effectRowValues as values,effectReader as reader,effectRaw as raw,authoredBattleEffect as effect} from './fixtures/battle-event-effect.js';
const increment:BattleEventOp={kind:'calc',index:0,operator:'＋',right:{kind:'immediate',value:1}};
const program=(ops:BattleEventOp[]):BattleEventProgram=>({kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:['after'],initialLocals:[0],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]});
function content(ops:BattleEventOp[]){const c=fixture();c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=9999;c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:program([{kind:'end-enabled',enabled:false},{kind:'pause',enabled:true},...ops,{kind:'exit'}])};return c;}
function make(ops:BattleEventOp[],host=createWebBattleEventEffectHost()){return new BattleGame(content(ops),99,undefined,undefined,undefined,undefined,undefined,undefined,{effects:host});}
const snapshot=(b:BattleGame)=>({time:b.time,units:structuredClone(b.combatants),event:b.eventExecution,events:structuredClone(b.events),effects:b.effectPresentation,journal:b.effectExecution,action:structuredClone(b.action),pending:b.pendingActions,phase:b.phase});
function controlled(){let status:'loading'|'ready'|'failed'='loading',fail=false,leases=0,commits=0,cancels=0,polls=0;const host:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(){leases++;if(fail)throw Error('authored effect dependency unavailable');let used=false,cancelled=false;
 const validate=()=>{if(cancelled)throw Error('authored cancelled lease');};return {validate,status(){validate();polls++;return status;},commit(){validate();assert.equal(used,false);commits++;used=true;},discard(){if(!cancelled)cancels++;cancelled=true;}};}};
 return {host,ready(){status='ready';},failed(){status='failed';},failPrepare(){fail=true;},allowPrepare(){fail=false;},counts:()=>({leases,commits,cancels,polls})};}
test('source effect operands preserve the complete native master row; i3 nonzero is asynchronous Next, zero is synchronous Blank',()=>{
 assert.equal((effect() as any).wait,true);assert.equal((effect(1) as any).wait,false);assert.equal((effect(-1) as any).wait,false);
 assert.deepEqual((effect() as any).effect.row,values);assert.equal((effect(1,7,2) as any).target.side,'enemy');
 assert.throws(()=>compileBattleEventEffect(raw()));for(const r of [raw(0,0),raw(0,1,3),{...raw(),type:2}])assert.throws(()=>compileBattleEventEffect(r,reader));
 const missing={row:()=>({source:source('battle_effect_asset.csv',99),values:{...values,asset_name:''}})};assert.throws(()=>compileBattleEventEffect(raw(),missing),/asset/);
 const corrupt=raw();corrupt.operands.iValues[7]=1;assert.throws(()=>compileBattleEventEffect(corrupt,reader));
});
test('the VM publishes exactly one play request and joins the host global effect predicate on later clocks',()=>{
 const p=program([effect(),increment,{kind:'exit'}]),ctx={clock:0,timeSeconds:0,started:true,aiCoreAlive:false,actionStaging:false,battleEffectsFinished:true};
 const a=advanceBattleEvent(p,createBattleEventState(p),ctx);assert.equal(a.requests.length,1);assert.equal(a.state.wait?.kind,'battle-effect');assert.equal(a.state.locals[0],0);
 const b=advanceBattleEvent(p,a.state,{...ctx,clock:1,timeSeconds:.01,battleEffectsFinished:false});assert.equal(b.requests.length,0);assert.equal(b.state.locals[0],0);
 const c=advanceBattleEvent(p,b.state,{...ctx,clock:2,timeSeconds:.02});assert.equal(c.state.locals[0],1);assert.equal(c.state.status,'exited');
 const {battleEffectsFinished:_,...absent}=ctx;assert.throws(()=>advanceBattleEvent(p,b.state,{...absent,clock:2,timeSeconds:.02}),/completion/);
});
test('real BattleGame loads and presents one effect on its existing clock without any HP MP ability flag or roster result',()=>{
 const b=make([effect(),increment]),units=b.combatants.map(({atb,...unit})=>structuredClone(unit));assert.equal(b.effectPresentation.length,0);b.advance(10);assert.equal(b.effectPresentation[0]!.phase,'loading');assert.equal(b.eventExecution.state!.locals[0],0);
 b.advance(10);assert.equal(b.effectPresentation[0]!.phase,'playing');b.advance(290);assert.equal(b.eventExecution.state!.locals[0],0);b.advance(10);
 assert.equal(b.effectPresentation.length,0);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.effectExecution.filter(x=>x.action==='request').length,1);assert.deepEqual(b.combatants.map(({atb,...unit})=>unit),units);
 b.advance(200);assert.equal(b.eventExecution.state!.locals[0],1);
});
test('async requests overlap but Sync joins every loading/presenting effect and never just the last request',()=>{
 const h=controlled(),b=make([effect(1),effect(1,1001),{kind:'sync-battle-effect'},increment],h.host);b.advance(10);assert.equal(b.effectPresentation.length,2);assert.equal(h.counts().commits,2);b.advance(500);assert.equal(b.eventExecution.state!.locals[0],0);
 h.ready();b.advance(10);assert.equal(b.effectPresentation.filter(e=>e.phase==='playing').length,2);b.advance(300);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(h.counts().cancels,2);
});
test('resource preparation and later load failure roll back the whole existing battle frame and retry without duplicate requests',()=>{
 const h=controlled(),b=make([effect(),increment],h.host),before=snapshot(b);h.failPrepare();assert.throws(()=>b.advance(10),/dependency unavailable/);assert.deepEqual(snapshot(b),before);
 h.allowPrepare();b.advance(0);assert.equal(h.counts().commits,1);const loading=snapshot(b);h.failed();assert.throws(()=>b.advance(10),/preparation failed/);assert.deepEqual(snapshot(b),loading);
 h.ready();b.advance(0);b.advance(300);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(h.counts().commits,1);assert.equal(b.effectExecution.filter(e=>e.action==='request').length,1);
});
test('pause freezes the presentation and VM together; detached UI projection cannot alter the current effect',()=>{
 const b=make([effect(),increment]);b.advance(20);const projected=b.effectPresentation as any[];projected[0].targetInstanceIds=['forged'];projected[0].elapsed=100000;
 const before=snapshot(b);b.setClockInput({paused:true,helpPaused:false,progressEnabled:true,uiWaiting:false,forceWaiting:false});b.advance(1000);assert.deepEqual(snapshot(b),before);
 b.setClockInput({paused:false,helpPaused:false,progressEnabled:true,uiWaiting:false,forceWaiting:false});b.advance(300);assert.equal(b.eventExecution.state!.locals[0],1);
});
test('retirement cancels outstanding resource leases; late old readiness cannot publish to a fresh battle or resume the retired VM',()=>{
 const h=controlled(),old=make([effect(),increment],h.host);old.advance(10);const retirement=old.prepareEventRetirement();retirement.validate();retirement.commit();assert.equal(h.counts().cancels,1);assert.equal(old.effectPresentation.length,0);
 const fresh=make([effect(),increment],h.host);fresh.advance(10);const before=snapshot(fresh);h.ready();assert.throws(()=>old.advance(10),/Retired/);assert.deepEqual(snapshot(fresh),before);
 fresh.advance(310);assert.equal(fresh.eventExecution.state!.locals[0],1);assert.equal(fresh.effectExecution.filter(e=>e.action==='request').length,1);
});
test('a removed/replaced source target cannot redirect a loading effect to the instance with the same visible identity',()=>{
 const b=make([effect(),increment]);b.advance(10);const target=b.combatants[0]!,before=snapshot(b);b.combatants[0]={...target};assert.throws(()=>b.advance(10),/target instance/);assert.equal(b.effectPresentation[0]!.phase,'loading');b.combatants[0]=target;
 assert.deepEqual(snapshot(b),before);b.advance(310);assert.equal(b.eventExecution.state!.locals[0],1);
});
test('the explicit Web resource policy and exact current target are required; a parsed source effect cannot grant them',()=>{
 assert.throws(()=>new BattleGame(content([effect(),increment]),99),/explicit Web/);const b=make([effect(0,999),increment]);assert.throws(()=>b.advance(10),/absent|ambiguous/);assert.equal(b.effectPresentation.length,0);
});
test('failure while committing a group of newly prepared resources cancels all candidates and rolls back the one frame before retry',()=>{
 let fail=true,created=0,cancelled=0;const base=createWebBattleEventEffectHost(),host:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const resource=base.prepare(request),number=++created;return {...resource,commit(){if(fail&&number===2)throw Error('authored late resource publication failure');resource.commit();},discard(){cancelled++;resource.discard();}};}};
 const b=make([effect(1),effect(1,1001),{kind:'sync-battle-effect'},increment],host),before=snapshot(b);assert.throws(()=>b.advance(10),/late resource publication/);assert.deepEqual(snapshot(b),before);assert.equal(cancelled,2);
 fail=false;b.advance(0);b.advance(310);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.effectExecution.filter(e=>e.action==='request').length,2);
});
test('global effect Sync remains joined after its pulse ends while the existing forced action presentation is still active',()=>{
 const c=content([effect(1),{kind:'script-action',actor:{side:'player',id:1000},target:{side:'enemy',id:1},sourceActorKind:1,sourceTargetKind:2,abilityId:10,asynchronous:true},{kind:'sync-battle-effect'},increment]);
 const b=new BattleGame(c,99,undefined,undefined,undefined,undefined,undefined,undefined,{effects:createWebBattleEventEffectHost(),scriptedActions:'web-source-scripted-battle-actions-v1'});
 b.advance(400);assert.equal(b.effectPresentation.length,0);assert.ok(b.action);assert.equal(b.eventExecution.state!.locals[0],0);
 b.advance(1000);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.action,null);
});
