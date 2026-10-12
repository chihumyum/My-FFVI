// Published source + controlled Web host, not original runtime timing parity.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GameSession } from '../dist/src/core/game-session.js';
import { BattleGame } from '../dist/src/core/battle.js';
import { GameState } from '../dist/src/core/game-state.js';
import { encounterContent } from '../dist/src/core/battle-content.js';
import { verifyContent } from '../dist/src/core/content-integrity.js';
import { hash } from '../dist/src/compiler/content.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = root + 'build/reports/battle-speed-settings-check.json';
await mkdir(root + 'build/reports', { recursive: true }); await rm(output, { force: true });
const read = async (file) => JSON.parse(await readFile(root + file, 'utf8'));
const native = await read('build/reports/battle-speed-settings-native-check.json');
assert.equal(native.semanticsVerified, false);
assert.deepEqual(native.speedSlots, [0.5, 0.75, 1, 1.5, 2]);
const field = await verifyContent(await read('build/game/narshe.json'));
const catalog = await verifyContent(await read('build/game/opening-playable.json'));
const original = structuredClone(catalog);
assert.equal(catalog.common.timing.speedIndex, native.defaultIndex);
const state = new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
const encounter = Number(Object.keys(catalog.encounters)[0]);
assert.ok(encounter);
const before = state.snapshot(), lease = state.openBattle(encounter), inventory = state.battleInventory(lease);
const units = state.battlePlayers(lease), progression = state.battleProgression(lease);
const probes = [];
for (let speedIndex = 0; speedIndex < 5; speedIndex++) {
  const content = structuredClone(encounterContent(catalog, encounter)), candidates = structuredClone(units);
  assert.ok(content); content.initialAtb.player = [0, 0];
  // Actual source poison identity, isolated candidates; no status or item grant.
  candidates[0].conditionIds.push(10);
  const battle = new BattleGame(content, 2612, candidates, inventory, progression, { mode: 'active', speedIndex });
  const actor = battle.players[0], multiplier = native.speedSlots[speedIndex];
  assert.equal(battle.timingState.atbSpeed, multiplier);
  assert.equal(battle.conditionClockState(actor.id)[0].thresholdSeconds, Math.fround(8 / multiplier));
  battle.advance(10);
  const python = String.raw`import json,sys,struct
v=json.load(sys.stdin);f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
c=v['rules'];r=f(f(f(v['agility']-v['weight'])/f(c['coefficient']))+1)
t=1 if not c['total'] else f(100/f(c['total']))
print(f(f(f(f(f(f(0.01)*30)*r)*f(v['speed']))*1)*t))`;
  const expected = Number(execFileSync(root + '.venv/bin/python', ['-c', python], {
    input: JSON.stringify({ rules: content.atb, agility: actor.agility, weight: actor.weight, speed: multiplier }), encoding: 'utf8',
  }).trim());
  assert.equal(actor.atb, expected);
  const gauge = actor.atb, clocks = battle.conditionClockState(actor.id);
  battle.setPreferences({ mode: 'wait', speedIndex });
  battle.setClockInput({ ...battle.timingState.input, uiWaiting: true });
  battle.advance(100);
  assert.equal(actor.atb, gauge); assert.deepEqual(battle.conditionClockState(actor.id), clocks);
  probes.push({ speedIndex, multiplier, gauge, initialPoisonThreshold: Math.fround(8 / multiplier) });
}
assert.deepEqual(state.snapshot(), before);
assert.deepEqual(catalog, original);

// Session persistence, encounter creation and retry must use the same settings.
const session = new GameSession(field, catalog);
session.setBattlePreferences({ mode: 'wait', speedIndex: 4 });
const checkpoint = session.checkpoint();
assert.equal(checkpoint.formatVersion, 5);
const restored = GameSession.restore(checkpoint, field, catalog);
assert.deepEqual(restored.battlePreferences, { mode: 'wait', speedIndex: 4 });
for (const invalid of [-1, 5, 0.5, '2', null]) {
  const before = restored.checkpoint();
  assert.throws(() => restored.setBattlePreferences({ mode: 'wait', speedIndex: invalid }), /preferences/);
  assert.deepEqual(restored.checkpoint(), before);
  const bad = structuredClone(checkpoint); bad.battlePreferences.speedIndex = invalid;
  assert.throws(() => GameSession.restore(bad, field, catalog), /preferences/);
}
const legacy = structuredClone(checkpoint); legacy.formatVersion = 2;
assert.throws(() => GameSession.restore(legacy, field, catalog), /checkpoint/);
for (let n = 0; n < 11; n++) {
  assert.equal(restored.field.move('up'), true); restored.advance(240);
}
restored.advance(1000); restored.field.confirm(); restored.advance(1000);
assert.equal(restored.battle.phase, 'active');
assert.equal(restored.battle.timingState.atbSpeed, 2);
restored.setBattlePreferences({ mode: 'active', speedIndex: 0 });
assert.equal(restored.battle.timingState.atbSpeed, 0.5);
for (let n = 0; n < 120 && restored.battle.phase === 'active'; n++) restored.advance(60000);
assert.equal(restored.battle.phase, 'defeat');
assert.ok(restored.retryBattle());
assert.deepEqual(restored.battle.preferences, { mode: 'active', speedIndex: 0 });
assert.equal(restored.battle.timingState.atbSpeed, 0.5);
const report = { kind: 'source-battle-speed-settings', contentHash: catalog.contentHash,
  fieldHash: field.contentHash, nativeReportHash: hash(native), sourceHostProbes: probes,
  checkpointVersion: 3, restoredAndRetried: true, invalidSettingsRejected: 5,
  originalGameExecuted: false, browserExecuted: false };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
