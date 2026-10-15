// Whole physical family: raw programs remain evidence, never replaced by the
// separately labelled controlled source-site execution envelope below.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--baseline-compiled','--report'].includes(args[i])&&args[i+1]);options[args[i]]=args[i+1];}
assert(options['--baseline-compiled']&&options['--report'],'Use --baseline-compiled dir --report ignored/path.json');
const compiled=resolve(root,'dist'),baseline=resolve(root,options['--baseline-compiled']),out=resolve(root,options['--report']);
assert(out.startsWith(resolve(root,'build')+'/'),'Report must remain ignored');
const load=(base,name)=>import(pathToFileURL(resolve(base,name+'.js')).href);
const [{loadCorpus,analyzeCorpus},{decodeFieldOp},{decodeFieldOp:before},{hash,canonical},{loadSystemMessages},
 {FieldGame},{EventState},{checkpointFixture},{sourceStandaloneWaitSelector}]=await Promise.all([
 load(compiled,'src/compiler/corpus'),load(compiled,'src/compiler/field'),load(baseline,'src/compiler/field'),
 load(compiled,'src/compiler/content'),load(compiled,'src/compiler/system-messages'),load(compiled,'src/core/field'),
 load(compiled,'src/core/event-state'),load(compiled,'tests/fixtures/checkpoint-game'),load(compiled,'src/compiler/field-standalone-wait')]);
const runtime=await runtimeDigest(root,compiled),corpus=await loadCorpus(root),rawHash=hash(corpus),
 system=await loadSystemMessages(root,corpus.manifest.parentSourceSetHash,corpus.manifest.sources),messages={...corpus.messages,system_zhc:system.messages},
 analysis=analyzeCorpus(corpus.assets,corpus.tables,messages,corpus.sourceSetHash),programs=corpus.assets.filter(a=>a.kind==='script'),
 selected=programs.filter(p=>p.data.Mnemonics.some(raw=>raw.mnemonic==='SysCall'&&raw.operands?.sValues?.[0]===sourceStandaloneWaitSelector)),sites=[],retained=[],changes=[];
const decode=(fn,raw,site)=>{try{return fn(raw,site,messages,corpus.tables);}catch(error){return {kind:'compiler-exception',message:error.message};}};
for(const p of selected){
 const row=analysis.scripts.find(r=>r.id===p.id);assert(row);
 const complete=p.data.Mnemonics.map((raw,index)=>{
  const site={script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},old=decode(before,raw,site),typed=decode(decodeFieldOp,raw,site),isWait=raw.mnemonic==='SysCall'&&raw.operands?.sValues?.[0]===sourceStandaloneWaitSelector;
  if(isWait){assert.equal(row.domain,'field');assert.equal(old.kind,'blocked');assert.equal(typed.kind,'standalone-wait');changes.push(site);
   const content=checkpointFixture().field;content.scripts={controlled:[typed,{kind:'flag',ref:{category:'ScenarioFlag1',index:40},operation:'set',...site},{kind:'exit',...site}]};
   const events=EventState.initialized(),field=new FieldGame(content,events);events.write({category:'MapLocalVariable',index:7},35);field.startEvent('controlled');
   assert.equal(events.read({category:'ScenarioFlag1',index:40}),0);assert.equal(field.checkpointReady,false);field.advance(30);assert.equal(events.read({category:'ScenarioFlag1',index:40}),0);
   field.advance(10);assert.equal(field.stop,null);assert.equal(events.read({category:'ScenarioFlag1',index:40}),1);assert.equal(field.checkpointReady,true);
   const checkpoint=field.checkpoint();assert.deepEqual(FieldGame.restore(content,JSON.parse(JSON.stringify(checkpoint))).checkpoint(),checkpoint);
   sites.push({site,raw,rawHash:hash(raw),typed,execution:{kind:'controlled-original-op-envelope',sourceProgramExecuted:false,mapLocal7:35,resumedAtMilliseconds:40,stableRestore:true}});
  }else assert.equal(canonical(old),canonical(typed),'Unrelated instruction changed: '+p.id+':'+index);
  return {index,raw,typed};
 });
 retained.push({...p,rawHash:hash(p.data),analysis:row,completeInstructions:complete});
}
assert.equal(programs.length,3304);assert.equal(programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
assert.equal(selected.length,32);assert.equal(sites.length,51);assert.equal(await runtimeDigest(root,compiled),runtime);assert.equal(hash(await loadCorpus(root)),rawHash);
const body={kind:'all-source-standalone-wait-family-v1',result:'passed-static-and-controlled-sites',runtimeSha256:runtime,sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,rawCorpusHash:rawHash,
 counts:{allPrograms:programs.length,allInstructions:186003,affectedPrograms:selected.length,completeInstructions:selected.reduce((n,p)=>n+p.data.Mnemonics.length,0),sites:sites.length,typedSites:changes.length,controlledSiteExecutions:sites.length,completeSourceProgramsExecuted:0},
 programs:retained,sites,nativeDynamicVerified:false,browserVerified:false,sourceCampaignComplete:false};await mkdir(resolve(out,'..'),{recursive:true});await writeFile(out,JSON.stringify({...body,contentHash:hash(body)}));console.log(JSON.stringify({result:body.result,counts:body.counts,report:out,runtimeSha256:runtime}));
