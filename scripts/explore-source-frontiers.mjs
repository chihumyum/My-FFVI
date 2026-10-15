import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),options={compiled:'dist',content:resolve(root,'build/content-packages'),
 'source-root':root,'release-root':undefined,'publication-report':resolve(root,'build/reports/versioned-content-package-build.json'),
 output:resolve(root,'build/reports/source-reachable-frontiers'),'max-runs':'48','max-ticks':'24000','max-depth':'96','allow-compatibility':false},args=process.argv.slice(2),seen=new Set();
while(args.length){const arg=args.shift();assert.ok(arg?.startsWith('--')&&!seen.has(arg),'Duplicate/invalid argument');seen.add(arg);
 const key=arg.slice(2);if(key==='allow-compatibility'){options[key]=true;continue;}
 assert.ok(['compiled','content','source-root','release-root','publication-report','output','max-runs','max-ticks','max-depth','resume'].includes(key)&&args[0],'Unknown/missing argument '+arg);options[key]=args.shift();}
const compiled=resolve(root,options.compiled),content=resolve(root,options.content),sourceRoot=resolve(root,options['source-root']),output=resolve(root,options.output),sha=b=>createHash('sha256').update(b).digest('hex');
assert.ok(output.startsWith(resolve(root,'build')+'/'),'Explorer evidence must stay in ignored build');await mkdir(resolve(output,'inputs'),{recursive:true});
const load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')));
const [{exploreReachableFrontiers},{GameSession},{GameFlow},{GameContentRepository},{NewGameFieldEntry},{FieldFadeState},
 {createSourcePresentationContext},{createWebFieldMessageSequencePort},{createWebFlatConditionLeaderActivityPort},
 {createWebLogicalFieldEffectsHost},{createWebFieldCameraShakePolicy},{WEB_SOURCE_ENCOUNTER_POLICY},{loadCorpus},{hash},{readSnapshot},{bindPublishedFrontierRelease},{resolveGameContentReleaseObject},{verifyContent}]=await Promise.all([
 'tools/reachable-frontiers','core/game-session','core/game-flow','core/game-content','core/new-game-field-entry','core/field-fade',
 'core/source-presentation','core/source-message-sequence','core/field-condition-activity','core/field-logical-effects','core/field-camera-shake',
 'core/source-encounter-entry','compiler/corpus','compiler/content','compiler/integrity','tools/frontier-input-binding','core/game-content-release','core/content-integrity'].map(load));
const releaseRoot=options['release-root']?resolve(root,options['release-root']):resolve(sourceRoot,'build/content-releases');
const runtime=await runtimeDigest(root,compiled),publicationBytes=await readFile(resolve(root,options['publication-report'])),publication=JSON.parse(publicationBytes),
 contentRuntime=publication.sourceInputLock?.runtimeSha256;
assert.ok(publication.published&&publication.result==='passed'&&/^[a-f0-9]{64}$/.test(contentRuntime),'Unavailable completed publication receipt');
assert.ok(contentRuntime===runtime||options['allow-compatibility'],'Runtime/content generation differs; use an explicit compatibility lane or same-generation publication');
await writeFile(resolve(output,'inputs',sha(publicationBytes)+'.json'),publicationBytes);
const snapshot=await loadCorpus(sourceRoot),snapshotManifest=await readFile(resolve(sourceRoot,'build/corpus/snapshot.json')),
 rawSourceSha256=sha(snapshotManifest),rawFiles=await readSnapshot(resolve(sourceRoot,'build/corpus')),sourceSnapshotInputs=[];
