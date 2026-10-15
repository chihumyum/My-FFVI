import test from "node:test";
import assert from "node:assert/strict";
import { exploreReachableFrontiers } from "../src/tools/reachable-frontiers.js";
import { reachableFrontierFixture } from "./fixtures/reachable-frontiers.js";
import { contentDigest } from "../src/core/content-integrity.js";

test("bounded geometric BFS uses actual contact/choice, map loader, battle and event saves across three maps",async()=>{
  const f=await reachableFrontierFixture(),persisted:string[]=[];
  const report=await exploreReachableFrontiers(f.host,{maxRuns:180,maxDepth:80,maxTicksPerRun:6000,persist:async r=>{persisted.push(await contentDigest(r));}});
  assert.equal(report.result,"bounded-complete");assert.equal(report.origin,"authored-mechanism");
  assert.equal(report.exhaustive,false);assert.equal(report.sourceCampaignComplete,false);
  assert.ok(report.frontiers.some(x=>x.message.includes("Authored shared choice capability frontier")));
  assert.ok(report.frontiers.some(x=>x.message.includes("Authored shared interaction capability frontier")));
  assert.deepEqual([...new Set(report.reached.map(x=>x.mapId))].sort(),[...f.ids]);
  assert.ok(report.runs.some(x=>x.transitions.length>=1));
  assert.ok(report.runs.some(x=>x.inputs.some((i:any)=>i.kind==="automatic-battle-return")));
  assert.ok(report.anchors.some(a=>a.reason==="source-event-save"));assert.ok(f.counts().restores>0);
  assert.ok(report.runs.flatMap(x=>x.inputs).some((i:any)=>i.kind==="automatic-confirm"&&i.before.dialogue?.key==="AUDIT_TALK"));
  assert.ok(report.groups.every(g=>g.sites.every(i=>report.frontiers[i]!.capability===g.capability)));
  assert.equal(persisted.length,report.runs.length+1);
  assert.ok(f.seenSessions.every(s=>s.state.snapshot().initialization==="source-new-game"));
});

test("run budget preserves queued input prefixes and snapshots without treating geometric pruning as proof",async()=>{
  const f=await reachableFrontierFixture();let wrote=false;
  const report=await exploreReachableFrontiers(f.host,{maxRuns:2,maxTicksPerRun:500,
    persist:async detached=>{wrote=true;if(detached.anchors[0])detached.anchors[0].serializedSlot="corrupt callback copy";}});
  assert.ok(wrote);assert.ok(report.pending.length>0);assert.ok(report.frontiers.some(f=>f.capability==="search-runs"));
  assert.ok(report.pending.every(p=>p.inputPrefix.length>0));assert.ok(report.anchors.every(a=>a.serializedSlot!=="corrupt callback copy"));
  assert.equal(report.policy.stateDedup,"exact-checkpoint-hash");assert.equal(report.exhaustive,false);
  await assert.rejects(()=>exploreReachableFrontiers(f.host,{maxRuns:0}),/budget/);
});

test("a genuine map dependency failure remains a grouped source frontier without replacing the original owner",async()=>{
  const f=await reachableFrontierFixture();f.files.delete(f.world.maps[f.ids[1]]!.url);
  const report=await exploreReachableFrontiers(f.host,{maxRuns:40,maxTicksPerRun:1000,maxDepth:16});
  assert.ok(report.frontiers.some(x=>x.capability==="map-lifecycle"&&x.message.includes("Missing controlled dependency")));
  assert.ok(report.frontiers.filter(x=>x.capability==="map-lifecycle").every(x=>x.sourceWitness));
  assert.ok(!report.reached.some(x=>x.mapId===f.ids[1]));
});

test("resuming a pending prefix replays real inputs from newgame instead of importing historical saved state",async()=>{
  const f=await reachableFrontierFixture(),first=await exploreReachableFrontiers(f.host,{maxRuns:3,maxTicksPerRun:2000});
  const prefixes=first.pending.map(p=>p.inputPrefix),before=f.counts();
  const resumed=await exploreReachableFrontiers(f.host,{maxRuns:35,maxTicksPerRun:2000,initialPrefixes:prefixes});
  assert.ok(f.counts().creates>before.creates);assert.ok(resumed.runs.some(r=>r.fromAnchor===null&&r.inputs.some((i:any)=>i.kind==="decision-input")));
  assert.ok(!resumed.frontiers.some(f=>f.kind==="replay-diverged"));
  const forged=structuredClone(prefixes[0]!);forged[0]!.decisionHash="0".repeat(64);
  const refused=await exploreReachableFrontiers(f.host,{maxRuns:1,maxTicksPerRun:2000,initialPrefixes:[forged]});
  assert.equal(refused.runs[0]!.inputPrefix.length,0,"An unexecuted proposed input is not a source witness");
  assert.ok(refused.frontiers.some(f=>f.kind==="replay-diverged"));assert.equal(refused.runs[0]!.inputs.length,0);
});

test("failed real entry preparation retains a frontier without inventing a published Session",async()=>{
  const source={file:"Event/Init.json",pathId:"9223372036854775807",script:"Main",index:99};
  const report=await exploreReachableFrontiers({origin:"source-new-game",sourceWitness:source,
    create:async()=>{throw new Error("Controlled entry provider unavailable");},restore:async()=>{throw new Error("Must not restore");}});
  assert.equal(report.runs.length,1);assert.equal(report.reached.length,0);assert.equal(report.anchors.length,0);
  assert.deepEqual(report.frontiers[0]!.sourceWitness,source);assert.equal(report.frontiers[0]!.capability,"new-game-entry");
  assert.equal(report.runs[0]!.mapId,null);assert.deepEqual(report.runs[0]!.inputPrefix,[]);
  assert.equal(report.groups[0]!.message,"Controlled entry provider unavailable");
});


test("source-style newgame exploration returns a real forced terminal through the common handoff and keeps searching",async()=>{
  const f=await reachableFrontierFixture({forcedBattle:true});
  const report=await exploreReachableFrontiers(f.host,{maxRuns:90,maxDepth:64,maxTicksPerRun:1500});
  const returns=report.runs.flatMap(r=>r.inputs).filter((i:any)=>i.kind==="automatic-battle-return") as {outcome:string}[];
  assert.ok(returns.some(r=>r.outcome==="forced"),"The forced terminal must publish through the real return transaction");
  assert.ok(report.reached.some(r=>r.mapId===f.ids[2]),"Continue the original field caller and its next real map transition");
  assert.ok(report.anchors.some(a=>a.reason==="source-event-save"));
  assert.ok(f.seenSessions.some(game=>game.state.snapshot().completedBattles.some(b=>b.outcome==="forced")));
  assert.ok(f.seenSessions.every(game=>game.state.completedEncounters.length===0),"A forced return cannot become a victory");
  assert.ok(!report.frontiers.some(f=>f.capability==="logical-clock"),"A supported terminal is not a wait-budget frontier");
  assert.equal(report.sourceCampaignComplete,false);
});
