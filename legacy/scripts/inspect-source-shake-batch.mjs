// Complete source-family inventory. No decoding, runtime admission or publication.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-shake-batch'},args=process.argv.slice(2);
while(args.length){const flag=args.shift();assert.ok(['--root','--compiled','--output'].includes(flag)&&args[0],'Use --root/--compiled/--output <path>');options[flag.slice(2)]=args.shift();}
const root=resolve(options.root),compiled=resolve(root,options.compiled),out=resolve(root,options.output),
 load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js'))),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.ok(out.startsWith(resolve(root,'build')+'/'));await mkdir(out,{recursive:true});await mkdir(resolve(out,'programs'),{recursive:true});
const [{loadCorpus},{loadSystemMessages},{compileStoryCorpus},{hash,canonical},{compileWorld},{analyzeContentDependencies}]=await Promise.all([
 'compiler/corpus','compiler/system-messages','compiler/story-corpus','compiler/content','compiler/world','compiler/content-dependencies'].map(load));
async function runtime(){const rows=[];async function walk(path){for(const entry of(await readdir(resolve(compiled,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const next=path+'/'+entry.name;if(entry.isDirectory())await walk(next);else if(entry.isFile()&&next.endsWith('.js'))rows.push({path:next,sha256:sha(await readFile(resolve(compiled,next)))});}}await walk('src');return{hash:hash(rows),files:rows};}
const runtimeBefore=await runtime(),source=await loadCorpus(root),sourceDigest=hash(source),
 messages=await loadSystemMessages(root,source.manifest.parentSourceSetHash,source.manifest.sources),
 corpus=compileStoryCorpus({...source,messages:{...source.messages,system_zhc:messages.messages}}),
 programs=new Map(corpus.scripts.map(program=>[program.id,program])),assets=new Map(source.assets.filter(asset=>asset.kind==='script').map(asset=>[asset.id,asset])),
 bindings=new Map(),dependencies=new Map();
for(const map of corpus.analysis.maps)for(const[alias,id]of Object.entries({...map.residentScripts,...map.scriptAliases})){
 if(!id)continue;const list=bindings.get(id)??[];list.push({mapId:map.id,alias,initializer:map.initializer,initializerName:map.initializerName,
  packageId:map.packageId,resident:map.residentScripts[alias]===id});bindings.set(id,list);}
for(const edge of corpus.analysis.dependencies){const list=dependencies.get(edge.site.asset)??[];list.push(edge);dependencies.set(edge.site.asset,list);}
const sites=[],physical=[],shapes=new Map(),mapIds=new Set();
for(const asset of assets.values()){
 const relevant=asset.data.Mnemonics?.map((raw,index)=>({raw,index})).filter(entry=>entry.raw?.mnemonic==='Shake')??[];
 if(!relevant.length)continue;const program=programs.get(asset.id);assert.ok(program);
 const context=bindings.get(asset.id)??[],siteRows=relevant.map(({raw,index})=>{
  const instruction=program.instructions.find(row=>row.site.index===index);assert.ok(instruction);
  const shape=canonical({type:raw.type,operands:raw.operands}),entry=shapes.get(shape)??{raw:structuredClone(raw),sites:[]};
  entry.sites.push({id:asset.id,index,source:instruction.site.source});shapes.set(shape,entry);
  for(const map of context)mapIds.add(map.mapId);
  return{assetId:asset.id,rawHash:program.rawHash,index,raw:structuredClone(raw),site:instruction.site,decoded:instruction.decoded,
   diagnostic:instruction.diagnostic??null,bindings:context,runtimeAdmission:'unassessed'};
 });sites.push(...siteRows);
 const body={kind:'source-shake-program-evidence-v1',id:asset.id,source:asset.source,rawHash:program.rawHash,raw:asset.data,
  typed:program,bindings:context,dependencies:dependencies.get(asset.id)??[],shakeSites:siteRows,
  otherOperandBlockers:program.instructions.filter(row=>row.raw.mnemonic!=='Shake'&&(!row.decoded||row.decoded.kind==='blocked')),
  runtimeAdmission:'unassessed',storyReachability:'unverified'};
 const bytes=JSON.stringify(body)+'\n',file='programs/'+hash(asset.id)+'.json';await writeFile(resolve(out,file),bytes);
 physical.push({id:asset.id,rawHash:program.rawHash,file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),siteCount:siteRows.length,
  bindings:context,otherOperandBlockers:body.otherOperandBlockers.length,otherwiseOperandClosed:body.otherOperandBlockers.length===0});
}
// Reuse the central corpus' complete namespace/dependency analysis rather than
// constructing a second resolver or silently choosing an ambiguous resident.
const analysisBytes=JSON.stringify(corpus.analysis)+'\n';await writeFile(resolve(out,'complete-corpus-analysis.json'),analysisBytes);
// The central whole-content dependency scanner owns group/Resident/script/
// entrance references. Do not replace it with a Shake-specific resolver.
const world=await compileWorld(root),allMapIds=world.maps.map(map=>map.mapId),allRoots=physical.flatMap(program=>program.bindings.map(binding=>
 ({kind:'script',mapId:Number(binding.mapId),script:binding.alias}))),graphs=[],nominees=[];
for(const rootRequest of allRoots){const map=world.maps.find(map=>map.mapId===rootRequest.mapId);assert.ok(map);
 const graph=analyzeContentDependencies({catalog:world.catalog,maps:[map],roots:[rootRequest],mapIds:[map.mapId]}),
  reasons=graph.diagnostics.filter(row=>row.code==='instruction-blocked'||row.code.startsWith('script-')),
  programIds=[...new Set([rootRequest.script,...graph.edges.filter(edge=>edge.kind==='script'&&edge.target)
   .flatMap(edge=>{const match=/^map:(\d+)\/script:(.+)$/.exec(edge.target);return match&&Number(match[1])===map.mapId?[decodeURIComponent(match[2])]:[];})])],
  namespace={...corpus.analysis.maps.find(row=>Number(row.id)===map.mapId).residentScripts,
   ...corpus.analysis.maps.find(row=>Number(row.id)===map.mapId).scriptAliases},
  bindings=programIds.map(alias=>({alias,id:namespace[alias]??null}));
 nominees.push({root:rootRequest,programBindings:bindings,wholeSameMapOperandClosure:reasons.length===0,
  exclusionReasons:reasons,externalMapBoundaries:graph.edges.filter(edge=>edge.kind==='map'),
  allDiagnostics:graph.diagnostics,allProviderRequirements:graph.providerRequirements,
  runtimeAdmission:'unassessed',storyReachability:'unverified'});
 graphs.push({root:rootRequest,analysis:graph});
}
const fullRoots=[...allRoots];
for(const mapId of mapIds){const map=world.maps.find(map=>map.mapId===Number(mapId));assert.ok(map);
 if(map.initializer)fullRoots.push({kind:'script',mapId:map.mapId,script:map.initializer});
 for(const point of map.partyEntry?.pointIns??[])fullRoots.push({kind:'entry',mapId:map.mapId,entrance:point.id,continuation:null});}
const fullGraph=analyzeContentDependencies({catalog:world.catalog,maps:world.maps,roots:fullRoots,mapIds:allMapIds}),artifacts={};
for(const[name,value]of Object.entries({nomination:nominees,sameMapGraphs:graphs,completeSourceDependencyGraph:fullGraph})){
 const bytes=JSON.stringify(value)+'\n',file=name+'.json';await writeFile(resolve(out,file),bytes);
 artifacts[name]={file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),contentHash:hash(value)};
}
assert.deepEqual(await runtime(),runtimeBefore);assert.equal(hash(await loadCorpus(root)),sourceDigest);
const body={kind:'source-shake-batch-inventory-v1',runtime:runtimeBefore,sourceSetHash:source.sourceSetHash,
 parentSourceSetHash:source.manifest.parentSourceSetHash,sourceDigest,corpusHash:corpus.contentHash,
 counts:{completePhysicalPrograms:corpus.scripts.length,physicalPrograms:physical.length,physicalSites:sites.length,
  logicalMapSites:sites.reduce((n,site)=>n+site.bindings.length,0),maps:mapIds.size,shapes:shapes.size,
  otherwiseOperandClosedPrograms:physical.filter(row=>row.otherwiseOperandClosed).length},
 nominationCounts:{logicalRoots:nominees.length,wholeSameMapOperandClosed:nominees.filter(row=>row.wholeSameMapOperandClosure).length,
  fullGraphMaps:fullGraph.requiredMapIds.length,fullGraphDiagnostics:fullGraph.diagnostics.length,
  fullGraphRequirements:fullGraph.providerRequirements.length,fullGraphEdges:fullGraph.edges.length},
 artifacts,
 maps:[...mapIds].sort((a,b)=>Number(a)-Number(b)),shapes:[...shapes.values()],sites,programs:physical,
 completeCorpusAnalysis:{file:'complete-corpus-analysis.json',sha256:sha(analysisBytes),bytes:Buffer.byteLength(analysisBytes)},
 runtimeAdmission:'unassessed',sourceCampaignComplete:false,storyReachability:'unverified',
 limitations:['All physical Shake sites and every original operand/locals/segment/source body are retained without source type aliasing.',
  'The complete central corpus analysis includes map-local and Resident bindings and unresolved dependencies; reference/operand closure is not runtime or story admission.',
  'This initial inventory does not authorize camera shake, Unity RNG, cross-map/battle continuation or non-default source parameters.']};
const report={...body,contentHash:hash(body)};await writeFile(resolve(out,'inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...body.counts,byType:Object.fromEntries([...new Set(sites.map(site=>site.raw.type))].map(type=>[String(type),sites.filter(site=>site.raw.type===type).length])),
 shapes:body.shapes.map(row=>({type:row.raw.type,operands:row.raw.operands,count:row.sites.length})),nominationCounts:body.nominationCounts,contentHash:report.contentHash}));
