import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterGroupsSessionFixture, rosterGroupHost } from './fixtures/roster-groups-session.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { GameMapLoader } from '../src/core/game-map-loader.js';
import { GameSession } from '../src/core/game-session.js';

const sourceIds=(f:ReturnType<typeof rosterGroupsSessionFixture>,slot:readonly{id:string|null}[])=>slot.map(c=>c.id===null?null:c.id===f.first?2:Number(c.id.split('-').at(-1)));

test('source parameters create eleven actual held owners through one Session, preserve all three Corps and borrow/return one current group',async()=>{
 const f=rosterGroupsSessionFixture(),h=f.make(),initial=h.game.state.snapshot(),player=h.game.field.player;
 f.run(h,'group-source-sequence');assert.equal(h.game.field.stop,null);
 const joined=h.game.state.snapshot();assert.equal(joined.roster.length,12);
 assert.deepEqual(joined.roster.slice(1).map(x=>x.sourceId),[19,20,21,22,23,24,25,26,27,28,11]);
 assert.deepEqual(joined.roster.map(x=>x.ownedId),Array.from({length:12},(_,i)=>i+1));
 assert.deepEqual(joined.party.slots.map(s=>sourceIds(f,s)),[[2,19,20,21],[11,22,23,24],[25,26,27,28]]);
 assert.equal(h.game.field.player,player);assert.deepEqual(initial.roster.map(x=>x.sourceId),[2]);
 const stock=structuredClone(joined.equipmentStock),names=structuredClone(joined.characterNames);
 f.run(h,'group-join');assert.equal(h.game.field.stop,null);
 assert.deepEqual(h.game.state.snapshot().equipmentStock,stock,'existing held group must not run fullJoin gear reissue');
 assert.deepEqual(h.game.state.snapshot().characterNames,names);
 for(let slot=0;slot<3;slot++) {
  f.run(h,'group-select-'+slot);assert.equal(h.game.field.stop,null);
  assert.equal(h.game.state.snapshot().party.selectedSlot,slot);
  assert.equal(h.game.state.partyPlayers().length,4);
 }
 f.startBattle(h.game);assert.equal(h.game.battle!.players.length,4);
 assert.deepEqual(h.game.battle!.players.map(x=>x.sourceId),[25,26,27,28]);
 assert.throws(()=>h.game.state.fieldRoster.prepareGroup!({kind:'secede',group:'moogles'}),/active battle/);
 f.previewVictory(h.game);assert(h.game.continueVictory());h.game.advance(10);assert.equal(h.game.continueVictory(),false);
 assert.equal(h.game.state.snapshot().completedBattles.length,1);assert(h.game.checkpointReady);
 assert.deepEqual(h.game.state.snapshot().party.slots,joined.party.slots);
 const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
 const saved=h.game.checkpoint();(await storage.prepareSave(saved,0)).commit();
 const restored=f.restore((await storage.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),saved);
 const forged=structuredClone(saved);Object.assign(forged.owned,{sourceRosterGroups:{kind:'source-roster-groups-v1'}});
 assert.throws(()=>f.restore(forged));assert.deepEqual(restored.checkpoint(),saved);
});

test('every secede refresh and final SwitchSlot use actual actor ownership, including an empty current second/third bank',()=>{
 for(const slot of [0,1,2]) {
  const f=rosterGroupsSessionFixture(),h=f.make();f.run(h,'group-source-sequence');assert.equal(h.game.field.stop,null);
  f.run(h,'group-select-'+slot);assert.equal(h.game.field.stop,null);
  const before=h.game.state.snapshot(),prepared=h.game.state.fieldRoster.prepareGroup!({kind:'secede',group:'moogles'});
  assert.equal(prepared.steps.length,12);assert.deepEqual(prepared.steps.map(s=>s.sourceId),[19,20,21,11,22,23,24,25,26,27,28,null]);
  assert.deepEqual(h.game.state.snapshot(),before);
  const leaked=prepared.steps;leaked[0]!.appearance.activeMembers.length=0;
  assert.notDeepEqual(leaked,prepared.steps,'candidate observations cannot rewrite the private prepared appearance');
  f.run(h,'group-leave');assert.equal(h.game.field.stop,null);
  const after=h.game.state.snapshot();assert.equal(after.party.selectedSlot,0);
  assert.deepEqual(after.party.slots.map(s=>sourceIds(f,s)),[[2,null,null,null],[null,null,null,null],[null,null,null,null]]);
  assert.deepEqual(after.roster.filter(x=>x.enabled).map(x=>x.sourceId),[2]);
  for(const owner of before.roster.slice(1))assert.deepEqual(after.roster.find(x=>x.id===owner.id)!.equipment,owner.equipment);
  assert(h.game.checkpointReady);assert.deepEqual(f.restore(h.game.checkpoint()).checkpoint(),h.game.checkpoint());
 }
});

