// Inspect the entire published source-world inventory through the same
// repository as the game. No map is published, instantiated or admitted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';

const root = resolve(import.meta.dirname, '..'), buildRoot = resolve(root, 'build');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const publicationStages = ['compile-private-candidate', 'validate-all-package-closures',
  'validate-complete-json-and-media-archive', 'archive-published-before-publication',
  'validate-retained-CAS-compatibility', 'validate-unchanged-inputs', 'publish-complete-collection',
  'archive-published-after-publication', 'verify-published-source-objects'];

/** Read-only provenance assessment. A failed/missing publication or incomplete
 * proof cannot fail the static graph, or turn matching timestamps/one entry
 * into evidence that every source map was rebuilt by the scanned runtime. */
export function assessStoryRuntimePublication({ receipt, runtimeSha256, compiledDirectory,
  refs, manifest, inputFiles, mapInventory, canonical, receiptStable = true }) {
  const unknown = reason => ({ status: 'unassessed', rebuiltForThisRuntime: 'unassessed', reasons: [reason] });
  try {
    if (!receipt || typeof receipt !== 'object') return unknown('publication-receipt-unavailable');
    if (!receiptStable) return unknown('publication-receipt-changed-during-scan');
    if (receipt.kind !== 'versioned-content-package-build-v2' || receipt.result !== 'passed' || receipt.published !== true)
      return unknown('successful-complete-publication-not-established');
    if (!Array.isArray(receipt.stages) || receipt.stages.some(stage => stage.status !== 'passed') ||
        publicationStages.some(name => receipt.stages.filter(stage => stage.name === name).length !== 1))
      return unknown('publication-stage-proof-incomplete');
    const lock = receipt.sourceInputLock;
    if (!['source-prerequisite-input-lock-v1','source-prerequisite-input-lock-v2','source-prerequisite-input-lock-v3'].includes(lock?.kind) || !digest(lock.compilerDigest) ||
        !digest(lock.runtimeSha256) || lock.runtimeSha256 !== runtimeSha256 ||
        typeof lock.compiledDir !== 'string' || resolve(root, lock.compiledDir) !== resolve(compiledDirectory))
      return unknown('same-runtime-compiler-lock-not-established');
    const skyboxLock=lock.kind==='source-prerequisite-input-lock-v3';
    if(skyboxLock?lock.skyboxPresentation!=='web-flat-skybox-panorama-v1':Object.hasOwn(lock,'skyboxPresentation'))return unknown('source-skybox-lock-policy-not-established');
    if (lock.sourceSetHash !== manifest.sourceSetHash || lock.parentSourceSetHash !== manifest.parentSourceSetHash)
      return unknown('publication-source-set-mismatch');
    const producer = id => {
      const matches = Array.isArray(receipt.producers) ? receipt.producers.filter(row => row.id === id) : [];
      return matches.length === 1 ? matches[0].report : null;
    };
    const source = producer('source-prerequisites'), linked = producer('linked-source-prerequisites'), base = producer('base');
    if (source?.kind !== 'source-prerequisite-candidate-v1' || linked?.kind !== 'linked-source-prerequisites-v1' ||
        base?.kind !== 'game-content-package-build-v1' || source.compilerDigest !== lock.compilerDigest ||
        source.sourceSetHash !== manifest.sourceSetHash || source.parentSourceSetHash !== manifest.parentSourceSetHash)
      return unknown('source-producer-identity-not-established');
    if(skyboxLock&&(!source.inputScope?.snapshotRoots?.includes('build/field-skybox-media')||source.skyboxPresentation?.policy!==lock.skyboxPresentation||!digest(source.skyboxPresentation?.catalogHash)||!digest(source.skyboxPresentation?.mediaSourceSetHash)||!Number.isSafeInteger(source.skyboxPresentation?.models)||source.skyboxPresentation.models<1||!Number.isSafeInteger(source.skyboxPresentation?.images)||source.skyboxPresentation.images<1))return unknown('source-skybox-media-producer-proof-not-established');
    const sourceStages = ['capture-inputs', 'battle-capability-rebuild', 'source-world', 'source-new-game',
      'framework-derivation', 'revalidate-inputs'];
    if (!Array.isArray(source.stages) || source.stages.some(stage => stage.status !== 'passed') ||
        sourceStages.some(name => source.stages.filter(stage => stage.name === name).length !== 1))
      return unknown('source-producer-stages-incomplete');
    if (source.strict?.maps !== mapInventory.length || linked.sourceMaps !== mapInventory.length ||
        linked.originalWorldHash !== source.strict.catalogHash || linked.originalEntryHash !== source.strict.entryHash ||
        linked.linkedWorldHash !== manifest.worldContentHash || linked.linkedEntryHash !== refs.source?.entry.contentHash)
      return unknown('linked-source-world-or-entry-proof-mismatch');
    const baseSource = Array.isArray(base.packages) ? base.packages.filter(row => row.id === 'source') : [];
    if (baseSource.length !== 1 || canonical(baseSource[0].refs) !== canonical(refs))
      return unknown('published-source-reference-producer-mismatch');
    if (!Array.isArray(source.payloads)) return unknown('source-producer-objects-unavailable');
    const produced = new Map();
    for (const row of source.payloads) {
      if (typeof row.url !== 'string' || !digest(row.contentHash) || produced.has(row.url))
        return unknown('source-producer-object-identity-invalid');
      produced.set(row.url, row.contentHash);
    }
    if (produced.get('/world/catalog.json') !== source.strict.catalogHash ||
        produced.get('/game/source-new-game.json') !== source.strict.entryHash)
      return unknown('source-producer-world-or-entry-object-mismatch');
    if ([...produced.keys()].filter(url => /^\/world\/maps\/[1-9][0-9]*\.json$/.test(url)).length !== mapInventory.length)
      return unknown('source-producer-map-inventory-mismatch');
    for (const map of mapInventory) if (produced.get('/world/maps/' + map.mapId + '.json') !== map.contentHash)
      return unknown('source-producer-map-object-mismatch');
    if (!Array.isArray(receipt.publishedObjects)) return unknown('published-byte-proof-unavailable');
    const published = new Map();
    for (const object of receipt.publishedObjects) {
      if (typeof object.url !== 'string' || !/^\/content-packages\/[a-zA-Z0-9/_-]+\.json$/.test(object.url) ||
          posix.normalize(object.url) !== object.url || !digest(object.sha256) ||
          !Number.isSafeInteger(object.bytes) || object.bytes < 1 ||
          object.contentHash !== null && !digest(object.contentHash) || published.has(object.url))
        return unknown('published-object-byte-identity-invalid');
      published.set(object.url, object);
    }
    const scanned = new Map();
    for (const input of inputFiles) {
      if (scanned.has(input.url)) return unknown('scanned-input-identity-invalid');
      scanned.set(input.url, input);
      const object = published.get(input.url);
      if (!object || object.sha256 !== input.sha256 || object.bytes !== input.bytes ||
          object.contentHash !== input.contentHash)
        return unknown('published-object-byte-proof-mismatch');
    }
    if (scanned.get(manifest.refsURL)?.contentHash !== null ||
        scanned.get(refs.world.url)?.contentHash !== manifest.worldContentHash ||
        scanned.get(manifest.refsURL)?.sha256 !== manifest.refsSha256)
      return unknown('scanned-source-refs-or-world-proof-incomplete');
    for (const map of mapInventory) {
      const input = scanned.get(map.url);
      if (!input || input.contentHash !== map.contentHash || input.sha256 !== map.sha256 || input.bytes !== map.bytes)
        return unknown('scanned-source-map-byte-proof-incomplete');
    }
    if (!receipt.after?.packages?.includes('source') || !Array.isArray(receipt.after.reports) ||
        receipt.after.reports.filter(row => row.packageId === 'source' && row.kind === 'content-release-archive-v1' &&
          row.originalJSONBytesPreserved === true && row.mapIndexCount === mapInventory.length &&
          digest(row.releaseId) && digest(row.indexHash)).length !== 1)
      return unknown('post-publication-source-archive-not-established');
    return { status: 'verified', rebuiltForThisRuntime: true, reasons: [],
      basis: 'successful-same-runtime-publication-producer-and-all-scanned-byte-bindings',
      runtimeSha256, compilerDigest: lock.compilerDigest, scannedFilesVerified: inputFiles.length,
      sourceMapsVerified: mapInventory.length, sourceSetHash: manifest.sourceSetHash };
  } catch { return unknown('publication-proof-malformed'); }
}

