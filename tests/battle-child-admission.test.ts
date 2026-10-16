import {childAdmissionSessionFixture as authored} from './fixtures/battle-child-admission.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {WEB_BATTLE_CHILD_ADMISSION,parseBattleChildAdmission,prepareBattleChildParty,type BattleChildAdmission,type BattleChildPartyEntry} from '../src/core/battle-child-admission.js';
import {compileBattleEncounterRuntime} from '../src/compiler/battle-encounter-runtime.js';
import {compileSourceBattleParticipantClosure,validateSourceBattleParticipantProof} from '../src/compiler/source-battle-participant-closure.js';
import {sourceParticipantFixture,dynamicSourcePolicy} from './fixtures/source-battle-participants.js';
import {WEB_BATTLE_BRANCH_EXECUTION} from '../src/core/battle-branch-execution.js';
import {WEB_MANUAL_BATTLE_CONTROLS} from '../src/core/battle-controls.js';
import {gauSessionFixture} from './fixtures/battle-gau-instances.js';
import {GameSession} from '../src/core/game-session.js';import {GameFlow} from '../src/core/game-flow.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import {analyzeBatchEncounters} from '../src/compiler/content-batch-battle.js';
const source=(table:string,id:number)=>({file:'controlled.bundle',assetPath:'Assets/Master/'+table,serializedFile:'controlled',objectId:'90071992547409939',rowId:String(id)});
function family({flags=[14,19],escape=3,missingName=false}:{flags?:number[];escape?:number;missingName?:boolean}={}){
 const f=sourceParticipantFixture({child:true}),party=f.tables['monster_party.csv']![2]!;party.battle_flag_group_id=flags.length?'77':'0';party.not_escape=String(escape);
 f.tables['battle_flag_group.csv']=flags.map((flag,i)=>({id:String(81+i),group_id:'77',battle_flag_id:String(flag)}));
 const sources={...f.sources,json(name:string){const raw=f.sources.json(name);raw.source.sourceSetHash='a'.repeat(64);return raw;},spritePath(suffix:string){return suffix==='/controlled_enemy.png'?'Assets/Controlled/controlled_enemy.png':f.sources.spritePath(suffix);}};
 Object.assign(f.input.sprites,{'Assets/Controlled/controlled_enemy.png':structuredClone(f.input.sprites['synthetic-enemy']!)});
 if(missingName){f.tables['monster.csv']!.find(row=>row.id==='9103')!.mes_id_name='UNBOUND_CHILD';const data=f.input.encounters[0]!.script!.data as {Mnemonics:{mnemonic:string}[]};data.Mnemonics[0]!.mnemonic='Nop';}
 const closure=compileSourceBattleParticipantClosure(f.reader(),{policy:dynamicSourcePolicy,encounters:f.input.encounters,sources,branchExecution:WEB_BATTLE_BRANCH_EXECUTION});
 const input={...f.input,branchExecution:WEB_BATTLE_BRANCH_EXECUTION,manualControls:WEB_MANUAL_BATTLE_CONTROLS,sourceFlagContext:'story' as const,
  reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,sourceDiagnostics:[...f.input.sourceDiagnostics,...closure.diagnostics],development:{...f.input.development,participants:closure.participants}};
 const before=compileBattleEncounterRuntime(f.reader(),input),after=compileBattleEncounterRuntime(f.reader(),{...input,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});
 return {...f,sources,closure,input,before,after};
}
test('the complete entry-only family admits empty, 19-only, 14-only and mixed source rows without changing root context',()=>{
 for(const flags of [[],[19],[14],[19,14]]){
  const f=family({flags});assert(f.after.encounters[9201],JSON.stringify(f.after.diagnostics));
  const plan=f.after.encounters[9201]!.childPartyAdmission!;assert.deepEqual(plan.entries[513]!.flagRows.map(r=>r.flagId),flags);assert.equal(plan.entries[513]!.notEscape,3);
  assert.equal(plan.context,'retain-parent-entry');assert.equal(plan.entries[513]!.gates.length,0);assert.equal(Object.keys(plan.entries[513]!.slots).length,9);
  assert.equal(f.after.encounters[9201]!.escapePolicy,f.before.encounters[9201]?.escapePolicy);
  validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION,encounters:f.after.encounters,diagnostics:f.after.diagnostics,entryScriptGroups:f.entryScriptGroups()});
 }
});
test('unknown full groups and child behavior remain exact execution gates, while legacy admission stays hard',()=>{
 for(const options of [{flags:[14,19,3]},{escape:4},{missingName:true}]){
  const f=family(options),e=f.after.encounters[9201];assert(e,JSON.stringify(f.after.diagnostics));
  assert.equal(f.before.encounters[9201],undefined);assert.equal(e.participants!.enemyParties?.[513],undefined);assert(e.childPartyAdmission!.entries[513]!.gates.length);
  assert.throws(()=>prepareBattleChildParty(e.childPartyAdmission,513,e.participants!),/cannot enter/);
  validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION,encounters:f.after.encounters,diagnostics:f.after.diagnostics,entryScriptGroups:f.entryScriptGroups()});
  const stripped=structuredClone(f.after);stripped.diagnostics=stripped.diagnostics.filter(d=>d.kind!=='runtime-dependency');
  assert.throws(()=>validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION,encounters:stripped.encounters,diagnostics:stripped.diagnostics,entryScriptGroups:f.entryScriptGroups()}),/Dropped exact/);
 }
});
test('a standard child source failure remains hard and a root not_escape3 is never granted by the child policy',()=>{
 const f=family(),broken={...f.input,sourceDiagnostics:[...f.input.sourceDiagnostics]};broken.sourceDiagnostics.push({partyId:9201,code:'participant-source-reference',reason:'Unreviewed conflicting element rows in group 125, element 5',source:broken.encounters[0]!.source,dependency:{table:'monster_party.csv',id:513}});
 const denied=compileBattleEncounterRuntime(f.reader(),{...broken,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});assert.equal(denied.encounters[9201],undefined);assert(denied.diagnostics.some(d=>d.kind==='blocked'&&d.reason.includes('conflicting element')));
 const root=family();root.input.encounters[0]!.metadata.notEscape=3;const result=compileBattleEncounterRuntime(root.reader(),{...root.input,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});assert.equal(result.encounters[9201],undefined);assert(result.diagnostics.some(d=>d.kind==='blocked'&&d.code==='escape'));
});
test('wrong source identity, raw nine-slot mutations and changed AI physical binding stay directory hard gates',()=>{
 for(const change of [(f:ReturnType<typeof family>)=>{delete f.tables['monster.csv']!.find(r=>r.id==='9103')!.hp;},(f:ReturnType<typeof family>)=>{f.input.enemyParties[0]!.encounter.enemies[0]!.monsterId=9102;},(f:ReturnType<typeof family>)=>{f.input.enemyParties[0]!.encounter.enemies[0]!.x++;},(f:ReturnType<typeof family>)=>{f.input.enemyParties[0]!.encounter.enemies[0]!.sprite='synthetic-background';},(f:ReturnType<typeof family>)=>{f.input.enemyParties[0]!.encounter.enemies[0]!.ai.source.assetPath='Assets/forged.json';}]){
  const f=family();change(f);const bad=compileBattleEncounterRuntime(f.reader(),{...f.input,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});assert.equal(bad.encounters[9201],undefined);assert(bad.diagnostics.some(d=>d.kind==='blocked'&&d.code==='enemy-party-provider'));
 }
 const f=family(),{branchExecution:ignored,...withoutBranch}=f.input;assert.throws(()=>compileBattleEncounterRuntime(f.reader(),{...withoutBranch,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION}),/requires explicit/);
});
test('each of the nine raw source slots remains a structural requirement, including empty positions',()=>{
 for(let slot=1;slot<=9;slot++)for(const column of ['','_x_position','_y_position','_group']){
  const f=family();delete f.tables['monster_party.csv']![2]!['monster'+slot+column];
  const bad=compileBattleEncounterRuntime(f.reader(),{...f.input,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});
  assert.equal(bad.encounters[9201],undefined);assert(bad.diagnostics.some(d=>d.kind==='blocked'&&d.code==='enemy-party-provider'));
 }
});
test('invalid child life, level, reward and geometry cannot become deferred behavior',()=>{
 for(const change of [(f:ReturnType<typeof family>)=>{f.tables['monster.csv']!.find(r=>r.id==='9103')!.hp='0';},(f:ReturnType<typeof family>)=>{f.tables['monster.csv']!.find(r=>r.id==='9103')!.lv='0';},(f:ReturnType<typeof family>)=>{f.tables['monster.csv']!.find(r=>r.id==='9103')!.exp='-1';},(f:ReturnType<typeof family>)=>{f.input.sprites['Assets/Controlled/controlled_enemy.png']!.width=0;}]){
  const f=family();change(f);const bad=compileBattleEncounterRuntime(f.reader(),{...f.input,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});
  assert.equal(bad.encounters[9201],undefined);assert(bad.diagnostics.some(d=>d.kind==='blocked'&&d.code==='enemy-party-provider'));
 }
});
test('missing and conflicting element masters remain original structural failures, not deferred ready children',()=>{
 for(const conflict of [false,true]){
  const f=family(),monster=f.tables['monster.csv']!.find(r=>r.id==='9103')!;monster.resistance_attribute='908';
  f.tables['attribute_group.csv']=conflict?[{id:'9801',group_id:'908',attribute_id:'1',type_id:'1'},{id:'9802',group_id:'908',attribute_id:'1',type_id:'2'}]:[];
  f.tables['attribute.csv']=[{id:'1'}];
  const bad=compileBattleEncounterRuntime(f.reader(),{...f.input,childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});
  assert.equal(bad.encounters[9201],undefined);assert(bad.diagnostics.some(d=>d.kind==='blocked'&&d.code==='enemy-party-provider'&&d.reason.includes(conflict?'conflicting element':'attribute_group.csv.group_id=908')),JSON.stringify(bad.diagnostics));
 }
});
const ready={visible:true,mediaReady:true,overlayOpen:false};
function session(f:ReturnType<typeof authored>){const game=new GameSession(f.field,f.catalog,71,f.runtime),flow=new GameFlow(game);game.field.eventState.write({category:'ScenarioVariable',index:8},1);flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());return {...f,game,flow,battle:game.battle!};}
test('an unvisited gated child performs no factory work and the actual Session returns and restores through Storage',async()=>{
 const f=session(authored([{kind:'jump',target:1},{kind:'gau-replace'},{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}],true)),before=f.game.state.snapshot();
 for(let i=0;i<30&&f.battle.phase==='active';i++)f.flow.advance(10,ready);assert.equal(f.battle.phase,'forced');assert.equal(f.battle.gauInstanceExecution.journal.length,0);assert.deepEqual(f.game.state.snapshot(),before);
 const cancelled=f.game.prepareBattleReturn()!;cancelled.discard();assert.deepEqual(f.game.state.snapshot(),before);assert(f.game.prepareBattleReturn()!.commit());f.game.advance(2000);assert(f.game.checkpointReady);
 const map=new Map<string,string>(),storage=new CheckpointStorage({getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);}});await storage.save(f.game.checkpoint(),123);const saved=await storage.load();assert(saved);const restored=GameSession.restore(saved.checkpoint,f.field,f.game.battleCatalog,undefined,f.runtime);assert.deepEqual(restored.checkpoint(),saved.checkpoint);const forged=structuredClone(saved.checkpoint) as unknown as Record<string,unknown>;forged.battleChildPartyAdmission=WEB_BATTLE_CHILD_ADMISSION;assert.throws(()=>GameSession.restore(forged as never,f.field,f.game.battleCatalog,undefined,f.runtime),/fields|checkpoint|key/i);
});
test('a reached gate stops before media, old instances, AI, RNG, lease or reward publication and repeats at the same source cursor',()=>{
 const f=session(authored([{kind:'gau-replace'},{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}],true)),before={units:structuredClone(f.battle.combatants),owned:f.game.state.snapshot(),event:f.battle.eventExecution,party:f.battle.enemyPartyExecution};
 for(let retry=0;retry<2;retry++){assert.throws(()=>f.flow.advance(10,ready),/controlled-child-behavior/);assert.deepEqual(f.battle.combatants,before.units);assert.deepEqual(f.game.state.snapshot(),before.owned);assert.deepEqual(f.battle.enemyPartyExecution,before.party);assert.equal(f.battle.eventExecution.state!.pc,before.event.state!.pc);assert.equal(f.battle.gauInstanceExecution.journal.length,0);}
});
test('known children use the actual existing instance/AI/condition and one final prepared return, not a second battle owner',()=>{
 const f=session(authored([{kind:'gau-replace'},{kind:'change-enemy-party',partyId:501,hidden:false},{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}])),old=f.battle;
 f.flow.advance(50,ready);assert.equal(f.game.battle,old);assert.equal(old.enemyPartyExecution.partyId,501);assert(old.enemyAIState(old.enemies[0]!.id));assert.equal(old.phase,'forced');
 const returning=f.game.prepareBattleReturn()!;returning.discard();assert.equal(f.game.state.snapshot().completedBattles.length,0);assert(f.game.prepareBattleReturn()!.commit());assert.equal(f.game.state.snapshot().completedBattles.length,1);assert.throws(()=>old.advance(10),/Retired/);
});
test('dual runtime authorization, strict fields and copied gates cannot be forged or supplied by saved content',()=>{
 const f=authored();const runtime={...f.runtime};delete (runtime as Partial<typeof runtime>).battleChildPartyAdmission;const game=new GameSession(f.field,f.catalog,1,runtime);game.advance(0);assert(game.field.startEvent('fight'));game.advance(10);assert.throws(()=>game.prepareBattleStart()!.commit(),/matching content and actual runtime/);
 const plan=structuredClone(f.catalog.encounters[1000]!.childPartyAdmission!);(plan as unknown as Record<string,unknown>).extra=true;assert.throws(()=>parseBattleChildAdmission(plan),/checkpoint|fields|key/i);
 const bad=structuredClone(f.catalog.encounters[1000]!.childPartyAdmission!);bad.entries[501]!.flagRows[0]!.flagId=3;assert.throws(()=>parseBattleChildAdmission(bad),/cannot be ready/);
 const changed=structuredClone(f.catalog.encounters[1000]!.childPartyAdmission!);changed.entries[501]!.slots[3]!.x++;assert.throws(()=>prepareBattleChildParty(changed,501,f.catalog.encounters[1000]!.participants!),/Changed prepared/);
});

