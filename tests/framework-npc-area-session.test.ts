import assert from "node:assert/strict";
import test from "node:test";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { GameSession } from "../src/core/game-session.js";
import { createWebFieldCameraShakePolicy } from "../src/core/field-camera-shake.js";
import { WEB_ASSIGNED_ROUTE_POLICY } from "../src/core/field-assigned-route.js";
import { compileFrameworkContent } from "../src/compiler/framework-content.js";
import { frameworkNpcAreaFixture } from "./fixtures/framework-npc-area.js";
const ready = { visible: true, mediaReady: true, overlayOpen: false };
function observe(game: GameSession) {
  const actor = game.field.actors["601"]!;
  return { position: structuredClone(actor.native!.entity.position), motion: structuredClone(actor.motion),
    animation: actor.animation!.snapshot(), steps: actor.steps, activity: game.field.npcActivitySnapshot["601"]! };
}
function flowFor(game: GameSession) { const flow = new GameFlow(game); flow.start(); flow.advance(0, ready); return flow; }
function until(flow: GameFlow, predicate: () => boolean, reason: string) {
  for (let i = 0; !predicate(); i++) { assert(i < 5000, reason); assert.notEqual(flow.phase, "blocked", JSON.stringify(flow.session.field.stop)); flow.advance(10, ready); }
}
function move(flow: GameFlow, direction: Parameters<GameFlow["move"]>[0]) {
  assert.equal(flow.move(direction), true); until(flow, () => !flow.session.field.player.motion, "Player move did not finish");
}
function storage() {
  const values = new Map<string, string>(); return new CheckpointStorage({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }, "framework", "controlled-global-area");
}
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}

test("global compilation consumes the existing motion/interaction/menu/storage lifecycle without rewriting native actors or owned data", async () => {
  const f = await frameworkNpcAreaFixture(), game = f.make(), flow = flowFor(game),
    actor = game.field.actors[f.npcId]!, native = actor.native!, entity = native.entity, owned = game.state.snapshot();
  assert.equal(game.field.content.frameworkNpcActivity!.sourceMapHash, f.maps.find(map => map.mapId === f.firstMap)!.contentHash);
  assert(game.field.content.map.groups!.entity_default!.blockers.some(row => row.reason.includes("movement controller 2")));
  move(flow, "down");
  until(flow, () => actor.x === 4 && actor.y === 5 && !!actor.motion && actor.motion.elapsed === 0, "No natural adjacent NPC command");
  assert.equal(flow.move("right"), false); const beforeTalk = observe(game), motion = actor.motion;
  assert.equal(flow.confirm(), true); assert(game.field.dialogue); assert(game.field.npcActivitySnapshot[f.npcId]!.holder);
  flow.advance(1000, ready); assert.equal(actor.motion, motion); assert.deepEqual(observe(game).motion, beforeTalk.motion);
  assert.equal(game.checkpointReady, false); assert.equal(flow.confirm(), true);
  until(flow, () => !game.field.busy, "Talk did not release");
  assert.equal(game.field.actors[f.npcId], actor); assert.equal(actor.native, native); assert.equal(native.entity, entity);
  until(flow, () => !!actor.motion && actor.motion.elapsed >= 40, "No resumed savable command");
  assert.equal(flow.pause(true), true); const beforeSave = observe(game), channel = new GameCommands(flow, game), store = storage();
  assert(channel.menuReady); assert.equal(channel.menu({kind:"set-preferences",preferences:{mode:"wait",speedIndex:1}}), true);
  assert.deepEqual(game.state.snapshot(), owned); const save = flow.beginOperation("save"), prepared = await store.prepareSave(game.checkpoint(), 1730000000000);
  flow.advance(2000, ready); assert.deepEqual(observe(game), beforeSave); prepared.commit(); assert(save.finish());
  const stored = await store.load(); assert(stored); const restored = f.restore(stored.checkpoint), after = observe(restored);
  assert.deepEqual(after.position, beforeSave.position); assert.deepEqual(after.motion, beforeSave.motion);
  assert.deepEqual(after.animation, beforeSave.animation); assert.equal(after.steps, beforeSave.steps);
  for (const key of ["rngState","rngDraws","waitMs","remainingSteps","direction","commandId"] as const)
    assert.equal(after.activity[key], beforeSave.activity[key]);
  assert(after.activity.generation > beforeSave.activity.generation);
  const load = flow.beginOperation("load"); assert(load.publish(restored,{paused:true})); flow.advance(0, ready);
  assert.equal(channel.menu({kind:"set-preferences",preferences:{mode:"active",speedIndex:4}}), false);
  flow.pause(false); flow.advance(10, ready); assert.equal(restored.field.actors[f.npcId]!.motion!.elapsed, beforeSave.motion!.elapsed+10);
  assert.equal(game.field.actors[f.npcId], actor); assert.notEqual(restored.field.actors[f.npcId], actor);
});

