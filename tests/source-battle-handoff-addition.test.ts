import {ownedCapabilitySourceFixture} from './fixtures/source-owned-capability-additions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonical,hash} from '../src/compiler/content.js';
import {fixture as battleFixture} from './fixtures/battle-content.js';
const compiledDir=fileURLToPath(new URL('../',import.meta.url));
const load=(name:string)=>import(pathToFileURL(resolve(process.cwd(),'scripts',name+'.mjs')).href);
const handoff={kind:'source-battle-handoff-catalog-v1',policy:'web-source-battle-handoffs-atomic-v1',sourceSetHash:'a'.repeat(64),conditions:[{id:305,type:5,untilType:3}]};
function fixture(fee=false){
 const b=battleFixture(),{encounterId:_e,formation:_f,enemies:_n,background:_b,contentHash:_h,...common}=b;
 Object.assign(common,{sourceContentHash:'c'.repeat(64),fieldSourceSetHash:'a'.repeat(64)});
 const seal=(v:any)=>{const{contentHash:_,...body}=v;return{...body,contentHash:hash(body)};};
 const old=seal({kind:'narshe-battle-catalog',common,gameState:{kind:'controlled-initializer',owned:[{id:'actual',hp:71,row:'back'}]},encounters:{}});
 const noFee=seal({...structuredClone(old),common:{...structuredClone(common),timing:{...common.timing,speedIndex:3}}});
 const feeCatalog={kind:'source-message-fees-v1',sourceSetHash:'b'.repeat(64),blockers:[],fees:[]};
 const baseline=fee?seal({...structuredClone(noFee),common:{...structuredClone(noFee.common),sourceMessageFees:feeCatalog}}):noFee;
 const next=seal({...structuredClone(baseline),gameState:{...structuredClone(baseline.gameState),sourceBattleHandoffs:structuredClone(handoff)}});
 const declaration={kind:'compiled-source-battle-handoff-addition-v1',compilerDigest:'e'.repeat(64),sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64)};
 const evidence=ownedCapabilitySourceFixture(['sourceBattleHandoffs']).evidence;
 const url='/game/source-catalog.json',proof=(v:any)=>({kind:'compiled-battle-rebinding-v1',url,previousHash:old.contentHash,candidateHash:v.contentHash,compilerDigest:declaration.compilerDigest,sourceContentHash:common.sourceContentHash,fieldSourceSetHash:common.fieldSourceSetHash,gameStateHash:hash(v.gameState)});
 const input={compiledDir,reference:{url,contentHash:old.contentHash},readCurrentJson:async()=>old,readCandidateJson:async()=>next,battleRebindings:[proof(next)],sourceBattleHandoffAddition:declaration,sourceBattleHandoffEvidence:evidence,sourceBattleHandoffBaselines:new Map([[url,{baseline,rebinding:proof(baseline)}]]),
 ...(fee?{sourceMessageFeeAddition:{...declaration,kind:'compiled-source-message-fee-addition-v1'},sourceMessageFeeEvidence:async()=>({kind:'verified-source-message-fee-evidence-v1',sourceSetHash:declaration.sourceSetHash,parentSourceSetHash:declaration.parentSourceSetHash,sourceDigest:'c'.repeat(64),catalog:feeCatalog,rows:[],physicalSources:[],compiler:{module:'controlled-fee-compiler',sha256:'d'.repeat(64)}}),sourceMessageFeeBaselines:new Map([[url,{baseline:noFee,rebinding:proof(noFee)}]])}:{})};
 return{old,noFee,baseline,next,seal,proof,input,declaration,evidence,url};
}
test('exact handoff source catalog addition retains actual owned bytes and the historical pin without a generic fallback',async()=>{
 const api=await load('source-recipe-inputs'),f=fixture(),before=structuredClone(f.old),result=await api.resolveCompiledBattleReference(f.input);
 assert.equal(result.reference.contentHash,f.next.contentHash);assert.equal(f.input.reference.contentHash,before.contentHash);assert.deepEqual(f.old,before);
 assert.equal(result.report.sourceBattleHandoffAddition.actualOwnedInitializationUnchanged,true);assert.equal(result.report.sourceBattleHandoffAddition.grantsSourceAdmission,false);
 assert.equal(result.report.sourceBattleHandoffAddition.compilationBaseline.contentHash,f.baseline.contentHash);
 assert.equal(result.report.sourceBattleHandoffAddition.compilationBaseline.historicalRebinding.candidateHash,f.baseline.contentHash);
 await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceBattleHandoffBaselines:undefined}),/compiled baseline/);
 await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceBattleHandoffAddition:undefined}),/declaration/);
});
test('handoff and fee additions compose through two separate same-source compiler baselines',async()=>{
 const api=await load('source-recipe-inputs'),f=fixture(true),result=await api.resolveCompiledBattleReference(f.input);
 assert.equal(result.report.sourceBattleHandoffAddition.compilationBaseline.contentHash,f.baseline.contentHash);
 assert.equal(result.report.sourceMessageFeeAddition.compilationBaseline.contentHash,f.noFee.contentHash);
 assert.equal(result.report.sourceMessageFeeAddition.beforeGameStateHash,result.report.sourceMessageFeeAddition.afterGameStateHash);
 await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceMessageFeeBaselines:undefined}),/unrelated common/);
});
test('source handoff audit refuses changed existing catalogs, foreign source, forged baseline, extra owned fields and moved current resources',async()=>{
 const api=await load('source-recipe-inputs'),f=fixture();
 for(const change of [
  (v:any)=>{v.gameState.owned[0].hp++;},(v:any)=>{v.gameState.unknown=true;},(v:any)=>{v.gameState.sourceBattleHandoffs.conditions[0].type++;},
  (v:any)=>{v.common.timing.speedIndex=4;},(v:any)=>{v.encounters.unreviewed={};},
 ]){const next=structuredClone(f.next);change(next);const sealed=f.seal(next);await assert.rejects(api.resolveCompiledBattleReference({...f.input,readCandidateJson:async()=>sealed,battleRebindings:[f.proof(sealed)]}));}
 for(const row of [{baseline:f.next,rebinding:f.proof(f.next)},{baseline:f.baseline,rebinding:{...f.proof(f.baseline),candidateHash:'f'.repeat(64)}},{baseline:f.baseline,rebinding:{...f.proof(f.baseline),compilerDigest:'f'.repeat(64)}}])await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceBattleHandoffBaselines:new Map([[f.url,row]])}));
 await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceBattleHandoffAddition:{...f.declaration,sourceSetHash:'f'.repeat(64)}}));
 const additions=await load('source-battle-handoff-addition');const changed=structuredClone(f.next);changed.gameState.sourceBattleHandoffs.conditions=[];
 await assert.rejects(additions.auditSourceBattleHandoffAddition({before:changed,after:f.next,canonical}),/Existing/);
 await assert.rejects(additions.auditSourceBattleHandoffAddition({before:f.next,after:f.baseline,canonical}),/removed/);
 const getter={...f.declaration};Object.defineProperty(getter,'compilerDigest',{enumerable:true,get:()=>f.declaration.compilerDigest});assert.throws(()=>additions.parseSourceBattleHandoffAddition(getter),/own data/);
});
test('actual recipe input resolver audits source, development and derived ordinary catalogs without rewriting recipe pins',async()=>{
 const api=await load('source-recipe-inputs');
 for(const url of ['/game/source-catalog.json','/game/opening-playable.json','/content-batches/ordinary-battles/battle.json']){
  const f=fixture(true),recipe={kind:'controlled-source-catalog-addition-recipe-v1',id:'controlled-source-handoff',battle:{url,contentHash:f.old.contentHash}},bytes=JSON.stringify(recipe),rebind=(v:any)=>({...f.proof(v),url});
  const result=await api.resolveSourceRecipeInputs({...f.input,recipePath:'content-batches/controlled-source-handoff.json',recipeBytes:bytes,battleRebindings:[rebind(f.next)],sourceBattleHandoffBaselines:new Map([[url,{baseline:f.baseline,rebinding:rebind(f.baseline)}]]),sourceMessageFeeBaselines:new Map([[url,{baseline:f.noFee,rebinding:rebind(f.noFee)}]])});
  assert.equal(result.recipe.battle.contentHash,f.next.contentHash);assert.equal(JSON.stringify(recipe),bytes);assert.equal(result.report.sourceBattleHandoffAdditions.length,1);assert.equal(result.report.sourceMessageFeeAdditions.length,1);
 }
});
