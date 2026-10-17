import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonical,hash} from '../src/compiler/content.js';
const root=process.cwd(),compiledDir=fileURLToPath(new URL('../',import.meta.url));
const script=(name:string)=>import(pathToFileURL(resolve(root,'scripts',name+'.mjs')).href);
const marker='web-source-logical-board-transforms-v1';
async function fixture(){
 const {movableFieldEffectsFixture}=await import(pathToFileURL(resolve(compiledDir,'tests/fixtures/movable-field-effects.js')).href),f=await movableFieldEffectsFixture({birdview:true});
 const base=structuredClone(f.catalog);delete base.boardTransforms;
 const logical=structuredClone(f.fx.catalog),flatBody={kind:'framework-field-effect-flat-assessment-v1',projection:base.webPolicy.boardProjection},flatAssessment={...flatBody,contentHash:hash(flatBody)},body={kind:'framework-field-effect-transform-assessment-v1',projection:f.policy},assessment={...body,contentHash:hash(body)};
 return{...f,base,logical,flatAssessment,assessment,catalogHash:hash(f.catalog)};
}
test('production entrypoints reject unknown board policies and marker-only or undeclared catalog inputs before source IO',async()=>{
 const a=await script('compile-source-prerequisites'),b=await script('content-package-pipeline'),c=await script('build-initialized-content-batch');
 for(const run of[()=>a.captureSourcePrerequisiteInputs({root:'/not-a-source',fieldEffectTransforms:'unknown'}),()=>a.compileSourcePrerequisites({root:'/not-a-source',fieldEffectTransforms:'unknown'}),()=>b.compileSharedContentPackages({root:'/not-a-source',fieldEffectTransforms:'unknown'}),()=>c.compileInitializedContentBatch('/not-a-source',null,'',{fieldEffectTransforms:'unknown'})])await assert.rejects(run,/board transform|Board transform/);
 await assert.rejects(c.compileInitializedContentBatch('/not-a-source',null,'',{fieldEffectTransforms:marker}),/full same-producer/);
 await assert.rejects(a.captureSourcePrerequisiteInputs({root:'/not-a-source',fieldEffectTransforms:marker}),/complete v4/);
 await assert.rejects(c.compileInitializedContentBatch('/not-a-source',null,'',{fieldEffectTransformCatalog:{}}),/Undeclared/);
 const old=c.initializedContentBatchProfile('a'.repeat(64),{presentation:'framework-ordinary-field-flat-v1'});assert.equal(old.fieldEffectTransforms,undefined);assert.equal(old.logicalFieldEffects,undefined);
 const declared=c.initializedContentBatchProfile('a'.repeat(64),{presentation:'framework-ordinary-field-flat-v1',fieldEffectTransforms:marker});assert.equal(declared.fieldEffectTransforms,marker);assert.equal(declared.fieldEffectProjection,'web-source-field-effect-flat-v1');
});
test('complete lock verification rebuilds final board catalog while retaining byte-identical legacy logical and flat owners',async()=>{
 const f=await fixture(),api=await script('framework-field-effect-transform-evidence'),input={root,compiledDir,assessment:f.assessment,flatAssessment:f.flatAssessment,catalogHash:f.catalogHash,logicalCatalog:f.logical},before=canonical(input);
 const r=await api.verifyFieldEffectTransformLock(input);assert.equal(canonical(r.catalog),canonical(f.catalog));assert.equal(canonical(r.base),canonical(f.base));assert.equal(r.catalog.webPolicy.catalogHash,f.base.webPolicy.catalogHash);assert.equal(canonical(input),before);
 for(const mutate of[(x:any)=>{x.assessment.contentHash='0'.repeat(64)},(x:any)=>{x.catalogHash='0'.repeat(64)},(x:any)=>{x.assessment.projection.bindings[0].factory.mapRange.x++;const {contentHash:_,...body}=x.assessment;x.assessment.contentHash=hash(body)},(x:any)=>{x.assessment.projection.mapSources.pop();const {contentHash:_,...body}=x.assessment;x.assessment.contentHash=hash(body)},(x:any)=>{x.flatAssessment.projection.bindings[0].position.x++},(x:any)=>{x.assessment.extra=true}]){const x=structuredClone(input);mutate(x);await assert.rejects(api.verifyFieldEffectTransformLock(x));}
});
test('new transform metadata is removed only after its full proof and exact original actor-independent binding validate',async()=>{
 const f=await fixture(),api=await script('framework-field-effect-transform-evidence'),before=structuredClone(f.map),after=structuredClone(f.map);delete before.developmentProfile.fieldEffectTransforms;before.fieldEffects=structuredClone(f.base);
 const proof=api.createFrameworkFieldEffectTransformAddition({compilerDigest:'c'.repeat(64),assessment:f.assessment,flatAssessment:f.flatAssessment,projectedCatalogHash:f.catalogHash,catalog:f.world,entry:f.content}),evidence=async()=>({assessment:f.assessment,catalog:f.catalog,legacy:f.base,sourceMap:{contentHash:f.map.developmentProfile.sourceContentHash}}),options={before,after,proof,evidence,assessment:f.assessment,canonical};
 const unchanged=canonical({before,after,proof}),result=await api.comparableFrameworkFieldEffectTransformAddition(options);assert.equal(canonical(result.after.fieldEffects),canonical(f.base));assert.equal(result.after.developmentProfile.fieldEffectTransforms,marker);assert.equal(result.addition.runtimeAdmission,'unassessed');assert.equal(canonical({before,after,proof}),unchanged);
 for(const mutate of[(x:any)=>{x.proof=undefined},(x:any)=>{x.evidence=undefined},(x:any)=>{x.after.fieldEffects.media={}},(x:any)=>{x.after.map.groups.entity_default.entities.find((e:any)=>e.kind===11).effect.assetGroup='changed'},(x:any)=>{x.before.developmentProfile.fieldEffectTransforms=marker;delete x.before.fieldEffects.boardTransforms}]){const x={...options,before:structuredClone(before),after:structuredClone(after),proof:structuredClone(proof)};mutate(x);await assert.rejects(api.comparableFrameworkFieldEffectTransformAddition(x));}
});
test('candidate readers require input-v4 authority, complete catalog identity and the same assessment for every map',async()=>{
 const f=await fixture(),api=await script('source-candidate'),lock={kind:'source-prerequisite-input-lock-v4',fieldEffectTransforms:marker,fieldEffectCatalogHash:f.catalogHash,fieldEffectTransformCatalog:f.assessment},options={hash,canonical};
 api.validateSourceCandidateBoardTransforms(f.map,lock,options);api.validateSourceCandidateBoardTransforms(f.world,lock,options);
 const strict={kind:'world-map-development',mapId:f.map.mapId};api.validateSourceCandidateBoardTransforms(strict,{kind:'source-prerequisite-input-lock-v3'},options);
 for(const mutate of[(x:any)=>{x.lock.kind='source-prerequisite-input-lock-v3'},(x:any)=>{delete x.value.developmentProfile.fieldEffectTransforms},(x:any)=>{x.value.fieldEffects.boardTransforms.bindings.pop()},(x:any)=>{x.lock.fieldEffectCatalogHash='0'.repeat(64)},(x:any)=>{x.lock.fieldEffectTransformCatalog.projection.reason='changed'},(x:any)=>{delete x.value.developmentProfile}]){const x={value:structuredClone(f.map),lock:structuredClone(lock)};mutate(x);assert.throws(()=>api.validateSourceCandidateBoardTransforms(x.value,x.lock,options));}
});
test('legacy input locks retain exact shapes and cannot acquire v4 transform fields',async()=>{
 const api=await script('compile-source-prerequisites');
 for(const kind of['source-prerequisite-input-lock-v1','source-prerequisite-input-lock-v2','source-prerequisite-input-lock-v3'])await assert.rejects(api.validateSourcePrerequisiteInputs({kind,sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64),compiledDir:'dist',compilerDigest:'c'.repeat(64),files:[],directories:[],fieldEffectTransforms:marker},{root}));
});
