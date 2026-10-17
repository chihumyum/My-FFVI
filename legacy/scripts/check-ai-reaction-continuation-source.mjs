// The complete source inventory remains unchanged. Pure source-root traces and
// authored actual-Battle tests are separate evidence; neither proves story play.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy} from './source-battle-directory.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),options={inputRoot:root,beforeCompiled:null,output:'build/reports/ai-reaction-continuation-source'};
const flags={'--input-root':'inputRoot','--before-compiled':'beforeCompiled','--output':'output'},seen=new Set();
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert(Object.hasOwn(flags,k)&&v&&!seen.has(k));seen.add(k);options[flags[k]]=v;}
assert(options.beforeCompiled,'Exact before compiled directory is required');
const beforeDist=resolve(root,options.beforeCompiled),dist=resolve(root,'dist'),inputRoot=resolve(root,options.inputRoot),out=resolve(root,options.output);
assert(out.startsWith(resolve(root,'build/reports')+'/'));
const sha=b=>createHash('sha256').update(b).digest('hex'),load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href),runtime=await runtimeDigest(root,dist),beforeRuntime=await runtimeDigest(resolve(beforeDist,'..'),beforeDist);
const policyBytes=await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')),
 policy=await readSourceBattleDirectoryPolicy({root:inputRoot,compiledDir:dist,policy:JSON.parse(policyBytes)}),
 selection={branchExecution:policy.framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:policy.framework.gauInstances},
 input=await loadBattleEventMessageSourceInputs(inputRoot,dist,selection),s=input.snapshot,{canonical,hash}=input.api;
const names=['compiler/field','compiler/field-empty-message','compiler/battle-event','compiler/battle-source-format-import','compiler/battle-ai','compiler/system-messages','core/battle-ai','core/enemy-behavior'],
 api=Object.assign({},...await Promise.all(names.map(n=>load(dist,n)))),old=Object.assign({},...await Promise.all(names.map(n=>load(beforeDist,n))));
