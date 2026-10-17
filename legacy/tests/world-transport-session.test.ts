import test from "node:test";
import assert from "node:assert/strict";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameSession } from "../src/core/game-session.js";
import { encodeSavedGame,decodeSavedGame } from "../src/core/saved-game.js";
import { worldTransportSessionFixture } from "./fixtures/world-transport-session.js";
const host={visible:true,mediaReady:true,overlayOpen:false};
async function launch(options:Parameters<typeof worldTransportSessionFixture>[0]={}) {
  const f=await worldTransportSessionFixture(options),game=await f.make(),flow=new GameFlow(game);
  flow.start(game);flow.observeHost(host);flow.advance(10,host);
  assert.equal(game.checkpointReady,true,game.field.stop?.message);
  if(f.armor){assert.equal(game.field.startEvent("board"),true);flow.advance(10,host);
    assert.equal(game.field.stop,null,game.field.stop?.message);assert.equal(game.field.transportationId,6);}
  return {f,game,flow,commands:new GameCommands(flow,game)};
}
function request(h:Awaited<ReturnType<typeof launch>>,name="go-world") {
  assert.equal(h.game.field.startEvent(name),true);h.flow.advance(10,host);
  assert.equal(h.game.field.stop?.kind,"map-transition",h.game.field.stop?.message);
}
function enter(h:Awaited<ReturnType<typeof launch>>) {
  request(h);const old=h.game.field,before=h.game.state.snapshot(),candidate=h.game.world.prepare(h.f.world,h.f.worldMap);
  assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);
  assert.equal(h.game.world.commit(candidate),true);h.flow.advance(10,host);
  assert.equal(h.game.checkpointReady,true,h.game.field.stop?.message);return candidate;
}
const parking=(h:Awaited<ReturnType<typeof launch>>)=>structuredClone(h.game.state.snapshot().nativeState!.ownedTransportations);

test("both retained source identities cross ordinary/world maps, save/restore and continue without replay or parking writes",async()=>{
  for(const armor of [false,true])for(const nonperiodic of [false,true]) {
    const h=await launch({armor,nonperiodic}),record=parking(h),id=armor?6:1,old=h.game.field;
    enter(h);assert.notEqual(h.game.field,old);assert.equal(h.game.field.transportationId,id);
    assert.equal((h.game.field.player.mount??""),armor?"armor":"");
    assert.deepEqual(parking(h),record);assert.equal(h.game.field.eventState.read(h.f.initializerRef),1);
    if(armor){const actor=h.game.field.partyActorCheckpoint!.context.player;
      assert.equal(actor.fieldAssetId,38);assert.notEqual(actor.riderFieldAssetId,38);assert.equal(actor.riding,true);}
    const saved=h.game.checkpoint(),encoded=await encodeSavedGame(saved,300),decoded=await decodeSavedGame(encoded);
    const restored=h.f.restore(decoded.checkpoint);assert.deepEqual(restored.checkpoint(),saved);
    restored.advance(20);assert.deepEqual(restored.state.snapshot(),saved.owned);
    assert.equal(restored.field.eventState.read(h.f.initializerRef),1);
    const flow=new GameFlow(restored);flow.start(restored);flow.observeHost(host);
    assert.equal(restored.field.startEvent("world-return"),true);flow.advance(10,host);
    const next=restored.world.prepare(h.f.world,h.f.map);assert.equal(restored.world.commit(next),true);flow.advance(10,host);
    assert.equal(restored.field.transportationId,id);assert.equal(restored.field.content.entry.viewPlan!.isWorld,false);
    assert.deepEqual(restored.state.snapshot().nativeState!.ownedTransportations,record);
    const back=restored.checkpoint();assert.deepEqual(h.f.restore(back).checkpoint(),back);
  }
});

