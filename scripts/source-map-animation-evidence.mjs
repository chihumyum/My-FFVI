import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** One collection-scoped reader. Both sides are reconstructed from the same
 * physical corpus and original media, never inferred from candidate metadata. */
export function createSourceMapAnimationEvidenceReader({ root, compiledDir = 'dist' }) {
    let context;
    const maps = new Map();
    return async (document) => {
        context ??= (async () => {
            const load = name => import(pathToFileURL(resolve(root, compiledDir, 'src/compiler', name + '.js')).href);
            const [{ loadCorpus }, { loadSystemMessages }, { bindMapPackages }, { compileEntityGroup, entityProperties }, { compileWorldCharacter }, { NATIVE_ANIMATION_JSON }, { readSnapshot, snapshotFile }, { canonical, hash }] = await Promise.all([
                load('corpus'), load('system-messages'), load('map-package'), load('entity-group'), load('world'),
                load('field-animation-import'), load('integrity'), load('content')
            ]);
            const { missingFieldPoses } = await import(pathToFileURL(resolve(root, compiledDir, 'src/core/character-media.js')).href);
            const corpus = await loadCorpus(root), system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources), mediaFiles = await readSnapshot(resolve(root, 'build/world-media')), media = JSON.parse(snapshotFile(mediaFiles, 'media.json'));
            assert.equal(media.parentSourceSetHash, corpus.sourceSetHash, 'Animation import media/corpus mismatch');
            assert.equal(media.formatVersion, 1);
            assert.equal(media.adapterVersion, 'world-media-0.1.0');
            assert.equal(hash(media.sources), media.sourceSetHash);
            const sourceFiles = new Map(corpus.manifest.sources.map(s => [s.file, s.sha256]));
            for (const s of media.sources)
                assert.equal(sourceFiles.get(s.file), s.sha256, 'Animation import media source changed');
            const physical = new Map(corpus.assets.filter(a => a.source.assetPath.endsWith('/anim_info.json')).map(a => [canonical(a.source), a]));
            const oldCharacters = {}, newCharacters = {}, oldIssues = {}, newIssues = {}, imports = {};
            for (const [key, raw] of Object.entries(media.characters)) {
                const animation = raw.animation, asset = physical.get(canonical(animation.source));
                const binding = asset && hash(asset.data) === hash(animation.data) ? { kind: NATIVE_ANIMATION_JSON, source: asset.source,
                    rawHash: hash(asset.data), sources: corpus.manifest.sources } : undefined;
                const verify = (file, digest) => assert.equal(sha(snapshotFile(mediaFiles, file)), digest, 'Animation import sprite changed');
                const old = compileWorldCharacter(raw, verify), next = compileWorldCharacter(raw, verify, binding);
                oldCharacters[key] = old.character;
                newCharacters[key] = next.character;
                oldIssues[key] = old.issues;
                newIssues[key] = next.issues;
                if (next.imports.length)
                    imports[key] = next.imports;
            }
            return { corpus, sourceDigest: hash(corpus), canonical, hash, compileEntityGroup, entityProperties,
                messages: { ...corpus.messages, system_zhc: system.messages }, byId: new Map(corpus.assets.map(a => [a.id, a])),
                bindings: new Map(bindMapPackages(corpus.assets, corpus.tables).map(b => [Number(b.id), b])),
                oldCharacters, newCharacters, oldIssues, newIssues, imports, missingFieldPoses };
        })();
        const data = await context;
        assert.equal(document.sourceSetHash, data.corpus.sourceSetHash, 'Animation source addition corpus mismatch');
        assert.equal(document.parentSourceSetHash, data.corpus.manifest.parentSourceSetHash, 'Animation source addition parent mismatch');
        if (document.kind === 'world-development')
            return { ...data, kind: 'verified-source-animation-world-evidence-v1' };
        if (!maps.has(document.mapId)) {
            const binding = data.bindings.get(document.mapId);
            assert.ok(binding, 'Animation source addition map not bound');
            const groups = {};
            for (const [name, id] of Object.entries(binding.groups)) {
                const asset = data.byId.get(id);
                assert.ok(asset);
                const sources = new Set();
                for (const [li, layer] of (asset.data.layers ?? []).entries())
                    for (const [oi, object] of (layer.objects ?? []).entries())
                        if (data.entityProperties(object.properties).object_type === 10)
                            sources.add(data.canonical({ ...asset.source, pointer: `/layers/${li}/objects/${oi}` }));
                const old = data.compileEntityGroup(name, asset, data.corpus.tables, data.messages, 16, 'source-map-animation-legacy-audit-v1'), next = data.compileEntityGroup(name, asset, data.corpus.tables, data.messages);
                for (const [group, characters] of [[old, data.oldCharacters], [next, data.newCharacters]])
                    for (const e of group.entities) {
                        if (e.script && !document.scripts[e.script])
                            group.blockers.push({ reason: 'Missing entity script ' + e.script, source: e.source });
                        if (e.asset)
                            for (const key of e.kind === 10 ? (characters[e.asset]?.animations.Default ? [] : ['Default']) : data.missingFieldPoses(characters[e.asset]))
                                group.blockers.push({ reason: `Missing character pose ${e.asset}/${key}`, source: e.source });
                    }
                groups[name] = { source: asset.source, rawHash: data.hash(asset.data), sources, old, next };
            }
            maps.set(document.mapId, { kind: 'verified-source-map-animation-evidence-v1', ...data, groups });
        }
        return maps.get(document.mapId);
    };
}
/** Candidate-only comparison projection. Every replaced value is first checked
 * against an exact fresh source compilation. The real document is untouched. */
