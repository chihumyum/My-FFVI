import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';
// Complete named-shop source-program lifecycle. All candidates are private;
// no source rewrites, story-state defaults, publication, or second VM/owner.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { collectNamedShopCohort } from './named-shop-cohort.mjs';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
let compiled = 'dist', sourceCompiler = null, sourceCache = null, output = null;
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--compiled', '--source-compiler', '--source-cache', '--output'].includes(process.argv[i])); assert.ok(process.argv[i + 1]);
  if (process.argv[i] === '--compiled') compiled = process.argv[i + 1];
  else if (process.argv[i] === '--source-compiler') sourceCompiler = process.argv[i + 1];
  else if (process.argv[i] === '--output') output = resolve(root, process.argv[i + 1]); else sourceCache = process.argv[i + 1];
}
output ??= resolve(root, 'build/reports/named-shops-lifecycle/lifecycle-report.json');
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
const beforeRuntime = await runtimeDigest(root, compiled), ownBytes = await readFile(new URL(import.meta.url));
const { checkNamedShopBindings } = await import(pathToFileURL(resolve(root, 'scripts/named-shop-bindings.mjs')).href);
const nativePath = resolve(out, 'binding-check.json'), bindingReport = await checkNamedShopBindings({ root, compiledDir: compiled, output: nativePath }),
  nativeBytes = await readFile(nativePath), native = bindingReport.nativeEvidence, nativeInputs = [];
for (const [name, path] of Object.entries(native.sourceFiles)) nativeInputs.push({ path, sha256: native.identity[name] });
for (const proof of native.sharedCommonReceipt.methods) nativeInputs.push({ path: proof.decompiledPath, sha256: proof.method.decompiledSha256 });
nativeInputs.push({ path: native.sharedCommonReceipt.path, sha256: native.sharedCommonReceipt.sha256 });
const snapshots = await Promise.all(['corpus', 'field'].map(async name => {
  const path = resolve(root, 'build', name, 'snapshot.json'), bytes = await readFile(path);
  await readSnapshot(resolve(root, 'build', name)); return { name, path, sha256: sha(bytes), manifest: JSON.parse(bytes) };
}));
const inputs = new Map(), host = { visible: true, mediaReady: true, overlayOpen: false };
const report = { kind: 'named-shop-full-source-program-lifecycle-v1', result: 'running',
  sourceStoryReachability: false, sourceCampaignComplete: false, nativeParity: false, browserVerified: false,
  runtimeSha256: beforeRuntime, checkerSha256: sha(ownBytes), cohortSha256: null,
  nativeMappingEvidence: { path: relative(root, nativePath), sha256: sha(nativeBytes), inputs: nativeInputs,
    bindings: native.bindings.map(({ selector, groupId, phase, methodRva, registrationRva }) => ({ selector, groupId, phase, methodRva, registrationRva })),
    scope: 'Exact selector registrations/wrapper arguments; native shop presentation/execution parity is not claimed.' },
  sourceSnapshots: snapshots.map(({ name, sha256, manifest }) => ({ name, sha256, manifest })),
  controlled: ['authored source PointIn relocation', 'source NewGamePlan initialization', 'headless audio/media readiness',
    'public startEvent on exact retained source program', 'optional exact source-owned character join via existing roster/party APIs'],
  limitations: ['Original story applicability of Figaro/Mobliz maps is unknown.',
    'Whole source programs/unchosen branches remain inventoried; the original Main entry alone is exercised.',
    'Plot flags are never filled or changed by this checker; later-world price branches remain unassessed without trusted input states.',
    'Mobliz currently has no maintained knowledge region/dossier. Static source identities do not close that gap.'],
  maps: [], cases: [], inventory: [] };
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
assert.equal(bindingReport.sourceSetHash, corpus.sourceSetHash); assert.equal(sourceWorld.sourceSetHash, corpus.sourceSetHash);
const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources),
  messages = { ...corpus.messages, system_zhc: system.messages },
  analysis = analyzeCorpus(corpus.assets, corpus.tables, messages, corpus.sourceSetHash),
  cohort = collectNamedShopCohort({ corpus, analysis, mapBindings: bindMapPackages(corpus.assets, corpus.tables),
    nativeBindings: native.bindings, resolveMapScript, hash }),
  evidencePath = resolve(out, 'source-cohort.json'), evidenceBytes = Buffer.from(JSON.stringify(cohort, null, 2) + '\n');
