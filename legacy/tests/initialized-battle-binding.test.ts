import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/compiler/content.js";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { selectInitializedBattleCatalog } from "../src/compiler/initialized-battle-binding.js";
import type { SourceBattleRequests } from "../src/compiler/source-battle-requests.js";
import type { BattleCatalog } from "../src/core/battle-content.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import { sourceParticipantFixture, dynamicSourcePolicy } from './fixtures/source-battle-participants.js';

function seal<T extends { contentHash?: string }>(value: T): T & { contentHash: string } {
  const { contentHash: _, ...body } = value;
  return { ...value, contentHash: hash(body) };
}
import { directoryAnalysis as analysis, initializedBattleDirectoryFixture as fixture } from "./fixtures/initialized-battle-directory.js";

test("baseline selection is an exact detached source catalog and needs no directory or walking policy", async () => {
  const f = await fixture(), before = structuredClone(f.sourceBattle);
  const result = await selectInitializedBattleCatalog({ selection: "source-baseline-v1",
    sourceBattle: f.sourceBattle, sourceWorld: f.sourceWorld });
  assert.deepEqual(result, { catalog: before, directoryBinding: null });
  assert.notEqual(result.catalog, f.sourceBattle);
  result.catalog.gameState.initialGil++;
  assert.deepEqual(f.sourceBattle, before);
});

test("whole directory selection preserves conditional and blocked parties without granting walking or owners", async () => {
  const f = await fixture(), before = structuredClone(f), result = await selectInitializedBattleCatalog(f);
  assert.deepEqual(result.catalog, f.directory.frameworkCatalog);
  assert.deepEqual(result.catalog.gameState, f.sourceBattle.gameState);
  assert.deepEqual(result.catalog.encounterReport!.entries.map(entry => [entry.partyId, entry.status]),
    [[9201, "compiled"], [9202, "blocked"]]);
  assert.deepEqual(analyzeBatchEncounters(result.catalog, [9201, 9202]).encounters.map(entry => entry.status),
    ["conditional", "blocked"]);
  assert.ok(result.catalog.encounterDiagnostics!.some(d => d.kind === "runtime-dependency"));
  assert.ok(result.catalog.encounterDiagnostics!.some(d => d.kind === "blocked"));
  assert.deepEqual(result.directoryBinding, { catalogHash: f.directory.frameworkCatalog.contentHash,
    requestsHash: f.directory.requests.contentHash, reportHash: f.directory.report.contentHash });
  assert.equal(Object.hasOwn(result.catalog, "walkEncounters"), false);
  result.catalog.encounterDiagnostics![0]!.reason = "Changed returned copy";
  assert.deepEqual(f, before);
});

test("selection captures all caller input before the first digest await", async () => {
  const f = await fixture(), expected = structuredClone(f.directory.frameworkCatalog);
  const promise = selectInitializedBattleCatalog(f);
  f.directory.frameworkCatalog.gameState.initialGil++;
  f.directory.requests.requestedPartyIds.length = 0;
  assert.deepEqual((await promise).catalog, expected);
});

test("missing proof and changed payloads cannot fall back to the small baseline", async () => {
  const f = await fixture(), { directory: _, ...without } = f;
  await assert.rejects(selectInitializedBattleCatalog(without), /proof is missing/);
  for (const field of ["requests", "report", "frameworkCatalog"] as const) {
    const bad = structuredClone(f); bad.directory[field].contentHash = "0".repeat(64);
    await assert.rejects(selectInitializedBattleCatalog(bad), /Content payload changed/);
  }
  const staleNested = structuredClone(f);
  staleNested.directory.requests.sourceRequests.requestedPartyIds.pop();
  staleNested.directory.requests = seal(staleNested.directory.requests);
  staleNested.directory.report.requestsHash = staleNested.directory.requests.contentHash;
  staleNested.directory.report = seal(staleNested.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(staleNested), /Content payload changed/);
});

test("rehashing does not excuse wrong baseline, report, source or world bindings", async () => {
  for (const field of ["baselineHash", "frameworkCatalogHash", "requestsHash", "sourceSetHash", "parentSourceSetHash"] as const) {
    const f = await fixture(); f.directory.report[field] = "0".repeat(64); f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /binding mismatch|source identity mismatch/);
  }
  const f = await fixture(); f.directory.requests.sourceRequests.worldCatalogHash = "0".repeat(64);
  f.directory.requests.sourceRequests = seal(f.directory.requests.sourceRequests);
  f.directory.requests = seal(f.directory.requests); f.directory.report.requestsHash = f.directory.requests.contentHash;
  f.directory.report = seal(f.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(f), /source world binding/);
});

