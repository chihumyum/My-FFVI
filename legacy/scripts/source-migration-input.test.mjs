import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,canonical} from '../dist/src/compiler/content.js';
import {contentBatchDiagnosticSystem} from '../dist/src/compiler/content-batch-work-plan.js';
import {compileSourceMigrationWorkSet} from '../dist/src/compiler/source-migration-workset.js';
import {normalizeSourceMigrationInput,sourceCommonCapabilityAssignments,sourceMigrationFieldContext} from './source-migration-input.mjs';
import {decodeFieldOp} from '../dist/src/compiler/field.js';
import {parseSourceMigrationOptions} from './plan-source-migration.mjs';

// Synthetic adapter results only. Full original source is independently loaded
// by the CLI; these tests claim neither source execution nor game readiness.
function fixture(){
 const source=id=>({file:'fixture.bundle',assetPath:'/Fixture/'+id+'.json',objectId:String(id),serializedFile:'CAB-fixture',sha256:'a'.repeat(64)});
 const scripts=[{id:'field',kind:'script',source:source(1),data:{Mnemonics:[{mnemonic:'SysCall',operands:{sValues:['Shared']},reason:'first form'},{mnemonic:'SysCall',operands:{sValues:['Shared']},reason:'second form'}]}},
  {id:'ai',kind:'script',source:{...source(2),assetPath:'/MonsterAI/fixture.json'},data:{Mnemonics:[{mnemonic:'Act'}]}},
  {id:'unknown',kind:'script',source:source(3),data:{Mnemonics:[{mnemonic:'Opaque'}]}}];
 const systemSource={file:'fixture.bundle',assetPath:'/Fixture/system_zhc.txt',objectId:'9223372036854775701',sourceSetHash:'f'.repeat(64),sha256:'a'.repeat(64)};
 const sourceInputs={scripts,programs:[],input:{},sourceDigest:'b'.repeat(64),inventory:{parentSourceSetHash:'e'.repeat(64)},
  snapshot:{sourceSetHash:'c'.repeat(64),manifest:{sources:[{file:systemSource.file,sha256:systemSource.sha256}]},tables:{},messages:{}},
  analysis:{scripts:scripts.map(p=>({id:p.id,domain:p.id==='field'?'field':'not-assessed-by-field-runtime',maps:p.id==='field'?['3']:[]})),dependencies:[],maps:[{id:'3',closure:['field']},{id:'52',closure:[]}]}};
 const api={hash,canonical,contentBatchDiagnosticSystem,createFieldEmptyMessageLookup:()=>Object.freeze({fixtureOnly:true}),decodeScriptLocals:()=>({}),
  decodeFieldOp:raw=>({kind:'blocked',reason:raw.reason}),compileBattleAI:()=>({blockers:[],instructions:[{op:{kind:'act',abilities:[101,102]}}]})};
 const fieldContext=sourceMigrationFieldContext(sourceInputs,{source:systemSource,messages:{AREA:'World'}},api);
 const registry={kind:'source-common-capability-registry-v1',sourceSetHash:sourceInputs.snapshot.sourceSetHash,sourceDigest:sourceInputs.sourceDigest,completion:'unassessed',
  families:[{id:'shared-source-system',owner:'map-event-and-travel',selectors:['SysCall:Shared']}]};
 const definition=id=>({source:{id},execution:'blocked',requirements:[],blockers:['slot 2: unsupported function type 33 values 2,2,'+id]});
 const abilityContent={entries:{101:definition(101),102:definition(102)},abilities:{101:{program:{functions:[{slot:2,type:33}]}},102:{program:{functions:[{slot:2,type:33}]}}}};
 const worldAnalysis={diagnostics:[{code:'map-geometry-missing',reason:'Missing complete source geometry',mapId:52}],
  providerRequirements:[{mapId:3,capability:'partyActors',status:'conditional'}],providerAssessments:[{mapId:3,status:'conditional',diagnostics:[]}]};
 return{sourceInputs,api,registry,abilityContent,worldAnalysis,fieldContext,runtimeSha256:'d'.repeat(64)};
}
test('whole source normalization retains all domains and exact forms without a first-map or first-error filter',()=>{
 const f=fixture(),before=structuredClone(f.sourceInputs),input=normalizeSourceMigrationInput(f),work=compileSourceMigrationWorkSet(input);
 assert.equal(input.programs.length,3);assert.equal(input.programs.reduce((n,p)=>n+p.instructionCount,0),4);
 const common=input.gaps.find(g=>g.code==='shared-source-system');assert.equal(common.sites.length,2);
 assert.equal(input.observations.filter(o=>o.record.kind==='source-instruction-diagnostic').length,2);
 assert(input.gaps.some(g=>g.code==='unassessed-program-domain'&&g.owner==='unclassified'));
 assert.deepEqual(f.sourceInputs,before);assert.equal(work.playable,false);assert.equal(work.sourceCampaignComplete,false);
 assert(work.batches.every(b=>b.executionAcceptance==='missing-contract'));
  assert(input.batches.filter(b=>b.id.startsWith('source-map-closure:')).every(b=>b.scope==='complete-map'));
  assert(input.batches.filter(b=>b.id.startsWith('source-program-closure:')).every(b=>b.scope==='standalone-program'));
});
test('planning uses the production Field message context while retaining unknown instructions and the original corpus digest',()=>{
 const f=fixture(),raw={type:1,mnemonic:'ShowMapTitle',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:['AREA',...Array(7).fill('')]}};
 f.sourceInputs.scripts[0].data.Mnemonics=[raw,{...raw,mnemonic:'UnknownSourceInstruction'}];
 f.api.decodeFieldOp=decodeFieldOp;delete f.api.createFieldEmptyMessageLookup;f.api.createFieldEmptyMessageLookup=()=>null;
 const before=canonical(f.sourceInputs),input=normalizeSourceMigrationInput(f);
 const diagnostics=input.observations.filter(o=>o.record.kind==='source-instruction-diagnostic'&&o.programIds.includes('field'));
 assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].record.selector,'UnknownSourceInstruction');
 assert.equal(input.sourceDigest,f.sourceInputs.sourceDigest);assert.equal(canonical(f.sourceInputs),before);
 const binding=input.observations.find(o=>o.scopeId==='field-decode-context').record;
 assert.equal(binding.systemMessageHash,hash({AREA:'World'}));assert.equal(binding.systemMessageSource.objectId,'9223372036854775701');
 assert.equal(decodeFieldOp(raw,{script:'field',index:0,source:f.sourceInputs.scripts[0].source},{}).kind,'blocked','base scenario messages alone reproduce the old false gap');
});
test('missing, foreign, altered or conflicting decode context fails before producing a misleading full-source queue',()=>{
 const f=fixture();assert.throws(()=>normalizeSourceMigrationInput({...f,fieldContext:undefined}),/Complete Field/);
 for(const key of ['sourceDigest','sourceSetHash','parentSourceSetHash','systemMessageHash']){
  const changed=structuredClone(f.fieldContext);changed[key]='0'.repeat(64);
  assert.throws(()=>normalizeSourceMigrationInput({...f,fieldContext:changed}),/context binding/);
 }
 const foreign=structuredClone(f.fieldContext);foreign.systemMessageSource.sha256='0'.repeat(64);
 assert.throws(()=>normalizeSourceMigrationInput({...f,fieldContext:foreign}),/Foreign system/);
 assert.throws(()=>sourceMigrationFieldContext(f.sourceInputs,{source:f.fieldContext.systemMessageSource,messages:{}},f.api),/Incomplete/);
 f.sourceInputs.snapshot.messages.system_zhc={AREA:'Other'};
 assert.throws(()=>normalizeSourceMigrationInput(f),/Conflicting/);
});
test('actual source slot identity and repeated AI references share one function task while retaining each reason',()=>{
 const input=normalizeSourceMigrationInput(fixture()),family=input.gaps.filter(g=>g.code==='battle-ability-function:33');
 assert.equal(family.length,1);assert.equal(family[0].sites.length,1);assert.equal(family[0].sites[0].programId,'ai');
 assert.equal(input.observations.filter(o=>o.scopeId.startsWith('ability-blocker:')).length,2);
 const wrong=fixture();wrong.abilityContent.abilities[101].program.functions[0].slot=1;
 assert.throws(()=>normalizeSourceMigrationInput(wrong),/Diagnostic\/function binding changed/);
});
test('map-only deficiencies retain the original record and conditional providers never become missing implementation claims',()=>{
 const input=normalizeSourceMigrationInput(fixture()),gap=input.gaps.find(g=>g.code==='world:map-geometry-missing');
 assert.deepEqual(gap.sites,[{kind:'dependency',scopeId:'world-diagnostic:0',mapIds:[52],record:{code:'map-geometry-missing',reason:'Missing complete source geometry',mapId:52}}]);
 assert(!Object.hasOwn(gap.sites[0],'programId'));assert.equal(input.observations.filter(o=>o.scopeId.startsWith('world-provider-')).length,2);
 assert(!input.gaps.some(g=>g.reason.includes('partyActors')));
});
test('assignment drift, ambiguous selectors and incomplete CLI scopes cannot silently narrow planning',()=>{
 const f=fixture(),binding={sourceSetHash:f.registry.sourceSetHash,sourceDigest:f.registry.sourceDigest};
 assert.doesNotThrow(()=>sourceCommonCapabilityAssignments(f.registry,binding));
 assert.throws(()=>sourceCommonCapabilityAssignments({...f.registry,sourceDigest:'e'.repeat(64)},binding),/./);
 const duplicate=structuredClone(f.registry);duplicate.families.push({id:'other',owner:'unclassified',selectors:['SysCall:Shared']});
 assert.throws(()=>sourceCommonCapabilityAssignments(duplicate,{sourceSetHash:f.registry.sourceSetHash,sourceDigest:f.registry.sourceDigest}),/Ambiguous capability/);
 assert.throws(()=>parseSourceMigrationOptions(['--source-root','fixture']),/complete frozen source/);
 assert.throws(()=>parseSourceMigrationOptions(['--source-root','a','--candidate-dir','b','--battle-audit','c','--parallelism','0']),/Invalid parallelism/);
});
