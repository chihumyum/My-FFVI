// Inspect the entire published source-world inventory through the same
// repository as the game. No map is published, instantiated or admitted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';

const root = resolve(import.meta.dirname, '..'), buildRoot = resolve(root, 'build');
const args = process.argv.slice(2);
let compiled = 'dist';
if (args.length) {
  if (args.length !== 2 || args[0] !== '--compiled' || !args[1] || args[1].startsWith('--'))
    throw new Error('Use plan-story-runtime.mjs [--compiled directory]');
  compiled = args[1];
}
const load = name => import(pathToFileURL(resolve(root, compiled, 'src', name + '.js')));
const [{ GameContentRepository }, { parseGameContentRefs }, { analyzeContentDependencies },
  { hash, canonical }] = await Promise.all([
  'core/game-content', 'core/game-content-refs', 'compiler/content-dependencies', 'compiler/content',
].map(load));
const started = Date.now(), initialRuntime = await runtimeDigest(root, compiled);
const inputFiles = new Map(), physicalBuildRoot = await realpath(buildRoot);
const fileDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, path) => {
  const child = relative(base, path);
  return child.length > 0 && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
};
async function read(url) {
  if (typeof url !== 'string' || !/^\/content-packages\/[a-zA-Z0-9/_-]+\.json$/.test(url) ||
      posix.normalize(url) !== url) throw new Error('Unexpected source content URL: ' + url);
  const path = resolve(buildRoot, '.' + url);
  if (!inside(buildRoot, path)) throw new Error('Content URL leaves build directory');
  const file = await realpath(path);
  if (!inside(physicalBuildRoot, file)) throw new Error('Content symlink leaves build directory');
  const bytes = await readFile(file), sha256 = fileDigest(bytes);
  const prior = inputFiles.get(url);
  if (prior && (prior.path !== file || prior.sha256 !== sha256))
    throw new Error('Source input changed during planning: ' + url);
  inputFiles.set(url, { url, path: file, sha256, bytes: bytes.length });
  return JSON.parse(bytes.toString('utf8'));
}

const refsURL = '/content-packages/source.json';
const refs = parseGameContentRefs(await read(refsURL));
assert.equal(refs.profile, 'source');
assert.ok(refs.source, 'The published collection must retain its strict source lane');
const repository = new GameContentRepository(read, 'source', refs);
const catalog = await repository.world();
const mapIds = Object.keys(catalog.maps).map(key => {
  const id = Number(key);
  assert.ok(Number.isSafeInteger(id) && id > 0 && String(id) === key, 'Noncanonical source map identity');
  return id;
}).sort((a, b) => a - b);
assert.ok(mapIds.length > 0 && new Set(mapIds).size === mapIds.length);
const maps = [];
// Bounded loading preserves all maps, including unavailable geometry. The
// repository verifies actual payload hashes and map/catalog links each time.
for (let cursor = 0; cursor < mapIds.length; cursor += 8) {
  maps.push(...await Promise.all(mapIds.slice(cursor, cursor + 8).map(id => repository.map(id, catalog))));
}
assert.deepEqual(maps.map(map => map.mapId), mapIds, 'A source map was omitted');
const roots = [], mapInventory = [];
for (const map of maps) {
  const scripts = Object.keys(map.scripts).sort();
  for (const script of scripts) roots.push({ kind: 'script', mapId: map.mapId, script });
  const pointIns = map.partyEntry?.pointIns ?? [];
  assert.ok(Array.isArray(pointIns), 'Invalid source PointIn inventory');
  for (const entry of pointIns)
    roots.push({ kind: 'entry', mapId: map.mapId, entrance: entry.id, continuation: null });
  const indexed = catalog.maps[String(map.mapId)], file = inputFiles.get(indexed.url);
  assert.ok(file, 'A map bypassed the verified source reader');
  mapInventory.push({ mapId: map.mapId, areaId: map.areaId, name: map.name,
    url: indexed.url, contentHash: map.contentHash, sha256: file.sha256, bytes: file.bytes,
    sourceSetHash: map.sourceSetHash, parentSourceSetHash: map.parentSourceSetHash,
    mediaSourceSetHash: map.mediaSourceSetHash, geometryPresent: map.map !== null,
    scripts, instructionRecords: Object.values(map.scripts).reduce((total, ops) => total + ops.length, 0),
    pointIns: structuredClone(pointIns), rootless: scripts.length === 0 && pointIns.length === 0 });
}
assert.ok(roots.length > 0, 'The full source inventory has no dependency roots');
// All map-local source script keys and every declared PointIn are roots. The
// graph conservatively scans conditional instructions/groups without deciding
// plot state. No provider observations are supplied or inferred from metadata.
const analysis = analyzeContentDependencies({ catalog, maps, roots, mapIds });

function groups(rows, signature, site) {
  const buckets = new Map();
  rows.forEach((row, index) => {
    const identity = signature(row), key = canonical(identity);
    if (!buckets.has(key)) buckets.set(key, { id: hash(identity), ...identity, sites: [] });
    buckets.get(key).sites.push({ recordIndex: index, ...site(row) });
  });
  const result = [...buckets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, group]) => ({ ...group, count: group.sites.length }));
  assert.equal(result.reduce((count, group) => count + group.sites.length, 0), rows.length,
    'A diagnostic/provider record disappeared during grouping');
  return result;
}
const diagnosticGroups = groups(analysis.diagnostics,
  row => ({ code: row.code, reason: row.reason }),
  row => Object.fromEntries(['mapId', 'script', 'index', 'source'].filter(key => Object.hasOwn(row, key))
    .map(key => [key, structuredClone(row[key])])));
