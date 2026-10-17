import test from'node:test';import assert from'node:assert/strict';
import{movableFieldEffectsFixture}from'./fixtures/movable-field-effects.js';import{validateFieldEffectTransformPolicy,fieldEffectTransformsBinding}from'../src/core/field-effect-transforms.js';
import{projectFrameworkFieldEffectTransformCatalog}from'../src/compiler/framework-field-effect-transforms.js';import{hash}from'../src/compiler/content.js';
import{compileFrameworkContent}from'../src/compiler/framework-content.js';import{sourceGameContentRefsFixture}from'./fixtures/game-content-refs.js';
test('new transform proof binds original raw fields, complete family, factory placement and legacy Birdview proof independently',async()=>{
 for(const birdview of[false,true]){const f=await movableFieldEffectsFixture({birdview});validateFieldEffectTransformPolicy(f.catalog);
  for(const mutate of[(c:typeof f.catalog)=>{c.boardTransforms!.bindings[0]!.factory.position.x+=16;},(c:typeof f.catalog)=>{c.boardTransforms!.objects=[];},(c:typeof f.catalog)=>{c.boardTransforms!.bindings.push(structuredClone(c.boardTransforms!.bindings[0]!));},(c:typeof f.catalog)=>{c.boardTransforms!.bindings[0]!.rawObject.x=0;},(c:typeof f.catalog)=>{c.boardTransforms!.objects[0]!.rawObject={properties:[]};},(c:typeof f.catalog)=>{c.boardTransforms!.logicalCatalogHash='a'.repeat(64);},(c:typeof f.catalog)=>{delete c.webPolicy!.boardProjection;if(!birdview)c.media.controlled_effect!.particles[0]!.loop=false;}]){const bad=structuredClone(f.catalog);mutate(bad);assert.throws(()=>validateFieldEffectTransformPolicy(bad));}
  const game=await f.make(),content=game.field.content;assert.equal(fieldEffectTransformsBinding(content,f.runtime.fieldEffectTransforms),f.runtime.fieldEffectTransforms);const old=structuredClone(content);old.cameraHost!.mapRange.x++;assert.throws(()=>fieldEffectTransformsBinding(old,f.runtime.fieldEffectTransforms),/map range/);
 }
});
test('complete compiler assessment cannot change world membership, previous catalog or immutable factory while recomputing its own hash',async()=>{
 const f=await movableFieldEffectsFixture(),base=structuredClone(f.catalog);delete base.boardTransforms;const body={kind:'framework-field-effect-transform-assessment-v1' as const,projection:structuredClone(f.policy)},assessment={...body,contentHash:hash(body)};assert.deepEqual(projectFrameworkFieldEffectTransformCatalog(base,assessment),f.catalog);
 for(const mutate of[(a:typeof body)=>{a.projection.sourceMapSetHash='b'.repeat(64);},(a:typeof body)=>{a.projection.mapSources.pop();},(a:typeof body)=>{a.projection.bindings[0]!.factory.position.y++;}]){const bad=structuredClone(body);mutate(bad);assert.throws(()=>projectFrameworkFieldEffectTransformCatalog(base,{...bad,contentHash:hash(bad)}));}
 assert.throws(()=>projectFrameworkFieldEffectTransformCatalog(f.catalog,assessment),/catalog binding changed/);
 const s=await sourceGameContentRefsFixture('source','/world');assert.throws(()=>compileFrameworkContent(s.catalog,[s.map,s.destination],s.content,{fieldEffectTransforms:f.runtime.fieldEffectTransforms!}),/complete compiled assessment/);
});
