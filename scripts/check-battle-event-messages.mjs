// Whole source programs and actual source operands are separate experiments.
// Every execution uses GameSession/BattleGame/the actual Field message owner.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {openSourceCandidate} from './source-candidate.mjs';
import { sourceWebReplayRuntimePorts, sourceWebReplayFieldEffectsHost } from './source-web-replay-runtime.mjs';
import {createSourceReplayGauMedia,SOURCE_REPLAY_PNG_ACK} from './source-replay-gau-media.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {observerErrorDetails,observedBattleEffects,observationDraftJSON} from './battle-observer-results.mjs';
import {chooseBattleObserverInput,BATTLE_OBSERVER_INPUT_POLICY} from './battle-observer-inputs.mjs';
import {createVerifiedBattleObserverCallers} from './battle-observer-verified-callers.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),o={compiled:'dist',report:'build/reports/battle-event-messages/check.json'},seen=new Set();
while(args.length){const f=args.shift();assert(['--compiled','--report','--candidate-dir','--smoke','--family','--caller-fade'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);o[f.slice(2)]=args.shift();}
assert(o['candidate-dir']||['one','all'].includes(o.smoke),'Use --candidate-dir <same-runtime private candidate>, or --smoke one|all');
assert(o['caller-fade']===undefined||o['caller-fade']==='transparent-web-v1','Unknown authored caller fade');
const callerFade=o['caller-fade']??null;
const family=o.family??'messages';assert(['messages','effects','system-messages','branch-execution','all'].includes(family));
const compiled=resolve(root,o.compiled),out=resolve(root,o.report),sha=b=>createHash('sha256').update(b).digest('hex');assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(dirname(out),{recursive:true});
const {readSourceBattleDirectoryPolicy:readObserverPolicy}=await import('./source-battle-directory.mjs');
const observerDeclaration=await readObserverPolicy({root,compiledDir:resolve(root,o.compiled),policy:JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')))});
const load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')).href),api=Object.assign({},...await Promise.all([
 'compiler/content','compiler/framework-new-game','compiler/content-dependencies','core/game-session','core/game-flow','core/saved-game','core/source-message-sequence',
 'core/verified-content','core/field-source-snapshot','core/field-fade','core/field-condition-activity','core/field-camera-shake','core/field-logical-effects','core/content-integrity'].map(load))),runtime=await runtimeDigest(root,compiled),input=await loadBattleEventMessageSourceInputs(root,compiled,{branchExecution:observerDeclaration.framework.branchExecution,sourceFormatImport:true,...(observerDeclaration.framework.gauInstances?{gauInstancePolicy:observerDeclaration.framework.gauInstances}:{})});
let gauMedia=null;
const ready={visible:true,mediaReady:true,overlayOpen:false},
 ports=()=>({...sourceWebReplayRuntimePorts(),...(gauMedia?{battleGauInstances:gauMedia.host}:{}),battleHandoff:'prepared',sourceMessageSequence:api.createWebFieldMessageSequencePort(),
 sourceEncounterPolicy:'web-source-encounter-uniform-slots-v1',scriptRandom:'web-source-script-random-field-stream-v1',assignedNpcRoutes:'web-assigned-npc-route-grid-v1',
 retainedWorldTransportation:'web-retained-walking-magitek-world-entry-v1',cameraShake:api.createWebFieldCameraShakePolicy(),fieldEffects:sourceWebReplayFieldEffectsHost(api.createWebLogicalFieldEffectsHost),
 conditionLeaderActivity:api.createWebFlatConditionLeaderActivityPort(),audioReadiness:{isReady:()=>true},soundPresentation:{isPresented:()=>true},transportationTimestamp:()=>'639273600000000000'});
