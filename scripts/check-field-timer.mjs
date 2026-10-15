// Whole source timer-family inventory and pure Web-clock candidates. This is
// not a source scene, campaign, browser or native behavior acceptance.
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
    throw new Error('Use check-field-timer.mjs [--compiled directory]');
  compiled = args[1];
}
const load = name => import(pathToFileURL(resolve(root, compiled, 'src', name + '.js')));
const [{ loadCorpus, analyzeCorpus }, { compileFieldTimerInstruction, fieldTimerMnemonics, fieldTimerSelectors },
  timer, { bindMapPackages, resolveMapScript }, { hash }, { loadSystemMessages }] = await Promise.all([
  'compiler/corpus', 'compiler/field-timer', 'core/field-timer', 'compiler/map-package',
  'compiler/content', 'compiler/system-messages',
].map(load));
const corpus = await loadCorpus(root);
const messages = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources);
const analysis = analyzeCorpus(corpus.assets, corpus.tables,
  { ...corpus.messages, system_zhc: messages.messages }, corpus.sourceSetHash);
const reports = new Map(analysis.scripts.map(script => [script.id, script]));
const byId = new Map(corpus.assets.map(asset => [asset.id, asset]));
const byMap = new Map(bindMapPackages(corpus.assets, corpus.tables).map(map => [map.id, map]));
const nativeDir = resolve(root, 'build/native/web-field-timer-closed');
const receipt = JSON.parse(await readFile(resolve(nativeDir, 'complete.json'), 'utf8'));
assert.equal(receipt.status, 'complete'); assert.equal(receipt.semanticsVerified, false);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(receipt.nativeSha256, corpus.manifest.sources.find(source => source.file === 'GameAssembly.dll')?.sha256);
for (const [key, path] of Object.entries({ nativeSha256: 'build/runtime/game/GameAssembly.dll',
  symbolsSha256: 'build/native/il2cpp/script.json', headerSha256: 'build/native/il2cpp/il2cpp_ghidra.h' }))
  assert.equal(sha(await readFile(resolve(root, path))), receipt[key]);
for (const method of receipt.methods)
  assert.equal(sha(await readFile(resolve(nativeDir, method.rva.slice(2) + '.c'))), method.decompiledSha256);
assert.equal(receipt.methods.length, 12);

