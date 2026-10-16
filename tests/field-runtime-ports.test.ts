import test from "node:test";
import assert from "node:assert/strict";
import { forwardFieldRuntimePorts } from "../src/core/field-runtime-ports.js";
import { createWebFieldMessageWindowReady, prepareWebFieldMessageWindowReady } from "../src/core/field-empty-message.js";
import { SourceMessageState } from "../src/core/source-message.js";
import type { FieldGame, FieldGameOptions } from "../src/core/field.js";
import type { GameSessionRuntime } from "../src/core/game-session.js";
import { nonEncounterSessionFixture } from "./fixtures/non-encounter-area-session.js";
import { encounterReady } from "./fixtures/source-encounter-session.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";

function runtimeOf(field: FieldGame): FieldGameOptions {
  return (field as unknown as { options: FieldGameOptions }).options;
}
function fixture() {
  const f = nonEncounterSessionFixture(), surface = {}, display: { current: FieldGame | null } = { current: null };
  const ready = createWebFieldMessageWindowReady(() => ({ kind: "web-field-message-window-surface-v1", surface,
    initialized: true, owner: display.current?.sourceMessage ?? null, generation: display.current }));
  f.runtime.sourceMessageReady = ready;
  f.runtime.sourceSnapshot = "immutable-owned-field-source-v1";
  f.runtime.transportationParkingUpload = "web-source-transport-parking-upload-v1";
  f.runtime.sourceStoryExecution = "source-story-execution-evidence-v1";
  const live = f.make(); display.current = live.game.field;
  return { f, live, ready, display };
}
function stable(live: ReturnType<typeof fixture>["live"]) {
  for (let i = 0; i < 100 && !live.game.checkpointReady; i++) live.flow.advance(10, encounterReady);
  assert.equal(live.game.checkpointReady, true, JSON.stringify(live.game.field.stop));
}
function activate(live: ReturnType<typeof fixture>["live"]) {
  assert.equal(live.game.field.startEvent("regions"), true); stable(live);
  assert.equal(live.game.field.sourceNonEncounterAreaProperties.length, 1);
}
function assertHosts(field: FieldGame, f: ReturnType<typeof nonEncounterSessionFixture>, ready: ReturnType<typeof createWebFieldMessageWindowReady>) {
  const actual = runtimeOf(field);
  assert.equal(actual.sourceMessageReady, ready);
  assert.equal(actual.sourceNonEncounterAreas, f.runtime.sourceNonEncounterAreas);
  assert.equal(actual.sourceSnapshot, f.runtime.sourceSnapshot);
  assert.equal(actual.transportationParkingUpload, f.runtime.transportationParkingUpload);
  assert.equal((actual as FieldGameOptions & Pick<GameSessionRuntime, "sourceStoryExecution">).sourceStoryExecution, f.runtime.sourceStoryExecution);
  assert.equal(prepareWebFieldMessageWindowReady(ready, field.sourceMessage).ready, true);
}

test("Field forwarding preserves a genuine private host and distinguishes session, entry and prepared-map ownership", () => {
  const owner = new SourceMessageState(), surface = {}, generation = {}, clock = () => true;
  const ready = createWebFieldMessageWindowReady(() => ({ kind: "web-field-message-window-surface-v1", surface,
    initialized: true, owner, generation }));
  const resultPort: NonNullable<FieldGameOptions["sourceBattleResult"]> = { policy: "web-committed-battle-result-v1",
    prepare: () => { throw Error("not requested by forwarding"); } };
  const options: FieldGameOptions = { sourceMessageReady: ready, sourceBattleResult: resultPort,
    nativeActorPreparation: true, npcActivityClock: clock, messageFeeSeed: undefined as never,
    sourceSnapshot: "immutable-owned-field-source-v1", transportationParkingUpload: "web-source-transport-parking-upload-v1",
    puppetRoutes: "web-grid-puppet-routes-v1" as never, fieldEffects: { prepare: () => { throw Error("no implicit allocation"); } } as never };
  const session = forwardFieldRuntimePorts(options, "session");
  assert.equal(session.sourceMessageReady, ready); assert.equal(prepareWebFieldMessageWindowReady(session.sourceMessageReady, owner).ready, true);
  assert.equal("sourceBattleResult" in session, false); assert.equal("npcActivityClock" in session, false);
  const entry = forwardFieldRuntimePorts(options, "entry");
  assert.equal(entry.sourceBattleResult, resultPort); assert.equal(entry.npcActivityClock, clock);
  assert.equal(entry.fieldEffects, options.fieldEffects); assert.equal(entry.puppetRoutes, options.puppetRoutes);
  const map = forwardFieldRuntimePorts(options, "map");
  assert.equal(map.sourceBattleResult, resultPort); assert.equal(map.sourceMessageReady, ready);
  for (const local of ["npcActivityClock", "nativeActorPreparation", "messageFeeSeed", "puppetRoutes", "fieldEffects"])
    assert.equal(local in map, false, local + " must come from the actual map/draft owner");
  const mixed: GameSessionRuntime = { sourceMessageReady: ready, battleHandoff: "prepared",
    battleEventMessages: "web-source-battle-event-messages-v1", sourceBattleResult: "web-committed-battle-result-v1" };
  assert.deepEqual(Object.keys(forwardFieldRuntimePorts(mixed, "session")), ["sourceMessageReady"]);
  assert.deepEqual(forwardFieldRuntimePorts(undefined, "entry"), {});
  assert.deepEqual(forwardFieldRuntimePorts({} as GameSessionRuntime, "session"), {});
  assert.equal(prepareWebFieldMessageWindowReady(ready, owner).ready, true, "helper never calls or serializes the private host");
});

