import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { canonical, hash } from "../src/compiler/content.js";
import { fixture as battleFixture } from "./fixtures/battle-content.js";
import type { SourceMessageFeeCatalog } from "../src/core/source-message-fees.js";
const modulePath=pathToFileURL(resolve(process.cwd(),"scripts/source-message-fee-evidence.mjs")).href,
 resolver=pathToFileURL(resolve(process.cwd(),"scripts/source-recipe-inputs.mjs")).href,compiledDir=fileURLToPath(new URL('../',import.meta.url));
const fee:SourceMessageFeeCatalog={kind:"source-message-fees-v1",sourceSetHash:"b".repeat(64),blockers:[],fees:[{groupId:101,productId:9001,amount:80,source:{file:"controlled-product.bundle",assetPath:"product.csv",objectId:"9223372036854775807",serializedFile:"controlled",rowId:"9001"}}]};
function fixture(){const b=battleFixture(),{encounterId:_e,formation:_f,enemies:_n,background:_b,contentHash:_h,...common}=b;
 common.sourceContentHash="c".repeat(64);common.fieldSourceSetHash="a".repeat(64);
 const before={kind:"narshe-battle-catalog",common,encounters:{},gameState:{kind:"controlled-source-initializer",owned:["unchanged"]},contentHash:""},seal=(v:typeof before)=>{const{contentHash:_,...body}=v;return{...body,contentHash:hash(body)};};
 const old=seal(before),next=seal({...structuredClone(before),common:{...structuredClone(common),sourceMessageFees:fee}} as typeof before),
 declaration={kind:"compiled-source-message-fee-addition-v1",compilerDigest:"e".repeat(64),sourceSetHash:"a".repeat(64),parentSourceSetHash:"b".repeat(64)},
 evidence=async()=>({kind:"verified-source-message-fee-evidence-v1",sourceSetHash:declaration.sourceSetHash,parentSourceSetHash:declaration.parentSourceSetHash,sourceDigest:"c".repeat(64),catalog:fee,rows:[],physicalSources:[],compiler:{module:"controlled",sha256:"d".repeat(64)}});
 return{old,next,seal,declaration,evidence};}
test("fee addition audits the entire common and DataInitialize while retaining exact old/new data",async()=>{
 const api=await import(modulePath),f=fixture(),original=structuredClone(f.next),audit=await api.auditSourceMessageFeeAddition({before:f.old,after:f.next,declaration:f.declaration,evidence:f.evidence,canonical});
 assert.equal(audit.beforeCommonHash,hash(f.old.common));assert.equal(audit.afterCommonHash,hash(f.next.common));assert.equal(audit.beforeGameStateHash,audit.afterGameStateHash);assert.equal(audit.beforeCatalog,null);assert.deepEqual(audit.afterCatalog,fee);assert.equal(audit.grantsSourceAdmission,false);assert.deepEqual(f.next,original);
 await assert.rejects(api.auditSourceMessageFeeAddition({before:f.old,after:f.next,canonical}),/explicit/);
 await assert.rejects(api.auditSourceMessageFeeAddition({before:f.old,after:f.next,declaration:{...f.declaration,kind:"unknown"},evidence:f.evidence,canonical}));
});
test("the fee proof cannot hide changed price, source refs, source set, other capabilities or owned state",async()=>{
 const api=await import(modulePath),f=fixture();
 for(const change of [(x:typeof f.next)=>{x.common.sourceMessageFees!.fees[0]!.amount++;},(x:typeof f.next)=>{x.common.sourceMessageFees!.fees[0]!.source.objectId="9007199254740993";},(x:typeof f.next)=>{x.common.profile="different"as typeof x.common.profile;},(x:typeof f.next)=>{x.gameState.owned.push("forged");}]){
  const changed=structuredClone(f.next);change(changed);await assert.rejects(api.auditSourceMessageFeeAddition({before:f.old,after:changed,declaration:f.declaration,evidence:f.evidence,canonical}));
 }
 await assert.rejects(api.auditSourceMessageFeeAddition({before:f.old,after:f.next,declaration:{...f.declaration,parentSourceSetHash:"f".repeat(64)},evidence:f.evidence,canonical}));
 await assert.rejects(api.auditSourceMessageFeeAddition({before:f.next,after:f.old,declaration:f.declaration,evidence:f.evidence,canonical}),/removed/);
});
test("existing valid fee catalogs remain exact and malformed declarations never create admission",async()=>{
 const api=await import(modulePath),f=fixture();assert.equal(await api.auditSourceMessageFeeAddition({before:f.next,after:f.next,canonical}),null);
 const previous=structuredClone(f.next);previous.common.sourceMessageFees!.fees=[];await assert.rejects(api.auditSourceMessageFeeAddition({before:previous,after:f.next,declaration:f.declaration,evidence:f.evidence,canonical}),/Existing/);
 const hidden={...f.declaration};Object.defineProperty(hidden,"compilerDigest",{get:()=>"e".repeat(64),enumerable:true});assert.throws(()=>api.parseSourceMessageFeeAddition(hidden),/data/);
});
test("the actual recipe battle rebinder requires the independent exact fee proof before accepting new SourceRefs",async()=>{
 const api=await import(resolver),f=fixture(),ref={url:"/game/source-catalog.json",contentHash:f.old.contentHash},battleRebindings=[{kind:"compiled-battle-rebinding-v1",url:ref.url,previousHash:ref.contentHash,candidateHash:f.next.contentHash,compilerDigest:f.declaration.compilerDigest,sourceContentHash:f.old.common.sourceContentHash,fieldSourceSetHash:f.old.common.fieldSourceSetHash,gameStateHash:hash(f.old.gameState)}],
 input={reference:ref,compiledDir,readCurrentJson:async()=>f.old,readCandidateJson:async()=>f.next,battleRebindings};
 await assert.rejects(api.resolveCompiledBattleReference(input),/explicit/);
 const result=await api.resolveCompiledBattleReference({...input,sourceMessageFeeAddition:f.declaration,sourceMessageFeeEvidence:f.evidence});assert.equal(result.reference.contentHash,f.next.contentHash);assert.equal(ref.contentHash,f.old.contentHash);assert.equal(result.report.sourceMessageFeeAddition.kind,f.declaration.kind);
});

