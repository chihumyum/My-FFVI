// Execute two complete original-content routes through one public runner.
// The second consumes the first's actual checkpoint, never new initialization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runContentBatchRoute } from './content-batch-route.mjs';
import { runtimeDigest } from './runtime-digest.mjs';

const root = resolve(import.meta.dirname, '..'), directory = resolve(root, 'build/content-packages');
const load = name => import(pathToFileURL(resolve(root, 'dist/src', name + '.js')));
const [{ GameContentRepository }, { planContentBatch }, { canonical, hash }, { createNewGame },
  { treasureFlagRef }, continuity] = await Promise.all([
  'core/game-content', 'compiler/content-batch', 'compiler/content', 'core/new-game',
  'core/treasure-inventory', 'compiler/story-continuity',
].map(load));
const output = resolve(root, 'build/reports/story-continuity.json');
await mkdir(resolve(root, 'build/reports'), { recursive: true });
const checks = [], report = { kind: 'story-continuity-experiment-v1', result: 'running', checks,
  sourceStoryReachability: false, sourceCampaignComplete: false, browserVerified: false,
  originalGameExecuted: false, publicContentPublished: false,
  limitations: ['Source initialized Web placement starts the first route; this is not original campaign reachability.',
    'Two complete route programs use existing entry, map, command and checkpoint owners with controlled media readiness.',
    'Original region diagnostics and unknown story phases remain; this validates a reusable continuity method.'] };
