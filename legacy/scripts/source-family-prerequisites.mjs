import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { compileSourcePrerequisites } from './compile-source-prerequisites.mjs';
import { webSourceFrameworkInputs } from './source-web-framework-inputs.mjs';
import { openSourceCandidate } from './source-candidate.mjs';

/** Family inventories keep their own complete raw corpus and dependency
 * assessment. This selects their common upstream, never family readiness.
 * Shared payloads use the published URL layout from the pure link stage;
 * their world/entry hashes therefore remain the linked hashes, not raw ones. */
export async function loadSourceFamilyPrerequisites({ root, compiledDir, candidateDir }) {
  if (candidateDir === undefined)
    return compileSourcePrerequisites({ root, compiledDir, ...webSourceFrameworkInputs() });
  const candidate = await openSourceCandidate({ root, runtimeRoot: resolve(import.meta.dirname, '..'), compiledDir, candidateDir });
  const payloads = new Map(), bodies = new Map();
  for (const row of candidate.report.objects) {
    assert.ok(!payloads.has(row.url));
    // The pure linker exposes logical and package URLs for the same map body.
    // Retain every URL; identical locked bytes may share their detached value.
    // openSourceCandidate still validates every physical file at both ends.
    if (!bodies.has(row.sha256)) bodies.set(row.sha256, await candidate.read(row.url));
    payloads.set(row.url, bodies.get(row.sha256));
  }
  return { inputs: candidate.lock, report: candidate.report.producer, payloads,
    validate: candidate.validate,
    candidateEvidence: { kind: 'same-runtime-shared-source-family-input-v1',
      report: resolve(root, candidateDir, 'report.json'),
      reportSha256: createHash('sha256').update(candidate.reportBytes).digest('hex'),
      runtimeSha256: candidate.runtimeSha256,
      link: candidate.report.link,
      objectCount: candidate.report.objects.length,
      pureCompilationsInThisFamily: 0,
      sourceCampaignComplete: false } };
}
