// Read-only complete source-program and battle dependency inventory. Not admission.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-condition-batch',
 battleCatalog:'',battleProof:''},names={'--root':'root','--compiled':'compiled','--output':'output','--battle-catalog':'battleCatalog','--battle-proof':'battleProof'},args=process.argv.slice(2);
while(args.length){const flag=args.shift();assert.ok(names[flag]&&args[0],'Use --root/--compiled/--output/--battle-catalog/--battle-proof <path>');options[names[flag]]=args.shift();}
assert.ok(options.battleCatalog&&options.battleProof,'An immutable full-source battle candidate and its proof are required');
const root=resolve(options.root),compiled=resolve(root,options.compiled),output=resolve(root,options.output),load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')));
assert.ok(output.startsWith(resolve(root,'build')+'/'),'Source-derived output must remain in ignored build/');await mkdir(output,{recursive:true});
const [{hash,canonical},{loadCorpus},{loadSystemMessages},{loadSystemSource},{compileStoryCorpus},{compileWorld},
 {analyzeContentDependencies},{compileAbilityProgram},{compileConditionResistances}]=await Promise.all([
 'compiler/content','compiler/corpus','compiler/system-messages','compiler/system-source','compiler/story-corpus','compiler/world',
 'compiler/content-dependencies','compiler/ability','compiler/condition-resistances'].map(load));
