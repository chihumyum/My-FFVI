import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentBatchManifest, planContentBatch } from '../src/compiler/content-batch.js';
import { compileFrameworkNewGame } from '../src/compiler/framework-new-game.js';
import { GameContentRepository } from '../src/core/game-content.js';
import { GameEntryLoader } from '../src/core/game-entry-loader.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameCommands } from '../src/core/game-commands.js';
import { GameSession } from '../src/core/game-session.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import type { GameContentRefsV2 } from '../src/core/game-content-refs.js';
import { frameworkNewGameFixture } from './fixtures/framework-new-game.js';
import { sealBatchContent } from './fixtures/content-batch.js';

const host = { visible: true, mediaReady: true, overlayOpen: false };
const runtime = { battleHandoff: 'prepared' as const };
async function fixture() {
  const f = await frameworkNewGameFixture();
  const refs: GameContentRefsV2 = { kind: 'game-content-refs-v2', profile: 'framework', source: null, development: null,
    initialized: { entry: { url: '/controlled/batch/entry.json', contentHash: f.content.contentHash },
      battle: { url: '/controlled/batch/battle.json', contentHash: f.battle.contentHash } },
    world: { url: '/controlled/batch/world.json', contentHash: f.world.contentHash } };
  const manifest: ContentBatchManifest = { kind: 'content-batch-manifest-v1', id: 'controlled-initialized-batch',
    profile: 'framework', contentRefs: refs, mapIds: [f.map.mapId],
    roots: [{ kind: 'entry', mapId: f.map.mapId, entrance: f.content.entry.entrance, continuation: f.map.initializer }],
    routes: [{ id: 'continued', entry: 'framework-new-game', expectedMapId: f.map.mapId,
      requiredMapIds: [f.map.mapId], requiredEncounterIds: [], maxTicks: 100,
      inputs: [{ kind: 'menu', command: { kind: 'set-preferences', preferences: { mode: 'wait', speedIndex: 3 } } },
        { kind: 'save-restore' }, { kind: 'menu', command: { kind: 'set-preferences', preferences: { mode: 'active', speedIndex: 2 } } }],
      choiceAnswers: [], battleAbilityIds: [] }] };
  const files = new Map<string, unknown>([[refs.initialized!.entry.url, f.content],
    [refs.initialized!.battle.url, f.battle], [refs.world.url, f.world], [f.world.maps[f.map.mapId]!.url, f.map]]);
  const calls: string[] = [], repository = new GameContentRepository(async url => {
    calls.push(url); assert.ok(files.has(url), 'No legacy or unrelated content URL is a fallback');
    return structuredClone(files.get(url));
  }, 'framework', refs);
  return { ...f, refs, manifest, files, calls, repository,
    packages: { entry: f.content, catalog: f.world, maps: [f.map], battle: f.battle } };
}

test('an initialized batch retains unexecuted instructions and entity blockers in its whole-map closure', async () => {
  const f = await fixture(), map = structuredClone(f.map), script = map.initializer!;
  map.scripts[script]!.push({ kind: 'blocked', mnemonic: 'ControlledFutureNPC', reason: 'Unimplemented routine owner',
    script, index: map.scripts[script]!.length, source: { ...f.source, pointer: '/untaken-after-exit' } });
  map.map!.groups!.entity_default!.blockers.push({ reason: 'Controlled unresolved actor provider', source: f.source });
  const changedMap = sealBatchContent(map), world = structuredClone(f.world);
  world.maps[f.map.mapId]!.contentHash = changedMap.contentHash;
  const changedWorld = sealBatchContent(world), content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry,
    sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, battle: f.battle,
    world: changedWorld, map: changedMap, entrance: f.content.entry.entrance });
  const manifest = structuredClone(f.manifest);
  manifest.contentRefs!.world.contentHash = changedWorld.contentHash;
  (manifest.contentRefs as GameContentRefsV2).initialized!.entry.contentHash = content.contentHash;
  const plan = planContentBatch(manifest, { entry: content, catalog: changedWorld, maps: [changedMap], battle: f.battle });
  assert.equal(plan.dependencies.referenceClosure, 'incomplete');
  assert.ok(plan.diagnostics.some(row => row.code === 'instruction-blocked' && row.reason.includes('ControlledFutureNPC')));
  assert.ok(plan.diagnostics.some(row => row.code === 'entity-group-blocked' && row.reason === 'Controlled unresolved actor provider'));
  assert.equal(plan.runtimeAdmission, 'unassessed'); assert.equal(plan.sourceCampaignComplete, false);
  assert.equal(changedMap.scripts[script]!.at(-1)!.kind, 'blocked', 'A safe earlier Exit does not erase content dependencies');
});

