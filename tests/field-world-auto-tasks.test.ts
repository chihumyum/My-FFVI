import test from 'node:test';import assert from 'node:assert/strict';
import { compileFieldWorldAutoInstruction as compile } from '../src/compiler/field-world-auto-tasks.js';
import { createWorldAutoPose,createWorldAutoQueue,addWorldAutoCommand,advanceWorldAutoQueue,projectFlatWorldAutoPose } from '../src/core/field-world-auto-tasks.js';
import { worldAutoRaw as raw } from './fixtures/world-auto-tasks.js';
const binding={mapId:1,fieldContentHash:'a'.repeat(64)},site={script:'authored',index:0,source:{file:'authored',assetPath:'world-auto'}};
test('native scalar operands preserve float32, explicit r2 start, implicit captured current and rotation increments',()=>{
 for(const name of ['AddAirShipRotateChangeTask','AddAirShipFlightAltitudeChangeTask','AddAirshipUpDownMoveTask']){
  const a=compile(raw(name,[1],[.1,17,-3])).command,b=compile(raw(name,[7],[.1,17,-3])).command;
  assert.equal(a.kind,'add-scalar');if(a.kind!=='add-scalar'||b.kind!=='add-scalar')throw Error('Expected scalar');
  assert.equal(a.start,-3);assert.equal(a.value,17);assert.equal(a.seconds,Math.fround(.1));assert.equal(b.start,null);
 }
 const v=raw('StartAirShipAutoManipulate');assert.deepEqual(compile(v).command,{kind:'start'});
 for(const bad of [{...v,type:0},raw('AddAirShipRotateChangeTask',[0,1]),{...v,operands:{...v.operands,iValues:[0]}},raw('StartAirShipAutoManipulate',[],[.1]),raw('AddAirShipMoveTask')])assert.throws(()=>compile(bad));
});
test('parallel channels and competing same-channel writes keep insertion order; Add captures current before Start and Start never consumes the list',()=>{
 let pose=createWorldAutoPose(binding),queue=createWorldAutoQueue();
 for(const command of [compile(raw('AddAirShipRotateChangeTask',[1],[.02,90,10])).command,compile(raw('AddAirShipFlightAltitudeChangeTask',[1],[.04,1,0])).command])queue=addWorldAutoCommand(queue,pose,command,site);
 assert.equal(queue.tasks.length,2);assert.deepEqual(advanceWorldAutoQueue(queue,pose).pose,pose);
 queue=addWorldAutoCommand(queue,pose,{kind:'start'},site);let step=advanceWorldAutoQueue(queue,pose);queue=step.queue;pose=step.pose;
 assert(pose.rotation>10&&pose.flightAltitude>0);const elapsed=queue.tasks[0]!.elapsed;
 queue=addWorldAutoCommand(queue,pose,{kind:'start'},site);assert.equal(queue.tasks[0]!.elapsed,elapsed);assert.equal(queue.tasks.length,2);
 queue=addWorldAutoCommand(queue,pose,compile(raw('AddAirShipRotateChangeTask',[],[.02,-20])).command,site);
 const pending=queue.tasks[2]!;if(pending.channel==='movement')throw Error('Expected scalar task');const start=pending.start;step=advanceWorldAutoQueue(queue,pose);queue=step.queue;pose=step.pose;assert.equal(pose.rotation,100);assert.equal(queue.tasks[2]!.started,false);
 queue=addWorldAutoCommand(queue,pose,{kind:'start'},site);step=advanceWorldAutoQueue(queue,pose);
 assert.equal(step.pose.rotation,Math.fround(start-10));assert.equal(step.queue.tasks.length,2);assert(step.pose.flightAltitude>pose.flightAltitude);
});
test('zero and negative durations really complete on a tick without writing a synthetic endpoint; flat projection consumes each scalar',()=>{
 let pose=createWorldAutoPose(binding),queue=createWorldAutoQueue();
 for(const name of ['AddAirShipRotateChangeTask','AddAirShipFlightAltitudeChangeTask','AddAirshipUpDownMoveTask'])queue=addWorldAutoCommand(queue,pose,compile(raw(name,[1],[0,99,10])).command,site);
 queue=addWorldAutoCommand(queue,pose,{kind:'start'},site);assert.equal(queue.tasks.length,3);const step=advanceWorldAutoQueue(queue,pose);assert.equal(step.queue.tasks.length,0);assert.deepEqual(step.pose,pose);assert.deepEqual(step.completed,[1,2,3]);
 let negative=addWorldAutoCommand(createWorldAutoQueue(),pose,compile(raw('AddAirshipUpDownMoveTask',[1],[-1,99,10])).command,site);negative=addWorldAutoCommand(negative,pose,{kind:'start'},site);
 const stopped=advanceWorldAutoQueue(negative,pose);assert.equal(stopped.queue.tasks.length,0);assert.deepEqual(stopped.pose,pose);
 assert.deepEqual(projectFlatWorldAutoPose({...pose,rotation:90,flightAltitude:1,upDown:20}),{radians:Math.PI/2,scale:.5,offsetY:-20});
});

test('movement requests observe scalar rotation at their actual parallel list position',()=>{
 const move={kind:'add-movement' as const,seconds:Math.fround(.1),axis:{x:1,y:0},speedId:0};
 for(const before of [false,true]){let pose=createWorldAutoPose(binding),queue=createWorldAutoQueue();const rotation=compile(raw('AddAirShipRotateChangeTask',[1],[.01,90,0])).command;
  for(const command of before?[rotation,move]:[move,rotation])queue=addWorldAutoCommand(queue,pose,command,site);queue=addWorldAutoCommand(queue,pose,{kind:'start'},site);
  const next=advanceWorldAutoQueue(queue,pose);assert.equal(next.movements.length,1);assert.equal(next.movements[0]!.rotation,before?90:0);assert.equal(next.pose.rotation,90);
 }
});
