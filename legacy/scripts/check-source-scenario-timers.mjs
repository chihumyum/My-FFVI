// Whole source static differential. No source-story execution, world producer or publication.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
const opts={},args=process.argv.slice(2);assert.equal(args.length%2,0);
for(let i=0;i<args.length;i+=2){assert(['--before-root','--inventory','--nomination','--output'].includes(args[i]));assert(!Object.hasOwn(opts,args[i]));opts[args[i]]=args[i+1];}
for(const key of ['--before-root','--inventory','--nomination'])assert(opts[key],key+' required');
const root=resolve(import.meta.dirname,'..'),before=resolve(opts['--before-root']),dist=resolve(root,'dist'),oldDist=resolve(before,'dist'),sha=b=>createHash('sha256').update(b).digest('hex');
const output=resolve(opts['--output']??resolve(root,'build/reports/source-scenario-timers/report.json'));assert(output.startsWith(resolve(root,'build/reports')+'/'));
const [ib,nb]=await Promise.all([readFile(resolve(opts['--inventory'])),readFile(resolve(opts['--nomination']))]),inventory=JSON.parse(ib),nomination=JSON.parse(nb),runtime=await runtimeDigest(root),baseRuntime=await runtimeDigest(before);
assert.equal(baseRuntime,nomination.sourceRuntimeSha256);assert.equal(inventory.runtimeSha256,baseRuntime);assert.equal(inventory.result,'passed');
const load=(directory,name)=>import(pathToFileURL(resolve(directory,'src',name+'.js')).href),names=['compiler/content','compiler/field','compiler/field-empty-message','compiler/battle-event','compiler/battle-source-format-import','compiler/battle-event-message-bindings','compiler/battle-ai','compiler/battle-ability-content','compiler/source-catalog-name','compiler/system-source','compiler/integrity','compiler/system-messages','compiler/map-package'];
const owner=async directory=>Object.assign({},...await Promise.all(names.map(name=>load(directory,name)))),[old,current]=await Promise.all([owner(oldDist),owner(dist)]),{hash,canonical}=current;
const source=await current.loadSystemSource(before,nomination.parentSourceSetHash),sourceDigest=hash({assets:source.assets,tables:source.tables,messages:source.messages,manifest:source.manifest});
assert.equal(sourceDigest,inventory.sourceDigest);assert.equal(source.sourceSetHash,nomination.sourceSetHash);
const files=await current.readSnapshot(resolve(before,'build/field')),field=JSON.parse(current.snapshotFile(files,'field.json').toString()),
 messageInput=current.bindBattleEventMessageInput(field,source,source.tables['character_default_name.csv'].map(row=>source.reader.row('character_default_name.csv',row.id))),
 system=await current.loadSystemMessages(before,source.manifest.parentSourceSetHash,source.manifest.sources),messages={...source.messages,system_zhc:system.messages},
 lookupOld=old.createFieldEmptyMessageLookup(messageInput),lookupNew=current.createFieldEmptyMessageLookup(messageInput),domains=new Map(inventory.allProgramBindings.map(row=>[row.id,row.domain])),
 physical=new Map(source.assets.map(asset=>[asset.id,asset])),oldBindings=new Map(inventory.allProgramBindings.map(row=>[row.id,row])),nominated=new Map(nomination.sites.map(site=>[site.program+':'+site.pc,site])),changes=[],bindings=[],selectedIds=new Set();
assert.equal(nomination.allSourceInventory.length,3304);assert.equal(inventory.completeRawSourcePrograms.length,3304);
let all=0,fieldCount=0,nonFieldChanges=0;
for(const prior of nomination.allSourceInventory){const asset=physical.get(prior.id);assert(asset);assert.equal(hash(asset.data),prior.rawHash);assert.equal(canonical(asset.source),canonical(prior.source));}
for(const program of inventory.completeRawSourcePrograms){const asset=physical.get(program.id);assert(asset);assert.equal(hash(asset.data),hash(program.data));assert.equal(canonical(asset.source),canonical(program.source));const raw=program.data.Mnemonics,from=[],to=[];
 for(const[pc,instruction]of raw.entries()) {all++;if(domains.get(program.id)==='field')fieldCount++;
  const site={script:program.id,index:pc,source:{...program.source,pointer:'/Mnemonics/'+pc}},baseContext={nextMnemonic:raw[pc+1]?.mnemonic??null},decode=(api,lookup)=>{
   try{return api.decodeFieldOp(instruction,site,messages,source.tables,{...baseContext,...(domains.get(program.id)==='field'?{emptyMessages:lookup}:{})});}
   catch(error){return{kind:'static-field-decode-error',error:{name:error.name,message:error.message},raw:instruction};}
  },beforeOp=decode(old,lookupOld),afterOp=decode(current,lookupNew),expected=nominated.get(program.id+':'+pc);from.push(beforeOp);to.push(afterOp);
  if(expected){assert.equal(canonical(instruction),canonical(expected.raw));assert.equal(beforeOp.kind,'blocked');assert.equal(afterOp.kind,instruction.operands.sValues[0]==='タイマー表示'?'source-field-ui':'field-scenario-timer');assert.notEqual(canonical(beforeOp),canonical(afterOp));selectedIds.add(program.id);changes.push({programId:program.id,pc,raw:instruction,source:site.source,before:beforeOp,after:afterOp});if(domains.get(program.id)!=='field')nonFieldChanges++;}
  else assert.equal(canonical(afterOp),canonical(beforeOp),'Unrelated Field projection changed '+program.id+':'+pc);
 }
 assert.equal(hash(from),oldBindings.get(program.id).afterFieldHash,'Original v129 production context differs: '+program.id);
 bindings.push({id:program.id,source:program.source,rawHash:hash(program.data),instructions:raw.length,domain:domains.get(program.id),beforeFieldHash:hash(from),afterFieldHash:hash(to)});
}
assert.equal(all,186003);assert.equal(fieldCount,173026);assert.equal(changes.length,14);assert.equal(nonFieldChanges,0);assert.equal(selectedIds.size,8);
const maps=current.bindMapPackages(source.assets,source.tables);assert.equal(maps.length,649);const selectedMaps=maps.filter(map=>map.scripts.some(id=>selectedIds.has(id))),closureIds=new Set(),callbackBindings=[];
for(const map of selectedMaps){const oldMap=inventory.completeMapClosures.find(row=>row.id===map.id);assert(oldMap);for(const id of [oldMap.packageId,...Object.values(oldMap.groups),...oldMap.closure])if(id)closureIds.add(id);
 if(map.scripts.some(id=>changes.some(site=>site.programId===id&&site.after.kind==='field-scenario-timer'&&site.after.command==='shadow-setup'))){const id=Object.hasOwn(map.scriptAliases,'sc_secede_shadow')?map.scriptAliases.sc_secede_shadow:map.residentScripts.sc_secede_shadow;assert(id);const callback=physical.get(id);assert(callback?.kind==='script');assert.equal(callback.data.Mnemonics.length,4);closureIds.add(id);callbackBindings.push({mapId:map.id,name:map.name,callbackId:id,source:callback.source,rawHash:hash(callback.data)});}}
