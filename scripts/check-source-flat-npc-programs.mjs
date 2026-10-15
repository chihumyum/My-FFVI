import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { compileInitializedContentBatch } from './build-initialized-content-batch.mjs';
import { validateSourcePrerequisiteInputs } from './compile-source-prerequisites.mjs';
import { controlledAudioRuntime } from './controlled-audio.mjs';
import { runtimeDigest } from './runtime-digest.mjs';
import { sourceFlatNpcCohort } from './source-flat-npc-cohort.mjs';
import {webSourceFrameworkInputs} from './source-web-framework-inputs.mjs';
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
assert.equal(args.length % 2, 0, 'Expected option/value pairs');
assert.equal(new Set(args.filter((_, i) => i % 2 === 0)).size, args.length / 2, 'Duplicate options');
for (let i = 0; i < args.length; i += 2)
    assert.ok(['--root', '--compiled-dir', '--output', '--candidate-dir'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown or missing option value');
const runtimeRoot = resolve(import.meta.dirname, '..'), root = resolve(option('--root') ?? runtimeRoot), out = resolve(root, option('--output') ?? 'build/reports/source-flat-npc'), candidateDir = resolve(root, option('--candidate-dir') ?? 'build/source-flat-npc-candidate'), compiled = resolve(root, option('--compiled-dir') ?? 'dist'), load = n => import(pathToFileURL(resolve(compiled, 'src', n + '.js')).href), sha = b => createHash('sha256').update(b).digest('hex');
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { compileFrameworkNewGame }, { canonical, hash }, { loadCorpus }, { loadSystemMessages }, { readSnapshot }, { createWebLogicalFieldEffectsHost }, { createWebFieldMessageSequencePort }, { createWebFlatConditionLeaderActivityPort }, { WEB_SOURCE_ENCOUNTER_POLICY }, { createWebFieldCameraShakePolicy }, { WEB_RETAINED_WORLD_TRANSPORTATION }, { WEB_ASSIGNED_ROUTE_POLICY }] = await Promise.all(['core/game-content', 'core/game-session', 'core/game-flow', 'compiler/framework-new-game', 'compiler/content', 'compiler/corpus', 'compiler/system-messages', 'compiler/integrity', 'core/field-logical-effects', 'core/source-message-sequence', 'core/field-condition-activity', 'core/source-encounter-entry', 'core/field-camera-shake', 'core/world-transportation-entry', 'core/field-assigned-route'].map(load));
const checkerBefore = sha(await readFile(new URL(import.meta.url)));
await mkdir(out,{recursive:true});
execFileSync(resolve(root,'.venv/bin/python'),[resolve(runtimeRoot,'scripts/inspect-flat-npc-native.py'),'--root',root,'--output',resolve(out,'native.json')],{stdio:'pipe'});
const nativeBytes=await readFile(resolve(out,'native.json')),native=JSON.parse(nativeBytes);assert.equal(native.result,'passed-static-input-audit');
const before = await runtimeDigest(runtimeRoot, compiled), candidateReportBytes = await readFile(resolve(candidateDir, 'report.json')), candidate = JSON.parse(candidateReportBytes), lock = JSON.parse(await readFile(resolve(candidateDir, 'inputs.json')));
await validateSourcePrerequisiteInputs(lock, { root });
assert.equal(candidate.status, 'complete');
assert.equal(candidate.runtimeSha256, before, 'Candidate must come from this exact compiled/tool/app runtime');
const corpusSnapshot = await readSnapshot(resolve(root, 'build/corpus')), bound = new Map(), objects = new Map(), objectIndex = new Map(candidate.objects.map(row => [row.url, row]));
const read = async (url) => { const row = objectIndex.get(url); assert.ok(row, 'Unknown same-candidate input ' + url); const file = resolve(candidateDir, 'objects', url.slice(1)); if (!objects.has(row.sha256)) {
    const bytes = await readFile(file);
    assert.equal(sha(bytes), row.sha256);
    assert.equal(bytes.length, row.bytes);
    bound.set(file, row.sha256);
    objects.set(row.sha256, JSON.parse(bytes));
} return structuredClone(objects.get(row.sha256)); };
const strictWorld = await read('/world/catalog.json'), sourceEntry = await read('/game/source-new-game.json'), sourceBattle = await read('/game/source-catalog.json'), frameworkWorld = await read('/framework/world/catalog.json'), strictMaps = new Map(), frameworkMaps = new Map();
const corpus = await loadCorpus(root), system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources), { compileStoryCorpus } = await load('compiler/story-corpus'), ir = compileStoryCorpus({...corpus,messages:{...corpus.messages,system_zhc:system.messages}}), nomination = sourceFlatNpcCohort(corpus,ir,{...await load('compiler/map-package'),...await load('compiler/entity-group'),canonical}), nominationIds = [...new Set(nomination.roots.map(row=>row.root.mapId))].sort((a,b)=>a-b);
for (const id of Object.keys(strictWorld.maps).map(Number).sort((a,b)=>a-b)) {
    strictMaps.set(id, await read(strictWorld.maps[id].url));
    frameworkMaps.set(id, await read(frameworkWorld.maps[id].url));
}
assert.equal(nomination.sourceSetHash, strictWorld.sourceSetHash);
const analysis = ir.analysis, ids = [...new Set(nominationIds)].sort((a, b) => a - b), allIds = Object.keys(strictWorld.maps).map(Number).sort((a,b)=>a-b), serviceIds = allIds.filter(id => Object.values(strictMaps.get(id).map?.groups ?? {}).some(g => g.entities.some(e => e.kind === 16))), start = allIds.find(id => { const map = strictMaps.get(id); return map.partyEntry?.pointIns.length && map.entryView?.isWorld === false && map.actorView?.kind === "native-default-field-view-v1" && !map.actorViewBlockers?.length && !map.nativeCompositionBlockers?.length; }), first = strictMaps.get(start);
// This seed builds only the shared entry scaffold. All 21 nominated maps and
// every original initializer/root remain in the independent execution queue.
assert.ok(first, "No source-proven ordinary field scaffold is available");
const {analyzeContentDependencies}=await load('compiler/content-dependencies');
const sourceDependencies=analyzeContentDependencies({catalog:strictWorld,maps:[...strictMaps.values()],mapIds:allIds,roots:[
 ...nomination.roots.map(row=>({kind:'script',mapId:row.root.mapId,script:row.root.alias})),
 ...ids.flatMap(mapId=>strictMaps.get(mapId).initializer?[{kind:'script',mapId,script:strictMaps.get(mapId).initializer}]:[])]});

