import test from'node:test';
import assert from'node:assert/strict';
import {rosterGroupsSessionFixture,rosterGroupHost}from'./fixtures/roster-groups-session.js';
import {GameMapLoader}from'../src/core/game-map-loader.js';
import {CheckpointStorage}from'../src/core/saved-game.js';
import {multiCorpsPreset}from'../src/core/field-multi-corps.js';
import {GameSession}from'../src/core/game-session.js';
import {WEB_RTS_PARTY_SWITCH}from'../src/core/field-rts-party.js';
function ready(options:{targetInitializer?:boolean;multiCorpsFailure?:boolean}={}){const f=rosterGroupsSessionFixture({rts:true,multiCorps:true,...options}),h=f.make();f.run(h,'group-source-sequence');assert.equal(h.game.field.stop,null,h.game.field.stop?.message);return{f,h};}
test('all four source deployment presets mutate the actual three factory actors and ScenarioVariables without moving player/camera or replacing any owner',()=>{
 for(const command of ['deploy-terra-defense','deploy-esper-defense','deploy-tower','deploy-phoenix']as const){
  const{f,h}=ready(),field=h.game.field,owned=h.game.state.snapshot(),player=field.player,native=player.native,pose={...native!.entity.position},camera=field.cameraSnapshot,
   before=field.nativeActorCandidate!,ids=before.bindings.otherParties,actors=new Map(Object.values(field.actors).map(a=>[a.id,a]));
  f.run(h,command);assert.equal(field.stop,null,field.stop?.message);assert(h.game.checkpointReady);assert.equal(field.player,player);assert.equal(player.native,native);assert.deepEqual(player.native!.entity.position,pose);assert.deepEqual(field.cameraSnapshot,camera);assert.deepEqual(h.game.state.snapshot(),owned);
  const preset=multiCorpsPreset(command)!;for(const[index,value]of [[4,0],[5,preset.count],[11,preset.mapId],[12,preset.mapId],[13,preset.mapId]]as const)assert.equal(field.eventState.read({category:'ScenarioVariable',index}),value);
  for(const a of Object.values(field.actors))assert.equal(a,actors.get(a.id));
  const placed=field.nativeActorCandidate!;assert.equal(placed.snapshot.actors.find(a=>a.id===ids[0])!.visible,false);assert.deepEqual(placed.snapshot.actors.find(a=>a.id===ids[0])!.position,{x:0,y:-1000,z:349});assert.equal(placed.snapshot.actors.find(a=>a.id===ids[0])!.direction,null);
  if(command==='deploy-phoenix')assert.equal(placed.snapshot.actors.find(a=>a.id===ids[1])!.animation!.snapshot()!.key,'Dying');
 }
});
test('dream split is visible to actual battle borrowing and return, Storage restore and rejoin without inventing a refresh',async()=>{
 const{f,h}=ready();
 for(const position of [0,1,2,3]as const)assert(h.game.changeParty({expected:h.game.state.snapshot().party,change:{kind:'set-row',position,row:'back'}}));
 const before=h.game.state.snapshot();f.run(h,'dream-separate');assert.equal(h.game.field.stop,null,h.game.field.stop?.message);
 const split=h.game.state.snapshot(),remaining=split.party.slots[0].flatMap(c=>c.id===null?[]:[split.roster.find(r=>r.id===c.id)!.sourceId]);assert.equal(remaining.length,2);assert.deepEqual(split.roster,before.roster);
 f.startBattle(h.game);assert.deepEqual(h.game.battle!.players.map(p=>p.sourceId),remaining);assert(h.game.battle!.players.every(p=>p.row==='back'));f.previewVictory(h.game);assert(h.game.continueVictory());h.game.advance(10);assert.equal(h.game.field.stop,null);
 const saved=h.game.checkpoint(),values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});(await storage.prepareSave(saved,0)).commit();
 const restored=f.restore((await storage.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),saved);
 const asset=restored.field.player.asset,party=restored.field.partyActorCheckpoint;assert(restored.field.startEvent('dream-rejoin-first'));for(let i=0;i<15;i++)restored.advance(10);
 assert.equal(restored.field.stop,null,restored.field.stop?.message);assert.equal(restored.field.player.asset,asset);assert.deepEqual(restored.field.partyActorCheckpoint,party);
 assert(restored.field.startEvent('dream-rejoin-second'));for(let i=0;i<15;i++)restored.advance(10);assert.equal(restored.field.stop,null);assert.deepEqual(restored.state.snapshot().party.slots[0],before.party.slots[0]);
});
test('missing actual PointIn and late Dying media reject the whole joint deployment, leaving events/owned/actors intact',()=>{
 for(const missing of ['point','dying']as const){const{f,h}=ready(),field=h.game.field;
  if(missing==='point')delete field.content.partyEntry;else for(const c of Object.values(field.content.characters))delete c.animations.Dying;
  assert(field.startEvent(missing==='point'?'deploy-tower':'deploy-phoenix'));
  const owned=h.game.state.snapshot(),events=field.eventState.snapshot(),actors=field.nativeActorStateFingerprint,camera=field.cameraSnapshot;
  h.flow.advance(10,rosterGroupHost);assert.equal(field.stop?.kind,'unsupported');assert.match(field.stop!.message,missing==='point'?/PointIn/:/Dying/);
  assert.deepEqual(h.game.state.snapshot(),owned);assert.deepEqual(field.eventState.snapshot(),events);assert.equal(field.nativeActorStateFingerprint,actors);assert.deepEqual(field.cameraSnapshot,camera);
 }
});
test('map candidate split remains draft-owned across cancellation/media failure, retry publishes once and old Field cannot mutate its retired owners',async()=>{
 const{f,h}=ready({targetInitializer:true}),old=h.game.field,before=h.game.state.snapshot();f.run(h,'group-change-map');assert.equal(old.stop?.kind,'map-transition');
 let release!:(v:null)=>void,entered!:(v:null)=>void,mode:'hold'|'fail'|'ok'='hold';const enteredPromise=new Promise<null>(r=>{entered=r;}),loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{if(mode==='fail')throw Error('Controlled multi-Corps media failure');if(mode==='hold'){entered(null);return new Promise<null>(r=>{release=r;});}return null;},discard(){}});
 const attempt=loader.load(),first=await Promise.race([enteredPromise,attempt]);assert.equal(first,null,first?.status==='failed'?String(first.error):first?.status);assert.deepEqual(h.game.state.snapshot(),before);loader.cancel();release(null);await attempt;assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);
 mode='fail';assert.equal((await loader.load()).status,'failed');assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);
 mode='ok';const result=await loader.load();assert.equal(result.status,'committed',result.status==='failed'?String(result.error):result.status);for(let i=0;i<12;i++)h.flow.advance(10,rosterGroupHost);assert.notEqual(h.game.field,old);assert.equal(h.game.field.stop,null,h.game.field.stop?.message);
 const after=h.game.state.snapshot();assert.equal(after.party.slots[0].filter(c=>c.id!==null).length,2);assert.deepEqual(after.roster,before.roster);assert(h.game.checkpointReady);
 const restored=GameSession.restore(h.game.checkpoint(),undefined,f.battle,{catalog:f.world,map:f.destination,source:{content:f.content,initialMap:f.map}},{rtsPartySwitch:WEB_RTS_PARTY_SWITCH});assert.deepEqual(restored.state.snapshot(),after);assert(old.startEvent('dream-rejoin-first')===false);old.advance(10);assert.deepEqual(h.game.state.snapshot(),after);
});
test('a candidate original-root late failure after split discards the entire owned/actor draft',async()=>{
 const{f,h}=ready({targetInitializer:true,multiCorpsFailure:true}),old=h.game.field,before=h.game.state.snapshot();f.run(h,'group-change-map');const actors=old.nativeActorStateFingerprint;
 const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>null,discard(){}}),result=await loader.load();assert.equal(result.status,'failed');assert.match(result.status==='failed'?String(result.error):'',/Controlled multi-Corps candidate failure/);assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);assert.equal(old.nativeActorStateFingerprint,actors);
});
