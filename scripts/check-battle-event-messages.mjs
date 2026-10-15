// Whole source programs and actual source operands are separate experiments.
// Every execution uses GameSession/BattleGame/the actual Field message owner.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {openSourceCandidate} from './source-candidate.mjs';
import {sourceWebReplayRuntimePorts} from './source-web-replay-runtime.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),o={compiled:'dist',report:'build/reports/battle-event-messages/check.json'},seen=new Set();
while(args.length){const f=args.shift();assert(['--compiled','--report','--candidate-dir','--smoke','--family'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);o[f.slice(2)]=args.shift();}
assert(o['candidate-dir']||['one','all'].includes(o.smoke),'Use --candidate-dir <same-runtime private candidate>, or --smoke one|all');
const family=o.family??'messages';assert(['messages','effects','system-messages'].includes(family));
const compiled=resolve(root,o.compiled),out=resolve(root,o.report),sha=b=>createHash('sha256').update(b).digest('hex');assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(dirname(out),{recursive:true});
const load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')).href),api=Object.assign({},...await Promise.all([
 'compiler/content','compiler/framework-new-game','compiler/content-dependencies','core/game-session','core/game-flow','core/saved-game','core/source-message-sequence',
 'core/field-condition-activity','core/field-camera-shake','core/field-logical-effects','core/content-integrity'].map(load))),runtime=await runtimeDigest(root,compiled),input=await loadBattleEventMessageSourceInputs(root,compiled);
const seal=v=>{const{contentHash,...body}=v;return {...body,contentHash:api.hash(body)};},ready={visible:true,mediaReady:true,overlayOpen:false},
 ports=()=>({...sourceWebReplayRuntimePorts(),battleHandoff:'prepared',sourceMessageSequence:api.createWebFieldMessageSequencePort(),
 sourceEncounterPolicy:'web-source-encounter-uniform-slots-v1',scriptRandom:'web-source-script-random-field-stream-v1',assignedNpcRoutes:'web-assigned-npc-route-grid-v1',
 retainedWorldTransportation:'web-retained-walking-magitek-world-entry-v1',cameraShake:api.createWebFieldCameraShakePolicy(),fieldEffects:api.createWebLogicalFieldEffectsHost(),
 conditionLeaderActivity:api.createWebFlatConditionLeaderActivityPort(),audioReadiness:{isReady:()=>true},soundPresentation:{isPresented:()=>true},transportationTimestamp:()=>'639273600000000000'});
