// Whole initial NPC pose contract. Source bodies/media stay unchanged; an
// authored group-activation initializer is a separate controlled entry lane.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openSourceCandidate} from './source-candidate.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
import { sourceWebReplayRuntimePorts, sourceWebReplayFieldEffectsHost } from './source-web-replay-runtime.mjs';
const args=process.argv.slice(2),options={root:resolve(import.meta.dirname,'..'),compiled:'dist',candidate:'build/source-candidate',report:'build/reports/source-initial-npc-pose'},seen=new Set(),names={'--root':'root','--compiled-dir':'compiled','--candidate-dir':'candidate','--report':'report'};
while(args.length){const name=args.shift();assert.ok(Object.hasOwn(names,name)&&args.length&&!seen.has(name),'Expected unique --root/--compiled-dir/--candidate-dir/--report paths');seen.add(name);options[names[name]]=args.shift();}
const root=resolve(options.root),runtimeRoot=resolve(import.meta.dirname,'..'),compiled=resolve(root,options.compiled),candidateDir=resolve(root,options.candidate),output=resolve(root,options.report),part=relative(resolve(root,'build'),output),
 sha=b=>createHash('sha256').update(b).digest('hex'),load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')).href);
assert.ok(part&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part),'Report belongs to an ignored private output');
assert.ok(!['content-packages','content-releases','corpus','import','world-media'].includes(part.split(sep)[0]),'Report cannot replace published/source inputs');await mkdir(output,{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/content','core/content-integrity','compiler/corpus','compiler/system-messages','compiler/map-package','compiler/story-corpus','compiler/content-dependencies',
 'compiler/framework-new-game','compiler/field-puppet-actors','compiler/field-initial-npc-pose','core/actor-animation','core/character-media',
 'core/game-session','core/game-flow','core/game-content','core/saved-game','core/game-entry-loader','core/game-event-save',
 'core/source-message-sequence','core/field-condition-activity','core/field-camera-shake','core/field-logical-effects','core/source-encounter-entry','core/world-transportation-entry','core/field-assigned-route'].map(load)));
const startRuntime=await runtimeDigest(runtimeRoot,compiled),checkerSha256=sha(await readFile(new URL(import.meta.url))),shared=await openSourceCandidate({root,runtimeRoot,compiledDir:compiled,candidateDir}),
 sourceWorld=await shared.read('/world/catalog.json'),world=await shared.read('/framework/world/catalog.json'),sourceEntry=await shared.read('/game/source-new-game.json'),battle=await shared.read('/game/source-catalog.json'),
 sourceMaps=new Map(),maps=new Map(),mapIds=Object.keys(sourceWorld.maps).map(Number).sort((a,b)=>a-b),corpus=await api.loadCorpus(root),sourceDigest=api.hash(corpus),physical=new Map(corpus.assets.map(a=>[a.id,a]));
assert.equal(sourceWorld.sourceSetHash,corpus.sourceSetHash);assert.equal(sourceEntry.battleCatalogHash,battle.contentHash);
for(const id of mapIds){sourceMaps.set(id,await shared.read(sourceWorld.maps[id].url));maps.set(id,await shared.read(world.maps[id].url));}
const sourceKey=r=>api.canonical(Object.fromEntries(['file','assetPath','objectId','serializedFile','sha256','pointer'].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))),
 uses=[],allUses=[],characters=Object.entries(sourceWorld.characters).map(([asset,c])=>({asset,source:c.source,animationKeys:Object.keys(c.animations),
  missingFourDirectionKeys:['Default','WalkB','WalkL','WalkR'].filter(key=>!c.animations[key]),issues:sourceWorld.characterIssues[asset]??null})),
 incomplete=new Set(characters.filter(row=>row.missingFourDirectionKeys.length).map(row=>row.asset));
