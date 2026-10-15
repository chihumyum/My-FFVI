// Actual source operands on a declared authored Session caller. Complete
// original programs and source party dependencies remain a separate lane.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),o={compiled:'dist',report:'build/reports/battle-system-message-cohort/check.json'},seen=new Set();
while(args.length){const f=args.shift();assert(['--compiled','--report'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);o[f.slice(2)]=args.shift();}
const compiled=resolve(root,o.compiled),out=resolve(root,o.report);assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(dirname(out),{recursive:true});
const runtime=await runtimeDigest(root,compiled),input=await loadBattleEventMessageSourceInputs(root,compiled),
 load=n=>import(pathToFileURL(resolve(compiled,n+'.js')).href),api=Object.assign({},...await Promise.all(['src/core/game-session','src/core/game-flow','src/core/saved-game','src/core/battle-event-message','tests/fixtures/battle-event-message'].map(load))),
 selected=input.sites.filter(s=>s.raw.mnemonic==='Msg'&&Object.hasOwn(input.input.messages.system_zhc??{},s.raw.operands.sValues[0])),programIds=new Set(selected.map(s=>s.program)),cases=[];
const ready={visible:true,mediaReady:true,overlayOpen:false};
for(const site of selected){
 assert.equal(site.typed.kind,'message');assert.equal(site.typed.command.kind,'sequence');
 const p=api.battleMessageProgram();p.source=null;p.messageBinding=structuredClone(input.input.binding);p.instructions[0]={mnemonic:site.raw.mnemonic,op:structuredClone(site.typed)};
 for(const i of p.instructions)if(['jump','call','branch','variable-branch'].includes(i.op.kind))i.op.target++;
 const f=api.battleMessageSessionFixture(p),players=f.battle.common.players;
 assert(players.length>=2,'Authored action requires two declared player resources');
 p.instructions.unshift({mnemonic:'authored:BattleAction',op:{kind:'script-action',actor:{side:'player',id:players[0].sourceId},target:{side:'player',id:players[1].sourceId},sourceActorKind:1,sourceTargetKind:1,abilityId:11,asynchronous:true}});p.end++;
 const runtimePorts={...f.runtime,scriptedBattleActions:'web-source-scripted-battle-actions-v1'},game=new api.GameSession(f.field,f.battle,314,runtimePorts),flow=new api.GameFlow(game);
 flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));game.advance(10);assert.equal(game.prepareBattleStart().commit(),true);
 const battle=game.battle,owner=game.field.sourceMessage,mp=battle.players[0].mp,trace=[];let concurrent=false,opened=null,closed=null,ticks=0;
 for(;ticks<30000&&battle.phase==='active';ticks++){
  const window=owner.projection;
  if(window){
   if(opened===null)opened=battle.time;
   assert.equal(window.key,site.raw.operands.sValues[0]);assert.equal(window.speaker,'');assert.equal(window.anchor,['top','middle','bottom'][site.raw.operands.iValues[1]]);
   assert.equal(battle.messagePresentation.sourceWindow,site.raw.operands.iValues[0]);assert.equal(battle.messagePresentation.speakerAnchor,site.raw.operands.iValues[0]===2?'right':'left');
   if(battle.action?.kind==='event')concurrent=true;
   if(window.acceptsInput){trace.push({kind:'confirm',time:battle.time,key:window.key});assert(flow.confirm());}
  }else if(opened!==null&&closed===null)closed=battle.time;
  if(!battle.messageInputPending)for(const actor of battle.ready){const target=battle.targets(actor.id,10)[0];if(target)assert(battle.command(actor.id,10,target.id));}
  flow.advance(10,ready);
 }
 assert.equal(battle.phase,'victory');assert.equal(battle.players[0].mp,mp-2);assert(concurrent,'Real scripted action did not overlap the actual message window');
 assert.notEqual(opened,null);assert.notEqual(closed,null);assert(closed-opened>=site.raw.operands.rValues[0]*1000,'Source timed message resumed too soon');
 assert.equal(game.prepareBattleReturn().commit(),true);game.advance(10);assert.equal(owner.active,false);assert.equal(game.field.updateAttributeMask,3);assert(game.checkpointReady);
 const slots=new Map(),storage=new api.CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>slots.set(k,v)});await storage.save(game.checkpoint(),1);const saved=await storage.load(),restored=api.GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,runtimePorts);assert.deepEqual(restored.checkpoint(),saved.checkpoint);
 assert.throws(()=>battle.advance(10),/Retired/);assert.equal(restored.field.sourceMessage.active,false);
 cases.push({sourceSite:{program:site.program,index:site.index,source:site.source,rawHash:site.rawHash,raw:site.raw,nextMnemonic:site.nextMnemonic},typed:site.typed,result:'source-operand-session-action-return-storage-passed',sourceMessageOwnerShared:true,concurrentActionObserved:concurrent,actionMpCost:mp-battle.players[0].mp,opened,closed,ticks,inputs:trace,event:battle.eventExecution,messages:battle.messageExecution,checkpointHash:input.api.hash(saved.checkpoint),sourceStoryReachability:false});
}
const now=await input.api.loadCorpus(root);assert.equal(input.api.hash({assets:now.assets,tables:now.tables,messages:now.messages,manifest:now.manifest}),input.sourceDigest);assert.equal(await runtimeDigest(root,compiled),runtime);
const report={kind:'source-battle-system-message-cohort-v1',result:'passed',runtimeSha256:runtime,sourceDigest:input.sourceDigest,binding:input.input.binding,
 counts:{allSourcePrograms:input.inventory.counts.allPrograms,allSourceInstructions:input.inventory.counts.allInstructions,battlePrograms:input.programs.length,battleInstructions:input.inventory.counts.instructions,requestedParties:input.dependencies.requestedPartyIds.length,sourceDescriptors:input.dependencies.encounters.length,sourceDiagnostics:input.dependencies.diagnostics.length,systemMessageSites:selected.length,decodedSystemSites:selected.filter(s=>s.typed.kind==='message').length,selectedCompletePrograms:programIds.size,selectedCompleteRawInstructions:input.programs.filter(p=>programIds.has(p.id)).reduce((n,p)=>n+p.data.Mnemonics.length,0),sessionCases:cases.length},
 inventory:input.inventory,cases,caller:'Declared authored fixture, real Session/Flow/Field.sourceMessage/BattleGame action and CheckpointStorage; exact source message operands only, complete original programs retained separately without invented source admission',sourceStoryPassed:false,nativeParity:false,browserVerified:false,sourceProducerStarted:false};
report.contentHash=input.api.hash(report);await writeFile(out,JSON.stringify(report)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,contentHash:report.contentHash,report:out}));
