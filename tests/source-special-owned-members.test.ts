import test from 'node:test';import assert from 'node:assert/strict';
import {compileSourceSpecialOwnedCatalog,compileSpecialOwnedEvent,sourceSpecialOwnedSelectors} from '../src/compiler/source-special-owned-members.js';
import {decodeFieldOp} from '../src/compiler/field.js';
import {sourceSpecialOwnedCatalog,validateSourceSpecialOwnedCatalog,validateSpecialOwnedCommand} from '../src/core/source-special-owned-members.js';
import {rosterGroupsSessionFixture,rosterGroupHost} from './fixtures/roster-groups-session.js';
import {CheckpointStorage} from '../src/core/saved-game.js';import {GameMapLoader} from '../src/core/game-map-loader.js';import {GameSession} from '../src/core/game-session.js';
const tables={'character_status.csv':[12,17,18].map(id=>({id:String(id),job_id:'12'})),'job.csv':[{id:'12'}],'exp_table.csv':[{id:'1',total_exp:'0'}]};
const raw=(selector:string)=>({type:1,mnemonic:'SysCall',operands:{iValues:Array<number>(8).fill(0),rValues:Array<number>(8).fill(0),sValues:[selector,...Array<string>(7).fill('')]}});
const site={script:'authored-special-owned',index:0,source:{file:'synthetic',assetPath:'authored-special-owned'}};
test('special wrappers lower through their distinct catalog, preserve all source operands and refuse tampered identities',()=>{
 assert.deepEqual(sourceSpecialOwnedSelectors.map(s=>compileSpecialOwnedEvent(s,tables).member),['ghost-1','ghost-2','gau']);
 for(const s of sourceSpecialOwnedSelectors){assert.equal(decodeFieldOp(raw(s),site,{},tables).kind,'special-owned-join');
  for(const mutate of [(r:ReturnType<typeof raw>)=>{r.type=0;},(r:ReturnType<typeof raw>)=>{r.operands.iValues[7]=1;},
    (r:ReturnType<typeof raw>)=>{r.operands.rValues[2]=1;},(r:ReturnType<typeof raw>)=>{r.operands.sValues[1]='extra';}]){
    const r=raw(s);mutate(r);assert.equal(decodeFieldOp(r,site,{},tables).kind,'blocked');}}
 assert.throws(()=>compileSourceSpecialOwnedCatalog({...tables,'exp_table.csv':[{id:'1',total_exp:'1'}]}),/reset experience/);
 assert.throws(()=>compileSourceSpecialOwnedCatalog({...tables,'character_status.csv':tables['character_status.csv'].slice(1)}),/source/);
 const c=sourceSpecialOwnedCatalog();c.ghostSourceIds.reverse();assert.throws(()=>validateSourceSpecialOwnedCatalog(c),/catalog/);
 assert.throws(()=>validateSpecialOwnedCommand({kind:'gau',firstEncounter:null as unknown as boolean}),/branch/);
});
test('actual Field creates Ghost held identities once, resets a rejoining parameter block and persists Battle return through Storage',async()=>{
 const f=rosterGroupsSessionFixture({specialOwned:true}),h=f.make();
 f.run(h,'ghost-1');assert.equal(h.game.field.stop,null);f.run(h,'ghost-2');assert.equal(h.game.field.stop,null);
 const first=h.game.state.snapshot(),g=first.roster.find(m=>m.sourceId===17)!;assert.equal(g.ownedId,2);assert.notEqual(g.ownedId,g.sourceId);
 const ids=first.roster.map(m=>[m.id,m.sourceId,m.ownedId]),name=g.name;f.run(h,'ghost-leave');assert.equal(h.game.field.stop,null);
 f.run(h,'ghost-1');assert.equal(h.game.field.stop,null);const joined=h.game.state.snapshot();assert.deepEqual(joined.roster.map(m=>[m.id,m.sourceId,m.ownedId]),ids);
 assert.equal(joined.roster.find(m=>m.sourceId===17)!.name,name);assert.equal(joined.roster.find(m=>m.sourceId===17)!.enabled,true);
 assert.equal(joined.party.slots[0].filter(c=>c.id===g.id).length,1);
 const level=joined.roster.find(m=>m.sourceId===17)!.level;assert(level>1);f.run(h,'ghost-1');assert.equal(h.game.field.stop,null);assert.equal(h.game.state.snapshot().roster.find(m=>m.sourceId===17)!.level,1,'an enabled Ghost resets parameters before common Join; it does not keep the old level');
 f.startBattle(h.game);assert(h.game.battle!.players.some(m=>m.id===g.id));
 assert.throws(()=>h.game.state.fieldRoster.prepareSpecial!({kind:'ghost',sourceId:17}),/active battle/);
 f.previewVictory(h.game);assert(h.game.continueVictory());h.game.advance(10);assert.equal(h.game.continueVictory(),false);assert(h.game.checkpointReady);
 const slots=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>{slots.set(k,v);}});
 const saved=h.game.checkpoint();(await storage.prepareSave(saved,0)).commit();assert.deepEqual(f.restore((await storage.load())!.checkpoint).checkpoint(),saved);
 const forged=structuredClone(saved);Object.assign(forged.owned,{sourceSpecialOwnedMembers:sourceSpecialOwnedCatalog()});assert.throws(()=>f.restore(forged));
});
test('Gau uses a real preexisting owner and known ScenarioVariable8; enabling precedes common recovery and does not create another record',()=>{
 const f=rosterGroupsSessionFixture({specialOwned:true}),h=f.make(),before=h.game.state.snapshot();
 assert.throws(()=>h.game.state.fieldRoster.prepareSpecial!({kind:'gau',firstEncounter:false}),/already held/);assert.deepEqual(h.game.state.snapshot(),before);
 f.run(h,'hold-gau');assert.equal(h.game.field.stop,null);f.run(h,'gau-leave');assert.equal(h.game.field.stop,null);
 h.game.field.eventState.write({category:'ScenarioVariable',index:8},1);f.run(h,'gau');assert.equal(h.game.field.stop,null);
 const joined=h.game.state.snapshot(),gau=joined.roster.find(m=>m.sourceId===12)!;assert.equal(gau.ownedId,2);assert.equal(gau.level,1,"pre-Join enable suppresses the disabled-member level correction");assert.equal(gau.enabled,true);assert.equal(gau.hp,gau.maxHp);assert.equal(gau.mp,gau.maxMp);
 f.run(h,'gau');assert.equal(h.game.field.stop,null);assert.equal(h.game.state.snapshot().roster.length,2);
 const tx=h.game.state.fieldRoster.prepareSpecial!({kind:'gau',firstEncounter:true}),stock=structuredClone(h.game.state.snapshot().equipmentStock);assert.deepEqual(tx.steps.map(s=>s.setDummy),[false,true]);
 assert.throws(()=>tx.commitWith(()=>{throw Error('Controlled final actor resource failure');}),/Controlled/);assert.deepEqual(h.game.state.snapshot().equipmentStock,stock);
 h.game.field.eventState.write({category:'ScenarioVariable',index:8},0);f.run(h,'gau');assert.equal(h.game.field.stop,null);assert.equal(h.game.state.snapshot().roster.filter(m=>m.sourceId===12).length,1);assert.equal(h.game.state.snapshot().roster.find(m=>m.sourceId===12)!.ownedId,2);
});
test('stale/failed special candidates share the existing draft generation and cannot publish actor or owned state',()=>{
 const f=rosterGroupsSessionFixture({specialOwned:true}),h=f.make(),before=h.game.state.snapshot();
 const tx=h.game.state.fieldRoster.prepareSpecial!({kind:'ghost',sourceId:17});assert.throws(()=>tx.commitWith(()=>{throw Error('Controlled special publish');}),/Controlled/);assert.deepEqual(h.game.state.snapshot(),before);
 const draft=h.game.state.prepareFieldState(),first=draft.ports.roster.prepareSpecial!({kind:'ghost',sourceId:17});
 draft.ports.roster.prepare({kind:'unlock',sourceId:12,refreshActors:false}).commit();assert.throws(()=>first.commitWith(check=>check()),/Stale/);assert.deepEqual(h.game.state.snapshot(),before);
 h.game.state.fieldRoster.prepare({kind:'unlock',sourceId:12,refreshActors:false}).commit();const changed=h.game.state.snapshot();assert.throws(()=>tx.commitWith(check=>check()),/Stale/);assert.deepEqual(h.game.state.snapshot(),changed);
});
test('failed actual media and canceled map preparation retain original owners; a clean retry joins once before stable restore',async()=>{
 const bad=rosterGroupsSessionFixture({specialOwned:true,missingMedia:true}),b=bad.make(),before=b.game.state.snapshot(),actors=b.game.field.nativeActorStateFingerprint;
 bad.run(b,'ghost-1');assert.equal(b.game.field.stop?.kind,'unsupported');assert.deepEqual(b.game.state.snapshot(),before);assert.equal(b.game.field.nativeActorStateFingerprint,actors);
 const f=rosterGroupsSessionFixture({specialOwned:true,specialTarget:true}),h=f.make(),initial=h.game.state.snapshot(),old=h.game.field;
 let release!:(v:null)=>void,entered!:(v:null)=>void,mode:'hold'|'ok'='hold';const waiting=new Promise<null>(r=>entered=r);
 const loader=new GameMapLoader(h.flow,f.repository,{prepare:async()=>{if(mode==='hold'){entered(null);return new Promise<null>(r=>release=r);}return null;},discard(){}});
 f.run(h,'group-change-map');const loading=loader.load();await waiting;loader.cancel();release(null);await loading;assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),initial);
 mode='ok';assert.equal((await loader.load()).status,'committed');for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,rosterGroupHost);
 assert.equal(h.game.field.stop,null);assert.equal(h.game.state.snapshot().roster.filter(m=>m.sourceId===17).length,1);const saved=h.game.checkpoint();
 assert.deepEqual(GameSession.restore(saved,undefined,f.battle,{catalog:f.world,map:f.destination,source:{content:f.content,initialMap:f.map}}).checkpoint(),saved);
 const state=h.game.state.snapshot();old.startEvent('ghost-2');old.advance(10);assert.deepEqual(h.game.state.snapshot(),state);
});
