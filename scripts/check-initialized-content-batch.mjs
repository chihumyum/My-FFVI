import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';
// Original source maps/events on an explicitly relocated initialized framework
// entry. Gameplay uses the app owners; media completion is a headless adapter.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import {controlledAudioRuntime} from './controlled-audio.mjs';
import {runContentBatchRoute} from './content-batch-route.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
let compiled='dist',directory='build/content-packages',reportPath='build/reports/initialized-content-batch-check.json';
for(let i=0;i<args.length;i++){
 assert.ok(['--compiled-dir','--content-dir','--report'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'));
 const name=args[i],value=args[++i];if(name==='--compiled-dir')compiled=value;else if(name==='--content-dir')directory=value;else reportPath=value;
}
const load=name=>import(pathToFileURL(resolve(root,compiled,'src/core',name+'.js')));
const initialRuntimeHash=await runtimeDigest(root,compiled);
const [{GameContentRepository,assertGameWorldMapIdentity},{GameSession},{GameFlow},{GameEntryLoader},{GameMapLoader},{GameCommands},
 {CheckpointStorage},{contentDigest,verifyContent},{canonical}]=await Promise.all(['game-content','game-session','game-flow','game-entry-loader',
 'game-map-loader','game-commands','saved-game','content-integrity','canonical'].map(load));
const output=resolve(root,reportPath),base=resolve(root,directory),tests=[];
const report={kind:'initialized-content-batch-check-v1',result:'running',runtimeSha256:initialRuntimeHash,tests,evidence:{lane:'framework-initialized-source-content',
 sourceCampaignComplete:false,sourceStoryReachability:false,browserVerified:false,originalGameExecuted:false,semanticsVerified:false,
 initialization:'actual source NewGamePlan; authored PointIn relocation; original events and groups retained',
 media:'headless immediately ready; no image decoding, audio output or original-game oracle'}};
const host={visible:true,mediaReady:true,overlayOpen:false},runtime={ ...sourceWebReplayRuntimePorts(),...controlledAudioRuntime(),battleHandoff:'prepared',transportationTimestamp:()=> '639273600000000000'};
const passed=name=>tests.push({name,passed:true}),readJSON=file=>readFile(file,'utf8').then(JSON.parse);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
await mkdir(resolve(output,'..'),{recursive:true});
try{
 const refs=await readJSON(resolve(base,'figaro-initialized.json')),urls=[];
 const read=async url=>{
  assert.match(url,/^\/content-packages\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/);
  const file=resolve(base,url.slice('/content-packages/'.length)),child=relative(base,file);
  assert.ok(child&&child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child));urls.push(url);return readJSON(file);
 };
 const repository=new GameContentRepository(read,'framework',refs),bundle=await repository.initializedNewGame();
 assert.equal(repository.hasInitializedEntry,true);assert.equal(repository.hasSourceEntry,false);assert.equal(repository.hasDevelopmentEntry,false);
 assert.ok(bundle.catalog.maps['22']&&bundle.catalog.maps['23']);
 const maps=await Promise.all([22,23].map(id=>repository.map(id,bundle.catalog)));
 // Compare against this package's pinned source compilation. The independent
 // legacy /build/world output may belong to an older compiler generation.
 const buildReport=await read('/content-packages/figaro-initialized/build-report.json');
 const expectedSourceWorld=bundle.catalog.developmentProfile.sourceContentHash;
 assert.equal(buildReport.sourceInputs.world.contentHash,expectedSourceWorld);
 let sourceRepository,sourceWorld,sourceRefs;
 try{
  sourceRefs=await readJSON(resolve(base,'source.json'));
 }catch(error){if(error.code!=='ENOENT')throw error;}
 if(sourceRefs){
  assert.equal(sourceRefs.world.contentHash,expectedSourceWorld,'Source package generation mismatch');
  sourceRepository=new GameContentRepository(read,'source',sourceRefs);
  sourceWorld=await sourceRepository.world();
 }else{
  // Private standalone batches declare their exact external source pins.
  // An unavailable/wrong body fails verification rather than choosing a newer one.
  const ref=buildReport.sourceInputs.world;
  assert.equal(ref.url,'/world/catalog.json');
  sourceWorld=await verifyContent(await readJSON(resolve(root,'build/world/catalog.json')),expectedSourceWorld);
 }
 const retained=['scripts','scriptLocals','scriptPuppetContexts','scriptSystemFlags','scriptTransitionMetadata','initializer','nativeFoot'];
 for(const map of maps){
  const index=sourceWorld.maps[String(map.mapId)];assert.ok(index);
  if(!sourceRepository)assert.equal(index.url,'/world/maps/'+map.mapId+'.json');
  const source=sourceRepository?await sourceRepository.map(map.mapId,sourceWorld):
   await verifyContent(await readJSON(resolve(root,'build/world/maps',map.mapId+'.json')),index.contentHash);
  assertGameWorldMapIdentity(map.mapId,sourceWorld,source);
  assert.equal(index.contentHash,buildReport.sourceInputs.maps.find(row=>row.mapId===map.mapId)?.contentHash);
  for(const key of retained)assert.equal(canonical(map[key]),canonical(source[key]),'Original source content changed: '+key);
  for(const key of ['groups','entities','collisions','entryContext','layers','textures','tilesets','source'])
   assert.equal(canonical(map.map[key]),canonical(source.map[key]),'Original source map changed: '+key);
 }
 report.content={refs,entryHash:bundle.content.contentHash,initializerHash:bundle.content.initializerHash,
  mapHashes:Object.fromEntries(maps.map(map=>[map.mapId,map.contentHash]))};
 passed('trusted-initialized-package-preserves-complete-source-scripts-groups-exits-and-collision');
 const flow=new GameFlow(),discarded=[],entries=new GameEntryLoader(flow,{discard:view=>discarded.push(view)});
 const started=await entries.begin('new-game').prepare(async()=>({session:await GameSession.prepareFrameworkNewGame(
  bundle.content,bundle.catalog,bundle.map,bundle.battle,runtime,314),presentation:null}));
 assert.equal(started.status,'committed',String(started.error?.stack??started.error));
 let game=started.session,commands=new GameCommands(flow,game);
 const advance=()=>{flow.advance(10,host);};
 const settle=()=>{for(let i=0;i<500&&!game.checkpointReady&&!game.field.stop&&!game.field.dialogue;i++)advance();
  assert.notEqual(game.field.stop?.kind,'unsupported',JSON.stringify(game.field.stop));};
 flow.advance(0,host);settle();
 assert.equal(game.field.content.map.identity.mapId,22);assert.equal(game.checkpointReady,true);
 assert.equal(game.state.initialization,'source-new-game');assert.ok(game.state.nativeState);
 assert.equal(game.field.eventState.read({category:'ScenarioFlag1',index:138}),0);
 assert.equal(game.field.eventState.read({category:'ScenarioFlag1',index:142}),0);
 const initialOwned=await contentDigest(game.state.snapshot());
 passed('real-new-game-initialization-provides-source-event-domain-without-legacy-seed-patch');
 const steps=[];
 const step=direction=>{const before={x:game.field.player.x,y:game.field.player.y,layer:game.field.player.layer};
  assert.equal(flow.move(direction),true,'Declared source movement rejected: '+direction);settle();
  steps.push({direction,before,after:{x:game.field.player.x,y:game.field.player.y,layer:game.field.player.layer}});};
 for(const direction of ['up','up','left','left','left'])step(direction);
 assert.equal(game.field.stop?.kind,'map-transition');assert.equal(game.field.stop.request.mapId,23);
 const from=game.field,request=from.stop,world=game.world,owner=game.state,before=await contentDigest(owner.snapshot());
 const pending=deferred(),entered=deferred(),media={kind:'controlled-map-presentation'},mapDiscard=[];
 const cancelled=new GameMapLoader(flow,repository,{prepare:async()=>{entered.resolve();return pending.promise;},discard:view=>mapDiscard.push(view)});
 const loading=cancelled.load();await entered.promise;
 assert.equal(commands.menuReady,false);cancelled.cancel();pending.resolve(media);
 assert.equal((await loading).status,'cancelled');assert.deepEqual(mapDiscard,[media]);
 assert.equal(game.field,from);assert.equal(game.field.stop,request);assert.equal(game.world,world);
 assert.equal(await contentDigest(owner.snapshot()),before);
 const failed=new GameMapLoader(flow,repository,{prepare:async()=>{throw new Error('Controlled media preparation failure');},discard:()=>{}});
 const refused=await failed.load();assert.equal(refused.status,'failed');assert.match(String(refused.error),/Controlled media preparation failure/);
 assert.equal(game.field,from);assert.equal(game.field.stop,request);assert.equal(await contentDigest(owner.snapshot()),before);
 const loader=new GameMapLoader(flow,repository,{prepare:async()=>null,discard:()=>{}});
 assert.equal((await loader.load()).status,'committed');flow.advance(0,host);settle();
 assert.equal(game.field.content.map.identity.mapId,23);assert.equal(game.state,owner);assert.equal(game.world,world);
 passed('source-exit-cancellation-and-media-failure-retain-owner-request-then-retry-once');
 for(const direction of ['left','left','left','down','left','up'])step(direction);
 assert.deepEqual({x:game.field.player.x,y:game.field.player.y,layer:game.field.player.layer,direction:game.field.player.direction},
  {x:9,y:34,layer:2,direction:'up'});
 const npc=maps.find(map=>map.mapId===23).map.groups.entity_default.entities.find(entity=>entity.id==='1');
 assert.equal(npc.npc.interaction.script,'sc_e_0278');assert.equal(npc.npc.moveType,0);
 const hook=registerHooks({resolve(specifier,context,next){return next(specifier.startsWith('/runtime/')?pathToFileURL(resolve(root,compiled,'src',specifier.slice(9))).href:specifier,context);}});
 let Renderer;try{({Renderer}=await import('../apps/game/renderer.js'));}finally{hook.deregister();}
 const drawCalls=[];
 class Canvas{constructor(width=0,height=0){this.width=width;this.height=height;this.ownerDocument={createElement:()=>new Canvas()};}
  getContext(){return this.context??=new Context(this);}}
 class Context{constructor(canvas){this.canvas=canvas;this.stack=[];this.globalAlpha=1;}
  save(){this.stack.push(this.globalAlpha);}restore(){assert.ok(this.stack.length);this.globalAlpha=this.stack.pop();}
  transform(...values){assert.ok(values.every(Number.isFinite));}translate(...values){this.transform(...values);}scale(...values){this.transform(...values);}
  drawImage(image,...values){assert.ok(image&&image.width>0&&image.height>0);assert.ok(values.every(Number.isFinite));drawCalls.push({file:image.file,args:values});}
  createImageData(width,height){return{width,height,data:new Uint8ClampedArray(width*height*4)};}
  getImageData(x,y,width=this.canvas.width,height=this.canvas.height){return this.createImageData(width,height);}
  putImageData(image){assert.equal(image.data.length,image.width*image.height*4);}
  fillRect(){}clearRect(){}strokeRect(){}fillText(){}beginPath(){}moveTo(){}lineTo(){}stroke(){}setLineDash(){}}
 const images=new Map(),fieldContent=game.field.content;
 for(const set of fieldContent.map.tilesets){const file=fieldContent.map.textures[set.image];assert.ok(file);
  images.set(file,{file,width:set.imagewidth,height:set.imageheight});}
 for(const character of Object.values(fieldContent.characters))for(const sprite of Object.values(character.sprites))
  images.set(sprite.file,{file:sprite.file,width:sprite.width,height:sprite.height});
 for(const background of fieldContent.map.nativeComposition?.view?.backgrounds??[])
  images.set(background.file,{file:background.file,width:background.width,height:background.height});
 const actor=game.field.actors[npc.id],frame=actor.animation.frame(),sprite=fieldContent.characters[actor.asset].sprites[frame.sprite];
 assert.ok(actor.native);assert.ok(game.field.isEntityVisible(actor.id));
 const canvas=new Canvas(fieldContent.map.nativeComposition?.renderHost?.width??320,fieldContent.map.nativeComposition?.renderHost?.height??180),renderer=new Renderer(canvas,fieldContent,images);
 const fieldBefore=await contentDigest(game.field.checkpoint());renderer.draw(game.field);
 assert.ok(drawCalls.some(call=>call.file===sprite.file),'Actual Renderer must draw the visible source NPC frame');
 assert.equal(await contentDigest(game.field.checkpoint()),fieldBefore);
 report.renderer={actualRenderer:true,npcFrameFile:sprite.file,npcDrawCalls:drawCalls.filter(call=>call.file===sprite.file).length,
  controlledCanvas:true,imagePixelsDecoded:false,omissions:renderer.presentationOmissions};
 passed('real-renderer-draws-current-native-source-npc-with-explicit-flat-material-policy');
 assert.equal(flow.confirm(),true);settle();assert.ok(game.field.dialogue,'Original NPC must publish its source dialogue');
 const message=maps.find(map=>map.mapId===23).scripts.sc_e_0278[16];
 assert.equal(message.kind,'message');assert.equal(game.field.dialogue.key,message.key);
 assert.equal(game.field.dialogue.text,message.text);assert.equal(game.field.dialogue.speaker,message.speaker);
 report.npc={entityId:npc.id,source:npc.source,script:message.script,index:message.index,key:message.key,
  messageHash:await contentDigest({key:message.key,text:message.text,speaker:message.speaker}),sourceMessage:message.source};
 for(let i=0;i<200&&game.field.dialogue;i++){advance();assert.equal(flow.confirm(),true);}
 settle();assert.equal(game.checkpointReady,true);assert.equal(game.field.stop,null);
 assert.equal(await contentDigest(game.state.snapshot()),initialOwned);
 passed('natural-source-npc-interaction-uses-initialized-flag-branch-and-original-message-exit');
 assert.equal(flow.pause(true),true);flow.observeHost(host);
 assert.equal(commands.menu({kind:'set-preferences',preferences:{mode:'wait',speedIndex:3}}),true);
 const saved=game.checkpoint();assert.equal(saved.formatVersion,6);assert.equal(saved.origin.kind,'framework-new-game');
 const bytes=new Map(),storage=new CheckpointStorage({getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value)},'framework','figaro-initialized');
 const saveTicket=flow.beginOperation('save');(await storage.prepareSave(saved,game.field.time)).commit();assert.equal(saveTicket.finish(),true);
 const checkpointHash=await contentDigest(saved),old=game,oldCommands=commands;
 const restore=async()=>{const stored=await storage.load(),packages=await repository.restoreSessionContent(stored.checkpoint);
  return{session:GameSession.restore(stored.checkpoint,packages.initial,packages.battle,packages.world,runtime),presentation:null,options:{paused:true}};};
 const loadFailure=await entries.begin('load').prepare(async()=>{throw new Error('Controlled restore read failure');});
 assert.equal(loadFailure.status,'failed');assert.equal(flow.session,old);assert.equal(await contentDigest(old.checkpoint()),checkpointHash);
 const late=deferred(),prepared=deferred(),attempt=entries.begin('load');
 const obsolete=attempt.prepare(async()=>{const candidate=await restore();prepared.resolve();await late.promise;return candidate;});
 await prepared.promise;attempt.cancel();late.resolve();assert.equal((await obsolete).status,'cancelled');
 assert.equal(flow.session,old);assert.equal(await contentDigest(old.checkpoint()),checkpointHash);
 const loaded=await entries.begin('load').prepare(restore);
 assert.equal(loaded.status,'committed',String(loaded.error?.stack??loaded.error));game=loaded.session;
 assert.notEqual(game,old);assert.equal(await contentDigest(game.checkpoint()),checkpointHash);
 assert.equal(oldCommands.menu({kind:'set-preferences',preferences:{mode:'active',speedIndex:0}}),false);
 commands=new GameCommands(flow,game);flow.observeHost(host);assert.equal(commands.menuReady,true);
 assert.equal(commands.menu({kind:'set-preferences',preferences:{mode:'active',speedIndex:2}}),true);
 flow.pause(false);flow.observeHost(host);
 passed('source-content-v6-restore-failure-cancellation-and-success-preserve-progress-and-reject-old-channel');
 for(const direction of ['right','right','right','right','up'])step(direction);
 assert.equal(game.field.stop?.kind,'map-transition');assert.equal(game.field.stop.request.mapId,22);
 assert.equal((await loader.load()).status,'committed');flow.advance(0,host);settle();
 assert.equal(game.field.content.map.identity.mapId,22);assert.equal(game.checkpointReady,true);
 for(const direction of ['left'])step(direction);
 assert.equal(game.field.stop?.kind,'map-transition');assert.equal(game.field.stop.request.mapId,23);
 assert.equal((await loader.load()).status,'committed');flow.advance(0,host);settle();
 assert.equal(game.field.content.map.identity.mapId,23);assert.equal(game.checkpointReady,true);
 report.steps=steps;report.restoredCheckpointHash=checkpointHash;
 passed('restored-owner-continues-source-return-and-next-original-exit');
 const {ContentBatchManifest,planContentBatch}=await import(pathToFileURL(resolve(root,compiled,'src/compiler/content-batch.js')));
 const manifest=ContentBatchManifest.parse(await readJSON(resolve(base,'figaro-initialized/manifest.json')));
 const plan=planContentBatch(manifest,{entry:bundle.content,catalog:bundle.catalog,battle:bundle.battle,maps}),batchRepository=repository,runtimeHash=await runtimeDigest(root,compiled);
 assert.equal(plan.dependencies.referenceClosure,'incomplete');
 assert.ok(plan.diagnostics.some(row=>row.code==='map-outside-batch'));
 // The shared member-count query has closed the selected batch's last
 // undecoded instruction. Full outside-map and presentation closure stays gated.
 assert.equal(plan.diagnostics.filter(row=>row.code==='instruction-blocked').length,0);
 assert.ok(plan.diagnostics.some(row=>row.code==='map-provider-blocked'));
 const routeId=plan.manifest.routes[0].id,run=await runContentBatchRoute({root,compiled,plan,routeId,repository:batchRepository,runtimeHash});
 assert.equal(run.receipt.result,'completed',JSON.stringify(run.receipt));assert.equal(run.receipt.lane,'framework-initialized');
 assert.deepEqual(run.receipt.visitedMapIds,[22,23]);assert.equal(run.receipt.finalMapId,22);
 assert.deepEqual(run.receipt.completedEncounterIds,[]);assert.ok(run.receipt.program.restoreCount>=2);
 assert.ok(run.receipt.program.postRestoreInputCount>0);assert.equal(run.receipt.boundary,null);
 assert.equal(await runtimeDigest(root,compiled),runtimeHash);
 report.plan={manifestHash:plan.manifestHash,dependencyHash:plan.dependencyHash,referenceClosure:plan.dependencies.referenceClosure,
  diagnostics:plan.diagnostics,encounters:plan.encounters};report.batchRun=run;
 passed('same-bound-batch-runner-completes-declared-program-with-whole-source-closure-still-blocked');
 assert.equal(await runtimeDigest(root,compiled),initialRuntimeHash,'Runtime changed during source-content validation');
 report.result='passed';
}catch(error){report.result='failed';report.error=String(error.stack??error);throw error;}
finally{await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,tests:tests.length,report:output}));}
