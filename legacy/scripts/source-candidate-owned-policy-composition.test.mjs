import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,canonical} from '../dist/src/compiler/content.js';
import {validateSourceCandidateOwnedPolicies as validate} from './source-candidate.mjs';
import {createSourceCandidateBoardByteValidator as create} from './source-candidate-board-validation.mjs';
const bytes=v=>Buffer.from(JSON.stringify(v)),parking='web-source-transport-parking-upload-v1';
function fixture(){
 const projection={kind:'test-board-projection',items:[{id:'a',position:{x:1,y:2}}]},effects={boardTransforms:projection,allObjects:[{id:'a'}]},transportation={kind:'test-source-transportation-catalog',records:[{id:1,position:{x:32.25,y:64,z:9},mapId:3}]},profile={fieldEffectTransforms:'test-board',transportationParkingUpload:parking,vehicleLifecycle:'web-source-vehicle-lifecycle-v1'},lock={kind:'source-prerequisite-input-lock-v5',fieldEffectTransforms:'test-board',fieldEffectCatalogHash:hash(effects),fieldEffectTransformCatalog:{projection},transportationParkingUpload:parking,transportationCatalogHash:hash(transportation)},world={kind:'world-development',developmentProfile:profile,transportation},map={kind:'world-map-development',developmentProfile:profile,fieldEffects:effects};
 return {lock,world,map};
}
test('a warmed board assessment cannot grant changed v5 parking metadata or catalog',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.map));reader.parseAndValidate(bytes(f.world));
 const changed=structuredClone(f.world);changed.transportation.records[0].position.x=99;assert.throws(()=>reader.parseAndValidate(bytes(changed)),/parking catalog differs/);
 const marker=structuredClone(f.map);marker.developmentProfile.transportationParkingUpload='forged';assert.throws(()=>reader.parseAndValidate(bytes(marker)),/parking marker differs/);
 assert.deepEqual(reader.parseAndValidate(bytes(f.map)),f.map);assert.deepEqual(reader.parseAndValidate(bytes(f.world)),f.world);
});
test('parking and board both remain bound to independently captured actual v5 input bytes',()=>{
 const f=fixture(),input=bytes(f.lock),reader=create(input,{validate,hash,canonical});input.fill(32);reader.parseAndValidate(bytes(f.world));
 f.lock.transportationCatalogHash='a'.repeat(64);f.lock.fieldEffectCatalogHash='b'.repeat(64);
 const map=structuredClone(f.map);map.fieldEffects.allObjects[0].id='changed';assert.throws(()=>reader.parseAndValidate(bytes(map)),/board catalog differs/);
 assert.deepEqual(reader.parseAndValidate(bytes(f.world)),f.world);
});
test('a v4 board lock preserves its board grant but cannot acquire parking authority',()=>{
 const f=fixture(),lock={...f.lock,kind:'source-prerequisite-input-lock-v4'},reader=create(bytes(lock),{validate,hash,canonical}),map=structuredClone(f.map);delete map.developmentProfile.transportationParkingUpload;
 reader.parseAndValidate(bytes(map));assert.throws(()=>reader.parseAndValidate(bytes(f.map)),/Legacy.*parking/);
});
test('inherited foreign transportation cannot impersonate an actual v5 catalog',()=>{
 const f=fixture(),reader=create(bytes(f.lock),{validate,hash,canonical});reader.parseAndValidate(bytes(f.world));const missing=structuredClone(f.world);delete missing.transportation;
 try{Object.defineProperty(Object.prototype,'transportation',{configurable:true,value:{toJSON(){return f.world.transportation;}}});assert.throws(()=>reader.parseAndValidate(bytes(missing)),/private JSON objects/);}finally{delete Object.prototype.transportation;}
});
