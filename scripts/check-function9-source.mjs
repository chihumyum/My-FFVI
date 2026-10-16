// Whole-source census and differential. This does not execute original bodies,
// publish content or turn parameter/lifecycle tests into story completion.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const options=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>i%2===0?[v,a[i+1]]:null).filter(Boolean));
const view=resolve(import.meta.dirname,'..'),root=resolve(options['--source-root']??view),compiled=resolve(options['--compiled']??resolve(view,'dist')),
  output=resolve(options['--output']??resolve(view,'build/reports/function9-source.json')),
  load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')).href),sha=v=>createHash('sha256').update(v).digest('hex'),
  runtimeSha256=await runtimeDigest(view,compiled),api=Object.assign({},...await Promise.all([
    'compiler/battle-ability-content','compiler/conditions','compiler/system-messages','compiler/battle-ai','compiler/content'].map(load))),
  input=await loadBattleEventMessageSourceInputs(root,compiled),s=input.snapshot,
  system=await api.loadSystemMessages(root,s.manifest.parentSourceSetHash,s.manifest.sources),
  name=key=>{const values=[...new Set([system.messages[key],s.messages.story_mes_zhc?.[key]].filter(v=>typeof v==='string'))];return values.length===1?values[0]:null;},
  catalog=api.compileBattleAbilityContent(s.reader,s.tables,name),
  conditions=api.compileBattleConditionCatalog(s.reader,s.tables['condition.csv'].map(row=>Number(row.id)),key=>name(key)??key),
  behaviors=new Map(conditions.catalog.behaviors.map(b=>[b.id,b])),
  physicalAi=input.scripts.filter(p=>p.source.assetPath.includes('/MonsterAI/')).map(p=>{
    let binding;try{binding=input.encounterSources.json(p.source.assetPath.split('/').at(-1).replace(/\.json$/,''));}catch{}
    try{const typed=api.compileBattleAI(p.data,binding?.source??null);
      return {...p,rawHash:api.hash(p.data),typed,exportBound:!!binding,abilityIds:api.battleAIAbilities(typed)};
    }catch(error){return{...p,rawHash:api.hash(p.data),typed:null,exportBound:!!binding,error:error.message,abilityIds:[]};}
  }),
  masterAi=s.tables['monster_ai_script.csv'].map(row=>{try{const source=input.encounterSources.json(row.script_name);return{row:s.reader.row('monster_ai_script.csv',row.id),source,rawHash:api.hash(source.data),typed:api.compileBattleAI(source.data,source.source)};}
    catch(error){return{row:s.reader.row('monster_ai_script.csv',row.id),error:error.message};}}),
  family=Object.values(catalog.abilities).filter(a=>a.program.functions.some(fn=>fn.type===9)).map(a=>{
    const entry=catalog.entries[a.id],rawDependencies=entry.sources.map(source=>{
      const tables=Object.keys(s.tables).filter(t=>source.assetPath===t||source.assetPath.endsWith('/'+t));assert.equal(tables.length,1);
      const row=s.reader.row(tables[0],source.rowId);assert.equal(api.canonical(row.source),api.canonical(source));return row;
    });
    return{id:a.id,definition:a,entry,rawDependencies,slots:a.program.functions.filter(fn=>fn.type===9).map(fn=>{
      const row=s.reader.row('condition.csv',fn.values[0]),behavior=behaviors.get(fn.values[0])??null;
      return{function:fn,condition:row,behavior,lifecycle:behavior?'existing-positive-behavior':'missing-provider',
        providerBlockers:conditions.providerBlockers.filter(b=>b.conditionId===fn.values[0])};
    }),aiSites:physicalAi.flatMap(p=>(p.typed?.instructions??[]).flatMap((op,pc)=>op.op.abilities?.includes(a.id)?[{program:p.id,source:p.source,rawHash:p.rawHash,pc,raw:p.data.Mnemonics[pc],typed:op.op}]:[]))};
  });
