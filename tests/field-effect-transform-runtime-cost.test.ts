import test from 'node:test';import assert from 'node:assert/strict';
import{movableFieldEffectsFixture}from './fixtures/movable-field-effects.js';
import{validateFieldEffectTransformPolicy,fieldEffectTransformContextBinding,WEB_FIELD_EFFECT_TRANSFORMS}from '../src/core/field-effect-transforms.js';
import{FieldEffects}from '../src/core/field-effects.js';import{createWebLogicalFieldEffectsHost}from '../src/core/field-logical-effects.js';import{GameFlow}from '../src/core/game-flow.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
test('every policy call rebuilds complete membership and rejects later mutable map/object/binding changes',async()=>{
 const f=await movableFieldEffectsFixture();validateFieldEffectTransformPolicy(f.catalog);
 for(const mutate of[(c:typeof f.catalog)=>{c.boardTransforms!.objects[0]!.sourceMapHash='f'.repeat(64)},(c:typeof f.catalog)=>{c.boardTransforms!.objects[0]!.mapId=987654},(c:typeof f.catalog)=>{(c.boardTransforms!.objects[0] as any).sourceMapHash=undefined;(c.boardTransforms!.objects[0]as any).mapId=undefined},(c:typeof f.catalog)=>{c.boardTransforms!.objects.push(structuredClone(c.boardTransforms!.objects[0]!))},(c:typeof f.catalog)=>{c.boardTransforms!.bindings.push(structuredClone(c.boardTransforms!.bindings[0]!))},(c:typeof f.catalog)=>{c.boardTransforms!.objects[0]!.reasons=['still-unclosed-owner']},(c:typeof f.catalog)=>{c.boardTransforms!.mapSources[0]!.sourceMapHash='e'.repeat(64)}]){
  const c=structuredClone(f.catalog);validateFieldEffectTransformPolicy(c);mutate(c);assert.throws(()=>validateFieldEffectTransformPolicy(c));validateFieldEffectTransformPolicy(f.catalog);
 }
});
test('joint context/ref entry still proves the actual source entity, definition, instance id, runtime and all current map members',async()=>{
 const f=await movableFieldEffectsFixture(),game=await f.make(),content=game.field.content,b=f.policy.bindings.find(b=>b.ref.mapId===f.map.mapId)!;
 assert.deepEqual(fieldEffectTransformContextBinding(content,WEB_FIELD_EFFECT_TRANSFORMS,b.entity.effect!,b.ref,b.ref.entityId),b);
 assert.throws(()=>fieldEffectTransformContextBinding(content,undefined,b.entity.effect!,b.ref,b.ref.entityId));assert.throws(()=>fieldEffectTransformContextBinding(content,WEB_FIELD_EFFECT_TRANSFORMS,b.entity.effect!,b.ref,'a-different-live-board'));
 const foreign=structuredClone(b.entity.effect!);foreign.pixelPosition.x++;assert.throws(()=>fieldEffectTransformContextBinding(content,WEB_FIELD_EFFECT_TRANSFORMS,foreign,b.ref,b.ref.entityId));
 const c=structuredClone(content);c.map.groups![b.ref.group]!.entities.find(e=>e.id===b.ref.entityId)!.x++;assert.throws(()=>fieldEffectTransformContextBinding(c,WEB_FIELD_EFFECT_TRANSFORMS,b.entity.effect!,b.ref,b.ref.entityId));
});
test('tick publication reuses only private owned catalog data; caller, snapshot and host-plan copies cannot mutate it',async()=>{
 const f=await movableFieldEffectsFixture(),base=createWebLogicalFieldEffectsHost({boardTransforms:WEB_FIELD_EFFECT_TRANSFORMS}),host={...base,prepare(plan:Parameters<typeof base.prepare>[0]){const p=base.prepare(plan);if(plan.after.boards[0])plan.after.boards[0].definition.pixelPosition.x=9999;return p;}},owner=new FieldEffects(f.catalog,host),b=f.policy.bindings[0]!,privateCatalog=owner.catalogSnapshot();
 owner.prepare([{kind:'create',id:b.ref.entityId,definition:b.entity.effect!,position:b.factory.position,transformRef:b.ref}]).commit();const before=owner.snapshot();f.catalog.boardTransforms!.kind='forged' as any;privateCatalog.boardTransforms!.kind='snapshot-forged'as any;
 for(let i=0;i<4;i++)owner.prepareTick(.01).commit();assert.deepEqual(owner.snapshot().boards[0]!.definition,b.entity.effect);assert.deepEqual(owner.catalogSnapshot().boardTransforms!.kind,WEB_FIELD_EFFECT_TRANSFORMS);assert.equal(owner.snapshot().boards[0]!.cameraId,before.boards[0]!.cameraId);
});
test('actual Session rechecks source content after opaque prepare/validation and never commits a stale Lerp draft',async()=>{
 for(const at of['prepare','validate']as const){const f=await movableFieldEffectsFixture(),base=f.runtime.fieldEffects!;let armed=false,game:Awaited<ReturnType<typeof f.make>>|null=null;
  const mutate=()=>{if(armed&&game){game.field.content.fieldEffects!.boardTransforms!.kind='after-host-forged'as any;armed=false;}};
  const runtime={...f.runtime,fieldEffects:{...base,prepare(plan:Parameters<typeof base.prepare>[0]){const moves=plan.before.boards.some(b=>{const next=plan.after.boards.find(n=>n.id===b.id);return next&&JSON.stringify(next.position)!==JSON.stringify(b.position)});if(moves&&at==='prepare')mutate();const p=base.prepare(plan);return{validate(){p.validate();if(moves&&at==='validate')mutate();},commit(){p.commit();}};}}};
  game=await f.make(runtime);const flow=new GameFlow(game);flow.start();flow.advance(10,ready);assert.equal(game.field.stop,null);const owned=game.state.snapshot(),before=game.field.fieldEffectsSnapshot!;armed=true;assert(game.field.startEvent('fx-transform'));flow.advance(10,ready);assert.equal((game.field.stop as {kind:string}|null)?.kind,'unsupported');assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(game.field.fieldEffectsSnapshot!.boards[0]!.position,before.boards[0]!.position);assert.equal(game.checkpointReady,false);
  const good=await movableFieldEffectsFixture(),retry=await good.make(),fresh=new GameFlow(retry);fresh.start();fresh.advance(10,ready);retry.field.startEvent('fx-transform');for(let i=0;i<30&&retry.field.busy&&!retry.field.stop;i++)fresh.advance(10,ready);assert.equal(retry.field.stop,null);assert(retry.checkpointReady);assert.deepEqual(good.restore(retry.checkpoint()).checkpoint(),retry.checkpoint());
 }
});

