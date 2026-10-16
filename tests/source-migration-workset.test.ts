import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSourceMigrationWorkSet, SOURCE_MIGRATION_UNASSESSED_DOMAIN_GAP, type SourceMigrationWorkSetInput, type SourceMigrationProgram, type SourceMigrationGap, type SourceMigrationBatch, type SourceMigrationSource } from '../src/compiler/source-migration-workset.js';
const pin = 'a'.repeat(64);
const source = (id: string): SourceMigrationSource => ({ file: 'original.bundle', assetPath: 'Assets/Full/Namespace/' + id + '.json', objectId: String(1 + id.length), serializedFile: 'CAB-original', sha256: pin });
function fixture(): SourceMigrationWorkSetInput {
    const program = (id: string, gapIds: string[], deps: string[] = [], mapIds = [1]): SourceMigrationProgram => ({ id, domain: 'field', source: source(id), rawHash: pin, instructionCount: 20, mapIds, dependencyProgramIds: deps, gapIds });
    const programs = [program('opening', ['frequent']), program('chapter-a', ['a', 'b']), program('chapter-b', ['rare']), program('helper', [], [], [2])];
    const gap = (id: string, owner = 'map-event-and-travel'): SourceMigrationGap => ({ id, owner, code: 'exact-' + id, reason: 'Retained shared semantic gap ' + id, dependsOnGapIds: [], sites: programs.filter(p => p.gapIds.includes(id)).map(p => ({ programId: p.id, index: 0, source: p.source, mapIds: [...p.mapIds] })) });
    const batch = (id: string, programIds: string[], gapIds: string[] = []): SourceMigrationBatch => ({ id, kind: 'structural-source-closure', programIds, mapIds: [1], gapIds });
    return { sourceSetHash: pin, sourceDigest: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64), parallelism: 2, programs, gaps: [gap('frequent'), gap('a'), gap('b'), gap('rare')], batches: [batch('joint-one', ['chapter-a']), batch('joint-two', ['chapter-a', 'helper']), batch('rare-route', ['chapter-b'])] };
}
test('joint full-batch benefits choose complementary gaps in one wave over opening frequency', () => {
    const raw = fixture();
    raw.gaps[0]!.sites = Array.from({ length: 20 }, (_, index) => ({ ...raw.gaps[0]!.sites[0]!, index }));
    const before = structuredClone(raw), work = compileSourceMigrationWorkSet(raw);
    assert.deepEqual(work.waves[0]!.gapIds, ['a', 'b']);
    assert.deepEqual(work.waves[0]!.potentialBatchIdsClosed, ['joint-one', 'joint-two']);
    assert(!work.waves[0]!.gapIds.includes('frequent'));
    assert.deepEqual(raw, before);
    assert.equal(work.counts.sites, 23);
    assert.equal(work.runtimeAdmission, 'unassessed');
    assert.equal(work.playable, false);
    assert.equal(work.sourceCampaignComplete, false);
    assert.equal(work.gaps.length, raw.gaps.length);
    assert.equal(work.programs.length, raw.programs.length);
    assert.equal(work.batches.length, raw.batches.length);
    assert.equal(work.counts.plannedGaps, raw.gaps.length);
});
test('rare shared prerequisite leads its dependent wave and exposes full closure assumptions', () => {
    const raw = fixture();
    raw.parallelism = 1;
    raw.gaps.find(g => g.id === 'rare')!.dependsOnGapIds = ['a'];
    raw.batches = [raw.batches[2]!];
    const work = compileSourceMigrationWorkSet(raw), first = work.waves[0]!;
    assert.deepEqual(first.gapIds, ['a']);
    assert.deepEqual(first.potentialBatchIdsClosed, []);
    const next = work.waves.find(w => w.gapIds.includes('rare'))!;
    assert(next.index > first.index);
    assert.deepEqual(next.potentialBatchIdsClosed, ['rare-route']);
    assert(next.assumesPriorWavesCompleted);
    assert(!next.tasks[0]!.readyForNomination);
    assert.deepEqual(next.tasks[0]!.assumesPriorGapIds, ['a']);
    assert.deepEqual(work.batches[0]!.requiredGapIds, ['a', 'rare']);
});
test('program closure includes external helper gaps and map aliases without truncating physical IDs', () => {
    const raw = fixture(), long = 'master.bundle::Assets/Serial/Complete/' + 'namespace/'.repeat(40) + 'CommonHelper.json';
    raw.programs[3]!.id = long;
    raw.programs[1]!.dependencyProgramIds = [long];
    raw.programs[3]!.gapIds = ['rare'];
    raw.gaps.find(g => g.id === 'rare')!.sites.push({ kind: 'instruction', programId: long, index: 19, source: raw.programs[3]!.source, mapIds: [2] });
    raw.batches = raw.batches.slice(0, 1);
    const work = compileSourceMigrationWorkSet(raw);
    assert(work.programs.some(p => p.id === long));
    assert(work.batches[0]!.requiredProgramIds.includes(long));
    assert.deepEqual(work.batches[0]!.requiredMapIds, [1, 2]);
    assert.deepEqual(work.batches[0]!.requiredGapIds, ['a', 'b', 'rare']);
    assert.equal(work.waves[0]!.ownerLanes.length, 1);
    assert.equal(work.waves[0]!.ownerLanes[0]!.gapIds.length, 3);
    assert.equal(work.batches[0]!.executionAcceptance, 'missing-contract');
});
test('unknown owner, cycles and downstream gaps remain explicit blocked groups; unrelated work survives', () => {
    const raw = fixture();
    raw.gaps.find(g => g.id === 'frequent')!.owner = 'future-owner';
    raw.gaps.find(g => g.id === 'a')!.dependsOnGapIds = ['b'];
    raw.gaps.find(g => g.id === 'b')!.dependsOnGapIds = ['a'];
    raw.gaps.find(g => g.id === 'rare')!.dependsOnGapIds = ['frequent'];
    const work = compileSourceMigrationWorkSet(raw);
    assert.equal(work.counts.blockedGaps, 4);
    assert.equal(work.counts.plannedGaps, 0);
    assert.deepEqual(work.waves, []);
    assert.deepEqual(work.gapComponents.find(g => g.cyclic)!.gapIds, ['a', 'b']);
    assert.equal(work.gaps.find(g => g.id === 'frequent')!.owner, 'unclassified');
    assert.equal(work.gaps.find(g => g.id === 'frequent')!.declaredOwner, 'future-owner');
    assert(work.blocked.find(g => g.gapId === 'rare')!.reasons.includes('blocked-dependency'));
    assert(work.batches.every(b => !b.readyForNomination));
});
test('map-only dependency records and conditional observations retain original JSON without invented scripts', () => {
    const raw = fixture(), record = { 'odd,key': { reason: 'map geometry/provider', candidateIds: [], unknown: null, conditional: true } };
    raw.gaps.push({ id: 'map-only', owner: 'unclassified', code: 'geometry-unknown', reason: 'No script position exists', sites: [{ kind: 'dependency', scopeId: 'map:9', mapIds: [9], record }], dependsOnGapIds: [] });
    raw.batches[0]!.gapIds.push('map-only');
    raw.observations = [{ id: 'conditional-host', scopeId: 'map:9', programIds: [], mapIds: [9], record }];
    const work = compileSourceMigrationWorkSet(raw);
    assert.deepEqual(work.observations[0]!.record, record);
    assert.deepEqual(work.gaps.find(g => g.id === 'map-only')!.sites, [{ kind: 'dependency', scopeId: 'map:9', mapIds: [9], record }]);
    assert.equal(work.counts.dependencySites, 1);
    assert.equal(work.counts.observations, 1);
    assert.equal(work.counts.gaps, 5);
    assert(work.batches[0]!.blockedGapIds.includes('map-only'));
    assert.deepEqual(work.batches[0]!.requiredMapIds, [1, 9]);
    work.observations[0]!.mapIds.push(100);
    assert.deepEqual(raw.observations[0]!.mapIds, [9]);
});
test('unknown domains cannot be reported gap-free; exact unassessed gap preserves complete program', () => {
    const raw = fixture();
    raw.programs[3]!.domain = 'future-native-domain';
    assert.throws(() => compileSourceMigrationWorkSet(raw), /Unassessed source domain/);
    raw.gaps.push({ id: 'unassessed-helper', owner: 'unclassified', code: SOURCE_MIGRATION_UNASSESSED_DOMAIN_GAP, reason: 'No decoder for this domain', sites: [], dependsOnGapIds: [] });
    raw.programs[3]!.gapIds = ['unassessed-helper'];
    const work = compileSourceMigrationWorkSet(raw);
    assert.equal(work.programs.find(p => p.id === 'helper')!.domain, 'future-native-domain');
    assert(work.blocked.some(g => g.gapId === 'unassessed-helper'));
    assert(work.batches.find(b => b.id === 'joint-two')!.blockedGapIds.includes('unassessed-helper'));
});
test('canonical plan and hash are independent of unordered scan traversal order', () => {
    const raw = fixture();
    raw.programs[1]!.dependencyProgramIds = ['helper'];
    const first = compileSourceMigrationWorkSet(raw), next = structuredClone(raw);
    next.programs.reverse();
    next.gaps.reverse();
    next.batches.reverse();
    for (const p of next.programs) {
        p.gapIds.reverse();
        p.mapIds.reverse();
        p.dependencyProgramIds.reverse();
    }
    for (const g of next.gaps) {
        g.sites.reverse();
        g.dependsOnGapIds.reverse();
    }
    assert.deepEqual(compileSourceMigrationWorkSet(next), first);
    assert.deepEqual(compileSourceMigrationWorkSet(raw), first);
    for (const edit of [(v: SourceMigrationWorkSetInput) => { v.runtimeSha256 = 'd'.repeat(64); }, (v: SourceMigrationWorkSetInput) => { v.programs[0]!.rawHash = 'd'.repeat(64); }, (v: SourceMigrationWorkSetInput) => { v.gaps[0]!.reason += ' different evidence'; }]) {
        const x = structuredClone(raw);
        edit(x);
        assert.notEqual(compileSourceMigrationWorkSet(x).contentHash, first.contentHash);
    }
});
test('structural cohorts never acquire a story contract; declared contracts remain unassessed', () => {
    const raw = fixture();
    raw.batches[0]!.routeContract = { id: 'supplied-reference', sha256: pin };
    raw.batches[1]!.kind = 'declared-story-route';
    raw.batches[1]!.routeContract = { id: 'actual-route', sha256: pin };
    raw.batches[2]!.kind = 'declared-story-route';
    const work = compileSourceMigrationWorkSet(raw);
    assert.equal(work.batches.find(b => b.id === 'joint-one')!.executionAcceptance, 'missing-contract');
    assert.equal(work.batches.find(b => b.id === 'joint-two')!.executionAcceptance, 'unassessed');
    assert.equal(work.batches.find(b => b.id === 'rare-route')!.executionAcceptance, 'missing-contract');
    assert.equal(work.playable, false);
});
test('program call cycles remain complete structural SCCs and do not delete gaps', () => {
    const raw = fixture();
    raw.programs[1]!.dependencyProgramIds = ['helper'];
    raw.programs[3]!.dependencyProgramIds = ['chapter-a'];
    const work = compileSourceMigrationWorkSet(raw);
    assert.deepEqual(work.programCycles, [['chapter-a', 'helper']]);
    assert.deepEqual(work.batches.find(b => b.id === 'joint-one')!.requiredProgramIds, ['chapter-a', 'helper']);
    assert.equal(work.counts.plannedGaps, 4);
});
test('sparse arrays, duplicates, accessors, missing references and wrong physical sources are rejected', () => {
    const edits: ((v: SourceMigrationWorkSetInput) => void)[] = [
        v => { delete v.programs[0]; }, v => { delete v.gaps[0]!.sites[0]; }, v => { v.gaps.push(v.gaps[0]!); }, v => { v.batches.push(v.batches[0]!); }, v => { v.programs.push(v.programs[0]!); }, v => { v.programs[0]!.gapIds.push('absent'); }, v => { v.programs[0]!.dependencyProgramIds.push('absent'); }, v => { v.gaps[0]!.dependsOnGapIds.push('absent'); }, v => { v.batches[0]!.programIds.push('absent'); }, v => { v.batches[0]!.gapIds.push('absent'); }, v => { v.gaps[0]!.sites.push(structuredClone(v.gaps[0]!.sites[0]!)); },
        v => { const s = v.gaps[0]!.sites[0]!; if (s.kind !== 'dependency')
            s.source = { ...s.source, assetPath: s.source.assetPath + 'wrong' }; }, v => { const s = v.gaps[0]!.sites[0]!; if (s.kind !== 'dependency')
            s.index = 20; }, v => { const s = v.gaps[0]!.sites[0]!; if (s.kind !== 'dependency')
            s.programId = 'missing'; }, v => { v.programs[0]!.mapIds = [1, 1]; }, v => { v.parallelism = 0; }, v => { Reflect.set(v, 'parallelism', null); }, v => { Reflect.set(v, 'observations', null); }, v => { v.sourceDigest = 'unknown'; }, v => { Object.defineProperty(v.programs[0]!, 'rawHash', { enumerable: true, get() { return pin; } }); }, v => { Reflect.set(v.gaps[0]!, 'runtimeAdmission', 'ready'); }, v => { v.programs[0]!.source.objectId = '9007199254740993.0'; },
    ];
    for (const edit of edits) {
        const raw = fixture();
        edit(raw);
        assert.throws(() => compileSourceMigrationWorkSet(raw));
    }
});
test('default three workers and empty listed gaps remain nominations with missing execution contracts', () => {
    const raw = fixture();
    delete raw.parallelism;
    raw.gaps = [];
    for (const p of raw.programs)
        p.gapIds = [];
    const work = compileSourceMigrationWorkSet(raw);
    assert.equal(work.parallelism, 3);
    assert.deepEqual(work.waves, []);
    assert.equal(work.counts.plannedGaps, 0);
    assert(work.batches.every(b => b.readyForNomination && b.executionAcceptance === 'missing-contract'));
    assert.equal(work.runtimeAdmission, 'unassessed');
    assert.equal(work.playable, false);
});
test('signed64-bit source IDs are exact strings and contradictory physical file pins are rejected', () => {
    const raw = fixture();
    raw.programs[0]!.source.objectId = '9223372036854775807';
    const w = compileSourceMigrationWorkSet(raw);
    assert.equal(w.programs.find(p => p.id === 'opening')!.source.objectId, '9223372036854775807');
    const wrong = fixture();
    wrong.programs[0]!.source.sha256 = 'd'.repeat(64);
    assert.throws(() => compileSourceMigrationWorkSet(wrong), /Conflicting physical source/);
    const record = fixture();
    record.observations = [{ id: 'sparse-json', scopeId: 'unknown', programIds: [], mapIds: [], record: [1, 2] }];
    delete (record.observations[0]!.record as number[])[0];
    assert.throws(() => compileSourceMigrationWorkSet(record), /complete plain/);
});

