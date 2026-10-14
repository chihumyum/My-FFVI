// Rebind declared recipe inputs to one private source compilation. This does
// not edit recipes, rebuild inputs, or confer gameplay/source admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository=resolve(import.meta.dirname,'..');
const digest=/^[a-f0-9]{64}$/;
const logicalURL=/^\/(?:world|game|framework)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const ordinaryBattle='/content-batches/ordinary-battles/battle.json';
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
  const legacy=recipe.kind==='development-content-batch-recipe-v1';
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

/** Readers return parsed JSON for the same logical URL. Each value is detached
 * before asynchronous verification. Callers retain byte/path freshness checks
 * and complete package validation at their publication boundary. */
export async function resolveSourceRecipeInputs({recipePath,recipeBytes,readCurrentJson,readCandidateJson,
    root=repository,compiledDir='dist'}){
  assert.ok(typeof recipePath==='string'&&recipePath.length>0,'Missing original recipe path');
  assert.equal(typeof readCurrentJson,'function');assert.equal(typeof readCandidateJson,'function');
  const recipe=recipeJSON(recipeBytes),refs=declaredReferences(recipe);
  const report={kind:'source-recipe-inputs-v1',id:recipe.id,recipeKind:recipe.kind,recipePath,
    recipeSha256:sha(recipeBytes),changes:[],dependencyRebindings:[],sourceIdentities:[]};
  if(refs.length===0)return {recipe,report};
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/core',name+'.js')).href);
  const [{canonical},{verifyContent},{sourceCatalogProfile}]=await Promise.all([
    load('canonical'),load('content-integrity'),load('source-catalog')]);
  const oldCache=new Map(),newCache=new Map(),documents=new Map(),omissionMaps=new Map();
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
      assert.equal(canonical(identities(before,canonical,sourceCatalogProfile)),
        canonical(identities(after,canonical,sourceCatalogProfile)),'Omission source identity/profile/media changed');
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
    const comparisonAfter=await comparableAfter(before,after,ref);
    const oldIdentity=identities(before,canonical,sourceCatalogProfile),newIdentity=identities(comparisonAfter,canonical,sourceCatalogProfile);
    assert.equal(canonical(oldIdentity),canonical(newIdentity),'Source identity/profile/media changed: '+ref.role);
    if(ref.kind==='narshe-battle-catalog'||ref.kind==='field-development')
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
