// Whole-source inspection. No world compilation, entry override or publication.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {sourceMigrationFieldContext} from './source-migration-input.mjs';
const load=(dist,name)=>import(pathToFileURL(resolve(dist,'src',name+'.js')).href);
export async function readSourceStoryExecutionGraph({sourceRoot,sourceCompiled=resolve(sourceRoot,'dist'),graphCompiled=resolve(import.meta.dirname,'../dist')}){
 const sourceRuntime=await runtimeDigest(sourceRoot,sourceCompiled),
  [{loadBattleEventMessageSourceInputs},{readSourceBattleDirectoryPolicy},compiler,...modules]=await Promise.all([
   import(pathToFileURL(resolve(sourceRoot,'scripts/battle-event-message-source-inputs.mjs'))),
   import(pathToFileURL(resolve(sourceRoot,'scripts/source-battle-directory.mjs'))),load(graphCompiled,'compiler/source-story-execution-graph'),
   ...['compiler/field','compiler/field-empty-message','compiler/battle-ai','compiler/system-messages','compiler/map-package'].map(n=>load(sourceCompiled,n))]),
  policy=JSON.parse(await readFile(resolve(sourceRoot,'content-batches/source-battle-directory.policy.json'))),
  {framework}=await readSourceBattleDirectoryPolicy({root:sourceRoot,compiledDir:sourceCompiled,policy}),
  source=await loadBattleEventMessageSourceInputs(sourceRoot,sourceCompiled,{branchExecution:framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:framework.gauInstances}),
  api=Object.assign({},source.api,...modules),messages=await api.loadSystemMessages(sourceRoot,source.inventory.parentSourceSetHash,source.snapshot.manifest.sources),
  fieldContext=sourceMigrationFieldContext(source,messages),emptyMessages=api.createFieldEmptyMessageLookup(source.input),
  analysisDomains=new Map(source.analysis.scripts.map(p=>[p.id,p.domain])),aliasOwners=new Map(),maps=api.bindMapPackages(source.snapshot.assets,source.snapshot.tables),
  fieldIds=new Set(source.analysis.scripts.filter(p=>p.domain==='field').map(p=>p.id)),battle=new Map(source.programs.map(p=>[p.id,p]));
 for(const map of maps)for(const id of Object.values({...map.residentScripts,...map.scriptAliases}))if(id){fieldIds.add(id);const ids=aliasOwners.get(id)??new Set();ids.add(Number(map.id));aliasOwners.set(id,ids);}
 const programs=source.scripts.map(p=>{
  let domain=fieldIds.has(p.id)?'field':battle.has(p.id)?'battle':p.source.assetPath.includes('/MonsterAI/')?'ai':'unassessed',instructions,diagnostics=[];
  if(domain==='field')instructions=p.data.Mnemonics.map((raw,index)=>{try{return api.decodeFieldOp(raw,{script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},fieldContext.messages,source.snapshot.tables,{nextMnemonic:p.data.Mnemonics[index+1]?.mnemonic??null,emptyMessages});}
   catch(error){return {kind:'blocked',script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index},mnemonic:raw.mnemonic,reason:error.message};}});
  else if(domain==='battle'){const compiled=battle.get(p.id).compiled;instructions=compiled.instructions.map(i=>i.op);diagnostics=compiled.blockers;}
  else if(domain==='ai'){try{const compiled=api.compileBattleAI(p.data,null);instructions=compiled.instructions.map(i=>i.op);diagnostics=compiled.blockers;}
   catch(error){instructions=p.data.Mnemonics.map(()=>({kind:'unassessed'}));diagnostics=[error.message];}}
  else instructions=p.data.Mnemonics.map(()=>({kind:'unassessed'}));
  return {id:p.id,domain,domainEvidence:{analysisDomain:analysisDomains.get(p.id)??null,fieldAliasMapIds:[...(aliasOwners.get(p.id)??[])].sort((a,b)=>a-b),binding:'actual-compileWorld-map-and-resident-alias-namespace'},source:p.source,raw:p.data,instructions,diagnostics};
 });
 const graph=compiler.compileSourceStoryExecutionGraph({sourceSetHash:source.snapshot.sourceSetHash,sourceDigest:source.sourceDigest,runtimeHash:sourceRuntime,
  assets:source.snapshot.assets,tables:source.snapshot.tables,programs});
 assert.equal(graph.counts.programs,source.inventory.counts.allPrograms);assert.equal(graph.counts.instructions,source.inventory.counts.allInstructions);
 assert.equal(await runtimeDigest(sourceRoot,sourceCompiled),sourceRuntime);
 const current=await api.loadSystemSource(sourceRoot,source.inventory.parentSourceSetHash);
 assert.equal(api.hash({assets:current.assets,tables:current.tables,messages:current.messages,manifest:current.manifest}),source.sourceDigest);
 return {graph,binding:{sourceRuntimeSha256:sourceRuntime,sourceSetHash:graph.sourceSetHash,sourceDigest:graph.sourceDigest,
  fieldDecodeContext:{...fieldContext,messages:undefined},graphCompiler:{module:'src/compiler/source-story-execution-graph.js',sha256:createHash('sha256').update(await readFile(resolve(graphCompiled,'src/compiler/source-story-execution-graph.js'))).digest('hex')},sourceBattlePolicySha256:createHash('sha256').update(await readFile(resolve(sourceRoot,'content-batches/source-battle-directory.policy.json'))).digest('hex')},api};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){assert(['--source-root','--source-compiled','--graph-compiled','--output'].includes(args[i])&&args[i+1]);assert(!Object.hasOwn(o,args[i]));o[args[i]]=args[i+1];}
 assert(o['--source-root']&&o['--output']);const output=resolve(o['--output']);
 const {graph,binding}=await readSourceStoryExecutionGraph({sourceRoot:resolve(o['--source-root']),...(o['--source-compiled']?{sourceCompiled:resolve(o['--source-compiled'])}:{}),...(o['--graph-compiled']?{graphCompiled:resolve(o['--graph-compiled'])}:{})});
 await mkdir(resolve(output,'..'),{recursive:true});const bytes=Buffer.from(JSON.stringify({graph,binding})+'\n');await writeFile(output,bytes);
 console.log(JSON.stringify({result:'complete-source-execution-obligations-not-story-completion',counts:graph.counts,artifact:output,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentHash:graph.contentHash,sourceCampaignComplete:false,worldCompilations:0}));
}
