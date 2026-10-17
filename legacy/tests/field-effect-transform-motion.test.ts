import test from 'node:test';import assert from 'node:assert/strict';
import {projectFieldBoardLerp,projectFieldBoardSetPosition} from '../src/core/field-effect-transform-motion.js';
import {fieldCameraCellToWorld} from '../src/core/field-camera.js';
import {GameFlow} from '../src/core/game-flow.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {createWebLogicalFieldEffectsHost} from '../src/core/field-logical-effects.js';
import {movableFieldEffectsFixture} from './fixtures/movable-field-effects.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
test('non-Sprite Lerp uses source absolute cells/int32 origins/direct Y arc and all four unchanged layers',()=>{
 const map={x:-7,y:4,width:20,height:13},command={kind:'lerp' as const,x:-18,y:31,layer:0 as const,duration:2,arcHeight:8,animation:''};
 for(const z of[349,249,149,49]){const position={x:10,y:-30,z},first=projectFieldBoardLerp(position,command,map,null,1);assert.equal(first.flow,'wait');assert.equal(first.position.z,z-5);assert.deepEqual(first.position,{...position,z:z-5});
  const mid=projectFieldBoardLerp(first.position,command,map,first.progress,2),target=fieldCameraCellToWorld(map,{x:-11,y:27},0);assert.equal(mid.position.x,Math.fround((position.x+target.x)/2));assert.equal(mid.position.y,Math.fround((position.y+target.y)/2+8));assert.equal(mid.position.z,z-5);
  const end=projectFieldBoardLerp(mid.position,command,map,mid.progress,3);assert.equal(end.flow,'next');assert.deepEqual(end.position,{x:target.x,y:target.y,z});
  assert.equal(projectFieldBoardLerp(position,{...command,duration:0},map,null,1).flow,'next');
 }
 assert.throws(()=>projectFieldBoardLerp({x:0,y:0,z:49},{...command,animation:'SpriteGuess'},map,null,0),/animation/);
 assert.throws(()=>projectFieldBoardLerp({x:0,y:0,z:49},{...command,layer:1},map,null,0),/layer transition/);
 const current=fieldCameraCellToWorld(map,{x:2,y:3},2);assert.deepEqual(projectFieldBoardSetPosition(current,{x:map.x-1,y:map.y-1,layer:0,animation:''},map),current);
 assert.equal(projectFieldBoardSetPosition(current,{x:-1,y:map.y-1,layer:0,animation:''},map).x,fieldCameraCellToWorld(map,{x:6,y:3},2).x);
 const relative=projectFieldBoardSetPosition(current,{mode:1,referenceEntityId:-1001,x:-2,y:3,layer:0,animation:''},map,{x:8,y:12,z:349});assert.equal(relative.z,149);
 assert.throws(()=>projectFieldBoardSetPosition({...current,z:49},{x:0,y:0,layer:0,animation:''},map),/cannot preserve this source Z layer/);assert.notDeepEqual(relative,current);
});
test('actual Session clocks ordinary and Birdview boards, gates active saves and restores stable moved current pose without replay',async()=>{
 for(const birdview of[false,true]){const f=await movableFieldEffectsFixture({birdview,layer:3,arcHeight:7}),game=await f.make(),flow=new GameFlow(game);flow.start();flow.advance(10,ready);const initial=game.field.fieldEffectsSnapshot!,id=initial.boards[0]!.id;
  assert(game.field.startEvent('fx-transform'));flow.advance(10,ready);assert.equal(game.field.stop,null);assert(game.field.busy);assert.equal(game.checkpointReady,false);assert.throws(()=>game.checkpoint());
  flow.pause(true);const paused=game.field.fieldEffectsSnapshot;flow.advance(100,ready);assert.deepEqual(game.field.fieldEffectsSnapshot,paused);flow.pause(false);
  for(let i=0;i<40&&game.field.busy&&!game.field.stop;i++)flow.advance(10,ready);
  assert.equal(game.field.stop,null);assert.equal(game.field.busy,false);assert(game.checkpointReady);const current=game.field.fieldEffectsSnapshot!;assert.notDeepEqual(current.boards[0]!.position,initial.boards[0]!.position);assert.equal(current.boards[0]!.position.z,49);assert.deepEqual(current.boards[0]!.definition,initial.boards[0]!.definition);assert.equal(current.players[0]!.cameraId,initial.players[0]!.cameraId);
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});await storage.save(game.checkpoint(),1);const saved=(await storage.load())!,restored=f.restore(saved.checkpoint);assert.deepEqual(restored.field.fieldEffectsSnapshot,current);assert.deepEqual(restored.checkpoint(),saved.checkpoint);
  const absent={...f.runtime};delete absent.fieldEffectTransforms;assert.throws(()=>f.restore(saved.checkpoint,absent),/fresh runtime authority|current trusted content/);assert.throws(()=>f.restore(saved.checkpoint,{...f.runtime,fieldEffects:createWebLogicalFieldEffectsHost()}),/matching runtime host/);
  assert.equal(restored.field.fieldEffectsSnapshot!.boards[0]!.id,id);
 }
});
