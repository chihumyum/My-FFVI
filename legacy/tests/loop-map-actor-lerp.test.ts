import test from 'node:test';
import assert from 'node:assert/strict';
import { worldLoopSessionFixture } from './fixtures/world-loop-session.js';
import { sealBatchContent as seal } from './fixtures/content-batch.js';
import { GameSession } from '../src/core/game-session.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import type { Op } from '../src/field/types.js';
import { fieldActorFactoryFixture } from './fixtures/field-actor-factory.js';
import { createFieldActorFactoryCandidate } from '../src/core/field-actor-factory.js';
import { fieldCameraCellToWorld } from '../src/core/field-camera.js';
import { projectFieldScriptLerp } from '../src/core/field-script-motion.js';

async function fixture(animation='',duration=.2){
 const f=await worldLoopSessionFixture(),target=structuredClone(f.worldMap),world=structuredClone(f.world),name='authored-loop-lerp',source=f.source;
 const values=[{kind:'puppet',slot:0,actor:'-1001',target:4},{kind:'exec-puppets',asynchronous:false},
  {kind:'calc',left:{category:'MapLocalVariable',index:4},operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'},
  {kind:'nop'},{kind:'field-script-motion',command:{kind:'lerp',x:-5,y:-3,layer:0,duration,arcHeight:0,animation}},{kind:'exit'}];
 target.scripts[name]=values.map((op,index)=>({...op,script:name,index,source})as Op);
 target.scriptPuppetContexts![name]={...structuredClone(target.scriptPuppetContexts!['world-initialize']!),scriptHash:'f'.repeat(64)};
 (target.scriptLocals??={})[name]=null;(target.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
 (target.scriptTransitionMetadata??={})[name]={customAnimations:'none'};
 const pinned=seal(target);world.maps[target.mapId]!.contentHash=pinned.contentHash;const catalog=seal(world),content=seal({...f.content,worldCatalogHash:catalog.contentHash}),
  game=await GameSession.prepareFrameworkNewGame(content,catalog,f.map,f.battle,{battleHandoff:'prepared'});
 game.advance(10);assert(game.checkpointReady);assert(game.field.startEvent('go-world'));game.advance(10);
 assert.equal(game.field.stop?.kind,'map-transition');const candidate=game.world.prepare(catalog,pinned);assert(game.world.commit(candidate));
 game.advance(10);assert(game.checkpointReady);assert.deepEqual(game.field.content.cameraHost!.loop,{horizontal:true,vertical:true});
 return{...f,game,name,catalog,content,target:pinned,restore:(saved:ReturnType<GameSession['checkpoint']>)=>GameSession.restore(saved,undefined,f.battle,{catalog,map:pinned,initialized:{content,initialMap:f.map}},{battleHandoff:'prepared'})};
}

test('actual looping map Lerp keeps the absolute unwrapped midpoint, endpoint, actor and owned state through Storage',async()=>{
 const f=await fixture(),game=f.game,field=game.field,actor=field.actors['native:puppet:0']!,native=actor.native!.entity,
  owned=game.state.snapshot(),steps=actor.steps;
 assert(field.startEvent(f.name));assert.equal(field.stop,null,field.stop?.message);
 const start={x:actor.x,y:actor.y};assert.equal(actor.motion,null);assert.equal(native.moving,false);assert.equal(game.checkpointReady,false);
 game.advance(100);assert.equal(actor.x,Math.fround(start.x+(-5-start.x)*.5));assert.equal(actor.y,Math.fround(start.y+(-3-start.y)*.5));
 assert.equal(field.actors[actor.id],actor);assert.equal(actor.native!.entity,native);assert.equal(actor.steps,steps);
 for(let i=0;i<100&&!game.checkpointReady&&!field.stop;i++)game.advance(10);
 assert.equal(field.stop,null);assert(game.checkpointReady);assert.equal(actor.x,-5);assert.equal(actor.y,-3);
 assert.equal(field.eventState.read({category:'MapLocalVariable',index:4}),1);assert.deepEqual(game.state.snapshot(),owned);
 const saved=game.checkpoint(),entries=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>entries.get(k)??null,setItem:(k,v)=>{entries.set(k,v);}});
 await storage.save(saved,0);const restored=f.restore((await storage.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),saved);
 assert.equal(restored.field.actors[actor.id]!.x,-5);assert.equal(restored.field.actors[actor.id]!.y,-3);
});

test('zero-time loop Lerp and missing-media first clock retain their existing instruction publication boundary',async()=>{
 const f=await fixture('',0);assert(f.game.field.startEvent(f.name));f.game.advance(20);assert.equal(f.game.field.stop,null);
 const a=f.game.field.actors['native:puppet:0']!;assert.equal(a.x,-5);assert.equal(a.y,-3);assert.equal(a.motion,null);
 const bad=await fixture('MissingLoopMedia'),actor=bad.game.field.actors['native:puppet:0']!;
 assert(bad.game.field.startEvent(bad.name));assert.match(bad.game.field.stop?.message??'',/animation/);
 assert.equal(actor.animation!.hasSourceCustomAnimations,false);assert.equal(bad.game.field.eventState.read({category:'MapLocalVariable',index:4}),0);
});

test('the source accessor subtracts a nonzero map origin without shortening an outside-crop destination',()=>{
 const f=fieldActorFactoryFixture(),map={...f.map.mapRange,x:40,y:50};
 f.input.player.position=fieldCameraCellToWorld(map,{x:2,y:3},0);
 const candidate=createFieldActorFactoryCandidate(f.input),id=candidate.bindings.player,
  command={kind:'lerp' as const,x:map.x+map.width+4,y:map.y-5,layer:0 as const,duration:.5,arcHeight:0,animation:''},
  first=projectFieldScriptLerp(candidate.snapshot,f.input.providers,id,command,map,null,10),
  middle=projectFieldScriptLerp(first.snapshot,f.input.providers,id,command,map,first.progress,10.25),
  last=projectFieldScriptLerp(middle.snapshot,f.input.providers,id,command,map,middle.progress,10.5),
  start=f.input.player.position,target=fieldCameraCellToWorld(map,{x:map.width+4,y:-5},0),
  mid=middle.snapshot.actors.find(a=>a.id===id)!.position;
 assert.equal(mid.x,Math.fround((start.x+target.x)/2));assert.equal(mid.y,Math.fround((start.y+target.y)/2));
 assert.deepEqual(last.snapshot.actors.find(a=>a.id===id)!.position,target);assert.equal(last.flow,'next');
});
