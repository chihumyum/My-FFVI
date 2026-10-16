import test from "node:test";
import assert from "node:assert/strict";
import { nonEncounterSessionFixture } from "./fixtures/non-encounter-area-session.js";
import { encounterReady } from "./fixtures/source-encounter-session.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import type { WalkEncounterSnapshot } from "../src/core/walk-encounters.js";
// Read-only scheduler observation; no test writes its counters or RNG.
const walkSnapshot=(game:ReturnType<ReturnType<typeof nonEncounterSessionFixture>["make"]>["game"]) =>
  (game as unknown as {walkEncounters:{snapshot():WalkEncounterSnapshot}}).walkEncounters.snapshot();
const media={prepareStart:async()=>({kind:"start"}),prepareReturn:async()=>({kind:"return"}),discard(){}};
function activate(live:ReturnType<ReturnType<typeof nonEncounterSessionFixture>["make"]>,name="regions") {
 assert.equal(live.game.field.startEvent(name),true);
 for(let i=0;i<100&&live.game.field.busy&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);
 assert.equal(live.game.field.stop,null,live.game.field.stop?.message);
}
function win(live:ReturnType<ReturnType<typeof nonEncounterSessionFixture>["make"]>) {
 const b=live.game.battle!;
 for(let i=0;i<2500&&b.phase==="active";i++){
  for(const actor of b.ready){const target=b.enemies.find(e=>e.hp>0);if(target)live.commands.command(b,actor.id,10,{kind:"single",id:target.id},100);}
  live.flow.advance(20,encounterReady);
 }
 assert.equal(b.phase,"victory");
}
function stable(live:ReturnType<ReturnType<typeof nonEncounterSessionFixture>["make"]>){
 for(let i=0;i<100&&!live.game.checkpointReady;i++)live.flow.advance(10,encounterReady);
 assert.equal(live.game.checkpointReady,true,live.game.field.stop?.message);
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return{promise,resolve};}

test("legal movement suppresses only the authored encounter scheduler inside; leaving joins one battle, unique return and Storage",async()=>{
 const f=nonEncounterSessionFixture({walking:true}),live=f.make(),{game,flow}=live;activate(live);
 assert.deepEqual([game.field.player.x,game.field.player.y],[3,4]);const before=walkSnapshot(game),owned=game.state.snapshot();
 assert.equal(flow.move("up"),true);flow.advance(240,encounterReady);
 assert.deepEqual([game.field.player.x,game.field.player.y],[3,3]);assert.equal(game.field.sourceStandingInNonEncounterArea(game.field.player),true);
 assert.deepEqual(walkSnapshot(game),before);assert.equal(game.field.player.steps,1);assert.equal(game.battle,null);
 assert.equal(flow.move("right"),true);flow.advance(240,encounterReady);assert.equal(game.field.stop?.kind,"encounter");
 assert.equal(walkSnapshot(game).completedSteps,1);assert.equal(walkSnapshot(game).encounters,1);
 assert.equal(game.field.sourceStandingInNonEncounterArea(game.field.player),false);
 const handoff=new GameBattleHandoff(flow,media);assert.equal((await handoff.start()).status,"committed");win(live);
 assert.equal((await handoff.return()).status,"committed");stable(live);assert.equal(game.state.completedEncounters.length,1);
 assert.equal(game.field.sourceNonEncounterAreaProperties.length,1);await assert.rejects(()=>handoff.return(),/requires/);
 const bytes=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}},"framework","region-loop");
 await store.save(game.checkpoint(),500);const saved=(await store.load())!,restored=f.restore(saved.checkpoint);
 assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert.equal(restored.field.sourceNonEncounterAreaProperties.length,1);
 assert.equal(restored.field.sourceStandingInNonEncounterArea({x:3,y:3}),true);assert.equal(restored.field.sourceStandingInNonEncounterArea({x:4,y:3}),false);
 assert.notDeepEqual(game.state.snapshot(),owned,"real battle completed through owned reward/return pipeline");
 delete f.runtime.sourceNonEncounterAreas;assert.throws(()=>f.restore(saved.checkpoint),/runtime authority/);
});