test("retained Magitek world entry failure, cancellation, retry and stale owned candidates publish once",async()=>{
  const h=await launch(),record=parking(h);request(h);const old=h.game.field,before=h.game.state.snapshot(),stop=old.stop;
  const a=h.game.world.prepare(h.f.world,h.f.worldMap);h.game.world.discard(a);assert.equal(h.game.world.commit(a),false);
  assert.equal(h.game.field,old);assert.equal(old.stop,stop);assert.deepEqual(h.game.state.snapshot(),before);
  const b=h.game.world.prepare(h.f.world,h.f.worldMap),c=h.game.world.prepare(h.f.world,h.f.worldMap);
  assert.equal(h.game.world.commit(b),true);h.flow.advance(10,host);const after=h.game.state.snapshot();
  assert.equal(h.game.world.commit(c),false);assert.deepEqual(h.game.state.snapshot(),after);assert.deepEqual(parking(h),record);
  const failed=await launch({initializationFailure:true});request(failed);
  const previous=failed.game.field,state=failed.game.state.snapshot(),actors=previous.nativeActorStateFingerprint;
  assert.throws(()=>failed.game.world.prepare(failed.f.world,failed.f.worldMap),/Controlled world initializer failed/);
  assert.equal(failed.game.field,previous);assert.deepEqual(failed.game.state.snapshot(),state);
  assert.equal(previous.nativeActorStateFingerprint,actors);
});

test("missing or unknown Web declaration, source profiles, release flags and linked PointIn cannot grant world armor entry",async()=>{
  const strict=await launch({policy:false});request(strict);const state=strict.game.state.snapshot();
  assert.throws(()=>strict.game.world.prepare(strict.f.world,strict.f.worldMap),/ordinary walking|explicit/);
  assert.deepEqual(strict.game.state.snapshot(),state);
  const valid=await launch();enter(valid);const saved=valid.game.checkpoint();
  assert.throws(()=>valid.f.restore(saved,false),/ordinary walking|explicit/);
  for(const mutation of [
    (h:Awaited<ReturnType<typeof launch>>)=>{delete h.f.worldMap.developmentProfile!.transportation;},
    (h:Awaited<ReturnType<typeof launch>>)=>{h.game.field.eventState.write({category:"TreasureFlag4",index:137},0);},
    (h:Awaited<ReturnType<typeof launch>>)=>{h.f.worldMap.partyEntry!.pointIns[0]!.linkObject=7;},
    (h:Awaited<ReturnType<typeof launch>>)=>{h.game.field.eventState.write({category:"ScenarioFlag3",index:45},1);},
  ]) {
    const h=await launch();mutation(h);request(h);const old=h.game.field,before=h.game.state.snapshot();
    assert.throws(()=>h.game.world.prepare(h.f.world,h.f.worldMap));assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);
  }
  await assert.rejects(()=>GameSession.prepareFrameworkNewGame(valid.f.content,valid.f.world,valid.f.map,valid.f.battle,
    {retainedWorldTransportation:"unknown" as never}),/Unknown retained/);
});

test("Magitek world event save resumes once and restores live identity through the existing field codec",async()=>{
  const h=await launch();enter(h);const record=parking(h),before=h.game.state.snapshot().items.find(i=>i.id===701)!.count;
  assert.equal(h.game.field.startEvent("world-save"),true);h.flow.advance(10,host);
  const request=h.game.eventSaveRequest;assert.ok(request);const pending=h.game.prepareEventSave(request),saved=pending.checkpoint;
  const copy=h.f.restore(saved);assert.equal(copy.field.transportationId,6);assert.equal(copy.eventSaveRequest,null);
  pending.commitWith(()=>{});h.flow.advance(10,host);copy.advance(10);
  assert.equal(copy.state.snapshot().items.find(i=>i.id===701)!.count,before+2);
  assert.deepEqual(copy.checkpoint(),h.game.checkpoint());assert.deepEqual(parking(h),record);
});