await writeFile(evidencePath, evidenceBytes); report.cohortSha256 = sha(evidenceBytes); report.cohort = cohort;
report.decoderInputs = { sourceSetHash: corpus.sourceSetHash, systemMessagesSource: system.source, analysisHash: analysis.contentHash };
const roots = cohort.programs.filter(program => program.root),
  mapIds = [...new Set(cohort.programs.flatMap(program => program.maps.map(Number)))].sort((a, b) => a - b);
assert.ok(roots.length && mapIds.length, 'No complete named-shop source-program closure');
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
for (const program of cohort.programs) {
  const asset = byId.get(program.id); assert.ok(asset); assert.equal(hash(asset.data), program.rawHash);
  const name = asset.data.Name, maps = program.maps.map(Number);
  for (const id of maps) {
    const map = sourceMaps.get(id); assert.ok(map.scripts[name]); assert.equal(map.scripts[name].length, program.instructions);
    for (const [pc, op] of map.scripts[name].entries()) {
      assert.equal(op.index, pc); assert.equal(op.source.objectId, asset.source.objectId);
      assert.equal(op.source.assetPath, asset.source.assetPath); assert.equal(op.source.file, asset.source.file);
    }
  }
  report.inventory.push({ ...program, name, raw: asset.data,
    consumedSourceDecodeDiagnostics: maps.flatMap(id => sourceMaps.get(id).scripts[name].filter(op => op.kind === 'blocked')) });
}
report.excludedPrograms = [];
for (const program of cohort.excludedPrograms) {
  const typed = [];
  for (const id of program.maps.map(Number)) {
    const repository = new GameContentRepository(candidateSourceRead, 'source', sourceRefs), map = await repository.map(id, sourceWorld);
    assert.ok(map.scripts[program.name]); typed.push({ mapId: id, completeTypedProgram: map.scripts[program.name],
      diagnostics: map.scripts[program.name].filter(op => op.kind === 'blocked') });
  }
  report.excludedPrograms.push({ ...program, typed, status: 'blocked-not-in-closed-cohort', sourceStoryReachability: false });
}
const serviceMapIds = mapIds.filter(id => Object.values(sourceMaps.get(id).map.groups ?? {})
  .some(group => group.entities.some(entity => entity.kind === 16)));