for(const[id,map]of sourceMaps)for(const[group,g]of Object.entries(map.map?.groups??{}))for(const e of g.entities)if(e.asset){
 const row={mapId:id,group,entityId:e.id,kind:e.kind,asset:e.asset,direction:e.direction,source:e.source};allUses.push(row);
 if((e.kind===6||e.kind===17)&&incomplete.has(e.asset)){
  const key=api.FIELD_POSE[e.direction],character=sourceWorld.characters[e.asset],poseDiagnostics=api.compileFieldEntityPoseBlockers([e],sourceWorld.characters);
  uses.push({...row,initialKey:key??null,initialKeyPresent:!!character?.animations[key],poseDiagnostics,
   originalNativeNpcBlockers:e.nativeNpcBlockers??[],originalInteraction:e.npc??null,entity:structuredClone(e)});
 }
}
uses.sort((a,b)=>a.mapId-b.mapId||a.group.localeCompare(b.group)||sourceKey(a.source).localeCompare(sourceKey(b.source)));
const affectedIds=[...new Set(uses.map(row=>row.mapId))].sort((a,b)=>a-b),bindings=new Map(api.bindMapPackages(corpus.assets,corpus.tables).map(b=>[Number(b.id),b])),programs=new Map(),namespace=[];
for(const id of affectedIds){const b=bindings.get(id),map=sourceMaps.get(id),aliases={...b.residentScripts,...b.scriptAliases};
 const row={mapId:id,originalInitializer:map.initializer,mapBlockers:map.blockers,partyEntryBlockers:map.partyEntryBlockers,
  nativeFootBlockers:map.nativeFootBlockers,actorViewBlockers:map.actorViewBlockers,nativeCompositionBlockers:map.nativeCompositionBlockers,
  groups:map.map?Object.fromEntries(Object.entries(map.map.groups).map(([n,g])=>[n,{source:g.source,entities:g.entities,blockers:g.blockers}])):null,
  scripts:[],uses:uses.filter(u=>u.mapId===id).map(({entity:_,...use})=>use)};
 for(const[name,assetId]of Object.entries(aliases)){if(!assetId)continue;const a=physical.get(assetId);assert.ok(a,'Complete source namespace physical body missing');
  const ops=map.scripts[name];assert.ok(ops,'Installed source namespace missing');programs.set(assetId,a);
  row.scripts.push({name,assetId,source:a.source,rawHash:api.hash(a.data),rawInstructions:Array.isArray(a.data.Mnemonics)?a.data.Mnemonics.length:null,
   typedInstructions:ops.length,originalLocals:map.scriptLocals?.[name]??null,typed:ops,systemFlags:map.scriptSystemFlags?.[name]??null,
   puppetContext:map.scriptPuppetContexts?.[name]??null,transitionMetadata:map.scriptTransitionMetadata?.[name]??null});
 }namespace.push(row);
}
const system=await api.loadSystemMessages(root,corpus.manifest.parentSourceSetHash,corpus.manifest.sources),
 ir=api.compileStoryCorpus({...corpus,messages:{...corpus.messages,system_zhc:system.messages}}),installed=new Set([...programs.keys()]),dependencies=api.analyzeContentDependencies({catalog:sourceWorld,maps:[...sourceMaps.values()],mapIds:affectedIds,
 roots:namespace.flatMap(map=>map.scripts.map(s=>({kind:'script',mapId:map.mapId,script:s.name})))}),artifactRows=[];
async function artifact(file,value){const bytes=JSON.stringify(value)+'\n',path=resolve(output,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);const row={file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)};artifactRows.push(row);return row;}
const allProgramIndex=[];
for(const a of corpus.assets.filter(a=>a.kind==='script')){const body={id:a.id,source:a.source,data:a.data},hash=api.hash(body);await artifact('physical-programs/'+hash+'.json',body);allProgramIndex.push({id:a.id,source:a.source,rawHash:api.hash(a.data),file:'physical-programs/'+hash+'.json',inAffectedNamespace:installed.has(a.id)});}
await artifact('source-snapshot-index.json',{sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,sourceDigest,programs:allProgramIndex});
await artifact('complete-corpus-analysis.json',ir.analysis);await artifact('affected-dependency-closure.json',dependencies);
await artifact('nomination.json',{kind:'source-initial-npc-pose-nomination-v1',sourceDigest,characters,uses,allEntityUses:allUses,namespace,
 unavailableGeometry:mapIds.filter(id=>!sourceMaps.get(id).map).map(id=>({mapId:id,blockers:sourceMaps.get(id).blockers})),
 physicalSourceProgramCount:allProgramIndex.length,completeSourceAnalysisHash:api.hash(ir.analysis),fullDependenciesHash:api.hash(dependencies)});
