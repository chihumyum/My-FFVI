import test from 'node:test';import assert from 'node:assert/strict';
import { GameSession } from '../src/core/game-session.js';import { GameFlow } from '../src/core/game-flow.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { WEB_BATTLE_BRANCH_EXECUTION as policy } from '../src/core/battle-branch-execution.js';
import { WEB_BATTLE_EVENT_EFFECTS,createWebBattleEventEffectHost,type BattleEventEffectHost } from '../src/core/battle-event-effect.js';
import { BattleEventError } from '../src/core/battle-event.js';
import { battleMessageSessionFixture } from './fixtures/battle-event-message.js';
import { branchRaw as raw,branchProgram,unknownBranchRaw as unknown } from './fixtures/battle-branch-execution.js';
import { hash } from '../src/compiler/content.js';
import { compileFieldTimerInstruction } from '../src/compiler/field-timer.js';
import { WEB_FIELD_STORY_RUNTIME } from '../src/core/field-story-runtime.js';
import type { Op } from '../src/field/types.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
function setup(ops:ReturnType<typeof raw>[],effectHost:BattleEventEffectHost|typeof WEB_BATTLE_EVENT_EFFECTS=WEB_BATTLE_EVENT_EFFECTS,lethalEnemies=false){
 const p=branchProgram(ops),f=battleMessageSessionFixture(p);f.battle.encounters[1000]!.lifecycle={kind:'battle-lifecycle-v2',mode:'script',scriptId:1,program:p,branchExecution:policy};
 if(lethalEnemies)for(const enemy of f.battle.encounters[1000]!.enemies){assert(enemy.physical);enemy.physical.attack=255;enemy.physical.strength=128;}
 const runtime={...f.runtime,battleBranchExecution:policy,battleEventEffects:effectHost},game=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(game);
 flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));game.advance(10);assert.equal(game.prepareBattleStart()!.commit(),true);return {...f,runtime,game,flow};
}
const gameplay=(game:GameSession)=>({time:game.battle!.time,units:structuredClone(game.battle!.combatants),event:game.battle!.eventExecution,
 owned:game.state.snapshot(),shared:game.battle!.eventSharedReturn?.candidate,window:game.field.sourceMessage.snapshot(),revision:game.field.sourceMessage.mutationRevision,
 mask:game.field.updateAttributeMask,effects:game.battle!.effectPresentation,effectJournal:game.battle!.effectExecution,messages:game.battle!.messageExecution,action:structuredClone(game.battle!.action),pending:game.battle!.pendingActions,ui:game.battle!.uiControls});
const mix=()=>[raw('SetFlag',[52],[],['ScenarioFlag1']),raw('PlayBattleEffect',[1,1000,99,1]),raw('Msg',[2,0],[-1],['SYSTEM'])];
test('actual unknown after shared writes, effect preparation and Msg rolls back one real Session frame; throwing cleanup cannot hide its original raw error',()=>{
 let discards=0,commits=0;const base=createWebBattleEventEffectHost(),host:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const r=base.prepare(request);return {...r,commit(){commits++;r.commit();},discard(){discards++;throw Error('authored failed cleanup');}};}};
 const f=setup([raw('BattleEndEnabled',[0]),raw('BattlePause',[1]),...mix(),unknown(),raw('Exit')],host),{game}=f,b=game.battle!,before=gameplay(game);
 for(let n=0;n<2;n++){
  assert.throws(()=>n===0?game.advance(10):b.advance(0),(e:unknown)=>{assert(e instanceof BattleEventError);assert.equal(e.pc,5);assert.deepEqual(e.rawInstruction,unknown());assert.equal(e.reason,'unsupported battle-event instruction or operands: AuthoredUnimplementedInstruction');return true;});
  assert.deepEqual(gameplay(game),before);assert.equal(commits,0);assert.equal(discards,n+1);assert.deepEqual(b.eventBranchExecution!.committedVisited,[]);
  assert.deepEqual(b.eventBranchExecution!.lastFailure!.attemptedVisited,[0,1,2,3,4,5]);assert.deepEqual(b.eventBranchExecution!.lastFailure!.raw,unknown());
 }
 assert.equal(b.effectCleanupFailures.length,2);assert.throws(()=>game.field.eventState.read({category:'ScenarioFlag1',index:52}),/未知事件状态/);
});
test('a later unknown restores already-published window, old effect lease, VM and shared banks; failed-frame visits remain separate from committed visits',()=>{
 const f=setup([raw('BattleEndEnabled',[0]),raw('BattlePause',[1]),raw('Msg',[2,0],[-1],['SYSTEM']),raw('PlayBattleEffect',[1,1000,99,1]),
  raw('Wait',[],[.02]),raw('SetFlag',[52],[],['ScenarioFlag1']),raw('MsgClose'),unknown(),raw('Exit')]),{game}=f,b=game.battle!;
 game.advance(10);assert.equal(game.field.sourceMessage.active,true);assert.equal(b.effectPresentation.length,1);game.advance(10);game.advance(10);
 const before=gameplay(game),visited=b.eventBranchExecution!.committedVisited;assert.deepEqual(visited,[0,1,2,3,4]);
 assert.throws(()=>game.advance(10),/Mnemonics\/7/);assert.deepEqual(gameplay(game),before);assert.deepEqual(b.eventBranchExecution!.committedVisited,visited);
 assert.deepEqual(b.eventBranchExecution!.lastFailure!.attemptedVisited,[4,5,6,7]);assert(b.eventBranchExecution!.unvisited.includes(7));assert.equal(b.eventBranchExecution!.unvisitedDependencies[0]!.pc,7);
});
function ordinary(){return [raw('Jump',[1]),unknown(),raw('ExecBattleAI'),raw('Blank'),raw('SyncBattleAI'),
 raw('Branch',[0,0,2],[],['ScriptLocalVariable','＝','imm']),raw('BattleSyncAction'),raw('Wait',[],[.04]),raw('Exit')];}