test("retained world identity survives real battle media failure, one victory return, save and a second world entry",async()=>{
  for(const armor of [false,true]){
    const h=await launch({armor});enter(h);const record=parking(h),id=armor?6:1;
    assert.equal(h.game.field.startEvent("world-fight"),true);h.flow.advance(10,host);
    assert.ok(h.game.battleStartRequest,h.game.field.stop?.message);const before=h.game.state.snapshot(),field=h.game.field;
    let fail=true;const handoff=new GameBattleHandoff(h.flow,{prepareStart:async()=>{if(fail)throw Error("held battle media");return {};},prepareReturn:async()=>({}),discard(){}});
    assert.equal((await handoff.start()).status,"failed");assert.equal(h.game.field,field);assert.deepEqual(h.game.state.snapshot(),before);
    fail=false;const started=await handoff.start();assert.equal(started.status,"committed",started.status==="failed"?String(started.error):started.status);
    for(let i=0;i<2000&&h.game.battle!.phase==="active";i++){
      const battle=h.game.battle!;for(const actor of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target)h.commands.command(battle,actor.id,10,{kind:"single",id:target.id},100);}
      h.flow.advance(20,host);
    }
    assert.equal(h.game.battle!.phase,"victory");assert.equal((await handoff.return()).status,"committed");h.flow.advance(20,host);
    assert.equal(h.game.field.transportationId,id);assert.equal(h.game.field.eventState.read({category:"MapLocalVariable",index:2}),1);
    assert.deepEqual(parking(h),record);assert.equal(h.game.state.completedEncounters.length,1);
    const saved=h.game.checkpoint(),restored=h.f.restore(saved);assert.deepEqual(restored.checkpoint(),saved);
    const flow=new GameFlow(restored);flow.start(restored);flow.observeHost(host);
    assert.equal(restored.field.startEvent("world-return"),true);flow.advance(10,host);
    assert.equal(restored.world.commit(restored.world.prepare(h.f.world,h.f.map)),true);flow.advance(10,host);
    assert.equal(restored.field.transportationId,id);assert.equal(restored.field.startEvent("go-world"),true);flow.advance(10,host);
    assert.equal(restored.world.commit(restored.world.prepare(h.f.world,h.f.worldMap)),true);flow.advance(10,host);
    assert.equal(restored.field.transportationId,id);assert.deepEqual(restored.state.snapshot().nativeState!.ownedTransportations,record);
  }
});


test("world map repository/media failures and Flow cancellation freeze the old field and retain the exact parked owner",{timeout:10000},async()=>{
  const h=await launch();request(h);const old=h.game.field,before=h.game.state.snapshot(),stop=old.stop,time=old.time;
  const files=new Map<string,unknown>([["/framework/world/catalog.json",h.f.world],
    ...h.f.maps.map(m=>[h.f.world.maps[m.mapId]!.url,m] as [string,unknown])]);
  const contents=new GameContentRepository(async url=>{assert.ok(files.has(url));return files.get(url);},"framework");
  let failed=true;
  const loader=new GameMapLoader(h.flow,contents,{prepare:async()=>{if(failed)throw Error("world media failure");return {};},discard(){}});
  assert.equal((await loader.load()).status,"failed");
  assert.equal(h.game.field,old);assert.equal(old.stop,stop);assert.deepEqual(h.game.state.snapshot(),before);
  let release!:(x:object)=>void,entered!:()=>void;
  const reached=new Promise<void>(yes=>{entered=yes;}),media=new Promise<object>(yes=>{release=yes;});let discards=0;
  const pendingLoader=new GameMapLoader(h.flow,contents,{prepare:async()=>{entered();return media;},discard(){discards++;}});
  const pending=pendingLoader.load();await reached;
  for(let i=0;i<16;i++)h.flow.advance(100,host);
  assert.equal(old.time,time);assert.deepEqual(h.game.state.snapshot(),before);
  pendingLoader.cancel();release({});assert.equal((await pending).status,"cancelled");assert.equal(discards,1);
  assert.equal(h.game.field,old);assert.equal(old.stop,stop);assert.deepEqual(h.game.state.snapshot(),before);
  failed=false;assert.equal((await loader.load()).status,"committed");h.flow.advance(10,host);
  assert.equal(h.game.field.transportationId,6);assert.deepEqual(h.game.state.snapshot().nativeState!.ownedTransportations,before.nativeState!.ownedTransportations);
});


test("an unused retained policy preserves legacy walking world content without a transportation declaration",async()=>{
  const {worldLoopSessionFixture}=await import("./fixtures/world-loop-session.js");
  const f=await worldLoopSessionFixture();
  const game=await GameSession.prepareFrameworkNewGame(f.content,f.world,f.map,f.battle,
    {retainedWorldTransportation:"web-retained-walking-magitek-world-entry-v1"});
  const flow=new GameFlow(game);flow.start();flow.advance(10,host);
  assert.equal(game.field.startEvent("go-world"),true);flow.advance(10,host);
  assert.equal(game.world.commit(game.world.prepare(f.world,f.worldMap)),true);flow.advance(10,host);
  assert.equal(game.field.transportationId,1);assert.equal(game.checkpointReady,true);
});
