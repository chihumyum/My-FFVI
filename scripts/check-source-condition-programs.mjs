import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// Runs complete original programs, not handpicked PCs. The source-map and
// declared controlled-map lanes remain separate from story reachability.
Error.stackTraceLimit=50;
const args=process.argv.slice(2),options={root:resolve(import.meta.dirname,'..'),compiled:'dist',
 'candidate-dir':'build/reports/source-condition-candidates',report:'build/reports/source-condition-programs-check.json'},seenArgs=new Set();
while(args.length){const flag=args.shift();assert.ok(['--root','--compiled','--candidate-dir','--report'].includes(flag)&&
 typeof args[0]==='string'&&!args[0].startsWith('--')&&!seenArgs.has(flag),
 'Use check-source-condition-programs.mjs [--root dir] [--compiled dir] [--candidate-dir dir] [--report file]');
 seenArgs.add(flag);options[flag.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),view=resolve(import.meta.dirname,'..'),
 candidateDir=resolve(root,options['candidate-dir']),reportPath=resolve(root,options.report),out=dirname(reportPath);
assert.ok(reportPath.startsWith(resolve(root,'build')+'/')&&reportPath.endsWith('.json'),
 'Source-derived reports must remain in ignored build/');
await mkdir(out,{recursive:true});
await writeFile(reportPath,JSON.stringify({kind:'source-condition-complete-program-lifecycle-v1',
 result:'running',stage:'preflight',wholeSourceCampaignComplete:false,runtimeAdmission:'unassessed'},null,2)+'\n');
async function main(){
const load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js'))),sha=b=>createHash('sha256').update(b).digest('hex');
const [{loadCorpus},{loadSystemMessages},{compileStoryCorpus},{hash,canonical},{GameContentRepository,fieldMediaUrls},{parseGameContentRefs},
 {compileFrameworkNewGame},{GameSession},{GameFlow},{GameCommands},{GameBattleHandoff},{CheckpointStorage},
 {compileFieldPuppetScriptContext},{bindSourceFormatFlags},{decodeScriptLocals,decodeConditionVisualFlag},
 {compileEventScriptTransitionMetadata},{createWebFieldMessageSequencePort},{createWebFlatConditionLeaderActivityPort},
 {WEB_SOURCE_ENCOUNTER_POLICY,selectWebSourceEncounter},{FRAMEWORK_STORY_RUNTIME_DECLARATIONS},
 {sourceEncounterCandidates},{analyzeBatchEncounters}]=await Promise.all([
 'compiler/corpus','compiler/system-messages','compiler/story-corpus','compiler/content','core/game-content','core/game-content-refs',
 'compiler/framework-new-game','core/game-session','core/game-flow','core/game-commands','core/game-battle-handoff','core/saved-game',
 'compiler/field-puppet-actors','compiler/source-system-flags','compiler/field','compiler/event-script-transition',
 'core/source-message-sequence','core/field-condition-activity','core/source-encounter-entry','core/development-profile',
 'core/source-encounter','compiler/content-batch-battle'].map(load));
const files=new Map(),read=async path=>{const absolute=resolve(root,path),bytes=await readFile(absolute);files.set(absolute,sha(bytes));return JSON.parse(bytes);};
const verified=value=>{const {contentHash,...body}=value;assert.equal(hash(body),contentHash,'Content digest mismatch');return value;};
const readJson=async url=>{assert.match(url,/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);return read('build'+url);};
const seal=v=>{const{contentHash:_,...body}=v;v.contentHash=hash(body);return v;};
const snapshot=await loadCorpus(root),system=await loadSystemMessages(root,snapshot.manifest.parentSourceSetHash,snapshot.manifest.sources),
 sourceDigest=hash({assets:snapshot.assets,tables:snapshot.tables,messages:snapshot.messages,manifest:snapshot.manifest}),
 ir=compileStoryCorpus({...snapshot,messages:{...snapshot.messages,system_zhc:system.messages}}),
 programs=new Map(ir.scripts.map(p=>[p.id,p])),assets=new Map(snapshot.assets.filter(a=>a.kind==='script').map(a=>[a.id,a])),
 misc=snapshot.assets.filter(a=>a.source.assetPath.endsWith('/serial_misc_assets.json'));
assert.equal(misc.length,1); assert.equal(ir.scripts.length,3304);
const sourceRefs=parseGameContentRefs(await readJson('/content-packages/source.json')),
 sourceRepository=new GameContentRepository(readJson,'source',sourceRefs),publishedSource=await sourceRepository.sourceNewGame(),
 systemsRefs=parseGameContentRefs(await readJson('/content-packages/systems-initialized.json')),
 systems=await new GameContentRepository(readJson,'framework',systemsRefs).initializedNewGame(),
 candidate=verified(await read(resolve(candidateDir,'source-condition-candidate.json'))),
 candidateProof=verified(await read(resolve(candidateDir,'source-condition-candidate-proof.json')));
assert.equal(candidate.contentHash,hash(Object.fromEntries(Object.entries(candidate).filter(([key])=>key!=='contentHash'))));
const sourceBase=verified(await read(resolve(candidateDir,'source-condition-source-base.json'))),source=publishedSource;
assert.equal(canonical(candidate.gameState),canonical(sourceBase.gameState),'Actual current compiler source/owned domains must not change');
assert.equal(canonical(candidate.gameState),canonical(publishedSource.battle.gameState),'Published source owned domain must remain exact');
assert.equal(candidate.common.sourceContentHash,publishedSource.battle.common.sourceContentHash);
assert.equal(candidate.common.fieldSourceSetHash,publishedSource.battle.common.fieldSourceSetHash);
assert.equal(candidateProof.kind,'source-condition-candidate-directory-proof-v1');
assert.equal(candidateProof.catalogHash,candidate.contentHash);
assert.deepEqual(candidate.common.conditionControlPolicy,{kind:'web-source-control-actions-v1'},'The candidate must declare the shared Web control policy');
assert.deepEqual(candidateProof.web.policy.conditionControlPolicy,candidate.common.conditionControlPolicy);
assert.equal(candidateProof.sourceSetHash,snapshot.sourceSetHash);
assert.equal(candidateProof.parentSourceSetHash,snapshot.manifest.parentSourceSetHash);
assert.equal(candidateProof.sourceDigest,hash(snapshot),'Candidate source input drift');
for(const file of candidateProof.runtime.files)assert.equal(sha(await readFile(resolve(compiled,file.path))),file.sha256,
 'Candidate compiler runtime differs from replay runtime: '+file.path);
const candidateAnalysis=analyzeBatchEncounters(candidate,candidateProof.partyIds);
assert.equal(canonical(candidateAnalysis),canonical(candidateProof.web.analysis),'Candidate dependency analysis mismatch');
const all=ir.scripts.filter(p=>p.domain==='field'&&p.instructions.some(i=>i.raw.mnemonic==='Encount')),
 sites=all.flatMap(p=>p.instructions.filter(i=>i.raw.mnemonic==='Encount').map(i=>({program:p.id,rawHash:p.rawHash,site:i.site,raw:i.raw,decoded:i.decoded,diagnostic:i.diagnostic??null}))),
 mapById=new Map(ir.analysis.maps.map(map=>[Number(map.id),map]));
const dependenciesByProgram=new Map();
for(const edge of ir.analysis.dependencies){const values=dependenciesByProgram.get(edge.site.asset)??[];
 values.push(edge);dependenciesByProgram.set(edge.site.asset,values);}
// Complete source inventory is checked independently of which roots can be
// nominated. No fixed map, script, PC or chosen-party allowlist is used.
assert.equal(all.length,candidateProof.counts.physicalPrograms);assert.equal(sites.length,candidateProof.counts.sites);
const physicalCandidates=[...new Set(sites.flatMap(site=>site.decoded?.kind==='source-encounter'
 ?sourceEncounterCandidates(site.decoded.command).map(row=>row.partyId):[]))].sort((a,b)=>a-b);
assert.equal(canonical(physicalCandidates),canonical(candidateProof.partyIds));
const battleAssessments=new Map(candidateAnalysis.encounters.map(row=>[row.id,row])),
 bindingsByProgram=new Map();
for(const map of ir.analysis.maps)for(const[alias,id]of Object.entries({...map.residentScripts,...map.scriptAliases})){
 if(!id)continue;const bindings=bindingsByProgram.get(id)??[];
 bindings.push({mapId:Number(map.id),alias,initializer:map.initializer,initializerName:map.initializerName,
  initializerStatus:map.initializerStatus,packageId:map.packageId});bindingsByProgram.set(id,bindings);}
function operandBlockers(program){return program.instructions.filter(op=>!op.decoded||op.decoded.kind==='blocked')
 .map(op=>({kind:'operand',program:program.id,site:op.site,raw:op.raw,diagnostic:op.diagnostic??null,
  reason:op.decoded?.reason??'Field decoding is unavailable'}));}
function battleBlockers(program){return program.instructions.flatMap(op=>op.decoded?.kind==='source-encounter'
 ?sourceEncounterCandidates(op.decoded.command).flatMap(slot=>{const assessment=battleAssessments.get(slot.partyId);
  return assessment?.status==='ready'?[]:[{kind:'battle-dependency',program:program.id,site:op.site,
   ...slot,assessment:assessment??null}];}):[]);}
const familyConditionIds=candidate.common.conditions.behaviors.filter(behavior=>['sleep','confusion','temptation','doom'].includes(behavior.kind)).map(behavior=>behavior.id),
 familyAbilityIds=Object.values(candidate.common.abilities).filter(ability=>ability.program.functions.some(fn=>fn.type===9&&familyConditionIds.includes(fn.values[0]))).map(ability=>ability.id),
 familyPartyIds=candidate.encounterReport.entries.filter(entry=>entry.abilityIds.some(id=>familyAbilityIds.includes(id))).map(entry=>entry.partyId);
assert.ok(familyConditionIds.length>=4&&familyAbilityIds.length&&familyPartyIds.length);
const nominations=all.map(program=>{const bindings=bindingsByProgram.get(program.id)??[],
 reasons=[...(program.domain==='field'?[]:[{kind:'non-field-domain',domain:program.domain}]),
  ...(program.instructions.some(op=>op.decoded?.kind==='source-encounter'&&sourceEncounterCandidates(op.decoded.command).some(slot=>familyPartyIds.includes(slot.partyId)))?[]:[{kind:'outside-nominated-condition-family'}]),
  ...operandBlockers(program),...battleBlockers(program),...(bindings.length?[]:[{kind:'no-original-map-binding'}])];
 return{id:program.id,rawHash:program.rawHash,bindings,reasons,ownProgramCandidate:reasons.length===0,
  runtimeAdmission:'unassessed',storyReachability:'unverified'};});
const groups=[];
for(const nomination of nominations.filter(row=>!row.reasons.some(reason=>reason.kind==='outside-nominated-condition-family')))for(const binding of nomination.bindings){
 const map=mapById.get(binding.mapId),namespace={...map.residentScripts,...map.scriptAliases},queue=[nomination.id],
  seen=new Set(),closurePrograms=[],edges=[],blockers=[],boundaries=[];
 while(queue.length){const id=queue.shift();if(seen.has(id))continue;seen.add(id);
  const program=programs.get(id),asset=assets.get(id);if(!program||!asset){blockers.push({kind:'missing-physical-program',id});continue;}
  closurePrograms.push({id,rawHash:program.rawHash,source:asset.source,raw:asset.data,
   instructions:program.instructions,dependencies:dependenciesByProgram.get(id)??[]});
  if(program.domain!=='field')blockers.push({kind:'non-field-domain',id,domain:program.domain});
  blockers.push(...operandBlockers(program),...battleBlockers(program));
  for(const op of program.instructions){
   if(op.decoded?.kind==='source-encounter'||op.raw.mnemonic==='ChangeScript'){
    const name=op.decoded?.kind==='source-encounter'?op.decoded.command.continuation:op.raw.operands.sValues[0];
    if(name){const target=Object.hasOwn(namespace,name)?namespace[name]:null;
     edges.push({id,index:op.site.index,name,target:target??null,source:op.site.source});
     if(target)queue.push(target);else blockers.push({kind:'unresolved-script',id,index:op.site.index,name});}}
   if(op.raw.mnemonic==='ChangeMap')boundaries.push({kind:'source-map-change',id,index:op.site.index,
    raw:op.raw,source:op.site.source,mapInitializationAdmission:'unassessed'});
  }
 }
 groups.push({root:{id:nomination.id,rawHash:nomination.rawHash,binding},programs:closurePrograms,edges,blockers,boundaries,
  ownProgramAndSameMapContinuationOperandAndBattleClosure:blockers.length===0,
  runtimeAdmission:'unassessed',mapInitializationAdmission:'unassessed',storyReachability:'unverified'});
}
// A source family is an attempt cohort, never an operand-readiness filter.
// Original unsupported instructions and every continuation remain in place.
const selectedGroups=groups,
 physicalClosure=new Map(selectedGroups.flatMap(group=>group.programs.map(program=>[program.id,program]))),
 originalClosure={kind:'source-encounter-fresh-same-map-closure-v1',groups,nominations,
 counts:{logicalRootCandidates:groups.length,selectedRoots:selectedGroups.length,operandAndBattleClosedRoots:groups.filter(group=>group.ownProgramAndSameMapContinuationOperandAndBattleClosure).length,physicalPrograms:physicalClosure.size,
  instructions:[...physicalClosure.values()].reduce((count,program)=>count+program.raw.Mnemonics.length,0),
  mapBoundaries:selectedGroups.reduce((count,group)=>count+group.boundaries.length,0)},
 rootSelection:'Every original field program containing a candidate affected by this condition family, including blocked programs; complete same-map Encount/ChangeScript alias closure',
 runtimeAdmission:'unassessed',sourceStoryReachability:false};

const imageFiles=new Map(),audioFiles=new Map(),audioBindings=new Map();
async function verifyImage(url){
 assert.match(url,/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.png$/);
 const path=resolve(root,url.startsWith('/imports/textures/')?'build/import/textures/'+url.slice('/imports/textures/'.length):'build'+url);
 if(!imageFiles.has(path)){const bytes=await readFile(path);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');imageFiles.set(path,sha(bytes));}
}
async function verifyTrack(track){if(!track)return;assert.match(track.file,/^\/(bgm|se|environment)\/tracks\/[a-f0-9]{64}\.flac$/);
 const path=resolve(root,'build'+track.file);if(!audioFiles.has(path)){const bytes=await readFile(path);assert.equal(sha(bytes),track.sha256);assert.equal(bytes.subarray(0,4).toString(),'fLaC');audioFiles.set(path,track.sha256);}assert.equal(audioFiles.get(path),track.sha256);audioBindings.set(hash(track),true);}
const ready={visible:true,mediaReady:true,overlayOpen:false};
async function runtimeBinding(){const rows=[];async function walk(base,path){for(const e of(await readdir(resolve(base,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const next=path+'/'+e.name;if(e.isDirectory())await walk(base,next);else if(e.isFile()&&/\.(?:js|mjs)$/.test(e.name))rows.push({base:base===compiled?'compiled':'view',path:next,sha256:sha(await readFile(resolve(base,next)))});}}await walk(compiled,'src');await walk(view,'apps/game');await walk(view,'scripts');return{hash:hash(rows),files:rows};}
const runtime=await runtimeBinding(),report={kind:'source-condition-complete-program-lifecycle-v1',result:'running',runtime,tool:{path:'scripts/check-source-condition-programs.mjs',sha256:sha(await readFile(import.meta.filename))},sourceDigest,
 sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash,corpusHash:ir.contentHash,
 completeCohort:all.map(p=>({id:p.id,rawHash:p.rawHash,raw:p.raw,source:p.source,maps:p.maps,instructions:p.instructions,
  dependencies:dependenciesByProgram.get(p.id)??[],runtimeAdmission:'unassessed',storyReachability:'unverified'})),
 allSites:sites,allBattleCandidates:candidateProof,originalSameMapClosure:originalClosure,
 familyScope:{conditionIds:familyConditionIds,abilityIds:familyAbilityIds,partyIds:familyPartyIds},sourceBase:{catalogHash:sourceBase.contentHash,publishedCatalogHash:publishedSource.battle.contentHash,entryHash:publishedSource.content.contentHash,initializerUnchanged:true,ownedDomainUnchanged:true,typedMetadataRecompiled:true},fullSourceDependencyAnalysis:ir.analysis,declaredRoots:selectedGroups.map(g=>g.root),programs:[],partyMechanisms:[],wholeSourceCampaignComplete:false,nativeRuntimeVerified:false,browserVerified:false,
 policies:{selection:WEB_SOURCE_ENCOUNTER_POLICY,conditionControl:candidate.common.conditionControlPolicy,owned:'unaltered-source-DataInitialize',audio:'verified-FLAC-controlled-presentation-ACK',
  battleInputs:'public-source-command-1-Attack-if-owned-and-available',entry:'defer-live-player-sync-until-prepared-battle-publication'},
 limitations:['Original source-map lane attempts the real original initializer before each root; failures are retained, never bypassed.',
 'Each root is launched through public FieldGame.startEvent after initialization. This is a controlled whole-program probe, not a navigation or story-reachability route.',
 'Controlled-map lane declares the already-authored systems-initialized map/PointIn/initializer, preserving its legal original source owned initializer. It installs whole original source programs and their exact map-local/resident namespace, but no original missing entity groups or scene state is invented.',
 'Both original-program lanes keep every original instruction and branch; source story reachability is unverified. A controlled-map completion is not original-map admission.',
 'The source-party-mechanism lane declares a new authored field request for each exact source enemy party, on the existing systems map with unaltered source owned initialization. It uses the same Session/Flow/Handoff/Commands/Storage engine and does not claim execution or reachability of an original source Main.',
 'FootInfo is only the proved consumed BG projection; terrain overwrite/exclusion branches remain blocked. Source Unity RNG and native introduction are unknown.',
 'Battle choices and command actions are real public inputs; no HP/flags/levels/skills/results are patched or initialized to fit a branch.']};
const built=new Map();
async function build(group,lane){const key=lane+':'+group.root.binding.mapId+':'+(group.root.mechanismPartyId??'source');if(built.has(key))return built.get(key);
 const sourceMap=await sourceRepository.map(group.root.binding.mapId,source.catalog),binding=mapById.get(sourceMap.mapId),
  rawMap=lane==='original-source-map'?sourceMap:systems.map,map=structuredClone(rawMap),world=structuredClone(lane==='original-source-map'?source.catalog:systems.catalog),
  battle=structuredClone(candidate),namespace=lane==='source-party-mechanism'?{}:{...binding.residentScripts,...binding.scriptAliases},programBindings=[],unavailable=[];
 for(const [alias,id]of Object.entries(namespace)){
  if(id===null){unavailable.push({alias,reason:'original unresolved alias shadows resident'});continue;}
  const asset=assets.get(id),program=programs.get(id);if(!asset||!program){unavailable.push({alias,id,reason:'missing original program'});continue;}
  map.scripts[alias]=program.instructions.map(i=>({...structuredClone(i.decoded??{kind:'blocked',mnemonic:i.raw.mnemonic,reason:'Non-field source domain is not admitted',...i.site}),script:alias}));
  const flags=bindSourceFormatFlags(snapshot.manifest,asset);
  try{(map.scriptLocals??={})[alias]=decodeScriptLocals(asset.data);(map.scriptPuppetContexts??={})[alias]=compileFieldPuppetScriptContext(asset.data,misc[0].data,flags);
   (map.scriptSystemFlags??={})[alias]=decodeConditionVisualFlag(asset.data,flags);(map.scriptTransitionMetadata??={})[alias]=compileEventScriptTransitionMetadata(asset.data);
  }catch(error){delete map.scriptLocals?.[alias];delete map.scriptPuppetContexts?.[alias];unavailable.push({alias,id,reason:String(error.message)});}
  programBindings.push({alias,id,rawHash:hash(asset.data),opHash:hash(map.scripts[alias]),instructionCount:asset.data.Mnemonics.length});
 }
 if(lane!=='original-source-map'){
  const row=systems.battle.common.battleEntry.maps.find(row=>row.id===map.mapId);assert.ok(row,'The existing authored qualification must be explicit');
  if(!battle.common.battleEntry.maps.some(entry=>entry.id===row.id))battle.common.battleEntry.maps.push(structuredClone(row));
  battle.common.limitations.push('Controlled source-program map '+map.mapId+' preserves its already declared map3 qualification; no source scene reachability.');seal(battle);
  // Missing source groups stay missing and block. An authored station may
  // never impersonate a group referenced by a complete original program.
  const sourceGroupNames=group.programs.flatMap(p=>p.raw.Mnemonics.filter(op=>op.mnemonic==='SetEntities').map(op=>op.operands.sValues[0]));
  assert.ok(sourceGroupNames.every(name=>!Object.hasOwn(map.map.groups,name)),'Controlled groups may not impersonate a referenced source group');
 }
 if(lane==='source-party-mechanism'){
  const name=group.root.binding.alias,after=name+'-after',evidence={file:'scripts/check-source-condition-programs.mjs',assetPath:'authored-source-party-mechanism'};
  map.scripts[name]=[{kind:'source-encounter',command:{kind:'source-encounter',slots:[group.root.mechanismPartyId,0,0,0],effectId:0,continuation:after,footCapture:'before-player-sync'},script:name,index:0,source:evidence}];
  map.scripts[after]=[{kind:'exit',script:after,index:0,source:evidence}];
  for(const alias of[name,after]){(map.scriptLocals??={})[alias]=null;
   (map.scriptSystemFlags??={})[alias]={keepBadStatusVisual:false};
   (map.scriptTransitionMetadata??={})[alias]={customAnimations:'none'};
   const inherited=Object.values(systems.map.scriptPuppetContexts??{}).find(value=>value!==null);
   if(inherited)(map.scriptPuppetContexts??={})[alias]={...structuredClone(inherited),scriptHash:hash(map.scripts[alias])};}
 }
 const profile=(sourceContentHash)=>({kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash,omissions:[],...FRAMEWORK_STORY_RUNTIME_DECLARATIONS});
 map.developmentProfile=profile(rawMap.contentHash);world.developmentProfile=profile((lane==='original-source-map'?source.catalog:systems.catalog).contentHash);
 seal(map);world.maps[String(map.mapId)].contentHash=map.contentHash;seal(world);
 const entrance=lane==='original-source-map'?map.partyEntry?.pointIns[0]?.id:systems.content.entry.entrance;
 const result={map,world,battle,sourceMap,programBindings,unavailable,entrance};
 try{result.content=await compileFrameworkNewGame({sourceEntry:source.content,sourceBattle:source.battle,sourceMap:source.map,world,map,battle,entrance});}
 catch(error){result.buildError={message:error.message,stack:error.stack};}
 built.set(key,result);return result;
}
async function execute(group,lane,seed,prefix){const input={lane,seed,choicePrefix:prefix,sourceMapId:group.root.binding.mapId,alias:group.root.binding.alias,
 ...(group.root.mechanismPartyId?{authoredMechanismPartyId:group.root.mechanismPartyId}:{} )};let binding;
 try{binding=await build(group,lane);}catch(error){return{...input,result:'entry-provider-blocked',stage:'map-program-binding',error:{message:error.message,stack:error.stack},sourceInitializationAttempted:false};}
 if(binding.buildError)return{...input,result:'entry-provider-blocked',stage:'framework-entry-binding',error:binding.buildError,sourceInitializationAttempted:false,
  sourceMapHash:binding.sourceMap.contentHash,sourceInitializer:binding.sourceMap.initializer,sourceMapBlockers:binding.sourceMap.blockers,programBindings:binding.programBindings};
 const presented=new Set(),frames=[],requests=[],commands=[],choices=[],messages=[];
 const runtime={sourceEncounterPolicy:WEB_SOURCE_ENCOUNTER_POLICY,battleHandoff:'prepared',sourceMessageSequence:createWebFieldMessageSequencePort(),
  conditionLeaderActivity:createWebFlatConditionLeaderActivityPort(),audioReadiness:{isReady:track=>audioBindings.has(hash(track))},
  soundPresentation:{isPresented:(voice,track)=>audioBindings.has(hash(track))&&presented.has(canonical({id:voice.id,track:voice.track,started:voice.started}))}};
 let game,flow,channel,stage='initialization',elapsed=0,frontier=null,error=null,saved=null,battles=0;
 const mediaObservations=[],conditionSamples=[],seenConditions=new Set();const handoffHost={prepareStart:async candidate=>{for(const url of candidate.mediaUrls)await verifyImage(url);mediaObservations.push({kind:candidate.kind,request:candidate.request,mediaUrls:candidate.mediaUrls});return{};},prepareReturn:async candidate=>({}),discard(){}};
 async function audio(){for(const track of game.field.pendingAudioTracks)await verifyTrack(track);for(const voice of game.field.se.voices){const track=game.field.content.se?.tracks[voice.track];await verifyTrack(track);const key=canonical({id:voice.id,track:voice.track,started:voice.started});if(!presented.has(key)){presented.add(key);frames.push({id:voice.id,track:voice.track,sha256:track.sha256});}}}
 async function tick(){await audio();const before=game.battle;
  if(before)for(const unit of before.combatants)for(const id of unit.conditionIds)if(familyConditionIds.includes(id))seenConditions.add(id);
  flow.advance(10,ready);elapsed+=10;
  if(game.battle){const sample=game.battle.combatants.map(unit=>({id:unit.id,hp:unit.hp,atb:unit.atb,conditions:unit.conditionIds,clocks:game.battle.phase==='active'?game.battle.controlClockState(unit.id):[]}));
   const last=conditionSamples.at(-1);if(sample.some(unit=>unit.conditions.some(id=>familyConditionIds.includes(id)))&&(!last||hash(last.units)!==hash(sample)))
    conditionSamples.push({time:elapsed,units:structuredClone(sample),action:game.battle.action?.control??null});}
 }
 async function fieldInput(){if(game.field.choice){if(choices.length>=prefix.length){frontier={kind:'choice',options:game.field.choice.options.length};return false;}
   const answer=prefix[choices.length];assert.equal(flow.choose(game.field.choice.id,answer),true);choices.push({request:game.field.choice,answer});}
  else if(game.field.dialogue){if(!game.field.dialogue.manual||game.field.time>=game.field.dialogue.manual.availableAt){messages.push(game.field.dialogue.key);flow.confirm();}}
  else if(game.field.sourceMessage.projection?.acceptsInput)flow.confirm();await tick();return true;}
 try{
  game=await GameSession.prepareFrameworkNewGame(binding.content,binding.world,binding.map,binding.battle,runtime,seed);for(const url of fieldMediaUrls(game.field.content))await verifyImage(url);flow=new GameFlow(game);flow.start();flow.advance(0,ready);channel=new GameCommands(flow,game);
  while(elapsed<120000&&!game.field.stop&&!game.checkpointReady){if(!await fieldInput())break;}
  if(!frontier&&!game.field.stop&&game.checkpointReady){stage='original-program';assert.equal(game.field.startEvent(group.root.binding.alias),true);}
  else if(!frontier&&!game.field.stop)frontier={kind:'initialization-clock-budget'};
  const handoff=new GameBattleHandoff(flow,handoffHost);
  while(stage==='original-program'&&!frontier&&elapsed<420000){
   if(game.battle){const battle=game.battle;if(battle.phase==='defeat'){const request=canonical(game.field.stop),owned=hash(game.state.snapshot()),
      field=game.field,player=field.player,native=player.native,entity=native?.entity,nativeBefore=canonical(field.nativeActorStateFingerprint);const retried=await handoff.retry();
      requests.push({kind:'defeat-fixed-entry-retry',status:retried.status,party:battle.content.encounterId});if(retried.status==='committed'){
       assert.notEqual(game.battle,battle);assert.strictEqual(game.field,field);assert.strictEqual(field.player,player);assert.strictEqual(player.native,native);assert.strictEqual(native?.entity,entity);
       assert.equal(canonical(field.nativeActorStateFingerprint),nativeBefore);assert.equal(canonical(game.field.stop),request);assert.equal(hash(game.state.snapshot()),owned);}
      frontier={kind:'real-source-party-defeat',retried:retried.status};break;}
    if(battle.phase==='victory'||battle.phase==='escaped'){const returned=await handoff.return();requests.push({kind:'return',status:returned.status,party:battle.content.encounterId});if(returned.status!=='committed'){frontier={kind:'return-provider',result:returned.status,error:returned.error?.message};break;}continue;}
    for(const actor of battle.ready){const menu=battle.commandMenu(actor.id),attack=menu.find(entry=>entry.kind==='ability'&&entry.available&&entry.abilityIds.includes(1)),
      choice=attack&&battle.targetChoices(actor.id,1).find(choice=>choice.selection.kind==='single'&&battle.enemies.some(enemy=>enemy.hp>0&&enemy.id===choice.selection.id));
     if(choice&&channel.command(battle,actor.id,1,choice.selection,attack.id))commands.push({actorId:actor.id,commandId:attack.id,abilityId:1,target:choice.selection});}
    await tick();continue;}
   if(game.field.stop?.kind==='encounter'){const request=structuredClone(game.field.stop),before=game.field.nativeActorStateFingerprint,entry=await handoff.start();
    requests.push({kind:'start',status:entry.status,request,beforeNative:hash(before),afterNative:hash(game.field.nativeActorStateFingerprint),error:entry.error?.message??null});
    if(entry.status!=='committed'){frontier={kind:'battle-entry-provider',status:entry.status,error:entry.error?.message??null};break;}battles++;continue;}
   if(game.field.stop){frontier={kind:game.field.stop.kind,stop:structuredClone(game.field.stop)};break;}
   if(game.checkpointReady){const checkpoint=game.checkpoint(),bytes=new Map(),storage=new CheckpointStorage({getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value)},'framework','source-condition-cohort');
    await storage.save(checkpoint,1000);const loaded=await storage.load();const restored=GameSession.restore(loaded.checkpoint,undefined,binding.battle,{catalog:binding.world,map:binding.map,initialized:{content:binding.content,initialMap:binding.map}},runtime);
    assert.deepEqual(restored.checkpoint(),checkpoint);saved={hash:hash(checkpoint),storageWrites:bytes.size,rewards:game.state.snapshot().completedBattles};break;}
   if(!await fieldInput())break;
  }
  if(stage==='original-program'&&!frontier&&!saved)frontier={kind:'clock-budget',milliseconds:elapsed};
 }catch(e){if(e?.code==='ERR_ASSERTION')throw e;error={message:e.message,stack:e.stack};}
 return{...input,stage,result:error?'explicit-provider-error':saved?'finished-and-restored':game?.field.stop?.kind==='unsupported'?'blocked':
  frontier?.kind==='real-source-party-defeat'?frontier.retried==='committed'?'defeat-and-fixed-entry-retried':'retry-provider-blocked':
  frontier?.kind==='battle-entry-provider'?'battle-entry-provider-blocked':frontier?'boundary':'unfinished',error,frontier,
  sourceInitializationAttempted:lane==='original-source-map',sourceInitializer:binding.sourceMap.initializer,sourceMapHash:binding.sourceMap.contentHash,
  authoredMapId:binding.map.mapId,actualInitializer:binding.map.initializer,programBindings:binding.programBindings,unavailable:binding.unavailable,
  ownedBeforeSourceHash:hash(binding.battle.gameState.sourceNewGame),elapsed,battles,requests,commands,choices,messages,saved,controlledAudioFrames:frames,mediaObservations,conditionIdsObserved:[...seenConditions],conditionSamples,
  stop:game?.field.stop??null,owned:game?.state.snapshot()??null,storyReachability:'unverified',runtimeAdmission:'unassessed'};
}
await mkdir(out,{recursive:true});
try{assert.ok(selectedGroups.length,'No nominated source program closure');for(const group of selectedGroups){const program=programs.get(group.root.id);assert.ok(program);assert.equal(program.rawHash,group.root.rawHash);const first=program.instructions.find(i=>i.decoded?.kind==='source-encounter')?.decoded.command;
 const seeds=first?first.slots.filter(id=>id>0).map((_,index)=>{for(let seed=0;seed<1000;seed++)if(selectWebSourceEncounter(first,seed,0).slotIndex===index)return seed;throw new Error('Missing deterministic slot');}):[314];
 const runs=[];for(const lane of ['original-source-map','controlled-map'])for(const seed of seeds){const prefixes=[[]];for(let index=0;index<prefixes.length&&index<16;index++){const run=await execute(group,lane,seed,prefixes[index]);runs.push(run);
 if(run.frontier?.kind==='choice'&&prefixes[index].length<8)for(let answer=0;answer<run.frontier.options;answer++)prefixes.push([...prefixes[index],answer]);}}
 report.programs.push({root:group.root,scopeProgramIds:group.programs.map(p=>p.id),runs});console.log(JSON.stringify({map:group.root.binding.mapId,alias:group.root.binding.alias,runs:runs.map(r=>({lane:r.lane,result:r.result,stage:r.stage,error:r.error?.message??r.frontier?.error??r.stop?.message??null,battles:r.battles}))}));}
 for(const partyId of familyPartyIds){
  const origin=selectedGroups.find(group=>group.programs.some(program=>program.instructions.some(op=>op.decoded?.kind==='source-encounter'&&sourceEncounterCandidates(op.decoded.command).some(slot=>slot.partyId===partyId))));
  assert.ok(origin,'Every affected source party needs an original source program binding');
  const group={root:{id:'authored-source-party:'+partyId,mechanismPartyId:partyId,sourceRoot:origin.root,
    binding:{...origin.root.binding,alias:'source-condition-mechanism-'+partyId}},programs:[],edges:[],blockers:[],boundaries:[]},
   run=await execute(group,'source-party-mechanism',314,[]);
  report.partyMechanisms.push({partyId,assessment:battleAssessments.get(partyId),root:group.root,run});
  console.log(JSON.stringify({mechanismParty:partyId,result:run.result,stage:run.stage,error:run.error?.message??run.frontier?.error??run.stop?.message??null,battles:run.battles}));
 }
 for(const[path,expected]of files)assert.equal(sha(await readFile(path)),expected,'Input changed '+path);for(const[path,expected]of audioFiles)assert.equal(sha(await readFile(path)),expected,'Audio changed '+path);for(const[path,expected]of imageFiles)assert.equal(sha(await readFile(path)),expected,'Image changed '+path);
 assert.deepEqual(await runtimeBinding(),runtime);const final=await loadCorpus(root);assert.equal(hash({assets:final.assets,tables:final.tables,messages:final.messages,manifest:final.manifest}),sourceDigest);
 report.result='complete-attempts-recorded';const runs=report.programs.flatMap(p=>p.runs);report.counts={allSites:sites.length,physicalPrograms:all.length,battleCandidateParties:physicalCandidates.length,selectedRoots:report.programs.length,sameMapPrograms:physicalClosure.size,
  runs:runs.length,byLane:Object.fromEntries(['original-source-map','controlled-map'].map(lane=>[lane,Object.fromEntries([...new Set(runs.filter(r=>r.lane===lane).map(r=>r.result))].map(result=>[result,runs.filter(r=>r.lane===lane&&r.result===result).length]))])),
  enteredBattles:runs.reduce((n,r)=>n+(r.battles??0),0),settled:runs.reduce((n,r)=>n+(r.owned?.completedBattles?.length??0),0),savedAndRestored:runs.filter(r=>r.saved).length,
  mechanisms:{attempts:report.partyMechanisms.length,enteredBattles:report.partyMechanisms.reduce((n,p)=>n+(p.run.battles??0),0),results:Object.fromEntries([...new Set(report.partyMechanisms.map(p=>p.run.result))].map(result=>[result,report.partyMechanisms.filter(p=>p.run.result===result).length]))}};
}catch(error){report.result='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
report.imageFiles=Object.fromEntries(imageFiles);report.imageDecodingVerified=false;report.audioFiles=Object.fromEntries(audioFiles);report.inputFiles=Object.fromEntries(files);seal(report);await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,error:report.error??null}));
}
try{await main();}catch(error){process.exitCode=1;const failed={kind:'source-condition-complete-program-lifecycle-v1',result:'failed',stage:'preflight',
 error:{message:error.message,stack:error.stack},wholeSourceCampaignComplete:false,runtimeAdmission:'unassessed'};
 await writeFile(reportPath,JSON.stringify(failed,null,2)+'\n');console.error(error);}