let candidate=null,systems=null,sourceBattle=null,sourceEntry=null,strict=null,framework=null,fullGraph=null,fixture=null,recipeBinding=null,familyCatalog=null,familyDirectory=null;
if(o['candidate-dir']){
 candidate=await openSourceCandidate({root,runtimeRoot:root,compiledDir:compiled,candidateDir:resolve(root,o['candidate-dir'])});
 sourceBattle=await candidate.read('/game/source-catalog.json');sourceEntry=await candidate.read('/game/source-new-game.json');strict=await candidate.read('/world/catalog.json');framework=await candidate.read('/framework/world/catalog.json');
 const recipeBytes=await readFile(resolve(root,'content-batches/systems-initialized.recipe.json')),recipe=JSON.parse(recipeBytes),fresh=new Map([
 [recipe.sourceEntry.url,sourceEntry],[recipe.sourceBattle.url,sourceBattle],[recipe.sourceWorld.url,strict],[recipe.sourceMap.url,await candidate.read(recipe.sourceMap.url)]]);
 for(const key of ['sourceEntry','sourceBattle','sourceWorld','sourceMap'])recipe[key].contentHash=fresh.get(recipe[key].url).contentHash;
 // This controlled caller already derives its compiled references from the
 // sealed candidate. Its raw battle generation must come from that same
 // locked input, rather than the historical public recipe's media snapshot.
 // Keep the tracked recipe unchanged and record the derivation explicitly.
 const battleSnapshot=await input.api.readSnapshot(resolve(root,'build/battle')),
  battleExport=JSON.parse(input.api.snapshotFile(battleSnapshot,'battle.json').toString());
 assert.equal(api.hash(battleExport.sources),battleExport.sourceSetHash,'Controlled caller battle export identity differs');
 assert.equal(battleExport.parentSourceSetHash,sourceEntry.parentSourceSetHash,'Controlled caller battle parent differs from source entry');
 assert.equal(battleExport.parentSourceSetHash,input.snapshot.manifest.parentSourceSetHash,'Controlled caller battle parent differs from source inputs');
 const battleSourceRebinding={kind:'same-candidate-controlled-caller-battle-input-v1',
  historicalRecipeSourceSetHash:recipe.battleSourceSetHash,sourceSetHash:battleExport.sourceSetHash,
  parentSourceSetHash:battleExport.parentSourceSetHash,exportContentHash:api.hash(battleExport)};
 recipe.battleSourceSetHash=battleExport.sourceSetHash;

 const {compileInitializedSystems}=await import('./build-initialized-systems.mjs');systems=await compileInitializedSystems(root,recipe,api.hash(recipe),{dist:compiled,readJson:async url=>{assert(fresh.has(url),'Unexpected mutable collection read '+url);return fresh.get(url);}});
 assert.equal(api.canonical(systems.battle.gameState),api.canonical(sourceBattle.gameState),'Message capability cannot change the source initializer/owned state');
 recipeBinding={originalRecipeSha256:sha(recipeBytes),detachedPins:recipe,battleSourceRebinding,sourceStateUnchanged:true};
 // The shared map prerequisite catalog deliberately selects a small baseline.
 // Its absence is not source party admission: compile the entire family from
 // the locked raw inputs through the same pure runtime/directory producer.
 const [{compileSharedBattleSource},{compileGameCatalogModules},{compileBattleEncounterRuntime},{compileSourceBattleParticipantClosure}]=await Promise.all([
  'compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure'].map(load));
 const {readSourceBattleDirectoryPolicy,composeFrameworkBattleDirectory}=await import('./source-battle-directory.mjs'),
  policyFile=resolve(root,'content-batches/source-battle-directory.policy.json'),policyBytes=await readFile(policyFile),
  declaration=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(policyBytes)}),
  source=await compileSharedBattleSource(root),shared=await compileGameCatalogModules(root,source),
  gauSource=declaration.framework.gauInstances?await compileSharedBattleSource(root,{gauInstances:declaration.framework.gauInstances}):null;
 assert.equal(source.parentSourceSetHash,input.snapshot.manifest.parentSourceSetHash);
 assert.equal(api.canonical(shared.runtimeInput.eventMessages),api.canonical(input.input),'Directory and observer must share exact bound message decoder input');
 const originalProgramBindings=input.dependencies.encounters.map(descriptor=>{
  const p=input.programs.find(p=>p.source.assetPath===descriptor.script?.source.assetPath);
  assert(p&&descriptor.script,'Original source party has no exact namespace/body binding');
  assert.equal(api.canonical(descriptor.script.data),api.canonical(p.data),'Original source descriptor/body differs');
  assert.equal(api.canonical(input.api.compileBattleEvent(descriptor.script.data,descriptor.script.source,input.input,input.snapshot.reader,declaration.framework.branchExecution,input.sourceFormatImport?.(descriptor.script),declaration.framework.gauInstances)),api.canonical(p.compiled),'Observer source program differs from production descriptor compilation');
  return {partyId:descriptor.partyId,program:p.id,rawHash:p.rawHash,source:descriptor.script.source};
 });
 const participantClosure=declaration.framework.sourceParticipants?compileSourceBattleParticipantClosure(input.snapshot.reader,{
  policy:declaration.framework.sourceParticipants,encounters:input.dependencies.encounters,sources:input.encounterSources,
  eventMessages:shared.runtimeInput.eventMessages,branchExecution:declaration.framework.branchExecution,...(input.sourceFormatImport?{sourceFormatImport:input.sourceFormatImport}:{}),...(declaration.framework.gauInstances?{gauInstancePolicy:declaration.framework.gauInstances}:{})}):null;
 const requestedPartyIds=input.dependencies.requestedPartyIds,
  runtime=compileBattleEncounterRuntime(shared.reader,{...shared.runtimeInput,...(input.sourceFormatImport?{sourceFormatImport:input.sourceFormatImport}:{}),requestedPartyIds,encounters:input.dependencies.encounters,sourceDiagnostics:input.dependencies.diagnostics,
   ...(gauSource?{gauInstancePolicy:declaration.framework.gauInstances,gauInstanceContent:gauSource.gauInstances.catalog}:{}),
   ...(declaration.framework.childPartyAdmission?{childPartyAdmission:declaration.framework.childPartyAdmission}:{}),
   ...(declaration.framework.forcedSavePolicy===undefined?{}:{forcedSavePolicy:declaration.framework.forcedSavePolicy}),
   ...(declaration.framework.spawnConditionPolicy===undefined?{}:{spawnConditionPolicy:declaration.framework.spawnConditionPolicy}),
   ...(participantClosure?{reserveEnemies:participantClosure.reserveEnemies,enemyParties:participantClosure.enemyParties,
    sourceDiagnostics:[...input.dependencies.diagnostics,...participantClosure.diagnostics]}:{}),
   ...(declaration.framework.branchExecution===undefined?{}:{branchExecution:declaration.framework.branchExecution}),
   ...(declaration.framework.manualControls===undefined?{}:{manualControls:declaration.framework.manualControls}),
   ...(declaration.framework.conditionControlPolicy?{conditionControlPolicy:declaration.framework.conditionControlPolicy}:{}),
   handoff:{policy:declaration.framework.handoff},development:{...(declaration.framework.entry?.formations?{formations:declaration.framework.entry.formations}:{}),scripts:[],flagGroups:[],
    ...(participantClosure?{participants:participantClosure.participants}:{})}}),
  composed=await composeFrameworkBattleDirectory({root,compiledDir:compiled,baseCatalog:sourceBattle,runtime,conditionControlPolicy:declaration.framework.conditionControlPolicy});
 familyCatalog=composed.catalog;
 if(declaration.framework.gauInstances)gauMedia=await createSourceReplayGauMedia({root,compiledDir:compiled,battleCatalog:familyCatalog,policy:declaration.framework.gauInstances,acknowledgement:SOURCE_REPLAY_PNG_ACK});
 assert.equal(api.canonical(familyCatalog.gameState),api.canonical(sourceBattle.gameState),'Complete party directory cannot change initial owners');
 assert.equal(familyCatalog.common.sourceContentHash,sourceBattle.common.sourceContentHash,'Complete party directory cannot change shared source content identity');
 familyDirectory={kind:'same-input-complete-battle-message-family-directory-v1',requestedPartyIds,baselineCatalogHash:sourceBattle.contentHash,catalogHash:familyCatalog.contentHash,
  policy:{file:policyFile,sha256:sha(policyBytes),declaration,sourceScriptOmissions:[],sourceFlagOmissions:[]},report:composed.runtime.report,diagnostics:composed.runtime.diagnostics,
  sourceDiagnostics:input.dependencies.diagnostics,participantClosure,originalProgramBindings,sourceStateUnchanged:true,sharedSourceContentUnchanged:true,sourceInitializerUnchanged:true,
  commonChanges:{kind:'existing-pure-framework-directory-composition',drops:'Source-bound compiler/compose merge with owned-content rejection',conditionControlPolicy:declaration.framework.conditionControlPolicy??null}};
 const maps=[];for(const ref of Object.values(strict.maps))maps.push(await candidate.read(ref.url));
 const roots=maps.flatMap(m=>[...Object.keys(m.scripts).map(script=>({kind:'script',mapId:m.mapId,script})),...(m.partyEntry?.pointIns??[]).map(p=>({kind:'entry',mapId:m.mapId,entrance:p.id,continuation:null}))]);
 fullGraph=api.analyzeContentDependencies({catalog:strict,maps,roots,mapIds:maps.map(m=>m.mapId)});
}else fixture=await import(pathToFileURL(resolve(compiled,'tests/fixtures/battle-event-message.js')).href);
const callerDefinitions=candidate?createVerifiedBattleObserverCallers(api,{systems,familyCatalog,familyDirectory,sourceEntry,sourceBattle,
 sourceMap:await candidate.read(strict.maps[sourceEntry.entry.mapId].url),branchExecution:observerDeclaration.framework.branchExecution}):null;
