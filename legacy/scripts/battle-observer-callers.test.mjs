import assert from 'node:assert/strict';
import test from 'node:test';
import {hash,canonical} from '../dist/src/compiler/content.js';
import {immutableFieldSourceCopy} from '../dist/src/core/field-source-snapshot.js';
import {createBattleObserverCallers} from './battle-observer-callers.mjs';
const api={hash,canonical,immutableFieldSourceCopy};
const program=(value=1)=>({kind:'battle-event-v1',instructions:[{op:{kind:'wait',seconds:value}}],initialLocals:[],localNames:[],entry:0,end:1,blockers:[]});
function input(){const p=program();return {systems:{map:{mapId:99,scripts:{init:[]},scriptPuppetContexts:{init:{characteristics:true}},scriptTransitionMetadata:{},scriptLocals:{}},catalog:{maps:{99:{contentHash:'old'}}},battle:{encounters:{7:{lifecycle:{kind:'battle-lifecycle-v1',mode:'automatic'}}},common:{battleEntry:{maps:[{id:99,qualification:'exact'}]}}}},familyCatalog:{encounters:{1:{lifecycle:{kind:'battle-lifecycle-v1',mode:'script',program:p,scriptId:12}},2:{lifecycle:{kind:'battle-lifecycle-v1',mode:'script',program:p,scriptId:12}}},common:{battleEntry:{maps:[]}}},familyDirectory:{report:{entries:[{partyId:3,status:'blocked'}]},diagnostics:[{partyId:3,reason:'unknown source phase'}]},sourceEntry:{id:'source'},sourceBattle:{id:'battle'},sourceMap:{id:'map'},branchExecution:undefined};}
test('caller grouping preserves actual operands; qualified directory alone is shared',()=>{
 const owners=createBattleObserverCallers(api,input()),a=owners.prepare(program()),b=owners.prepare(program(2)),x=owners.prepare(program(),1),y=owners.prepare(program(),2);
 assert.equal(a.map,b.map);assert.equal(a.world,b.world);assert.notEqual(a.battle,b.battle);
 assert.equal(a.map.scripts[a.script][0].party,7);
 assert.equal(x.battle,y.battle);assert.notEqual(x.map,y.map);assert.equal(x.map.scripts[x.script][0].party,1);assert.equal(y.map.scripts[y.script][0].party,2);
 assert.equal(x.battle.encounters[1].lifecycle.scriptId,12);assert.deepEqual(x.battle.common.battleEntry.maps,[{id:99,qualification:'exact'}]);
 assert.deepEqual(owners.stats(),{requests:4,controlledRequests:2,originalPartyRequests:2,callerGroups:3,callerGroupHits:1,qualifiedBattleBuilds:1});
});
test('each cached original-party row retains source/program gates and its own error',()=>{
 const owners=createBattleObserverCallers(api,input());owners.prepare(program(),1);
 assert.throws(()=>owners.prepare(program(2),1),/Original source lifecycle\/program binding differs/);
 for(let n=0;n<2;n++)assert.throws(()=>owners.prepare(program(),3),/unknown source phase/);
 assert.equal(owners.stats().requests,4);assert.equal(owners.stats().qualifiedBattleBuilds,1);assert.equal(owners.stats().callerGroups,1);
 assert.equal(owners.prepare(program(),1).battle.encounters[1].lifecycle.scriptId,12);
});
test('definition ownership never freezes callers or leaks writable cached state',()=>{
 const source=input(),owners=createBattleObserverCallers(api,source);source.systems.map.mapId=123;source.familyCatalog.encounters[1].lifecycle.scriptId=44;
 assert.equal(Object.isFrozen(source),false);
 const a=owners.prepare(program(),1);assert.equal(a.map.mapId,99);assert.equal(a.battle.encounters[1].lifecycle.scriptId,12);
 assert.throws(()=>{a.map.scripts[a.script][0].party=2;},TypeError);
 assert.throws(()=>{a.battle.encounters[1].lifecycle.scriptId=44;},TypeError);
 assert.equal(owners.prepare(program(),1).map.scripts[a.script][0].party,1);
});
test('same external program identity after mutation produces a new real definition',()=>{
 const owners=createBattleObserverCallers(api,input()),p=program(),a=owners.prepare(p);
 p.instructions[0].op.seconds=4;const b=owners.prepare(p);
 assert.equal(Object.isFrozen(p),false);assert.equal(a.battle.encounters[7].lifecycle.program.instructions[0].op.seconds,1);
 assert.equal(b.battle.encounters[7].lifecycle.program.instructions[0].op.seconds,4);assert.notEqual(a.battle.contentHash,b.battle.contentHash);
});
test('a failed row is never cached as completion or used to suppress retry',()=>{
 const owners=createBattleObserverCallers(api,input());assert.throws(()=>owners.prepare(program(4),1));
 assert.equal(owners.stats().callerGroups,0);assert.equal(owners.stats().qualifiedBattleBuilds,0);
 const value=owners.prepare(program(),1);assert.equal(value.battle.encounters[1].lifecycle.scriptId,12);assert.equal(owners.stats().requests,2);
});
test('opaque runtime hosts cannot enter the definition snapshot',()=>{
 const source=input();source.host={commit:()=>true};assert.throws(()=>createBattleObserverCallers(api,source),/non-data value/);
 const owners=createBattleObserverCallers(api,input()),p=program();p.instructions[0].op.extra=new Map();assert.throws(()=>owners.prepare(p),/plain records/);
});
