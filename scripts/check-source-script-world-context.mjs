// Full corpus nomination and immutable source preservation; no story-state injection.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runtimeDigest } from './runtime-digest.mjs';
import { loadBattleEventMessageSourceInputs } from './battle-event-message-source-inputs.mjs';
import { readSourceBattleDirectoryPolicy } from './source-battle-directory.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),dist=resolve(root,process.argv[2]??'dist');
const load=name=>import(pathToFileURL(resolve(dist,'src',name+'.js')).href);
const {hash}=await load('compiler/content'),{compileWorldMapEntryView}=await load('compiler/world-terrain'),
  {bindMapPackages,resolveMapScript}=await load('compiler/map-package'),
  {compileEventScriptTransitionInstruction}=await load('compiler/event-script-transition');
const runtime=await runtimeDigest(root,dist),rawPolicy=JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'))),
  policy=await readSourceBattleDirectoryPolicy({root,compiledDir:dist,policy:rawPolicy});
const input=await loadBattleEventMessageSourceInputs(root,dist,{branchExecution:policy.framework.branchExecution,
  sourceFormatImport:true,gauInstancePolicy:policy.framework.gauInstances}),s=input.snapshot;
assert.equal(input.scripts.length,3304);assert.equal(input.inventory.counts.allInstructions,186003);
assert.equal(input.programs.length,53);assert.equal(input.inventory.counts.instructions,2312);
assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.diagnostics.length,7);
const maps=bindMapPackages(s.assets,s.tables),byId=new Map(input.scripts.map(p=>[p.id,p])),selected=new Set(),calls=[];
for(const p of input.scripts)for(const[index,raw]of p.data.Mnemonics.entries())if(raw.mnemonic==='ChangeScript'){
  const op=compileEventScriptTransitionInstruction(raw);selected.add(p.id);
  calls.push({program:p.id,source:p.source,index,raw,op});
}
assert.equal(calls.length,358);assert.equal(selected.size,302);
const allMapPredicates=maps.map(map=>({mapId:map.id,source:compileWorldMapEntryView(s.reader,Number(map.id),s.manifest.sources)}));
assert.equal(allMapPredicates.length,649);
const bindings=[];
for(const map of maps){const aliases=new Map();for(const[name,id]of Object.entries({...map.residentScripts,...map.scriptAliases}))if(id&&byId.has(id)){
  const values=aliases.get(id)??[];values.push(name);aliases.set(id,values);
 }
 for(const call of calls){const names=aliases.get(call.program);if(!names)continue;
  const target=resolveMapScript(map,call.op.targetScript);if(target)selected.add(target);
  bindings.push({mapId:map.id,callerId:call.program,callerAliases:names,index:call.index,targetAlias:call.op.targetScript,
   targetId:target,targetBound:target!==null,returnToCaller:call.op.returnToCaller,
   sourceWorldMap:allMapPredicates.find(x=>x.mapId===map.id).source.isWorld,
   nameClassificationChanges:names.filter(name=>name.toLowerCase().startsWith('sc_map_')!==call.op.targetScript.toLowerCase().startsWith('sc_map_'))});
 }
}
const affectedMaps=input.analysis.maps.filter(m=>m.scripts.some(id=>selected.has(id))||m.closure.some(id=>selected.has(id))),
  assetIds=new Set(affectedMaps.flatMap(m=>[m.packageId,...Object.values(m.groups),...m.closure]));
assert.equal(await runtimeDigest(root,dist),runtime);
const counts={allPrograms:3304,allInstructions:186003,maps:649,calls:358,callerPrograms:302,
 completeCallerAndTargetPrograms:input.scripts.filter(p=>selected.has(p.id)).length,
 completeCallerAndTargetInstructions:input.scripts.filter(p=>selected.has(p.id)).reduce((n,p)=>n+p.data.Mnemonics.length,0),
 mapAliasUses:bindings.length,classificationChangeUses:bindings.filter(b=>b.nameClassificationChanges.length).length,
 affectedMaps:affectedMaps.length,dependentAssets:assetIds.size,battlePrograms:53,battleInstructions:2312,requestedParties:490,retainedSourceDiagnostics:7};
const data={kind:'source-script-world-context-complete-nomination-v1',runtimeSha256:runtime,sourceDigest:input.sourceDigest,counts,
 allProgramBindings:input.scripts.map(p=>({id:p.id,source:p.source,rawHash:hash(p.data),instructions:p.data.Mnemonics.length})),
 allMapPredicates,calls,bindings,completePrograms:input.scripts.filter(p=>selected.has(p.id)),
 completeMapClosures:affectedMaps,completeAssets:s.assets.filter(a=>assetIds.has(a.id)),
 scope:{sourceBodiesExecuted:0,worldCompilations:0,publications:0,browserVerified:false,sourceCampaignComplete:false}};
const output=resolve(root,'build/reports/source-script-world-context');await mkdir(output,{recursive:true});
const bytes=JSON.stringify(data)+'\n',file=resolve(output,'inventory.json');await writeFile(file,bytes);
const report={kind:data.kind,result:'complete-source-retained',runtimeSha256:runtime,sourceDigest:input.sourceDigest,counts,
 artifact:{file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)},scope:data.scope};
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