test("all map and party request bindings are required, including currently blocked entries", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.directory.requests.sourceRequests.mapBindings = []; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.directory.requests.sourceRequests.requests.pop(); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.directory.requests.requestedPartyIds = [9201]; },
  ]) {
    const f = await fixture(); change(f);
    f.directory.requests.sourceRequests = seal(f.directory.requests.sourceRequests);
    f.directory.requests = seal(f.directory.requests); f.directory.report.requestsHash = f.directory.requests.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /complete source/);
  }
});

test("directory cannot mutate initialization, owned data or any shared non-drop capability", async () => {
  for (const mutate of [
    (catalog: BattleCatalog) => { catalog.gameState.initialGil++; },
    (catalog: BattleCatalog) => { catalog.common.timing.speedIndex = 4; },
  ]) {
    const f = await fixture(); mutate(f.directory.frameworkCatalog);
    f.directory.frameworkCatalog = seal(f.directory.frameworkCatalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /owned catalogs|shared battle capabilities/);
  }
});

test("drop extension keeps source lottery and requires actual admitted monster and owned content references", async () => {
  for (const mutate of [
    (catalog: BattleCatalog) => { catalog.common.drops!.weights = [0, 100, 0, 0, 0, 0, 0, 0]; },
    (catalog: BattleCatalog) => { catalog.common.drops!.monsters[0]!.id = 9999; },
    (catalog: BattleCatalog) => {
      const monster = catalog.common.drops!.monsters[0]!; monster.rate = 100; monster.slots[0] = { contentId: 9999, count: 1 };
      catalog.common.drops!.contents.push({ id: 9999, kind: "item" });
    },
  ]) {
    const f = await fixture(); mutate(f.directory.frameworkCatalog);
    f.directory.frameworkCatalog = seal(f.directory.frameworkCatalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /drop weights|drop monster|owned definition/);
  }
});

test("removing diagnostics or changing compiler readiness cannot borrow the original report", async () => {
  const filtered = await fixture(); filtered.directory.frameworkCatalog.encounterDiagnostics = [];
  filtered.directory.frameworkCatalog = seal(filtered.directory.frameworkCatalog);
  filtered.directory.report.frameworkCatalogHash = filtered.directory.frameworkCatalog.contentHash;
  filtered.directory.report = seal(filtered.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(filtered), /complete encounter diagnostics/);
  const reassessed = await fixture(); reassessed.directory.report.framework.analysis.conditional = 0;
  reassessed.directory.report.framework.analysis.ready = 1; reassessed.directory.report = seal(reassessed.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(reassessed), /current complete dependency analysis/);
});

test("an optional strict catalog is also hash checked, never an ignored extra payload", async () => {
  const f = await fixture();
  await assert.rejects(selectInitializedBattleCatalog({ ...f,
    directory: { ...f.directory, strictCatalog: f.sourceBattle } }), /Content identity mismatch/);
  assert.equal(canonical(f.sourceBattle.gameState), canonical(f.directory.frameworkCatalog.gameState));
});

async function conditionPolicyFixture() {
  const f = await fixture(), policy = { kind: "web-source-control-actions-v1" as const };
  const catalog = seal({ ...f.directory.frameworkCatalog,
    common: { ...f.directory.frameworkCatalog.common, conditionControlPolicy: policy } });
  const report = seal({ ...f.directory.report, frameworkCatalogHash: catalog.contentHash,
    policy: { kind: "source-battle-directory-policy-v2", framework: { conditionControlPolicy: policy } },
    policyChanges: [{ kind: "framework-condition-policy-binding-v1", field: "common.conditionControlPolicy",
      from: null, to: policy, beforeCommonHash: hash(f.sourceBattle.common), afterCommonHash: hash(catalog.common),
      beforeGameStateHash: hash(f.sourceBattle.gameState), afterGameStateHash: hash(catalog.gameState),
      beforeCommon: structuredClone(f.sourceBattle.common), afterCommon: structuredClone(catalog.common) }],
  });
  const producer = await import(pathToFileURL(resolve("scripts/source-battle-directory.mjs")).href);
  const actual = await producer.composeFrameworkBattleDirectory({ compiledDir: resolve(import.meta.dirname, ".."),
    baseCatalog: f.sourceBattle, conditionControlPolicy: policy, runtime: {
      encounters: f.directory.frameworkCatalog.encounters, diagnostics: f.directory.frameworkCatalog.encounterDiagnostics,
      report: f.directory.frameworkCatalog.encounterReport, drops: f.directory.frameworkCatalog.common.drops,
    } });
  assert.deepEqual(actual.catalog, catalog);
  assert.deepEqual(actual.policyChanges, report.policyChanges);
  return { ...f, directory: { ...f.directory, frameworkCatalog: catalog, report } };
}

