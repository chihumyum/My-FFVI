// Read-only complete source comparison. No source root execution or publishing.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const options=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>i%2===0?[v,a[i+1]]:null).filter(Boolean));
assert(options['--baseline-compiled']&&options['--planner-input'],'Supply a frozen compiled baseline and complete source planner input');
const view=resolve(import.meta.dirname,'..'),root=resolve(options['--source-root']??view),compiled=resolve(view,'dist'),
  baseline=resolve(options['--baseline-compiled']),output=resolve(options['--output']??resolve(view,'build/reports/source-owned-recovery.json')),
  load=(directory,n)=>import(pathToFileURL(resolve(directory,'src',n+'.js')).href),sha=b=>createHash('sha256').update(b).digest('hex'),
  runtimeSha256=await runtimeDigest(view,compiled),
  after=Object.assign({},...await Promise.all(['compiler/field','compiler/field-empty-message','compiler/battle-ai','compiler/battle-event','compiler/content'].map(n=>load(compiled,n)))),
  before=Object.assign({},...await Promise.all(['compiler/field','compiler/field-empty-message','compiler/battle-ai','compiler/battle-event'].map(n=>load(baseline,n)))),
  sourceInputs=await loadBattleEventMessageSourceInputs(root,compiled),s=sourceInputs.snapshot,
  plannerBytes=await readFile(resolve(options['--planner-input'])),planner=JSON.parse(plannerBytes),
  registryBytes=await readFile(resolve(view,'content-batches/source-common-capabilities.json')),registry=JSON.parse(registryBytes),
  family=registry.families.find(f=>f.id==='source-owned-condition-and-recovery'),selectors=new Set(family.selectors),
  byId=new Map(planner.programs.map(p=>[p.id,p])),rawById=new Map(sourceInputs.scripts.map(p=>[p.id,p])),
  emptyMessages=new Map([[before,before.createFieldEmptyMessageLookup(sourceInputs.input)],[after,after.createFieldEmptyMessageLookup(sourceInputs.input)]]),
  changes=[],familySites=[],programs=[],affected=new Set,physicalAi=[],battlePrograms=[];
assert.equal(planner.sourceSetHash,s.sourceSetHash);assert.equal(planner.sourceDigest,sourceInputs.sourceDigest);
assert.equal(sourceInputs.scripts.length,3304);assert.equal(byId.size,3304);
const selector=raw=>raw.mnemonic==='SysCall'?'SysCall:'+raw.operands?.sValues?.[0]:raw.mnemonic;
const decode=(api,p,raw,pc)=>{try{
  const {script,index,source,...op}=api.decodeFieldOp(raw,{script:p.id,index:pc,source:{...p.source,pointer:'/Mnemonics/'+pc}},s.messages,s.tables,
    {nextMnemonic:p.data.Mnemonics[pc+1]?.mnemonic??null,emptyMessages:emptyMessages.get(api)});return op;
}catch(error){return{kind:'static-field-decode-error',reason:error.message};}};
for(const p of sourceInputs.scripts){
  const index=byId.get(p.id);assert(index);assert.equal(after.hash(p.data),index.rawHash);assert.equal(p.data.Mnemonics.length,index.instructionCount);
  const projections=[],prior=[];
  for(const[pc,raw]of p.data.Mnemonics.entries()){
    const selected=selectors.has(selector(raw));if(selected)affected.add(p.id);
    let a=null,b=null;
    if(index.domain==='field'){
      a=decode(before,p,raw,pc);b=decode(after,p,raw,pc);projections.push(b);prior.push(a);
      if(after.canonical(a)!==after.canonical(b)){
        assert(selected,'Changed a non-family field operation: '+p.id+'#'+pc);assert.equal(a.kind,'blocked');
        assert(['owned-condition','field-recovery'].includes(b.kind));
        changes.push({programId:p.id,pc,source:p.source,raw,selector:selector(raw),before:a,after:b,mapIds:index.mapIds});
      }
    }
    if(selected)familySites.push({programId:p.id,pc,domain:index.domain,source:p.source,raw,selector:selector(raw),before:a,after:b,mapIds:index.mapIds});
  }
  programs.push({...index,beforeProjectionSha256:index.domain==='field'?after.hash(prior):null,afterProjectionSha256:index.domain==='field'?after.hash(projections):null,
    ...(affected.has(p.id)?{data:p.data,beforeProjection:prior,afterProjection:projections}: {})});
  if(index.domain==='ai'){
    let source=null;try{source=sourceInputs.encounterSources.json(p.source.assetPath.split('/').at(-1).replace(/\.json$/,'')).source;}catch{}
    const compile=api=>{try{return{typed:api.compileBattleAI(p.data,source),error:null};}catch(error){return{typed:null,error:error.message};}},a=compile(before),b=compile(after);
    assert.equal(after.canonical(a),after.canonical(b),'Changed complete AI body');physicalAi.push({...p,rawHash:index.rawHash,...b});
  }
}
for(const p of sourceInputs.programs){
  const source=p.battleExportBinding.kind==='exact-battle-export-source-binding-v1'?p.battleExportBinding.source:null;
  const compile=api=>{try{return{typed:api.compileBattleEvent(p.data,source,sourceInputs.input,s.reader),error:null};}catch(error){return{typed:null,error:error.message};}},a=compile(before),b=compile(after);
  assert.equal(after.canonical(a),after.canonical(b),'Changed complete battle body');battlePrograms.push({...p,typed:b.typed,error:b.error});
}
const queue=[...affected],closure=new Set;
while(queue.length){const id=queue.shift();if(closure.has(id))continue;closure.add(id);assert(byId.has(id));queue.push(...byId.get(id).dependencyProgramIds);}
const completeBodies=[...closure].sort().map(id=>({...byId.get(id),data:rawById.get(id).data})),
  dependencies=sourceInputs.analysis.dependencies.filter(d=>closure.has(d.site.asset)),
  operandGroups=new Map;
