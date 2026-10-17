import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,symlink,rm,access}from'node:fs/promises';import{tmpdir}from'node:os';import{resolve}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
import{WEB_FLAT_MOB_COLOR_FILTER}from'../src/core/field-mob-controls.js';
const root=process.cwd(),compiledDir=fileURLToPath(new URL('../',import.meta.url)),load=(n:string)=>import(pathToFileURL(resolve(root,'scripts',n+'.mjs')).href);
test('actual shared/initialized producers reject unknown Mob policy before source production or any output',async()=>{
 const tmp=await mkdtemp(resolve(tmpdir(),'ffvi-mob-producer-'));try{await mkdir(resolve(tmp,'content-batches'));await symlink(resolve(root,'apps'),resolve(tmp,'apps'),'dir');await symlink(resolve(root,'scripts'),resolve(tmp,'scripts'),'dir');
 const {compileSharedContentPackages}=await load('content-package-pipeline');await assert.rejects(compileSharedContentPackages({root:tmp,compiledDir,sourceRecipePaths:[],mobColorFilter:'unknown'}),/Unknown source framework Mob/);await assert.rejects(access(resolve(tmp,'build')));
 const {compileInitializedContentBatch}=await load('build-initialized-content-batch');await assert.rejects(compileInitializedContentBatch(root,{},'a'.repeat(64),{mobColorFilter:'unknown'}),/Unknown initialized Mob/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
test('all fresh initialized profiles and detached replay declarations carry one explicit Mob policy without granting it on omission',async()=>{
 const{webSourceFrameworkInputs}=await load('source-web-framework-inputs'),{sourceWebReplayRuntimePorts}=await load('source-web-replay-runtime'),{initializedContentBatchProfile}=await load('build-initialized-content-batch');const a=webSourceFrameworkInputs(),b=webSourceFrameworkInputs();assert.equal(a.mobColorFilter,WEB_FLAT_MOB_COLOR_FILTER);assert.equal(sourceWebReplayRuntimePorts().mobColorFilter,WEB_FLAT_MOB_COLOR_FILTER);delete a.mobColorFilter;assert.equal(b.mobColorFilter,WEB_FLAT_MOB_COLOR_FILTER);
 for(const hash of['a','b','c']){const profile=initializedContentBatchProfile(hash.repeat(64),{presentation:'framework-ordinary-field-flat-v1',mobColorFilter:b.mobColorFilter});assert.equal(profile.mobColorFilter,WEB_FLAT_MOB_COLOR_FILTER);assert.equal(profile.sourceContentHash,hash.repeat(64));}
 assert.equal(initializedContentBatchProfile('a'.repeat(64),{presentation:'framework-ordinary-field-flat-v1'}).mobColorFilter,undefined);
});