test('an initialized batch cannot borrow source/profile authority or a resealed different initializer', async () => {
  const f = await fixture(), plan = planContentBatch(f.manifest, f.packages);
  assert.equal(plan.contentHashes.entry, f.content.contentHash);
  assert.throws(() => planContentBatch(ContentBatchManifest.parse({ ...f.manifest, profile: 'source', contentRefs: undefined }), f.packages), /profile|framework/i);
  const wrong = sealBatchContent({ ...f.content, initializerHash: 'f'.repeat(64) });
  const changed = structuredClone(f.manifest);
  (changed.contentRefs as GameContentRefsV2).initialized!.entry.contentHash = wrong.contentHash;
  assert.throws(() => planContentBatch(changed, { ...f.packages, entry: wrong }), /payload|initializer/i);
  const otherRefs = structuredClone(f.manifest);
  otherRefs.contentRefs!.world.contentHash = 'f'.repeat(64);
  assert.throws(() => planContentBatch(otherRefs, f.packages), /reference|hash|pin/i);
  assert.deepEqual(f.battle.gameState, f.sourceBattle.gameState);
});

test('the declared initialized origin restores once through the same repository and invalidates the old command owner', async () => {
  const f = await fixture(), bundle = await f.repository.initializedNewGame();
  const flow = new GameFlow(), entries = new GameEntryLoader(flow, { discard: () => {} });
  const start = await entries.begin('new-game').prepare(async () => ({ session: await GameSession.prepareFrameworkNewGame(
    bundle.content, bundle.catalog, bundle.map, bundle.battle, runtime, 314), presentation: null }));
  assert.equal(start.status, 'committed'); if (start.status !== 'committed') return;
  const original = start.session, oldCommands = new GameCommands(flow, original);
  flow.advance(0, host); assert.equal(original.checkpointReady, true);
  flow.pause(true); flow.observeHost(host);
  assert.equal(oldCommands.menu({ kind: 'set-preferences', preferences: { mode: 'wait', speedIndex: 3 } }), true);
  const before = original.checkpoint(), values = new Map<string, string>();
  const storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
    'framework', 'controlled-initialized-batch');
  (await storage.prepareSave(before, 1)).commit();
  const loaded = await entries.begin('load').prepare(async () => {
    const saved = await storage.load(); assert.ok(saved);
    const packages = await f.repository.restoreSessionContent(saved.checkpoint);
    return { session: GameSession.restore(saved.checkpoint, packages.initial, packages.battle, packages.world, runtime),
      presentation: null, options: { paused: true } };
  });
  assert.equal(loaded.status, 'committed'); if (loaded.status !== 'committed') return;
  assert.notEqual(loaded.session, original); assert.deepEqual(loaded.session.checkpoint(), before);
  const continued = new GameCommands(flow, loaded.session); flow.observeHost(host);
  assert.equal(oldCommands.menu({ kind: 'set-preferences', preferences: { mode: 'active', speedIndex: 2 } }), false);
  assert.equal(continued.menu({ kind: 'set-preferences', preferences: { mode: 'active', speedIndex: 2 } }), true);
  flow.pause(false); flow.advance(10, host);
  assert.deepEqual(loaded.session.state.snapshot(), before.owned, 'Restore and later input cannot repeat the initialized grant');
  assert.equal(loaded.session.field.eventState.read(f.initializerFlag), 1);
  assert.deepEqual(loaded.session.checkpoint().origin, { kind: 'framework-new-game', entryContentHash: f.content.contentHash });
  assert.ok(f.calls.every(url => f.files.has(url)));
});
