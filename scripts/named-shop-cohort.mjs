// Batch discovery only. Lexical closure and decoder acceptance never grant
// field admission, native parity, a world era, or campaign reachability.
import assert from 'node:assert/strict';

const ordered = values => [...new Set(values)].sort();

export function collectNamedShopCohort({ corpus, analysis, mapBindings, nativeBindings, resolveMapScript, hash }) {
  assert.equal(analysis.sourceSetHash, corpus.sourceSetHash, 'Shop analysis belongs to another source set');
  const assets = new Map(), reports = new Map(analysis.scripts.map(row => [row.id, row]));
  for (const asset of corpus.assets) {
    assert.equal(assets.has(asset.id), false, 'Duplicate physical source identity'); assets.set(asset.id, asset);
  }
  const maps = new Map(mapBindings.map(map => [String(map.id), map])), selectors = new Set();
  for (const binding of nativeBindings) if (binding.phase === 'new') {
    assert.equal(selectors.has(binding.selector), false, 'Duplicate new shop selector'); selectors.add(binding.selector);
  }
  assert.ok(selectors.size, 'No newly verified shop selectors');
  const roots = corpus.assets.filter(asset => asset.kind === 'script' && asset.data.Mnemonics.some(raw =>
    raw.mnemonic === 'SysCall' && selectors.has(raw.operands?.sValues?.[0]))).sort((a, b) => a.id.localeCompare(b.id));
  const programs = new Map(), executions = [], allSourceSites = [];
  function retain(id, mapId, root) {
    const asset = assets.get(id), report = reports.get(id); assert.ok(asset?.kind === 'script' && report, 'Missing physical script record');
    assert.equal(asset.data.Mnemonics.length, report.instructions, 'Analyzed source body changed');
    let row = programs.get(id);
    if (!row) {
      row = { id, source: structuredClone(asset.source), rawHash: hash(asset.data), name: asset.data.Name,
        maps: [], instructions: report.instructions, segments: structuredClone(asset.data.Segments ?? []),
        root: false, dependencies: [], decodeDiagnostics: [...report.blocked], raw: structuredClone(asset.data) };
      programs.set(id, row);
    }
    row.root ||= root;
    if (mapId !== null && !row.maps.includes(mapId)) row.maps.push(mapId);
    return row;
  }
  for (const asset of roots) {
    const report = reports.get(asset.id); assert.ok(report, 'Missing root source analysis');
    const rootMaps = ordered(report.maps);
    for (const [index, raw] of asset.data.Mnemonics.entries()) if (raw.mnemonic === 'SysCall' && selectors.has(raw.operands?.sValues?.[0]))
      allSourceSites.push({ assetId: asset.id, index, selector: raw.operands.sValues[0], maps: rootMaps,
        source: { ...asset.source, pointer: '/Mnemonics/' + index }, raw: structuredClone(raw) });
    if (!rootMaps.length) {
      retain(asset.id, null, true);
      executions.push({ rootId: asset.id, mapId: null, programIds: [asset.id], diagnostics: [{ kind: 'unbound-source-root' }],
        status: 'unready', sourceStoryReachability: false });
    }
    for (const mapId of rootMaps) {
      const map = maps.get(mapId); assert.ok(map, 'Missing analyzed map binding');
      const queue = [asset.id], seen = new Set(), diagnostics = [], dependencies = [];
      while (queue.length) {
        const id = queue.shift(); if (seen.has(id)) continue; seen.add(id);
        const row = retain(id, mapId, id === asset.id), current = reports.get(id);
        assert.ok(current.maps.includes(mapId), 'Dependency analysis lost its source namespace');
        for (const family of current.blocked) diagnostics.push({ kind: 'blocked-family', assetId: id, family });
        for (const dep of analysis.dependencies.filter(dep => dep.site.asset === id && (!dep.mapId || dep.mapId === mapId))) {
          dependencies.push(structuredClone(dep));
          if (!row.dependencies.some(existing => hash(existing) === hash(dep))) row.dependencies.push(structuredClone(dep));
          if (!dep.resolved) { diagnostics.push({ kind: 'unresolved-reference', dependency: structuredClone(dep) }); continue; }
          if (dep.kind !== 'script') continue;
          const target = resolveMapScript(map, dep.reference);
          if (target === null || dep.candidates.length !== 1 || target !== dep.candidates[0]) {
            diagnostics.push({ kind: 'source-namespace-mismatch', dependency: structuredClone(dep), resolvedTarget: target }); continue;
          }
          queue.push(target);
        }
      }
      executions.push({ rootId: asset.id, mapId, programIds: ordered(seen), dependencies,
        mapBindingIssues: [...map.issues], diagnostics, status: diagnostics.length ? 'unready' : 'decoded-closure-only',
        sourceStoryReachability: false });
    }
  }
  const readyExecutions = executions.filter(row => row.status === 'decoded-closure-only'),
    readyIds = new Set(readyExecutions.flatMap(row => row.programIds)), readyRoots = new Set(readyExecutions.map(row => row.rootId));
  const values = [...programs.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const row of values) row.maps.sort();
  const closedPrograms = values.filter(row => readyIds.has(row.id)).map(row => ({ ...row, root: readyRoots.has(row.id) }));
  const result = { kind: 'named-shop-source-cohort-v2', sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash, analysisHash: analysis.contentHash,
    sourceStoryReachability: false, selectedNativeSelectors: [...selectors].sort(), sourceSites: allSourceSites,
    programs: closedPrograms, excludedPrograms: values.filter(row => !readyIds.has(row.id)), executions,
    counts: { selectedRoots: roots.length, selectedSourceSites: allSourceSites.length,
      roots: readyRoots.size, physicalPrograms: closedPrograms.length,
      instructions: closedPrograms.reduce((n, row) => n + row.instructions, 0),
      sourceMaps: new Set(readyExecutions.map(row => row.mapId)).size,
      closedSourceSites: allSourceSites.filter(site => readyRoots.has(site.assetId)).length,
      closedSelectors: new Set(allSourceSites.filter(site => readyRoots.has(site.assetId)).map(site => site.selector)).size,
      resolvedEdges: closedPrograms.reduce((n, row) => n + row.dependencies.filter(dep => dep.resolved).length, 0),
      staticallyUnreadyExecutions: executions.length - readyExecutions.length } };
  return { ...result, contentHash: hash(result) };
}
