import { sourceWebReplayRuntimePorts, sourceWebReplayFieldEffectsHost } from './source-web-replay-runtime.mjs';
// Attempts every original affected map's complete initializer through the
// existing initialized entry/Flow/Storage owners. Placement is an explicit
// Web entry, not an assertion of source-story reachability.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const options={root:resolve(import.meta.dirname,'..'),compiled:'dist',inventory:'build/reports/source-global-npc-area',
 report:'build/reports/source-global-npc-area-check.json'},args=process.argv.slice(2),seen=new Set();
while(args.length){const flag=args.shift();assert.ok(['--root','--compiled','--inventory','--report'].includes(flag)&&args.length&&!seen.has(flag),'Use --root/--compiled/--inventory/--report <path>');seen.add(flag);options[flag.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),view=resolve(import.meta.dirname,'..'),
 inventoryDir=resolve(root,options.inventory),out=resolve(root,options.report),part=relative(resolve(root,'build'),out),
 sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')));
assert.ok(part&&!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));await mkdir(dirname(out),{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/content','core/game-content','compiler/framework-new-game','core/game-session',
 'core/game-flow','core/game-commands','core/game-battle-handoff','core/saved-game','core/content-integrity','core/source-message-sequence',
 'core/field-condition-activity','core/source-encounter-entry','compiler/corpus','compiler/framework-npc-area',
 'core/field-camera-shake','core/field-assigned-route','core/field-logical-effects','core/world-transportation-entry'].map(load)));
const files=new Map(),media=new Map(),audio=new Map(),presented=new Set(),ready={visible:true,mediaReady:true,overlayOpen:false};
const read=async file=>{const path=resolve(root,file),bytes=await readFile(path);if(files.has(path))assert.equal(sha(bytes),files.get(path));else files.set(path,sha(bytes));return JSON.parse(bytes);};
const inventory=await api.verifyContent(await read(resolve(inventoryDir,'inventory.json')));
for(const row of inventory.runtime.files)assert.equal(sha(await readFile(resolve(compiled,row.path))),row.sha256,'Inventory compiler changed');
const artifact=async record=>{const path=resolve(inventoryDir,record.file),bytes=await readFile(path);assert.equal(sha(bytes),record.sha256);files.set(path,sha(bytes));return JSON.parse(bytes);};
const sourceWorld=await api.verifyContent(await artifact(inventory.artifacts.sourceWorld)),
 world=await api.verifyContent(await artifact(inventory.artifacts.frameworkWorld)),
 sourceEntry=await api.verifyContent(await artifact(inventory.artifacts.sourceEntry)),
 battle=await api.verifyContent(await read(inventory.battleInput.path)),
 sourceMap=(await read(resolve(inventoryDir,'maps/'+sourceEntry.entry.mapId+'.json'))).source,
 snapshot=await api.loadCorpus(root),sourceDigest=api.hash(snapshot);