const media=new Map(),audio=new Set(),presented=new Set(),spriteBindings=new Map();
for(const c of Object.values(world.characters))for(const sprite of Object.values(c.sprites)){const old=spriteBindings.get(sprite.file);if(old)assert.equal(old,sprite.sha256);spriteBindings.set(sprite.file,sprite.sha256);}
async function image(url){assert.match(url,/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.png$/);const file=resolve(root,url.startsWith('/imports/')?'build/import/'+url.slice('/imports/'.length):'build'+url);
 if(!media.has(file)){const bytes=await readFile(file);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const digest=sha(bytes),expected=spriteBindings.get(url);if(expected)assert.equal(digest,expected);media.set(file,digest);}}
async function track(value){if(!value)return;assert.match(value.file,/^\/(bgm|environment|se)\/tracks\/[a-f0-9]{64}\.flac$/);const file=resolve(root,'build'+value.file);
 if(!media.has(file)){const bytes=await readFile(file);assert.equal(bytes.subarray(0,4).toString(),'fLaC');assert.equal(sha(bytes),value.sha256);media.set(file,value.sha256);}assert.equal(media.get(file),value.sha256);audio.add(api.hash(value));}
const ready={visible:true,mediaReady:true,overlayOpen:false},runtime=()=>({...sourceWebReplayRuntimePorts(),scriptRandom:'web-source-script-random-field-stream-v1',
 transportationTimestamp:()=>'639273600000000000',sourceEncounterPolicy:api.WEB_SOURCE_ENCOUNTER_POLICY,battleHandoff:'prepared',
 retainedWorldTransportation:api.WEB_RETAINED_WORLD_TRANSPORTATION,cameraShake:api.createWebFieldCameraShakePolicy(),assignedNpcRoutes:api.WEB_ASSIGNED_ROUTE_POLICY,
 sourceMessageSequence:api.createWebFieldMessageSequencePort(),conditionLeaderActivity:api.createWebFlatConditionLeaderActivityPort(),fieldEffects:sourceWebReplayFieldEffectsHost(api.createWebLogicalFieldEffectsHost),
 audioReadiness:{isReady:value=>audio.has(api.hash(value))},soundPresentation:{isPresented:(voice,value)=>audio.has(api.hash(value))&&presented.has(api.canonical({id:voice.id,track:voice.track,started:voice.started}))}});
async function fieldAudio(game){for(const value of game.field.pendingAudioTracks)await track(value);for(const voice of game.field.se.voices){await track(game.field.content.se?.tracks[voice.track]);presented.add(api.canonical({id:voice.id,track:voice.track,started:voice.started}));}}
function actors(game){return Object.values(game.field.actors).filter(a=>a.native?.scope?.kind==='map-npc').map(a=>({id:a.id,scope:a.native.scope,asset:a.asset,
 position:structuredClone(a.native.entity.position),direction:a.direction,animation:a.animation?.snapshot()??null,motion:structuredClone(a.motion),visible:game.field.isEntityVisible(a.id)})).sort((a,b)=>a.id.localeCompare(b.id));}
