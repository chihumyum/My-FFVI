import { hash } from "./content.js";
import { CONTENT_BATCH_SYSTEMS, type ContentBatchSystem } from "./content-batch-work-plan.js";
export type SourceMigrationJson = null | boolean | number | string | SourceMigrationJson[] | {
    [key: string]: SourceMigrationJson;
};
export type SourceMigrationSource = {
    file: string;
    assetPath: string;
    objectId: string;
    serializedFile: string;
    sha256: string;
};
export type SourceMigrationProgram = {
    id: string;
    domain: string;
    source: SourceMigrationSource;
    rawHash: string;
    instructionCount: number;
    mapIds: number[];
    dependencyProgramIds: string[];
    gapIds: string[];
};
export type SourceMigrationSite = {
    kind?: "instruction";
    programId: string;
    index: number;
    source: SourceMigrationSource;
    mapIds: number[];
} | {
    kind: "dependency";
    scopeId: string;
    mapIds: number[];
    record: SourceMigrationJson;
};
export type SourceMigrationGap = {
    id: string;
    owner: string;
    code: string;
    reason: string;
    sites: SourceMigrationSite[];
    dependsOnGapIds: string[];
};
export type SourceMigrationBatchScope = "complete-map" | "standalone-program" | "global-catalog" | "unscoped";
export type SourceMigrationBatch = {
    id: string;
    kind: "structural-source-closure" | "declared-story-route";
    scope?: SourceMigrationBatchScope;
    programIds: string[];
    mapIds: number[];
    gapIds: string[];
    routeContract?: {
        id: string;
        sha256: string;
    };
};
export type SourceMigrationObservation = {
    id: string;
    scopeId: string;
    programIds: string[];
    mapIds: number[];
    record: SourceMigrationJson;
};
export type SourceMigrationWorkSetInput = {
    sourceSetHash: string;
    sourceDigest: string;
    runtimeSha256: string;
    programs: SourceMigrationProgram[];
    gaps: SourceMigrationGap[];
    batches: SourceMigrationBatch[];
    observations?: SourceMigrationObservation[];
    parallelism?: number;
};
export type SourceMigrationBlock = {
    gapId: string;
    reasons: ("unclassified-owner" | "dependency-cycle" | "blocked-dependency")[];
    blockedDependencyGapIds: string[];
};
export type SourceMigrationWave = {
    index: number;
    gapIds: string[];
    tasks: {
        gapId: string;
        owner: ContentBatchSystem;
        readyForNomination: boolean;
        assumesPriorGapIds: string[];
    }[];
    ownerLanes: { owner: ContentBatchSystem; gapIds: string[] }[];
    potentialBatchIdsPrepared: string[];
    potentialMapIdsPrepared: number[];
    potentialBatchIdsClosed: string[];
    potentialProgramIdsClosed: string[];
    potentialMapIdsClosed: number[];
    assumesPriorWavesCompleted: boolean;
};
export type SourceMigrationWorkSet = {
    kind: "source-migration-work-set-v1";
    contentHash: string;
    sourceSetHash: string;
    sourceDigest: string;
    runtimeSha256: string;
    parallelism: number;
    programs: SourceMigrationProgram[];
    gaps: (SourceMigrationGap & {
        declaredOwner: string;
        owner: ContentBatchSystem;
        readyForNomination: boolean;
    })[];
    batches: (SourceMigrationBatch & {
        requiredProgramIds: string[];
        requiredGapIds: string[];
        requiredMapIds: number[];
        blockedGapIds: string[];
        readyForNomination: boolean;
        scope: SourceMigrationBatchScope;
        plannedPreparationWave: number | null;
        plannedClosureWave: number | null;
        executionAcceptance: "missing-contract" | "unassessed";
    })[];
    observations: SourceMigrationObservation[];
    gapComponents: {
        id: string;
        gapIds: string[];
        dependsOnComponentIds: string[];
        cyclic: boolean;
    }[];
    programCycles: string[][];
    blocked: SourceMigrationBlock[];
    waves: SourceMigrationWave[];
    readyForNominationGapIds: string[];
    unbatchedProgramIds: string[];
    counts: {
        programs: number;
        instructions: number;
        gaps: number;
        sites: number;
        instructionSites: number;
        dependencySites: number;
        batches: number;
        observations: number;
        plannedGaps: number;
        blockedGaps: number;
    };
    planningMethod: "whole-map-preparation-owner-lanes-v2";
    runtimeAdmission: "unassessed";
    playable: false;
    sourceCampaignComplete: false;
    limitations: string[];
};
export const SOURCE_MIGRATION_ASSESSED_DOMAINS = ["field", "battle", "ai"] as const;
export const SOURCE_MIGRATION_UNASSESSED_DOMAIN_GAP = "unassessed-program-domain";
const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ordered = (values: Iterable<string>) => [...new Set(values)].sort(lex);
const numbers = (values: Iterable<number>) => [...new Set(values)].sort((a, b) => a - b);
function text(value: unknown): asserts value is string {
    // Physical corpus IDs contain bundle::full namespace; never truncate them.
    if (typeof value !== "string" || !value.trim())
        throw Error("Missing work-set identity/text");
}
function digest(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        throw Error("Invalid work-set source/runtime digest");
}
function integer(value: unknown, min = 0): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > 0x7fffffff)
        throw Error("Invalid work-set integer");
}
function dense(raw: unknown): asserts raw is unknown[] {
    if (!Array.isArray(raw) || Reflect.ownKeys(raw).length !== raw.length + 1)
        throw Error("Work set requires complete plain arrays");
    for (let i = 0; i < raw.length; i++) {
        const d = Object.getOwnPropertyDescriptor(raw, String(i));
        if (!d || !d.enumerable || !("value" in d))
            throw Error("Work set requires complete plain array values");
    }
}
function object(raw: unknown, required: string, optional = ""): asserts raw is Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw)))
        throw Error("Work set requires plain records");
    const keys = required.split(',').filter(Boolean), allowed = new Set([...keys, ...optional.split(',').filter(Boolean)]);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string' || !allowed.has(k)) || keys.some(k => !Object.hasOwn(raw, k)))
        throw Error("Unknown/missing work-set record fields");
    for (const d of Object.values(Object.getOwnPropertyDescriptors(raw)))
        if (!("value" in d) || !d.enumerable)
            throw Error("Work set requires plain record values");
}
function ids(raw: unknown, numeric = false): void {
    dense(raw);
    for (const v of raw)
        numeric ? integer(v, 1) : text(v);
    if (new Set(raw).size !== raw.length)
        throw Error("Duplicate work-set reference");
}
function source(raw: unknown): asserts raw is SourceMigrationSource {
    object(raw, 'file,assetPath,objectId,serializedFile,sha256');
    for (const k of ['file', 'assetPath', 'objectId', 'serializedFile'])
        text(raw[k]);
    digest(raw.sha256);
    const id = raw.objectId as string;
    if (!/^-?(?:0|[1-9]\d*)$/.test(id) || String(BigInt(id)) !== id || BigInt(id) < -(1n << 63n) || BigInt(id) >= (1n << 63n))
        throw Error("Invalid physical source object identity");
}
function json(raw: unknown, active = new Set<object>(), depth = 0): asserts raw is SourceMigrationJson {
    if (raw === null || typeof raw === 'string' || typeof raw === 'boolean')
        return;
    if (typeof raw === 'number' && Number.isFinite(raw))
        return;
    if (!raw || typeof raw !== 'object' || depth > 128 || active.has(raw))
        throw Error("Invalid/cyclic observation JSON");
    active.add(raw);
    if (Array.isArray(raw)) {
        dense(raw);
        for (const v of raw)
            json(v, active, depth + 1);
    }
    else {
        if (![null, Object.prototype].includes(Object.getPrototypeOf(raw)) || Reflect.ownKeys(raw).some(k => typeof k !== 'string'))
            throw Error('Observation requires plain JSON records');
        for (const d of Object.values(Object.getOwnPropertyDescriptors(raw))) {
            if (!d.enumerable || !('value' in d))
                throw Error('Observation requires plain JSON values');
            json(d.value, active, depth + 1);
        }
    }
    active.delete(raw);
}
function unique<T extends {
    id: string;
}>(rows: T[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const row of rows) {
        text(row.id);
        if (result.has(row.id))
            throw Error("Duplicate work-set identity: " + row.id);
        result.set(row.id, row);
    }
    return result;
}
/** Iterative SCC traversal also handles long source call/dependency chains. */
function components(ids: string[], edges: (id: string) => readonly string[]): string[][] {
    const visited = new Set<string>(), finish: string[] = [], reverse = new Map(ids.map(id => [id, [] as string[]]));
    for (const id of ids)
        for (const dep of edges(id))
            reverse.get(dep)!.push(id);
    for (const root of ids) {
        if (visited.has(root))
            continue;
        visited.add(root);
        const stack = [{ id: root, index: 0, edges: ordered(edges(root)) }];
        while (stack.length) {
            const top = stack.at(-1)!;
            if (top.index < top.edges.length) {
                const dep = top.edges[top.index++]!;
                if (!visited.has(dep)) {
                    visited.add(dep);
                    stack.push({ id: dep, index: 0, edges: ordered(edges(dep)) });
                }
            }
            else {
                finish.push(top.id);
                stack.pop();
            }
        }
    }
    const seen = new Set<string>(), result: string[][] = [];
    for (const root of finish.reverse()) {
        if (seen.has(root))
            continue;
        seen.add(root);
        const stack = [root], group: string[] = [];
        while (stack.length) {
            const id = stack.pop()!;
            group.push(id);
            for (const dep of reverse.get(id)!)
                if (!seen.has(dep)) {
                    seen.add(dep);
                    stack.push(dep);
                }
        }
        result.push(group.sort(lex));
    }
    return result.sort((a, b) => lex(a[0]!, b[0]!));
}
/** Input normalization binds supplied identities, not raw-byte verification or
 * runtime authority. The caller must retain the complete verified source scan.
 * Waves are hypothetical implementation nominations, never completed work. */
