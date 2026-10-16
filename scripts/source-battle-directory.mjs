// Pure whole-world battle directory. Inspection preserves blocked parties;
// only explicitly declared framework entry differences may be applied.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository=resolve(import.meta.dirname,'..');
async function modules(root,compiledDir){
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src/'+name+'.js')).href);
  return Object.assign({},...await Promise.all([
    'compiler/source-battle-requests','compiler/battle','compiler/game-catalog','compiler/system-source',
    'compiler/battle-source-format-import','compiler/battle-encounters','compiler/battle-encounter-runtime','compiler/battle-handoff','compiler/source-battle-participant-closure',
    'compiler/battle-batch-entry','compiler/content-batch-battle','compiler/integrity','compiler/content',
    'core/battle-child-admission','core/battle-gau-instances','core/battle-spawn-conditions','core/battle-forced-save','core/content-integrity','core/source-catalog','core/battle-rewards','core/battle-handoff-content',
  ].map(load)));
}
function fields(value,keys,label){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Invalid '+label);
  assert.ok([Object.prototype,null].includes(Object.getPrototypeOf(value)),'Invalid '+label+' prototype');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  assert.deepEqual(Reflect.ownKeys(value).sort(),keys.split(',').sort(),'Invalid '+label+' fields');
  assert.ok(Object.values(descriptors).every(d=>d.enumerable&&'value'in d),'Invalid '+label+' data');
}
function parsePolicy(raw,api){
  fields(raw,'kind,framework','source battle directory policy');
  assert.ok(['source-battle-directory-policy-v1','source-battle-directory-policy-v2','source-battle-directory-policy-v3','source-battle-directory-policy-v4','source-battle-directory-policy-v5','source-battle-directory-policy-v6','source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind),'Unknown source battle directory policy version');
  fields(raw.framework,raw.kind==='source-battle-directory-policy-v9'?'handoff,entry,conditionControlPolicy,manualControls,branchExecution,sourceParticipants,forcedSavePolicy,spawnConditionPolicy,gauInstances,childPartyAdmission':raw.kind==='source-battle-directory-policy-v8'?'handoff,entry,conditionControlPolicy,manualControls,branchExecution,sourceParticipants,forcedSavePolicy,spawnConditionPolicy,gauInstances':raw.kind==='source-battle-directory-policy-v7'?'handoff,entry,conditionControlPolicy,manualControls,branchExecution,sourceParticipants,forcedSavePolicy,spawnConditionPolicy':raw.kind==='source-battle-directory-policy-v6'?'handoff,entry,conditionControlPolicy,manualControls,branchExecution,sourceParticipants,forcedSavePolicy':raw.kind==='source-battle-directory-policy-v5'?'handoff,entry,conditionControlPolicy,manualControls,branchExecution,sourceParticipants':raw.kind==='source-battle-directory-policy-v4'?'handoff,entry,conditionControlPolicy,manualControls,branchExecution':raw.kind==='source-battle-directory-policy-v3'?'handoff,entry,conditionControlPolicy,manualControls':raw.kind==='source-battle-directory-policy-v2'?'handoff,entry,conditionControlPolicy':'handoff,entry','framework battle directory policy');
  const current=['source-battle-directory-policy-v3','source-battle-directory-policy-v4','source-battle-directory-policy-v5','source-battle-directory-policy-v6','source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind),manualControls=current?raw.framework.manualControls:undefined;
  const childPartyAdmission=raw.kind==='source-battle-directory-policy-v9'?api.parseWebBattleChildAdmission(raw.framework.childPartyAdmission):undefined;
  const gauInstances=['source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind)?api.parseWebBattleGauInstances(raw.framework.gauInstances):undefined;
  const spawnConditionPolicy=['source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind)?api.parseWebEnemySpawnConditions(raw.framework.spawnConditionPolicy):undefined;
  const forcedSavePolicy=['source-battle-directory-policy-v6','source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind)?api.parseWebBattleForcedSave(raw.framework.forcedSavePolicy):undefined;
  const sourceParticipants=['source-battle-directory-policy-v5','source-battle-directory-policy-v6','source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind)?api.parseSourceBattleParticipantPolicy(raw.framework.sourceParticipants):undefined;
  const branchExecution=['source-battle-directory-policy-v4','source-battle-directory-policy-v5','source-battle-directory-policy-v6','source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind)?raw.framework.branchExecution:undefined;
  if(['source-battle-directory-policy-v4','source-battle-directory-policy-v5','source-battle-directory-policy-v6','source-battle-directory-policy-v7','source-battle-directory-policy-v8','source-battle-directory-policy-v9'].includes(raw.kind))assert.equal(branchExecution,'web-source-battle-branch-execution-v1','Missing or unknown source battle branch policy');
  if(current)assert.equal(manualControls,'web-manual-battle-controls-v1','Missing or unknown manual controls policy');
  const conditionControlPolicy=raw.kind!=='source-battle-directory-policy-v1'?parseConditionControlPolicy(raw.framework.conditionControlPolicy):undefined;
  return {kind:raw.kind,framework:{handoff:api.parseBattleHandoffPolicy(raw.framework.handoff),
    entry:raw.framework.entry===null?null:api.parseBattleBatchEntryPolicy(raw.framework.entry),
    ...(conditionControlPolicy?{conditionControlPolicy}:{}),...(manualControls===undefined?{}:{manualControls}),...(branchExecution===undefined?{}:{branchExecution}),...(sourceParticipants?{sourceParticipants}:{}),...(forcedSavePolicy?{forcedSavePolicy}:{}),...(spawnConditionPolicy?{spawnConditionPolicy}:{}),...(gauInstances?{gauInstances}:{}),...(childPartyAdmission?{childPartyAdmission}:{})}};
}
function parseConditionControlPolicy(raw){
  fields(raw,'kind','Web condition control policy');
  assert.equal(raw.kind,'web-source-control-actions-v1','Unknown Web condition control policy');
  return {kind:raw.kind};
}
async function assertConditionControlRuntime(root,compiledDir,policy){
  if(!policy)return;
  const runtime=await import(pathToFileURL(resolve(root,compiledDir,'src/core/condition-control-actions.js')).href);
  assert.equal(runtime.webSourceControlPolicyKind,policy.kind,'Compiled runtime has no matching Web condition policy');
  assert.equal(typeof runtime.planWebControlAction,'function','Compiled runtime has no condition action planner');
  assert.equal(typeof runtime.planWebControlTarget,'function','Compiled runtime has no condition target planner');
}
async function assertManualControlRuntime(root,compiledDir,policy){
  if(policy===undefined)return;
  const runtime=await import(pathToFileURL(resolve(root,compiledDir,'src/core/battle-controls.js')).href);
  assert.equal(runtime.WEB_MANUAL_BATTLE_CONTROLS,policy,'Compiled runtime has no matching manual controls policy');
  assert.equal(typeof runtime.parseSourceBattleControls,'function','Compiled runtime has no source battle controls parser');
}
/** All source-family producers use this version/field/runtime contract. */
export async function readSourceBattleDirectoryPolicy({root=repository,compiledDir='dist',policy}){
  const declared=parsePolicy(policy,await modules(root,compiledDir));
  await Promise.all([assertConditionControlRuntime(root,compiledDir,declared.framework.conditionControlPolicy),
    assertManualControlRuntime(root,compiledDir,declared.framework.manualControls)]);
  if(declared.framework.branchExecution!==undefined){const runtime=await import(pathToFileURL(resolve(root,compiledDir,'src/core/battle-branch-execution.js')).href);assert.equal(runtime.WEB_BATTLE_BRANCH_EXECUTION,declared.framework.branchExecution);assert.equal(typeof runtime.validateBattleBranchExecutionPolicy,'function');runtime.validateBattleBranchExecutionPolicy(declared.framework.branchExecution);}
  return declared;
}

/** Bind omissions globally against actual complete descriptors. Formation
 * qualification belongs to the per-party runtime compiler, not this binding
 * pass: one unsupported source pattern must not abort the entire directory. */
function bindEntryPolicy(policy,encounters,api){
  if(policy===null)return {scripts:[],flagGroups:[]};
  const bind=(entries,select,label)=>entries.map(entry=>{
    const matches=select(entry.id);
    assert.ok(matches.length&&matches.every(value=>api.hash(value)===entry.sourceHash),
      'Missing, changed or conflicting directory '+label+': '+entry.id);
    return structuredClone(matches[0]);
  });
  const scripts=bind(policy.scripts,id=>encounters.filter(e=>e.metadata.scriptId===id)
    .flatMap(e=>e.script?[e.script]:[]),'script omission');
  const flags=bind(policy.flagGroups,id=>encounters.filter(e=>e.metadata.battleFlagGroupId===id)
    .map(e=>e.metadata.battleFlags),'flag group omission');
  return {formations:policy.formations,
    scripts:scripts.map((script,i)=>({id:policy.scripts[i].id,source:script.source,reason:policy.scripts[i].reason})),
    flagGroups:flags.map((rows,i)=>({id:policy.flagGroups[i].id,rows,reason:policy.flagGroups[i].reason}))};
}
export async function compileSourceBattleDirectoryEntryPolicy({root=repository,compiledDir='dist',policy,encounters}){
  const api=await modules(root,compiledDir);
  return bindEntryPolicy(policy===null?null:api.parseBattleBatchEntryPolicy(policy),encounters,api);
}
const merge=(before,extra,canonical,label)=>{
  const result=structuredClone(before),ids=new Map(result.map(row=>[row.id,row]));
  assert.equal(ids.size,result.length,'Duplicate '+label);
  for(const row of extra){const previous=ids.get(row.id);
    if(previous)assert.equal(canonical(previous),canonical(row),'Conflicting '+label+': '+row.id);
    else{result.push(structuredClone(row));ids.set(row.id,row);}}
  return result.sort((a,b)=>a.id-b.id);
};
const summary=(runtime)=>({requested:runtime.report.entries.length,compiledDefinitions:Object.keys(runtime.encounters).length,
  blocked:runtime.report.entries.filter(e=>e.status==='blocked').length,
  withRuntimeDependencies:new Set(runtime.diagnostics.filter(d=>d.kind==='runtime-dependency').map(d=>d.partyId)).size,
  withDevelopmentOmissions:new Set(runtime.diagnostics.filter(d=>d.kind==='development-omission').map(d=>d.partyId)).size});

/** Compose a source-initialized framework catalog without inventing owners or
 * dropping unsuccessful requests. Inputs are outputs of the existing compiler.
 * This is also independently testable with redistributable controlled data. */
export async function composeFrameworkBattleDirectory({root=repository,compiledDir='dist',baseCatalog,runtime,conditionControlPolicy}){
  const api=await modules(root,compiledDir),base=await api.verifyContent(structuredClone(baseCatalog));
  api.assertSourceGameCatalog(base);
  assert.ok(!Object.hasOwn(base.common,'conditionControlPolicy'),'A strict source baseline cannot already carry a Web condition policy');
  const conditionPolicy=conditionControlPolicy===undefined?undefined:parseConditionControlPolicy(conditionControlPolicy);
  await assertConditionControlRuntime(root,compiledDir,conditionPolicy);
  const result=structuredClone(runtime),blocked=new Set(result.diagnostics.filter(d=>d.kind==='blocked').map(d=>d.partyId));
  for(const content of result.drops.contents){
    const admitted=content.kind==='item'?base.gameState.items[content.id]:base.gameState.equipmentSystem?.catalog.definitions[content.id];
    if(admitted)continue;
    for(const encounter of Object.values(result.encounters)){
      const monsters=new Set(Object.values(encounter.participants?.enemyDefinitions??{}).map(enemy=>enemy.sourceId));
      for(const enemy of encounter.enemies)monsters.add(enemy.sourceId);
      if(!result.drops.monsters.some(monster=>monsters.has(monster.id)&&monster.slots.some(slot=>slot.contentId===content.id)))continue;
      blocked.add(encounter.encounterId);result.diagnostics.push({partyId:encounter.encounterId,kind:'blocked',code:'directory-owned-drop-content',
        reason:'Source owner catalog has no '+content.kind+' definition for drop '+content.id,
        source:encounter.handoff?.source.row??null,dependency:{table:'content.csv',id:content.id}});
    }
  }
  for(const id of blocked)delete result.encounters[String(id)];
  for(const encounter of Object.values(result.encounters)){
    const assessment=api.assessBattleHandoff(encounter.handoff,'framework');
    assert.equal(assessment.status,'ready','Framework directory requires an explicit bound handoff policy');
  }
  result.report.entries=result.report.entries.map(entry=>blocked.has(entry.partyId)?{...entry,status:'blocked'}:entry);
  Object.assign(result.report,summary(result));
  const usedMonsters=new Set(Object.values(result.encounters).flatMap(encounter=>
    Object.values(encounter.participants?.enemyDefinitions??{}).map(enemy=>enemy.sourceId)));
  const selectedMonsters=result.drops.monsters.filter(monster=>usedMonsters.has(monster.id));
  const selectedContentIds=new Set(selectedMonsters.flatMap(monster=>monster.slots.flatMap((slot,i)=>
    monster.rate>0&&result.drops.weights[i]>0&&slot.contentId?[slot.contentId]:[])));
  const drops={...structuredClone(base.common.drops),
    monsters:merge(base.common.drops.monsters,selectedMonsters,api.canonical,'monster drop'),
    contents:merge(base.common.drops.contents,result.drops.contents.filter(content=>selectedContentIds.has(content.id)),api.canonical,'drop content')};
  assert.equal(api.canonical(base.common.drops.weights),api.canonical(result.drops.weights),'Source drop weights disagree');
  api.validateBattleDropCatalog(drops);
  const {contentHash:_,...body}=structuredClone(base);
  body.common.drops=drops;if(conditionPolicy)body.common.conditionControlPolicy=conditionPolicy;body.encounters=result.encounters;body.encounterDiagnostics=result.diagnostics;body.encounterReport=result.report;
  const catalog={...body,contentHash:api.hash(body)};
  await api.verifyContent(catalog);api.assertSourceGameCatalog(catalog,'framework');
  assert.equal(api.canonical(catalog.gameState),api.canonical(base.gameState),'Directory changed source initial owners');
  const {drops:beforeDrops,...before}=base.common,{drops:afterDrops,...after}=catalog.common;
  if(conditionPolicy){
    const {conditionControlPolicy:published,...other}=after;
    assert.equal(api.canonical(published),api.canonical(conditionPolicy),'Directory changed its explicit condition policy');
    assert.equal(api.canonical(before),api.canonical(other),'Directory changed unrelated shared source capabilities');
  }else assert.equal(api.canonical(before),api.canonical(after),'Directory changed shared source capabilities');
  const policyChanges=conditionPolicy?[{kind:'framework-condition-policy-binding-v1',
    field:'common.conditionControlPolicy',from:null,to:structuredClone(conditionPolicy),
    beforeCommonHash:api.hash(base.common),afterCommonHash:api.hash(catalog.common),
    beforeGameStateHash:api.hash(base.gameState),afterGameStateHash:api.hash(catalog.gameState),
    beforeCommon:structuredClone(base.common),afterCommon:structuredClone(catalog.common)}]:[];
  return {catalog,runtime:result,policyChanges};
}

/** No file publication. Caller supplies the same candidate's whole source
 * world and baseline; this function emits strict and explicit Web variants. */
export async function compileSourceBattleDirectory({root=repository,compiledDir='dist',world,baseCatalog,policy}){
  root=resolve(root);const api=await modules(root,compiledDir),declared=await readSourceBattleDirectoryPolicy({root,compiledDir,policy});
  const base=await api.verifyContent(structuredClone(baseCatalog));api.assertSourceGameCatalog(base);
  const catalog=await api.verifyContent(structuredClone(world.catalog));
  const maps=await Promise.all(world.maps.map(map=>api.verifyContent(structuredClone(map),catalog.maps[String(map.mapId)]?.contentHash)));
  const [source,snapshot,corpus]=await Promise.all([api.compileSharedBattleSource(root),api.readSnapshot(resolve(root,'build/battle')),
    api.loadSystemSource(root,catalog.parentSourceSetHash)]);
  assert.equal(source.parentSourceSetHash,catalog.parentSourceSetHash,'Directory parent source mismatch');
  const exported=JSON.parse(api.snapshotFile(snapshot,'battle.json').toString());
  const bindings=new Map(),reader={};
  for(const method of ['row','unique','group','matching'])reader[method]=(...args)=>{
    const found=corpus.reader[method](...args);
    for(const row of Array.isArray(found)?found:[found])bindings.set(api.canonical({table:args[0],source:row.source}),{table:args[0],source:structuredClone(row.source)});
    return found;
  };
  reader.handoffMusic=api.createBattleHandoffMusicLookup(corpus.tables,reader);
  const sourceRequests=api.collectSourceBattleRequests({catalog,maps,corpus});
  const retainedBaseRequests=[...new Set(base.encounterReport?.entries.map(entry=>entry.partyId)??[])].sort((a,b)=>a-b);
  const requestedPartyIds=[...new Set([...sourceRequests.requestedPartyIds,...retainedBaseRequests])].sort((a,b)=>a-b);
  const requestBody={kind:'source-battle-directory-requests-v1',sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:catalog.parentSourceSetHash,
    sourceRequests,retainedBase:{catalogHash:base.contentHash,partyIds:retainedBaseRequests},requestedPartyIds};
  const requests={...requestBody,contentHash:api.hash(requestBody)};
  const descriptorSources={json:name=>{
    const found=Object.values(exported.assets).filter(asset=>asset.source.assetPath.endsWith('/'+name+'.json'));
    assert.equal(found.length,1,'Missing or ambiguous battle JSON: '+name);
    const asset=found[0],files=exported.sources.filter(file=>file.file===asset.source.file||file.file.endsWith('/'+asset.source.file));
    assert.equal(files.length,1,'Unbound battle JSON: '+name);
    return {data:structuredClone(asset.data),source:{...asset.source,sha256:files[0].sha256,
      sourceSetHash:source.parentSourceSetHash,battleSourceSetHash:source.sourceSetHash}};
  },spritePath:suffix=>{
    const found=Object.keys(exported.sprites).filter(path=>path.toLowerCase().endsWith(suffix.toLowerCase()));
    assert.equal(found.length,1,'Missing or ambiguous battle sprite: '+suffix);return found[0];
  }};
  const descriptors=api.compileBattleEncounterSources(reader,{partyIds:requestedPartyIds,...descriptorSources});
  const shared=await api.compileGameCatalogModules(root,source);
  assert.equal(base.common.fieldSourceSetHash,shared.common.fieldSourceSetHash,'Source owner baseline field mismatch');
  const runtimeInput={...shared.runtimeInput,requestedPartyIds,encounters:descriptors.encounters,sourceDiagnostics:descriptors.diagnostics};
  const strictCatalog=api.assembleGameCatalog({...shared,reader:shared.reader,runtimeInput:{...runtimeInput,handoff:{policy:null}}},
    {kind:'source-new-game',limitations:[...base.common.limitations]});
  api.assertSourceGameCatalog(strictCatalog);await api.verifyContent(strictCatalog);
  assert.equal(api.canonical(strictCatalog.gameState),api.canonical(base.gameState),'Strict directory changed source initial owners');
  const {drops:oldDrops,...oldCommon}=base.common,{drops:newDrops,...newCommon}=strictCatalog.common;
  assert.equal(api.canonical(oldCommon),api.canonical(newCommon),'Strict directory changed shared source capabilities');
  const sourceFormatImport=declared.framework.branchExecution ? api.createBattleSourceFormatImportResolver(corpus) : undefined;
  const participantClosure=declared.framework.sourceParticipants?api.compileSourceBattleParticipantClosure(reader,{policy:declared.framework.sourceParticipants,
    encounters:descriptors.encounters,sources:descriptorSources,eventMessages:shared.runtimeInput.eventMessages,branchExecution:declared.framework.branchExecution,...(sourceFormatImport?{sourceFormatImport}:{}),...(declared.framework.gauInstances?{gauInstancePolicy:declared.framework.gauInstances}:{})}):null;
  const gauSource=declared.framework.gauInstances?await api.compileSharedBattleSource(root,{gauInstances:declared.framework.gauInstances}):null;
  const runtime=api.compileBattleEncounterRuntime(shared.reader,{...runtimeInput,...(sourceFormatImport?{sourceFormatImport}:{}),
    ...(gauSource?{gauInstanceContent:gauSource.gauInstances.catalog}:{}),
    ...(participantClosure?{reserveEnemies:participantClosure.reserveEnemies,enemyParties:participantClosure.enemyParties,sourceDiagnostics:[...runtimeInput.sourceDiagnostics,...participantClosure.diagnostics]}:{}),
    ...(declared.framework.gauInstances?{gauInstancePolicy:declared.framework.gauInstances}:{}),
    ...(declared.framework.childPartyAdmission?{childPartyAdmission:declared.framework.childPartyAdmission}:{}),
    ...(declared.framework.spawnConditionPolicy?{spawnConditionPolicy:declared.framework.spawnConditionPolicy}:{}),
    ...(declared.framework.forcedSavePolicy?{forcedSavePolicy:declared.framework.forcedSavePolicy}:{}),
    ...(declared.framework.branchExecution===undefined?{}:{branchExecution:declared.framework.branchExecution}),
    ...(declared.framework.manualControls===undefined?{}:{manualControls:declared.framework.manualControls}),
    ...(declared.framework.conditionControlPolicy?{conditionControlPolicy:declared.framework.conditionControlPolicy}:{}),handoff:{policy:declared.framework.handoff},
    development:{...bindEntryPolicy(declared.framework.entry,descriptors.encounters,api),...(participantClosure?{participants:participantClosure.participants}:{})}});
  const composed=await composeFrameworkBattleDirectory({root,compiledDir,baseCatalog:base,runtime,conditionControlPolicy:declared.framework.conditionControlPolicy});
  const frameworkCatalog=composed.catalog;
  const analyze=value=>{
    const result=api.analyzeBatchEncounters(value,requestedPartyIds);
    return {ready:result.encounters.filter(entry=>entry.status==='ready').length,
      conditional:result.encounters.filter(entry=>entry.status==='conditional').length,
      blocked:result.encounters.filter(entry=>entry.status==='blocked').length,entries:result.encounters};
  };
  const groups=(key,select)=>{
    const grouped=new Map();for(const encounter of descriptors.encounters){const id=encounter.metadata[key];if(!id)continue;
      const value=select(encounter),sourceHash=api.hash(value),entry=grouped.get(id)??{id,sourceHash,partyIds:[],source:value};
      assert.equal(entry.sourceHash,sourceHash,'Conflicting source directory dependency '+key+': '+id);
      entry.partyIds.push(encounter.partyId);grouped.set(id,entry);}
    return [...grouped.values()].sort((a,b)=>a.id-b.id).map(value=>({...value,frequency:value.partyIds.length}));
  };
  const reportBody={kind:'source-battle-directory-build-v1',sourceSetHash:corpus.sourceSetHash,
    parentSourceSetHash:source.parentSourceSetHash,battleSourceSetHash:exported.sourceSetHash,policy:declared,
    ...(gauSource?{sourceGauFactory:structuredClone(gauSource.gauInstances)}:{}),policyChanges:composed.policyChanges,...(participantClosure?{sourceParticipantClosure:participantClosure.report}:{}),baselineHash:base.contentHash,requestsHash:requests.contentHash,strictCatalogHash:strictCatalog.contentHash,frameworkCatalogHash:frameworkCatalog.contentHash,
    requestedPartyIds,sourceDescriptors:{compiled:descriptors.encounters.length,blocked:descriptors.diagnostics.length,diagnostics:descriptors.diagnostics},
    strict:{...strictCatalog.encounterReport,analysis:analyze(strictCatalog)},framework:{...composed.runtime.report,analysis:analyze(frameworkCatalog)},
    entryDependencies:{scripts:groups('scriptId',encounter=>encounter.script).map(entry=>{
      const families=new Map();for(const instruction of entry.source?.data?.Mnemonics??[]){
        const family=instruction.mnemonic==='SysCall'?'SysCall:'+(instruction.operands?.sValues?.[0]??'<unresolved>'):instruction.mnemonic;
        families.set(family,(families.get(family)??0)+1);}
      return {...entry,category:'source-entry-script',instructionFamilies:[...families].sort(([a],[b])=>a.localeCompare(b)).map(([family,sites])=>({family,sites}))};}),
      flagGroups:groups('battleFlagGroupId',encounter=>encounter.metadata.battleFlags).map(entry=>({...entry,category:'source-flag-group',
        flagIds:[...new Set(entry.source.map(row=>api.tableInteger(row.values.battle_flag_id)))].sort((a,b)=>a-b)}))},
    partySources:descriptors.encounters.map(encounter=>({partyId:encounter.partyId,source:encounter.source,patterns:encounter.patterns,
      metadata:encounter.metadata,background:encounter.background,scriptSource:encounter.script?.source??null})),
    conditionSourceBindings:shared.readConditionSourceBindings(),
    conditionSourceBindingsHash:api.hash(shared.readConditionSourceBindings()),
    sourceBindings:[...bindings.values()].sort((a,b)=>api.canonical(a).localeCompare(api.canonical(b))),
    diagnostics:{requests:sourceRequests.diagnostics,strict:strictCatalog.encounterDiagnostics,framework:frameworkCatalog.encounterDiagnostics},
    initialStateChanged:false,sourceRoutesChanged:false,sourceGameplayVerified:false,nativeHandoffVerified:false,browserVerified:false,
    limitations:['Directory compilation is not gameplay admission. Every unresolved request and source site is retained.',
      'Blocked Encount variants, source walking timing/lottery and area-grid references remain blocked.',
      'Only explicit source-bound entry policies differ in the Web variant; AI, abilities, conditions and rewards keep existing gates.']};
  return {strictCatalog,frameworkCatalog,requests,report:{...reportBody,contentHash:api.hash(reportBody)}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={compiledDir:'dist',report:'build/reports/source-battle-directory.json'};
  while(args.length){const flag=args.shift();assert.ok(['--compiled-dir','--policy','--report'].includes(flag)&&args[0],'Use source-battle-directory.mjs --policy file [--compiled-dir dir] [--report file]');
    options[{'--compiled-dir':'compiledDir','--policy':'policy','--report':'report'}[flag]]=args.shift();}
  assert.ok(options.policy,'An explicit framework directory policy is required');
  const api=await modules(repository,options.compiledDir),read=async url=>JSON.parse(await readFile(resolve(repository,'build',url.slice(1)),'utf8'));
  const refs=await read('/content-packages/source.json'),world=await api.verifyContent(await read(refs.world.url),refs.world.contentHash);
  const maps=await Promise.all(Object.values(world.maps).map(index=>read(index.url)));
  const result=await compileSourceBattleDirectory({compiledDir:options.compiledDir,world:{catalog:world,maps},
    baseCatalog:await read(refs.source.battle.url),policy:JSON.parse(await readFile(resolve(repository,options.policy),'utf8'))});
  assert.ok(resolve(repository,options.report).startsWith(resolve(repository,'build/reports')+'/'),'Inspection report must be inside build/reports');
  await writeFile(resolve(repository,options.report),JSON.stringify(result.report,null,2)+'\n');
  console.log(JSON.stringify({requested:result.requests.requestedPartyIds.length,
    strict:{ready:result.report.strict.analysis.ready,conditional:result.report.strict.analysis.conditional,blocked:result.report.strict.analysis.blocked},
    framework:{ready:result.report.framework.analysis.ready,conditional:result.report.framework.analysis.conditional,blocked:result.report.framework.analysis.blocked},published:false}));
}
