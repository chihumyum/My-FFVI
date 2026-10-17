import test from 'node:test';import assert from 'node:assert/strict';
import {canonical} from '../dist/src/compiler/content.js';
import {flatEffectCatalog} from '../dist/tests/fixtures/flat-field-effects.js';
import {createFrameworkFieldEffectFlatAddition,parseFrameworkFieldEffectFlatAddition,comparableFrameworkFieldEffectFlatAddition} from './framework-field-effect-flat-evidence.mjs';
function fixture(){const f=flatEffectCatalog(),profile={kind:'framework-development-v1',sourceContentHash:f.binding.ref.sourceMapHash,logicalFieldEffects:'web-logical-all-loop-field-effects-v1'},map={identity:{mapId:1,areaId:1},groups:{entity_default:{name:'entity_default',entities:[structuredClone(f.binding.entity)],blockers:[]}},entities:[structuredClone(f.binding.entity)]},
 before={kind:'world-map-development',contentHash:'1'.repeat(64),sourceSetHash:f.projection.sourceSetHash,parentSourceSetHash:f.projection.parentSourceSetHash,mapId:1,developmentProfile:profile,fieldEffects:f.strictLogicalCatalog,map},
 after={...structuredClone(before),contentHash:'2'.repeat(64),developmentProfile:{...profile,fieldEffectProjection:f.projection.kind},fieldEffects:f.catalog},
 assessment={contentHash:'3'.repeat(64),projection:f.projection},proof=createFrameworkFieldEffectFlatAddition({compilerDigest:'4'.repeat(64),assessment,catalog:{sourceSetHash:f.projection.sourceSetHash,contentHash:'5'.repeat(64)},entry:{contentHash:'6'.repeat(64)}}),
 originalEvidence=structuredClone({sourceMap:{...structuredClone(before),contentHash:f.binding.ref.sourceMapHash},logical:f.strictLogicalCatalog,catalog:f.catalog,assessment}),evidence=async()=>structuredClone(originalEvidence);return{f,before,after,proof,evidence};}
test('exact independent addition only projects catalog/marker in a detached comparison; real source identity remains intact',async()=>{
 const f=fixture(),before=canonical(f.before),after=canonical(f.after),result=await comparableFrameworkFieldEffectFlatAddition({...f,canonical});
 assert.equal(canonical(result.after.fieldEffects),canonical(f.before.fieldEffects));assert.equal(result.after.developmentProfile.fieldEffectProjection,undefined);assert(result.addition);assert.equal(result.addition.derived,1);assert.equal(canonical(f.before),before);assert.equal(canonical(f.after),after);
});
test('source coordinates/definition, removed/duplicate members, old catalog replacement and missing proof reject',async()=>{
 for(const change of [v=>v.after.map.groups.entity_default.entities[0].x=999,v=>v.before.map.groups.entity_default.entities[0].x=999,v=>v.before.map.groups.entity_default.entities=[],v=>v.after.map.groups.entity_default.entities[0].effect.assetId=999,v=>v.after.map.groups.entity_default.entities=[],v=>v.after.map.groups.entity_default.entities.push(structuredClone(v.after.map.groups.entity_default.entities[0])),v=>v.after.fieldEffects.webPolicy.boardProjection.bindings=[],v=>v.before.fieldEffects.media.controlled_effect.particles[0].loop=false,v=>v.proof=undefined]){
  const f=fixture();change(f);await assert.rejects(comparableFrameworkFieldEffectFlatAddition({...f,canonical}));
 }
});
test('partial whole-source declaration, malformed literal, getters and sparse arrays never become evidence',()=>{
 for(const change of [p=>p.kind='unknown',p=>p.maps=[],p=>p.maps.push(structuredClone(p.maps[0])),p=>{p.maps.length=2;},p=>Object.defineProperty(p,'reason',{get(){throw Error('getter must not execute');},enumerable:true})]){
  const f=fixture(),proof=structuredClone(f.proof);change(proof);assert.throws(()=>parseFrameworkFieldEffectFlatAddition(proof));
 }
});

test('new projection composes with a separately audited initial logical catalog addition, without rewriting the old catalog',async()=>{
 const f=fixture();delete f.before.developmentProfile.logicalFieldEffects;f.before.fieldEffects={media:{}};
 const before=canonical(f.before),after=canonical(f.after),r=await comparableFrameworkFieldEffectFlatAddition({...f,canonical});
 assert.deepEqual(r.after.fieldEffects,f.f.strictLogicalCatalog);assert.equal(r.after.developmentProfile.logicalFieldEffects,'web-logical-all-loop-field-effects-v1');
 assert.equal(r.after.developmentProfile.fieldEffectProjection,undefined);assert.equal(canonical(f.before),before);assert.equal(canonical(f.after),after);
 const forged=fixture();delete forged.before.developmentProfile.logicalFieldEffects;
 await assert.rejects(comparableFrameworkFieldEffectFlatAddition({...forged,canonical}));
});
