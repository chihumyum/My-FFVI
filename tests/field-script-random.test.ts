import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldScriptRandomInstruction } from "../src/compiler/field-script-random.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { executeFieldScriptRandom, WEB_SOURCE_SCRIPT_RANDOM } from "../src/core/field-script-random.js";
import { EventState } from "../src/core/event-state.js";
import { GameState } from "../src/core/game-state.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { FieldGame } from "../src/core/field.js";
import { drawFieldRandom } from "../src/core/field-random.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { Op } from "../src/field/types.js";
const raw=(bank="MapLocalVariable",index=0,upper=4)=>({type:1,mnemonic:"SetRandomValue",operands:{iValues:[index,upper,0,0,0,0,0,0],rValues:Array(8).fill(0),sValues:[bank,...Array(7).fill("")]}});
const source={file:"synthetic",assetPath:"random",objectId:"9223372036854775807"},command=()=>compileFieldScriptRandomInstruction(raw()).command;
const ready={visible:true,mediaReady:true,overlayOpen:false};
async function owned(){const f=await frameworkNewGameFixture(),state=new GameState(f.battle.gameState,f.battle.common.players,f.battle.contentHash,f.battle.common.conditions);assert.ok(state.snapshot().fieldRandom);return{f,state};}
test("source random decoder preserves one-based inclusive bounds, exact banks and source address",()=>{
 for(const bank of ["MapLocalVariable","AreaLocalVariable"]){const r=raw(bank,7,15),op=compileFieldScriptRandomInstruction(r);assert.deepEqual(op,{kind:"script-random",command:{target:{category:bank,index:7},upperInclusive:15}});
 const site={script:"alias",index:99,source};assert.deepEqual(decodeFieldOp(r,site,{},{}),{...site,...op});}
 for(const r of [raw("ScenarioVariable"),raw("maplocalvariable"),raw("MapLocalVariable",8),raw("AreaLocalVariable",-1),raw("MapLocalVariable",0,0),raw("MapLocalVariable",0,0x7fffffff)])assert.throws(()=>compileFieldScriptRandomInstruction(r));
 for(const mutate of [(r:ReturnType<typeof raw>)=>r.operands.iValues[4]=1,(r:ReturnType<typeof raw>)=>r.operands.rValues[1]=.1,(r:ReturnType<typeof raw>)=>r.operands.sValues[1]="x",(r:ReturnType<typeof raw>)=>r.type=2]){const r=raw();mutate(r);assert.throws(()=>compileFieldScriptRandomInstruction(r));}
});
test("live random and destination publish together; invalid destination and late failure consume no draw",async()=>{
 const{state}=await owned(),events=new EventState(),before=state.snapshot(),expected=structuredClone(before.fieldRandom!),value=drawFieldRandom(expected,1,4);
 assert.throws(()=>executeFieldScriptRandom(command(),events,state.fieldScriptRandom,()=>{throw Error("late task failure");}),/late task/);assert.deepEqual(state.snapshot(),before);assert.equal(events.snapshot().map[0],null);
 assert.throws(()=>executeFieldScriptRandom({target:{category:"MapLocalVariable",index:8},upperInclusive:4},events,state.fieldScriptRandom));assert.deepEqual(state.snapshot(),before);
 assert.equal(executeFieldScriptRandom(command(),events,state.fieldScriptRandom),value);assert.equal(events.read(command().target),value);assert.deepEqual(state.snapshot().fieldRandom,expected);
 const p=state.fieldScriptRandom.prepare(4);p.commitWith(()=>{});assert.throws(()=>p.commitWith(()=>{}),/Stale/);
});
test("candidate map random stays private, rejects stale generation, and rebinds same port to live after publication",async()=>{
 const{state}=await owned(),before=state.snapshot(),draft=state.prepareFieldState({scriptRandom:WEB_SOURCE_SCRIPT_RANDOM}),events=new EventState();assert.ok(draft.ports.scriptRandom);
 const stale=draft.ports.scriptRandom.prepare(4);executeFieldScriptRandom(command(),events,draft.ports.scriptRandom);assert.deepEqual(state.snapshot(),before);assert.throws(()=>stale.commitWith(()=>{}),/Stale/);
 assert.equal(draft.commit(),true);assert.equal(state.snapshot().fieldRandom!.draws,before.fieldRandom!.draws+1);
 executeFieldScriptRandom(command(),events,draft.ports.scriptRandom);assert.equal(state.snapshot().fieldRandom!.draws,before.fieldRandom!.draws+2);
 assert.equal(state.prepareFieldState().ports.scriptRandom,undefined,"No runtime policy can be inferred from a saved RNG field");
});
test("missing policy/owner and changed event bank cannot silently become a successful random write",async()=>{
 const{state}=await owned(),e=new EventState(),before=state.snapshot();assert.throws(()=>executeFieldScriptRandom(command(),e,undefined),/explicit Web/);
 assert.throws(()=>executeFieldScriptRandom(command(),e,state.fieldScriptRandom,()=>{e.write({category:"AreaLocalVariable",index:1},7);}),/Stale/);assert.deepEqual(state.snapshot(),before);
 const f=checkpointFixture();f.field.scripts.random=[{...compileFieldScriptRandomInstruction(raw()),script:"random",index:99,source},{kind:"exit",script:"random",index:100,source}];
 const game=new FieldGame(f.field);assert.equal(game.startEvent("random"),true);assert.ok(game.stop?.message.includes("explicit Web"));
});
test("continuous Session save/restore consumes a deterministic shared stream once and preserves source banks",async()=>{
 const{f}=await owned(),field=structuredClone(checkpointFixture().field),battle=structuredClone(f.battle),r=compileFieldScriptRandomInstruction(raw()),ops:Op[]=[{...r,script:"evidence-alias",index:99,source},{kind:"wait",seconds:.02,script:"evidence-alias",index:100,source},{...r,script:"evidence-alias",index:101,source},{kind:"exit",script:"evidence-alias",index:102,source}];
 field.scripts.random=ops;field.sourceSetHash=battle.common.fieldSourceSetHash;
 const session=new GameSession(field,battle,undefined,{scriptRandom:WEB_SOURCE_SCRIPT_RANDOM}),flow=new GameFlow(session);flow.start();assert.equal(session.field.startEvent("random"),true);
 flow.advance(40,ready);assert.equal(session.checkpointReady,true);assert.equal(session.state.snapshot().fieldRandom!.draws,2);
 const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});await storage.save(session.checkpoint(),0);
 const saved=(await storage.load())!.checkpoint,restored=GameSession.restore(saved,field,battle,undefined,{scriptRandom:WEB_SOURCE_SCRIPT_RANDOM});assert.deepEqual(restored.state.snapshot(),session.state.snapshot());
 for(const current of [session,restored]){const cf=new GameFlow(current);cf.start();current.field.startEvent("random");cf.advance(40,ready);}
 assert.deepEqual(restored.state.snapshot(),session.state.snapshot());assert.equal(restored.state.snapshot().fieldRandom!.draws,4);assert.deepEqual(restored.field.eventState.snapshot(),session.field.eventState.snapshot());
});

