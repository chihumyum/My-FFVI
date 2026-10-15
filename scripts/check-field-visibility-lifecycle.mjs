// Complete actor-visibility source-program lifecycle. All candidates are private;
// no source rewrites, story-state defaults, publication, or second VM/owner.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { collectVisibilityCohort } from './visibility-cohort.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
let compiled = 'dist', sourceCompiler = null, sourceCache = null, output = null;
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--compiled', '--source-compiler', '--source-cache', '--output'].includes(process.argv[i])); assert.ok(process.argv[i + 1]);
  if (process.argv[i] === '--compiled') compiled = process.argv[i + 1];
  else if (process.argv[i] === '--source-compiler') sourceCompiler = process.argv[i + 1];
  else if (process.argv[i] === '--output') output = resolve(root, process.argv[i + 1]); else sourceCache = process.argv[i + 1];
}
output ??= resolve(root, 'build/reports/field-visibility-lifecycle/lifecycle-report.json');
const out = dirname(output); await mkdir(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const load = name => import(pathToFileURL(resolve(root, compiled, 'src', name + '.js')).href);
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { GameCommands }, { GameEntryLoader },
  { CheckpointStorage }, { canonical }, { loadCorpus, analyzeCorpus }, { hash }, { readSnapshot },
  { loadSystemMessages }, { bindMapPackages, resolveMapScript }] = await Promise.all([
  'core/game-content', 'core/game-session', 'core/game-flow', 'core/game-commands', 'core/game-entry-loader',
  'core/saved-game', 'core/canonical', 'compiler/corpus', 'compiler/content', 'compiler/integrity',
  'compiler/system-messages', 'compiler/map-package',
].map(load));
const { runtimeDigest } = await import(pathToFileURL(resolve(root, 'scripts/runtime-digest.mjs')).href);
const { compileInitializedContentBatch } = await import(pathToFileURL(resolve(root, 'scripts/build-initialized-content-batch.mjs')).href);
const { controlledAudioRuntime } = await import(pathToFileURL(resolve(root, 'scripts/controlled-audio.mjs')).href);
const { decodeFieldOp } = await load('compiler/field');
const { createWebFieldMessageSequencePort } = await load('core/source-message-sequence');
const { createWebFlatConditionLeaderActivityPort } = await load('core/field-condition-activity');
const runtime = () => ({ ...controlledAudioRuntime(), sourceMessageSequence: createWebFieldMessageSequencePort(),
  conditionLeaderActivity: createWebFlatConditionLeaderActivityPort() });
const cohortHelperBytes=await readFile(new URL('./visibility-cohort.mjs',import.meta.url));
const beforeRuntime = await runtimeDigest(root, compiled), ownBytes = await readFile(new URL(import.meta.url));
const snapshots = await Promise.all(['corpus', 'field', 'world-media'].map(async name => {
  const path = resolve(root, 'build', name, 'snapshot.json'), bytes = await readFile(path);
  await readSnapshot(resolve(root, 'build', name)); return { name, path, sha256: sha(bytes), manifest: JSON.parse(bytes) };
}));
const inputs = new Map(), host = { visible: true, mediaReady: true, overlayOpen: false };
const report = { kind: 'source-visibility-whole-program-lifecycle-v1', result: 'running',
  sourceStoryReachability: false, sourceCampaignComplete: false, nativeParity: false, browserVerified: false,
  runtimeSha256: beforeRuntime, checkerSha256: sha(ownBytes), cohortProducerSha256:sha(cohortHelperBytes), cohortSha256: null,
  sourceSnapshots:snapshots.map(({name,sha256,manifest})=>({name,sha256,manifest})),
  npcHostPolicy:{kind:'framework-npc-area-v1',origin:'existing versioned pure initialized map recipe v4/v5',nativeParity:false},
  conditionActivityHostPolicy:{kind:'web-flat-condition-leader-activity-v1',origin:'same createWebFlatConditionLeaderActivityPort as apps/game/app.js',nativeParity:false},
  hostPolicy:{kind:'web-field-message-sequence-v1',origin:'same createWebFieldMessageSequencePort as apps/game/app.js',nativeParity:false},
  controlled: ['declared source PointIn relocation', 'actual source NewGamePlan', 'headless audio/media readiness', 'public startEvent retaining full original Main body'],
  limitations: ['No plot flags or live actor properties are injected; research roster joins use existing source-owned transactions and are reported separately.', 'Original story applicability, unchosen branches and original-game parity remain unassessed.'], maps: [], cases: [], inventory: [] };