test('failed actual group media preparation publishes no state or actors; a clean restore retries the complete group exactly once',()=>{
 const bad=rosterGroupsSessionFixture({missingMedia:true}),h=bad.make(),before=h.game.state.snapshot(),actors=h.game.field.nativeActorStateFingerprint,checkpoint=h.game.checkpoint();
 bad.run(h,'group-join');assert.equal(h.game.field.stop?.kind,'unsupported');assert.match(h.game.field.stop!.message,/animation|media|appearance|Default/i);
 assert.deepEqual(h.game.state.snapshot(),before);assert.equal(h.game.field.nativeActorStateFingerprint,actors);
 const good=rosterGroupsSessionFixture(),fresh=good.make();
 assert.deepEqual(fresh.game.state.snapshot().roster.map(x=>x.sourceId),checkpoint.owned.roster.map(x=>x.sourceId));
 good.run(fresh,'group-join');assert.equal(fresh.game.field.stop,null);assert.equal(fresh.game.state.snapshot().roster.length,12);
});

test('candidate and current group transactions share one generation, reject stale/failed publications and cannot be granted by stored state',()=>{
 const f=rosterGroupsSessionFixture(),h=f.make(),before=h.game.state.snapshot();
 const tx=h.game.state.fieldRoster.prepareGroup!({kind:'join',group:'moogles'});
 assert.throws(()=>tx.commitWith(()=>{throw new Error('Controlled group publish failure');}),/Controlled group/);
 assert.deepEqual(h.game.state.snapshot(),before);
 h.game.state.fieldRoster.prepare({kind:'unlock',sourceId:3,refreshActors:false}).commit();
 const changed=h.game.state.snapshot();assert.throws(()=>tx.commitWith(check=>check()),/Stale/);assert.deepEqual(h.game.state.snapshot(),changed);
 const draft=h.game.state.prepareFieldState(),candidate=draft.ports.roster.prepareGroup!({kind:'join',group:'moogles'});
 draft.ports.roster.prepare({kind:'unlock',sourceId:19,refreshActors:false}).commit();
 assert.throws(()=>candidate.commitWith(check=>check()),/Stale/);assert.deepEqual(h.game.state.snapshot(),changed);
 const missing=rosterGroupsSessionFixture({catalog:false}),m=missing.make();missing.run(m,'group-join');
 assert.match(m.game.field.stop!.message,/catalog is unavailable/);assert.equal(m.game.state.snapshot().roster.length,1);
});

test('map initialization cancellation/failure never adopts grouped ownership; fresh retry publishes one draft and old Field cannot replay it',async()=>{
 const f=rosterGroupsSessionFixture({targetInitializer:true}),h=f.make(),before=h.game.state.snapshot(),old=h.game.field;
 let mode:'hold'|'fail'|'ok'='hold',release!:(v:null)=>void,entered!:(v:null)=>void;
 let pending=new Promise<null>(resolve=>{entered=resolve;});
 const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{
   if(mode==='fail')throw new Error('Controlled group target media failure');
   if(mode==='hold'){entered(null);return new Promise<null>(resolve=>{release=resolve;});}return null;
 },discard(){}});
 f.run(h,'group-change-map');const loading=loader.load();const preparation=await Promise.race([pending.then(()=>null),loading]);assert.equal(preparation,null,preparation?.status==='failed'?String(preparation.error):preparation?.status);assert.deepEqual(h.game.state.snapshot(),before);
 loader.cancel();release(null);await loading;assert.deepEqual(h.game.state.snapshot(),before);assert.equal(h.game.field,old);
 assert.equal(h.game.field,old);
 mode='fail';assert.equal((await loader.load()).status,'failed');assert.deepEqual(h.game.state.snapshot(),before);
 mode='ok';assert.equal((await loader.load()).status,'committed');
 for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,rosterGroupHost);
 assert.equal(h.game.field.stop,null);assert.notEqual(h.game.field,old);assert.equal(h.game.state.snapshot().roster.length,12);
 const saved=h.game.checkpoint(),again=GameSession.restore(saved,undefined,f.battle,{catalog:f.world,map:f.destination,source:{content:f.content,initialMap:f.map}});
 assert.deepEqual(again.checkpoint(),saved);const current=h.game.state.snapshot();old.startEvent('group-leave');old.advance(10);assert.deepEqual(h.game.state.snapshot(),current);
});