const recipe = { kind: 'initialized-source-map-recipe-v5', id: 'play-animation-whole-source-wip', sourceEntry: { url: '/game/source-new-game.json', contentHash: sourceEntry.contentHash }, sourceBattle: { url: '/game/source-catalog.json', contentHash: sourceBattle.contentHash }, sourceWorld: { url: '/world/catalog.json', contentHash: strictWorld.contentHash }, startMap: start, entrance: first.partyEntry.pointIns[0].id, presentation: 'framework-ordinary-field-flat-v1', battleCatalogSelection: 'source-baseline-v1', sourceAreaScope: null, walking: null, npcActivity: { kind: 'framework-npc-area-template-v1', policy: 'framework-npc-area-v1', missingFirstInterval: 'source-ctor-true', random: 'web-xorshift32-v1', collision: 'actor-grid-reservations-v1', schedule: 'fixed-step-source-order-v1', takeover: 'pause-autonomous-motion-v1', reason: webSourceFrameworkInputs().npcAreas.reason }, fieldServices: { kind: 'framework-field-services-declaration-v1', relayInteraction: 'framework-relay-interaction-v1', passiveEffects: 'framework-passive-field-effects-v1', mapIds: serviceIds }, manifest: { kind: 'content-batch-manifest-v1', id: 'play-animation-whole-source', profile: 'framework', mapIds: allIds, roots: [{ kind: 'entry', mapId: start, entrance: first.partyEntry.pointIns[0].id, continuation: first.initializer }], routes: [{ id: 'original-map-initializers', entry: 'framework-new-game', expectedMapId: start, requiredMapIds: allIds, requiredEncounterIds: [], maxTicks: 6000, inputs: [], choiceAnswers: [], battleAbilityIds: [] }] } };
if (!serviceIds.length) {
    recipe.kind = 'initialized-source-map-recipe-v4';
    delete recipe.fieldServices;
}
const plain = await compileInitializedContentBatch(root, recipe, hash(recipe), { dist: compiled, readJson: read }), seal = value => { const { contentHash: _, ...body } = value; return { ...body, contentHash: hash(body) }; }, maps = plain.maps.map(value => { const original = frameworkMaps.get(value.mapId), map = structuredClone(value); map.map = structuredClone(original.map); map.blockers = structuredClone(original.blockers); map.developmentOmissions = structuredClone(original.developmentOmissions); map.fieldEffects = structuredClone(original.fieldEffects); map.frameworkNpcFlat=structuredClone(original.frameworkNpcFlat); if(original.frameworkPresentation)map.frameworkPresentation=structuredClone(original.frameworkPresentation); map.developmentProfile = { ...map.developmentProfile, ...original.developmentProfile, fieldPresentation: value.developmentProfile.fieldPresentation, npcActivity: value.developmentProfile.npcActivity, relayInteraction: value.developmentProfile.relayInteraction, passiveEffects: value.developmentProfile.passiveEffects }; for (const key of Object.keys(map.developmentProfile))
    if (map.developmentProfile[key] === undefined)
        delete map.developmentProfile[key]; assert.equal(canonical(map.scripts), canonical(strictMaps.get(map.mapId).scripts)); assert.equal(canonical(map.scriptPuppetContexts), canonical(strictMaps.get(map.mapId).scriptPuppetContexts)); return seal(map); }), byId = new Map(maps.map(m => [m.mapId, m])), worldDraft = structuredClone(plain.catalog);
