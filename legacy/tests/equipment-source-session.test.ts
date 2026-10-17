import test from 'node:test';
import assert from 'node:assert/strict';
import { magicStonesSessionFixture } from './fixtures/magic-stones-session.js';
import { sealBatchContent } from './fixtures/content-batch.js';
import { createNewGame } from '../src/core/new-game.js';
import { GameSession, type GameCheckpoint } from '../src/core/game-session.js';
import { NewGameFieldEntry } from '../src/core/new-game-field-entry.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { compileRosterLifecycleEvent } from '../src/compiler/roster.js';
import { compilePartyEvent } from '../src/compiler/party.js';
import type { Op } from '../src/field/types.js';

/** Controlled source fixture and real factory/session. Only the first owner is
 * declared by its initializer; the second must be created by the roster command.
 * It is not source-story reachability or a substitute for missing real media. */
function sourceEquipmentSession(options: { preparedBattle?: boolean } = {}) {
  const f = magicStonesSessionFixture(), owner = f.battle.gameState;
  delete f.map.walkEncounters;
  const [first, joining] = f.playerIds, initial = owner.sourceNewGame!;
  const actual = Object.values(initial.equipment.definitions).find(d => !d.empty && d.kind === 'weapon')!;
  const job = owner.characterInitializations![joining]!.initial.jobId;
  actual.jobIds = [job + 99];
  initial.equipment.kind = 'source-equipment-state-v2';
  initial.characters = initial.characters.filter(c => c.id === first);
  for (const slot of initial.party.slots) for (const cell of slot) if (cell.id === joining) cell.id = null;
  const fresh = createNewGame(initial);
  owner.initialParty = structuredClone(fresh.owned.party);
  owner.equipment = Object.fromEntries(fresh.owned.roster.map(m => [m.id, [...m.equipment]]));
  owner.rosterLifecycle.initial = Object.fromEntries(fresh.owned.roster.map(m => [m.id, {
    ownedId: m.ownedId, jobId: m.jobId, additionalLevel: m.additionalLevel,
    magicStoneId: m.magicStoneId, ownedJobs: structuredClone(m.ownedJobs),
  }]));
  owner.rosterLifecycle.firstJoinLevelAdjustments = { 3: 0 };
  owner.equipmentSystem!.catalog = structuredClone(initial.equipment);
  owner.equipmentSystem!.initialStock = structuredClone(fresh.owned.equipmentStock);
  owner.battleDefinitions = structuredClone(f.battle.common.players);
  f.battle.common.players = f.battle.common.players.filter(p => p.id === first);
  const runtime = options.preparedBattle ? { battleHandoff: "prepared" as const } : {};
  const tables = { 'character_status.csv': [{ id: '2', job_id: '12' }, { id: '3', job_id: '12' }], 'job.csv': [{ id: '12' }] };
  const script = 'source-equipment-join';
  const join = compileRosterLifecycleEvent('メンバー加入：カイエン', tables);
  const organize = compilePartyEvent('OrganizePartySlot', [1, 3, 2, -2, -2, 0, 0, 0], tables);
  f.map.scripts[script] = [join, organize, { kind: 'exit' }].map((op, index) => ({ ...op, index, script, source: f.source }) as Op);
  f.map.scriptPuppetContexts![script] = { ...f.map.scriptPuppetContexts!.reserved! };
  (f.map.scriptSystemFlags ??= {})[script] = { keepBadStatusVisual: false };
  (f.map.scriptLocals ??= {})[script] = null;
  const battle = sealBatchContent(f.battle), map = sealBatchContent(f.map);
  f.world.maps[map.mapId]!.contentHash = map.contentHash;
  const world = sealBatchContent(f.world);
  f.content.battleCatalogHash = battle.contentHash; f.content.worldCatalogHash = world.contentHash; f.content.mapContentHash = map.contentHash;
  const content = sealBatchContent(f.content);
  const make = () => {
    const entry = new NewGameFieldEntry(content.entry, f.presentation);
    const start = entry.prepareStart(f.fade, { active: true, callbacks: 'absent' }); start.commit();
    let fade = start.fade; fade.advance(.5);
    for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
    const game = GameSession.prepareNewGame(content, world, map, battle, fade, f.presentation, runtime);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
    for (let i = 0; i < 100 && !game.checkpointReady; i++) game.advance(10);
    assert(game.checkpointReady, game.field.stop?.message);
    assert.deepEqual(game.state.snapshot().roster.map(m => m.id), [first]);
    return game;
  };
  const restore = (checkpoint: GameCheckpoint) => GameSession.restore(checkpoint, undefined, battle,
    { catalog: world, map, source: { content, initialMap: map } }, runtime);
  const enter = (game: GameSession) => { assert(game.field.startEvent(script)); game.advance(10); assert.equal(game.field.stop, null); };
  return { f, owner, actual, first, joining, battle, map, make, restore, enter, script };
}