const battleInput=messageInput,framework=JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'),'utf8')).framework,battlePrograms=[];
for(const p of inventory.completeBattlePrograms){const binding=p.battleExportBinding,sourceBinding=binding.kind==='exact-battle-export-source-binding-v1'?binding.source:null,compile=api=>api.compileBattleEvent(p.data,sourceBinding,battleInput,source.reader,framework.branchExecution,
 sourceBinding?api.createBattleSourceFormatImportResolver(source)({data:p.data,source:sourceBinding}):undefined,framework.gauInstances),from=compile(old),to=compile(current);assert.equal(canonical(from),canonical(to),'Battle IR changed');assert.equal(canonical(to),canonical(p.after),'v129 Battle 0055/final content changed');battlePrograms.push({id:p.id,rawHash:hash(p.data),irHash:hash(to),source:p.source});}
assert.equal(battlePrograms.length,53);
const aiPrograms=[];for(const p of inventory.completeAIPrograms){const compile=api=>{try{return{kind:'compiled-ai',program:api.compileBattleAI(p.data,null)}}catch(error){return{kind:'unassessed-ai-encoding',name:error.name,reason:error.message}}},from=compile(old),to=compile(current);assert.equal(canonical(from),canonical(to));assert.equal(canonical(to),canonical(p.after));aiPrograms.push({id:p.id,rawHash:hash(p.data),irHash:hash(to),source:p.source});}assert.equal(aiPrograms.length,430);
const nameResolver=current.createSourceCatalogNameResolver(messageInput),literal=key=>{try{return nameResolver.literalBody(key)}catch{return null}},oldAbilities=old.compileBattleAbilityContent(source.reader,source.tables,literal),newAbilities=current.compileBattleAbilityContent(source.reader,source.tables,literal);
assert.equal(canonical(oldAbilities),canonical(newAbilities));assert.equal(canonical(newAbilities),canonical(inventory.all1530AbilitiesAfter));assert.equal(Object.keys(newAbilities.abilities).length,1530);
assert.equal(await runtimeDigest(root),runtime);assert.equal(await runtimeDigest(before),baseRuntime);
const payload={kind:'complete-source-scenario-timer-differential-v1',result:'passed',runtimeSha256:runtime,baseRuntimeSha256:baseRuntime,sourceDigest,sourceSetHash:source.sourceSetHash,nominationSha256:sha(nb),originalInventorySha256:sha(ib),
 counts:{allPrograms:3304,allInstructions:all,fieldInstructions:fieldCount,changedField:changes.length,unchangedField:fieldCount-changes.length,nonFieldChanges,completeBodies:8,bodyInstructions:1280,maps:649,dependentMaps:selectedMaps.length,dependentPhysicalAssets:closureIds.size,shadowCallbackBindings:callbackBindings.length,battlePrograms:53,battleInstructions:2312,battleChanges:0,aiPrograms:430,aiInstructions:10093,aiChanges:0,abilities:1530,abilityChanges:0},
 productionMessages:{source:system.source,hash:hash(messages),emptyLookup:'Each compiler creates its own branded full dictionary resolver.'},allSourceInventory:bindings,completeRawSourcePrograms:inventory.completeRawSourcePrograms,allMapClosures:inventory.completeMapClosures,
 changes,completeSelectedPrograms:inventory.completeRawSourcePrograms.filter(program=>selectedIds.has(program.id)),completeSelectedMapClosures:inventory.completeMapClosures.filter(map=>selectedMaps.some(selected=>selected.id===map.id)),completeDependentAssets:source.assets.filter(asset=>closureIds.has(asset.id)),callbackBindings,battlePrograms,aiPrograms,abilityHash:hash(newAbilities),
 scope:{sourceBodiesExecuted:0,worldCompilations:0,publications:0,nativeDynamicParity:false,sourceCampaignComplete:false}};
await mkdir(dirname(output),{recursive:true});const full=resolve(dirname(output),'inventory.json'),bytes=JSON.stringify(payload)+'\n';await writeFile(full,bytes);
const report={kind:payload.kind,result:payload.result,runtimeSha256:runtime,baseRuntimeSha256:baseRuntime,sourceDigest,counts:payload.counts,scope:payload.scope,artifact:{path:full,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)}};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
