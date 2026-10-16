import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';
import { compileSourcePrerequisites, validateSourcePrerequisiteInputs } from './compile-source-prerequisites.mjs';
import { linkSourcePrerequisites } from './link-source-prerequisites.mjs';
import { webSourceFrameworkInputs } from './source-web-framework-inputs.mjs';
import { createSourceCandidateBoardByteValidator } from './source-candidate-board-validation.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const SHARED_SOURCE_CANDIDATE = 'shared-source-candidate-v1';
const KINDS = [SHARED_SOURCE_CANDIDATE, 'source-map-animation-candidate-v1', 'source-play-animation-candidate-v1', 'source-flat-npc-candidate-v1', 'source-birdview-field-effect-candidate-v1'];
const directoryPolicyPath='content-batches/source-battle-directory.policy.json';
async function directoryPolicyInput(root,expected){
 const file=resolve(root,directoryPolicyPath),bytes=await readFile(file),record={path:directoryPolicyPath,sha256:sha(bytes),bytes:bytes.length,realPath:await realpath(file)};
 if(expected)assert.deepEqual(record,expected,'Whole newgame battle directory policy changed');return {record,policy:JSON.parse(bytes)};
}
export function parseSourceCandidateOptions(args) {
    assert.equal(args.length % 2, 0, 'Expected option/value pairs'); const result = {};
    for (let i = 0; i < args.length; i += 2) {
        assert.ok(['--root', '--compiled-dir', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown or missing option value');
        assert.equal(result[args[i]], undefined, 'Duplicate options'); result[args[i]] = args[i + 1];
    }
    return result;
}
function safeUrl(url) {
    assert.ok(typeof url === 'string' && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/.test(url) && !url.split('/').some(p => p === '.' || p === '..'), 'Unsafe candidate object URL');
}
export function validateSourceCandidateReport(report, { runtimeSha256, inputBytes, legacyKind } = {}) {
    assert.ok(report && (report.kind === SHARED_SOURCE_CANDIDATE || report.kind === legacyKind) && KINDS.includes(report.kind), 'Unsupported source candidate kind');
    assert.equal(report.status, 'complete'); assert.equal(report.published, false, 'Source candidate cannot be a public cache');
    assert.ok(/^[a-f0-9]{64}$/.test(report.runtimeSha256));
    assert.equal(report.runtimeSha256, runtimeSha256, 'Candidate must come from this exact compiled/tool/app runtime');
    if (report.kind === SHARED_SOURCE_CANDIDATE || report.inputLock) {
        assert.equal(report.inputLock?.file, 'inputs.json'); assert.equal(report.inputLock?.sha256, sha(inputBytes), 'Candidate input lock bytes changed');
        assert.equal(report.inputLock?.bytes, inputBytes.length);
    }
    assert.ok(report.producer && report.link && Array.isArray(report.objects) && report.objects.length > 0, 'Incomplete candidate producer/object closure');
    const index = new Map();
    for (const row of report.objects) {
        safeUrl(row.url); assert.ok(!index.has(row.url), 'Duplicate candidate object URL');
        assert.ok(/^[a-f0-9]{64}$/.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes > 0, 'Invalid candidate object binding');
        assert.ok(row.contentHash === undefined || row.contentHash === null || /^[a-f0-9]{64}$/.test(row.contentHash), 'Invalid candidate content hash');
        index.set(row.url, structuredClone(row));
    }
    if(report.frameworkBattleDirectory){
        const binding=report.frameworkBattleDirectory;
        assert.equal(binding.input?.path,directoryPolicyPath);assert.match(binding.input.sha256,/^[a-f0-9]{64}$/);
        assert(Number.isSafeInteger(binding.input.bytes)&&binding.input.bytes>0&&typeof binding.input.realPath==='string');
        for(const url of ['/framework/full-new-game.json','/framework/full-battle.json','/framework/full-content-refs.json','/framework/full-battle-binding.json','/framework/full-battle-directory-requests.json','/framework/full-battle-directory-report.json'])assert(index.has(url),'Missing whole newgame battle dependency '+url);
        assert.equal(index.get('/framework/full-battle-binding.json').contentHash,binding.bindingHash);
        assert.equal(index.get('/framework/full-battle.json').contentHash,binding.catalogHash);
        assert.equal(index.get('/framework/full-new-game.json').contentHash,binding.entryHash);
        assert.equal(index.get('/framework/full-battle-directory-requests.json').contentHash,binding.requestsHash);
        assert.equal(index.get('/framework/full-battle-directory-report.json').contentHash,binding.reportHash);
    }
    for (const url of ['/world/catalog.json', '/framework/world/catalog.json', '/game/source-new-game.json', '/game/source-catalog.json'])
        assert.ok(index.has(url), 'Missing complete candidate dependency ' + url);
    return index;
}
/** Resolve the complete world reference graph before any family may select its
 * own nomination. A valid list of object hashes alone cannot prove that an
 * unconsumed original map was not removed from that list. */
export function validateSourceCandidateCatalogs(report, index, source, framework) {
    for (const world of [source, framework]) {
        assert.equal(world.kind, 'world-development'); assert.equal(world.formatVersion, 1);
        assert.ok(world.maps && typeof world.maps === 'object' && !Array.isArray(world.maps));
    }
    assert.equal(source.developmentProfile, undefined, 'Candidate strict world has a policy');
    assert.equal(framework.developmentProfile?.kind, 'framework-development-v1');
    assert.equal(framework.developmentProfile.sourceContentHash, source.contentHash, 'Candidate framework world source binding mismatch');
    for (const key of ['sourceSetHash', 'parentSourceSetHash', 'mediaSourceSetHash'])
        assert.equal(framework[key], source[key], 'Candidate world source generation mismatch');
    const ids = Object.keys(source.maps).sort(), frameworkIds = Object.keys(framework.maps).sort();
    assert.ok(ids.length > 0); assert.deepEqual(frameworkIds, ids, 'Candidate world map membership mismatch');
    assert.equal(report.producer.strict.maps, ids.length, 'Candidate producer source map denominator mismatch');
    assert.equal(report.link.sourceMaps, ids.length, 'Candidate linked source map denominator mismatch');
    assert.equal(report.link.frameworkMaps, ids.length, 'Candidate linked framework map denominator mismatch');
    assert.equal(report.link.linkedWorldHash, source.contentHash, 'Candidate linked source world mismatch');
    assert.equal(report.link.frameworkWorldHash, framework.contentHash, 'Candidate linked framework world mismatch');
    const bindings = new Map();
    for (const [role, world] of [['source', source], ['framework', framework]]) {
        for (const id of ids) {
            assert.ok(/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)), 'Invalid candidate map ID');
            const ref = world.maps[id]; safeUrl(ref.url);
            assert.ok(/^[a-f0-9]{64}$/.test(ref.contentHash), 'Invalid candidate indexed map hash');
            const row = index.get(ref.url); assert.ok(row, 'Missing complete candidate map dependency ' + ref.url);
            assert.equal(row.contentHash, ref.contentHash, 'Candidate indexed map content hash mismatch: ' + ref.url);
            assert.ok(!bindings.has(ref.url), 'Ambiguous candidate map reference URL');
            bindings.set(ref.url, { role, mapId: Number(id), areaId: ref.areaId, name: ref.name, contentHash: ref.contentHash,
                sourceContentHash: source.maps[id].contentHash, sourceSetHash: source.sourceSetHash,
                parentSourceSetHash: source.parentSourceSetHash, mediaSourceSetHash: source.mediaSourceSetHash });
        }
    }
    return bindings;
}
export function validateSourceCandidateMapObject(value, binding) {
    assert.equal(value.kind, 'world-map-development'); assert.equal(value.formatVersion, 1);
    for (const key of ['mapId', 'areaId', 'name', 'contentHash', 'sourceSetHash', 'parentSourceSetHash', 'mediaSourceSetHash'])
        assert.equal(value[key], binding[key], 'Candidate complete map identity mismatch: ' + key);
    if (binding.role === 'source') assert.equal(value.developmentProfile, undefined, 'Candidate source map has a policy');
    else {
        assert.equal(value.developmentProfile?.kind, 'framework-development-v1');
        assert.equal(value.developmentProfile.sourceContentHash, binding.sourceContentHash, 'Candidate framework map source binding mismatch');
    }
}

