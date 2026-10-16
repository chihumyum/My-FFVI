import {GameMapLoader} from '../src/core/game-map-loader.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {characterNamingSessionFixture as fixture,selectionHost as host} from './fixtures/source-character-naming-session.js';
import {characterNameConfirmation as name} from '../src/core/source-character-naming.js';
import {sourceCharacterNamingSelectors,compileSourceCharacterNamingInstruction} from '../src/compiler/source-character-naming.js';
import {decodeFieldOp} from '../src/compiler/field.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
const raw=(s:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[s,...Array(7).fill('')]}});
function open(script='name-new'){const f=fixture(),h=f.make();assert(h.game.field.startEvent(script));h.flow.advance(10,host);assert.equal(h.flow.phase,'character-name',h.game.field.stop?.message);return{...h,f};}
function drain(h:ReturnType<typeof open>){for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,host);assert(h.game.checkpointReady,h.game.field.stop?.message);}
test('all14 native dispatches are typed with exact operands; other source domains remain rejected',()=>{
 for(const selector of Object.keys(sourceCharacterNamingSelectors)){const r=raw(selector),site={script:'authored',index:5,source:{file:'synthetic',assetPath:'synthetic'}};
  assert.equal(decodeFieldOp(r,site,{}).kind,'source-character-naming');for(const type of [0,2,3])assert.equal(decodeFieldOp({...r,type},site,{}).kind,'blocked');
  r.operands.iValues[6]=1;assert.throws(()=>compileSourceCharacterNamingInstruction(r),/reserved/);}
});
test('confirmation follows UTF16 native widths and exact default bypass, not UTF8 or codepoints',()=>{
 assert.equal(name('abcdefghijklmn','default'),'abcdefghijkl');assert.equal(name('中文名字很长啊','default'),'中文名字很长');
 assert.equal(name('ｱ'.repeat(13),'default'),'ｱ'.repeat(12));assert.equal(name('😀'.repeat(4),'default'),'😀'.repeat(3));
 const d='a'.repeat(30);assert.equal(name(d,d),d);assert.equal(name('       ','default'),'       ');assert.throws(()=>name('','default'),/empty/);
});
test('Opening alone creates disabled actual ownership and removes granted equipment counts, without a party join',()=>{
 const f=fixture(),h=f.make(),before=h.game.state.snapshot();assert(h.game.field.startEvent('name-new'));h.flow.advance(10,host);
 const after=h.game.state.snapshot(),r=h.commands.characterNaming()!,member=after.roster.find(m=>m.sourceId===12)!;
 assert(r.model.wasNew);assert.equal(member.enabled,false);assert.equal(member.ownedId,before.roster.length+1);assert.deepEqual(after.party,before.party);
 assert.deepEqual(after.equipmentStock.filter(s=>s.id!==3&&s.id!==4&&s.id!==5),before.equipmentStock.filter(s=>s.id!==3&&s.id!==4&&s.id!==5));
 assert.equal(h.game.checkpointReady,false);assert.throws(()=>h.game.checkpoint());const time=h.game.field.time;h.flow.advance(2000,host);assert.equal(h.game.field.time,time);
 assert.throws(()=>h.commands.submitCharacterName(r.token,''),/empty/);assert.equal(h.game.state.snapshot().roster.length,after.roster.length);
});
test('actual Commands input/No/Yes separates name commit from next source poll; completed state round-trips Storage',async()=>{
 const h=open(),r=h.commands.characterNaming()!,opened=h.game.state.snapshot();assert(h.commands.submitCharacterName(r.token,'新名字太长会截断'));assert.equal(h.commands.characterNaming()!.stage,'confirm');
 assert(h.commands.confirmCharacterName(r.token,false));assert.deepEqual(h.game.state.snapshot(),opened);
 assert(h.commands.submitCharacterName(r.token,'A new name'));assert(h.commands.confirmCharacterName(r.token,true));assert.equal(h.commands.characterNaming(),null);
 assert.equal(h.game.state.snapshot().roster.find(m=>m.sourceId===12)!.name,'A new name');assert.equal(h.game.checkpointReady,false);
 assert.equal(h.commands.confirmCharacterName(r.token,true),false);drain(h);
 assert.equal(h.game.state.snapshot().characterNames.AUTHORED_NAME_12,'A new name');
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
 (await storage.prepareSave(h.game.checkpoint(),0)).commit();const restored=h.f.restore((await storage.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),h.game.checkpoint());
 restored.field.startEvent('name-new');restored.advance(10);assert.equal(restored.currentCharacterNaming!.model.wasNew,false);
});
test('held names do not reset enable/resources/equipment and media/pause/stale gateways cannot submit',()=>{
 const h=open('name-held'),r=h.commands.characterNaming()!,opened=h.game.state.snapshot();assert.equal(r.model.wasNew,false);
 h.flow.pause(true);assert.equal(h.commands.submitCharacterName(r.token,'paused'),false);h.flow.pause(false);
 h.flow.observeHost({...host,mediaReady:false});assert.equal(h.commands.submitCharacterName(r.token,'media'),false);h.flow.observeHost(host);
 assert(h.commands.submitCharacterName(r.token,'Changed'));assert(h.commands.confirmCharacterName(r.token,true));drain(h);
 const expected=structuredClone(opened),m=expected.roster.find(m=>m.sourceId===3)!;m.name='Changed';expected.characterNames.AUTHORED_SECOND_OWNER='Changed';assert.deepEqual(h.game.state.snapshot(),expected);
 const next=h.f.make();h.flow.start(next.game);h.flow.observeHost(host);assert.equal(h.commands.submitCharacterName(r.token,'old'),false);
});
test('strict policy and original-job prelude remain before any mutation',()=>{
 for(const script of ['name-new','name-prelude']){const f=fixture({policy:script!=='name-new'}),h=f.make(),before=h.game.state.snapshot();h.game.field.startEvent(script);h.flow.advance(10,host);
  assert.equal(h.game.field.stop?.kind,'unsupported');assert.deepEqual(h.game.state.snapshot(),before);}
});
test('owned/event ABA rejects stale callbacks but retains already committed Opening',()=>{
 for(const domain of ['owned','event']){const h=open(),r=h.commands.characterNaming()!,opened=h.game.state.snapshot();
  if(domain==='owned'){h.game.state.fieldInventory.prepare({kind:'grant-gil',amount:1}).commit();h.game.state.fieldInventory.prepare({kind:'pay-gil',amount:1}).commit();}
  else{const e=h.game.field.eventState,ref={category:'MapLocalVariable' as const,index:0},v=e.read(ref);e.write(ref,v+1);e.write(ref,v);}
  const current=h.game.state.snapshot();assert.throws(()=>h.commands.submitCharacterName(r.token,'stale'),/Stale/);assert.deepEqual(h.game.state.snapshot(),current);assert.deepEqual(current.roster,opened.roster);}
});
test('Opening and name publication each fail atomically, retry once, and reject reentrancy',()=>{
 const h=fixture().make(),state=h.game.state,before=state.snapshot(),command={kind:'source-character-naming' as const,sourceId:12,prelude:'none' as const,completion:'first-join-level' as const};
 const a=state.fieldCharacterNaming.prepareOpen(command),b=state.fieldCharacterNaming.prepareOpen(command);
 assert.throws(()=>a.commitWith(()=>{throw Error('Opening publication failure');}),/Opening publication/);assert.deepEqual(state.snapshot(),before);
 assert.throws(()=>a.commitWith(()=>b.commitWith(()=>{})),/progress/);assert.deepEqual(state.snapshot(),before);
 a.commitWith(()=>{});const opened=state.snapshot();assert.equal(opened.roster.length,before.roster.length+1);assert.throws(()=>a.commitWith(()=>{}),/Repeated/);
 const name=a.lease.prepareName('atomic');assert.throws(()=>name.commitWith(()=>{throw Error('Name publication failure');}),/Name publication/);assert.deepEqual(state.snapshot(),opened);
 name.commitWith(()=>{});assert.equal(state.snapshot().roster.find(m=>m.sourceId===12)!.name,'atomic');assert.throws(()=>name.commitWith(()=>{}),/Stale/);
 a.lease.prepareCompletion(true).commitWith(()=>{});assert.throws(()=>a.lease.prepareName('late'),/Inactive/);
});
test('map candidate naming shares the same generation, publishes once, and binds its lease to promoted live ownership',()=>{
 const state=fixture().make().game.state,before=state.snapshot(),command={kind:'source-character-naming' as const,sourceId:12,prelude:'none' as const,completion:'first-join-level' as const};
 const abandoned=state.prepareFieldState(),stale=abandoned.ports.characterNamingPort.prepareOpen(command);
 abandoned.ports.inventory.prepare({kind:'grant-gil',amount:1}).commit();assert.throws(()=>stale.commitWith(()=>{}),/Stale/);assert.deepEqual(state.snapshot(),before);
 const draft=state.prepareFieldState(),open=draft.ports.characterNamingPort.prepareOpen(command);
 assert.throws(()=>open.commitWith(()=>{const other=draft.ports.characterNamingPort.prepareOpen(command);other.commitWith(()=>{});}),/progress/);assert.deepEqual(state.snapshot(),before);
 open.commitWith(()=>{});assert.deepEqual(state.snapshot(),before);const sealed=draft.sealPublication();assert(sealed());assert(draft.commit());assert(!draft.commit());
 open.lease.prepareName('promoted').commitWith(()=>{});open.lease.prepareCompletion(true).commitWith(()=>{});assert.equal(state.snapshot().roster.find(m=>m.sourceId===12)!.name,'promoted');
});
test('post-name CorrectLevel failure preserves earlier Opening and confirmed name at the original PC',()=>{
 const f=fixture({levelOwner:false}),h=f.make();h.game.field.startEvent('name-new');h.flow.advance(10,host);const r=h.commands.characterNaming()!;
 assert(h.commands.submitCharacterName(r.token,'kept'));assert(h.commands.confirmCharacterName(r.token,true));const named=h.game.state.snapshot();h.flow.advance(10,host);
 assert.equal(h.game.field.stop?.kind,'unsupported');assert.match(h.game.field.stop?.message??'',/first-join level/);assert.deepEqual(h.game.state.snapshot(),named);assert.equal(named.roster.find(m=>m.sourceId===12)!.name,'kept');
});

