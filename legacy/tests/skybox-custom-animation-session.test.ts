import test from 'node:test';
import assert from 'node:assert/strict';
import { skyboxFixture, skyboxHost, skyboxOp } from './fixtures/skybox.js';
import { sealBatchContent as seal } from './fixtures/content-batch.js';
import { compileSourceScriptAnimations } from '../src/compiler/source-script-animations.js';
import { compileEventScriptTransitionMetadata } from '../src/compiler/event-script-transition.js';
import { SOURCE_FORMAT_FLAG_IMPORT } from '../src/core/source-format-import.js';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { FieldFadeState, DEVELOPMENT_TRANSPARENT_FADE } from '../src/core/field-fade.js';
import { hash } from '../src/compiler/content.js';
import type { Op } from '../src/field/types.js';

test('one initialized Session saves the completed Skybox owner and actual custom component cache together', async () => {
  const f = await skyboxFixture(), sample = await f.make(), map = structuredClone(f.map), world = structuredClone(f.world),
    character = sample.game.field.actors['-1001']!.animation!.character, sprite = Object.keys(character.sprites)[0]!;
  assert(sprite);
  const name = 'authored-custom-skybox', source = { file: 'authored-custom-skybox.bundle',
    assetPath: 'authored/custom-skybox', objectId: '-9007199254740999', serializedFile: 'authored', sha256: '7'.repeat(64) },
    data = { SystemFlag: {}, Animations: [{ name: 'SkyPose', frames: [{ sprite_name: sprite, offsetx: 7, offsety: 0,
      alpha: 1, rgb: { r: 1, g: 1, b: 1, a: 1 }, flip: false }], play_speed: 0, play_mode: 0, is_reverse: false, next_anim_name: '' }] },
    asset = { id: name, kind: 'script' as const, source, data }, sources = [
      { file: 'GameAssembly.dll', sha256: SOURCE_FORMAT_FLAG_IMPORT.nativeSha256 }, { file: source.file, sha256: source.sha256 }],
    sourceSetHash = hash(sources), compiled = compileSourceScriptAnimations({ sourceSetHash,
      manifest: { parentSourceSetHash: map.parentSourceSetHash, sources }, assets: [asset] });
  map.sourceSetHash = sourceSetHash; world.sourceSetHash = sourceSetHash;
  const skybox = map.map!.skybox!; skybox.catalog = seal({ ...skybox.catalog, sourceSetHash });
  assert.deepEqual(compiled.rejected, []); world.sourceScriptAnimations = compiled.catalog;
  for (const key of Object.keys(map.scripts)) (map.scriptTransitionMetadata ??= {})[key] ??= { customAnimations: 'none' };
  const instructions = [{ kind: 'animation-cue', animation: 'SkyPose', frame: 0 }, skyboxOp(),
    { kind: 'event-save' }, { kind: 'exit' }];
  map.scripts[name] = instructions.map((op, index) => ({ ...op, script: name, index, source }) as Op);
  map.scriptPuppetContexts![name] = { ...map.scriptPuppetContexts!.skybox!, skipInitialize: true,
    keepPlayerPuppet: true, scriptHash: hash(data) };
  map.scriptTransitionMetadata![name] = compileEventScriptTransitionMetadata(data,
    { catalog: compiled.catalog, assetId: compiled.byProgram[name]! });
  map.scriptLocals![name] = null; map.scriptSystemFlags![name] = { keepBadStatusVisual: false };
  const pinnedMap = seal(map); world.maps[map.mapId]!.contentHash = pinnedMap.contentHash;
  const pinnedWorld = seal(world), content = seal({ ...f.content, sourceSetHash, mapContentHash: pinnedMap.contentHash,
    worldCatalogHash: pinnedWorld.contentHash }), external = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE),
    game = await GameSession.prepareFrameworkNewGame(content, pinnedWorld, pinnedMap, f.battle, f.runtime, 17, external),
    flow = new GameFlow(game);
  flow.start(); flow.advance(10, skyboxHost); const actor = game.field.actors['-1001']!, fade = game.field.fader;
  assert.equal(game.field.stop, null, game.field.stop?.message); assert(game.checkpointReady);
  assert(game.field.startEvent(name), JSON.stringify(game.field.stop));
  for (let i = 0; i < 12000 && !game.eventSaveRequest && !game.field.stop; i++) flow.advance(10, skyboxHost);
  assert.equal(game.field.stop, null, JSON.stringify(game.field.stop)); assert(game.eventSaveRequest);
  assert.equal(actor.animation!.frame().x, 7); assert.equal(actor.animation!.hasSourceCustomAnimations, true);
  const request = game.eventSaveRequest, checkpoint = game.prepareEventSave(request).checkpoint;
  assert.equal(checkpoint.world.field.kind, 'event-field-v8');
  assert(JSON.stringify(checkpoint).includes('web-flat-skybox-state-v1'));
  assert.equal(JSON.stringify(checkpoint).includes('sprite_name'), false);
  const entries = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => entries.get(k) ?? null,
    setItem: (k, v) => { entries.set(k, v); } });
  await storage.save(checkpoint, 0); const saved = (await storage.load())!.checkpoint,
    dependencies = { catalog: pinnedWorld, map: pinnedMap, initialized: { content, initialMap: pinnedMap } },
    restored = GameSession.restore(saved, undefined, f.battle, dependencies, f.runtime);
  assert.equal(restored.eventSaveRequest, null, 'Loading the committed event save resumes after its acknowledged barrier');
  assert.equal(restored.field.actors[actor.id]!.animation!.frame().x, 7);
  assert.deepEqual(restored.field.skyboxPresentation, game.field.skyboxPresentation);
  assert.equal(game.field.fader, fade); assert.deepEqual(external.projection, DEVELOPMENT_TRANSPARENT_FADE);
  const ports = { ...f.runtime }; delete ports.skyboxPresentation;
  assert.throws(() => GameSession.restore(saved, undefined, f.battle, dependencies, ports), /Skybox|skybox/);
  game.field.acknowledgeEventSave(request);
  for (let i = 0; i < 100 && (!game.checkpointReady || !restored.checkpointReady); i++) { game.advance(10); restored.advance(10); }
  assert(game.checkpointReady && restored.checkpointReady); assert.deepEqual(restored.checkpoint(), game.checkpoint());
});
