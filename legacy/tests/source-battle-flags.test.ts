import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { parseSourceBattleFlags } from "../src/core/battle-flags.js";
import { WEB_MANUAL_BATTLE_CONTROLS } from "../src/core/battle-controls.js";
import { encounterContent } from "../src/core/battle-content.js";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function fixture(flags:number[]=[14]){
 const source=encounterRuntimeFixture(),entry=source.encounter(1000);entry.metadata.battleFlagGroupId=90;
 entry.metadata.battleFlags=flags.map((id,n)=>({values:{id:String(n+1),group_id:"90",battle_flag_id:String(id)},source:source.rowSource("battle_flag_group.csv",n+1)}));
 const input={...source.input,requestedPartyIds:[1000],encounters:[entry],sourceFlagContext:"story"as const},
  compile=()=>compileBattleEncounterRuntime(source.reader(),input),base=checkpointFixture();
 return{source,input,entry,compile,base,catalog(){const result=compile();return{...base.battle,encounters:result.encounters,common:{...base.battle.common,drops:result.drops}};}};
}
test("source flag14 retains its AR-directory exclusion while a normal story battle uses the existing units and controller",()=>{
 const f=fixture(),before=structuredClone(f.entry),catalog=f.catalog(),content=encounterContent(catalog,1000,1)!,game=new BattleGame(content,1);
 assert.equal(game.sourceFlagExecution?.arDirectoryEligible,false);assert.equal(game.sourceFlagExecution?.entryContext,"story");
 assert.deepEqual(game.sourceFlagExecution!.rows.map(r=>r.flagId),[14]);assert.equal(game.playerControlMode,"manual");
 assert.deepEqual(f.entry,before);assert.equal(game.combatants.filter(c=>c.side==="enemy").length,1);
 const exposed=game.sourceFlagExecution!;exposed.rows[0]!.source.rowId="77";content.sourceFlags!.rows[0]!.source.rowId="78";
 assert.equal(game.sourceFlagExecution!.rows[0]!.source.rowId,"1");assert.equal(game.combatants[0]!.hp,80);
 assert.ok(f.compile().report.flagSources?.some(r=>r.partyId===1000&&r.content.rows[0]!.flagId===14));
});
test("flag14 needs a declared story context; unknown AR contexts cannot be granted by a source flag",()=>{
 const f=fixture(),{sourceFlagContext:_,...unknown}=f.input;
 const strict=compileBattleEncounterRuntime(f.source.reader(),unknown);assert.equal(strict.encounters[1000],undefined);
 assert.ok(strict.diagnostics.some(d=>d.code==="battle-flags"&&d.kind==="blocked"));
 assert.throws(()=>compileBattleEncounterRuntime(f.source.reader(),{...f.input,sourceFlagContext:"ar"as"story"}),/context/);
 const raw=f.catalog().encounters[1000]!.sourceFlags!;
 assert.throws(()=>parseSourceBattleFlags({...raw,entryContext:"ar"}),/context/);
 assert.throws(()=>parseSourceBattleFlags({...raw,arDirectoryEligible:true}),/context/);
});
test("mixed flag14 and flag19 apply both exact roles, without enabling automatic control",()=>{
 const f=fixture([14,19]);assert.equal(f.compile().encounters[1000],undefined);
 Object.assign(f.input,{manualControls:WEB_MANUAL_BATTLE_CONTROLS});const catalog=f.catalog(),content=encounterContent(catalog,1000,2)!,game=new BattleGame(content,2);
 assert.equal(game.sourceFlagExecution?.arDirectoryEligible,false);assert.equal(game.playerControlMode,"manual");
 assert.throws(()=>game.setAutomaticMode(true),/unimplemented/);assert.equal(game.playerControlMode,"manual");
 assert.deepEqual(game.sourceFlagExecution!.rows.map(r=>r.flagId),[14,19]);
 const noController={...content};delete noController.controls;assert.throws(()=>new BattleGame(noController,2),/flag19/);
 delete catalog.encounters[1000]!.controls;assert.throws(()=>encounterContent(catalog,1000,2),/flag19/);
});
test("known flags do not erase another flag, an unknown battle script, an initial-condition failure or source diagnostic",()=>{
 for(const flags of [[14,24],[14,19,27],[14,999]]){const f=fixture(flags);Object.assign(f.input,{manualControls:WEB_MANUAL_BATTLE_CONTROLS});const r=f.compile();assert.equal(r.encounters[1000],undefined);assert.ok(r.diagnostics.some(d=>d.code==="battle-flags"&&d.kind==="blocked"));}
 const f=fixture();f.entry.metadata.scriptId=1;f.entry.script={source:f.source.aiIdentity,data:{Name:"synthetic",Title:{main:"",sub:""},Mnemonics:[{mnemonic:"Exit",type:1,operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:Array(8).fill("")}},{mnemonic:"SysCall",type:1,operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:["Unknown",...Array(7).fill("")]}}],Segments:[{Label:"Main",EntryPoint:0,Count:2}],ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]}};
 let r=f.compile();assert.equal(r.encounters[1000],undefined);assert.ok(r.diagnostics.some(d=>d.code==="battle-script"&&d.pc===1));assert.equal(r.report.flagSources!.length,1);
 f.entry.metadata.scriptId=0;f.entry.script=null;f.source.tables["monster.csv"]![0]!.initial_condition="999";r=f.compile();
 assert.equal(r.encounters[1000],undefined);assert.ok(r.diagnostics.some(d=>d.code==="enemy-initial-condition"));assert.ok(r.diagnostics.some(d=>d.code==="participant-content"));
 const g=fixture();g.input.sourceDiagnostics=[{partyId:1000,code:"synthetic-source-failure",reason:"Retained exact dependency failure",source:g.entry.source}];r=g.compile();assert.equal(r.encounters[1000],undefined);assert.ok(r.diagnostics.some(d=>d.code==="synthetic-source-failure"));
});
test("source flag rows, party identity and placement remain strict at import and runtime boundaries",()=>{
 const f=fixture();f.entry.metadata.battleFlags[0]!.values.group_id="91";assert.equal(f.compile().encounters[1000],undefined);
 const g=fixture(),catalog=g.catalog(),plan=catalog.encounters[1000]!.sourceFlags!;
 for(const bad of [{...plan,extra:1},{...plan,groupId:0},{...plan,rows:[plan.rows[0],plan.rows[0]]},{...plan,rows:[{...plan.rows[0],flagId:4}]},{...plan,rows:[]},{...plan,partySource:{...plan.partySource,objectId:9007199254740993}}])assert.throws(()=>parseSourceBattleFlags(bad));
 catalog.encounters[1000]!.sourceFlags!.partySource.rowId="1001";assert.throws(()=>encounterContent(catalog,1000,1),/another encounter/);
 const h=fixture(),valid=h.catalog();Object.assign(valid.common,{sourceFlags:valid.encounters[1000]!.sourceFlags});assert.throws(()=>encounterContent(valid,1000,1),/belong to an encounter/);
});
test("normal story flag binding survives prepared cancellation, victory, owned return and stable Storage without adding a state owner",async()=>{
 const f=fixture([14,19]);Object.assign(f.input,{manualControls:WEB_MANUAL_BATTLE_CONTROLS});const catalog=f.catalog(),session=new GameSession(f.base.field,catalog,123,{battleHandoff:"prepared"}),flow=new GameFlow(session),ready={visible:true,mediaReady:true,overlayOpen:false};flow.start();flow.advance(0,ready);
 const owner=session.state,before=owner.snapshot();session.field.startEvent("fight");const request=session.field.stop;
 let release!:(v:{kind:string})=>void;const pending=new Promise<{kind:string}>(yes=>{release=yes;}),discarded:unknown[]=[],old=new GameBattleHandoff(flow,{prepareStart:()=>pending,prepareReturn:async()=>({kind:"return"}),discard:x=>discarded.push(x)}),starting=old.start();old.cancel();
 const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>({kind:"ready"}),prepareReturn:async()=>({kind:"return"}),discard:x=>discarded.push(x)});assert.equal((await handoff.start()).status,"committed");release({kind:"old"});assert.equal((await starting).status,"cancelled");assert.equal(discarded.length,1);assert.deepEqual(owner.snapshot(),before);assert.equal(session.field.stop,request);
 const game=session.battle!,plan=game.sourceFlagExecution;assert.equal(plan?.arDirectoryEligible,false);assert.equal(game.playerControlMode,"manual");
 for(let i=0;i<20000&&game.phase==="active";i++){for(const actor of game.ready){const target=game.targets(actor.id,10)[0];if(target)game.command(actor.id,10,target.id);}flow.advance(10,ready);}
 assert.equal(game.phase,"victory");assert.equal((await handoff.return()).status,"committed");flow.advance(10,ready);assert.equal(session.state,owner);assert.equal(owner.snapshot().completedBattles.length,1);
 const stable=session.checkpoint(),bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}},"framework","source-flags");await storage.save(stable,99);const saved=(await storage.load())!,restored=GameSession.restore(saved.checkpoint,f.base.field,catalog,undefined,{battleHandoff:"prepared"});assert.deepEqual(restored.checkpoint(),stable);
 restored.field.startEvent("fight");const again=new GameFlow(restored);again.start();again.advance(0,ready);const next=new GameBattleHandoff(again,{prepareStart:async()=>({kind:"ready"}),prepareReturn:async()=>({kind:"return"}),discard:x=>discarded.push(x)});assert.equal((await next.start()).status,"committed");assert.deepEqual(restored.battle!.sourceFlagExecution,plan);assert.equal(restored.battle!.playerControlMode,"manual");
});