const system=await api.loadSystemMessages(inputRoot,input.inventory.parentSourceSetHash,s.manifest.sources),messages={...s.messages,system_zhc:system.messages};
const empty=api.createFieldEmptyMessageLookup(input.input),oldEmpty=old.createFieldEmptyMessageLookup(input.input),bindings=[],programs=[],traces=[];
function trace(owner,program){
 const context={clock:0,self:{hp:10000,mp:10000,monsterId:1,behavior:owner.initialEnemyBehavior()},conditionIds:[],players:[{level:1}],enemies:[{level:1}]};
 const finish=(run)=>{try{let turn=run();for(let i=0;turn.state.continuation&&i<100;i++)turn=owner.resumeBattleAI(program,turn.state,{...context,clock:(i+1)*10});return{kind:turn.state.continuation?'bounded-unfinished-source-clock':'source-sync-or-exit',turn};}catch(error){return{kind:'source-gate',name:error.name,reason:error.message};}};
 const initial=finish(()=>owner.startBattleAI(program,context));
 if(initial.kind!=='source-sync-or-exit'||initial.turn.state.status!=='waiting')return{initial};
 const next={...context,clock:1010,self:{...context.self,behavior:initial.turn.behavior}},finishWake=(run,wakeContext=next)=>{try{let turn=run();for(let i=0;turn.state.continuation&&i<100;i++)turn=owner.resumeBattleAI(program,turn.state,{...wakeContext,clock:1020+i*10});return{kind:turn.state.continuation?'bounded-unfinished-source-clock':'source-sync-or-exit',turn};}catch(error){return{kind:'source-gate',name:error.name,reason:error.message};}};
 return{initial,normal:finishWake(()=>owner.planBattleAITurn(program,initial.turn.state,next)),received:finishWake(()=>owner.planBattleAIReaction(program,initial.turn.state,next,{counterReady:true,receivedAbilityId:1,receivedSystemId:1,receivedAbilityTypeId:1})),final:finishWake(()=>owner.planBattleAIReaction(program,initial.turn.state,{...next,self:{...next.self,hp:0}},{counterReady:false,finalReady:true,receivedAbilityId:1,receivedSystemId:1,receivedAbilityTypeId:1}),{...next,self:{...next.self,hp:0}})};
}
let instructions=0,aiInstructions=0,fieldChanges=0;
for(const p of input.scripts){const beforeOps=[],afterOps=[];
 for(const[index,raw]of p.data.Mnemonics.entries()){
  const site={script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},next={nextMnemonic:p.data.Mnemonics[index+1]?.mnemonic??null};
  const decode=(owner,lookup)=>{try{return owner.decodeFieldOp(raw,site,messages,s.tables,{...next,emptyMessages:lookup});}catch(error){return{kind:'source-field-decode-error',reason:error.message};}};
  const a=decode(old,oldEmpty),b=decode(api,empty);assert.equal(canonical(a),canonical(b),'Field IR changed '+p.id+':'+index);beforeOps.push(a);afterOps.push(b);instructions++;
 }
 bindings.push({id:p.id,source:p.source,rawHash:hash(p.data),instructionCount:p.data.Mnemonics.length,beforeFieldHash:hash(beforeOps),afterFieldHash:hash(afterOps)});
 if(!p.source.assetPath.includes('/MonsterAI/'))continue;
 const compile=owner=>{try{return{kind:'compiled-ai',program:owner.compileBattleAI(p.data,null)};}catch(error){return{kind:'unassessed-ai-encoding',reason:error.message};}},a=compile(old),b=compile(api);
 assert.equal(canonical(a),canonical(b),'AI source IR changed '+p.id);programs.push({...p,rawHash:hash(p.data),before:a,after:b});aiInstructions+=p.data.Mnemonics.length;
 if(a.kind==='compiled-ai'){const before=trace(old,a.program),after=trace(api,b.program);assert.equal(canonical(before),canonical(after),'Unrelated complete source-root route changed '+p.id);traces.push({programId:p.id,source:p.source,before,after});}
}
const oldFormat=old.createBattleSourceFormatImportResolver(s);
for(const p of input.programs){const bound=p.battleExportBinding.kind==='exact-battle-export-source-binding-v1'?p.battleExportBinding.source:null;
 const a=old.compileBattleEvent(p.data,bound,input.input,s.reader,selection.branchExecution,bound?oldFormat({data:p.data,source:bound}):undefined,selection.gauInstancePolicy);
 assert.equal(canonical(a),canonical(p.compiled),'Battle source IR/gate changed '+p.id);
}
assert.equal(input.scripts.length,3304);assert.equal(instructions,186003);assert.equal(programs.length,430);assert.equal(aiInstructions,10093);assert.equal(input.programs.length,53);
assert.equal(await runtimeDigest(root,dist),runtime);assert.equal(await runtimeDigest(resolve(beforeDist,'..'),beforeDist),beforeRuntime);
assert.equal(sha(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'))),sha(policyBytes));
const report={kind:'source-ai-reaction-continuation-full-source-differential-v1',result:'passed',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,sourceDigest:input.sourceDigest,sourceSetHash:s.sourceSetHash,
 fieldDecodeContext:{systemMessageSource:system.source,systemMessageHash:hash(system.messages)},counts:{allPrograms:3304,allInstructions:instructions,aiPrograms:430,aiInstructions,changedAIInstructions:0,fieldChanges,battlePrograms:53,battleInstructions:2312,battleChanges:0,unassessedAIEncodings:programs.filter(p=>p.after.kind!=='compiled-ai').length,blankSites:46,blankPrograms:44},allSourceBindings:bindings,completeAIPrograms:programs,completeBattlePrograms:input.programs,completeBattleDependencies:input.dependencies,
 naturalSourceRootTraces:traces,scope:{sourceStoryExecutions:0,sourceCampaignComplete:false,worldProductions:0,publications:0,browserVerified:false,nativeTimingVerified:false,pureRoutes:'original program entry to first Sync plus one original normal/received/Final path, bounded to 100 continuation clocks, with explicitly controlled parameter values; no arbitrary middle PC',actualParentLifecycle:'authored actual Battle/Session tests only; individual original ability/condition/target gates are retained'}};
await mkdir(out,{recursive:true});const path=resolve(out,'report.json');await writeFile(path,JSON.stringify(report)+'\n');console.log(JSON.stringify({result:report.result,runtimeSha256:runtime,counts:report.counts,artifact:{path,bytes:(await readFile(path)).length,sha256:sha(await readFile(path))},scope:report.scope}));