/** New capability objects must agree with the complete immutable input-v4
 * tuple. Old locks cannot acquire it through an edited candidate/save body. */
export function validateSourceCandidateBoardTransforms(value,lock,{hash,canonical}){
    const marker=value.developmentProfile?.fieldEffectTransforms,policy=value.fieldEffects?.boardTransforms;
    if(!["source-prerequisite-input-lock-v4","source-prerequisite-input-lock-v5"].includes(lock.kind)){
        assert.equal(marker,undefined,"Legacy candidate lock cannot grant board transforms");assert.equal(policy,undefined,"Legacy candidate lock cannot carry board transform metadata");return;
    }
    if(value.developmentProfile===undefined){assert.equal(policy,undefined,"Strict source cannot carry board transform policy");return;}
    if(!["world-development","world-map-development","source-new-game-content-v1"].includes(value.kind))return;
    assert.equal(marker,lock.fieldEffectTransforms,"Candidate board marker differs from current input-v4");
    if(value.kind==="world-map-development"){
        assert.equal(hash(value.fieldEffects),lock.fieldEffectCatalogHash,"Candidate complete board catalog differs from input-v4");
        assert.equal(canonical(policy),canonical(lock.fieldEffectTransformCatalog.projection),"Candidate board assessment differs from input-v4");
    }else assert.equal(policy,undefined,"Board catalog belongs to actual map owner");
}