async function sourceRead(url) {
  assert.match(url, /^\/content-packages\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/);
  const file = resolve(root, 'build', '.' + url), bytes = await readFile(file), digest = sha(bytes);
  if (inputs.has(url)) assert.equal(inputs.get(url).sha256, digest, 'Published input changed');
  else inputs.set(url, { url, sha256: digest, bytes: bytes.length });
  return JSON.parse(bytes.toString());
}
let sourceRefs = await sourceRead('/content-packages/source.json');
const sourceRepository = new GameContentRepository(sourceRead, 'source', sourceRefs), bundle = await sourceRepository.sourceNewGame();
let sourceWorld = await sourceRepository.world(); const corpus = await loadCorpus(root);
assert.equal(sourceWorld.sourceSetHash, corpus.sourceSetHash);
const originalSourceFiles=[],sourceRoot=resolve(root,'build/runtime/game');
async function verifyOriginals(first){
 const seen=new Set();for(const row of corpus.manifest.sources){
  assert.ok(typeof row.file==='string'&&!row.file.includes('\\')&&!row.file.split('/').includes('..'));
  assert.ok(!seen.has(row.file));seen.add(row.file);const path=resolve(sourceRoot,row.file);assert.ok(path.startsWith(sourceRoot+sep));
  const digest=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){digest.update(chunk);bytes+=chunk.length;}
  const actual=digest.digest('hex');assert.equal(actual,row.sha256,'Original source changed: '+row.file);assert.equal(bytes,row.bytes);
  if(first)originalSourceFiles.push({file:row.file,sha256:actual,bytes});
 }
}
await verifyOriginals(true);
const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources),
  messages = { ...corpus.messages, system_zhc: system.messages },
  analysis = analyzeCorpus(corpus.assets, corpus.tables, messages, corpus.sourceSetHash),
  cohort = collectVisibilityCohort({corpus,analysis,messages,decodeFieldOp,hash}),
  cohortBytes = Buffer.from(JSON.stringify(cohort,null,2)+'\n'), evidencePath = resolve(out, 'source-cohort.json');
assert.equal(cohort.sourceSetHash, corpus.sourceSetHash);
await writeFile(evidencePath, cohortBytes); report.cohortSha256 = sha(cohortBytes);
const programsById = new Map(analysis.scripts.map(row => [row.id, row]));
const selected = cohort.onlyFamily;
const physicalIds = [...new Set(selected.flatMap(row => row.closure))];
report.cohort = { selectedRootMapUses: selected.length, physicalPrograms: physicalIds.length,
 instructions: physicalIds.reduce((sum, id) => sum + corpus.assets.find(row => row.id === id).data.Mnemonics.length, 0),
 fullCohortHash: sha(cohortBytes), selected, allAffectedRoots: cohort.roots, sites: cohort.sites };
