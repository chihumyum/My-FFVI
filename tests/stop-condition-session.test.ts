import test from 'node:test';import assert from 'node:assert/strict';
import {sourceConditionSessionFixture} from './fixtures/source-condition-session.js';import {sealBatchContent} from './fixtures/content-batch.js';
import {encounterReady} from './fixtures/source-encounter-session.js';import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';
import {GameFlow} from '../src/core/game-flow.js';import {GameCommands} from '../src/core/game-commands.js';import {CheckpointStorage} from '../src/core/saved-game.js';
function fixture(){
 const f=sourceConditionSessionFixture(7),c=f.battle.common;
 c.conditions.rules.definitions.find(d=>d.id===7)!.type=17;
 c.conditions.behaviors=c.conditions.behaviors.filter(b=>b.id!==7);c.conditions.behaviors.push({id:7,kind:'stop',name:'Authored Stop',untilType:7,untilValue:30});
 c.battleAbilities!.conditions.find(d=>d.id===7)!.type=17;
 Object.assign(f.battle,sealBatchContent(f.battle));f.content.battleCatalogHash=f.battle.contentHash;Object.assign(f.content,sealBatchContent(f.content));return f;
}
function begin(f:ReturnType<typeof fixture>){const live=f.make();assert(live.game.field.startEvent('source-fight'));for(let i=0;i<100&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);return live;}
const host={prepareStart:async()=>({}),prepareReturn:async()=>({}),discard(){}};
function affected(live:ReturnType<typeof begin>){const b=live.game.battle!;for(let i=0;i<5000&&!b.players.some(p=>b.isStopped(p.id));i++)live.flow.advance(10,encounterReady);assert(b.players.some(p=>b.isStopped(p.id)));return b;}
function finish(live:Pick<ReturnType<typeof begin>,'game'|'flow'|'commands'>){const b=live.game.battle!;for(let i=0;i<10000&&b.phase==='active';i++){
 for(const p of b.ready){const e=b.enemies.find(e=>e.hp>0);if(e)live.commands.command(b,p.id,10,{kind:'single',id:e.id},100);}live.flow.advance(10,encounterReady);
 }assert.equal(b.phase,'victory');return b;}
test('real native-field Session Stop survives failed/cancelled start and failed return, then stores one clean result and enters a fresh battle',async()=>{
 const f=fixture(),live=begin(f),g=live.game,entry=g.state.snapshot(),field=g.field,native=field.player.native!.entity;
 let failStart=true,failReturn=true,discards=0;
 const h=new GameBattleHandoff(live.flow,{prepareStart:async()=>{if(failStart){failStart=false;throw Error('authored start media failure');}return{};},prepareReturn:async()=>{if(failReturn){failReturn=false;throw Error('authored return media failure');}return{};},discard(){discards++;}});
 assert.equal((await h.start()).status,'failed');assert.deepEqual(g.state.snapshot(),entry);
 let release!:(v:{})=>void;const waiting=new Promise<{}>(yes=>{release=yes;}),old=new GameBattleHandoff(live.flow,{prepareStart:()=>waiting,prepareReturn:async()=>({}),discard(){discards++;}}),pending=old.start();old.cancel();
 assert.equal((await h.start()).status,'committed');release({});assert.equal((await pending).status,'cancelled');assert.equal(discards,1);
 const b=affected(live),stopped=b.players.find(p=>b.isStopped(p.id))!;assert(!b.ready.includes(stopped));assert.throws(()=>g.checkpoint());assert.deepEqual(g.state.snapshot(),entry);
 const clocks=b.controlClockState(stopped.id);assert(live.flow.pause(true));live.flow.advance(1000,encounterReady);assert.deepEqual(b.controlClockState(stopped.id),clocks);assert(live.flow.pause(false));
 finish(live);assert(!b.players.some(p=>b.isStopped(p.id)));const terminal=g.state.snapshot();assert.equal((await h.return()).status,'failed');assert.equal(g.battle,b);assert.deepEqual(g.state.snapshot(),terminal);
 assert.equal((await h.return()).status,'committed');live.flow.advance(100,encounterReady);assert.equal(g.field,field);assert.equal(field.player.native!.entity,native);assert.equal(g.state.completedEncounters.length,1);assert(!g.players.some(p=>p.conditionIds.includes(7)));
 const stable=g.checkpoint(),values=new Map<string,string>();let quota=true;const storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(quota)throw Error('authored quota');values.set(k,v);}},'framework','stop-lifecycle');
 await assert.rejects(()=>storage.save(stable,1),/quota/);assert.equal(values.size,0);assert.deepEqual(g.checkpoint(),stable);quota=false;await storage.save(stable,2);const saved=(await storage.load())!;
 const injected=structuredClone(stable);injected.owned.roster[0]!.conditionIds.push(7);await storage.save(injected,3);const invalid=(await storage.load())!;assert.throws(()=>f.restore(invalid.checkpoint),/condition|persist/i);await storage.save(stable,4);
 const restored=f.restore(saved.checkpoint),flow=new GameFlow(restored);flow.start();flow.advance(0,encounterReady);assert.deepEqual(restored.checkpoint(),stable);const commands=new GameCommands(flow,restored);
 assert(restored.field.startEvent('source-next'));const next=new GameBattleHandoff(flow,host);assert.equal((await next.start()).status,'committed');const fresh=restored.battle!;assert.notEqual(fresh,b);assert(!fresh.players.some(p=>fresh.isStopped(p.id)));
 const before=restored.state.snapshot();assert.throws(()=>b.advance(10),/Retired/);assert.equal(live.commands.command(b,stopped.id,10,'old-target',100),false);assert.deepEqual(restored.state.snapshot(),before);
 finish({game:restored,flow,commands});assert.equal((await next.return()).status,'committed');flow.advance(100,encounterReady);assert.equal(restored.state.completedEncounters.length,2);
});
test('actual defeat and entry retry retire every Stop function without granting a new battle from old completion',async()=>{
 const f=fixture(),live=begin(f),h=new GameBattleHandoff(live.flow,host),entry=live.game.state.snapshot();assert.equal((await h.start()).status,'committed');const b=affected(live);
 // Declared control fixture terminal transition; no original source progress
 // or claim of a natural source victory/defeat is attached to this mechanism.
 for(const p of b.players){p.hp=0;p.conditionIds=[305];}for(let i=0;i<1000&&b.phase==='active';i++)live.flow.advance(10,encounterReady);
 assert.equal(b.phase,'defeat');assert.deepEqual(live.game.state.snapshot(),entry);assert.equal((await h.retry()).status,'committed');const fresh=live.game.battle!;assert.notEqual(fresh,b);assert(!fresh.players.some(p=>fresh.isStopped(p.id)));
 const before=live.game.state.snapshot();assert.throws(()=>b.advance(10),/Retired/);assert.deepEqual(live.game.state.snapshot(),before);finish(live);assert.equal((await h.return()).status,'committed');live.flow.advance(100,encounterReady);assert.equal(live.game.state.completedEncounters.length,1);
});