const consumed = new Map();
const readURL = async url => {
  assert.match(url, /^\/content-packages\/[A-Za-z0-9/_-]+\.json$/);
  const path = resolve(directory, url.slice('/content-packages/'.length)), bytes = await readFile(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (consumed.has(path)) assert.equal(consumed.get(path), digest, 'Content changed during story continuity');
  consumed.set(path, digest);
  return JSON.parse(bytes);
};
const check = (name, evidence) => checks.push({ name, result: 'passed', evidence });
try {
  const runtimeHash = await runtimeDigest(root, resolve(root, 'dist'));
  const refs = await readURL('/content-packages/south-figaro-interiors.json');
  const repository = new GameContentRepository(readURL, 'framework', refs);
  const start = await repository.initializedNewGame();
  const manifest = await readURL('/content-packages/south-figaro-interiors/manifest.json');
  const maps = await Promise.all(manifest.mapIds.map(id => repository.map(id, start.catalog)));
  const plan = planContentBatch(manifest, { entry: start.content, catalog: start.catalog, battle: start.battle, maps });
  const routeId = 'source-interiors-full-loop-and-treasures';
  const routes = manifest.routes.filter(route => route.id === routeId);
  assert.equal(routes.length, 1);
  const route = routes[0];
  const before = createNewGame(start.battle.gameState.sourceNewGame);
  const baseline = before.owned;
  // Expectations are derived from source reward definitions before execution.
  const treasureDefinitions = maps.flatMap(map => map.map.groups.entity_default.entities
    .filter(entity => entity.treasure).map(entity => entity.treasure));
  assert.equal(treasureDefinitions.length, 12);
  let gilDelta = 0;
  const gains = { items: new Map(), equipmentStock: new Map() };
  for (const treasure of treasureDefinitions) {
    const command = treasure.reward;
    if (command.kind === 'grant-gil') gilDelta += command.amount;
    else {
      assert.ok(['grant-item', 'grant-equipment'].includes(command.kind));
      const rows = gains[command.kind === 'grant-item' ? 'items' : 'equipmentStock'];
      rows.set(command.id, (rows.get(command.id) ?? 0) + command.count);
    }
  }
  const deltas = key => [...gains[key]].sort(([a], [b]) => a - b).map(([id, count]) => ({ id, count }));
  const expectedStock = (key, acquired) => {
    const rows = new Map(baseline[key].map(row => [row.id, row.count]));
    if (acquired) for (const [id, gain] of gains[key]) rows.set(id, (rows.get(id) ?? 0) + gain);
    return [...rows].sort(([a], [b]) => a - b).map(([id, count]) => ({ id, count }));
  };
  const first = await runContentBatchRoute({ root, plan, routeId, repository, runtimeHash, captureFinalState: true });
  assert.equal(first.receipt.result, 'completed', JSON.stringify(first.receipt.boundary));
  assert.ok(first.finalState.firstStableCheckpoint);
  report.first = first;
  const binding = { sourceSetHash: start.content.parentSourceSetHash,
    sourceFingerprints: { corpus: start.catalog.sourceSetHash, field: start.content.sourceSetHash },
    runtimeHash, contentRefs: refs, contentHashes: plan.contentHashes };
  const expectation = acquired => ({ mapId: route.expectedMapId,
    flags: treasureDefinitions.map(definition => ({ ref: treasureFlagRef(definition.flagId), value: acquired ? 1 : 0 })),
    roster: baseline.roster.map(({ id, sourceId, ownedId, enabled }) => ({ id, sourceId, ownedId, enabled })),
    party: baseline.party, gil: baseline.gil + (acquired ? gilDelta : 0),
    items: expectedStock('items', acquired), equipmentStock: expectedStock('equipmentStock', acquired) });
  const contract = { kind: 'story-route-contract-v1', id: 'original-interiors-first-pass', binding,
    entry: expectation(false), exit: expectation(true), changes: { gil: gilDelta,
      items: deltas('items'), equipmentStock: deltas('equipmentStock'), completedBattles: [] } };
  report.contract = contract;
  const firstResult = continuity.assessStoryRouteContinuity(contract, { binding, capture: first.finalState });
  assert.equal(firstResult.status, 'passed', JSON.stringify(firstResult.issues));
  const completeInventory = (owned, acquired) => {
    for (const key of ['items', 'equipmentStock']) assert.deepEqual(
      [...owned[key]].sort((a, b) => a.id - b.id), expectedStock(key, acquired),
      'Unspecified inventory member or count at ' + key);
  };
  completeInventory(first.finalState.firstStableCheckpoint.owned, false);
  completeInventory(first.finalState.finalOwned, true);
  check('full-source-route-exit-state-agrees-with-original-twelve-rewards', firstResult);
  const bytes = canonical(first.finalState.checkpoint), checkpointHash = hash(first.finalState.checkpoint);
  const checkpointFile = resolve(root, 'build/reports/story-continuity-checkpoint.json');
  await writeFile(checkpointFile, bytes);
  const readBytes = await readFile(checkpointFile, 'utf8');
  assert.equal(readBytes, bytes);
  const second = await runContentBatchRoute({ root, plan, routeId, repository, runtimeHash, captureFinalState: true,
    continuation: { checkpoint: JSON.parse(readBytes), checkpointHash, predecessorRouteId: contract.id } });
  report.second = second;
  assert.equal(second.receipt.result, 'completed', JSON.stringify(second.receipt.boundary));
  assert.equal(second.receipt.lane, 'story-checkpoint-continuation');
  const link = continuity.assessStoryCheckpointLink({ checkpoint: first.finalState.checkpoint, bytes, sha256: checkpointHash },
    { checkpoint: second.finalState.firstStableCheckpoint, bytes: readBytes, sha256: checkpointHash });
  assert.equal(link.status, 'passed', JSON.stringify(link.issues));
  check('real-checkpoint-file-restores-through-public-owners-without-initialization-replay', link);
  const revisit = { ...contract, id: 'original-interiors-return-pass', entry: expectation(true), exit: expectation(true),
    changes: { gil: 0, items: deltas('items').map(row => ({ ...row, count: 0 })),
      equipmentStock: deltas('equipmentStock').map(row => ({ ...row, count: 0 })), completedBattles: [] } };
  const secondResult = continuity.assessStoryRouteContinuity(revisit, { binding, capture: second.finalState });
  assert.equal(secondResult.status, 'passed', JSON.stringify(secondResult.issues));
  completeInventory(second.finalState.firstStableCheckpoint.owned, true);
  completeInventory(second.finalState.finalOwned, true);
  check('entire-route-replay-preserves-flags-party-and-inventory-without-repeat-rewards', secondResult);
  const wrong = structuredClone(contract); wrong.exit.flags[0].value = 0;
  assert.equal(continuity.assessStoryRouteContinuity(wrong, { binding, capture: first.finalState }).status, 'mismatch');
  const extraStock = structuredClone(second.finalState.finalOwned);
  extraStock.items.push({ id: 2147483647, count: 1 });
  assert.throws(() => completeInventory(extraStock, true), /Unspecified inventory/);
  const changed = structuredClone(second.finalState.firstStableCheckpoint); changed.owned.gil++;
  assert.equal(continuity.assessStoryCheckpointLink({ checkpoint: first.finalState.checkpoint, bytes, sha256: checkpointHash },
    { checkpoint: changed, bytes: readBytes, sha256: checkpointHash }).status, 'mismatch');
  const rejected = await runContentBatchRoute({ root, plan, routeId, repository, runtimeHash, continuation: {
    checkpoint: changed, checkpointHash, predecessorRouteId: contract.id } });
  assert.equal(rejected.receipt.result, 'failed');
  assert.equal(rejected.execution.entriesCommitted, 0);
  check('wrong-story-exit-broken-chain-and-mutated-checkpoint-are-rejected', rejected.receipt.boundary);
  for (const [path, digest] of consumed) assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), digest);
  assert.equal(await runtimeDigest(root, resolve(root, 'dist')), runtimeHash);
  report.runtimeHash = runtimeHash; report.result = 'passed';
  report.counts = { sourceMaps: maps.length, sourceTreasures: treasureDefinitions.length, segments: 2,
    inputs: first.receipt.program.inputCount + second.receipt.program.inputCount,
    restores: first.receipt.program.restoreCount + second.receipt.program.restoreCount, checks: checks.length };
} catch (error) { report.result = 'failed'; report.error = error.stack ?? String(error); throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ result: report.result, counts: report.counts }));
