// Source import metadata audit. Static cohort counts are not VM executions,
// map admission, original-game parity, or source-story reachability.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const attempt = callback => { try { return { status: 'compiled', value: callback() }; }
  catch (error) { return { status: 'rejected', error: String(error) }; } };

export async function checkSourceSystemFlags({ root, compiledDir = 'dist', output }) {
  const runtimeModule = pathToFileURL(resolve(root, 'scripts/runtime-digest.mjs')).href;
  const { runtimeDigest } = await import(runtimeModule);
  const runtimeSha256 = await runtimeDigest(root, compiledDir);
  const selfPaths = [import.meta.filename, resolve(import.meta.dirname, 'inspect-source-system-flags.py')];
  const toolFiles = await Promise.all(selfPaths.map(async path => ({ path: relative(root, path), sha256: sha(await readFile(path)) })));
  const load = name => import(pathToFileURL(resolve(root, compiledDir, 'src/compiler', name + '.js')).href);
  const [{ loadCorpus, analyzeCorpus }, { hash, canonical }, { readSnapshot }, { loadSystemMessages },
    { compileFieldPuppetScriptContext }, { decodeConditionVisualFlag }, codec] = await Promise.all([
    'corpus', 'content', 'integrity', 'system-messages', 'field-puppet-actors', 'field', 'source-system-flags'].map(load));
  const snapshots = [];
  for (const name of ['corpus', 'field']) {
    const path = resolve(root, 'build', name, 'snapshot.json'), bytes = await readFile(path);
    await readSnapshot(resolve(root, 'build', name));
    snapshots.push({ name, path: relative(root, path), sha256: sha(bytes) });
  }
  const corpus = await loadCorpus(root), system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources);
  const analysis = analyzeCorpus(corpus.assets, corpus.tables, { ...corpus.messages, system_zhc: system.messages }, corpus.sourceSetHash);
  const nativePath = output + '.native.json';
  await mkdir(resolve(output, '..'), { recursive: true });
  execFileSync(resolve(root, '.venv/bin/python'), [selfPaths[1], '--root', root, '--output', nativePath],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const nativeBytes = await readFile(nativePath), native = JSON.parse(nativeBytes);
  assert.equal(native.kind, 'source-system-flags-native-import-v1');
  assert.equal(native.result, 'passed-static-import-and-api-contract');
  assert.equal(native.sourceSetHash, corpus.sourceSetHash);
  assert.equal(native.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  for (const key of ['nativeSha256', 'symbolsSha256', 'headerSha256'])
    assert.equal(codec.SOURCE_FORMAT_FLAG_IMPORT[key], native.identity[key]);
  assert.equal(codec.SOURCE_FORMAT_FLAG_IMPORT.unityVersion, native.unityVersion.value);
  assert.equal(codec.SOURCE_FORMAT_FLAG_IMPORT.api, native.apiContract.url);
  assert.equal(codec.SOURCE_FORMAT_FLAG_IMPORT.genericMethodMetadataRva, '0x' + native.genericContext.Address.toString(16));
  assert.equal(codec.SOURCE_FORMAT_FLAG_IMPORT.loaderRva, '0x5f2530');
  assert.deepEqual(codec.SOURCE_SYSTEM_FLAG_KEYS, native.nativeFieldLayout.map(row => row.field));

  // Source manifests are compiler inputs, never self-authenticating permission.
  // Freshly hash every listed supplied original file at both ends as well as
  // the existing extracted snapshots, rather than trusting a WIP receipt.
  const sourceRoot = resolve(root, 'build/runtime/game'), sourceRows = corpus.manifest.sources;
  const sourceFiles = [];
  assert.ok(Array.isArray(sourceRows));
  async function verifyOriginals(first) {
    const seen = new Set();
    for (const row of sourceRows) {
      assert.ok(typeof row.file === 'string' && !row.file.includes('\\') && !row.file.split('/').includes('..'));
      assert.ok(!seen.has(row.file), 'Duplicate original source path'); seen.add(row.file);
      const path = resolve(sourceRoot, row.file); assert.ok(path.startsWith(sourceRoot + sep));
      const digest = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(path)) { digest.update(chunk); bytes += chunk.length; }
      const actual = digest.digest('hex'); assert.equal(actual, row.sha256, 'Original source changed: ' + row.file);
      assert.equal(bytes, row.bytes, 'Original source size changed: ' + row.file);
      if (first) sourceFiles.push({ file: row.file, sha256: actual, bytes });
    }
  }
  await verifyOriginals(true);
  const misc = corpus.assets.filter(asset => asset.source.assetPath.endsWith('/serial_misc_assets.json'));
  assert.equal(misc.length, 1, 'Ambiguous physical source misc');
  const reports = new Map(analysis.scripts.map(row => [row.id, row])), rows = [], shapes = new Map();
  const fields = Object.fromEntries(codec.SOURCE_SYSTEM_FLAG_KEYS.map(key => [key, { present: 0, omitted: 0, values: {} }]));
  for (const asset of corpus.assets.filter(asset => asset.kind === 'script')) {
    const original = canonical(asset.data), report = reports.get(asset.id); assert.ok(report);
    const rawFlags = asset.data.SystemFlag, own = Object.hasOwn(asset.data, 'SystemFlag');
    const object = own && rawFlags !== null && typeof rawFlags === 'object' && !Array.isArray(rawFlags);
    const missing = codec.SOURCE_SYSTEM_FLAG_KEYS.filter(key => !object || !Object.hasOwn(rawFlags, key));
    const shape = !own ? 'object-omitted' : rawFlags === null ? 'object-null' : !object ? 'object-' + typeof rawFlags : Object.keys(rawFlags).sort().join(',');
    const form = shapes.get(shape) ?? { shape, scripts: 0, fieldBoundScripts: 0 };
    form.scripts++; if (report.maps.length) form.fieldBoundScripts++; shapes.set(shape, form);
    for (const key of codec.SOURCE_SYSTEM_FLAG_KEYS) {
      const row = fields[key], present = object && Object.hasOwn(rawFlags, key); row[present ? 'present' : 'omitted']++;
      if (present) { const value = typeof rawFlags[key] + ':' + JSON.stringify(rawFlags[key]); row.values[value] = (row.values[value] ?? 0) + 1; }
    }
    // The maintained unbound API is the strict legacy lane, not a stale copy.
    const before = attempt(() => compileFieldPuppetScriptContext(asset.data, misc[0].data));
    const binding = codec.bindSourceFormatFlags({ sourceSetHash: corpus.sourceSetHash,
      parentSourceSetHash: corpus.manifest.parentSourceSetHash, sources: sourceRows }, asset);
    assert.deepEqual(binding.source, asset.source); assert.equal(binding.rawScriptHash, hash(asset.data));
    const projection = attempt(() => codec.decodeSourceSystemFlags(asset.data, binding));
    const after = attempt(() => compileFieldPuppetScriptContext(asset.data, misc[0].data, binding));
    const visualBefore = attempt(() => decodeConditionVisualFlag(asset.data));
    const visualAfter = attempt(() => decodeConditionVisualFlag(asset.data, binding));
    assert.equal(canonical(asset.data), original, 'Import mutated original raw JSON');
    if (before.status === 'compiled') assert.deepEqual(after, before, 'Explicit legacy context changed');
    if (!object) assert.equal(after.status, 'rejected', 'Whole-object omission granted source context');
    if (projection.status === 'compiled') {
      assert.deepEqual(projection.value.defaulted, missing);
      for (const key of codec.SOURCE_SYSTEM_FLAG_KEYS)
        assert.equal(projection.value.values[key], Object.hasOwn(rawFlags, key) ? rawFlags[key] : 0);
    }
    if (after.status === 'compiled') {
      assert.equal(after.value.scriptHash, hash(asset.data)); assert.equal(after.value.miscHash, hash(misc[0].data));
    }
    rows.push({ id: asset.id, source: asset.source, rawHash: hash(asset.data), maps: report.maps,
      sourceInstructions: report.instructions, wholeProgramDiagnostics: report,
      rawSystemFlag: own ? rawFlags : { absent: true }, missing,
      before, after, visualBefore, visualAfter, importProjection: projection,
      changed: canonical(before) !== canonical(after), visualChanged: canonical(visualBefore) !== canonical(visualAfter) });
  }
  for (const snapshot of snapshots) {
    assert.equal(sha(await readFile(resolve(root, snapshot.path))), snapshot.sha256, 'Extracted snapshot header changed');
    await readSnapshot(resolve(root, 'build', snapshot.name));
  }
  await verifyOriginals(false);
  for (const [key, path] of Object.entries(native.sourceFiles)) assert.equal(sha(await readFile(resolve(root, path))), native.identity[key]);
  assert.equal(sha(await readFile(nativePath)), sha(nativeBytes), 'Native evidence changed');
  for (const tool of toolFiles) assert.equal(sha(await readFile(resolve(root, tool.path))), tool.sha256, 'Audit tool changed');
  assert.equal(await runtimeDigest(root, compiledDir), runtimeSha256, 'Runtime changed during audit');
  const counts = { scripts: rows.length, fieldBoundScripts: rows.filter(row => row.maps.length).length,
    explicitContextsUnchanged: rows.filter(row => row.before.status === 'compiled').length,
    importedContexts: rows.filter(row => row.after.status === 'compiled').length,
    newlyImportedContexts: rows.filter(row => row.before.status === 'rejected' && row.after.status === 'compiled').length,
    newlyImportedFieldContexts: rows.filter(row => row.maps.length && row.before.status === 'rejected' && row.after.status === 'compiled').length,
    stillRejected: rows.filter(row => row.after.status === 'rejected').length,
    stillRejectedFieldContexts: rows.filter(row => row.maps.length && row.after.status === 'rejected').length,
    visualProjectionsChanged: rows.filter(row => row.visualChanged).length,
    visualProjectionsChangedField: rows.filter(row => row.maps.length && row.visualChanged).length };
  const result = { kind: 'source-system-flags-cohort-check-v1', result: 'passed-import-contract-only', counts,
    sourceInputLock: { sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
      runtimeSha256, compiledDir, snapshots, originalSourceFileCount: sourceFiles.length,
      originalSourceFilesHash: hash(sourceFiles), nativeEvidenceSha256: sha(nativeBytes), toolFiles },
    analysisHash: analysis.contentHash, analysisCounts: analysis.counts, allDependencies: analysis.dependencies,
    mapDiagnostics: analysis.maps, capabilityDiagnostics: analysis.priorities,
    systemMessagesSource: system.source, miscSource: misc[0].source,
    contract: codec.SOURCE_FORMAT_FLAG_IMPORT, nativeEvidence: native,
    sourceFiles, shapes: [...shapes.values()].sort((a, b) => b.scripts - a.scripts), fields, rows,
    runtimeAdmission: 'unassessed', originalGameExecuted: false, sourceStoryReachability: false,
    limitations: ['Static source metadata import only; field-bound counts are not playable map coverage.',
      'Missing/null whole objects and bad explicit members remain rejected; original raw hashes are preserved.',
      'No saved/authored/development content grants this compiler import binding.',
      'Source manifest/binding hashes detect drift; trusted loader provenance is a compiler call-boundary requirement.'] };
  await writeFile(output, JSON.stringify({ ...result, contentHash: hash(result) }, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = { root: process.cwd(), compiledDir: 'dist' };
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--root': 'root', '--compiled': 'compiledDir', '--output': 'output' }[args[i]];
    assert.ok(key && args[i + 1], 'Invalid source SystemFlag checker argument'); options[key] = args[i + 1];
  }
  options.root = resolve(options.root); options.output ??= resolve(options.root, 'build/reports/source-system-flags-check.json');
  options.output = resolve(options.root, options.output);
  const report = await checkSourceSystemFlags(options);
  console.log(JSON.stringify({ result: report.result, counts: report.counts, output: options.output }));
}
