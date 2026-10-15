import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';
// Whole installed source programs on original maps and an explicitly authored
// contact map. This uses the real Session/Flow/handoff/storage engine only.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
const options={root:resolve(import.meta.dirname,'..'),compiled:'dist',inventory:'build/reports/source-event-activation',report:'build/reports/source-event-activation-check.json'},args=process.argv.slice(2),seen=new Set();
while(args.length){const flag=args.shift();assert(['--root','--compiled','--inventory','--report'].includes(flag)&&args[0]&&!seen.has(flag));seen.add(flag);options[flag.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),view=resolve(import.meta.dirname,'..'),
 input=resolve(root,options.inventory),out=resolve(root,options.report),sha=b=>createHash('sha256').update(b).digest('hex'),
 load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')));
assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(dirname(out),{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/content','compiler/corpus','compiler/framework-new-game',
 'compiler/field-event-activation','core/content-integrity','core/game-content','core/game-session','core/game-flow',
 'core/game-commands','core/game-entry-loader','core/game-battle-handoff','core/saved-game','core/source-message-sequence',
 'core/field-condition-activity','core/source-encounter-entry','core/field-camera-shake','core/field-assigned-route','core/field-logical-effects','core/world-transportation-entry'].map(load)));
const files=new Map(),images=new Map(),audios=new Map(),audioReady=new Set(),read=async path=>{const p=resolve(root,path),b=await readFile(p);if(files.has(p))assert.equal(sha(b),files.get(p));else files.set(p,sha(b));return JSON.parse(b);},
 inventory=await api.verifyContent(await read(resolve(input,'inventory.json'))),
 artifact=async record=>{const p=resolve(input,record.file),b=await readFile(p);assert.equal(sha(b),record.sha256);files.set(p,sha(b));return JSON.parse(b);};
const prerequisites=await artifact(inventory.artifacts.sourcePrerequisites);
await validateSourcePrerequisiteInputs(prerequisites.inputs,{root});
for(const f of inventory.runtime.files)assert.equal(sha(await readFile(resolve(compiled,f.path))),f.sha256,'Inspector runtime changed');
const sourceWorld=await api.verifyContent(await artifact(inventory.artifacts.strictWorld)),
 frameworkWorld=await api.verifyContent(await artifact(inventory.artifacts.frameworkWorld)),
 sourceEntry=await api.verifyContent(await artifact(inventory.artifacts.sourceEntry)),
 sourceBattle=await api.verifyContent(await artifact(inventory.artifacts.sourceBattle)),
 directory=await api.verifyContent(await artifact(inventory.artifacts.battleDirectory)),
 systems=await artifact(inventory.artifacts.systems),cohort=await artifact(inventory.artifacts.roots),snapshot=await api.loadCorpus(root),
 sourceDigest=api.hash(snapshot),pairs=new Map();assert.equal(sourceDigest,inventory.sourceDigest);
assert.equal(api.canonical(sourceBattle.gameState),api.canonical(directory.gameState));assert.equal(api.canonical(systems.battle.gameState),api.canonical(sourceBattle.gameState));
const pair=async id=>{if(!pairs.has(id))pairs.set(id,await read(resolve(input,'maps/'+id+'.json')));return pairs.get(id);},
 sourceStart=(await pair(sourceEntry.entry.mapId)).source,ready={visible:true,mediaReady:true,overlayOpen:false};
