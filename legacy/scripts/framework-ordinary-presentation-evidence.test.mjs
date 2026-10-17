import test from 'node:test';import assert from 'node:assert/strict';
import {createFrameworkOrdinaryPresentationAddition,parseFrameworkOrdinaryPresentationAddition,comparableFrameworkOrdinaryPresentationAddition} from './framework-ordinary-presentation-evidence.mjs';
import {ordinaryPresentationFixture} from '../dist/tests/fixtures/ordinary-presentation.js';
import {compileFrameworkContent} from '../dist/src/compiler/framework-content.js';
import {canonical,hash} from '../dist/src/compiler/content.js';
import {verifyContent} from '../dist/src/core/content-integrity.js';
const H='a'.repeat(64),seal=v=>{const{contentHash:_,...body}=v;return{...body,contentHash:hash(body)}};
async function fixture(){
 const f=await ordinaryPresentationFixture(),base=compileFrameworkContent(f.catalog,[f.strict],f.entry),
  derived=compileFrameworkContent(f.catalog,[f.strict],f.entry,{ordinaryPresentations:[f.assessment]}),
  proof=createFrameworkOrdinaryPresentationAddition({compilerDigest:H,assessments:[f.assessment],strictWorld:f.catalog,catalog:derived.catalog,entry:derived.entry}),
  evidence=async(p,id=null)=>{assert.deepEqual(p,proof);return id===null?{ordinaryMaps:1}:{sourceMap:f.strict,assessment:f.assessment};};
 return{...f,before:base.maps[0],after:derived.maps[0],proof,evidence,canonical,verifyContent};
}
test('ordinary source proof changes only the detached exact alternative/marker comparison',async()=>{
 const f=await fixture(),before=canonical({before:f.before,after:f.after}),r=await comparableFrameworkOrdinaryPresentationAddition(f);
 assert.equal(r.after.frameworkPresentation,undefined);assert.equal(r.after.developmentProfile.fieldPresentation,undefined);
 assert.deepEqual(r.after.map,f.before.map);assert.deepEqual(r.after.scripts,f.before.scripts);
 assert.equal(canonical({before:f.before,after:f.after}),before);assert.equal(r.addition.ordinaryMaps,1);assert.equal(r.addition.runtimeAdmission,'unassessed');
});
test('a periodic marker alone cannot prove a newly added ordinary alternative',async()=>{
 const f=await fixture();await assert.rejects(comparableFrameworkOrdinaryPresentationAddition({...f,proof:null}),/independent complete source proof/);
 const markerOnly=seal({...structuredClone(f.before),developmentProfile:f.after.developmentProfile});
 const r=await comparableFrameworkOrdinaryPresentationAddition({...f,after:markerOnly,proof:null});
 assert.equal(r.addition,null);assert.deepEqual(r.after,markerOnly,'Old marker-only proof must remain visible to its existing exact owner');
});
test('foreign/removed/modified geometry, applicability and diagnostics are never display normalization',async()=>{
 for(const mutate of [v=>v.map.width=999,v=>v.map.layers[0].data.pop(),v=>v.partyEntry.mapRange.width--,
  v=>v.nativeFoot.source.objectId='9007199254740993',v=>v.actorViewBlockers=[],v=>v.cameraHost.loop.horizontal=true]){
  const f=await fixture(),after=structuredClone(f.after);mutate(after);
  await assert.rejects(comparableFrameworkOrdinaryPresentationAddition({...f,after:seal(after)}),/original source geometry|original source applicability|original map\/entity\/collision body/);
 }
});
test('display proof cannot hide original actor positions, collision or script changes',async()=>{
 for(const mutate of [v=>v.map.groups.entity_default.entities[0].x++,v=>v.map.collisions[Object.keys(v.map.collisions)[0]][0]=99,
  v=>v.scripts.fallback[0]={...v.scripts.fallback[0],kind:'exit'},v=>v.nativeFootBlockers=[{reason:'foreign',source:v.map.source}]]){
  const f=await fixture(),after=structuredClone(f.after);mutate(after);
  await assert.rejects(comparableFrameworkOrdinaryPresentationAddition({...f,after:seal(after)}),/original map\/entity\/collision|original source program|original source applicability/);
 }
});
test('unbound alternative or altered original header cannot authorize a comparison',async()=>{
 const f=await fixture(),after=structuredClone(f.after);after.frameworkPresentation.view.omissions=[];
 await assert.rejects(comparableFrameworkOrdinaryPresentationAddition({...f,after:seal(after)}),/independently compiled source/);
 const corrupt=structuredClone(f.after);corrupt.map.width=999;
 await assert.rejects(comparableFrameworkOrdinaryPresentationAddition({...f,after:corrupt}),/payload changed/);
 await assert.rejects(comparableFrameworkOrdinaryPresentationAddition({...f,evidence:undefined}),/function/);
});
test('ordinary proof parsing rejects missing, duplicate, foreign and accessor-backed metadata',async()=>{
 const f=await fixture();assert.deepEqual(parseFrameworkOrdinaryPresentationAddition(f.proof),f.proof);
 for(const mutate of [p=>p.kind='foreign',p=>p.maps.push(structuredClone(p.maps[0])),p=>p.reason='',p=>p.maps[0].assessmentHash='foreign',p=>p.extra=true]){
  const proof=structuredClone(f.proof);mutate(proof);assert.throws(()=>parseFrameworkOrdinaryPresentationAddition(proof));
 }
 const getter=structuredClone(f.proof);Object.defineProperty(getter,'reason',{enumerable:true,get(){throw Error('getter must not execute')}});
 assert.throws(()=>parseFrameworkOrdinaryPresentationAddition(getter),{code:'ERR_ASSERTION'});
});
test('intermediate comparison uses separate original sealed documents and retains unrelated fields',async()=>{
 const f=await fixture(),intermediate=structuredClone(f.after);intermediate.limitations.push('A separately audited prior comparison');
 const result=await comparableFrameworkOrdinaryPresentationAddition({...f,after:intermediate,actualAfter:f.after});
 assert.deepEqual(result.after.limitations,intermediate.limitations);assert.deepEqual(f.after.limitations,f.before.limitations);
});
