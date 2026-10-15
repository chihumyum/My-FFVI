import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';
// Whole kind-11 map/source namespace acceptance. Original scripts and source
// initialization remain intact. Every unknown prerequisite is reported.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {compileInitializedContentBatch} from './build-initialized-content-batch.mjs';
import {deriveLogicalFieldEffects} from './derive-logical-field-effects.mjs';
import {compileLogicalFieldEffects} from './compile-logical-field-effects.mjs';
import {validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
import {assessStoryRuntimePublication} from './plan-story-runtime.mjs';
import {controlledAudioRuntime} from './controlled-audio.mjs';
const repository=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
/** Static targeting only; this does not count executed PCs or prove branches. */
export function collectFieldEffectProgramTargets(map,ops,acceptedGroups) {
 const boards=Object.values(map.map?.groups??{}).flatMap(group=>group.entities.filter(entity=>entity.kind===11));
 const groupNames=Object.entries(map.map?.groups??{}).filter(([,group])=>group.entities.some(entity=>entity.kind===11)).map(([name])=>name);
 const puppetSites=ops.filter(op=>op.kind==='puppet'&&boards.some(entity=>entity.id===op.actor));
 const groupSites=ops.filter(op=>op.kind==='entities'&&groupNames.includes(op.group));
 if(!puppetSites.length&&!groupSites.length)return null;
 const selected=boards.filter(entity=>puppetSites.some(op=>op.actor===entity.id)||groupSites.some(op=>map.map.groups[op.group].entities.some(board=>board.kind===11&&board.id===entity.id)));
 const bindings=[...new Map(selected.map(entity=>{const row={id:entity.id,assetGroup:entity.effect?.assetGroup??null,accepted:acceptedGroups.has(entity.effect?.assetGroup)};return[JSON.stringify(row),row];})).values()];
 const accepted=bindings.some(row=>row.accepted),rejected=bindings.some(row=>!row.accepted);
 return {classification:accepted?(rejected?'mixed':'accepted-related'):'rejected-only',referencedBoards:bindings,
   declaredEffectPuppetSites:puppetSites.map(op=>op.index),declaredEffectGroupSites:groupSites.map(op=>op.index)};
}
export async function runLogicalFieldEffectsLifecycle({root=repository,compiled='dist',runtimeRoot=repository,
 effectInputDirectory='build/field-effect-media',candidateDirectory,candidateObservationRuntime}={}){
 root=resolve(root);runtimeRoot=resolve(runtimeRoot);compiled=resolve(root,compiled);
 const load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')).href);
 const {readSnapshot}=await load('compiler/integrity');
 const corpusDirectory=resolve(root,'build/corpus'),corpusSnapshotBytes=await readFile(resolve(corpusDirectory,'snapshot.json')),corpusSnapshot=await readSnapshot(corpusDirectory);
 const [{GameContentRepository},{GameSession},{GameFlow},{compileFrameworkNewGame},{compileFrameworkContent},
  {canonical,hash},{loadCorpus,analyzeCorpus},{loadSystemMessages},{createWebLogicalFieldEffectsHost,WEB_LOGICAL_FIELD_EFFECTS},
  {createWebFieldMessageSequencePort},{createWebFlatConditionLeaderActivityPort}]=await Promise.all([
   load('core/game-content'),load('core/game-session'),load('core/game-flow'),load('compiler/framework-new-game'),
   load('compiler/framework-content'),load('compiler/content'),load('compiler/corpus'),load('compiler/system-messages'),
   load('core/field-logical-effects'),load('core/source-message-sequence'),load('core/field-condition-activity')]);
 const checkerBefore=sha(await readFile(new URL(import.meta.url))),before=await runtimeDigest(runtimeRoot,compiled),bound=new Map(),sourceObjects=new Map();
 const boundRead=async file=>{file=resolve(file);const bytes=await readFile(file);if(bound.has(file))assert.equal(sha(bytes),sha(bound.get(file)),'Source input changed');else bound.set(file,bytes);return bytes;};
 let refs,origin,validateOrigin,sourceInputLock;
 if(candidateDirectory!==undefined){
   const cache=resolve(root,candidateDirectory),part=relative(resolve(root,'build'),cache);
   assert.ok(part&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part),'Private candidates must be local build prerequisites');
   const receiptBytes=await boundRead(resolve(cache,'receipt.json')),receipt=JSON.parse(receiptBytes);
   assert.equal(receipt.kind,'private-fresh-source-world-v2');assert.equal(receipt.published,false);
   if(receipt.runtimeSha256!==before) {
     assert.equal(candidateObservationRuntime,receipt.runtimeSha256,'An observation-only continuation must explicitly identify the frozen producer runtime');
   } else assert.ok(candidateObservationRuntime===undefined||candidateObservationRuntime===before);

   assert.equal(resolve(receipt.compiledScope),compiled);sourceInputLock=JSON.parse(await boundRead(resolve(cache,'source-input-lock.json')));
   await validateSourcePrerequisiteInputs(sourceInputLock,{root});
   for(const row of receipt.objects){const bytes=await boundRead(resolve(cache,row.url.slice('/content-packages/'.length)));assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);sourceObjects.set(row.url,JSON.parse(bytes));}
   refs=receipt.refs;origin={kind:'same-candidate-input-lock',receiptSha256:sha(receiptBytes),published:false,
     producerRuntimeSha256:receipt.runtimeSha256,executionRuntimeSha256:before,sameWholeRuntime:receipt.runtimeSha256===before,
     compiledSourceLockRevalidated:true,observationContinuation:receipt.runtimeSha256!==before};
   validateOrigin=()=>validateSourcePrerequisiteInputs(sourceInputLock,{root});
 }else{
   assert.equal(candidateObservationRuntime,undefined,'Published default requires actual same-runtime publication');
   refs=JSON.parse(await boundRead(resolve(root,'build/content-packages/source.json')));
   origin={kind:'published-same-runtime',published:true};validateOrigin=async()=>{};
 }
 const read=async url=>{
   assert.match(url,/^\/content-packages\/[A-Za-z0-9/_-]+\.json$/,'Only complete versioned package inputs are admitted');
   if(candidateDirectory!==undefined){assert.ok(sourceObjects.has(url),'Unknown private source dependency '+url);return structuredClone(sourceObjects.get(url));}
   const value=JSON.parse(await boundRead(resolve(root,'build','.'+url)));sourceObjects.set(url,value);return value;
 };
 const repositoryContent=new GameContentRepository(read,'source',refs),bundle=await repositoryContent.sourceNewGame(),sourceWorld=await repositoryContent.world(),
 corpus=await loadCorpus(root),system=await loadSystemMessages(root,corpus.manifest.parentSourceSetHash,corpus.manifest.sources),
 analysis=analyzeCorpus(corpus.assets,corpus.tables,{...corpus.messages,system_zhc:system.messages},corpus.sourceSetHash),sourceMaps=new Map();
 for(const id of Object.keys(sourceWorld.maps).map(Number))sourceMaps.set(id,await repositoryContent.map(id,sourceWorld));
 const effectInput=await compileLogicalFieldEffects({root,compiled,runtimeRoot,input:effectInputDirectory});
 if(candidateDirectory===undefined){
   const receipt=JSON.parse(await boundRead(resolve(root,'build/reports/versioned-content-package-build.json')));
   const inputFiles=[...bound].filter(([file])=>file.startsWith(resolve(root,'build/content-packages')+sep)).map(([file,bytes])=>({
     url:'/'+relative(resolve(root,'build'),file).split(sep).join('/'),sha256:sha(bytes),bytes:bytes.length,contentHash:JSON.parse(bytes).contentHash??null}));
   const mapInventory=[...sourceMaps.values()].map(map=>{const url=sourceWorld.maps[map.mapId].url,row=inputFiles.find(item=>item.url===url);return{mapId:map.mapId,url,contentHash:map.contentHash,sha256:row.sha256,bytes:row.bytes};});
   const provenance=assessStoryRuntimePublication({receipt,runtimeSha256:before,compiledDirectory:compiled,refs,
     manifest:{sourceSetHash:sourceWorld.sourceSetHash,parentSourceSetHash:sourceWorld.parentSourceSetHash,
       worldContentHash:sourceWorld.contentHash,refsURL:'/content-packages/source.json',refsSha256:sha(bound.get(resolve(root,'build/content-packages/source.json')))},
     inputFiles,mapInventory,canonical});
   assert.equal(provenance.status,'verified','A complete same-runtime publication is required: '+canonical(provenance));origin.provenance=provenance;
   const frameworkRefs=JSON.parse(await boundRead(resolve(root,'build/content-packages/framework.json'))),frameworkRepo=new GameContentRepository(read,'framework',frameworkRefs),world=await frameworkRepo.world();
   const linkedProof=receipt.producers.filter(row=>row.id==='linked-source-prerequisites');assert.equal(linkedProof.length,1);
   assert.equal(world.contentHash,linkedProof[0].report.frameworkWorldHash,'Published framework must match this same producer');
   const frameworkBundle=await frameworkRepo.sourceNewGame();assert.equal(frameworkBundle.content.contentHash,linkedProof[0].report.frameworkEntryHash);
   assert.equal(world.developmentProfile?.logicalFieldEffects,WEB_LOGICAL_FIELD_EFFECTS);
   let expectedPublishedEffects=effectInput.catalog;
   if(world.developmentProfile?.fieldEffectProjection!==undefined){
     assert.equal(world.developmentProfile.fieldEffectProjection,'web-source-field-effect-flat-v1');
     const {assessFrameworkFieldEffectFlatWorld,projectFrameworkFieldEffectCatalog}=await load('compiler/framework-field-effect-flat-projection'),
       projection=linkedProof[0].report.fieldEffectProjection;
     assert.ok(projection,'Published board projection must name its same-candidate assessment');
     const assessment=assessFrameworkFieldEffectFlatWorld(corpus,sourceWorld,[...sourceMaps.values()],effectInput.catalog,projection.declaration.reason);
     assert.equal(assessment.contentHash,projection.assessmentHash);
     expectedPublishedEffects=projectFrameworkFieldEffectCatalog(effectInput.catalog,assessment);
   }
   for(const id of Object.keys(world.maps).map(Number)){const map=await frameworkRepo.map(id,world);assert.equal(map.developmentProfile?.logicalFieldEffects,WEB_LOGICAL_FIELD_EFFECTS);assert.equal(map.developmentProfile?.fieldEffectProjection,world.developmentProfile?.fieldEffectProjection);assert.equal(canonical(map.fieldEffects),canonical(expectedPublishedEffects),'Published framework must carry the freshly verified same catalog and optional exact board projection');}
 }
