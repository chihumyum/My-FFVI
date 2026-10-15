// Full, unchanged source-program experiments on the actual shared/native VM.
// Controlled geometry/owners are declared here, never claimed as story state.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSourceMessageCorpusInputs } from './source-message-corpus-inputs.mjs';

const names = { '--root': 'root', '--compiled-dir': 'compiled', '--report': 'report', '--audio-lane': 'audioLane', '--leader-lane': 'leaderLane', '--corpus': 'corpus', '--build-receipt': 'buildReceipt', '--app': 'app' }, seen = new Set();
const options = { root: resolve(import.meta.dirname, '..'), compiled: 'dist', report: 'build/reports/source-remove-all-check.json', audioLane: 'unassisted', leaderLane: 'native-source-unknown', corpus: 'build/story-corpus/corpus.json', buildReceipt: 'build/reports/story-corpus-build.json', app: 'apps/game/app.js' };
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  assert.ok(names[name] && value && !value.startsWith('--') && !seen.has(name), 'Use --root/--compiled-dir/--report <path>, --audio-lane unassisted|sha-verified-controlled-ack');
  seen.add(name); options[names[name]] = value;
}
assert.ok(['unassisted', 'sha-verified-controlled-ack'].includes(options.audioLane), 'Unknown controlled audio lane');
assert.ok(['native-source-unknown', 'controlled-flat-native', 'production-web-flat'].includes(options.leaderLane), 'Unknown controlled actor activity lane');
const root = resolve(options.root), compiled = resolve(root, options.compiled), output = resolve(root, options.report),
  load = name => import(pathToFileURL(resolve(compiled, 'src', name + '.js'))),
  sha = bytes => createHash('sha256').update(bytes).digest('hex'), inputFiles = new Map();