test('private catalog comparison pins switch only with a successful candidate publication',async()=>{
 const {effectCatalog}=await import('./fixtures/field-effects.js'),base=effectCatalog(),host={prepare(){return{validate(){},commit(){}}},beginCandidate(){return{validate(){},prepare(){return{validate(){},commit(){}}},discard(){}}}},owner=new FieldEffects(base,host),target=structuredClone(base);
 target.media.next={...structuredClone(base.media.controlled_effect!),assetGroup:'next'};
 owner.assertCatalog(base);assert.throws(()=>owner.assertCatalog(target),/Unbound map effect media/);
 const cancelled=owner.fork(target),caller=structuredClone(target);cancelled.assertCatalog(caller);caller.media.next!.source.file='mutated-current-caller';assert.throws(()=>cancelled.assertCatalog(caller),/Unbound map effect media/);cancelled.discard();assert.throws(()=>owner.assertCatalog(target),/Unbound map effect media/);
 const rejected=owner.fork(target);assert.equal(rejected.seal().commitWith(()=>false),false);assert.throws(()=>owner.assertCatalog(target),/Unbound map effect media/);
 const retry=owner.fork(target),snapshot=retry.catalogSnapshot();snapshot.media.next!.source.file='mutated-snapshot';retry.assertCatalog(target);assert.throws(()=>retry.assertCatalog(snapshot),/Unbound map effect media/);retry.seal().commit();owner.assertCatalog(target);
 const live=owner.catalogSnapshot();live.media.next!.source.file='mutated-live-snapshot';assert.throws(()=>owner.assertCatalog(live),/Unbound map effect media/);owner.assertCatalog(target);assert.deepEqual(owner.catalogSnapshot(),target);
});
test('private pins do not broaden map subset comparisons or eagerly reject previously unused invalid encoding',async()=>{
 const {effectCatalog}=await import('./fixtures/field-effects.js'),base=effectCatalog(),owner=new FieldEffects(base),subset={media:{}};owner.assertCatalog(subset);
 const changed=structuredClone(base);(changed.media.controlled_effect!.source as any).unknown=undefined;
 const unused=new FieldEffects(changed);assert.deepEqual(unused.catalogSnapshot(),changed);unused.assertCatalog(subset);assert.throws(()=>unused.assertCatalog(base),/Unsupported canonical value/);
 const f=await movableFieldEffectsFixture(),logical=new FieldEffects(f.catalog,f.runtime.fieldEffects),current=structuredClone(f.catalog);logical.assertBoardTransformCatalog(current);current.boardTransforms!.reason+=' mutated';assert.throws(()=>logical.assertBoardTransformCatalog(current),/differs from its actual manager/);logical.assertBoardTransformCatalog(f.catalog);
});
