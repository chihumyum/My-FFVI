import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleAbilityContent } from "../src/compiler/battle-ability-content.js";
import { projectActionTargets } from "../src/core/action-user-conditions.js";
import { battleReaction } from "../src/core/battle-reactions.js";
import { projectNonDamagingEffect, isNonDamagingHit } from "../src/core/non-damaging-ability.js";
import { BattleGame } from "../src/core/battle.js";
import { compileScriptedBattleAction } from "../src/compiler/battle-scripted-action.js";
import { WEB_SCRIPTED_BATTLE_ACTIONS } from "../src/core/scripted-battle-action.js";
import type { BattleEventOp } from "../src/core/battle-event.js";
import { battleAbilityContentFixture } from "./fixtures/battle-ability-content.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
function source(){const f=battleAbilityContentFixture();Object.assign(f.ability,{type_id:"35",system_id:"2",battle_renge_id:"5",standard_value:"0",use_value:"0",ability_wait:"0",battle_effect_asset_id:"808"});
 f.tables["function.csv"]![0]!.type_id="19";f.group.function1_value1=f.group.function1_value2="0";f.tables["content.csv"]=[];
 f.tables["battle_effect_asset.csv"]=[{id:"808",asset_name:"synthetic_effect",position_type:"5",display_type:"0",se_asset_id:"404",se_asset_id_2:"0",critical_se_asset_id:"0"}];f.tables["se_asset.csv"]=[{id:"404",asset_name:"synthetic_sound"}];return f;}
const compile=(f=source())=>compileBattleAbilityContent(f.reader(),f.tables,f.resolveName);
function action(asynchronous=false){return compileScriptedBattleAction({type:1,mnemonic:"BattleAction",operands:{iValues:[1,1000,901,2,1,Number(asynchronous),0,0],rValues:Array(8).fill(0),sValues:Array(8).fill("")}});}
const after:BattleEventOp={kind:"calc",index:0,operator:"＋",right:{kind:"immediate",value:1}};
function content(extra:BattleEventOp[]=[]){const c=fixture();c.abilities[901]=compile().abilities[901]!;c.players[0]!.commands=[];c.players[0]!.abilities=[];c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=9999;
 c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 const ops:BattleEventOp[]=[{kind:"end-enabled",enabled:false},{kind:"pause",enabled:true},...extra,action(),after,{kind:"nop"},{kind:"blank"},{kind:"jump",target:extra.length+4}];
 c.lifecycle={kind:"battle-lifecycle-v1",mode:"script",scriptId:1,program:{kind:"battle-event-v1",source:null,entry:0,end:ops.length,localNames:["after"],initialLocals:[0],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]}};return c;}
const game=(c=content())=>new BattleGame(c,123,undefined,undefined,undefined,undefined,undefined,undefined,{scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS});
const snap=(b:BattleGame)=>({time:b.time,units:structuredClone(b.combatants),action:structuredClone(b.action),pending:b.pendingActions,event:b.eventExecution,events:structuredClone(b.events),phase:b.phase});
function until(b:BattleGame,p:()=>boolean){for(let i=0;i<700&&!p();i++)b.advance(10);assert(p());}

