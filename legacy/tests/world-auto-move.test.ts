import {GameMapLoader} from '../src/core/game-map-loader.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {worldAutoMoveFixture,prepareFlatAutoMovement} from './fixtures/world-auto-move.js';
import {worldAutoRaw} from './fixtures/world-auto-tasks.js';
import {GameFlow} from '../src/core/game-flow.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {compileFieldWorldAutoMove} from '../src/compiler/field-world-auto-tasks.js';
import {prepareFlatWorldAutoSegment} from '../src/core/field-world-auto-move.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
async function initialized(options:Parameters<typeof worldAutoMoveFixture>[0]={}){const f=await worldAutoMoveFixture(options),game=await f.make(),flow=new GameFlow(game);flow.start();flow.advance(10,ready);assert(game.checkpointReady);return {...f,game,flow};}
const values=(g:Awaited<ReturnType<typeof initialized>>['game'])=>({owned:g.state.snapshot(),queue:g.field.worldAutoTaskSnapshot,pose:g.field.cameraSnapshot,position:{...g.field.player.native!.entity.position},motion:structuredClone(g.field.player.motion)});
function drain(h:Awaited<ReturnType<typeof initialized>>){for(let i=0;i<1000&&!h.game.checkpointReady;i++){h.game.advance(10);assert.equal(h.game.field.stop,null,h.game.field.stop?.message);}assert(h.game.checkpointReady);}
test('whole native parameter shape and nonunit axes retain the source speed duration and original-axis diagonal multiplier',()=>{
 const command=compileFieldWorldAutoMove(worldAutoRaw('AddAirShipMoveTask',[3],[.2,1.5,.3])).command;assert.equal(command.seconds,Math.fround(.2));assert.equal(command.axis.x,1.5);
 const plan=prepareFlatWorldAutoSegment(command,0,{x:10,y:10},{x:0,y:0,width:100,height:100},{horizontal:false,vertical:false})!;
 assert.equal(plan.motion.to.x,11.5);assert.equal(plan.motion.to.y,Math.fround(10-Math.fround(.3)));assert(Math.abs(plan.motion.duration-Math.fround(Math.fround(.96)*Math.fround(Math.SQRT2))*1000)<1e-8);
 const rotated=prepareFlatWorldAutoSegment({...command,axis:{x:0,y:1}},90,{x:10,y:10},{x:0,y:0,width:100,height:100},{horizontal:false,vertical:false})!;assert.equal(rotated.motion.to.x,9);assert.equal(rotated.motion.to.y,10);
 for(const bad of [worldAutoRaw('AddAirShipMoveTask',[0,1]),worldAutoRaw('AddAirShipMoveTask',[9]),{...worldAutoRaw('AddAirShipMoveTask'),type:2}])assert.throws(()=>compileFieldWorldAutoMove(bad));
});
test('actual following player owns interpolation; task retires before the final real segment drains, then native pose round-trips Storage',async()=>{
 const h=await initialized(),field=h.game.field,owned=h.game.state.snapshot(),from={x:field.player.x,y:field.player.y};prepareFlatAutoMovement(field);
 assert(field.startEvent('auto-move'));assert.equal(field.busy,false);assert.equal(field.player.motion,null);assert.equal(h.game.checkpointReady,false);h.game.advance(10);const motion=field.player.motion!;
 assert(motion);assert(field.player.x>from.x);assert.equal(field.player.y,from.y);assert.equal(field.move('left'),false);h.game.advance(70);
 assert.equal(field.worldAutoTaskSnapshot!.tasks.length,0);assert(field.player.motion);assert.equal(h.game.checkpointReady,false);assert.throws(()=>h.game.checkpoint());drain(h);
 assert.equal(field.player.x,from.x+1);assert.deepEqual(h.game.state.snapshot(),owned);assert.equal(field.worldAutoTaskSnapshot!.actorMovement,undefined);
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>bytes.set(k,v)});await storage.save(h.game.checkpoint(),1);const saved=(await storage.load())!.checkpoint;assert.deepEqual(h.restore(saved).checkpoint(),saved);
});
test('dual authorization and active collision remain precise reached gates; revocation publishes no queue or entity change',async()=>{
 for(const options of [{policy:false},{declared:false}]){const h=await initialized(options),before=h.game.state.snapshot();prepareFlatAutoMovement(h.game.field);assert(h.game.field.startEvent('auto-move'));assert.equal(h.game.field.stop!.kind,'unsupported');assert.equal(h.game.field.worldAutoTaskSnapshot!.tasks.length,0);assert.deepEqual(h.game.state.snapshot(),before);}
 const collision=await initialized();assert(collision.game.field.startEvent('auto-move'));const before=values(collision.game);collision.game.advance(10);assert.match(collision.game.field.stop!.message,/collision\/raycast/);assert.deepEqual(values(collision.game),before);
 const h=await initialized();prepareFlatAutoMovement(h.game.field);assert(h.game.field.startEvent('auto-move-long'));h.game.advance(10);const state=values(h.game);delete h.game.field.content.developmentProfile!.worldAutoMove;h.game.advance(10);assert.match(h.game.field.stop!.message,/both current runtime/);assert.deepEqual(values(h.game),state);
});
test('camera dummy uses the existing camera transform and motion integrator; save waits for its final movement after the task completes',async()=>{
 const h=await initialized(),field=h.game.field,player={x:field.player.x,y:field.player.y};prepareFlatAutoMovement(field);assert(field.startEvent('auto-move-dummy'));const before=field.cameraSnapshot!.dummy.position;
 h.game.advance(10);assert(field.cameraSnapshot!.dummy.position.y>before.y);(Reflect.get(field,'camera') as import('../src/core/field-camera-host.js').FieldCameraHost).prepareVisibility(true).commit();assert.deepEqual({x:field.player.x,y:field.player.y},player);h.game.advance(80);assert.equal(field.worldAutoTaskSnapshot!.tasks.length,0);assert(field.worldAutoTaskSnapshot!.dummyMovement);assert(!h.game.checkpointReady);drain(h);
 const saved=h.game.checkpoint();assert.deepEqual(h.restore(saved).checkpoint(),saved);assert.equal(field.worldAutoTaskSnapshot!.dummyMovement,undefined);
});
test('native busy requests do not reset the same actor segment; ordered competing tasks and repeated Start share one movement owner',async()=>{
 const h=await initialized(),field=h.game.field;prepareFlatAutoMovement(field);assert(field.startEvent('auto-move-combined'));h.game.advance(10);const initial=structuredClone(field.player.motion)!;
 h.game.advance(30);assert.equal(field.player.motion!.to.x,initial.to.x);assert(field.player.motion!.elapsed>initial.elapsed);assert.equal(field.worldAutoTaskSnapshot!.tasks.length,2);drain(h);
 assert(field.worldAutoTaskJournal.filter(row=>row.action==='start').length===2);
});
test('private map candidate queues never tick; cancel/stale/failure preserve source, retry publishes one real following owner',async()=>{
 const h=await initialized({entryMove:true}),old=h.game.field,before=h.game.state.snapshot();assert(old.startEvent('go-world'));h.game.advance(10);
 const canceled=h.game.world.prepare(h.world,h.worldMap),position={...canceled.field.player.native!.entity.position};prepareFlatAutoMovement(canceled.field);canceled.field.advance(100);assert.deepEqual(canceled.field.player.native!.entity.position,position);
 h.game.world.discard(canceled);assert(!h.game.world.commit(canceled));assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);
 const candidate=h.game.world.prepare(h.world,h.worldMap);assert(h.game.world.commit(candidate));drain(h);const current=values(h.game);canceled.field.advance(1000);old.advance(1000);assert.deepEqual(values(h.game),current);
 const bad=await initialized({entryMove:true,lateFailure:true}),state=bad.game.state.snapshot();assert(bad.game.field.startEvent('go-world'));bad.game.advance(10);assert.throws(()=>bad.game.world.prepare(bad.world,bad.worldMap),/failure after movement/);assert.deepEqual(bad.game.state.snapshot(),state);
});
test('a queued shared movement task pauses during actual battle and resumes only after the existing return handoff',async()=>{
 const h=await initialized(),field=h.game.field;prepareFlatAutoMovement(field);assert(field.startEvent('auto-move-battle'));assert.equal(field.stop!.kind,'encounter');assert(h.game.prepareBattleStart()!.commit());const before=values(h.game),battle=h.game.battle!;
 for(let i=0;i<20000&&battle.phase==='active';i++){for(const actor of battle.ready){const target=battle.targets(actor.id,10)[0];if(target)battle.command(actor.id,10,target.id);}h.game.advance(10);}
 assert.equal(battle.phase,'victory');assert.deepEqual(field.worldAutoTaskSnapshot,before.queue);assert.deepEqual(field.player.native!.entity.position,before.position);assert(h.game.prepareBattleReturn()!.commit());drain(h);assert.equal(h.game.state.snapshot().completedBattles.length,1);
});