const seal=v=>{const{contentHash:_,...body}=v;return{...body,contentHash:api.hash(body)};};
async function runtime(){const rows=[];async function walk(base,path){for(const e of(await readdir(resolve(base,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path+'/'+e.name;if(e.isDirectory())await walk(base,p);else if(e.isFile()&&/\.(?:mjs|js)$/.test(p))rows.push({base:base===compiled?'compiled':'view',path:p,sha256:sha(await readFile(resolve(base,p)))});}}await walk(compiled,'src');await walk(view,'scripts');await walk(view,'apps/game');return{hash:api.hash(rows),files:rows};}
const locked=await runtime(),spriteBindings=new Map();
for(const c of Object.values(sourceWorld.characters))for(const s of Object.values(c.sprites)){
 if(spriteBindings.has(s.file))assert.equal(spriteBindings.get(s.file),s.sha256);spriteBindings.set(s.file,s.sha256);}
async function image(url){assert.match(url,/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.png$/);
 const p=resolve(root,url.startsWith('/imports/')?'build/import/'+url.slice(9):'build'+url);if(images.has(p))return;
 const b=await readFile(p);assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const expected=spriteBindings.get(url);if(expected)assert.equal(sha(b),expected);images.set(p,sha(b));}
async function audio(t){if(!t)return;const p=resolve(root,'build'+t.file);assert.match(t.file,/^\/(bgm|se|environment)\/tracks\/[a-f0-9]{64}\.flac$/);
 if(!audios.has(p)){const b=await readFile(p);assert.equal(b.subarray(0,4).toString(),'fLaC');assert.equal(sha(b),t.sha256);audios.set(p,sha(b));}assert.equal(audios.get(p),t.sha256);audioReady.add(api.hash(t));}
const bindings=new Map();
async function bind(root,lane){const key=api.canonical([root.mapId,root.alias,lane]);if(bindings.has(key))return bindings.get(key);
 const sourceMap=(await pair(root.mapId)).source,original=(await pair(root.mapId)).framework,
  map=structuredClone(lane==='original-source-map'?original:systems.map),world=structuredClone(lane==='original-source-map'?frameworkWorld:systems.world),
  battle=structuredClone(directory),unavailable=[];
 if(!map.map)throw new Error('Source map geometry remains unavailable');
 if(lane==='controlled-contact'){
  const sourceGroups=new Set(root.programIds.flatMap(id=>{const found=snapshot.assets.find(a=>a.id===id);return found?.data.Mnemonics.filter(i=>i.mnemonic==='SetEntities').map(i=>i.operands.sValues[0])??[];}));
  if(sourceGroups.has('entity_default'))throw new Error('Authored default group cannot impersonate a source SetEntities dependency');
  // Preserve every installed source body and metadata. The controlled map
  // supplies no missing original entity group, flag or source-scene provider.
  for(const alias of Object.keys(root.namespace))if(root.namespace[alias]){
   if(!sourceMap.scripts[alias]){unavailable.push({alias,reason:'missing original installed program'});continue;}
   map.scripts[alias]=structuredClone(sourceMap.scripts[alias]);
   for(const k of ['scriptLocals','scriptPuppetContexts','scriptSystemFlags','scriptTransitionMetadata']){
    map[k]??={};if(Object.hasOwn(sourceMap[k]??{},alias))map[k][alias]=structuredClone(sourceMap[k][alias]);else delete map[k][alias];
   }
  }
  const point=map.partyEntry.pointIns[0],directions=[['right',1,0],['down',0,1],['left',-1,0],['up',0,-1]],
   selected=directions.find(([,dx,dy])=>map.map.collisions[point.layer]?.[(point.y+dy)*map.map.width+point.x+dx]===0&&point.x+dx>=0&&point.y+dy>=0&&point.x+dx<map.map.width&&point.y+dy<map.map.height);
  if(!selected)throw new Error('No declared neighboring control cell');
  const[direction,dx,dy]=selected,source={file:'scripts/check-source-event-activation.mjs',assetPath:'Authored/WholeSourceContact',pointer:'/root/'+root.mapId+'/'+root.alias},
   activation=api.compileFieldEventActivation('entity_default',root.uses[0].properties,root.alias,source),
   trigger={id:'controlled-source-event',kind:2,objectId:0,x:point.x+dx,y:point.y+dy,layer:point.layer,width:1,height:1,direction:'down',asset:null,
    script:root.alias,collision:null,destinationLayer:null,source,eventActivation:activation},
   points=map.map.groups.entity_default.entities.filter(e=>e.kind===0),entities=[...points,trigger];
  map.map.entities=structuredClone(entities);map.map.groups={entity_default:{name:'entity_default',source,entities,blockers:[]}};
  map.map.entryContext.groups={entity_default:{savePointCount:0,reason:null,source}};
  const qualification=systems.battle.common.battleEntry.maps.find(r=>r.id===map.mapId);assert(qualification);
  if(!battle.common.battleEntry.maps.some(r=>r.id===map.mapId))battle.common.battleEntry.maps.push(structuredClone(qualification));
  map.controlDirection=direction;
 }
 const direction=map.controlDirection;delete map.controlDirection;
 const sealedMap=seal(map),sealedBattle=seal(battle);world.maps[map.mapId].contentHash=sealedMap.contentHash;
 const sealedWorld=seal(world),entrance=sealedMap.partyEntry?.pointIns[0]?.id;
 const content=await api.compileFrameworkNewGame({sourceEntry,sourceBattle,sourceMap:sourceStart,world:sealedWorld,map:sealedMap,battle:sealedBattle,entrance}),
  value={sourceMap,map:sealedMap,world:sealedWorld,battle:sealedBattle,content,direction,unavailable};bindings.set(key,value);return value;
}
async function execute(root,lane,prefix){const row={mapId:root.mapId,alias:root.alias,lane,choicePrefix:prefix,elapsed:0,stage:'entry',
 choices:[],messages:[],battles:[],saves:[],commands:[],originalMapEntryRequested:lane==='original-source-map',sourceMapInitializerStarted:false,sourceMapInitializerCompleted:false,
 invocation:lane==='original-source-map'?'public-whole-body-observer-not-contact':'actual-authored-contact-with-original-program',runtimeAdmission:'unassessed',storyReachability:'unverified'};
 let bound,game,flow,commands,handoff;const presented=new Set();
 try{bound=await bind(root,lane);const runtime={ ...sourceWebReplayRuntimePorts(),scriptRandom:'web-source-script-random-field-stream-v1',transportationTimestamp:()=>'639273600000000000',battleHandoff:'prepared',sourceEncounterPolicy:api.WEB_SOURCE_ENCOUNTER_POLICY,
  sourceMessageSequence:api.createWebFieldMessageSequencePort(),conditionLeaderActivity:api.createWebFlatConditionLeaderActivityPort(),
  cameraShake:api.createWebFieldCameraShakePolicy(),assignedNpcRoutes:api.WEB_ASSIGNED_ROUTE_POLICY,
  fieldEffects:api.createWebLogicalFieldEffectsHost(),retainedWorldTransportation:api.WEB_RETAINED_WORLD_TRANSPORTATION,
  audioReadiness:{isReady:t=>audioReady.has(api.hash(t))},soundPresentation:{isPresented:(v,t)=>audioReady.has(api.hash(t))&&presented.has(api.canonical({id:v.id,track:v.track,started:v.started}))}};
  row.stage='prepare-session';game=await api.GameSession.prepareFrameworkNewGame(bound.content,bound.world,bound.map,bound.battle,runtime,314);
  row.sourceMapInitializerStarted=lane==='original-source-map';
  for(const url of api.fieldMediaUrls(game.field.content))await image(url);
  flow=new api.GameFlow(game);flow.start();flow.advance(0,ready);commands=new api.GameCommands(flow,game);
  handoff=new api.GameBattleHandoff(flow,{prepareStart:async c=>{for(const url of c.mediaUrls)await image(url);return{};},prepareReturn:async()=>({}),discard(){}});
  async function tick(){for(const t of game.field.pendingAudioTracks)await audio(t);for(const v of game.field.se.voices){const t=game.field.content.se?.tracks[v.track];await audio(t);presented.add(api.canonical({id:v.id,track:v.track,started:v.started}));}flow.advance(10,ready);row.elapsed+=10;}
  async function input(){if(game.field.choice){if(row.choices.length>=prefix.length){row.boundary={kind:'choice',options:game.field.choice.options.length};return false;}
    const request=structuredClone(game.field.choice),answer=prefix[row.choices.length];assert.equal(flow.choose(request.id,answer),true);row.choices.push({request,answer});}
   else if(game.field.dialogue&&(!game.field.dialogue.manual||game.field.time>=game.field.dialogue.manual.availableAt)){row.messages.push(game.field.dialogue.key);flow.confirm();}
   else if(game.field.sourceMessage.projection?.acceptsInput)flow.confirm();await tick();return true;}
  row.stage='original-initializer';while(row.elapsed<120000&&!game.field.stop&&!game.checkpointReady){if(game.eventSaveRequest){row.boundary={kind:'initializer-save-request'};break;}if(!await input())break;}
  if(game.field.stop||!game.checkpointReady){row.boundary??={kind:'source-initializer',stop:structuredClone(game.field.stop)};}
  else{row.sourceMapInitializerCompleted=lane==='original-source-map';row.stage='whole-original-program';row.ownedBeforeProgram=game.state.snapshot();
   if(lane==='controlled-contact'){assert.deepEqual(flow.directionInput(bound.direction),{kind:'movement'});while(game.field.player.motion&&!game.field.stop)await tick();}
   else assert.equal(game.field.startEvent(root.alias),true);
   row.invocationState=game.field.sourceEventActivation;
   while(!row.boundary&&row.elapsed<420000){
    if(game.battle){const battle=game.battle;
     if(battle.phase==='defeat'){const before=api.hash(game.state.snapshot()),request=api.canonical(game.field.stop),retry=await handoff.retry();row.battles.push({kind:'defeat-retry',status:retry.status,partyId:battle.content.encounterId});assert.equal(api.hash(game.state.snapshot()),before);assert.equal(api.canonical(game.field.stop),request);row.boundary={kind:'natural-defeat'};break;}
     if(['victory','escaped'].includes(battle.phase)){const r=await handoff.return();row.battles.push({kind:'return',phase:battle.phase,status:r.status,partyId:battle.content.encounterId});if(r.status!=='committed'){row.boundary={kind:'return-provider',error:r.error?.message??null};break;}continue;}
     for(const actor of battle.ready){const cmd=battle.commandMenu(actor.id).find(c=>c.kind==='ability'&&c.available&&c.abilityIds.includes(1)),
      target=cmd&&battle.targetChoices(actor.id,1).find(t=>t.selection.kind==='single'&&battle.enemies.some(e=>e.hp>0&&e.id===t.selection.id));
      if(target&&commands.command(battle,actor.id,1,target.selection,cmd.id))row.commands.push({actorId:actor.id,commandId:cmd.id,abilityId:1,target:target.selection});}
     await tick();continue;
    }
    if(game.field.stop?.kind==='encounter'){const r=await handoff.start();row.battles.push({kind:'start',status:r.status,request:structuredClone(game.field.stop),error:r.error?.message??null});if(r.status!=='committed'){row.boundary={kind:'battle-entry',error:r.error?.message??null};break;}continue;}
    if(game.field.stop){row.boundary={kind:game.field.stop.kind,stop:structuredClone(game.field.stop)};break;}
    if(game.eventSaveRequest||game.checkpointReady){
     const pending=game.eventSaveRequest?game.prepareEventSave(game.eventSaveRequest):null,
      checkpoint=pending?.checkpoint??game.checkpoint(),data=new Map(),storage=new api.CheckpointStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},'framework','source-event-activation');
     await storage.save(checkpoint,1000);const loaded=(await storage.load()).checkpoint,
      restored=api.GameSession.restore(loaded,undefined,bound.battle,{catalog:bound.world,map:bound.map,initialized:{content:bound.content,initialMap:bound.map}},runtime);
     assert.deepEqual(restored.state.snapshot(),game.state.snapshot());
     assert.deepEqual(restored.field.player.native.entity.position,game.field.player.native.entity.position);
     row.saves.push({kind:pending?'event':'stable',checkpointHash:api.hash(checkpoint),execution:'execution'in checkpoint.world.field?checkpoint.world.field.execution:null});
     if(pending)pending.commitWith(()=>{});
     const loader=new api.GameEntryLoader(flow,{discard(){}});assert.equal((await loader.begin('load').prepare(async()=>({session:restored,presentation:null}))).status,'committed');
     game=restored;commands=new api.GameCommands(flow,game);flow.observeHost(ready);await tick();
     if(!pending){row.finished=true;break;}
     if(row.saves.length>=16){row.boundary={kind:'explicit-save-budget'};break;}continue;
    }
    if(!await input())break;
   }
   if(!row.boundary&&!row.finished)row.boundary={kind:'clock-budget',milliseconds:row.elapsed};
  }
 }catch(e){if(e.code==='ERR_ASSERTION')throw e;row.error={message:e.message,stack:e.stack};}
 row.result=row.error?'explicit-provider-error':row.finished?'finished-and-restored':row.boundary?.kind==='unsupported'?'blocked':'boundary';
 row.stop=game?.field.stop??null;row.owned=game?.state.snapshot()??null;row.actualMapId=bound?.map.mapId??null;return row;
}
const report={kind:'source-event-activation-complete-lifecycle-v1',result:'running',runtime:locked,inventoryHash:inventory.contentHash,
 completeScope:inventory.counts,roots:cohort.map(r=>({...r,runs:[]})),sourceCampaignComplete:false,nativeParity:false,browserVerified:false,
 runtimeAdmission:'unassessed',limitations:['Every logical Gimmick source root receives an original-map entry request. Geometry/provider failures may block before the original initializer starts; started/completed are recorded separately.',
  'Original-map whole-body entry uses the existing public startEvent observer and does not claim source contact or Gimmick invocation identity.',
  'The controlled lane uses a separate authored contact trigger with unmodified complete source programs and source-owned DataInitialize. Missing source groups/providers remain blocked.',
  'Both lanes preserve every source instruction/branch. Choices are explicit public input prefixes, never source flags or invented battle outcomes.',
  'Verified original PNG/FLAC bytes feed controlled presentation ACK; browser/native timing and story reachability remain unverified.']};
await writeFile(out,JSON.stringify(report,null,2)+'\n');
try{for(const root of report.roots)for(const lane of ['original-source-map','controlled-contact']){
 const prefixes=[[]];for(let index=0;index<prefixes.length&&index<8;index++){
  const row=await execute(root,lane,prefixes[index]);root.runs.push(row);
  if(row.boundary?.kind==='choice'&&prefixes[index].length<4)for(let answer=0;answer<row.boundary.options;answer++)prefixes.push([...prefixes[index],answer]);
  console.log(JSON.stringify({mapId:root.mapId,alias:root.alias,lane,result:row.result,stage:row.stage,error:row.error?.message??row.boundary?.stop?.message??row.boundary?.kind??null,saves:row.saves.length}));
 }
 // Prepared immutable content is only reused by choice-prefix retries of this
 // source root. Do not retain a cloned whole battle directory per old run.
 bindings.clear();
 }
 for(const[p,h]of files)assert.equal(sha(await readFile(p)),h,'Artifact input drift');for(const[p,h]of [...images,...audios])assert.equal(sha(await readFile(p)),h,'Media input drift');
 assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);assert.deepEqual(await runtime(),locked);
 await validateSourcePrerequisiteInputs(prerequisites.inputs,{root});
 const runs=report.roots.flatMap(r=>r.runs);report.counts={roots:report.roots.length,runs:runs.length,
  byLane:Object.fromEntries(['original-source-map','controlled-contact'].map(l=>[l,Object.fromEntries([...new Set(runs.filter(r=>r.lane===l).map(r=>r.result))].map(s=>[s,runs.filter(r=>r.lane===l&&r.result===s).length]))])),
  battleStarts:runs.flatMap(r=>r.battles).filter(b=>b.kind==='start'&&b.status==='committed').length,
  settlements:runs.reduce((n,r)=>n+(r.owned?.completedBattles?.length??0),0),storageRestores:runs.reduce((n,r)=>n+r.saves.length,0)};
 report.result='complete-attempts-recorded';
}catch(e){report.result='failed';report.error={message:e.message,stack:e.stack};process.exitCode=1;}
report.inputs=Object.fromEntries(files);report.images=Object.fromEntries(images);report.audio=Object.fromEntries(audios);
report.contentHash=api.hash(report);await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,error:report.error??null,contentHash:report.contentHash}));
