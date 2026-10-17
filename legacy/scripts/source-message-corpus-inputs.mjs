// One shared verified-input contract for the sequence inventory and VM audit.
// It consumes the full translated artifact; it does not re-decode instructions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';

export function sourceMessageAuditOptions(args, root) {
  const options = { root, compiledDir: 'dist', corpusFile: 'build/story-corpus/corpus.json',
    buildReceipt: 'build/reports/story-corpus-build.json' };
  const names = { '--root': 'root', '--compiled': 'compiledDir', '--corpus': 'corpusFile',
    '--build-receipt': 'buildReceipt', '--report': 'output' }, seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(names[args[i]] && args[i + 1] && !args[i + 1].startsWith('--') && !seen.has(args[i]),
      'Use --root/--compiled/--corpus/--build-receipt/--report <path>');
    seen.add(args[i]); options[names[args[i]]] = args[i + 1];
  }
  options.root = resolve(options.root);
  return options;
}

export async function loadSourceMessageCorpusInputs(options) {
  const { root } = options, compiled = resolve(root, options.compiledDir);
  const load = name => import(pathToFileURL(resolve(compiled, 'src', name + '.js')));
  const [{ loadCorpus }, { loadSystemMessages }, { hash }, { createWebFieldMessageSequencePort }] =
    await Promise.all(['compiler/corpus', 'compiler/system-messages', 'compiler/content', 'core/source-message-sequence'].map(load));
  const toolNames = ['source-message-corpus-inputs.mjs', 'check-source-message-sequence.mjs',
    'check-source-message-sequence-execution.mjs', 'inspect-source-message-sequence.py'];
  const toolBytes = await Promise.all(toolNames.map(name => readFile(resolve(import.meta.dirname, name))));
  const toolFiles = toolNames.map((name, index) => ({ name,
    sha256: createHash('sha256').update(toolBytes[index]).digest('hex') }));
  const runtimeHash = await runtimeDigest(root, compiled);
  const snapshot = await loadCorpus(root), system = await loadSystemMessages(root,
    snapshot.manifest.parentSourceSetHash, snapshot.manifest.sources);
  const digest = value => hash({ assets: value.assets, tables: value.tables, messages: value.messages, manifest: value.manifest });
  const sourceDigest = digest(snapshot), corpusPath = resolve(root, options.corpusFile),
    receiptPath = resolve(root, options.buildReceipt), corpusBytes = await readFile(corpusPath), receiptBytes = await readFile(receiptPath);
  const corpus = JSON.parse(corpusBytes), receipt = JSON.parse(receiptBytes), { contentHash, ...body } = corpus;
  assert.equal(corpus.kind, 'story-corpus-v1'); assert.equal(hash(body), contentHash);
  assert.equal(corpus.sourceSetHash, snapshot.sourceSetHash);
  assert.equal(hash(corpus.manifest), hash(snapshot.manifest));
  assert.equal(corpus.runtimeAdmission, 'unassessed'); assert.equal(corpus.storyReachability, 'unassessed');
  assert.equal(receipt.kind, 'story-corpus-build-v1'); assert.equal(receipt.result, 'passed');
  assert.equal(receipt.contentHash, contentHash); assert.equal(receipt.sourceSetHash, snapshot.sourceSetHash);
  assert.equal(receipt.sourceDigest, sourceDigest);
  assert.equal(receipt.runtimeHash, runtimeHash, 'Story corpus must be rebuilt with this exact runtime/tool/app generation');
  const assets = snapshot.assets.filter(asset => asset.kind === 'script').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(new Set(corpus.scripts.map(program => program.id)).size, corpus.scripts.length);
  assert.deepEqual(corpus.scripts.map(program => program.id).sort(), assets.map(asset => asset.id).sort());
  const byId = new Map(corpus.scripts.map(program => [program.id, program]));
  let count = 0;
  for (const asset of assets) {
    const program = byId.get(asset.id);
    assert.equal(program.rawHash, hash(asset.data)); assert.deepEqual(program.raw, asset.data);
    assert.deepEqual(program.source, asset.source); assert.equal(program.instructions.length, asset.data.Mnemonics.length);
    assert.equal(program.runtimeAdmission, 'unassessed'); assert.equal(program.storyReachability, 'unassessed');
    for (const [index, instruction] of program.instructions.entries()) {
      assert.equal(instruction.site.script, asset.id); assert.equal(instruction.site.index, index);
      assert.equal(hash(instruction.raw), hash(asset.data.Mnemonics[index]));
      assert.equal(instruction.rawPreserved, true); assert.equal(instruction.runtimeAdmission, 'unassessed');
      if (program.domain !== 'field') {
        assert.equal(instruction.operandDecoded, 'unassessed'); assert.equal(instruction.decoded, null);
      } else {
        assert.ok(instruction.decoded); assert.equal(instruction.decoded.script, asset.id);
        assert.equal(instruction.decoded.index, index);
      }
      count++;
    }
  }
  assert.equal(count, corpus.counts.instructions); assert.equal(assets.length, corpus.counts.scripts);
  const policy = createWebFieldMessageSequencePort(), context = policy.prepare().context;
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  return { load, hash, snapshot, system, sourceDigest, corpus, assets, byId, policy, context,
    binding: { runtimeHash, sourceDigest, toolFiles, sourceSetHash: snapshot.sourceSetHash, corpusHash: contentHash,
      corpusBytesSha256: sha(corpusBytes), buildReceiptSha256: sha(receiptBytes), systemMessageSource: system.source },
    async finish() {
      for (const [index, name] of toolNames.entries())
        assert.ok((await readFile(resolve(import.meta.dirname, name))).equals(toolBytes[index]), 'Audit tool changed: ' + name);
      const current = await loadCorpus(root);
      assert.equal(digest(current), sourceDigest, 'Source changed during message audit');
      const currentSystem = await loadSystemMessages(root, current.manifest.parentSourceSetHash, current.manifest.sources);
      assert.equal(hash(currentSystem), hash(system), 'System message bundle changed during audit');
      assert.ok((await readFile(corpusPath)).equals(corpusBytes), 'Translated corpus changed during audit');
      assert.ok((await readFile(receiptPath)).equals(receiptBytes), 'Compiler receipt changed during audit');
      assert.equal(await runtimeDigest(root, compiled), runtimeHash, 'Runtime/app/tools changed during audit');
    } };
}
