import test from 'node:test';import assert from 'node:assert/strict';
import {setposOwnerFixture,setposRaw,setposOp,setposHost as ready} from './fixtures/setpos-owner.js';
import {resolveFieldPuppetActor} from '../src/core/field-puppet-actors.js';
import {fieldCameraWorldToCell,fieldCameraCellToWorld,createFieldCameraState,projectFieldCameraSetPosition} from '../src/core/field-camera.js';
import {FieldCameraHost} from '../src/core/field-camera-host.js';
import {GameMapLoader} from '../src/core/game-map-loader.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {retainedViewFixture,enterRetainedViewWorld} from './fixtures/retained-view-session.js';
import type{FieldGame}from '../src/core/field.js';import type{Op}from '../src/field/types.js';
async function initialized(options:Parameters<typeof setposOwnerFixture>[0]={}){const f=await setposOwnerFixture(options),s=await f.make();assert(s.game.checkpointReady);return{...f,...s};}
function drain(h:Awaited<ReturnType<typeof initialized>>){for(let i=0;i<200&&!h.game.checkpointReady;i++){h.flow.advance(10,ready);assert.equal(h.game.field.stop,null,h.game.field.stop?.message);}assert(h.game.checkpointReady);}
function binding(field:FieldGame,selector:number){const {catalog,context}=field.options.puppetActors!.read();return resolveFieldPuppetActor(catalog,context,selector).actor!;}
function prepare(field:FieldGame,raw=setposRaw()){return (Reflect.get(field,'prepareCameraPosition')as (op:Op)=>()=>void).call(field,setposOp(raw));}
function nativePoint(field:FieldGame,id:string){return id===field.cameraActorId?field.cameraSnapshot!.dummy.position:field.actors[id]!.native!.entity.position;}
const actorValues=(field:FieldGame)=>field.nativeActorCandidate!.snapshot.actors.map(({animation,...actor})=>({...actor,animation:animation?.snapshot()??null}));
const serial=(field:FieldGame)=>({camera:field.cameraSnapshot,actors:field.nativeActorStateFingerprint});
test('relative dummy position uses the existing selector and source layer while preserving view/world-auto state and all actual actor identities',async()=>{
 for(const ref of [-1001,0]){const h=await initialized({raw:setposRaw(1,ref,1,-1)}),field=h.game.field,actors={...field.actors},owned=h.game.state.snapshot();
  assert(field.startEvent('setpos'));const initial=field.cameraSnapshot!,anchor=fieldCameraWorldToCell(field.content.cameraHost!.mapRange,{x:nativePoint(field,binding(field,ref)).x,y:nativePoint(field,binding(field,ref)).y});
  assert.equal(initial.kind,'field-camera-v4');const expected=fieldCameraCellToWorld(field.content.cameraHost!.mapRange,{x:anchor.x+1,y:anchor.y-1},[349,249,149].indexOf(initial.dummy.position.z));
  assert(!h.game.checkpointReady);for(let i=0;i<10&&JSON.stringify(field.cameraSnapshot!.dummy.position)!==JSON.stringify(expected);i++)h.flow.advance(10,ready);assert.deepEqual(field.cameraSnapshot!.dummy.position,expected);drain(h);
  assert.deepEqual((field.cameraSnapshot as any).worldAuto,(initial as any).worldAuto);assert.deepEqual((field.cameraSnapshot as any).view,(initial as any).view);
  for(const[id,a]of Object.entries(actors))assert.equal(field.actors[id],a);assert.deepEqual(h.game.state.snapshot(),owned);
  prepare(field,setposRaw(1,ref,1,-1))();const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>bytes.set(k,v)}),saved=h.game.checkpoint();await storage.save(saved,1);assert.deepEqual(h.restore((await storage.load())!.checkpoint).checkpoint(),saved);
 }
});
test('the complete source positioning contract resolves actor self, leader and camera through the same native roster rather than the real-player shortcut',async()=>{
 for(const [actor,ref]of [['-1001',-1001],['-1002',-1001],['-1001',0]]as const){const h=await initialized({actor,raw:setposRaw(1,ref,-1,1)}),field=h.game.field;assert(field.startEvent('setpos'));
  const id=binding(field,Number(actor)),destination=field.actors[id]!,entity=destination.native!.entity,reference=nativePoint(field,binding(field,ref)),map=field.content.cameraHost!.mapRange,
   anchor=fieldCameraWorldToCell(map,{x:reference.x,y:reference.y}),expected=fieldCameraCellToWorld(map,{x:anchor.x-1,y:anchor.y+1},[349,249,149].indexOf(entity.position.z));
  drain(h);assert.equal(field.actors[id],destination);assert.equal(destination.native!.entity,entity);assert.deepEqual(entity.position,expected);
 }
});
test('relative camera candidates reject same-ID replacement, changed reference pose/selector/port/callback and stale camera without partial publication; fresh retry is single use',async()=>{
 for(const fault of ['instance','position','selector','port','callback','camera','factory','bindings','policy']as const){const h=await initialized(),field=h.game.field,id=binding(field,-1001),actor=field.actors[id]!,port=field.options.puppetActors!,publish=prepare(field),camera=Reflect.get(field,'camera')as FieldCameraHost;
  if(fault==='instance')field.actors[id]={...actor};
  if(fault==='position')actor.native!.entity.position.x+=1;
  if(fault==='selector'||fault==='port')Reflect.set(field.options,'puppetActors',fault==='port'?{...port}:{...port,read:()=>{const v=port.read();v.context.partyPuppets[0]=v.context.partyPuppets[1]!;return v;}});
  if(fault==='callback')Reflect.set(field.content.cameraHost!,'callbacks','unknown');
  if(fault==='camera')camera.prepareInitializeDummy().commit();
  if(fault==='factory'){const runtime=Reflect.get(field,'nativeRuntime');runtime.mapLifecycle.factory=structuredClone(runtime.mapLifecycle.factory);}
  if(fault==='bindings')Reflect.set(field,'nativeActorBindings',structuredClone(Reflect.get(field,'nativeActorBindings')));
  if(fault==='policy')Reflect.set(field.options,'viewChange',undefined);const before=serial(field);
  assert.throws(publish,/Stale|selector owner/);assert.deepEqual(serial(field),before);
 }
 const h=await initialized(),publish=prepare(h.game.field);publish();const after=serial(h.game.field);assert.throws(publish,/Stale/);assert.deepEqual(serial(h.game.field),after);
});
test('missing native reference, callback, animation and layer remain precise hard gates; save data cannot supply an owner',async()=>{
 for(const raw of [setposRaw(1,999999),setposRaw(1,-1001,1,1,1),setposRaw(1,-1001,1,1,0,'Default')]){const h=await initialized({raw}),field=h.game.field;assert(field.startEvent('setpos'));const before=serial(field),owned=h.game.state.snapshot();
  for(let i=0;i<20&&!field.stop;i++)h.flow.advance(10,ready);assert.equal(field.stop!.kind,'unsupported');assert.deepEqual(serial(field),before);assert.deepEqual(h.game.state.snapshot(),owned);assert(!h.game.checkpointReady);
 }
 const h=await initialized(),saved=h.game.checkpoint();(saved.world.field.camera as any).callbacks='fresh-normal-field-v1';assert.throws(()=>h.restore(saved),/camera|checkpoint|fields/);
});
test('relative camera SetPos is refused during an actual auto-controller segment and cannot retire or overwrite its movement',async()=>{
 const h=await initialized(),field=h.game.field;const{prepareFlatAutoMovement}=await import('./fixtures/world-auto-move.js');prepareFlatAutoMovement(field);assert(field.startEvent('auto-move-dummy'));h.game.advance(10);assert(field.worldAutoTaskSnapshot!.dummyMovement);const before=serial(field),motion=field.worldAutoTaskSnapshot;
 assert.throws(()=>prepare(field),/active movement/);assert.deepEqual(serial(field),before);assert.deepEqual(field.worldAutoTaskSnapshot,motion);
});
test('absolute camera command retains its exact legacy shape and coordinates; relative mode rejects missing anchor and extra fields',()=>{
 const state=createFieldCameraState();state.dummy.position={x:-100,y:54,z:349};state.dummy.layer=9;const map={x:11,y:-7,width:20,height:16},command={kind:'set-position' as const,x:10,y:0,layer:0 as const};
 const p=projectFieldCameraSetPosition(state,command,map);assert.deepEqual(p.state.dummy.position,{x:-104,y:8,z:349});assert.deepEqual(Object.keys(command).sort(),['kind','layer','x','y']);
 assert.throws(()=>projectFieldCameraSetPosition(state,{...command,mode:1,referenceEntityId:-1001},map),/reference entity/);assert.throws(()=>projectFieldCameraSetPosition(state,{...command,mode:0}as never,map));
});
test('held map media failure/cancel/stale keeps old camera and shared writes; retry publishes the destination once',async()=>{
 const h=await initialized({entryPosition:true}),old=h.game.field;assert(old.startEvent('go-world'));h.flow.advance(10,ready);const before=serial(old),owned=h.game.state.snapshot(),contents={world:async()=>h.world,map:async()=>h.worldMap};
 const failed=new GameMapLoader(h.flow,contents,{prepare:async()=>{throw Error('Authored SetPos map media failure');},discard(){}});assert.equal((await failed.load()).status,'failed');assert.equal(h.game.field,old);assert.deepEqual(serial(old),before);assert.deepEqual(h.game.state.snapshot(),owned);
 let enter!:(f:FieldGame)=>void,finish!:(f:FieldGame)=>void;const entered=new Promise<FieldGame>(r=>enter=r),media=new Promise<FieldGame>(r=>finish=r),loader=new GameMapLoader(h.flow,contents,{prepare:async field=>{enter(field);return media;},discard(){}});
 const pending=loader.load(),abandoned=await entered;loader.cancel();finish(abandoned);assert.equal((await pending).status,'cancelled');assert.equal(h.game.field,old);assert.deepEqual(serial(old),before);assert.deepEqual(h.game.state.snapshot(),owned);
 let enter2!:()=>void,finish2!:(v:null)=>void;const reached=new Promise<void>(r=>enter2=r),media2=new Promise<null>(r=>finish2=r),stale=new GameMapLoader(h.flow,contents,{prepare:async()=>{enter2();return media2;},discard(){}}),loading=stale.load();await reached;
 const camera=Reflect.get(old,'camera')as FieldCameraHost;camera.prepareVisibility(false).commit();const changed=serial(old);finish2(null);assert.equal((await loading).status,'failed');assert.equal(h.game.field,old);assert.deepEqual(serial(old),changed);
 const retry=new GameMapLoader(h.flow,contents,{prepare:async()=>null,discard(){}});assert.equal((await retry.load()).status,'committed');h.flow.advance(10,ready);assert(h.game.checkpointReady);assert.notEqual(h.game.field,old);const after=h.game.checkpoint();abandoned.advance(100);old.advance(100);assert.deepEqual(h.game.checkpoint(),after);
 const bad=await initialized({entryPosition:true,lateFailure:true});assert(bad.game.field.startEvent('go-world'));bad.flow.advance(10,ready);const b=serial(bad.game.field),state=bad.game.state.snapshot();assert.throws(()=>bad.game.world.prepare(bad.world,bad.worldMap),/private SetPos/);assert.deepEqual(serial(bad.game.field),b);assert.deepEqual(bad.game.state.snapshot(),state);
});
test('relative dummy placement reads a declared riding reference in the same flat world view without rewriting transport or appearance',async()=>{
 const h=await retainedViewFixture();enterRetainedViewWorld(h);const field=h.game.field;field.prepareViewChange({kind:'change-view',requestedViewType:1,timeScale:1,wait:true}).commit();
 const owned=h.game.state.snapshot(),actors=actorValues(field),view=field.currentView,party=field.partyActorCheckpoint;assert(field.player.native!.entity.riding);prepare(field)();assert.deepEqual(h.game.state.snapshot(),owned);assert.deepEqual(actorValues(field),actors);assert.deepEqual(field.currentView,view);assert.deepEqual(field.partyActorCheckpoint,party);
});

test('camera relative arithmetic floors a non-cell reference before float32 offsets and preserves destination Z without subtracting origin twice',()=>{
 const state=createFieldCameraState();state.dummy.position={x:-100,y:54,z:349};state.dummy.layer=9;
 const p=projectFieldCameraSetPosition(state,{kind:'set-position',mode:1,referenceEntityId:601,x:-2,y:3,layer:0},{x:11,y:-7,width:20,height:16},{x:-77,y:30,z:149});
 assert.deepEqual(p.state.dummy.position,{x:-104,y:-24,z:349});assert.deepEqual(state.dummy.position,{x:-100,y:54,z:349});
 const h=setposOp();if(h.kind!=='position')assert.fail('Expected decoded position');h.nativeCommand!.x+=1;
 return initialized().then(f=>{const field=f.game.field,before=serial(field);assert.throws(()=>(Reflect.get(field,'prepareCameraPosition')as(op:Op)=>()=>void).call(field,h),/operand shape/);assert.deepEqual(serial(field),before);});
});
