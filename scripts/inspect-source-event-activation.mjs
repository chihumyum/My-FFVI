// Pure complete original trigger inventory and same-build source/controlled
// content. No published collection, raw body, story state or owner is changed.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
import {loadSourceFamilyPrerequisites} from './source-family-prerequisites.mjs';
import {webSourceFrameworkInputs} from './source-web-framework-inputs.mjs';
const args=process.argv.slice(2),options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-event-activation'},seen=new Set();
while(args.length){const f=args.shift();assert.ok(['--root','--compiled','--output','--candidate-dir'].includes(f)&&args[0]&&!seen.has(f));seen.add(f);options[f.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),out=resolve(root,options.output),
 load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js'))),sha=b=>createHash('sha256').update(b).digest('hex');
assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(out,{recursive:true});
for(const name of ['maps','programs','closures'])await mkdir(resolve(out,name),{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/content','compiler/corpus','compiler/system-messages',
 'compiler/story-corpus','compiler/world','compiler/battle','compiler/game-catalog','compiler/source-new-game',
 'compiler/framework-content','compiler/framework-npc-area','compiler/map-package','compiler/entity-group',
 'compiler/content-dependencies','core/content-integrity'].map(load)));
async function runtime(){const files=[];async function walk(path){for(const e of(await readdir(resolve(compiled,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path+'/'+e.name;if(e.isDirectory())await walk(p);else if(e.isFile()&&p.endsWith('.js'))files.push({path:p,sha256:sha(await readFile(resolve(compiled,p)))});}}await walk('src');return{files,hash:api.hash(files)};}
const before=await runtime(),source=await api.loadCorpus(root),sourceDigest=api.hash(source),
 system=await api.loadSystemMessages(root,source.manifest.parentSourceSetHash,source.manifest.sources),
 corpus=api.compileStoryCorpus({...source,messages:{...source.messages,system_zhc:system.messages}}),
 webInputs=webSourceFrameworkInputs(),prerequisites=await loadSourceFamilyPrerequisites({root,compiledDir:compiled,...(options['candidate-dir']?{candidateDir:options['candidate-dir']}:{})}),
 payloads=prerequisites.payloads,sourceCatalog=payloads.get('/world/catalog.json'),frameworkCatalog=payloads.get('/framework/world/catalog.json'),
 world={catalog:sourceCatalog,maps:Object.values(sourceCatalog.maps).map(row=>payloads.get(row.url))},
 sourceBattle=await api.verifyContent(payloads.get('/game/source-catalog.json')),entry=await api.verifyContent(payloads.get('/game/source-new-game.json')),
 policyBytes=await readFile(resolve(import.meta.dirname,'../content-batches/source-battle-directory.policy.json')),
 {compileSourceBattleDirectory}=await import('./source-battle-directory.mjs'),
 directory=await compileSourceBattleDirectory({root,compiledDir:compiled,world,baseCatalog:sourceBattle,policy:JSON.parse(policyBytes)}),
 template=api.frameworkNpcAreaTemplate(webInputs.npcAreas.reason),
 framework={catalog:frameworkCatalog,maps:Object.values(frameworkCatalog.maps).map(row=>payloads.get(row.url)),entry:payloads.get('/framework/new-game.json')};
assert.equal(entry.battleCatalogHash,sourceBattle.contentHash,'Original entry must use the fresh shared source catalog');
assert.equal(api.canonical(directory.frameworkCatalog.gameState),api.canonical(sourceBattle.gameState));
const assets=new Map(source.assets.map(a=>[a.id,a])),bindings=api.bindMapPackages(source.assets,source.tables),
 byMap=new Map(world.maps.map(m=>[m.mapId,m])),programs=new Map(corpus.scripts.map(p=>[p.id,p])),
 physical=new Map(),uses=[],roots=new Map(),allAffected=new Set(),allInstalled=new Set();
for(const b of bindings){let affected=false;
 for(const[group,id]of Object.entries(b.groups)){
  const asset=assets.get(id);assert(asset);const typed=byMap.get(Number(b.id)).map?.groups?.[group];
  for(const[li,l]of(asset.data.layers??[]).entries())for(const[oi,raw]of(l.objects??[]).entries()){
   const p=api.entityProperties(raw.properties);if(![2,3,8,21].includes(p.object_type))continue;affected=true;
   const evidence={...asset.source,pointer:`/layers/${li}/objects/${oi}`},key=api.canonical(evidence),
    entities=typed?.entities.filter(e=>api.canonical(e.source)===key)??[],
    blockers=typed?.blockers.filter(d=>api.canonical(d.source)===key||!d.source.pointer||evidence.pointer.startsWith(d.source.pointer+'/'))??[];
   if(!physical.has(key))physical.set(key,{key,raw,properties:p,source:evidence,rawHash:api.hash(raw),uses:[]});
   const use={mapId:Number(b.id),group,key,typed:entities[0]??null,blockers};physical.get(key).uses.push(use);uses.push(use);
   if(p.object_type!==2||p.gimmick!==true)continue;
   const scriptRows=source.tables['script.csv'].filter(r=>Number(r.id)===p.script_id),alias=scriptRows.length===1?scriptRows[0].script_name:null,
    namespace={...b.residentScripts,...b.scriptAliases},programId=alias&&Object.hasOwn(namespace,alias)?namespace[alias]:null,
    rk=api.canonical([Number(b.id),alias,programId]);
   if(!roots.has(rk))roots.set(rk,{mapId:Number(b.id),alias,programId,namespace,bindingIssues:b.issues,uses:[]});
   roots.get(rk).uses.push({...use,source:evidence,rawHash:api.hash(raw),properties:p});
  }
 }
 if(affected){allAffected.add(Number(b.id));for(const id of Object.values({...b.residentScripts,...b.scriptAliases}))if(id)allInstalled.add(id);}
}
const dependencyByProgram=new Map();for(const edge of corpus.analysis.dependencies){const list=dependencyByProgram.get(edge.site.asset)??[];list.push(edge);dependencyByProgram.set(edge.site.asset,list);}
const closures=[];
for(const root of roots.values()){
 const queue=root.programId?[root.programId]:[],done=new Set(),scope=[],diagnostics=[],edges=[],boundaries=[];
 if(!root.programId)diagnostics.push({kind:'missing-root-alias',alias:root.alias});
 while(queue.length){const id=queue.shift();if(done.has(id))continue;done.add(id);const p=programs.get(id);
  if(!p){diagnostics.push({kind:'missing-physical-program',id});continue;}scope.push(id);
  for(const op of p.instructions){if(!op.decoded||op.decoded.kind==='blocked')diagnostics.push({kind:'operand',id,site:op.site,raw:op.raw,reason:op.diagnostic??op.decoded?.reason??'unknown source domain'});
   const next=op.decoded?.kind==='source-encounter'?op.decoded.command.continuation:op.decoded?.kind==='script-transition'?op.decoded.targetScript:null;
   if(next){const target=Object.hasOwn(root.namespace,next)?root.namespace[next]:null;edges.push({id,site:op.site,alias:next,target});if(target)queue.push(target);else diagnostics.push({kind:'unresolved-alias',id,site:op.site,alias:next});}
   if(op.raw.mnemonic==='ChangeMap')boundaries.push({kind:'map-change',site:op.site,raw:op.raw,mapInitializationAdmission:'unassessed'});
  }
 }
 closures.push({...root,programIds:scope,edges,diagnostics,boundaries,wholeProgramOperandsClosed:!diagnostics.length,runtimeAdmission:'unassessed',storyReachability:'unverified'});
}
async function artifact(path,value){const bytes=JSON.stringify(value)+'\n';await writeFile(resolve(out,path),bytes);return{file:path,sha256:sha(bytes),contentHash:api.hash(value),bytes:Buffer.byteLength(bytes)};}
const artifacts={};
for(const map of world.maps)await artifact('maps/'+map.mapId+'.json',{source:map,framework:framework.maps.find(m=>m.mapId===map.mapId)});
artifacts.strictWorld=await artifact('strict-world.json',world.catalog);artifacts.frameworkWorld=await artifact('framework-world.json',framework.catalog);
artifacts.sourceBattle=await artifact('source-battle.json',sourceBattle);artifacts.battleDirectory=await artifact('battle-directory.json',directory.frameworkCatalog);
artifacts.battleDirectoryReport=await artifact('battle-directory-report.json',directory.report);
artifacts.sourceEntry=await artifact('source-entry.json',entry);artifacts.frameworkEntry=await artifact('framework-entry.json',framework.entry);
artifacts.fullObjects=await artifact('all-event-objects.json',[...physical.values()]);artifacts.roots=await artifact('gimmick-roots.json',closures);
artifacts.corpusAnalysis=await artifact('complete-corpus-analysis.json',corpus.analysis);
const graphRoots=closures.filter(r=>r.alias).map(r=>({kind:'script',mapId:r.mapId,script:r.alias})),
 graph=api.analyzeContentDependencies({catalog:world.catalog,maps:world.maps,roots:graphRoots,mapIds:world.maps.map(m=>m.mapId)});
artifacts.dependencies=await artifact('complete-gimmick-dependencies.json',graph);
artifacts.sourcePrerequisites=await artifact('source-prerequisites.json',{inputs:prerequisites.inputs,report:prerequisites.report,webInputs,...(prerequisites.candidateEvidence?{candidateEvidence:prerequisites.candidateEvidence}:{})});
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
const {compileInitializedSystems}=await import('./build-initialized-systems.mjs'),systems=await compileInitializedSystems(root,recipe,api.hash(recipe),
 {dist:compiled,readJson:async url=>{assert(fresh.has(url),'Unexpected public content read '+url);return fresh.get(url);}});
assert.equal(api.canonical(systems.battle.gameState),api.canonical(sourceBattle.gameState));
artifacts.systems=await artifact('controlled-systems.json',{content:systems.entry,world:systems.catalog,map:systems.map,battle:systems.battle,
 recipe:recipe,originalRecipeSha256:sha(recipeBytes),declaredProbe:true});
const counts={allMaps:world.maps.length,physicalObjects:physical.size,mapGroupUses:uses.length,affectedMaps:allAffected.size,
 wholeInstalledPhysicalPrograms:records.length,wholeInstalledInstructions:records.reduce((n,r)=>n+programs.get(r.id).instructions.length,0),
 gimmickPhysical:[...physical.values()].filter(o=>o.properties.object_type===2&&o.properties.gimmick===true).length,
 gimmickUses:closures.reduce((n,r)=>n+r.uses.length,0),gimmickMaps:new Set(closures.map(r=>r.mapId)).size,
 logicalGimmickRoots:closures.length,operandClosedRoots:closures.filter(r=>r.wholeProgramOperandsClosed).length,
 closedPhysicalPrograms:new Set(closures.filter(r=>r.wholeProgramOperandsClosed).flatMap(r=>r.programIds)).size,
 dependencyMaps:graph.requiredMapIds.length,diagnostics:graph.diagnostics.length,requirements:graph.providerRequirements.length,edges:graph.edges.length};
assert.equal(counts.physicalObjects,4108);assert.equal(counts.mapGroupUses,4225);assert.equal(counts.gimmickPhysical,229);assert.equal(counts.gimmickUses,254);
assert.deepEqual(await runtime(),before);assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);
await validateSourcePrerequisiteInputs(prerequisites.inputs,{root});if(prerequisites.validate)await prerequisites.validate();
const report={kind:'source-event-activation-whole-family-inventory-v1',runtime:before,sourceDigest,sourceSetHash:source.sourceSetHash,
 parentSourceSetHash:source.manifest.parentSourceSetHash,counts,artifacts,policies:{...webInputs,npc:template,
 battleDirectory:JSON.parse(policyBytes),controlledMap:'existing-author-systems-map-new-source-pins-explicit-probe'},
 publishedInputsRead:false,sourceCampaignComplete:false,nativeParity:false,browserVerified:false,runtimeAdmission:'unassessed'};
report.contentHash=api.hash(report);await writeFile(resolve(out,'inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'whole-family-retained',counts,contentHash:report.contentHash}));
