import type { CorpusAsset } from './corpus.js';
import { hash, record } from './content.js';
import { BATTLE_RESERVED_SCRIPTS, type SourceReservedScriptBinding } from '../core/field-reserved-script.js';

/** Input aliases have already been resolved by bindMapPackages, with current
 * map priority and the one native Resident fallback. No basename search. */
export function compileReservedScriptBindings(aliases: Record<string, string | null>,
  assets: ReadonlyMap<string, CorpusAsset>, sourceSetHash: string, parentSourceSetHash: string): Record<string, SourceReservedScriptBinding> {
  const bindings: Record<string, SourceReservedScriptBinding> = {};
  for (const name of Object.values(BATTLE_RESERVED_SCRIPTS)) {
    const id = aliases[name], asset = id ? assets.get(id) : undefined;
    if (!asset) continue; // Absence remains an explicit runtime dependency.
    if (asset.kind !== 'script' || record(asset.data).Name !== name || !asset.source.objectId)
      throw new Error('Reserved script alias/source mismatch: ' + name);
    bindings[name] = { kind: 'source-reserved-field-script-v1', name, rawHash: hash(asset.data),
      sourceSetHash, parentSourceSetHash, source: {...structuredClone(asset.source),objectId:asset.source.objectId} };
  }
  return bindings;
}
