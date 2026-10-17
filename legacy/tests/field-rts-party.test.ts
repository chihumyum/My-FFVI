import assert from'node:assert/strict';
import test from'node:test';
import {compileRtsPartyInstruction,sourceRtsPartySelectors,compileRtsPartyCatalog}from'../src/compiler/field-rts-party.js';
import {rtsNextSlot,rtsMapScript,rtsCapturedCoordinate,rtsLinearRatio,validateRtsCatalog,WEB_RTS_PARTY_SWITCH,type SourceRtsPartyCatalog}from'../src/core/field-rts-party.js';
import {GameState}from'../src/core/game-state.js';
import {rosterGroupsSessionFixture}from'./fixtures/roster-groups-session.js';

function catalog():SourceRtsPartyCatalog{return{kind:'source-rts-party-v1',policy:WEB_RTS_PARTY_SWITCH,
 nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',miscHash:'b'.repeat(64),stayMapIndices:[11,12,13],memberLimit:4,afterScript:'sc_sht_corps_after',
 talk:{scriptId:1,script:'authored-talk',source:{file:'authored',assetPath:'script.csv#1'}},maps:[{id:901,mapName:'Map_Authored',source:{file:'authored',assetPath:'map.csv#901'}}]};}
const raw=(selector:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}});

test('all six RTS wrappers require exact source banks and preserve their distinct shared commands',()=>{
 for(const[selector,command]of Object.entries(sourceRtsPartySelectors)){
  assert.deepEqual(compileRtsPartyInstruction(raw(selector)),{kind:'rts-party',command});
  for(const field of['iValues','rValues','sValues']as const){const bad=raw(selector);bad.operands[field][7]=field==='sValues'?'unknown':1;assert.throws(()=>compileRtsPartyInstruction(bad),/reserved/);}
  const missing=raw(selector);missing.operands.iValues.length=7;assert.throws(()=>compileRtsPartyInstruction(missing),/operand bank/);
  assert.throws(()=>compileRtsPartyInstruction({...raw(selector),type:2}),/Unsupported/);
 }
});
test('verified stay-map indices and the concrete Map name remain distinct from source map IDs and script IDs',()=>{
 const c=catalog();validateRtsCatalog(c);assert.equal(rtsMapScript(c,901),'sc_map_authored');assert.throws(()=>rtsMapScript(c,11),/unknown/);
 for(const mutate of[(x:SourceRtsPartyCatalog)=>{x.stayMapIndices.reverse();},(x:SourceRtsPartyCatalog)=>{x.maps.push(structuredClone(x.maps[0]!));},(x:SourceRtsPartyCatalog)=>{x.nativeSha256='0'.repeat(64);}]){
  const bad=structuredClone(c);mutate(bad);assert.throws(()=>validateRtsCatalog(bad));
 }
 assert.deepEqual([rtsNextSlot(0,3),rtsNextSlot(1,3),rtsNextSlot(2,3)],[1,2,0]);assert.throws(()=>rtsNextSlot(2,2));assert.throws(()=>rtsNextSlot(0,0));
 assert.equal(rtsCapturedCoordinate(-12.8),-12);assert.equal(rtsLinearRatio(7,7),0);assert(rtsLinearRatio(7.7,7)>0.49);assert.equal(rtsLinearRatio(9,7),1);
});
test('permanent selection uses the same owned generation, preserves all held identity/loadout data and rejects failed/stale publication',()=>{
 const f=rosterGroupsSessionFixture(),content=structuredClone(f.battle.gameState);content.sourceRtsParty=catalog();
 const state=GameState.createNewGame(content,f.battle.common.players,'a'.repeat(64),f.battle.common.conditions);
 state.fieldRoster.prepareGroup!({kind:'join',group:'moogles'}).commitWith(check=>check());
 const before=state.snapshot(),tx=state.fieldRtsParty.prepare(1);assert.equal(tx.before.selectedSlot,0);assert.equal(tx.after.selectedSlot,1);assert.deepEqual(state.snapshot(),before);
 assert.throws(()=>tx.commitWith(()=>{throw Error('Controlled RTS publication failure');}),/publication failure/);assert.deepEqual(state.snapshot(),before);
 tx.commitWith(check=>{check();assert.throws(()=>state.fieldRoster.prepare({kind:'unlock',sourceId:3,refreshActors:false}).commit(),/publication/);});
 const after=state.snapshot();assert.equal(after.party.selectedSlot,1);const stripped=structuredClone(after);stripped.party.selectedSlot=before.party.selectedSlot;assert.deepEqual(stripped,before);
 assert.throws(()=>tx.commitWith(check=>check()),/Stale/);
 const draft=state.prepareFieldState(),old=draft.ports.rtsParty.prepare(2);draft.ports.rtsParty.prepare(0).commitWith(check=>check());assert.throws(()=>old.commitWith(check=>check()),/Stale/);assert.deepEqual(state.snapshot(),after);
 const restored=GameState.createNewGame(content,f.battle.common.players,'a'.repeat(64),f.battle.common.conditions);restored.restore(JSON.parse(JSON.stringify(after)));assert.deepEqual(restored.snapshot(),after);
});
test('saved values and a missing source catalog cannot grant the permanent RTS provider',()=>{
 const f=rosterGroupsSessionFixture(),state=GameState.createNewGame(f.battle.gameState,f.battle.common.players,'a'.repeat(64),f.battle.common.conditions);
 assert.throws(()=>state.fieldRtsParty.read(),/catalog is unavailable/);assert.throws(()=>state.fieldRtsParty.prepare(0),/catalog is unavailable/);
 const forged=structuredClone(state.snapshot());Object.assign(forged,{sourceRtsParty:catalog()});assert.throws(()=>state.restore(forged));
});

test('same-build missing Misc talk field uses its verified constructor initializer; explicit source values still resolve by complete physical row',()=>{
 const reads:[string,string|number][]=[],source={file:'authored',assetPath:'master',objectId:'1',serializedFile:'authored-master',rowId:'1'};const reader={row:(table:string,id:string|number)=>{reads.push([table,id]);return{values:table==='script.csv'?{id:String(id),script_name:'authored-script-'+id}:{id:String(id),map_name:'Map_Authored'},source};}};
 const tables={'map.csv':[{id:'901'}]};assert.equal(compileRtsPartyCatalog(reader,tables,{}).talk.scriptId,5003);assert.equal(compileRtsPartyCatalog(reader,tables,{rtsmode_resident_talk_script:5010}).talk.script,'authored-script-5010');
 for(const value of[null,undefined,0,-1,1.5,'5003',true])assert.throws(()=>compileRtsPartyCatalog(reader,tables,{rtsmode_resident_talk_script:value}),/identity/);assert(reads.some(([table,id])=>table==='script.csv'&&id===5003));
});