const cases=[],misc=corpus.assets.filter(a=>a.source.assetPath.endsWith('/serial_misc_assets.json'));assert.equal(misc.length,1);
async function run(mapId,lane,use){const source=sourceMaps.get(mapId),row={mapId,lane,group:use?.group??null,entityId:use?.entityId??null,sourceMapHash:source.contentHash,
 originalInitializer:source.initializer,sourceStoryReachability:false,runtimeAdmission:'unassessed',stage:'entry',result:'not-started',trace:[]};let game,flow,map,context,content,catalog=world;
 try{map=structuredClone(maps.get(mapId));if(!map.partyEntry?.pointIns.length)throw new Error('Original PointIn is unavailable; no invented replacement');
  if(lane==='controlled-original-group'){
   const name='__authored_initial_npc_pose_contract';assert.equal(map.scripts[name],undefined);const site={script:name,source:{file:'scripts/check-source-initial-npc-pose.mjs',assetPath:'authored-controlled-group-activation'}};
   map.scripts[name]=[...(use.group==='entity_default'?[]:[{kind:'entities',group:use.group}]),{kind:'exit'}].map((op,index)=>({...op,...site,index}));
   map.scriptLocals??={};map.scriptLocals[name]=null;map.scriptSystemFlags??={};map.scriptSystemFlags[name]={keepBadStatusVisual:false};
   map.scriptPuppetContexts??={};map.scriptPuppetContexts[name]=api.compileFieldPuppetScriptContext({SystemFlag:{SkipInitialize:1,KeepPlayerPuppet:0,KeepBadStatusVisual:0,RidingVehicle:0},Mnemonics:[{type:1,mnemonic:'Exit',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:Array(8).fill('')}}]},misc[0].data);
   map.scriptTransitionMetadata??={};map.scriptTransitionMetadata[name]={customAnimations:'none'};map.initializer=name;
   row.controlledDeclaration='Only the entry initializer is authored to activate the complete original nominated group; original initializer, Resident namespace, group membership, NPC rows, collision, media, foot and all original diagnostics remain unchanged.';
   map.contentHash=api.hash(Object.fromEntries(Object.entries(map).filter(([k])=>k!=='contentHash')));catalog=structuredClone(world);catalog.maps[String(mapId)].contentHash=map.contentHash;
   catalog.contentHash=api.hash(Object.fromEntries(Object.entries(catalog).filter(([k])=>k!=='contentHash')));
  }
  row.entrance=map.partyEntry.pointIns[0].id;row.candidateMapHash=map.contentHash;
  content=await api.compileFrameworkNewGame({sourceEntry,sourceBattle:battle,sourceMap:source,world:catalog,map,battle,entrance:row.entrance});context=runtime();
  game=await api.GameSession.prepareFrameworkNewGame(content,catalog,map,battle,context,314);row.actualSessionCreated=true;row.stage='initializer';
  for(const url of api.fieldMediaUrls(game.field.content))await image(url);flow=new api.GameFlow(game);flow.start();flow.advance(0,ready);
  const stores=new Map(),storage=new api.CheckpointStorage({getItem:key=>stores.get(key)??null,setItem:(key,value)=>stores.set(key,value)},'framework','whole-initial-npc-pose'),saver=new api.GameEventSaveCoordinator(flow,storage);
  let elapsed=0;
  for(let tick=0;tick<6000&&game.field.busy&&!game.field.stop;tick++){
   if(game.eventSaveRequest){const result=await saver.save(tick);row.trace.push({kind:'event-save',status:result.status});if(result.status!=='committed')throw new Error('Source event save '+result.status);}
   if(game.field.choice){row.boundary={kind:'unspecified-source-choice',choice:structuredClone(game.field.choice)};break;}
   if(game.field.dialogue&&(!game.field.dialogue.manual||game.field.time>=game.field.dialogue.manual.availableAt))flow.confirm();else if(game.field.sourceMessage.projection?.acceptsInput)flow.confirm();
   await fieldAudio(game);flow.advance(10,ready);elapsed+=10;
  }
  row.elapsedMs=elapsed;row.stop=structuredClone(game.field.stop);row.actors=actors(game);row.ownedHash=api.hash(game.state.snapshot());row.initializerComplete=!game.field.busy&&!game.field.stop;
  row.result=game.field.stop?'source-provider-boundary':row.initializerComplete?'initializer-completed':'source-clock-or-choice-boundary';
  if(use){const a=game.field.actors[use.entityId];row.nominatedActorPresent=!!a?.native&&sourceKey(a.native.scope.source)===sourceKey(use.source);if(row.nominatedActorPresent){row.actualInitialAnimation=a.animation?.snapshot()??null;row.exactNativeActorIdentity=a.native.scope;}}
  if(game.checkpointReady){row.stage='stable-save';const saved=game.checkpoint();await storage.save(saved,1730000000000);const loaded=await storage.load();assert.ok(loaded);
   const restored=api.GameSession.restore(loaded.checkpoint,undefined,battle,{catalog,map,initialized:{content,initialMap:map}},context);
   assert.deepEqual(actors(restored),actors(game));assert.deepEqual(restored.state.snapshot(),game.state.snapshot());assert.deepEqual(restored.field.eventState.snapshot(),game.field.eventState.snapshot());
   const next=new api.GameFlow(restored);next.start();next.advance(0,ready);await fieldAudio(restored);next.advance(10,ready);
   row.saveRestore={result:'passed',checkpointHash:api.hash(saved),storageWrites:stores.size,exactActorPlaybackRestored:true,postRestoreInputClock:true};
  }
 }catch(error){if(error.code==='ERR_ASSERTION')throw error;row.result='explicit-source-provider-error';row.error={message:error.message,stack:error.stack};if(game){row.actors=actors(game);row.stop=structuredClone(game.field.stop);}}
 cases.push(row);console.log(JSON.stringify({mapId,lane,group:row.group,entityId:row.entityId,result:row.result,actors:row.actors?.length??0,nominated:row.nominatedActorPresent??false,saved:!!row.saveRestore,error:row.error?.message??row.stop?.message??null}));return row;}