test("a declared Web condition policy binds through both source selection consumers without changing owners", async () => {
  const f = await conditionPolicyFixture(), selected = await selectInitializedBattleCatalog(f);
  assert.deepEqual(selected.catalog.gameState, f.sourceBattle.gameState);
  assert.deepEqual(selected.catalog.common.conditionControlPolicy, { kind: "web-source-control-actions-v1" });
  const checker = await import(pathToFileURL(resolve("scripts/check-selected-source-batches.mjs")).href);
  const binding = await checker.validateSelectedSourceCatalogBinding({ built: {
    kind: "initialized-source-map-build-v1", recipeKind: "initialized-source-map-recipe-v3",
    battleCatalogSelection: "shared-framework-directory-v1", sourceAreaScopeReceipt: null,
    battleDirectory: selected.directoryBinding,
  }, battle: selected.catalog, sourceBattle: f.sourceBattle, sourceWorld: f.sourceWorld,
  directory: selected.catalog, requests: f.directory.requests, directoryReport: f.directory.report },
  { compiledDir: resolve(import.meta.dirname, "..") });
  assert.equal(binding.catalogHash, selected.catalog.contentHash);
});

test("rehashing cannot replace a missing, changed or unknown condition-policy receipt", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policyChanges.length = 0; },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policyChanges[0]!.beforeCommonHash = "0".repeat(64); },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policyChanges[0]!.afterGameStateHash = "0".repeat(64); },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policy.kind = "source-battle-directory-policy-v1"; },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policy.framework.conditionControlPolicy = { kind: "unknown" } as never; },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { delete (f.directory.frameworkCatalog as BattleCatalog).common.conditionControlPolicy; },
  ]) {
    const f = await conditionPolicyFixture(); mutate(f);
    f.directory.frameworkCatalog = seal(f.directory.frameworkCatalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /condition policy|condition-policy/);
  }
});

test("a consistent policy receipt grants no other capability or owned-state change", async () => {
  for (const owned of [false, true]) {
    const f = await conditionPolicyFixture();
    if (owned) f.directory.frameworkCatalog.gameState.initialGil++;
    else f.directory.frameworkCatalog.common.timing.speedIndex = 4;
    const catalog = f.directory.frameworkCatalog, change = f.directory.report.policyChanges[0]!;
    change.afterCommon = structuredClone(catalog.common); change.afterCommonHash = hash(catalog.common);
    change.afterGameStateHash = hash(catalog.gameState);
    f.directory.frameworkCatalog = seal(catalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /owned catalogs|shared battle capabilities/);
  }
  const f = await conditionPolicyFixture();
  await assert.rejects(selectInitializedBattleCatalog({ selection: "source-baseline-v1", sourceWorld: f.sourceWorld,
    sourceBattle: f.directory.frameworkCatalog }), /strict source baseline cannot use a Web condition control policy/);
});

