import {CheckpointStorage} from "../src/core/saved-game.js";
import {GameBattleHandoff} from "../src/core/game-battle-handoff.js";
import {startMobColor} from "../src/core/field-mob-controls.js";
import test from 'node:test';import assert from 'node:assert/strict';
import{mobControlsFixture,mobHost}from'./fixtures/mob-controls.js';
import{startFieldActorVisibility}from'../src/core/field-actor-visibility.js';
const finish=(flow:any)=>{for(let i=0;i<20;i++)flow.advance(10,mobHost);};
test('actual source Main control affects real eligible actors and retained membership; opacity, collision and coordinates remain independent',async()=>{
 const f=await mobControlsFixture(),{game,flow}=await f.make(),actor=game.field.player,native=actor.native!.entity,before={visible:native.visible,alpha:native.fadeAlpha,position:{...native.position},collision:game.field.collisionState};
 assert(game.field.startEvent('mob-hide'));finish(flow);assert.equal(game.field.stop,null);assert.equal(game.field.mobColorFilterAlpha(actor.id),1);
 assert.deepEqual({visible:native.visible,alpha:native.fadeAlpha,position:{...native.position},collision:game.field.collisionState},before);
 const members=game.field.mobControlsSnapshot!.members;assert(members.some(m=>m.actorId===actor.id));
 assert(game.field.startEvent('mob-restore'));finish(flow);assert.equal(game.field.mobColorFilterAlpha(actor.id),0);assert.deepEqual(game.field.mobControlsSnapshot!.members,members);
});
test('content/runtime dual authorization and actual bad selector failure publish no partial actor filter or hidden list',async()=>{
 for(const pair of[{declared:false},{policy:false}]){const f=await mobControlsFixture(pair),{game}=await f.make();assert(game.field.startEvent('mob-hide'));assert.equal(game.field.stop?.kind,'unsupported');assert.equal(game.field.player.mobColor,undefined);}
 const f=await mobControlsFixture(),{game}=await f.make(),before=game.field.mobControlsSnapshot;assert(game.field.startEvent('mob-bad-selector'));assert.equal(game.field.stop?.kind,'unsupported');assert.deepEqual(game.field.mobControlsSnapshot,before);assert(Object.values(game.field.actors).every(a=>a.mobColor===undefined));
});
test('color tween pauses ordinary visibility update and zero-duration commands preserve an existing color clock',async()=>{
 const f=await mobControlsFixture(),{game,flow}=await f.make(),a=game.field.player,e=a.native!.entity;
 const fade=startFieldActorVisibility(e,false,.2,game.field.time/1000);e.visible=fade.visible;e.fadeAlpha=fade.fadeAlpha;e.visibilityFade=fade.visibilityFade??null;const visibility=structuredClone(e.visibilityFade);
 assert(game.field.startEvent('mob-darken'));flow.advance(50,mobHost);assert(e.visibilityFade);assert.deepEqual(e.visibilityFade,visibility);assert(a.mobColor!.alpha>0);
 assert(game.field.startEvent('mob-restore'));assert.equal(a.mobColor!.alpha,0);flow.advance(20,mobHost);assert(a.mobColor!.alpha>0);
 flow.advance(300,mobHost);assert.equal(a.mobColor!.tween,null);assert.equal(e.visible,false);
});
test('stable native Storage payload reconstructs numeric filters and membership on fresh actors without replay or policy grant',async()=>{
 const f=await mobControlsFixture(),{game,flow}=await f.make();assert(game.field.startEvent('mob-hide'));finish(flow);const saved=game.checkpoint(),bytes=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}}),failure=new CheckpointStorage({getItem:()=>null,setItem:()=>{throw new Error('Controlled quota failure');}});
 assert.throws((await failure.prepareSave(saved,1)).commit,/quota/);assert.deepEqual(game.checkpoint(),saved);
 (await store.prepareSave(saved,1)).commit();const loaded=await store.load();assert(loaded);const restored=f.restore(loaded.checkpoint);
 assert.notEqual(restored.field.player,game.field.player);assert.equal(restored.field.mobColorFilterAlpha(restored.field.player.id),1);assert(restored.field.startEvent('mob-restore'));for(let i=0;i<20;i++)restored.advance(10);assert.equal(restored.field.mobColorFilterAlpha(restored.field.player.id),0);
 const bad=structuredClone(saved);bad.world.field.native!.mobControls!.members[0]!.actorId='unknown';assert.throws(()=>f.restore(bad));
 const active=await f.make();assert(active.game.field.startEvent('mob-darken'));assert.equal(active.game.checkpointReady,false);assert.throws(()=>active.game.checkpoint(),/Cannot save/);
});
test('map failure, discard and stale private candidate preserve live membership; committed transfer keeps tombstones and fences same-ID actors',async()=>{
 const f=await mobControlsFixture(),{game,flow}=await f.make(),old=game.field,oldActor=old.player;
 assert(old.startEvent('mob-hide'));finish(flow);const before=old.mobControlsSnapshot;
 assert(old.startEvent('go-world'));flow.advance(10,mobHost);assert.equal(old.stop?.kind,'map-transition');
 const wrong=structuredClone(f.worldMap);wrong.contentHash='f'.repeat(64);assert.throws(()=>game.world.prepare(f.world,wrong));assert.deepEqual(old.mobControlsSnapshot,before);
 const discarded=game.world.prepare(f.world,f.worldMap);game.world.discard(discarded);assert.equal(game.world.commit(discarded),false);assert.deepEqual(old.mobControlsSnapshot,before);
 const stale=game.world.prepare(f.world,f.worldMap);stale.field.player.mobColor=startMobColor(undefined,1,0,0);assert.equal(game.world.commit(stale),false);assert.equal(game.field,old);assert.deepEqual(old.mobControlsSnapshot,before);
 const retry=game.world.prepare(f.world,f.worldMap);assert(game.world.commit(retry));flow.advance(10,mobHost);const fresh=game.field,newActor=fresh.player;
 assert.equal(newActor.id,oldActor.id);assert.notEqual(newActor,oldActor);assert(fresh.mobControlsSnapshot!.members.every(m=>m.kind==='retired'));assert.equal(fresh.mobColorFilterAlpha(newActor.id),0);
 newActor.mobColor=startMobColor(undefined,1,0,0);assert(fresh.startEvent('mob-restore'));finish(flow);assert.equal(fresh.stop,null);assert.equal(fresh.mobColorFilterAlpha(newActor.id),1);assert.equal(oldActor.mobColor!.alpha,1);
 const time=old.time;old.advance(1000);assert.equal(old.time,time);assert.throws(()=>old.mobColorFilterAlpha(oldActor.id),/retired|Retired|owner|actual/);
 const saved=game.checkpoint(),restored=f.restore(saved);assert(restored.field.mobControlsSnapshot!.members.every(m=>m.kind==='retired'));assert.equal(restored.field.mobColorFilterAlpha(restored.field.player.id),1);
});
test('prepared battle failure, cancellation and once-only victory return preserve the exact live Mob member instance',async()=>{
 const f=await mobControlsFixture(),{game,flow}=await f.make(),field=game.field;
 assert(field.startEvent('mob-hide'));finish(flow);const actor=field.player,color=actor.mobColor,owned=game.state.snapshot(),members=field.mobControlsSnapshot;
 assert(field.startEvent('stone-battle'));assert.equal(field.stop?.kind,'encounter');const request=field.stop;
 let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail){fail=false;throw new Error('Controlled media failure');}return null;},prepareReturn:async()=>null,discard:()=>{}});
 assert.equal((await handoff.start()).status,'failed');assert.equal(field.stop,request);assert.equal(actor.mobColor,color);assert.deepEqual(field.mobControlsSnapshot,members);assert.deepEqual(game.state.snapshot(),owned);
 let release!:(v:null)=>void;const cancel=new GameBattleHandoff(flow,{prepareStart:()=>new Promise<null>(resolve=>{release=resolve;}),prepareReturn:async()=>null,discard:()=>{}}),attempt=cancel.start();cancel.cancel();release(null);assert.equal((await attempt).status,'cancelled');assert.equal(actor.mobColor,color);
 assert.equal((await handoff.start()).status,'committed');const battle=game.battle!;
 for(let i=0;i<3000&&battle.phase==='active';i++){for(const a of battle.ready)assert(battle.command(a.id,10,battle.enemies[0]!.id,100));flow.advance(10,mobHost);}
 assert.equal(battle.phase,'victory');assert.equal((await handoff.return()).status,'committed');flow.advance(10,mobHost);assert.equal(game.field,field);assert.equal(field.player,actor);assert.equal(actor.mobColor,color);assert.deepEqual(field.mobControlsSnapshot,members);
 const after=game.state.snapshot();assert.equal(after.completedBattles.length,owned.completedBattles.length+1);await assert.rejects(handoff.return());assert.deepEqual(game.state.snapshot(),after);
});
test('a proved empty active Web registry replaces membership with empty; an unknown live renderer is not empty or partially tinted',async()=>{
 const f=await mobControlsFixture(),{game,flow}=await f.make();for(const actor of Object.values(game.field.actors))actor.native!.entity.visible=false;
 assert(game.field.startEvent('mob-hide'));finish(flow);assert.equal(game.field.stop,null);assert.deepEqual(game.field.mobControlsSnapshot!.members,[]);assert(Object.values(game.field.actors).every(a=>a.mobColor===undefined));
 assert(game.field.startEvent('mob-restore'));finish(flow);assert.equal(game.field.stop,null);
 const unknown=await f.make(),before=unknown.game.field.mobControlsSnapshot;unknown.game.field.player.native!.entity.childEntityObject='unknown';
 assert(unknown.game.field.startEvent('mob-hide'));assert.equal(unknown.game.field.stop?.kind,'unsupported');assert.deepEqual(unknown.game.field.mobControlsSnapshot,before);assert(Object.values(unknown.game.field.actors).every(a=>a.mobColor===undefined));
});
test('prepared fanout fences actual instances and late validation before any write; a new Hide replaces membership without restoring old members',async()=>{
 const f=await mobControlsFixture(),{game}=await f.make(),{FieldMobControls}=await import('../src/core/field-mob-controls.js'),actors=game.field.actors,
 owner=new FieldMobControls({mapId:game.field.content.map.identity!.mapId,contentHash:game.field.content.contentHash},()=>actors),[one,two]=Object.values(actors).filter(a=>a.native).slice(0,2);
 assert(one&&two);one.native!.entity.visible=true;two.native!.entity.visible=true;const command={kind:'hide' as const,exemptions:[],durationSeconds:0};
 const fail=owner.prepare(command,[one,two],[],0,()=>{throw new Error('Controlled late registry validation');});assert.throws(fail,/late registry/);assert.equal(one.mobColor,undefined);assert.equal(two.mobColor,undefined);assert.deepEqual(owner.snapshot().members,[]);
 const stale=owner.prepare(command,[one,two],[],0,()=>{});actors[two.id]={...two};assert.throws(stale,/Stale Mob/);assert.equal(one.mobColor,undefined);assert.equal(two.mobColor,undefined);actors[two.id]=two;
 owner.prepare(command,[one,two],[],0,()=>{})();assert.equal(one.mobColor!.alpha,1);assert.equal(two.mobColor!.alpha,1);assert.equal(owner.snapshot().members.length,2);
 two.native!.entity.visible=false;owner.prepare({kind:'restore',durationSeconds:0},[one,two],[],0,()=>{})();assert.equal(one.mobColor!.alpha,0);assert.equal(two.mobColor!.alpha,0);assert.equal(owner.snapshot().members.length,2);
 two.native!.entity.visible=true;owner.prepare(command,[one,two],[],0,()=>{})();two.native!.entity.visible=false;owner.prepare(command,[one,two],[one],0,()=>{})();assert.deepEqual(owner.snapshot().members,[]);owner.prepare({kind:'restore',durationSeconds:0},[one,two],[],0,()=>{})();assert.equal(one.mobColor!.alpha,1);
});
