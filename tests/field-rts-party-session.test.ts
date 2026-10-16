import {GameMapLoader}from'../src/core/game-map-loader.js';
import {GameSession}from'../src/core/game-session.js';
import {CheckpointStorage}from'../src/core/saved-game.js';
import {WEB_RTS_PARTY_SWITCH}from'../src/core/field-rts-party.js';
import test from'node:test';
import assert from'node:assert/strict';
import {rosterGroupsSessionFixture,rosterGroupHost}from'./fixtures/roster-groups-session.js';
function ready(){const f=rosterGroupsSessionFixture({rts:true}),h=f.make();f.run(h,'group-source-sequence');assert.equal(h.game.field.stop,null);f.run(h,'rts-place');assert.equal(h.game.field.stop,null);const e=h.game.field.eventState;for(const[index,value]of[[4,0],[5,3],[11,f.map.mapId],[12,f.map.mapId],[13,f.map.mapId]]as const)e.write({category:'ScenarioVariable',index},value);e.write({category:'MapLocalVariable',index:0},1);return{f,h};}
test('real Session source RTS shift borrows permanent Corps, yields the same Core and restores once after a battle',()=>{
 const{f,h}=ready(),before=h.game.state.snapshot(),field=h.game.field,player=field.player,position={...player.native!.entity.position};
 assert(field.startEvent('rts-shift'));assert.equal(field.stop,null);assert.equal(h.game.state.snapshot().party.selectedSlot,1);assert.equal(field.rtsPartyBusy,true);assert.equal(field.player,player);assert.equal(h.game.checkpointReady,false);
 for(let i=0;i<145;i++)h.flow.advance(10,rosterGroupHost);assert.equal(field.stop,null);assert.equal(field.rtsPartyBusy,true);
 f.startBattle(h.game);assert(h.game.battle);assert.deepEqual(h.game.battle.players.map(p=>p.sourceId),[11,22,23,24]);f.previewVictory(h.game);assert(h.game.continueVictory());h.game.advance(10);
 f.run(h,'rts-restore');assert.equal(field.stop,null);assert.equal(field.rtsPartyBusy,false);assert.equal(h.game.state.snapshot().party.selectedSlot,0);assert.deepEqual(player.native!.entity.position,position);assert.deepEqual(h.game.state.snapshot().party.slots,before.party.slots);
});
test('real Session same-map rotation preserves source StayMap and current-bank variables, old roster qualifications and exact source inventory',()=>{
 const{f,h}=ready(),before=h.game.state.snapshot();f.run(h,'rts-switch');assert.equal(h.game.field.stop,null);assert.equal(h.game.state.snapshot().party.selectedSlot,1);assert.equal(h.game.field.eventState.read({category:'ScenarioVariable',index:4}),1);
 const after=h.game.state.snapshot();assert.deepEqual(after.roster,before.roster);assert.deepEqual(after.equipmentStock,before.equipmentStock);assert.deepEqual(after.items,before.items);
});

test('cross-map switch shares one reservation/VM, parks only inactive numeric poses and survives cancellation, media failure, retry and Storage',async()=>{
 const{f,h}=ready(),home=h.game.field,owned=h.game.state.snapshot();
 const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>null,discard(){}});
 f.run(h,'group-change-map');assert.equal((await loader.load()).status,'committed');for(let i=0;i<10;i++)h.flow.advance(10,rosterGroupHost);
 assert.notEqual(h.game.field,home);assert(h.game.checkpointReady,h.game.field.stop?.message);
 const away=h.game.field;e: {const e=away.eventState;e.write({category:'ScenarioVariable',index:4},0);e.write({category:'ScenarioVariable',index:5},3);}
 f.run(h,'rts-switch');assert.equal(away.stop?.kind,'map-transition',away.stop?.message);assert.equal(h.game.state.snapshot().party.selectedSlot,0,'cross-map branch selects at original after callback');assert.equal(h.game.reservedFieldScript?.kind,'source-rts-field-reservation-v1');
 let mode:'hold'|'fail'|'ok'='hold',entered!:(v:null)=>void,release!:(v:null)=>void;const pending=new Promise<null>(r=>{entered=r;});
 const guarded=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{if(mode==='fail')throw Error('Controlled RTS media failure');if(mode==='hold'){entered(null);return new Promise<null>(r=>{release=r;});}return null;},discard(){}});
 const loading=guarded.load(),arrived=await Promise.race([pending.then(()=>null),loading]);assert.equal(arrived,null,arrived?.status==='failed'?String(arrived.error):arrived?.status);guarded.cancel();release(null);await loading;assert.equal(h.game.field,away);assert.equal(h.game.state.snapshot().party.selectedSlot,0);
 mode='fail';assert.equal((await guarded.load()).status,'failed');assert.equal(h.game.field,away);assert.equal(h.game.reservedFieldScript?.kind,'source-rts-field-reservation-v1');
 mode='ok';const result=await guarded.load();assert.equal(result.status,'committed',result.status==='failed'?String(result.error):result.status);
 const queued=h.game.checkpoint();assert.equal(queued.formatVersion,9);const queuedRestore=f.restore(queued);assert.equal(queuedRestore.reservedFieldScript?.kind,'source-rts-field-reservation-v1');const legacy=structuredClone(queued);legacy.formatVersion=7;assert.throws(()=>f.restore(legacy),/reservation/);
 for(let i=0;i<30;i++)h.flow.advance(10,rosterGroupHost);assert.equal(h.game.field.stop,null,h.game.field.stop?.message);assert.equal(h.game.state.snapshot().party.selectedSlot,1);assert.equal(h.game.reservedFieldScript,null);assert(h.game.checkpointReady);
 const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}}),saved=h.game.checkpoint();assert.equal(saved.world.kind,'idle-world-v12');
 (await storage.prepareSave(saved,0)).commit();const again=GameSession.restore((await storage.load())!.checkpoint,undefined,f.battle,{catalog:f.world,map:f.map,source:{content:f.content,initialMap:f.map}},{rtsPartySwitch:WEB_RTS_PARTY_SWITCH});assert.deepEqual(again.checkpoint(),saved);
 assert.throws(()=>GameSession.restore(saved,undefined,f.battle,{catalog:f.world,map:f.map,source:{content:f.content,initialMap:f.map}}),/RTS|provider/);
 const before=h.game.state.snapshot();away.startEvent('rts-switch');away.advance(10);assert.deepEqual(h.game.state.snapshot(),before);assert.deepEqual(before.party.slots,owned.party.slots);
});

