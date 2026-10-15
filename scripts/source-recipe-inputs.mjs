import {parseFrameworkFieldEffectFlatAddition,comparableFrameworkFieldEffectFlatAddition} from './framework-field-effect-flat-evidence.mjs';
import {parseSourceMessageFeeAddition,createSourceMessageFeeEvidenceReader,auditSourceMessageFeeAddition} from './source-message-fee-evidence.mjs';
import {parseFrameworkNpcFlatAddition,comparableFrameworkNpcFlatAddition} from './framework-npc-flat-evidence.mjs';
// Rebind declared recipe inputs to one private source compilation. This does
// not edit recipes, rebuild inputs, or confer gameplay/source admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSourceMapAnimationEvidenceReader,compareSourceMapAnimationAddition} from './source-map-animation-evidence.mjs';
import {parseSourceEventActivationAddition,createSourceEventActivationEvidenceReader,compareSourceEventActivationAddition,sourceEventActivationChanged} from './source-event-activation-evidence.mjs';
import {parseFrameworkNpcAreaAddition,comparableFrameworkNpcAreaAddition} from './framework-npc-area-evidence.mjs';

const repository=resolve(import.meta.dirname,'..');
const digest=/^[a-f0-9]{64}$/;
const logicalURL=/^\/(?:world|game|framework)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const jsonURL=/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const ordinaryBattle='/content-batches/ordinary-battles/battle.json';
const frameworkHostMarkers={storyRuntime:{value:'web-field-story-runtime-v1',module:'field-story-runtime',
  exportName:'WEB_FIELD_STORY_RUNTIME',provider:'hasFieldStoryRuntime'},
  autoSave:{value:'web-field-autosave-barrier-v1',module:'field-auto-save',
    exportName:'WEB_AUTO_SAVE_POLICY',provider:'assertFieldEventSaveAdmission'}};
const logicalMarker={value:'web-logical-all-loop-field-effects-v1',module:'field-logical-effects',
  exportName:'WEB_LOGICAL_FIELD_EFFECTS',provider:'createWebLogicalFieldEffectsHost'};
const periodicMarkers={worldMap:{value:'framework-world-map-flat-v1',module:'field-presentation',
  exportName:'WEB_PERIODIC_WORLD_PRESENTATION',provider:'resolveFieldPresentation'},
  fieldPresentation:{value:'framework-ordinary-field-flat-v1',module:'field-presentation',
    exportName:'WEB_PERIODIC_FIELD_PRESENTATION',provider:'resolveFieldPresentation'}};
const roles={sourceEntry:'source-new-game-content-v1',sourceBattle:'narshe-battle-catalog',
  sourceWorld:'world-development',sourceMap:'world-map-development',
  'sourceMaps.world':'world-map-development','sourceMaps.location':'world-map-development',
  baseField:'field-development',battle:'narshe-battle-catalog',baseWorld:'world-development',mapRules:'world-map-development'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const linkedMapURL=(world,id)=>'/content-packages/'+(world.developmentProfile?'framework':'source')+'/maps/'+id+'.json';
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const pointer=parts=>'/'+parts.map(part=>part.replaceAll('~','~0').replaceAll('/','~1')).join('/');

function recipeJSON(bytes){
  assert.ok(typeof bytes==='string'||bytes instanceof Uint8Array,'Expected original recipe bytes');
  const text=typeof bytes==='string'?bytes:new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const result=JSON.parse(text),stack=[];
  // JSON.parse otherwise hides duplicate declarations before ambiguity checks.
  const tokens=/"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  for(let token;(token=tokens.exec(text));){
    const value=token[0];
    if(value==='{')stack.push(new Set());
    else if(value==='[')stack.push(null);
    else if(value==='}'||value===']')stack.pop();
    else if(/^\s*:/.test(text.slice(tokens.lastIndex))){
      const keys=stack.at(-1),key=JSON.parse(value);
      assert.ok(keys&&!keys.has(key),'Ambiguous duplicate recipe key: '+key);keys.add(key);
    }
  }
  assert.ok(plain(result),'Expected a recipe object');
  assert.ok(typeof result.kind==='string'&&result.kind.length>0,'Missing recipe kind');
  assert.match(result.id,/^[a-z0-9][a-z0-9-]{0,79}$/,'Invalid recipe id');
  return result;
}

function declaredReferences(recipe){
  const refs=[],allowed=new Set();
  const independent=recipe.kind==='development-content-batch-recipe-v2';
  const legacy=recipe.kind==='development-content-batch-recipe-v1'||independent;
  if(independent){
    dataFields(recipe.frameworkPolicy,['kind','sourceEntry'],'independent development world policy');
    assert.equal(recipe.frameworkPolicy.kind,'independent-source-framework-v1','Unknown independent development world policy');
    assert.equal(recipe.frameworkPolicy.sourceEntry,'game/source-new-game.json','Independent development world requires the same candidate source entry');
    assert.equal(recipe.world,'world/catalog.json','Independent development world requires a strict source world');
  }
  if(legacy){
    for(const role of ['baseField','battle','world']){
      const value=recipe[role];assert.equal(typeof value,'string','Development recipe must retain unpinned string inputs');
      assert.ok(logicalURL.test('/'+value)||(role==='battle'&&'/'+value===ordinaryBattle),'Invalid unpinned recipe URL');
    }
  }
  for(const [role,kind] of Object.entries(roles)){
    const parts=role.split('.');let value=recipe;
    for(const part of parts)value=value?.[part];
    if(value===undefined)continue;
    if(legacy&&parts.length===1&&['baseField','battle'].includes(role))continue;
    assert.ok(plain(value),'Missing recipe reference: '+role);
    assert.deepEqual(Object.keys(value).sort(),['contentHash','url'],'Unknown recipe reference fields: '+role);
    assert.match(value.contentHash,digest,'Invalid recipe content hash: '+role);
    assert.equal(typeof value.url,'string','Missing recipe URL: '+role);
    assert.ok(logicalURL.test(value.url)||(role==='battle'&&value.url===ordinaryBattle),'Unsupported recipe URL: '+role);
    const path=pointer(parts);allowed.add(path);refs.push({pointer:path,parts,role,kind,...value});
  }
  if(Object.hasOwn(recipe,'sourceMaps')){
    assert.ok(plain(recipe.sourceMaps),'Invalid sourceMaps reference set');
    assert.deepEqual(Object.keys(recipe.sourceMaps).sort(),['location','world'],'Unknown or missing sourceMaps role');
  }
  function scan(value,parts=[]){
    if(!value||typeof value!=='object')return;
    if(!Array.isArray(value)&&(Object.hasOwn(value,'url')||Object.hasOwn(value,'contentHash')))
      assert.ok(allowed.has(pointer(parts)),'Unknown recipe reference at '+pointer(parts));
    for(const [key,child] of Object.entries(value))scan(child,[...parts,key]);
  }
  scan(recipe);
  assert.ok(legacy||refs.length>0,'Recipe has no declared pinned inputs');
  const pins=new Map();
  for(const ref of refs){
    if(pins.has(ref.url))assert.equal(pins.get(ref.url),ref.contentHash,'Ambiguous recipe pins for '+ref.url);
    pins.set(ref.url,ref.contentHash);
  }
  return refs;
}

