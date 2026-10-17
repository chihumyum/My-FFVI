// Pure complete original trigger inventory and same-build source/controlled
// content. No published collection, raw body, story state or owner is changed.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,symlink,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compileSourcePrerequisites,validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
import {webSourceFrameworkInputs} from './source-web-framework-inputs.mjs';
const args=process.argv.slice(2),options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-field-content-invalidations'},seen=new Set();
while(args.length){const f=args.shift();assert.ok(['--root','--compiled','--output'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);options[f.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),out=resolve(root,options.output),
 load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js'))),sha=b=>createHash('sha256').update(b).digest('hex');
assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(out,{recursive:true});
for(const name of ['maps','programs','closures'])await mkdir(resolve(out,name),{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/content','compiler/corpus','compiler/system-messages',
 'compiler/story-corpus','compiler/world','compiler/battle','compiler/game-catalog','compiler/opening-playable','compiler/source-new-game',
 'compiler/framework-content','compiler/framework-npc-area','compiler/map-package','compiler/entity-group',
 'compiler/content-dependencies','core/content-integrity'].map(load)));
async function runtime(){const files=[];async function walk(path){for(const e of(await readdir(resolve(compiled,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path+'/'+e.name;if(e.isDirectory())await walk(p);else if(e.isFile()&&p.endsWith('.js'))files.push({path:p,sha256:sha(await readFile(resolve(compiled,p)))});}}await walk('src');return{files,hash:api.hash(files)};}
// The publication owner may be replacing public collections. This candidate
// uses only raw exports and current pure compilers. Its two historical URL
// baseline bodies are freshly built in an isolated input view, never read from
// root/build/game or root/build/content-packages.
const privateInputRoot=resolve(out,'source-input-root');await mkdir(resolve(privateInputRoot,'build/game'),{recursive:true});
async function linkRaw(from,to){try{await symlink(from,to,'dir');}catch(error){if(error.code!=='EEXIST')throw error;assert((await lstat(to)).isSymbolicLink()&&await realpath(to)===await realpath(from),'Private raw link changed');}}
for(const name of ['import','corpus','battle','field','world-media','field-background-media','map-ui','bgm','environment','se','runtime','native','field-effect-media'])
 await linkRaw(resolve(root,'build',name),resolve(privateInputRoot,'build',name));
await mkdir(resolve(privateInputRoot,'build/reports'),{recursive:true});
await linkRaw(resolve(root,'build/reports/v71-esper-native-complete'),resolve(privateInputRoot,'build/reports/v71-esper-native-complete'));
await (async()=>{
 const rawShared=await api.compileSharedBattleSource(root),rawLegacy=await api.compileOpeningBattle(root),
  freshBase=await api.compileSharedGameCatalog(root,rawShared),freshLegacy=await api.compileOpeningPlayable(root,rawLegacy);
 await writeFile(resolve(privateInputRoot,'build/game/source-catalog.json'),api.canonical(freshBase)+'\n');
 await writeFile(resolve(privateInputRoot,'build/game/opening-playable.json'),api.canonical(freshLegacy)+'\n');
})();
const before=await runtime(),source=await api.loadCorpus(root),sourceDigest=api.hash(source),
 system=await api.loadSystemMessages(root,source.manifest.parentSourceSetHash,source.manifest.sources),
 corpus=api.compileStoryCorpus({...source,messages:{...source.messages,system_zhc:system.messages}}),
 webInputs=webSourceFrameworkInputs(),prerequisites=await compileSourcePrerequisites({root:privateInputRoot,compiledDir:compiled,...webInputs}),
 payloads=prerequisites.payloads,sourceCatalog=payloads.get('/world/catalog.json'),frameworkCatalog=payloads.get('/framework/world/catalog.json'),
 world={catalog:sourceCatalog,maps:Object.values(sourceCatalog.maps).map(row=>payloads.get(row.url))},
 sourceBattle=await api.verifyContent(payloads.get('/game/source-catalog.json')),entry=await api.verifyContent(payloads.get('/game/source-new-game.json')),
 policyBytes=await readFile(resolve(import.meta.dirname,'../content-batches/source-battle-directory.policy.json')),
 {compileSourceBattleDirectory}=await import('./source-battle-directory.mjs'),
 directory=await compileSourceBattleDirectory({root:privateInputRoot,compiledDir:compiled,world,baseCatalog:sourceBattle,policy:JSON.parse(policyBytes)}),
 template=api.frameworkNpcAreaTemplate(webInputs.npcAreas.reason),
 framework={catalog:frameworkCatalog,maps:Object.values(frameworkCatalog.maps).map(row=>payloads.get(row.url)),entry:payloads.get('/framework/new-game.json')};
assert.equal(entry.battleCatalogHash,sourceBattle.contentHash,'Original entry must use the fresh shared source catalog');
assert.equal(api.canonical(directory.frameworkCatalog.gameState),api.canonical(sourceBattle.gameState));
const bindings=api.bindMapPackages(source.assets,source.tables),byMap=new Map(world.maps.map(m=>[m.mapId,m])),
 programs=new Map(corpus.scripts.map(p=>[p.id,p])),sourcePrograms=new Map(source.assets.filter(a=>a.kind==='script').map(a=>[a.id,a])),
 physical=new Map(),uses=[],roots=new Map(),allAffected=new Set(),allInstalled=new Set(programs.keys()),families=new Map();
for(const p of sourcePrograms.values())for(const[pc,raw]of p.data.Mnemonics.entries()){
 if(!['InvalidateTelepo','AddTelepoCache','RemoveTelepoCache','CastTelepo'].includes(raw.mnemonic))continue;
 const row={programId:p.id,pc,raw,source:{...p.source,pointer:'/Mnemonics/'+pc},bindings:[]};
 for(const binding of bindings)for(const[alias,id]of Object.entries({...binding.residentScripts,...binding.scriptAliases}))if(id===p.id){
  const use={mapId:Number(binding.id),alias,resident:binding.residentScripts[alias]===id};row.bindings.push(use);uses.push({...use,family:raw.mnemonic,programId:p.id,pc});
  if(raw.mnemonic==='InvalidateTelepo'){
   allAffected.add(Number(binding.id));const key=api.canonical([Number(binding.id),alias,p.id]);
   if(!roots.has(key))roots.set(key,{mapId:Number(binding.id),alias,programId:p.id,
    namespace:{...binding.residentScripts,...binding.scriptAliases},initializer:binding.initializer,initializerName:binding.initializerName,bindingIssues:binding.issues,uses:[]});
   roots.get(key).uses.push({source:row.source,pc,raw});
  }
 }
 const list=families.get(raw.mnemonic)??[];list.push(row);families.set(raw.mnemonic,list);physical.set(api.canonical([p.id,pc]),row);
}
const dependencyByProgram=new Map();for(const edge of corpus.analysis.dependencies){const list=dependencyByProgram.get(edge.site.asset)??[];list.push(edge);dependencyByProgram.set(edge.site.asset,list);}
const closures=[];
for(const root of roots.values()){
 const queue=[root.programId],done=new Set(),diagnostics=[],edges=[],boundaries=[];
 while(queue.length){const id=queue.shift();if(done.has(id))continue;done.add(id);const p=programs.get(id);
  if(!p){diagnostics.push({kind:'missing-physical-program',id});continue;}
  for(const op of p.instructions){
   if(!op.decoded||op.decoded.kind==='blocked')diagnostics.push({kind:'operand',id,site:op.site,raw:op.raw,reason:op.diagnostic??op.decoded?.reason??'unknown source domain'});
   const next=op.decoded?.kind==='source-encounter'?op.decoded.command.continuation:op.decoded?.kind==='script-transition'?op.decoded.targetScript:null;
   if(next){const target=Object.hasOwn(root.namespace,next)?root.namespace[next]:null;edges.push({id,site:op.site,alias:next,target});if(target)queue.push(target);else diagnostics.push({kind:'unresolved-alias',id,site:op.site,alias:next});}
   if(op.raw.mnemonic==='ChangeMap')boundaries.push({kind:'map-change',site:op.site,raw:op.raw,mapInitializationAdmission:'unassessed'});
  }
 }
 closures.push({...root,programIds:[...done],edges,diagnostics,boundaries,wholeProgramOperandsClosed:!diagnostics.length,runtimeAdmission:'unassessed',storyReachability:'unverified'});
}
async function artifact(path,value){const bytes=JSON.stringify(value)+'\n';await writeFile(resolve(out,path),bytes);return{file:path,sha256:sha(bytes),contentHash:api.hash(value),bytes:Buffer.byteLength(bytes)};}
const artifacts={};
for(const map of world.maps)await artifact('maps/'+map.mapId+'.json',{source:map,framework:framework.maps.find(m=>m.mapId===map.mapId)});
artifacts.strictWorld=await artifact('strict-world.json',world.catalog);artifacts.frameworkWorld=await artifact('framework-world.json',framework.catalog);
artifacts.sourceBattle=await artifact('source-battle.json',sourceBattle);artifacts.battleDirectory=await artifact('battle-directory.json',directory.frameworkCatalog);
artifacts.battleDirectoryReport=await artifact('battle-directory-report.json',directory.report);
artifacts.sourceEntry=await artifact('source-entry.json',entry);artifacts.frameworkEntry=await artifact('framework-entry.json',framework.entry);
artifacts.fullObjects=await artifact('all-telepo-sites.json',[...physical.values()]);artifacts.roots=await artifact('invalidation-roots.json',closures);
artifacts.corpusAnalysis=await artifact('complete-corpus-analysis.json',corpus.analysis);
const graphRoots=closures.filter(r=>r.alias).map(r=>({kind:'script',mapId:r.mapId,script:r.alias})),
 graph=api.analyzeContentDependencies({catalog:world.catalog,maps:world.maps,roots:graphRoots,mapIds:world.maps.map(m=>m.mapId)});
artifacts.dependencies=await artifact('complete-invalidation-dependencies.json',graph);
artifacts.sourcePrerequisites=await artifact('source-prerequisites.json',{inputs:prerequisites.inputs,report:prerequisites.report,webInputs,privateInputRoot,sourceBaseline:"fresh-pure-compiler-not-published-cache"});
const records=[];
for(const id of [...allInstalled].sort()){const p=programs.get(id);assert(p);const file='programs/'+api.hash(id)+'.json';
 const body={program:p,dependencies:dependencyByProgram.get(id)??[],runtimeAdmission:'unassessed'};records.push({id,rawHash:p.rawHash,source:p.source,artifact:await artifact(file,body)});}
artifacts.programs=await artifact('programs.json',records);
// Build the established author map from these same fresh source dependencies.
// Recipe pins are explicitly bound in a detached probe declaration, never
// refreshed in tracked files or treated as a source-story route.
const recipeBytes=await readFile(resolve(import.meta.dirname,'../content-batches/systems-initialized.recipe.json')),
 recipe=JSON.parse(recipeBytes),fresh=new Map([[recipe.sourceEntry.url,entry],[recipe.sourceBattle.url,sourceBattle],
 [recipe.sourceWorld.url,world.catalog],[recipe.sourceMap.url,byMap.get(Number(recipe.sourceMap.url.match(/(\d+)\.json$/)[1]))]]);
for(const key of ['sourceEntry','sourceBattle','sourceWorld','sourceMap'])recipe[key].contentHash=fresh.get(recipe[key].url).contentHash;
const {compileInitializedSystems}=await import('./build-initialized-systems.mjs'),systems=await compileInitializedSystems(privateInputRoot,recipe,api.hash(recipe),
 {dist:compiled,readJson:async url=>{assert(fresh.has(url),'Unexpected public content read '+url);return fresh.get(url);}});
assert.equal(api.canonical(systems.battle.gameState),api.canonical(sourceBattle.gameState));
artifacts.systems=await artifact('controlled-systems.json',{content:systems.entry,world:systems.catalog,map:systems.map,battle:systems.battle,
 recipe:recipe,originalRecipeSha256:sha(recipeBytes),declaredProbe:true});
const familyCounts=[...families].map(([family,rows])=>({family,physicalSites:rows.length,
 physicalPrograms:new Set(rows.map(r=>r.programId)).size,installedUses:rows.reduce((n,r)=>n+r.bindings.length,0),
 logicalRoots:new Set(rows.flatMap(r=>r.bindings.map(b=>api.canonical([b.mapId,b.alias,r.programId])))).size,
 maps:new Set(rows.flatMap(r=>r.bindings.map(b=>b.mapId))).size,allRawSites:rows}));
artifacts.fullFamilies=await artifact('complete-telepo-family-cohort.json',familyCounts);
const counts={allMaps:world.maps.length,allPhysicalPrograms:programs.size,allInstructions:corpus.scripts.reduce((n,p)=>n+p.instructions.length,0),
 physicalSites:physical.size,installedSiteUses:uses.length,invalidationMaps:allAffected.size,logicalRoots:closures.length,
 fullRetainedPhysicalPrograms:records.length,operandClosedRoots:closures.filter(r=>r.wholeProgramOperandsClosed).length,
 closedPhysicalPrograms:new Set(closures.filter(r=>r.wholeProgramOperandsClosed).flatMap(r=>r.programIds)).size,
 dependencyMaps:graph.requiredMapIds.length,diagnostics:graph.diagnostics.length,requirements:graph.providerRequirements.length,edges:graph.edges.length,
 families:familyCounts.map(({allRawSites,...c})=>c)};
assert.equal(counts.allMaps,649);assert.equal(counts.allPhysicalPrograms,3304);assert.equal(counts.physicalSites,24);assert.equal(counts.logicalRoots,8);
assert.deepEqual(await runtime(),before);assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);
await validateSourcePrerequisiteInputs(prerequisites.inputs,{root:privateInputRoot});
const report={kind:'source-field-content-invalidations-whole-family-inventory-v1',runtime:before,sourceDigest,sourceSetHash:source.sourceSetHash,
 parentSourceSetHash:source.manifest.parentSourceSetHash,counts,artifacts,policies:{...webInputs,npc:template,
 battleDirectory:JSON.parse(policyBytes),controlledMap:'existing-author-systems-map-new-source-pins-explicit-probe'},
 publicCollectionInputsRead:false,privateInputRoot,sourceCampaignComplete:false,nativeParity:false,browserVerified:false,runtimeAdmission:'unassessed'};
report.contentHash=api.hash(report);await writeFile(resolve(out,'inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'whole-family-retained',counts,contentHash:report.contentHash}));
