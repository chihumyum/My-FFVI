import test from 'node:test';import assert from 'node:assert/strict';
import {FieldFadeState,DEVELOPMENT_TRANSPARENT_FADE,fieldFadeOverlay} from '../src/core/field-fade.js';
import {WEB_BATTLE_GLOBAL_FADE,parseBattleGlobalFadeOp} from '../src/core/battle-global-fade.js';
import {compileBattleEvent} from '../src/compiler/battle-event.js';
import {classifyDeferredBattleInstruction,WEB_BATTLE_BRANCH_EXECUTION} from '../src/core/battle-branch-execution.js';
import {BattleGame} from '../src/core/battle.js';
import {GameSession} from '../src/core/game-session.js';import {GameFlow} from '../src/core/game-flow.js';
import {WEB_BATTLE_EVENT_CONTROLS} from '../src/core/battle-controls.js';
import {CheckpointStorage} from '../src/core/saved-game.js';import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';
import {battleMessageProgram,battleMessageContent,battleMessageSessionFixture,messageRaw} from './fixtures/battle-event-message.js';
import {authoredBattleEffect} from './fixtures/battle-event-effect.js';
import {WEB_BATTLE_EVENT_EFFECTS,type BattleEventEffectHost} from '../src/core/battle-event-effect.js';
const rgba=(a=255)=>({r:0,g:0,b:0,a:Math.fround(a/255)});
const fade=(seconds=.7,a=255,direction:'in'|'out'='out')=>({kind:'global-fade' as const,direction,seconds:Math.fround(seconds),color:rgba(a)});
const raw=(direction='FadeOut',seconds=.7,a=255)=>({mnemonic:direction,type:1,operands:{iValues:[0,0,0,a,0,0,0,0],rValues:[seconds,0,0,0,0,0,0,0],sValues:Array(8).fill('')}});
const program=(ops:ReturnType<typeof raw>[])=>battleMessageProgram(ops);
const host=(owner:FieldFadeState)=>({fade:{policy:WEB_BATTLE_GLOBAL_FADE,owner},controls:WEB_BATTLE_EVENT_CONTROLS});
const forcedProgram=(seconds=.7,a=255)=>program([raw('FadeOut',seconds,a),messageRaw('BattleForceExit'),messageRaw('Exit')]);
const ready={visible:true,mediaReady:true,overlayOpen:false};

export function fadeSessionFixture(p=forcedProgram()){
 const f=battleMessageSessionFixture(p);f.field.entry.fade=structuredClone(DEVELOPMENT_TRANSPARENT_FADE);
 f.field.entry.initialEventValues=[{ref:{category:'ScenarioVariable',index:0},value:0},{ref:{category:'ScenarioFlag1',index:8},value:0}];
 f.field.scripts['fade-go-next']=[{kind:'change-map',script:'fade-go-next',index:0,source:f.field.map.source,request:{mapId:2,entrance:1,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'}}];
 const runtime={...f.runtime,battleGlobalFade:WEB_BATTLE_GLOBAL_FADE,battleEventControls:WEB_BATTLE_EVENT_CONTROLS};
 const game=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(game);flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));game.advance(10);
 return {...f,runtime,game,flow};
}

test('complete ordinary fade operand contract, signed float32 and known-operand hard gates',()=>{
 for(const name of ['FadeIn','FadeOut'])for(const seconds of [.7,1.4,0,-0,-.7,-1e-100])for(const alpha of [0,255]){
  const p=program([raw(name,seconds,alpha),messageRaw('BattleForceExit')]);assert.equal(p.instructions[0]!.op.kind,'global-fade');
 }
 for(const mutate of [(m:ReturnType<typeof raw>)=>{m.operands.iValues[5]=1;},(m:ReturnType<typeof raw>)=>{m.operands.iValues[3]=355;},(m:ReturnType<typeof raw>)=>{m.operands.sValues[4]='bad';}]){
  const m=raw();mutate(m);const p=program([m,messageRaw('BattleForceExit')]);assert.equal(p.instructions[0]!.op.kind,'blocked');assert.equal(classifyDeferredBattleInstruction(m),null);
 }
 assert.throws(()=>parseBattleGlobalFadeOp({...fade(),callback:()=>{}}),/checkpoint/i);
 assert.throws(()=>new BattleGame(battleMessageContent(forcedProgram()),1),/actual known shared Field fade/);
 assert.throws(()=>new BattleGame(battleMessageContent(forcedProgram()),1,undefined,undefined,undefined,undefined,undefined,undefined,host(new FieldFadeState(null))),/actual known shared Field fade/);
});

test('reserved manager candidates prevent external writes, stale ABA or changed candidate publication without touching current state',()=>{
 const manager=new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE),before=manager.snapshot(),revision=manager.mutationRevision,frame=manager.prepareFrame();
 frame.state.start({...fade(),kind:'field-fade'},.01);assert.deepEqual(manager.snapshot(),before);assert.throws(()=>manager.advance(.01),/reserved/);assert.throws(()=>manager.start({...fade(),kind:'field-fade'}),/reserved/);
 const write=frame.prepareCommit();frame.state.advance(.01);assert.throws(write.commit,/candidate changed/);frame.discard();assert.deepEqual(manager.snapshot(),before);assert.equal(manager.mutationRevision,revision);
 const retry=manager.prepareFrame();retry.state.start({...fade(),kind:'field-fade'},.01);const accepted=retry.prepareCommit();accepted.validate();accepted.commit();assert(manager.active);assert.throws(accepted.commit,/Stale/);
});

