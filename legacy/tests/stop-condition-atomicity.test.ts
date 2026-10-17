import {FieldFadeState,DEVELOPMENT_TRANSPARENT_FADE} from '../src/core/field-fade.js';
import {WEB_BATTLE_GLOBAL_FADE} from '../src/core/battle-global-fade.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {BattleGame} from '../src/core/battle.js';import {SourceMessageState} from '../src/core/source-message.js';
import {createWebFieldMessageSequencePort} from '../src/core/source-message-sequence.js';import {WEB_BATTLE_EVENT_MESSAGE_POLICY} from '../src/core/battle-event-message.js';
import {createWebBattleEventEffectHost,WEB_BATTLE_EVENT_EFFECTS,type BattleEventEffectHost} from '../src/core/battle-event-effect.js';
import {EventState} from '../src/core/event-state.js';import {battleEventSharedSnapshot} from '../src/core/battle-event-shared.js';
import {battleMessageProgram,messageRaw} from './fixtures/battle-event-message.js';import {authoredBattleEffect} from './fixtures/battle-event-effect.js';import {stopConditionContent} from './fixtures/stop-condition.js';
test('actual Stop + Msg + effect + shared writes roll back one failed frame before cleanup, then publish once and survive cleanup failure',()=>{
 const {content}=stopConditionContent(),p=battleMessageProgram([messageRaw('Nop'),messageRaw('Wait',.409),messageRaw('Nop'),messageRaw('Msg',-1,'ASYNC'),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Exit')]);
 p.instructions[0]!.op={kind:'end-enabled',enabled:false};p.instructions[2]!.op=authoredBattleEffect(1);
 p.instructions[4]!.op={kind:'calc',index:0,operator:'＋',right:{kind:'immediate',value:1}};
 p.instructions[5]!.op={kind:'variable-calc',left:{category:'ScenarioVariable',index:3},operator:'＋',right:{kind:'immediate',value:1}};
 content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:9,program:p};content.battleEvents={conditions:content.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 content.players[0]!.conditionIds=[110];const owner=new SourceMessageState(),shared=battleEventSharedSnapshot(EventState.initialized()),base=createWebBattleEventEffectHost();
 let b!:BattleGame,fail=true,mask=3;const cleaned:unknown[]=[],late:boolean[]=[];
 const host:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const lease=base.prepare(request),index=late.push(false)-1;return{...lease,status(){return late[index]?'ready':lease.status();},discard(){cleaned.push(snapshot());throw Error('authored cleanup failure');}};}};
 b=new BattleGame(content,314,undefined,undefined,undefined,undefined,shared,undefined,{effects:host,messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),prepareEffects(){const previous=mask;return{validate(){assert.equal(mask,previous);},commit(){if(fail)throw Error('authored message commit failure');mask=previous+1;}};}}});
 function snapshot(){return structuredClone({units:b.combatants,time:b.time,action:b.action,pending:b.pendingActions,tickets:b.actionExecutor,
  poison:b.conditionClockState('a'),control:b.controlClockState('a'),random:Reflect.get(b,'randomState'),event:b.eventExecution,shared:b.eventSharedReturn,
  message:owner.snapshot(),revision:owner.mutationRevision,effects:b.effectPresentation,effectJournal:b.effectExecution,mask});}
 b.advance(10);assert(b.command('b',901,'a'));b.advance(400);assert.equal(b.action!.elapsed,390);assert.equal(owner.active,false);assert.equal(b.effectPresentation.length,0);
 const before=snapshot();assert.throws(()=>b.advance(10),/authored message commit failure/);assert.deepEqual(snapshot(),before);assert.deepEqual(cleaned,[before]);assert.deepEqual(b.effectCleanupFailures,[{reason:'rollback',time:410}]);
 fail=false;b.advance(0);assert(b.isStopped('a'));assert(b.conditionClockState('a')[0]!.isTimeStop);assert.equal(b.players[1]!.mp,198);assert(owner.active);assert.equal(mask,4);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.eventSharedReturn!.candidate.global[3],1);
 const published=snapshot();late[0]=true;assert.deepEqual(snapshot(),published,'old candidate completion cannot change new lease or published frame');
 b.advance(400);assert(b.isStopped('a'));assert(b.conditionClockState('a')[0]!.isTimeStop);assert.equal(b.players[1]!.mp,198);assert.equal(mask,4);assert.equal(b.eventSharedReturn!.candidate.global[3],1);
 assert(b.effectCleanupFailures.some(x=>x.reason==='complete'));assert.equal(b.effectPresentation.length,0);
});