for(const site of familySites){const key=after.canonical({selector:site.selector,operands:site.raw.operands}),g=operandGroups.get(key)??{selector:site.selector,operands:site.raw.operands,sites:[],before:site.before,after:site.after};
  g.sites.push({programId:site.programId,pc:site.pc,domain:site.domain});operandGroups.set(key,g);}
const counts={allPrograms:programs.length,allInstructions:programs.reduce((n,p)=>n+p.instructionCount,0),
  fieldPrograms:programs.filter(p=>p.domain==='field').length,fieldInstructions:programs.filter(p=>p.domain==='field').reduce((n,p)=>n+p.instructionCount,0),
  physicalAi:physicalAi.length,physicalAiInstructions:physicalAi.reduce((n,p)=>n+p.data.Mnemonics.length,0),physicalAiContainerErrors:physicalAi.filter(p=>p.error).length,
  battlePrograms:battlePrograms.length,battleInstructions:battlePrograms.reduce((n,p)=>n+p.data.Mnemonics.length,0),
  familySites:familySites.length,familyFieldSites:familySites.filter(p=>p.domain==='field').length,familyNonFieldSites:familySites.filter(p=>p.domain!=='field').length,
  familyPrograms:affected.size,operandGroups:operandGroups.size,affectedMaps:new Set(familySites.flatMap(p=>p.mapIds)).size,
  beforeBlocked:familySites.filter(p=>p.before?.kind==='blocked').length,afterBlocked:familySites.filter(p=>p.after?.kind==='blocked').length,
  changed:changes.length,retainedPriorPositiveSites:familySites.filter(p=>p.before&&p.before.kind!=='blocked'&&after.canonical(p.before)===after.canonical(p.after)).length,
  completeClosurePrograms:completeBodies.length,completeClosureInstructions:completeBodies.reduce((n,p)=>n+p.instructionCount,0),
  unresolvedDependencies:dependencies.filter(d=>!d.resolved).length};
assert.equal(counts.allPrograms,3304);assert.equal(counts.allInstructions,186003);assert.equal(counts.physicalAi,430);assert.equal(counts.physicalAiContainerErrors,1);
assert.equal(counts.familySites,360);assert.equal(counts.familyFieldSites,358);assert.equal(counts.operandGroups,66);
assert.equal(counts.beforeBlocked,30);assert.equal(counts.changed,17);assert.equal(counts.afterBlocked,13);
const report={kind:'source-owned-recovery-complete-source-differential-v1',runtimeSha256,sourceSetHash:s.sourceSetHash,sourceDigest:sourceInputs.sourceDigest,
  plannerInputSha256:sha(plannerBytes),registrySha256:sha(registryBytes),baselineCompiled:baseline,counts,family,changes,familySites,operandGroups:[...operandGroups.values()],
  programs,completeBodies,dependencies,physicalAi,battlePrograms,conditionMasterRows:s.tables['condition.csv'].map(row=>s.reader.row('condition.csv',row.id)),
  sourceProgramExecutions:0,producerExecutions:0,browserExecutions:0,sourceCampaignComplete:false};
assert.equal(await runtimeDigest(view,compiled),runtimeSha256,'Candidate runtime changed during complete-source comparison');
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report)+'\n');
console.log(JSON.stringify({counts,runtimeSha256,reportSha256:sha(await readFile(output))},null,2));
