// Whole source data/decoder comparison. This is not a world publication or a
// claim that all nominated source bodies execute through their other gates.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const args=Object.fromEntries(Array.from({length:process.argv.slice(2).length/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
const root=resolve(args['--root']??resolve(import.meta.dirname,'..')),compiled=resolve(root,args['--compiled']??'dist'),before=resolve(root,args['--before-compiled']??'dist');
const physical=resolve(root,args['--physical-input']??'build/wip/source-field-syscall-capability-nomination/physical-input.json'),output=resolve(root,args['--output']??'build/reports/source-non-encounter-areas.json');
const sha=b=>createHash('sha256').update(b).digest('hex'),raw=await readFile(physical),p=JSON.parse(raw);
const load=(dir,name)=>import(pathToFileURL(resolve(dir,'src/'+name+'.js')));
const [oldGroup,newGroup,oldOp,newOp,oldEntry,newEntry,{hash},{sourcePropertyAreaCellRect}]=await Promise.all([
 load(before,'compiler/entity-group'),load(compiled,'compiler/entity-group'),load(before,'compiler/field'),load(compiled,'compiler/field'),
 load(before,'compiler/field-entry-context'),load(compiled,'compiler/field-entry-context'),load(compiled,'compiler/content'),load(compiled,'core/field-move-area')]);