test('destination naming Opening stays in the map draft across failed/cancelled media; publication promotes its single owner and retires old callbacks',async()=>{
 const f=fixture({destinationSelection:true}),h=f.make(),old=h.game.field,before=h.game.state.snapshot();old.startEvent('selection-leave');h.flow.advance(10,host);assert.equal(old.stop?.kind,'map-transition');
 let mode:'fail'|'hold'|'pass'='fail',entered!:(v:unknown)=>void,release!:(v:null)=>void;const pending=new Promise(r=>{entered=r;});
 const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{if(mode==='fail')throw Error('Naming destination media failure');if(mode==='hold'){entered(null);return new Promise<null>(r=>{release=r;});}return null;},discard(){}});
 assert.equal((await loader.load()).status,'failed');assert.deepEqual(h.game.state.snapshot(),before);assert.equal(h.game.field,old);
 mode='hold';const loading=loader.load();await Promise.race([pending,loading.then(r=>{throw Error('Missing naming candidate media '+r.status);})]);loader.cancel();release(null);assert.equal((await loading).status,'cancelled');assert.deepEqual(h.game.state.snapshot(),before);
 mode='pass';assert.equal((await loader.load()).status,'committed');assert.notEqual(h.game.field,old);assert.equal(h.game.state.snapshot().roster.length,before.roster.length+1);
 h.flow.observeHost(host);const r=h.commands.characterNaming()!;assert(r);assert(r.model.wasNew);assert(h.commands.submitCharacterName(r.token,'map owner'));assert(h.commands.confirmCharacterName(r.token,true));
 for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,host);assert(h.game.checkpointReady,h.game.field.stop?.message);assert.equal(h.game.state.snapshot().roster.find(m=>m.sourceId===12)!.name,'map owner');
 const stable=h.game.state.snapshot();assert.equal(old.currentCharacterNaming,null);assert.equal(old.submitCharacterName(r.token,'old map'),false);old.advance(1000);assert.deepEqual(h.game.state.snapshot(),stable);
});