const providerRequirementGroups = groups(analysis.providerRequirements,
  row => ({ capability: row.capability, code: row.code, reason: row.reason, when: row.when }),
  row => ({ mapId: row.mapId, site: structuredClone(row.site) }));
const providerAssessmentGroups = groups(analysis.providerAssessments,
  row => ({ status: row.status, diagnostics: row.diagnostics.map(diagnostic => ({
    capability: diagnostic.capability, code: diagnostic.code, reason: diagnostic.reason, status: diagnostic.status,
  })) }), row => ({ mapId: row.mapId, site: structuredClone(row.site) }));

const reads = [...inputFiles.values()].sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
// Validate retained bytes independently of Repository's cache before emitting
// the receipt. A replaced generation or changed runtime invalidates this run.
for (let cursor = 0; cursor < reads.length; cursor += 16) {
  await Promise.all(reads.slice(cursor, cursor + 16).map(async input => {
    const currentPath = await realpath(resolve(buildRoot, '.' + input.url));
    assert.equal(currentPath, input.path, 'Source content path changed during planning');
    assert.equal(fileDigest(await readFile(currentPath)), input.sha256, 'Source content bytes changed during planning');
  }));
}
assert.equal(await runtimeDigest(root, compiled), initialRuntime, 'Runtime changed during full source-world planning');
const manifest = { kind: 'all-source-world-static-roots-v1', refsURL,
  refsSha256: inputFiles.get(refsURL).sha256, worldContentHash: catalog.contentHash,
  sourceSetHash: catalog.sourceSetHash, parentSourceSetHash: catalog.parentSourceSetHash,
  mediaSourceSetHash: catalog.mediaSourceSetHash, mapIds, roots };
const counts = { maps: mapIds.length, mapLocalScriptKeys: mapInventory.reduce((total, map) => total + map.scripts.length, 0),
  mapLocalInstructionRecords: mapInventory.reduce((total, map) => total + map.instructionRecords, 0),
  pointIns: mapInventory.reduce((total, map) => total + map.pointIns.length, 0),
  roots: roots.length, rootlessMaps: mapInventory.filter(map => map.rootless).length,
  mapsWithoutGeometry: mapInventory.filter(map => !map.geometryPresent).length,
  edges: analysis.edges.length, diagnostics: analysis.diagnostics.length,
  providerRequirements: analysis.providerRequirements.length, providerAssessments: analysis.providerAssessments.length,
  diagnosticGroups: diagnosticGroups.length, providerRequirementGroups: providerRequirementGroups.length,
  providerAssessmentGroups: providerAssessmentGroups.length,
  encounterIds: analysis.encounterIds.length, requiredMapIds: analysis.requiredMapIds.length,
  providerAssessmentReady: analysis.providerAssessments.filter(row => row.status === 'ready').length,
  providerAssessmentConditional: analysis.providerAssessments.filter(row => row.status === 'conditional').length,
  providerAssessmentBlocked: analysis.providerAssessments.filter(row => row.status === 'blocked').length };
const report = { kind: 'story-runtime-plan-v1', result: 'static-planning-complete',
  sourceSetHash: catalog.sourceSetHash, parentSourceSetHash: catalog.parentSourceSetHash,
  mediaSourceSetHash: catalog.mediaSourceSetHash, runtimeSha256: initialRuntime,
  manifestHash: hash(manifest), manifest, contentHashes: {
    world: catalog.contentHash, maps: Object.fromEntries(mapInventory.map(map => [String(map.mapId), map.contentHash])),
  }, inputFiles: reads.map(({ path: _path, ...input }) => input), mapInventory, counts,
  scan: { calls: 1, scope: 'complete-source-world-map-inventory',
    providerContext: { providers: {}, actorKind: 'unknown' },
    contentGeneration: 'existing-published-source-packages', rebuiltForThisRuntime: false },
  analysis, work: { grouping: 'exact-code-reason-and-explicit-capability',
    ownerClassification: 'unassigned-no-owner-inference', diagnosticGroups, providerRequirementGroups, providerAssessmentGroups },
  runtimeAdmission: 'unassessed', sourceStoryReachability: false, sourceCampaignComplete: false,
  browserVerified: false, originalGameExecuted: false, limitations: [
    'Every published source map, map-local script key and source PointIn is inventoried; this is a conservative static graph, not a reachable campaign.',
    'Existing source packages were not rebuilt for this runtime. Checked payload/source identities do not grant migration or runtime admission.',
    'Empty geometry and unknown diagnostics are retained. No missing provider is replaced with a no-op or guessed host.',
    'No provider observations are supplied; conditional/blocked assessments are potential host requirements, not evidence that existing shared owners are absent.',
    'Gap groups preserve every original record/site and use only exact published codes, reasons and explicit capabilities; system ownership is not guessed.',
    'The graph covers compiled field references. Battle/AI providers, media execution, source dynamic selectors, plot applicability and playthrough remain separately unassessed.',
    'Numeric encounter references are retained in full; they are not claims of battle-catalog or encounter readiness.',
  ] };
const output = resolve(root, 'build/reports/story-runtime-plan.json');
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, counts, referenceClosure: analysis.referenceClosure,
  runtimeSha256: initialRuntime, sourceStoryReachability: false, runtimeAdmission: 'unassessed',
  elapsedMs: Date.now() - started, report: output }));