const families = {}, inventory = [], callbackBindings = [], lifecycleCases = [], programIds = new Set();
for (const asset of corpus.assets.filter(asset => asset.kind === 'script').sort((a, b) => a.id.localeCompare(b.id))) {
  const report = reports.get(asset.id);
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    const selector = raw.operands?.sValues?.[0] ?? '';
    // Discovery only: broad timer names remain inventoried and unsupported;
    // instruction admission uses the exact compiler selector allowlist.
    const family = raw.mnemonic === 'SysCall' ? 'SysCall:' + selector : raw.mnemonic;
    if (!(fieldTimerMnemonics.includes(raw.mnemonic) || /Timer/.test(raw.mnemonic) ||
        raw.mnemonic === 'SysCall' && /タイマー|時間切れ/.test(selector))) continue;
    const stats = families[family] ??= { total: 0, decoded: 0, blocked: 0, unassessed: 0 };
    stats.total++;
    programIds.add(asset.id);
    const site = { script: asset.id, index, source: { ...asset.source, pointer: '/Mnemonics/' + index } };
    const row = { site, raw, family, maps: [...report.maps], instructionHash: hash(raw) };
    if (report.domain !== 'field') {
      stats.unassessed++;
      inventory.push({ ...row, status: 'unassessed', domain: report.domain });
      continue;
    }
    let op;
    try { op = compileFieldTimerInstruction(raw); }
    catch (error) {
      stats.blocked++;
      inventory.push({ ...row, status: 'blocked', diagnostic: { code: 'FIELD_TIMER_SOURCE_UNSUPPORTED',
        reason: error instanceof Error ? error.message : String(error) } });
      continue;
    }
    stats.decoded++;
    inventory.push({ ...row, status: 'operand-decoded', op, runtimeAdmission: 'unassessed' });
    if (op.command.kind !== 'set') continue;
    for (const mapId of report.maps) {
      const map = byMap.get(mapId);
      for (const name of op.command.callbackScripts) {
        const targetId = resolveMapScript(map, name), target = targetId === null ? null : byId.get(targetId);
        const reference = { site, mapId: Number(mapId), name, targetId,
          source: target?.source ?? null, rawHash: target ? hash(target.data) : null,
          resolution: target ? 'resolved' : 'unresolved' };
        callbackBindings.push(reference);
        if (!target || op.command.callbackScripts.length !== 1) continue;
        // Controlled mapContentHash binds this pure source candidate only. It
        // is not the published map hash or permission to execute its callback.
        const binding = { sourceSetHash: corpus.sourceSetHash, mapId: Number(mapId),
          mapContentHash: hash({ kind: 'controlled-source-timer-map-v1', map }), site,
          callback: { name, source: target.source } };
        const initial = timer.createFieldTimer(timer.WEB_FIELD_TIMER_POLICY, corpus.sourceSetHash);
        let state = timer.prepareFieldTimerCommand(initial, { ...op, ...site }, binding).snapshot;
        const halfway = Math.floor(state.active.durationMs / 2);
        state = timer.advanceFieldTimer(state, halfway, 'player');
        state = timer.prepareFieldTimerCommand(state, { kind: 'field-timer', command: { kind: 'pause' } }).snapshot;
        assert.deepEqual(timer.advanceFieldTimer(state, 900000, 'player'), state);
        const copied = timer.cloneFieldTimer(state);
        state = timer.restoreFieldTimer(JSON.parse(JSON.stringify(copied)), {
          sourceSetHash: corpus.sourceSetHash, policy: timer.WEB_FIELD_TIMER_POLICY, binding,
        });
        state = timer.prepareFieldTimerCommand(state, { kind: 'field-timer', command: { kind: 'resume' } }).snapshot;
        state = timer.advanceFieldTimer(state, state.active.durationMs - halfway, 'player');
        const pending = timer.pendingFieldTimerCallback(state);
        assert.ok(pending);
        assert.deepEqual(timer.pendingFieldTimerCallback(timer.cloneFieldTimer(state)), pending,
          'Failed map/callback preparation must not consume pending expiry');
        state = timer.acknowledgeFieldTimerCallback(state, pending);
        assert.equal(timer.pendingFieldTimerCallback(state), null);
        assert.throws(() => timer.acknowledgeFieldTimerCallback(state, pending), /Stale/);
        const restored = timer.restoreFieldTimer(JSON.parse(JSON.stringify(state)), {
          sourceSetHash: corpus.sourceSetHash, policy: timer.WEB_FIELD_TIMER_POLICY, binding,
        });
        assert.equal(timer.pendingFieldTimerCallback(restored), null);
        lifecycleCases.push({ site, mapId: Number(mapId), callback: reference, command: op.command,
          ticks: [halfway, state.active.durationMs - halfway], pausedMsExcluded: 900000,
          before: initial, after: restored, result: 'passed', callbackActuallyExecuted: false });
      }
    }
  }
}
const programs = [...programIds].sort().map(id => {
  const asset = byId.get(id), report = reports.get(id);
  return { id, source: asset.source, rawHash: hash(asset.data), raw: asset.data, domain: report.domain,
    maps: report.maps, instructions: asset.data.Mnemonics.length,
    runtimeAdmission: 'unassessed', sourceStoryReachability: false };
});
const counts = { sourceScripts: analysis.counts.scripts, affectedCompletePrograms: programs.length,
  timerFamilySites: inventory.length, operandDecoded: inventory.filter(row => row.status === 'operand-decoded').length,
  ordinaryFieldPrograms: new Set(inventory.filter(row => row.status === 'operand-decoded').map(row => row.site.script)).size,
  ordinaryFieldMaps: new Set(inventory.filter(row => row.status === 'operand-decoded').flatMap(row => row.maps)).size,
  blocked: inventory.filter(row => row.status === 'blocked').length,
  unassessed: inventory.filter(row => row.status === 'unassessed').length,
  setTimerSites: inventory.filter(row => row.family === 'SetTimer').length,
  resolvedMapCallbackBindings: callbackBindings.filter(row => row.resolution === 'resolved').length,
  unresolvedMapCallbackBindings: callbackBindings.filter(row => row.resolution === 'unresolved').length,
  controlledLifecycleCases: lifecycleCases.length,
  ordinarySelectorFamilies: [...fieldTimerMnemonics, ...fieldTimerSelectors.map(selector => 'SysCall:' + selector)].length };
assert.equal(counts.timerFamilySites, counts.operandDecoded + counts.blocked + counts.unassessed);
assert.equal(inventory.filter(row => row.family === 'SetTimer' && row.status === 'operand-decoded').length, 27);
assert.ok(lifecycleCases.length > 0);
const report = { kind: 'source-field-timer-check-v1', result: 'pure-source-candidates-passed',
  sourceSetHash: corpus.sourceSetHash, policy: timer.WEB_FIELD_TIMER_POLICY,
  runtimeSha256: await runtimeDigest(root, compiled), counts, families, inventory, programs, callbackBindings, lifecycleCases,
  nativeEvidence: receipt, runtimeAdmission: 'unassessed', sourceStoryReachability: false,
  browserVerified: false, originalGameExecuted: false, semanticsVerified: false,
  limitations: [
    'Complete source programs are preserved for batch nomination; only timer instructions and controlled pure candidates are executed here.',
    'Web logical milliseconds and ceiling-second presentation are explicit policy; native float deltaTime, lotteries and host callback arbitration are not certified.',
    'Callback names resolve by existing exact map/Resident aliases. No same-name global lookup or source story applicability is inferred.',
    'The controlled binding digest is not a published map hash; successful pure preparation cannot authorize a live game callback.',
    'Battle and unbound timer instructions remain unassessed by this field compiler; separate Cid, Shadow, defeat and display selectors remain explicit gaps.',
    'Map/session publication, callback execution, cross-owner save integration and original playthrough require separate shared-owner evidence.',
  ] };
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/field-timer-check.json'), JSON.stringify({ ...report,
  contentHash: hash(report) }, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, counts, families }));