function recipe(startMap) {
  const map = sourceMaps.get(startMap), entrance = map.partyEntry?.pointIns[0]?.id; assert.ok(entrance !== undefined);
  const service = serviceMapIds.includes(startMap);
  return { kind: service ? 'initialized-source-map-recipe-v5' : 'initialized-source-map-recipe-v1', id: 'named-shops-lifecycle-' + startMap,
    sourceEntry: sourceRefs.source.entry, sourceBattle: sourceRefs.source.battle, sourceWorld: sourceRefs.world,
    startMap, entrance, presentation: 'framework-ordinary-field-flat-v1',
    ...(service ? { battleCatalogSelection: 'source-baseline-v1', sourceAreaScope: null, walking: null,
      npcActivity: { kind: 'framework-npc-area-template-v1', policy: 'framework-npc-area-v1', missingFirstInterval: 'source-ctor-true',
        random: 'web-xorshift32-v1', collision: 'actor-grid-reservations-v1', schedule: 'fixed-step-source-order-v1',
        takeover: 'pause-autonomous-motion-v1', reason: 'Reuse the declared Web source-NPC host; preserve all source diagnostics and unknown applicability.' },
      fieldServices: { kind: 'framework-field-services-declaration-v1', relayInteraction: 'framework-relay-interaction-v1',
        passiveEffects: 'framework-passive-field-effects-v1', mapIds: serviceMapIds } } : {}),
    manifest: { kind: 'content-batch-manifest-v1', id: 'named-shops-source-programs-' + startMap, profile: 'framework', mapIds,
      roots: [{ kind: 'entry', mapId: startMap, entrance, continuation: map.initializer },
        ...roots.map(program => ({ kind: 'script', mapId: Number(program.maps[0]), script: byId.get(program.id).data.Name }))],
      routes: [{ id: 'named-shop-main-' + startMap, entry: 'framework-new-game', expectedMapId: startMap,
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
const stateView = game => ({ mapId: game.field.content.map.identity?.mapId, fieldHash: game.field.content.contentHash,
  phase: game.field.stop ?? (game.field.dialogue ? { kind: 'dialogue', key: game.field.dialogue.key } : game.field.currentShop ?? { kind: game.field.busy ? 'event' : 'idle' }),
  gil: game.state.snapshot().gil, ownedHash: hash(game.state.snapshot()), party: game.state.snapshot().party,
  names: game.state.snapshot().characterNames });
function flags(game, ops) {
  const refs = ops.flatMap(op => op.kind === 'flag' ? [op.ref] :
    ['branch', 'calc'].includes(op.kind) ? [op.left, ...(op.right.kind === 'variable' ? [op.right.ref] : [])] : []);
  return [...new Map(refs.map(ref => [canonical(ref), ref])).values()]
    .map(ref => ({ ref, value: game.field.eventState.read(ref) }));
}
function observedEventBankDeltas(before, after) {
  const changes = [];
  for (const bank of ['scenario', 'treasure', 'global', 'area', 'map', 'script']) {
    const a = before[bank], b = after[bank];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      if (canonical(a) !== canonical(b)) changes.push({ bank, before: a, after: b });
    } else for (let index = 0; index < a.length; index++) if (a[index] !== b[index])
      changes.push({ bank, index, before: a[index], after: b[index] });
  }
  for (const register of ['scriptLabels', 'selected', 'itemSelected', 'currentMapId'])
    if (canonical(before[register]) !== canonical(after[register]))
      changes.push({ register, before: before[register], after: after[register] });
  return { beforeHash: hash(before), afterHash: hash(after), changes,
    actualFlagInstructionExecutions: 'unassessed', scope: 'Observed net state only; no VM instruction trace.' };
}
function drain(flow, game, until, trace) {
  for (let ticks = 0; ticks < 4000; ticks++) {
    if (game.field.stop) throw new Error('Source VM stopped: ' + canonical(game.field.stop));
    if (until()) return;
    if (game.field.dialogue) { trace.push({ kind: 'confirm-source-dialogue', key: game.field.dialogue.key }); flow.confirm(); }
    if (game.field.choice) throw new Error('Source choice input is not declared: ' + canonical(game.field.choice));
    flow.advance(10, host);
  }
  throw new Error('Source program exceeded its bounded clock budget');
}
function leaderVariants(program) {
  const raw = byId.get(program.id).data.Mnemonics;
  return raw[1]?.mnemonic === 'BranchByCharacter' && raw[1].operands.iValues[0] === 5 &&
    raw[2]?.mnemonic === 'BranchByCharacter' && raw[2].operands.iValues[0] === 6 ? [null, 5, 6] : [null];
}
for (const program of roots) for (const executionMap of program.maps) for (const ownedSourceId of leaderVariants(program)) {
  const mapId = Number(executionMap), name = byId.get(program.id).data.Name, prepared = candidates.get(mapId);
  const row = { programId: program.id, mapId, name, controlledPartySourceId: ownedSourceId, status: 'unready', trace: [] };
  report.cases.push(row); if (!prepared) { row.reason = 'Source map candidate preparation failed'; continue; }
  let game;
  try {
    const flow = new GameFlow(), entry = new GameEntryLoader(flow, { discard() {} });
    const launched = await entry.begin('new-game').prepare(async () => ({ session: await GameSession.prepareFrameworkNewGame(
      prepared.contents.content, prepared.contents.catalog, prepared.contents.map, prepared.contents.battle, { ...controlledAudioRuntime(), ...sourceWebReplayRuntimePorts() }, 314), presentation: null }));
    assert.equal(launched.status, 'committed', String(launched.error)); game = launched.session;
    let commands = new GameCommands(flow, game); flow.advance(0, host);
    drain(flow, game, () => game.checkpointReady, row.trace);
    if (ownedSourceId !== null) {
      const command = { kind: 'join', sourceId: ownedSourceId, position: null, row: 'front', refreshActors: false,
        recovery: false, refitEquipment: false };
      game.state.fieldRoster.prepare(command).commit();
      const member = game.state.snapshot().roster.find(member => member.sourceId === ownedSourceId); assert.ok(member);
      flow.pause(true); flow.advance(0, host);
      const slot = game.state.snapshot().party.slots[game.state.snapshot().party.selectedSlot], position = slot.findIndex(cell => cell.id === member.id);
      assert.ok(position >= 0);
      assert.equal(commands.menu({ kind: 'change-party', change: { kind: 'swap', from: position, to: 0 } }), true);
      flow.pause(false); flow.advance(0, host); row.trace.push({ kind: 'controlled-source-owned-join-and-menu-input', command, ownedId: member.id });
    }
    const original = { owned: game.state, field: game.field, world: game.world }, sourceOps = game.field.content.scripts[name];
    const namespaceOps = cohort.programs.filter(program => program.maps.includes(String(mapId)))
      .flatMap(program => game.field.content.scripts[byId.get(program.id).data.Name]);
    assert.ok(sourceOps); const programBytes = canonical(sourceOps), initialFlags = flags(game, namespaceOps);
    row.before = stateView(game); row.flagsBefore = initialFlags; row.eventBanksBefore = game.field.eventState.snapshot();
    assert.equal(game.field.startEvent(name), true);
    drain(flow, game, () => game.field.currentShop !== null, row.trace);
    const visit = game.field.currentShop; row.visit = visit; const options = game.shopOptions();
    // These expectations come from the original Main branch structure and the
    // native selector registration/wrapper mapping, never the observed shop.
    if (leaderVariants(program).length === 3) {
      assert.equal(game.field.eventState.read({ category: 'ScenarioFlag1', index: 138 }), 0);
      assert.equal(game.field.eventState.read({ category: 'ScenarioFlag2', index: 41 }), 0);
      const expectedIndex = ownedSourceId === null ? 5 : ownedSourceId === 5 ? 33 : 62;
      const rawShop = byId.get(program.id).data.Mnemonics[expectedIndex]; assert.equal(rawShop.mnemonic, 'SysCall');
      const selector = rawShop.operands.sValues[0], binding = native.bindings.find(binding => binding.selector === selector); assert.ok(binding);
      row.expectedShop = { sourceIndex: expectedIndex, selector, groupId: binding.groupId,
        origin: 'original retained Main branch + native selector wrapper argument', controlledStoryFlags: 'actual-source-new-game-zero' };
      assert.equal(sourceOps[expectedIndex].kind, 'field-script-shop'); assert.equal(sourceOps[expectedIndex].groupId, binding.groupId);
      assert.equal(visit.groupId, binding.groupId); assert.equal(options.groupId, binding.groupId);
    } else {
      const sites = sourceOps.filter(op => op.kind === 'field-script-shop'); assert.equal(sites.length, 1, 'Source shop route expectation is unassessed');
      const binding = native.bindings.find(binding => binding.selector === sites[0].selector); assert.ok(binding);
      row.expectedShop = { sourceIndex: sites[0].index, selector: binding.selector, groupId: binding.groupId, origin: 'single retained source shop call + native wrapper argument' };
      assert.equal(visit.groupId, binding.groupId); assert.equal(options.groupId, binding.groupId);
    }
    assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint()); assert.equal(flow.move('up'), false);
    const ownedBefore = canonical(game.state.snapshot());
    const absent = prepared.contents.battle.gameState.shops.contents.find(content => content.sellable && !options.sell.some(option => option.contentId === content.id));
    if (absent) {
      assert.throws(() => commands.tradeShop({ kind: 'sell', contentId: absent.id, count: 1 }));
      assert.equal(canonical(game.state.snapshot()), ownedBefore); row.trace.push({ kind: 'no-owned-stock-trade-refused', contentId: absent.id });
    }
    const tooExpensive = options.buy.find(option => Math.floor(game.state.snapshot().gil / option.unitPrice) + 1 <=
      prepared.contents.battle.gameState.shops.itemLimit - option.count);
    if (tooExpensive) {
      assert.throws(() => commands.tradeShop({ kind: 'buy', productId: tooExpensive.productId,
        count: Math.floor(game.state.snapshot().gil / tooExpensive.unitPrice) + 1 }));
      assert.equal(canonical(game.state.snapshot()), ownedBefore); row.trace.push({ kind: 'insufficient-money-trade-refused', productId: tooExpensive.productId });
    }
    const product = options.buy.find(option => option.maxCount > 0);
    if (!product) throw new Error('No source-funded affordable trade available; insufficient-money refusal retained without adding Gil');
    const stalePrepared = game.state.prepareShopTrade(visit.groupId, { kind: 'buy', productId: product.productId, count: 1 });
    const beforeGil = game.state.snapshot().gil, purchase = commands.tradeShop({ kind: 'buy', productId: product.productId, count: 1 });
    assert.ok(purchase); assert.equal(game.state.snapshot().gil, beforeGil - product.unitPrice);
    assert.equal(purchase.contentId, product.contentId); assert.equal(purchase.count, 1);
    assert.equal(game.shopOptions().buy.find(option => option.productId === product.productId).count, product.count + 1);
    const afterPurchase = canonical(game.state.snapshot()); assert.throws(() => stalePrepared.commit(), /stale/i);
    assert.equal(canonical(game.state.snapshot()), afterPurchase); row.trace.push({ kind: 'stale-prepared-trade-refused' });
    row.trace.push({ kind: 'source-funded-buy', purchase });
    const sellQuote = game.shopOptions().sell.find(option => option.contentId === purchase.contentId); assert.ok(sellQuote);
    const sold = commands.tradeShop({ kind: 'sell', contentId: purchase.contentId, count: 1 }); assert.ok(sold);
    assert.equal(game.state.snapshot().gil, beforeGil - product.unitPrice + sellQuote.unitPrice);
    assert.equal(game.shopOptions().buy.find(option => option.productId === product.productId).count, product.count);
    row.trace.push({ kind: 'sell-back-owned-copy', sold });
    assert.deepEqual(flags(game, namespaceOps), initialFlags, 'Post-shop source flags cannot execute before close');
    assert.equal(commands.closeShop(visit.id), true); assert.equal(commands.closeShop(visit.id), false);
    drain(flow, game, () => game.checkpointReady, row.trace);
    assert.equal(game.state, original.owned); assert.equal(game.field, original.field); assert.equal(game.world, original.world);
    assert.equal(canonical(game.field.content.scripts[name]), programBytes); row.flagsAfter = flags(game, namespaceOps); row.eventBanksAfter = game.field.eventState.snapshot();
    row.observedEventBankDeltas = observedEventBankDeltas(row.eventBanksBefore, row.eventBanksAfter);
    const values = new Map(); let fail = true;
    const storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (fail) throw new Error('Controlled quota failure'); values.set(key, value); } }, 'framework');
    const checkpoint = game.checkpoint(); await assert.rejects(storage.save(checkpoint, 1), /quota/);
    assert.equal(values.size, 0); assert.deepEqual(game.checkpoint(), checkpoint); fail = false; await storage.save(checkpoint, 2);
    const loaded = await storage.load(); const restored = await prepared.repository.restoreSessionContent(loaded.checkpoint);
    const oldCommands = commands, next = GameSession.restore(loaded.checkpoint, restored.initial, restored.battle, restored.world, sourceWebReplayRuntimePorts());
    const loadTicket = flow.beginOperation('load'); assert.equal(loadTicket.publish(next), true); game = next;
    flow.advance(0, host); commands = new GameCommands(flow, game);
    assert.equal(oldCommands.tradeShop({ kind: 'buy', productId: product.productId, count: 1 }), null);
    assert.equal(oldCommands.closeShop(visit.id), false); assert.deepEqual(game.checkpoint(), checkpoint);
    assert.equal(game.field.currentShop, null); assert.deepEqual(flags(game, namespaceOps), row.flagsAfter);
    const settledOwned = canonical(game.state.snapshot()); assert.equal(game.field.startEvent(name), true);
    drain(flow, game, () => game.field.currentShop !== null, row.trace); const nextVisit = game.field.currentShop;
    assert.notEqual(nextVisit.id, visit.id); assert.equal(commands.closeShop(visit.id), false);
    assert.equal(game.field.currentShop.id, nextVisit.id); assert.equal(commands.closeShop(nextVisit.id), true);
    drain(flow, game, () => game.checkpointReady, row.trace);
    assert.equal(canonical(game.state.snapshot()), settledOwned, 'A restored/reopened source script cannot replay a trade');
    assert.deepEqual(flags(game, namespaceOps), row.flagsAfter, 'Source flag sets are not duplicated on replay');
    row.trace.push({ kind: 'restored-whole-source-program-reopened-and-closed-without-trade-or-variable-replay',
      variableRefsChecked: row.flagsAfter.length, actualFlagInstructionExecutions: 'unassessed', declaredFlagWriteSites: namespaceOps.filter(op => op.kind === 'flag').length });
    row.eventBanksAfterReopen = game.field.eventState.snapshot();
    row.observedEventBankDeltasAfterReopen = observedEventBankDeltas(row.eventBanksAfter, row.eventBanksAfterReopen);
    row.after = stateView(game); row.status = 'controlled-original-main-lifecycle-passed';
  } catch (error) { row.reason = String(error.stack ?? error); if (game) row.atFailure = stateView(game); }
}
for (const input of inputs.values()) assert.equal(sha(await readFile(resolve(root, 'build', '.' + input.url))), input.sha256);
for (const snapshot of snapshots) {
  assert.equal(sha(await readFile(snapshot.path)), snapshot.sha256); await readSnapshot(resolve(root, 'build', snapshot.name));
}
for (const input of nativeInputs) assert.equal(sha(await readFile(resolve(root, input.path))), input.sha256);
assert.equal(sha(await readFile(nativePath)), sha(nativeBytes));
if (report.privateSourceCompiler) assert.equal(await runtimeDigest(root, report.privateSourceCompiler.directory),
  report.privateSourceCompiler.compilerRuntimeSha256, 'Private source compiler changed during execution');
assert.equal(await runtimeDigest(root, compiled), beforeRuntime, 'Public runtime changed during WIP acceptance');
assert.equal(sha(await readFile(new URL(import.meta.url))), report.checkerSha256); assert.equal(sha(await readFile(evidencePath)), report.cohortSha256);
report.inputs = [...inputs.values()]; report.counts = { completeSourcePrograms: cohort.programs.length, retainedInstructions: cohort.counts.instructions, roots: roots.length, sourceMaps: mapIds.length,
  selectedRoots: cohort.counts.selectedRoots, selectedSourceSites: cohort.counts.selectedSourceSites,
  staticallyUnreadyExecutions: cohort.counts.staticallyUnreadyExecutions,
  cases: report.cases.length, passed: report.cases.filter(row => row.status.endsWith('-passed')).length,
  unready: report.cases.filter(row => row.status === 'unready').length };
report.result = report.counts.unready || report.counts.staticallyUnreadyExecutions ? 'unready-gaps-retained' : 'controlled-original-main-lifecycles-passed';
await mkdir(out, { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, counts: report.counts, output, cases: report.cases.map(({ mapId, name, status, reason }) => ({ mapId, name, status, reason: reason?.split('\n')[0] })) }));