const journalProjection=game=>({field:game.field.stop,window:game.field.sourceMessage.projection,revision:game.field.sourceMessage.mutationRevision,
 mask:game.field.updateAttributeMask,effectRequests:game.battle?.effectExecution??[],effects:game.battle?.effectPresentation??[],branchExecution:game.battle?.eventBranchExecution??null,event:game.battle?.eventExecution??null,messages:game.battle?.messageExecution??[],battleTime:game.battle?.time??null,phase:game.battle?.phase??null});
async function create(program,partyOverride){
 if(fixture){const f=fixture.battleMessageSessionFixture(program);if(callerFade)f.field.entry.fade=structuredClone(api.DEVELOPMENT_TRANSPARENT_FADE);if(program.kind==='battle-event-v2')f.battle.encounters[1000].lifecycle={kind:'battle-lifecycle-v2',mode:'script',scriptId:9000,program,branchExecution:observerDeclaration.framework.branchExecution};const game=new api.GameSession(f.field,f.battle,314,{...f.runtime,...sourceWebReplayRuntimePorts()});return {game,field:f.field,battle:f.battle,restore:saved=>api.GameSession.restore(saved,f.field,f.battle,undefined,{...f.runtime,...sourceWebReplayRuntimePorts()})};}
 const {map:sealedMap,world:sealedWorld,battle:sealedBattle,content,verified,script}=await callerDefinitions.prepare(program,partyOverride),
  game=await api.GameSession.prepareFrameworkNewGameFromVerified(verified.content,verified.world,verified.map,verified.battle,ports(),20261010,
    callerFade?new api.FieldFadeState(api.DEVELOPMENT_TRANSPARENT_FADE):undefined);
 return {game,field:null,battle:sealedBattle,restore:saved=>api.GameSession.restore(saved,undefined,sealedBattle,{catalog:sealedWorld,map:sealedMap,initialized:{content,initialMap:sealedMap}},ports()),script};
}
const authored=(kind,rest={})=>({mnemonic:'authored:'+kind,op:{kind,...rest}}),close=()=>({kind:'message',command:{kind:'close'},presentation:null});
function envelope(site){
 const p=input.programs.find(p=>p.id===site.program),actual=structuredClone(site.typed),seed={kind:'message',command:{kind:'sequence',key:'authored-close-witness',speaker:'Controlled host',layout:{window:'frame',anchor:'bottom'},seconds:-1,bypassSpeed:true,after:'message',document:{kind:'source-message-sequence-v1',alignment:'left',tokens:[{kind:'text',text:'Controlled open window'}]}},presentation:{sourceWindow:1,speakerAnchor:'left'}},
  instructions=site.raw.mnemonic==='MsgClose'?[{mnemonic:'authored:Msg',op:seed},authored('wait',{seconds:.15}),{mnemonic:site.raw.mnemonic,op:actual},authored('wait',{seconds:1000})]:[
   {mnemonic:site.raw.mnemonic,op:actual},authored('wait',{seconds:.15}),{mnemonic:'authored:MsgClose',op:close()},authored('wait',{seconds:1000})];
 return {program:{kind:'battle-event-v1',source:p.compiled.source,entry:0,end:instructions.length,localNames:[],initialLocals:[],instructions,blockers:[],messageBinding:input.input.binding},actualPc:site.raw.mnemonic==='MsgClose'?2:0,endPc:3};
}
async function run(program,{site=null,actualPc=null,endPc=null,partyOverride=null,lane}){
 const row={lane,parameterOnly:!!site,actualSourceSite:site?{program:site.program,index:site.index,source:site.source,rawHash:site.rawHash}:null,inputs:[],ticks:0,result:'not-started',stateBefore:null,stateAfter:null,sourceStoryReachability:false};let bound,game,flow;
 try{
  row.vmPreflightAttempted=true;input.api.createBattleEventState(program,observerDeclaration.framework.branchExecution);row.vmPreflightAccepted=true;
  bound=await create(program,partyOverride);game=bound.game;flow=new api.GameFlow(game);flow.start();flow.observeHost(ready);
  for(let n=0;n<12000&&!game.checkpointReady&&!game.field.stop;n++){flow.advance(10,ready);row.ticks++;if(game.field.sourceMessage.projection?.acceptsInput){row.inputs.push({kind:'initializer-confirm',tick:row.ticks,key:game.field.sourceMessage.projection.key});flow.confirm();}}
  if(!game.checkpointReady){row.result='initializer-boundary';row.stateAfter=journalProjection(game);return row;}
  row.stateBefore=game.state.snapshot();assert(game.field.startEvent(bound.script??'fight'),'Authored battle observer caller rejected');game.advance(10);assert(game.battleStartRequest,'Missing pending battle request');
  row.sessionBattlePreparationAttempted=true;
  const start=game.prepareBattleStart();assert(start,'Battle start candidate unavailable');assert(start.commit(),'Battle start did not publish');const battle=game.battle;
  battleTicks: for(let n=0;n<12000;n++){
   const projection=battle.sourceMessage?.projection;
   if(projection?.acceptsInput){row.inputs.push({kind:'confirm',tick:row.ticks,key:projection.key,page:projection.page,ticket:projection.windowTicket,text:projection.text});assert(flow.confirm(),'Actual battle message input rejected');}
   if(!site&&!battle.messageInputPending&&!battle.globalFadeRaycast)for(const actor of battle.ready){
    const choice=chooseBattleObserverInput(battle,actor.id);
    if(choice.kind==='unavailable'){row.result='battle-input-boundary';row.inputBoundary=choice;break battleTicks;}
    const accepted=battle.command(choice.actorId,choice.abilityId,choice.selection,choice.commandId);
    row.inputs.push({...choice,kind:'battle-command',accepted,tick:row.ticks});assert(accepted,'Current qualified menu input was rejected');
   }
   flow.advance(10,ready);row.ticks++;
   if(site&&battle.eventExecution.state?.pc===endPc){
    const action=site.raw.mnemonic==='MsgClose'?'close':'open';assert(battle.messageExecution.some(e=>e.pc===actualPc&&e.action===action),'Actual source operation was not executed');
    assert.equal(game.field.sourceMessage.active,false);row.result='parameter-protocol-completed';row.actualSourceInstructionExecuted=true;break;
   }
   if(!site&&battle.phase!=='active'){
    row.terminal=battle.phase;if(!['victory','escaped','forced'].includes(battle.phase)){row.result='terminal-boundary';break;}
    row.battleAtReturn=journalProjection(game);const ret=game.prepareBattleReturn();assert(ret&&ret.commit(),'Battle result return unavailable');game.advance(10);
    if(!game.checkpointReady){row.result='field-continuation-boundary';break;}
    const slots=new Map(),storage=new api.CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>slots.set(k,v)});await storage.save(game.checkpoint(),0);
    const saved=await storage.load(),restored=bound.restore(saved.checkpoint);assert.equal(api.canonical(restored.state.snapshot()),api.canonical(game.state.snapshot()));row.checkpointHash=api.hash(saved.checkpoint);row.result='whole-program-finished-and-restored';break;
   }
  }
  if(row.result==='not-started')row.result='clock-budget';row.stateAfter=journalProjection(game);row.ownedAfter=game.state.snapshot();
 }catch(error){row.result='blocked';row.error=observerErrorDetails(error);if(game){row.stateAfter=journalProjection(game);row.ownedAfter=game.state.snapshot();}}
 return row;
}
const effectSites=input.programs.flatMap(p=>p.data.Mnemonics.flatMap((raw,index)=>['PlayBattleEffect','SyncBattleEffect'].includes(raw.mnemonic)?[{program:p.id,index,source:p.source,raw,typed:p.compiled.instructions[index].op}]:[]));
const systemSites=input.sites.filter(site=>site.raw.mnemonic==='Msg'&&Object.hasOwn(input.input.messages.system_zhc??{},site.raw.operands.sValues[0])),systemPrograms=new Set(systemSites.map(site=>site.program));
// All three observers use the identical initialization, source bodies, source
// party directory, input policy and real Session lifecycle. The joint mode
// executes that shared experiment once; family views below are projections of
// the same evidence, never independent repeats or cached old-runtime reports.
const progress={kind:'source-battle-common-execution-progress-v1',family,runtimeSha256:runtime,sourceDigest:input.sourceDigest,
 candidateReportSha256:candidate?sha(candidate.reportBytes):null,status:'running',completed:{parameters:0,programs:0,originalParties:0},active:null,sourceCampaignComplete:false};