export function compileSourceMigrationWorkSet(input: SourceMigrationWorkSetInput): SourceMigrationWorkSet {
    object(input, 'sourceSetHash,sourceDigest,runtimeSha256,programs,gaps,batches', 'parallelism,observations');
    for (const pin of [input.sourceSetHash, input.sourceDigest, input.runtimeSha256])
        digest(pin);
    for (const a of [input.programs, input.gaps, input.batches])
        dense(a);
    if (!input.programs.length)
        throw Error("Work set requires the full nonempty source program inventory");
    const parallelism = Object.hasOwn(input, 'parallelism') ? input.parallelism : 3;
    integer(parallelism, 1);
    if (parallelism > 32)
        throw Error("Unbounded work-set parallelism");
    for (const p of input.programs) {
        object(p, 'id,domain,source,rawHash,instructionCount,mapIds,dependencyProgramIds,gapIds');
        text(p.id);
        text(p.domain);
        source(p.source);
        digest(p.rawHash);
        integer(p.instructionCount);
        ids(p.mapIds, true);
        ids(p.dependencyProgramIds);
        ids(p.gapIds);
    }
    for (const g of input.gaps) {
        object(g, 'id,owner,code,reason,sites,dependsOnGapIds');
        for (const s of [g.id, g.owner, g.code, g.reason])
            text(s);
        dense(g.sites);
        ids(g.dependsOnGapIds);
        const siteKeys = new Set<string>();
        for (const s of g.sites) {
            if (s?.kind === 'dependency') {
                object(s, 'kind,scopeId,mapIds,record');
                text(s.scopeId);
                ids(s.mapIds, true);
                json(s.record);
            }
            else {
                object(s, 'programId,index,source,mapIds', 'kind');
                if (s.kind !== undefined && s.kind !== 'instruction')
                    throw Error('Unknown source site kind');
                text(s.programId);
                integer(s.index);
                source(s.source);
                ids(s.mapIds, true);
            }
            const key = hash({ ...s, ...(s.kind === 'dependency' ? {} : { kind: 'instruction' }), mapIds: numbers(s.mapIds) });
            if (siteKeys.has(key))
                throw Error('Duplicate source gap site');
            siteKeys.add(key);
        }
    }
    for (const b of input.batches) {
        object(b, 'id,kind,programIds,mapIds,gapIds', 'routeContract,scope');
        text(b.id);
        if (!['structural-source-closure', 'declared-story-route'].includes(b.kind))
            throw Error('Unknown source batch kind');
        if (b.scope !== undefined && !['complete-map', 'standalone-program', 'global-catalog', 'unscoped'].includes(b.scope))
            throw Error('Unknown source batch scope');
        if (b.scope === 'complete-map' && !b.mapIds.length)
            throw Error('Complete-map scope requires its original map identity');
        ids(b.programIds);
        ids(b.mapIds, true);
        ids(b.gapIds);
        if (b.routeContract !== undefined) {
            object(b.routeContract, 'id,sha256');
            text(b.routeContract.id);
            digest(b.routeContract.sha256);
        }
    }
    const observations = Object.hasOwn(input, 'observations') ? input.observations! : [];
    dense(observations);
    for (const o of observations) {
        object(o, 'id,scopeId,programIds,mapIds,record');
        text(o.id);
        text(o.scopeId);
        ids(o.programIds);
        ids(o.mapIds, true);
        json(o.record);
    }
    unique(observations);
    const programs = structuredClone(input.programs).map(p => ({ ...p, mapIds: numbers(p.mapIds), dependencyProgramIds: ordered(p.dependencyProgramIds), gapIds: ordered(p.gapIds) })).sort((a, b) => lex(a.id, b.id));
    const gaps = structuredClone(input.gaps).map(g => ({ ...g, declaredOwner: g.owner, owner: (CONTENT_BATCH_SYSTEMS as readonly string[]).includes(g.owner) ? g.owner as ContentBatchSystem : 'unclassified' as const,
        dependsOnGapIds: ordered(g.dependsOnGapIds), sites: g.sites.map((s): SourceMigrationSite => s.kind === 'dependency' ? { ...s, mapIds: numbers(s.mapIds) } : { ...s, kind: 'instruction', mapIds: numbers(s.mapIds) }).sort((a, b) => lex(hash(a), hash(b))) })).sort((a, b) => lex(a.id, b.id));
    const pm = unique(programs), gm = unique(gaps);
    unique(input.batches);
    const refs = (values: readonly string[], map: Map<string, unknown>) => { for (const id of values)
        if (!map.has(id))
            throw Error('Missing work-set reference: ' + id); };
    const physical = new Set<string>(), filePins = new Map<string, string>();
    for (const p of programs) {
        const previous = filePins.get(p.source.file);
        if (previous !== undefined && previous !== p.source.sha256)
            throw Error('Conflicting physical source file hashes');
        filePins.set(p.source.file, p.source.sha256);
        const { sha256, ...identity } = p.source, key = hash(identity);
        if (physical.has(key))
            throw Error('Duplicate physical source program');
        physical.add(key);
        refs(p.dependencyProgramIds, pm);
        refs(p.gapIds, gm);
        if (!(SOURCE_MIGRATION_ASSESSED_DOMAINS as readonly string[]).includes(p.domain) && !p.gapIds.some(id => gm.get(id)!.owner === 'unclassified' && gm.get(id)!.code === SOURCE_MIGRATION_UNASSESSED_DOMAIN_GAP))
            throw Error('Unassessed source domain requires its explicit unclassified gap');
    }
    for (const g of gaps) {
        refs(g.dependsOnGapIds, gm);
        for (const s of g.sites)
            if (s.kind !== 'dependency') {
                const p = pm.get(s.programId);
                if (!p || s.index >= p.instructionCount || hash(s.source) !== hash(p.source) || s.mapIds.some(id => !p.mapIds.includes(id)) || !p.gapIds.includes(g.id))
                    throw Error('Gap site is not bound to its full physical source program');
            }
    }
    for (const o of observations)
        refs(o.programIds, pm);
    const gapGroups = components(gaps.map(g => g.id), id => gm.get(id)!.dependsOnGapIds), groupOf = new Map<string, string>();
    for (const group of gapGroups) {
        const id = 'gap-component:' + hash(group);
        for (const gap of group)
            groupOf.set(gap, id);
    }
    const gapComponents = gapGroups.map(group => ({ id: groupOf.get(group[0]!)!, gapIds: group, dependsOnComponentIds: ordered(group.flatMap(id => gm.get(id)!.dependsOnGapIds.map(dep => groupOf.get(dep)!)).filter(id => id !== groupOf.get(group[0]!)!)), cyclic: group.length > 1 || gm.get(group[0]!)!.dependsOnGapIds.includes(group[0]!) }));
    const cycles = new Set(gapComponents.filter(g => g.cyclic).flatMap(g => g.gapIds)), blockedIds = new Set(gaps.filter(g => g.owner === 'unclassified' || cycles.has(g.id)).map(g => g.id));
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of gaps)
            if (!blockedIds.has(g.id) && g.dependsOnGapIds.some(id => blockedIds.has(id))) {
                blockedIds.add(g.id);
                changed = true;
            }
    }
    const blocked: SourceMigrationBlock[] = gaps.filter(g => blockedIds.has(g.id)).map(g => ({ gapId: g.id, reasons: [...(g.owner === 'unclassified' ? ['unclassified-owner' as const] : []), ...(cycles.has(g.id) ? ['dependency-cycle' as const] : []), ...(g.dependsOnGapIds.some(id => blockedIds.has(id) && !cycles.has(g.id)) ? ['blocked-dependency' as const] : [])], blockedDependencyGapIds: g.dependsOnGapIds.filter(id => blockedIds.has(id)) }));
    const batches = input.batches.map(b => {
        refs(b.programIds, pm);
        refs(b.gapIds, gm);
        const requiredPrograms = new Set<string>(), queue = [...b.programIds];
        while (queue.length) {
            const id = queue.pop()!;
            if (requiredPrograms.has(id))
                continue;
            requiredPrograms.add(id);
            queue.push(...pm.get(id)!.dependencyProgramIds);
        }
        const requiredGaps = new Set<string>(), pending = [...b.gapIds, ...[...requiredPrograms].flatMap(id => pm.get(id)!.gapIds)];
        while (pending.length) {
            const id = pending.pop()!;
            if (requiredGaps.has(id))
                continue;
            requiredGaps.add(id);
            pending.push(...gm.get(id)!.dependsOnGapIds);
        }
        return { ...structuredClone(b), scope: b.scope ?? 'unscoped' as SourceMigrationBatchScope, programIds: ordered(b.programIds), mapIds: numbers(b.mapIds), gapIds: ordered(b.gapIds), requiredProgramIds: ordered(requiredPrograms), requiredGapIds: ordered(requiredGaps), requiredMapIds: numbers([...b.mapIds, ...[...requiredPrograms].flatMap(id => pm.get(id)!.mapIds), ...[...requiredGaps].flatMap(id => gm.get(id)!.sites.flatMap(s => s.mapIds))]), blockedGapIds: ordered([...requiredGaps].filter(id => blockedIds.has(id))), readyForNomination: requiredGaps.size === 0, plannedPreparationWave: null as number | null, plannedClosureWave: null as number | null, executionAcceptance: b.kind === 'declared-story-route' && b.routeContract ? 'unassessed' as const : 'missing-contract' as const };
    }).sort((a, b) => lex(a.id, b.id));
    const planned = new Set<string>(), waves: SourceMigrationWave[] = [];
    const lastOwnerWave = new Map<ContentBatchSystem, number>();
    // A parallel slot belongs to an owner, not to a single diagnostic. Each
    // lane nominates at most three complementary gaps from one batch frontier.
    // Unknown dependencies remain in strict closure, but cannot erase an
    // entire map's known implementation work from preparation scoring.
    while (planned.size + blockedIds.size < gaps.length) {
        const ready = gaps.filter(g => !blockedIds.has(g.id) && !planned.has(g.id) && g.dependsOnGapIds.every(id => planned.has(id))).map(g => g.id);
        if (!ready.length)
            throw Error('Inconsistent acyclic work-set frontier');
        const readySet = new Set(ready), chosen = new Set<string>(), prior = new Set(planned);
        const pending = batches.map(b => ({ batch: b, missing: b.requiredGapIds.filter(id => !blockedIds.has(id) && !prior.has(id)) })).filter(b => b.missing.length);
        const scores = new Map<string, number[]>();
        const score = (selected: Set<string>) => {
            const key = JSON.stringify(ordered(selected)), cached = scores.get(key);
            if (cached)
                return cached;
            // Priority tiers are source contracts/maps, catalogs, unscoped
            // closures, then isolated programs. No site count or opening PC.
            const result = Array<number>(12).fill(0);
            for (const { batch: b, missing } of pending) {
                const hits = missing.reduce((n, id) => n + Number(selected.has(id)), 0);
                if (!hits)
                    continue;
                const prepared = hits === missing.length, strict = prepared && !b.blockedGapIds.length;
                const declared = b.kind === 'declared-story-route' && b.routeContract;
                if (declared) {
                    result[0]! += Number(strict);
                    result[1]! += Number(prepared);
                    result[2]! += hits / missing.length;
                }
                else if (b.scope === 'complete-map') {
                    result[3]! += Number(strict);
                    result[4]! += Number(prepared);
                    result[5]! += hits / missing.length;
                }
                else {
                    const offset = b.scope === 'global-catalog' ? 6 : b.scope === 'standalone-program' ? 10 : 8;
                    result[offset]! += Number(prepared);
                    result[offset + 1]! += hits / missing.length;
                }
            }
            result.push(-selected.size);
            scores.set(key, result);
            return result;
        };
        const compare = (a: Set<string>, b: Set<string>) => {
            const x = score(a), y = score(b);
            for (let i = 0; i < x.length; i++)
                if (x[i] !== y[i])
                    return x[i]! - y[i]!;
            return -lex(JSON.stringify(ordered(a)), JSON.stringify(ordered(b)));
        };
        const owners = ordered(ready.map(id => gm.get(id)!.owner)) as ContentBatchSystem[];
        const ownerLanes: SourceMigrationWave['ownerLanes'] = [];
        while (owners.length && ownerLanes.length < parallelism) {
            const last = Math.min(...owners.map(owner => lastOwnerWave.get(owner) ?? 0));
            let selectedOwner: ContentBatchSystem | undefined, selectedBundle: Set<string> | undefined;
            for (const owner of owners.filter(owner => (lastOwnerWave.get(owner) ?? 0) === last)) {
                const ownReady = ready.filter(id => gm.get(id)!.owner === owner);
                const single = new Map(ownReady.map(id => [id, new Set([...chosen, id])]));
                const ranked = [...ownReady].sort((a, b) => -compare(single.get(a)!, single.get(b)!));
                const candidates = [...single.values()];
                for (const { missing } of pending) {
                    const frontier = new Set(missing.filter(id => readySet.has(id) && gm.get(id)!.owner === owner));
                    if (frontier.size > 1) {
                        const complement = ranked.filter(id => frontier.has(id)).slice(0, 3);
                        candidates.push(new Set([...chosen, ...complement]));
                    }
                }
                let best = candidates[0]!;
                for (const candidate of candidates.slice(1))
                    if (compare(candidate, best) > 0)
                        best = candidate;
                if (!selectedBundle || compare(best, selectedBundle) > 0 || compare(best, selectedBundle) === 0 && lex(owner, selectedOwner!) < 0) {
                    selectedOwner = owner;
                    selectedBundle = best;
                }
            }
            const owner = selectedOwner!, gapIds = ordered([...selectedBundle!].filter(id => !chosen.has(id)));
            ownerLanes.push({ owner, gapIds });
            for (const id of gapIds)
                chosen.add(id);
            owners.splice(owners.indexOf(owner), 1);
        }
        const index = waves.length + 1;
        for (const lane of ownerLanes)
            lastOwnerWave.set(lane.owner, index);
        const prepared = pending.filter(b => b.missing.every(id => chosen.has(id))).map(b => b.batch);
        const closed = prepared.filter(b => !b.blockedGapIds.length);
        for (const id of chosen)
            planned.add(id);
        for (const b of prepared)
            b.plannedPreparationWave = index;
        for (const b of closed)
            b.plannedClosureWave = index;
        waves.push({ index, gapIds: ordered(chosen), ownerLanes,
            potentialBatchIdsPrepared: prepared.map(b => b.id),
            potentialMapIdsPrepared: numbers(prepared.filter(b => b.scope === 'complete-map').flatMap(b => b.mapIds)),
            tasks: ordered(chosen).map(id => ({ gapId: id, owner: gm.get(id)!.owner, readyForNomination: gm.get(id)!.dependsOnGapIds.length === 0, assumesPriorGapIds: [...gm.get(id)!.dependsOnGapIds] })),
            potentialBatchIdsClosed: closed.map(b => b.id), potentialProgramIdsClosed: ordered(closed.flatMap(b => b.requiredProgramIds)),
            potentialMapIdsClosed: numbers(closed.filter(b => b.scope === 'complete-map').flatMap(b => b.mapIds)), assumesPriorWavesCompleted: index > 1 });
    }
    const programGroups = components(programs.map(p => p.id), id => pm.get(id)!.dependencyProgramIds), programCycles = programGroups.filter(group => group.length > 1 || pm.get(group[0]!)!.dependencyProgramIds.includes(group[0]!));
    const body: Omit<SourceMigrationWorkSet, 'contentHash'> = { kind: 'source-migration-work-set-v1', sourceSetHash: input.sourceSetHash, sourceDigest: input.sourceDigest, runtimeSha256: input.runtimeSha256, parallelism, programs, gaps: gaps.map(g => ({ ...g, readyForNomination: !blockedIds.has(g.id) && g.dependsOnGapIds.length === 0 })), batches, observations: structuredClone(observations).map(o => ({ ...o, mapIds: numbers(o.mapIds), programIds: ordered(o.programIds) })).sort((a, b) => lex(a.id, b.id)), gapComponents, programCycles, blocked, waves, readyForNominationGapIds: gaps.filter(g => !blockedIds.has(g.id) && !g.dependsOnGapIds.length).map(g => g.id), unbatchedProgramIds: programs.filter(p => !batches.some(b => b.requiredProgramIds.includes(p.id))).map(p => p.id), counts: { programs: programs.length, instructions: programs.reduce((n, p) => n + p.instructionCount, 0), gaps: gaps.length, sites: gaps.reduce((n, g) => n + g.sites.length, 0), instructionSites: gaps.reduce((n, g) => n + g.sites.filter(s => s.kind === 'instruction').length, 0), dependencySites: gaps.reduce((n, g) => n + g.sites.filter(s => s.kind === 'dependency').length, 0), batches: batches.length, observations: observations.length, plannedGaps: planned.size, blockedGaps: blockedIds.size }, planningMethod: 'whole-map-preparation-owner-lanes-v2', runtimeAdmission: 'unassessed', playable: false, sourceCampaignComplete: false, limitations: ['Full source/program/gap/site/observation records are retained; supplied digests are bindings, not independent raw-byte verification.', 'Wave benefits are hypothetical preparation or strict dependency closures, never executed source bodies or playable maps. Preparation excludes blocked unknowns; strict closure retains them.', 'Deterministic owner lanes prioritize whole declared contracts and maps before isolated programs. At most three complementary gaps per owner and fair owner rotation bound parallel nominations; no global optimum is claimed.', 'Later waves assume earlier nominated gaps have actually been implemented and accepted; no dependency is marked implemented here.', 'Unknown owners and gap cycles remain blocked together with their downstream dependencies. Program call cycles are retained as structural groups.', 'Structural source cohorts have no story route contract; even a declared contract remains unassessed and requires real owner lifecycle and continuous route acceptance.', 'Conditional observations are evidence records, not automatically missing implementations or readiness authority.'] };
    return { ...body, contentHash: hash(body) };
}
