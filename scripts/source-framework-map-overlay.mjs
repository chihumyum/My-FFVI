import assert from 'node:assert/strict';

// Recipe hosts augment a pinned source map. They never replace the source
// namespace, source geometry, family sidecars, or capability declarations.
const RECIPE_FIELDS = ['frameworkNpcActivity', 'frameworkRelayInteraction', 'frameworkPassiveEffects', 'walkEncounters', 'frameworkWalkBinding'];
const RECIPE_PROFILE = ['fieldPresentation', 'npcActivity', 'relayInteraction', 'passiveEffects'];
const FRAMEWORK_FIELDS = ['map', 'blockers', 'limitations', 'developmentOmissions', 'fieldEffects', 'frameworkNpcActivity', 'frameworkNpcFlat', 'frameworkPresentation'];
function without(value, keys) { const copy = structuredClone(value); for (const key of keys) delete copy[key]; return copy; }
function verify(value, hash) {
    assert.ok(value && /^[a-f0-9]{64}$/.test(value.contentHash), 'Overlay requires a sealed content input');
    assert.equal(hash(without(value, ['contentHash'])), value.contentHash, 'Overlay input content identity changed');
}
function seal(value, hash) { const body = without(value, ['contentHash']); return { ...body, contentHash: hash(body) }; }
function same(a, b, canonical, message) { assert.equal(canonical(a), canonical(b), message); }
function profile(initialized, framework, sourceHash, canonical) {
    assert.equal(framework?.kind, 'framework-development-v1', 'Overlay requires explicit framework profile');
    assert.equal(framework.sourceContentHash, sourceHash, 'Framework profile has another source identity');
    assert.equal(initialized?.kind, framework.kind, 'Initialized profile kind mismatch');
    assert.equal(initialized.policy, framework.policy, 'Initialized profile policy mismatch');
    assert.equal(initialized.sourceContentHash, sourceHash, 'Initialized profile has another source identity');
    for (const key of Object.keys(initialized)) {
        if (['sourceContentHash', 'omissions', ...RECIPE_PROFILE].includes(key)) continue;
        if (framework[key] !== undefined) same(initialized[key], framework[key], canonical, 'Recipe changes source policy ' + key);
        else assert.fail('Recipe grants an undeclared source policy ' + key);
    }
    const result = structuredClone(framework);
    for (const key of RECIPE_PROFILE) if (initialized[key] !== undefined) result[key] = structuredClone(initialized[key]);
    return result;
}
/** Inputs are independent sealed products: strict source, same-candidate Web
 * framework source, and initialized recipe output built from that strict map.
 * Start from the full framework map so new source-side fields cannot be lost
 * by a checker maintaining its own partial list of copied capabilities. */
export function overlaySourceFrameworkMap({ source, framework, initialized, canonical, hash }) {
    for (const value of [source, framework, initialized]) verify(value, hash);
    assert.equal(source.kind, 'world-map-development');
    assert.equal(source.developmentProfile, undefined, 'Overlay strict input already has policy');
    for (const value of [framework, initialized]) {
        assert.equal(value.kind, source.kind); assert.equal(value.mapId, source.mapId);
        assert.equal(value.sourceSetHash, source.sourceSetHash); assert.equal(value.parentSourceSetHash, source.parentSourceSetHash);
        assert.equal(value.mediaSourceSetHash, source.mediaSourceSetHash);
    }
    same(without(initialized, ['contentHash', 'developmentProfile', 'frameworkPresentation', ...RECIPE_FIELDS]),
        without(source, ['contentHash', 'developmentProfile', 'frameworkPresentation', ...RECIPE_FIELDS]), canonical,
        'Initialized recipe changed original source map/namespace/metadata');
    same(without(framework, ['contentHash', 'developmentProfile', ...FRAMEWORK_FIELDS]),
        without(source, ['contentHash', 'developmentProfile', ...FRAMEWORK_FIELDS]), canonical,
        'Framework candidate changed original source namespace/metadata');
    const map = structuredClone(framework);
    map.developmentProfile = profile(initialized.developmentProfile, framework.developmentProfile, source.contentHash, canonical);
    for (const key of RECIPE_FIELDS) if (initialized[key] !== undefined) map[key] = structuredClone(initialized[key]);
    if (!framework.frameworkPresentation && initialized.frameworkPresentation)
        map.frameworkPresentation = structuredClone(initialized.frameworkPresentation);
    return seal(map, hash);
}
/** Catalog URLs/subset and recipe hosts come from the initialized package;
 * source capabilities come from the same candidate's complete framework world. */
export function overlaySourceFrameworkWorld({ source, framework, initialized, maps, canonical, hash }) {
    for (const value of [source, framework, initialized]) verify(value, hash);
    assert.equal(source.kind, 'world-development');
    assert.equal(source.developmentProfile, undefined);
    for (const value of [framework, initialized]) {
        assert.equal(value.kind, source.kind); assert.equal(value.sourceSetHash, source.sourceSetHash);
        assert.equal(value.parentSourceSetHash, source.parentSourceSetHash); assert.equal(value.mediaSourceSetHash, source.mediaSourceSetHash);
        same(value.characters, source.characters, canonical, 'Overlay world changed source characters');
    }
    assert.equal(new Set(maps.map(map => map.mapId)).size, maps.length, 'Duplicate overlay map');
    same(Object.keys(initialized.maps).sort(), maps.map(map => String(map.mapId)).sort(), canonical, 'Overlay map membership mismatch');
    const world = structuredClone(initialized);
    world.developmentProfile = profile(initialized.developmentProfile, framework.developmentProfile, source.contentHash, canonical);
    for (const map of maps) {
        verify(map, hash); assert.equal(map.sourceSetHash, source.sourceSetHash);
        assert.ok(source.maps[map.mapId] && framework.maps[map.mapId], 'Unknown overlay source map');
        assert.equal(map.developmentProfile.sourceContentHash, source.maps[map.mapId].contentHash);
        world.maps[map.mapId].contentHash = map.contentHash;
    }
    return seal(world, hash);
}
