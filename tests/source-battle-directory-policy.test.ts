import test from "node:test";
import assert from "node:assert/strict";
import {readFile}from"node:fs/promises";
import {resolve}from"node:path";
import {fileURLToPath,pathToFileURL}from"node:url";
const compiledDir=fileURLToPath(new URL("../",import.meta.url)),
 modulePath=pathToFileURL(resolve("scripts/source-battle-directory.mjs")).href;
const input=async()=>JSON.parse(await readFile(resolve("content-batches/source-battle-directory.policy.json"),"utf8"));
test("all source producers share the exact known directory versions and compiled runtime markers",async()=>{
 const api=await import(modulePath),base=await input(),before=JSON.stringify(base);
 const current=await api.readSourceBattleDirectoryPolicy({compiledDir,policy:base});
 assert.equal(current.kind,"source-battle-directory-policy-v7");
 assert.deepEqual(current.framework.spawnConditionPolicy,{kind:"web-source-enemy-spawn-conditions-v1"});
 assert.deepEqual(current.framework.forcedSavePolicy,{kind:"web-source-battle-forced-save-v1"});
 assert.equal(current.framework.branchExecution,"web-source-battle-branch-execution-v1");
 assert.equal(current.framework.manualControls,"web-manual-battle-controls-v1");
 assert.deepEqual(current.framework.conditionControlPolicy,{kind:"web-source-control-actions-v1"});
 assert.deepEqual(current.framework.sourceParticipants,{kind:'web-source-dynamic-participants-v1',slotLayout:'source-party-nine-slots',rewardScope:'all-entered'});
 for(const version of ["v1","v2","v3","v4","v5","v6"]){
  const legacy=structuredClone(base);legacy.kind="source-battle-directory-policy-"+version;delete legacy.framework.spawnConditionPolicy;if(version!=="v6")delete legacy.framework.forcedSavePolicy;if(!["v5","v6"].includes(version))delete legacy.framework.sourceParticipants;if(!["v4","v5","v6"].includes(version))delete legacy.framework.branchExecution;if(!['v3','v4','v5','v6'].includes(version))delete legacy.framework.manualControls;
  if(version==="v1")delete legacy.framework.conditionControlPolicy;
  const parsed=await api.readSourceBattleDirectoryPolicy({compiledDir,policy:legacy});
  assert.equal(parsed.kind,legacy.kind);assert.equal(parsed.framework.manualControls,['v3','v4','v5','v6'].includes(version)?"web-manual-battle-controls-v1":undefined);assert.equal(parsed.framework.branchExecution,['v4','v5','v6'].includes(version)?'web-source-battle-branch-execution-v1':undefined);assert.deepEqual(parsed.framework.sourceParticipants,['v5','v6'].includes(version)?base.framework.sourceParticipants:undefined);assert.deepEqual(parsed.framework.forcedSavePolicy,version==="v6"?base.framework.forcedSavePolicy:undefined);assert.equal(parsed.framework.spawnConditionPolicy,undefined);
 }
 assert.equal(JSON.stringify(base),before);
});
test("the shared directory reader rejects missing or unknown controls, old-version smuggling and extra declarations",async()=>{
 const api=await import(modulePath);
 for(const change of [
  (p:Record<string,any>)=>{delete p.framework.manualControls;},
  (p:Record<string,any>)=>{p.framework.manualControls=undefined;},
  (p:Record<string,any>)=>{p.framework.manualControls=null;},
  (p:Record<string,any>)=>{p.framework.manualControls="future-controls";},
  (p:Record<string,any>)=>{p.kind="source-battle-directory-policy-v8";},
  (p:Record<string,any>)=>{p.kind="source-battle-directory-policy-v2";},
  (p:Record<string,any>)=>{p.framework.unknown=true;},
  (p:Record<string,any>)=>{delete p.framework.branchExecution;},
  (p:Record<string,any>)=>{p.framework.branchExecution="future";},
  (p:Record<string,any>)=>{p.kind="source-battle-directory-policy-v3";},
  (p:Record<string,any>)=>{p.framework.conditionControlPolicy={kind:"future"};},
  (p:Record<string,any>)=>{delete p.framework.sourceParticipants;},
  (p:Record<string,any>)=>{p.framework.sourceParticipants.rewardScope='active-units';},
  (p:Record<string,any>)=>{p.framework.sourceParticipants.slotLayout='compact';},
  (p:Record<string,any>)=>{p.framework.sourceParticipants.extra=true;},
  (p:Record<string,any>)=>{p.kind='source-battle-directory-policy-v4';},
  (p:Record<string,any>)=>{delete p.framework.forcedSavePolicy;},
  (p:Record<string,any>)=>{p.framework.forcedSavePolicy={kind:'unknown'};},
  (p:Record<string,any>)=>{p.kind='source-battle-directory-policy-v5';},
  (p:Record<string,any>)=>{p.kind='source-battle-directory-policy-v6';},
  (p:Record<string,any>)=>{delete p.framework.spawnConditionPolicy;},
  (p:Record<string,any>)=>{p.framework.spawnConditionPolicy={kind:'unknown'};},
  (p:Record<string,any>)=>{p.framework.spawnConditionPolicy.extra=true;},
 ]){
  const value=await input();change(value);
  await assert.rejects(api.readSourceBattleDirectoryPolicy({compiledDir,policy:value}));
 }
});