const sha=b=>createHash('sha256').update(b).digest('hex'),readInputs=new Map();
async function readJSON(path){const file=resolve(root,path),bytes=await readFile(file);readInputs.set(file,sha(bytes));return JSON.parse(bytes);}
const proof=await readJSON(options.battleProof),catalog=await readJSON(options.battleCatalog);
for(const value of[proof,catalog]){const{contentHash,...body}=value;assert.equal(hash(body),contentHash);}assert.equal(proof.catalogHash,catalog.contentHash);
async function runtime(){const files=[];async function walk(path){for(const e of(await readdir(resolve(compiled,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=path+'/'+e.name;
 if(e.isDirectory())await walk(name);else if(name.endsWith('.js'))files.push({path:name,sha256:sha(await readFile(resolve(compiled,name)))});}}await walk('src');return{compiled,sha256:hash(files),files};}
const runtimeBefore=await runtime(),snapshot=await loadCorpus(root);assert.equal(hash(snapshot),proof.sourceDigest);
const sourceDigest=hash(snapshot),system=await loadSystemMessages(root,snapshot.manifest.parentSourceSetHash,snapshot.manifest.sources),
 systemSource=await loadSystemSource(root,snapshot.manifest.parentSourceSetHash),messages={...snapshot.messages,system_zhc:system.messages},
 ir=compileStoryCorpus({...snapshot,messages}),assets=new Map(snapshot.assets.map(a=>[a.id,a])),typed=new Map(ir.scripts.map(s=>[s.id,s])),
 mapReports=new Map(ir.analysis.maps.map(m=>[Number(m.id),m])),selectedParties=[116,117,290,291],selectedSet=new Set(selectedParties),
 sourceSites=proof.sites.filter(site=>site.candidates.some(c=>selectedSet.has(c.partyId)));
assert.equal(sourceSites.length,6);assert.ok(sourceSites.every(site=>site.candidates.every(c=>selectedSet.has(c.partyId))));
const roots=[],groups=[];
for(const site of sourceSites){const program=typed.get(site.assetId);assert.ok(program);assert.equal(program.rawHash,site.rawHash);
 for(const map of ir.analysis.maps)for(const[alias,id]of Object.entries({...map.residentScripts,...map.scriptAliases}))if(id===site.assetId){
  roots.push({kind:'script',mapId:Number(map.id),script:alias});const namespace={...map.residentScripts,...map.scriptAliases},queue=[id],seen=new Set(),programs=[],edges=[],unresolved=[];
  while(queue.length){const next=queue.shift();if(seen.has(next))continue;seen.add(next);const full=typed.get(next);if(!full){unresolved.push({kind:'script-body-missing',id:next});continue;}programs.push(full);
   for(const edge of ir.analysis.dependencies.filter(d=>d.site.asset===next&&(!d.mapId||d.mapId===map.id))){edges.push(edge);if(!edge.resolved)unresolved.push(edge);
    if(edge.kind==='script'&&edge.resolved)queue.push(edge.candidates[0]);}
  }
  groups.push({root:{assetId:site.assetId,mapId:Number(map.id),alias,index:site.index,rawHash:site.rawHash},programs,edges,unresolved,
   runtimeAdmission:'unassessed',sourceStoryReachability:false});
 }}
const selectedMapIds=[...new Set(roots.map(r=>r.mapId))].sort((a,b)=>a-b),world=await compileWorld(root),allMapIds=world.maps.map(map=>map.mapId).sort((a,b)=>a-b);
assert.equal(world.maps.length,649);const graphRoots=[...roots];
for(const mapId of selectedMapIds){const map=world.maps.find(map=>map.mapId===mapId);assert.ok(map);for(const point of map.partyEntry?.pointIns??[])graphRoots.push({kind:'entry',mapId,entrance:point.id,continuation:null});
 if(map.initializer)graphRoots.push({kind:'script',mapId,script:map.initializer});}
const graph=analyzeContentDependencies({catalog:world.catalog,maps:world.maps,roots:graphRoots,mapIds:allMapIds}),allSourcePrograms=new Map();
for(const group of groups)for(const p of group.programs)allSourcePrograms.set(p.id,p);
for(const edge of graph.edges){if(edge.kind!=='script'||!edge.target)continue;const match=/^map:(\d+)\/script:(.+)$/.exec(edge.target);if(!match)continue;
 const map=mapReports.get(Number(match[1]));if(!map)continue;const id=({...map.residentScripts,...map.scriptAliases})[decodeURIComponent(match[2])];if(id&&typed.has(id))allSourcePrograms.set(id,typed.get(id));}
const abilities=[];
for(const id of[577,343,140,305]){const compiled=compileAbilityProgram(systemSource.reader,id),definition=catalog.common.abilities[id],targetId=compiled.program.functions[0].values[0],
 condition=systemSource.reader.row('condition.csv',targetId),groupId=Number(condition.values.condition_group_id),
 resistance=compileConditionResistances(systemSource.reader,groupId,catalog.common.conditions.rules.definitions),
 eraseId=Number(condition.values.erase_condition_group_id),eraseRows=systemSource.reader.group('erase_condition_group.csv','group_id',eraseId);
 abilities.push({id,definition,compiled,target:{condition,resistance,erase:{groupId:eraseId,rows:eraseRows}},runtimeAdmission:'unassessed'});}
const parties=selectedParties.map(id=>({id,source:proof.sourceDescriptors.encounters.find(e=>e.partyId===id),
 assessment:proof.web.analysis.encounters.find(e=>e.id===id),runtime:catalog.encounters[id]??null}));
const body={kind:'source-condition-action-batch-inventory-v1',runtime:runtimeBefore,sourceSetHash:snapshot.sourceSetHash,
 parentSourceSetHash:snapshot.manifest.parentSourceSetHash,sourceDigest,typedCorpusHash:ir.contentHash,
 inputBattleCatalogHash:catalog.contentHash,inputBattleProofHash:proof.contentHash,
 counts:{sourceSites:sourceSites.length,physicalRoots:new Set(sourceSites.map(s=>s.assetId)).size,mapAliasRoots:roots.length,selectedMaps:selectedMapIds.length,
 sameMapPrograms:new Set(groups.flatMap(g=>g.programs.map(p=>p.id))).size,
 sameMapInstructions:[...new Map(groups.flatMap(g=>g.programs.map(p=>[p.id,p]))).values()].reduce((n,p)=>n+p.instructions.length,0),
 fullGraphMaps:graph.requiredMapIds.length,fullGraphPrograms:allSourcePrograms.size,fullGraphDiagnostics:graph.diagnostics.length,
 fullGraphRequirements:graph.providerRequirements.length,fullGraphEdges:graph.edges.length},sourceSites,selectedMapIds,roots,groups,parties,abilities,
 sourceMapInitialization:selectedMapIds.map(id=>({id,binding:mapReports.get(id),map:world.maps.find(map=>map.mapId===id)})),
 fullDependencyAnalysis:graph,allSourcePrograms:[...allSourcePrograms.values()],
 runtimeAdmission:'unassessed',sourceStoryReachability:false,sourceCampaignComplete:false,
 limitations:['Whole source bodies, original PCs/locals/segments and all unknown diagnostics are retained; no flag/roster/HP is edited.',
 'The four enemy parties are conditional because their complete Fn9 condition behaviors and full ability rules remain unavailable.',
 'The 649-map pure compiler/dependency graph retains source initialization and external dependencies; reference closure is not gameplay admission.',
 'Native RNG, live party qualification, natural recovery, control/target changes and battle return require the same existing owners; no second VM/state owner is provided.']};
assert.equal((await runtime()).sha256,runtimeBefore.sha256,'Compiled runtime drift');assert.equal(hash(await loadCorpus(root)),sourceDigest,'Source corpus drift');
for(const[path,digest]of readInputs)assert.equal(sha(await readFile(path)),digest,'Immutable battle input drift '+path);
// Full graph and physical source bodies are independent artifacts. This avoids
// a single pretty-printed string exceeding V8's limit; no record is filtered.
const parts={groups:body.groups,sourceMapInitialization:body.sourceMapInitialization,
 fullDependencyAnalysis:body.fullDependencyAnalysis,allSourcePrograms:body.allSourcePrograms},references={};
for(const[name,value]of Object.entries(parts)){const bytes=JSON.stringify(value);const file=name+'.json';
 await writeFile(resolve(output,file),bytes+'\n');references[name]={file,sha256:sha(bytes+'\n'),contentHash:hash(value),bytes:Buffer.byteLength(bytes)+1};}
const{groups:_groups,sourceMapInitialization:_initialization,fullDependencyAnalysis:_analysis,allSourcePrograms:_programs,...summary}=body;
const reportBody={...summary,artifacts:references},report={...reportBody,contentHash:hash(reportBody)};
await writeFile(resolve(output,'inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...body.counts,selectedMapIds,hash:report.contentHash}));
