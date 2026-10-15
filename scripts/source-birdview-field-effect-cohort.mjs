import assert from 'node:assert/strict';
/** All raw kind-11 rows and full installed namespaces stay in the denominator,
 * even when import or media is unknown. Targeting is static, not execution. */
export function sourceBirdviewFieldEffectCohort(corpus,ir,{bindMapPackages,entityProperties,compileFieldEffectBoard}){
 const packages=bindMapPackages(corpus.assets,corpus.tables),all=new Map(),errors=[];
 for(const a of corpus.assets){if(!a.data||typeof a.data!=='object'||!Array.isArray(a.data.layers))continue;
  for(const[li,l]of a.data.layers.entries())for(const[oi,raw]of(l.objects??[]).entries()){
   let properties;try{properties=entityProperties(raw.properties);}catch(e){errors.push({asset:a.id,raw,reason:e.message});continue;}if(properties.object_type!==11)continue;
   const key=a.id+':'+li+':'+oi,source={...a.source,pointer:`/layers/${li}/objects/${oi}`};let definition=null,diagnostic=null;
   try{definition=compileFieldEffectBoard(properties,{x:raw.x,y:raw.y,width:raw.width,height:raw.height},corpus.tables['mapobject.csv'],source);}catch(e){diagnostic=e.message;}
   all.set(key,{key,assetId:a.id,source,rawLayer:{...l,objects:undefined},raw,properties,definition,diagnostic});
  }}
 const uses=[];for(const b of packages)for(const[group,id]of Object.entries(b.groups))for(const o of all.values())if(o.assetId===id)uses.push({mapId:Number(b.id),group,key:o.key});
 const rawObjects=[...all.values()].filter(o=>o.properties.birdview_puppet===true),keys=new Set(rawObjects.map(o=>o.key)),familyUses=uses.filter(u=>keys.has(u.key)),affected=new Set(familyUses.map(u=>u.mapId));
 const physical=new Map(ir.scripts.map(p=>[p.id,p])),edges=new Map();for(const e of ir.analysis.dependencies){const a=edges.get(e.site.asset)??[];a.push(e);edges.set(e.site.asset,a);}
 const maps=ir.analysis.maps.map(m=>({mapId:Number(m.id),initializer:m.initializer,initializerName:m.initializerName,namespace:{...m.residentScripts,...m.scriptAliases},residentNamespace:m.residentScripts,rawGroups:m.groups}));
 function closure(id,mapId){const queue=[id],ids=new Set(),dependencies=[],unresolved=[];while(queue.length){const id=queue.pop();if(ids.has(id))continue;ids.add(id);for(const e of edges.get(id)??[]){if(e.mapId!==undefined&&Number(e.mapId)!==mapId)continue;dependencies.push(e);if(e.kind==='script'){if(!e.resolved||e.candidates.length!==1)unresolved.push(e);queue.push(...e.candidates);}}}return{ids:[...ids].sort(),dependencies,unresolved};}
 const roots=maps.filter(m=>affected.has(m.mapId)).flatMap(m=>Object.entries(m.namespace).map(([alias,id])=>{const p=physical.get(id);assert(p,'Full original source program missing');const c=closure(id,m.mapId),operandBlockers=c.ids.flatMap(id=>{const p=physical.get(id);return p?[...(p.locals.operandDecoded==='decoded'?[]:[{id,kind:'locals',diagnostic:p.locals.diagnostic}]),...p.instructions.filter(op=>op.operandDecoded!=='decoded').map(op=>({id,site:op.site,raw:op.raw,diagnostic:op.diagnostic}))]:[{id,reason:'Missing physical dependency'}];});return{root:{id,alias,mapId:m.mapId,resident:m.residentNamespace[alias]===id},source:p.source,rawHash:p.rawHash,instructions:p.instructions.length,closure:c,operandBlockers,otherwiseOperandClosed:!c.unresolved.length&&!operandBlockers.length};}));
 const used=new Set(uses.map(u=>u.key));return{kind:'whole-source-birdview-field-effect-cohort-v1',sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,sourceCorpusHash:ir.contentHash,
  allRawObjects:[...all.values()],allRawUses:uses,rawObjects,uses:familyUses,unbound:rawObjects.filter(o=>!used.has(o.key)),errors,maps,roots,programs:ir.scripts,
  counts:{allMaps:maps.length,allKind11PhysicalObjects:all.size,allKind11MapGroupUses:uses.length,physicalObjects:rawObjects.length,mapGroupUses:familyUses.length,affectedMaps:affected.size,unboundObjects:rawObjects.filter(o=>!used.has(o.key)).length,rawPropertyErrors:errors.length,allPhysicalPrograms:ir.scripts.length,allInstructions:ir.scripts.reduce((n,p)=>n+p.instructions.length,0),installedRootUses:roots.length,installedPhysicalPrograms:new Set(roots.map(r=>r.root.id)).size,operandClosedRoots:roots.filter(r=>r.otherwiseOperandClosed).length},staticOnly:true,sourceProgramExecution:0,sourceStoryReachability:false,nativeParity:false};
}