test('zero and negative task durations retire without a native movement setter, and a known absent following target does not manufacture an actor',async()=>{
 const h=await initialized();assert(h.game.field.startEvent('auto-move-zero'));const before=values(h.game);assert.equal(h.game.field.worldAutoTaskSnapshot!.tasks.length,2);h.game.advance(10);assert.equal(h.game.field.worldAutoTaskSnapshot!.tasks.length,0);assert.deepEqual(h.game.field.player.native!.entity.position,before.position);assert.equal(h.game.field.player.motion,null);assert(h.game.checkpointReady);
 const noTarget=await initialized(),field=noTarget.game.field;assert(field.startEvent('auto-move'));const camera=Reflect.get(field,'camera') as import('../src/core/field-camera-host.js').FieldCameraHost;
 camera.prepareState({...camera.snapshot(),target:null}).commit();const position={...field.player.native!.entity.position};drain(noTarget);assert.deepEqual(field.player.native!.entity.position,position);assert.equal(field.worldAutoTaskSnapshot!.tasks.length,0);
});
test('source InitCameraDummy resets retire its exact transient movement without letting an old segment overwrite the new dummy',async()=>{
 const h=await initialized(),field=h.game.field;prepareFlatAutoMovement(field);assert(field.startEvent('auto-move-dummy-reset'));h.game.advance(10);assert(field.worldAutoTaskSnapshot!.dummyMovement);h.game.advance(100);assert.equal(field.stop,null);assert.equal(field.worldAutoTaskSnapshot!.dummyMovement,undefined);assert(h.game.checkpointReady);
 const pose=field.cameraSnapshot;h.game.advance(1000);assert.deepEqual(field.cameraSnapshot,pose);assert.deepEqual(h.restore(h.game.checkpoint()).checkpoint(),h.game.checkpoint());
});

