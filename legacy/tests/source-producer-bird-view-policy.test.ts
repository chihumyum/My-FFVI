import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WEB_FLAT_BIRD_VIEW_ACTORS, fieldBirdViewActorBinding } from '../src/core/field-bird-view-actors.js';
import { birdViewActorsFixture, birdHost } from './fixtures/bird-view-actors.js';
import { GameFlow } from '../src/core/game-flow.js';
import { GameSession } from '../src/core/game-session.js';
import { compileFrameworkNewGame } from '../src/compiler/framework-new-game.js';
import { sealBatchContent } from './fixtures/content-batch.js';
const root = process.cwd(), compiledDir = fileURLToPath(new URL('../', import.meta.url));
const script = (name: string) => import(pathToFileURL(resolve(root, 'scripts', name + '.mjs')).href);
test('actual shared and initialized producers reject unknown BirdView input before source compilation or any output', async () => {
  const tmp = await mkdtemp(resolve(tmpdir(), 'ffvi-shared-bird-view-'));
  try {
    await mkdir(resolve(tmp, 'content-batches')); await symlink(resolve(root, 'apps'), resolve(tmp, 'apps'), 'dir');
    await symlink(resolve(root, 'scripts'), resolve(tmp, 'scripts'), 'dir');
    const { compileSharedContentPackages } = await script('content-package-pipeline');
    await assert.rejects(compileSharedContentPackages({ root: tmp, compiledDir, sourceRecipePaths: [], birdViewActors: 'unknown' }), /Unknown source framework BirdView actor policy/);
    await assert.rejects(access(resolve(tmp, 'build')));
    const { compileInitializedContentBatch } = await script('build-initialized-content-batch');
    await assert.rejects(compileInitializedContentBatch(root, {}, 'a'.repeat(64), { birdViewActors: 'unknown' }), /Unknown initialized BirdView actor policy/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
test('shared inputs, replay ports and initialized entry/world/map profiles carry the same explicit actor policy', async () => {
  const { webSourceFrameworkInputs } = await script('source-web-framework-inputs'), { sourceWebReplayRuntimePorts } = await script('source-web-replay-runtime'),
    { initializedContentBatchProfile } = await script('build-initialized-content-batch');
  const a = webSourceFrameworkInputs(), b = webSourceFrameworkInputs(); assert.equal(a.birdViewActors, WEB_FLAT_BIRD_VIEW_ACTORS);
  assert.equal(sourceWebReplayRuntimePorts().birdViewActors, WEB_FLAT_BIRD_VIEW_ACTORS); delete a.birdViewActors;
  assert.equal(b.birdViewActors, WEB_FLAT_BIRD_VIEW_ACTORS);
  for (const [declared, policy] of [[true, false], [false, true], [true, true]] as const) {
    const f = await birdViewActorsFixture({ contentPolicy: false }), parentSourceSetHash = 'a'.repeat(64),
      sourceMap = sealBatchContent({ ...f.sourceMap, parentSourceSetHash }),
      sourceEntry = sealBatchContent({ ...f.sourceEntry, parentSourceSetHash, mapContentHash: sourceMap.contentHash }),
      profile = (hash: string) => initializedContentBatchProfile(hash, { presentation: 'framework-ordinary-field-flat-v1',
        ...(declared ? { birdViewActors: b.birdViewActors } : {}) }),
      map = sealBatchContent({ ...f.map, parentSourceSetHash, developmentProfile: profile(sourceMap.contentHash) }),
      world = sealBatchContent({ ...f.world, parentSourceSetHash, developmentProfile: profile(sourceEntry.worldCatalogHash), maps: { ...f.world.maps,
        [map.mapId]: { ...f.world.maps[map.mapId]!, contentHash: map.contentHash } } }),
      content = await compileFrameworkNewGame({ sourceEntry, sourceBattle: f.sourceBattle, sourceMap,
        world, map, battle: f.battle, entrance: map.partyEntry!.pointIns[0]!.id }),
      game = await GameSession.prepareFrameworkNewGame(content, world, map, f.battle, policy ? f.runtime : { battleHandoff: 'prepared' }),
      flow = new GameFlow(game); flow.start(game); flow.observeHost(birdHost); flow.advance(10, birdHost);
    for (const value of [content, world, map]) assert.equal(value.developmentProfile?.birdViewActors, declared ? WEB_FLAT_BIRD_VIEW_ACTORS : undefined);
    assert.equal(!!fieldBirdViewActorBinding(game.field.content, policy ? WEB_FLAT_BIRD_VIEW_ACTORS : undefined), declared && policy);
    assert(game.field.startEvent('bird-up')); flow.advance(510, birdHost);
    if (declared && policy) { assert.equal(game.field.stop, null); assert.equal(game.field.birdViewActorElevation('native:puppet:0'), 120); }
    else { assert.equal(game.field.stop?.kind, 'unsupported'); assert.equal(game.field.actors['native:puppet:0']!.birdView, undefined); }
  }
});
