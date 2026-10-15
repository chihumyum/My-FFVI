import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFieldOp } from '../src/compiler/field.js';
import { compileFieldViewChangeInstruction } from '../src/compiler/field-view-change.js';
import { projectFieldViewChange, parseFieldDynamicView, WEB_FLAT_FIELD_VIEW_CHANGE } from '../src/core/field-view-change.js';
import { FieldCameraHost } from '../src/core/field-camera-host.js';
import { createFieldCameraState } from '../src/core/field-camera.js';
const raw=(request=1,rate=0)=>({type:1,mnemonic:'ChangeView',operands:{iValues:[request,...Array(7).fill(0)],rValues:[rate,...Array(7).fill(0)],sValues:Array(8).fill('')}});
const binding={mapId:1,isWorld:true,fieldContentHash:'1'.repeat(64)};
const site={script:'original',index:99,source:{file:'controlled',assetPath:'view'}};
test('ChangeView decodes source rate as float32 reciprocal and synchronous polarity, never as milliseconds',()=>{
  for(const [rate,wait]of [[0,true],[.016,true],[-.016,false]] as const){const r=raw(1,rate),original=structuredClone(r),op=compileFieldViewChangeInstruction(r);
    assert.equal(op.command.wait,wait);assert.equal(op.command.timeScale,rate===0?1:Math.fround(1/Math.abs(Math.fround(rate))));assert.deepEqual(r,original);assert.equal(decodeFieldOp(r,site,{}).kind,'field-view-change');}
  assert.throws(()=>compileFieldViewChangeInstruction(raw(2)));for(const key of ['iValues','rValues','sValues'] as const){const r=raw();r.operands[key][7]=key==='sValues'?'unresolved':1 as never;assert.throws(()=>compileFieldViewChangeInstruction(r));}
  for(const type of [0,2,3])assert.equal(decodeFieldOp({...raw(),type},site,{}).kind,'blocked');
  let reads=0;const r=raw();Object.defineProperty(r.operands.rValues,0,{get(){reads++;return .016;},enumerable:true});assert.throws(()=>compileFieldViewChangeInstruction(r));assert.equal(reads,0);
  assert.throws(()=>compileFieldViewChangeInstruction(raw(1,Number.MIN_VALUE/2||1e-45)));
});
test('world Normal is FlatBird2; nonworld Bird is a true early branch-return without a new current view',()=>{
  assert.equal(projectFieldViewChange(binding,compileFieldViewChangeInstruction(raw(0)).command)!.mapViewType,2);
  assert.equal(projectFieldViewChange(binding,compileFieldViewChangeInstruction(raw(1)).command)!.mapViewType,1);
  assert.equal(projectFieldViewChange({...binding,isWorld:false},compileFieldViewChangeInstruction(raw(1)).command),null);
  const v=projectFieldViewChange(binding,compileFieldViewChangeInstruction(raw(1)).command)!;
  assert.throws(()=>parseFieldDynamicView(v,{...binding,mapId:2}));assert.throws(()=>parseFieldDynamicView({...v,mapViewType:0}));
});
test('the same camera owns dynamic view, rejects stale commits, and restores only under its trusted map binding',()=>{
  const definition={kind:'source-field-camera-host-v1' as const,mapRange:{x:0,y:0,width:32,height:32},loop:{horizontal:true,vertical:true},playerVisualOffset:{x:0,y:-6},callbacks:'fresh-normal-field-v1' as const,sources:[{file:'dll',sha256:'1'.repeat(64)},{file:'prefab',sha256:'2'.repeat(64)}]},ports={readPlayer:()=>({cell:{x:2,y:3},logicalLayer:0,direction:'down' as const}),readScrollOffset:()=>({x:0,y:0})};
  const camera=new FieldCameraHost(definition,ports,createFieldCameraState(),binding),before=camera.snapshot();
  const a=camera.prepareView(compileFieldViewChangeInstruction(raw()).command),b=camera.prepareView(compileFieldViewChangeInstruction(raw(0)).command);
  assert.deepEqual(camera.snapshot(),before);a.state.dummy.position.x=999;a.commit();assert.notEqual(camera.snapshot().dummy.position.x,999);assert.throws(()=>b.commit(),/Stale/);
  const saved=camera.snapshot();assert.equal(saved.kind,'field-camera-v3');assert.throws(()=>new FieldCameraHost(definition,ports,saved));
  assert.throws(()=>new FieldCameraHost(definition,ports,saved,{...binding,mapId:2}));assert.deepEqual(new FieldCameraHost(definition,ports,saved,binding).snapshot(),saved);
  assert.equal(a.callbackDisposition,'web-flat-not-installed');assert.equal((saved as any).view.policy,WEB_FLAT_FIELD_VIEW_CHANGE);
});
