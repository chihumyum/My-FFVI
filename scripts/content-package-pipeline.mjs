import {createFrameworkFieldEffectFlatAddition,createFrameworkFieldEffectFlatEvidenceReader} from './framework-field-effect-flat-evidence.mjs';
import {createFrameworkOrdinaryPresentationAddition,createFrameworkOrdinaryPresentationEvidenceReader} from './framework-ordinary-presentation-evidence.mjs';
import {createSourceMessageFeeEvidenceReader} from './source-message-fee-evidence.mjs';
import {createFrameworkNpcFlatAddition,createFrameworkNpcFlatEvidenceReader} from './framework-npc-flat-evidence.mjs';
// Prepare the entire collection privately; producers own no gameplay state.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,lstat,mkdir,mkdtemp,readFile,readdir,readlink,realpath,rename,rm,stat,writeFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archivePublishedContentPackages} from './archive-content-release.mjs';
import {acquireContentPackageLock} from './content-package-lock.mjs';
import {loadSourceContentSelection,loadSourceRecipePaths} from './source-content-selection.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
import {webSourceFrameworkInputs} from './source-web-framework-inputs.mjs';
import {compileSourcePrerequisites,validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
import {linkSourcePrerequisites} from './link-source-prerequisites.mjs';
import {createSourceEventActivationEvidenceReader} from './source-event-activation-evidence.mjs';
import {createSourceMapAnimationEvidenceReader} from './source-map-animation-evidence.mjs';
import {resolveSourceRecipeInputs,resolveCompiledBattleReference,createSourceWalkEvidenceReader,createSourceNpcRouteEvidenceReader} from './source-recipe-inputs.mjs';
import {createFrameworkNpcAreaAddition,createFrameworkNpcAreaEvidenceReader} from './framework-npc-area-evidence.mjs';

const repository=resolve(import.meta.dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(parent,file)=>{const part=relative(parent,file);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
const packageURL=/^\/content-packages\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const jsonURL=/^\/(?:game|world|framework|content-batches)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const mediaURL=/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|flac)$/;

async function fingerprint(directory){
  const rows=[];
  try{const info=await lstat(directory);assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'Package collection must be a directory');}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  async function visit(file){
    const info=await lstat(file),name=relative(directory,file);
    if(info.isSymbolicLink())rows.push([name,'link',await readlink(file)]);
    else if(info.isDirectory())for(const child of (await readdir(file)).sort())await visit(resolve(file,child));
    else if(info.isFile())rows.push([name,sha(await readFile(file))]);
    else throw new Error('Unsupported content-package file: '+name);
  }
  await visit(directory);
  return sha(JSON.stringify(rows));
}

// Retain exact consumed upstream bytes and reject changes before publication.
function inputReader(root){
  const build=resolve(root,'build'),inputs=new Map(),mediaInputs=new Map(),bindings=new Map();
  async function boundPath(file){
    const actual=await realpath(file);assert.ok(within(build,actual),'Content input escapes build');
    if(bindings.has(file))assert.equal(actual,bindings.get(file),'Content input changed its path binding');
    else bindings.set(file,actual);
    return actual;
  }
  async function bytes(url){
    assert.match(url,jsonURL,'Unexpected upstream JSON URL');
    const actual=await boundPath(resolve(build,url.slice(1)));
    if(!inputs.has(actual))inputs.set(actual,await readFile(actual));
    return inputs.get(actual);
  }
  return {inputs,mediaInputs,bytes,json:async url=>JSON.parse((await bytes(url)).toString()),
    async media(url){
      assert.match(url,mediaURL);
      assert.ok(['/world-media/','/field-background-media/','/map-ui/','/field/sprites/','/battle/sprites/',
        '/bgm/tracks/','/se/tracks/','/environment/tracks/','/imports/textures/'].some(prefix=>url.startsWith(prefix)),
        'Unexpected runtime media URL');
      const mapped=url.startsWith('/imports/')?'/import/'+url.slice('/imports/'.length):url;
      const file=await boundPath(resolve(build,'.'+mapped));
      const raw=await readFile(file),digest=sha(raw);
      if(mediaInputs.has(file))assert.equal(digest,mediaInputs.get(file),'Media changed during candidate preparation');
      else mediaInputs.set(file,digest);
      return raw;
    },
    async validate(){
      for(const [file,actual] of bindings)assert.equal(await realpath(file),actual,
        'Content input changed its path binding: '+relative(root,file));
      for(const [file,raw] of inputs)assert.equal(sha(await readFile(file)),sha(raw),
        'Upstream content changed during candidate preparation: '+relative(root,file));
      for(const [file,digest] of mediaInputs)assert.equal(sha(await readFile(file)),digest,
        'Media changed during candidate preparation: '+relative(root,file));
    },
  };
}

// The retained CAS preserves original JSON bytes, even when two valid JSON
// serializations have the same semantic content digest. Detect all predictable
// conflicts before replacing the current collection.
async function validatePublicCAS(root,candidateHistory){
  let checked=0;
  for(const namespace of ['objects','media']){
    const privateDirectory=resolve(candidateHistory,namespace);let files;
    try{files=await readdir(privateDirectory);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const name of files){
      assert.match(name,/^[a-f0-9]{64}\.(json|png|flac)$/,'Invalid candidate CAS identity');
      const retained=resolve(root,'build/content-releases',namespace,name);let info;
      try{info=await lstat(retained);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      assert.ok(info.isFile()&&!info.isSymbolicLink(),'Invalid retained CAS object');
      const [before,after]=await Promise.all([readFile(retained),readFile(resolve(privateDirectory,name))]);
      assert.ok(before.equals(after),'Candidate conflicts with retained immutable bytes: '+name);checked++;
    }
  }
  return checked;
}

const sourceFrameworkDefaults=webSourceFrameworkInputs();
export async function compileSharedContentPackages({root=repository,compiledDir='dist',readJson,
  sourceRecipePaths,sourceSelectionPath,npcAreas=sourceFrameworkDefaults.npcAreas,npcFlat=sourceFrameworkDefaults.npcFlat,fieldEffectFlat=sourceFrameworkDefaults.fieldEffectFlat,
  worldAutoTasks=sourceFrameworkDefaults.worldAutoTasks,
  periodicMaps=sourceFrameworkDefaults.periodicMaps,ordinaryFields=sourceFrameworkDefaults.ordinaryFields,logicalFieldEffects=sourceFrameworkDefaults.logicalFieldEffects}={}){
  root=await realpath(resolve(root));
  // Several existing producers still import the repository's default emitted
  // modules. Do not claim another compiler lock covers that mixed runtime.
  assert.equal(await realpath(resolve(root,compiledDir)),await realpath(resolve(repository,'dist')),
    'Shared public compilation requires the repository dist modules');
  assert.ok(sourceRecipePaths===undefined||sourceSelectionPath===undefined,
    'Choose one source selection or the legacy explicit recipe paths');
  const selection=sourceRecipePaths===undefined
    ? await loadSourceContentSelection({root,path:sourceSelectionPath??'content-batches/source-batches.selection.json',
      reservedPackageIds:['source-batches','source-batch-selection']})
    : await loadSourceRecipePaths({root,paths:sourceRecipePaths,
      reservedPackageIds:['source-batches','source-batch-selection']});
  const preparedRuntime=await runtimeDigest(root,resolve(root,compiledDir));
  readJson??=inputReader(root).json;
  const [{compileBaseContentPackages},{compileDevelopmentContentBatch},{compileSystemsPlayground},
    {compileBattleContentBatch},{compileInitializedSystems},{compileWorldTravel},{compileInitializedContentBatch}]=await Promise.all([
    import('./build-content-packages.mjs'),import('./build-development-content-batch.mjs'),
    import('./build-systems-playground.mjs'),import('./build-battle-content-batch.mjs'),
    import('./build-initialized-systems.mjs'),import('./build-world-travel.mjs'),
    import('./build-initialized-content-batch.mjs'),
  ]);
  const recipes=new Map(selection.inputFiles),payloads=new Map(),reports=[],rebindings=[];
  const recipe=async path=>{const file=resolve(root,path),raw=await readFile(file);
    assert.ok(within(resolve(root,'content-batches'),file),'Recipe must be inside content-batches');
    if(recipes.has(file))assert.equal(sha(raw),recipes.get(file),'Selected recipe changed before compilation: '+path);
    recipes.set(file,sha(raw));return {path,raw,value:JSON.parse(raw.toString()),sha256:sha(raw)};};
  const put=(url,value)=>{assert.match(url,packageURL);
    assert.ok(!payloads.has(url),'Conflicting candidate payload: '+url);payloads.set(url,value);};
  const append=(id,result)=>{
    for(const [url,value] of result.payloads)put(url,value);
    if(result.refs instanceof Map)for(const [name,refs] of result.refs)put('/content-packages/'+name+'.json',refs);
    else if(result.refs)put('/content-packages/'+id+'.json',result.refs);
    if(result.manifest)put('/content-packages/'+id+'/manifest.json',result.manifest);
    if(id!=='base')put('/content-packages/'+id+'/build-report.json',result.report);
    reports.push({id,report:result.report});
  };
  const prerequisites=await compileSourcePrerequisites({root,compiledDir,logicalFieldEffects,periodicMaps,ordinaryFields,npcAreas,npcFlat,fieldEffectFlat,
    mapAnimatedEntities:sourceFrameworkDefaults.mapAnimatedEntities,worldAutoTasks});
  const linked=await linkSourcePrerequisites({root,compiledDir,payloads:prerequisites.payloads,frameworkOptions:prerequisites.frameworkOptions});
  const sourceRead=async url=>linked.inputs.has(url)?structuredClone(linked.inputs.get(url)):readJson(url);
  for(const [url,value] of linked.payloads)payloads.set(url,value);
  reports.push({id:'source-prerequisites',report:prerequisites.report},{id:'linked-source-prerequisites',report:linked.report});
  const ordinary=await recipe('content-batches/ordinary-battles.json');
  const battleRebindings=[...prerequisites.battleRebindings];
  const sourceMessageFeeAddition={kind:'compiled-source-message-fee-addition-v1',compilerDigest:prerequisites.inputs.compilerDigest,sourceSetHash:prerequisites.inputs.sourceSetHash,parentSourceSetHash:prerequisites.inputs.parentSourceSetHash};
  const sourceMessageFeeEvidence=createSourceMessageFeeEvidenceReader({root,compiledDir});
  const sourceMessageFeeBaselines=new Map(prerequisites.sourceMessageFeeBaselines);
  const ordinaryReference=await resolveCompiledBattleReference({root,compiledDir,
    reference:ordinary.value.baseCatalogRef,readCurrentJson:readJson,readCandidateJson:sourceRead,battleRebindings,sourceMessageFeeAddition,sourceMessageFeeEvidence,sourceMessageFeeBaselines});
  const ordinaryDeclaration={...ordinary.value,baseCatalogRef:ordinaryReference.reference};
  if(ordinaryReference.report)rebindings.push({id:'ordinary-battles',kind:'battle-declaration-inputs-v1',
    recipePath:ordinary.path,recipeSha256:ordinary.sha256,battleCapabilityRebindings:[ordinaryReference.report]});
  const noFeeBase=sourceMessageFeeBaselines.get(ordinary.value.baseCatalogRef.url);
  assert.ok(noFeeBase,'Ordinary content requires the same producer fee baseline');
  const noFeeDeclaration={...ordinaryDeclaration,baseCatalogRef:{
    ...ordinaryDeclaration.baseCatalogRef,contentHash:noFeeBase.baseline.contentHash}};
  const [base,battles,noFeeBattles]=await Promise.all([
    compileBaseContentPackages({root,readJson:sourceRead}),compileBattleContentBatch(root,ordinaryDeclaration,{readJson:sourceRead}),
    compileBattleContentBatch(root,noFeeDeclaration,{readJson:async url=>
      url===ordinary.value.baseCatalogRef.url?structuredClone(noFeeBase.baseline):sourceRead(url)})]);
  assert.ok(noFeeBattles.catalog,'Ordinary fee audit baseline is blocked');
  assert.ok(battles.catalog,'Ordinary battle content candidate is blocked');append('base',base);
  const {verifyContent,hash}=Object.assign({},...await Promise.all([
    import(pathToFileURL(resolve(root,compiledDir,'src/core/content-integrity.js')).href),
    import(pathToFileURL(resolve(root,compiledDir,'src/compiler/content.js')).href)]));
  const previousOrdinary=await verifyContent(structuredClone(await readJson('/content-batches/ordinary-battles/battle.json')));
  battleRebindings.push({kind:'compiled-battle-rebinding-v1',url:'/content-batches/ordinary-battles/battle.json',
    previousHash:previousOrdinary.contentHash,candidateHash:battles.catalog.contentHash,
    compilerDigest:prerequisites.inputs.compilerDigest,sourceContentHash:battles.catalog.common.sourceContentHash,
    fieldSourceSetHash:battles.catalog.common.fieldSourceSetHash,gameStateHash:hash(battles.catalog.gameState)});
  const ordinaryFeeBaseline=noFeeBattles.catalog;
  await verifyContent(ordinaryFeeBaseline);
  sourceMessageFeeBaselines.set('/content-batches/ordinary-battles/battle.json',{baseline:ordinaryFeeBaseline,rebinding:{
    kind:'compiled-battle-rebinding-v1',url:'/content-batches/ordinary-battles/battle.json',
    previousHash:previousOrdinary.contentHash,candidateHash:ordinaryFeeBaseline.contentHash,
    compilerDigest:prerequisites.inputs.compilerDigest,sourceContentHash:ordinaryFeeBaseline.common.sourceContentHash,
    fieldSourceSetHash:ordinaryFeeBaseline.common.fieldSourceSetHash,gameStateHash:hash(ordinaryFeeBaseline.gameState)}});
  reports.push({id:'source-message-fee-baselines',report:{
    kind:'same-input-compiled-message-fee-baselines-v1',compilerDigest:prerequisites.inputs.compilerDigest,
    sourceSetHash:prerequisites.inputs.sourceSetHash,parentSourceSetHash:prerequisites.inputs.parentSourceSetHash,
    policy:'omit-source-message-fees-for-addition-audit-v1',grantsSourceAdmission:false,
    baselines:[...sourceMessageFeeBaselines].map(([url,value])=>({url,...value}))}});
  const candidateRead=async url=>url==='/content-batches/ordinary-battles/battle.json'
    ? structuredClone(battles.catalog):sourceRead(url);
  const sourceWalkEvidence=createSourceWalkEvidenceReader({root,compiledDir});
  const sourceEventActivationEvidence=createSourceEventActivationEvidenceReader({root,compiledDir});
  const sourceMapAnimationEvidence=createSourceMapAnimationEvidenceReader({root,compiledDir});
  const sourceNpcRouteEvidence=createSourceNpcRouteEvidenceReader({root,compiledDir});
  const frameworkNpcAreaAddition=prerequisites.frameworkOptions.npcAreaAssessments?createFrameworkNpcAreaAddition({
    compilerDigest:prerequisites.inputs.compilerDigest,assessments:prerequisites.frameworkOptions.npcAreaAssessments,
    catalog:await sourceRead('/framework/world/catalog.json'),entry:await sourceRead('/framework/new-game.json')}):undefined;
  const frameworkNpcAreaEvidence=frameworkNpcAreaAddition?createFrameworkNpcAreaEvidenceReader({root,compiledDir,
    readSourceWorld:()=>sourceRead('/world/catalog.json'),readSourceMap:async mapId=>{
      const catalog=await sourceRead('/world/catalog.json');return sourceRead(catalog.maps[String(mapId)].url);}}):undefined;
  const frameworkNpcFlatAddition=prerequisites.frameworkOptions.npcFlatAssessments?createFrameworkNpcFlatAddition({compilerDigest:prerequisites.inputs.compilerDigest,assessments:prerequisites.frameworkOptions.npcFlatAssessments,
    catalog:await sourceRead('/framework/world/catalog.json'),entry:await sourceRead('/framework/new-game.json')}):undefined;
  const frameworkNpcFlatEvidence=frameworkNpcFlatAddition?createFrameworkNpcFlatEvidenceReader({root,compiledDir,readSourceWorld:()=>sourceRead('/world/catalog.json'),
    readSourceMap:async mapId=>{const catalog=await sourceRead('/world/catalog.json');return sourceRead(catalog.maps[String(mapId)].url);}}):undefined;
  const frameworkFieldEffectFlatAddition=prerequisites.frameworkOptions.fieldEffectFlat?createFrameworkFieldEffectFlatAddition({compilerDigest:prerequisites.inputs.compilerDigest,assessment:prerequisites.frameworkOptions.fieldEffectFlat,
    catalog:await sourceRead('/framework/world/catalog.json'),entry:await sourceRead('/framework/new-game.json')}):undefined;
  const frameworkFieldEffectFlatEvidence=frameworkFieldEffectFlatAddition?createFrameworkFieldEffectFlatEvidenceReader({root,compiledDir,logicalInputDirectory:prerequisites.inputs.logicalFieldEffects.input,readSourceWorld:()=>sourceRead('/world/catalog.json'),
    readSourceMap:async mapId=>{const catalog=await sourceRead('/world/catalog.json');return sourceRead(catalog.maps[String(mapId)].url);}}):undefined;
  const frameworkOrdinaryPresentationAddition=prerequisites.frameworkOptions.ordinaryPresentations?createFrameworkOrdinaryPresentationAddition({
    compilerDigest:prerequisites.inputs.compilerDigest,assessments:prerequisites.frameworkOptions.ordinaryPresentations,
    strictWorld:await sourceRead('/world/catalog.json'),catalog:await sourceRead('/framework/world/catalog.json'),entry:await sourceRead('/framework/new-game.json')}):undefined;
  const frameworkOrdinaryPresentationEvidence=frameworkOrdinaryPresentationAddition?createFrameworkOrdinaryPresentationEvidenceReader({root,compiledDir,
    compilerDigest:prerequisites.inputs.compilerDigest,
    readSourceWorld:()=>sourceRead('/world/catalog.json'),readSourceMap:async mapId=>{const catalog=await sourceRead('/world/catalog.json');return sourceRead(catalog.maps[String(mapId)].url);}}):undefined;
  const resolveRecipe=async path=>{
    const original=await recipe(path);
    const resolved=await resolveSourceRecipeInputs({root,compiledDir,recipePath:path,recipeBytes:original.raw,
      readCurrentJson:readJson,readCandidateJson:candidateRead,sourceWalkEvidence,battleRebindings,sourceMessageFeeAddition,sourceMessageFeeEvidence,sourceMessageFeeBaselines,sourceMapAnimationEvidence,sourceNpcRouteEvidence,
      sourceEventActivationEvidence,sourceEventActivationAddition:{kind:'compiled-source-event-activation-addition-v1',
        compilerDigest:prerequisites.inputs.compilerDigest,sourceSetHash:prerequisites.inputs.sourceSetHash,
        parentSourceSetHash:prerequisites.inputs.parentSourceSetHash},
      sourceMapAnimationAddition:{kind:'compiled-source-map-animation-import-addition-v1',compilerDigest:prerequisites.inputs.compilerDigest,
        sourceSetHash:prerequisites.inputs.sourceSetHash,parentSourceSetHash:prerequisites.inputs.parentSourceSetHash},
      sourceNpcInitialPoseAddition:{kind:'compiled-source-npc-initial-pose-contract-addition-v1',compilerDigest:prerequisites.inputs.compilerDigest,
        sourceSetHash:prerequisites.inputs.sourceSetHash,parentSourceSetHash:prerequisites.inputs.parentSourceSetHash},
      sourceNpcRoutesAddition:{kind:'compiled-source-npc-route-evidence-addition-v1',compilerDigest:prerequisites.inputs.compilerDigest,
        sourceSetHash:prerequisites.inputs.sourceSetHash,parentSourceSetHash:prerequisites.inputs.parentSourceSetHash},
      frameworkNpcAreaAddition,frameworkNpcAreaEvidence,frameworkNpcFlatAddition,frameworkNpcFlatEvidence,frameworkFieldEffectFlatAddition,frameworkFieldEffectFlatEvidence,frameworkOrdinaryPresentationAddition,frameworkOrdinaryPresentationEvidence,
      frameworkProfileUpgrade:{kind:prerequisites.frameworkOptions.worldAutoTasks?'compiled-framework-profile-upgrade-v5':'compiled-framework-profile-upgrade-v4',
        compilerDigest:prerequisites.inputs.compilerDigest,markers:{
          storyRuntime:'web-field-story-runtime-v1',autoSave:'web-field-autosave-barrier-v1',mapAnimatedEntities:'web-field-animated-map-entities-v1',
          ...(prerequisites.frameworkOptions.worldAutoTasks?{worldAutoTasks:prerequisites.frameworkOptions.worldAutoTasks}:{}),
          ...(prerequisites.frameworkOptions.logicalFieldEffects?{logicalFieldEffects:'web-logical-all-loop-field-effects-v1'}:{}),
          ...(prerequisites.frameworkOptions.periodicPresentations?{worldMap:'framework-world-map-flat-v1'}:{}),
          ...(prerequisites.frameworkOptions.periodicPresentations||prerequisites.frameworkOptions.ordinaryPresentations?{fieldPresentation:'framework-ordinary-field-flat-v1'}:{})},
        ...(prerequisites.frameworkOptions.logicalFieldEffects?{logicalFieldEffects:prerequisites.frameworkOptions.logicalFieldEffects.catalog}:{})}});
    rebindings.push(resolved.report);return {...original,value:resolved.recipe};
  };
  const [playRecipe,initRecipe,travelRecipe,developmentRecipe,...sourceRecipes]=await Promise.all([
    ...['systems-playground','systems-initialized','world-travel','figaro-development'].map(name=>
      resolveRecipe('content-batches/'+name+'.recipe.json')),
    ...selection.items.map(item=>resolveRecipe(item.path))]);
  let sourceBattleDirectory;
  {
    const declaration=await recipe('content-batches/source-battle-directory.policy.json');
    const {compileSourceBattleDirectory}=await import('./source-battle-directory.mjs');
    const catalog=await sourceRead('/world/catalog.json');
    const maps=await Promise.all(Object.values(catalog.maps).map(ref=>sourceRead(ref.url)));
    sourceBattleDirectory=await compileSourceBattleDirectory({root,compiledDir,world:{catalog,maps},
      baseCatalog:await sourceRead('/game/source-catalog.json'),policy:declaration.value});
    for(const [name,value] of [['strict',sourceBattleDirectory.strictCatalog],
      ['framework',sourceBattleDirectory.frameworkCatalog],['requests',sourceBattleDirectory.requests]])
      put('/content-packages/source-battle-directory/'+name+'.json',value);
    put('/content-packages/source-battle-directory/build-report.json',sourceBattleDirectory.report);
    reports.push({id:'source-battle-directory',report:sourceBattleDirectory.report});
  }
  // Parallel pure preparation; no producer writes the live registry or an
  // independent battle cache. Derived packages read this build's battle body.
  const derived=await Promise.all([
    compileDevelopmentContentBatch({root,readJson:candidateRead,recipe:developmentRecipe.value,recipeSha256:developmentRecipe.sha256}),
    compileSystemsPlayground(root,playRecipe.value,playRecipe.sha256,{readJson:candidateRead}),
    compileInitializedSystems(root,initRecipe.value,initRecipe.sha256,{dist:compiledDir,readJson:candidateRead}),
    compileWorldTravel(root,travelRecipe.value,travelRecipe.sha256,{dist:compiledDir,readJson:candidateRead}),
    ...sourceRecipes.map(item=>compileInitializedContentBatch(root,item.value,item.sha256,
      {dist:compiledDir,readJson:candidateRead,sourceBattleDirectory,...(prerequisites.frameworkOptions.worldAutoTasks?{worldAutoTasks:prerequisites.frameworkOptions.worldAutoTasks}:{})})),
  ]);
  for(const [index,id] of ['figaro-development','systems-playground','systems-initialized','world-travel'].entries())append(id,derived[index]);
  for(const [index,item] of sourceRecipes.entries())append(item.value.id,derived[index+4]);
  reports.push({id:'ordinary-battles',report:battles.report});
  let sourceWorkSet=null;
  if(selection.items.length){
    const {projectContentBatchWorkSet}=await import(pathToFileURL(
      resolve(root,compiledDir,'src/compiler/content-batch-work-set.js')).href);
    sourceWorkSet=projectContentBatchWorkSet({selection:{id:selection.id,sha256:selection.sha256},
      runtimeSha256:preparedRuntime,batches:selection.items.map((item,index)=>({
        packageId:item.id,label:item.label,recipePath:item.path,recipeSha256:item.sha256,plan:derived[index+4].plan}))});
    put('/content-packages/source-batches/work-plan.json',sourceWorkSet);
  }
  const selectionBody={kind:'source-content-selection-receipt-v1',id:selection.id,path:selection.path,
    sha256:selection.sha256,items:selection.items,
    workPlan:sourceWorkSet?{url:'/content-packages/source-batches/work-plan.json',contentHash:sourceWorkSet.contentHash}:null};
  const {contentDigest}=await import(pathToFileURL(resolve(root,compiledDir,'src/core/content-integrity.js')).href);
  const sourceSelection={...selectionBody,contentHash:await contentDigest(selectionBody)};
  put('/content-packages/source-batches/selection.json',sourceSelection);
  reports.push({id:'source-batch-selection',report:sourceSelection});
  return {payloads,reports,recipes,rebindings,sourceInputs:prerequisites.inputs,sourceSelection,battleRebindings,
    runtimeSha256:preparedRuntime,
    validateInputs:async()=>{
      await validateSourcePrerequisiteInputs(prerequisites.inputs,{root});
      assert.equal(await runtimeDigest(root,resolve(root,compiledDir)),preparedRuntime,
        'Runtime changed while compiling the selected source batches');
    }};
}

export async function publishContentPackages({root=repository,compiledDir='dist',compile=compileSharedContentPackages,
  archive=archivePublishedContentPackages,reportPath='build/reports/versioned-content-package-build.json',
  sourceRecipePaths,sourceSelectionPath}={}){
  root=await realpath(resolve(root));const build=resolve(root,'build'),target=resolve(build,'content-packages');
  const backup=resolve(build,'.previous-package-collection');
  const output=resolve(root,reportPath);
  assert.ok(within(resolve(build,'reports'),output),'Pipeline report must be inside build/reports');
  const report={kind:'versioned-content-package-build-v2',result:'running',published:false,stages:[],
    sourceGameplayAdmitted:false,fullGameMigration:false,browserVerified:false};
  const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
  let lock=null,staged=null,candidateHistory=null;
  async function stage(name,work){const item={name,status:'running'};report.stages.push(item);await persist();
    try{const value=await work();item.status='passed';await persist();return value;}
    catch(error){item.status='failed';throw error;}}
  try{
    await mkdir(resolve(output,'..'),{recursive:true});
    lock=await acquireContentPackageLock(root);
    // A refused overlapping invocation must not replace the running report.
    await persist();
    try{await stat(backup);throw new Error('Inspect interrupted content package collection publication');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const previousFingerprint=await fingerprint(target),reader=inputReader(root);
    const candidate=await stage('compile-private-candidate',()=>compile({root,compiledDir,sourceRecipePaths,sourceSelectionPath,
      readJson:url=>reader.json(url)}));
    assert.ok(candidate?.payloads instanceof Map&&candidate.payloads.size>0,'Content candidate has no payloads');
    if(candidate.sourceInputs)assert.match(candidate.runtimeSha256,/^[a-f0-9]{64}$/,
      'Source publication requires the candidate runtime identity');
    report.producers=candidate.reports??[];
    if(candidate.sourceSelection)report.sourceSelection=candidate.sourceSelection;
    report.recipeRebindings=candidate.rebindings??[];
    report.battleCapabilityRebindings=candidate.battleRebindings??[];
    if(candidate.sourceInputs)report.sourceInputLock={kind:candidate.sourceInputs.kind,
      runtimeSha256:candidate.runtimeSha256,sourceSetHash:candidate.sourceInputs.sourceSetHash,
      parentSourceSetHash:candidate.sourceInputs.parentSourceSetHash,compiledDir,
      compilerDigest:candidate.sourceInputs.compilerDigest,files:candidate.sourceInputs.files.length,
      directories:candidate.sourceInputs.directories.length};
    const api=Object.assign({},...await Promise.all(['core/game-content','core/game-content-refs','core/content-integrity','core/canonical'].map(name=>
      import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href))));
    staged=await mkdtemp(resolve(build,'.package-candidate-'));
    if(previousFingerprint!==null)await cp(target,staged,{recursive:true,verbatimSymlinks:true});
    for(const [url,value] of candidate.payloads){
      assert.match(url,packageURL);const file=resolve(staged,url.slice('/content-packages/'.length)),parent=resolve(file,'..');
      await mkdir(parent,{recursive:true});
      assert.ok(parent===staged||within(staged,await realpath(parent)),'Candidate namespace escapes its directory');
      let bytes=Buffer.from(api.canonical(value)+'\n');
      // An unchanged body keeps the exact original bytes. Also reuse verified
      // retained bytes when linking that body under another package URL.
      const previous=[];
      if(/^[a-f0-9]{64}$/.test(value?.contentHash??''))previous.push(
        resolve(root,'build/content-releases/objects',value.contentHash+'.json'));
      previous.push(file);
      for(const existing of previous){
        try{
          const info=await lstat(existing);
          if(!info.isFile()||info.isSymbolicLink())continue;
          const raw=await readFile(existing),parsed=JSON.parse(raw.toString());
          if(api.canonical(parsed)===api.canonical(value)){bytes=raw;break;}
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      await rm(file,{force:true});await writeFile(file,bytes);
    }
    const candidateBytes=async url=>{
      if(!url.startsWith('/content-packages/'))return reader.bytes(url);
      assert.match(url,packageURL);const file=await realpath(resolve(staged,url.slice('/content-packages/'.length)));
      assert.ok(within(staged,file),'Candidate JSON escapes its directory');return readFile(file);
    };
    await stage('validate-all-package-closures',async()=>{
      report.packages=[];report.indexedMaps=0;
      for(const name of (await readdir(staged)).sort()){
        if(!/^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(name))continue;
        const raw=JSON.parse((await candidateBytes('/content-packages/'+name)).toString());
        if(!['game-content-refs-v1','game-content-refs-v2'].includes(raw.kind))continue;
        const refs=api.parseGameContentRefs(raw),game=new api.GameContentRepository(
          async url=>JSON.parse((await candidateBytes(url)).toString()),refs.profile,refs);
        const world=await game.world();
        if(game.hasSourceEntry)await game.sourceNewGame();
        if(game.hasDevelopmentEntry)await game.opening();
        if(game.hasInitializedEntry)await game.initializedNewGame();
        for(const [key,ref] of Object.entries(world.maps)){
          assert.equal(String(Number(key)),key,'Invalid map index identity');
          const map=await api.verifyContent(JSON.parse((await candidateBytes(ref.url)).toString()),ref.contentHash);
          api.assertGameWorldMapIdentity(Number(key),world,map);report.indexedMaps++;}
        report.packages.push(name.slice(0,-5));
      }
      assert.ok(report.packages.length,'Candidate has no content-package references');
    });
    candidateHistory=await mkdtemp(resolve(build,'.package-candidate-history-'));
    report.candidate=await stage('validate-complete-json-and-media-archive',()=>archive({root,compiledDir,
      packageDirectory:staged,out:candidateHistory,readJson:candidateBytes,readMedia:url=>reader.media(url)}));
    report.before=await stage('archive-published-before-publication',()=>archive({root,compiledDir,packageDirectory:target}));
    report.retainedCASObjects=await stage('validate-retained-CAS-compatibility',()=>validatePublicCAS(root,candidateHistory));
    await stage('validate-unchanged-inputs',async()=>{
      if(candidate.validateInputs)await candidate.validateInputs();
      await reader.validate();
      for(const [file,digest] of candidate.recipes??[])assert.equal(sha(await readFile(file)),digest,
        'Recipe changed during candidate preparation');
      assert.equal(await fingerprint(target),previousFingerprint,'Published package collection changed during candidate preparation');
    });
    await stage('publish-complete-collection',async()=>{
      let previous=false;
      try{await rename(target,backup);previous=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      try{await rename(staged,target);}catch(error){if(previous)await rename(backup,target);throw error;}
      staged=null;report.published=true;
      if(previous)await rm(backup,{recursive:true});
    });
    // Once published, metadata failures require repair, never a rollback of
    // content which a live app may already use.
    report.after=await stage('archive-published-after-publication',()=>archive({root,compiledDir,packageDirectory:target}));
    if(candidate.sourceInputs)await stage('verify-published-source-objects',async()=>{
      report.publishedObjects=[];
      for(const [url,value] of [...candidate.payloads].filter(([url])=>
        url==='/content-packages/source.json'||url.startsWith('/content-packages/source/')).sort(([a],[b])=>a.localeCompare(b))){
        assert.match(url,packageURL);
        const file=await realpath(resolve(target,url.slice('/content-packages/'.length)));
        assert.ok(within(target,file),'Published source object escapes its collection');
        const raw=await readFile(file),parsed=JSON.parse(raw.toString());
        assert.equal(api.canonical(parsed),api.canonical(value),'Published source object differs from its validated candidate');
        report.publishedObjects.push({url,contentHash:typeof value.contentHash==='string'?value.contentHash:null,
          sha256:sha(raw),bytes:raw.length});
      }
      assert.equal(await runtimeDigest(root,resolve(root,compiledDir)),candidate.runtimeSha256,
        'Runtime changed during complete collection publication');
    });
    report.upstreamJSONFiles=reader.inputs.size;report.upstreamMediaFiles=reader.mediaInputs.size;
    report.result='passed';await persist();return report;
  }catch(error){
    const failure=error instanceof Error?error:new Error(String(error),{cause:error});
    report.result='failed';report.error=String(failure.stack??failure);failure.report=report;
    if(lock)try{await persist();}catch(reportError){console.error('Unable to retain pipeline report:',reportError);}
    throw failure;
  }finally{
    if(staged)await rm(staged,{recursive:true,force:true});
    if(candidateHistory)await rm(candidateHistory,{recursive:true,force:true});
    if(lock)await lock();
  }
}
