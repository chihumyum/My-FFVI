import test from 'node:test';
import assert from 'node:assert/strict';
import { mobMaterialProvidersFixture } from './fixtures/mob-material-providers.js';
import { mobHost } from './fixtures/mob-controls.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { resolveFieldPuppetActor } from '../src/core/field-puppet-actors.js';
const finish=(flow:Awaited<ReturnType<Awaited<ReturnType<typeof mobMaterialProvidersFixture>>['make']>>['flow'])=>flow.advance(20,mobHost);
test('actual boarded player and separately ridden NPC keep their IDs, outer clock and source bindings under one material filter',async()=>{
 const f=await mobMaterialProvidersFixture(),{game,flow}=await f.make(),field=game.field,player=field.player;
 assert.equal(player.native!.entity.riding,true);assert.equal(player.mount,'armor');
 assert(field.startEvent('mount-npc'));finish(flow);assert.equal(field.stop,null);
 const port=field.options.puppetActors!.read(),npc=field.actors[resolveFieldPuppetActor(port.catalog,port.context,-1001).actor!]!;
 assert.equal(npc.native!.entity.riding,true);assert.notEqual(npc,player);
 assert(field.startEvent('mob-hide'));finish(flow);assert.equal(field.stop,null);assert.equal(field.mobColorFilterAlpha(player.id),1);assert.equal(npc.mobColor,undefined);
 assert(field.startEvent('mob-restore'));finish(flow);assert.equal(field.mobColorFilterAlpha(player.id),0);
 assert(field.startEvent('mob-npc-during'));flow.advance(20,mobHost);assert.equal(field.stop,null);
 const before=[player,npc].map(a=>({actor:a,native:a.native,entity:a.native!.entity,outerCharacter:a.animation!.character,asset:a.asset,mount:a.mount,position:{...a.native!.entity.position},alpha:a.native!.entity.fadeAlpha})),owned=game.state.snapshot();
 flow.advance(20,mobHost);assert.equal(field.stop,null,String(field.stop));assert.equal(npc.native!.entity.visible,true);
 for(const b of before){assert.equal(field.actors[b.actor.id],b.actor);assert.equal(b.actor.native,b.native);assert.equal(b.actor.native!.entity,b.entity);
  assert.equal(b.actor.animation,b.actor.native!.entity.animation);assert.deepEqual(b.actor.animation!.character,b.outerCharacter);assert.equal(b.actor.asset,b.asset);assert.equal(b.actor.mount,b.mount);assert.deepEqual(b.actor.native!.entity.position,b.position);
  assert.equal(b.actor.native!.entity.fadeAlpha,b.alpha);assert.equal(field.mobColorFilterAlpha(b.actor.id),b.actor.native!.entity.visible?1:0);}
 assert.deepEqual(game.state.snapshot(),owned);flow.advance(100,mobHost);assert.equal(field.stop,null);
 assert.equal(field.mobColorFilterAlpha(player.id),0);assert.equal(field.mobColorFilterAlpha(npc.id),0);
});
test('riding poses restore only through current source media and survive quota retry plus map retirement without same-ID retargeting',async()=>{
 const f=await mobMaterialProvidersFixture(),{game,flow}=await f.make(),old=game.field;
 assert(old.startEvent('mob-hide'));finish(flow);const memory=new Map<string,string>();let fail=true;
 const store=new CheckpointStorage({getItem:k=>memory.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('controlled quota');memory.set(k,v);}}),saved=game.checkpoint();
 assert.throws((await store.prepareSave(saved,1)).commit,/quota/);assert.deepEqual(game.checkpoint(),saved);fail=false;(await store.prepareSave(saved,1)).commit();
 const restored=f.restore((await store.load())!.checkpoint);assert.equal(restored.field.player.native!.entity.riding,true);assert.equal(restored.field.mobColorFilterAlpha(restored.field.player.id),1);
 assert(old.startEvent('go-world'));flow.advance(10,mobHost);const draft=game.world.prepare(f.world,f.worldMap);game.world.discard(draft);assert.equal(game.field,old);
 const retry=game.world.prepare(f.world,f.worldMap);assert(game.world.commit(retry));finish(flow);assert.equal(game.field.stop,null);
 const next=game.field;assert.notEqual(next.player,old.player);assert.equal(next.player.id,old.player.id);assert.equal(next.player.native!.entity.riding,true);
 assert(next.startEvent('mob-restore'));finish(flow);assert.equal(next.stop,null);assert.equal(next.player.mobColor,undefined);assert.throws(()=>old.mobColorFilterAlpha(old.player.id),/retired|registered/i);
});
test('a proven logical effect board has no Web material, remains active and keeps its independent playback while actual actors are filtered',async()=>{
 const f=await mobMaterialProvidersFixture({effects:true}),{game,flow}=await f.make(),field=game.field,before=field.fieldEffectsSnapshot!;
 assert(before.boards[0]!.activeSelf);assert(before.players[0]!.playing);assert.equal(field.actors['404'],undefined);
 assert(field.startEvent('mob-hide'));finish(flow);assert.equal(field.stop,null,String(field.stop));assert.equal(field.mobColorFilterAlpha(field.player.id),1);
 const after=field.fieldEffectsSnapshot!;assert.equal(after.boards[0]!.activeSelf,true);assert.deepEqual(after.boards,before.boards);assert.equal(after.instanceCount,before.instanceCount);assert(after.players[0]!.elapsedSec>=before.players[0]!.elapsedSec);
 assert(field.startEvent('mob-restore'));finish(flow);assert.equal(field.stop,null);assert.equal(field.fieldEffectsSnapshot!.instanceCount,1);
 const checkpoint=game.checkpoint();assert.deepEqual(f.restore(checkpoint).checkpoint(),checkpoint);
});
test('unbound riding media, unknown children and an effect host with a material remain atomic specific gates',async()=>{
 for(const mode of ['rider','outer','child','effect']as const){
  const f=await mobMaterialProvidersFixture({effects:mode==='effect'}),{game}=await f.make(),field=game.field;
  if(mode==='rider')delete field.content.characters[field.player.asset!];
  if(mode==='outer')delete field.content.characters[field.player.mount!];
  if(mode==='child')field.player.native!.entity.childEntityObject='unknown';
  if(mode==='effect')Reflect.set(field.options.fieldEffectMap!,'logicalPolicy',null);
  const before=field.mobControlsSnapshot;assert(field.startEvent('mob-hide'));assert.equal(field.stop?.kind,'unsupported',mode);assert.deepEqual(field.mobControlsSnapshot,before);
  assert(Object.values(field.actors).every(a=>a.mobColor===undefined));
 }
});

test('late actual rider-media loss is fenced before any member or actor filter publication',async()=>{
 const f=await mobMaterialProvidersFixture(),{game}=await f.make(),field=game.field,port=field.options.puppetActors!,before=field.mobControlsSnapshot;
 let reads=0;Reflect.set(field.options,'puppetActors',{...port,read:()=>{const value=port.read();if(++reads===2)delete field.content.characters[field.player.asset!];return value;}});
 const execute=Reflect.get(field,'executeMobControl') as (op:unknown)=>void;
 assert.throws(()=>execute.call(field,{kind:'field-mob-control',command:{kind:'hide',exemptions:[],durationSeconds:0}}),/media|material/);
 assert.deepEqual(field.mobControlsSnapshot,before);assert(Object.values(field.actors).every(a=>a.mobColor===undefined));
});
