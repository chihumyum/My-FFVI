// Pure whole-family source audit. No map producer, source execution or publication.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runtimeDigest } from './runtime-digest.mjs';
const root = resolve(import.meta.dirname, '..'), args = process.argv.slice(2), options = {
  compiledDir: 'dist', output: 'build/reports/source-move-bird-view',
};
while (args.length) {
  const key = args.shift(); assert(['--compiled-dir', '--output'].includes(key) && args[0]);
  options[key === '--compiled-dir' ? 'compiledDir' : 'output'] = args.shift();
}
const compiled = resolve(root, options.compiledDir), out = resolve(root, options.output);
assert(out.startsWith(resolve(root, 'build') + '/'));
const load = name => import(pathToFileURL(resolve(compiled, 'src', name + '.js')).href);
const [{ readSnapshot, snapshotFile }, { loadSystemSource }, { analyzeCorpus }, { hash },
  { decodeFieldOp }, { fieldInstructionRequirements, assessFieldRequirements }] = await Promise.all([
  load('compiler/integrity'), load('compiler/system-source'), load('compiler/corpus'), load('compiler/content'),
  load('compiler/field'), load('core/field-content-admission'),
]);
const runtime = await runtimeDigest(root, compiled), corpus = JSON.parse(snapshotFile(await readSnapshot(resolve(root, 'build/corpus')), 'corpus.json').toString());
const snapshot = await loadSystemSource(root, corpus.parentSourceSetHash), programs = snapshot.assets.filter(p => p.kind === 'script');
assert.equal(programs.length, 3304); assert.equal(programs.reduce((n, p) => n + p.data.Mnemonics.length, 0), 186003);
const selected = programs.filter(p => p.data.Mnemonics.some(op => op.mnemonic === 'MoveBirdView')), sites = [];
for (const p of selected) for (const [pc, raw] of p.data.Mnemonics.entries()) {
  if (raw.mnemonic !== 'MoveBirdView') continue;
  const typed = decodeFieldOp(raw, { script: p.id, index: pc, source: { ...p.source, pointer: '/Mnemonics/' + pc } }, snapshot.messages, snapshot.reader);
  assert.equal(typed.kind, 'field-bird-view-move', 'Complete original operand family must decode: ' + p.id + ':' + pc);
  const requirements = fieldInstructionRequirements(typed), noInstanceAdmission = assessFieldRequirements(requirements, { providers: {}, actorKind: 'unknown' });
  assert.notEqual(noInstanceAdmission.status, 'ready', 'Static decoding cannot invent an actual actor/controller');
  sites.push({ programId: p.id, source: p.source, rawHash: hash(p.data), pc, raw, typed, requirements, noInstanceAdmission });
}
const counts = { allPhysicalPrograms: programs.length, allRawInstructions: 186003,
  selectedPrograms: selected.length, selectedInstructions: selected.reduce((n, p) => n + p.data.Mnemonics.length, 0),
  sites: sites.length, delegatedMove: sites.filter(s => s.typed.command.move !== null).length,
  heightOnly: sites.filter(s => s.typed.command.move === null).length,
  positiveDuration: sites.filter(s => s.typed.command.duration > 0).length,
  negativeDuration: sites.filter(s => s.typed.command.duration < 0).length,
  readyWithoutInstance: sites.filter(s => s.noInstanceAdmission.status === 'ready').length,
};
assert.deepEqual(counts, { allPhysicalPrograms: 3304, allRawInstructions: 186003, selectedPrograms: 16,
  selectedInstructions: 2959, sites: 68, delegatedMove: 66, heightOnly: 2, positiveDuration: 2, negativeDuration: 0, readyWithoutInstance: 0 });
const analysis = analyzeCorpus(snapshot.assets, snapshot.tables, snapshot.messages, snapshot.sourceSetHash);
const payload = { kind: 'whole-source-move-bird-view-audit-v1', runtimeSha256: runtime,
  sourceSetHash: snapshot.sourceSetHash, parentSourceSetHash: snapshot.manifest.parentSourceSetHash,
  sourceDigest: hash({ assets: snapshot.assets, tables: snapshot.tables, messages: snapshot.messages, manifest: snapshot.manifest }),
  counts, completeSelectedPrograms: selected.map(p => ({ ...p, rawHash: hash(p.data) })), sites,
  allProgramBindings: programs.map(p => ({ id: p.id, source: p.source, rawHash: hash(p.data), instructions: p.data.Mnemonics.length })),
  completeCorpusAnalysis: analysis, sourceExecutions: 0, worldCompilations: 0, publications: 0,
  nativeDynamicParity: false, sourceCampaignComplete: false,
  limitations: ['All68 source shapes decode; actual actor, map loop, forms, collision and animation providers remain independent gates.',
    'Web actor elevation is an explicitly created component, not a recovered Unity BirdViewPuppet registry.',
    'Stable numeric poses require trusted content and runtime policy; save data grants no capability.'],
};
await mkdir(out, { recursive: true });
const file = resolve(out, 'inventory.json'), bytes = Buffer.from(JSON.stringify(payload) + '\n'); await writeFile(file, bytes);
assert.equal(await runtimeDigest(root, compiled), runtime, 'Runtime changed during pure source audit');
const report = { kind: payload.kind, result: 'passed-static-complete-family-not-source-execution', runtimeSha256: runtime, counts,
  artifact: { path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  sourceExecutions: 0, worldCompilations: 0, publications: 0, sourceCampaignComplete: false };
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