let candidate=null,systems=null,sourceBattle=null,sourceEntry=null,strict=null,framework=null,fullGraph=null,fixture=null,recipeBinding=null,familyCatalog=null,familyDirectory=null;
if(o['candidate-dir']){
 candidate=await openSourceCandidate({root,runtimeRoot:root,compiledDir:compiled,candidateDir:resolve(root,o['candidate-dir'])});
 sourceBattle=await candidate.read('/game/source-catalog.json');sourceEntry=await candidate.read('/game/source-new-game.json');strict=await candidate.read('/world/catalog.json');framework=await candidate.read('/framework/world/catalog.json');
 const recipeBytes=await readFile(resolve(root,'content-batches/systems-initialized.recipe.json')),recipe=JSON.parse(recipeBytes),fresh=new Map([
 [recipe.sourceEntry.url,sourceEntry],[recipe.sourceBattle.url,sourceBattle],[recipe.sourceWorld.url,strict],[recipe.sourceMap.url,await candidate.read(recipe.sourceMap.url)]]);
 for(const key of ['sourceEntry','sourceBattle','sourceWorld','sourceMap'])recipe[key].contentHash=fresh.get(recipe[key].url).contentHash;
 const {compileInitializedSystems}=await import('./build-initialized-systems.mjs');systems=await compileInitializedSystems(root,recipe,api.hash(recipe),{dist:compiled,readJson:async url=>{assert(fresh.has(url),'Unexpected mutable collection read '+url);return fresh.get(url);}});
 assert.equal(api.canonical(systems.battle.gameState),api.canonical(sourceBattle.gameState),'Message capability cannot change the source initializer/owned state');
 recipeBinding={originalRecipeSha256:sha(recipeBytes),detachedPins:recipe,sourceStateUnchanged:true};
 // The shared map prerequisite catalog deliberately selects a small baseline.
 // Its absence is not source party admission: compile the entire family from
 // the locked raw inputs through the same pure runtime/directory producer.
 const [{compileSharedBattleSource},{compileGameCatalogModules},{compileBattleEncounterRuntime}]=await Promise.all([
  'compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime'].map(load));
 const {readSourceBattleDirectoryPolicy,composeFrameworkBattleDirectory}=await import('./source-battle-directory.mjs'),
  policyFile=resolve(root,'content-batches/source-battle-directory.policy.json'),policyBytes=await readFile(policyFile),
  declaration=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(policyBytes)}),
  source=await compileSharedBattleSource(root),shared=await compileGameCatalogModules(root,source);
 assert.equal(source.parentSourceSetHash,input.snapshot.manifest.parentSourceSetHash);
 assert.equal(api.canonical(shared.runtimeInput.eventMessages),api.canonical(input.input),'Directory and observer must share exact bound message decoder input');
 const originalProgramBindings=input.dependencies.encounters.map(descriptor=>{
  const p=input.programs.find(p=>p.source.assetPath===descriptor.script?.source.assetPath);
  assert(p&&descriptor.script,'Original source party has no exact namespace/body binding');
  assert.equal(api.canonical(descriptor.script.data),api.canonical(p.data),'Original source descriptor/body differs');
  assert.equal(api.canonical(input.api.compileBattleEvent(descriptor.script.data,descriptor.script.source,input.input,input.snapshot.reader)),api.canonical(p.compiled),'Observer source program differs from production descriptor compilation');
  return {partyId:descriptor.partyId,program:p.id,rawHash:p.rawHash,source:descriptor.script.source};
 });
 const requestedPartyIds=input.dependencies.requestedPartyIds,
  runtime=compileBattleEncounterRuntime(shared.reader,{...shared.runtimeInput,requestedPartyIds,encounters:input.dependencies.encounters,sourceDiagnostics:input.dependencies.diagnostics,
   ...(declaration.framework.manualControls===undefined?{}:{manualControls:declaration.framework.manualControls}),
   ...(declaration.framework.conditionControlPolicy?{conditionControlPolicy:declaration.framework.conditionControlPolicy}:{}),
   handoff:{policy:declaration.framework.handoff},development:{...(declaration.framework.entry?.formations?{formations:declaration.framework.entry.formations}:{}),scripts:[],flagGroups:[]}}),
  composed=await composeFrameworkBattleDirectory({root,compiledDir:compiled,baseCatalog:sourceBattle,runtime,conditionControlPolicy:declaration.framework.conditionControlPolicy});
 familyCatalog=composed.catalog;
 assert.equal(api.canonical(familyCatalog.gameState),api.canonical(sourceBattle.gameState),'Complete party directory cannot change initial owners');
 assert.equal(familyCatalog.common.sourceContentHash,sourceBattle.common.sourceContentHash,'Complete party directory cannot change shared source content identity');
 familyDirectory={kind:'same-input-complete-battle-message-family-directory-v1',requestedPartyIds,baselineCatalogHash:sourceBattle.contentHash,catalogHash:familyCatalog.contentHash,
  policy:{file:policyFile,sha256:sha(policyBytes),declaration,sourceScriptOmissions:[],sourceFlagOmissions:[]},report:composed.runtime.report,diagnostics:composed.runtime.diagnostics,
  sourceDiagnostics:input.dependencies.diagnostics,originalProgramBindings,sourceStateUnchanged:true,sharedSourceContentUnchanged:true,sourceInitializerUnchanged:true,
  commonChanges:{kind:'existing-pure-framework-directory-composition',drops:'Source-bound compiler/compose merge with owned-content rejection',conditionControlPolicy:declaration.framework.conditionControlPolicy??null}};
 const maps=[];for(const ref of Object.values(strict.maps))maps.push(await candidate.read(ref.url));
 const roots=maps.flatMap(m=>[...Object.keys(m.scripts).map(script=>({kind:'script',mapId:m.mapId,script})),...(m.partyEntry?.pointIns??[]).map(p=>({kind:'entry',mapId:m.mapId,entrance:p.id,continuation:null}))]);
 fullGraph=api.analyzeContentDependencies({catalog:strict,maps,roots,mapIds:maps.map(m=>m.mapId)});
}else fixture=await import(pathToFileURL(resolve(compiled,'tests/fixtures/battle-event-message.js')).href);
const journalProjection=game=>({field:game.field.stop,window:game.field.sourceMessage.projection,revision:game.field.sourceMessage.mutationRevision,
 mask:game.field.updateAttributeMask,effectRequests:game.battle?.effectExecution??[],effects:game.battle?.effectPresentation??[],event:game.battle?.eventExecution??null,messages:game.battle?.messageExecution??[],battleTime:game.battle?.time??null,phase:game.battle?.phase??null});