report.decoderInputs = { sourceSetHash: corpus.sourceSetHash, systemMessagesSource: system.source, analysisHash: analysis.contentHash };
const roots = selected, mapIds = [...new Set(selected.map(row => Number(row.mapId)))].sort((a,b)=>a-b);
assert.ok(roots.length && mapIds.length, 'No complete visibility source-program closure');
const byId = new Map(corpus.assets.filter(asset => asset.kind === 'script').map(asset => [asset.id, asset]));
let sourceMaps = new Map(await Promise.all(mapIds.map(async id => [id, await sourceRepository.map(id, sourceWorld)])));
let candidateSourceRead = sourceRead;
if (sourceCache) {
  assert.equal(sourceCompiler, null, 'Choose a fresh compiler or its exact cached candidate');
  const cache = resolve(root, sourceCache), receiptBytes = await readFile(resolve(cache, 'receipt.json')),
    receipt = JSON.parse(receiptBytes), refsBytes = await readFile(resolve(cache, 'source.json')), cached = new Map();
  assert.equal(receipt.published, false); assert.equal(receipt.compiledFromFullSourceInputs, true);
  assert.equal(receipt.publicRuntimeSha256, beforeRuntime, 'Cached candidate belongs to another public runtime');
  assert.equal(await runtimeDigest(root, receipt.directory), receipt.compilerRuntimeSha256, 'Cached source compiler changed');
  assert.equal(sha(refsBytes), receipt.refsSha256); assert.deepEqual(JSON.parse(refsBytes), receipt.refs);
  for (const object of receipt.objects) {
    assert.match(object.url, /^\/content-packages\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/);
    const bytes = await readFile(resolve(cache, object.url.slice('/content-packages/'.length)));
    assert.equal(bytes.length, object.bytes); assert.equal(sha(bytes), object.sha256);
    const value = JSON.parse(bytes); assert.equal(value.contentHash, object.contentHash); assert.equal(cached.has(object.url), false);
    cached.set(object.url, value);
  }
  candidateSourceRead = async url => { assert.ok(cached.has(url)); return structuredClone(cached.get(url)); };
  sourceRefs = receipt.refs; const repository = new GameContentRepository(candidateSourceRead, 'source', sourceRefs);
  await repository.sourceNewGame(); sourceWorld = await repository.world();
  sourceMaps = new Map(await Promise.all(mapIds.map(async id => [id, await repository.map(id, sourceWorld)])));
  report.privateSourceCompiler = { ...receipt, objects: undefined, cachedCandidateSha256: sha(receiptBytes) };
}
if (sourceCompiler) {
  const loadCompiler = name => import(pathToFileURL(resolve(root, sourceCompiler, 'src/compiler', name + '.js')).href);
  const [{ compileWorld }, { compileSourceNewGame }] = await Promise.all(['world', 'source-new-game'].map(loadCompiler));
  const compilerBefore = await runtimeDigest(root, sourceCompiler), fresh = await compileWorld(root);
  const entry = await compileSourceNewGame(root, bundle.battle, fresh);
  const { linkSourcePrerequisites } = await import(pathToFileURL(resolve(root, 'scripts/link-source-prerequisites.mjs')).href);
  const payloads = new Map([['/world/catalog.json', fresh.catalog], ['/game/source-new-game.json', entry]]);
  for (const map of fresh.maps) payloads.set('/world/maps/' + map.mapId + '.json', map);
  const linked = await linkSourcePrerequisites({ root, compiledDir: compiled, payloads });
  const catalog = linked.inputs.get('/world/catalog.json'), currentEntry = linked.inputs.get('/game/source-new-game.json');
  const privateSource = new Map(linked.payloads);
  privateSource.set('/content-packages/source/world.json', catalog); privateSource.set('/content-packages/source/entry.json', currentEntry);
  privateSource.set('/content-packages/source/battle.json', bundle.battle);
  sourceRefs = { kind: 'game-content-refs-v1', profile: 'source', development: null,
    world: { url: '/content-packages/source/world.json', contentHash: catalog.contentHash }, source: {
      entry: { url: '/content-packages/source/entry.json', contentHash: currentEntry.contentHash },
      battle: { url: '/content-packages/source/battle.json', contentHash: bundle.battle.contentHash } } };
  candidateSourceRead = async url => { assert.ok(privateSource.has(url), 'Unbound fresh source object: ' + url); return structuredClone(privateSource.get(url)); };
  const freshRepository = new GameContentRepository(candidateSourceRead, 'source', sourceRefs);
  await freshRepository.sourceNewGame(); sourceWorld = await freshRepository.world();
  sourceMaps = new Map(await Promise.all(mapIds.map(async id => [id, await freshRepository.map(id, sourceWorld)])));
  assert.equal(await runtimeDigest(root, sourceCompiler), compilerBefore, 'Private source compiler changed during compilation');
  report.privateSourceCompiler = { directory: sourceCompiler, compilerRuntimeSha256: compilerBefore,
    publicRuntimeSha256: beforeRuntime, sourceSetHash: fresh.catalog.sourceSetHash, mapsRetained: fresh.maps.length,
    sourceWorldHash: sourceWorld.contentHash, sourceEntryHash: currentEntry.contentHash, published: false,
    compiledFromFullSourceInputs: true, sourceProgramsRewrittenByChecker: false };
  // Reuse exact candidate JSON on later lifecycle probes without recompiling
  // the world or mutating the public collection. This is not a published pack.
  const cache = resolve(out, 'candidate-source'); await mkdir(cache, { recursive: true });
  const objects = [];
  for (const [url, value] of privateSource) {
    const bytes = Buffer.from(canonical(value) + '\n'), file = resolve(cache, url.slice('/content-packages/'.length));
    await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, bytes);
    objects.push({ url, contentHash: value.contentHash, sha256: sha(bytes), bytes: bytes.length });
  }
  await writeFile(resolve(cache, 'source.json'), JSON.stringify(sourceRefs) + '\n');
  await writeFile(resolve(cache, 'receipt.json'), JSON.stringify({ ...report.privateSourceCompiler, objects,
    refs: sourceRefs, refsSha256: sha(Buffer.from(JSON.stringify(sourceRefs) + '\n')) }, null, 2) + '\n');
}
function nameFor(id,mapId){
 const source=byId.get(id).source;
 const matches=Object.entries(sourceMaps.get(mapId).scripts).filter(([name,ops])=>
  ops[0]?.source.file===source.file && ops[0]?.source.assetPath===source.assetPath && ops[0]?.source.objectId===source.objectId);
 assert.equal(matches.length,1,'Physical source must resolve to one retained map namespace');return matches[0][0];
}
for (const id of physicalIds) {
  const asset = byId.get(id); assert.ok(asset);
  const uses = selected.filter(row => row.closure.includes(id));
  const maps = [...new Set(uses.map(row => Number(row.mapId)))];
  for (const mapId of maps) {
    const ops = sourceMaps.get(mapId).scripts[nameFor(id,mapId)]; assert.equal(ops.length, asset.data.Mnemonics.length);
    for (const [index, op] of ops.entries()) { assert.equal(op.index,index); assert.equal(op.source.objectId,asset.source.objectId);
      assert.equal(op.source.file,asset.source.file); assert.equal(op.source.assetPath,asset.source.assetPath); }
  }
  report.inventory.push({ id, maps, rawHash:hash(asset.data), raw:asset.data, source:asset.source,
    dependencies:analysis.dependencies.filter(row=>row.site.asset===id),
    decoded:maps.map(mapId=>({mapId, ops:sourceMaps.get(mapId).scripts[nameFor(id,mapId)]})) });
}
const serviceMapIds = mapIds.filter(id => Object.values(sourceMaps.get(id).map.groups ?? {})
  .some(group => group.entities.some(entity => entity.kind === 16)));
