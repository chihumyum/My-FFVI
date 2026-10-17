import test from 'node:test';import assert from 'node:assert/strict';
import { GameFlow } from '../src/core/game-flow.js';import { CheckpointStorage } from '../src/core/saved-game.js';
import { worldAutoSessionFixture } from './fixtures/world-auto-tasks.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
async function initialized(options:Parameters<typeof worldAutoSessionFixture>[0]={}){const f=await worldAutoSessionFixture(options),game=await f.make(),flow=new GameFlow(game);flow.start();flow.advance(10,ready);assert(game.checkpointReady);return {...f,game,flow};}
test('real Session source commands return immediately, tick parallel pose on the existing field clock, and only stable pose can round-trip Storage',async()=>{
 const h=await initialized(),{game}=h,field=game.field,owned=game.state.snapshot();assert(field.startEvent('auto'));assert.equal(field.worldAutoTaskSnapshot!.tasks.length,3);
 assert.equal(field.busy,false);assert.equal(game.checkpointReady,false);assert.throws(()=>game.checkpoint());assert.equal(field.worldAutoPose!.rotation,0);
 game.advance(10);assert(field.worldAutoPose!.rotation>10);assert(field.worldAutoPose!.flightAltitude>0);assert(field.worldAutoPose!.upDown>-10);
 game.advance(100);assert.equal(game.checkpointReady,true);assert.equal(field.worldAutoPose!.rotation,100);assert.equal(field.worldAutoPose!.flightAltitude,1);assert.equal(field.worldAutoPose!.upDown,20);assert.deepEqual(game.state.snapshot(),owned);
 const slots=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>slots.set(k,v)});await storage.save(game.checkpoint(),1);const saved=(await storage.load())!;
 const restored=h.restore(saved.checkpoint);assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert.deepEqual(restored.field.worldAutoPose,field.worldAutoPose);assert.equal(restored.field.worldAutoTaskSnapshot!.tasks.length,0);
 assert.throws(()=>h.restore(saved.checkpoint,{battleHandoff:'prepared'}),/cannot grant/);
 const forged=structuredClone(saved.checkpoint);if(!forged.world.field.camera||forged.world.field.camera.kind!=='field-camera-v4')throw Error('Expected stable pose');forged.world.field.camera.worldAuto.binding.mapId++;
 assert.throws(()=>h.restore(forged),/another field/);assert.deepEqual(restored.state.snapshot(),owned);
});
test('runtime alone and trusted content alone cannot grant tasks; active event saves stay explicit hard gates',async()=>{
 for(const options of [{policy:false},{declared:false}]){const h=await initialized(options),before=h.game.state.snapshot();assert(h.game.field.startEvent('auto'));assert.equal(h.game.field.stop!.kind,'unsupported');assert.deepEqual(h.game.state.snapshot(),before);assert.equal(h.game.field.cameraSnapshot!.kind,'field-camera-v2');}
 const h=await initialized();assert(h.game.field.startEvent('auto-save-active'));assert.equal(h.game.field.stop!.kind,'unsupported');assert.match(h.game.field.stop!.message,/quiescent/);assert.equal(h.game.field.worldAutoTaskSnapshot!.tasks.length,1);
});
test('real map candidate task initialization is held until publication; cancellation and stale queue changes retire private work, then retry succeeds',async()=>{
 const h=await initialized({entryTasks:true}),{game}=h,old=game.field,before=game.state.snapshot();assert(old.startEvent('go-world'));game.advance(10);
 const canceled=game.world.prepare(h.world,h.worldMap);assert.equal(canceled.field.worldAutoTaskSnapshot!.tasks.length,1);assert.equal(canceled.field.worldAutoTaskSnapshot!.prepared,true);canceled.field.advance(100);assert.equal(canceled.field.worldAutoPose!.upDown,0);
 game.world.discard(canceled);assert.equal(canceled.field.worldAutoTaskSnapshot!.retired,true);assert.equal(game.world.commit(canceled),false);assert.equal(game.field,old);assert.deepEqual(game.state.snapshot(),before);
 const stale=game.world.prepare(h.world,h.worldMap);assert(stale.field.startEvent('auto-start'));assert.equal(game.world.commit(stale),false);assert.equal(stale.field.worldAutoTaskSnapshot!.retired,true);
 const candidate=game.world.prepare(h.world,h.worldMap);assert(game.world.commit(candidate));assert.equal(old.worldAutoTaskSnapshot!.retired,true);game.advance(100);assert.equal(game.field.worldAutoPose!.upDown,20);assert(game.checkpointReady);
 const pose=game.field.worldAutoPose;old.advance(100);canceled.field.advance(100);assert.deepEqual(game.field.worldAutoPose,pose);assert.equal(game.state.snapshot().items.find(i=>i.id===701)!.count,before.items.find(i=>i.id===701)!.count+1);
 assert(game.field.startEvent('world-return'));game.advance(10);assert(game.world.commit(game.world.prepare(h.world,h.map)));game.advance(10);assert.equal(game.field.worldAutoPose!.upDown,0);
});
test('late source initializer failure after Add/Start cannot publish owned rewards or change the outgoing camera',async()=>{
 const h=await initialized({entryTasks:true,lateFailure:true}),{game}=h,old=game.field,before=game.state.snapshot(),pose=old.worldAutoPose;assert(old.startEvent('go-world'));game.advance(10);
 for(let n=0;n<2;n++)assert.throws(()=>game.world.prepare(h.world,h.worldMap),/failed after queue/);
 assert.equal(game.field,old);assert.deepEqual(game.state.snapshot(),before);assert.deepEqual(old.worldAutoPose,pose);assert.equal(old.worldAutoTaskSnapshot!.retired,false);
});
test('battle uses the same Field/camera but never advances its auto tasks; actual victory/return resumes the held queue once',async()=>{
 const h=await initialized(),{game}=h,field=game.field;assert(field.startEvent('auto-add'));assert(field.startEvent('auto-start'));game.advance(10);assert(field.startEvent('auto-fight'));game.advance(10);assert(game.prepareBattleStart()!.commit());
 const pose=field.worldAutoPose,queue=field.worldAutoTaskSnapshot,battle=game.battle!;
 for(let n=0;n<20000&&battle.phase==='active';n++){for(const actor of battle.ready){const target=battle.targets(actor.id,10)[0];if(target)battle.command(actor.id,10,target.id);}game.advance(10);}
 assert.equal(battle.phase,'victory');assert.deepEqual(field.worldAutoPose,pose);assert.deepEqual(field.worldAutoTaskSnapshot,queue);assert(game.prepareBattleReturn()!.commit());assert.equal(game.field,field);game.advance(500);assert.equal(field.worldAutoTaskSnapshot!.tasks.length,0);assert(game.checkpointReady);assert.equal(game.state.snapshot().completedBattles.length,1);
});
test('revoked trusted content or changed current field identity cannot continue a running queue or publish another scalar',async()=>{
 for(const mutate of [(h:Awaited<ReturnType<typeof initialized>>)=>{delete h.game.field.content.developmentProfile!.worldAutoTasks;},
  (h:Awaited<ReturnType<typeof initialized>>)=>{h.game.field.content.map.identity!.mapId++;}]){
  const h=await initialized(),{game}=h;assert(game.field.startEvent('auto'));game.advance(10);const pose=game.field.worldAutoPose,queue=game.field.worldAutoTaskSnapshot,owned=game.state.snapshot();
  mutate(h);game.advance(10);assert.equal(game.field.stop!.kind,'unsupported');assert.match(game.field.stop!.message,/camera\/content\/clock owner changed/);
  assert.deepEqual(game.field.worldAutoPose,pose);assert.deepEqual(game.field.worldAutoTaskSnapshot,queue);assert.deepEqual(game.state.snapshot(),owned);
 }
});