function requiredString(value,field){
  assert.ok(typeof value==='string'&&value.length>0,'Missing source identity: '+field);return value;
}

function dataFields(value,keys,label){
  assert.ok(plain(value),'Invalid '+label);
  const own=Reflect.ownKeys(value);
  assert.ok(own.every(key=>typeof key==='string'),'Invalid '+label+' fields');
  assert.deepEqual(own.sort(),[...keys].sort(),'Invalid '+label+' fields');
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
    assert.ok(descriptor.enumerable&&Object.hasOwn(descriptor,'value'),label+' must contain own data fields');
  return value;
}

function parseBattleRebindings(raw=[]){
  assert.ok(Array.isArray(raw),'Battle rebindings must be an array');
  assert.equal(Reflect.ownKeys(raw).length,raw.length+1,'Battle rebindings must be dense own data');
  const result=new Map();
  for(let index=0;index<raw.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(raw,String(index));
    assert.ok(descriptor?.enumerable&&Object.hasOwn(descriptor,'value'),'Battle rebindings must be dense own data');
    const value=dataFields(descriptor.value,['kind','url','previousHash','candidateHash','compilerDigest',
      'sourceContentHash','fieldSourceSetHash','gameStateHash'],'compiled battle rebinding');
    assert.equal(value.kind,'compiled-battle-rebinding-v1','Unknown compiled battle rebinding');
    assert.ok(typeof value.url==='string'&&jsonURL.test(value.url),'Invalid compiled battle rebinding URL');
    for(const key of ['previousHash','candidateHash','compilerDigest','sourceContentHash','fieldSourceSetHash','gameStateHash'])
      assert.ok(typeof value[key]==='string'&&digest.test(value[key]),'Invalid compiled battle rebinding '+key);
    assert.ok(!result.has(value.url),'Ambiguous compiled battle rebinding: '+value.url);
    result.set(value.url,structuredClone(value));
  }
  return result;
}

async function frameworkUpgradeDeclaration(raw,root,compiledDir){
  if(raw===undefined)return null;
  const animated=raw?.kind==='compiled-framework-profile-upgrade-v4';
  const periodic=raw?.kind==='compiled-framework-profile-upgrade-v3'||animated&&Object.hasOwn(raw?.markers??{},'worldMap');
  const logical=raw?.kind==='compiled-framework-profile-upgrade-v2'||(periodic||animated)&&Object.hasOwn(raw,'logicalFieldEffects');
  dataFields(raw,['kind','compilerDigest','markers',...(logical?['logicalFieldEffects']:[])],'framework profile upgrade declaration');
  assert.ok(['compiled-framework-profile-upgrade-v1','compiled-framework-profile-upgrade-v2','compiled-framework-profile-upgrade-v3','compiled-framework-profile-upgrade-v4'].includes(raw.kind),'Unknown framework profile upgrade version');
  assert.ok(typeof raw.compilerDigest==='string'&&digest.test(raw.compilerDigest),'Invalid framework profile upgrade compiler digest');
  const hosts={...frameworkHostMarkers,...(animated?{mapAnimatedEntities:{value:'web-field-animated-map-entities-v1',module:'field-map-animation',exportName:'WEB_FIELD_MAP_ANIMATION',provider:'prepareFieldMapAnimations'}}:{}),...(logical?{logicalFieldEffects:logicalMarker}:{}),...(periodic?periodicMarkers:{})};
  dataFields(raw.markers,Object.keys(hosts),'framework profile upgrade markers');
  const result=structuredClone(raw),providers=[];
  for(const [marker,definition] of Object.entries(hosts)){
    assert.equal(result.markers[marker],definition.value,'Unavailable or unknown framework profile upgrade marker: '+marker);
    const path=resolve(root,compiledDir,'src/core',definition.module+'.js');
    let module,bytes;
    try{bytes=await readFile(path);module=await import(pathToFileURL(path).href);}
    catch(error){throw new Error('Framework profile upgrade host unavailable: '+marker,{cause:error});}
    assert.equal(module[definition.exportName],definition.value,'Framework profile upgrade host unavailable: '+marker);
    assert.equal(typeof module[definition.provider],'function','Framework profile upgrade host unavailable: '+marker);
    providers.push({marker,value:definition.value,module:'src/core/'+definition.module+'.js',
      exportName:definition.exportName,provider:definition.provider,sha256:sha(bytes)});
  }
  if(logical){
    const [{validateLogicalEffectCatalog},{hash}]=await Promise.all([
      import(pathToFileURL(resolve(root,compiledDir,'src/core/field-logical-effects.js')).href),
      import(pathToFileURL(resolve(root,compiledDir,'src/compiler/content.js')).href)]);
    const catalog=result.logicalFieldEffects,policy=catalog?.webPolicy;
    assert.ok(policy,'Framework profile upgrade requires a compiled logical effect catalog');
    validateLogicalEffectCatalog(catalog);
    assert.equal(policy.catalogHash,hash({sourceSetHash:policy.sourceSetHash,parentSourceSetHash:policy.parentSourceSetHash,
      media:catalog.media,proofs:policy.proofs}),'Framework profile upgrade logical catalog identity mismatch');
  }
  return {...result,providers};
}

/** One narrowly versioned additive comparison. The actual candidate remains
 * untouched and keeps its new profile/hash. No existing value may be removed
 * or changed, and no other profile field is normalized by this declaration. */