test("v3 directory manual controls keep the exact condition receipt through both initialized consumers",async()=>{
 const f=await conditionPolicyFixture();
 f.directory.report.policy.kind="source-battle-directory-policy-v3";
 (f.directory.report.policy.framework as Record<string,unknown>).manualControls="web-manual-battle-controls-v1";
 f.directory.report=seal(f.directory.report);
 const selected=await selectInitializedBattleCatalog(f);
 assert.deepEqual(selected.catalog.gameState,f.sourceBattle.gameState);
 const checker=await import(pathToFileURL(resolve("scripts/check-selected-source-batches.mjs")).href);
 const binding=await checker.validateSelectedSourceCatalogBinding({built:{
  kind:"initialized-source-map-build-v1",recipeKind:"initialized-source-map-recipe-v3",
  battleCatalogSelection:"shared-framework-directory-v1",sourceAreaScopeReceipt:null,battleDirectory:selected.directoryBinding,
 },battle:selected.catalog,sourceBattle:f.sourceBattle,sourceWorld:f.sourceWorld,
 directory:selected.catalog,requests:f.directory.requests,directoryReport:f.directory.report},
 {compiledDir:resolve(import.meta.dirname,"..")});
 assert.equal(binding.catalogHash,selected.catalog.contentHash);
});
test("new directory controls cannot be omitted, forged, granted by an old version or inferred for a future version",async()=>{
 for(const change of [
  (p:Record<string,unknown>)=>{delete(p.framework as Record<string,unknown>).manualControls;},
  (p:Record<string,unknown>)=>{(p.framework as Record<string,unknown>).manualControls="unknown";},
  (p:Record<string,unknown>)=>{p.kind="source-battle-directory-policy-v2";},
  (p:Record<string,unknown>)=>{p.kind="source-battle-directory-policy-v4";},
 ]){
  const f=await conditionPolicyFixture(),p=f.directory.report.policy as Record<string,unknown>;
  p.kind="source-battle-directory-policy-v3";(p.framework as Record<string,unknown>).manualControls="web-manual-battle-controls-v1";
  change(p);f.directory.report=seal(f.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(f),/manual control|versioned directory/);
 }
});

test('v4 source directory binds manual, condition and exact branch policies through both initialized consumers',async()=>{
 const f=await conditionPolicyFixture();
 f.directory.report.policy.kind='source-battle-directory-policy-v4';
 Object.assign(f.directory.report.policy.framework,{manualControls:'web-manual-battle-controls-v1',branchExecution:'web-source-battle-branch-execution-v1'});
 f.directory.report=seal(f.directory.report);const before=structuredClone(f),selected=await selectInitializedBattleCatalog(f);
 assert.deepEqual(selected.catalog.gameState,f.sourceBattle.gameState);assert.deepEqual(selected.catalog.encounterDiagnostics,f.directory.frameworkCatalog.encounterDiagnostics);
 const checker=await import(pathToFileURL(resolve('scripts/check-selected-source-batches.mjs')).href);
 const binding=await checker.validateSelectedSourceCatalogBinding({built:{kind:'initialized-source-map-build-v1',recipeKind:'initialized-source-map-recipe-v3',
  battleCatalogSelection:'shared-framework-directory-v1',sourceAreaScopeReceipt:null,battleDirectory:selected.directoryBinding},battle:selected.catalog,
  sourceBattle:f.sourceBattle,sourceWorld:f.sourceWorld,directory:selected.catalog,requests:f.directory.requests,directoryReport:f.directory.report},
  {compiledDir:resolve(import.meta.dirname,'..')});
 assert.equal(binding.catalogHash,selected.catalog.contentHash);assert.deepEqual(f,before);
});
test('rehashing a v4 directory cannot hide missing/unknown branch policy, unknown fields or an old/future version',async()=>{
 for(const mutate of [
  (p:any)=>{delete p.framework.branchExecution;},(p:any)=>{p.framework.branchExecution='unknown';},
  (p:any)=>{p.framework.inventedProvider=true;},(p:any)=>{p.inventedGrant=true;},
  (p:any)=>{p.kind='source-battle-directory-policy-v3';},(p:any)=>{p.kind='source-battle-directory-policy-v5';},
 ]){
  const f=await conditionPolicyFixture();f.directory.report.policy.kind='source-battle-directory-policy-v4';
  Object.assign(f.directory.report.policy.framework,{manualControls:'web-manual-battle-controls-v1',branchExecution:'web-source-battle-branch-execution-v1'});
  mutate(f.directory.report.policy);f.directory.report=seal(f.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(f),/branch execution|versioned directory|manual controls/);
 }
});

