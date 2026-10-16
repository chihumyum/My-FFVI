import test from 'node:test';import assert from 'node:assert/strict';
import {sourceParticipantFixture,dynamicSourcePolicy} from './fixtures/source-battle-participants.js';
import {compileSourceBattleParticipantClosure,validateSourceBattleParticipantProof} from '../src/compiler/source-battle-participant-closure.js';
import {compileBattleEncounterRuntime} from '../src/compiler/battle-encounter-runtime.js';
import {WEB_BATTLE_CHILD_ADMISSION} from '../src/core/battle-child-admission.js';
import {WEB_BATTLE_PARTY_CONTEXT} from '../src/core/battle-party-context.js';
import {WEB_BATTLE_BRANCH_EXECUTION} from '../src/core/battle-branch-execution.js';
import {WEB_MANUAL_BATTLE_CONTROLS} from '../src/core/battle-controls.js';
function fixture(){
 const f=sourceParticipantFixture({child:true}),sources={...f.sources,json(name:string){const r=f.sources.json(name);r.source.sourceSetHash='a'.repeat(64);return r;},spritePath(suffix:string){return suffix==='/controlled_enemy.png'?'Assets/Controlled/controlled_enemy.png':f.sources.spritePath(suffix);}};
 Object.assign(f.input.sprites,{'Assets/Controlled/controlled_enemy.png':structuredClone(f.input.sprites['synthetic-enemy']!)});
 const closure=compileSourceBattleParticipantClosure(f.reader(),{policy:dynamicSourcePolicy,encounters:f.input.encounters,sources,branchExecution:WEB_BATTLE_BRANCH_EXECUTION});
 const input={...f.input,branchExecution:WEB_BATTLE_BRANCH_EXECUTION,manualControls:WEB_MANUAL_BATTLE_CONTROLS,sourceFlagContext:'story' as const,reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,sourceDiagnostics:[...f.input.sourceDiagnostics,...closure.diagnostics],development:{...f.input.development,participants:closure.participants},childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION,partyContext:WEB_BATTLE_PARTY_CONTEXT};
 return {...f,closure,input};
}
test('the compiler binds complete rows and the independent participant consumer rejects changed current reward facts',()=>{
 const f=fixture(),result=compileBattleEncounterRuntime(f.reader(),f.input),e=result.encounters[9201];assert(e,JSON.stringify(result.diagnostics));assert(e.partyContext);assert.equal(Object.keys(e.partyContext.entries).length,2);
 const validate=()=>validateSourceBattleParticipantProof(dynamicSourcePolicy,f.closure.report,{childPartyAdmission:WEB_BATTLE_CHILD_ADMISSION,partyContext:WEB_BATTLE_PARTY_CONTEXT,encounters:result.encounters,diagnostics:result.diagnostics,entryScriptGroups:f.entryScriptGroups()});validate();
 e.partyContext.entries[513]!.getValue++;assert.throws(validate,/Changed complete current child descriptor proof/);e.partyContext.entries[513]!.getValue--;
 e.partyContext.entries[9201]!.bgmId++;assert.throws(validate,/Changed battle party descriptor battle_bgm_asset_id/);
});
test('source row and supplied descriptor mutations remain hard, rather than granting an inferred current descriptor',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.input.encounters[0]!.source.objectId='90071992547409941';},(f:ReturnType<typeof fixture>)=>{f.input.enemyParties[0]!.encounter.metadata.getValue++;},(f:ReturnType<typeof fixture>)=>{f.input.encounters[0]!.patterns[0]=0;}]){
  const f=fixture();change(f);const r=compileBattleEncounterRuntime(f.reader(),f.input);assert.equal(r.encounters[9201],undefined);assert(r.diagnostics.some(d=>d.kind==='blocked'&&d.code==='encounter-provider'));
 }
});
test('v10 context policy is opt-in and cannot leak into unchanged legacy directory contracts',async()=>{
 const {readFile}=await import('node:fs/promises'),{resolve}=await import('node:path'),{pathToFileURL,fileURLToPath}=await import('node:url'),api=await import(pathToFileURL(resolve('scripts/source-battle-directory.mjs')).href),compiledDir=fileURLToPath(new URL('../',import.meta.url)),policy=JSON.parse(await readFile('content-batches/source-battle-party-context.policy.json','utf8'));
 assert.equal((await api.readSourceBattleDirectoryPolicy({compiledDir,policy})).framework.partyContext,WEB_BATTLE_PARTY_CONTEXT);
 for(const mutate of [(p:typeof policy)=>{p.kind='source-battle-directory-policy-v9';},(p:typeof policy)=>{delete p.framework.partyContext;},(p:typeof policy)=>{p.framework.partyContext='unknown';}]){const p=structuredClone(policy);mutate(p);await assert.rejects(api.readSourceBattleDirectoryPolicy({compiledDir,policy:p}));}
});