test('real shared manager synchronizes once after the first Blank, including transparent target and negative-zero paths',()=>{
 for(const [seconds,alpha]of [[.7,255],[1.4,255],[.7,0],[0,255],[-1e-100,255]] as const){
  const f=fadeSessionFixture(forcedProgram(seconds,alpha)),before=f.game.field.fader.snapshot();assert.equal(f.game.battle,null);assert(f.game.prepareBattleStart()!.commit());const battle=f.game.battle!;
  assert.deepEqual(f.game.field.fader.snapshot(),before);f.game.advance(10);assert.equal(battle.phase,'active');assert.equal(battle.eventExecution?.state?.wait?.kind,'global-fade');assert.equal(battle.fadeExecution.filter(e=>e.action==='start').length,1);
  for(let i=0;i<400&&battle.phase==='active';i++)f.game.advance(10);assert.equal(battle.phase,'forced');assert.equal(battle.fadeExecution.filter(e=>e.action==='start').length,1);assert.equal(battle.fadeExecution.filter(e=>e.action==='complete').length,1);
  assert.deepEqual(battle.globalFadeOverlay,fieldFadeOverlay(f.game.field.fader.projection));assert.equal(f.game.checkpointReady,false);
 }
});

test('a same-frame async fade/shared-bank/effect failure discards the unpublished manager tick and retries without duplicate publication',()=>{
 const p=program([raw('FadeOut',-.7),messageRaw('Msg',-1,'ASYNC'),messageRaw('BattleForceExit'),messageRaw('Exit')]);p.instructions.splice(1,0,{mnemonic:'Calc',op:{kind:'variable-calc',left:{category:'ScenarioVariable',index:0},operator:'＋',right:{kind:'immediate',value:1}}},{mnemonic:'PlayBattleEffect',op:authoredBattleEffect(1,1000)});p.end+=2;
 let fail=true,discards=0;const effects:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(){return{validate(){if(fail)throw Error('Controlled effect failure after fade request');},status(){return'ready';},commit(){},discard(){discards++;}};}};
 const f=fadeSessionFixture(p);(f.runtime as typeof f.runtime&{battleEventEffects:BattleEventEffectHost}).battleEventEffects=effects;
 const game=new GameSession(f.field,f.battle,314,{...f.runtime,battleEventEffects:effects}),flow=new GameFlow(game);flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));game.advance(10);assert(game.prepareBattleStart()!.commit());const battle=game.battle!,messageBefore=game.field.sourceMessage.projection,messageRevision=game.field.sourceMessage.mutationRevision,snapshot=game.field.fader.snapshot(),rev=game.field.fader.mutationRevision,shared=game.field.eventState.snapshot(),time=battle.time;
 assert.throws(()=>game.advance(10),/Controlled effect failure/);assert.equal(battle.time,time);assert.deepEqual(game.field.fader.snapshot(),snapshot);assert.equal(game.field.fader.mutationRevision,rev);assert.deepEqual(game.field.sourceMessage.projection,messageBefore);assert.equal(game.field.sourceMessage.mutationRevision,messageRevision);assert.deepEqual(game.field.eventState.snapshot(),shared);assert.equal(battle.fadeExecution.length,0);assert.equal(discards,1);
 fail=false;game.advance(10);assert.equal(battle.phase,'forced');assert.equal(battle.fadeExecution.filter(e=>e.action==='start').length,1);assert.equal(battle.fadeExecution.filter(e=>e.action==='complete').length,0);assert.equal(battle.eventSharedReturn!.candidate.global[0],1);assert.equal(game.field.eventState.read({category:'ScenarioVariable',index:0}),0);assert(game.field.fader.active);assert(game.prepareBattleReturn()!.commit());assert.equal(game.field.eventState.read({category:'ScenarioVariable',index:0}),1);assert.equal(game.field.sourceMessage.projection,null);
});

