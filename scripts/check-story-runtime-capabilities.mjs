// Complete source-family inventory plus controlled public-VM host composition.
// Source-site execution is deliberately not complete source-program admission.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';

const root = resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
let compiled = 'dist';
if (args.length) {
  if (args.length !== 2 || args[0] !== '--compiled' || !args[1])
    throw new Error('Use check-story-runtime-capabilities.mjs [--compiled directory]');
  compiled = args[1];
}
const load = name => import(pathToFileURL(resolve(root, compiled, name + '.js')));
const [{ loadCorpus, analyzeCorpus }, { decodeFieldOp }, { compileFieldTaskControlInstruction },
  { FieldGame }, { EventState }, { DEVELOPMENT_TRANSPARENT_FADE }, story, audio,
  { checkpointFixture }, { sourceNewGameFixture }, { hash, canonical }, { loadSystemMessages },
  { readSnapshot }, { fieldTimerUpdateStates }] = await Promise.all([
  'src/compiler/corpus', 'src/compiler/field', 'src/compiler/field-task-control',
  'src/core/field', 'src/core/event-state', 'src/core/field-fade', 'src/core/field-story-runtime',
  'src/core/static-audio', 'tests/fixtures/checkpoint-game', 'tests/fixtures/source-new-game',
  'src/compiler/content', 'src/compiler/system-messages', 'src/compiler/integrity', 'src/core/field-timer',
].map(load));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshotHeaders = await Promise.all(['corpus', 'field'].map(async name => {
  const path = resolve(root, 'build', name, 'snapshot.json'), bytes = await readFile(path);
  return { name, path, sha256: sha(bytes), manifest: JSON.parse(bytes) };
}));
const corpus = await loadCorpus(root);
const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources);
const messages = { ...corpus.messages, system_zhc: system.messages };
const analysis = analyzeCorpus(corpus.assets, corpus.tables, messages, corpus.sourceSetHash);
const byReport = new Map(analysis.scripts.map(row => [row.id, row]));
const scripts = corpus.assets.filter(asset => asset.kind === 'script').sort((a, b) => a.id.localeCompare(b.id));

const nativeFiles = [], nativeEvidence = [];
for (const directory of ['story-bgm-control', 'story-fader-control', 'web-field-timer-closed']) {
  const path = resolve(root, 'build/native', directory, 'complete.json'), bytes = await readFile(path);
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, corpus.manifest.sources.find(source => source.file === 'GameAssembly.dll')?.sha256);
  nativeFiles.push({ path, sha256: sha(bytes) });
  for (const method of receipt.methods) {
    const bodyPath = resolve(root, 'build/native', directory, method.rva.slice(2) + '.c');
    const bodySha = sha(await readFile(bodyPath)); assert.equal(bodySha, method.decompiledSha256);
    nativeFiles.push({ path: bodyPath, sha256: bodySha });
  }
  nativeEvidence.push({ directory, receiptSha256: sha(bytes), receipt });
}
for (const [key, relative] of Object.entries({ nativeSha256: 'build/runtime/game/GameAssembly.dll',
  symbolsSha256: 'build/native/il2cpp/script.json', headerSha256: 'build/native/il2cpp/il2cpp_ghidra.h' })) {
  const path = resolve(root, relative), digest = sha(await readFile(path));
  for (const row of nativeEvidence) assert.equal(row.receipt[key], digest);
  nativeFiles.push({ path, sha256: digest });
}
const runtimeBefore = await runtimeDigest(root, compiled);
const audioNames = new Set(['PauseBGM', 'ReplayBgm']), screenNames = new Set(['ColorFade', 'Flash']);
const motionNames = new Set(['Move', 'MoveTo', 'Lerp']);
const scope = raw => audioNames.has(raw.mnemonic) ? 'audio-control' : screenNames.has(raw.mnemonic) ? 'screen-effects'
  : motionNames.has(raw.mnemonic) ? 'camera-motion-inventory'
  : /Timer/.test(raw.mnemonic) || raw.mnemonic === 'SysCall' && /タイマー|時間切れ/.test(raw.operands?.sValues?.[0] ?? '') ? 'timer' : null;