test("global map candidates fail, cancel and retry on the existing world owner; obsolete NPC clocks remain retired", async () => {
  const f = await frameworkNpcAreaFixture(), game = f.make(), flow = flowFor(game);
  until(flow, () => !!game.field.actors[f.npcId]!.motion, "No initial autonomous motion"); move(flow, "left");
  const field = game.field, actor = field.actors[f.npcId]!, before = observe(game), owned = game.state.snapshot(),
    request = field.stop, entered = deferred<void>(), media = deferred<{id:number}>(); let reads = 0, stages = 0;
  const discarded: number[] = [], loader = new GameMapLoader(flow, {world:async()=>f.derived.catalog, map:async id => {
    if(++reads===1) throw new Error("Controlled global candidate download failure"); return f.derivedMaps[id]!;
  }}, {prepare:async()=>{if(++stages===1){entered.resolve();return media.promise;}return{id:stages};},discard:value=>{discarded.push(value.id);}});
  assert.equal((await loader.load()).status,"failed"); assert.equal(game.field,field); assert.equal(field.stop,request);
  assert.deepEqual(observe(game),before); assert.deepEqual(game.state.snapshot(),owned);
  const pending=loader.load(); await entered.promise; loader.cancel(); flow.advance(500,ready);
  assert.equal(game.field,field); assert.deepEqual(observe(game),before); assert.equal((await loader.load()).status,"committed");
  const next=game.field; assert.notEqual(next,field); assert.notEqual(next.actors[f.npcId],actor);
  media.resolve({id:99}); assert.equal((await pending).status,"cancelled"); assert.deepEqual(discarded,[99]);
  assert.equal(game.field,next); const retired=field.npcActivitySnapshot; field.advance(1000); assert.deepEqual(field.npcActivitySnapshot,retired);
  flow.advance(10,ready); until(flow,()=>!game.field.busy,"Destination did not settle");
  move(flow,"left"); assert.equal((await loader.load()).status,"committed"); flow.advance(10,ready);
  assert.equal(game.field.content.map.identity!.mapId,f.firstMap); assert.notEqual(game.field.actors[f.npcId],actor);
  assert.equal(game.state,flow.session.state); assert.equal(game.checkpointReady,true);
});

test("global Area motion survives failed battle preparation, fixed entry retry, one settlement and restored field continuation", async () => {
  const f = await frameworkNpcAreaFixture(), game=f.make(),flow=flowFor(game),owned=game.state;
  until(flow,()=>!!game.field.actors[f.npcId]!.motion&&game.field.actors[f.npcId]!.motion!.elapsed>0,"No motion before battle");
  move(flow,"up"); assert.equal(game.field.stop?.kind,"encounter"); const actor=game.field.actors[f.npcId]!,before=observe(game),request=game.field.stop;
  let attempts=0;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{
    if(++attempts===1)throw new Error("Controlled battle media failure");return{kind:"start"};},prepareReturn:async()=>({kind:"return"}),discard:()=>{}});
  assert.equal((await handoff.start()).status,"failed"); assert.equal(game.battle,null);assert.equal(game.field.stop,request);
  assert.deepEqual(observe(game),before);assert.equal((await handoff.start()).status,"committed");
  const battle=game.battle!;assert(battle);const commands=new GameCommands(flow,game);
  for(let i=0;battle.phase==="active";i++){
    assert(i<2000,"Controlled initializer battle failed to finish");
    for(const player of battle.ready)assert.equal(commands.command(battle,player.id,10,battle.enemies[0]!.id,100),true);
    flow.advance(10,ready);
  }
  assert.equal(battle.phase,"victory");assert.deepEqual(observe(game).motion,before.motion);
  assert.equal((await handoff.return()).status,"committed");assert.equal(game.state,owned);assert.equal(game.field.actors[f.npcId],actor);
  flow.advance(10,ready);until(flow,()=>!game.field.busy,"Battle continuation did not settle");
  assert.equal(game.state.snapshot().completedBattles.length,1);await assert.rejects(handoff.return(),/pending encounter or terminal battle/);
  const after=observe(game),store=storage();(await store.prepareSave(game.checkpoint(),1730000000001)).commit();const saved=await store.load();assert(saved);
  const restored=f.restore(saved.checkpoint);assert.equal(restored.state.snapshot().completedBattles.length,1);
  assert.deepEqual(observe(restored).motion,after.motion);assert.equal(observe(restored).activity.rngState,after.activity.rngState);
  const next=flowFor(restored);until(next,()=>restored.field.actors[f.npcId]!.steps>after.steps,"Restored autonomous motion never completed");
  assert.equal(restored.state.snapshot().completedBattles.length,1);
});


