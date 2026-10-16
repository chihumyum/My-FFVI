import {compileBattleGauInstances} from "../src/compiler/battle-gau-instances.js";
import test from 'node:test';import assert from 'node:assert/strict';
import {sourceParticipantFixture,dynamicSourcePolicy} from './fixtures/source-battle-participants.js';
import {compileSourceBattleParticipantClosure,validateSourceBattleParticipantProof} from '../src/compiler/source-battle-participant-closure.js';
import {compileBattleEncounterRuntime} from '../src/compiler/battle-encounter-runtime.js';
import {WEB_BATTLE_GAU_INSTANCES} from '../src/core/battle-gau-instances.js';
import {validateInitializedBattleSharedCapabilities} from '../src/compiler/initialized-battle-binding.js';
import {checkpointFixture} from './fixtures/checkpoint-game.js';
import {gauSessionFixture} from './fixtures/battle-gau-instances.js';
import {hash} from '../src/compiler/content.js';
function source(){
 const f=sourceParticipantFixture(),row=f.tables['monster_party.csv']![2]!;
 f.tables['monster_party.csv']!.push({...row,id:'522'},{...row,id:'523'});
 const raw=f.input.encounters[0]!.script!.data as {Mnemonics:{mnemonic:string;type:number;operands:{iValues:number[];rValues:number[];sValues:string[]}}[]};
 raw.Mnemonics[0]={mnemonic:'SysCall',type:1,operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:['敵パーティをガウに',...Array(7).fill('')]}};
 const closure=compileSourceBattleParticipantClosure(f.reader(),{policy:dynamicSourcePolicy,encounters:f.input.encounters,sources:f.sources,gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES});
 const gau=gauSessionFixture();f.tables['character_status.csv']=[{id:'101',character_asset_id:'201',job_id:'7'}];f.tables['job.csv']=[{id:'7'}];
 Object.assign(f.input.sprites,gau.catalog.common.sprites);
 const facts=compileBattleGauInstances(f.reader(),{misc:{source:{file:'controlled.bundle',assetPath:'Assets/Misc/serial_misc_assets.json',objectId:'1',serializedFile:'controlled',sha256:'a'.repeat(64)},data:{animation_enemy_params:[{monster_id:9103,character_status_id:101,character_status_job_id:7,weapon_id:1}]}},actors:{101:gau.actor}});
 const proof={...facts,appearance:{catalog:gau.catalog.common.battleAppearance!,actors:{101:gau.actor},blockers:[]}};
 const runtime=compileBattleEncounterRuntime(f.reader(),{...f.input,gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES,gauInstanceContent:facts.catalog,reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,
  sourceDiagnostics:[...f.input.sourceDiagnostics,...closure.diagnostics],development:{...f.input.development,participants:closure.participants}});
 return {...f,closure,runtime,proof};
}
test('the Gau cohort resolves both complete native-selected child parties through the same source participant compiler and preserves all nine slots',()=>{
 const f=source();assert.equal(f.closure.diagnostics.length,0);assert.deepEqual(f.closure.enemyParties.map(row=>row.encounter.partyId),[522,523]);
 assert.equal(f.closure.report.kind,'source-battle-participant-closure-v2');assert.deepEqual(Object.keys(f.runtime.encounters[9201]!.participants!.enemyParties!),['522','523']);
 assert.equal(f.runtime.encounters[9201]!.gauInstancePolicy,WEB_BATTLE_GAU_INSTANCES);assert.equal(f.runtime.encounters[9202]!.gauInstancePolicy,undefined);
 assert.equal(Object.keys(f.runtime.encounters[9201]!.participants!.enemyParties![523]!.slots).length,9);
 validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES,encounters:f.runtime.encounters,diagnostics:f.runtime.diagnostics,entryScriptGroups:f.entryScriptGroups()});
 const strict=compileBattleEncounterRuntime(f.reader(),f.input);assert.equal(strict.encounters[9201],undefined);assert(strict.diagnostics.some(row=>row.code==='battle-script'));
 for(const change of [(c:typeof f.closure)=>{c.report.bindings[0]!.children=[];},(c:typeof f.closure)=>{c.report.bindings[0]!.childSourceRows=[];},(c:typeof f.closure)=>{delete c.report.gauInstancePolicy;}]){
  const changed=structuredClone(f.closure);change(changed);assert.throws(()=>validateSourceBattleParticipantProof(dynamicSourcePolicy,changed.report,{gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES,encounters:f.runtime.encounters,diagnostics:f.runtime.diagnostics,entryScriptGroups:f.entryScriptGroups()}));
 }
 assert.throws(()=>validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{encounters:f.runtime.encounters,diagnostics:f.runtime.diagnostics,entryScriptGroups:f.entryScriptGroups()}));
});
test('the initialized v8 consumer requires the exact dual declaration and complete v2 source proof while preserving all owned/shared facts',()=>{
 const f=source(),base=checkpointFixture().battle;base.common.battleAppearance=f.proof.appearance.catalog;Object.assign(base.common.sprites,f.input.sprites);
 const catalog=structuredClone(base);catalog.encounters=f.runtime.encounters;catalog.encounterDiagnostics=f.runtime.diagnostics;
 const condition={kind:'web-source-control-actions-v1' as const};catalog.common.conditionControlPolicy=condition;
 const report={policy:{kind:'source-battle-directory-policy-v8',framework:{handoff:null,entry:null,conditionControlPolicy:condition,
  manualControls:'web-manual-battle-controls-v1',branchExecution:'web-source-battle-branch-execution-v1',sourceParticipants:dynamicSourcePolicy,
  forcedSavePolicy:{kind:'web-source-battle-forced-save-v1'},spawnConditionPolicy:{kind:'web-source-enemy-spawn-conditions-v1'},gauInstances:WEB_BATTLE_GAU_INSTANCES}},
  sourceGauFactory:f.proof,entryDependencies:{scripts:f.entryScriptGroups()},sourceParticipantClosure:f.closure.report,
  policyChanges:[{kind:'framework-condition-policy-binding-v1',field:'common.conditionControlPolicy',from:null,to:condition,
    beforeCommonHash:hash(base.common),afterCommonHash:hash(catalog.common),beforeGameStateHash:hash(base.gameState),afterGameStateHash:hash(catalog.gameState),beforeCommon:base.common,afterCommon:catalog.common}]};
 // A source Gau replacement also requires the declared late spawn owner.
 catalog.encounters[9201]!.spawnConditionPolicy={kind:'web-source-enemy-spawn-conditions-v1'};
 validateInitializedBattleSharedCapabilities(base,catalog,report);
 for(const change of [(r:typeof report)=>{r.policy.kind='source-battle-directory-policy-v7';},(r:typeof report)=>{r.policy.framework.gauInstances='unknown' as never;},(r:typeof report)=>{r.sourceParticipantClosure.bindings=[];}]){
  const changed=structuredClone(report);change(changed);assert.throws(()=>validateInitializedBattleSharedCapabilities(base,catalog,changed));
 }
 const changed=structuredClone(catalog);delete changed.encounters[9201]!.gauInstancePolicy;assert.throws(()=>validateInitializedBattleSharedCapabilities(base,changed,report));
});
test('unavailable source child descriptors remain blocked while complete original party rows and v2 proof survive',()=>{
 const f=source(),sources={...f.sources,json(){throw new Error('controlled missing child AI asset');}};
 const c=compileSourceBattleParticipantClosure(f.reader(),{policy:dynamicSourcePolicy,encounters:f.input.encounters,sources,gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES});
 assert.equal(c.enemyParties.length,0);assert(c.diagnostics.length);assert.equal((c.report.bindings[0]!.childSourceRows as unknown[]).length,2);
 const runtime=compileBattleEncounterRuntime(f.reader(),{...f.input,gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES,sourceDiagnostics:[...f.input.sourceDiagnostics,...c.diagnostics],
  reserveEnemies:c.reserveEnemies,enemyParties:c.enemyParties,development:{...f.input.development,participants:c.participants}});
 assert.equal(runtime.encounters[9201],undefined);validateSourceBattleParticipantProof(dynamicSourcePolicy,c.report,{gauInstancePolicy:WEB_BATTLE_GAU_INSTANCES,encounters:runtime.encounters,diagnostics:runtime.diagnostics,entryScriptGroups:f.entryScriptGroups()});
});

import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
test('v8 factory declaration is separate opt-in and cannot be smuggled into any unchanged legacy directory shape',async()=>{
 const compiledDir=fileURLToPath(new URL('../',import.meta.url)),api=await import(pathToFileURL(resolve('scripts/source-battle-directory.mjs')).href),
 v7=JSON.parse(await readFile('content-batches/source-battle-directory.policy.json','utf8')),v8=JSON.parse(await readFile('content-batches/source-battle-gau-instances.policy.json','utf8'));
 assert.equal(v7.kind,'source-battle-directory-policy-v7');assert.equal(v7.framework.gauInstances,undefined);
 assert.equal((await api.readSourceBattleDirectoryPolicy({compiledDir,policy:v8})).framework.gauInstances,WEB_BATTLE_GAU_INSTANCES);
 for(const change of [(p:typeof v8)=>{p.kind='source-battle-directory-policy-v7';},(p:typeof v8)=>{delete p.framework.gauInstances;},(p:typeof v8)=>{p.framework.gauInstances='unknown';},(p:typeof v8)=>{p.framework.extra=true;}]){
  const bad=structuredClone(v8);change(bad);await assert.rejects(api.readSourceBattleDirectoryPolicy({compiledDir,policy:bad}));}
});