const inventory = [], families = {}, programIds = new Set();
for (const asset of scripts) {
  const report = byReport.get(asset.id), body = asset.data.Mnemonics;
  const cameraRanges = [];
  // This is syntactic task-range membership, not interprocedural actor flow or
  // story reachability. Every matching source SetPuppet use point is retained.
  for (const [index, raw] of body.entries()) if (raw.mnemonic === 'SetPuppet') {
    try {
      const op = compileFieldTaskControlInstruction(raw);
      if (op.actor !== '0' || op.target >= body.length) continue;
      const end = body.findIndex((instruction, i) => i >= op.target && instruction.mnemonic === 'Exit');
      if (end >= 0) cameraRanges.push({ sourceSite: { script: asset.id, index,
        source: { ...asset.source, pointer: '/Mnemonics/' + index } }, raw, decoded: op, start: op.target, end });
    } catch { /* No camera claim is inferred from an unsupported assignment. */ }
  }
  for (const [index, raw] of body.entries()) {
    const capability = scope(raw); if (!capability) continue;
    programIds.add(asset.id);
    const site = { script: asset.id, index, source: { ...asset.source, pointer: '/Mnemonics/' + index } };
    const family = raw.mnemonic === 'SysCall' ? 'SysCall:' + (raw.operands?.sValues?.[0] ?? '') : raw.mnemonic;
    const row = { site, raw, instructionHash: hash(raw), family, capability, domain: report.domain, maps: report.maps,
      cameraTaskContexts: motionNames.has(raw.mnemonic) ? cameraRanges.filter(range => index >= range.start && index <= range.end) : [],
      runtimeAdmission: 'unassessed', sourceStoryReachability: false };
    const stats = families[family] ??= { total: 0, decoded: 0, blocked: 0, unassessed: 0, executed: 0, passed: 0, failed: 0, excluded: 0 };
    stats.total++;
    if (report.domain !== 'field') { row.status = 'unassessed'; stats.unassessed++; }
    else {
      row.typed = decodeFieldOp(raw, site, messages);
      if (row.typed.kind === 'blocked') { row.status = 'blocked'; stats.blocked++; }
      else { row.status = 'operand-decoded'; stats.decoded++; }
    }
    inventory.push(row);
  }
}

const fixtureBase = checkpointFixture().field;
const cameraDefinition = sourceNewGameFixture().map.cameraHost;
const syntheticSource = { file: 'authored-web-host-envelope', assetPath: 'Fixtures/StoryRuntimeCapability/v1',
  sha256: hash('authored Web host envelope'), objectId: '9007199254740995' };