worldDraft.developmentProfile = { ...plain.catalog.developmentProfile, ...frameworkWorld.developmentProfile, fieldPresentation: 'framework-ordinary-field-flat-v1', npcActivity: 'framework-npc-area-v1', ...(serviceIds.length ? { relayInteraction: 'framework-relay-interaction-v1', passiveEffects: 'framework-passive-field-effects-v1' } : {}) };
for (const map of maps)
    worldDraft.maps[map.mapId].contentHash = map.contentHash;
const world = seal(worldDraft);
const sourceKey = ref => canonical(Object.fromEntries(['file', 'assetPath', 'objectId', 'serializedFile', 'sha256'].map(k => [k, ref[k]]))), physical = new Map(corpus.assets.filter(a => a.kind === 'script').map(a => [sourceKey(a.source), a])), physicalById=new Map(corpus.assets.filter(a=>a.kind==='script').map(a=>[a.id,a])), programs = new Map(), inventory = [], cases = [], host = { visible: true, mediaReady: true, overlayOpen: false }, runtime = () => ({ ...controlledAudioRuntime(), transportationTimestamp: () => '639273600000000000', sourceEncounterPolicy: WEB_SOURCE_ENCOUNTER_POLICY, cameraShake: createWebFieldCameraShakePolicy(), retainedWorldTransportation: WEB_RETAINED_WORLD_TRANSPORTATION, fieldEffects: createWebLogicalFieldEffectsHost(), sourceMessageSequence: createWebFieldMessageSequencePort(), conditionLeaderActivity: createWebFlatConditionLeaderActivityPort(), assignedNpcRoutes: WEB_ASSIGNED_ROUTE_POLICY, battleHandoff: 'prepared' });
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
        trace.push({kind:'source-map-request',request:structuredClone(request),projectedActors:projectedActors(game)});
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
function projectedActors(game){return Object.values(game.field.actors).flatMap(actor=>{const binding=game.field.content.frameworkNpcFlat?.bindings.find(b=>b.definition.entityId===actor.id);return binding?[{id:actor.id,source:actor.native?.scope??null,sourceLayer:binding.definition.geometry.layer,logicalLayer:actor.layer,nativeLayer:actor.native?.entity.layer??null,position:structuredClone(actor.native?.entity.position??null),allLayerTarget:binding.allLayerTarget,birdviewPuppet:binding.birdviewPuppet}]:[];});}
function actualActors(game) { return Object.values(game.field.actors).map(actor => ({ id: actor.id, source: actor.native?.scope ?? null, position: { x: actor.x, y: actor.y, layer: actor.layer }, direction: actor.direction, animation: actor.animation?.snapshot() ?? null, visible: game.field.isEntityVisible(actor.id) })); }
for (const id of ids) {
    const map = byId.get(id), source = strictMaps.get(id), row = { mapId: id, rawNomination: nomination.maps.find(row => row.mapId === id), originalInitializer: map.initializer, sourceMapHash: source.contentHash, candidateMapHash: map.contentHash, originalMapDiagnostics: source.blockers, originalGroupDiagnostics: Object.fromEntries(Object.entries(source.map?.groups ?? {}).map(([name, g]) => [name, g.blockers])), fullNamespace: [], roots: [], status: 'unready', trace: [] };
    inventory.push(row);
    row.roots = nomination.roots.filter(candidate=>candidate.root.mapId===id).map(candidate=>({name:candidate.root.alias,assetId:candidate.root.id,instructions:candidate.instructions,completeClosure:candidate.closure,operandBlockers:candidate.operandBlockers,otherwiseOperandClosed:candidate.otherwiseOperandClosed}));
    for (const [name, ops] of Object.entries(map.scripts)) {
        const asset = ops[0]?.source ? physical.get(sourceKey(ops[0].source)) : physicalById.get(row.rawNomination.namespace[name]);
        assert.ok(asset, 'Unbound installed source namespace ' + name);
        assert.equal(asset.data.Mnemonics.length, ops.length);
        programs.set(asset.id, { id: asset.id, source: asset.source, rawHash: hash(asset.data), raw: asset.data, instructions: ops.length });
        row.fullNamespace.push({ name, assetId: asset.id, rawHash: hash(asset.data), instructions: ops.length, blocked: ops.filter(op => op.kind === 'blocked') });

    }
    const installed = new Set(row.fullNamespace.map(p => p.assetId));
    row.dependencies = analysis.dependencies.filter(d => installed.has(d.site.asset));
    try {
        assert.ok(map.partyEntry?.pointIns.length, 'Source entrance metadata missing');
        const entry = await compileFrameworkNewGame({ sourceEntry, sourceBattle, sourceMap: source, world, map, battle: plain.battle, entrance: map.partyEntry.pointIns[0].id }), files = new Map([[plain.refs.world.url, world], [plain.refs.initialized.entry.url, entry], [plain.refs.initialized.battle.url, plain.battle], ...maps.map(m => [world.maps[m.mapId].url, m])]), refs = { ...plain.refs, world: { ...plain.refs.world, contentHash: world.contentHash }, initialized: { entry: { ...plain.refs.initialized.entry, contentHash: entry.contentHash }, battle: plain.refs.initialized.battle } }, repo = new GameContentRepository(async (url) => { assert.ok(files.has(url), 'Undeclared candidate dependency ' + url); return structuredClone(files.get(url)); }, 'framework', refs), contents = await repo.initializedNewGame(), launch = async () => { const game = await GameSession.prepareFrameworkNewGame(contents.content, contents.catalog, contents.map, contents.battle, runtime()), flow = new GameFlow(game); flow.start(); flow.observeHost(host); repositories.set(game,repo); return { game, flow }; }, firstRun = await launch(), game = firstRun.game, flow = firstRun.flow;
        row.ticks = await drain(game, flow, row.trace);
        row.status = 'initializer-completed'; row.activeFlatNpcIds=Object.values(game.field.actors).filter(a=>game.field.content.frameworkNpcFlat?.bindings.some(b=>b.definition.entityId===a.id)).map(a=>a.id);
        row.beforeClock = actualActors(game); row.projectionsAfterInitializer = projectedActors(game);
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
        if (game.checkpointReady) {
            const saved = game.checkpoint(), restored = GameSession.restore(saved, undefined, contents.battle, { catalog: contents.catalog, map: contents.map, initialized: { content: contents.content, initialMap: contents.map } }, runtime());
            assert.deepEqual(actualActors(restored), actualActors(game));
            assert.deepEqual(restored.state.snapshot(), game.state.snapshot());
            assert.deepEqual(restored.field.eventState.snapshot(), game.field.eventState.snapshot());
            row.saveRestore = 'passed';
        }
        for (const rootProgram of row.roots) {
            const c = { mapId: id, ...rootProgram, status: 'unready', trace: [] }; let attempted=null;
            cases.push(c);
            try {
                if (rootProgram.name === map.initializer) {
                    c.status = 'completed';
                    c.projectedActors = projectedActors(game); c.execution = 'original-initializer';
                    continue;
                }
                const { game: g, flow: f } = await launch(); attempted=g;
                await drain(g, f, c.trace);
                 c.before = { actors: actualActors(g), banks: g.field.eventState.snapshot(), owned: hash(g.state.snapshot()) };
                assert.equal(g.field.startEvent(rootProgram.name), true);
                c.ticks = await drain(g, f, c.trace);
                c.projectedActors = projectedActors(g); c.after = { actors: actualActors(g), banks: g.field.eventState.snapshot(), owned: hash(g.state.snapshot()) };
                c.execution = 'full-source-body-after-original-initializer';
                c.status = 'completed';
            }
            catch (error) {
                c.reason = String(error.stack ?? error); c.fullBodyCompleted = false; if(attempted){c.projectedActors=projectedActors(attempted);c.actualStop=attempted.field.stop;}
            }
        }
    }
    catch (error) {
        row.reason = String(error.stack ?? error);
        for (const rootProgram of row.roots)
            cases.push({ mapId: id, ...rootProgram, status: 'unready', execution: 'unexecuted-initialization-prerequisite', reason: 'Original source initializer/host prerequisite failed; root body not executed.', initializationFailure:row.reason });
    }
}
assert.equal(cases.length,nomination.roots.length,'Every original installed source root must retain an actual attempt or initialization-unexecuted case');
const rows = nomination.programs, report = { kind: 'whole-source-flat-npc-lifecycle-v1', published: false, sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash, runtimeSha256: before, checkerSha256: checkerBefore, nativeEvidence:{file:resolve(out,'native.json'),sha256:sha(nativeBytes),scope:native.scope,unknown:native.unknown}, sourceOrigin: { kind: 'private-pure-source-candidate-input-lock', reportSha256: sha(candidateReportBytes), sourceCompilerDigest: lock.compilerDigest }, recipe, buildReport: plain.report, counts: { ...nomination.counts, initializerAttempts: inventory.length, initializersCompleted: inventory.filter(row=>row.status==='initializer-completed').length, initializersUnready:inventory.filter(row=>row.status==='unready').length, sourceRootCases:cases.length, sourceRootsCompleted:cases.filter(c=>c.status==='completed').length, sourceRootsUnready:cases.filter(c=>c.status==='unready').length, flatNpcActiveAfterInitializers:inventory.reduce((n,row)=>n+(row.activeFlatNpcIds?.length??0),0), sourceRootsUnexecuted:cases.filter(c=>c.execution==='unexecuted-initialization-prerequisite').length, rootsWithProjectionActors:cases.filter(c=>c.projectedActors?.length).length, saveRestores:inventory.filter(row=>row.saveRestore==='passed').length }, dependencies:{file:resolve(out,'source-dependencies.json'),requiredMapIds:sourceDependencies.requiredMapIds,diagnostics:sourceDependencies.diagnostics.length,edges:sourceDependencies.edges.length,providerRequirements:sourceDependencies.providerRequirements.length}, maps: inventory, cases, evidence: { actualRepository: true, actualSession: true, actualFlow: true, actualNativeActorOwner: true, sourceProgramsPreserved: true, completeInstalledNamespace: true, actualFlatNpcActorOwner:true, countsAreStoryReachability: false, plotFlagsInjected: false, rosterInjected: false, sourceStoryReachability: false, nativeParity: false } };
assert.equal(await runtimeDigest(runtimeRoot, compiled), before);
await validateSourcePrerequisiteInputs(lock, { root });
const afterSnapshot = await readSnapshot(resolve(root, 'build/corpus'));
assert.equal(corpusSnapshot.size, afterSnapshot.size);
for (const [name, bytes] of corpusSnapshot)
    assert.equal(sha(afterSnapshot.get(name)), sha(bytes));
