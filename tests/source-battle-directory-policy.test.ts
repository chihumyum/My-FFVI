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
 assert.equal(current.kind,"source-battle-directory-policy-v3");
 assert.equal(current.framework.manualControls,"web-manual-battle-controls-v1");
 assert.deepEqual(current.framework.conditionControlPolicy,{kind:"web-source-control-actions-v1"});
 for(const version of ["v1","v2"]){
  const legacy=structuredClone(base);legacy.kind="source-battle-directory-policy-"+version;delete legacy.framework.manualControls;
  if(version==="v1")delete legacy.framework.conditionControlPolicy;
  const parsed=await api.readSourceBattleDirectoryPolicy({compiledDir,policy:legacy});
  assert.equal(parsed.kind,legacy.kind);assert.equal(parsed.framework.manualControls,undefined);
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
  (p:Record<string,any>)=>{p.kind="source-battle-directory-policy-v4";},
  (p:Record<string,any>)=>{p.kind="source-battle-directory-policy-v2";},
  (p:Record<string,any>)=>{p.framework.unknown=true;},
  (p:Record<string,any>)=>{p.framework.conditionControlPolicy={kind:"future"};},
 ]){
  const value=await input();change(value);
  await assert.rejects(api.readSourceBattleDirectoryPolicy({compiledDir,policy:value}));
 }
});
