import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFieldFiniteAnimationInstruction } from '../src/compiler/field-play-animation.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { ActorAnimation } from '../src/core/actor-animation.js';
import { FieldGame } from '../src/core/field.js';
import { TileAnimationState } from '../src/core/tile-animation.js';
import { fieldUsesCoreRegisters } from '../src/core/field-core-registers.js';
import { checkpointFixture } from './fixtures/checkpoint-game.js';
import type { Animation, Character, Op, Site } from '../src/field/types.js';
const source = { file: 'synthetic-finite-animation', assetPath: 'Fixture/finite.json', objectId: '9223372036854775807' };
const site = { source, script: 'physical-source-alias', index: 99 };
const raw = (count=3,speed=1) => ({ type: 2, mnemonic: 'PlayAnim', operands: {
  iValues: [0,count,0,0,0,0,0,0], rValues: [speed,0,0,0,0,0,0,0], sValues: ['Wave','','','','','','',''] } });
const clip = (next=''): Animation => ({ duration:.125,mode:0,next,flip:false,
  frames:[{sprite:'pose',x:0,y:0,flip:false,alpha:1}] });
function content(count=3,barrier=false) {
  const f=checkpointFixture();
  for(const c of Object.values(f.field.characters)) {
    c.animations.Wave=clip(); c.animations.A=clip('B');c.animations.B=clip('A');
  }
  const op=decodeFieldOp(raw(count),site,{});assert.equal(op.kind,'animation-play');
  f.field.scripts.finite=[{kind:'nop',...site,index:0},op,
    {...site,index:100,...(barrier?{kind:'event-save' as const}:{kind:'message' as const,key:'DONE',text:'done',speaker:''})},
    {kind:'exit',...site,index:101}];
  f.field.contentHash='finite-fixture';
  return f;
}
function field(count=3,barrier=false) { return new FieldGame(content(count,barrier).field); }
function run(g:FieldGame,until:()=>boolean,steps=500) {
  for(let i=0;i<steps&&!until()&&!g.stop;i++)g.advance(10);
  assert.equal(g.stop,null,g.stop?.message);assert.equal(until(),true);
}

test('the complete finite source form preserves repeat count, speed and source location without granting delay/flip/time limit',()=>{
  for(const count of [2,3,23,0x7fffffff])for(const speed of [0,.5,2]) {
    const op=decodeFieldOp(raw(count,speed),site,{});
    assert.deepEqual(op,{...site,kind:'animation-play',animation:'Wave',speed:Math.fround(speed||1),loop:false,repeatCount:count});
  }
  for(const change of [
    (x:ReturnType<typeof raw>)=>x.type=1,(x:ReturnType<typeof raw>)=>x.operands.iValues[0]=1,
    (x:ReturnType<typeof raw>)=>x.operands.iValues[1]=2.5,(x:ReturnType<typeof raw>)=>x.operands.iValues[7]=1,
    (x:ReturnType<typeof raw>)=>x.operands.rValues[1]=.5,(x:ReturnType<typeof raw>)=>x.operands.rValues[2]=.1,
    (x:ReturnType<typeof raw>)=>x.operands.sValues[7]='unknown',
    (x:ReturnType<typeof raw>)=>x.operands.rValues[0]=Infinity,
    (x:ReturnType<typeof raw>)=>x.operands.rValues[0]=Number.MIN_VALUE,
  ]) {const x=raw();change(x);assert.throws(()=>compileFieldFiniteAnimationInstruction(x));}
  for(const count of [-1,0,1])assert.throws(()=>compileFieldFiniteAnimationInstruction(raw(count)));
});

test('finite operand import rejects sparse/accessor/extra data without invoking accessors or iterators',()=>{
  let reads=0;
  for(const change of [
    (x:ReturnType<typeof raw>)=>delete (x.operands.iValues as unknown[])[0],
    (x:ReturnType<typeof raw>)=>x.operands.rValues.pop(),
    (x:ReturnType<typeof raw>)=>Object.defineProperty(x.operands,'iValues',{enumerable:true,get(){reads++;return Array(8).fill(0);}}),
    (x:ReturnType<typeof raw>)=>Object.defineProperty(x.operands.rValues,'0',{enumerable:true,get(){reads++;return 1;}}),
    (x:ReturnType<typeof raw>)=>Object.defineProperty(x.operands.sValues,Symbol.iterator,{value(){reads++;return [][Symbol.iterator]();}}),
    (x:ReturnType<typeof raw>)=>Object.defineProperty(x.operands,'unknown',{enumerable:true,value:0}),
  ]) {const x=raw();change(x);assert.throws(()=>compileFieldFiniteAnimationInstruction(x));}
  assert.equal(reads,0);
});

test('later Entity playback does not re-Cue the first-clock key and keeps failures atomic',()=>{
  const c=content().field.characters.hero!;const a=new ActorAnimation(c);
  a.play('A',false,2);assert.equal(a.snapshot()!.key,'B');a.advance(70);assert.equal(a.playing,false);
  a.replayEntity('A',2);assert.equal(a.snapshot()!.key,'A');assert.equal(a.snapshot()!.duration,.0625);
  const b=a.snapshot();for(const speed of [0,-1,Infinity,Number.MIN_VALUE])assert.throws(()=>a.replayEntity('A',speed));
  assert.throws(()=>a.replayEntity('absent',1));assert.deepEqual(a.snapshot(),b);
});