for (const [file, digest] of bound)
    assert.equal(sha(await readFile(file)), digest);
for (const row of candidate.objects) {
    const bytes = await readFile(resolve(candidateDir, 'objects', row.url.slice(1)));
    assert.equal(sha(bytes), row.sha256);
    assert.equal(bytes.length, row.bytes);
}
assert.equal(sha(await readFile(new URL(import.meta.url))), checkerBefore);assert.equal(sha(await readFile(resolve(out,'native.json'))),sha(nativeBytes));
for(const row of native.files)assert.equal(sha(await readFile(resolve(root,row.path))),row.sha256);
for(const row of Object.values(native.inputs))assert.equal(sha(await readFile(resolve(root,row.path))),row.sha256);
await mkdir(out, { recursive: true });
const artifacts={
 'source-dependencies.json':JSON.stringify(sourceDependencies)+'\n',
 'nomination.json':JSON.stringify({...nomination,programs:nomination.programs.map(p=>({id:p.id,source:p.source,rawHash:p.rawHash,instructions:p.instructions.length,bindings:p.bindings??[]}))},null,2)+'\n',
 'full-source-programs.json':JSON.stringify({sourceSetHash:corpus.sourceSetHash,programs:rows,allDependencies:analysis.dependencies,maps:nomination.maps})+'\n'};
report.artifacts=[];for(const [file,bytes] of Object.entries(artifacts)){await writeFile(resolve(out,file),bytes);report.artifacts.push({file:resolve(out,file),sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