test('actual party confirm resolves the owned saved leader and routes the existing replacement callback; a direct Talk invocation cannot invent a target',()=>{
 const{f,h}=ready(),field=h.game.field,before=h.game.state.snapshot();
 assert.equal(field.directionInput('right').kind,'facing');field.confirm();for(let i=0;i<10;i++)h.flow.advance(10,rosterGroupHost);
 assert.equal(field.stop,null,field.stop?.message);assert.equal(field.eventState.read({category:'ScriptLocalVariable',index:0}),11);
 assert.deepEqual(field.puppetReplacementSnapshot?.selectors,[-1031]);assert.deepEqual(h.game.state.snapshot(),before);
 const no=ready();no.f.run(no.h,'authored-rts-talk');assert.match(no.h.game.field.stop!.message,/actual invoked party target/);
});
test('failed source appearance leaves the complete owned/events/actors/camera unchanged and retry from a stable save uses the same group',()=>{
 const{f,h}=ready(),saved=h.game.checkpoint(),field=h.game.field;assert(field.startEvent('rts-switch'));const owned=h.game.state.snapshot(),events=field.eventState.snapshot(),actors=field.nativeActorStateFingerprint,camera=field.cameraSnapshot;
 const old=field.content.characters.charlie!.animations.Default;delete field.content.characters.charlie!.animations.Default;
 for(let i=0;i<10;i++)h.flow.advance(10,rosterGroupHost);assert.equal(field.stop?.kind,'unsupported');assert.match(field.stop!.message,/animation|media|appearance|Default/i);
 assert.deepEqual(h.game.state.snapshot(),owned);assert.deepEqual(field.eventState.snapshot(),events);assert.equal(field.nativeActorStateFingerprint,actors);assert.deepEqual(field.cameraSnapshot,camera);
 field.content.characters.charlie!.animations.Default=old!;
 const again=f.restore(saved);assert(again.field.startEvent('rts-switch'));for(let i=0;i<15;i++)again.advance(10);assert.equal(again.field.stop,null);assert.equal(again.state.snapshot().party.selectedSlot,1);
});
test('a published encounter selection survives a later camera-owner failure, without skipping its original pending Core or granting save/map',()=>{
 const{f,h}=ready(),field=h.game.field;assert(field.startEvent('rts-shift'));const selected=h.game.state.snapshot();
 assert.equal(field.startEvent('rts-restore'),false);assert.throws(()=>h.game.checkpoint(),/Cannot save/);assert.throws(()=>field.previewMap(f.map.mapId,1),/event/);
 const owner=field as unknown as{camera:{snapshot():NonNullable<typeof field.cameraSnapshot>;prepareState(v:NonNullable<typeof field.cameraSnapshot>):{commit():void}}};
 const changed=owner.camera.snapshot();changed.dummy.position.x+=1;owner.camera.prepareState(changed).commit();h.flow.advance(10,rosterGroupHost);
 assert.equal(field.stop?.kind,'unsupported');assert.match(field.stop!.message,/original Core\/actor\/camera owner/);assert.deepEqual(h.game.state.snapshot(),selected);assert.equal(h.game.checkpointReady,false);
});