function historicalCompilationFixture(){
 const f=fixture(),url="/game/source-catalog.json";
 const baseline=structuredClone(f.old);baseline.common.timing={...baseline.common.timing,speedIndex:3};
 const noFee=f.seal(baseline),after=f.seal({...structuredClone(noFee),common:{...structuredClone(noFee.common),sourceMessageFees:fee}} as typeof f.next);
 const rebinding=(candidate:typeof f.old)=>({kind:"compiled-battle-rebinding-v1",url,previousHash:f.old.contentHash,
  candidateHash:candidate.contentHash,compilerDigest:f.declaration.compilerDigest,
  sourceContentHash:f.old.common.sourceContentHash,fieldSourceSetHash:f.old.common.fieldSourceSetHash,gameStateHash:hash(f.old.gameState)});
 const row={baseline:noFee,rebinding:rebinding(noFee)};
 const input={compiledDir,reference:{url,contentHash:f.old.contentHash},readCurrentJson:async()=>f.old,readCandidateJson:async()=>after,
  battleRebindings:[rebinding(after)],sourceMessageFeeAddition:f.declaration,sourceMessageFeeEvidence:f.evidence,
  sourceMessageFeeBaselines:new Map([[url,row]])};
 return{f,url,noFee,after,row,rebinding,input};
}
test("legacy common compilation and the exact fee addition retain separate proofs and the old recipe pin",async()=>{
 const api=await import(resolver),h=historicalCompilationFixture(),original=structuredClone(h.f.old);
 await assert.rejects(api.resolveCompiledBattleReference({...h.input,sourceMessageFeeBaselines:undefined}),/unrelated common/);
 const result=await api.resolveCompiledBattleReference(h.input),audit=result.report.sourceMessageFeeAddition;
 assert.equal(result.reference.contentHash,h.after.contentHash);
 assert.equal(audit.beforeCommonHash,hash(h.noFee.common));
 assert.equal(audit.compilationBaseline.originalPinnedCommonHash,hash(h.f.old.common));
 assert.equal(audit.compilationBaseline.originalPinnedHash,h.f.old.contentHash);
 assert.equal(audit.compilationBaseline.historicalRebinding.candidateHash,h.noFee.contentHash);
 assert.equal(audit.compilationBaseline.contentHash,h.noFee.contentHash);
 assert.notEqual(audit.beforeCommonHash,audit.compilationBaseline.originalPinnedCommonHash);
 assert.deepEqual(h.f.old,original);assert.equal(h.input.reference.contentHash,original.contentHash);
 assert.equal(audit.beforeGameStateHash,audit.afterGameStateHash);
});
test("the composition rejects missing, stale or foreign baseline proofs and candidate changes outside the exact addition",async()=>{
 const api=await import(resolver),h=historicalCompilationFixture();
 // Even a redundant baseline equal to the old pin must verify its supplied proof.
 const fresh=fixture(),finalProof=h.rebinding(fresh.next),redundantProof=h.rebinding(fresh.old);
 await assert.rejects(api.resolveCompiledBattleReference({...h.input,
  reference:{url:h.url,contentHash:fresh.old.contentHash},readCurrentJson:async()=>fresh.old,readCandidateJson:async()=>fresh.next,
  battleRebindings:[finalProof],sourceMessageFeeBaselines:new Map([[h.url,{baseline:fresh.old,
   rebinding:{...redundantProof,candidateHash:"f".repeat(64)}}]])}),/baseline candidate hash/);
 const badBaseline=structuredClone(h.noFee);badBaseline.common.timing.speedIndex=4;
 const rows=[
  {...h.row,baseline:h.f.seal(badBaseline)},
  {...h.row,rebinding:{...h.row.rebinding,compilerDigest:"f".repeat(64)}},
  {...h.row,rebinding:{...h.row.rebinding,url:"/game/foreign.json"}},
  {...h.row,baseline:h.after},
 ];
 for(const row of rows)await assert.rejects(api.resolveCompiledBattleReference({...h.input,sourceMessageFeeBaselines:new Map([[h.url,row]])}));
 await assert.rejects(api.resolveCompiledBattleReference({...h.input,sourceMessageFeeBaselines:new Map()}));
 for(const change of [
  (x:typeof h.after)=>{x.common.timing.speedIndex=4;},
  (x:typeof h.after)=>{x.gameState.owned.push("forged");},
  (x:typeof h.after)=>{(x.encounters as Record<string,unknown>).unexpected={};},
  (x:typeof h.after)=>{x.common.sourceMessageFees!.fees[0]!.amount++;},
 ]){
  const changed=structuredClone(h.after);change(changed);const candidate=h.f.seal(changed);
  await assert.rejects(api.resolveCompiledBattleReference({...h.input,readCandidateJson:async()=>candidate,battleRebindings:[h.rebinding(candidate)]}));
 }
});