const ref = index => ({ category: 'ScenarioFlag1', index });
const flag = index => ({ kind: 'flag', ref: ref(index), operation: 'set' });
const emit = (script, values) => values.map((value, index) => ({ ...value, script, index, source: syntheticSource }));
const seal = content => { const { contentHash: _, ...body } = content; content.contentHash = hash(body); };
function fixture(row) {
  const content = structuredClone(fixtureBase);
  content.parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  content.sourceSetHash = hash({ kind: 'authored-source-site-host-envelope-v1', sourceSetHash: corpus.sourceSetHash, site: row.site });
  content.entry.fade = structuredClone(DEVELOPMENT_TRANSPARENT_FADE);
  content.developmentProfile = { kind: 'framework-development-v1', policy: 'omit-anonymous-environment-particles-v1',
    sourceContentHash: hash('controlled original fixture'), omissions: [], storyRuntime: story.WEB_FIELD_STORY_RUNTIME };
  content.scripts = {}; content.scriptLocals = {}; content.scriptTransitionMetadata = {};
  const add = (name, body) => {
    content.scripts[name] = emit(name, body); content.scriptLocals[name] = null;
    content.scriptTransitionMetadata[name] = { customAnimations: 'none' };
  };
  let fixturePc = row.site.index;
  if (row.typed.kind === 'field-script-motion') {
    content.cameraHost = structuredClone(cameraDefinition);
    // Only the host envelope has different PCs. The source typed op itself is
    // byte-for-byte retained, and its original address stays in row.site.
    add(row.site.script, [{ kind: 'puppet', slot: 0, actor: '0', target: 4 },
      { kind: 'exec-puppets', asynchronous: false }, flag(40), { kind: 'exit' }, { kind: 'nop' },
      row.typed, { kind: 'exit' }]);
    fixturePc = 5; content.scripts[row.site.script][5] = structuredClone(row.typed);
  } else {
    add(row.site.script, [...Array.from({ length: fixturePc }, () => ({ kind: 'nop' })), row.typed, flag(40), { kind: 'exit' }]);
    content.scripts[row.site.script][fixturePc] = structuredClone(row.typed);
  }
  const callback = row.typed.kind === 'field-timer' && row.typed.command.kind === 'set'
    ? row.typed.command.callbackScripts[0] : 'authored_timer_callback';
  // ChangeScript's native jump/Next skips its target label. The ordinary
  // automatic callback starts at PC 0; both paths share this explicit label.
  add(callback, [{ kind: 'nop' }, { kind: 'calc', left: { category: 'ScenarioVariable', index: 7 }, operator: '＋', right: { kind: 'immediate', value: 1 } },
    flag(41), { kind: 'exit' }]);
  add('authored_timer_setup', [{ kind: 'field-timer', command: { kind: 'set', seconds: 20, displayUI: true,
    updateStates: fieldTimerUpdateStates({ display: 0, battle: 0, message: 1, event: 1 }),
    sourceSelectors: { display: 0, battle: 0, message: 1, event: 1 }, callbackScripts: [callback] } },
    ...(row.typed.kind === 'field-timer' && row.typed.command.kind === 'resume'
      ? [{ kind: 'field-timer', command: { kind: 'pause' } }] : []), { kind: 'exit' }]);
  content.bgm = { sourceSetHash: hash('authored audio'), tracks: Object.fromEntries([1, 2].map(track => [track,
    { file: '/authored/loop-' + track + '.flac', sha256: hash('authored audio samples ' + track), sampleRate: 1000,
      frames: 10000, channels: 2, loop: { start: 2000, end: 8000 }, source: syntheticSource, tableSource: syntheticSource }])) };
  seal(content);
  return { content, fixturePc, callback };
}
const variable = field => field.eventState.read({ category: 'ScenarioVariable', index: 7 });
const flagValue = (field, index) => field.eventState.read(ref(index));
function advance(field, milliseconds) {
  while (milliseconds > 0 && !field.stop) { const next = Math.min(60000, milliseconds); field.advance(next); milliseconds -= next; }
}
function projection(field) {
  return { time: field.time, stop: field.stop, busy: field.busy, flags: [flagValue(field, 40), flagValue(field, 41)],
    callbackCount: variable(field), timer: field.storyRuntimeSnapshot?.timer, colorFilter: field.storyRuntimeSnapshot?.colorFilter,
    fade: field.fader.snapshot(), audio: field.bgm.snapshot(), camera: field.cameraSnapshot };
}
function execute(row) {
  const { content, fixturePc, callback } = fixture(row), field = new FieldGame(content, EventState.initialized());
  const op = row.typed, trace = [];
  try {
  field.bgm.play(1, 0, 0, 0, content.bgm); field.bgm.play(2, 1, 0, 0, content.bgm);
  advance(field, 50);
  if (op.kind === 'bgm-pause' && !op.paused) field.bgm.pause(op.channel, true, 0, content.bgm);
  if (op.kind === 'field-timer' && op.command.kind !== 'set') {
    field.startEvent('authored_timer_setup');
    if (op.command.kind === 'resume') assert.equal(field.storyRuntimeSnapshot.timer.active.paused, true);
    if (op.command.kind === 'change-script-if-expired') field.advanceStoryTimer(20000, 'player');
  }
  trace.push({ boundary: 'before-source-op', state: projection(field) });
  const sourceBefore = canonical(content.scripts[row.site.script][fixturePc]);
  field.startEvent(row.site.script);
  trace.push({ boundary: 'after-source-op-first-clock', state: projection(field) });
  let duration = 3000;
  if (op.kind === 'field-color-fade' || op.kind === 'field-flash')
    duration = Math.ceil(Math.abs(op.seconds) * 1000) * (op.kind === 'field-flash' ? 2 : 1) + 200;
  if (op.kind === 'bgm-pause' || op.kind === 'bgm-replay') duration = Math.ceil(op.fade * 1000) + 100;
  if (op.kind === 'field-script-motion') {
    const c = op.command, speed = [240, 480, 120, 960, 60, 1920, 160][c.speedId ?? 0];
    const steps = c.kind === 'move' ? c.steps : c.kind === 'move-to' ? Math.abs(c.target.value - content.entry.player[c.axis]) : 0;
    duration = c.kind === 'lerp' ? Math.ceil(c.duration * 1000) + 100 : Math.min(600000, (steps + 1) * (speed + 20) + 100);
  }
  advance(field, duration);
  assert.equal(field.stop, null, field.stop?.message);
  if (op.kind === 'field-timer' && op.command.kind === 'change-script-if-expired') {
    assert.equal(flagValue(field, 40), 0, 'Timeout must replace the current task, rather than execute its continuation');
    assert.equal(variable(field), 1);
  } else assert.equal(flagValue(field, 40), 1, 'Source op must reach its controlled continuation through the actual VM');
  if (op.kind === 'field-timer') {
    let active = field.storyRuntimeSnapshot.timer.active;
    if (op.command.kind === 'set') {
      assert.ok(active); assert.equal(active.command.seconds, op.command.seconds);
      // Public battle/field-clock bridge advances the existing field owner. It
      // does not run a second timer VM or alter the source duration.
      if (!active.expired) field.advanceStoryTimer(active.durationMs - active.elapsedMs, 'player');
      advance(field, 20); assert.equal(variable(field), 1); assert.equal(flagValue(field, 41), 1);
      const saved = field.checkpoint(), restored = FieldGame.restore(content, JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(restored.checkpoint(), saved); advance(restored, 100);
      assert.equal(variable(restored), 1, 'Restoration must not replay the timer callback');
    } else if (op.command.kind === 'pause') {
      assert.equal(active.paused, true); const held = canonical(active);
      field.advanceStoryTimer(100000, 'player'); assert.equal(canonical(field.storyRuntimeSnapshot.timer.active), held);
    } else if (op.command.kind === 'resume') assert.equal(active.paused, false);
    else if (op.command.kind === 'finish') assert.equal(active, null);
    else { advance(field, 100); assert.equal(variable(field), 1); }
  }
  if (op.kind === 'bgm-pause') {
    const voiceId = field.bgm.snapshot().channels[op.channel];
    const voice = field.bgm.voices.find(voice => voice.id === voiceId);
    assert.ok(voice); assert.equal(audio.audioVoicePlaying(voice, field.bgm.time), !op.paused);
    const position = audio.audioPosition(voice, field.bgm.time, content.bgm.tracks[voice.track]);
    advance(field, 100);
    if (op.paused) assert.equal(audio.audioPosition(voice, field.bgm.time, content.bgm.tracks[voice.track]), position);
  }
  if (op.kind === 'bgm-replay') {
    const voice = field.bgm.voices.find(voice => voice.id === field.bgm.snapshot().channels[0]);
    assert.equal(voice.id, 3); assert.ok(audio.audioPosition(voice, field.bgm.time, content.bgm.tracks[voice.track]) < 0.2);
  }
  if (op.kind === 'field-color-fade') assert.deepEqual(field.colorFilter, op.color);
  if (op.kind === 'field-flash') assert.equal(field.fader.active, false);
  if (op.kind === 'field-script-motion') assert.equal(field.busy, false, 'Joined camera task must finish');
  const saved = field.checkpoint(), restored = FieldGame.restore(content, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(canonical(content.scripts[row.site.script][fixturePc]), sourceBefore);
  assert.equal(sourceBefore, canonical(row.typed), 'The source op is not rewritten for its host envelope');
  trace.push({ boundary: 'settled-and-restored', state: projection(field), checkpointHash: hash(saved) });
  return { result: 'passed', envelope: { kind: 'authored-web-host-envelope-v1', contentHash: content.contentHash,
    fixturePc, sourcePc: row.site.index, callbackName: callback, sourceCallbackExecuted: false,
    camera: op.kind === 'field-script-motion' ? { actor: '0', join: 'synchronous', view: 'ordinary-field',
      loop: false, animationMedia: 'absent', entitySelectors: 'unbound' } : null }, trace };
  } catch (error) {
    if (error instanceof Error) error.controlledFixture = { contentHash: content.contentHash, fixturePc,
      sourcePc: row.site.index, trace, atFailure: projection(field) };
    throw error;
  }
}

for (const row of inventory) {
  const stats = families[row.family];
  let exclusion = row.status !== 'operand-decoded' ? row.status : null;
  if (!exclusion && row.capability === 'timer' && row.typed.kind !== 'field-timer') exclusion = 'Separate timer family has no ordinary field-timer host';
  if (!exclusion && row.capability === 'camera-motion-inventory') {
    if (!row.cameraTaskContexts.length) exclusion = 'Camera ownership is not established by a syntactic SetPuppet(actor=0) task range';
    else if (row.typed.kind !== 'field-script-motion') exclusion = 'Not the source type=2 motion opcode';
    else if (row.typed.command.animation !== '') exclusion = 'Camera animation media is not admitted';
    else if (row.typed.command.kind === 'move-to' && (row.typed.command.target.kind !== 'direct' || row.typed.command.target.layer !== 0))
      exclusion = 'Camera target entity/nonzero layer is not bound in the controlled ordinary host';
    else if (row.typed.command.kind === 'lerp' && row.typed.command.layer !== 0) exclusion = 'Camera Lerp nonzero layer is not admitted';
  }
  if (exclusion) { row.execution = { result: 'excluded', reason: exclusion }; stats.excluded++; continue; }
  stats.executed++;
  try {
    const first = execute(row), second = execute(row);
    assert.equal(canonical(second), canonical(first), 'Controlled source-site replay differs');
    row.execution = { ...first, deterministicReplay: 'passed' }; stats.passed++;
  } catch (error) {
    row.execution = { result: 'failed', diagnostic: { code: 'SOURCE_SITE_HOST_COMPOSITION_FAILED',
      reason: error instanceof Error ? error.message : String(error) }, controlledFixture: error.controlledFixture ?? null,
      completeSourceProgramAdmission: 'unassessed' };
    stats.failed++;
  }
}
const programs = scripts.filter(asset => programIds.has(asset.id)).map(asset => ({ id: asset.id, source: asset.source,
  rawHash: hash(asset.data), raw: asset.data, maps: byReport.get(asset.id).maps, domain: byReport.get(asset.id).domain,
  runtimeAdmission: 'unassessed', sourceStoryReachability: false }));
const counts = { sourceScripts: scripts.length, affectedCompleteProgramsPreserved: programs.length, sourceSites: inventory.length,
  operandDecoded: inventory.filter(row => row.status === 'operand-decoded').length,
  blocked: inventory.filter(row => row.status === 'blocked').length, unassessed: inventory.filter(row => row.status === 'unassessed').length,
  executedSourceSiteParameters: inventory.filter(row => row.execution.result !== 'excluded').length,
  passedSourceSiteParameters: inventory.filter(row => row.execution.result === 'passed').length,
  failedSourceSiteParameters: inventory.filter(row => row.execution.result === 'failed').length,
  excludedSourceSites: inventory.filter(row => row.execution.result === 'excluded').length,
  wholeSourceProgramsPlayed: 0, originalGameRuns: 0 };
assert.equal(counts.sourceSites, counts.operandDecoded + counts.blocked + counts.unassessed);
assert.equal(counts.sourceSites, counts.passedSourceSiteParameters + counts.failedSourceSiteParameters + counts.excludedSourceSites);
// Re-read all snapshot-listed bytes, not just mutable header files. This also
// detects source drift while the public VM cases were being executed.
for (const header of snapshotHeaders) {
  assert.equal(sha(await readFile(header.path)), header.sha256, 'Source snapshot header changed');
  await readSnapshot(resolve(root, 'build', header.name));
}
for (const file of nativeFiles) assert.equal(sha(await readFile(file.path)), file.sha256, 'Native evidence bytes changed');
const runtimeAfter = await runtimeDigest(root, compiled), runtimeStable = runtimeBefore === runtimeAfter;
const report = { kind: 'source-story-runtime-capability-batch-v1', result: runtimeStable ? 'controlled-host-batch-assessed' : 'runtime-drift-rejected',
  runtimeSha256: runtimeBefore, runtimeAfterSha256: runtimeAfter, runtimeStable,
  sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  manifest: corpus.manifest, snapshots: snapshotHeaders.map(({ name, sha256, manifest }) => ({ name, sha256, manifest })),
  counts, families, inventory, programs, nativeEvidence,
  runtimeAdmission: 'unassessed', sourceStoryReachability: false, sourceCampaignComplete: false,
  browserVerified: false, originalGameExecuted: false, semanticsVerified: false,
  nomination: Object.entries(families).map(([family, stats]) => ({ family, stats,
    admission: stats.failed ? 'host-composition-gap-retained' : stats.passed ? 'controlled-parameter-batch-demonstrated' : 'unassessed',
    sites: inventory.filter(row => row.family === family).map(row => row.site) })),
  limitations: [
    'All family sites and complete affected source bodies are retained. Passed cases execute actual source typed operands on authored host envelopes, not original control flow.',
    'Audio scope is PauseBGM/ReplayBgm; screen scope is ColorFade/Flash; timer discovery includes unsupported/battle variants; motion discovery inventories all Move/MoveTo/Lerp.',
    'Camera classification is syntactic SetPuppet(actor=0) membership. It does not prove dynamic actor flow, loop/raycast/view applicability or source-script callbacks.',
    'The camera source operation keeps its original Site and operands; its authored envelope PC is recorded separately. It runs through the public joined camera puppet task.',
    'Timer callbacks are explicitly authored counters in a controlled namespace. Original callback programs and map-specific story applicability remain unassessed.',
    'Positive expiry uses the public logical field-clock bridge on the same timer owner. Web timing, fades and audio presentation are explicit policies, not native behavior parity.',
    'Non-field, unsupported operands and fixture composition failures remain recorded. No whole source program, browser campaign or original runtime was accepted here.',
    'A runtime drift result cannot nominate this receipt for admission and must be rerun against fixed bytes.',
  ] };
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/story-runtime-capabilities.json'), JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, runtimeStable, counts, families }));