export function validateSourceCandidateParkingUpload(value,lock,{hash}){
 const marker=value.developmentProfile?.transportationParkingUpload;
 if(lock.kind!=="source-prerequisite-input-lock-v5"){assert.equal(marker,undefined,"Legacy candidate lock cannot grant parking upload");return;}
 if(value.developmentProfile===undefined)return;
 if(!["world-development","world-map-development","source-new-game-content-v1"].includes(value.kind))return;
 assert.equal(marker,lock.transportationParkingUpload,"Candidate parking marker differs from v5 lock");
 assert.equal(marker,"web-source-transport-parking-upload-v1");assert.equal(value.developmentProfile.vehicleLifecycle,"web-source-vehicle-lifecycle-v1");
 if(value.kind==="world-development")assert.equal(hash(value.transportation),lock.transportationCatalogHash,"Candidate parking catalog differs from v5 locked source");
}

/** Both policies observe the same private parsed graph and actual input lock.
 * A successful board memo never grants a parking profile or catalog binding. */
export function validateSourceCandidateOwnedPolicies(value,lock,api){
 validateSourceCandidateBoardTransforms(value,lock,api);
 validateSourceCandidateParkingUpload(value,lock,api);
}

async function containedFile(base, url) {
    safeUrl(url); const file = resolve(base, 'objects', url.slice(1)), actual = await realpath(file), parent = await realpath(resolve(base, 'objects'));
    assert.ok(actual.startsWith(parent + sep), 'Candidate object escapes its sealed directory'); return file;
}
/** Full input/runtime/object validation is retained per consumer. Shared means
 * reuse one fresh pure output, never a relaxed identity or a cached public map. */
