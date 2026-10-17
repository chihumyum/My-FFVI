// Pure complete-source capability inventory. Does not execute a source battle,
// rebuild worlds or publish content. Static initial support is not an encounter grant.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={compiledDir:'dist',output:'build/reports/source-initial-conditions'};
while(args.length){const flag=args.shift();assert(['--compiled-dir','--output'].includes(flag)&&args[0]);options[flag==='--compiled-dir'?'compiledDir':'output']=args.shift();}
const compiled=resolve(root,options.compiledDir),out=resolve(root,options.output);assert(out.startsWith(resolve(root,'build')+'/'));
const runtime=await runtimeDigest(root,compiled),source=await loadBattleEventMessageSourceInputs(root,compiled),{api,snapshot}=source;
const load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')).href),
 {compileEnemyInitialConditions}=await load('compiler/initial-conditions'),{compileBattleConditionCatalog}=await load('compiler/conditions'),{compileDevelopmentAbility}=await load('compiler/ability');
assert.equal(source.programs.length,53);assert.equal(source.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),2312);
assert.equal(source.scripts.length,3304);assert.equal(source.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
assert.equal(source.dependencies.requestedPartyIds.length,490);assert.equal(source.dependencies.encounters.length,483);assert.equal(source.dependencies.diagnostics.length,7);
for(const p of source.programs){assert.equal(p.compiled.instructions.length,p.data.Mnemonics.length);assert.equal(p.rawHash,api.hash(p.data));api.parseBattleEventProgram(p.compiled);}
const specialAbilities=[211,226,227].map(id=>{
 const compiled=compileDevelopmentAbility(snapshot.reader,id,String(id));
 assert.equal(compiled.plan,null,'Early miss must not remove existing full source dispatch gates');
 return {abilityId:id,source:snapshot.reader.row('ability.csv',id),program:compiled.program,plan:compiled.plan,blockers:compiled.blockers,sources:compiled.sources};
});
const masters=snapshot.reader.ordered('condition.csv');assert.equal(masters.length,100);
const catalog=compileBattleConditionCatalog(snapshot.reader,masters.map(r=>Number(r.values.id)),key=>key).catalog;
const monsters=new Map();for(const encounter of source.dependencies.encounters)for(const [memberIndex,member] of encounter.enemies.entries()){
 const entry=monsters.get(member.monsterId)??{monsterId:member.monsterId,partyIds:[],slots:[]};
 if(!entry.partyIds.includes(encounter.partyId))entry.partyIds.push(encounter.partyId);
 entry.slots.push({partyId:encounter.partyId,memberIndex,slot:member.slot,group:member.group,x:member.x,y:member.y,sprite:member.sprite,aiSource:member.ai.source,aiRawHash:api.hash(member.ai.data)});monsters.set(member.monsterId,entry);
}
assert.equal(monsters.size,324);
const dispositions=[...monsters.values()].map(entry=>{
 const monster=snapshot.reader.row('monster.csv',entry.monsterId),groupId=Number(monster.values.initial_condition),groupRows=snapshot.reader.group('condition_group.csv','group_id',groupId),
  membership=new Set(groupRows.map(r=>Number(r.values.condition_id))),conditions=masters.flatMap((row,masterIndex)=>membership.has(Number(row.values.id))?[{masterIndex,row}]:[]);
 assert.equal(conditions.length,membership.size);
 try{const initial=compileEnemyInitialConditions(snapshot.reader,groupId,catalog);return {...entry,monster,initialGroupId:groupId,groupRows,conditions,conditionIds:initial.conditionIds,
  disposition:'initial-capability-supported-not-entered',sources:initial.sources};}
 catch(error){return {...entry,monster,initialGroupId:groupId,groupRows,conditions,conditionIds:conditions.map(c=>Number(c.row.values.id)),disposition:'blocked',
  blocker:{reason:error.message,dependency:error.dependency}};}
});
const cohorts=new Map();for(const entry of dispositions.filter(r=>r.initialGroupId!==0)){
 const key=entry.conditionIds.join(','),cohort=cohorts.get(key)??{conditionIds:entry.conditionIds,conditionTypes:entry.conditions.map(c=>Number(c.row.values.condition_type)),monsterIds:[],partyIds:[],dispositions:[]};
 cohort.monsterIds.push(entry.monsterId);for(const party of entry.partyIds)if(!cohort.partyIds.includes(party))cohort.partyIds.push(party);
 cohort.dispositions.push({monsterId:entry.monsterId,disposition:entry.disposition,...(entry.blocker?{blocker:entry.blocker}:{})});cohorts.set(key,cohort);
}
assert.equal(cohorts.size,24);const nonzero=dispositions.filter(r=>r.initialGroupId!==0),supported=nonzero.filter(r=>r.disposition!=='blocked'),blocked=nonzero.filter(r=>r.disposition==='blocked');
assert.equal(nonzero.length,131);assert.equal(supported.length,101);assert.equal(blocked.length,30);
const candidates=supported.filter(row=>row.conditionIds.includes(96)||row.conditionIds.length>1),partyCount=rows=>new Set(rows.flatMap(r=>r.partyIds)).size;
assert.equal(candidates.length,66);assert.equal(partyCount(candidates),149);assert.equal(partyCount(supported),218);
assert.equal(new Set(candidates.map(r=>r.conditionIds.join(','))).size,6);
// Unknown lifecycle combos remain explicit; no list of source monsters grants runtime behavior.
for(const row of blocked)assert(row.blocker.reason&&row.blocker.dependency);
await mkdir(out,{recursive:true});
const payload={kind:'whole-source-initial-condition-inventory-v1',sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash,
 sourceDigest:source.sourceDigest,completeBattlePrograms:source.programs,completeDependencies:source.dependencies,
 specialAbilities,orderedConditionMasters:masters.map((row,masterIndex)=>({masterIndex,row})),monsters:dispositions,cohorts:[...cohorts.values()],
 sourceExecutions:0,worldCompilations:0,publications:0,sourceStoryReachability:false};
const file=resolve(out,'full-inventory.json'),bytes=Buffer.from(JSON.stringify(payload)+'\n');await writeFile(file,bytes);
assert.equal(await runtimeDigest(root,compiled),runtime,'Runtime changed during source observation');
const report={kind:'whole-source-initial-condition-check-v1',result:'passed-pure-capability-inventory-not-source-execution',runtimeSha256:runtime,
 sourceSetHash:payload.sourceSetHash,parentSourceSetHash:payload.parentSourceSetHash,sourceDigest:source.sourceDigest,
 counts:{allPhysicalPrograms:3304,allRawInstructions:186003,battlePrograms:53,battleInstructions:2312,requestedParties:490,descriptors:483,diagnostics:7,
  dependencyMonsters:324,nonzeroInitialMonsters:131,cohorts:24,supportedInitialMonsters:101,supportedInitialPartyReferences:218,
  candidateInitialMonsters:66,candidateInitialPartyReferences:149,candidateCohorts:6,concretelyBlockedMonsters:30,enteredBattles:0},
 artifacts:[{path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}],
 sourceExecutions:0,worldCompilations:0,publications:0,nativeDynamicParity:false,browserVerified:false,
 limitations:['Static initial support does not admit AI/ability/flag/handoff or story dependencies.',
 'All 24 combinations remain evaluated; unknown Double/Reflex/BarrierChange and other real behaviors stay blocked.',
 'Late nonzero initialization and player Leviteto renderer/field lifecycle retain separate gates.',
 'Actual source ability211/226/227 ability types613/621 implementation remains independently gated; common early miss is not a bypass.']};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:resolve(out,'report.json')}));