const groups=new Map;
for(const member of family)for(const slot of member.slots){
  const type=Number(slot.condition.values.condition_type),g=groups.get(type)??{type,rows:[],abilityIds:[],sole:0,mixed:0,plans:0,positiveBehaviorSlots:0,missingProviderSlots:0,blockers:{}};
  if(!g.rows.some(r=>r.source.rowId===slot.condition.source.rowId))g.rows.push(slot.condition);
  g.abilityIds.push(member.id);g[member.definition.program.functions.length===1?'sole':'mixed']++;
  if(member.definition.plan)g.plans++;else for(const blocker of member.definition.blockers)g.blockers[blocker]=(g.blockers[blocker]??0)+1;
  g[slot.behavior?'positiveBehaviorSlots':'missingProviderSlots']++;groups.set(type,g);
}
const typeClassification=[...groups.values()].sort((a,b)=>b.abilityIds.length-a.abilityIds.length);
assert.equal(Object.keys(catalog.abilities).length,1530);assert.equal(physicalAi.length,430);assert.equal(input.scripts.length,3304);
assert.equal(family.length,564);assert.equal(family.reduce((n,p)=>n+p.slots.length,0),564);assert.equal(typeClassification.length,45);
const familyIds=new Set(family.map(a=>a.id));
let differential=null;
if(options['--baseline']){
  const bytes=await readFile(resolve(options['--baseline'])),before=JSON.parse(bytes);
  assert.equal(before.sourceSetHash,s.sourceSetHash);assert.equal(before.sourceDigest,input.sourceDigest);
  assert.equal(before.counts.abilities,1530);assert.equal(before.physicalAi.length,430);
  const added=[],lost=[],changedOther=[],changedExistingPlans=[];
  for(const a of Object.values(catalog.abilities)){
    const old=before.catalog.abilities[a.id];assert(old,'Missing baseline ability '+a.id);
    assert.equal(api.canonical(a.program),api.canonical(old.program),'Changed raw source ability program');
    if(a.plan&&!old.plan)added.push(a.id);if(old.plan&&!a.plan)lost.push(a.id);
    if(old.plan&&api.canonical(a)!==api.canonical(old))changedExistingPlans.push(a.id);
    if(!familyIds.has(a.id)&&api.canonical(a)!==api.canonical(old))changedOther.push(a.id);
  }
  assert.equal(lost.length,0);assert.equal(changedOther.length,0);assert.equal(changedExistingPlans.length,0);
  assert(added.every(id=>familyIds.has(id)));
  const ai=new Map(before.physicalAi.map(p=>[p.id,p]));
  for(const p of physicalAi){const old=ai.get(p.id);assert(old);assert.equal(p.rawHash,old.rawHash);assert.equal(api.canonical(p.typed),api.canonical(old.typed));assert.equal(p.error,old.error);}
  assert.equal(api.canonical(masterAi),api.canonical(before.masterAi));
  differential={baselineSha256:sha(bytes),beforePlans:before.catalog.report.boundedHostPlans,afterPlans:catalog.report.boundedHostPlans,
    added,lost,changedOther,changedExistingPlans,retainedPhysicalAi:physicalAi.length,sourceProgramsUnchanged:true};
}
const counts={abilities:1530,plans:catalog.report.boundedHostPlans,blocked:catalog.report.blocked,allPrograms:input.scripts.length,
  allInstructions:input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),physicalAi:physicalAi.length,
  physicalAiInstructions:physicalAi.reduce((n,p)=>n+p.data.Mnemonics.length,0),masterAi:masterAi.length,
  physicalAiContainerErrors:physicalAi.filter(p=>p.error).length,
  boundMasterAi:masterAi.filter(p=>p.source).length,unboundMasterAi:masterAi.filter(p=>p.error).length,
  familyDeclarations:family.length,familySlots:family.reduce((n,p)=>n+p.slots.length,0),
  familySole:family.filter(p=>p.definition.program.functions.length===1).length,familyMixed:family.filter(p=>p.definition.program.functions.length!==1).length,
  familyTypes:typeClassification.length,positiveBehaviorTypes:typeClassification.filter(g=>g.positiveBehaviorSlots>0).length,
  missingProviderTypes:typeClassification.filter(g=>g.missingProviderSlots>0).length,
  positiveBehaviorSlots:typeClassification.reduce((n,g)=>n+g.positiveBehaviorSlots,0),missingProviderSlots:typeClassification.reduce((n,g)=>n+g.missingProviderSlots,0),
  admittedFamilyPlans:family.filter(p=>p.definition.plan).length,retainedFamilyBlockers:family.filter(p=>!p.definition.plan).length,
  familyAiSiteAbilityPairs:family.reduce((n,p)=>n+p.aiSites.length,0),
  familyAiInstructions:new Set(family.flatMap(p=>p.aiSites.map(site=>JSON.stringify([site.program,site.pc])))).size,
  admittedFamilyAiSiteAbilityPairs:family.filter(p=>p.definition.plan).reduce((n,p)=>n+p.aiSites.length,0),
  admittedFamilyAiInstructions:new Set(family.filter(p=>p.definition.plan).flatMap(p=>p.aiSites.map(site=>JSON.stringify([site.program,site.pc])))).size};
const report={kind:'source-function9-complete-family-v1',runtimeSha256,sourceSetHash:s.sourceSetHash,sourceDigest:input.sourceDigest,
  counts,differential,catalog,conditions,family,typeClassification,physicalAi,masterAi,
  sourcePrograms:input.scripts.map(p=>({id:p.id,source:p.source,rawHash:api.hash(p.data),instructions:p.data.Mnemonics.length})),
  sourceProgramExecutions:0,sourceCampaignComplete:false,originalGameExecuted:false,producerExecutions:0,browserExecutions:0};
assert.equal(await runtimeDigest(view,compiled),runtimeSha256,'Runtime changed during complete source census');
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report)+'\n');
console.log(JSON.stringify({counts,differential,runtimeSha256,reportSha256:sha(await readFile(output))},null,2));