export async function openSourceCandidate({ root, runtimeRoot, compiledDir, candidateDir, legacyKind }) {
    root = resolve(root); compiledDir = resolve(root, compiledDir); candidateDir = resolve(root, candidateDir);
    const runtimeSha256 = await runtimeDigest(runtimeRoot, compiledDir), reportBytes = await readFile(resolve(candidateDir, 'report.json')),
        inputBytes = await readFile(resolve(candidateDir, 'inputs.json')), report = JSON.parse(reportBytes), lock = JSON.parse(inputBytes),
        index = validateSourceCandidateReport(report, { runtimeSha256, inputBytes, legacyKind });
    if(report.frameworkBattleDirectory)await directoryPolicyInput(root,report.frameworkBattleDirectory.input);
    await validateSourcePrerequisiteInputs(lock, { root });
    if(report.frameworkBattleDirectory)assert.deepEqual(lock.files.find(row=>row.path===directoryPolicyPath),report.frameworkBattleDirectory.input,'Whole directory policy is outside the candidate input fence');
    const boardApi=await import(pathToFileURL(resolve(compiledDir,"src/compiler/content.js")).href);
    const boardValidation=createSourceCandidateBoardByteValidator(inputBytes,{validate:validateSourceCandidateOwnedPolicies,...boardApi});
    const cache = new Map();
    async function objectBytes(row) {
        const bytes = await readFile(await containedFile(candidateDir, row.url));
        assert.equal(sha(bytes), row.sha256, 'Candidate object bytes changed: ' + row.url);
        assert.equal(bytes.length, row.bytes, 'Candidate object size changed: ' + row.url); return bytes;
    }
    async function read(url) {
        const row = index.get(url); assert.ok(row, 'Unknown same-candidate input ' + url);
        if (!cache.has(url)) {
            const value = JSON.parse(await objectBytes(row));
            assert.equal(value.contentHash, row.contentHash ?? undefined, 'Candidate object content hash binding changed');
            cache.set(url, value);
        }
        return structuredClone(cache.get(url));
    }
    // All objects, including maps outside this particular family, are part of
    // the producer closure and remain checked at both ends.
    const bindings = validateSourceCandidateCatalogs(report, index, await read('/world/catalog.json'), await read('/framework/world/catalog.json'));
    for (const row of index.values()) {
        const bytes = await objectBytes(row), binding = bindings.get(row.url);
        const value=boardValidation.parseAndValidate(bytes);
        if (binding) validateSourceCandidateMapObject(value, binding);
    }
    async function validate() {
        assert.equal(sha(await readFile(resolve(candidateDir, 'report.json'))), sha(reportBytes), 'Candidate receipt changed');
        assert.equal(sha(await readFile(resolve(candidateDir, 'inputs.json'))), sha(inputBytes), 'Candidate input lock changed');
        assert.equal(await runtimeDigest(runtimeRoot, compiledDir), runtimeSha256, 'Runtime changed during candidate consumption');
        if(report.frameworkBattleDirectory)await directoryPolicyInput(root,report.frameworkBattleDirectory.input);
        await validateSourcePrerequisiteInputs(lock, { root });
        for (const row of index.values()) {const bytes=await objectBytes(row);boardValidation.parseAndValidate(bytes);}
    }
    return { report, reportBytes, lock, runtimeSha256, read, validate };
}
/** One full strict/framework compile and prerequisite link. The shared receipt
 * describes compilation provenance only; it awards no family/story readiness. */
