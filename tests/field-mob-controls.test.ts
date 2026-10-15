import test from 'node:test';import assert from 'node:assert/strict';
import {compileFieldMobControl}from'../src/compiler/field-mob-controls.js';
import{startMobColor,tickMobColor,parseMobControlCommand}from'../src/core/field-mob-controls.js';
import{mobRaw}from'./fixtures/mob-controls.js';
test('Mob full operands preserve five source exemptions and float material duration; malformed selectors/tails stay blocked',()=>{
 assert.deepEqual(compileFieldMobControl(mobRaw('HideMob',[32,46,47],.7)),{kind:'field-mob-control',command:{kind:'hide',exemptions:[32,46,47],durationSeconds:Math.fround(.7)}});
 for(const mutate of[(v:any)=>{v.type=2},(v:any)=>{v.operands.iValues[5]=1},(v:any)=>{v.operands.rValues[1]=1},(v:any)=>{v.operands.sValues[0]='unknown'},(v:any)=>{v.operands.rValues[0]=-1}]){const raw=mobRaw('HideMob');mutate(raw);assert.throws(()=>compileFieldMobControl(raw));}
 assert.throws(()=>compileFieldMobControl(mobRaw('RestoreMob',[1])));
 assert.throws(()=>parseMobControlCommand({kind:'unknown',durationSeconds:0} as any),/Unknown Mob/);
 assert.throws(()=>parseMobControlCommand({kind:'restore',exemptions:[1],durationSeconds:0} as any));
 assert.throws(()=>parseMobControlCommand({kind:'hide',exemptions:[0],durationSeconds:0}));
});
test('black-filter clock is independent of opacity and retains source zero-duration and strict-completion quirks',()=>{
 const a=startMobColor(undefined,1,1,0);assert.equal(a.alpha,0);const b=tickMobColor(a,.5);assert.equal(b.alpha,.5);
 assert.equal(tickMobColor(a,1).tween!==null,true);assert.equal(tickMobColor(a,1.01).tween,null);
 const instant=startMobColor(b,0,0,.5);assert.equal(instant.alpha,0);assert.deepEqual(instant.tween,b.tween);assert.equal(tickMobColor(instant,.75).alpha,.75);
 const restore=startMobColor(b,0,1,2);assert.equal(restore.alpha,.5);assert.equal(tickMobColor(restore,2.25).alpha,.75);assert.equal(tickMobColor(restore,3.01).alpha,0);
 assert.equal(a.alpha,0);assert.throws(()=>startMobColor(a,1,-1,1));
});
