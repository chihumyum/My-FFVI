// One physical source load; full bodies and dependencies remain distinct from
// controlled Session execution. This script does not produce any maps.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy} from './source-battle-directory.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),o={inputRoot:root,compiledDir:'dist',beforeCompiledDir:null,baselineGameDir:null,output:'build/reports/source-moogles-roster-groups'},args=process.argv.slice(2),seen=new Set(),flags={'--input-root':'inputRoot','--compiled-dir':'compiledDir','--before-compiled-dir':'beforeCompiledDir','--baseline-game-dir':'baselineGameDir','--output':'output'};
while(args.length){const key=args.shift();assert(Object.hasOwn(flags,key)&&args[0]&&!seen.has(key),'Unknown or repeated argument '+key);seen.add(key);o[flags[key]]=args.shift();}
assert(o.beforeCompiledDir&&o.baselineGameDir,'Exact compiled before and current27 Game baseline are required');
const dist=resolve(root,o.compiledDir),beforeDist=resolve(root,o.beforeCompiledDir),inputRoot=resolve(root,o.inputRoot),gameDir=resolve(root,o.baselineGameDir),out=resolve(root,o.output);assert(out.startsWith(resolve(root,'build')+'/'));
const sha=b=>createHash('sha256').update(b).digest('hex'),load=(base,n)=>import(pathToFileURL(resolve(base,'src',n+'.js')).href),modules=['compiler/field','compiler/roster-selectors','compiler/roster','compiler/field-puppet-replacement','compiler/source-party-selection','compiler/field-party-queries','compiler/roster-groups','compiler/owned-character','compiler/ordinary-weapon','compiler/character-growth','compiler/character-learning','compiler/source-catalog-name','compiler/battle-event','core/game-state','core/roster-groups'];
const api=Object.assign({},...await Promise.all(modules.map(n=>load(dist,n)))),old=Object.assign({},...await Promise.all(modules.filter(n=>!n.endsWith('/roster-groups')).map(n=>load(beforeDist,n))));
const runtime=await runtimeDigest(root,dist),policyBytes=await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')),policy=await readSourceBattleDirectoryPolicy({root:inputRoot,compiledDir:dist,policy:JSON.parse(policyBytes)});
assert.equal(policy.kind,'source-battle-directory-policy-v9');assert(policy.framework.gauInstances&&policy.framework.childPartyAdmission,'Complete current Gau/Child policy must remain declared');
const selection={branchExecution:policy.framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:policy.framework.gauInstances},input=await loadBattleEventMessageSourceInputs(inputRoot,dist,selection),s=input.snapshot,{canonical,hash}=input.api;
assert.equal(input.scripts.length,3304);assert.equal(input.inventory.counts.allInstructions,186003);assert.equal(input.programs.length,53);assert.equal(input.inventory.counts.instructions,2312);assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.encounters.length,483);assert.equal(input.dependencies.diagnostics.length,7);
const mediaBytes=await readFile(resolve(inputRoot,'build/battle/battle.json')),media=JSON.parse(mediaBytes);assert.equal(sha(mediaBytes),'f7d9f431b6169d4bc60ee83e3c5f80bbcd69425bf02ed8ee8aaa7fc7a719e462');assert.equal(media.sourceSetHash,'bafa2b0f29fde044757092e7e1518fb6a34a5daa508495460342873062e01180');assert.equal(media.characterIds.length,27);
const project=(owner,raw,site)=>{try{return owner.decodeFieldOp(raw,site,s.messages,s.tables);}catch(e){return{kind:'static-field-decode-error',error:{name:e.name,message:e.message},raw};}};
const partyMnemonics=new Set(['OrganizePartySlot','ChangePartySlot',...api.fieldPartyQueryMnemonics]),calls=[],stateCalls=[],programs=[],sites=[],allProgramBindings=[];
for(const p of input.scripts){let selected=false,grouped=false;const before=[],after=[];
 for(const[pc,raw]of p.data.Mnemonics.entries()){
  const site={script:p.id,index:pc,source:{...p.source,pointer:'/Mnemonics/'+pc}},b=project(old,raw,site),a=project(api,raw,site),selector=raw.mnemonic==='SysCall'?raw.operands?.sValues?.[0]:null;
  const category=partyMnemonics.has(raw.mnemonic)?'party-instruction':api.sourcePartySelectionSelectors.includes(selector)?'party-selection':api.rosterNativeSelectors[selector]?'roster':/^パペット入れ替え：/.test(selector??'')?'puppet-replacement':/^RTS[：:]/.test(selector??'')?'rts':null;
  const row={programId:p.id,source:site.source,pc,selector,category,raw,before:b,after:a};
  if(api.rosterGroupSelectors.includes(selector)){assert.equal(b.kind,'blocked');assert.equal(a.kind,'roster-group');sites.push(row);grouped=true;}
  else assert.equal(canonical(b),canonical(a),'Unrelated full-source lowering changed '+p.id+':'+pc);
  if(category){calls.push(row);selected=true;}if(['AddCondition','RemoveCondition','RecoveryHP','RecoveryMP'].includes(raw.mnemonic))stateCalls.push(row);
  before.push(b);after.push(a);
 }
 allProgramBindings.push({id:p.id,source:p.source,rawHash:hash(p.data),instructions:p.data.Mnemonics.length,beforeProjectionHash:hash(before),afterProjectionHash:hash(after)});
 if(selected)programs.push({...p,rawHash:hash(p.data),beforeProjection:before,afterProjection:after,grouped});
}
assert.equal(calls.length,595);assert.equal(stateCalls.length,550);assert.equal(programs.length,235);assert.equal(programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),31249);assert.equal(sites.length,2);assert.equal(programs.filter(p=>p.grouped).reduce((n,p)=>n+p.data.Mnemonics.length,0),271);
const special=calls.filter(r=>r.category==='roster'&&api.rosterNativeSelectors[r.selector]?.gate);
assert.equal(special.length,17);assert.equal(new Set(special.map(r=>r.selector)).size,5);
const specialIds=new Set(special.map(r=>r.programId)),specialBodies=input.scripts.filter(p=>specialIds.has(p.id));assert.equal(specialBodies.length,11);assert.equal(specialBodies.reduce((n,p)=>n+p.data.Mnemonics.length,0),1512);
const npcCalls=calls.filter(r=>api.sourcePuppetReplacementSelectors.slice(9).includes(r.selector)),rtsCalls=calls.filter(r=>r.category==='rts');assert.equal(npcCalls.length,12);assert.equal(rtsCalls.length,58);assert.equal(special.filter(r=>r.after.kind==='blocked').length,15);assert.equal(special.filter(r=>r.after.kind==='roster-group').length,2);
const ids=new Set(programs.map(p=>p.id)),maps=input.analysis.maps.filter(m=>m.scripts.some(id=>ids.has(id))||m.closure.some(id=>ids.has(id))),assetIds=new Set(maps.flatMap(m=>[m.packageId,...Object.values(m.groups),...m.closure]));assert.equal(maps.length,97);assert.equal(assetIds.size,1633);
for(const p of input.programs){const source=p.battleExportBinding.kind==='exact-battle-export-source-binding-v1'?p.battleExportBinding.source:null;
 const b=old.compileBattleEvent(p.data,source,input.input,s.reader,selection.branchExecution,source?input.sourceFormatImport({data:p.data,source}):undefined,selection.gauInstancePolicy);
 assert.equal(canonical(b),canonical(p.compiled),'Unrelated complete Battle program changed '+p.id);
}
const singleton=name=>{const rows=s.assets.filter(a=>a.source.assetPath.endsWith('/'+name+'.json'));assert.equal(rows.length,1);return rows[0];},extra=singleton('battle_extra_data'),misc=singleton('serial_misc_assets'),effects=api.compileOrdinaryWeaponEffects(s.reader,extra.data),observed=api.compileObservedLearning(s.reader,s.tables,misc.data).catalog,name=api.createSourceCatalogNameResolver(input.input),templates=[];
for(const row of s.tables['character_status.csv']){const id=Number(row.id),results=[];for(const owner of[old,api]){let initialization=null,growth=null,error=null;try{initialization=owner.compileOwnedCharacterInitialization(s.reader,s.tables,id,name,effects.catalog,'source-equipment-state-v2');growth=owner.compileCharacterGrowth(s.reader,s.tables,initialization.template,observed);}catch(e){error=e.message;}results.push({initialization,growth,error});}assert.equal(canonical(results[0]),canonical(results[1]),'Changed complete initialization/growth '+id);templates.push({source:s.reader.row('character_status.csv',id),sourceId:id,...results[1]});}
assert.equal(templates.length,34);const ready=templates.filter(x=>x.initialization&&x.growth&&!x.error);assert.equal(ready.length,27);assert.equal(templates.length-ready.length,7);
const fresh=[];
// A joint capability build may also carry the independently source-backed
// EnemyCharacterParameter factory metadata. Admit only that exact additive
// field on actual encounter definitions; keep every other byte of the
// normalized Game body subject to the original comparison.
let enemyMpCompiler;
const stripVerifiedAddedEnemyMp=async(current,baseline,file)=>{
 const additions=[];
 const check=async(value,prior,path)=>{
  if(!value||!prior||Object.hasOwn(prior,'mpParameter')||!Object.hasOwn(value,'mpParameter'))return;
  assert.equal(value.sourceId,prior.sourceId,'Changed enemy identity '+path);
  enemyMpCompiler??=(await load(dist,'compiler/source-enemy-mp-parameter')).compileSourceEnemyMpParameter;
  const expected=enemyMpCompiler(s.reader,value.sourceId).metadata;
  assert.equal(canonical(value.mpParameter),canonical(expected),'Unbound added enemy MP metadata '+path);
  additions.push({path,sourceId:value.sourceId,metadata:expected});delete value.mpParameter;
 };
 for(const[id,encounter]of Object.entries(current.encounters??{})){
  const prior=baseline.encounters?.[id];if(!prior)continue;
  for(const[index,enemy]of(encounter.enemies??[]).entries())await check(enemy,prior.enemies?.[index],'/encounters/'+id+'/enemies/'+index);
  for(const[id,enemy]of Object.entries(encounter.participants?.enemyDefinitions??{}))await check(enemy,prior.participants?.enemyDefinitions?.[id],'/encounters/'+id+'/participants/enemyDefinitions/'+id);
 }
 return{file,additions};
};
for(const file of['source-catalog.json','opening-playable.json']){
 const bytes=await readFile(resolve(gameDir,file)),aBytes=await readFile(resolve(root,'build/game',file)),b=JSON.parse(bytes),a=JSON.parse(aBytes);
 assert.equal(sha(bytes),file==='source-catalog.json'?'7e73e03c25da0492300e9dd2688991db22e4578b3d77efaef521075030d2c5dc':'e977b835044f97db07fc0cf825b450ac82c33810daacad5118cd82b79c25fbcf');
 const{contentHash,...body}=a;assert.equal(hash(body),contentHash);assert.equal(Object.keys(a.gameState.characterInitializations).length,27);assert.equal(a.gameState.battleDefinitions.length,27);
 const stripped=structuredClone(a);delete stripped.gameState.sourceRosterGroups;delete stripped.contentHash;const oldBody=structuredClone(b);delete oldBody.contentHash;const admittedEnemyMp=await stripVerifiedAddedEnemyMp(stripped,oldBody,file);assert.equal(canonical(stripped),canonical(oldBody),'Fresh current27 compiler changed unrelated Game/source initialization');
 api.validateSourceRosterGroupCatalog(a.gameState.sourceRosterGroups);assert.deepEqual(a.common.players.map(p=>p.id),['player:1','player:31','player:32']);assert.equal(canonical(a.gameState.sourceNewGame),canonical(b.gameState.sourceNewGame),'Original three characters and inline equipment changed');
 fresh.push({file,baselineSha256:sha(bytes),baselineContentHash:b.contentHash,afterSha256:sha(aBytes),afterContentHash:a.contentHash,onlyNewOwnedField:'sourceRosterGroups',admittedEnemyMp,originalThreeAndInlineEquipmentUnchanged:true});
}
const actual=JSON.parse(await readFile(resolve(root,'build/game/source-catalog.json'),'utf8')),state=api.GameState.createNewGame(actual.gameState,actual.common.players,hash(actual.gameState),actual.common.conditions),initial=state.snapshot();
state.fieldRoster.prepare(api.compileRosterLifecycleEvent('メンバー加入：ロック',s.tables).command).commit();const beforeGroup=state.snapshot(),failed=state.fieldRoster.prepareGroup({kind:'join',group:'moogles'});assert.throws(()=>failed.commitWith(()=>{throw new Error('Controlled actual-data group publication failure');}),/publication failure/);assert.equal(canonical(state.snapshot()),canonical(beforeGroup));
const tx=state.fieldRoster.prepareGroup({kind:'join',group:'moogles'}),joinOrder=tx.steps.map(s=>s.sourceId);tx.commitWith(validate=>validate());assert.equal(tx.steps.length,11);const joined=state.snapshot(),stock=canonical(joined.equipmentStock),names=canonical(joined.characterNames);state.fieldRoster.prepareGroup({kind:'join',group:'moogles'}).commitWith(validate=>validate());assert.equal(canonical(state.snapshot().equipmentStock),stock);assert.equal(canonical(state.snapshot().characterNames),names);
const leave=state.fieldRoster.prepareGroup({kind:'secede',group:'moogles'}),leaveOrder=leave.steps.map(s=>s.sourceId);leave.commitWith(validate=>validate());const left=state.snapshot();assert.equal(leaveOrder.length,12);const restored=api.GameState.createNewGame(actual.gameState,actual.common.players,hash(actual.gameState),actual.common.conditions);restored.restore(JSON.parse(JSON.stringify(left)));assert.equal(canonical(restored.snapshot()),canonical(left));
const result={kind:'whole-source-roster-groups-audit-v1',result:'passed-static-full-source-and-actual-data-state-probe',runtimeSha256:runtime,sourceDigest:input.sourceDigest,sourceSetHash:s.sourceSetHash,sourcePolicy:{sha256:sha(policyBytes),declaration:policy,selection},media:{sha256:sha(mediaBytes),sourceSetHash:media.sourceSetHash,characterIds:media.characterIds},fresh,
 counts:{allPrograms:3304,allInstructions:186003,maps:649,workspaceCalls:595,workspaceBodies:235,workspaceInstructions:31249,workspaceMaps:97,workspaceAssets:1633,recoveryContextCalls:550,specialCalls:17,specialSelectors:5,specialBodies:11,specialBodyInstructions:1512,newGroupCalls:2,retainedSpecialGates:15,npcDictionaryGates:12,rtsGates:58,groupBodies:2,groupBodyInstructions:271,characterTemplates:34,readyTemplates:27,retainedTemplateGates:7,battlePrograms:53,battleInstructions:2312,requestedParties:490,sourceDescriptors:483,sourceDiagnostics:7},
 sites,special,completeSpecialBodies:specialBodies,npcCalls,rtsCalls,calls,stateCalls,completeWorkspacePrograms:programs,completeMapClosures:maps,completeDependentAssets:s.assets.filter(a=>assetIds.has(a.id)),allProgramBindings,templates,groupDefinition:api.compileSourceRosterGroups(s.tables),sourceTables:s.tables,completeBattlePrograms:input.programs,completeBattleDependencies:input.dependencies,
 actualDataStateProbe:{initialSourceIds:initial.roster.map(x=>x.sourceId),beforeGroup,joinOrder,joined,leaveOrder,left,rollback:true,repeatWithoutRegrant:true,restored:true,fieldPublication:false,sourceStoryExecuted:false},
 scope:{sourceStoryBodiesExecuted:0,sourceStoryReachability:false,actualSessionLifecycle:'separate real Session synthetic media tests',nativeDynamicParity:false,worldCompilations:0,publications:0,newNativeExports:0}};
assert.equal(await runtimeDigest(root,dist),runtime);await mkdir(out,{recursive:true});const file=resolve(out,'inventory.json'),bytes=Buffer.from(JSON.stringify(result)+'\n');await writeFile(file,bytes);const report={kind:result.kind,result:result.result,runtimeSha256:runtime,sourceDigest:input.sourceDigest,counts:result.counts,fresh,media:result.media,artifact:{file,sha256:sha(bytes),bytes:bytes.length},scope:result.scope};await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
