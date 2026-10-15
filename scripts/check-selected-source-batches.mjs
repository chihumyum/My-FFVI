// Fresh declared routes over the published selection. Complete dependency
// diagnostics remain separate from route completion and source admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDigest} from './runtime-digest.mjs';
import {runContentBatchRoute} from './content-batch-route.mjs';

const repository=resolve(import.meta.dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(base,path)=>{const part=relative(base,path);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
const digest=/^[a-f0-9]{64}$/;
const slug=/^[a-z0-9][a-z0-9-]{0,79}$/;
const jsonURL=/^\/content-packages\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const selectionURL='/content-packages/source-batches/selection.json';
const workURL='/content-packages/source-batches/work-plan.json';
function keys(value,expected){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Invalid published source selection record');
  assert.deepEqual(Object.keys(value).sort(),expected.split(',').sort(),'Unknown published source selection fields');
}
function parseArgs(args){
  const options=new Map(),usage='Use check-selected-source-batches.mjs [--compiled-dir directory] [--content-dir directory] [--report build/reports/name.json]';
  for(let i=0;i<args.length;i++){
    const name=args[i],value=args[++i];
    assert.ok(['--compiled-dir','--content-dir','--report'].includes(name)&&value&&!value.startsWith('--')&&!options.has(name),usage);
    options.set(name,value);
  }
  return {compiledDir:options.get('--compiled-dir')??'dist',contentDir:options.get('--content-dir')??'build/content-packages',
    reportPath:options.get('--report')??'build/reports/selected-source-batches-check.json'};
}

function recipeKind(built){
  assert.ok(built&&typeof built==='object'&&!Array.isArray(built),'Missing initialized build record');
  assert.equal(built.kind,'initialized-source-map-build-v1','Unknown initialized build record');
  const kind=built.recipeKind;
  if(kind!==undefined)assert.ok(['initialized-source-map-recipe-v1','initialized-source-map-recipe-v2',
    'initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(kind),'Unknown initialized source recipe kind');
  if(['initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(kind)){
    assert.ok(Object.hasOwn(built,'battleCatalogSelection'),'Version 3 build must declare its battle catalog selection');
    assert.ok(Object.hasOwn(built,'sourceAreaScopeReceipt'),'Version 3 build must declare its source area scope receipt');
  }
  return kind;
}

/** Compare the complete selected catalog, independently of whether walking
 * was enabled. Catalog presence and conditional definitions grant no runtime
 * readiness; all plans/diagnostics remain with the ordinary batch analyzer. */
export async function validateSelectedSourceCatalogBinding(input,{root=repository,compiledDir='dist'}={}){
  const {built,battle,sourceBattle,sourceWorld,directory,requests,directoryReport}=structuredClone(input);
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/core',name+'.js')).href);
  const [{canonical},{verifyContent},{assertSourceGameCatalog}]=await Promise.all([
    load('canonical'),load('content-integrity'),load('source-catalog')]);
  const kind=recipeKind(built),hasDirectory=built.battleDirectory!==undefined,hasWalking=built.walking!==undefined,
    declared=built.battleCatalogSelection;
  assert.ok(declared===undefined||declared==='source-baseline-v1'||declared==='shared-framework-directory-v1',
    'Unknown selected source battle catalog');
  if(hasWalking){
    assert.ok(Array.isArray(built.walking)&&built.walking.length>0,'Walking build must retain its actual enabled map records');
    assert.equal(built.nativeWalkingRulesVerified,false,'Walking framework policy cannot claim native rule verification');
  }else assert.equal(built.nativeWalkingRulesVerified,undefined,'A non-walking build cannot declare walking verification');
  if(kind==='initialized-source-map-recipe-v1')assert.ok(!hasDirectory&&!hasWalking&&declared===undefined,
    'Version 1 build cannot select a bulk battle directory');
  if(kind==='initialized-source-map-recipe-v2')assert.ok(hasWalking&&hasDirectory&&declared===undefined,
    'Version 2 build must retain its walking directory binding');
  if(kind===undefined&&hasWalking)assert.ok(hasDirectory,'Legacy walking build must retain its directory binding');
  if(!['initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(kind)&&declared!==undefined)
    throw new Error('Explicit battle catalog selection requires a version 3 build');
  if(hasDirectory&&!hasWalking)assert.equal(declared,'shared-framework-directory-v1',
    'Directory without walking requires an explicit version 3 selection');
  if(declared==='shared-framework-directory-v1')assert.ok(hasDirectory,'Selected shared battle directory is missing');
  if(declared==='source-baseline-v1')assert.equal(hasDirectory,false,'Source baseline cannot carry a hidden directory binding');
  await Promise.all([sourceBattle,battle,sourceWorld].map(value=>verifyContent(value)));
  assert.equal(sourceWorld.kind,'world-development','Unknown source world catalog');
  assert.equal(sourceWorld.developmentProfile,undefined,'Source world cannot carry a framework profile');
  assert.equal(sourceBattle.developmentProfile,undefined,'Source baseline cannot carry a framework profile');
  assertSourceGameCatalog(sourceBattle);
  // fieldSourceSetHash names the field export subset. The world catalog names
  // the complete corpus, so equality between these distinct sets is not an
  // identity invariant. Entry/catalog pins and the directory's world/parent
  // chain independently bind their actual source domains below.
  if(!hasDirectory){
    assert.equal(canonical(battle),canonical(sourceBattle),'Selected source baseline catalog changed');
    return {selection:'source-baseline-v1',catalogHash:battle.contentHash,baselineHash:sourceBattle.contentHash};
  }
  keys(built.battleDirectory,'catalogHash,requestsHash,reportHash');
  for(const value of Object.values(built.battleDirectory))assert.match(value,digest);
  assert.ok(directory&&requests&&directoryReport,'Missing published shared battle directory dependencies');
  await verifyContent(directory,built.battleDirectory.catalogHash);
  await verifyContent(requests,built.battleDirectory.requestsHash);
  await verifyContent(directoryReport,built.battleDirectory.reportHash);
  assert.equal(requests.kind,'source-battle-directory-requests-v1');
  assert.equal(directoryReport.kind,'source-battle-directory-build-v1');
  await verifyContent(requests.sourceRequests);
  assert.equal(directoryReport.frameworkCatalogHash,directory.contentHash);
  assert.equal(directoryReport.requestsHash,requests.contentHash);
  assert.equal(directoryReport.baselineHash,sourceBattle.contentHash);
  assert.equal(requests.sourceRequests.worldCatalogHash,sourceWorld.contentHash,'Directory request world identity changed');
  assert.equal(directoryReport.sourceSetHash,sourceWorld.sourceSetHash,'Directory corpus identity changed');
  assert.equal(directoryReport.parentSourceSetHash,sourceWorld.parentSourceSetHash,'Directory parent source changed');
  assert.equal(requests.parentSourceSetHash,sourceWorld.parentSourceSetHash,'Directory request parent source changed');
  assert.equal(canonical(battle),canonical(directory),'Selected battle catalog is not the complete published shared directory');
  assert.equal(canonical(directory.gameState),canonical(sourceBattle.gameState),'Directory changed the owned source initializer');
  const {validateInitializedBattleSharedCapabilities}=await import(pathToFileURL(
    resolve(root,compiledDir,'src/compiler/initialized-battle-binding.js')).href);
  validateInitializedBattleSharedCapabilities(sourceBattle,directory,directoryReport);
  assertSourceGameCatalog(directory,'framework');
  return {selection:'shared-framework-directory-v1',catalogHash:directory.contentHash,baselineHash:sourceBattle.contentHash,
    directory:structuredClone(built.battleDirectory)};
}

/** The scope receipt is static source evidence only. Reconstruct it from the
 * trusted published source world and every original map, never derived maps
 * or routes which happened to complete. An absent/null claim grants no scope. */
export async function validateSelectedSourceAreaBinding(input,{root=repository,compiledDir='dist'}={}){
  const {built,sourceWorld,sourceMaps}=structuredClone(input),kind=recipeKind(built),receipt=built.sourceAreaScopeReceipt;
  if(receipt===undefined){
    assert.ok(!['initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(kind),'Missing complete source area scope receipt');return null;
  }
  if(receipt===null)return null;
  assert.ok(['initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(kind),'Source area scope requires a version 3, 4 or 5 build');
  const {parseSourceAreaScope,validateSourceAreaScope}=await import(pathToFileURL(
    resolve(root,compiledDir,'src/compiler/source-area-scope.js')).href);
  const scope=parseSourceAreaScope(receipt.scope);
  validateSourceAreaScope(receipt,{scope,catalog:sourceWorld,maps:sourceMaps});
  assert.ok(Array.isArray(built.sourceInputs?.maps)&&built.sourceInputs.maps.length===sourceMaps.length,
    'Source area build pins omit original maps');
  const pins=new Map();
  for(const item of built.sourceInputs.maps){
    assert.ok(!pins.has(item.mapId),'Source area build pins duplicate a map');pins.set(item.mapId,item);
  }
  for(const map of sourceMaps){
    const pin=pins.get(map.mapId),index=sourceWorld.maps[String(map.mapId)];
    assert.ok(pin&&index,'Source area map lacks its published pin');
    assert.equal(pin.url,index.url,'Source area build pin URL changed');
    assert.equal(pin.contentHash,map.contentHash,'Source area build pin content changed');
  }
  return receipt;
}

/** Recompile the entire package-local inventory from verified source snapshots.
 * No route, saved state, active group subset or successful derivation can stand
 * in for the complete map's source records and unresolved dependencies. */
export async function validateSelectedSourceNpcActivityBinding(input,{root=repository,compiledDir='dist'}={}){
  const {built,maps,sourceMaps}=structuredClone(input),kind=recipeKind(built);
  if(!['initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(kind)){
    assert.equal(built.npcActivity,undefined,'NPC host requires its explicit version 4 declaration');
    assert.ok(maps.every(map=>map.frameworkNpcActivity===undefined),'Hidden NPC host in an older recipe');return null;
  }
  keys(built.npcActivity,'template,maps,nativeRulesVerified,counts');
  assert.equal(built.npcActivity.nativeRulesVerified,false);
  const template=built.npcActivity.template;
  keys(template,'kind,policy,missingFirstInterval,random,collision,schedule,takeover,reason');
  assert.equal(template.kind,'framework-npc-area-template-v1');
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href);
  const api=Object.assign({},...await Promise.all(['compiler/corpus','compiler/field-npc-activity',
    'compiler/content','core/field-npc-activity-source','core/content-integrity'].map(load)));
  api.parseFrameworkNpcActivityDeclaration({...template,kind:'framework-npc-area-declaration-v1',sourceHash:'0'.repeat(64)});
  const corpus=await api.loadCorpus(root),originals=new Map(sourceMaps.map(map=>[map.mapId,map]));
  assert.equal(originals.size,sourceMaps.length);assert.equal(maps.length,sourceMaps.length);
  assert.equal(new Set(maps.map(map=>map.mapId)).size,maps.length,'Duplicate derived NPC map identity');
  assert.ok(Array.isArray(built.npcActivity.maps)&&built.npcActivity.maps.length===maps.length,'Incomplete NPC map inventory');
  const records=new Map(built.npcActivity.maps.map(value=>[value.mapId,value]));
  assert.equal(records.size,maps.length,'Duplicate NPC map inventory');
  let declared=0,derived=0;
  for(const map of maps){
    const original=originals.get(map.mapId),record=records.get(map.mapId);assert.ok(original&&record);
    await Promise.all([original,map].map(value=>api.verifyContent(value)));
    assert.equal(original.developmentProfile,undefined);assert.equal(original.frameworkNpcActivity,undefined);
    assert.equal(original.sourceSetHash,corpus.sourceSetHash);assert.equal(original.parentSourceSetHash,corpus.manifest.parentSourceSetHash);
    keys(record,'mapId,sourceMapHash,sources,counts,diagnostics');assert.equal(record.sourceMapHash,original.contentHash);
    const inventory=api.compileFieldNpcActivitySources(corpus,map.mapId),bindings=[],diagnostics=structuredClone(inventory.diagnostics);
    for(const source of inventory.definitions){
      try{bindings.push(api.deriveFrameworkNpcActivity(source,{...template,kind:'framework-npc-area-declaration-v1',sourceHash:source.contentHash}));}
      catch(error){diagnostics.push({code:'framework-npc-area-derivation',reason:String(error.message??error),source:source.source});}
    }
    assert.equal(api.canonical(record.sources),api.canonical(inventory.definitions),'NPC source inventory omitted or changed a record');
    assert.equal(api.canonical(record.counts),api.canonical({...inventory.counts,derived:bindings.length}));
    assert.equal(api.canonical(record.diagnostics),api.canonical(diagnostics));
    const host=map.frameworkNpcActivity;assert.ok(host,'Missing declared NPC host sidecar');
    keys(host,'kind,policy,sourceMapHash,sourceSetHash,parentSourceSetHash,bindings,diagnostics,limitations,nativeRulesVerified');
    assert.equal(host.kind,'framework-npc-area-host-v1');assert.equal(host.policy,template.policy);
    assert.equal(host.sourceMapHash,original.contentHash);assert.equal(host.sourceSetHash,corpus.sourceSetHash);
    assert.equal(host.parentSourceSetHash,corpus.manifest.parentSourceSetHash);assert.equal(host.nativeRulesVerified,false);
    assert.equal(map.developmentProfile.npcActivity,template.policy);
    assert.equal(api.canonical(host.bindings),api.canonical(bindings),'NPC policy/program/source hash relation changed');
    for(const binding of host.bindings)api.validateFrameworkNpcActivityBinding(binding);
    assert.equal(api.canonical(host.diagnostics),api.canonical(diagnostics));
    const limitations=[...new Set([...inventory.definitions.flatMap(source=>source.nativeGaps),
      'Web Area activity leaves every original dialogue, event, provider and story-reachability blocker visible.'])];
    assert.equal(api.canonical(host.limitations),api.canonical(limitations));
    declared+=inventory.definitions.length;derived+=bindings.length;
  }
  const counts={maps:maps.length,declared,derived,blocked:declared-derived};
  assert.equal(api.canonical(built.npcActivity.counts),api.canonical(counts));
  return {...counts,policy:template.policy,nativeRulesVerified:false};
}

/** Service hosts are reconstructed from verified original maps and the current
 * verified corpus supplied by the I/O caller. This proves static bindings only;
 * neither an empty diagnostic list nor a declaration proves counter reachability. */
export async function validateSelectedSourceFieldServicesBinding(input,{root=repository,compiledDir='dist'}={}){
  const {built,maps,sourceMaps,corpus}=structuredClone(input),kind=recipeKind(built);
  const hasServices=map=>Object.hasOwn(map,'frameworkRelayInteraction')||Object.hasOwn(map,'frameworkPassiveEffects')||
    Object.hasOwn(map.developmentProfile??{},'relayInteraction')||Object.hasOwn(map.developmentProfile??{},'passiveEffects');
  if(kind!=='initialized-source-map-recipe-v5'){
    assert.equal(Object.hasOwn(built,'fieldServices'),false,'Field services require an explicit version 5 declaration');
    assert.ok(maps.every(map=>!hasServices(map)),'Hidden field services in an older recipe');return null;
  }
  keys(built.fieldServices,'declaration,maps,nativeRulesVerified');
  assert.equal(built.fieldServices.nativeRulesVerified,false);
  const declaration=built.fieldServices.declaration;
  keys(declaration,'kind,relayInteraction,passiveEffects,mapIds');
  assert.equal(declaration.kind,'framework-field-services-declaration-v1');
  assert.equal(declaration.relayInteraction,'framework-relay-interaction-v1');
  assert.equal(declaration.passiveEffects,'framework-passive-field-effects-v1');
  assert.ok(Array.isArray(declaration.mapIds)&&declaration.mapIds.length>0,'Missing declared service maps');
  assert.ok(declaration.mapIds.every(id=>Number.isSafeInteger(id)&&id>0&&id<=0x7fffffff),'Invalid service map identity');
  const selected=new Set(declaration.mapIds);
  assert.equal(selected.size,declaration.mapIds.length,'Duplicate declared service map');
  assert.ok(Array.isArray(maps)&&Array.isArray(sourceMaps)&&maps.length===sourceMaps.length,'Incomplete service map inventory');
  const originals=new Map(sourceMaps.map(map=>[map.mapId,map]));
  assert.equal(originals.size,sourceMaps.length,'Duplicate original service map');
  assert.equal(new Set(maps.map(map=>map.mapId)).size,maps.length,'Duplicate derived service map');
  assert.ok(maps.every(map=>originals.has(map.mapId)),'Foreign derived service map');
  assert.ok([...selected].every(id=>originals.has(id)),'Declared service map outside selected source package');
  assert.ok(corpus&&Array.isArray(corpus.assets)&&corpus.manifest,'Missing verified current corpus');
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href);
  const api=Object.assign({},...await Promise.all(['compiler/field-services','core/field-relay-policy',
    'core/field-passive-effects-host','core/canonical','core/content-integrity'].map(load)));
  const expected=[];
  for(const map of maps){
    const original=originals.get(map.mapId);
    await Promise.all([map,original].map(value=>api.verifyContent(value)));
    assert.equal(original.developmentProfile,undefined,'Service source map is already derived');
    assert.equal(hasServices(original),false,'Service source map carries hidden host authority');
    assert.equal(original.sourceSetHash,corpus.sourceSetHash,'Service corpus source identity changed');
    assert.equal(original.parentSourceSetHash,corpus.manifest.parentSourceSetHash,'Service corpus parent identity changed');
    assert.equal(map.sourceSetHash,original.sourceSetHash);assert.equal(map.parentSourceSetHash,original.parentSourceSetHash);
    assert.equal(map.mediaSourceSetHash,original.mediaSourceSetHash);
    assert.equal(map.developmentProfile?.sourceContentHash,original.contentHash,'Service map baseline hash changed');
    const {contentHash:_sourceHash,...sourceBody}=original;
    const {contentHash:_derivedHash,developmentProfile:_profile,frameworkPresentation:_presentation,
      frameworkNpcActivity:_npc,...derivedBody}=map;
    if(!selected.has(map.mapId)){
      assert.equal(hasServices(map),false,'Hidden field services outside declared maps');
      assert.equal(api.canonical(derivedBody),api.canonical(sourceBody),'Unselected service map payload changed');
      continue;
    }
    assert.ok(map.map,'Declared service map has no source geometry');
    assert.equal(map.developmentProfile.relayInteraction,declaration.relayInteraction);
    assert.equal(map.developmentProfile.passiveEffects,declaration.passiveEffects);
    const relay=api.deriveFrameworkRelayHost(original),passive=api.deriveFrameworkPassiveEffectsHost(original,corpus.assets);
    const parsedRelay=api.parseFieldRelayInteractionHost(map.frameworkRelayInteraction);
    assert.equal(api.canonical(parsedRelay),api.canonical(relay),'Relay host differs from complete original source derivation');
    assert.equal(api.bindFieldRelays(map).size,relay.bindings.length,'Relay host failed trusted content binding');
    if(passive.host){
      const parsedPassive=api.parseFieldPassiveEffectsHost(map.frameworkPassiveEffects);
      assert.equal(api.canonical(parsedPassive),api.canonical(passive.host),'Passive effect host differs from verified raw source derivation');
      assert.equal(api.bindPassiveEffects(map).size,passive.host.bindings.length,'Passive effect host failed trusted content binding');
    }else{
      assert.equal(Object.hasOwn(map,'frameworkPassiveEffects'),false,'Empty or hidden passive effect host');
      assert.equal(api.bindPassiveEffects(map).size,0);
    }
    // Re-derivation is additional to the immutable-body check. A candidate may
    // not drop source 11/16 entities, diagnostics or scripts to make it pass.
    delete derivedBody.frameworkRelayInteraction;delete derivedBody.frameworkPassiveEffects;
    assert.equal(api.canonical(derivedBody),api.canonical(sourceBody),'Service derivation changed original map payload');
    expected.push({mapId:map.mapId,relays:relay.bindings.length,passiveEffects:passive.host?.bindings.length??0,
      diagnostics:structuredClone(passive.diagnostics),nativeRulesVerified:false});
  }
  assert.ok(Array.isArray(built.fieldServices.maps),'Missing complete field services receipt');
  for(const record of built.fieldServices.maps)keys(record,'mapId,relays,passiveEffects,diagnostics,nativeRulesVerified');
  assert.equal(api.canonical(built.fieldServices.maps),api.canonical(expected),'Incomplete or changed source service receipt');
  return {declaration:structuredClone(declaration),maps:expected,nativeRulesVerified:false,
    runtimeAdmission:'unassessed',counterReachabilityVerified:false};
}

export async function checkSelectedSourceBatches({root=repository,compiledDir='dist',contentDir='build/content-packages',
  reportPath='build/reports/selected-source-batches-check.json'}={}){
  root=await realpath(resolve(root));
  const reportRoot=resolve(root,'build/reports');let output=resolve(reportRoot,'selected-source-batches-check.json');
  const report={kind:'selected-source-batches-check-v1',result:'running',tests:[],batches:[],
    declaredRoutes:{status:'not-run',completed:0},wholeSourceBatchAdmission:{status:'not-assessed',
      reason:'Declared routes do not admit the whole source batch; all diagnostics are retained.'},
    runtimeAdmission:'unassessed',sourceCampaignComplete:false,sourceStoryReachability:false,browserVerified:false,
    originalGameExecuted:false,fullGameMigration:false,
    evidence:{execution:'actual GameContentRepository and runContentBatchRoute; existing entry/Flow/map/prepared battle/commands/storage owners',
      media:'controlled immediate completion; no decoding, audible output or browser pixels',
      entry:'source DataInitialize with declared authored PointIn and ordinary flat presentation; no story-state substitution'}};
  const inputs=new Map();
  try{
    const requested=resolve(root,reportPath);
    assert.ok(within(reportRoot,requested)&&requested.endsWith('.json'),'Report must be a JSON file inside build/reports');output=requested;
    const compiled=await realpath(resolve(root,compiledDir)),content=await realpath(resolve(root,contentDir));
    assert.ok(within(root,compiled),'Compiled modules must remain inside the repository');
    assert.ok(within(resolve(root,'build'),content),'Content collection must remain inside build');
    assert.ok((await lstat(compiled)).isDirectory()&&(await lstat(content)).isDirectory(),'Expected compiled and content directories');
    report.compiledDirectory=relative(root,compiled);report.contentDirectory=relative(root,content);
    const load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')).href);
    const api=Object.assign({},...await Promise.all(['core/game-content','core/game-content-refs','core/content-integrity','core/canonical',
      'compiler/content-batch','compiler/content-batch-work-set','compiler/source-walk-policy'].map(load)));
    const read=async url=>{
      assert.match(url,jsonURL,'Only this published collection supplies JSON dependencies');
      const logical=resolve(content,url.slice('/content-packages/'.length)),file=await realpath(logical);
      assert.ok(within(content,file),'Published JSON escaped the selected collection');
      const info=await lstat(logical);assert.ok(info.isFile()&&!info.isSymbolicLink(),'Published JSON must be a regular file');
      const bytes=await readFile(file),fingerprint=sha(bytes),prior=inputs.get(url);
      if(prior)assert.ok(prior.file===file&&prior.fingerprint===fingerprint,'Published collection changed during validation: '+url);
      else inputs.set(url,{logical,file,fingerprint});
      return JSON.parse(bytes.toString('utf8'));
    };
    const validateInputs=async()=>{
      for(const [url,{logical,file,fingerprint}] of inputs){
        assert.equal(await realpath(logical),file,'Published JSON path changed: '+url);
        assert.equal(sha(await readFile(file)),fingerprint,'Published JSON bytes changed: '+url);
      }
    };
    const initialRuntime=await runtimeDigest(root,compiled);report.runtimeSha256=initialRuntime;
    const receipt=await api.verifyContent(await read(selectionURL));
    keys(receipt,'kind,id,path,sha256,items,workPlan,contentHash');
    assert.equal(receipt.kind,'source-content-selection-receipt-v1');
    assert.ok(typeof receipt.id==='string'&&receipt.id.trim()&&receipt.id.length<=160);assert.match(receipt.sha256,digest);
    assert.ok(receipt.path===null||typeof receipt.path==='string'&&/^content-batches\/[a-z0-9][a-z0-9_.-]*\.json$/.test(receipt.path));
    assert.ok(Array.isArray(receipt.items),'Published selection items must be an array');
    const packageIds=new Set(),manifestIds=new Set(),recipePaths=new Set();
    for(const item of receipt.items){
      keys(item,'path,sha256,label,id,manifestId');assert.match(item.id,slug);assert.match(item.sha256,digest);
      assert.match(item.path,/^content-batches\/[a-z0-9][a-z0-9-]{0,79}\.recipe\.json$/);
      assert.match(item.manifestId,/^[a-z0-9][a-z0-9-]{0,159}$/);
      assert.ok(typeof item.label==='string'&&item.label.trim()&&item.label.length<=160);
      assert.ok(!packageIds.has(item.id)&&!manifestIds.has(item.manifestId)&&!recipePaths.has(item.path),'Ambiguous published selection ownership');
      packageIds.add(item.id);manifestIds.add(item.manifestId);recipePaths.add(item.path);
    }
    report.selection={id:receipt.id,path:receipt.path,sha256:receipt.sha256,contentHash:receipt.contentHash,items:receipt.items};
    if(receipt.items.length===0){
      assert.equal(receipt.workPlan,null,'An empty selection cannot point at a retained old work set');
      await validateInputs();assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed during empty selection validation');
      report.result='not-assessed';report.declaredRoutes.status='no-selected-source-batches';return report;
    }
    keys(receipt.workPlan,'url,contentHash');assert.equal(receipt.workPlan.url,workURL);assert.match(receipt.workPlan.contentHash,digest);
    const work=await api.verifyContent(await read(receipt.workPlan.url),receipt.workPlan.contentHash);
    assert.equal(work.kind,'content-batch-work-set-v1');assert.equal(work.runtimeSha256,initialRuntime,'Work set belongs to another runtime');
    assert.equal(work.runtimeAdmission,'unassessed');assert.equal(work.sourceCampaignComplete,false);
    assert.equal(api.canonical(work.selection),api.canonical({id:receipt.id,sha256:receipt.sha256}));
    assert.ok(Array.isArray(work.batches)&&work.batches.length===receipt.items.length,'Selection/work-set membership changed');
    const selected=work.batches.map(batch=>({path:batch.recipePath,sha256:batch.recipeSha256,label:batch.label,
      id:batch.packageId,manifestId:batch.work.batchId}));
    assert.equal(api.canonical(selected),api.canonical(receipt.items),'Selection/work-set identities or order changed');
    report.workSet={contentHash:work.contentHash,counts:work.counts};
    const sourceRefs=api.parseGameContentRefs(await read('/content-packages/source.json'));
    assert.equal(sourceRefs.profile,'source');assert.ok(sourceRefs.source,'Published collection requires its strict source lane');
    const sourceRepository=new api.GameContentRepository(read,'source',sourceRefs),sourceWorld=await sourceRepository.world();
    const sourceBattle=await api.verifyContent(await read(sourceRefs.source.battle.url),sourceRefs.source.battle.contentHash);
    const prepared=[];let currentCorpus;
    for(const batch of work.batches){
      const prefix='/content-packages/'+batch.packageId,refs=api.parseGameContentRefs(await read(prefix+'.json'));
      const manifest=api.ContentBatchManifest.parse(await read(prefix+'/manifest.json'));
      assert.equal(manifest.id,batch.work.batchId);assert.equal(api.canonical(manifest.contentRefs),api.canonical(refs));
      assert.equal(refs.profile,manifest.profile);assert.equal(refs.profile,'framework');
      assert.ok(refs.kind==='game-content-refs-v2'&&refs.initialized&&refs.source===null&&refs.development===null,
        'Selected source-map package must retain its declared initialized lane');
      const repository=new api.GameContentRepository(read,refs.profile,refs),bundle=await repository.initializedNewGame();
      const maps=await Promise.all(manifest.mapIds.map(id=>repository.map(id,bundle.catalog)));
      const plan=api.planContentBatch(manifest,{entry:bundle.content,battle:bundle.battle,catalog:bundle.catalog,maps});
      assert.equal(plan.manifestHash,batch.work.manifestHash);assert.equal(plan.dependencyHash,batch.work.dependencyHash);
      assert.equal(api.canonical(plan.contentHashes),api.canonical(batch.work.contentHashes));
      const built=await read(prefix+'/build-report.json');
      assert.equal(built.kind,'initialized-source-map-build-v1');assert.equal(built.package,batch.packageId);
      assert.equal(built.recipeSha256,batch.recipeSha256);assert.equal(api.canonical(built.refs),api.canonical(refs));
      assert.equal(built.sourceInputs.world.contentHash,sourceWorld.contentHash);
      assert.equal(bundle.catalog.developmentProfile.sourceContentHash,sourceWorld.contentHash);
      assert.equal(built.sourceInputs.battle.contentHash,sourceRefs.source.battle.contentHash);
      let directory,requests,directoryReport;
      if(built.battleDirectory!==undefined){
        directory=await api.verifyContent(await read('/content-packages/source-battle-directory/framework.json'));
        requests=await api.verifyContent(await read('/content-packages/source-battle-directory/requests.json'));
        directoryReport=await api.verifyContent(await read('/content-packages/source-battle-directory/build-report.json'));
      }
      const battleCatalogBinding=await validateSelectedSourceCatalogBinding({built,battle:bundle.battle,sourceBattle,sourceWorld,
        directory,requests,directoryReport},{root,compiledDir:compiled});
      const walkingMaps=new Map();
      if(built.walking!==undefined){
        assert.equal(built.nativeWalkingRulesVerified,false);assert.ok(Array.isArray(built.walking));
        for(const result of built.walking){
          assert.equal(result.status,'ready');assert.ok(!walkingMaps.has(result.binding.mapId));
          walkingMaps.set(result.binding.mapId,result);
        }
      }
      const row={packageId:batch.packageId,label:batch.label,manifestHash:plan.manifestHash,dependencyHash:plan.dependencyHash,
        contentHashes:plan.contentHashes,diagnostics:plan.diagnostics,referenceClosure:plan.dependencies.referenceClosure,
        providerRequirements:plan.dependencies.providerRequirements,providerAssessments:plan.dependencies.providerAssessments,
        battleCatalogBinding,sourceAreaScopeReceipt:null,npcActivityBinding:null,fieldServicesBinding:null,
        maps:[],routes:manifest.routes.map(route=>({id:route.id,status:'not-run'}))};
      report.batches.push(row);
      const originals=[];
      for(const map of maps){
        const original=await sourceRepository.map(map.mapId,sourceWorld);
        originals.push(original);
        assert.equal(original.developmentProfile,undefined);assert.equal(original.frameworkPresentation,undefined);
        assert.equal(map.developmentProfile.sourceContentHash,original.contentHash);
        const sourcePin=built.sourceInputs.maps.filter(item=>item.mapId===map.mapId);assert.equal(sourcePin.length,1);
        assert.equal(sourcePin[0].contentHash,original.contentHash);
        const {contentHash:_sourceHash,...sourceBody}=original;
        const {contentHash:_derivedHash,developmentProfile:_profile,frameworkPresentation:_presentation,...derivedBody}=map;
        if(walkingMaps.has(map.mapId)){
          const result=walkingMaps.get(map.mapId);
          assert.equal(api.canonical(result.source),api.canonical(original.sourceWalkEncounters));
          assert.equal(api.canonical(result.binding),api.canonical(map.frameworkWalkBinding));
          assert.equal(api.canonical(result.policy),api.canonical(map.walkEncounters));
          api.assertSourceWalkPolicyBinding({mapId:map.mapId,source:original.sourceWalkEncounters,
            catalog:bundle.battle,binding:map.frameworkWalkBinding,policy:map.walkEncounters});
          delete derivedBody.walkEncounters;delete derivedBody.frameworkWalkBinding;
        }
        if(['initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(recipeKind(built)))delete derivedBody.frameworkNpcActivity;
        if(recipeKind(built)==='initialized-source-map-recipe-v5'&&built.fieldServices?.declaration?.mapIds?.includes(map.mapId)){
          delete derivedBody.frameworkRelayInteraction;delete derivedBody.frameworkPassiveEffects;
        }
        assert.equal(api.canonical(derivedBody),api.canonical(sourceBody),'Source map payload changed: '+batch.packageId+'/'+map.mapId);
        row.maps.push({mapId:map.mapId,sourceHash:original.contentHash,derivedHash:map.contentHash,fullPayloadPreserved:true});
      }
      row.sourceAreaScopeReceipt=await validateSelectedSourceAreaBinding({built,sourceWorld,sourceMaps:originals},
        {root,compiledDir:compiled});
      row.npcActivityBinding=await validateSelectedSourceNpcActivityBinding({built,maps,sourceMaps:originals},{root,compiledDir:compiled});
      if(recipeKind(built)==='initialized-source-map-recipe-v5')
        currentCorpus??=await (await load('compiler/corpus')).loadCorpus(root);
      row.fieldServicesBinding=await validateSelectedSourceFieldServicesBinding({built,maps,sourceMaps:originals,corpus:currentCorpus},
        {root,compiledDir:compiled});
      assert.ok([...walkingMaps.keys()].every(id=>maps.some(map=>map.mapId===id)),
        'Walking build record names a map outside this package');
      report.tests.push({name:batch.packageId+': exact selected content and complete original map payloads',passed:true});
      prepared.push({batch,plan,repository,row});
    }
    const projected=api.projectContentBatchWorkSet({selection:work.selection,runtimeSha256:initialRuntime,batches:prepared.map(({batch,plan})=>
      ({packageId:batch.packageId,label:batch.label,recipePath:batch.recipePath,recipeSha256:batch.recipeSha256,plan}))});
    assert.equal(api.canonical(projected),api.canonical(work),'Published unified work set differs from fresh complete plans');
    report.tests.push({name:'selection and unified work set retain every current diagnostic/provider record',passed:true});
    for(const {plan,repository,row} of prepared)for(const route of plan.manifest.routes){
      assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed before a declared route');
      const result=await runContentBatchRoute({root,compiled,plan,routeId:route.id,repository,runtimeHash:initialRuntime});
      const record=row.routes.find(item=>item.id===route.id);Object.assign(record,{status:result.receipt.result,...result});
      assert.equal(result.receipt.result,'completed',JSON.stringify(result.receipt.boundary));
      assert.equal(result.receipt.runtimeHash,initialRuntime);assert.equal(result.receipt.manifestHash,plan.manifestHash);
      assert.equal(result.receipt.dependencyHash,plan.dependencyHash);assert.equal(api.canonical(result.receipt.contentHashes),api.canonical(plan.contentHashes));
      assert.equal(result.receipt.saveRestored,true);assert.equal(result.receipt.checkpointReady,true);
      report.declaredRoutes.completed++;report.tests.push({name:row.packageId+': '+route.id+' declared route and save/restore continuation',passed:true});
      await validateInputs();assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed during a declared route');
    }
    await validateInputs();assert.equal(await runtimeDigest(root,compiled),initialRuntime,'Runtime changed during selected-source validation');
    report.declaredRoutes.status='passed';report.result='passed';return report;
  }catch(error){report.result='failed';report.declaredRoutes.status='failed';report.error=String(error.stack??error);throw error;}
  finally{
    report.readJSONFiles=inputs.size;await mkdir(resolve(output,'..'),{recursive:true});
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({result:report.result,tests:report.tests.length,batches:report.batches.length,
      routes:report.declaredRoutes,wholeSourceBatchAdmission:'not-assessed',report:output}));
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let options;
  try{options=parseArgs(process.argv.slice(2));}
  catch(error){
    const output=resolve(repository,'build/reports/selected-source-batches-check.json');await mkdir(resolve(output,'..'),{recursive:true});
    await writeFile(output,JSON.stringify({kind:'selected-source-batches-check-v1',result:'failed',tests:[],error:String(error),
      wholeSourceBatchAdmission:{status:'not-assessed'},sourceCampaignComplete:false,browserVerified:false,fullGameMigration:false},null,2)+'\n');
    throw error;
  }
  await checkSelectedSourceBatches(options);
}
