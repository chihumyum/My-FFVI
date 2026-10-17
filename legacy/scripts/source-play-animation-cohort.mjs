import assert from 'node:assert/strict';
/** Whole physical PlayAnim family; finite replay is one explicit operand
 * subfamily. A decoder result never grants an initializer, actor or story. */
export function sourcePlayAnimationCohort(ir) {
 const physical=new Map(ir.scripts.map(p=>[p.id,p])),edges=new Map(),bindings=new Map();
 for(const edge of ir.analysis.dependencies){const list=edges.get(edge.site.asset)??[];list.push(edge);edges.set(edge.site.asset,list);}
 const maps=ir.analysis.maps.map(map=>{const namespace={...map.residentScripts,...map.scriptAliases};
  for(const [alias,id]of Object.entries(namespace)){if(!id)continue;assert.ok(physical.has(id),'Installed physical program missing');const rows=bindings.get(id)??[];rows.push({mapId:Number(map.id),alias,resident:map.residentScripts[alias]===id});bindings.set(id,rows);}
  return {mapId:Number(map.id),initializer:map.initializer,initializerName:map.initializerName,initializerStatus:map.initializerStatus,namespace};});
 const family=ir.scripts.filter(p=>p.instructions.some(i=>i.raw?.mnemonic==='PlayAnim'));
 const allSites=family.flatMap(p=>p.instructions.filter(i=>i.raw?.mnemonic==='PlayAnim').map(i=>({program:p.id,rawHash:p.rawHash,domain:p.domain,...i,bindings:bindings.get(p.id)??[]})));
 const finitePrograms=family.filter(p=>p.domain==='field'&&p.instructions.some(i=>i.raw?.mnemonic==='PlayAnim'&&Number.isInteger(i.raw.operands?.iValues?.[1])&&i.raw.operands.iValues[1]>1));
 function closure(root){const queue=[root.id],ids=new Set(),dependencies=[],unresolved=[];
  while(queue.length){const id=queue.pop();if(ids.has(id))continue;ids.add(id);const p=physical.get(id);if(!p){unresolved.push({id,reason:'Missing physical program'});continue;}
   for(const edge of edges.get(id)??[]){if(edge.mapId!==undefined&&Number(edge.mapId)!==root.mapId)continue;dependencies.push(edge);
    if(edge.kind==='script'){if(!edge.resolved||edge.candidates.length!==1)unresolved.push(edge);for(const candidate of edge.candidates)queue.push(candidate);}}
  }return {ids:[...ids].sort(),dependencies,unresolved};}
 const roots=finitePrograms.flatMap(p=>(bindings.get(p.id)??[]).map(binding=>{const root={...binding,id:p.id},closed=closure(root);
  const blockers=closed.ids.flatMap(id=>{const target=physical.get(id);if(!target)return [{id,reason:'Missing source'}];return [
   ...(target.locals.operandDecoded==='decoded'?[]:[{id,kind:'locals',diagnostic:target.locals.diagnostic}]),
   ...target.instructions.filter(i=>i.operandDecoded!=='decoded').map(i=>({id,site:i.site,raw:i.raw,diagnostic:i.diagnostic}))];});
  return {root,source:p.source,rawHash:p.rawHash,instructions:p.instructions.length,closure:closed,operandBlockers:blockers,
   otherwiseOperandClosed:!closed.unresolved.length&&!blockers.length,runtimeAdmission:'unassessed',storyReachability:'unassessed'};}));
 const retained=new Set(family.map(p=>p.id));for(const map of maps)for(const id of Object.values(map.namespace))if(id)retained.add(id);
 for(const root of roots)for(const id of root.closure.ids)retained.add(id);
 return {kind:'whole-source-play-animation-cohort-v1',sourceSetHash:ir.sourceSetHash,sourceCorpusHash:ir.contentHash,
  allSites,roots,maps,programs:[...retained].sort().map(id=>{const p=physical.get(id);assert.ok(p);return {...p,dependencies:edges.get(id)??[],bindings:bindings.get(id)??[]};}),
  counts:{allPhysicalPrograms:ir.scripts.length,familyPhysicalPrograms:family.length,familyInstructions:family.reduce((n,p)=>n+p.instructions.length,0),allSites:allSites.length,
   fieldSites:allSites.filter(i=>i.domain==='field').length,decodedSites:allSites.filter(i=>i.operandDecoded==='decoded').length,blockedSites:allSites.filter(i=>i.operandDecoded==='blocked').length,
   unassessedSites:allSites.filter(i=>i.operandDecoded==='unassessed').length,finiteFieldSites:allSites.filter(i=>i.domain==='field'&&i.raw.operands.iValues[1]>1).length,
   finitePhysicalPrograms:finitePrograms.length,finiteRootBindings:roots.length,finiteMaps:new Set(roots.map(r=>r.root.mapId)).size,
   operandClosedRoots:roots.filter(r=>r.otherwiseOperandClosed).length,allNamespaceMaps:maps.length,namespaceUses:maps.reduce((n,m)=>n+Object.keys(m.namespace).length,0),
   retainedPhysicalPrograms:retained.size,retainedInstructions:[...retained].reduce((n,id)=>n+physical.get(id).instructions.length,0)},
  staticOnly:true,sourceProgramExecution:0,sourceStoryReachability:false,nativeParity:false};
}