async function create(program,partyOverride){
 if(fixture){const f=fixture.battleMessageSessionFixture(program),game=new api.GameSession(f.field,f.battle,314,{...f.runtime,...sourceWebReplayRuntimePorts()});return {game,field:f.field,battle:f.battle,restore:saved=>api.GameSession.restore(saved,f.field,f.battle,undefined,{...f.runtime,...sourceWebReplayRuntimePorts()})};}
 const map=structuredClone(systems.map),world=structuredClone(systems.catalog),battle=structuredClone(partyOverride?familyCatalog:systems.battle),partyId=partyOverride??Number(Object.keys(battle.encounters)[0]);
 if(partyOverride){
  const encounter=battle.encounters[partyId],assessment=familyDirectory.report.entries.find(row=>row.partyId===partyId),diagnostics=familyDirectory.diagnostics.filter(row=>row.partyId===partyId);
  assert(encounter,'Original source party is blocked in the complete pure family directory: '+JSON.stringify({partyId,assessment,diagnostics}));
  assert.equal(encounter.lifecycle?.mode,'script','Original source lifecycle is absent; it cannot be replaced by the observer');
  assert.equal(api.canonical(encounter.lifecycle.program),api.canonical(program),'Original source lifecycle/program binding differs');
  // Only the existing initialized recipe's authored map qualification is added
  // to this controlled caller. No original row, common source identity or owner
  // is replaced. The exact original encounter lifecycle/scriptId stays intact.
  const rows=systems.battle.common.battleEntry.maps.filter(row=>row.id===map.mapId);assert.equal(rows.length,1);
  assert(!battle.common.battleEntry.maps.some(row=>row.id===map.mapId));battle.common.battleEntry.maps.push(structuredClone(rows[0]));
 }else{
  assert(battle.encounters[partyId],'Controlled recipe has no legal encounter');
  battle.encounters[partyId].lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:900000,program};
 }
 const script='__authored_battle_message_observer__',source={file:'authored-message-observer',assetPath:'controlled-whole-program-caller'};
 const continuation=script+'return';assert(!map.scripts[script]&&!map.scripts[continuation]);
 map.scripts[script]=[{kind:'encounter',party:partyId,continuation,script,index:0,source},{kind:'exit',script,index:1,source}];
 map.scripts[continuation]=[{kind:'exit',script:continuation,index:0,source}];
 // Caller and placement are explicitly authored. No original battle program,
 // source flags, roster, resources or source initializer is edited.
 (map.scriptSystemFlags??={})[script]={keepBadStatusVisual:false};map.scriptSystemFlags[continuation]={keepBadStatusVisual:false};
 // These two scripts are authored callers, so they require the same explicit
 // native task metadata as the initialized recipe's other authored programs.
 // The original BattleScript body, root flags and locals remain unchanged.
 const template=Object.entries(map.scriptPuppetContexts??{}).find(([,v])=>v&&v.characteristics===true);
 assert(template,'Controlled recipe lacks an authored native script context');
 for(const alias of [script,continuation]){
  map.scriptPuppetContexts[alias]={...structuredClone(template[1]),scriptHash:api.hash(map.scripts[alias])};
  map.scriptTransitionMetadata[alias]={customAnimations:'none'};
  map.scriptLocals[alias]={labels:[],values:[]};
 }
 const sealedMap=seal(map);world.maps[map.mapId].contentHash=sealedMap.contentHash;const sealedWorld=seal(world),sealedBattle=seal(battle),
  content=await api.compileFrameworkNewGame({sourceEntry,sourceBattle,sourceMap:await candidate.read(strict.maps[sourceEntry.entry.mapId].url),world:sealedWorld,map:sealedMap,battle:sealedBattle,entrance:sealedMap.partyEntry.pointIns[0].id}),
  game=await api.GameSession.prepareFrameworkNewGame(content,sealedWorld,sealedMap,sealedBattle,ports());
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
  row.vmPreflightAttempted=true;input.api.createBattleEventState(program);row.vmPreflightAccepted=true;
  bound=await create(program,partyOverride);game=bound.game;flow=new api.GameFlow(game);flow.start();flow.observeHost(ready);
  for(let n=0;n<12000&&!game.checkpointReady&&!game.field.stop;n++){flow.advance(10,ready);row.ticks++;if(game.field.sourceMessage.projection?.acceptsInput){row.inputs.push({kind:'initializer-confirm',tick:row.ticks,key:game.field.sourceMessage.projection.key});flow.confirm();}}
  if(!game.checkpointReady){row.result='initializer-boundary';row.stateAfter=journalProjection(game);return row;}
  row.stateBefore=game.state.snapshot();assert(game.field.startEvent(bound.script??'fight'),'Authored battle observer caller rejected');game.advance(10);assert(game.battleStartRequest,'Missing pending battle request');
  row.sessionBattlePreparationAttempted=true;
  const start=game.prepareBattleStart();assert(start,'Battle start candidate unavailable');assert(start.commit(),'Battle start did not publish');const battle=game.battle;
  for(let n=0;n<12000;n++){
   const projection=battle.sourceMessage?.projection;
   if(projection?.acceptsInput){row.inputs.push({kind:'confirm',tick:row.ticks,key:projection.key,page:projection.page,ticket:projection.windowTicket,text:projection.text});assert(flow.confirm(),'Actual battle message input rejected');}
   if(!site&&!battle.messageInputPending)for(const actor of battle.ready){const target=battle.targets(actor.id,10)[0];if(target){const accepted=battle.command(actor.id,10,target.id);row.inputs.push({kind:'battle-command',actor:actor.id,abilityId:10,target:target.id,accepted,tick:row.ticks});}}
   flow.advance(10,ready);row.ticks++;
   if(site&&battle.eventExecution.state?.pc===endPc){
    const action=site.raw.mnemonic==='MsgClose'?'close':'open';assert(battle.messageExecution.some(e=>e.pc===actualPc&&e.action===action),'Actual source operation was not executed');
    assert.equal(game.field.sourceMessage.active,false);row.result='parameter-protocol-completed';row.actualSourceInstructionExecuted=true;break;
   }
   if(!site&&battle.phase!=='active'){
    row.terminal=battle.phase;if(battle.phase!=='victory'&&battle.phase!=='escaped'){row.result='terminal-boundary';break;}
    const ret=game.prepareBattleReturn();assert(ret&&ret.commit(),'Battle result return unavailable');game.advance(10);
    if(!game.checkpointReady){row.result='field-continuation-boundary';break;}
    const slots=new Map(),storage=new api.CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>slots.set(k,v)});await storage.save(game.checkpoint(),0);
    const saved=await storage.load(),restored=bound.restore(saved.checkpoint);assert.equal(api.canonical(restored.state.snapshot()),api.canonical(game.state.snapshot()));row.checkpointHash=api.hash(saved.checkpoint);row.result='whole-program-finished-and-restored';break;
   }
  }
  if(row.result==='not-started')row.result='clock-budget';row.stateAfter=journalProjection(game);row.ownedAfter=game.state.snapshot();
 }catch(error){row.result='blocked';row.error={message:error.message,stack:error.stack};if(game){row.stateAfter=journalProjection(game);row.ownedAfter=game.state.snapshot();}}
 return row;
}
const effectSites=input.programs.flatMap(p=>p.data.Mnemonics.flatMap((raw,index)=>['PlayBattleEffect','SyncBattleEffect'].includes(raw.mnemonic)?[{program:p.id,index,source:p.source,raw,typed:p.compiled.instructions[index].op}]:[]));
const systemSites=input.sites.filter(site=>site.raw.mnemonic==='Msg'&&Object.hasOwn(input.input.messages.system_zhc??{},site.raw.operands.sValues[0])),systemPrograms=new Set(systemSites.map(site=>site.program));
const selected=family==='system-messages'?systemSites:family==='effects'?[]:o.smoke==='one'?[input.sites.find(s=>s.typed.kind==='message'&&s.typed.command.kind==='sequence'&&!s.typed.command.template)]:input.sites,parameters=[];
for(const site of selected){if(site.typed.kind!=='message'){parameters.push({site,result:'source-operand-blocked',reason:site.typed.reason});continue;}const e=envelope(site);parameters.push({site,run:await run(e.program,{site,actualPc:e.actualPc,endPc:e.endPc,lane:o.smoke?'authored-fixture-smoke':'actual-source-operand-controlled-host'})});}
const programs=[],originalParties=[];
if(!o.smoke){for(const p of input.programs)programs.push({id:p.id,source:p.source,rawHash:p.rawHash,affected:family==='system-messages'?systemPrograms.has(p.id):family==='effects'?p.data.Mnemonics.some(i=>["PlayBattleEffect","SyncBattleEffect"].includes(i.mnemonic)):p.messageSites.length>0,battleExportBinding:p.battleExportBinding,
 run:p.battleExportBinding.kind==='unbound-battle-export-source-v1'?{lane:'whole-original-battle-program-controlled-caller',result:'source-program-binding-blocked',reason:p.battleExportBinding.reason,vmPreflightAttempted:false,sessionBattlePreparationAttempted:false,sourceStoryReachability:false}:await run(p.compiled,{lane:'whole-original-battle-program-controlled-caller'})});
 for(const partyId of input.dependencies.requestedPartyIds){
  const descriptor=input.dependencies.encounters.find(row=>row.partyId===partyId),diagnostics=input.dependencies.diagnostics.filter(row=>row.partyId===partyId);
  if(!descriptor){assert(diagnostics.length,'Requested party has neither descriptor nor diagnostic');originalParties.push({partyId,program:null,sourceDiagnostics:diagnostics,
   run:{lane:'original-source-party-availability-and-lifecycle',result:'source-descriptor-blocked',vmPreflightAttempted:false,sessionBattlePreparationAttempted:false,sourceStoryReachability:false}});continue;}
  const p=input.programs.find(p=>p.source.assetPath===descriptor.script?.source.assetPath);
  if(!p){originalParties.push({partyId,program:null,source:descriptor.source,dependencies:descriptor,sourceDiagnostics:diagnostics,
   run:{lane:'original-source-party-availability-and-lifecycle',result:'source-program-binding-blocked',reason:'Complete original source body/namespace binding is unavailable',vmPreflightAttempted:false,sessionBattlePreparationAttempted:false,sourceStoryReachability:false}});continue;}
  originalParties.push({partyId,program:p.id,source:descriptor.source,dependencies:descriptor,sourceDiagnostics:diagnostics,
   run:await run(p.compiled,{partyOverride:partyId,lane:'original-source-party-availability-and-lifecycle'})});}}
