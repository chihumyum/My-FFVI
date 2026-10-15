// One source load, complete original bodies/references, and a separately named
// controlled parameter lane. Never produces world content or skips source ops.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
const view=resolve(import.meta.dirname,'..'),options={inputRoot:view,compiled:resolve(view,'dist'),report:resolve(view,'build/reports/source-world-auto-tasks.json')},args=process.argv.slice(2),seen=new Set();
while(args.length){const f=args.shift();assert(['--input-root','--compiled-dir','--report'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);options[f==='--input-root'?'inputRoot':f==='--compiled-dir'?'compiled':'report']=resolve(view,args.shift());}
assert(options.report.startsWith(resolve(view,'build')+'/'));await mkdir(dirname(options.report),{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=n=>import(pathToFileURL(resolve(options.compiled,n+'.js')).href),runtime=await runtimeDigest(view,options.compiled),
 proposalFile=resolve(options.inputRoot,'build/wip/source-world-auto-task-proposal/proposal.json'),proposalBytes=await readFile(proposalFile),proposal=JSON.parse(proposalBytes);
assert.equal(sha(proposalBytes),'b303b3f136c33bfe9de3f3d17b09db3704cc768f1b88739424bba8d49831ed6f');
const input=await loadBattleEventMessageSourceInputs(options.inputRoot,options.compiled),api=Object.assign({},input.api,...await Promise.all([
 'src/compiler/field','src/compiler/framework-new-game','src/core/game-session','src/core/game-flow','src/core/field-world-auto-tasks','tests/fixtures/world-auto-tasks'].map(load)));
assert.equal(input.sourceDigest,proposal.sourceDigest);
const names=new Set(Object.keys(proposal.counts.mnemonics)),selected=input.scripts.filter(p=>p.data.Mnemonics.some(op=>names.has(op.mnemonic))),sites=[],programs=[];
for(const p of selected){const original=proposal.completeSelectedPrograms.find(q=>q.id===p.id);assert(original);assert.equal(api.canonical(original),api.canonical({...p,rawHash:api.hash(p.data)}));
 const compiled=p.data.Mnemonics.map((raw,pc)=>api.decodeFieldOp(raw,{script:p.id,index:pc,source:p.source},input.snapshot.messages,input.snapshot.tables));
 assert.equal(compiled.length,p.data.Mnemonics.length);for(const[pc,raw]of p.data.Mnemonics.entries())if(names.has(raw.mnemonic))sites.push({program:p.id,source:p.source,pc,rawHash:api.hash(p.data),raw,typed:compiled[pc]});
 programs.push({...p,rawHash:api.hash(p.data),compiled,sourceExecution:'not-executed; retained complete original body',unknowns:compiled.flatMap((op,pc)=>op.kind==='blocked'?[{pc,reason:op.reason,raw:p.data.Mnemonics[pc]}]:[])});
}
assert.equal(selected.length,68);assert.equal(selected.reduce((n,p)=>n+p.data.Mnemonics.length,0),6709);assert.equal(sites.length,460);
const scalars=sites.filter(s=>s.typed.kind==='field-world-auto-task'),movements=sites.filter(s=>s.typed.kind==='field-world-auto-move'),spatial=sites.filter(s=>!['field-world-auto-task','field-world-auto-move'].includes(s.typed.kind));
assert.equal(scalars.length,352);assert.equal(movements.length,40);assert.equal(spatial.length,68);assert(spatial.every(s=>['blocked','field-bird-view-move'].includes(s.typed.kind)));
const spatialGates=spatial.filter(s=>s.typed.kind==='blocked'),birdViewSites=spatial.filter(s=>s.typed.kind==='field-bird-view-move');
const f=await api.worldAutoSessionFixture(),ready={visible:true,mediaReady:true,overlayOpen:false},seal=v=>{const{contentHash,...body}=v;return {...body,contentHash:api.hash(body)};},attempts=[];
for(const site of scalars){
 const map=structuredClone(f.map),world=structuredClone(f.world),actual=structuredClone(site.typed),controlledSite={script:'auto',index:1,source:{file:'authored-world-auto-parameter',assetPath:'controlled-source-operand-envelope'}},
  operations=[actual,...(actual.command.kind==='start'?[]:[{kind:'field-world-auto-task',command:{kind:'start'},...controlledSite}]),{kind:'exit',...controlledSite}];
 map.scripts.auto=operations;const pinnedMap=seal(map);world.maps[map.mapId].contentHash=pinnedMap.contentHash;const pinnedWorld=seal(world),
  content=await api.compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:pinnedWorld,map:pinnedMap,battle:f.battle,entrance:map.partyEntry.pointIns[0].id}),
  game=await api.GameSession.prepareFrameworkNewGame(content,pinnedWorld,pinnedMap,f.battle,f.runtime),flow=new api.GameFlow(game);flow.start();flow.advance(10,ready);assert(game.checkpointReady);
 const owned=game.state.snapshot(),before=game.field.worldAutoPose;assert(game.field.startEvent('auto'));assert.equal(game.field.busy,false,'Source wrapper cannot wait on auto-task completion');
 const queued=game.field.worldAutoTaskSnapshot;assert.equal(queued.tasks.length,actual.command.kind==='start'?0:1);assert.deepEqual(game.field.worldAutoPose,before,'Add/Start cannot fabricate a synchronous endpoint');
 let ticks=0;while(game.field.worldAutoTaskSnapshot.tasks.length&&ticks<2000){game.advance(10);ticks++;assert.equal(game.field.stop,null,game.field.stop?.message);}
 assert.equal(game.field.worldAutoTaskSnapshot.tasks.length,0);assert(game.checkpointReady);assert.equal(api.canonical(game.state.snapshot()),api.canonical(owned));
 const pose=game.field.worldAutoPose;
 if(actual.command.kind==='add-scalar'){
  const command=actual.command,start=command.start??before[command.channel],expected=command.seconds<=0?before[command.channel]:command.channel==='rotation'?Math.fround(start+command.value):Math.fround(start+Math.fround(command.value-start));
  assert.equal(pose[command.channel],expected,'Original source operand endpoint differs');
 }
 attempts.push({program:site.program,source:site.source,pc:site.pc,rawHash:site.rawHash,raw:site.raw,typed:actual,parameterOnly:true,
  result:'actual-source-operand-Session-protocol-completed',before,queued,after:pose,ticks,actualQueueJournal:game.field.worldAutoTaskJournal,stableCheckpointReady:true,ownedUnchanged:true,sourceStoryReachability:false});
}
assert.equal(sha(await readFile(proposalFile)),sha(proposalBytes));assert.equal(await runtimeDigest(view,options.compiled),runtime);
const corpus=await input.api.loadCorpus(options.inputRoot);assert.equal(api.hash({assets:corpus.assets,tables:corpus.tables,messages:corpus.messages,manifest:corpus.manifest}),input.sourceDigest);
const report={kind:'source-world-auto-task-family-check-v1',result:'passed-controlled-parameters-and-whole-source-audit',runtimeSha256:runtime,proposalSha256:sha(proposalBytes),sourceDigest:input.sourceDigest,
 counts:{...proposal.counts,decodedSharedSites:scalars.length,decodedMovementSites:movements.length,explicitSpatialGates:spatialGates.length,existingBirdViewSites:birdViewSites.length,actualSourceOperandSessionAttempts:attempts.length,actualSourceOperandSessionCompleted:attempts.length,completeOriginalProgramExecutions:0,worldCompilations:0},
 programs,sites,completeReferenceAnalysis:input.analysis,parameterAttempts:attempts,explicitSpatialGates:spatialGates,existingBirdViewSites:birdViewSites,
 webPolicy:{runtime:api.WEB_FLAT_WORLD_AUTO_TASKS,trustedContent:'framework profile.worldAutoMove + worldAutoTasks; current map/camera binding',clock:'Existing Field 10ms, all running tasks in insertion order',start:'Does not clear or consume queue; repeated Start preserves running progress, newly appended tasks wait for Start',projection:'Camera-owned flat rotation/zoom/vertical offset; not native 3D/RT',zeroDuration:'No endpoint setter; completes on a real tick',battle:'Field task queue paused while independently committed Session passive clocks continue'},
 executionLimitations:['All68 original complete bodies and unknowns remain; source MainCore bodies were not selectively rewritten or executed by the parameter lane.','Parameter envelopes use actual source commands and an explicitly authored Start/caller, with existing owned initializer.','Parent owns the one subsequent649 candidate and actual whole-body route replay.'],sourceCampaignComplete:false,nativeParity:false,browserVerified:false,sourceProducerStarted:false};
report.contentHash=api.hash(report);await writeFile(options.report,JSON.stringify(report)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,contentHash:report.contentHash,report:options.report}));