const persistProgress=async()=>writeFile(resolve(dirname(out),'execution-progress.json'),JSON.stringify(progress)+'\n');
const trackedRun=async(program,options)=>{
 progress.active={lane:options.lane,partyId:options.partyOverride??null,source:program.source,programHash:api.hash(program)};await persistProgress();
 const result=await run(program,options);progress.active=null;return result;
};
const selected=family==='branch-execution'?[]:family==='system-messages'?systemSites:family==='effects'?[]:o.smoke==='one'?[input.sites.find(s=>s.typed.kind==='message'&&s.typed.command.kind==='sequence'&&!s.typed.command.template)]:input.sites,parameters=[];
for(const site of selected){if(site.typed.kind!=='message')parameters.push({site,result:'source-operand-blocked',reason:site.typed.reason});else{const e=envelope(site);parameters.push({site,run:await trackedRun(e.program,{site,actualPc:e.actualPc,endPc:e.endPc,lane:o.smoke?'authored-fixture-smoke':'actual-source-operand-controlled-host'})});}progress.completed.parameters=parameters.length;await persistProgress();}
const programs=[],originalParties=[];
if(!o.smoke){for(const p of input.programs){programs.push({id:p.id,source:p.source,rawHash:p.rawHash,affected:['branch-execution','all'].includes(family)?true:family==='system-messages'?systemPrograms.has(p.id):family==='effects'?p.data.Mnemonics.some(i=>["PlayBattleEffect","SyncBattleEffect"].includes(i.mnemonic)):p.messageSites.length>0,battleExportBinding:p.battleExportBinding,
 run:p.battleExportBinding.kind==='unbound-battle-export-source-v1'?{lane:'whole-original-battle-program-controlled-caller',result:'source-program-binding-blocked',reason:p.battleExportBinding.reason,vmPreflightAttempted:false,sessionBattlePreparationAttempted:false,sourceStoryReachability:false}:await trackedRun(p.compiled,{lane:'whole-original-battle-program-controlled-caller'})});progress.completed.programs=programs.length;await persistProgress();}
 for(const partyId of input.dependencies.requestedPartyIds){
  const descriptor=input.dependencies.encounters.find(row=>row.partyId===partyId),diagnostics=input.dependencies.diagnostics.filter(row=>row.partyId===partyId);
  if(!descriptor){assert(diagnostics.length,'Requested party has neither descriptor nor diagnostic');originalParties.push({partyId,program:null,sourceDiagnostics:diagnostics,
   run:{lane:'original-source-party-availability-and-lifecycle',result:'source-descriptor-blocked',vmPreflightAttempted:false,sessionBattlePreparationAttempted:false,sourceStoryReachability:false}});progress.completed.originalParties=originalParties.length;await persistProgress();continue;}
  const p=input.programs.find(p=>p.source.assetPath===descriptor.script?.source.assetPath);
  if(!p){originalParties.push({partyId,program:null,source:descriptor.source,dependencies:descriptor,sourceDiagnostics:diagnostics,
   run:{lane:'original-source-party-availability-and-lifecycle',result:'source-program-binding-blocked',reason:'Complete original source body/namespace binding is unavailable',vmPreflightAttempted:false,sessionBattlePreparationAttempted:false,sourceStoryReachability:false}});progress.completed.originalParties=originalParties.length;await persistProgress();continue;}
  originalParties.push({partyId,program:p.id,source:descriptor.source,dependencies:descriptor,sourceDiagnostics:diagnostics,
   run:await trackedRun(p.compiled,{partyOverride:partyId,lane:'original-source-party-availability-and-lifecycle'})});progress.completed.originalParties=originalParties.length;await persistProgress();}}