const [{ hash }, { canonical }, { loadCorpus }, { loadSystemMessages }, { decodeFieldOp, decodeScriptLocals, decodeConditionVisualFlag },
  { bindSourceFormatFlags }, { compileFieldPuppetScriptContext, compileFieldPuppetActorCatalog },
  { compileEventScriptTransitionMetadata }, { WEB_FIELD_STORY_RUNTIME }] = await Promise.all([
  'compiler/content', 'core/canonical', 'compiler/corpus', 'compiler/system-messages', 'compiler/field',
  'compiler/source-system-flags', 'compiler/field-puppet-actors', 'compiler/event-script-transition', 'core/field-story-runtime',
].map(load));
const { createWebFlatConditionLeaderActivityPort } = await load('core/field-condition-activity');
const { type0ConditionSessionFixture } = await import(pathToFileURL(resolve(compiled, 'tests/fixtures/type0-condition-session.js')));
async function read(path, seal = false) {
  const bytes = await readFile(resolve(root, path)), value = JSON.parse(bytes); inputFiles.set(path, sha(bytes));
  if (seal) { const { contentHash, ...body } = value; assert.equal(hash(body), contentHash, path); } return value;
}
async function runtimeBinding() {
  const files = [];
  async function walk(base, relative) {
    for (const entry of (await readdir(resolve(base, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(base, path);
      else if (entry.isFile() && path.endsWith('.js')) files.push({ path, sha256: sha(await readFile(resolve(base, path))) });
    }
  }
  await walk(compiled, 'src'); await walk(compiled, 'tests/fixtures');
  return { sha256: hash(files), files, checkerSha256: sha(await readFile(new URL(import.meta.url))) };
}
const runtime = await runtimeBinding(), verified = await loadSourceMessageCorpusInputs({
  root, compiledDir: compiled, corpusFile: options.corpus, buildReceipt: options.buildReceipt,
}), snapshot = verified.snapshot,
  sourceDigest = verified.sourceDigest, system = verified.system,
  corpus = await read(options.corpus, true),
  sourceWorld = await read('build/content-packages/source/world.json', true),
  assets = new Map(snapshot.assets.filter(asset => asset.kind === 'script').map(asset => [asset.id, asset])),
  messages = { ...snapshot.messages, system_zhc: system.messages };
const audioFiles = new Map(), audioBindings = new Map();
async function verifyAudioTrack(track) {
  if (!track) return; // Missing metadata remains a runtime provider error.
  assert.match(track.file, /^\/(bgm|se|environment)\/tracks\/[a-f0-9]{64}\.flac$/);
  const path = 'build' + track.file;
  if (!audioFiles.has(path)) {
    const bytes = await readFile(resolve(root, path));
    assert.equal(sha(bytes), track.sha256, 'Audio bytes changed: ' + track.file);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'fLaC', 'Not an exported FLAC resource');
    audioFiles.set(path, track.sha256);
  }
  assert.equal(audioFiles.get(path), track.sha256);
  audioBindings.set(hash(track), { file: track.file, sha256: track.sha256, source: track.source,
    sampleRate: track.sampleRate, channels: track.channels, frames: track.frames });
}
assert.equal(corpus.sourceSetHash, snapshot.sourceSetHash); assert.equal(corpus.scripts.length, 3304);
const isType0 = op => op.raw.mnemonic === 'RemoveCondition' && op.raw.operands.iValues[0] === 0,
  allType0 = corpus.scripts.filter(script => script.domain === 'field' && script.instructions.some(isType0)),
  roots = allType0.filter(script => script.instructions.every(op => op.operandDecoded !== 'blocked' || isType0(op)));
assert.equal(allType0.length, 147, 'The complete original type0 cohort must remain present');
const rootIds = new Set(roots.map(script => script.id));
const logical = [];
for (const script of roots) {
  assert.deepEqual(script.raw, assets.get(script.id).data); assert.equal(hash(script.raw), script.rawHash);
  const bindings = [];
  for (const map of corpus.analysis.maps) for (const [alias, id] of Object.entries({ ...map.residentScripts, ...map.scriptAliases }))
    if (id === script.id) bindings.push({ map, alias });
  assert.ok(bindings.length, 'A source root must have its real map namespace: ' + script.id);
  logical.push(...bindings.map(binding => ({ script, ...binding })));
}
const appBytes = await readFile(resolve(root, options.app)); inputFiles.set(options.app, sha(appBytes));
if (options.leaderLane !== 'native-source-unknown') {
  assert.match(appBytes.toString(), /import \{ createWebFlatConditionLeaderActivityPort \} from [\"']\/runtime\/core\/field-condition-activity\.js[\"']/);
  assert.match(appBytes.toString(), /conditionLeaderActivity: createWebFlatConditionLeaderActivityPort\(\)/);
}
const dependencyIndices = new Map();
corpus.analysis.dependencies.forEach((edge, index) => {
  const rows = dependencyIndices.get(edge.site.asset) ?? []; rows.push(index); dependencyIndices.set(edge.site.asset, rows);
});
const report = { kind: 'source-remove-all-program-replay-v1', result: 'running', runtime,
  audioLane: options.audioLane, leaderLane: options.leaderLane, app: { path: options.app, sha256: sha(appBytes) },
  conditionLeaderActivityPolicy: options.leaderLane !== 'native-source-unknown' ? {
    kind: 'web-flat-condition-leader-activity-v1', factory: 'createWebFlatConditionLeaderActivityPort (same production module as app)', componentsEnabled: true, ancestorsActive: true,
    activeSelf: 'same-draft-native-entity-visible', nativeRuntimeVerified: false,
  } : null,
  sourceSetHash: snapshot.sourceSetHash, parentSourceSetHash: snapshot.manifest.parentSourceSetHash,
  corpusHash: corpus.contentHash, sourceDigest, translatedBinding: verified.binding,
  completeType0Cohort: allType0.map(script => ({ id: script.id, rawHash: script.rawHash, source: script.source,
    maps: script.maps, dependencyIndices: dependencyIndices.get(script.id) ?? [], selectedForControlledExecution: rootIds.has(script.id),
    sites: script.instructions.filter(isType0).map(instruction => ({ site: instruction.site, raw: instruction.raw, decoded: instruction.decoded })),
    remainingInstructionDiagnostics: script.instructions.filter(op => op.operandDecoded === 'blocked' && !isType0(op))
      .map(op => ({ site: op.site, raw: op.raw, decoded: op.decoded, diagnostic: op.diagnostic })),
    runtimeAdmission: 'unassessed', storyReachability: 'unverified',
  })),
  fullCorpusDependencyBinding: { corpusHash: corpus.contentHash, dependencyCount: corpus.analysis.dependencies.length,
    unresolvedDependencyCount: corpus.analysis.dependencies.filter(edge => !edge.resolved).length,
    limitation: 'Complete source dependency graph and all unselected programs remain in the bound full corpus; execution roots do not grant map/init/provider closure.' },
  roots: roots.map(script => ({ id: script.id, rawHash: script.rawHash, source: script.source, maps: script.maps })),
  logicalRoots: logical.length, programs: [],
  nativeRuntimeVerified: false, browserVerified: false, storyReachability: 'unverified', runtimeAdmission: 'unassessed', sourceCampaignComplete: false,
  limitations: ['All original source instructions/segments and exact local/resident aliases remain; none is skipped or shortened.',
    'The actual shared GameSession/native actors run an explicitly synthetic initializer, ordinary map and minimal authored puppet catalog.',
    'The production named Web-flat factory explicitly fixes component enabled and parent active; it projects activeSelf from the same private native entity. It does not prove arbitrary source/runtime hierarchy activity.',
    'Two legal owned preconditions are controlled: fresh healthy, and current first owner dead with a retained53 on the second. No story flag or result is invented.',
    'All source script flags are decoded from the verified original Format import. True requires an explicit actor activity provider; source-unknown never grants it.',
    'The unassisted lane retains missing resource/presentation providers. The optional bytes-verified ACK is an explicit controlled presenter, not browser/audio-device decoding evidence.',
    'Choice answers are explicit user-input prefixes. Zero native story banks are an input, not proof of source reachability.',
    'The associated static nomination retains the complete map/init/provider closure, separate from this controlled host.'] };
function seal(value) { value.contentHash = hash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentHash'))); }
function build(binding) {
  const f = type0ConditionSessionFixture(), rawMisc = { characteristics: true, corps_order: [0, 1, 2, 3],
    resident_characters: [], change_character_condition_list: [] },
    puppet = compileFieldPuppetActorCatalog(rawMisc), namespace = { ...binding.map.residentScripts, ...binding.map.scriptAliases };
  const controlledParent = hash({ kind: 'synthetic-native-vm-cohort-host-parent-v1' });
  for (const content of [f.map, f.world, f.content]) content.parentSourceSetHash = controlledParent;
  // Author launcher is deliberately inert. It is not one of the source
  // programs, and it must not seed a fake original ScenarioFlag20.
  for (const name of ['reserved', 'fallback']) f.map.scripts[name] = [{ kind: 'exit', script: name, index: 0, source: f.source }];
  f.content.puppetCatalog = puppet;
  for (const context of Object.values(f.map.scriptPuppetContexts)) context.miscHash = puppet.miscHash;
  const programBindings = [], unavailable = [];
  for (const [alias, id] of Object.entries(namespace)) {
    if (id === null) { unavailable.push({ alias, reason: 'unresolved original local alias shadows resident' }); continue; }
    const asset = assets.get(id); if (!asset) { unavailable.push({ alias, id, reason: 'source program is unavailable' }); continue; }
    const flags = bindSourceFormatFlags(snapshot.manifest, asset), raw = asset.data.Mnemonics;
    const ops = raw.map((instruction, index) => decodeFieldOp(instruction, { script: alias, index,
      source: { ...asset.source, pointer: '/Mnemonics/' + index } }, messages, snapshot.tables,
    { nextMnemonic: raw[index + 1]?.mnemonic ?? null }));
    assert.equal(ops.length, raw.length);
    f.map.scripts[alias] = ops;
    try {
      f.map.scriptLocals[alias] = decodeScriptLocals(asset.data);
      f.map.scriptPuppetContexts[alias] = compileFieldPuppetScriptContext(asset.data, rawMisc, flags);
      f.map.scriptSystemFlags[alias] = decodeConditionVisualFlag(asset.data, flags);
    } catch (error) {
      delete f.map.scriptLocals[alias]; delete f.map.scriptPuppetContexts[alias]; delete f.map.scriptSystemFlags[alias];
      unavailable.push({ alias, id, reason: error.message });
    }
    try { f.map.scriptTransitionMetadata[alias] = compileEventScriptTransitionMetadata(asset.data); }
    catch (error) { delete f.map.scriptTransitionMetadata[alias]; unavailable.push({ alias, id, reason: error.message }); }
    programBindings.push({ alias, id, rawHash: hash(asset.data), opHash: hash(ops), instructionCount: raw.length,
      segments: structuredClone(asset.data.Segments), source: structuredClone(asset.source),
      blockers: ops.filter(op => op.kind === 'blocked').map(op => ({ index: op.index, reason: op.reason })) });
  }
  assert.equal(hash(assets.get(binding.script.id).data), binding.script.rawHash);
  assert.equal(f.map.scripts[binding.alias].length, binding.script.raw.Mnemonics.length);
  f.world.bgm = structuredClone(sourceWorld.bgm); f.world.environment = structuredClone(sourceWorld.environment); f.world.se = structuredClone(sourceWorld.se);
  for (const content of [f.map, f.world, f.content]) content.developmentProfile.storyRuntime = WEB_FIELD_STORY_RUNTIME;
  seal(f.map); f.world.maps[f.map.mapId].contentHash = f.map.contentHash; seal(f.world);
  f.content.mapContentHash = f.map.contentHash; f.content.worldCatalogHash = f.world.contentHash; seal(f.content);
  return { f, programBindings, unavailable };
}
async function execute(binding, legalOwned, prefix) {
  const { f, programBindings, unavailable } = build(binding), presented = new Set(), frames = [];
  if (options.audioLane === 'sha-verified-controlled-ack') {
    for (const ops of Object.values(f.map.scripts)) for (const op of ops) {
      if (op.kind === 'field-sound' && 'soundId' in op.command) await verifyAudioTrack(sourceWorld.se?.tracks[op.command.soundId]);
      if (op.kind === 'bgm-play' || op.kind === 'bgm-ready') await verifyAudioTrack(sourceWorld.bgm?.tracks[op.track]);
      if (op.kind === 'environment-play') await verifyAudioTrack(sourceWorld.environment?.tracks[op.track]);
    }
    f.runtime.audioReadiness = { isReady: track => audioBindings.has(hash(track)) };
    f.runtime.soundPresentation = { isPresented: (voice, track) => audioBindings.has(hash(track)) && presented.has(voiceKey(voice)) };
  }
  const leaderObservations = [];
  if (options.leaderLane !== 'native-source-unknown') {
    const activity = createWebFlatConditionLeaderActivityPort();
    f.runtime.conditionLeaderActivity = { ...activity, prepare(host) {
      const scope = activity.prepare(host);
      return { validate: () => scope.validate(), isActiveAndEnabled(id, entity) {
        const result = scope.isActiveAndEnabled(id, entity);
        const observation = { actor: id, activeAndEnabled: result, activeSelf: entity.visible,
          position: { ...entity.position }, layer: entity.layer, animationKey: entity.animation?.key ?? null };
        const previous = leaderObservations.at(-1);
        if (!previous || canonical(previous) !== canonical(observation)) leaderObservations.push(observation);
        return result;
      } };
    } };
  }
  const game = f.make();
  function voiceKey(voice) { return canonical({ id: voice.id, track: voice.track, started: voice.started }); }
  function observeAudio(active) {
    if (options.audioLane !== 'sha-verified-controlled-ack') return;
    for (const voice of active.field.se.voices) {
      const track = active.field.content.se?.tracks[voice.track];
      assert.ok(track && audioBindings.has(hash(track)), 'Output submission cannot ACK unverified media');
      const key = voiceKey(voice);
      if (!presented.has(key)) { presented.add(key); frames.push({ id: voice.id, track: voice.track,
        sha256: track.sha256, fieldTime: active.field.time }); }
    }
  }
  if (legalOwned === 'controlled-death-and-retained-row') {
    const next = game.state.snapshot(); next.roster[0].hp = 0; next.roster[0].conditionIds = [f.deathId];
    next.roster[1].conditionIds = [53]; game.state.restore(next);
  }
  const ownerBefore = game.state.snapshot(), eventBefore = game.field.eventState.snapshot(),
    clears = [], choices = [], shown = [], tasks = () => Reflect.get(game.field, 'tasks');
  const actual = game.state.fieldOwnedConditions, prepare = actual.prepare;
  // Observational wrapper delegates to the real state transaction and records
  // after success. It cannot supply a plan, mutate an owner or swallow errors.
  actual.prepare = command => {
    const transaction = prepare(command);
    return { ...transaction, commitWith(publish) {
      transaction.commitWith(publish);
      if (command.conditionType === 0) clears.push({ command, targets: transaction.targets,
        writes: transaction.coreI0Writes, ownedHash: hash(game.state.snapshot()),
        main: tasks().filter(task => task.slot === null).map(task => ({ script: task.script, pc: task.pc,
          generalRegisters: structuredClone(task.generalRegisters) })) });
    } };
  };
  let frontier = null, exception = null, steps = 0, saved = null;
  try {
    assert.equal(game.field.startEvent(binding.alias), true);
    while (steps++ < 12000 && !game.field.stop && (game.field.busy || game.field.fader.active || game.field.storyRuntimeSnapshot?.colorFilter?.tween)) {
      observeAudio(game);
      if (game.field.choice) {
        const request = game.field.choice;
        if (choices.length >= prefix.length) { frontier = { kind: 'choice', options: request.options.length }; break; }
        const answer = prefix[choices.length]; assert.equal(game.field.choose(request.id, answer), true);
        choices.push({ site: { script: request.script ?? null }, answer }); game.advance(10);
      } else if (game.field.dialogue) {
        if (game.field.dialogue.manual && game.field.time < game.field.dialogue.manual.availableAt) game.advance(10);
        else { shown.push(game.field.dialogue.key); game.field.confirm(); game.advance(10); }
      } else {
        game.advance(10);
        if (game.field.sourceMessage.projection?.acceptsInput) game.field.confirm();
      }
    }
    if (steps >= 12000 && !game.field.stop) frontier = { kind: 'clock-budget', milliseconds: 120000 };
    if (!frontier && !game.field.stop && game.checkpointReady) {
      const checkpoint = game.checkpoint(); presented.clear();
      const restored = f.restore(JSON.parse(JSON.stringify(checkpoint))); observeAudio(restored);
      assert.deepEqual(restored.checkpoint(), checkpoint); saved = { kind: checkpoint.kind, hash: hash(checkpoint) };
    }
  } catch (error) { exception = { message: error.message, stack: error.stack }; }
  actual.prepare = prepare;
  return { ownedPrecondition: legalOwned, choicePrefix: prefix, before: { ownedHash: hash(ownerBefore),
    resources: ownerBefore.roster.map(owner => ({ id: owner.id, ownedId: owner.ownedId, sourceId: owner.sourceId,
      hp: owner.hp, mp: owner.mp, conditionIds: owner.conditionIds })), eventStateHash: hash(eventBefore) },
    result: exception ? 'exception' : frontier ? 'input-boundary' : game.field.stop ? 'blocked' : game.checkpointReady ? 'finished-and-restored' : 'unfinished',
    exception, frontier, stop: game.field.stop, steps, clears, choices, shown, saved, controlledAudioFrames: frames,
    after: { ownedHash: hash(game.state.snapshot()), eventStateHash: hash(game.field.eventState.snapshot()),
      tasks: tasks().map(task => ({ script: task.script, pc: task.pc, state: task.state, done: task.done,
        actor: task.actor, sourceEntityId: task.sourceEntityId, generalRegisters: structuredClone(task.generalRegisters) })) },
    controlledLeaderObservations: leaderObservations,
    programBindings, unavailable, runtimeAdmission: 'unassessed', storyReachability: 'unverified' };
}
await mkdir(dirname(output), { recursive: true });
try {
  for (const binding of logical) {
    const runs = [];
    for (const state of ['fresh-healthy', 'controlled-death-and-retained-row']) {
      const prefixes = [[]];
      for (let index = 0; index < prefixes.length && index < 32; index++) {
        const run = await execute(binding, state, prefixes[index]); runs.push(run);
        if (run.frontier?.kind === 'choice' && prefixes[index].length < 8)
          for (let answer = 0; answer < run.frontier.options; answer++) prefixes.push([...prefixes[index], answer]);
      }
      if (prefixes.length > 32) runs.push({ result: 'input-budget', ownedPrecondition: state, choicePrefixCount: prefixes.length });
    }
    report.programs.push({ program: binding.script.id, rawHash: binding.script.rawHash, source: binding.script.source,
      sourceMapId: Number(binding.map.id), alias: binding.alias, runs });
  }
  for (const [path, expected] of inputFiles) assert.equal(sha(await readFile(resolve(root, path))), expected, path);
  for (const [path, expected] of audioFiles) assert.equal(sha(await readFile(resolve(root, path))), expected, path);
  const finalSource = await loadCorpus(root);
  assert.equal(hash({ assets: finalSource.assets, tables: finalSource.tables, messages: finalSource.messages, manifest: finalSource.manifest }), sourceDigest);
  await verified.finish();
  assert.deepEqual(await runtimeBinding(), runtime);
  const runs = report.programs.flatMap(program => program.runs);
  assert.ok(runs.every(run => run.result !== 'exception'), 'A VM exception is not a successful source experiment');
  report.counts = { physicalPrograms: roots.length, logicalRoots: logical.length, runs: runs.length,
    byResult: Object.fromEntries([...new Set(runs.map(run => run.result))].sort().map(result => [result, runs.filter(run => run.result === result).length])),
    successfulType0Calls: runs.reduce((sum, run) => sum + (run.clears?.length ?? 0), 0),
    restored: runs.filter(run => run.saved).length };
  assert.ok(report.programs.length === logical.length);
  report.verifiedAudio = { files: Object.fromEntries(audioFiles), bindings: [...audioBindings.values()],
    decodedInBrowser: false, outputDeviceVerified: false };
  report.result = 'complete-attempts-recorded'; report.inputFiles = Object.fromEntries(inputFiles);
} catch (error) { report.result = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, counts: report.counts, error: report.error,
  runtimeAdmission: report.runtimeAdmission, storyReachability: report.storyReachability, sourceCampaignComplete: false }));