test('opening grants and removes in native cap order rather than netting equipment totals',()=>{
 const h=fixture().make(),state=h.game.state;for(const id of [101,201])state.fieldInventory.prepare({kind:'grant-equipment',id,count:99}).commit();
 const before=state.snapshot(),open=state.fieldCharacterNaming.prepareOpen({kind:'source-character-naming',sourceId:12,prelude:'none',completion:'first-join-level'});open.commitWith(()=>{});
 const after=state.snapshot(),member=after.roster.find(m=>m.sourceId===12)!;
 for(const id of [101,201]){assert.equal(before.equipmentStock.find(s=>s.id===id)!.count,99);assert.equal(after.equipmentStock.find(s=>s.id===id)!.count,99-member.equipment.filter(v=>v===id).length);}
});
test('confirmed names feed actual battle participants, a prepared return failure retries once, and Storage restores the same named owner',async()=>{
 const h=open('name-held'),r=h.commands.characterNaming()!;assert(h.commands.submitCharacterName(r.token,'Battle name'));assert(h.commands.confirmCharacterName(r.token,true));drain(h);
 const named=h.game.state.snapshot();h.f.startBattle(h.game);assert.equal(h.game.battle!.players.find(p=>p.sourceId===3)!.name,'Battle name');h.f.previewVictory(h.game);
 const pending=h.game.prepareBattleReturn()!;assert(pending);pending.discard();assert.deepEqual(h.game.state.snapshot(),named);
 const retry=h.game.prepareBattleReturn()!;assert(retry);assert(retry.commit());assert(!retry.commit());h.game.advance(10);assert(h.game.checkpointReady,h.game.field.stop?.message);
 assert.equal(h.game.state.snapshot().roster.find(m=>m.sourceId===3)!.name,'Battle name');assert.equal(h.game.state.snapshot().characterNames.AUTHORED_SECOND_OWNER,'Battle name');
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});(await storage.prepareSave(h.game.checkpoint(),0)).commit();assert.deepEqual(h.f.restore((await storage.load())!.checkpoint).checkpoint(),h.game.checkpoint());
});