await writeFile(resolve(output,'inputs',rawSourceSha256+'.json'),snapshotManifest);
for(const[file,bytes]of rawFiles){const digest=sha(bytes);await writeFile(resolve(output,'inputs',digest+'.json'),bytes);sourceSnapshotInputs.push({file,sha256:digest,bytes:bytes.length});}
const sourceSnapshotIndexBytes=JSON.stringify({manifestSha256:rawSourceSha256,files:sourceSnapshotInputs},null,2)+'\n';
await writeFile(resolve(output,'source-snapshot-index.json'),sourceSnapshotIndexBytes);
const consumed=new Map(),releaseIndexPath=resolve(releaseRoot,'packages/framework.json'),releaseIndexBytes=await readFile(releaseIndexPath);
await writeFile(resolve(output,'inputs',sha(releaseIndexBytes)+'.json'),releaseIndexBytes);
const refsPath=resolve(content,'framework.json'),refsBytes=await readFile(refsPath),refs=JSON.parse(refsBytes),
 binding=await bindPublishedFrontierRelease(publication,JSON.parse(releaseIndexBytes),refs);
await writeFile(resolve(output,'inputs',sha(refsBytes)+'.json'),refsBytes);
consumed.set('/content-packages/framework.json',{path:refsPath,bytes:refsBytes,sha256:sha(refsBytes)});
async function read(url){assert.match(url,/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/);
 if(!consumed.has(url)){
  const ref=resolveGameContentReleaseObject(binding.selected,url),archivePath=resolve(releaseRoot,'objects',ref.contentHash+'.json'),
   path=url.startsWith('/content-packages/')?resolve(content,url.slice('/content-packages/'.length)):resolve(sourceRoot,'build','.'+url),
   bytes=await readFile(path),archived=await readFile(archivePath),digest=sha(bytes);
  assert.ok(bytes.equals(archived),'Published bytes differ from the selected original-byte release: '+url);
  await verifyContent(JSON.parse(bytes),ref.contentHash);
  await writeFile(resolve(output,'inputs',digest+'.json'),bytes);consumed.set(url,{path,archivePath,bytes,sha256:digest,contentHash:ref.contentHash});}
 return JSON.parse(consumed.get(url).bytes);}
const repo=new GameContentRepository(read,'framework',refs),entryContent=await repo.sourceNewGame(),{catalog,map,battle}=entryContent;
assert.equal(snapshot.sourceSetHash,catalog.sourceSetHash);assert.equal(snapshot.manifest.parentSourceSetHash,catalog.parentSourceSetHash);
assert.equal(binding.selected.release.sourceSetHash,catalog.parentSourceSetHash,'Release parent source identity changed');
const runtimePorts=()=>({assignedNpcRoutes:'web-assigned-npc-route-grid-v1',retainedWorldTransportation:'web-retained-walking-magitek-world-entry-v1',
 sourceEncounterPolicy:WEB_SOURCE_ENCOUNTER_POLICY,sourceMessageSequence:createWebFieldMessageSequencePort(),
 conditionLeaderActivity:createWebFlatConditionLeaderActivityPort(),fieldEffects:createWebLogicalFieldEffectsHost(),cameraShake:createWebFieldCameraShakePolicy(),
 battleHandoff:'prepared',audioReadiness:{isReady:()=>true},soundPresentation:{isPresented:()=>true},transportationTimestamp:()=>'639273600000000000'});
const bundle=game=>{const flow=new GameFlow(game);flow.start();flow.observeHost({visible:true,mediaReady:true,overlayOpen:false});return{game,flow,contents:repo};};
const host={origin:'source-new-game',sourceWitness:{entry:entryContent.content.entry.evidence,map:map.map.source},create:async()=>{const presentation=createSourcePresentationContext({kind:'title-new-game',titleCleanupComplete:true,openingCallbackStarted:false}),
 entry=new NewGameFieldEntry(entryContent.content.entry,presentation),initialFade=new FieldFadeState({imageColor:{r:0,g:0,b:0,a:1},rendererColor:{r:1,g:1,b:1,a:0},raycastTarget:false}),
 start=entry.prepareStart(initialFade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.51);
 while(entry.phase!=='field-preparing'){const next=entry.prepareResume(fade,true);assert.ok(next);next.commit();fade=next.fade;}
 const game=GameSession.prepareNewGame(entryContent.content,catalog,map,battle,fade,presentation,runtimePorts()),
 launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();return bundle(game);},
 restore:async checkpoint=>{const dependencies=await repo.restoreSessionContent(checkpoint);return bundle(GameSession.restore(checkpoint,
  dependencies.initial,dependencies.battle,dependencies.world,runtimePorts()));}};