assert.equal(sourceDigest,inventory.sourceDigest);assert.equal(sourceEntry.battleCatalogHash,battle.contentHash);
async function runtime(){const rows=[];async function walk(base,path){for(const item of(await readdir(resolve(base,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 const name=path+'/'+item.name;if(item.isDirectory())await walk(base,name);else if(item.isFile()&&/\.(?:js|mjs)$/.test(item.name))rows.push({base:base===compiled?'compiled':'view',path:name,sha256:sha(await readFile(resolve(base,name)))});}}
 await walk(compiled,'src');await walk(view,'scripts');await walk(view,'apps/game');return{hash:api.hash(rows),files:rows};}
const runtimeBefore=await runtime(),spriteBindings=new Map();
for(const character of Object.values(world.characters))for(const sprite of Object.values(character.sprites)){
 if(spriteBindings.has(sprite.file))assert.equal(spriteBindings.get(sprite.file),sprite.sha256);spriteBindings.set(sprite.file,sprite.sha256);}
async function image(url){assert.match(url,/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.png$/);
 const path=resolve(root,url.startsWith('/imports/')?'build/import/'+url.slice('/imports/'.length):'build'+url);
 if(!media.has(path)){const bytes=await readFile(path);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const hash=sha(bytes),expected=spriteBindings.get(url);if(expected)assert.equal(hash,expected);media.set(path,hash);}}
async function track(value){if(!value)return;assert.match(value.file,/^\/(bgm|se|environment)\/tracks\/[a-f0-9]{64}\.flac$/);
 const path=resolve(root,'build'+value.file);if(!media.has(path)){const bytes=await readFile(path);assert.equal(bytes.subarray(0,4).toString(),'fLaC');assert.equal(sha(bytes),value.sha256);media.set(path,value.sha256);}
 assert.equal(media.get(path),value.sha256);audio.set(api.hash(value),true);}
const runtimePorts=()=>({ ...sourceWebReplayRuntimePorts(),scriptRandom:'web-source-script-random-field-stream-v1',transportationTimestamp:()=>'639273600000000000',sourceEncounterPolicy:api.WEB_SOURCE_ENCOUNTER_POLICY,battleHandoff:'prepared',
 retainedWorldTransportation:api.WEB_RETAINED_WORLD_TRANSPORTATION,fieldEffects:sourceWebReplayFieldEffectsHost(api.createWebLogicalFieldEffectsHost),
 sourceMessageSequence:api.createWebFieldMessageSequencePort(),conditionLeaderActivity:api.createWebFlatConditionLeaderActivityPort(),
 cameraShake:api.createWebFieldCameraShakePolicy(),assignedNpcRoutes:api.WEB_ASSIGNED_ROUTE_POLICY,
 audioReadiness:{isReady:value=>audio.has(api.hash(value))},soundPresentation:{isPresented:(voice,value)=>audio.has(api.hash(value))&&presented.has(api.canonical({id:voice.id,track:voice.track,started:voice.started}))}});
async function fieldAudio(game){for(const value of game.field.pendingAudioTracks)await track(value);
 for(const voice of game.field.se.voices){const value=game.field.content.se?.tracks[voice.track];await track(value);presented.add(api.canonical({id:voice.id,track:voice.track,started:voice.started}));}}
const report={kind:'source-global-npc-area-lifecycle-check-v1',result:'running',runtime:runtimeBefore,
 inventoryHash:inventory.contentHash,sourceSetHash:inventory.sourceSetHash,parentSourceSetHash:inventory.parentSourceSetHash,
 completeScope:inventory.counts,attempts:[],policies:{npc:inventory.template,entry:'explicit-Web-original-PointIn',
 existingFrameworkPolicies:inventory.existingFrameworkPolicies,assignedNpcRoutes:api.WEB_ASSIGNED_ROUTE_POLICY,cameraShake:api.createWebFieldCameraShakePolicy(),
 audio:'verified-original-FLAC-controlled-presentation-ACK',images:'original-file-hash/signature; decoder and browser unverified'},
 sourceCampaignComplete:false,nativeParity:false,browserVerified:false,runtimeAdmission:'unassessed',
 limitations:['Every affected original map is attempted, including all eighteen unready Area objects. No source map initializer or resident program is removed.',
 'Each map uses an explicit framework entry at its first original PointIn and the unchanged actual source initializer; this does not demonstrate story reachability.',
 'The virtual clock budget is an observation boundary, never a skipped instruction or readiness grant.',
 'No flags, conditions, HP/skills/roster, actor pose, active groups or battle result is patched. Shared mechanism combination tests are an independent controlled lane.']};
await writeFile(out,JSON.stringify(report,null,2)+'\n');
for(const scope of inventory.affectedMaps){
 const row={mapId:scope.mapId,assessmentHash:scope.assessmentHash,counts:scope.counts,allDerivationDiagnostics:scope.diagnostics,
  result:'not-started',stage:'original-entry',elapsed:0,events:[],runtimeAdmission:'unassessed',storyReachability:'unverified'};
 let game,flow,content,map,context;
 try{
  const pair=await read(resolve(inventoryDir,'maps/'+scope.mapId+'.json'));map=await api.verifyContent(pair.framework);
  const original=await api.verifyContent(pair.source,sourceWorld.maps[String(scope.mapId)].contentHash),
   expected=api.assessFrameworkNpcAreaMap(snapshot,original,inventory.template);
  assert.equal(expected.contentHash,scope.assessmentHash);assert.equal(api.canonical(map.frameworkNpcActivity),api.canonical(expected.host));
  assert.equal(map.contentHash,world.maps[String(scope.mapId)].contentHash);row.sourceMapHash=original.contentHash;
  row.originalInitializer=original.initializer;row.originalMapBlockers=original.blockers;row.originalPointIns=original.partyEntry?.pointIns??null;
  const entrance=original.partyEntry?.pointIns[0]?.id;if(entrance===undefined)throw new Error('No original PointIn; no authored replacement');
  row.entrance=entrance;content=await api.compileFrameworkNewGame({sourceEntry,sourceBattle:battle,sourceMap,
   world,map,battle,entrance});context=runtimePorts();game=await api.GameSession.prepareFrameworkNewGame(content,world,map,battle,context,314);
  for(const url of api.fieldMediaUrls(game.field.content))await image(url);
  flow=new api.GameFlow(game);flow.start();flow.advance(0,ready);row.stage='original-initializer';
  async function tick(){await fieldAudio(game);flow.advance(10,ready);row.elapsed+=10;}
  for(let index=0;index<12000&&!game.field.stop&&!game.checkpointReady;index++){
   if(game.field.choice){row.boundary={kind:'original-choice',choice:structuredClone(game.field.choice)};break;}
   if(game.field.dialogue&&(!game.field.dialogue.manual||game.field.time>=game.field.dialogue.manual.availableAt))flow.confirm();
   else if(game.field.sourceMessage.projection?.acceptsInput)flow.confirm();
   await tick();
  }
  row.stop=structuredClone(game.field.stop);row.initialized=game.checkpointReady;
  if(game.field.stop){row.result='original-provider-blocked';row.stage='original-initializer';}
  else if(!game.checkpointReady){row.result='original-boundary';row.boundary??={kind:'initializer-clock-budget',milliseconds:row.elapsed};}
  else{
   row.stage='autonomous-source-map';row.result='initialized';
   const actors=Object.fromEntries(Object.entries(game.field.actors).filter(([,actor])=>actor.native?.scope?.kind==='map-npc').map(([id,actor])=>[id,actor])),
    before=Object.fromEntries(Object.entries(actors).map(([id,actor])=>[id,{steps:actor.steps,native:actor.native,entity:actor.native.entity}]));
   let saved=null;
   for(let frame=0;frame<500&&!game.field.stop&&!game.field.busy;frame++){
    await tick();
    for(const[id,actor]of Object.entries(actors)){assert.equal(game.field.actors[id],actor);assert.equal(actor.native,before[id].native);assert.equal(actor.native.entity,before[id].entity);}
    if(saved===null&&game.checkpointReady&&Object.keys(game.field.npcActivitySnapshot).length){
     const checkpoint=game.checkpoint(),bytes=new Map(),store=new api.CheckpointStorage({getItem:key=>bytes.get(key)??null,
      setItem:(key,value)=>bytes.set(key,value)},'framework','whole-source-area');await store.save(checkpoint,1730000000000);
     const loaded=await store.load();assert(loaded);const restored=api.GameSession.restore(loaded.checkpoint,undefined,battle,
      {catalog:world,map,initialized:{content,initialMap:map}},context),savedState=game.field.npcActivitySnapshot,restoredState=restored.field.npcActivitySnapshot;
     assert.deepEqual(Object.keys(restoredState),Object.keys(savedState));
     for(const id of Object.keys(savedState)){
      assert.deepEqual(restored.field.actors[id].motion,game.field.actors[id].motion);
      assert.deepEqual(restored.field.actors[id].native.entity.position,game.field.actors[id].native.entity.position);
      for(const key of ['rngState','rngDraws','waitMs','remainingSteps','direction','commandId'])assert.equal(restoredState[id][key],savedState[id][key]);
      assert(restoredState[id].generation>savedState[id].generation);
     }
     assert.deepEqual(restored.state.snapshot(),game.state.snapshot());const nextFlow=new api.GameFlow(restored);nextFlow.start();nextFlow.advance(0,ready);
     await fieldAudio(restored);nextFlow.advance(10,ready);saved={checkpointHash:api.hash(checkpoint),controllers:Object.keys(savedState).length,
      restoredMotionIds:Object.keys(savedState).filter(id=>game.field.actors[id].motion),postRestoreState:restored.field.npcActivitySnapshot,storageWrites:bytes.size};
    }
   }
   row.activeActivities=game.field.npcActivitySnapshot;row.moved=Object.keys(before).filter(id=>game.field.actors[id].steps>before[id].steps);
   row.sourceActors=Object.keys(before);row.save=saved;row.stop=structuredClone(game.field.stop);
  }
 }catch(error){if(error.code==='ERR_ASSERTION')throw error;row.result='explicit-provider-error';row.error={message:error.message,stack:error.stack};}
 row.nativeActorState=game?game.field.nativeActorStateFingerprint:null;row.owned=game?game.state.snapshot():null;
 report.attempts.push(row);console.log(JSON.stringify({mapId:row.mapId,result:row.result,stage:row.stage,
  activities:Object.keys(row.activeActivities??{}).length,moved:row.moved?.length??0,saved:!!row.save,error:row.error?.message??row.stop?.message??null}));
}
assert.equal(report.attempts.length,inventory.affectedMaps.length);
for(const[file,expected]of files)assert.equal(sha(await readFile(file)),expected,'Input changed '+file);
for(const[file,expected]of media)assert.equal(sha(await readFile(file)),expected,'Media changed '+file);
assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);assert.deepEqual(await runtime(),runtimeBefore);
report.result='complete-attempts-recorded';report.counts={attemptedMaps:report.attempts.length,
 initialized:report.attempts.filter(row=>row.initialized).length,activeControllers:report.attempts.reduce((n,row)=>n+Object.keys(row.activeActivities??{}).length,0),
 movedControllers:report.attempts.reduce((n,row)=>n+(row.moved?.length??0),0),savedAndRestored:report.attempts.filter(row=>row.save).length,
 byResult:Object.fromEntries([...new Set(report.attempts.map(row=>row.result))].map(result=>[result,report.attempts.filter(row=>row.result===result).length]))};
report.media=Object.fromEntries(media);report.inputFiles=Object.fromEntries(files);report.contentHash=api.hash(report);
await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,contentHash:report.contentHash}));