const mapIds=[...sourceMaps.values()].filter(m=>Object.values(m.map?.groups??{}).some(g=>g.entities.some(e=>e.kind===11))).map(m=>m.mapId).sort((a,b)=>a-b);
const framework=compileFrameworkContent(sourceWorld,[...sourceMaps.values()],bundle.content),derivedById=new Map(framework.maps.map(m=>[m.mapId,m])),logical=effectInput.catalog,allEligible=new Set(Object.keys(logical.media)),serviceMapIds=mapIds.filter(id=>Object.values(sourceMaps.get(id).map?.groups??{}).some(g=>g.entities.some(e=>e.kind===16))),startMap=mapIds.find(id=>sourceMaps.get(id).partyEntry?.pointIns.length&&sourceMaps.get(id).entryView?.isWorld===false),first=sourceMaps.get(startMap);assert.ok(first);
const recipe={kind:serviceMapIds.length?'initialized-source-map-recipe-v5':'initialized-source-map-recipe-v4',id:'logical-effects-whole-source-wip',sourceEntry:refs.source.entry,sourceBattle:refs.source.battle,sourceWorld:refs.world,startMap,entrance:first.partyEntry.pointIns[0].id,presentation:'framework-ordinary-field-flat-v1',battleCatalogSelection:'source-baseline-v1',sourceAreaScope:null,walking:null,npcActivity:{kind:'framework-npc-area-template-v1',policy:'framework-npc-area-v1',missingFirstInterval:'source-ctor-true',random:'web-xorshift32-v1',collision:'actor-grid-reservations-v1',schedule:'fixed-step-source-order-v1',takeover:'pause-autonomous-motion-v1',reason:'Same existing explicit app Web NPC lifecycle; no plot phase or script substitution.'},...(serviceMapIds.length?{fieldServices:{kind:'framework-field-services-declaration-v1',relayInteraction:'framework-relay-interaction-v1',passiveEffects:'framework-passive-field-effects-v1',mapIds:serviceMapIds}}:{}),manifest:{kind:'content-batch-manifest-v1',id:'logical-effects-whole-source',profile:'framework',mapIds,roots:[{kind:'entry',mapId:startMap,entrance:first.partyEntry.pointIns[0].id,continuation:first.initializer}],routes:[{id:'logical-effects-source-initializer',entry:'framework-new-game',expectedMapId:startMap,requiredMapIds:mapIds,requiredEncounterIds:[],maxTicks:6000,inputs:[],choiceAnswers:[],battleAbilityIds:[]}]}};
const plain=await compileInitializedContentBatch(root,recipe,hash(recipe),{dist:compiled,readJson:read}),seal=v=>{const{contentHash:_,...b}=v;return{...b,contentHash:hash(b)};};
const preMaps=plain.maps.map(input=>{const map=structuredClone(input),omitted=derivedById.get(map.mapId);map.developmentProfile.omissions=structuredClone(omitted.developmentProfile.omissions);map.developmentOmissions=structuredClone(omitted.developmentOmissions);
 // Reuse exactly the existing full-source anonymous omission result. No new
 // named or effect-specific omission; all retained source boards stay present.
 map.map.entities=structuredClone(omitted.map?.entities??[]);for(const[key,g]of Object.entries(map.map.groups??{})){g.entities=structuredClone(omitted.map.groups[key].entities);g.blockers=structuredClone(omitted.map.groups[key].blockers);}map.blockers=structuredClone(omitted.blockers);
 assert.equal(canonical(map.scripts),canonical(sourceMaps.get(map.mapId).scripts));assert.equal(canonical(map.scriptPuppetContexts),canonical(sourceMaps.get(map.mapId).scriptPuppetContexts));return seal(map);}),byId=new Map(preMaps.map(m=>[m.mapId,m])),worldDraft=structuredClone(plain.catalog);worldDraft.developmentProfile.omissions=framework.report.omissions.filter(o=>byId.has(o.mapId));for(const m of preMaps)worldDraft.maps[m.mapId].contentHash=m.contentHash;
