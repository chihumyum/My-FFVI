import assert from 'node:assert/strict';
/** Raw physical source nomination precedes typed entity admission. A failed
 * decoder must never disappear from the batch's denominator. */
export function sourceMapAnimationCohort(corpus, api) {
    const { bindMapPackages, entityProperties, canonical, hash } = api;
    const bindings = bindMapPackages(corpus.assets, corpus.tables), byId = new Map(corpus.assets.map(a => [a.id, a]));
    const physical = new Map(), maps = [], uses = [];
    for (const binding of bindings) {
        const rawSites = [], scripts = new Set();
        for (const [group, id] of Object.entries(binding.groups)) {
            const asset = byId.get(id);
            assert.ok(asset, 'Missing bound physical source group');
            for (const [li, layer] of (asset.data.layers ?? []).entries()) {
                for (const [oi, object] of (layer.objects ?? []).entries()) {
                    const p = entityProperties(object.properties), kind = p.object_type, direction = [5, 7, 8].includes(kind) ? 0 : p.direction ?? 0, badDirection = !['0', '1', '2', '4', '8'].includes(String(direction));
                    if (kind !== 10 && !badDirection)
                        continue;
                    const source = { ...asset.source, pointer: `/layers/${li}/objects/${oi}` }, key = canonical(source);
                    if (!physical.has(key))
                        physical.set(key, { source, physicalGroupId: id, rawHash: hash(object), raw: object,
                            properties: p, kind, direction, badDirection, uses: [] });
                    const use = { mapId: Number(binding.id), group, physicalKey: key, kind, direction, badDirection };
                    physical.get(key).uses.push({ mapId: use.mapId, group });
                    rawSites.push(use);
                    uses.push(use);
                    if (kind === 10 && p.script_id !== undefined && p.script_id !== 0) {
                        const rows = (corpus.tables['script.csv'] ?? []).filter(row => Number(row.id) === p.script_id);
                        if (rows.length === 1 && rows[0].script_name)
                            scripts.add(rows[0].script_name);
                    }
                }
            }
        }
        if (rawSites.length)
            maps.push({ mapId: Number(binding.id), rawSites, rawEntityScripts: [...scripts].sort(),
                bindingIssues: binding.issues, installedPhysicalBindings: { ...binding.residentScripts, ...binding.scriptAliases } });
    }
    const objects = [...physical.values()];
    return { kind: 'all-source-map-animation-cohort-v1', sourceSetHash: corpus.sourceSetHash,
        parentSourceSetHash: corpus.manifest.parentSourceSetHash, counts: { allMaps: bindings.length,
            affectedMaps: maps.length, kind10Maps: maps.filter(m => m.rawSites.some(s => s.kind === 10)).length,
            physicalObjects: objects.length, rawMapGroupUses: uses.length,
            kind10Physical: objects.filter(o => o.kind === 10).length, kind10MapGroupUses: uses.filter(o => o.kind === 10).length,
            nonKind10DirectionPhysical: objects.filter(o => o.kind !== 10).length }, objects, maps,
        sourceReachability: false, acceptance: 'raw-source-nomination-only' };
}

/** Source selector inventory does not depend on successful typed decoding. */
export function sourceMapAnimationRawSelectors(cohort, mapId) {
  const values = new Set();
  for (const object of cohort.objects) if (object.kind === 10 && object.uses.some(use => use.mapId === mapId)) {
    const id = object.properties.entity_id;
    if (typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 0x7fffffff) values.add(String(id));
  }
  return [...values].sort((a,b) => Number(a)-Number(b));
}
