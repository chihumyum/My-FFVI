// Whole-table name census and same-source directory comparison. No map producer
// or original battle/story execution. Raw dictionaries/text remain ignored.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy,compileSourceBattleDirectoryEntryPolicy} from './source-battle-directory.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),opts={};
while(args.length){const key=args.shift();assert(['--before','--compiled','--output'].includes(key)&&args[0]&&!opts[key]);opts[key]=args.shift();}
assert(opts['--before'],'A separately compiled baseline is required');
const dist=resolve(root,opts['--compiled']??'dist'),before=resolve(root,opts['--before']),out=resolve(root,opts['--output']??'build/reports/source-catalog-names');
assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(out,{recursive:true});
const load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href),api=Object.assign({},...await Promise.all([
 'compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure',
 'compiler/battle-event','compiler/battle-encounters','compiler/world','compiler/source-catalog-name','core/field-message-template','core/source-catalog-name',
].map(name=>load(dist,name)))),old=Object.assign({},...await Promise.all(['compiler/game-catalog','compiler/battle-encounter-runtime','compiler/battle-event'].map(name=>load(before,name)))),
 runtime=await runtimeDigest(root,dist),beforeRuntime=await runtimeDigest(root,before),input=await loadBattleEventMessageSourceInputs(root,dist),sourceDigest=input.sourceDigest,
 binding=input.input.binding,resolver=api.createSourceCatalogNameResolver(input.input),references=[],keys=new Map();