let initialPrefixes,resume=null;
if(options.resume){const bytes=await readFile(resolve(root,options.resume)),previous=JSON.parse(bytes),{contentHash,...body}=previous;
 assert.equal(hash(body),contentHash,'Resume report integrity changed');assert.equal(previous.runtime,runtime);assert.equal(previous.rawSourceSha256,rawSourceSha256);
 assert.equal(previous.refsHash,hash(refs));assert.equal(previous.release?.id,binding.selected.release.id,'Resume published release changed');
 assert.equal(previous.release?.indexHash,binding.selected.indexHash,'Resume publication archive generation changed');
 assert.ok(previous.exploration.pending.length,'Resume report has no pending queue');
 initialPrefixes=previous.exploration.pending.map(p=>p.inputPrefix);resume={sha256:sha(bytes),policy:'Replay all pending full input prefixes from real newgame; no imported game state'};}
const receipt={kind:'source-reachable-frontier-experiment-v1',result:'running',runtime,contentRuntime,
 generation:contentRuntime===runtime?'same-runtime-publication':'explicit-runtime-content-compatibility',
 rawSourceSha256,sourceSnapshotFiles:sourceSnapshotInputs.length,sourceSnapshotIndexSha256:sha(sourceSnapshotIndexBytes),sourceDigest:hash(snapshot),sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash,
 release:{id:binding.selected.release.id,indexHash:binding.selected.indexHash,indexSha256:sha(releaseIndexBytes),originalJSONBytesPreserved:true},
 refsHash:hash(refs),refs,publicationSha256:sha(publicationBytes),resume,sourceStoryAdmitted:false,sourceCampaignComplete:false,
 browserVerified:false,nativeParity:false,controlledHost:{media:'immediately ready audio and display ACK; no rendered pixels',clockMs:10,timestamp:'639273600000000000'},
 contentInputs:[],exploration:null};
async function persist(exploration){receipt.exploration=exploration;receipt.contentInputs=[...consumed].map(([url,row])=>({url,sha256:row.sha256,...(row.contentHash?{contentHash:row.contentHash}:{})}));
 const body=JSON.parse(JSON.stringify(receipt));await writeFile(resolve(output,'report.json'),JSON.stringify({...body,contentHash:hash(body)},null,2)+'\n');}
try{const exploration=await exploreReachableFrontiers(host,{maxRuns:Number(options['max-runs']),maxTicksPerRun:Number(options['max-ticks']),
 maxDepth:Number(options['max-depth']),...(initialPrefixes?{initialPrefixes}:{}),persist});
 assert.equal(await runtimeDigest(root,compiled),runtime,'Explorer runtime changed');
 assert.equal(hash(await loadCorpus(sourceRoot)),receipt.sourceDigest,'Raw source changed');
 assert.ok((await readFile(resolve(root,options['publication-report']))).equals(publicationBytes),'Publication generation changed during exploration');
 assert.ok((await readFile(releaseIndexPath)).equals(releaseIndexBytes),'Publication archive index changed');
 for(const row of consumed.values()){assert.ok((await readFile(row.path)).equals(row.bytes),'Consumed published input changed '+row.path);
  if(row.archivePath)assert.ok((await readFile(row.archivePath)).equals(row.bytes),'Consumed archive object changed '+row.archivePath);}
 receipt.result='bounded-complete';await persist(exploration);
 console.log(JSON.stringify({result:receipt.result,generation:receipt.generation,runs:exploration.runs.length,reached:exploration.reached.length,
  pending:exploration.pending.length,groups:exploration.groups.map(g=>({capability:g.capability,message:g.message,sites:g.sites.length})),report:resolve(output,'report.json')}));
}catch(error){receipt.result='failed';receipt.error={message:error.message,stack:error.stack};await persist(receipt.exploration);throw error;}