assert.equal(await runtimeDigest(root,compiled),runtime,'Runtime changed during family execution');if(candidate){await candidate.validate();assert.equal(sha(await readFile(familyDirectory.policy.file)),familyDirectory.policy.sha256,'Explicit family battle policy changed');}if(gauMedia)await gauMedia.validate();
const now=await input.api.loadCorpus(root);assert.equal(api.hash({assets:now.assets,tables:now.tables,messages:now.messages,manifest:now.manifest}),input.sourceDigest,'Source snapshots changed');
const artifacts={};async function artifact(file,value){const bytes=JSON.stringify(value)+'\n',path=resolve(dirname(out),file);await writeFile(path,bytes);return {file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};}
artifacts.inventory=await artifact('source-inventory.json',input.inventory);if(['effects','all'].includes(family))artifacts.effectSites=await artifact('all-battle-effect-sites.json',effectSites);if(fullGraph)artifacts.completeWorldDependencies=await artifact('all-world-dependencies.json',fullGraph);
const blockerGroups=new Map();for(const row of [...parameters.filter(p=>p.result==='source-operand-blocked'||p.run?.result==='blocked').map(p=>({kind:'parameter',reason:p.reason??p.run.error.message,source:p.site.source,index:p.site.index,program:p.site.program})),
 ...programs.filter(p=>['blocked','source-program-binding-blocked'].includes(p.run.result)).map(p=>({kind:'whole-program',reason:p.run.error?.message??p.run.reason,source:p.source,program:p.id}))]){
 const key=row.reason;const group=blockerGroups.get(key)??{reason:key,sites:[]};group.sites.push(row);blockerGroups.set(key,group);
}
const familyDefinitions={messages:p=>p.messageSites.length>0,effects:p=>p.data.Mnemonics.some(i=>['PlayBattleEffect','SyncBattleEffect'].includes(i.mnemonic)),
 'system-messages':p=>systemPrograms.has(p.id),'branch-execution':()=>true};