test('committed asynchronous manager clock survives force terminal, failed/cancelled return, successful retirement, Field continuation and Storage',async()=>{
 const f=fadeSessionFixture(forcedProgram(-.7)),{game,flow}=f;assert(game.prepareBattleStart()!.commit());game.advance(10);const old=game.battle!,owner=game.field.fader;assert.equal(old.phase,'forced');assert(owner.active);
 const checkpoint=owner.snapshot(),owned=game.state.snapshot();let entered!:(v:null)=>void,release!:(v:null)=>void;
 const barrier=new Promise<null>(r=>{entered=r;}),handoff=new GameBattleHandoff(flow,{async prepareStart(){return null;},async prepareReturn(){entered(null);return new Promise<null>(r=>{release=r;});},discard(){}}),pending=handoff.return();await barrier;handoff.cancel();release(null);assert.equal((await pending).status,'cancelled');assert.equal(game.battle,old);assert.deepEqual(owner.snapshot(),checkpoint);assert.deepEqual(game.state.snapshot(),owned);
 const failed=new GameBattleHandoff(flow,{async prepareStart(){return null;},async prepareReturn(){throw Error('Controlled fade return media failure');},discard(){}});assert.equal((await failed.return()).status,'failed');assert.equal(game.battle,old);assert.deepEqual(owner.snapshot(),checkpoint);
 game.advance(100);assert.notDeepEqual(owner.snapshot(),checkpoint);assert.equal(game.prepareBattleReturn()!.commit(),true);assert.equal(game.field.fader,owner);assert.throws(()=>old.advance(10),/Retired/);assert.equal(game.state.snapshot().completedBattles.length,1);assert.equal(game.checkpointReady,false);
 game.advance(1000);assert.equal(owner.active,false);assert(game.checkpointReady);const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});await storage.save(game.checkpoint(),0);const loaded=(await storage.load())!;const restored=GameSession.restore(loaded.checkpoint,f.field,f.battle,undefined,f.runtime);assert.deepEqual(restored.checkpoint(),loaded.checkpoint);assert.equal(restored.field.fader.projection!.rendererColor.a,1);
 assert(restored.field.startEvent('fade-go-next'));restored.advance(10);assert.equal(restored.field.stop?.kind,'map-transition');const prior=restored.field.fader.projection,candidate=restored.world.prepare(f.world,f.target);assert.deepEqual(candidate.field.fader.projection,prior);assert(restored.world.commit(candidate));restored.advance(10);assert(restored.checkpointReady);assert.deepEqual(restored.field.fader.projection,prior);
 await storage.save(restored.checkpoint(),1);const mapped=(await storage.load())!;const mappedAgain=GameSession.restore(mapped.checkpoint,f.field,f.battle,{catalog:f.world,map:f.target},f.runtime);assert.deepEqual(mappedAgain.checkpoint(),mapped.checkpoint);
});

test('pause and unexpected external owner writes cannot advance or silently rebind a live battle',()=>{
 const f=fadeSessionFixture(),{game,flow}=f;assert(game.prepareBattleStart()!.commit());flow.advance(10,ready);const battle=game.battle!,snapshot=game.field.fader.snapshot();flow.pause(true);flow.advance(200,ready);assert.deepEqual(game.field.fader.snapshot(),snapshot);flow.pause(false);
 game.field.fader.advance(0);assert.throws(()=>game.advance(10),/changed outside/);assert.equal(battle.fadeExecution.filter(e=>e.action==='start').length,1);
});