function comparableFrameworkUpgrade(before,after,ref,declaration,canonical){
  if(!declaration)return {after,upgrade:null};
  const previous=before.developmentProfile,next=after.developmentProfile;
  if(['compiled-framework-profile-upgrade-v3','compiled-framework-profile-upgrade-v4'].includes(declaration.kind)&&
      ['world-map-development','field-development'].includes(after.kind)) {
    // A marker proof is not a presentation/media/geometry migration proof.
    // In particular, same physical SourceRefs do not establish unchanged
    // topology, tile arrays, textures or a newly added alternative.
    for(const key of ['map','frameworkPresentation','actorView','entryView','partyEntry','cameraHost'])
      assert.equal(canonical(before[key]??null),canonical(after[key]??null),
        'Framework profile upgrade periodic geometry or presentation changed: '+key);
  }
  const keys=Object.keys(declaration.markers);
  const changes=keys.filter(key=>Object.hasOwn(previous??{},key)!==Object.hasOwn(next??{},key)||
    canonical(previous?.[key]??null)!==canonical(next?.[key]??null));
  if(!changes.length)return {after,upgrade:null};
  assert.ok(previous?.kind==='framework-development-v1'&&next?.kind==='framework-development-v1',
    'Framework profile upgrade requires an existing framework profile');
  const comparison=structuredClone(after),addedMarkers=[];
  for(const key of changes){
    assert.ok(!Object.hasOwn(previous,key)&&Object.hasOwn(next,key),
      'Framework profile upgrade cannot remove or change marker: '+key);
    assert.equal(next[key],declaration.markers[key],'Unavailable or unknown framework profile upgrade marker: '+key);
    delete comparison.developmentProfile[key];
    addedMarkers.push({key,previous:null,next:next[key]});
  }
  let logicalFieldEffects=null;
  if(changes.includes('logicalFieldEffects')){
    const catalog=declaration.logicalFieldEffects,policy=catalog.webPolicy;
    assert.equal(after.sourceSetHash,policy.sourceSetHash,'Framework profile upgrade logical source mismatch');
    assert.equal(after.parentSourceSetHash,policy.parentSourceSetHash,'Framework profile upgrade logical parent mismatch');
    if(after.kind==='world-map-development'){
      assert.equal(canonical(after.fieldEffects),canonical(catalog),'Framework profile upgrade requires the same compiled logical catalog on every map');
      assert.equal(before.fieldEffects?.webPolicy,undefined,'Framework profile upgrade cannot replace an existing logical owner');
      // This exact, separately audited catalog projection is the sole metadata
      // exception. All physical map/entities/scripts/assets outside it remain
      // in the ordinary full source/profile/media identity comparison.
      if(before.fieldEffects===undefined)delete comparison.fieldEffects;
      else comparison.fieldEffects=structuredClone(before.fieldEffects);
      logicalFieldEffects={catalogHash:policy.catalogHash,previousCatalog:structuredClone(before.fieldEffects??null),
        candidateCatalog:structuredClone(catalog),display:policy.display,nativeParity:false};
    }else assert.equal(after.fieldEffects,undefined,'Framework logical catalog belongs to map owners');
  }
  return {after:comparison,upgrade:{kind:declaration.kind,compilerDigest:declaration.compilerDigest,
    pointer:ref.pointer+'/developmentProfile',role:ref.role,url:ref.url,
    oldHash:before.contentHash,newHash:after.contentHash,addedMarkers,providers:structuredClone(declaration.providers),
    profileBefore:structuredClone(previous),profileAfter:structuredClone(next),
    logicalFieldEffects,grantsSourceAdmission:false,saveMigration:false}};
}

function identities(value,canonical,sourceCatalogProfile){
  const physical=new Map(),media=[];
  function scan(node,path=[]){
    if(!node||typeof node!=='object')return;
    if(!Array.isArray(node)&&typeof node.file==='string'&&
        (typeof node.assetPath==='string'||typeof node.sha256==='string')){
      const source=Object.fromEntries(['file','assetPath','objectId','serializedFile','sha256','sourceSetHash']
        .filter(key=>Object.hasOwn(node,key)).map(key=>[key,node[key]]));
      physical.set(canonical(source),source);
    }
    for(const [key,child] of Object.entries(node)){
      const next=[...path,key];
      if(typeof child==='string'&&/^\/[A-Za-z0-9/_-]+\.(?:png|flac)$/.test(child))
        media.push({pointer:pointer(next),url:child,sha256:node.sha256??null});
      else scan(child,next);
    }
  }
  scan(value);
  const profile=structuredClone(value.developmentProfile??null);
  const framework=sourceCatalogProfile(value.developmentProfile);
  if(profile)delete profile.sourceContentHash;
  const sourceEvidence=[...physical].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,source])=>source);
  return {kind:value.kind,formatVersion:value.formatVersion??null,profile:framework,profileDetails:profile,
    sourceSetHash:value.sourceSetHash??value.common?.fieldSourceSetHash??null,
    parentSourceSetHash:value.parentSourceSetHash??null,mediaSourceSetHash:value.mediaSourceSetHash??null,
    mapId:value.mapId??value.map?.identity?.mapId??null,areaId:value.areaId??value.map?.identity?.areaId??null,
    mapIdentity:value.map?.identity??null,mapSource:value.map?.source??null,
    physicalSourceCount:sourceEvidence.length,physicalSourceHash:sha(canonical(sourceEvidence)),
    mediaCount:media.length,mediaBindingsHash:sha(canonical(media.sort((a,b)=>a.pointer<b.pointer?-1:a.pointer>b.pointer?1:0)))};
}

function validateDocument(value,ref){
  assert.equal(value.kind,ref.kind,'Recipe role/content kind mismatch: '+ref.role);
  if(ref.kind==='narshe-battle-catalog'){
    assert.ok(plain(value.common)&&plain(value.gameState),'Missing battle source metadata');return;
  }
  requiredString(value.sourceSetHash,'sourceSetHash');requiredString(value.parentSourceSetHash,'parentSourceSetHash');
  if(ref.kind==='world-map-development'||ref.kind==='world-development')
    requiredString(value.mediaSourceSetHash,'mediaSourceSetHash');
  if(ref.kind==='world-map-development'||ref.kind==='field-development'){
    assert.ok(plain(value.map)&&plain(value.map.source)&&plain(value.map.identity),'Missing physical map identity');
    assert.ok(Number.isInteger(value.map.identity.mapId)&&value.map.identity.mapId>0,'Invalid map identity');
    assert.ok(Number.isInteger(value.map.identity.areaId)&&value.map.identity.areaId>=0,'Invalid area identity');
    requiredString(value.map.source.file,'map.source.file');requiredString(value.map.source.assetPath,'map.source.assetPath');
    if(ref.kind==='world-map-development'){
      assert.equal(value.mapId,value.map.identity.mapId,'Map identity mismatch');
      assert.equal(value.areaId,value.map.identity.areaId,'Area identity mismatch');
    }
  }
  if(ref.kind==='source-new-game-content-v1'){
    for(const key of ['entry','factory','puppetCatalog','view','animationKeys'])assert.ok(plain(value[key]),'Missing source entry '+key);
    for(const key of ['battleCatalogHash','worldCatalogHash','mapContentHash'])assert.match(value[key],digest,'Missing entry dependency '+key);
  }
  if(ref.kind==='world-development'){
    assert.ok(plain(value.maps),'Missing world map index');
    for(const [id,map] of Object.entries(value.maps)){
      assert.ok(/^[1-9]\d*$/.test(id)&&Number.isSafeInteger(Number(id)),'Invalid world map key');
      assert.ok(plain(map)&&(logicalURL.test(map.url)||map.url===linkedMapURL(value,id)),'Invalid world map reference');
      assert.match(map.contentHash,digest,'Invalid world map content hash');
    }
  }
}