const familyViews=family==='all'?Object.fromEntries(Object.entries(familyDefinitions).map(([name,select])=>{
 const selected=new Set(input.programs.filter(select).map(p=>p.id)),indexes=programs.flatMap((p,i)=>selected.has(p.id)?[i]:[]),
  actualParameters=name==='messages'?parameters:name==='system-messages'?parameters.filter(p=>systemSites.some(s=>s.program===p.site.program&&s.index===p.site.index)):[];
 return [name,{kind:'same-execution-family-view-v1',physicalPrograms:selected.size,completeRawInstructions:input.programs.filter(p=>selected.has(p.id)).reduce((n,p)=>n+p.data.Mnemonics.length,0),
  sourceSites:name==='messages'?input.sites.length:name==='system-messages'?systemSites.length:name==='effects'?effectSites.length:input.programs.reduce((n,p)=>n+(p.compiled.branchExecution?.deferred.length??0),0),
  programResultIndexes:indexes,affectedProgramAttempts:indexes.length,affectedProgramFinished:indexes.filter(i=>programs[i].run.result==='whole-program-finished-and-restored').length,
  parameterAttempts:actualParameters.length,parameterCompleted:actualParameters.filter(p=>p.run?.result==='parameter-protocol-completed').length,
  sourceStoryReachability:false,independentEvidence:false}];})):undefined;
