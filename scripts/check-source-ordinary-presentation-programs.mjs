import { assertSourceProgramOrigin } from './source-program-origin.mjs';
import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { compileInitializedContentBatch } from './build-initialized-content-batch.mjs';
import { openSourceCandidate } from './source-candidate.mjs';
import { overlaySourceFrameworkMap, overlaySourceFrameworkWorld } from './source-framework-map-overlay.mjs';
import { controlledAudioRuntime } from './controlled-audio.mjs';
import { runtimeDigest } from './runtime-digest.mjs';
// Whole ordinary family; no opcode count or scene-specific nomination.
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
assert.equal(args.length % 2, 0, 'Expected option/value pairs');
assert.equal(new Set(args.filter((_, i) => i % 2 === 0)).size, args.length / 2, 'Duplicate options');
for (let i = 0; i < args.length; i += 2)
    assert.ok(['--root', '--compiled-dir', '--output', '--candidate-dir'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown or missing option value');
const runtimeRoot = resolve(import.meta.dirname, '..'), root = resolve(option('--root') ?? runtimeRoot), out = resolve(root, option('--output') ?? 'build/reports/source-ordinary-field-presentation'), candidateDir = resolve(root, option('--candidate-dir') ?? 'build/source-candidate'), compiled = resolve(root, option('--compiled-dir') ?? 'dist'), load = n => import(pathToFileURL(resolve(compiled, 'src', n + '.js')).href), sha = b => createHash('sha256').update(b).digest('hex');
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { compileFrameworkNewGame }, { canonical, hash }, { loadCorpus }, { loadSystemMessages }, { readSnapshot }, { createWebLogicalFieldEffectsHost }, { createWebFieldMessageSequencePort }, { createWebFlatConditionLeaderActivityPort }, { WEB_SOURCE_ENCOUNTER_POLICY }, { createWebFieldCameraShakePolicy }, { WEB_RETAINED_WORLD_TRANSPORTATION }, { WEB_ASSIGNED_ROUTE_POLICY }] = await Promise.all(['core/game-content', 'core/game-session', 'core/game-flow', 'compiler/framework-new-game', 'compiler/content', 'compiler/corpus', 'compiler/system-messages', 'compiler/integrity', 'core/field-logical-effects', 'core/source-message-sequence', 'core/field-condition-activity', 'core/source-encounter-entry', 'core/field-camera-shake', 'core/world-transportation-entry', 'core/field-assigned-route'].map(load));
const checkerBefore = sha(await readFile(new URL(import.meta.url)));
await mkdir(out,{recursive:true});
const sharedCandidate = await openSourceCandidate({ root, runtimeRoot, compiledDir: compiled, candidateDir }), before = sharedCandidate.runtimeSha256, candidateReportBytes = sharedCandidate.reportBytes, candidate = sharedCandidate.report, lock = sharedCandidate.lock, read = sharedCandidate.read;
const corpusSnapshot = await readSnapshot(resolve(root, 'build/corpus'));
const strictWorld = await read('/world/catalog.json'), sourceEntry = await read('/game/source-new-game.json'), sourceBattle = await read('/game/source-catalog.json'), frameworkWorld = await read('/framework/world/catalog.json'), strictMaps = new Map(), frameworkMaps = new Map();
const corpus=await loadCorpus(root),system=await loadSystemMessages(root,corpus.manifest.parentSourceSetHash,corpus.manifest.sources),
 {compileStoryCorpus}=await load('compiler/story-corpus'),ir=compileStoryCorpus({...corpus,messages:{...corpus.messages,system_zhc:system.messages}}),
 {bindMapPackages,resolveMapScript}=await load('compiler/map-package'),{isOrdinarySourceMap}=await load('compiler/framework-ordinary-presentation'),
 rawBindings=bindMapPackages(corpus.assets,corpus.tables),rawAssets=new Map(corpus.assets.map(a=>[a.id,a]));
for (const id of Object.keys(strictWorld.maps).map(Number).sort((a,b)=>a-b)) {
    strictMaps.set(id, await read(strictWorld.maps[id].url));
    frameworkMaps.set(id, await read(frameworkWorld.maps[id].url));
}
const analysis=ir.analysis,allIds=Object.keys(strictWorld.maps).map(Number).sort((a,b)=>a-b),
 ids=allIds.filter(id=>isOrdinarySourceMap(strictMaps.get(id))),nomination={sourceSetHash:corpus.sourceSetHash,maps:[],roots:[],programs:corpus.assets.filter(a=>a.kind==='script').map(a=>({id:a.id,source:a.source,rawHash:hash(a.data),instructions:a.data.Mnemonics.length,raw:a.data}))};
for(const mapId of ids){
 const map=strictMaps.get(mapId),binding=rawBindings.find(b=>Number(b.id)===mapId);assert(binding,'Missing original source map package');
 const aliases=[...new Set([...Object.keys(binding.scriptAliases),...Object.keys(binding.residentScripts)])].sort(),namespace={};
 for(const alias of aliases){const id=resolveMapScript(binding,alias);assert(id&&rawAssets.has(id),'Unbound original installed namespace');namespace[alias]=id;
  const raw=rawAssets.get(id),ops=map.scripts[alias];nomination.roots.push({root:{mapId,alias,id},instructions:raw.data.Mnemonics.length,
   closure:analysis.maps.find(m=>Number(m.id)===mapId)?.closure??[],operandBlockers:ops?.filter(op=>op.kind==='blocked')??[],
   compiledProgramPresent:!!ops,otherwiseOperandClosed:!!ops&&ops.every(op=>op.kind!=='blocked')});}
 nomination.maps.push({mapId,binding,namespace,sourceMapHash:map.contentHash,entryView:map.entryView,sourceBlockers:map.blockers,
  familySelection:frameworkMaps.get(mapId).frameworkPresentation?.kind==='framework-ordinary-field-presentation-v1'?'selected-flat-alternative':'native-preserved-or-unready'});
}
const {assessFrameworkOrdinaryWorld}=await load('compiler/framework-ordinary-presentation'),
 {loadFieldCompositionRenderHost}=await load('compiler/field-native-composition'),
 {webSourceFrameworkInputs}=await import('./source-web-framework-inputs.mjs'),ordinaryDeclaration=webSourceFrameworkInputs().ordinaryFields,
 renderHost=await loadFieldCompositionRenderHost(root,corpus.manifest.sources),
 ordinaryAssessments=assessFrameworkOrdinaryWorld(corpus,strictWorld,[...strictMaps.values()],renderHost,ordinaryDeclaration.reason);
assert.deepEqual(candidate.producer.ordinaryFields.declaration,ordinaryDeclaration,'Candidate lacks the exact explicit ordinary-family producer input');
assert.equal(candidate.producer.ordinaryFields.assessmentsHash,hash(ordinaryAssessments),'Candidate whole ordinary source assessments differ');
assert.deepEqual(ordinaryAssessments.map(row=>row.mapId),ids,'All ordinary source members, including unready, must remain');
for(const assessment of ordinaryAssessments){
 const original=strictMaps.get(assessment.mapId),framework=frameworkMaps.get(assessment.mapId),
  expected=assessment.mode==='flat-alternative'?assessment.presentation:undefined;
 assert.deepEqual(framework.frameworkPresentation,expected,'Source candidate alternative differs from independent whole-family derivation');
 assert.deepEqual(framework.actorView,original.actorView,'Ordinary policy must never replace the native actor view');
 assert.deepEqual(framework.actorViewBlockers,original.actorViewBlockers);assert.deepEqual(framework.nativeCompositionBlockers,original.nativeCompositionBlockers);
 if(assessment.mode==='native-preserved')assert.equal(framework.frameworkPresentation,undefined,'An already qualified native map cannot acquire an alternative');
}
nomination.counts={allSourceMaps:allIds.length,ordinaryMaps:ids.length,outsideFamily:allIds.length-ids.length,
 rawPhysicalPrograms:nomination.programs.length,rawInstructions:nomination.programs.reduce((n,p)=>n+p.instructions,0),
 completeInstalledNamespaceUses:nomination.roots.length,actualFlagInstructionExecutions:'unassessed'};
const serviceIds=allIds.filter(id=>Object.values(strictMaps.get(id).map?.groups??{}).some(g=>g.entities.some(e=>e.kind===16))),
 start=allIds.find(id=>{const m=strictMaps.get(id);return isOrdinarySourceMap(m)&&m.partyEntry?.pointIns.length&&m.actorView?.kind==='native-default-field-view-v1'&&!m.actorViewBlockers?.length&&!m.nativeCompositionBlockers?.length&&!m.cameraHostBlockers?.length;}),first=strictMaps.get(start);
assert.ok(first,'A separate qualified helper entry is required; family membership is never reduced to find one');
const {analyzeContentDependencies}=await load('compiler/content-dependencies');
const sourceDependencies=analyzeContentDependencies({catalog:strictWorld,maps:[...strictMaps.values()],mapIds:allIds,roots:[
 ...nomination.roots.map(row=>({kind:'script',mapId:row.root.mapId,script:row.root.alias})),
 ...ids.flatMap(mapId=>strictMaps.get(mapId).initializer?[{kind:'script',mapId,script:strictMaps.get(mapId).initializer}]:[])]});

const recipe = { kind: 'initialized-source-map-recipe-v5', id: 'ordinary-presentation-whole-source-wip', sourceEntry: { url: '/game/source-new-game.json', contentHash: sourceEntry.contentHash }, sourceBattle: { url: '/game/source-catalog.json', contentHash: sourceBattle.contentHash }, sourceWorld: { url: '/world/catalog.json', contentHash: strictWorld.contentHash }, startMap: start, entrance: first.partyEntry.pointIns[0].id, presentation: 'framework-ordinary-field-flat-v1', battleCatalogSelection: 'source-baseline-v1', sourceAreaScope: null, walking: null, npcActivity: { kind: 'framework-npc-area-template-v1', policy: 'framework-npc-area-v1', missingFirstInterval: 'source-ctor-true', random: 'web-xorshift32-v1', collision: 'actor-grid-reservations-v1', schedule: 'fixed-step-source-order-v1', takeover: 'pause-autonomous-motion-v1', reason: 'Use existing shared Web NPC host unchanged; no story state selection.' }, fieldServices: { kind: 'framework-field-services-declaration-v1', relayInteraction: 'framework-relay-interaction-v1', passiveEffects: 'framework-passive-field-effects-v1', mapIds: serviceIds }, manifest: { kind: 'content-batch-manifest-v1', id: 'ordinary-presentation-whole-source', profile: 'framework', mapIds: allIds, roots: [{ kind: 'entry', mapId: start, entrance: first.partyEntry.pointIns[0].id, continuation: first.initializer }], routes: [{ id: 'original-map-initializers', entry: 'framework-new-game', expectedMapId: start, requiredMapIds: allIds, requiredEncounterIds: [], maxTicks: 6000, inputs: [], choiceAnswers: [], battleAbilityIds: [] }] } };
if (!serviceIds.length) {
    recipe.kind = 'initialized-source-map-recipe-v4';
    delete recipe.fieldServices;
}
const plain = await compileInitializedContentBatch(root, recipe, hash(recipe), { dist: compiled, readJson: read }),
    maps = plain.maps.map(initialized => overlaySourceFrameworkMap({ source: strictMaps.get(initialized.mapId), framework: frameworkMaps.get(initialized.mapId), initialized, canonical, hash })),
    byId = new Map(maps.map(m => [m.mapId, m])),
    world = overlaySourceFrameworkWorld({ source: strictWorld, framework: frameworkWorld, initialized: plain.catalog, maps, canonical, hash });
const physicalById=new Map(corpus.assets.filter(a=>a.kind==='script').map(a=>[a.id,a])), programs = new Map(), inventory = [], cases = [], host = { visible: true, mediaReady: true, overlayOpen: false }, runtime = () => ({ ...sourceWebReplayRuntimePorts(), ...controlledAudioRuntime(), scriptRandom: 'web-source-script-random-field-stream-v1', transportationTimestamp: () => '639273600000000000', sourceEncounterPolicy: WEB_SOURCE_ENCOUNTER_POLICY, cameraShake: createWebFieldCameraShakePolicy(), retainedWorldTransportation: WEB_RETAINED_WORLD_TRANSPORTATION, fieldEffects: createWebLogicalFieldEffectsHost(), sourceMessageSequence: createWebFieldMessageSequencePort(), conditionLeaderActivity: createWebFlatConditionLeaderActivityPort(), assignedNpcRoutes: WEB_ASSIGNED_ROUTE_POLICY, battleHandoff: 'prepared' });
const { GameEventSaveCoordinator } = await load('core/game-event-save'), { CheckpointStorage } = await load('core/saved-game'),{GameMapLoader}=await load('core/game-map-loader'), savers = new WeakMap(),repositories=new WeakMap();
async function drain(game, flow, trace) { for (let tick = 0; tick < 6000; tick++) {
    if (game.eventSaveRequest) {
        let saver = savers.get(game);
        if (!saver) {
            const bytes = new Map(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null, setItem: (key, value) => bytes.set(key, value) }, 'framework');
            saver = new GameEventSaveCoordinator(flow, storage);
            savers.set(game, saver);
        }
        const result = await saver.save(tick);
        assert.equal(result.status, 'committed');
        trace.push({ kind: 'source-event-save', tick, status: result.status });
        flow.advance(10, host);
        continue;
    }
    if(game.field.stop?.kind==='map-transition') {
        const request=game.field.stop,repo=repositories.get(game);assert.ok(repo,'Map continuation requires the same actual repository');
        trace.push({kind:'source-map-request',request:structuredClone(request),finiteExecutions:game.field.finiteAnimationExecutions});
        const result=await new GameMapLoader(flow,repo,{prepare:async()=>null,discard(){}}).load();
        if(result.status!=='committed')throw new Error('Source map preparation '+result.status+': '+String(result.error));
        trace.push({kind:'source-map-committed',mapId:game.field.content.map.identity?.mapId});continue;
    }
    if (game.field.stop)
        throw new Error('Source VM stopped: ' + canonical(game.field.stop));
    if (!game.field.busy)
        return tick;
    if (game.field.dialogue || game.field.sourceMessage.projection?.acceptsInput) {
        trace.push({ kind: 'confirm-source-message', key: game.field.dialogue?.key ?? game.field.sourceMessage.projection.key });
        flow.confirm();
    }
    if (game.field.choice)
        throw new Error('Unspecified source choice: ' + canonical(game.field.choice));
    flow.advance(10, host);
} throw new Error('Whole original source body exceeded declared clock budget'); }
function assertRestoredCheckpoint(before,after){
 const expected=structuredClone(before),rebindings=[];
 const prior=before.world.field.npcActivities,next=after.world.field.npcActivities;
 if(prior!==undefined){
  assert.ok(next);assert.equal(prior.kind,'field-npc-activities-checkpoint-v1');assert.equal(next.kind,prior.kind);
  assert.deepEqual(Object.keys(next.activities).sort(),Object.keys(prior.activities).sort());
  for(const [id,row]of Object.entries(prior.activities)){
   const a=row.state,b=next.activities[id].state,target=expected.world.field.npcActivities.activities[id].state;
   assert.equal(a.holder,null);assert.equal(b.holder,null);
   assert.ok(Number.isSafeInteger(b.generation)&&b.generation>a.generation,'Fresh field completion generation must retire old command authority');
   assert.equal(b.revision,a.revision+1,'restoreNpcActivity bumps its revision exactly once');
   if(a.pending!==null){assert.ok(b.pending);assert.equal(b.pending.revision,b.revision);target.pending.revision=a.revision+1;}
   target.generation=b.generation;target.revision=a.revision+1;
   rebindings.push({path:'world.field.npcActivities.activities.'+id,actorId:id,
    generation:{before:a.generation,after:b.generation},revision:{before:a.revision,after:b.revision},
    pendingRevision:{before:a.pending?.revision??null,after:b.pending?.revision??null},
    contract:'existing restoreNpcActivity: fresh generation, exactly one revision bump; command/rng/wait/gameplay state unchanged'});
  }
 }
 assert.deepEqual(after,expected,'Only exact existing NPC completion-identity rebinding may differ after restore');return rebindings;
}
function actualActors(game) { return Object.values(game.field.actors).map(actor => ({ id: actor.id, source: actor.native?.scope ?? null, position: { x: actor.x, y: actor.y, layer: actor.layer }, direction: actor.direction, animation: actor.animation?.snapshot() ?? null, visible: game.field.isEntityVisible(actor.id) })); }
for (const id of ids) {
    const map = byId.get(id), source = strictMaps.get(id), row = { mapId: id, rawNomination: nomination.maps.find(row => row.mapId === id), originalInitializer: map.initializer, sourceMapHash: source.contentHash, candidateMapHash: map.contentHash, originalMapDiagnostics: source.blockers, originalGroupDiagnostics: Object.fromEntries(Object.entries(source.map?.groups ?? {}).map(([name, g]) => [name, g.blockers])), fullNamespace: [], roots: [], status: 'unready', trace: [] };
    inventory.push(row);
    row.roots = nomination.roots.filter(candidate=>candidate.root.mapId===id).map(candidate=>({name:candidate.root.alias,assetId:candidate.root.id,instructions:candidate.instructions,completeClosure:candidate.closure,operandBlockers:candidate.operandBlockers,otherwiseOperandClosed:candidate.otherwiseOperandClosed}));
    for(const [name,assetId]of Object.entries(row.rawNomination.namespace)){
      const asset=physicalById.get(assetId);assert(asset,'Unbound raw installed source namespace');const ops=map.scripts[name];
      if(ops)assert.equal(asset.data.Mnemonics.length,ops.length,'Whole source instruction membership changed');
      programs.set(asset.id,{id:asset.id,source:asset.source,rawHash:hash(asset.data),raw:asset.data,instructions:asset.data.Mnemonics.length});
      row.fullNamespace.push({name,assetId:asset.id,rawHash:hash(asset.data),instructions:asset.data.Mnemonics.length,
        compiledProgramPresent:!!ops,blocked:ops?.filter(op=>op.kind==='blocked')??[]});
    }
    const installed = new Set(row.fullNamespace.map(p => p.assetId));
    row.dependencies = analysis.dependencies.filter(d => installed.has(d.site.asset));
    try {
        assert.ok(map.partyEntry?.pointIns.length, 'Source entrance metadata missing');
        const entry = await compileFrameworkNewGame({ sourceEntry, sourceBattle, sourceMap: source, world, map, battle: plain.battle, entrance: map.partyEntry.pointIns[0].id }), files = new Map([[plain.refs.world.url, world], [plain.refs.initialized.entry.url, entry], [plain.refs.initialized.battle.url, plain.battle], ...maps.map(m => [world.maps[m.mapId].url, m])]), refs = { ...plain.refs, world: { ...plain.refs.world, contentHash: world.contentHash }, initialized: { entry: { ...plain.refs.initialized.entry, contentHash: entry.contentHash }, battle: plain.refs.initialized.battle } }, repo = new GameContentRepository(async (url) => { assert.ok(files.has(url), 'Undeclared candidate dependency ' + url); return structuredClone(files.get(url)); }, 'framework', refs), contents = await repo.initializedNewGame(), launch = async () => { const game = await GameSession.prepareFrameworkNewGame(contents.content, contents.catalog, contents.map, contents.battle, runtime()), flow = new GameFlow(game); flow.start(); flow.observeHost(host); repositories.set(game,repo); return { game, flow }; }, firstRun = await launch(), game = firstRun.game, flow = firstRun.flow;
        row.presentationAtInitialEntry={sourceCandidateSelected:row.rawNomination.familySelection==='selected-flat-alternative',
          mapId:game.field.content.map.identity?.mapId,nativeBinding:game.field.player.native?.entity.viewBinding?.properties?.kind??null};
        if(row.presentationAtInitialEntry.sourceCandidateSelected)assert.equal(row.presentationAtInitialEntry.nativeBinding,'framework-flat-field-view-projection-v1');
        row.ticks = await drain(game, flow, row.trace);
        row.status = 'initializer-completed';
        row.beforeClock = actualActors(game); row.finiteAfterInitializer = game.field.finiteAnimationExecutions;
        const owner = game.field, refsBefore = new Map(row.beforeClock.map(r => [r.id, game.field.actors[r.id]]));
        flow.advance(120, host);
        assert.equal(game.field, owner);
        for (const [id, ref] of refsBefore)
            assert.equal(game.field.actors[id], ref);
        assert.equal(game.field.stop, null);
        row.afterClock = actualActors(game);
        row.clockObserved = row.afterClock.some(after => canonical(after.animation) !== canonical(row.beforeClock.find(before => before.id === after.id)?.animation));
        row.bankAfterInitializer = game.field.eventState.snapshot();
        row.ownedAfterInitializerHash = hash(game.state.snapshot());
        if(game.checkpointReady){
          const saved=game.checkpoint(),bytes=new Map(),storage=new CheckpointStorage({getItem:key=>bytes.get(key)??null,setItem:(key,v)=>bytes.set(key,v)},'framework');
          await storage.save(saved,1);const loaded=await storage.load();assert(loaded);
          const restoredContents=await repo.restoreSessionContent(loaded.checkpoint),restored=GameSession.restore(loaded.checkpoint,undefined,restoredContents.battle,restoredContents.world,runtime());
          row.restoreNpcRebindings=assertRestoredCheckpoint(saved,restored.checkpoint());
          assert.deepEqual(restored.state.snapshot(),game.state.snapshot());assert.deepEqual(restored.field.eventState.snapshot(),game.field.eventState.snapshot());
          row.saveRestore='passed-durable-Storage-and-Repository';
        }
        for (const rootProgram of row.roots) {
            const c = { mapId: id, ...rootProgram, status: 'unready', trace: [] }; let attempted=null, finiteStart=0;
            cases.push(c);
            try {
                if (rootProgram.name === map.initializer) {
                    c.status = 'completed';
                    c.finiteExecutions = game.field.finiteAnimationExecutions; c.execution = 'original-initializer';
                    continue;
                }
                const { game: g, flow: f } = await launch(); attempted=g;
                await drain(g, f, c.trace);
                finiteStart=g.field.finiteAnimationExecutions.length; c.before = { actors: actualActors(g), banks: g.field.eventState.snapshot(), owned: hash(g.state.snapshot()) };
                c.execution='unexecuted-original-source-origin';
                c.sourceOrigin=assertSourceProgramOrigin({field:g.field,map,script:rootProgram.name,canonical});
                assert.equal(g.field.startEvent(rootProgram.name), true);
                c.execution='attempted-original-source-body-after-initializer';
                c.execution='attempted-original-source-body-after-initializer';
                c.ticks = await drain(g, f, c.trace);
                c.finiteExecutions = g.field.finiteAnimationExecutions.slice(finiteStart); c.after = { actors: actualActors(g), banks: g.field.eventState.snapshot(), owned: hash(g.state.snapshot()) };
                c.execution = 'full-source-body-after-original-initializer';
                c.status = 'completed';
            }
            catch (error) {
                c.reason = String(error.stack ?? error); c.fullBodyCompleted = false; if(attempted){c.finiteExecutions=attempted.field.finiteAnimationExecutions.slice(finiteStart);c.actualStop=attempted.field.stop;}
            }
        }
    }
    catch (error) {
        row.reason = String(error.stack ?? error);
        for (const rootProgram of row.roots)
            cases.push({ mapId: id, ...rootProgram, status: 'unready', execution: 'unexecuted-initialization-prerequisite', reason: 'Original source initializer/host prerequisite failed; root body not executed.', initializationFailure:row.reason });
    }
    await writeFile(resolve(out,'progress.json'),JSON.stringify({kind:'ordinary-presentation-source-progress-v1',result:'running',mapsAttempted:inventory.length,mapsTotal:ids.length,
      initializersCompleted:inventory.filter(r=>r.status==='initializer-completed').length,rootCasesRecorded:cases.length,rootCasesTotal:nomination.roots.length,
      completedRoots:cases.filter(r=>r.status==='completed').length,lastMapId:id,sourceStoryReachability:false})+'\n');

}
assert.equal(cases.length,nomination.roots.length,'Every original ordinary namespace root must retain an actual attempt or initialization-unexecuted case');
const rows=nomination.programs,report={kind:'whole-source-ordinary-field-presentation-lifecycle-v1',published:false,
 sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,runtimeSha256:before,checkerSha256:checkerBefore,
 sourceOrigin:{kind:'private-pure-source-candidate-input-lock',reportSha256:sha(candidateReportBytes),sourceCompilerDigest:lock.compilerDigest,candidateKind:candidate.kind,candidateDir,sharedObjectCount:candidate.objects.length},
 recipe,buildReport:plain.report,counts:{...nomination.counts,
  selectedAlternativeMaps:nomination.maps.filter(m=>m.familySelection==='selected-flat-alternative').length,
  availableProjections:ordinaryAssessments.filter(row=>row.presentation).length,nativePreservedMaps:ordinaryAssessments.filter(row=>row.mode==='native-preserved').length,
  retainedPresentationUnready:ordinaryAssessments.filter(row=>row.mode==='unready').length,
  initializerAttempts:inventory.length,initializersCompleted:inventory.filter(r=>r.status==='initializer-completed').length,
  initializersUnready:inventory.filter(r=>r.status==='unready').length,
  sourceRootCases:cases.length,sourceRootsCompleted:cases.filter(c=>c.status==='completed').length,
  sourceRootsUnready:cases.filter(c=>c.status==='unready').length,sourceRootsUnexecuted:cases.filter(c=>c.execution?.startsWith('unexecuted-')).length,
  selectedAlternativeActualPreparations:inventory.filter(r=>r.presentationAtInitialEntry?.sourceCandidateSelected).length,
  saveRestores:inventory.filter(r=>r.saveRestore==='passed-durable-Storage-and-Repository').length},
 dependencies:{file:resolve(out,'source-dependencies.json'),requiredMapIds:sourceDependencies.requiredMapIds,diagnostics:sourceDependencies.diagnostics.length,edges:sourceDependencies.edges.length,providerRequirements:sourceDependencies.providerRequirements.length},
 maps:inventory,cases,evidence:{actualRepository:true,actualSession:true,actualFlow:true,actualNativeActorOwner:true,sourceProgramsPreserved:true,completeInstalledNamespace:true,
 wholeFamilyIncludesEveryUnreadyMap:true,countsAreStoryReachability:false,plotFlagsInjected:false,rosterInjected:false,sourceStoryReachability:false,nativeParity:false},
 sourceCampaignComplete:false,fullGameMigration:false};
assert.equal(await runtimeDigest(runtimeRoot, compiled), before);
await sharedCandidate.validate();
const afterSnapshot = await readSnapshot(resolve(root, 'build/corpus'));
assert.equal(corpusSnapshot.size, afterSnapshot.size);
for (const [name, bytes] of corpusSnapshot)
    assert.equal(sha(afterSnapshot.get(name)), sha(bytes));
assert.equal(sha(await readFile(new URL(import.meta.url))),checkerBefore);
await mkdir(out, { recursive: true });
const artifacts={
 'source-dependencies.json':JSON.stringify(sourceDependencies)+'\n',
 'all-ordinary-assessments.json':JSON.stringify(ordinaryAssessments)+'\n',
 'nomination.json':JSON.stringify({...nomination,programs:nomination.programs.map(({raw,...row})=>row)},null,2)+'\n',
 'full-source-programs.json':JSON.stringify({sourceSetHash:corpus.sourceSetHash,programs:rows,allDependencies:analysis.dependencies,maps:nomination.maps})+'\n'};
report.artifacts=[];for(const [file,bytes] of Object.entries(artifacts)){await writeFile(resolve(out,file),bytes);report.artifacts.push({file:resolve(out,file),sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
