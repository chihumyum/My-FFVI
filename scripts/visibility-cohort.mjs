// Whole physical source programs and their complete source dependency closure.
// This collector never supplies gameplay state or grants a live host capability.
import assert from 'node:assert/strict';
export function collectVisibilityCohort({ corpus, analysis, decodeFieldOp, messages, hash }) {
  const names = new Set(['Show', 'Hide', 'ShowMob', 'HideMob', 'RestoreMob']),
    byAsset = new Map(corpus.assets.map(asset => [asset.id, asset])),
    reports = new Map(analysis.scripts.map(script => [script.id, script])), decoded = new Map(), sites = [];
  for (const asset of corpus.assets.filter(asset => asset.kind === 'script')) {
    const ops = asset.data.Mnemonics.map((raw, index) => {
      try { return decodeFieldOp(raw, { script: asset.data.Name ?? asset.id, index,
        source: { ...asset.source, pointer: '/Mnemonics/' + index } }, messages, corpus.tables,
        { nextMnemonic: asset.data.Mnemonics[index + 1]?.mnemonic ?? null }); }
      catch(error) { return { kind: 'blocked', mnemonic: raw.mnemonic, reason: String(error), index }; }
    }); decoded.set(asset.id, ops);
    for (const [index, raw] of asset.data.Mnemonics.entries()) if (names.has(raw.mnemonic)) {
      const op = ops[index], extended = op.kind === 'blocked' || op.kind === 'actor-visibility' && op.timing !== undefined ||
        ['ShowMob', 'HideMob', 'RestoreMob'].includes(raw.mnemonic);
      sites.push({ id: asset.id, source: asset.source, index, maps: reports.get(asset.id).maps,
        raw, rawHash: hash(raw), decoded: op, extendedFamily: extended });
    }
  }
  const targets = new Set(sites.filter(site => site.extendedFamily && site.maps.length).map(site => site.id)), roots = [], onlyFamily = [];
  for (const id of targets) for (const mapId of reports.get(id).maps) {
    const closure = new Set([id]), pending = [id];
    while (pending.length) {
      const current = pending.shift();
      for (const edge of analysis.dependencies.filter(edge => edge.site.asset === current && edge.kind === 'script' &&
        (!edge.mapId || edge.mapId === mapId) && edge.resolved)) for (const target of edge.candidates)
        if (!closure.has(target)) { assert.ok(byAsset.has(target)); closure.add(target); pending.push(target); }
    }
    const dependencies = analysis.dependencies.filter(edge => closure.has(edge.site.asset) && (!edge.mapId || edge.mapId === mapId)),
      blocked = [...closure].flatMap(assetId => decoded.get(assetId).filter(op => op.kind === 'blocked').map(op => ({ assetId, ...op }))),
      otherBlocked = blocked.filter(op => !names.has(op.mnemonic)), unresolved = dependencies.filter(edge => !edge.resolved),
      record = { id, mapId, closure: [...closure].sort(),
        instructions: [...closure].reduce((sum, assetId) => sum + byAsset.get(assetId).data.Mnemonics.length, 0),
        source: byAsset.get(id).source, dependencies, blocked, otherBlocked, unresolved,
        lexicalOnlyFamily: !otherBlocked.length && !unresolved.length };
    roots.push(record); if (record.lexicalOnlyFamily) onlyFamily.push(record);
  }
  const physical = [...new Set(onlyFamily.flatMap(root => root.closure))];
  return { kind: 'source-visibility-whole-program-cohort-v1', sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash, analysisHash: analysis.contentHash,
    sourceStoryReachability: false, runtimeAdmission: 'unassessed', sites, roots, onlyFamily,
    counts: { sourceScripts: analysis.counts.scripts, sourceInstructions: analysis.counts.instructions,
      physicalSites: sites.length, fieldBoundSites: sites.filter(site => site.maps.length).length,
      affectedPhysicalRoots: targets.size, affectedRootMapUses: roots.length,
      selectedPhysicalPrograms: physical.length, selectedRootMapUses: onlyFamily.length,
      selectedMaps: new Set(onlyFamily.map(root => root.mapId)).size,
      retainedInstructions: physical.reduce((sum, id) => sum + byAsset.get(id).data.Mnemonics.length, 0) } };
}