export async function compileSourceCandidate({ root, runtimeRoot, compiledDir, output, kind = SHARED_SOURCE_CANDIDATE, wholeBattleDirectory = kind === SHARED_SOURCE_CANDIDATE }) {
    assert.equal(typeof wholeBattleDirectory,'boolean','Whole source battle directory requires an explicit boolean');
    assert.ok(KINDS.includes(kind)); root = resolve(root); compiledDir = resolve(root, compiledDir); output = resolve(root, output);
    const rel = relative(root, output);
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('build' + sep), 'Private candidate output must be inside root/build');
    assert.ok(!/^build\/(?:content-packages|content-releases|corpus|import|field-effect-media)(?:\/|$)/.test(rel.split(sep).join('/')), 'Candidate cannot overwrite public/raw input directories');
    const runtimeSha256 = await runtimeDigest(runtimeRoot, compiledDir), started = Date.now();
    const directoryInput=wholeBattleDirectory?await directoryPolicyInput(root):null;
    const result = await compileSourcePrerequisites({ root, compiledDir, ...webSourceFrameworkInputs() });
    if(directoryInput){assert(!result.inputs.files.some(row=>row.path===directoryPolicyPath));result.inputs.files.push(directoryInput.record);result.inputs.files.sort((a,b)=>a.path.localeCompare(b.path));}
    console.log('pure source prerequisite compiled');
    const linked = await linkSourcePrerequisites({ root, compiledDir, payloads: result.payloads, frameworkOptions: result.frameworkOptions });
    let frameworkBattleDirectory;
    if(directoryInput){
        const {compileSourceBattleDirectory}=await import('./source-battle-directory.mjs'),{bindFrameworkSourceBattleDirectory}=await import('./framework-source-battle-binding.mjs');
        const sourceWorld=linked.inputs.get('/world/catalog.json'),sourceBattle=linked.inputs.get('/game/source-catalog.json'),
          maps=Object.values(sourceWorld.maps).map(ref=>{assert(linked.inputs.has(ref.url));return linked.inputs.get(ref.url);});
        const directory=await compileSourceBattleDirectory({root,compiledDir,world:{catalog:sourceWorld,maps},baseCatalog:sourceBattle,policy:directoryInput.policy});
        const bound=await bindFrameworkSourceBattleDirectory({root,compiledDir,sourceWorld,sourceBattle,sourceEntry:linked.inputs.get('/game/source-new-game.json'),
          frameworkEntry:linked.inputs.get('/framework/new-game.json'),frameworkWorld:linked.inputs.get('/framework/world/catalog.json'),directory});
        for(const[url,value]of bound.payloads){assert(!linked.inputs.has(url));linked.inputs.set(url,value);}
        linked.inputs.set('/framework/full-battle-directory-requests.json',directory.requests);linked.inputs.set('/framework/full-battle-directory-report.json',directory.report);
        await directoryPolicyInput(root,directoryInput.record);
        frameworkBattleDirectory={input:directoryInput.record,bindingHash:bound.report.contentHash,catalogHash:bound.battle.contentHash,entryHash:bound.entry.contentHash,
          requestsHash:directory.requests.contentHash,reportHash:directory.report.contentHash,requestedParties:directory.requests.requestedPartyIds.length,compiledDefinitions:Object.keys(bound.battle.encounters).length,sourceCampaignComplete:false};
    }
    assert.equal(await runtimeDigest(runtimeRoot, compiledDir), runtimeSha256, 'Runtime changed during private source compilation');
    await validateSourcePrerequisiteInputs(result.inputs, { root });
    const staging = output + '.preparing-' + randomUUID(), objects = [];
    await mkdir(staging, { recursive: true });
    for (const [url, value] of linked.inputs) {
        safeUrl(url); const bytes = JSON.stringify(value) + '\n', file = resolve(staging, 'objects', url.slice(1));
        await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
        objects.push({ url, sha256: sha(bytes), bytes: Buffer.byteLength(bytes), ...(value.contentHash ? { contentHash: value.contentHash } : {}) });
    }
    const inputBytes = JSON.stringify(result.inputs, null, 2) + '\n';
    const report = { kind, status: 'complete', runtimeSha256, producer: result.report, link: linked.report,
        inputLock: { file: 'inputs.json', sha256: sha(inputBytes), bytes: Buffer.byteLength(inputBytes) }, objects,
        elapsedMs: Date.now() - started, pureCompilations: 1, prerequisiteLinks: 1, published: false, countsAreStoryReachability: false, ...(frameworkBattleDirectory?{frameworkBattleDirectory}:{}) };
    const index = validateSourceCandidateReport(report, { runtimeSha256, inputBytes: Buffer.from(inputBytes), legacyKind: kind });
    validateSourceCandidateCatalogs(report, index, linked.inputs.get('/world/catalog.json'), linked.inputs.get('/framework/world/catalog.json'));
    await writeFile(resolve(staging, 'inputs.json'), inputBytes); await writeFile(resolve(staging, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    // Exercise the exact reader/complete input fence before this candidate can
    // replace the previous output. Producer shape checks alone cannot verify
    // the async compiled-module and all-map consumer path.
    const readable=await openSourceCandidate({root,runtimeRoot,compiledDir,candidateDir:staging,legacyKind:kind});
    await readable.validate();
    assert.equal(await runtimeDigest(runtimeRoot, compiledDir), runtimeSha256, 'Runtime changed before candidate installation');
    if(directoryInput)await directoryPolicyInput(root,directoryInput.record);
    let previous;
    try { await rename(output, previous = output + '.previous-' + randomUUID()); } catch (error) { if (error.code !== 'ENOENT') throw error; previous = undefined; }
    try { await rename(staging, output); } catch (error) { if (previous) await rename(previous, output); throw error; }
    return report;
}
export async function sourceCandidateCli({ args = process.argv.slice(2), runtimeRoot = resolve(import.meta.dirname, '..'), kind, defaultOutput = 'build/source-candidate' } = {}) {
    const options = parseSourceCandidateOptions(args), root = resolve(options['--root'] ?? runtimeRoot),
        report = await compileSourceCandidate({ root, runtimeRoot, compiledDir: options['--compiled-dir'] ?? 'dist', output: options['--output'] ?? defaultOutput, ...(kind ? { kind } : {}) });
    console.log(JSON.stringify({ objects: report.objects.length, strict: report.producer.strict, framework: report.link.frameworkWorldHash, published: false, pureCompilations: 1 }));
}