export async function planStoryRuntime({ compiled = 'dist', publication = 'build/reports/versioned-content-package-build.json' } = {}) {
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
  const value = JSON.parse(bytes.toString('utf8'));
  inputFiles.set(url, { url, path: file, sha256, bytes: bytes.length, contentHash: value.contentHash ?? null });
  return value;
}

const publicationPath = resolve(root, publication);
let publicationBytes = null, publicationReceipt = null;
try { publicationBytes = await readFile(publicationPath); publicationReceipt = JSON.parse(publicationBytes.toString()); }
catch { /* Missing, malformed and failed metadata leave origin unassessed. */ }

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
let publicationStable = false;
try { publicationStable = publicationBytes !== null && (await readFile(publicationPath)).equals(publicationBytes); }
catch { /* A removed receipt cannot grant rebuild provenance. */ }
const publicationProof = assessStoryRuntimePublication({ receipt: publicationReceipt, runtimeSha256: initialRuntime,
  compiledDirectory: resolve(root, compiled), refs, manifest, inputFiles: reads, mapInventory, canonical,
  receiptStable: publicationStable });
const publicationMetadata = { ...publicationProof, receiptPath: relative(root, publicationPath),
  receiptSha256: publicationBytes ? fileDigest(publicationBytes) : null };
const report = { kind: 'story-runtime-plan-v1', result: 'static-planning-complete',
  sourceSetHash: catalog.sourceSetHash, parentSourceSetHash: catalog.parentSourceSetHash,
  mediaSourceSetHash: catalog.mediaSourceSetHash, runtimeSha256: initialRuntime,
  manifestHash: hash(manifest), manifest, contentHashes: {
    world: catalog.contentHash, maps: Object.fromEntries(mapInventory.map(map => [String(map.mapId), map.contentHash])),
  }, inputFiles: reads.map(({ path: _path, ...input }) => input), mapInventory, counts,
  scan: { calls: 1, scope: 'complete-source-world-map-inventory',
    providerContext: { providers: {}, actorKind: 'unknown' },
    contentGeneration: publicationProof.status === 'verified' ? 'same-runtime-publication-verified' : 'published-source-generation-unassessed',
    rebuiltForThisRuntime: publicationProof.rebuiltForThisRuntime, publication: publicationMetadata },
  analysis, work: { grouping: 'exact-code-reason-and-explicit-capability',
    ownerClassification: 'unassigned-no-owner-inference', diagnosticGroups, providerRequirementGroups, providerAssessmentGroups },
  runtimeAdmission: 'unassessed', sourceStoryReachability: false, sourceCampaignComplete: false,
  browserVerified: false, originalGameExecuted: false, limitations: [
    'Every published source map, map-local script key and source PointIn is inventoried; this is a conservative static graph, not a reachable campaign.',
    publicationProof.status === 'verified'
      ? 'Successful same-runtime publication and producer/byte bindings establish source rebuild provenance; they do not grant migration or runtime admission.'
      : 'Source rebuild provenance is unassessed without a matching complete successful publication receipt; checked payload/source identities do not grant migration or runtime admission.',
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
  rebuiltForThisRuntime: publicationProof.rebuiltForThisRuntime, publication: publicationProof.status,
  elapsedMs: Date.now() - started, report: output }));
return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {}, seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--compiled', '--publication'].includes(key) || !value || value.startsWith('--') || seen.has(key))
      throw new Error('Use plan-story-runtime.mjs [--compiled directory] [--publication receipt.json]');
    seen.add(key); options[key === '--compiled' ? 'compiled' : 'publication'] = value;
  }
  await planStoryRuntime(options);
}
