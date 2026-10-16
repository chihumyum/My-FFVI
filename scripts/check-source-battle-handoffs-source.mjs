// Whole source differential only. No producer, gameplay execution, or native run.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy} from './source-battle-directory.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),options={inputRoot:root,compiledDir:'dist',beforeCompiledDir:null,output:'build/reports/source-battle-handoffs-source'};
const flags={'--input-root':'inputRoot','--compiled-dir':'compiledDir','--before-compiled-dir':'beforeCompiledDir','--output':'output'},seen=new Set();
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];assert(Object.hasOwn(flags,key)&&value&&!seen.has(key),'Unknown/missing/repeated checker option');seen.add(key);options[flags[key]]=value;}
assert(options.beforeCompiledDir,'Exact before compiler required');
const dist=resolve(root,options.compiledDir),beforeDist=resolve(root,options.beforeCompiledDir),inputRoot=resolve(root,options.inputRoot),out=resolve(root,options.output);assert(out.startsWith(resolve(root,'build/reports')+'/'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href),modules=['compiler/field','compiler/field-empty-message','compiler/battle-event','compiler/battle-source-format-import','compiler/battle-ai'];
const api=Object.assign({},...await Promise.all(modules.map(name=>load(dist,name)))),old=Object.assign({},...await Promise.all(modules.map(name=>load(beforeDist,name))));
const runtime=await runtimeDigest(root,dist),policyBytes=await readFile(resolve(inputRoot,'content-batches/source-battle-directory.policy.json')),
  policy=await readSourceBattleDirectoryPolicy({root:inputRoot,compiledDir:dist,policy:JSON.parse(policyBytes)}),selection={branchExecution:policy.framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:policy.framework.gauInstances};
const source=await loadBattleEventMessageSourceInputs(inputRoot,dist,selection),s=source.snapshot,{canonical,hash}=source.api,
  emptyOld=old.createFieldEmptyMessageLookup(source.input),emptyNew=api.createFieldEmptyMessageLookup(source.input),domains=new Map(source.analysis.scripts.map(p=>[p.id,p]));
const selectors=['コロシアム回復','コロシアム開始','バトルデータ復元：sc_b_0055','パーティ編成：ラストバトル'],sites=[],bindings=[],fieldBodies=[],aiPrograms=[],battleSites=[],battlePrograms=[];
let instructions=0,fieldInstructions=0,aiInstructions=0;
for(const p of source.scripts){const a=[],b=[];let changed=false;
  for(const[index,raw]of p.data.Mnemonics.entries()){
    const site={script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},next={nextMnemonic:p.data.Mnemonics[index+1]?.mnemonic??null},
      decode=(owner,empty)=>{try{return owner.decodeFieldOp(raw,site,s.messages,s.tables,{...next,emptyMessages:empty});}catch(error){return{kind:'static-field-decode-error',reason:error.message};}},before=decode(old,emptyOld),after=decode(api,emptyNew);
    a.push(after);b.push(before);instructions++;if(domains.get(p.id)?.domain==='field')fieldInstructions++;
    if(canonical(before)===canonical(after))continue;
    assert.equal(raw.type,1);assert.equal(raw.mnemonic,'SysCall');const selector=raw.operands.sValues[0];assert(selectors.includes(selector),'Unexpected whole-source Field change');assert.equal(before.kind,'blocked');
    assert.equal(after.kind,selector==='コロシアム開始'?'blocked':selector==='パーティ編成：ラストバトル'?'source-party-selection':'source-battle-handoff');
    if(selector==='コロシアム開始')assert.match(after.reason,/actual bet\/opponent/);
    changed=true;sites.push({programId:p.id,index,source:p.source,rawHash:hash(p.data),instructionRawHash:hash(raw),raw,before,after});
  }
  bindings.push({id:p.id,source:p.source,rawHash:hash(p.data),instructionCount:p.data.Mnemonics.length,fieldProjectionBefore:hash(b),fieldProjectionAfter:hash(a)});
  if(changed)fieldBodies.push({...p,rawHash:hash(p.data),before:b,after:a});
  if(!p.source.assetPath.includes('/MonsterAI/'))continue;
  const compile=owner=>{try{return{kind:'compiled-ai',program:owner.compileBattleAI(p.data,null)};}catch(error){return{kind:'unassessed-ai-encoding',name:error.name,reason:error.message};}},before=compile(old),after=compile(api);
  assert.equal(canonical(before),canonical(after),'Unrelated whole-source AI change');aiInstructions+=p.data.Mnemonics.length;aiPrograms.push({...p,rawHash:hash(p.data),before,after});
}
const oldFormat=old.createBattleSourceFormatImportResolver(s);
for(const p of source.programs){const binding=p.battleExportBinding,bound=binding.kind==='exact-battle-export-source-binding-v1'?binding.source:null,
  before=old.compileBattleEvent(p.data,bound,source.input,s.reader,selection.branchExecution,bound?oldFormat({data:p.data,source:bound}):undefined,selection.gauInstancePolicy),after=p.compiled;
  assert.equal(before.instructions.length,p.data.Mnemonics.length);assert.equal(after.instructions.length,p.data.Mnemonics.length);
  for(const[index,raw]of p.data.Mnemonics.entries()){
    const oldOp=before.instructions[index],newOp=after.instructions[index];if(canonical(oldOp)===canonical(newOp))continue;
    assert.equal(raw.type,1);assert.equal(raw.mnemonic,'SysCall');const selector=raw.operands.sValues[0];assert(['バトルデータ保存：sc_b_0055','LB:プレイヤーパーティ変更'].includes(selector),'Unexpected whole-source Battle change');
    assert.equal(oldOp.op.kind,'blocked');assert.equal(newOp.op.kind,selector==='バトルデータ保存：sc_b_0055'?'capture-source-0055':'source-final-player-switch');
    battleSites.push({programId:p.id,index,source:p.source,rawHash:hash(p.data),instructionRawHash:hash(raw),raw,before:oldOp,after:newOp});
  }
  battlePrograms.push({...p,before,after});
}
assert.equal(bindings.length,3304);assert.equal(instructions,186003);assert.equal(fieldInstructions,173026);assert.equal(aiPrograms.length,430);assert.equal(aiInstructions,10093);
assert.equal(sites.length,6);assert.equal(fieldBodies.length,6);assert.equal(fieldBodies.reduce((n,p)=>n+p.data.Mnemonics.length,0),954);
assert.equal(sites.filter(p=>p.after.kind==='blocked').length,1);assert.equal(battlePrograms.length,53);assert.equal(battleSites.length,4);
assert.equal(battleSites.filter(p=>p.after.op.kind==='capture-source-0055').length,1);assert.equal(battleSites.filter(p=>p.after.op.kind==='source-final-player-switch').length,3);
assert.equal(await runtimeDigest(root,dist),runtime,'Runtime changed during source inspection');assert.equal(sha(await readFile(resolve(inputRoot,'content-batches/source-battle-directory.policy.json'))),sha(policyBytes));
const selectedIds=new Set(fieldBodies.map(p=>p.id)),maps=source.analysis.maps.filter(m=>m.scripts.some(id=>selectedIds.has(id))||Object.values(m.residentScripts??{}).some(id=>selectedIds.has(id)));
const report={kind:'source-battle-final-menu-whole-source-differential-v1',runtimeSha256:runtime,sourceDigest:source.sourceDigest,sourceSetHash:s.sourceSetHash,
  sourcePolicy:{sha256:sha(policyBytes),declaration:policy},counts:{programs:3304,instructions,fieldInstructions,fieldChanges:6,fieldLowered:5,fieldChangedGate:1,fieldBodies:6,fieldBodyInstructions:954,maps:maps.length,
    battlePrograms:53,battleInstructions:battlePrograms.reduce((n,p)=>n+p.data.Mnemonics.length,0),battleChanges:4,battleCaptureSites:1,battleConsumerSites:3,aiPrograms:430,aiInstructions,aiChanges:0},
  sites,battleSites,allProgramBindings:bindings,completeOriginalFieldBodies:fieldBodies,completeOriginalMapClosures:maps,completeBattlePrograms:battlePrograms,completeBattleDependencies:source.dependencies,completeAIPrograms:aiPrograms,
  scope:{sourceStoryExecutions:0,worldProductions:0,originalGameExecuted:false,nativeTimingVerified:false,runtimeSourceAdmissionsClaimed:0,
    colosseumStart:'explicit actual bet/opponent/automatic-battle/settlement provider gate',colosseum601:'independent active/re-add lifecycle gate',
    source0055:'actual source instruction capture and same GameState return/restore only; non607 retained Type field-add lifecycle remains gated',
    finalMenu:'same actual owned UI transaction produces waiting IDs, including cancellation',finalConsumer:'same existing Web borrowed player resources, partial retirement and event clock; not a complete-group replacement',
    nativeFinalFlag3Result:'independent original source final result path remains gated',normalSourceRootReachability:'unverified; no middle-PC start or injected story prerequisite'}};
await mkdir(out,{recursive:true});await writeFile(resolve(out,'report.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify({counts:report.counts,runtimeSha256:runtime,reportSha256:sha(await readFile(resolve(out,'report.json'))),scope:report.scope}));
