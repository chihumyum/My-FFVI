// Full-source differential only: no production, source-story execution or native run.
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy} from './source-battle-directory.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),options={inputRoot:root,compiledDir:'dist',beforeCompiledDir:null,output:'build/reports/ai-internal-clocks-source'};
const flags={'--input-root':'inputRoot','--compiled-dir':'compiledDir','--before-compiled-dir':'beforeCompiledDir','--output':'output'},seen=new Set();
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert(Object.hasOwn(flags,k)&&v&&!seen.has(k),'Unknown/missing/repeated checker option');seen.add(k);options[flags[k]]=v;}
assert(options.beforeCompiledDir,'An exact before compiler is required');
const dist=resolve(root,options.compiledDir),beforeDist=resolve(root,options.beforeCompiledDir),inputRoot=resolve(root,options.inputRoot),out=resolve(root,options.output);assert(out.startsWith(resolve(root,'build/reports')+'/'));
const sha=b=>createHash('sha256').update(b).digest('hex'),load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href);
const modules=['compiler/field','compiler/field-empty-message','compiler/battle-event','compiler/battle-source-format-import','compiler/battle-ai'];
const api=Object.assign({},...await Promise.all(modules.map(n=>load(dist,n)))),old=Object.assign({},...await Promise.all(modules.map(n=>load(beforeDist,n))));
const runtime=await runtimeDigest(root,dist),policyBytes=await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')),policy=await readSourceBattleDirectoryPolicy({root:inputRoot,compiledDir:dist,policy:JSON.parse(policyBytes)});
const selection={branchExecution:policy.framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:policy.framework.gauInstances};
const source=await loadBattleEventMessageSourceInputs(inputRoot,dist,selection),s=source.snapshot,{canonical,hash}=source.api;
assert.equal(source.scripts.length,3304);assert.equal(source.inventory.counts.allInstructions,186003);assert.equal(source.programs.length,53);
const emptyOld=old.createFieldEmptyMessageLookup(source.input),emptyNew=api.createFieldEmptyMessageLookup(source.input),domains=new Map(source.analysis.scripts.map(p=>[p.id,p]));
const sites=[],bindings=[],bodies=[],aiPrograms=[];let fieldInstructions=0,instructions=0,aiInstructions=0;
for(const p of source.scripts){const a=[],b=[];
 for(const[index,raw]of p.data.Mnemonics.entries()){
  const site={script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},next={nextMnemonic:p.data.Mnemonics[index+1]?.mnemonic??null};
  const decode=(owner,empty)=>{try{return owner.decodeFieldOp(raw,site,s.messages,s.tables,{...next,emptyMessages:empty});}catch(e){return{kind:'static-field-decode-error',reason:e.message};}};
  const before=decode(old,emptyOld),after=decode(api,emptyNew);assert.equal(canonical(before),canonical(after),'Unrelated full-source Field lowering changed '+p.id+':'+index);a.push(after);b.push(before);instructions++;if(domains.get(p.id)?.domain==='field')fieldInstructions++;
 }
 bindings.push({id:p.id,source:p.source,rawHash:hash(p.data),instructionCount:p.data.Mnemonics.length,fieldProjectionBefore:hash(b),fieldProjectionAfter:hash(a)});
 if(!p.source.assetPath.includes('/MonsterAI/'))continue;
 const compile=owner=>{try{return{kind:'compiled-ai',program:owner.compileBattleAI(p.data,null)};}catch(e){return{kind:'unassessed-ai-encoding',name:e.name,reason:e.message};}};
 const before=compile(old),after=compile(api);aiInstructions+=p.data.Mnemonics.length;
 if(before.kind!=='compiled-ai'||after.kind!=='compiled-ai')assert.equal(canonical(before),canonical(after),'AI encoding error changed');
 else{
  assert.equal(canonical({...before.program,instructions:[]}),canonical({...after.program,instructions:[]}),'Unrelated AI program header changed');
  assert.equal(before.program.instructions.length,p.data.Mnemonics.length);assert.equal(after.program.instructions.length,p.data.Mnemonics.length);
  let nominated=false;
  for(const[index,raw]of p.data.Mnemonics.entries()){
   const oldOp=before.program.instructions[index],newOp=after.program.instructions[index];
   if(canonical(oldOp)===canonical(newOp))continue;
   assert.equal(raw.type,1);assert(['Nop','Blank'].includes(raw.mnemonic));assert.equal(oldOp.op.kind,'blocked');
   assert.equal(newOp.op.kind,raw.mnemonic==='Nop'?'nop':'blank');nominated=true;
   sites.push({programId:p.id,index,source:p.source,programRawHash:hash(p.data),instructionRawHash:hash(raw),raw,before:oldOp,after:newOp,
    phaseAdmission:raw.mnemonic==='Blank'?{initial:'same existing Battle clock continuation',normal:'whole candidate until Sync; one queue/RNG publication',reaction:'explicit prepared-parent-action transaction gate',final:'explicit prepared-parent-action transaction gate'}:{internal:'Next without reading old operand banks'}});
  }
  if(nominated)bodies.push({...p,rawHash:hash(p.data),before,after});
 }
 aiPrograms.push({programId:p.id,source:p.source,rawHash:hash(p.data),before,after});
}
assert.equal(instructions,186003);assert.equal(fieldInstructions,173026);assert.equal(aiPrograms.length,430);assert.equal(aiInstructions,10093);
assert.equal(sites.length,51);const blank=sites.filter(p=>p.raw.mnemonic==='Blank'),nop=sites.filter(p=>p.raw.mnemonic==='Nop');
assert.equal(blank.length,46);assert.equal(new Set(blank.map(p=>p.programId)).size,44);assert.equal(nop.length,5);assert.equal(new Set(nop.map(p=>p.programId)).size,2);
assert.equal(aiPrograms.filter(p=>p.after.kind==='unassessed-ai-encoding').length,1);
const oldFormat=old.createBattleSourceFormatImportResolver(s);
for(const p of source.programs){const binding=p.battleExportBinding,bound=binding.kind==='exact-battle-export-source-binding-v1'?binding.source:null;
 assert(['exact-battle-export-source-binding-v1','unbound-battle-export-source-v1'].includes(binding.kind));
 const before=old.compileBattleEvent(p.data,bound,source.input,s.reader,selection.branchExecution,bound?oldFormat({data:p.data,source:bound}):undefined,selection.gauInstancePolicy);
 assert.equal(canonical(before),canonical(p.compiled),'Unrelated full Battle program changed '+p.id);
}
assert.equal(await runtimeDigest(root,dist),runtime,'Runtime changed during full-source inspection');assert.equal(sha(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'))),sha(policyBytes));
const report={kind:'ai-internal-clock-full-source-differential-v1',runtimeSha256:runtime,sourceDigest:source.sourceDigest,sourceSetHash:s.sourceSetHash,
 sourcePolicy:{sha256:sha(policyBytes),declaration:policy},counts:{programs:3304,instructions,fieldInstructions,fieldChanges:0,aiPrograms:430,aiInstructions,changedAIInstructions:51,blankSites:46,blankPrograms:44,nopSites:5,nopPrograms:2,aiUnassessedEncodings:1,completeOriginalBodies:bodies.length,bodyInstructions:bodies.reduce((n,p)=>n+p.data.Mnemonics.length,0),battlePrograms:53,battleInstructions:2312,battleChanges:0,battleUnboundExports:source.programs.filter(p=>p.battleExportBinding.kind!=='exact-battle-export-source-binding-v1').length},
 sites,allProgramBindings:bindings,completeAIPrograms:aiPrograms,completeOriginalBodies:bodies,completeBattlePrograms:source.programs,completeBattleDependencies:source.dependencies,
 scope:{all46BlankSitesRetained:true,all5LegacyNopSitesRetained:true,initialAndNormalContinuation:'Web-controlled-mechanism-tests',reactionAndFinalContinuation:'explicit actual Battle gate; pure route is independent',nativeTimingVerified:false,originalGameExecuted:false,sourceStoryExecutions:0,runtimeSourceAdmissionsClaimed:0,worldProductions:0,publications:0}};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'report.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify({counts:report.counts,runtimeSha256:runtime,reportSha256:sha(await readFile(resolve(out,'report.json'))),scope:report.scope}));
