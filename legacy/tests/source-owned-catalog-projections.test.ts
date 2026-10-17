import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {ownedCapabilitySourceFixture} from './fixtures/source-owned-capability-additions.js';
import {fixture as battleFixture} from './fixtures/battle-content.js';
import {parseSourceOwnedCapabilityAdditionAudit,compileSourceEquipmentStrongestMetadata} from '../src/compiler/source-owned-capability-catalogs.js';
const compiledDir=fileURLToPath(new URL('../',import.meta.url)),load=(n:string)=>import(pathToFileURL(resolve('scripts',n+'.mjs')).href),rank='equipmentStrongestMetadata';
function fixture(h=false,s=false,m=false,fee=false){
 const f=ownedCapabilitySourceFixture(['sourceBattleHandoffs','sourceSpecialOwnedMembers',rank]),{hash}=f,b=battleFixture(),{encounterId:_,formation:_f,enemies:_e,background:_b,contentHash:_h,...common}=b;
 Object.assign(common,{sourceContentHash:'c'.repeat(64),fieldSourceSetHash:'a'.repeat(64)});
 const seal=(v:any)=>{const{contentHash:_,...body}=v;return{...body,contentHash:hash(body)};},metadata=(f.expected[rank]!.catalog as any).definitions;
 const rawDefinitions:Record<string,Record<string,unknown>>=Object.fromEntries(f.values['content.csv']!.map(c=>[c.id,{id:Number(c.id),equipmentId:Number(c.type_value),kind:c.type_id==='2'?'weapon':'armor',strength:7,parameter:{attack:11},blockers:[]}]));
 const compile=(omit:string[],hasFee=false)=>{
  const definitions=Object.fromEntries(Object.entries(rawDefinitions).map(([id,value])=>[id,{...structuredClone(value),...omit.includes(rank)?{}:{strongest:structuredClone(metadata[id])}}])),initial=Object.fromEntries(['100','200'].map(id=>[id,structuredClone(definitions[id])])),owned:any={kind:'controlled-original-initializer',owned:[{id:'owner:1',hp:71,row:'back'}],equipmentStock:[{id:100,count:4}],equipmentSystem:{catalog:{kind:'controlled-equipment-catalog',definitions},initialStock:[{id:100,count:4}]},sourceNewGame:{equipment:{kind:'controlled-initial-equipment',definitions:initial},initialParty:[{id:'owner:1',equipment:[100,0,200,0,0,0]}]}};
  for(const key of ['sourceBattleHandoffs','sourceSpecialOwnedMembers'])if(!omit.includes(key))owned[key]=structuredClone(f.expected[key]!.catalog);
  return seal({kind:'narshe-battle-catalog',common:{...structuredClone(common),...hasFee?{sourceMessageFees:{kind:'source-message-fees-v1',sourceSetHash:'b'.repeat(64),blockers:[],fees:[]}}:{}},gameState:owned,encounters:{}});
 };
 const omitted=['sourceBattleHandoffs','sourceSpecialOwnedMembers',rank].filter((_,i)=>![h,s,m][i]),old=compile(omitted),baseline=compile(omitted,fee),next=compile([],fee),url='/game/source-catalog.json',declaration={kind:'compiled-source-owned-capability-additions-v1',compilerDigest:'e'.repeat(64),sourceSetHash:'a'.repeat(64),parentSourceSetHash:'b'.repeat(64),catalogKeys:['sourceBattleHandoffs','sourceSpecialOwnedMembers',rank]},proof=(v:any)=>({kind:'compiled-battle-rebinding-v1',url,previousHash:old.contentHash,candidateHash:v.contentHash,compilerDigest:declaration.compilerDigest,sourceContentHash:common.sourceContentHash,fieldSourceSetHash:common.fieldSourceSetHash,gameStateHash:hash(v.gameState)}),bag={declaration,evidence:f.evidence,baselines:new Map([[url,{baseline,rebinding:proof(baseline),omittedCatalogs:omitted}]])};
 return {...f,old,baseline,next,compile,omitted,proof,bag,url,seal,input:{compiledDir,reference:{url,contentHash:old.contentHash},readCurrentJson:async()=>old,readCandidateJson:async()=>next,battleRebindings:[proof(next)],sourceOwnedCapabilityAdditions:bag}};
}
test('closed registry composes three source projections in all eight historical shapes through the same actual resolver',async()=>{
 const api=await load('source-recipe-inputs');for(const h of [false,true])for(const s of [false,true])for(const m of [false,true]){
  const f=fixture(h,s,m),old=structuredClone(f.old),result=await api.resolveCompiledBattleReference(f.input);
  assert.equal(result.reference.contentHash,f.next.contentHash);assert.deepEqual(f.old,old);assert.equal(f.input.reference.contentHash,old.contentHash);
  if(!m){const evidence=result.report.sourceOwnedCapabilityAdditions.catalogs[rank];assert.equal(evidence.globalDefinitions,3);assert.equal(evidence.initialDefinitions,2);assert.equal(evidence.rows.length,6);assert.equal(result.report.sourceOwnedCapabilityAdditions.actualOwnedInitializationUnchanged,true);}
 }
 assert.deepEqual(parseSourceOwnedCapabilityAdditionAudit({kind:'omit-source-owned-capability-catalogs-for-addition-audit-v1',omit:[rank]}).omit,[rank]);
});
test('partial/mixed copies and any changed existing strongest metadata are rejected instead of assembled into an upgrade',async()=>{
 const api=await load('source-recipe-inputs');for(const existing of [false,true])for(const which of ['global','initial'])for(const mutation of ['remove','change','partial']){
  const f=fixture(true,true,existing),candidate=structuredClone(f.next),definitions=which==='global'?candidate.gameState.equipmentSystem.catalog.definitions:candidate.gameState.sourceNewGame.equipment.definitions;
  if(mutation==='change')definitions['100'].strongest.sortId++;
  else delete definitions['100'].strongest;
  if(mutation==='partial')delete definitions[which==='global'?'101':'200'].strongest;
  const next=f.seal(candidate);await assert.rejects(api.resolveCompiledBattleReference({...f.input,readCandidateJson:async()=>next,battleRebindings:[f.proof(next)]}));
 }
 const f=fixture(),partial=structuredClone(f.old);partial.gameState.equipmentSystem.catalog.definitions['100'].strongest={sortId:20,weaponCategory:1,twoHanded:false};
 await assert.rejects(api.resolveCompiledBattleReference({...f.input,readCurrentJson:async()=>f.seal(partial),reference:{url:f.url,contentHash:f.seal(partial).contentHash}}),/Partial or mixed/);
});
test('rank projection cannot change old equipment fields, stock, actual initial slots or any unrelated state/body',async()=>{
 const api=await load('source-recipe-inputs');for(const mutate of [(v:any)=>v.gameState.equipmentSystem.catalog.definitions['100'].strength++,
  (v:any)=>v.gameState.equipmentStock[0].count++,(v:any)=>v.gameState.sourceNewGame.initialParty[0].equipment[0]=101,
  (v:any)=>v.gameState.sourceNewGame.equipment.definitions['100'].parameter.attack++,
  (v:any)=>v.gameState.owned[0].hp++,(v:any)=>v.gameState.unregistered={},(v:any)=>v.common.unregistered={},
  (v:any)=>v.gameState.equipmentSystem.catalog.definitions['100'].unregistered={}]){
  const f=fixture(),v=structuredClone(f.next);mutate(v);const next=f.seal(v);await assert.rejects(api.resolveCompiledBattleReference({...f.input,readCandidateJson:async()=>next,battleRebindings:[f.proof(next)]}));
 }
});
test('complete raw equipment domain and physical/compiler bindings defeat missing rows and rank forgeries',async()=>{
 const api=await load('source-recipe-inputs');for(const mutate of [(v:any)=>v.sourceTables['weapon.csv'][0].values.sort_id='999',
  (v:any)=>v.sourceTables['content.csv'][0].values.type_value='2',(v:any)=>v.sourceTables['armor.csv'].pop(),
  (v:any)=>v.sourceTables['weapon.csv'][0].source.assetPath='Assets/Master/armor.csv',
  (v:any)=>v.compilers[4].sha256='f'.repeat(64),(v:any)=>v.expected[rank].catalog.definitions['100'].sortId=999]){
  const f=fixture(),evidence=async()=>{const v=await f.evidence();mutate(v);for(const key of Object.keys(v.sourceTables))v.sourceTableHashes[key]=f.hash(v.sourceTables[key]);return v;};
  await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceOwnedCapabilityAdditions:{...f.bag,evidence}}));
 }
 const f=fixture();assert.throws(()=>compileSourceEquipmentStrongestMetadata({...f.values,'armor.csv':[]}));
 await assert.rejects(api.resolveCompiledBattleReference({...f.input,sourceOwnedCapabilityAdditions:{...f.bag,declaration:{...f.bag.declaration,catalogKeys:[rank,'unknown']}}}));
});
test('ordinary lazy derivation selects its own exact three-projection shape, preserves pins, and retries late source failure',async()=>{
 const owner=await load('source-owned-capability-additions'),api=await load('source-recipe-inputs'),{verifyContent}=await import('../src/core/content-integrity.js');
 for(const h of [false,true])for(const s of [false,true])for(const m of [false,true]){
  const f=fixture(h,s,m),before=structuredClone(f.old),calls:any[]=[];let fail=true;
  const deriveInput={rootUrl:'/game/opening-playable.json',previousDerived:f.old,compileBattleAuditBaseline:async(request:any)=>{calls.push(structuredClone(request));assert.deepEqual(request.omittedCatalogs,f.omitted);return f.compile(request.omittedCatalogs);},derive:async(parent:any)=>{if(fail)throw Error('late raw equipment upgrade resource failure');return{catalog:parent};},verifyContent,hash:f.hash};
  await assert.rejects(owner.compileDerivedOwnedCapabilityBaselines(deriveInput),/late raw equipment/);assert.deepEqual(f.old,before);fail=false;
  const derived=await owner.compileDerivedOwnedCapabilityBaselines(deriveInput);assert.deepEqual(derived.omittedCatalogs,f.omitted);assert.equal(calls.filter(c=>c.omitMessageFees).length,2);
  const url='/content-batches/ordinary-battles/battle.json',proof=(v:any)=>({...f.proof(v),url}),input={...f.input,reference:{url,contentHash:f.old.contentHash},battleRebindings:[proof(f.next)],sourceOwnedCapabilityAdditions:{...f.bag,baselines:new Map([[url,{baseline:derived.baseline,rebinding:proof(derived.baseline),omittedCatalogs:derived.omittedCatalogs}]])}};
  assert.equal((await api.resolveCompiledBattleReference(input)).reference.contentHash,f.next.contentHash);assert.deepEqual(f.old,before);
  await assert.rejects(api.resolveCompiledBattleReference({...input,reference:{url,contentHash:'f'.repeat(64)}}));
 }
});