assert.equal(input.scripts.length,3304);assert.equal(input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
assert.equal(input.programs.length,53);assert.equal(input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),2312);
assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.encounters.length,483);assert.equal(input.dependencies.diagnostics.length,7);
for(const[table,rows]of Object.entries(input.snapshot.tables))for(const row of rows)for(const[field,key]of Object.entries(row))if(/^mes_id_/.test(field)){
 const matches=Object.entries(input.input.messages).flatMap(([namespace,dict])=>Object.hasOwn(dict,key)?[{namespace,text:dict[key]}]:[]),body=matches.filter(m=>['system_zhc','story_mes_zhc','etc_text_zhc'].includes(m.namespace)),
  ref={table,rowId:row.id,field,key,nameField:/^mes_id_name\d*$/.test(field),source:input.snapshot.reader.row(table,row.id).source,matches,body};
 references.push(ref);if(!ref.nameField||!key||key==='None')continue;
 if(!keys.has(key)){let compiled=null,error=null;try{compiled=resolver.sourceCatalogName(key);}catch(e){error=String(e);}
  if(compiled){assert.equal(body.length,1);assert.equal(compiled.name,body[0].text);if(compiled.nameSource){assert.throws(()=>resolver(key),/live owned-name/);assert.throws(()=>api.prepareSourceCatalogName(compiled.name,compiled.nameSource),/held-name owner/);}else assert.equal(resolver(key),body[0].text);}
  if(body.length===1&&body[0].namespace==='system_zhc')assert.equal(compiled?.name,body[0].text,'Existing system label bytes changed: '+key);
  keys.set(key,{key,body,compiled,error,uses:[]});
 }keys.get(key).uses.push({table,rowId:row.id,field});
}
const allNames=[...keys.values()],missing=allNames.filter(v=>v.body.length===0),dynamic=allNames.filter(v=>v.compiled?.nameSource),gated=allNames.filter(v=>v.body.length===1&&v.error);
assert.equal(Object.keys(input.snapshot.tables).length,96);assert.equal(references.length,8552);assert.equal(keys.size,1318);assert.equal(missing.length,3);assert.equal(dynamic.length,2);
const source=await api.compileSharedBattleSource(root),shared=await api.compileGameCatalogModules(root,source),prior=await old.compileGameCatalogModules(root,source);
const sharedBeforeHash=api.hash({...prior.runtimeInput,name:'source-bound-name-provider'}),sharedAfterHash=api.hash({...shared.runtimeInput,name:'source-bound-name-provider'});
// Separate byte-level shared catalog differences from directory observations.
const sharedCatalogBefore=api.hash(prior.common),sharedCatalogAfter=api.hash(shared.common);
assert.equal(sharedCatalogBefore,sharedCatalogAfter,'Changed existing shared catalog outputs');
assert.equal(sharedBeforeHash,sharedAfterHash,'Changed immutable runtime input other than name provider');
const policy=await readSourceBattleDirectoryPolicy({root,compiledDir:dist,policy:JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')))}),
 maps=input.snapshot.tables['map.csv'].map(row=>api.compileSourceWalkEncounterDependencies(input.snapshot.reader,Number(row.id))),
 walkIds=[...new Set(maps.flatMap(m=>m.set?Object.entries(m.set.values).filter(([k])=>/^monster_set\d+$/.test(k)).map(([,v])=>Number(v)).filter(v=>Number.isInteger(v)&&v>0):[]))],
 union=[...new Set([...input.dependencies.requestedPartyIds,...walkIds])].sort((a,b)=>a-b),combined=api.compileBattleEncounterSources(input.snapshot.reader,{partyIds:union,...input.encounterSources});
assert.equal(maps.length,649);assert.equal(combined.requestedPartyIds.length,492);assert.equal(combined.encounters.length,485);assert.equal(combined.diagnostics.length,7);
for(const p of input.programs){const compiled=old.compileBattleEvent(p.data,p.compiled.source,input.input,input.snapshot.reader,input.sourceFormatImport?.resolve(p.data,p.compiled.source));assert.deepEqual(compiled,p.compiled,'Name routing changed original battle decoding');}
const observations=[];
for(const[label,dep]of [['original490',input.dependencies],['sourceAndWalkingUnion492',combined]]){
 const closure=api.compileSourceBattleParticipantClosure(shared.reader,{policy:policy.framework.sourceParticipants,encounters:dep.encounters,sources:input.encounterSources,
  eventMessages:shared.runtimeInput.eventMessages,branchExecution:policy.framework.branchExecution}),
  development=await compileSourceBattleDirectoryEntryPolicy({root,compiledDir:dist,policy:policy.framework.entry,encounters:dep.encounters}),
  fixed={requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:[...dep.diagnostics,...closure.diagnostics],reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,
   spawnConditionPolicy:policy.framework.spawnConditionPolicy,forcedSavePolicy:policy.framework.forcedSavePolicy,branchExecution:policy.framework.branchExecution,manualControls:policy.framework.manualControls,
   conditionControlPolicy:policy.framework.conditionControlPolicy,handoff:{policy:policy.framework.handoff},development:{...development,participants:closure.participants}},
  was=old.compileBattleEncounterRuntime(prior.reader,{...prior.runtimeInput,...fixed}),now=api.compileBattleEncounterRuntime(shared.reader,{...shared.runtimeInput,...fixed}),
  key=d=>api.canonical(d),oldSet=new Set(was.diagnostics.map(key)),newSet=new Set(now.diagnostics.map(key)),removed=was.diagnostics.filter(d=>!newSet.has(key(d))),added=now.diagnostics.filter(d=>!oldSet.has(key(d)));
 observations.push({label,requested:dep.requestedPartyIds.length,sourceDescriptors:dep.encounters.length,sourceDiagnostics:dep.diagnostics,participantClosure:closure,
  before:was,after:now,removed,added});
}
assert.equal(await runtimeDigest(root,dist),runtime);assert.equal(await runtimeDigest(root,before),beforeRuntime);assert.equal((await loadBattleEventMessageSourceInputs(root,dist)).sourceDigest,sourceDigest);
const payload={kind:'whole-source-catalog-names-v1',result:'passed-source-compilation-not-story-execution',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,sourceDigest,binding,
 counts:{tables:96,messageReferences:references.length,nameReferences:references.filter(r=>r.nameField&&r.key&&r.key!=='None').length,distinctNameKeys:keys.size,
  systemKeys:allNames.filter(v=>v.body[0]?.namespace==='system_zhc').length,storyKeys:allNames.filter(v=>v.body[0]?.namespace==='story_mes_zhc').length,
  dynamicKeys:dynamic.length,missingKeys:missing.length,specificPresentationGates:gated.length,allPrograms:3304,allInstructions:186003,battlePrograms:53,battleInstructions:2312,
  originalBattleExecutions:0,originalCompleteBodyExecutions:0,worldCompilations:0,publications:0},references,names:allNames,completeBattlePrograms:input.programs,sourceDependencies:input.dependencies,
 walkingUnionDependencies:combined,maps,observations,shared:{beforeRuntimeInputHash:sharedBeforeHash,afterRuntimeInputHash:sharedAfterHash,beforeCatalogHash:sharedCatalogBefore,afterCatalogHash:sharedCatalogAfter},
 noWalkingAdmissionGranted:true,sourceCampaignComplete:false,browserVerified:false,nativeGameplay:false};
const bytes=JSON.stringify(payload)+'\n',file=resolve(out,'full-source.json');await writeFile(file,bytes);
const summary={...Object.fromEntries(['kind','result','runtimeSha256','beforeRuntimeSha256','sourceDigest','counts','shared','noWalkingAdmissionGranted'].map(k=>[k,payload[k]])),
 artifact:{file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)},observations:observations.map(o=>({label:o.label,requested:o.requested,sourceDescriptors:o.sourceDescriptors,
  beforeDefinitions:Object.keys(o.before.encounters).length,afterDefinitions:Object.keys(o.after.encounters).length,removed:o.removed.length,added:o.added.length}))};
await writeFile(resolve(out,'report.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