test('source roster creation and native actor refresh keep an otherwise job-ineligible initial loadout through one battle return and Storage', async () => {
  const f = sourceEquipmentSession(), game = f.make(), before = game.state.snapshot(), player = game.field.player;
  f.enter(game);
  assert.equal(game.field.player, player);
  const joined = game.state.snapshot(), member = joined.roster.find(m => m.id === f.joining)!;
  assert.equal(member.ownedId, 2); assert.equal(joined.party.slots[0][0].id, f.joining);
  assert.deepEqual(member.equipment, f.owner.characterInitializations![f.joining]!.initial.equipment);
  assert.equal(game.field.partyActorCheckpoint!.context.puppets[0]!.fieldAssetId, 3);
  assert.equal(joined.roster.length, before.roster.length + 1);
  const equipmentBefore = [...member.equipment], stockBefore = structuredClone(joined.equipmentStock);
  f.f.startBattle(game); assert.equal(game.battle!.players[0]!.id, f.joining);
  assert.throws(() => game.state.changeEquipment(f.joining, 1, f.actual.id), /active|battle|战斗/i);
  f.f.previewVictory(game); assert(game.continueVictory()); game.advance(10);
  assert.equal(game.continueVictory(), false);
  assert.deepEqual(game.state.snapshot().roster.find(m => m.id === f.joining)!.equipment, equipmentBefore);
  assert.deepEqual(game.state.snapshot().equipmentStock, stockBefore);
  assert(game.checkpointReady);
  const values = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } });
  const saved = game.checkpoint(); (await storage.prepareSave(saved, 0)).commit();
  const restored = f.restore((await storage.load())!.checkpoint);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.throws(() => restored.state.changeEquipment(f.joining, 1, f.actual.id), /job mismatch/);
  assert.deepEqual(restored.state.snapshot(), saved.owned);
  const forged = structuredClone(saved);
  Object.assign(forged.owned, { equipmentStateKind: 'source-equipment-state-v2' });
  assert.throws(() => f.restore(forged));
  assert.deepEqual(restored.state.snapshot(), saved.owned);
});

test('a prepared roster candidate failing before publication does not create ownership, names, history, inventory or actors; retry creates once', () => {
  const f = sourceEquipmentSession(), game = f.make(), checkpoint = game.checkpoint(), before = game.state.snapshot(), appearance = game.field.partyActorCheckpoint,
    native = game.field.nativeActorStateFingerprint;
  const port = game.state.fieldRoster, prepare = port.prepare.bind(port);
  port.prepare = command => {
    const candidate = prepare(command);
    return { ...candidate, commitWith() { throw new Error('Controlled source-equipment candidate publication failure'); } };
  };
  assert(game.field.startEvent(f.script)); game.advance(10);
  assert.match(game.field.stop!.message, /candidate publication failure/);
  assert.deepEqual(game.state.snapshot(), before); assert.deepEqual(game.field.partyActorCheckpoint, appearance);
  assert.equal(game.field.nativeActorStateFingerprint, native);
  port.prepare = prepare; const retry = f.restore(checkpoint); f.enter(retry);
  assert.notEqual(retry.field, game.field); assert.equal(game.field.startEvent(f.script), false);
  const stable = retry.state.snapshot(); assert.equal(stable.roster.length, 2);
  assert.throws(() => retry.state.fieldRoster.prepare({ kind: 'unlock', sourceId: 999, refreshActors: false }), /initialization/);
  assert.deepEqual(retry.state.snapshot(), stable);
});


test('source initial equipment survives prepared battle cancellation, stale candidates and unique return under the actual session lease', () => {
  const f = sourceEquipmentSession({ preparedBattle: true }), game = f.make(); f.enter(game);
  const before = game.state.snapshot(); assert(game.field.startEvent('stone-battle')); game.advance(10);
  assert.equal(game.battle, null); const old = game.prepareBattleStart()!; assert(old);
  old.validate(); old.discard(); assert.equal(game.state.inBattle, false);
  assert.deepEqual(game.state.snapshot(), before);
  const next = game.prepareBattleStart()!; assert(next); assert.equal(game.state.inBattle, true);
  old.discard(); assert.equal(old.commit(), false); assert.equal(game.state.inBattle, true);
  assert(next.commit()); assert.equal(game.battle!.players[0]!.id, f.joining);
  f.f.previewVictory(game); const returning = game.prepareBattleReturn()!; assert(returning); returning.discard();
  assert.equal(game.state.inBattle, true); assert.deepEqual(game.state.snapshot(), before);
  const retry = game.prepareBattleReturn()!; assert(retry); returning.discard(); assert(retry.commit());
  assert.equal(returning.commit(), false); assert.equal(retry.commit(), false);
  game.advance(10); assert(game.checkpointReady);
  assert.deepEqual(game.state.snapshot().roster.find(m => m.id === f.joining)!.equipment,
    before.roster.find(m => m.id === f.joining)!.equipment);
  assert.equal(game.state.snapshot().completedBattles.length, before.completedBattles.length + 1);
});