function compiledBattleRebinding(before,after,ref,proofs,canonical,sourceCatalogProfile){
  if(before.contentHash===after.contentHash)return null;
  const proof=proofs.get(ref.url);
  assert.ok(proof,'This batch must retain '+ref.role+' content unchanged');
  assert.equal(proof.previousHash,before.contentHash,'Compiled battle previous hash mismatch');
  assert.equal(proof.candidateHash,after.contentHash,'Compiled battle candidate hash mismatch');
  for(const value of [before,after]){
    assert.equal(value.common.sourceContentHash,proof.sourceContentHash,'Compiled battle source content mismatch');
    assert.equal(value.common.fieldSourceSetHash,proof.fieldSourceSetHash,'Compiled battle field source mismatch');
    assert.equal(sha(canonical(value.gameState)),proof.gameStateHash,'Compiled battle owned initializer mismatch');
  }
  assert.equal(canonical(before.gameState),canonical(after.gameState),'Compiled battle owned initializer changed');
  assert.equal(before.common.kind,after.common.kind,'Compiled battle common kind changed');
  assert.equal(before.common.profile,after.common.profile,'Compiled battle common profile changed');
  assert.equal(canonical(before.common.sprites),canonical(after.common.sprites),'Compiled battle media bindings changed');
  const sourceIdentityBefore=identities(before,canonical,sourceCatalogProfile),
    sourceIdentityAfter=identities(after,canonical,sourceCatalogProfile);
  // New compiler capability metadata may add or replace explicit SourceRefs.
  // Keep both identities in the report rather than normalizing their counts or
  // hashes to pretend the physical evidence stayed identical. Every other
  // source/profile/media identity must still be exactly preserved.
  const invariant=({physicalSourceCount:_,physicalSourceHash:__,...identity})=>identity;
  assert.equal(canonical(invariant(sourceIdentityBefore)),canonical(invariant(sourceIdentityAfter)),
    'Compiled battle source/profile/media identity changed');
  return {...proof,profile:sourceIdentityAfter.profile,sourceIdentityBefore,sourceIdentityAfter};
}

/** Historical compiler changes and a single metadata addition are separate
 * proofs. A baseline is independently compiled by the input-locked producer,
 * including its encounter body; it is never after.common with a field deleted. */
async function auditCompiledMessageFeeAddition({before,after,ref,proofs,declaration,evidence,baselines,canonical,verifyContent,sourceCatalogProfile}) {
  const needsAddition=before.kind==='narshe-battle-catalog' &&
    before.common?.sourceMessageFees===undefined && after.common?.sourceMessageFees!==undefined;
  if(!needsAddition || baselines===undefined)
    return auditSourceMessageFeeAddition({before,after,declaration,evidence,canonical});
  assert.ok(baselines instanceof Map,'Source fee baselines must be trusted compiler products');
  const raw=baselines.get(ref.url);
  dataFields(raw,['baseline','rebinding'],'source fee compiler baseline');
  const baseline=structuredClone(raw.baseline);
  await verifyContent(baseline);
  assert.equal(baseline.kind,'narshe-battle-catalog');
  assert.equal(baseline.common?.sourceMessageFees,undefined,'Source fee baseline already has the addition');
  const baselineProofs=parseBattleRebindings([raw.rebinding]),baselineProof=baselineProofs.get(ref.url),finalProof=proofs.get(ref.url),
    declarationProof=parseSourceMessageFeeAddition(declaration);
  assert.ok(baselineProof&&finalProof&&declarationProof,'Source fee baseline requires both compiler rebindings and the addition declaration');
  assert.equal(baselineProof.candidateHash,baseline.contentHash,'Source fee baseline candidate hash mismatch');
  assert.equal(baselineProof.compilerDigest,declarationProof.compilerDigest,'Source fee baseline compiler mismatch');
  assert.equal(finalProof.compilerDigest,declarationProof.compilerDigest,'Source fee candidate compiler mismatch');
  for(const key of ['previousHash','sourceContentHash','fieldSourceSetHash','gameStateHash'])
    assert.equal(baselineProof[key],finalProof[key],'Source fee baseline rebinding mismatch: '+key);
  const historical=compiledBattleRebinding(before,baseline,ref,baselineProofs,canonical,sourceCatalogProfile);
  // No-fee and with-fee compilation must differ only in that common field.
  const outsideCommon=value=>{const{contentHash:_,common:__,...body}=value;return body;};
  assert.equal(canonical(outsideCommon(baseline)),canonical(outsideCommon(after)),'Source fee addition changed the compiler baseline body');
  const audit=await auditSourceMessageFeeAddition({before:baseline,after,declaration,evidence,canonical});
  assert.ok(audit,'Source fee compiler baseline did not prove an addition');
  return {...audit,compilationBaseline:{kind:'same-input-compiled-message-fee-baseline-v1',url:ref.url,
    policy:'omit-source-message-fees-for-addition-audit-v1',contentHash:baseline.contentHash,
    commonHash:sha(canonical(baseline.common)),compilerDigest:baselineProof.compilerDigest,
    historicalRebinding:historical,originalPinnedHash:before.contentHash,
    originalPinnedCommonHash:sha(canonical(before.common)),sourceOwnedBytesUnchanged:true}};
}

/** The proof is supplied by the trusted same-candidate compiler, never by a
 * recipe or save. It binds an exact URL and old/new body hashes; this helper
 * grants no source gameplay readiness and performs no save migration. */
export async function resolveCompiledBattleReference({reference,readCurrentJson,readCandidateJson,
    battleRebindings,sourceMessageFeeAddition,sourceMessageFeeEvidence,sourceMessageFeeBaselines,root=repository,compiledDir='dist'}){
  dataFields(reference,['url','contentHash'],'compiled battle reference');
  assert.ok(typeof reference.url==='string'&&jsonURL.test(reference.url),'Invalid compiled battle reference URL');
  assert.ok(typeof reference.contentHash==='string'&&digest.test(reference.contentHash),'Invalid compiled battle reference hash');
  assert.equal(typeof readCurrentJson,'function');assert.equal(typeof readCandidateJson,'function');
  const ref={...structuredClone(reference),role:'battle',kind:'narshe-battle-catalog'},
    proofs=parseBattleRebindings(battleRebindings);
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/core',name+'.js')).href);
  const [{canonical},{verifyContent},{sourceCatalogProfile}]=await Promise.all([
    load('canonical'),load('content-integrity'),load('source-catalog')]);
  const before=structuredClone(await readCurrentJson(ref.url));
  assert.ok(plain(before),'Missing content for '+ref.url);
  await verifyContent(before,ref.contentHash);
  const after=structuredClone(await readCandidateJson(ref.url));
  assert.ok(plain(after),'Missing content for '+ref.url);
  await verifyContent(after);
  validateDocument(before,ref);validateDocument(after,ref);
  const feeAudit=await auditCompiledMessageFeeAddition({before,after,ref,proofs,declaration:sourceMessageFeeAddition,evidence:sourceMessageFeeEvidence??(sourceMessageFeeAddition?createSourceMessageFeeEvidenceReader({root,compiledDir}):undefined),baselines:sourceMessageFeeBaselines,canonical,verifyContent,sourceCatalogProfile});
  const report=compiledBattleRebinding(before,after,ref,proofs,canonical,sourceCatalogProfile);
  if(report&&feeAudit)report.sourceMessageFeeAddition=feeAudit;
  return {reference:{url:ref.url,contentHash:after.contentHash},report};
}

/** One fresh source-table reader per collection preparation. Only the small
 * table index is retained; the source corpus is not kept by every recipe. */
export function createSourceWalkEvidenceReader({root=repository,compiledDir='dist'}={}){
  let source=null;
  return async map=>{
    const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/compiler',name+'.js')).href);
    const [{loadSystemSource},{compileSourceWalkEncounterDependencies}]=await Promise.all([
      load('system-source'),load('world')]);
    source??=(async()=>{
      const loaded=await loadSystemSource(root,map.parentSourceSetHash);
      return {reader:loaded.reader,sourceSetHash:loaded.sourceSetHash,parentSourceSetHash:loaded.manifest.parentSourceSetHash};
    })();
    const data=await source;
    assert.equal(data.sourceSetHash,map.sourceSetHash,'Walking evidence corpus identity mismatch');
    assert.equal(data.parentSourceSetHash,map.parentSourceSetHash,'Walking evidence parent identity mismatch');
    return compileSourceWalkEncounterDependencies(data.reader,map.mapId);
  };
}