assert.equal(p.allAssets.length,6951);assert.equal(p.allProgramBindings.length,3304);
const assets=new Map(p.allAssets.map(a=>[a.id,a])),programs=p.allProgramBindings.map(b=>{const a=assets.get(b.id);assert.ok(a);assert.equal(hash(a.data),b.rawHash);return a;});
let ops=0;const decoderExceptions=[];
for(const a of programs)for(const [index,raw]of a.data.Mnemonics.entries()){
 const site={script:a.id,index,source:{...a.source,pointer:'/Mnemonics/'+index}};
 const project=(decoder)=>{try{return {op:decoder.decodeFieldOp(raw,site,p.tables,p.messages)}}catch(error){return {error:String(error)}}};
 const current=project(newOp),prior=project(oldOp);assert.deepEqual(current,prior,`IR changed ${a.id}:${index}`);
 if(current.error)decoderExceptions.push({assetId:a.id,index,error:current.error});ops++;
}
assert.equal(ops,186003);
let objectCount=0;const physicalAreas=[],groupAssets=new Set();
for(const a of p.allAssets)for(const [li,l]of (a.data?.layers??[]).entries())for(const [oi,o]of (l.objects??[]).entries()){
 objectCount++;if(!o.properties?.some(q=>q.name==='object_type'&&q.value===23))continue;
 physicalAreas.push({assetId:a.id,pointer:`/layers/${li}/objects/${oi}`,source:a.source,raw:o,layer:l.name});groupAssets.add(a.id);
}
assert.equal(physicalAreas.length,13);assert.equal(groupAssets.size,11);
const checked=[],changed=[],ready=[],maps=[];let oldKinds=0,oldTransforms=0;
for(const m of p.mapBindings){
 let has=false;
 for(const[name,id]of Object.entries(m.groups)){
  const a=assets.get(id);assert.ok(a);const projectGroup=decoder=>{try{return {group:decoder.compileEntityGroup(name,a,p.tables,p.messages)}}catch(error){return{error:String(error)}}};
  const prior=projectGroup(oldGroup),current=projectGroup(newGroup);
  if(prior.error||current.error){assert.deepEqual(current,prior);checked.push({mapId:m.id,group:name,assetId:id,error:current.error});continue;}
  const old=prior.group,next=current.group;
  const pointers=new Set(physicalAreas.filter(o=>o.assetId===id).map(o=>o.pointer));
  const expected=old.blockers.filter(b=>!(pointers.has(b.source.pointer)&&['Unsupported entity kind 23','Unsupported entity transform'].includes(b.reason)));
  assert.deepEqual(next.blockers,expected,`other blockers changed ${m.id}/${name}`);
  assert.equal(next.entities.length,old.entities.length);
  for(let i=0;i<next.entities.length;i++){
   const e=next.entities[i],prior=old.entities[i],{nonEncounterArea,...rest}=e;assert.deepEqual(rest,prior);
   if(e.kind===23){assert.ok(nonEncounterArea);assert.ok(pointers.has(e.source.pointer));}
   else assert.equal(nonEncounterArea,undefined);
  }
  if(pointers.size){has=true;oldKinds+=old.blockers.filter(b=>pointers.has(b.source.pointer)&&b.reason==='Unsupported entity kind 23').length;
   oldTransforms+=old.blockers.filter(b=>pointers.has(b.source.pointer)&&b.reason==='Unsupported entity transform').length;
   const defaultGroup=oldGroup.compileEntityGroup('entity_default',assets.get(m.groups.entity_default),p.tables,p.messages);
   const rangeEntity=defaultGroup.entities.find(e=>e.kind===27),tile=assets.get(m.tilemap).data;
   const range=rangeEntity?{x:rangeEntity.x,y:rangeEntity.y,width:rangeEntity.width,height:rangeEntity.height}:{x:0,y:0,width:tile.width,height:tile.height};
   const row={mapId:m.id,group:name,assetId:id,range,areas:next.entities.filter(e=>e.kind===23).map(e=>({definition:e.nonEncounterArea,cellArea:sourcePropertyAreaCellRect(e.nonEncounterArea.pixelBounds,range)})),oldBlockers:old.blockers,remainingBlockers:next.blockers};
   changed.push(row);if(!next.blockers.length)ready.push({mapId:m.id,group:name});
  }
  checked.push({mapId:m.id,group:name,assetId:id,beforeHash:hash(old),afterHash:hash(next)});
 }
 if(has){const a=oldEntry.compileFieldEntryContext(p.allAssets,p.tables,Number(m.id)),b=newEntry.compileFieldEntryContext(p.allAssets,p.tables,Number(m.id));assert.deepEqual(a,b);assert.equal(a.foot.kind,'uniform-zero');maps.push({mapId:m.id,entryDefinition:b});}
}
assert.equal(changed.length,13);assert.equal(maps.length,11);assert.equal(oldKinds,15);assert.equal(oldTransforms,8);
assert.equal(p.completeBattlePrograms.length,53);assert.equal(p.completeBattleDependencies.requestedPartyIds.length,490);
// Original SetEntities operands and complete original groups on the real
// initialized Session. These single-op mechanism probes do not execute or
// replace the complete original source bodies, which remain separately kept.
const {nonEncounterSessionFixture}=await import(pathToFileURL(resolve(compiled,'tests/fixtures/non-encounter-area-session.js')));
const {sealBatchContent}=await import(pathToFileURL(resolve(compiled,'tests/fixtures/content-batch.js')));
const {SOURCE_NON_ENCOUNTER_AREAS}=await load(compiled,'core/field-non-encounter-areas');
const groupIds=new Set(physicalAreas.map(a=>a.assetId));
const sourceSites=p.analysis.dependencies.filter(d=>d.kind==='entity-group'&&d.candidates.some(id=>groupIds.has(id)));
const sourceParameterSessions=[];
for(const d of sourceSites){
 assert.equal(d.candidates.length,1);const sourceAsset=assets.get(d.site.asset),rawOp=sourceAsset.data.Mnemonics[d.site.index];
 const asset=assets.get(d.candidates[0]),group=newGroup.compileEntityGroup(d.reference,asset,p.tables,p.messages);
 if(group.blockers.length){
  sourceParameterSessions.push({sourceSite:d.site,mapId:d.mapId,group:d.reference,originalRaw:rawOp,groupRawHash:hash(asset.data),admitted:false,stage:'original-other-static-gates-preserved-no-session-created',blockedReasons:group.blockers,areas:group.entities.filter(e=>e.kind===23).length});continue;
 }
 const f=nonEncounterSessionFixture(),name='original-kind23-parameters';
 f.map.map.groups[d.reference]=structuredClone(group);f.map.map.entryContext.groups[d.reference]={savePointCount:0,reason:null,source:asset.source};
 f.map.scripts[name]=[{...newOp.decodeFieldOp(rawOp,{script:name,index:0,source:{...sourceAsset.source,pointer:'/Mnemonics/'+d.site.index}},p.tables,p.messages)},
  {kind:'exit',script:name,index:1,source:sourceAsset.source}];
 f.map.scriptPuppetContexts[name]={...f.map.scriptPuppetContexts.reserved};f.map.scriptLocals[name]=null;
 f.map.scriptTransitionMetadata[name]={customAnimations:'none'};f.map.scriptSystemFlags[name]={keepBadStatusVisual:false};
 Object.assign(f.map,sealBatchContent(f.map));f.world.maps[f.map.mapId].contentHash=f.map.contentHash;Object.assign(f.world,sealBatchContent(f.world));
 f.content.worldCatalogHash=f.world.contentHash;f.content.mapContentHash=f.map.contentHash;Object.assign(f.content,sealBatchContent(f.content));
 const {game}=f.make(),before=game.state.snapshot();assert.equal(game.field.startEvent(name),true);
 if(group.blockers.length){assert.equal(game.field.stop?.kind,'unsupported');assert.equal(game.field.activeGroups.has(d.reference),false);assert.equal(game.field.sourceNonEncounterAreaProperties.length,0);}
 else{assert.equal(game.field.stop,null,game.field.stop?.message);assert.equal(game.field.activeGroups.has(d.reference),true);
  assert.deepEqual(game.field.sourceNonEncounterAreaProperties,group.entities.filter(e=>e.kind===23).map(e=>e.nonEncounterArea));}
 assert.deepEqual(game.state.snapshot(),before);
 sourceParameterSessions.push({sourceSite:d.site,mapId:d.mapId,group:d.reference,originalRaw:rawOp,groupRawHash:hash(asset.data),
  admitted:group.blockers.length===0,blockedReasons:group.blockers,areas:group.entities.filter(e=>e.kind===23).length});
}
assert.equal(sourceParameterSessions.length,38);
const r={kind:'source-non-encounter-areas-complete-audit-v1',physicalInputSha256:sha(raw),counts:{allAssets:p.allAssets.length,programs:programs.length,instructions:ops,allTiledObjects:objectCount,allMapDefinitions:p.mapBindings.length,allGroupBindings:checked.length,physicalAreas:13,physicalGroupAssets:11,mapAliasBindings:changed.length,affectedMaps:maps.length,removedKindBlockers:oldKinds,removedVisibleTransformBlockers:oldTransforms,otherBlockerChanges:0,decodedInstructionChanges:0,preservedDecoderExceptions:decoderExceptions.length,otherwiseReadyGroupBindings:ready.length,battlePrograms:53,battlePartyDependencies:490,originalParameterBindings:sourceParameterSessions.length,actualControlledSessionInstances:sourceParameterSessions.filter(s=>s.admitted).length,actualOriginalParameterPhysicalSites:new Set(sourceParameterSessions.map(s=>s.sourceSite.asset+':'+s.sourceSite.index)).size,actualOriginalParameterSessionAdmissions:sourceParameterSessions.filter(s=>s.admitted).length},sourceParameterSessions,physicalAreas,changed,ready,maps,checked,decoderExceptions,limits:['Static otherwise-ready groups are not story reachability or whole-map admission.','Other NPC/controller/particle/condition/media gates remain complete.','No native random encounter required_steps or RNG parity claim.'],scope:{worldCompilations:0,sourceBodiesExecuted:0,actualControlledParameterSessionInstances:sourceParameterSessions.filter(s=>s.admitted).length,publications:0}};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r.counts));