test("global Area, explicit animation, assigned Wait route and Shake retain independent capabilities and resume all same owners after joint save", async () => {
  const f = await frameworkNpcAreaFixture({presentationFamilies:true}),
    runtime = {assignedNpcRoutes:WEB_ASSIGNED_ROUTE_POLICY,cameraShake:createWebFieldCameraShakePolicy(12345)},
    npcOnly = compileFrameworkContent(f.catalog,f.maps,f.entry,{npcAreaAssessments:f.assessments});
  assert.equal(npcOnly.catalog.developmentProfile.mapAnimatedEntities,undefined);
  assert(npcOnly.maps[0]!.map!.groups!.entity_default!.blockers.some(row=>row.reason.includes("animated map entity")));
  assert.throws(()=>f.make(npcOnly,runtime),/animated|animation|source|Source|map/i);
  const game=f.make(f.derived,runtime),flow=flowFor(game),area=game.field.actors[f.npcId]!,
    wait=game.field.actors[f.obstacleId]!,animated=game.field.actors["750"]!,owner=game.state;
  assert.equal(animated.native!.scope!.kind,"map-animated");assert.equal(area.native!.scope!.kind,"map-npc");
  assert.equal(game.field.startEvent("combined-families"),true);
  until(flow,()=>game.field.assignedRouteSnapshot.length>0,"Source wrapper did not advance to its assignment");
  // The source/physical Site is deliberately not the installed Web name/PC.
  assert.equal(game.field.assignedRouteSnapshot[0]!.site.index,100);
  until(flow,()=>!!area.motion&&!!wait.motion,"Both distinct motion owners did not run concurrently");
  assert.equal(game.field.stop,null);assert.equal(game.state,owner);
  const before={area:observe(game),assigned:game.field.assignedRouteSnapshot,
    waitMotion:structuredClone(wait.motion),animation:animated.animation!.snapshot(),story:game.field.storyRuntimeSnapshot};
  assert(before.story?.kind==="web-field-story-runtime-v2"&&before.story.cameraShake);
  assert.equal(flow.pause(true),true);flow.advance(500,ready);
  assert.deepEqual(observe(game),before.area);assert.deepEqual(wait.motion,before.waitMotion);
  assert.deepEqual(animated.animation!.snapshot(),before.animation);assert.deepEqual(game.field.storyRuntimeSnapshot,before.story);
  const store=storage(),saved=game.checkpoint();assert.equal(saved.world.field.kind,"idle-field-v14");
  (await store.prepareSave(saved,1730000000002)).commit();const value=await store.load();assert(value);
  const restored=f.restore(value.checkpoint,runtime),field=restored.field,restoredWait=field.actors[f.obstacleId]!;
  assert.deepEqual(field.assignedRouteSnapshot,before.assigned);assert.deepEqual(restoredWait.motion,before.waitMotion);
  assert.deepEqual(observe(restored).motion,before.area.motion);assert.deepEqual(field.actors["750"]!.animation!.snapshot(),before.animation);
  assert.deepEqual(field.storyRuntimeSnapshot,before.story);assert.equal(observe(restored).activity.rngState,before.area.activity.rngState);
  const next=flowFor(restored);until(next,()=>field.assignedRouteSnapshot.length===0,"Restored assigned route did not drain once");
  assert.equal(restoredWait.x,8);assert.equal(field.actors["750"]!.native!.scope!.kind,"map-animated");
  until(next,()=>field.actors[f.npcId]!.steps>before.area.steps,"Restored original Area command did not resume");
  assert.equal(field.stop,null);assert.deepEqual(restored.state.snapshot(),game.state.snapshot());
});