async function mapAnimationAdditionDeclaration(raw,root,compiledDir){
  if(raw===undefined)return null;
  dataFields(raw,['kind','compilerDigest','sourceSetHash','parentSourceSetHash'],'map animation source addition declaration');
  assert.equal(raw.kind,'compiled-source-map-animation-import-addition-v1','Unknown map animation source addition declaration');
  for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash'])assert.ok(typeof raw[key]==='string'&&digest.test(raw[key]),'Invalid map animation source addition '+key);
  const modules=[];
  for(const name of ['entity-group','world','field-animation-import']){
    const file=resolve(root,compiledDir,'src/compiler',name+'.js'),bytes=await readFile(file);
    modules.push({module:'src/compiler/'+name+'.js',sha256:sha(bytes)});
  }
  return {...structuredClone(raw),modules};
}

/** A complete verified source snapshot supplies the exact package-local raw
 * aliases and route objects. Neither a recipe nor a save may supply this proof. */
export function createSourceNpcRouteEvidenceReader({root=repository,compiledDir='dist'}={}){
  let source=null;const results=new Map();
  return async map=>{
    source??=(async()=>{
      const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/compiler',name+'.js')).href);
      const [{loadCorpus},{compileFieldNpcRoutes},{hash}]=await Promise.all([load('corpus'),load('field-npc-route'),load('content')]);
      const snapshot=await loadCorpus(root);return {snapshot,compileFieldNpcRoutes,hash,sourceDigest:hash(snapshot)};
    })();
    const data=await source;
    assert.equal(data.snapshot.sourceSetHash,map.sourceSetHash,'NPC route evidence corpus identity mismatch');
    assert.equal(data.snapshot.manifest.parentSourceSetHash,map.parentSourceSetHash,'NPC route evidence parent identity mismatch');
    if(!results.has(map.mapId)){
      const result=data.compileFieldNpcRoutes(data.snapshot,map.mapId),catalog=result.catalog;
      assert.ok(catalog,'Missing complete package-local source NPC route catalog');
      const pkg=data.snapshot.assets.filter(a=>a.kind==='map-package'&&a.source.file===catalog.packageSource.file&&
        a.source.assetPath===catalog.packageSource.assetPath&&a.source.objectId===catalog.packageSource.objectId);
      assert.equal(pkg.length,1,'NPC route evidence package identity is ambiguous');
      const selected=pkg[0].data.map.filter(m=>m.name===catalog.mapName);assert.equal(selected.length,1,'NPC route evidence map is ambiguous');
      results.set(map.mapId,{kind:'verified-source-npc-route-evidence-v1',sourceDigest:data.sourceDigest,
        sourceSetHash:data.snapshot.sourceSetHash,parentSourceSetHash:data.snapshot.manifest.parentSourceSetHash,
        rawAliasHash:data.hash(selected[0].route_instruction??[]),rawAliases:structuredClone(selected[0].route_instruction??[]),
        catalog,report:result.report,diagnostics:result.diagnostics});
    }
    return structuredClone(results.get(map.mapId));
  };
}

async function npcRouteAdditionDeclaration(raw,root,compiledDir){
  if(raw===undefined)return null;
  dataFields(raw,['kind','compilerDigest','sourceSetHash','parentSourceSetHash'],'NPC route source addition declaration');
  assert.equal(raw.kind,'compiled-source-npc-route-evidence-addition-v1','Unknown NPC route source addition declaration');
  for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash'])assert.ok(typeof raw[key]==='string'&&digest.test(raw[key]),'Invalid NPC route addition '+key);
  const path=resolve(root,compiledDir,'src/compiler/field-npc-route.js'),bytes=await readFile(path),module=await import(pathToFileURL(path).href);
  assert.equal(typeof module.compileFieldNpcRoutes,'function','Source NPC route compiler unavailable');
  return {...structuredClone(raw),compiler:{module:'src/compiler/field-npc-route.js',sha256:sha(bytes)}};
}

/** Readers return parsed JSON for the same logical URL. Each value is detached
 * before asynchronous verification. Callers retain byte/path freshness checks
 * and complete package validation at their publication boundary. */