function win(game:GameSession){for(let n=0;n<30000&&game.battle?.phase==='active';n++){for(const actor of game.battle.ready){const t=game.battle.targets(actor.id,10)[0];if(t)game.battle.command(actor.id,10,t.id);}game.advance(10);}assert.equal(game.battle!.phase,'victory');}
test('a completed actual path with an unvisited dependency can return and restore Storage; the checkpoint cannot grant the missing runtime policy',async()=>{
 const f=setup(ordinary()),{game}=f,b=game.battle!;assert.equal(b.eventExecution.state!.pc,0);win(game);assert.deepEqual(b.eventBranchExecution!.unvisitedDependencies.map(d=>d.pc),[1]);assert.equal(b.eventBranchExecution!.lastFailure,null);
 assert.equal(game.prepareBattleReturn()!.commit(),true);game.advance(10);const slots=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>slots.set(k,v)});await storage.save(game.checkpoint(),1);const saved=(await storage.load())!;
 const strict=GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,{...f.runtime,battleBranchExecution:undefined}as never);assert(strict.field.startEvent('fight'));strict.advance(10);const before=strict.state.snapshot();assert.throws(()=>strict.prepareBattleStart()!.commit(),/explicit Web runtime host/);assert.deepEqual(strict.state.snapshot(),before);assert.equal(strict.state.inBattle,false);
 const restored=GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,f.runtime);assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert(restored.field.startEvent('fight'));restored.advance(10);assert(restored.prepareBattleStart()!.commit());win(restored);assert(restored.prepareBattleReturn()!.commit());restored.advance(10);assert.equal(restored.state.snapshot().completedBattles.length,2);
 assert.throws(()=>GameSession.restore({...saved.checkpoint,battleBranchExecution:policy}as never,f.field,f.battle));
});
test('a legitimate defeat retry resets branch evidence/entry and retires the old VM without changing the owned initializer',()=>{
 const {game}=setup(ordinary(),WEB_BATTLE_EVENT_EFFECTS,true),old=game.battle!,before=game.state.snapshot();for(let n=0;n<30000&&old.phase==='active';n++)game.advance(10);
 assert.equal(old.phase,'defeat');assert.deepEqual(game.state.snapshot(),before);assert(old.eventBranchExecution!.committedVisited.length>0);
 const retry=game.prepareBattleRetry()!;assert(retry.commit());const fresh=game.battle!;assert.notEqual(fresh,old);assert.deepEqual(fresh.eventBranchExecution!.committedVisited,[]);assert.equal(fresh.eventBranchExecution!.lastFailure,null);
 assert.throws(()=>old.advance(10),/Retired/);assert.equal(fresh.time,0);win(game);assert(game.prepareBattleReturn()!.commit());assert.equal(game.state.snapshot().completedBattles.length,1);
});
test('Session passive timer/audio clocks commit before a failing BattleGame subframe, but cannot run field callbacks or publish owned rewards',()=>{
 const f=battleMessageSessionFixture(branchProgram([unknown(),raw('Exit')])),program=f.battle.encounters[1000]!.lifecycle!;
 if(program.mode!=='script')throw Error('Expected authored script');
 f.battle.encounters[1000]!.lifecycle={...program,kind:'battle-lifecycle-v2',branchExecution:policy};
 f.field.parentSourceSetHash=hash('authored passive source');f.field.sourceSetHash=hash('authored passive field');
 f.field.developmentProfile={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:hash('authored original passive field'),omissions:[],storyRuntime:WEB_FIELD_STORY_RUNTIME};
 const source={file:'authored-passive.bundle',assetPath:'authored/timer',objectId:'9007199254740993'},bind=(script:string,ops:unknown[])=>ops.map((op,index)=>({...op as object,script,index,source})as Op);
 f.field.scripts['timer']=bind('timer',[compileFieldTimerInstruction(raw('SetTimer',[0,0,0,1],[Math.fround(.05)],['expired'])),{kind:'exit'}]);
 f.field.scripts['expired']=bind('expired',[{kind:'flag',ref:{category:'ScenarioFlag1',index:52},operation:'set'},{kind:'exit'}]);
 f.field.scriptLocals={...f.field.scriptLocals,timer:null,expired:null};
 const {contentHash:ignored,...body}=f.field;f.field.contentHash=hash(body);f.battle.common.fieldSourceSetHash=f.field.sourceSetHash;
 const game=new GameSession(f.field,f.battle,314,{...f.runtime,battleBranchExecution:policy}),flow=new GameFlow(game);flow.start();flow.advance(0,ready);
 assert(game.field.startEvent('timer'));assert(game.field.startEvent('fight'));game.advance(10);assert(game.prepareBattleStart()!.commit());
 const battle=game.battle!,before=gameplay(game),audio=game.field.bgm.snapshot().time,timer=game.field.storyRuntimeSnapshot!.timer.active!;
 assert.equal(timer.expired,false);
 for(let n=0;n<8;n++){assert.throws(()=>game.advance(10),/Mnemonics\/0/);assert.deepEqual(gameplay(game),before);}
 assert.equal(game.field.bgm.snapshot().time,audio+80);assert.equal(game.field.storyRuntimeSnapshot!.timer.active!.expired,true);
 assert.equal(game.field.storyRuntimeSnapshot!.timer.active!.dispatched,false);assert.throws(()=>game.field.eventState.read({category:'ScenarioFlag1',index:52}),/未知事件状态/);
 assert.equal(battle.phase,'active');assert.equal(game.state.snapshot().completedBattles.length,0);assert.equal(battle.time,0);
});
