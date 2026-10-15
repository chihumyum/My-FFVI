// Whole original Area NPC production assessment. All source programs and
// unknown dependencies remain evidence; no publication or source-story grant.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateSourcePrerequisiteInputs} from './compile-source-prerequisites.mjs';
import {loadSourceFamilyPrerequisites} from './source-family-prerequisites.mjs';
import {webSourceFrameworkInputs} from './source-web-framework-inputs.mjs';
const options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-global-npc-area',
 battle:'build/game/source-catalog.json'},args=process.argv.slice(2);
while(args.length){const flag=args.shift();assert.ok(['--root','--compiled','--output','--battle','--candidate-dir'].includes(flag)&&args.length,'Use --root/--compiled/--output/--battle <path>');options[flag.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),out=resolve(root,options.output),
 part=relative(resolve(root,'build'),out),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),
 load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')));
assert.ok(part&&!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep),'Output must be private build evidence');
await mkdir(out,{recursive:true});for(const dir of ['programs','maps','assessments','same-map-closures'])await mkdir(resolve(out,dir),{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/corpus','compiler/story-corpus','compiler/system-messages',
 'compiler/content','compiler/world','compiler/source-new-game','compiler/framework-content','compiler/framework-npc-area',
 'compiler/content-dependencies','core/content-integrity','compiler/map-package','compiler/entity-group'].map(load)));