async function dynamicDirectoryFixture({saved=false,spawn=false}:{saved?:boolean;spawn?:boolean}={}){
 const f=await conditionPolicyFixture(),g=sourceParticipantFixture({child:true});
 g.input.conditions=f.sourceBattle.common.conditions;g.input.abilities=f.sourceBattle.common.abilities;
 g.input.handoff={policy:{kind:'framework-battle-handoff-v1',id:'controlled-directory',audio:'retain-field',introduction:'omit'}};
 if(spawn)g.input.spawnConditionPolicy={kind:'web-source-enemy-spawn-conditions-v1'};
 if(saved||spawn){g.input.forcedSavePolicy={kind:'web-source-battle-forced-save-v1'};const script=g.input.encounters[0]!.script!.data as {Mnemonics:{mnemonic:string;type:number;operands:{iValues:number[];rValues:number[];sValues:string[]}}[];Segments:{Count:number}[]};script.Mnemonics.splice(script.Mnemonics.length-1,0,{mnemonic:'BattleForceExitOnSave',type:1,operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:Array(8).fill('')}});script.Segments[0]!.Count++;}
 const closure=g.closure(),runtime=g.runtime(closure),producer=await import(pathToFileURL(resolve('scripts/source-battle-directory.mjs')).href),
  composed=await producer.composeFrameworkBattleDirectory({compiledDir:resolve(import.meta.dirname,'..'),baseCatalog:f.sourceBattle,runtime,conditionControlPolicy:{kind:'web-source-control-actions-v1'}}),
  catalog=composed.catalog as BattleCatalog;
 const report=seal({...f.directory.report,frameworkCatalogHash:catalog.contentHash,policyChanges:composed.policyChanges,
  policy:{kind:spawn?'source-battle-directory-policy-v7':saved?'source-battle-directory-policy-v6':'source-battle-directory-policy-v5',framework:{handoff:g.input.handoff.policy,entry:null,conditionControlPolicy:{kind:'web-source-control-actions-v1'},
   manualControls:'web-manual-battle-controls-v1',branchExecution:'web-source-battle-branch-execution-v1',sourceParticipants:structuredClone(dynamicSourcePolicy),...((saved||spawn)?{forcedSavePolicy:{kind:'web-source-battle-forced-save-v1'}}:{}),...(spawn?{spawnConditionPolicy:{kind:'web-source-enemy-spawn-conditions-v1'}}:{})}},
  sourceParticipantClosure:closure.report,entryDependencies:{scripts:g.entryScriptGroups()},
  framework:{...catalog.encounterReport!,analysis:analysis(catalog,[9201,9202])},
  diagnostics:{...f.directory.report.diagnostics,framework:catalog.encounterDiagnostics!}});
 return {...f,directory:{...f.directory,frameworkCatalog:catalog,report}};
}
test('v5 initialized consumers bind the actual source-derived participant compiler output with complete child/source proof',async()=>{
 const f=await dynamicDirectoryFixture(),selected=await selectInitializedBattleCatalog(f);
 assert.equal(selected.catalog.encounters[9201]!.participants!.rewardScope,'all-entered');
 assert.equal(Object.keys(selected.catalog.encounters[9201]!.participants!.slots).length,9);
 assert.ok(selected.catalog.encounters[9201]!.participants!.enemyDefinitions[9103]);
 const checker=await import(pathToFileURL(resolve('scripts/check-selected-source-batches.mjs')).href);
 const binding=await checker.validateSelectedSourceCatalogBinding({built:{kind:'initialized-source-map-build-v1',recipeKind:'initialized-source-map-recipe-v3',
  battleCatalogSelection:'shared-framework-directory-v1',sourceAreaScopeReceipt:null,battleDirectory:selected.directoryBinding},battle:selected.catalog,
  sourceBattle:f.sourceBattle,sourceWorld:f.sourceWorld,directory:selected.catalog,requests:f.directory.requests,directoryReport:f.directory.report},
  {compiledDir:resolve(import.meta.dirname,'..')});assert.equal(binding.catalogHash,selected.catalog.contentHash);
 const producer=await import(pathToFileURL(resolve('scripts/source-battle-directory.mjs')).href);
 assert.deepEqual(await producer.readSourceBattleDirectoryPolicy({compiledDir:resolve(import.meta.dirname,'..'),policy:f.directory.report.policy}),f.directory.report.policy);
});
test('v5 source binding cannot be inferred for older/future declarations or ignore rehashed missing/raw/slot/master proof',async()=>{
 for(const change of [
  (f:any)=>{delete f.directory.report.sourceParticipantClosure;},
  (f:any)=>{f.directory.report.policy.kind='source-battle-directory-policy-v4';},
  (f:any)=>{f.directory.report.policy.kind='source-battle-directory-policy-v6';},
  (f:any)=>{f.directory.report.policy.framework.sourceParticipants.extra=true;},
  (f:any)=>{f.directory.report.sourceParticipantClosure.bindings[0].templates=[];},
  (f:any)=>{f.directory.report.sourceParticipantClosure.bindings[0].completeRawProgram.Mnemonics[0].operands.iValues[0]++;},
  (f:any)=>{f.directory.frameworkCatalog.encounters[9201].participants.slots[2].x++;},
 ]){
  const f=await dynamicDirectoryFixture();change(f);f.directory.frameworkCatalog=seal(f.directory.frameworkCatalog);
  f.directory.report.frameworkCatalogHash=f.directory.frameworkCatalog.contentHash;f.directory.report=seal(f.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(f));
 }
});