assert.equal(await runtimeDigest(root,compiled),runtime,'Runtime changed during family execution');if(candidate){await candidate.validate();assert.equal(sha(await readFile(familyDirectory.policy.file)),familyDirectory.policy.sha256,'Explicit family battle policy changed');}
const now=await input.api.loadCorpus(root);assert.equal(api.hash({assets:now.assets,tables:now.tables,messages:now.messages,manifest:now.manifest}),input.sourceDigest,'Source snapshots changed');
const artifacts={};async function artifact(file,value){const bytes=JSON.stringify(value)+'\n',path=resolve(dirname(out),file);await writeFile(path,bytes);return {file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};}
artifacts.inventory=await artifact('source-inventory.json',input.inventory);if(family==='effects')artifacts.effectSites=await artifact('all-battle-effect-sites.json',effectSites);if(fullGraph)artifacts.completeWorldDependencies=await artifact('all-world-dependencies.json',fullGraph);
const blockerGroups=new Map();for(const row of [...parameters.filter(p=>p.result==='source-operand-blocked'||p.run?.result==='blocked').map(p=>({kind:'parameter',reason:p.reason??p.run.error.message,source:p.site.source,index:p.site.index,program:p.site.program})),
 ...programs.filter(p=>['blocked','source-program-binding-blocked'].includes(p.run.result)).map(p=>({kind:'whole-program',reason:p.run.error?.message??p.run.reason,source:p.source,program:p.id}))]){
 const key=row.reason;const group=blockerGroups.get(key)??{reason:key,sites:[]};group.sites.push(row);blockerGroups.set(key,group);
}
const report={kind:family==='system-messages'?'source-battle-system-message-execution-v1':family==='effects'?'source-battle-event-effect-execution-v1':'source-battle-event-message-execution-v1',family,result:o.smoke?'smoke-attempts-recorded':'complete-attempts-recorded',runtimeSha256:runtime,sourceDigest:input.sourceDigest,
 candidate:candidate?{reportSha256:sha(candidate.reportBytes),runtimeSha256:candidate.runtimeSha256,objects:candidate.report.objects.length,link:candidate.report.link,inputLock:candidate.report.inputLock}:null,recipeBinding,familyDirectory,artifacts,
 counts:{...input.inventory.counts,...(family==='effects'?{effectSites:effectSites.length,decodedEffectSites:effectSites.filter(s=>['play-battle-effect','sync-battle-effect'].includes(s.typed.kind)).length,actualEffectRequests:programs.reduce((n,p)=>n+(p.run.stateAfter?.effectRequests.filter(e=>e.action==='request').length??0),0),actualEffectCompletions:programs.reduce((n,p)=>n+(p.run.stateAfter?.effectRequests.filter(e=>e.action==='complete').length??0),0)}:{}),parameterAttempts:parameters.length,parameterCompleted:parameters.filter(r=>r.run?.result==='parameter-protocol-completed').length,
  parameterBlocked:parameters.filter(r=>r.result==='source-operand-blocked'||r.run?.result==='blocked').length,wholeProgramAttempts:programs.length,wholeProgramVMPreflightAccepted:programs.filter(r=>r.run.vmPreflightAccepted).length,wholeProgramSessionBattlePreparationAttempts:programs.filter(r=>r.run.sessionBattlePreparationAttempted).length,wholeProgramFinished:programs.filter(r=>r.run.result==='whole-program-finished-and-restored').length,
  affectedProgramAttempts:programs.filter(r=>r.affected).length,affectedProgramFinished:programs.filter(r=>r.affected&&r.run.result==='whole-program-finished-and-restored').length,originalPartyAttempts:originalParties.length,originalPartyDirectoryRequests:familyDirectory?.requestedPartyIds.length??0,originalPartyDescriptorDiagnostics:input.dependencies.diagnostics.length},
 parameters,programs,originalParties,blockerGroups:[...blockerGroups.values()],sourceCampaignComplete:false,nativeParity:false,browserVerified:false,
 familyCounts:family==='system-messages'?{systemMessageSites:systemSites.length,physicalPrograms:systemPrograms.size,completeRawInstructions:input.programs.filter(p=>systemPrograms.has(p.id)).reduce((n,p)=>n+p.data.Mnemonics.length,0)}:family==='effects'?{playSites:effectSites.filter(s=>s.raw.mnemonic==='PlayBattleEffect').length,syncSites:effectSites.filter(s=>s.raw.mnemonic==='SyncBattleEffect').length,physicalPrograms:input.programs.filter(p=>p.data.Mnemonics.some(i=>['PlayBattleEffect','SyncBattleEffect'].includes(i.mnemonic))).length,completeRawInstructions:input.programs.filter(p=>p.data.Mnemonics.some(i=>['PlayBattleEffect','SyncBattleEffect'].includes(i.mnemonic))).reduce((n,p)=>n+p.data.Mnemonics.length,0)}:null,
 controlledHost:{input:'Explicit recorded confirmation and legal existing battle commands',caller:'Authored ordinary Session/placement; original battle body and all unknowns intact',clock:'10ms fixed Web manager-before-VM; no message-implied pause',policy:sourceWebReplayRuntimePorts(),messageOwner:'Actual Field.sourceMessage; no second window owner',smoke:!!o.smoke}};
report.contentHash=api.hash(report);await writeFile(out,JSON.stringify(report)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,hash:report.contentHash,report:out}));
