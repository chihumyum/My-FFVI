// One lossless compilation of all source programs. This private artifact does
// not replace the app's content collection or grant runnable-story admission.
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';

const root = resolve(import.meta.dirname, '..');
const load = name => import(pathToFileURL(resolve(root, 'dist/src/compiler', name + '.js')));
const [{ loadCorpus }, { compileStoryCorpus }, { loadSystemMessages }, { canonical, hash }] = await Promise.all([
  'corpus', 'story-corpus', 'system-messages', 'content',
].map(load));
const started = Date.now(), runtimeHash = await runtimeDigest(root, resolve(root, 'dist'));
const snapshot = await loadCorpus(root);
const system = await loadSystemMessages(root, snapshot.manifest.parentSourceSetHash, snapshot.manifest.sources);
const sourceDigest = hash({ assets: snapshot.assets, tables: snapshot.tables, messages: snapshot.messages, manifest: snapshot.manifest });
const corpus = compileStoryCorpus({ ...snapshot, messages: { ...snapshot.messages, system_zhc: system.messages } });
const output = resolve(root, 'build/story-corpus/corpus.json'), temporary = output + '.' + process.pid + '.candidate';
await mkdir(resolve(root, 'build/story-corpus'), { recursive: true });
try {
  await writeFile(temporary, JSON.stringify(corpus) + '\n');
  const decoded = JSON.parse(await readFile(temporary, 'utf8'));
  const { contentHash, ...payload } = decoded;
  assert.equal(contentHash, hash(payload), 'Serialized full-story corpus changed');
  assert.deepEqual(decoded.counts, corpus.counts);
  const current = await loadCorpus(root);
  assert.equal(hash({ assets: current.assets, tables: current.tables, messages: current.messages, manifest: current.manifest }),
    sourceDigest, 'Source snapshot changed during full-story compilation');
  const currentSystem = await loadSystemMessages(root, current.manifest.parentSourceSetHash, current.manifest.sources);
  assert.equal(canonical(currentSystem), canonical(system), 'System message bindings changed during compilation');
  assert.equal(await runtimeDigest(root, resolve(root, 'dist')), runtimeHash, 'Compiler/runtime changed during compilation');
  await rename(temporary, output);
} finally { await rm(temporary, { force: true }); }
const report = { kind: 'story-corpus-build-v1', result: 'passed', artifact: 'build/story-corpus/corpus.json',
  contentHash: corpus.contentHash, sourceSetHash: corpus.sourceSetHash, sourceDigest, runtimeHash,
  elapsedMs: Date.now() - started, counts: corpus.counts, rawPreserved: true,
  runtimeAdmission: 'unassessed', sourceStoryReachability: false, sourceCampaignComplete: false,
  publicContentPublished: false, browserVerified: false, originalGameExecuted: false };
await mkdir(resolve(root, 'build/reports'), { recursive: true });
await writeFile(resolve(root, 'build/reports/story-corpus-build.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
