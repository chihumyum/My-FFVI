import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,canonical} from '../dist/src/compiler/content.js';
import {validateSourceCandidateBoardTransforms as validate} from './source-candidate.mjs';
import {createSourceCandidateBoardByteValidator as create} from './source-candidate-board-validation.mjs';
const bytes=v=>Buffer.from(JSON.stringify(v));
function fixture(){const projection={kind:'source-test-projection',items:[{id:'a',position:{x:1,y:2}}]},effects={boardTransforms:projection,allObjects:[{id:'a'}]},lock={kind:'source-prerequisite-input-lock-v4',fieldEffectTransforms:'web-board-test',fieldEffectCatalogHash:hash(effects),fieldEffectTransformCatalog:{projection}},value={kind:'world-map-development',developmentProfile:{fieldEffectTransforms:'web-board-test'},fieldEffects:effects};return{projection,effects,lock,value};}
test('every fresh object is checked, while exact JSON subtrees reuse successful canonical results',()=>{
 const f=fixture();let validations=0,hashes=0,forms=0;const reader=create(bytes(f.lock),{validate:(...a)=>{validations++;validate(...a);},hash:v=>{hashes++;return hash(v);},canonical:v=>{forms++;return canonical(v);}});
 const a=reader.parseAndValidate(bytes(f.value)),counts=[hashes,forms];assert.throws(()=>{a.fieldEffects.allObjects[0].id='caller edit';},TypeError);
 assert.deepEqual(reader.parseAndValidate(bytes(f.value)),f.value);assert.deepEqual([hashes,forms],counts);assert.equal(validations,2);
});
test('a stale claimed header cannot conceal a changed actual effect catalog or projection',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.value));
 const bad=structuredClone(f.value);bad.fieldEffects.allObjects[0].id='wrong';bad.contentHash='a'.repeat(64);
 assert.throws(()=>reader.parseAndValidate(bytes(bad)),/catalog differs/);assert.deepEqual(reader.parseAndValidate(bytes(f.value)),f.value);
 const other=structuredClone(f.value);other.fieldEffects.boardTransforms.items[0].position.x=99;assert.throws(()=>reader.parseAndValidate(bytes(other)),/catalog differs/);
});
test('expected bytes are captured independently and a mutable byte buffer is re-read as new data',()=>{
 const f=fixture(),lock=bytes(f.lock),reader=create(lock,{validate,hash,canonical});lock.fill(32);assert.deepEqual(reader.parseAndValidate(bytes(f.value)),f.value);
 const changed=structuredClone(f.value);changed.developmentProfile.fieldEffectTransforms='changed';assert.throws(()=>reader.parseAndValidate(bytes(changed)),/marker differs/);
});
test('old locks cannot acquire markers and strict source cannot acquire a board policy',()=>{
 const f=fixture();for(const kind of ['source-prerequisite-input-lock-v1','source-prerequisite-input-lock-v2','source-prerequisite-input-lock-v3']){
  const reader=create(bytes({...f.lock,kind}),{validate,hash,canonical});assert.throws(()=>reader.parseAndValidate(bytes(f.value)),/Legacy/);
 }
 const reader=create(bytes(f.lock),{validate,hash,canonical});const strict=structuredClone(f.value);delete strict.developmentProfile;assert.throws(()=>reader.parseAndValidate(bytes(strict)),/Strict source/);
});
test('native JSON overflow cannot collide with a previously validated null value',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.value));
 const text=JSON.stringify({...f.value,extra:null}).replace('"extra":null','"extra":1e999');assert.throws(()=>reader.parseAndValidate(Buffer.from(text)),/nonfinite/);
});
test('prototype serialization hooks are rejected before memoization and caller hooks are never invoked',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.value));let calls=0;
 for(const prototype of [Object.prototype,Array.prototype]){
  try{Object.defineProperty(prototype,'toJSON',{configurable:true,value(){calls++;return {};}});assert.throws(()=>reader.parseAndValidate(Buffer.from('{}')),/toJSON hooks/);}
  finally{delete prototype.toJSON;}
 }
 assert.equal(calls,0);assert.deepEqual(reader.parseAndValidate(bytes(f.value)),f.value);
});
test('an inherited field object cannot impersonate warmed bytes with its own toJSON',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.value));let hooks=0;
 try{
  Object.defineProperty(Object.prototype,'fieldEffects',{configurable:true,value:{boardTransforms:f.projection,toJSON(){hooks++;return f.effects;}}});
  const missing={...f.value};delete missing.fieldEffects;
  assert.throws(()=>validate(missing,f.lock,{hash,canonical}),/Unsupported canonical/);
  assert.throws(()=>reader.parseAndValidate(bytes(missing)),/private JSON objects/);
 }finally{delete Object.prototype.fieldEffects;}
 assert.equal(hooks,0);
});
test('a prototype getter cannot mutate an admitted private subtree before memoization',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.value));let hooks=0;
 const missing={...f.value,payload:structuredClone(f.effects)};delete missing.fieldEffects;const encoded=bytes(missing);
 try{
  Object.defineProperty(Object.prototype,'fieldEffects',{configurable:true,get(){this.payload.toJSON=()=>{hooks++;return f.effects;};return this.payload;}});
  assert.throws(()=>reader.parseAndValidate(encoded),TypeError);
 }finally{delete Object.prototype.fieldEffects;}
 assert.equal(hooks,0);
});
test('an inherited expected projection cannot become a frozen-lock authority or a stale cached expectation',()=>{
 const f=fixture(),lock={...f.lock,fieldEffectTransformCatalog:{}},outside=structuredClone(f.projection);
 try{
  Object.defineProperty(Object.prototype,'projection',{configurable:true,value:outside});
  validate(f.value,lock,{hash,canonical});
  const reader=create(bytes(lock),{validate,hash,canonical});assert.throws(()=>reader.parseAndValidate(bytes(f.value)),/private JSON objects/);
  outside.items[0].position.x=77;assert.throws(()=>validate(f.value,lock,{hash,canonical}),/assessment differs/);
  assert.throws(()=>reader.parseAndValidate(bytes(f.value)),/private JSON objects/);
 }finally{delete Object.prototype.projection;}
});
