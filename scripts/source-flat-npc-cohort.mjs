import assert from 'node:assert/strict';
export function sourceFlatNpcCohort(corpus,ir,{bindMapPackages,entityProperties,canonical}){
 const bindings=bindMapPackages(corpus.assets,corpus.tables),byId=new Map(corpus.assets.map(a=>[a.id,a])),uses=[],rawObjects=new Map(),errors=[];
 // All physical Tiled data is retained, including currently unbound objects.
 for(const asset of corpus.assets){if(!asset.data||typeof asset.data!=='object'||!Array.isArray(asset.data.layers))continue;
  for(const[li,layer]of asset.data.layers.entries())for(const[oi,raw]of(layer.objects??[]).entries()){
   let properties;try{properties=entityProperties(raw.properties);}catch(error){errors.push({asset:asset.id,li,oi,raw,reason:error.message});continue;}
   if(![6,17].includes(properties.object_type)||!(properties.all_layers===true||properties.birdview_puppet===true))continue;
   const key=asset.id+':'+li+':'+oi;rawObjects.set(key,{key,assetId:asset.id,source:{...asset.source,pointer:`/layers/${li}/objects/${oi}`},layer:layer.name,raw,properties});
  }}
 for(const b of bindings)for(const[group,id]of Object.entries(b.groups)){
  assert(byId.has(id));for(const row of rawObjects.values())if(row.assetId===id)uses.push({mapId:Number(b.id),group,key:row.key});
 }
 const affectedIds=new Set(uses.map(u=>u.mapId)),physical=new Map(ir.scripts.map(p=>[p.id,p])),edges=new Map();for(const e of ir.analysis.dependencies){const rows=edges.get(e.site.asset)??[];rows.push(e);edges.set(e.site.asset,rows);}
 const maps=ir.analysis.maps.map(m=>({mapId:Number(m.id),initializer:m.initializer,initializerName:m.initializerName,namespace:{...m.residentScripts,...m.scriptAliases},residentNamespace:m.residentScripts,rawGroups:m.groups}));
 function closure(id,mapId){const queue=[id],ids=new Set(),dependencies=[],unresolved=[];while(queue.length){const id=queue.pop();if(ids.has(id))continue;ids.add(id);for(const edge of edges.get(id)??[]){if(edge.mapId!==undefined&&Number(edge.mapId)!==mapId)continue;dependencies.push(edge);if(edge.kind==='script'){if(!edge.resolved||edge.candidates.length!==1)unresolved.push(edge);for(const next of edge.candidates)queue.push(next);}}}return{ids:[...ids].sort(),dependencies,unresolved};}
 const roots=maps.filter(m=>affectedIds.has(m.mapId)).flatMap(m=>Object.entries(m.namespace).map(([alias,id])=>{assert(id&&physical.has(id),'Full installed physical source missing');const p=physical.get(id),c=closure(id,m.mapId),operandBlockers=c.ids.flatMap(id=>{const p=physical.get(id);return p?[...(p.locals.operandDecoded==='decoded'?[]:[{id,kind:'locals',diagnostic:p.locals.diagnostic}]),...p.instructions.filter(op=>op.operandDecoded!=='decoded').map(op=>({id,site:op.site,raw:op.raw,diagnostic:op.diagnostic}))]:[{id,reason:'Missing physical dependency'}];});return{root:{id,alias,mapId:m.mapId,resident:m.residentNamespace[alias]===id},source:p.source,rawHash:p.rawHash,instructions:p.instructions.length,closure:c,operandBlockers,otherwiseOperandClosed:!c.unresolved.length&&!operandBlockers.length};}));
 const used=new Set(uses.map(u=>u.key));return{kind:'whole-source-flat-npc-cohort-v1',sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,sourceCorpusHash:ir.contentHash,rawObjects:[...rawObjects.values()],uses,unbound:[...rawObjects.values()].filter(r=>!used.has(r.key)),errors,maps,roots,programs:ir.scripts,
 counts:{allMaps:maps.length,physicalObjects:rawObjects.size,mapGroupUses:uses.length,affectedMaps:affectedIds.size,unboundObjects:[...rawObjects.keys()].filter(k=>!used.has(k)).length,rawPropertyErrors:errors.length,allPhysicalPrograms:ir.scripts.length,allInstructions:ir.scripts.reduce((n,p)=>n+p.instructions.length,0),installedRootUses:roots.length,installedPhysicalPrograms:new Set(roots.map(r=>r.root.id)).size,operandClosedRoots:roots.filter(r=>r.otherwiseOperandClosed).length},staticOnly:true,sourceProgramExecution:0,sourceStoryReachability:false,nativeParity:false};
}