function recipe(startMap) {
  const map = sourceMaps.get(startMap), entrance = map.partyEntry?.pointIns[0]?.id; assert.ok(entrance !== undefined);
  const service = serviceMapIds.includes(startMap);
  return { kind: service ? 'initialized-source-map-recipe-v5' : 'initialized-source-map-recipe-v4', id: 'visibility-lifecycle-' + startMap,
    sourceEntry: sourceRefs.source.entry, sourceBattle: sourceRefs.source.battle, sourceWorld: sourceRefs.world,
    startMap, entrance, presentation: 'framework-ordinary-field-flat-v1',
    battleCatalogSelection: 'source-baseline-v1', sourceAreaScope: null, walking: null,
    npcActivity: { kind: 'framework-npc-area-template-v1', policy: 'framework-npc-area-v1', missingFirstInterval: 'source-ctor-true',
      random: 'web-xorshift32-v1', collision: 'actor-grid-reservations-v1', schedule: 'fixed-step-source-order-v1',
      takeover: 'pause-autonomous-motion-v1', reason: 'Reuse the existing declared Web source-NPC host uniformly, retaining all native gaps and original story applicability.' },
    ...(service ? { fieldServices: { kind: 'framework-field-services-declaration-v1', relayInteraction: 'framework-relay-interaction-v1',
      passiveEffects: 'framework-passive-field-effects-v1', mapIds: serviceMapIds } } : {}),
    manifest: { kind: 'content-batch-manifest-v1', id: 'visibility-source-programs-' + startMap, profile: 'framework', mapIds,
      roots: [{ kind: 'entry', mapId: startMap, entrance, continuation: map.initializer },
        ...roots.map(program => ({ kind: 'script', mapId: Number(program.mapId), script: nameFor(program.id,Number(program.mapId)) }))],
      routes: [{ id: 'visibility-main-' + startMap, entry: 'framework-new-game', expectedMapId: startMap,
        requiredMapIds: mapIds, requiredEncounterIds: [], maxTicks: 10000, inputs: [], choiceAnswers: [], battleAbilityIds: [] }] } };
}
const candidates = new Map();
for (const id of mapIds) {
  const declaration = recipe(id); await writeFile(resolve(out, 'recipe-' + id + '.json'), JSON.stringify(declaration, null, 2) + '\n');
  try {
    const candidate = await compileInitializedContentBatch(root, declaration, hash(declaration), { dist: compiled, readJson: candidateSourceRead });
    const privateRead = async url => candidate.payloads.has(url) ? structuredClone(candidate.payloads.get(url)) : candidateSourceRead(url);
    const repository = new GameContentRepository(privateRead, 'framework', candidate.refs), contents = await repository.initializedNewGame();
    candidates.set(id, { candidate, repository, contents });
    report.maps.push({ mapId: id, status: 'candidate-prepared', sourceMapHash: sourceMaps.get(id).contentHash,
      candidateMapHash: contents.map.contentHash, buildReport: candidate.report, diagnostics: candidate.plan.diagnostics });
  } catch (error) { report.maps.push({ mapId: id, status: 'unready', reason: String(error.stack ?? error) }); }
}
const view = game => ({ fieldHash:game.field.content.contentHash, ownedHash:hash(game.state.snapshot()),
 mapId:game.field.content.map.identity?.mapId, stop:game.field.stop, busy:game.field.busy, visibilityBusy:game.field.actorVisibilityBusy,
 visibility:game.field.actorVisibilityExecutions, sourceMessage:game.field.sourceMessage.projection, owned:game.state.snapshot(), eventBanks:game.field.eventState.snapshot() });
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
function drain(flow,game,until,trace) {
 for(let ticks=0;ticks<6000;ticks++){
  if(game.field.stop)throw new Error('Source VM stopped: '+canonical(game.field.stop));
  if(until())return;
  if(game.field.dialogue || game.field.sourceMessage.projection?.acceptsInput){trace.push({kind:'source-message-confirm',key:game.field.dialogue?.key??game.field.sourceMessage.projection.key,phase:game.field.sourceMessage.projection?.phase??'ordinary'});flow.confirm();}
  if(game.field.choice)throw new Error('Source choice input is not declared: '+canonical(game.field.choice));
  flow.advance(10,host);
 }
 throw new Error('Whole source program exceeded bounded clock budget');
}
function nameRefs(value,ids=new Set()){
 if(Array.isArray(value))for(const v of value)nameRefs(v,ids);
 else if(value && typeof value==='object'){
  if(value.kind==='character-name' && Number.isInteger(value.ref?.sourceId))ids.add(value.ref.sourceId);
  for(const v of Object.values(value))nameRefs(v,ids);
 }
 return [...ids].sort((a,b)=>a-b);
}
for(const program of roots)for(const rosterVariant of [false,...(nameRefs(sourceMaps.get(Number(program.mapId)).scripts[nameFor(program.id,Number(program.mapId))]).length?[true]:[])]){
 const mapId=Number(program.mapId),name=nameFor(program.id,mapId),prepared=candidates.get(mapId);
 const row={programId:program.id,mapId,name,controlledRoster:rosterVariant,status:'unready',trace:[]};report.cases.push(row);
 if(!prepared){row.reason='Source map candidate preparation failed';continue;}
 let game;
 try{
  const flow=new GameFlow(),entry=new GameEntryLoader(flow,{discard(){}});
  const launched=await entry.begin('new-game').prepare(async()=>({session:await GameSession.prepareFrameworkNewGame(
   prepared.contents.content,prepared.contents.catalog,prepared.contents.map,prepared.contents.battle,runtime(),314),presentation:null}));
  assert.equal(launched.status,'committed',String(launched.error));game=launched.session;
  const commands=new GameCommands(flow,game);flow.advance(0,host);drain(flow,game,()=>game.checkpointReady,row.trace);
  if(rosterVariant){
   const ids=nameRefs(game.field.content.scripts[name]);
   for(const sourceId of ids)if(!game.state.snapshot().roster.some(member=>member.sourceId===sourceId)){
    const command={kind:'join',sourceId,position:null,row:'front',refreshActors:false,recovery:false,refitEquipment:false};
    game.state.fieldRoster.prepare(command).commit();row.trace.push({kind:'controlled-source-owned-roster-join',command});
   }
   row.controlledRosterSourceIds=ids;
  }
  row.before=view(game);const sourceBytes=canonical(game.field.content.scripts[name]);
  row.declaredVisibilitySites=game.field.content.scripts[name].filter(op=>['actor-visibility','mob-visibility'].includes(op.kind)).map(op=>({index:op.index,kind:op.kind,timing:op.timing??null}));
  row.declaredFlagWriteSites=game.field.content.scripts[name].filter(op=>op.kind==='flag').length;row.actualFlagInstructionExecutions='unassessed';
  const original={field:game.field,state:game.state,world:game.world};assert.equal(game.field.startEvent(name),true);
  drain(flow,game,()=>game.checkpointReady,row.trace);
  assert.equal(game.field,original.field);assert.equal(game.state,original.state);assert.equal(game.world,original.world);
  assert.equal(canonical(game.field.content.scripts[name]),sourceBytes);
  row.after=view(game);row.actualVisibilityTransactions=game.field.actorVisibilityExecutions.filter(op=>op.site.script===name);
  const values=new Map();let fail=true;const storage=new CheckpointStorage({getItem:key=>values.get(key)??null,
   setItem(key,value){if(fail)throw new Error('Controlled quota failure');values.set(key,value);}},'framework');
  const checkpoint=game.checkpoint();await assert.rejects(storage.save(checkpoint,1),/quota/);assert.equal(values.size,0);
  assert.deepEqual(game.checkpoint(),checkpoint);fail=false;await storage.save(checkpoint,2);const loaded=await storage.load();assert.deepEqual(loaded.checkpoint,checkpoint);
  const restored=await prepared.repository.restoreSessionContent(loaded.checkpoint),next=GameSession.restore(loaded.checkpoint,restored.initial,restored.battle,restored.world,runtime());
  const oldCommands=commands,ticket=flow.beginOperation('load');assert.equal(ticket.publish(next),true);game=next;flow.advance(0,host);
  row.restoreNpcRebindings=assertRestoredCheckpoint(checkpoint,game.checkpoint());assert.equal(game.field.actorVisibilityExecutions.length,0);
  assert.equal(oldCommands.closeShop('stale-visibility-owner'),false);const restoredOwned=canonical(game.state.snapshot()),restoredBanks=canonical(game.field.eventState.snapshot());flow.advance(100,host);
  assert.equal(canonical(game.state.snapshot()),restoredOwned);assert.equal(canonical(game.field.eventState.snapshot()),restoredBanks);assert.equal(game.field.actorVisibilityExecutions.length,0);row.restored=view(game);row.status='controlled-whole-main-lifecycle-passed';
 }catch(error){row.reason=String(error.stack??error);if(game){row.atFailure=view(game);row.actualVisibilityTransactions=game.field.actorVisibilityExecutions.filter(op=>op.site.script===name);}}
}
for(const input of inputs.values())assert.equal(sha(await readFile(resolve(root,'build','.'+input.url))),input.sha256);
for(const snapshot of snapshots){assert.equal(sha(await readFile(snapshot.path)),snapshot.sha256);await readSnapshot(resolve(root,'build',snapshot.name));}
if(report.privateSourceCompiler)assert.equal(await runtimeDigest(root,report.privateSourceCompiler.directory),report.privateSourceCompiler.compilerRuntimeSha256);
assert.equal(await runtimeDigest(root,compiled),beforeRuntime,'Runtime changed during WIP acceptance');
await verifyOriginals(false);report.originalSourceFiles=originalSourceFiles;report.originalSourceFilesHash=hash(originalSourceFiles);
assert.equal(sha(await readFile(new URL('./visibility-cohort.mjs',import.meta.url))),report.cohortProducerSha256);
assert.equal(sha(await readFile(new URL(import.meta.url))),report.checkerSha256);assert.equal(sha(await readFile(evidencePath)),report.cohortSha256);
report.inputs=[...inputs.values()];report.counts={completeSourcePrograms:physicalIds.length,rootMapUses:roots.length,sourceMaps:mapIds.length,
 retainedInstructions:report.cohort.instructions,cases:report.cases.length,passed:report.cases.filter(row=>row.status.endsWith('-passed')).length,
 unready:report.cases.filter(row=>row.status==='unready').length,
 baselineCases:report.cases.filter(row=>!row.controlledRoster).length,controlledRosterCases:report.cases.filter(row=>row.controlledRoster).length,
 actualTimedVisibilityApplied:report.cases.reduce((sum,row)=>sum+(row.actualVisibilityTransactions??[]).filter(op=>op.phase==='applied'&&(op.durationSeconds!==0||op.delaySeconds!==0)).length,0),
 actualVisibilityApplied:report.cases.reduce((sum,row)=>sum+(row.actualVisibilityTransactions??[]).filter(op=>op.phase==='applied').length,0)};
report.result=report.counts.unready?'unready-gaps-retained':'controlled-whole-main-lifecycles-passed';
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,output,
 cases:report.cases.map(({mapId,name,status,reason})=>({mapId,name,status,reason:reason?.split('\n')[0]}))}));