test('v6 binds a real typed saved-return encounter through the public initialized producer and independent consumer',async()=>{
 const f=await dynamicDirectoryFixture({saved:true}),selected=await selectInitializedBattleCatalog(f);const encounter=selected.catalog.encounters[9201]!;
 assert.deepEqual(encounter.forcedSavePolicy,{kind:'web-source-battle-forced-save-v1'});assert.equal(encounter.lifecycle!.mode,'script');if(encounter.lifecycle!.mode!=='script')throw Error('Expected source program');assert(encounter.lifecycle!.program.instructions.some(i=>i.op.kind==='force-save-return'));
 const checker=await import(pathToFileURL(resolve('scripts/check-selected-source-batches.mjs')).href),binding=await checker.validateSelectedSourceCatalogBinding({built:{kind:'initialized-source-map-build-v1',recipeKind:'initialized-source-map-recipe-v3',
 battleCatalogSelection:'shared-framework-directory-v1',sourceAreaScopeReceipt:null,battleDirectory:selected.directoryBinding},battle:selected.catalog,sourceBattle:f.sourceBattle,sourceWorld:f.sourceWorld,directory:selected.catalog,requests:f.directory.requests,directoryReport:f.directory.report},{compiledDir:resolve(import.meta.dirname,'..')});
 assert.equal(binding.catalogHash,selected.catalog.contentHash);
});
test('v6 rehash cannot hide a missing Save encounter lease, unknown policy or an old version grant',async()=>{
 for(const change of [(f:any)=>{delete f.directory.frameworkCatalog.encounters[9201].forcedSavePolicy;},(f:any)=>{delete f.directory.report.policy.framework.forcedSavePolicy;},
 (f:any)=>{f.directory.report.policy.framework.forcedSavePolicy.kind='unknown';},(f:any)=>{f.directory.report.policy.kind='source-battle-directory-policy-v5';}]){
  const f=await dynamicDirectoryFixture({saved:true});change(f);f.directory.frameworkCatalog=seal(f.directory.frameworkCatalog);f.directory.report.frameworkCatalogHash=f.directory.frameworkCatalog.contentHash;f.directory.report=seal(f.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(f));
 }
});

test('v7 explicit spawn policy binds the actual dynamic source compiler through both initialized consumers',async()=>{
 const f=await dynamicDirectoryFixture({spawn:true}),selected=await selectInitializedBattleCatalog(f);assert.deepEqual(selected.catalog.encounters[9201]!.spawnConditionPolicy,{kind:'web-source-enemy-spawn-conditions-v1'});
 const checker=await import(pathToFileURL(resolve('scripts/check-selected-source-batches.mjs')).href),binding=await checker.validateSelectedSourceCatalogBinding({built:{kind:'initialized-source-map-build-v1',recipeKind:'initialized-source-map-recipe-v3',battleCatalogSelection:'shared-framework-directory-v1',sourceAreaScopeReceipt:null,battleDirectory:selected.directoryBinding},battle:selected.catalog,sourceBattle:f.sourceBattle,sourceWorld:f.sourceWorld,directory:selected.catalog,requests:f.directory.requests,directoryReport:f.directory.report},{compiledDir:resolve(import.meta.dirname,'..')});assert.equal(binding.catalogHash,selected.catalog.contentHash);
});
test('v7 cannot omit the dynamic encounter policy or rehash an older/unknown declaration to grant it',async()=>{
 for(const change of [(f:any)=>{delete f.directory.frameworkCatalog.encounters[9201].spawnConditionPolicy;},(f:any)=>{delete f.directory.report.policy.framework.spawnConditionPolicy;},(f:any)=>{f.directory.report.policy.framework.spawnConditionPolicy.kind='unknown';},(f:any)=>{f.directory.report.policy.kind='source-battle-directory-policy-v6';}]){
 const f=await dynamicDirectoryFixture({spawn:true});change(f);f.directory.frameworkCatalog=seal(f.directory.frameworkCatalog);f.directory.report.frameworkCatalogHash=f.directory.frameworkCatalog.contentHash;f.directory.report=seal(f.directory.report);await assert.rejects(selectInitializedBattleCatalog(f));}
});