test("one source function protocol compiles without inventing missing content or ownership",()=>{
 const f=source(),before=structuredClone(f.tables),r=compile(f),a=r.abilities[901]!;assert(a.plan);assert.equal(a.presentation,"source-effect-deferred");
 assert.deepEqual(a.plan.effects,[{kind:"non-damaging",slot:1,calculation:"fixed-status-hit",parameterUpdate:"none"}]);assert.equal(a.name,"");assert.equal(r.abilityContentIds[901],null);assert.equal(r.entries[901]!.display.kind,"missing-content");
 assert.equal(a.nonDamagingPresentation!.effectAssetId,808);assert.deepEqual(a.nonDamagingPresentation!.sourceEffect!.soundAssetIds,[404,0,0]);assert.equal(r.report.ownershipGranted,false);
 assert(r.entries[901]!.sources.some(s=>s.assetPath.endsWith("battle_effect_asset.csv")&&s.rowId==="808"));assert(r.entries[901]!.sources.some(s=>s.assetPath.endsWith("se_asset.csv")&&s.rowId==="404"));assert.deepEqual(f.tables,before);
 // A different synthetic master ID uses exactly the same source protocol.
 f.ability.id="902";assert(compile(f).abilities[902]!.plan);
});
test("the complete composition and effect references gate instead of admitting a Non label",()=>{
 for(const [key,value]of Object.entries({process_prog:"UNPORTED_PROCESS",type_id:"34",system_id:"3",battle_renge_id:"12",standard_value:"1",use_value:"1",invalid_reflection:"0",accuracy_rate:"99",ability_wait:"1",attribute_group_id:"99"})){
  const f=source();f.ability[key]=value;let blocked=false;try{blocked=compile(f).abilities[901]!.plan===null;}catch{blocked=true;}assert(blocked,key);
 }
 for(const mutate of [(f:ReturnType<typeof source>)=>{f.group.function1_value1="1";},(f:ReturnType<typeof source>)=>{f.tables["function.csv"]![0]!.series_id="1";},(f:ReturnType<typeof source>)=>{f.tables["battle_effect_asset.csv"]=[];},(f:ReturnType<typeof source>)=>{f.tables["se_asset.csv"]=[];}]){
  const f=source();mutate(f);let blocked=false;try{blocked=!compile(f).abilities[901]!.plan;}catch{blocked=true;}assert(blocked);
 }
 const ambiguous=source();ambiguous.tables["content.csv"]=[{...ambiguous.content},{...ambiguous.content,id:"402"}];assert.equal(compile(ambiguous).abilities[901]!.plan,null);
});
test("fixed Hit is non-numerical: target state is unchanged, zero RNG, real counter eligibility",()=>{
 const b=game(),a=b.players[0]!,target=b.enemies[0]!,plan=b.content.abilities[901]!.plan!,before=structuredClone(target);let rng=0;
 const p=projectActionTargets(plan,0,a,[target],b.conditions,()=>{rng++;throw new Error("No RNG");});assert.equal(rng,0);assert.deepEqual(p.targets[0]!.state,{hp:target.hp,mp:target.mp,conditionIds:target.conditionIds});assert.deepEqual(target,before);
 const effect=p.targets[0]!.effects[0]!;assert.equal(effect.resource,"none");assert(isNonDamagingHit(effect));
 const r=battleReaction({counterLimit:1,excludedAbilityIds:[]},{actor:a.id,target:target.id,isCounter:false,abilityId:901,systemId:2,primarySlot:1,effects:[effect]});assert(r?.counterReady);assert.equal(r.receivedAbilityId,901);
 assert.throws(()=>isNonDamagingHit({...effect,missed:true}),/fixed Hit/);assert.throws(()=>projectNonDamagingEffect({...plan.effects[0]!,parameterUpdate:"HP"}as never));
});
test("actual queued source action resolves once without HP/MP/state or a menu grant and keeps sync continuation",()=>{
 const b=game(),before=b.combatants.map(c=>({id:c.id,hp:c.hp,mp:c.mp,conditions:[...c.conditionIds]}));assert.equal(b.pendingActions[0]!.kind,"event");assert.equal(b.command("a",901,"e1"),false);
 b.advance(10);assert.equal(b.action?.kind,"event");b.advance(390);assert.equal(b.action?.resolved,false);b.advance(10);assert.equal(b.action?.resolved,true);assert(isNonDamagingHit(b.action!.results[0]!.effects[0]));assert.equal(b.eventExecution.state!.locals[0],0);
 assert.deepEqual(b.combatants.map(c=>({id:c.id,hp:c.hp,mp:c.mp,conditions:c.conditionIds})),before);until(b,()=>b.eventExecution.state!.locals[0]===1);assert.equal(b.action,null);assert.equal(b.pendingActions.length,0);b.advance(100);assert.equal(b.eventExecution.state!.locals[0],1);assert.deepEqual(b.players[0]!.abilities,[]);
});
test("non-damaging Hit waits through the real reaction owner, not only the primary Web stages",()=>{
 const c=content([{kind:"exec-ai"}]);c.enemies[0]!.ai=syntheticAI([["Nop"],["SyncAI"],["StartTable",[0]],["Act",[13]],["CounterActReceiveCommand",[35,13],[0,100]],["EndTable"],["JumpBattleAI",[0]]]);
 const b=game(c);until(b,()=>b.action?.kind==="counter");assert.equal(b.eventExecution.state!.locals[0],0);until(b,()=>b.eventExecution.state!.locals[0]===1);assert.equal(b.action,null);
});
test("missing or changed presentation policy rejects atomically and retry does not repeat a result",()=>{
 const c=content();delete c.abilities[901]!.nonDamagingPresentation;assert.throws(()=>game(c),/presentation policy/);
 const b=game();b.advance(400);const policy=b.content.abilities[901]!.nonDamagingPresentation!,before=snap(b);policy.kind="unsupported"as never;assert.throws(()=>b.advance(10),/presentation policy/);assert.deepEqual(snap(b),before);policy.kind="web-source-non-damaging-effect-deferred-v1";b.advance(10);assert(isNonDamagingHit(b.action!.results[0]!.effects[0]));until(b,()=>b.eventExecution.state!.locals[0]===1);assert.equal(b.eventExecution.state!.locals[0],1);
});