function scopedFixture(specs: { id: string; owner: string; scope: NonNullable<SourceMigrationBatch['scope']>; count?: number; unknown?: boolean }[]): SourceMigrationWorkSetInput {
    const programs: SourceMigrationProgram[] = [], gaps: SourceMigrationGap[] = [], batches: SourceMigrationBatch[] = [];
    for (const [index, spec] of specs.entries()) {
        const mapIds = spec.scope === 'complete-map' ? [index + 1] : [];
        const gapIds = Array.from({ length: spec.count ?? 1 }, (_, n) => spec.id + '-gap-' + n);
        if (spec.unknown)
            gapIds.push(spec.id + '-unknown');
        const p: SourceMigrationProgram = { id: spec.id, domain: 'field', source: source(spec.id), rawHash: pin, instructionCount: gapIds.length, mapIds, dependencyProgramIds: [], gapIds };
        programs.push(p);
        for (const [n, id] of gapIds.entries())
            gaps.push({ id, owner: id.endsWith('-unknown') ? 'unclassified' : spec.owner, code: id, reason: 'Complete retained source diagnostic ' + id, dependsOnGapIds: [], sites: [{ programId: p.id, index: n, source: p.source, mapIds }] });
        batches.push({ id: 'batch-' + spec.id, kind: 'structural-source-closure', scope: spec.scope, programIds: [p.id], mapIds, gapIds: [] });
    }
    return { sourceSetHash: pin, sourceDigest: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64), parallelism: 3, programs, gaps, batches };
}
test('unknown-blocked whole maps retain known preparation priority above many isolated programs', () => {
    const raw = scopedFixture([
        { id: 'map', owner: 'map-event-and-travel', scope: 'complete-map', count: 2, unknown: true },
        ...Array.from({ length: 80 }, (_, i) => ({ id: 'battle-' + i, owner: 'battle-and-return', scope: 'standalone-program' as const })),
    ]);
    raw.parallelism = 1;
    const work = compileSourceMigrationWorkSet(raw), first = work.waves[0]!, batch = work.batches.find(b => b.id === 'batch-map')!;
    assert.deepEqual(first.gapIds, ['map-gap-0', 'map-gap-1']);
    assert.deepEqual(first.potentialMapIdsPrepared, [1]);
    assert.deepEqual(first.potentialMapIdsClosed, []);
    assert.equal(batch.plannedPreparationWave, 1);
    assert.equal(batch.plannedClosureWave, null);
    assert.deepEqual(batch.blockedGapIds, ['map-unknown']);
    assert.equal(batch.executionAcceptance, 'missing-contract');
    assert(!work.waves.some(w => w.gapIds.includes('map-unknown')));
    assert.equal(work.counts.plannedGaps, 82);
    assert.equal(work.counts.blockedGaps, 1);
});
test('parallel slots are unique owner lanes, each bounded to three complementary gaps', () => {
    const raw = scopedFixture([
        { id: 'field', owner: 'map-event-and-travel', scope: 'complete-map', count: 5 },
        { id: 'owned', owner: 'owned-menus-economy-and-growth', scope: 'complete-map', count: 3 },
        { id: 'battle', owner: 'battle-and-return', scope: 'standalone-program', count: 4 },
    ]);
    raw.parallelism = 3;
    const work = compileSourceMigrationWorkSet(raw), first = work.waves[0]!;
    assert.equal(first.ownerLanes.length, 3);
    assert.equal(new Set(first.ownerLanes.map(l => l.owner)).size, 3);
    assert.deepEqual(first.ownerLanes.map(l => l.gapIds.length), [3, 3, 3]);
    assert.equal(first.gapIds.length, 9);
    assert.deepEqual(first.potentialMapIdsClosed, [2]);
    assert.deepEqual(work.waves[1]!.potentialMapIdsClosed, [1]);
    assert(work.waves.every(w => w.ownerLanes.every(l => l.gapIds.length <= 3 && l.gapIds.every(id => work.gaps.find(g => g.id === id)!.owner === l.owner))));
});
test('fair owner rotation admits waiting owners before owners served in the previous wave', () => {
    const raw = scopedFixture([
        { id: 'field', owner: 'map-event-and-travel', scope: 'complete-map', count: 8 },
        { id: 'owned', owner: 'owned-menus-economy-and-growth', scope: 'complete-map', count: 8 },
        { id: 'battle', owner: 'battle-and-return', scope: 'standalone-program', count: 8 },
        { id: 'save', owner: 'save-restore-and-continuation', scope: 'global-catalog', count: 8 },
    ]);
    raw.parallelism = 2;
    const work = compileSourceMigrationWorkSet(raw);
    assert.deepEqual(new Set(work.waves[0]!.ownerLanes.map(l => l.owner)), new Set(['map-event-and-travel', 'owned-menus-economy-and-growth']));
    assert.deepEqual(new Set(work.waves[1]!.ownerLanes.map(l => l.owner)), new Set(['battle-and-return', 'save-restore-and-continuation']));
    assert(work.waves.every(w => w.ownerLanes.length <= 2));
    assert.equal(work.counts.plannedGaps, 32);
});
test('scope is explicit and unknown-only maps never acquire a preparation or strict closure claim', () => {
    const raw = scopedFixture([{ id: 'unknown-map', owner: 'map-event-and-travel', scope: 'complete-map', count: 0, unknown: true }]);
    const work = compileSourceMigrationWorkSet(raw), b = work.batches[0]!;
    assert.equal(b.scope, 'complete-map');
    assert.equal(b.plannedPreparationWave, null);
    assert.equal(b.plannedClosureWave, null);
    assert.deepEqual(work.waves, []);
    assert.equal(compileSourceMigrationWorkSet(fixture()).batches[0]!.scope, 'unscoped');
    Reflect.set(raw.batches[0]!, 'scope', 'chapter');
    assert.throws(() => compileSourceMigrationWorkSet(raw), /Unknown source batch scope/);
    Reflect.set(raw.batches[0]!, 'scope', 'complete-map');
    raw.batches[0]!.mapIds = [];
    assert.throws(() => compileSourceMigrationWorkSet(raw), /original map identity/);
});