export function compareSourceMapAnimationAddition(before, after, evidence, proof) {
    const { canonical, hash } = evidence, copy = structuredClone(after), changes = [];
    if (after.kind === 'world-development') {
        assert.equal(canonical(after.characters), canonical(evidence.newCharacters), 'Animation candidate media differs from raw source');
        assert.equal(canonical(after.characterIssues), canonical(evidence.newIssues), 'Animation candidate diagnostics differ from source');
        assert.equal(canonical(after.characterImports ?? {}), canonical(evidence.imports), 'Animation candidate import observations differ from source');
        const legacy = before.characterImports === undefined;
        assert.equal(canonical(before.characters), canonical(legacy ? evidence.oldCharacters : evidence.newCharacters), 'Animation previous media is not the verified legacy/current source import');
        assert.equal(canonical(before.characterIssues), canonical(legacy ? evidence.oldIssues : evidence.newIssues), 'Animation previous diagnostics differ from source');
        if (!legacy)
            assert.equal(canonical(before.characterImports), canonical(evidence.imports), 'Animation previous observations changed');
        copy.characters = structuredClone(before.characters);
        copy.characterIssues = structuredClone(before.characterIssues);
        if (legacy)
            delete copy.characterImports;
        else
            copy.characterImports = structuredClone(before.characterImports);
        if (canonical(before.characters) !== canonical(after.characters) || legacy && Object.keys(evidence.imports).length)
            changes.push({ field: 'characters/characterIssues/characterImports', previousHash: hash({ characters: before.characters, issues: before.characterIssues, imports: before.characterImports ?? null }),
                candidateHash: hash({ characters: after.characters, issues: after.characterIssues, imports: after.characterImports }), observations: structuredClone(evidence.imports) });
    }
    else if (after.kind === 'world-map-development' && after.map && before.map) {
        const replacements = new Map(), addedAssets = new Set();
        const familyRows = group => group.entities.filter(e => e.kind === 10);
        const familySources = new Set(Object.values(evidence.groups).flatMap(pair => [...pair.sources]));
        const isActiveFamily = entity => entity.kind === 10 || familySources.has(canonical(entity.source));
        const covered = (b, sources) => sources.has(canonical(b.source)) || b.reason.startsWith('Missing character pose ');
        const familyBlockers = (group, sources) => group.blockers.filter(b => covered(b, sources));
        const actualNext = (g, document) => ({ ...g, blockers: g.blockers.filter(b => !(b.reason === 'Native animated map entity presentation/lifecycle is unbound' && document.developmentProfile?.mapAnimatedEntities === 'web-field-animated-map-entities-v1')) });
        for (const [name, pair] of Object.entries(evidence.groups)) {
            const old = before.map.groups?.[name], next = after.map.groups?.[name];
            assert.ok(old && next, 'Animation source group disappeared');
            assert.equal(canonical(old.source), canonical(pair.source), 'Animation previous group binding changed');
            assert.equal(canonical(next.source), canonical(pair.source), 'Animation candidate group binding changed');
            const expectedNext = actualNext(pair.next, after), oldCurrent = actualNext(pair.next, before);
            assert.equal(canonical(familyRows(next)), canonical(familyRows(expectedNext)), 'Animation candidate entity differs from source');
            assert.equal(canonical(familyBlockers(next, pair.sources)), canonical(familyBlockers(expectedNext, pair.sources)), 'Animation candidate family diagnostics differ from source');
            const legacy = canonical(familyRows(old)) === canonical(familyRows(pair.old)) && canonical(familyBlockers(old, pair.sources)) === canonical(familyBlockers(pair.old, pair.sources));
            if (!legacy) {
                assert.equal(canonical(familyRows(old)), canonical(familyRows(oldCurrent)), 'Animation previous entities are not verified legacy/current source');
                assert.equal(canonical(familyBlockers(old, pair.sources)), canonical(familyBlockers(oldCurrent, pair.sources)), 'Animation previous family diagnostics differ from source');
            }
            for (const e of familyRows(next))
                if (e.asset)
                    addedAssets.add(e.asset);
            for (const source of pair.sources)
                replacements.set(source, old.entities.find(e => canonical(e.source) === source));
            const projected = copy.map.groups[name];
            projected.entities = projected.entities.flatMap(e => {
                const key = canonical(e.source);
                return pair.sources.has(key) ? (replacements.get(key) ? [structuredClone(replacements.get(key))] : []) : [e];
            });
            const nextNonFamily = next.blockers.filter(b => !covered(b, pair.sources)), oldNonFamily = old.blockers.filter(b => !covered(b, pair.sources));
            assert.equal(canonical(nextNonFamily), canonical(oldNonFamily), 'Unrelated group diagnostics changed during animation import');
            projected.blockers = structuredClone(old.blockers);
            if (canonical(old) !== canonical(next))
                changes.push({ group: name, source: pair.source, rawHash: pair.rawHash, previousHash: hash(old), candidateHash: hash(next), legacyImport: legacy });
        }
        // compileWorld's source initialization installs exactly entity_default.
        // Verify that complete membership, not only rows that happen to remain
        // active: normalization must not hide an omitted/duplicated actor or an
        // active row that disagrees with its already raw-verified definition.
        if (familySources.size || before.map.entities.some(isActiveFamily) || after.map.entities.some(isActiveFamily)) {
            const initial = 'entity_default', expectedInitial = evidence.groups[initial];
            assert.ok(expectedInitial, 'Animation source default group is missing');
            for (const [label, document] of [['previous', before], ['candidate', after]]) {
                assert.equal(canonical(document.map.initialGroups), canonical([initial]), 'Animation ' + label + ' source initialization membership changed');
                const group = document.map.groups[initial], expected = familyRows(group), actual = document.map.entities.filter(isActiveFamily);
                for (const row of actual) {
                    const matches = expected.filter(entity => entity.id === row.id && canonical(entity.source) === canonical(row.source));
                    assert.equal(matches.length, 1, 'Animation ' + label + ' active family identity is absent or ambiguous');
                    assert.equal(canonical(row), canonical(matches[0]), 'Animation ' + label + ' active family row differs from its verified source group');
                }
                assert.equal(canonical(actual), canonical(expected), 'Animation ' + label + ' active family membership differs from source initialization');
            }
            const oldActive = before.map.groups[initial].entities;
            copy.map.entities = copy.map.entities.flatMap(entity => {
                if (!isActiveFamily(entity)) return [entity];
                const previous = oldActive.filter(row => row.id === entity.id && canonical(row.source) === canonical(entity.source));
                assert.ok(previous.length <= 1, 'Animation previous active family identity is ambiguous');
                return previous.length ? [structuredClone(previous[0])] : [];
            });
        }
        const oldAssets = before.characterAssets ?? [], nextAssets = after.characterAssets ?? [];
        assert.equal(canonical(nextAssets), canonical([...new Set([...oldAssets, ...addedAssets])].sort()), 'Animation imported character set has an unrelated change');
        copy.characterAssets = structuredClone(oldAssets);
    }
    return { after: copy, audit: changes.length ? { ...structuredClone(proof), sourceDigest: evidence.sourceDigest, mapId: after.mapId ?? null,
            changes, sourceGameplayAdmitted: false, nativeParity: false, saveMigration: false } : null };
}