if(family==='all'&&!o.smoke){assert.equal(programs.length,input.programs.length);assert.equal(originalParties.length,input.dependencies.requestedPartyIds.length);assert.equal(parameters.length,input.sites.length);}
const report={kind:family==='all'?'source-battle-common-family-execution-v1':family==='branch-execution'?'source-battle-branch-execution-v1':family==='system-messages'?'source-battle-system-message-execution-v1':family==='effects'?'source-battle-event-effect-execution-v1':'source-battle-event-message-execution-v1',family,result:o.smoke?'smoke-attempts-recorded':'complete-attempts-recorded',runtimeSha256:runtime,sourceDigest:input.sourceDigest,callerDefinitionGroups:callerDefinitions?.stats()??null,
 ...(familyViews?{familyViews,sharedExecution:{kind:'one-source-battle-lifecycle-experiment-v1',repeats:1,independentEvidence:false,wholeSourceScopeUnchanged:true}}:{}),
 candidate:candidate?{reportSha256:sha(candidate.reportBytes),runtimeSha256:candidate.runtimeSha256,objects:candidate.report.objects.length,link:candidate.report.link,inputLock:candidate.report.inputLock}:null,recipeBinding,familyDirectory,artifacts,
 counts:{...input.inventory.counts,...(['effects','all'].includes(family)?{effectSites:effectSites.length,decodedEffectSites:effectSites.filter(s=>['play-battle-effect','sync-battle-effect'].includes(s.typed.kind)).length,actualEffectRequests:programs.reduce((n,p)=>n+observedBattleEffects(p.run).filter(e=>e.action==='request').length,0),actualEffectCompletions:programs.reduce((n,p)=>n+observedBattleEffects(p.run).filter(e=>e.action==='complete').length,0)}:{}),parameterAttempts:parameters.length,parameterCompleted:parameters.filter(r=>r.run?.result==='parameter-protocol-completed').length,
  parameterBlocked:parameters.filter(r=>r.result==='source-operand-blocked'||r.run?.result==='blocked').length,wholeProgramAttempts:programs.length,wholeProgramVMPreflightAccepted:programs.filter(r=>r.run.vmPreflightAccepted).length,wholeProgramSessionBattlePreparationAttempts:programs.filter(r=>r.run.sessionBattlePreparationAttempted).length,wholeProgramFinished:programs.filter(r=>r.run.result==='whole-program-finished-and-restored').length,
  affectedProgramAttempts:programs.filter(r=>r.affected).length,affectedProgramFinished:programs.filter(r=>r.affected&&r.run.result==='whole-program-finished-and-restored').length,originalPartyAttempts:originalParties.length,originalPartyDirectoryRequests:familyDirectory?.requestedPartyIds.length??0,originalPartyDescriptorDiagnostics:input.dependencies.diagnostics.length},
 parameters,programs,originalParties,blockerGroups:[...blockerGroups.values()],sourceCampaignComplete:false,nativeParity:false,browserVerified:false,
 familyCounts:family==='branch-execution'?{programs:input.programs.length,rawInstructions:input.inventory.counts.instructions,deferredSites:input.programs.reduce((n,p)=>n+(p.compiled.branchExecution?.deferred.length??0),0)}:family==='system-messages'?{systemMessageSites:systemSites.length,physicalPrograms:systemPrograms.size,completeRawInstructions:input.programs.filter(p=>systemPrograms.has(p.id)).reduce((n,p)=>n+p.data.Mnemonics.length,0)}:family==='effects'?{playSites:effectSites.filter(s=>s.raw.mnemonic==='PlayBattleEffect').length,syncSites:effectSites.filter(s=>s.raw.mnemonic==='SyncBattleEffect').length,physicalPrograms:input.programs.filter(p=>p.data.Mnemonics.some(i=>['PlayBattleEffect','SyncBattleEffect'].includes(i.mnemonic))).length,completeRawInstructions:input.programs.filter(p=>p.data.Mnemonics.some(i=>['PlayBattleEffect','SyncBattleEffect'].includes(i.mnemonic))).reduce((n,p)=>n+p.data.Mnemonics.length,0)}:null,
 controlledHost:{input:'Explicit recorded confirmation and current-menu qualified battle commands',battleInputPolicy:BATTLE_OBSERVER_INPUT_POLICY,battleUIInputPolicy:'current-app-message-and-raycast-v1',caller:'Authored ordinary Session/placement; original battle body and all unknowns intact',callerFade:{kind:callerFade??'unknown',origin:'Explicit authored caller presentation, not a source title-state assertion',sourceStateUnchanged:true},clock:'10ms fixed Web manager-before-VM; no message-implied pause',policy:sourceWebReplayRuntimePorts(),gauMedia:gauMedia?.evidence??null,messageOwner:'Actual Field.sourceMessage; no second window owner',smoke:!!o.smoke}};
await writeFile(resolve(dirname(out),'attempts-draft.json'),observationDraftJSON(report));
try{report.contentHash=api.hash(report);}catch(error){progress.status='failed-report-validation';progress.error=observerErrorDetails(error);await persistProgress();throw error;}
await writeFile(out,JSON.stringify(report)+'\n');progress.status=report.result;progress.reportContentHash=report.contentHash;await persistProgress();console.log(JSON.stringify({result:report.result,counts:report.counts,hash:report.contentHash,report:out}));