async function runtime(){const rows=[];async function walk(path){for(const entry of(await readdir(resolve(compiled,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 const next=path+'/'+entry.name;if(entry.isDirectory())await walk(next);else if(entry.isFile()&&next.endsWith('.js'))rows.push({path:next,sha256:sha(await readFile(resolve(compiled,next)))});}}
 await walk('src');return{hash:api.hash(rows),files:rows};}
const runtimeBefore=await runtime(),snapshotBefore=sha(await readFile(resolve(root,'build/corpus/snapshot.json'))),
 source=await api.loadCorpus(root),sourceDigest=api.hash(source),webInputs=webSourceFrameworkInputs(),
 prerequisites=await loadSourceFamilyPrerequisites({root,compiledDir:compiled,...(options['candidate-dir']?{candidateDir:options['candidate-dir']}:{})}),payloads=prerequisites.payloads,
 sourceCatalog=payloads.get('/world/catalog.json'),frameworkCatalog=payloads.get('/framework/world/catalog.json');
assert.ok(sourceCatalog&&frameworkCatalog,'Missing shared whole-source world');
const world={catalog:sourceCatalog,maps:Object.values(sourceCatalog.maps).map(row=>payloads.get(row.url))},
 battle=await api.verifyContent(payloads.get('/game/source-catalog.json')),
 entry=await api.verifyContent(payloads.get('/game/source-new-game.json')),
 framework={catalog:frameworkCatalog,maps:Object.values(frameworkCatalog.maps).map(row=>payloads.get(row.url)),
  entry:payloads.get('/framework/new-game.json'),report:prerequisites.report.framework},
 battleBytes=await readFile(resolve(root,options.battle)),priorBattle=await api.verifyContent(JSON.parse(battleBytes)),
 template=api.frameworkNpcAreaTemplate(webInputs.npcAreas.reason),
 assessments=api.assessFrameworkNpcAreaWorld(source,world.catalog,world.maps,template);
assert.equal(api.hash(priorBattle.gameState),api.hash(battle.gameState),'Source owned initializer changed');
assert.equal(entry.battleCatalogHash,battle.contentHash,'Source entry must use the freshly recompiled battle catalog');

const rawObjects=new Map(),uses=[],propertyErrors=[],sourceAssets=new Map(source.assets.map(asset=>[asset.id,asset]));
for(const binding of api.bindMapPackages(source.assets,source.tables))for(const[group,assetId]of Object.entries(binding.groups)){
 const asset=sourceAssets.get(assetId);assert.ok(asset,'Missing original entity group');
 for(const[li,layer]of(asset.data.layers??[]).entries())for(const[oi,raw]of(layer.objects??[]).entries()){
  let p;try{p=api.entityProperties(raw.properties);}catch(error){propertyErrors.push({mapId:Number(binding.id),group,assetId,
   source:{...asset.source,pointer:`/layers/${li}/objects/${oi}`},reason:error.message});continue;}
  if(![6,17].includes(p.object_type)||p.move_type!==2)continue;
  const key=`${assetId}:${li}:${oi}`;rawObjects.set(key,{key,source:{...asset.source,pointer:`/layers/${li}/objects/${oi}`},raw});
  uses.push({key,mapId:Number(binding.id),group});
 }}
const affected=assessments.filter(row=>row.record.counts.declared>0),affectedIds=new Set(affected.map(row=>row.record.mapId)),
 messages=await api.loadSystemMessages(root,source.manifest.parentSourceSetHash,source.manifest.sources),
 corpus=api.compileStoryCorpus({...source,messages:{...source.messages,system_zhc:messages.messages}}),
 bindings=new Map(),dependencies=new Map();
for(const map of corpus.analysis.maps)for(const[alias,id]of Object.entries({...map.residentScripts,...map.scriptAliases})){
 if(!id)continue;const rows=bindings.get(id)??[];rows.push({mapId:Number(map.id),alias,resident:map.residentScripts[alias]===id,
  initializer:map.initializer,initializerName:map.initializerName,packageId:map.packageId});bindings.set(id,rows);}
for(const edge of corpus.analysis.dependencies){const rows=dependencies.get(edge.site.asset)??[];rows.push(edge);dependencies.set(edge.site.asset,rows);}
const artifacts={};
async function artifact(file,value){const bytes=JSON.stringify(value)+'\n';await writeFile(resolve(out,file),bytes);
 return{file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),contentHash:api.hash(value)};}
const roots=[],mapClosures=[];
for(const assessment of assessments){
 const id=assessment.record.mapId,map=world.maps.find(map=>map.mapId===id),derived=framework.maps.find(map=>map.mapId===id);
 assert.ok(map&&derived);await artifact('assessments/'+id+'.json',assessment);
 await artifact('maps/'+id+'.json',{source:map,framework:derived});
 if(!affectedIds.has(id))continue;
 const namespace=corpus.analysis.maps.find(row=>Number(row.id)===id);assert.ok(namespace,'Missing complete installed namespace');
 const localRoots=Object.keys({...namespace.residentScripts,...namespace.scriptAliases}).sort().map(script=>({kind:'script',mapId:id,script}));
 if(map.initializer&&!localRoots.some(row=>row.script===map.initializer))localRoots.push({kind:'script',mapId:id,script:map.initializer});
 for(const point of map.partyEntry?.pointIns??[])localRoots.push({kind:'entry',mapId:id,entrance:point.id,continuation:null});
 // No geometry, readiness or blocker filtering removes a source root.
 assert.ok(localRoots.length,'Affected source map has no installed/entry root');roots.push(...localRoots);
 const graph=api.analyzeContentDependencies({catalog:world.catalog,maps:[map],roots:localRoots,mapIds:[id]}),
  record={mapId:id,assessmentHash:assessment.contentHash,namespace,initializer:map.initializer,roots:localRoots,analysis:graph,
   runtimeAdmission:'unassessed',storyReachability:'unverified'};
 const receipt=await artifact('same-map-closures/'+id+'.json',record);
 mapClosures.push({mapId:id,artifact:receipt,roots:localRoots.length,declared:assessment.record.counts.declared,
  derived:assessment.record.counts.derived,unready:assessment.record.counts.declared-assessment.record.counts.derived,
  diagnostics:graph.diagnostics.length,requirements:graph.providerRequirements.length,edges:graph.edges.length});
}
const fullGraph=api.analyzeContentDependencies({catalog:world.catalog,maps:world.maps,roots,mapIds:world.maps.map(map=>map.mapId)}),
 programRecords=[];
// Retain the complete 3304 physical program bodies once, including all locals,
// segments and aliases. site.asset is the exact physical dependency key.
for(const program of corpus.scripts){
 const bound=bindings.get(program.id)??[],row={program,bindings:bound,dependencies:dependencies.get(program.id)??[],
  affectedMapBindings:bound.filter(binding=>affectedIds.has(binding.mapId)),runtimeAdmission:'unassessed'};
 const receipt=await artifact('programs/'+api.hash(program.id)+'.json',row);
 programRecords.push({id:program.id,rawHash:program.rawHash,source:program.source,artifact:receipt,bindings:bound,
  affectedMapBindings:row.affectedMapBindings,operandBlockers:program.instructions.filter(op=>op.operandDecoded!=='decoded').length});
}
artifacts.corpusAnalysis=await artifact('complete-corpus-analysis.json',corpus.analysis);
artifacts.completeDependencies=await artifact('complete-source-dependencies.json',fullGraph);
artifacts.sourceWorld=await artifact('strict-world.json',world.catalog);artifacts.frameworkWorld=await artifact('framework-world.json',framework.catalog);
artifacts.sourceEntry=await artifact('strict-entry.json',entry);artifacts.frameworkEntry=await artifact('framework-entry.json',framework.entry);
artifacts.assessments=await artifact('assessments.json',assessments);artifacts.programs=await artifact('programs.json',programRecords);
artifacts.freshBattle=await artifact('fresh-battle.json',battle);
artifacts.prerequisites=await artifact('shared-source-prerequisites.json',{inputs:prerequisites.inputs,report:prerequisites.report,webInputs,...(prerequisites.candidateEvidence?{candidateEvidence:prerequisites.candidateEvidence}:{})});
artifacts.mapClosures=await artifact('map-closures.json',mapClosures);
await validateSourcePrerequisiteInputs(prerequisites.inputs,{root});if(prerequisites.validate)await prerequisites.validate();
assert.deepEqual(await runtime(),runtimeBefore,'Private compiled runtime changed');assert.equal(api.hash(await api.loadCorpus(root)),sourceDigest);
assert.equal(sha(await readFile(resolve(root,'build/corpus/snapshot.json'))),snapshotBefore);
assert.equal(sha(await readFile(resolve(root,options.battle))),sha(battleBytes),'Battle input changed');
assert.deepEqual([...new Set(uses.map(row=>row.mapId))].sort((a,b)=>a-b),[...affectedIds].sort((a,b)=>a-b),'Raw whole family differs from assessment scope');
assert.equal(uses.length,framework.report.npcActivity.counts.declared,'Raw declared Area objects were lost');
artifacts.rawObjects=await artifact('complete-area-objects.json',{rawObjects:[...rawObjects.values()],uses,propertyErrors});
const body={kind:'source-global-npc-area-production-inventory-v1',runtime:runtimeBefore,sourceSetHash:source.sourceSetHash,
 parentSourceSetHash:source.manifest.parentSourceSetHash,sourceDigest,snapshotSha256:snapshotBefore,corpusHash:corpus.contentHash,
 battleInput:{path:relative(root,resolve(out,artifacts.freshBattle.file)),sha256:artifacts.freshBattle.sha256,contentHash:battle.contentHash,scope:'Fresh catalog from the same shared prerequisite producer'},
 priorBattleInput:{path:options.battle,sha256:sha(battleBytes),contentHash:priorBattle.contentHash,scope:'Owned-initializer identity comparison only; never the execution battle'},template,
 existingFrameworkPolicies:webInputs,
 counts:{indexedMaps:world.maps.length,affectedMaps:affected.length,physicalObjects:rawObjects.size,
 mapGroupUses:uses.length,rawPropertyErrors:propertyErrors.length,declared:framework.report.npcActivity.counts.declared,derived:framework.report.npcActivity.counts.derived,
 unready:framework.report.npcActivity.counts.blocked,completePhysicalPrograms:corpus.scripts.length,
 affectedPhysicalPrograms:programRecords.filter(row=>row.affectedMapBindings.length).length,
 installedRoots:roots.length,dependencyMaps:fullGraph.requiredMapIds.length,diagnostics:fullGraph.diagnostics.length,
 requirements:fullGraph.providerRequirements.length,edges:fullGraph.edges.length},
 affectedMaps:affected.map(row=>({mapId:row.record.mapId,assessmentHash:row.contentHash,counts:row.record.counts,
  diagnostics:row.record.diagnostics})),artifacts,strictDataUnmodified:true,sourceGameplayAdmitted:false,nativeParity:false,
 runtimeAdmission:'unassessed',sourceCampaignComplete:false,browserVerified:false,
 limitations:['Assessment and program closure are complete static evidence, not executed story coverage.',
  'All original initializers/Resident/script bodies and unknown group/media/flag providers are retained.',
  'The existing Web Area RNG/grid reservations/scheduling/takeover policy is explicit. Strict source receives no capability.']};
const report={...body,contentHash:api.hash(body)};await writeFile(resolve(out,'inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'static-complete',...body.counts,contentHash:report.contentHash}));
