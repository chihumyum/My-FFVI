import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const {collectFieldEffectProgramTargets:targets}=await import(pathToFileURL(resolve(process.cwd(),"scripts/check-logical-field-effects-lifecycle.mjs")).href);
const map={map:{groups:{a:{entities:[{id:"proved",kind:11,effect:{assetGroup:"loop"}}]},b:{entities:[{id:"unknown",kind:11,effect:{assetGroup:"unknown"}},{id:"npc",kind:2}]}}}};
const accepted=new Set(["loop"]);
test("whole field-effect roots include rejected-only targets and mixed group bindings without granting source readiness",()=>{
  assert.equal(targets(map,[{kind:"puppet",actor:"proved",index:1}],accepted).classification,"accepted-related");
  assert.equal(targets(map,[{kind:"puppet",actor:"unknown",index:2}],accepted).classification,"rejected-only");
  const result=targets(map,[{kind:"entities",group:"a",index:3},{kind:"entities",group:"b",index:4}],accepted);
  assert.equal(result.classification,"mixed");assert.deepEqual(result.declaredEffectGroupSites,[3,4]);
  assert.deepEqual(result.referencedBoards,[{id:"proved",assetGroup:"loop",accepted:true},{id:"unknown",assetGroup:"unknown",accepted:false}]);
  assert.equal(result.sourceReady,undefined);assert.equal(result.actualInstructionExecutions,undefined);
  assert.equal(targets(map,[{kind:"puppet",actor:"npc",index:5}],accepted),null);
});
test("cohort selection retains source-site indexes as static evidence and leaves inputs detached",()=>{
  const ops=[{kind:"puppet",actor:"unknown",index:99}],before=structuredClone({map,ops});
  const result=targets(map,ops,accepted);assert.deepEqual(result.declaredEffectPuppetSites,[99]);
  result.referencedBoards[0].id="mutated";assert.deepEqual({map,ops},before);
});
