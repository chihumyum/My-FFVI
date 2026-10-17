// Exact same-source registration audit. This module grants neither source
// program admission nor a live shop permission; the shared owner still validates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function ownData(value, label) {
  assert.ok(plain(value), 'Invalid ' + label);
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor =>
    descriptor.enumerable && Object.hasOwn(descriptor, 'value')), label + ' requires own data fields');
}
function dense(value, label) {
  assert.ok(Array.isArray(value), label + ' must be an array');
  assert.equal(Reflect.ownKeys(value).length, value.length + 1, label + ' must be dense own data');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    assert.ok(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), label + ' must be dense own data');
  }
}
/** Native rows must come from the independently byte-verified audit below.
 * The pure comparison preserves exact selector identity, including punctuation,
 * phase and leader variants. Presence in a native dictionary never substitutes
 * for an available product_group row or runtime shop-owner preparation. */
export function assertNamedShopBindings(actual, verified, availableGroupIds) {
  dense(actual, 'Compiled named shop bindings'); dense(verified, 'Verified named shop bindings');
  dense(availableGroupIds, 'Source product groups');
  const groups = new Set();
  for (const id of availableGroupIds) {
    assert.ok(Number.isSafeInteger(id) && id > 0, 'Invalid source product group');
    assert.ok(!groups.has(id), 'Duplicate source product group'); groups.add(id);
  }
  const expected = new Map();
  for (const row of verified) {
    ownData(row, 'verified named shop binding');
    assert.ok(typeof row.selector === 'string' && row.selector.length > 0, 'Invalid verified shop selector');
    assert.ok(Number.isSafeInteger(row.groupId) && row.groupId > 0, 'Invalid verified shop group');
    assert.ok(!expected.has(row.selector), 'Duplicate verified shop selector'); expected.set(row.selector, row.groupId);
  }
  const seen = new Set();
  for (const row of actual) {
    ownData(row, 'compiled named shop binding');
    assert.deepEqual(Reflect.ownKeys(row).sort(), ['groupId', 'selector'], 'Unknown compiled shop binding fields');
    assert.ok(typeof row.selector === 'string' && row.selector.length > 0, 'Invalid compiled shop selector');
    assert.ok(!seen.has(row.selector), 'Duplicate compiled shop selector'); seen.add(row.selector);
    assert.ok(expected.has(row.selector), 'Unverified compiled shop selector: ' + row.selector);
    assert.equal(row.groupId, expected.get(row.selector), 'Source shop binding changed: ' + row.selector);
    assert.ok(groups.has(row.groupId), 'Dangling source product group: ' + row.groupId);
  }
  assert.equal(seen.size, expected.size, 'Missing compiled named shop selector');
  return { selectors: seen.size, sourceGroups: groups.size, result: 'passed' };
}

export async function checkNamedShopBindings({ root, compiledDir, output }) {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const modulePath = resolve(root, compiledDir, 'src/compiler/field-script-shop.js');
  const compilerSha256 = sha(await readFile(modulePath));
  const evidenceFile = output + '.native.json';
  await mkdir(resolve(output, '..'), { recursive: true });
  execFileSync(resolve(root, '.venv/bin/python'), [resolve(import.meta.dirname, 'inspect-named-shop-bindings.py'),
    '--root', root, '--output', evidenceFile], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const evidenceBytes = await readFile(evidenceFile), evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.kind, 'named-shop-native-bindings-v1'); assert.equal(evidence.status, 'passed');
  assert.equal(evidence.bindings.filter(row => row.phase === 'new').length, 17);
  assert.equal(evidence.bindings.filter(row => row.phase === 'existing').length, 8);
  const load = name => import(pathToFileURL(resolve(root, compiledDir, 'src', name + '.js')));
  const [{ loadCorpus }, { compileFieldScriptShopInstruction, fieldScriptShopSelectors }, { hash }] = await Promise.all([
    load('compiler/corpus'), load('compiler/field-script-shop'), load('compiler/content')]);
  const snapshot = await loadCorpus(root);
  assert.equal(snapshot.manifest.sources.find(source => source.file === 'GameAssembly.dll')?.sha256, evidence.identity.nativeSha256);
  const groupRows = snapshot.tables['product_group.csv'];
  assert.ok(Array.isArray(groupRows), 'Missing source product_group.csv');
  const sourceGroups = groupRows.map(row => Number(row.id));
  const raw = selector => ({ type: 1, mnemonic: 'SysCall', operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0),
    sValues: [selector, ...Array(7).fill('')] } });
  const compiled = fieldScriptShopSelectors.map(selector => {
    const op = compileFieldScriptShopInstruction(raw(selector));
    return { selector: op.selector, groupId: op.groupId };
  });
  const result = assertNamedShopBindings(compiled, evidence.bindings, sourceGroups);
  const cases = [];
  for (const script of snapshot.assets.filter(asset => asset.kind === 'script'))
    for (const [index, instruction] of script.data.Mnemonics.entries()) {
      const selector = instruction.operands?.sValues?.[0];
      if (instruction.mnemonic !== 'SysCall' || !evidence.bindings.some(row => row.selector === selector)) continue;
      cases.push({ script: script.id, index, source: { ...script.source, pointer: '/Mnemonics/' + index },
        raw: instruction, decoded: compileFieldScriptShopInstruction(instruction), runtimeAdmission: 'unassessed' });
    }
  for (const [key, path] of Object.entries(evidence.sourceFiles))
    assert.equal(sha(await readFile(resolve(root, path))), evidence.identity[key], 'Source byte drift');
  assert.equal(sha(await readFile(modulePath)), compilerSha256, 'Named shop compiler changed during audit');
  const report = { kind: 'named-shop-binding-check-v1', result: result.result,
    sourceSetHash: snapshot.sourceSetHash, parentSourceSetHash: snapshot.manifest.parentSourceSetHash,
    compilerSha256, nativeEvidenceSha256: sha(evidenceBytes),
    counts: { ...result, newBindings: 17, previousBindings: 8, rawSourceCases: cases.length },
    compiled, sourceGroupRows: groupRows, nativeEvidence: evidence, cases,
    runtimeAdmission: 'unassessed', sourceStoryReachability: false, sourceCampaignComplete: false,
    originalGameExecuted: false, semanticsVerified: false };
  await writeFile(output, JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = { root: resolve(import.meta.dirname, '..'), compiledDir: 'dist' };
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(args[index + 1], 'Missing named shop checker argument');
    const key = { '--root': 'root', '--compiled': 'compiledDir', '--output': 'output' }[args[index]];
    assert.ok(key, 'Unknown named shop checker option'); options[key] = args[index + 1];
  }
  options.root = resolve(options.root); options.output ??= resolve(options.root, 'build/reports/named-shop-binding-check.json');
  const report = await checkNamedShopBindings(options);
  console.log(JSON.stringify({ result: report.result, counts: report.counts, output: options.output }));
}