export async function resolveSourceRecipeInputs({recipePath,recipeBytes,readCurrentJson,readCandidateJson,
    root=repository,compiledDir='dist',sourceWalkEvidence,battleRebindings,frameworkProfileUpgrade,sourceMapAnimationAddition,sourceMapAnimationEvidence,sourceNpcRoutesAddition,sourceNpcRouteEvidence,
    frameworkNpcAreaAddition,frameworkNpcAreaEvidence,sourceEventActivationAddition,sourceEventActivationEvidence,frameworkNpcFlatAddition,frameworkNpcFlatEvidence,frameworkFieldEffectFlatAddition,frameworkFieldEffectFlatEvidence,sourceMessageFeeAddition,sourceMessageFeeEvidence,sourceMessageFeeBaselines}){
  assert.ok(typeof recipePath==='string'&&recipePath.length>0,'Missing original recipe path');
  assert.equal(typeof readCurrentJson,'function');assert.equal(typeof readCandidateJson,'function');
  const recipe=recipeJSON(recipeBytes),refs=declaredReferences(recipe),proofs=parseBattleRebindings(battleRebindings);
  const report={kind:'source-recipe-inputs-v1',id:recipe.id,recipeKind:recipe.kind,recipePath,
    recipeSha256:sha(recipeBytes),changes:[],dependencyRebindings:[],sourceIdentities:[],sourceEvidenceEnrichments:[],
    battleCapabilityRebindings:[],frameworkProfileUpgrades:[],sourceMapAnimationAdditions:[],sourceNpcRouteAdditions:[]};
  parseSourceMessageFeeAddition(sourceMessageFeeAddition);
  sourceMessageFeeEvidence??=sourceMessageFeeAddition?createSourceMessageFeeEvidenceReader({root,compiledDir}):undefined;
  if(sourceMessageFeeAddition)report.sourceMessageFeeAdditions=[];
  const frameworkUpgrade=await frameworkUpgradeDeclaration(frameworkProfileUpgrade,root,compiledDir);
  const eventActivationAddition=parseSourceEventActivationAddition(sourceEventActivationAddition);
  if(eventActivationAddition)report.sourceEventActivationAdditions=[];
  const eventActivationEvidence=sourceEventActivationEvidence??(eventActivationAddition?createSourceEventActivationEvidenceReader({root,compiledDir}):undefined);
  const animationAddition=await mapAnimationAdditionDeclaration(sourceMapAnimationAddition,root,compiledDir);
  sourceMapAnimationEvidence??=createSourceMapAnimationEvidenceReader({root,compiledDir});
  const npcRouteAddition=await npcRouteAdditionDeclaration(sourceNpcRoutesAddition,root,compiledDir);
  const npcAreaAddition=parseFrameworkNpcAreaAddition(frameworkNpcAreaAddition);
  if(npcAreaAddition)report.frameworkNpcAreaAdditions=[];
  const npcFlatAddition=parseFrameworkNpcFlatAddition(frameworkNpcFlatAddition);
  if(npcFlatAddition)report.frameworkNpcFlatAdditions=[];
  const effectFlatAddition=parseFrameworkFieldEffectFlatAddition(frameworkFieldEffectFlatAddition);
  if(effectFlatAddition)report.frameworkFieldEffectFlatAdditions=[];
  if(refs.length===0)return {recipe,report};
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/core',name+'.js')).href);
  const [{canonical},{verifyContent},{sourceCatalogProfile}]=await Promise.all([
    load('canonical'),load('content-integrity'),load('source-catalog')]);
  const oldCache=new Map(),newCache=new Map(),documents=new Map(),omissionMaps=new Map();
  sourceWalkEvidence??=createSourceWalkEvidenceReader({root,compiledDir});
  sourceNpcRouteEvidence??=createSourceNpcRouteEvidenceReader({root,compiledDir});
  async function comparableNpcRoutes(before,after,role,url,actualBefore=before,actualAfter=after){
    if(before.npcRoutes===undefined&&after.npcRoutes===undefined)return {before,after};
    assert.equal(before.kind,'world-map-development','NPC route evidence belongs only to source map packages');
    assert.equal(after.kind,'world-map-development','NPC route evidence belongs only to source map packages');
    assert.ok(after.npcRoutes!==undefined,'Existing source NPC route catalog cannot be removed');
    if(!npcRouteAddition){assert.equal(canonical(before.npcRoutes??null),canonical(after.npcRoutes),'NPC route source addition requires an explicit compiler declaration');return {before,after};}
    assert.equal(after.sourceSetHash,npcRouteAddition.sourceSetHash,'NPC route addition source set mismatch');
    assert.equal(after.parentSourceSetHash,npcRouteAddition.parentSourceSetHash,'NPC route addition parent mismatch');
    const evidence=await sourceNpcRouteEvidence(after);
    assert.equal(evidence.kind,'verified-source-npc-route-evidence-v1','Invalid NPC route source evidence');
    for(const key of ['sourceDigest','rawAliasHash'])assert.ok(typeof evidence[key]==='string'&&digest.test(evidence[key]),'Invalid NPC route evidence '+key);
    assert.equal(evidence.sourceSetHash,after.sourceSetHash,'NPC route evidence source mismatch');
    assert.equal(evidence.parentSourceSetHash,after.parentSourceSetHash,'NPC route evidence parent mismatch');
    const {parseFieldNpcRouteCatalog}=await load('field-npc-route');
    const expected=parseFieldNpcRouteCatalog(evidence.catalog),candidate=parseFieldNpcRouteCatalog(after.npcRoutes);
    const report=evidence.report;
    assert.equal(expected.mapId,after.mapId,'NPC route addition map mismatch');
    assert.equal(expected.sourceSetHash,after.sourceSetHash,'NPC route catalog source mismatch');
    assert.equal(expected.parentSourceSetHash,after.parentSourceSetHash,'NPC route catalog parent mismatch');
    assert.equal(canonical(candidate),canonical(expected),'NPC route addition differs from complete verified source catalog');
    assert.ok(Array.isArray(evidence.rawAliases)&&report?.mapId===after.mapId&&report.parse?.invalid===0&&
      report.parse.declared===evidence.rawAliases.length&&report.parse.parsed===evidence.rawAliases.length&&
      Object.keys(expected.routes).length===evidence.rawAliases.length&&report.binding?.blocked===0,
      'NPC route addition requires the complete unambiguous raw alias/catalog domain');
    assert.equal(sha(canonical(evidence.rawAliases)),evidence.rawAliasHash,'NPC route raw alias digest mismatch');
    for(const alias of evidence.rawAliases){assert.ok(plain(alias)&&Object.keys(alias).sort().join(',')==='asset,name'&&typeof alias.asset==='string','Invalid raw NPC route alias');
      const found=Object.values(expected.routes).filter(r=>r.alias===alias.name);assert.equal(found.length,1,'NPC route raw alias is not retained');}
    if(before.npcRoutes!==undefined)assert.equal(canonical(parseFieldNpcRouteCatalog(before.npcRoutes)),canonical(expected),'Existing source NPC route catalog cannot be changed');
    const comparisonBefore=structuredClone(before),comparisonAfter=structuredClone(after);
    delete comparisonBefore.npcRoutes;delete comparisonAfter.npcRoutes;
    const fullBefore=identities(actualBefore,canonical,sourceCatalogProfile),fullAfter=identities(actualAfter,canonical,sourceCatalogProfile);
    reportSourceRouteAddition({role,url,mapId:after.mapId,declaration:npcRouteAddition,evidence,
      beforeCatalog:before.npcRoutes??null,candidateCatalog:after.npcRoutes,
      sourceIdentityBefore:fullBefore,sourceIdentityAfter:fullAfter});
    return {before:comparisonBefore,after:comparisonAfter};
  }
  function reportSourceRouteAddition(value){report.sourceNpcRouteAdditions.push({...structuredClone(value),
    grantsSourceAdmission:false,saveMigration:false,normalization:'only exact verified npcRoutes metadata; all remaining whole identities compared unchanged'});}

  async function comparableWalkingEvidence(before,after,role,url){
    if(before.sourceWalkEncounters===undefined&&after.sourceWalkEncounters===undefined)return {before,after};
    assert.equal(before.kind,'world-map-development','Walking evidence requires a source map');
    assert.equal(after.kind,'world-map-development','Walking evidence requires a source map');
    assert.ok(after.sourceWalkEncounters!==undefined,'Walking source evidence cannot be removed');
    for(const value of [before,after])if(value.sourceWalkEncounters!==undefined){
      const expected=await sourceWalkEvidence(value);
      assert.equal(canonical(value.sourceWalkEncounters),canonical(expected),
        'Walking source evidence differs from the verified original table rows');
    }
    const originalBefore=identities(before,canonical,sourceCatalogProfile),originalAfter=identities(after,canonical,sourceCatalogProfile);
    const comparisonBefore=structuredClone(before),comparisonAfter=structuredClone(after);
    delete comparisonBefore.sourceWalkEncounters;delete comparisonAfter.sourceWalkEncounters;
    report.sourceEvidenceEnrichments.push({role,url,mapId:after.mapId,
      before:before.sourceWalkEncounters===undefined?null:sha(canonical(before.sourceWalkEncounters)),
      after:sha(canonical(after.sourceWalkEncounters)),
      physicalSourceBefore:{count:originalBefore.physicalSourceCount,hash:originalBefore.physicalSourceHash},
      physicalSourceAfter:{count:originalAfter.physicalSourceCount,hash:originalAfter.physicalSourceHash},
      evidence:'exact metadata reconstructed from verified original map/monster-set table rows; no walking execution grant'});
    return {before:comparisonBefore,after:comparisonAfter};
  }
  async function read(reader,cache,url,expected){
    if(!cache.has(url))cache.set(url,(async()=>{
      const value=structuredClone(await reader(url));assert.ok(plain(value),'Missing content for '+url);
      return verifyContent(value,expected);
    })());
    const value=await cache.get(url);
    if(expected!==undefined)assert.equal(value.contentHash,expected,'Content identity mismatch: '+url);
    return value;
  }
  async function omissionSourceMaps(mapId){
    if(!omissionMaps.has(mapId))omissionMaps.set(mapId,(async()=>{
      const url='/world/maps/'+mapId+'.json';
      const before=await read(readCurrentJson,oldCache,url),after=await read(readCandidateJson,newCache,url);
      for(const value of [before,after]){
        validateDocument(value,{kind:'world-map-development',role:'omission source map'});
        assert.equal(value.mapId,mapId,'Omission source map identity mismatch');
        assert.ok(value.developmentProfile===undefined&&value.frameworkPresentation===undefined&&
          value.walkEncounters===undefined&&!(value.developmentOmissions?.length),'Omission requires a strict source map');
      }
      const routed=await comparableNpcRoutes(before,after,'omission source map',url);
      const comparison=await comparableWalkingEvidence(routed.before,routed.after,'omission source map',url);
      assert.equal(canonical(identities(comparison.before,canonical,sourceCatalogProfile)),
        canonical(identities(comparison.after,canonical,sourceCatalogProfile)),'Omission source identity/profile/media changed');
      return {url,before,after};
    })());
    return omissionMaps.get(mapId);
  }
  async function comparableAfter(before,after,ref){
    // Only an independently verified strict-map dependency may differ inside
    // the profile. The actual payload and resolved recipe remain unmodified.
    if(before.developmentProfile===undefined||after.developmentProfile===undefined)return after;
    sourceCatalogProfile(before.developmentProfile);sourceCatalogProfile(after.developmentProfile);
    const old=before.developmentProfile.omissions,next=after.developmentProfile.omissions;
    assert.equal(next.length,old.length,'Framework omission membership changed');
    const comparison=structuredClone(after);
    for(let i=0;i<old.length;i++){
      for(const omission of [old[i],next[i]]){
        assert.ok(plain(omission),'Invalid framework omission');
        assert.deepEqual(Object.keys(omission).sort(),
          ['entityId','group','kind','mapId','reason','source','sourceMapContentHash'],'Invalid framework omission fields');
        assert.equal(omission.kind,'field-effect','Unknown framework omission kind');
        assert.ok(Number.isInteger(omission.mapId)&&omission.mapId>0&&omission.mapId<=0x7fffffff,'Invalid omission map identity');
        for(const key of ['entityId','group','reason'])requiredString(omission[key],'omission.'+key);
        assert.ok(plain(omission.source),'Missing omission SourceRef');assert.match(omission.sourceMapContentHash,digest);
      }
      const semantic=({sourceMapContentHash:_,...omission})=>omission;
      assert.equal(canonical(semantic(old[i])),canonical(semantic(next[i])),
        'Framework omission membership/source/reason changed');
      const maps=await omissionSourceMaps(old[i].mapId);
      for(const [value,omission,sourceMap] of [[before,old[i],maps.before],[after,next[i],maps.after]]){
        assert.equal(omission.sourceMapContentHash,sourceMap.contentHash,'Omission source map dependency mismatch');
        for(const key of ['sourceSetHash','parentSourceSetHash','mediaSourceSetHash'])
          if(value[key]!==undefined)assert.equal(value[key],sourceMap[key],'Omission source map parent/media mismatch');
        const group=sourceMap.map.groups?.[omission.group];
        assert.ok(group&&group.name===omission.group&&Array.isArray(group.entities),'Missing omission source group');
        const entities=group.entities.filter(entity=>entity.id===omission.entityId);
        assert.equal(entities.length,1,'Missing or ambiguous omission source entity');
        assert.equal(entities[0].kind,11,'Omission source entity is not a field effect');
        assert.equal(canonical(entities[0].source),canonical(omission.source),'Omission source entity SourceRef mismatch');
      }
      assert.equal(canonical(maps.before.map.groups[old[i].group].source),
        canonical(maps.after.map.groups[next[i].group].source),'Omission source group identity changed');
      comparison.developmentProfile.omissions[i].sourceMapContentHash=old[i].sourceMapContentHash;
      if(old[i].sourceMapContentHash!==next[i].sourceMapContentHash)report.dependencyRebindings.push({
        pointer:ref.pointer+'/developmentProfile/omissions/'+i+'/sourceMapContentHash',role:ref.role,url:maps.url,
        mapId:old[i].mapId,oldHash:old[i].sourceMapContentHash,newHash:next[i].sourceMapContentHash});
    }
    return comparison;
  }
  for(const ref of refs){
    const before=await read(readCurrentJson,oldCache,ref.url,ref.contentHash);
    const after=await read(readCandidateJson,newCache,ref.url);
    validateDocument(before,ref);validateDocument(after,ref);
    let eventAfter=after;
    if(['world-development','world-map-development'].includes(after.kind)){
      if(sourceEventActivationChanged(before,after,canonical))assert.ok(eventActivationAddition,'Source event activation addition proof is required');
      if(eventActivationAddition){
        assert.equal(after.sourceSetHash,eventActivationAddition.sourceSetHash,'Event activation source mismatch');
        assert.equal(after.parentSourceSetHash,eventActivationAddition.parentSourceSetHash,'Event activation parent mismatch');
        const evidence=await eventActivationEvidence(after),result=compareSourceEventActivationAddition(before,after,evidence,eventActivationAddition);
        eventAfter=result.after;
        if(result.audit)report.sourceEventActivationAdditions.push({pointer:ref.pointer,role:ref.role,url:ref.url,
          previousHash:before.contentHash,candidateHash:after.contentHash,...result.audit,
          sourceIdentityBefore:identities(before,canonical,sourceCatalogProfile),sourceIdentityAfter:identities(after,canonical,sourceCatalogProfile)});
      }
    }
    let animationAfter=eventAfter;
    if(animationAddition&&['world-development','world-map-development'].includes(after.kind)){
      assert.equal(after.sourceSetHash,animationAddition.sourceSetHash,'Animation source addition source mismatch');
      assert.equal(after.parentSourceSetHash,animationAddition.parentSourceSetHash,'Animation source addition parent mismatch');
      const evidence=await sourceMapAnimationEvidence(after),result=compareSourceMapAnimationAddition(before,eventAfter,evidence,animationAddition);
      animationAfter=result.after;
      if(result.audit)report.sourceMapAnimationAdditions.push({pointer:ref.pointer,role:ref.role,url:ref.url,
        previousHash:before.contentHash,candidateHash:after.contentHash,...result.audit,
        sourceIdentityBefore:identities(before,canonical,sourceCatalogProfile),sourceIdentityAfter:identities(after,canonical,sourceCatalogProfile)});
    }
    const omissionsAfter=await comparableAfter(before,animationAfter,ref);
    const npcArea=await comparableFrameworkNpcAreaAddition({before,after:omissionsAfter,proof:npcAreaAddition,
      evidence:frameworkNpcAreaEvidence,canonical});
    if(npcArea.addition)report.frameworkNpcAreaAdditions.push({pointer:ref.pointer,role:ref.role,url:ref.url,
      previousHash:before.contentHash,candidateHash:after.contentHash,...npcArea.addition,
      sourceIdentityBefore:identities(before,canonical,sourceCatalogProfile),
      sourceIdentityAfter:identities(after,canonical,sourceCatalogProfile)});
    const npcFlat=await comparableFrameworkNpcFlatAddition({before,after:npcArea.after,proof:npcFlatAddition,evidence:frameworkNpcFlatEvidence,canonical});
    if(npcFlat.addition)report.frameworkNpcFlatAdditions.push({pointer:ref.pointer,role:ref.role,url:ref.url,previousHash:before.contentHash,candidateHash:after.contentHash,...npcFlat.addition,
      sourceIdentityBefore:identities(before,canonical,sourceCatalogProfile),sourceIdentityAfter:identities(after,canonical,sourceCatalogProfile)});
    const effectFlat=await comparableFrameworkFieldEffectFlatAddition({before,after:npcFlat.after,proof:effectFlatAddition,evidence:frameworkFieldEffectFlatEvidence,canonical});
    if(effectFlat.addition)report.frameworkFieldEffectFlatAdditions.push({pointer:ref.pointer,role:ref.role,url:ref.url,previousHash:before.contentHash,candidateHash:after.contentHash,...effectFlat.addition,
      sourceIdentityBefore:identities(before,canonical,sourceCatalogProfile),sourceIdentityAfter:identities(after,canonical,sourceCatalogProfile)});
    const upgraded=comparableFrameworkUpgrade(before,effectFlat.after,ref,frameworkUpgrade,canonical);
    const comparisonAfter=upgraded.after;
    const routed=await comparableNpcRoutes(before,comparisonAfter,ref.role,ref.url,before,after);
    const comparison=await comparableWalkingEvidence(routed.before,routed.after,ref.role,ref.url);
    const oldIdentity=identities(comparison.before,canonical,sourceCatalogProfile),
      newIdentity=identities(comparison.after,canonical,sourceCatalogProfile);
    const feeAudit=await auditCompiledMessageFeeAddition({before,after,ref,proofs,declaration:sourceMessageFeeAddition,evidence:sourceMessageFeeEvidence,baselines:sourceMessageFeeBaselines,canonical,verifyContent,sourceCatalogProfile});
    if(feeAudit)report.sourceMessageFeeAdditions.push({pointer:ref.pointer,role:ref.role,url:ref.url,...feeAudit});
    const battleRebinding=ref.kind==='narshe-battle-catalog'
      ?compiledBattleRebinding(before,after,ref,proofs,canonical,sourceCatalogProfile):null;
    if(battleRebinding)report.battleCapabilityRebindings.push({pointer:ref.pointer,role:ref.role,...battleRebinding});
    else assert.equal(canonical(oldIdentity),canonical(newIdentity),'Source identity/profile/media changed: '+ref.role);
    if(upgraded.upgrade)report.frameworkProfileUpgrades.push({...upgraded.upgrade,
      // These are the unmodified full identities, including physical/media
      // counts and hashes. Existing walking/omission evidence has its own
      // independent receipts; their effects are never hidden in this audit.
      profileAfter:structuredClone(after.developmentProfile),
      sourceIdentityBefore:identities(before,canonical,sourceCatalogProfile),
      sourceIdentityAfter:identities(after,canonical,sourceCatalogProfile),
      comparisonIdentityBefore:oldIdentity,comparisonIdentityAfter:newIdentity});
    if(ref.kind==='field-development')
      assert.equal(after.contentHash,before.contentHash,'This batch must retain '+ref.role+' content unchanged');
    if(ref.kind==='source-new-game-content-v1'){
      const semantic=value=>{const copy=structuredClone(value);
        for(const key of ['contentHash','battleCatalogHash','worldCatalogHash','mapContentHash'])delete copy[key];
        if(copy.developmentProfile)delete copy.developmentProfile.sourceContentHash;return copy;};
      assert.equal(canonical(semantic(before)),canonical(semantic(comparisonAfter)),'Source entry initialization semantics changed');
    }
    if(ref.kind==='world-development'){
      for(const [id,map] of Object.entries(after.maps)){
        const previous=before.maps[id];assert.ok(previous,'World map physical index changed');
        assert.ok(map.url===previous.url||map.url===linkedMapURL(after,id),'World map physical index URL changed');
      }
      const index=value=>Object.fromEntries(Object.entries(value.maps).map(([id,map])=>[id,
        Object.fromEntries(Object.entries(map).filter(([key])=>!['url','contentHash','blockers','defaultGroupReady','geometryReady'].includes(key)))]));
      assert.equal(canonical(index(before)),canonical(index(after)),'World map physical index changed');
    }
    documents.set(ref.role,{before,after,ref});
    report.sourceIdentities.push({pointer:ref.pointer,role:ref.role,url:ref.url,...oldIdentity});
    if(before.contentHash!==after.contentHash){
      let destination=recipe;for(const part of ref.parts)destination=destination[part];
      destination.contentHash=after.contentHash;
      report.changes.push({pointer:ref.pointer+'/contentHash',role:ref.role,url:ref.url,
        oldHash:before.contentHash,newHash:after.contentHash});
    }
  }
  // A valid individual payload is insufficient when its declared siblings name
  // a different compilation. Check both the pinned collection and the candidate.
  for(const phase of ['before','after']){
    const entry=documents.get('sourceEntry')?.[phase],world=documents.get('sourceWorld')?.[phase];
    const battle=documents.get('sourceBattle')?.[phase];
    if(entry&&world){
      assert.equal(entry.worldCatalogHash,world.contentHash,'Entry/world dependency mismatch');
      assert.equal(entry.mapContentHash,world.maps[entry.entry.mapId]?.contentHash,'Entry/map dependency mismatch');
    }
    if(entry&&battle)assert.equal(entry.battleCatalogHash,battle.contentHash,'Entry/battle dependency mismatch');
    for(const role of ['sourceMap','sourceMaps.world','sourceMaps.location','mapRules']){
      const child=documents.get(role),parent=documents.get(role==='mapRules'?'baseWorld':'sourceWorld');
      if(!child||!parent)continue;
      const map=child[phase],index=parent[phase].maps[map.mapId];
      assert.ok(index,'Missing map in declared world');
      if(index.url!==child.ref.url){
        assert.equal(index.url,linkedMapURL(parent[phase],map.mapId),'Map/world URL mismatch');
        const actual=await read(phase==='before'?readCurrentJson:readCandidateJson,
          phase==='before'?oldCache:newCache,index.url);
        assert.equal(canonical(actual),canonical(map),'Linked map/recipe alias mismatch');
      }
      assert.equal(index.contentHash,map.contentHash,'Map/world dependency mismatch');
      for(const key of ['sourceSetHash','parentSourceSetHash','mediaSourceSetHash'])
        assert.equal(map[key],parent[phase][key],'Map/world source mismatch');
    }
  }
  return {recipe,report};
}