test('a later frame failure preserves earlier committed fade time, actual damage and paid MP while retrying only the failed frame',()=>{
 const p=forcedProgram(-2);p.instructions.splice(1,0,{mnemonic:'BattlePause',op:{kind:'pause',enabled:true}},
  {mnemonic:'BattleAction',op:{kind:'script-action',actor:{side:'player',id:1000},target:{side:'enemy',id:1},sourceActorKind:1,sourceTargetKind:2,abilityId:10,asynchronous:true}},
  {mnemonic:'BattleSyncAction',op:{kind:'sync-action'}},{mnemonic:'PlayBattleEffect',op:authoredBattleEffect(1,1000)});p.end+=4;
 const c=battleMessageContent(p);c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=9999;c.abilities[10]!.cost=2;
 const owner=new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE);let fail=true;
 const effects:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(){return{validate(){if(fail)throw Error('Controlled postdamage dependency');},status(){return 'ready';},commit(){},discard(){}};}};
 const b=new BattleGame(c,99,undefined,undefined,undefined,undefined,undefined,undefined,{...host(owner),scriptedActions:'web-source-scripted-battle-actions-v1',effects});
 const mp=b.players[0]!.mp;let previous!: {time:number;fade:ReturnType<FieldFadeState['snapshot']>;hp:number;mp:number;action:unknown},failed=false;
 for(let i=0;i<2000;i++){
  previous={time:b.time,fade:owner.snapshot(),hp:b.enemies[0]!.hp,mp:b.players[0]!.mp,action:structuredClone(b.action)};
  try{b.advance(10);}catch(e){assert.match(String(e),/Controlled postdamage dependency/);failed=true;break;}
 }
 assert(failed);assert(previous.time>100);assert(previous.hp<9999);assert.equal(previous.mp,mp-2);assert.equal(b.time,previous.time);assert.deepEqual(owner.snapshot(),previous.fade);assert.equal(b.enemies[0]!.hp,previous.hp);assert.equal(b.players[0]!.mp,previous.mp);assert.deepEqual(b.action,previous.action);
 fail=false;b.advance(0);assert.equal(b.phase,'forced');assert.equal(b.enemies[0]!.hp,previous.hp);assert.equal(b.players[0]!.mp,previous.mp);assert.notDeepEqual(owner.snapshot(),previous.fade);assert.equal(b.fadeExecution.filter(e=>e.action==='start').length,1);
});


test('cancelled and successful fixed-entry retries keep the shared committed manager and revoke the old Battle owner',()=>{
 const f=fadeSessionFixture(forcedProgram(.7)),{game}=f;assert(game.prepareBattleStart()!.commit());game.advance(10);
 const old=game.battle!,owner=game.field.fader;
 // Explicit runtime defeat fixture; source scripts and source states stay intact.
 for(const player of old.players){player.hp=0;player.conditionIds=[305];}game.advance(10);assert.equal(old.phase,'defeat');
 const before=owner.snapshot(),revision=owner.mutationRevision,owned=game.state.snapshot();
 const cancelled=game.prepareBattleRetry()!;cancelled.discard();assert.equal(game.battle,old);assert.deepEqual(owner.snapshot(),before);assert.equal(owner.mutationRevision,revision);assert.deepEqual(game.state.snapshot(),owned);
 const retry=game.prepareBattleRetry()!;assert(retry.commit());const replacement=game.battle!;assert.notEqual(replacement,old);assert.equal(game.field.fader,owner);assert.deepEqual(owner.snapshot(),before);assert.equal(owner.mutationRevision,revision);assert.equal(replacement.time,0);assert.equal(replacement.fadeExecution.length,0);assert.throws(()=>old.advance(10),/Retired/);
 game.advance(10);assert.equal(replacement.fadeExecution.filter(e=>e.action==='start').length,1);assert.equal(replacement.eventExecution?.state?.wait?.kind,'global-fade');assert(owner.projection!.imageColor.a>=before!.imageColor.a);assert.deepEqual(game.state.snapshot(),owned);
 for(let i=0;i<200&&replacement.phase==='active';i++)game.advance(10);assert.equal(replacement.phase,'forced');assert.equal(replacement.fadeExecution.filter(e=>e.action==='complete').length,1);assert(game.prepareBattleReturn()!.commit());assert.equal(game.state.snapshot().completedBattles.length,1);
});