const derivationProducer=resolve(import.meta.dirname,'derive-logical-field-effects.mjs'),derivationBytes=await readFile(derivationProducer),declaration={kind:'web-logical-field-effects-declaration-v1',policy:WEB_LOGICAL_FIELD_EFFECTS,sourceSetHash:logical.webPolicy.sourceSetHash,parentSourceSetHash:logical.webPolicy.parentSourceSetHash,catalogHash:logical.webPolicy.catalogHash,mapIds,reason:'Whole source graph-proven all-loop logical playback with deferred particle/material/minimap display; source scripts and unknown prerequisites remain unchanged.'},derived=await deriveLogicalFieldEffects({root,compiled,catalog:seal(worldDraft),maps:preMaps,effects:logical,declaration}),maps=derived.maps,world=derived.catalog;

const {WEB_SOURCE_ENCOUNTER_POLICY}=await load('core/source-encounter-entry');
const sourceRefKey=r=>canonical(Object.fromEntries(['file','assetPath','objectId','serializedFile','sha256'].map(k=>[k,r[k]]))),physical=new Map(corpus.assets.filter(a=>a.kind==='script').map(a=>[sourceRefKey(a.source),a])),programs=new Map(),inventory=[],cases=[],host={visible:true,mediaReady:true,overlayOpen:false},runtime=()=>({ ...sourceWebReplayRuntimePorts(),...controlledAudioRuntime(),sourceEncounterPolicy:WEB_SOURCE_ENCOUNTER_POLICY,fieldEffects:createWebLogicalFieldEffectsHost(),sourceMessageSequence:createWebFieldMessageSequencePort(),conditionLeaderActivity:createWebFlatConditionLeaderActivityPort(),battleHandoff:'prepared'});
function drain(game,flow,trace){for(let tick=0;tick<6000;tick++){if(game.field.stop)throw new Error('Source VM stopped: '+canonical(game.field.stop));if(!game.field.busy)return tick;if(game.field.dialogue||game.field.sourceMessage.projection?.acceptsInput){trace.push({kind:'source-message-confirm',key:game.field.dialogue?.key??game.field.sourceMessage.projection.key});flow.confirm();}if(game.field.choice)throw new Error('Unspecified original source choice: '+canonical(game.field.choice));flow.advance(10,host);}throw new Error('Whole original source body exceeded declared clock budget');}
for(const map of maps){const source=sourceMaps.get(map.mapId),row={mapId:map.mapId,sourceMapHash:source.contentHash,candidateMapHash:map.contentHash,originalInitializer:map.initializer,defaultBoards:map.map.groups?.entity_default?.entities.filter(e=>e.kind===11).map(e=>({id:e.id,assetGroup:e.effect?.assetGroup,logicalPrefab:allEligible.has(e.effect?.assetGroup)}))??[],originalMapDiagnostics:source.blockers,originalGroupDiagnostics:Object.fromEntries(Object.entries(source.map?.groups??{}).map(([k,g])=>[k,g.blockers])),dependencies:analysis.dependencies.filter(d=>d.mapId&&Number(d.mapId)===map.mapId),fullNamespace:[],effectSourceProgramRoots:[],status:'unready',trace:[]};inventory.push(row);
 for(const[name,ops]of Object.entries(source.scripts)){const refs=[...new Set(ops.map(op=>sourceRefKey(op.source)))];assert.equal(refs.length,1);const asset=physical.get(refs[0]);assert.ok(asset,'Unbound full runtime namespace source '+name);assert.equal(ops.length,asset.data.Mnemonics.length);for(const[index,op]of ops.entries())assert.equal(op.index,index);programs.set(asset.id,{id:asset.id,source:asset.source,rawHash:hash(asset.data),raw:asset.data,instructions:ops.length});row.fullNamespace.push({name,assetId:asset.id,rawHash:hash(asset.data),instructions:ops.length,blocked:ops.filter(op=>op.kind==='blocked')});
 const targets=collectFieldEffectProgramTargets(map,ops,allEligible);if(targets)row.effectSourceProgramRoots.push({name,assetId:asset.id,...targets});
 }
 const installedAssets=new Set(row.fullNamespace.map(program=>program.assetId));
 row.dependencies=analysis.dependencies.filter(dependency=>installedAssets.has(dependency.site.asset));
 try{assert.ok(map.partyEntry?.pointIns.length,'Source entrance metadata missing');const entry=await compileFrameworkNewGame({sourceEntry:bundle.content,sourceBattle:bundle.battle,sourceMap:source,world,map,battle:plain.battle,entrance:map.partyEntry.pointIns[0].id}),files=new Map([[plain.refs.world.url,world],[plain.refs.initialized.entry.url,entry],[plain.refs.initialized.battle.url,plain.battle],...maps.map(m=>[world.maps[m.mapId].url,m])]),refs={...plain.refs,world:{...plain.refs.world,contentHash:world.contentHash},initialized:{entry:{...plain.refs.initialized.entry,contentHash:entry.contentHash},battle:plain.refs.initialized.battle}},repo=new GameContentRepository(async url=>{assert.ok(files.has(url),'Undeclared private candidate dependency '+url);return structuredClone(files.get(url));},'framework',refs),contents=await repo.initializedNewGame(),game=await GameSession.prepareFrameworkNewGame(contents.content,contents.catalog,contents.map,contents.battle,runtime()),flow=new GameFlow(game);flow.start();flow.observeHost(host);const ticks=drain(game,flow,row.trace);row.status='initializer-completed';row.ticks=ticks;row.fxBeforeClock=game.field.fieldEffectsSnapshot;flow.advance(20,host);assert.equal(game.field.stop,null);row.fx=game.field.fieldEffectsSnapshot;if(row.fxBeforeClock){assert.equal(row.fx.instanceCount,row.fxBeforeClock.instanceCount);assert.deepEqual(row.fx.players.map(p=>({cameraId:p.cameraId,references:p.references,playing:p.playing,loopLimit:p.loopLimit,loopCount:p.loopCount})),row.fxBeforeClock.players.map(p=>({cameraId:p.cameraId,references:p.references,playing:p.playing,loopLimit:p.loopLimit,loopCount:p.loopCount})));row.logicalClockObserved=row.fx.players.some((p,i)=>p.elapsedSec>row.fxBeforeClock.players[i].elapsedSec);}
row.bankAfterInitializer=game.field.eventState.snapshot();row.ownedAfterInitializerHash=hash(game.state.snapshot());row.stableSaveReady=game.checkpointReady;if(game.checkpointReady){const saved=game.checkpoint(),restored=GameSession.restore(saved,undefined,contents.battle,{catalog:contents.catalog,map:contents.map,initialized:{content:contents.content,initialMap:contents.map}},runtime());assert.deepEqual(restored.field.fieldEffectsSnapshot,game.field.fieldEffectsSnapshot);assert.deepEqual(restored.state.snapshot(),game.state.snapshot());assert.deepEqual(restored.field.eventState.snapshot(),game.field.eventState.snapshot());const oldFx=game.field.fieldEffectsSnapshot;restored.advance(10);assert.deepEqual(game.field.fieldEffectsSnapshot,oldFx);row.logicalSaveRestore='passed';}
  for(const rootProgram of row.effectSourceProgramRoots){const c={mapId:map.mapId,...rootProgram,status:'unready',trace:[]};cases.push(c);try{if(rootProgram.name===map.initializer){c.status='completed';c.execution='covered-by-original-initializer';c.ticks=row.ticks;c.after={fx:row.fx,banks:row.bankAfterInitializer,ownedHash:row.ownedAfterInitializerHash};continue;}c.execution='full-source-root-after-original-initializer';const g=await GameSession.prepareFrameworkNewGame(contents.content,contents.catalog,contents.map,contents.battle,runtime()),f=new GameFlow(g);f.start();f.observeHost(host);drain(g,f,c.trace);c.before={fx:g.field.fieldEffectsSnapshot,banks:g.field.eventState.snapshot(),ownedHash:hash(g.state.snapshot())};assert.equal(g.field.startEvent(rootProgram.name),true);c.ticks=drain(g,f,c.trace);c.after={fx:g.field.fieldEffectsSnapshot,banks:g.field.eventState.snapshot(),ownedHash:hash(g.state.snapshot())};c.status='completed';if(g.checkpointReady){const saved=g.checkpoint(),restored=GameSession.restore(saved,undefined,contents.battle,{catalog:contents.catalog,map:contents.map,initialized:{content:contents.content,initialMap:contents.map}},runtime());assert.deepEqual(restored.field.fieldEffectsSnapshot,g.field.fieldEffectsSnapshot);c.logicalRestore='passed';}}catch(e){c.reason=String(e.stack??e);}}
 }catch(error){row.reason=String(error.stack??error);for(const rootProgram of row.effectSourceProgramRoots)cases.push({mapId:map.mapId,...rootProgram,status:'unready',execution:'unexecuted-initialization-prerequisite',reason:'Original source map initialization prerequisite failed; full source root was not executed.'});}

}
const rows=[...programs.values()];const report={kind:'all-loop-effects-whole-map-source-lifecycle-v1',result:'completed-with-explicit-unready',runtimeSha256:before,sourceOrigin:origin,fieldEffectInput:effectInput.report,checkerSha256:checkerBefore,sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,recipe,logicalDerivation:{producerSha256:sha(derivationBytes),report:derived.report},buildReport:plain.report,existingAnonymousOmissionPolicy:{kind:'omit-anonymous-environment-particles-v1',fullSourceOmissions:framework.report.omissions.length,retained:framework.report.retained.length,newNamedPassiveAdmission:false},logicalPolicy:logical.webPolicy,counts:{maps:inventory.length,physicalPrograms:rows.length,physicalInstructions:rows.reduce((n,p)=>n+p.instructions,0),namespaceUses:inventory.reduce((n,m)=>n+m.fullNamespace.length,0),initializersCompleted:inventory.filter(m=>m.status==='initializer-completed').length,initializersUnready:inventory.filter(m=>m.status==='unready').length,completedMapsWithOwnedBoards:inventory.filter(m=>m.status==='initializer-completed'&&m.fx?.boards.length).length,completedOwnedBoards:inventory.filter(m=>m.status==='initializer-completed').reduce((n,m)=>n+(m.fx?.boards.length??0),0),actualClockObservedMaps:inventory.filter(m=>m.logicalClockObserved).length,logicalSaveRestores:inventory.filter(m=>m.logicalSaveRestore==='passed').length,effectSourceProgramCases:cases.length,effectRootClassification:Object.fromEntries(['accepted-related','rejected-only','mixed'].map(kind=>[kind,cases.filter(row=>row.classification===kind).length])),effectSourceProgramCompleted:cases.filter(c=>c.status==='completed').length,effectSourceProgramUnready:cases.filter(c=>c.status==='unready').length},maps:inventory,cases,evidence:{actualRepository:true,actualSession:true,actualFlow:true,sourceProgramsPreserved:true,originalInitializerPreserved:true,actualParticleSimulation:false,sourceStoryReachability:false,nativeParity:false,plotFlagsInjected:false,rosterInjected:false},limitations:['Generic PointIn relocation and ordinary flat-map preparation are controlled research states, never main-story reachability or coverage of independently declared periodic-world variants.','Complete map namespace retention includes Residents; unknown instructions, branches, external transitions, choices and provider gaps remain explicit.','No source body, live actor, roster, inventory or plot flag is rewritten to improve completion counts.','Shared continuous failure/retry/save/battle/renderer contracts are separately exercised in authored lifecycle acceptance; static graph/map counts are not source execution counts.']};const finalCorpus=await readSnapshot(corpusDirectory);assert.equal(sha(await readFile(resolve(corpusDirectory,'snapshot.json'))),sha(corpusSnapshotBytes),'Corpus snapshot manifest changed');assert.equal(finalCorpus.size,corpusSnapshot.size);for(const[name,bytes]of corpusSnapshot)assert.equal(sha(finalCorpus.get(name)),sha(bytes),'Complete corpus input changed: '+name);await loadCorpus(root);assert.equal(sha(await readFile(derivationProducer)),sha(derivationBytes));assert.equal(sha(await readFile(new URL(import.meta.url))),checkerBefore);assert.equal(await runtimeDigest(runtimeRoot,compiled),before);await validateOrigin();for(const[file,bytes]of bound)assert.equal(sha(await readFile(file)),sha(bytes),'Source/package input changed during complete lifecycle acceptance');return {report,derivation:derived.report,programs:{sourceSetHash:corpus.sourceSetHash,programs:rows}};

}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const options={},args=process.argv.slice(2);let output='build/reports/logical-field-effects-lifecycle';
 for(let i=0;i<args.length;i+=2){assert.ok(['--root','--compiled','--runtime-root','--effect-input','--candidate-directory','--candidate-observation-runtime','--output'].includes(args[i])&&args[i+1]);
  if(args[i]==='--output')output=args[i+1];else options[{'--root':'root','--compiled':'compiled','--runtime-root':'runtimeRoot','--effect-input':'effectInputDirectory','--candidate-directory':'candidateDirectory','--candidate-observation-runtime':'candidateObservationRuntime'}[args[i]]]=args[i+1];}
 const result=await runLogicalFieldEffectsLifecycle(options),root=resolve(options.root??repository),out=resolve(root,output),part=relative(resolve(root,'build'),out);
 assert.ok(part&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)&&!part.split(sep).some(name=>['content-packages','content-releases'].includes(name)),'Lifecycle reports must be outside public collections');
 await mkdir(out,{recursive:true});for(const[name,value]of [['report',result.report],['derivation',result.derivation],['full-source-programs',result.programs]])await writeFile(resolve(out,name+'.json'),JSON.stringify(value,null,2)+'\n');
 console.log(JSON.stringify({result:result.report.result,sourceOrigin:result.report.sourceOrigin,counts:result.report.counts}));
}
