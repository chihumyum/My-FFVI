import test from 'node:test';import assert from 'node:assert/strict';
import {compileSourceBattleParticipantClosure,parseSourceBattleParticipantPolicy,sourceBattleParticipantSlots,validateSourceBattleParticipantProof} from '../src/compiler/source-battle-participant-closure.js';
import {compileBattleEncounterRuntime} from '../src/compiler/battle-encounter-runtime.js';
import {sourceParticipantFixture,dynamicSourcePolicy} from './fixtures/source-battle-participants.js';
import {aiSource} from './fixtures/battle-ai.js';
import {checkpointFixture} from './fixtures/checkpoint-game.js';
import {GameSession} from '../src/core/game-session.js';

test('whole source closure uses every original slot and resolves an absent initial master through its own source chain',()=>{
 const f=sourceParticipantFixture(),before=JSON.stringify(f.input),c=f.closure(),r=f.runtime(c);
 assert.equal(c.diagnostics.length,0);assert.equal(c.reserveEnemies.length,1);assert.equal(c.reserveEnemies[0]!.enemy.monsterId,9103);
 assert.deepEqual(Object.keys(c.participants[0]!.slots),['1','2','3','4','5','6','7','8','9']);
 assert.deepEqual(c.participants[0]!.slots[2],{x:-21,y:31,group:1});
 assert.equal(r.encounters[9201]!.participants!.enemyDefinitions[9103]!.exp,19);
 assert.equal(r.encounters[9201]!.enemies.length,1);assert.equal(r.encounters[9201]!.participants!.rewardScope,'all-entered');
 assert.equal(r.encounters[9202]!.participants!.rewardScope,'active-units');assert.equal(JSON.stringify(f.input),before);
 validateSourceBattleParticipantProof(dynamicSourcePolicy,c.report,{encounters:r.encounters,diagnostics:r.diagnostics,entryScriptGroups:f.entryScriptGroups()});
 const old=compileBattleEncounterRuntime(f.reader(),f.input);assert.equal(old.encounters[9201],undefined);
 assert.ok(old.diagnostics.some(d=>d.code==='participant-policy'&&d.pc===0));
 assert.equal(c.report.sourceExecutions,0);assert.equal(c.report.nativeLayoutParity,false);
});
test('full child source members and all nine positions flow through the existing party compiler without replacing the root',()=>{
 const f=sourceParticipantFixture({child:true}),c=f.closure(),r=f.runtime(c),p=r.encounters[9201]!.participants!;
 assert.equal(c.enemyParties.length,1);assert.equal(c.enemyParties[0]!.encounter.partyId,513);
 assert.equal(Object.keys(p.enemyParties![513]!.slots).length,9);assert.deepEqual(p.enemyParties![513]!.members,[{sourceId:9103,uniqueId:5}]);
 const lifecycle=r.encounters[9201]!.lifecycle!;assert.equal(lifecycle.mode,'script');if(lifecycle.mode==='script')assert.equal(lifecycle.scriptId,8123);
 validateSourceBattleParticipantProof(dynamicSourcePolicy,c.report,{encounters:r.encounters,diagnostics:r.diagnostics,entryScriptGroups:f.entryScriptGroups()});
});
test('missing data and changed source identity block only affected roots; no compacted layout or another-party master fallback',()=>{
 for(const cause of ['master','asset','ai','ability','slot','group'] as const){
  const f=sourceParticipantFixture();
  if(cause==='master')f.tables['monster.csv']!.pop();if(cause==='asset')f.tables['monster.csv']![2]!.monster_asset_id='999';
  if(cause==='ai')f.tables['monster.csv']![2]!.script_id='999';if(cause==='ability')f.tables['ability.csv']=[];
  if(cause==='slot')delete f.tables['monster_party.csv']![0]!.monster2_x_position;
  if(cause==='group')f.tables['monster_party.csv']![0]!.monster2_group='0';
  const c=f.closure(),r=f.runtime(c);assert.equal(r.encounters[9201],undefined,cause);assert.ok(r.encounters[9202],cause);
  assert.ok(r.diagnostics.some(d=>d.partyId===9201&&d.code==='participant-source-reference'&&d.kind==='blocked'),cause);
  validateSourceBattleParticipantProof(dynamicSourcePolicy,c.report,{encounters:r.encounters,diagnostics:r.diagnostics,entryScriptGroups:f.entryScriptGroups()});
 }
 const f=sourceParticipantFixture(),reader=f.reader();
 assert.throws(()=>sourceBattleParticipantSlots({...reader.row('monster_party.csv',9201),values:{id:'9201'}}));
 const c=compileSourceBattleParticipantClosure({row(table,id){const row=reader.row(table,id);return table==='monster.csv'?{...row,source:{...row.source,rowId:'99'}}:row;},group:reader.group.bind(reader)},
  {policy:dynamicSourcePolicy,encounters:f.input.encounters,sources:f.sources});assert.equal(c.reserveEnemies.length,0);assert.ok(c.diagnostics.length);
});
test('unimplemented late conditions, child flags and real AI gates survive successful source data closure',()=>{
 const f=sourceParticipantFixture();f.tables['monster.csv']![2]!.initial_condition='999';
 const c=f.closure(),r=f.runtime(c);assert.equal(c.diagnostics.length,0);assert.equal(r.encounters[9201],undefined);
 assert.ok(r.diagnostics.some(d=>d.kind==='blocked'&&d.code.includes('condition')));
 const g=sourceParticipantFixture({child:true});g.tables['monster_party.csv']![2]!.battle_flag_group_id='17';g.tables['battle_flag_group.csv']=[{id:'1',group_id:'17',battle_flag_id:'3'}];
 const gr=g.runtime();assert.equal(gr.encounters[9201],undefined);assert.ok(gr.diagnostics.some(d=>d.kind==='blocked'&&d.code==='enemy-party-flags'));
 const h=sourceParticipantFixture(),original=h.sources.json;h.sources.json=name=>{const value=original(name);value.data=aiSource([['Nop'],['SyncAI'],['ControlledUnknownAI'],['StartTable',[0]],['Act',[13]],['EndTable'],['JumpBattleAI',[0]]]);return value;};
 const hr=h.runtime();assert.ok(hr.diagnostics.some(d=>d.code==='ai-instruction'&&d.kind==='runtime-dependency'&&d.pc===2));
});
test('proof validation rejects removed sites, invented rewards, source slots, templates and child bindings after rehashing',()=>{
 for(const change of [
  (c:ReturnType<ReturnType<typeof sourceParticipantFixture>['closure']>)=>{c.report.bindings=[];},
  c=>{(c.report.bindings[0]!.sites as unknown[]).pop();},
  c=>{(c.report.bindings[0]!.derivedPolicy as {rewardScope:string}).rewardScope='active-units';},
  c=>{(c.report.bindings[0]!.derivedPolicy as {slots:Record<string,{x:number}>}).slots[2]!.x++;},
  c=>{c.report.bindings[0]!.templates=[];},
  c=>{c.report.bindings[0]!.children=[];},
 ] as ((c:ReturnType<ReturnType<typeof sourceParticipantFixture>['closure']>)=>void)[]){
  const f=sourceParticipantFixture({child:true}),c=f.closure(),r=f.runtime(c);change(c);
  assert.throws(()=>validateSourceBattleParticipantProof(dynamicSourcePolicy,c.report,{encounters:r.encounters,diagnostics:r.diagnostics,entryScriptGroups:f.entryScriptGroups()}));
 }
 for(const raw of [{...dynamicSourcePolicy,extra:true},{...dynamicSourcePolicy,rewardScope:'active-units'},{...dynamicSourcePolicy,kind:'future'}])assert.throws(()=>parseSourceBattleParticipantPolicy(raw));
});
test('real Session publishes the source-derived reserve with a fresh AI owner, then returns and restores without duplicating rewards',()=>{
 const f=sourceParticipantFixture(),raw=f.input.encounters[0]!.script!.data as {ScriptLocal:string[];ScriptLocalValue:number[];Mnemonics:Record<string,unknown>[];Segments:{Count:number}[]},
  instruction=(mnemonic:string,i:number[]=[],strings:string[]=[])=>({mnemonic,type:1,operands:{iValues:[...i,...Array(8-i.length).fill(0)],rValues:Array(8).fill(0),sValues:[...strings,...Array(8-strings.length).fill('')]}});
 raw.ScriptLocal=['AI'];raw.ScriptLocalValue=[0];raw.Mnemonics=[instruction('ExecBattleAI'),instruction('Blank'),raw.Mnemonics[0]!,instruction('Nop'),instruction('Blank'),
  instruction('SyncBattleAI'),instruction('Branch',[0,0,3],['ScriptLocalVariable','＝','imm']),instruction('BattleSyncAction'),instruction('Exit')];raw.Segments[0]!.Count=raw.Mnemonics.length;
 const r=f.runtime(),s=checkpointFixture(),fight=s.field.scripts.fight![0]!;
 assert.equal(fight.kind,'encounter');if(fight.kind==='encounter')fight.party=9201;
 s.battle.encounters=r.encounters;s.battle.encounterDiagnostics=r.diagnostics;s.battle.encounterReport=r.report;
 Object.assign(s.battle.common,{abilities:f.input.abilities,conditions:f.input.conditions,sprites:f.input.sprites,drops:r.drops,
  battleEvents:{conditions:f.input.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:id===305?1:0,gameOverTarget:id===305?1:0}))}});
 const game=new GameSession(s.field,s.battle,71),before=game.state.snapshot();game.field.startEvent('fight');
 for(let n=0;n<20&&!game.battle?.enemies.some(e=>e.sourceId===9103);n++)game.advance(10);
 const entered=game.battle!;assert.ok(entered);const joined=entered.enemies.find(e=>e.sourceId===9103)!;assert.ok(joined);
 assert.equal(joined.placement!.x,-21);assert.ok(entered.enemyAIState(joined.id));assert.equal(entered.participantExecution.entries.length,2);
 assert.deepEqual(game.state.snapshot(),before);
 for(let n=0;n<20000&&game.battle?.phase==='active';n++){
  for(const actor of game.battle.ready){const target=game.battle.targets(actor.id,10)[0];if(target)game.battle.command(actor.id,10,target.id);}game.advance(10);
 }
 assert.equal(game.battle?.phase,'victory');assert.equal(game.continueVictory(),true);assert.equal(game.continueVictory(),false);game.advance(10);
 assert.equal(game.state.snapshot().completedBattles.length,before.completedBattles.length+1);
 const checkpoint=JSON.parse(JSON.stringify(game.checkpoint())),restored=GameSession.restore(checkpoint,s.field,s.battle);assert.deepEqual(restored.checkpoint(),game.checkpoint());
});
