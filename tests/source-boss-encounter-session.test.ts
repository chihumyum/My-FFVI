import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceBossEncounterSessionFixture,encounterReady } from './fixtures/source-boss-encounter-session.js';
import { GameBattleHandoff } from '../src/core/game-battle-handoff.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameCommands } from '../src/core/game-commands.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
const host={prepareStart:async()=>({kind:'start'}),prepareReturn:async()=>({kind:'return'}),discard(){}};
function begin(f:ReturnType<typeof sourceBossEncounterSessionFixture>,name='source-fight'){
  const live=f.make();assert.equal(live.game.field.startEvent(name),true);
  for(let i=0;i<100&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);
  return live;
}
function win(live:ReturnType<typeof begin>){const battle=live.game.battle!;
  for(let i=0;i<2000&&battle.phase==='active';i++){for(const actor of battle.ready){const enemy=battle.enemies.find(x=>x.hp>0);if(enemy)live.commands.command(battle,actor.id,10,{kind:'single',id:enemy.id},100);}live.flow.advance(20,encounterReady);}
  assert.equal(battle.phase,'victory');return battle;
}
test('Boss media failure/cancel/retry preserves native player, camera, bank and RNG; real victory returns once and restore continues',async()=>{
  const f=sourceBossEncounterSessionFixture(),live=begin(f),{game,flow}=live,field=game.field;
  assert.equal(field.stop?.kind,'encounter',field.stop?.message);assert.ok(field.stop?.sourceBoss);
  assert.throws(()=>game.prepareCommittedBattleResult(),/uncommitted/,'a new pending entry cannot read an earlier terminal value');
  const before=structuredClone({owned:game.state.snapshot(),native:field.nativeActorStateFingerprint,camera:field.cameraSnapshot,events:field.eventState.snapshot(),stop:field.stop}),player=field.player,entity=player.native!.entity;
  const pos=structuredClone(entity.position);assert.notDeepEqual(pos,field.cameraSnapshot!.dummy.position,'fixture moved only the camera');
  let fail=true,failReturn=true;const h=new GameBattleHandoff(flow,{...host,prepareStart:async()=>{if(fail)throw new Error('media rejected');return {kind:'start'};},prepareReturn:async()=>{if(failReturn)throw new Error('return media rejected');return {kind:'return'};}});
  assert.equal((await h.start()).status,'failed');assert.deepEqual(game.state.snapshot(),before.owned);assert.deepEqual(field.nativeActorStateFingerprint,before.native);
  assert.throws(()=>game.prepareCommittedBattleResult(),/uncommitted/);
  let release!:(x:{kind:string})=>void;const media=new Promise<{kind:string}>(yes=>{release=yes;}),cancel=new GameBattleHandoff(flow,{...host,prepareStart:()=>media});
  const time=field.time,pending=cancel.start();for(let i=0;i<20;i++)flow.advance(16,encounterReady);assert.equal(field.time,time,'actual Flow pauses a legal pending entry');cancel.cancel();release({kind:'start'});assert.equal((await pending).status,'cancelled');
  assert.deepEqual({owned:game.state.snapshot(),native:field.nativeActorStateFingerprint,camera:field.cameraSnapshot,events:field.eventState.snapshot(),stop:field.stop},before);
  fail=false;assert.equal((await h.start()).status,'committed');assert.equal(field.player,player);assert.equal(player.native!.entity,entity);assert.deepEqual(entity.position,pos,'Boss does not inherit ordinary camera-to-player sync');
  assert.equal(game.battle!.playerControlMode,'manual');assert.throws(()=>game.prepareCommittedBattleResult(),/uncommitted/);
  const battle=win(live);assert.throws(()=>game.prepareCommittedBattleResult(),/uncommitted/,'unreturned victory is not a terminal receipt');
  assert.equal((await h.return()).status,'failed');assert.equal(game.state.snapshot().completedBattles.length,0);
  assert.equal(game.battle,battle);assert.deepEqual(game.state.snapshot(),before.owned);assert.throws(()=>game.prepareCommittedBattleResult(),/uncommitted/);
  failReturn=false;
  assert.equal((await h.return()).status,'committed');assert.deepEqual(game.prepareCommittedBattleResult().receipt,{serial:0,encounterId:f.partyId,outcome:'victory'});
  flow.advance(10,encounterReady);assert.equal(field.eventState.read({category:'ScriptLocalVariable',index:0}),1);
  for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,encounterReady);assert.equal(game.checkpointReady,true,field.stop?.message);
  await assert.rejects(()=>h.return(),/requires/);assert.equal(game.state.snapshot().completedBattles.length,1);
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}},'framework','boss-mechanism');
  await storage.save(game.checkpoint(),100);const saved=(await storage.load())!;const restored=f.restore(saved.checkpoint),nextFlow=new GameFlow(restored);nextFlow.start();nextFlow.advance(0,encounterReady);
  assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert.equal(restored.prepareCommittedBattleResult().value,1);
  assert.equal(restored.field.startEvent('query'),true);nextFlow.advance(10,encounterReady);assert.equal(restored.field.eventState.read({category:'ScriptLocalVariable',index:0}),1);nextFlow.advance(100,encounterReady);
  assert.equal(live.commands.command(battle,game.players[0]!.id,10,'retired',100),false);
  assert.equal(restored.field.startEvent('source-next'),true);const next=new GameBattleHandoff(nextFlow,host);assert.equal((await next.start()).status,'committed');win({game:restored,flow:nextFlow,commands:new GameCommands(nextFlow,restored)});assert.equal((await next.return()).status,'committed');nextFlow.advance(100,encounterReady);
  assert.equal(restored.state.snapshot().completedBattles.length,2);assert.equal(restored.checkpointReady,true);
});
test('fresh result needs a source initialization and a real frame; source policy and request tampering remain blocked',()=>{
  const f=sourceBossEncounterSessionFixture(),live=f.make();assert.equal(live.game.prepareCommittedBattleResult().value,0);
  assert.equal(live.game.field.startEvent('query'),true);live.flow.advance(10,encounterReady);assert.equal(live.game.field.eventState.read({category:'ScriptLocalVariable',index:0}),0);
  const noFrame=sourceBossEncounterSessionFixture({missingResultFrame:true}),second=noFrame.make();assert.equal(second.game.field.startEvent('query'),true);second.flow.advance(10,encounterReady);assert.equal(second.game.field.stop?.kind,'unsupported');assert.equal(second.game.state.snapshot().completedBattles.length,0);
  const missing=begin(sourceBossEncounterSessionFixture({policy:false}));assert.equal(missing.game.field.stop?.kind,'unsupported');assert.equal(missing.game.state.inBattle,false);
  const changed=begin(sourceBossEncounterSessionFixture()),stop=changed.game.field.stop;assert.equal(stop?.kind,'encounter');assert.ok(stop&&stop.kind==='encounter'&&stop.sourceBoss);stop.sourceBoss.command.focusCell.x++;
  assert.throws(()=>changed.game.prepareBattleStart(),/Stale/);assert.equal(changed.game.state.inBattle,false);
});
test('real defeat keeps the previous committed result inaccessible and fixed-entry retry does not settle or reward',async()=>{
  const f=sourceBossEncounterSessionFixture({lethalNextBattle:true}),live=begin(f),h=new GameBattleHandoff(live.flow,host);
  assert.equal((await h.start()).status,'committed');win(live);assert.equal((await h.return()).status,'committed');live.flow.advance(100,encounterReady);
  const before=live.game.state.snapshot();assert.equal(live.game.prepareCommittedBattleResult().value,1);
  assert.equal(live.game.field.startEvent('source-next'),true);assert.equal((await h.start()).status,'committed');const battle=live.game.battle!;
  for(let i=0;i<5000&&battle.phase==='active';i++)live.flow.advance(20,encounterReady);
  assert.equal(battle.phase,'defeat');assert.throws(()=>live.game.prepareCommittedBattleResult(),/uncommitted/);
  assert.equal((await h.retry()).status,'committed');assert.notEqual(live.game.battle,battle);assert.equal(live.game.battle!.phase,'active');
  assert.deepEqual(live.game.state.snapshot(),before);assert.equal(live.game.state.snapshot().completedBattles.length,1);assert.equal(live.game.checkpointReady,false);
});
test('a real ordinary escape after Boss victory commits its own result and never reuses the previous Win',async()=>{
  const f=sourceBossEncounterSessionFixture({walking:true}),live=begin(f),h=new GameBattleHandoff(live.flow,host);
  assert.equal((await h.start()).status,'committed');win(live);assert.equal((await h.return()).status,'committed');live.flow.advance(100,encounterReady);
  const rewarded=live.game.state.snapshot();assert.equal(live.game.prepareCommittedBattleResult().value,1);
  assert.equal(live.flow.move('right'),true);live.flow.advance(240,encounterReady);
  assert.equal(live.game.field.stop?.kind,'encounter');assert.equal((await h.start()).status,'committed');
  const battle=live.game.battle!;assert.equal(live.commands.canEscape(battle),true);assert.equal(live.commands.requestEscape(battle),true);
  live.flow.advance(10,encounterReady);assert.equal(battle.phase,'escaped');assert.throws(()=>live.game.prepareCommittedBattleResult(),/uncommitted/);
  assert.equal((await h.return()).status,'committed');live.flow.advance(10,encounterReady);
  const current=live.game.state.snapshot();assert.equal(current.gil,rewarded.gil);assert.equal(current.completedBattles.length,2);
  const result=live.game.prepareCommittedBattleResult();assert.equal(result.value,3);
  assert.deepEqual(result.receipt,{serial:1,encounterId:f.partyId,outcome:'escaped'});result.validate();
  assert.equal(live.game.field.startEvent('query'),true);live.flow.advance(10,encounterReady);
  assert.equal(live.game.field.eventState.read({category:'ScriptLocalVariable',index:0}),3);live.flow.advance(100,encounterReady);
  const saved=live.game.checkpoint(),restored=f.restore(saved);assert.equal(restored.prepareCommittedBattleResult().value,3);
  assert.deepEqual(restored.state.snapshot().completedBattles,current.completedBattles);
});