test("initialized Session map cancel/retry and Storage retain hosts, while private candidate never inherits current-window readiness", async () => {
  const { f, live, ready, display } = fixture(), old = live.game.field;
  assertHosts(old, f, ready); activate(live);
  assert.equal(old.startEvent("region-travel"), true);
  const cancelled = live.game.world.prepare(f.world, f.map);
  assert.equal(runtimeOf(cancelled.field).sourceMessageReady, ready);
  assert.equal(prepareWebFieldMessageWindowReady(ready, cancelled.field.sourceMessage).ready, false);
  live.game.world.discard(cancelled);
  assert.equal(live.game.field, old); assert.equal(old.sourceNonEncounterAreaProperties.length, 1);
  assert.throws(() => cancelled.field.sourceStandingInNonEncounterArea({ x: 1, y: 1 }), /Retired/);
  const stale = live.game.world.prepare(f.world, f.map);
  // Publishing the winning candidate makes the competing preparation stale.
  const next = live.game.world.prepare(f.world, f.map);
  assert.equal(live.game.world.commit(next), true); assert.equal(live.game.world.commit(stale), false);
  const current = live.game.field; display.current = current;
  stable(live); assertHosts(current, f, ready); activate(live);
  assert.throws(() => old.sourceStandingInNonEncounterArea({ x: 1, y: 1 }), /Retired/);
  const values = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }, "framework", "runtime-forwarding");
  await storage.save(live.game.checkpoint(), 0); const saved = (await storage.load())!.checkpoint;
  const restored = f.restore(saved); display.current = restored.field;
  assertHosts(restored.field, f, ready); assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.field.sourceNonEncounterAreaProperties.length, 1);
  delete f.runtime.sourceMessageReady;
  const unbound = f.restore(saved); assert.equal(runtimeOf(unbound.field).sourceMessageReady, undefined);
  assert.throws(() => prepareWebFieldMessageWindowReady(runtimeOf(unbound.field).sourceMessageReady, unbound.field.sourceMessage), /genuine/);
  delete f.runtime.sourceNonEncounterAreas;
  assert.throws(() => f.restore(saved), /runtime authority/);
});

test("actual prepared battle failure and unique return retain the same Field host identities and area membership", async () => {
  const { f, live, ready } = fixture(), field = live.game.field; activate(live);
  assert.equal(field.startEvent("source-fight"), true);
  for (let i = 0; i < 100 && !field.stop; i++) live.flow.advance(10, encounterReady);
  assert.equal(field.stop?.kind, "encounter");
  const fail = new GameBattleHandoff(live.flow, { prepareStart: async () => { throw Error("media unavailable"); }, prepareReturn: async () => ({}), discard() {} });
  assert.equal((await fail.start()).status, "failed"); assertHosts(live.game.field, f, ready);
  const handoff = new GameBattleHandoff(live.flow, { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} });
  assert.equal((await handoff.start()).status, "committed"); const battle = live.game.battle!;
  for (let i = 0; i < 2500 && battle.phase === "active"; i++) {
    for (const actor of battle.ready) { const target = battle.enemies.find(e => e.hp > 0);
      if (target) live.commands.command(battle, actor.id, 10, { kind: "single", id: target.id }, 100); }
    live.flow.advance(20, encounterReady);
  }
  assert.equal(battle.phase, "victory"); assert.equal((await handoff.return()).status, "committed"); stable(live);
  assert.equal(live.game.field, field); assertHosts(field, f, ready); assert.equal(field.sourceNonEncounterAreaProperties.length, 1);
  await assert.rejects(() => handoff.return(), /requires/);
});
