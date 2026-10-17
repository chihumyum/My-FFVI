import test from'node:test';
import assert from'node:assert/strict';
import {compileMultiCorpsInstruction,sourceMultiCorpsSelectors}from'../src/compiler/field-multi-corps.js';
import {projectMultiCorpsParty,multiCorpsPreset,multiCorpsPlacement}from'../src/core/field-multi-corps.js';
import {emptyPartyState,type PartyState}from'../src/core/party.js';
import {fieldCameraCellToWorld}from'../src/core/field-camera.js';
import {rosterGroupsSessionFixture}from'./fixtures/roster-groups-session.js';
import {GameState}from'../src/core/game-state.js';
const raw=(selector:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}});
test('all seven whole-source wrappers are strict; their coordinates and exact retained map IDs stay preset data',()=>{
 assert.equal(Object.keys(sourceMultiCorpsSelectors).length,7);
 for(const[selector,command]of Object.entries(sourceMultiCorpsSelectors)){
  assert.deepEqual(compileMultiCorpsInstruction(raw(selector)),{kind:'multi-corps',command});
  for(const name of ['iValues','rValues','sValues']as const){const bad=raw(selector);bad.operands[name][7]=name==='sValues'?'unknown':1;assert.throws(()=>compileMultiCorpsInstruction(bad),/reserved/);}
  const sparse=raw(selector);delete sparse.operands.iValues[2];assert.throws(()=>compileMultiCorpsInstruction(sparse),/bank|operand/);
  assert.throws(()=>compileMultiCorpsInstruction({...raw(selector),type:2}),/wrapper/);
 }
 assert.deepEqual(multiCorpsPreset('deploy-terra-defense'),{mapId:318,count:3,positions:[[12,13],[14,13]],cue:null});
 assert.deepEqual(multiCorpsPreset('deploy-esper-defense'),{mapId:19,count:3,positions:[[18,9],[22,9]],cue:null});
 assert.deepEqual(multiCorpsPreset('deploy-tower'),{mapId:542,count:3,positions:[[43,21],[56,22]],cue:null});
 assert.deepEqual(multiCorpsPreset('deploy-phoenix'),{mapId:497,count:2,positions:[[12,6]],cue:'Dying'});
 const map={x:0,y:0,width:100,height:90},definition={formatVersion:1 as const,kind:'map-party-entry' as const,mapId:123,width:100,height:90,mapRange:map,loopType:0,conditionColliders:[],pointIns:[{id:1,x:8,y:9,layer:2,direction:'up' as const,linkObject:0,source:{file:'authored',assetPath:'PointIn1'}}]};
 const p=multiCorpsPlacement('deploy-tower',definition,map);assert.deepEqual(p.positions[0]!.position,fieldCameraCellToWorld(map,{x:43,y:21},2));assert.deepEqual(p.positions[2],{slot:0,position:{x:0,y:-1000,z:149},layer:11,direction:null});
 assert.throws(()=>multiCorpsPlacement('deploy-tower',undefined,map),/provider/);const unknown=structuredClone(definition);unknown.pointIns.push(structuredClone(unknown.pointIns[0]!));assert.throws(()=>multiCorpsPlacement('deploy-tower',unknown,map),/ambiguous/);
});
test('dream split/rejoin preserves holes and actual owned identities, clears every old bank cell, and full-party rejoin still removes the source',()=>{
 const roster=[1,2,3,4,5].map((sourceId,i)=>({id:'owned-'+(i+90),sourceId,enabled:i!==1})),p=emptyPartyState();
 p.slots[0]=[{id:null,row:'back'},{id:roster[0]!.id,row:'back'},{id:roster[1]!.id,row:'back'},{id:roster[2]!.id,row:'front'}];p.slots[1][0].id=roster[4]!.id;p.slots[2][3].id=roster[4]!.id;
 const split=projectMultiCorpsParty(p,roster,'dream-separate');
 assert.deepEqual(split.slots.map(s=>s.map(c=>c.id)),[[null,null,null,roster[2]!.id],[null,roster[0]!.id,null,null],[null,null,roster[1]!.id,null]]);assert.equal(split.slots[1][1].row,'back');assert.deepEqual(p.slots[0][1],{id:roster[0]!.id,row:'back'});
 const same=projectMultiCorpsParty(split,roster,'dream-rejoin-first');assert.deepEqual(same.slots[0][1],p.slots[0][1]);assert.equal(same.slots[1][1].id,null);assert.equal(same.slots[1][1].row,'back');
 const occupied=structuredClone(split);occupied.slots[0][1].id=roster[3]!.id;const fallback=projectMultiCorpsParty(occupied,roster,'dream-rejoin-first');assert.deepEqual(fallback.slots[0][0],p.slots[0][1]);
 const full=structuredClone(split);full.slots[0]=roster.slice(1).map(r=>({id:r.id,row:'back'}))as PartyState['slots'][0];const lost=projectMultiCorpsParty(full,roster,'dream-rejoin-first');assert.deepEqual(lost.slots[0],full.slots[0]);assert.equal(lost.slots[1][1].id,null);
 assert.deepEqual(projectMultiCorpsParty(lost,roster,'dream-rejoin-first'),lost);
});
test('multi-Corps uses the existing GameState live/draft generation and rejects failed, repeated, stale and missing-provider publications',()=>{
 const f=rosterGroupsSessionFixture({rts:true}),state=GameState.createNewGame(f.battle.gameState,f.battle.common.players,'a'.repeat(64),f.battle.common.conditions);
 state.fieldRoster.prepareGroup!({kind:'join',group:'moogles'}).commitWith(check=>check());const before=state.snapshot(),tx=state.fieldRtsParty.prepareCorps!('dream-separate');
 assert.throws(()=>tx.commitWith(()=>{throw Error('Controlled failed presentation');}),/failed presentation/);assert.deepEqual(state.snapshot(),before);
 tx.commitWith(check=>check());assert.throws(()=>tx.commitWith(check=>check()),/Stale/);const split=state.snapshot();assert.deepEqual(split.roster,before.roster);assert.deepEqual(split.items,before.items);
 const draft=state.prepareFieldState(),stale=draft.ports.rtsParty.prepareCorps!('dream-rejoin-first');draft.ports.rtsParty.prepareCorps!('dream-rejoin-second').commitWith(check=>check());assert.throws(()=>stale.commitWith(check=>check()),/Stale/);assert.deepEqual(state.snapshot(),split);
 const no=rosterGroupsSessionFixture(),unbound=GameState.createNewGame(no.battle.gameState,no.battle.common.players,'a'.repeat(64),no.battle.common.conditions);assert.throws(()=>unbound.fieldRtsParty.prepareCorps!('dream-separate'),/catalog/);
});
