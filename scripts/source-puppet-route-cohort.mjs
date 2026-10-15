import assert from 'node:assert/strict';
/** Preserve the complete physical Puppet.Route family and each exact map
 * namespace. This projection never admits an initializer, actor, or path. */
export function sourcePuppetRouteCohort(ir) {
  const physical = new Map(ir.scripts.map(p => [p.id, p])), edges = new Map(), bindings = new Map();
  for (const edge of ir.analysis.dependencies) { const rows = edges.get(edge.site.asset) ?? []; rows.push(edge); edges.set(edge.site.asset, rows); }
  const maps = ir.analysis.maps.map(map => {
    const namespace = { ...map.residentScripts, ...map.scriptAliases };
    for (const [alias, id] of Object.entries(namespace)) {
      if (!id) continue; assert.ok(physical.has(id), 'Installed source program missing');
      const rows = bindings.get(id) ?? []; rows.push({ mapId: Number(map.id), alias, resident: map.residentScripts[alias] === id }); bindings.set(id, rows);
    }
    return { mapId: Number(map.id), namespace, initializer: map.initializer, initializerName: map.initializerName, initializerStatus: map.initializerStatus };
  });
  const family = ir.scripts.filter(p => p.instructions.some(i => i.raw?.mnemonic === 'Route'));
  const allSites = family.flatMap(p => p.instructions.filter(i => i.raw?.mnemonic === 'Route').map(i => ({ program: p.id, rawHash: p.rawHash, domain: p.domain, ...i, bindings: bindings.get(p.id) ?? [] })));
  function closure(root, namespace) {
    const queue = [root], seen = new Set(), dependencies = [], unresolved = [];
    while (queue.length) {
      const id = queue.pop(); if (seen.has(id)) continue; seen.add(id);
      const p = physical.get(id); if (!p) { unresolved.push({ id, reason: 'Missing physical program' }); continue; }
      for (const edge of edges.get(id) ?? []) {
        if (namespace && edge.mapId !== undefined && Number(edge.mapId) !== namespace.mapId) continue;
        dependencies.push(edge); if (!edge.resolved) unresolved.push(edge);
        if (edge.kind !== 'script' || !edge.resolved) continue;
        const targets = namespace ? [namespace.namespace[edge.reference] ?? null] : edge.candidates;
        for (const target of targets) {
          if (!target || !physical.has(target)) unresolved.push({ ...edge, reason: 'Physical script is not installed in this exact map namespace' });
          else queue.push(target);
        }
      }
    }
    const ids = [...seen].sort(), operandBlockers = ids.flatMap(id => {
      const p = physical.get(id); if (!p) return [{ id, reason: 'Missing physical program' }];
      return [...(p.locals.operandDecoded === 'decoded' ? [] : [{ id, kind: 'locals', diagnostic: p.locals.diagnostic }]),
        ...p.instructions.filter(i => i.operandDecoded !== 'decoded').map(i => ({ id, site: i.site, raw: i.raw, diagnostic: i.diagnostic }))];
    });
    return { ids, dependencies, unresolved, operandBlockers, operandClosed: !unresolved.length && !operandBlockers.length,
      instructions: ids.reduce((n, id) => n + (physical.get(id)?.instructions.length ?? 0), 0) };
  }
  const roots = family.flatMap(p => (bindings.get(p.id) ?? []).map(binding => {
    const map = maps.find(m => m.mapId === binding.mapId), c = closure(p.id, map); assert.ok(map);
    return { root: { ...binding, id: p.id }, source: p.source, rawHash: p.rawHash, namespace: map.namespace, closure: c,
      instructions: p.instructions.length, runtimeAdmission: 'unassessed', sourceStoryReachability: false };
  }));
  const retained = new Set(family.map(p => p.id)); for (const root of roots) for (const id of root.closure.ids) retained.add(id);
  return { kind: 'whole-source-puppet-route-cohort-v1', sourceSetHash: ir.sourceSetHash, sourceCorpusHash: ir.contentHash,
    allSites, roots, maps, programs: [...retained].sort().map(id => { const p = physical.get(id); assert.ok(p); return { ...p, dependencies: edges.get(id) ?? [], bindings: bindings.get(id) ?? [] }; }),
    counts: { allPhysicalPrograms: ir.scripts.length, allInstructions: ir.counts.instructions, familyPhysicalPrograms: family.length,
      familyInstructions: family.reduce((n, p) => n + p.instructions.length, 0), allSites: allSites.length,
      fieldSites: allSites.filter(i => i.domain === 'field').length, decodedSites: allSites.filter(i => i.operandDecoded === 'decoded').length,
      blockedSites: allSites.filter(i => i.operandDecoded === 'blocked').length, unassessedSites: allSites.filter(i => i.operandDecoded === 'unassessed').length,
      rootBindings: roots.length, maps: new Set(roots.map(r => r.root.mapId)).size, operandClosedRoots: roots.filter(r => r.closure.operandClosed).length,
      allNamespaceMaps: maps.length, namespaceUses: maps.reduce((n, m) => n + Object.keys(m.namespace).length, 0),
      retainedPhysicalPrograms: retained.size, retainedInstructions: [...retained].reduce((n, id) => n + physical.get(id).instructions.length, 0) },
    staticOnly: true, sourceProgramExecution: 0, sourceStoryReachability: false, nativeParity: false };
}