test('the exact ongoing controller motion retires only with real map media publication; failed, cancelled and stale candidates preserve it for retry',async()=>{
 const h=await initialized(),old=h.game.field;prepareFlatAutoMovement(old);assert(old.startEvent('auto-move-map'));for(let i=0;i<10&&!old.stop;i++)h.game.advance(10);
 assert.equal(old.stop!.kind,'map-transition');const motion=old.player.motion!;assert(motion);assert(old.nativeActorCandidate!.snapshot.actors.find(a=>a.id===old.player.id)!.moving);
 assert.equal(old.nativeMapDepartureCandidate!.snapshot.actors.find(a=>a.id===old.player.id)!.moving,false);assert.equal(old.player.motion,motion);
 const before=values(h.game),contents={world:async()=>h.world,map:async()=>h.worldMap},prepared:import('../src/core/field.js').FieldGame[]=[];
 const failed=new GameMapLoader(h.flow,contents,{prepare:async(field)=>{prepared.push(field);throw Error('authored outgoing movement media failure');},discard(){}});
 assert.equal((await failed.load()).status,'failed');assert.equal(h.game.field,old);assert.equal(old.player.motion,motion);assert.deepEqual(values(h.game),before);assert(prepared[0]!.worldAutoTaskSnapshot!.retired);
 let resolve!:(v:{id:number})=>void,entered!:()=>void;let readyMedia=new Promise<void>(yes=>{entered=yes;});const media=new Promise<{id:number}>(yes=>{resolve=yes;});const canceled=new GameMapLoader(h.flow,contents,{prepare:async()=>{entered();return media;},discard(){}});
 const loading=canceled.load();await readyMedia;canceled.cancel();resolve({id:1});assert.equal((await loading).status,'cancelled');assert.equal(old.player.motion,motion);assert.deepEqual(values(h.game),before);
 let complete!:(v:{id:number})=>void;readyMedia=new Promise<void>(yes=>{entered=yes;});const staleMedia=new Promise<{id:number}>(yes=>{complete=yes;}),stale=new GameMapLoader(h.flow,contents,{prepare:async()=>{entered();return staleMedia;},discard(){}});
 const pending=stale.load();await readyMedia;
 // A late native component update during held media invalidates the captured
 // actual source snapshot. This is an explicit callback/fence probe; the Web
 // Flow normally holds its old field clock during map I/O.
 const source={...old.player.native!.entity.position};old.player.native!.entity.position.x=Math.fround(source.x+1);complete({id:2});assert.equal((await pending).status,'failed');assert.equal(h.game.field,old);assert.equal(old.player.motion,motion);assert.equal(old.worldAutoTaskSnapshot!.retired,false);
 Object.assign(old.player.native!.entity.position,source);const retry=new GameMapLoader(h.flow,contents,{prepare:async()=>({id:3}),discard(){}});assert.equal((await retry.load()).status,'committed');assert.notEqual(h.game.field,old);assert.equal(old.player.motion,null);assert(old.worldAutoTaskSnapshot!.retired);h.game.advance(10);const current=values(h.game);old.advance(1000);assert.deepEqual(values(h.game),current);
 const unrelated=await initialized();assert(unrelated.game.field.startEvent('go-world'));unrelated.game.advance(10);unrelated.game.field.player.motion={from:{x:3,y:4},to:{x:4,y:4},elapsed:0,duration:240,manual:true};
 assert(unrelated.game.field.nativeMapDepartureCandidate!.snapshot.actors.find(a=>a.id===unrelated.game.field.player.id)!.moving);assert.throws(()=>unrelated.game.world.prepare(unrelated.world,unrelated.worldMap),/moving|movement|actor|identity/i);
});