import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameCommands } from "../src/core/game-commands.js";
async function randomWorld(fail=false){
 const f=await worldLoopSessionFixture(),map=structuredClone(f.map),target=structuredClone(f.worldMap),world=structuredClone(f.world);
 const op=(script:string,index:number,upper=4,bank="MapLocalVariable"):Op=>({...compileFieldScriptRandomInstruction(raw(bank,7,upper)),script,index,source});
 map.scripts[map.initializer!]!.unshift(op(map.initializer!,99));target.scripts[target.initializer!]!.unshift(op(target.initializer!,99,15,"AreaLocalVariable"));
 if(fail)target.scripts[target.initializer!]!.splice(1,0,{kind:"blocked",mnemonic:"AuthoredLateRandomFailure",reason:"Controlled candidate failed after a private random draw",script:target.initializer!,index:100,source});
 target.scripts["rng-save"]=[op("original-alias",501),{kind:"event-save",script:"original-alias",index:502,source},op("original-alias",503),{kind:"exit",script:"original-alias",index:504,source}];
 target.scripts["rng-fight"]=[{kind:"encounter",party:f.encounterId,continuation:"rng-after-fight",script:"rng-fight",index:1,source}];
 target.scripts["rng-after-fight"]=[op("rng-after-fight",700),{kind:"exit",script:"rng-after-fight",index:701,source}];
 for(const name of ["rng-save","rng-fight","rng-after-fight"]){target.scriptPuppetContexts![name]=structuredClone(target.scriptPuppetContexts![target.initializer!]!);(target.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};}
 const start=sealBatchContent(map),next=sealBatchContent(target);world.maps[start.mapId]!.contentHash=start.contentHash;world.maps[next.mapId]!.contentHash=next.contentHash;
 const catalog=sealBatchContent(world),content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world:catalog,map:start,battle:f.battle,entrance:start.partyEntry!.pointIns[0]!.id}),runtime={battleHandoff:"prepared" as const,scriptRandom:WEB_SOURCE_SCRIPT_RANDOM};
 const game=await GameSession.prepareFrameworkNewGame(content,catalog,start,f.battle,runtime),flow=new GameFlow(game);flow.start();flow.advance(10,ready);
 return{f,game,flow,start,next,catalog,content,runtime,restore:(checkpoint:Parameters<typeof GameSession.restore>[0])=>GameSession.restore(checkpoint,undefined,f.battle,{catalog,map:checkpoint.world.location?.mapId===next.mapId?next:start,initialized:{content,initialMap:start}},runtime)};
}
test("whole shared lifecycle keeps draws private through map cancellation, active event save, battle media failure and return",async()=>{
 const h=await randomWorld();assert.equal(h.game.state.snapshot().fieldRandom!.draws,1);h.game.field.startEvent("go-world");h.flow.advance(10,ready);
 const before=h.game.state.snapshot(),old=h.game.field,cancelled=h.game.world.prepare(h.catalog,h.next);assert.deepEqual(h.game.state.snapshot(),before);h.game.world.discard(cancelled);assert.equal(h.game.field,old);
 const candidate=h.game.world.prepare(h.catalog,h.next);assert.equal(h.game.world.commit(candidate),true);h.flow.advance(10,ready);assert.equal(h.game.state.snapshot().fieldRandom!.draws,2);
 h.game.field.startEvent("rng-save");h.flow.advance(10,ready);assert.ok(h.game.eventSaveRequest);assert.equal(h.game.state.snapshot().fieldRandom!.draws,3);
 const save=h.game.prepareEventSave(h.game.eventSaveRequest!),bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}}),prepared=await storage.prepareSave(save.checkpoint,0);save.commitWith(()=>prepared.commit());
 const game=h.restore((await storage.load())!.checkpoint),flow=new GameFlow(game);flow.start();flow.advance(40,ready);h.flow.advance(40,ready);assert.deepEqual(game.state.snapshot(),h.game.state.snapshot());assert.equal(game.state.snapshot().fieldRandom!.draws,4);
 game.field.startEvent("rng-fight");flow.advance(10,ready);let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail)throw Error("controlled media failure");},prepareReturn:async()=>undefined,discard(){}}),prior=game.state.snapshot();
 assert.equal((await handoff.start()).status,"failed");assert.deepEqual(game.state.snapshot(),prior);fail=false;assert.equal((await handoff.start()).status,"committed");
 const commands=new GameCommands(flow,game);for(let i=0;i<2000&&game.battle?.phase==="active";i++){const b=game.battle;for(const actor of b.ready){const target=b.enemies.find(e=>e.hp>0);if(target)commands.command(b,actor.id,10,{kind:"single",id:target.id},100);}flow.advance(20,ready);}
 assert.equal(game.battle?.phase,"victory");assert.equal((await handoff.return()).status,"committed");flow.advance(10,ready);assert.equal(game.state.snapshot().fieldRandom!.draws,5);
 const settled=game.checkpoint(),restored=h.restore(settled);assert.deepEqual(restored.checkpoint(),settled);assert.equal(restored.state.snapshot().completedBattles.length,1);
 const rf=new GameFlow(restored);rf.start();restored.field.startEvent("world-return");rf.advance(10,ready);const back=restored.world.prepare(h.catalog,h.start);assert.equal(restored.world.commit(back),true);rf.advance(10,ready);assert.equal(restored.state.snapshot().fieldRandom!.draws,6);
});
test("original map initialization failure after a candidate draw preserves live RNG, actors and pending request",async()=>{
 const h=await randomWorld(true);h.game.field.startEvent("go-world");h.flow.advance(10,ready);const before=h.game.state.snapshot(),old=h.game.field,actors=old.nativeActorStateFingerprint,stop=structuredClone(old.stop);
 assert.throws(()=>h.game.world.prepare(h.catalog,h.next),/Controlled candidate failed/);assert.equal(h.game.field,old);assert.deepEqual(h.game.state.snapshot(),before);assert.equal(old.nativeActorStateFingerprint,actors);assert.deepEqual(old.stop,stop);
});

