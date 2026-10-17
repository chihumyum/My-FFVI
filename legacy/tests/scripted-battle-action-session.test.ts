import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { WEB_SCRIPTED_BATTLE_ACTIONS } from "../src/core/scripted-battle-action.js";
import { compileScriptedBattleAction } from "../src/compiler/battle-scripted-action.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
const ready={visible:true,mediaReady:true,overlayOpen:false};
const runtime={battleHandoff:"prepared" as const,scriptedBattleActions:WEB_SCRIPTED_BATTLE_ACTIONS};
function fixture(){
 const f=checkpointFixture();f.battle.common.sprites.synthetic={file:"synthetic.png",width:16,height:16};
 f.battle.common.battleEvents={conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 const op=compileScriptedBattleAction({type:1,mnemonic:"BattleAction",operands:{iValues:[1,1000,10,2,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill("")}});
 f.battle.encounters[1000]!.lifecycle={kind:"battle-lifecycle-v1",mode:"script",scriptId:1,program:{kind:"battle-event-v1",source:null,entry:0,end:3,localNames:["after"],initialLocals:[0],instructions:[{mnemonic:"BattleAction",op},{mnemonic:"Calc",op:{kind:"calc",index:0,operator:"＋",right:{kind:"immediate",value:1}}},{mnemonic:"Exit",op:{kind:"exit"}}],blockers:[]}};
 const game=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(game);flow.start();flow.advance(0,ready);
 const owner=game.state,before=owner.snapshot();assert.equal(game.field.startEvent("fight"),true);
 const request=game.field.stop;assert.equal(request?.kind,"encounter");
 return {...f,game,flow,owner,before,request,commands:new GameCommands(flow,game)};
}
const host={prepareStart:async()=>({kind:"start"}),prepareReturn:async()=>({kind:"return"}),discard(_v:{kind:string}){}};
function win(f:ReturnType<typeof fixture>){const b=f.game.battle!;assert.equal(b.pendingActions[0]?.kind,"event");const hp=b.enemies.map(e=>e.hp);f.flow.advance(10,ready);assert.equal(b.action?.kind,"event");assert.deepEqual(b.enemies.map(e=>e.hp),hp);for(let i=0;i<300&&b.phase==="active";i++)f.flow.advance(10,ready);assert.equal(b.phase,"victory");assert.equal(b.eventExecution.state?.locals[0],1);assert(b.enemies.every(enemy=>enemy.hp===0));return b;}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}

test("scripted action entry media failure/cancellation retain the original lease and execute once after retry",async()=>{
 const f=fixture();let failures=1;const handoff=new GameBattleHandoff(f.flow,{...host,prepareStart:async()=>{if(failures-->0)throw new Error("Controlled decode failure");return{kind:"start"};}});
 assert.equal((await handoff.start()).status,"failed");assert.equal(f.game.battle,null);assert.equal(f.game.field.stop,f.request);assert.deepEqual(f.owner.snapshot(),f.before);assert.equal(f.owner.inBattle,false);
 const held=deferred<{kind:string}>(),disposed:{kind:string}[]=[],cancel=new GameBattleHandoff(f.flow,{...host,prepareStart:()=>held.promise,discard:v=>{disposed.push(v);}});
 const old=cancel.start();cancel.cancel();assert.equal(f.game.battle,null);assert.deepEqual(f.owner.snapshot(),f.before);
 assert.equal((await handoff.start()).status,"committed");const battle=win(f);held.resolve({kind:"obsolete"});assert.equal((await old).status,"cancelled");assert.equal(disposed.length,1);assert.equal(f.game.battle,battle);assert.equal(f.owner.snapshot().completedBattles.length,0);
 assert.equal((await handoff.return()).status,"committed");f.flow.advance(10,ready);assert.equal(f.owner.snapshot().completedBattles.length,1);assert.equal(f.game.field.flags.ScenarioFlag1![1],true);await assert.rejects(()=>handoff.return(),/pending encounter|requires/);assert.equal(f.owner.snapshot().completedBattles.length,1);
});

test("real action terminal return retries atomically and stable Storage restore never repeats effects or rewards",async()=>{
 const f=fixture();let fail=true;const handoff=new GameBattleHandoff(f.flow,{...host,prepareReturn:async()=>{if(fail){fail=false;throw new Error("Controlled return failure");}return{kind:"return"};}});
 await handoff.start();const battle=win(f),before=f.owner.snapshot();assert.equal((await handoff.return()).status,"failed");assert.equal(f.game.battle,battle);assert.deepEqual(f.owner.snapshot(),before);assert.equal((await handoff.return()).status,"committed");f.flow.advance(10,ready);
 const settled=f.game.checkpoint(),bytes=new Map<string,string>();let failStorage=true;const storage=new CheckpointStorage({getItem:key=>bytes.get(key)??null,setItem:(key,value)=>{if(failStorage)throw new Error("quota");bytes.set(key,value);}},"framework","scripted-battle-action");
 await assert.rejects(storage.save(settled,100),/quota/);assert.equal(bytes.size,0);assert.deepEqual(f.game.checkpoint(),settled);failStorage=false;await storage.save(settled,101);const save=(await storage.load())!;
 const restored=GameSession.restore(save.checkpoint,f.field,f.battle,undefined,runtime),flow=new GameFlow(restored);flow.start();flow.advance(0,ready);assert.deepEqual(restored.checkpoint(),settled);const beforeAdvance=restored.state.snapshot();flow.advance(100,ready);assert.deepEqual(restored.state.snapshot(),beforeAdvance);assert.equal(restored.state.snapshot().completedBattles.length,1);assert.equal(restored.battle,null);
 assert.equal(f.commands.command(battle,"a",10,"e1",100),false);assert.equal(restored.field.startEvent("fight"),true);const next=new GameBattleHandoff(flow,host);assert.equal((await next.start()).status,"committed");for(let i=0;i<300&&restored.battle!.phase==="active";i++)flow.advance(10,ready);assert.equal(restored.battle!.phase,"victory");assert.equal((await next.return()).status,"committed");flow.advance(10,ready);assert.equal(restored.state.snapshot().completedBattles.length,2);
});

test("defeat retry discards old action identities, restores the fixed entry and retains the sole persistent owner",async()=>{
 const f=fixture(),handoff=new GameBattleHandoff(f.flow,host);await handoff.start();const old=f.game.battle!;
 // Controlled casualty precondition, not a scripted action implementation.
 for(const player of old.players){player.hp=0;player.conditionIds=[305];}
 f.flow.advance(10,ready);assert.equal(old.phase,"defeat");assert.equal(f.owner.snapshot().completedBattles.length,0);assert.equal((await handoff.retry()).status,"committed");assert.notEqual(f.game.battle,old);assert.equal(f.game.state,f.owner);assert.equal(f.game.field.stop,f.request);assert.deepEqual(f.owner.snapshot(),f.before);win(f);await handoff.return();f.flow.advance(10,ready);assert.equal(f.owner.snapshot().completedBattles.length,1);assert.equal(f.commands.command(old,"a",10,"e1",100),false);
});