test('external resource commit invalidation is rejected before Stop/Msg/fade/mask publication; every throwing cleanup sees restored owners',()=>{
 for(const invalidation of ['lease','fade-candidate'] as const){
  const {content}=stopConditionContent(),p=battleMessageProgram([messageRaw('Nop'),messageRaw('Wait',.409),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Msg',-1,'ASYNC'),messageRaw('Nop'),messageRaw('Exit')]);
  p.instructions[0]!.op={kind:'end-enabled',enabled:false};p.instructions[2]!.op=authoredBattleEffect(1);p.instructions[3]!.op=authoredBattleEffect(1);
  p.instructions[5]!.op={kind:'variable-calc',left:{category:'ScenarioVariable',index:3},operator:'＋',right:{kind:'immediate',value:1}};
  content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:9,program:p};content.battleEvents={conditions:content.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  content.players[0]!.conditionIds=[110];
  const owner=new SourceMessageState(),fade=new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE),base=createWebBattleEventEffectHost(),shared=battleEventSharedSnapshot(EventState.initialized());
  let b!:BattleGame,fail=true,mask=3,candidate:FieldFadeState,frameCleanup=false;const stale:boolean[]=[],cleaned:unknown[]=[],frames:string[]=[];
  const originalMessage=owner.prepareFrame.bind(owner),originalFade=fade.prepareFrame.bind(fade);
  owner.prepareFrame=()=>{const f=originalMessage();return{...f,discard(){f.discard();if(frameCleanup){frames.push('message');assert.deepEqual(snapshot(),before);throw Error('message cleanup failure');}}};};
  fade.prepareFrame=()=>{const f=originalFade();candidate=f.state;return{...f,discard(){f.discard();if(frameCleanup){frames.push('fade');assert.deepEqual(snapshot(),before);throw Error('fade cleanup failure');}}};};
  const effects:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const lease=base.prepare(request),index=stale.push(false)-1;return{...lease,
   validate(){lease.validate();if(stale[index])throw Error('actual effect lease invalidated by later resource commit');},
   commit(){lease.commit();if(index===1&&fail){if(invalidation==='lease')stale[0]=true;else candidate.advance(0);}},
   discard(){lease.discard();cleaned.push(snapshot());throw Error('resource cleanup failure');}};}};
  b=new BattleGame(content,314,undefined,undefined,undefined,undefined,shared,undefined,{effects,fade:{policy:WEB_BATTLE_GLOBAL_FADE,owner:fade},messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),prepareEffects(){const previous=mask;return{validate(){assert.equal(mask,previous);},commit(){mask=previous+1;}};}}});
  function snapshot(){return structuredClone({units:b.combatants,time:b.time,action:b.action,pending:b.pendingActions,tickets:b.actionExecutor,
   poison:b.conditionClockState('a'),control:b.controlClockState('a'),random:Reflect.get(b,'randomState'),event:b.eventExecution,shared:b.eventSharedReturn,
   message:owner.snapshot(),revision:owner.mutationRevision,fade:fade.snapshot(),fadeRevision:fade.mutationRevision,effects:b.effectPresentation,effectJournal:b.effectExecution,mask});}
  b.advance(10);assert(b.command('b',901,'a'));b.advance(400);const before=snapshot();frameCleanup=true;
  assert.throws(()=>b.advance(10),invalidation==='lease'?/actual effect lease invalidated/:/Global fade candidate changed/);
  assert.deepEqual(snapshot(),before);assert.deepEqual(frames,['message','fade']);assert.deepEqual(cleaned,[before,before]);
  assert.deepEqual(b.frameCleanupFailures,[{owner:'message',time:410},{owner:'fade',time:410}]);assert.equal(b.effectCleanupFailures.length,2);
  fail=false;frameCleanup=false;b.advance(0);assert(b.isStopped('a'));assert(b.conditionClockState('a')[0]!.isTimeStop);assert(owner.active);assert.equal(mask,4);assert.equal(b.players[1]!.mp,198);assert.equal(b.eventSharedReturn!.candidate.global[3],1);
 }
});