test("source mutation during a random preparation cannot redirect the destination or consume its draw",async()=>{
 const {state}=await owned(),e=new EventState(),before=state.snapshot(),c=command();
 const port={prepare:(upper:number)=>{const p=state.fieldScriptRandom.prepare(upper);c.target.index=1;return p;}};
 assert.throws(()=>executeFieldScriptRandom(c,e,port),/Stale.*instruction/);assert.deepEqual(state.snapshot(),before);assert.equal(e.snapshot().map[0],null);assert.equal(e.snapshot().map[1],null);
});

test("restored Session captures its explicit random policy before a later caller-object mutation",async()=>{
 const h=await randomWorld(),restored=h.restore(h.game.checkpoint()),flow=new GameFlow(restored);flow.start();
 Reflect.deleteProperty(h.runtime,"scriptRandom");
 restored.field.startEvent("go-world");flow.advance(10,ready);
 const candidate=restored.world.prepare(h.catalog,h.next);assert.equal(restored.world.commit(candidate),true);flow.advance(10,ready);
 assert.equal(restored.field.stop,null);assert.equal(restored.state.snapshot().fieldRandom!.draws,2);
 const ungranted=h.restore(h.game.checkpoint()),uf=new GameFlow(ungranted);uf.start();Reflect.set(h.runtime,"scriptRandom",WEB_SOURCE_SCRIPT_RANDOM);
 ungranted.field.startEvent("go-world");uf.advance(10,ready);const before=ungranted.state.snapshot();
 assert.throws(()=>ungranted.world.prepare(h.catalog,h.next),/explicit Web/);assert.deepEqual(ungranted.state.snapshot(),before);
});