test('VM repeats only after actual completion, then continues once; render frame partitions share one clock',()=>{
  const a=field(),b=field();assert.equal(a.startEvent('finite'),true);assert.equal(b.startEvent('finite'),true);
  assert.equal(a.finiteAnimationExecutions.length,1);assert.equal(a.finiteAnimationExecutions[0]!.remaining,3);
  a.advance(120);assert.equal(a.finiteAnimationExecutions.length,1);assert.equal(a.dialogue,null);
  a.advance(10);assert.equal(a.finiteAnimationExecutions[1]!.phase,'replayed');assert.equal(a.dialogue,null);
  a.advance(260);assert.ok(a.dialogue);assert.equal(a.finiteAnimationExecutions.length,4);
  for(const ms of [3,57,70,101,49,110])b.advance(ms);
  assert.deepEqual(a.player.animation!.snapshot(),b.player.animation!.snapshot());
  assert.deepEqual(a.finiteAnimationExecutions,b.finiteAnimationExecutions);
  assert.deepEqual(a.finiteAnimationExecutions.map(x=>x.remaining),[3,2,1,0]);
  const transcript=a.finiteAnimationExecutions;transcript[0]!.site.source.file='tampered';
  assert.equal(a.finiteAnimationExecutions[0]!.site.source.file,source.file);
  assert.equal(a.finiteAnimationExecutions[0]!.site.index,99,'source PC is evidence, actual Web PC was 1');
});

test('stale actual instruction, program and actor identities block before the next owner tick',()=>{
  for(const change of [
    (g:FieldGame)=>{g.content.scripts.finite![1]={...g.content.scripts.finite![1]!};},
    (g:FieldGame)=>{g.content.scripts.finite=[...g.content.scripts.finite!];},
    (g:FieldGame)=>{(g.content.scripts.finite![1] as Extract<Op,{kind:'animation-play'}>).speed=2;},
    (g:FieldGame)=>{g.actors['-1001']={...g.player};},
  ]) {const g=field();g.startEvent('finite');const before=g.player.animation!.snapshot(),time=g.time;change(g);g.advance(10);
    assert.match(g.stop!.message,/Stale finite PlayAnim/);assert.equal(g.time,time);assert.deepEqual(g.player.animation!.snapshot(),before);}
});

test('failed first playback leaves the actor and transcript unchanged and never reaches continuation',()=>{
  const f=content();(f.field.scripts.finite![1] as Extract<Op,{kind:'animation-play'}>).animation='missing';
  const g=new FieldGame(f.field),before=g.player.animation!.snapshot();g.startEvent('finite');
  assert.match(g.stop!.message,/Missing actor animation/);assert.deepEqual(g.player.animation!.snapshot(),before);
  assert.deepEqual(g.finiteAnimationExecutions,[]);assert.equal(g.dialogue,null);
});

test('finite playback blocks stable save, then the existing event continuation stores the single Core counter and restores without replay',()=>{
  const g=field(3,true);g.startEvent('finite');assert.equal(g.checkpointReady,false);assert.throws(()=>g.checkpoint(),/Cannot save/);
  run(g,()=>!!g.eventSaveRequest);const request=g.eventSaveRequest!,saved=g.eventCheckpoint(request);
  assert.ok('execution' in saved);assert.equal(saved.execution.kind,'field-event-continuation-v2');
  const bank=saved.execution.main.generalRegisters!;
  assert.deepEqual(bank.i,[0,3,0,0,0,0,0,0]);assert.deepEqual(bank.r,[0,0,0,0]);
  const restored=FieldGame.restore(g.content,saved);assert.equal(restored.eventSaveRequest,null);
  assert.deepEqual(restored.finiteAnimationExecutions,[]);g.acknowledgeEventSave(request);g.advance(10);restored.advance(10);
  assert.equal(g.busy,false);assert.equal(restored.busy,false);assert.deepEqual(restored.checkpoint(),g.checkpoint());
  restored.advance(1000);assert.deepEqual(restored.finiteAnimationExecutions,[]);
  const old=content();delete (old.field.scripts.finite![1] as Extract<Op,{kind:'animation-play'}>).repeatCount;
  assert.equal(fieldUsesCoreRegisters(old.field),false,'save payload cannot grant the register consumer');
  assert.throws(()=>FieldGame.restore(old.field,saved),/version|content|mismatch/);
});

test('tile repeats invoke the existing Entity playback without resetting accumulated UV/count state',()=>{
  const f=checkpointFixture(),s=new TileAnimationState(f.field.map);s.register(f.field.map.entities);
  s.play('region',false,1);s.advance(70);assert.equal(s.isPlaying('region'),false);const before=s.checkpoint();
  s.replayEntity('region',false,2);assert.deepEqual(s.checkpoint().cells['0:8'],{...before.cells['0:8']!,scale:.5});
  s.advance(10);assert.equal(s.isPlaying('region'),false);assert.equal(s.checkpoint().cells['0:8']!.count,1);
  const last=s.checkpoint();assert.throws(()=>s.replayEntity('region',false,0));assert.deepEqual(s.checkpoint(),last);
});


test('finite playback updates only the native Core slots and r3 copies prior Core.r0 rather than operand speed',()=>{
 const f=content(2,true);f.field.scripts.finite!.unshift({...site,kind:'event-save',index:98});
 const g=new FieldGame(f.field);g.startEvent('finite');const saved=structuredClone(g.eventCheckpoint(g.eventSaveRequest!));assert.ok('execution' in saved);
 const bank=saved.execution.main.generalRegisters!;bank.i=[9,8,7,6,5,4,3,2];bank.r=[2.5,4,6,8];
 const r=FieldGame.restore(f.field,saved);run(r,()=>!!r.eventSaveRequest);const end=r.eventCheckpoint(r.eventSaveRequest!);assert.ok('execution' in end);
 assert.deepEqual(end.execution.main.generalRegisters!.i,[0,2,7,6,5,4,0,0]);
 assert.deepEqual(end.execution.main.generalRegisters!.r,[2.5,4,6,2.5]);
});