import {WEB_BATTLE_EVENT_CONDITIONS} from '../src/core/battle-event-condition.js';
import {participantProgram} from './fixtures/battle-participant-game.js';
import {gauSessionFixture} from './fixtures/battle-gau-instances.js';
import {GameSession} from '../src/core/game-session.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import type {BattleGauOwnedFrame} from '../src/core/battle-gau-instances.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
const list=(side:'player'|'enemy',id:number,conditionId:number,action:'add'|'recover'):BattleEventOp=>({kind:'condition-list',target:{side,id},conditionId,action});
test('direct source-list Stop uses the actual ready ticket, Poison instance writes and independent Sleep contribution',()=>{
 for(const [queued,initialSleep]of [[false,false],[true,false],[false,true]]){
  const {content}=stopConditionContent();content.abilities[10]!.wait=100;if(initialSleep)content.players[0]!.conditionIds=[2907];
  const ops:BattleEventOp[]=[{kind:'wait',seconds:.001},list('player',1000,110,'add'),list('player',1000,1907,'add'),{kind:'wait',seconds:.03},
   list('player',1000,110,'recover'),list('player',1000,110,'add'),{kind:'wait',seconds:.03},
   list('player',1000,1907,'recover'),{kind:'wait',seconds:.03},{kind:'exit'}];
  content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:19,program:participantProgram(ops)};
  content.battleEvents={conditions:content.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  const b=new BattleGame(content,19,undefined,undefined,undefined,undefined,undefined,undefined,{conditions:WEB_BATTLE_EVENT_CONDITIONS});
  b.advance(10); // Start the deferred root and yield its real first Wait clock.
  if(queued){assert(b.command('a',10,'e1'));assert(b.pendingActions.some(action=>action.actor==='a'));}else b.players[0]!.atb=63;
  for(let i=0;i<5&&!b.isStopped('a');i++)b.advance(10);assert(b.isStopped('a'));assert(b.conditionClockState('a')[0]!.isTimeStop);assert(!b.pendingActions.some(action=>action.actor==='a'));
  assert.equal(b.actionExecutor.fixedPlayerActions.length,0);assert.equal(b.players[0]!.mp,200);
  if(queued)assert.equal(b.players[0]!.atb,0);else assert(b.players[0]!.atb>=63,'Start cannot zero a bare gauge');
  for(let i=0;i<10&&b.conditionExecution.length<4;i++)b.advance(10);
  assert.equal(b.conditionClockState('a')[0]!.isTimeStop,false,'Re-added Poison is a new instance while Stop still exists');assert(b.isStopped('a'));
  for(let i=0;i<10&&b.isStopped('a');i++)b.advance(10);
  assert(!b.isStopped('a'));assert.equal(b.players[0]!.atb,0);if(initialSleep){assert(b.players[0]!.conditionIds.includes(2907));assert(!b.canUse('a',10));}
 }
});
function addGauStopCatalog(f:ReturnType<typeof gauSessionFixture>){
 const c=f.catalog.common.conditions;c.rules.definitions.push({id:400017,type:17,overlapped:false,eraseGroupId:9000},{id:400010,type:10,overlapped:false,eraseGroupId:9000});
 c.rules.eraseRules.push({id:9000,groupId:9000,conditionId:0,type:2,eraseConditionId:0});
 c.behaviors.push({id:400017,kind:'stop',name:'Authored Stop',untilType:7,untilValue:30},{id:400010,kind:'poison',name:'Authored Poison',untilType:3,hpDivisor:16});
 f.catalog.common.conditionControlPolicy={kind:'web-source-control-actions-v1'};
 f.catalog.common.battleEvents!.conditions.push({id:400017,type:17,attackTarget:0,gameOverTarget:0},{id:400010,type:10,attackTarget:0,gameOverTarget:0});
}
test('actual Gau owned candidate invalidated by a resource callback rejects Stop/Msg/fade/mask before publication, retries and returns once through Storage',async()=>{
 const message=battleMessageProgram([messageRaw('Msg',-1,'ASYNC'),messageRaw('Nop')]).instructions[0]!.op;
 const f=gauSessionFixture([list('player',1,400010,'add'),list('player',1,400017,'add'),{kind:'gau-join'},authoredBattleEffect(1,1),message,
  {kind:'variable-calc',left:{category:'ScenarioVariable',index:3},operator:'＋',right:{kind:'immediate',value:1}},
  {kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}]);addGauStopCatalog(f);f.field.entry.fade=structuredClone(DEVELOPMENT_TRANSPARENT_FADE);
 let g!:GameSession,held!:BattleGauOwnedFrame,fail=true;const base=createWebBattleEventEffectHost(),cleaned:unknown[]=[];
 const effects:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const lease=base.prepare(request);return{...lease,commit(){lease.commit();if(fail)held.join({sourceId:2,firstEncounter:false});},discard(){lease.discard();cleaned.push(snapshot());throw Error('authored post-restore cleanup failure');}};}};
 const runtime={...f.runtime,battleGlobalFade:WEB_BATTLE_GLOBAL_FADE,battleEventConditions:WEB_BATTLE_EVENT_CONDITIONS,battleEventEffects:effects,battleEventMessages:WEB_BATTLE_EVENT_MESSAGE_POLICY,sourceMessageSequence:createWebFieldMessageSequencePort()};
 g=new GameSession(f.field,f.catalog,71,runtime);g.state.fieldRoster.prepare({kind:'secede',sourceId:2,removeEquipment:false,refreshActors:true}).commit();g.field.eventState.write({category:'ScenarioVariable',index:8},1);g.field.eventState.write({category:'ScenarioVariable',index:3},0);
 const actual=g.state.battleGauOwnedHost.bind(g.state);g.state.battleGauOwnedHost=lease=>{const host=actual(lease);return{...host,prepareFrame(){held=host.prepareFrame();const discard=held.discard.bind(held);held.discard=()=>{discard();throw Error('authored owned cleanup failure');};return held;}};};
 g.advance(0);assert(g.field.startEvent('fight'));g.advance(10);assert(g.prepareBattleStart()!.commit());const b=g.battle!;
 function snapshot(){return structuredClone({units:g.battle!.combatants,time:g.battle!.time,event:g.battle!.eventExecution,conditions:g.battle!.conditionExecution,
  poison:g.battle!.conditionClockState(g.battle!.players[0]!.id),control:g.battle!.controlClockState(g.battle!.players[0]!.id),shared:g.battle!.eventSharedReturn,
  message:g.field.sourceMessage.snapshot(),messageRevision:g.field.sourceMessage.mutationRevision,fade:g.field.fader.snapshot(),fadeRevision:g.field.fader.mutationRevision,
  mask:g.field.updateAttributeMask,owned:g.state.snapshot(),gau:g.battle!.gauInstanceExecution});}
 const before=snapshot();assert.throws(()=>g.advance(10),/Source Gau owned frame changed after preparation/);assert.deepEqual(snapshot(),before);assert.deepEqual(cleaned,[before]);
 assert(b.frameCleanupFailures.some(row=>row.owner==='owned'));assert.equal(b.effectCleanupFailures.length,1);
 fail=false;g.advance(10);assert.equal(b.phase,'forced');assert(b.isStopped(b.players[0]!.id));assert(b.conditionClockState(b.players[0]!.id)[0]!.isTimeStop);assert(g.field.sourceMessage.active);
 assert.equal(b.gauInstanceExecution.journal.filter(row=>row.action==='join').length,1);assert.equal(b.eventSharedReturn!.candidate.global[3],1);assert.deepEqual(g.state.snapshot(),before.owned);
 assert(g.prepareBattleReturn()!.commit());assert(g.state.snapshot().roster.find(row=>row.id==='b')!.enabled);assert(g.state.snapshot().roster.every(row=>!row.conditionIds.includes(400017)));assert.throws(()=>b.advance(10),/Retired/);
 g.advance(2000);assert(g.checkpointReady);const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:key=>bytes.get(key)??null,setItem:(key,value)=>{bytes.set(key,value);}});
 await storage.save(g.checkpoint(),0);const saved=(await storage.load())!,restored=GameSession.restore(saved.checkpoint,f.field,g.battleCatalog,undefined,runtime);assert.deepEqual(restored.state.snapshot(),g.state.snapshot());
});
test('actual Gau party retirement drops old Stop/Poison clocks and failure restores those exact instance owners',()=>{
 const f=gauSessionFixture([list('enemy',2,400010,'add'),list('enemy',2,400017,'add'),{kind:'wait',seconds:.03},{kind:'gau-replace'},
  {kind:'wait',seconds:.03},{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}]);addGauStopCatalog(f);
 let fail=true;const media=f.runtime.battleGauInstances;const runtime={...f.runtime,battleEventConditions:WEB_BATTLE_EVENT_CONDITIONS,
  battleGauInstances:{...media,prepare(request:Parameters<typeof media.prepare>[0]){const lease=media.prepare(request);return{...lease,commit(){if(fail)throw Error('authored Gau replacement media commit');lease.commit();}};}}};
 const g=new GameSession(f.field,f.catalog,71,runtime);g.field.eventState.write({category:'ScenarioVariable',index:8},1);g.field.eventState.write({category:'ScenarioVariable',index:3},0);g.advance(0);assert(g.field.startEvent('fight'));g.advance(10);assert(g.prepareBattleStart()!.commit());const b=g.battle!,old=b.enemies[0]!;
 g.advance(10);assert(b.isStopped(old.id));assert(b.conditionClockState(old.id)[0]!.isTimeStop);
 let failed=false;for(let i=0;i<10;i++){const before={units:structuredClone(b.combatants),time:b.time,poison:b.conditionClockState(old.id),control:b.controlClockState(old.id),gau:b.gauInstanceExecution};
  try{g.advance(10);}catch(error){assert.match(String(error),/authored Gau replacement media commit/);assert.deepEqual({units:b.combatants,time:b.time,poison:b.conditionClockState(old.id),control:b.controlClockState(old.id),gau:b.gauInstanceExecution},before);failed=true;break;}}
 assert(failed);fail=false;for(let i=0;i<10&&b.enemies.includes(old);i++)g.advance(10);assert(!b.enemies.includes(old));
 assert.throws(()=>b.conditionClockState(old.id),/Unknown condition clock owner/);assert.throws(()=>b.controlClockState(old.id),/Unknown condition-control owner/);
 for(const unit of b.enemies){assert(!b.isStopped(unit.id));assert.deepEqual(b.conditionClockState(unit.id),[]);assert.deepEqual(b.controlClockState(unit.id),[]);assert(!unit.conditionIds.includes(400017));}
});
