import test from 'node:test';import assert from 'node:assert/strict';
import {collectVisibilityCohort}from'./visibility-cohort.mjs';
const hash=value=>JSON.stringify(value),script=(id,ops)=>({id,kind:'script',source:{file:id,assetPath:id},data:{Name:id,Mnemonics:ops.map(mnemonic=>({mnemonic}))}});
const decodeFieldOp=raw=>raw.mnemonic==='Hide'?{kind:'actor-visibility',visible:false,timing:{durationSeconds:.5,delaySeconds:0}}:
 raw.mnemonic==='Exit'?{kind:'exit'}:{kind:'blocked',mnemonic:raw.mnemonic,reason:'Unassessed source instruction'};
function setup(){const assets=[script('A',['Hide','Exit']),script('B',['Other','Exit']),script('Unused',['ShowMob'])];return{
 corpus:{assets,tables:{},sourceSetHash:'source',manifest:{parentSourceSetHash:'parent'}},messages:{},hash,decodeFieldOp,
 analysis:{scripts:[{id:'A',maps:['1','2']},{id:'B',maps:['1']},{id:'Unused',maps:[]}],counts:{scripts:3,instructions:5},contentHash:'analysis',
 dependencies:[{kind:'script',site:{asset:'A',index:0},mapId:'1',resolved:true,candidates:['B']}]}};}
test('whole dependency body and each physical map namespace remain distinct',()=>{const input=setup(),before=structuredClone(input.corpus),value=collectVisibilityCohort(input);
 assert.equal(value.roots.length,2);assert.deepEqual(value.onlyFamily.map(row=>row.mapId),['2']);
 assert.deepEqual(value.roots[0].closure,['A','B']);assert.equal(value.roots[0].instructions,4);assert.equal(value.roots[0].otherBlocked.length,1);
 assert.equal(value.sites.length,2);assert.equal(value.sites.find(row=>row.id==='Unused').maps.length,0);assert.deepEqual(input.corpus,before);});
test('unresolved external edge is retained rather than treated as a complete body',()=>{const input=setup();input.analysis.dependencies=[{kind:'script',site:{asset:'A',index:0},mapId:'2',resolved:false,candidates:[]}];
 const value=collectVisibilityCohort(input);assert.deepEqual(value.onlyFamily.map(row=>row.mapId),['1']);assert.equal(value.roots[1].unresolved.length,1);});
test('decoder failure remains an explicit family blocker and cannot remove its original program',()=>{const input=setup();input.decodeFieldOp=raw=>{if(raw.mnemonic==='Hide')throw Error('Malformed ABI');return decodeFieldOp(raw);};
 const value=collectVisibilityCohort(input);assert.equal(value.sites[0].decoded.kind,'blocked');assert.match(value.sites[0].decoded.reason,/Malformed ABI/);
 assert.equal(value.onlyFamily.length,1);assert.equal(value.onlyFamily[0].blocked.length,1);assert.equal(value.onlyFamily[0].instructions,2);});
