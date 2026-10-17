import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WEB_FLAT_WORLD_AUTO_MOVE, worldAutoMoveBinding } from '../src/core/field-world-auto-move.js';
import { worldAutoMoveFixture, prepareFlatAutoMovement } from './fixtures/world-auto-move.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameSession } from '../src/core/game-session.js';
import { compileFrameworkNewGame } from '../src/compiler/framework-new-game.js';
import { sealBatchContent } from './fixtures/content-batch.js';
const root = process.cwd(), compiledDir = fileURLToPath(new URL('../', import.meta.url));
const script = (name: string) => import(pathToFileURL(resolve(root, 'scripts', name + '.mjs')).href);
test('actual shared and initialized producers reject unknown movement input before source compilation or output', async () => {
  const tmp = await mkdtemp(resolve(tmpdir(), 'ffvi-shared-world-auto-move-'));
  try {
    await mkdir(resolve(tmp, 'content-batches')); await symlink(resolve(root, 'apps'), resolve(tmp, 'apps'), 'dir');
    await symlink(resolve(root, 'scripts'), resolve(tmp, 'scripts'), 'dir');
    const { compileSharedContentPackages } = await script('content-package-pipeline');
    await assert.rejects(compileSharedContentPackages({ root: tmp, compiledDir, sourceRecipePaths: [], worldAutoMove: 'unknown' }), /Invalid shared world auto-movement/);
    await assert.rejects(access(resolve(tmp, 'build')));
    const { compileInitializedContentBatch, initializedContentBatchProfile } = await script('build-initialized-content-batch');
    await assert.rejects(compileInitializedContentBatch(root, {}, 'a'.repeat(64), { worldAutoMove: 'unknown' }), /Invalid initialized world auto-movement/);
    assert.throws(() => initializedContentBatchProfile('a'.repeat(64), { presentation: 'framework-ordinary-field-flat-v1', worldAutoMove: WEB_FLAT_WORLD_AUTO_MOVE }), /Invalid initialized world auto-movement/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
test('shared defaults, replay ports and initialized profiles retain dual current authorization on the real movement owner', async () => {
  const { webSourceFrameworkInputs } = await script('source-web-framework-inputs'), { sourceWebReplayRuntimePorts } = await script('source-web-replay-runtime'),
    { initializedContentBatchProfile } = await script('build-initialized-content-batch');
  const a = webSourceFrameworkInputs(), b = webSourceFrameworkInputs(); assert.equal(a.worldAutoMove, WEB_FLAT_WORLD_AUTO_MOVE);
  assert.equal(sourceWebReplayRuntimePorts().worldAutoMove, WEB_FLAT_WORLD_AUTO_MOVE); delete a.worldAutoMove;
  assert.equal(b.worldAutoMove, WEB_FLAT_WORLD_AUTO_MOVE);
  const ready = { visible: true, mediaReady: true, overlayOpen: false };
  for (const [declared, policy] of [[true, false], [false, true], [true, true]] as const) {
    const f = await worldAutoMoveFixture({ declared: false, policy }), parentSourceSetHash = 'a'.repeat(64),
      sourceMap = sealBatchContent({ ...f.sourceMap, parentSourceSetHash }),
      sourceEntry = sealBatchContent({ ...f.sourceEntry, parentSourceSetHash, mapContentHash: sourceMap.contentHash }),
      profile = (hash: string) => initializedContentBatchProfile(hash, { presentation: 'framework-ordinary-field-flat-v1',
        worldAutoTasks: b.worldAutoTasks, ...(declared ? { worldAutoMove: b.worldAutoMove } : {}) }),
      map = sealBatchContent({ ...f.map, parentSourceSetHash, developmentProfile: profile(sourceMap.contentHash) }),
      world = sealBatchContent({ ...f.world, parentSourceSetHash, developmentProfile: profile(sourceEntry.worldCatalogHash), maps: { ...f.world.maps,
        [map.mapId]: { ...f.world.maps[map.mapId]!, contentHash: map.contentHash } } }),
      content = await compileFrameworkNewGame({ sourceEntry, sourceBattle: f.sourceBattle, sourceMap,
        world, map, battle: f.battle, entrance: map.partyEntry!.pointIns[0]!.id }),
      game = await GameSession.prepareFrameworkNewGame(content, world, map, f.battle, f.runtime),
      flow = new GameFlow(game); flow.start(game); flow.advance(10, ready);
    for (const value of [content, world, map]) assert.equal(value.developmentProfile?.worldAutoMove, declared ? WEB_FLAT_WORLD_AUTO_MOVE : undefined);
    if (declared && policy) assert.equal(worldAutoMoveBinding(game.field.content, WEB_FLAT_WORLD_AUTO_MOVE).fieldContentHash, game.field.content.contentHash);
    else assert.throws(() => worldAutoMoveBinding(game.field.content, policy ? WEB_FLAT_WORLD_AUTO_MOVE : undefined), /both current runtime/);
    prepareFlatAutoMovement(game.field); const before = { ...game.field.player.native!.entity.position };
    assert(game.field.startEvent('auto-move')); flow.advance(400, ready);
    if (declared && policy) { assert.equal(game.field.stop, null); assert.notDeepEqual(game.field.player.native!.entity.position, before); assert(game.checkpointReady); }
    else { assert.equal(game.field.stop?.kind, 'unsupported'); assert.deepEqual(game.field.player.native!.entity.position, before); assert.equal(game.field.worldAutoTaskSnapshot?.tasks.length??0, 0); }
  }
});