try{
 for(const id of affectedIds)await run(id,'original-source-map');
 for(const use of uses)await run(use.mapId,'controlled-original-group',use);
 assert.equal(cases.length,affectedIds.length+uses.length);
 assert.equal(await runtimeDigest(runtimeRoot,compiled),startRuntime);await shared.validate();assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);
 for(const[file,digest]of media)assert.equal(sha(await readFile(file)),digest,'Verified media changed');
 const count=lane=>{const rows=cases.filter(row=>row.lane===lane);return{attempts:rows.length,actualSessions:rows.filter(r=>r.actualSessionCreated).length,
  initializersCompleted:rows.filter(r=>r.initializerComplete).length,activeMapNpcInstances:rows.reduce((n,r)=>n+(r.actors?.length??0),0),
  nominatedActorInstances:lane==='controlled-original-group'?rows.filter(r=>r.nominatedActorPresent).length:null,savedAndRestored:rows.filter(r=>r.saveRestore).length,
  byResult:Object.fromEntries([...new Set(rows.map(r=>r.result))].map(result=>[result,rows.filter(r=>r.result===result).length]))};};
 const report={kind:'source-initial-npc-pose-lifecycle-check-v1',result:'complete-attempts-recorded',runtimeSha256:startRuntime,checkerSha256,sourceDigest,
  sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,sourceInput:{candidateDir,reportSha256:sha(shared.reportBytes),compilerDigest:shared.lock.compilerDigest,objects:shared.report.objects.length},
  counts:{sourceMaps:mapIds.length,characters:characters.length,sourceEntityUses:allUses.length,incompleteReferencedAssets:new Set(uses.map(u=>u.asset)).size,
   nominatedUses:uses.length,nominatedMaps:affectedIds.length,initialKeyPresent:uses.filter(u=>u.initialKeyPresent).length,initialKeyAbsent:uses.filter(u=>!u.initialKeyPresent).length,
   initialPoseChainQualified:uses.filter(u=>!u.poseDiagnostics.length).length,sourcePhysicalPrograms:allProgramIndex.length,affectedPhysicalPrograms:programs.size,
   original:count('original-source-map'),controlled:count('controlled-original-group')},cases,media:[...media].map(([file,sha256])=>({file,sha256})),artifacts:artifactRows,
  runtimeAdmission:'unassessed',sourceCampaignComplete:false,sourceStoryReachability:false,browserVerified:false,nativeParity:false,
  limits:['Every incomplete non-kind10 NPC source use and its original map initializer is retained; controller/geometry/source gaps are not filtered.',
   'The controlled lane changes only the entry initializer to request the complete original group. It does not execute the replaced original initializer or establish story reachability.',
   'Whole physical source bodies and the complete original dependency analysis are independent of actual execution counts.',
   'Images/FLAC bytes are checked; decode, browser and original runtime parity are unverified. No pose/media alias, story flag, roster, HP, location, motion or battle result is patched.']};
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.counts));
}catch(error){await writeFile(resolve(output,'failed.json'),JSON.stringify({kind:'source-initial-npc-pose-lifecycle-failure-v1',runtimeSha256:startRuntime,checkerSha256,cases,error:{message:error.message,stack:error.stack},runtimeAdmission:'unassessed',sourceCampaignComplete:false},null,2)+'\n');throw error;}