test('missing an entire v9 plan or dropping its source gates is rejected by the independent consumer',()=>{
 for(const options of [{flags:[14,19]},{flags:[14,19,3]}]){const f=family(options),catalog=structuredClone(f.after.encounters);delete catalog[9201]!.childPartyAdmission;
  assert.throws(()=>validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION,encounters:catalog,diagnostics:f.after.diagnostics,entryScriptGroups:f.entryScriptGroups()}),/Missing bound/);}
});
test('the new exact directory declaration cannot be supplied to any unchanged legacy version',async()=>{
 const {readFile}=await import('node:fs/promises'),{resolve}=await import('node:path'),{pathToFileURL,fileURLToPath}=await import('node:url'),
 api=await import(pathToFileURL(resolve('scripts/source-battle-directory.mjs')).href),compiledDir=fileURLToPath(new URL('../',import.meta.url)),v9=JSON.parse(await readFile('content-batches/source-battle-child-admission.policy.json','utf8'));
 assert.equal((await api.readSourceBattleDirectoryPolicy({compiledDir,policy:v9})).framework.childPartyAdmission,WEB_BATTLE_CHILD_ADMISSION);
 for(const change of [(p:typeof v9)=>{p.kind='source-battle-directory-policy-v8';},(p:typeof v9)=>{delete p.framework.childPartyAdmission;},(p:typeof v9)=>{p.framework.childPartyAdmission='unknown';},(p:typeof v9)=>{p.framework.extra=true;}]){const bad=structuredClone(v9);change(bad);await assert.rejects(api.readSourceBattleDirectoryPolicy({compiledDir,policy:bad}));}
});
test('the actual child resource lease can fail, retry and retire without changing the old units or double returning',()=>{
 const f=session(authored([{kind:'gau-replace'},{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}])),owned=f.game.state.snapshot();
 f.setMediaReady(false);f.flow.advance(10,ready);const units=structuredClone(f.battle.combatants);f.flow.advance(100,ready);assert.deepEqual(f.battle.combatants,units);assert.deepEqual(f.game.state.snapshot(),owned);
 f.setMediaValid(false);assert.throws(()=>f.flow.advance(10,ready),/Gau media|invalid Gau/);assert.deepEqual(f.battle.combatants,units);assert.deepEqual(f.game.state.snapshot(),owned);
 f.setMediaReady(true);f.setMediaValid(true);f.flow.advance(50,ready);assert.equal(f.battle.phase,'forced');assert.notDeepEqual(f.battle.enemies.map(e=>e.id),units.filter(e=>e.side==='enemy').map(e=>e.id));
 const cancelled=f.game.prepareBattleReturn()!;cancelled.discard();assert.deepEqual(f.game.state.snapshot(),owned);const success=f.game.prepareBattleReturn()!;assert(success.commit());assert.equal(success.commit(),false);assert.equal(f.game.state.snapshot().completedBattles.length,1);assert.throws(()=>f.battle.advance(10),/Retired/);
});
