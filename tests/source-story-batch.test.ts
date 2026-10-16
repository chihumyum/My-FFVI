import test from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {mkdir,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {hash} from "../src/compiler/content.js";
import {planContentBatch} from "../src/compiler/content-batch.js";
import {assessSourceStoryBatch,type SourceStoryBatchContract,type SourceStoryProgramWitness,type SourceStoryRun} from "../src/compiler/source-story-batch.js";
import {GameContentRepository} from "../src/core/game-content.js";
import {GameSession} from "../src/core/game-session.js";
import type {Op} from "../src/field/types.js";
import {contentBatchFixture,sealBatchContent} from "./fixtures/content-batch.js";

const load=async(name:string)=>import(pathToFileURL(resolve(process.cwd(),"scripts",name+".mjs")).href);
const {runtimeDigest}=await load("runtime-digest"),{runSourceStoryBatch}=await load("source-story-batch");
const source={file:"synthetic-complete-story",assetPath:"authored-complete-source-contract",sha256:hash("synthetic source bytes")};
const flag={category:"ScenarioFlag1" as const,index:8};

function fixture(){
  const f=contentBatchFixture(),parent=hash("synthetic parent"),fieldSource=hash("synthetic field"),worldSource=hash("synthetic world");
  f.packages.entry.parentSourceSetHash=f.packages.catalog.parentSourceSetHash=parent;
  f.packages.entry.sourceSetHash=fieldSource;f.packages.catalog.sourceSetHash=worldSource;f.packages.battle.common.fieldSourceSetHash=fieldSource;
  const ops=(script:string,rows:Record<string,unknown>[])=>rows.map((row,index)=>({...row,script,index,source})as unknown as Op);
  const entry=f.packages.entry;
  entry.scripts.after=ops("after",[
    {kind:"branch",left:flag,operator:"＝",right:{kind:"immediate",value:0},target:3},
    {kind:"flag",ref:flag,operation:"reset"},{kind:"jump",target:4},
    {kind:"flag",ref:flag,operation:"set"},{kind:"exit"},
  ]);
  entry.scripts.journey=entry.scripts.journey!.map((op,index)=>({...op,index,source}));
  f.packages.entry=sealBatchContent(entry);
  const first=f.packages.maps[0]!;first.parentSourceSetHash=parent;first.sourceSetHash=worldSource;
  first.scripts=structuredClone(entry.scripts);first.map=structuredClone(entry.map);f.packages.maps=[sealBatchContent(first)];
  f.packages.catalog.maps={1:{...f.packages.catalog.maps[1]!,contentHash:f.packages.maps[0]!.contentHash}};
  f.packages.catalog=sealBatchContent(f.packages.catalog);
  f.packages.battle.common.sprites.synthetic={file:"/synthetic/story-player.png",width:16,height:16};
  f.packages.battle=sealBatchContent(f.packages.battle);
  f.manifest.id="synthetic-complete-story-contract";f.manifest.mapIds=[1];
  const route=f.manifest.routes[0]!;route.expectedMapId=1;route.requiredMapIds=[1];
  route.inputs=[{kind:"move",direction:"right"},{kind:"save-restore"},{kind:"move",direction:"left"},{kind:"move",direction:"right"}];
  f.manifest.routes.push({...structuredClone(route),id:"actual-checkpoint-continuation",inputs:[{kind:"move",direction:"left"},...structuredClone(route.inputs)]});
  const refs={kind:"game-content-refs-v1" as const,profile:"source" as const,
    world:{url:"/world/catalog.json",contentHash:f.packages.catalog.contentHash},source:null,
    development:{entry:{url:"/game/content.json",contentHash:f.packages.entry.contentHash},battle:{url:"/game/battle.json",contentHash:f.packages.battle.contentHash}}};
  f.manifest.contentRefs=refs;
  const files=new Map<string,unknown>([[refs.world.url,f.packages.catalog],[refs.development.entry.url,f.packages.entry],
    [refs.development.battle.url,f.packages.battle],...f.packages.maps.map(m=>[f.packages.catalog.maps[m.mapId]!.url,m]as[string,unknown])]);
  const repository=new GameContentRepository(async url=>{assert.ok(files.has(url),url);return files.get(url);},"source",refs);
  const plan=planContentBatch(f.manifest,f.packages),initial=new GameSession(f.packages.entry,f.packages.battle,314).checkpoint();
  const witnesses:SourceStoryProgramWitness[]=Object.entries(entry.scripts).map(([script,typedBody])=>({kind:"synthetic-source-program-v1",mapId:1,script,
    sourceSetHash:parent,source,typedBody,rawBody:typedBody.map((op,index)=>({label:index===0?"Main":"",mnemonic:op.kind,index}))}));
  return {f,plan,repository,refs,initial,witnesses,parent};
}
async function execute(f=fixture()){
  const runtimeHash=await runtimeDigest(process.cwd(),"dist"),binding={sourceSetHash:f.parent,sourceFingerprints:{script:source.sha256},runtimeHash,
    contentRefs:f.refs,contentHashes:f.plan.contentHashes};
  const owned=f.initial.owned,expectation=(pass:number)=>({mapId:null,flags:[{ref:flag,value:0}],
    roster:owned.roster.map(({id,sourceId,ownedId,enabled})=>({id,sourceId,ownedId,enabled})),party:owned.party,
    gil:owned.gil+28*pass,items:[{id:10,count:4*pass}]});
  const routeId=f.plan.manifest.routes[0]!.id;
  const contract:SourceStoryBatchContract={kind:"source-story-batch-contract-v1",id:f.plan.manifest.id,lane:"synthetic-source-contract",
    manifestHash:f.plan.manifestHash,dependencyHash:f.plan.dependencyHash,
    roots:f.witnesses.map(w=>({id:w.script,mapId:1,script:w.script,source,fingerprintKey:"script",rawBodyHash:hash(w.rawBody),typedBodyHash:hash(w.typedBody),
      entryPc:0,rawMainIndex:0,completion:w.script==="journey"?"handoff":"natural-finish",successorRootIds:w.script==="journey"?["after"]:[]})),
    routes:f.plan.manifest.routes.map((r,pass)=>({id:r.id,predecessorRouteId:pass===0?null:routeId,rootIds:["journey","after"],requiredEncounterIds:[1000],
      branches:[{id:"first-pass",rootId:"after",pc:0,nextPc:3},{id:"restored-return",rootId:"after",pc:0,nextPc:1}],
      continuity:{kind:"story-route-contract-v1",id:r.id,binding,entry:expectation(pass),exit:expectation(pass+1),
        changes:{gil:28,items:[{id:10,count:4}],completedBattles:[{serial:pass*2,encounterId:1000,outcome:"victory"},{serial:pass*2+1,encounterId:1000,outcome:"victory"}]}}}))};
  const report=await runSourceStoryBatch({root:process.cwd(),compiled:"dist",plan:f.plan,contract,repository:f.repository,binding,witnesses:f.witnesses});
  const assess=(runs:SourceStoryRun[]=report.runs,c:unknown=contract)=>assessSourceStoryBatch({id:contract.id,contract:c,binding,manifestHash:f.plan.manifestHash,
    dependencyHash:f.plan.dependencyHash,diagnostics:f.plan.diagnostics,witnesses:f.witnesses,runs});
  return {f,report,contract,binding,assess};
}

test("complete synthetic source contract uses normal Main, real battle return, both branches and Storage continuation",async()=>{
  const x=await execute();assert.equal(x.report.runs[0].receipt.result,"completed",JSON.stringify(x.report.runs[0].receipt.boundary));
  assert.equal(x.report.assessment.status,"passed",JSON.stringify(x.report.assessment.issues));
  assert.equal(x.report.assessment.coverage,"synthetic-contract-only");assert.equal(x.report.assessment.sourceCampaignComplete,false);
  assert.equal(x.report.runs.length,2);assert.equal(x.report.runs[1].receipt.lane,"story-checkpoint-continuation");
  assert.equal(x.report.assessment.branches.length,4);assert(x.report.runs[0].sourceStory.checkpointRelays.some((r:{final:boolean})=>!r.final));
  assert.equal(x.report.runs[0].execution.committedReturns,2);
  // Necessary negative evidence, without adding unrelated broad test families.
  for(const fault of ["missing-root","fake-completed","wrong-runtime","wrong-source","mid-pc","missing-branch","bad-storage","changed-checkpoint-bytes"]){
    const runs=structuredClone(x.report.runs),run=runs[0];
    if(fault==="missing-root")for(const field of run.sourceStory.fields)field.events=field.events.filter((e:{script:string})=>e.script!=="after");
    if(fault==="fake-completed")delete run.sourceStory;
    if(fault==="wrong-runtime")run.receipt.runtimeHash=hash("other runtime");
    if(fault==="wrong-source")run.sourceStory.fields[0].parentSourceSetHash=hash("other source");
    if(fault==="mid-pc")for(const field of run.sourceStory.fields)for(const e of field.events)if(e.kind==="root-enter")e.pc=1;
    if(fault==="missing-branch")for(const field of run.sourceStory.fields)field.events=field.events.filter((e:{kind:string})=>e.kind!=="branch");
    if(fault==="bad-storage")run.sourceStory.checkpointRelays[0].slotBytes="{}";
    if(fault==="changed-checkpoint-bytes")runs[1].inputCheckpoint.bytes+=" ";
    assert.equal(x.assess(runs).status,"blocked",fault);
  }
  const omitted=structuredClone(x.contract);for(const route of omitted.routes)route.branches=[];
  assert(x.assess(x.report.runs,omitted).issues.some(i=>i.code==="undeclared-branch-requirement"));
  const promoted=structuredClone(x.contract);promoted.lane="original-source";assert.equal(x.assess(x.report.runs,promoted).status,"blocked");
  const missing=x.assess([],null);assert.equal(missing.status,"unassessed");assert.equal(missing.issues[0]!.code,"missing-contract");
  await mkdir(resolve(process.cwd(),"build/reports"),{recursive:true});
  await writeFile(resolve(process.cwd(),"build/reports/source-story-batch-synthetic.json"),JSON.stringify({kind:"source-story-batch-synthetic-proof-v1",
    report:x.report,witnesses:x.f.witnesses,negativeChecks:["missing-root","fake-completed","wrong-runtime","wrong-source","mid-pc","missing-branch","bad-storage","changed-checkpoint-bytes","omitted-branch-domain","synthetic-promotion","missing-contract"],
    actualSourceStoryExecutions:0,sourceCampaignComplete:false},null,2)+"\n");
});

test("late restore failure cannot certify already completed independent roots",async()=>{
  const f=fixture(),original=f.repository.restoreSessionContent.bind(f.repository);let calls=0;
  f.repository.restoreSessionContent=async checkpoint=>{if(++calls===2)throw Error("late complete-batch restore failure");return original(checkpoint);};
  const x=await execute(f);assert.equal(x.report.assessment.status,"blocked");
  assert.notEqual(x.report.runs[0].receipt.result,"completed");assert.equal(x.report.runs[0].execution.committedReturns,2);
  assert(x.report.runs[0].sourceStory.fields.some((f:{events:{kind:string}[]})=>f.events.some(e=>e.kind==="natural-finish")));
  await mkdir(resolve(process.cwd(),"build/reports"),{recursive:true});
  await writeFile(resolve(process.cwd(),"build/reports/source-story-batch-late-failure.json"),JSON.stringify(x.report,null,2)+"\n");
});
