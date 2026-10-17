// Complete-source differential inspection; no map production or source-story execution.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadBattleEventMessageSourceInputs } from './battle-event-message-source-inputs.mjs';
import { readSourceBattleDirectoryPolicy } from './source-battle-directory.mjs';
import { runtimeDigest } from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'), options={inputRoot:root,compiledDir:'dist',beforeCompiledDir:null,output:'build/reports/source-owned-equipment'};
const flags={'--input-root':'inputRoot','--compiled-dir':'compiledDir','--before-compiled-dir':'beforeCompiledDir','--output':'output'},seen=new Set();
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];assert(Object.hasOwn(flags,key)&&value&&!seen.has(key),'Unknown/missing/repeated checker option');seen.add(key);options[flags[key]]=value;}
assert(options.beforeCompiledDir,'An exact before compiler is required');
const dist=resolve(root,options.compiledDir),beforeDist=resolve(root,options.beforeCompiledDir),inputRoot=resolve(root,options.inputRoot),out=resolve(root,options.output);assert(out.startsWith(resolve(root,'build/reports')+'/'));
const sha=b=>createHash('sha256').update(b).digest('hex'),load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href);
const modules=['compiler/field','compiler/field-empty-message','compiler/battle-event','compiler/battle-source-format-import','compiler/battle-ai'];
const api=Object.assign({},...await Promise.all(modules.map(name=>load(dist,name)))),old=Object.assign({},...await Promise.all(modules.map(name=>load(beforeDist,name))));
const runtime=await runtimeDigest(root,dist),policyBytes=await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')),policy=await readSourceBattleDirectoryPolicy({root:inputRoot,compiledDir:dist,policy:JSON.parse(policyBytes)});
const selection={branchExecution:policy.framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:policy.framework.gauInstances};
const source=await loadBattleEventMessageSourceInputs(inputRoot,dist,selection),s=source.snapshot,{canonical,hash}=source.api;
assert.equal(source.scripts.length,3304);assert.equal(source.inventory.counts.allInstructions,186003);assert.equal(source.programs.length,53);
const emptyBefore=old.createFieldEmptyMessageLookup(source.input),emptyAfter=api.createFieldEmptyMessageLookup(source.input),domains=new Map(source.analysis.scripts.map(p=>[p.id,p]));
const selectors=new Set(['全員の装備を外す','控えメンバーの装備を外す','最強装備：ティナ','最強装備：エドガー']),sites=[],bindings=[],bodies=[],aiProgramEncodings=[];let operations=0,fieldOperations=0,changedLowerings=0,aiPrograms=0,aiInstructions=0;
for(const p of source.scripts){const a=[],b=[];let selected=false;
 for(const[index,raw]of p.data.Mnemonics.entries()){
  const site={script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},next={nextMnemonic:p.data.Mnemonics[index+1]?.mnemonic??null};
  const decode=(owner,empty)=>{try{return owner.decodeFieldOp(raw,site,s.messages,s.tables,{...next,emptyMessages:empty});}catch(error){return{kind:'static-field-decode-error',reason:error.message};}};
  const before=decode(old,emptyBefore),after=decode(api,emptyAfter),selector=raw.mnemonic==='SysCall'?raw.operands?.sValues?.[0]:null;
  const field=domains.get(p.id)?.domain==='field',nominated=field&&selectors.has(selector);operations++;if(field)fieldOperations++;if(canonical(before)!==canonical(after))changedLowerings++;a.push(after);b.push(before);
  if(nominated){selected=true;assert.equal(before.kind,'blocked');
   if(selector.startsWith('最強装備：')){assert.equal(after.kind,'blocked');assert.match(after.reason,/0x334c20/);}
   else assert.equal(after.kind,'source-owned-equipment');
   sites.push({programId:p.id,index,source:p.source,rawHash:hash(raw),raw,selector,before,after,mapIds:domains.get(p.id).maps});
  }else assert.equal(canonical(before),canonical(after),'Unrelated full-source lowering changed '+p.id+':'+index);
 }
 bindings.push({id:p.id,source:p.source,rawHash:hash(p.data),instructions:p.data.Mnemonics.length,beforeProjectionHash:hash(b),afterProjectionHash:hash(a)});
 if(selected)bodies.push({...p,rawHash:hash(p.data),beforeProjection:b,afterProjection:a});
 if(p.source.assetPath.includes('/MonsterAI/')){const compile=owner=>{try{return{kind:'compiled-ai',program:owner.compileBattleAI(p.data,null)};}catch(error){return{kind:'unassessed-ai-encoding',name:error.name,reason:error.message};}};const before=compile(old),after=compile(api);assert.equal(canonical(before),canonical(after),'Unrelated complete AI changed '+p.id);aiProgramEncodings.push({programId:p.id,source:p.source,rawHash:hash(p.data),result:after});aiPrograms++;aiInstructions+=p.data.Mnemonics.length;}
}
assert.equal(operations,186003);assert.equal(fieldOperations,173026);assert.equal(changedLowerings,8);assert.equal(sites.length,8);assert.equal(bodies.length,5);assert.equal(sites.filter(s=>s.after.kind==='source-owned-equipment').length,6);
assert.equal(aiPrograms,430);assert.equal(aiInstructions,10093);
const oldFormat=old.createBattleSourceFormatImportResolver(s);
for(const p of source.programs){const binding=p.battleExportBinding,bound=binding.kind==='exact-battle-export-source-binding-v1'?binding.source:null;
 assert(['exact-battle-export-source-binding-v1','unbound-battle-export-source-v1'].includes(binding.kind));
 const before=old.compileBattleEvent(p.data,bound,source.input,s.reader,selection.branchExecution,bound?oldFormat({data:p.data,source:bound}):undefined,selection.gauInstancePolicy);
 assert.equal(canonical(before),canonical(p.compiled),'Unrelated complete Battle changed '+p.id);
}
const maps=new Set(sites.flatMap(p=>p.mapIds)),completeMaps=source.analysis.maps.filter(m=>maps.has(m.id));assert.equal(maps.size,5);assert.equal(completeMaps.length,5);
const assetIds=new Set([...bodies.map(p=>p.id),...completeMaps.flatMap(m=>[m.packageId,...Object.values(m.groups),...m.closure]).filter(Boolean)]),assets=new Map(s.assets.map(p=>[p.id,p]));
const dependencies=[...assetIds].sort().map(id=>{assert(assets.has(id),'Missing original map dependency '+id);return assets.get(id);});
assert.equal(await runtimeDigest(root,dist),runtime,'Runtime changed during source inspection');assert.equal(sha(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'))),sha(policyBytes));
const report={kind:'source-owned-equipment-complete-source-differential-v1',runtimeSha256:runtime,sourceDigest:source.sourceDigest,sourceSetHash:s.sourceSetHash,
 sourcePolicy:{sha256:sha(policyBytes),declaration:policy},counts:{programs:3304,instructions:operations,fieldInstructions:fieldOperations,changedLowerings,nominatedSites:8,supportedRemovalSites:6,explicitStrongestGates:2,fullBodies:5,bodyInstructions:bodies.reduce((n,p)=>n+p.data.Mnemonics.length,0),maps:5,dependentAssets:dependencies.length,battlePrograms:53,battleInstructions:2312,battleExportUnboundPrograms:source.programs.filter(p=>p.battleExportBinding.kind!=='exact-battle-export-source-binding-v1').length,aiPrograms,aiInstructions,aiEncodingUnassessedPrograms:aiProgramEncodings.filter(p=>p.result.kind==='unassessed-ai-encoding').length},
 sites,allProgramBindings:bindings,aiProgramEncodings,completeOriginalBodies:bodies,completeMapClosures:completeMaps,completeDependentAssets:dependencies,completeBattlePrograms:source.programs,completeBattleDependencies:source.dependencies,
 scope:{all8SitesRetained:true,unrelatedFieldProjectionUnchanged:true,actualBattleAndAICompilersUnchanged:true,sourceStoryExecutions:0,runtimeAdmissionsClaimed:0,strongestSelectionGranted:false,worldProductions:0,publications:0}};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'report.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify({counts:report.counts,runtimeSha256:runtime,reportSha256:sha(await readFile(resolve(out,'report.json'))),scope:report.scope}));
