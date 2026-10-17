import assert from 'node:assert/strict';
/** Redistributable, explicitly authored native-actor mechanism fixture. Its
 * blank 128x64 geometry/placement never claim an original map or source caller.
 * Only the actual source Route opcode is transplanted verbatim into the VM. */
export async function createPuppetRouteParameterHost({ load, op, subject = "ordinary-native-NPC" }) {
  assert.equal(op.kind, 'field-puppet-route'); assert.ok(['ordinary-native-NPC', 'camera-dummy'].includes(subject));
  const [{ fieldMoveToSessionFixture }, { hash }, { decodeFieldOp }, { GameSession }, { GameFlow }, { NewGameFieldEntry }, { fieldCameraWorldToCell }] = await Promise.all([
    load('tests/fixtures/field-move-to-session'), load('src/compiler/content'), load('src/compiler/field'),
    load('src/core/game-session'), load('src/core/game-flow'), load('src/core/new-game-field-entry'), load('src/core/field-camera')]);
  const f = await fieldMoveToSessionFixture(), map = structuredClone(f.map), world = structuredClone(f.world),
    source = { file: 'scripts/source-puppet-route-parameter-host.mjs', assetPath: 'authored-128x64-native-route-parameter-envelope' },
    width = 128, height = 64, range = { x: 0, y: 0, width, height }, script = 'controlled-route-parameter',
    seal = v => { const { contentHash, ...body } = v; return { ...body, contentHash: hash(body) }; };
  assert.ok(Number.isInteger(op.command.x) && op.command.x > 1 && op.command.x < width && op.command.y > 1 && op.command.y < height,
    'Actual source Route parameters outside this declared controlled geometry');
  map.map.width = width; map.map.height = height; map.map.layers = []; map.map.collisions = { 0: Array(width * height).fill(0), 1: Array(width * height).fill(0), 2: Array(width * height).fill(0) };
  const initialLayer = subject === 'camera-dummy' && op.command.layer ? op.command.layer - 1 : 0;
  map.partyEntry.pointIns[0].layer = initialLayer;
  for (const e of map.map.groups.entity_default.entities) if (e.kind === 0 && e.objectId === map.partyEntry.pointIns[0].id) e.layer = initialLayer;
  map.partyEntry.width = width; map.partyEntry.height = height; map.partyEntry.mapRange = { ...range }; map.cameraHost.mapRange = { ...range };
  map.actorView.mapSize = { width, height }; map.actorView.contextId = hash({ sources: map.actorView.sources, mapSize: map.actorView.mapSize, declaration: source });
  const entities = map.map.groups.entity_default.entities.filter(e => e.kind === 0 || e.id === '601');
  map.map.groups = { entity_default: { ...map.map.groups.entity_default, entities } }; map.map.entities = structuredClone(entities);
  const position = decodeFieldOp({ type: 2, mnemonic: 'SetPos', operands: { iValues: [op.command.x - 1, op.command.y, subject === "camera-dummy" ? 0 : op.command.layer || 1, 0, 0, 0, 0, 0],
    rValues: Array(8).fill(0), sValues: Array(8).fill('') } }, { script, index: 6, source }, {}); assert.equal(position.kind, 'position');
  const emit = (value, index) => ({ ...value, script, index, source });
  map.scripts[script] = [emit({ kind: 'puppet', slot: 0, actor: subject === 'camera-dummy' ? '0' : '601', target: 5 }, 0), emit({ kind: 'exec-puppets', asynchronous: true }, 1),
    emit({ kind: 'finish-puppets' }, 2), emit({ kind: 'message', key: 'AUTHORED_ROUTE_ENDPOINT', speaker: '', text: 'Controlled Route endpoint observed before Main cleanup.' }, 3), emit({ kind: 'exit' }, 4), emit({ kind: 'nop' }, 5), position,
    structuredClone(op), emit({ kind: 'exit' }, 8)];
  map.scriptLocals[script] = null; map.scriptPuppetContexts[script] = { ...map.scriptPuppetContexts.reserved, scriptHash: hash({ source, sourceSite: op }) };
  const sealedMap = seal(map); world.maps[map.mapId].contentHash = sealedMap.contentHash;
  const catalog = seal(world), content = seal({ ...f.content, view: structuredClone(map.actorView), worldCatalogHash: catalog.contentHash, mapContentHash: sealedMap.contentHash }), runtime = { puppetRoutes: 'web-source-puppet-route-grid-v1' };
  const sequence = new NewGameFieldEntry(content.entry, f.presentation), start = sequence.prepareStart(f.fade, { active: true, callbacks: 'absent' }); start.commit();
  let fade = start.fade; fade.advance(.5); for (let i = 0; i < 3; i++) { const next = sequence.prepareResume(fade, true); assert.ok(next); next.commit(); fade = next.fade; }
  const game = GameSession.prepareNewGame(content, catalog, sealedMap, f.battle, fade, f.presentation, runtime), launch = sequence.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); const flow = new GameFlow(game); flow.start();
  return { game, flow, script, subject, actorId: subject === 'camera-dummy' ? game.field.cameraActorId : '601', destination: { x: op.command.x, y: op.command.y, layer: op.command.layer ? op.command.layer - 1 : 0 },
    declaration: { kind: 'authored-source-route-parameter-host-v1', subject, geometry: { width, height, collisions: 'declared-all-walkable' },
      placement: { kind: 'authored-SetPos-before-actual-Route', initialPointInLayer: initialLayer, x: op.command.x - 1, y: op.command.y, layer: subject === "camera-dummy" ? 0 : op.command.layer || 1 },
      sourceOpcodeRetained: true, sourceCallerPreserved: false, sourceStoryReachability: false, originalOwnedState: false },
    position: () => { if (subject !== 'camera-dummy') { const a = game.field.actors['601']; return { x: a.x, y: a.y, layer: a.layer }; } const p = game.field.cameraSnapshot.dummy.position; return { ...fieldCameraWorldToCell(range, { x: p.x, y: p.y }), layer: [349,249,149].indexOf(p.z) }; },
    restore: saved => GameSession.restore(saved, undefined, f.battle, { catalog, map: sealedMap, source: { content, initialMap: sealedMap } }, runtime) };
}