test("scripted source Encount inside retains the real pre-sync pose and invariant BG0 and still battles; failure/cancel/retry preserve membership",async()=>{
 const f=nonEncounterSessionFixture(),live=f.make(),{game,flow}=live;activate(live);
 assert.equal(flow.move("up"),true);flow.advance(240,encounterReady);assert.equal(game.field.sourceStandingInNonEncounterArea(game.field.player),true);
 const field=game.field,regions=field.sourceNonEncounterAreaProperties;assert.equal(field.startEvent("source-fight"),true);
 for(let i=0;i<100&&!field.stop;i++)flow.advance(10,encounterReady);
 const stop=field.stop;assert.ok(stop?.kind==="encounter"&&stop.sourceEncounter,JSON.stringify(stop));
 assert.equal(stop.sourceEncounter.foot.origin,"default-or-excluded-unprojected");assert.equal(stop.sourceEncounter.foot.backgroundId,0);
 assert.deepEqual(stop.sourceEncounter.foot.player.position,field.player.native!.entity.position);
 const actualPose=structuredClone(field.nativeActorStateFingerprint),owned=game.state.snapshot();
 const fail=new GameBattleHandoff(flow,{...media,prepareStart:async()=>{throw new Error("media failed");}});
 assert.equal((await fail.start()).status,"failed");assert.deepEqual(field.sourceNonEncounterAreaProperties,regions);assert.equal(game.field,field);assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(field.nativeActorStateFingerprint,actualPose);
 const late=deferred<{kind:string}>(),pendingHost=new GameBattleHandoff(flow,{...media,prepareStart:()=>late.promise});
 const pending=pendingHost.start();pendingHost.cancel();late.resolve({kind:"late"});assert.equal((await pending).status,"cancelled");assert.equal(game.battle,null);
 const retry=new GameBattleHandoff(flow,media);assert.equal((await retry.start()).status,"committed");assert.deepEqual(field.sourceNonEncounterAreaProperties,regions);win(live);
 assert.equal((await retry.return()).status,"committed");stable(live);assert.equal(game.field,field);assert.deepEqual(field.sourceNonEncounterAreaProperties,regions);assert.equal(game.state.completedEncounters.length,1);
});

test("map preparation failure/cancel/late result cannot clear old regions or append into a fresh map owner",async()=>{
 const f=nonEncounterSessionFixture(),live=f.make(),{game,flow}=live;activate(live);const old=game.field,regions=old.sourceNonEncounterAreaProperties;
 assert.equal(old.startEvent("region-travel"),true);assert.equal(old.stop?.kind,"map-transition");
 let failed=false,calls=0;const late=deferred<{id:number}>(),entered=deferred<void>(),discarded:number[]=[],candidates:typeof old[]=[];
 const loader=new GameMapLoader(flow,{world:async()=>f.world,map:async()=>{if(!failed){failed=true;throw Error("download failure");}return f.map;}},
  {prepare:async field=>{candidates.push(field);if(++calls===1){entered.resolve();return late.promise;}return{id:calls};},discard:value=>{discarded.push(value.id);}});
 assert.equal((await loader.load()).status,"failed");assert.equal(game.field,old);assert.deepEqual(old.sourceNonEncounterAreaProperties,regions);
 const pending=loader.load();await Promise.race([entered.promise,pending.then(result=>{throw new Error("map attempt ended before media: "+JSON.stringify(result.status==="failed"?String(result.error):result));})]);loader.cancel();assert.equal(game.field,old);assert.deepEqual(old.sourceNonEncounterAreaProperties,regions);
 assert.equal((await loader.load()).status,"committed");const fresh=game.field;assert.notEqual(fresh,old);assert.equal(fresh.sourceNonEncounterAreaProperties.length,0);
 late.resolve({id:99});assert.equal((await pending).status,"cancelled");assert.deepEqual(discarded,[99]);assert.equal(game.field,fresh);
 assert.throws(()=>old.sourceStandingInNonEncounterArea({x:1,y:1}),/Retired/);assert.throws(()=>candidates[0]!.sourceStandingInNonEncounterArea({x:1,y:1}),/Retired/);
 stable(live);activate(live);assert.equal(fresh.sourceNonEncounterAreaProperties.length,1);assert.equal(fresh.sourceStandingInNonEncounterArea({x:1,y:1}),true);
});

test("without runtime authority an actual initialized Session preserves all published groups and original region blocker",()=>{
 const f=nonEncounterSessionFixture({runtime:false}),live=f.make(),field=live.game.field,before={entities:field.entities,active:[...field.activeGroups],owned:live.game.state.snapshot()};
 assert.equal(field.startEvent("regions"),true);assert.equal(field.stop?.kind,"unsupported");assert.match(field.stop!.message,/runtime authority/);
 assert.deepEqual([...field.activeGroups],before.active);assert.deepEqual(field.entities,before.entities);assert.deepEqual(live.game.state.snapshot(),before.owned);assert.equal(field.sourceNonEncounterAreaProperties.length,0);
});
