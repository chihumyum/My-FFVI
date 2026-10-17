import test from "node:test";
import assert from "node:assert/strict";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { resolveFieldPuppetActor } from "../src/core/field-puppet-actors.js";
import { fieldMoveToSessionFixture, launchFieldMoveToSession } from "./fixtures/field-move-to-session.js";

const host = { visible: true, mediaReady: true, overlayOpen: false };
function storage() {
  const bytes = new Map<string, string>();
  return { bytes, port: { getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => { bytes.set(key, value); } } };
}
type Fixture = Awaited<ReturnType<typeof fieldMoveToSessionFixture>>;
function tickUntil(flow: GameFlow, done: () => boolean, label: string, maxTicks = 1000): void {
  for (let index = 0; index < maxTicks; index++) {
    assert.equal(flow.session.field.stop, null, flow.session.field.stop?.message ?? label);
    assert.equal(flow.session.battle, null);
    if (done()) return;
    flow.advance(10, host);
  }
  assert.fail("Timed out: " + label);
}
async function start(f: Fixture) {
  const game = launchFieldMoveToSession(f), flow = new GameFlow(), discarded: null[] = [];
  const entries = new GameEntryLoader(flow, { discard: (value: null) => discarded.push(value) });
  const before = game.state.snapshot();
  flow.advance(1000, host);
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(entries.begin("new-game").commit({ session: game, presentation: null }).status, "committed");
  flow.advance(0, host); tickUntil(flow, () => game.checkpointReady, "source initialization");
  return { game, flow, entries, discarded };
}
const cell = (actor: { x: number; y: number }) => ({ x: actor.x, y: actor.y });

test("two actual native actors drain independent MoveTo routes, join, save/restore and continue through new input", async () => {
  const f = await fieldMoveToSessionFixture(), { game, flow, entries, discarded } = await start(f);
  const owner = game.state, world = game.world, field = game.field, actors = field.actors;
  const party = actors[f.actors.party.id]!, npc = actors[f.actors.npc.id]!;
  assert.ok(party.native && npc.native && party.animation && npc.animation);
  assert.notEqual(party, npc); assert.notEqual(party, field.player); assert.notEqual(npc, field.player);
  assert.equal(npc.native.scope?.kind, "map-npc");
  const context = field.options.puppetActors!.read();
  assert.equal(resolveFieldPuppetActor(context.catalog, context.context, f.actors.party.selector).actor, party.id);
  assert.equal(resolveFieldPuppetActor(context.catalog, context.context, f.actors.npc.selector).actor, npc.id);
  assert.deepEqual(cell(field.player), { x: 3, y: 4 }); assert.deepEqual(cell(npc), { x: 5, y: 5 });
  const owned = owner.snapshot(), nativeParty = party.native.entity, nativeNpc = npc.native.entity;
  const partySteps = party.steps, npcSteps = npc.steps, playerSteps = field.player.steps;
  assert.equal(flow.move("down"), true);
  tickUntil(flow, () => party.motion !== null && npc.motion !== null, "both source tracks start");
  assert.equal(field.actors, actors); assert.equal(game.state, owner); assert.equal(game.world, world);
  assert.equal(field.actors[party.id], party); assert.equal(field.actors[npc.id], npc);
  assert.equal(party.native.entity, nativeParty); assert.equal(npc.native.entity, nativeNpc);
  assert.equal(party.motion!.duration, 240); assert.equal(npc.motion!.duration, 120);
  assert.equal(party.motion!.route!.direction, "right"); assert.equal(npc.motion!.route!.direction, "down");
  assert.deepEqual(party.motion!.route!.points.at(-1), { x: 7, y: 5 });
  assert.deepEqual(npc.motion!.route!.points.at(-1), { x: 5, y: 7 });
  const moving = { party: structuredClone(party.motion), npc: structuredClone(npc.motion), time: field.time };
  assert.equal(flow.pause(true), true); flow.advance(5000, host);
  assert.deepEqual({ party: party.motion, npc: npc.motion, time: field.time }, moving);
  assert.equal(flow.pause(false), true);
  assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint());
  tickUntil(flow, () => npc.motion === null, "faster NPC final drain");
  assert.deepEqual(cell(npc), { x: 5, y: 7 }); assert.ok(party.motion);
  assert.equal(field.eventState.read(f.counters.completed), 0);
  assert.equal(field.dialogue, null, "FinishPuppets cannot advance on one actor alone");
  tickUntil(flow, () => party.x === 7 && party.motion?.route?.pendingSegment === true, "slower party endpoint");
  assert.deepEqual(cell(party), { x: 7, y: 5 }); assert.ok(party.motion);
  assert.equal(field.eventState.read(f.counters.completed), 0, "The final endpoint still owns its drain update");
  tickUntil(flow, () => field.dialogue !== null, "join after both routes drain");
  assert.equal(party.motion, null); assert.equal(npc.motion, null);
  assert.equal(field.eventState.read(f.counters.completed), 1);
  assert.equal(party.steps, partySteps + 4); assert.equal(npc.steps, npcSteps + 2);
  assert.equal(field.player.steps, playerSteps + 1, "Script actors cannot issue extra player-step callbacks");
  assert.deepEqual(owner.snapshot(), owned, "Actor choreography cannot consume items or settle a battle");
  assert.equal(flow.confirm(), true); tickUntil(flow, () => game.checkpointReady, "stable menu boundary");
  assert.deepEqual(cell(field.player), { x: 7, y: 5 });
  const commands = new GameCommands(flow, game);
  assert.equal(flow.pause(true), true); assert.equal(commands.menuReady, true);
  assert.equal(commands.menu({ kind: "set-preferences", preferences: { mode: "wait", speedIndex: 1 } }), true);
  const saved = game.checkpoint(), store = storage(), saves = new CheckpointStorage(store.port, "source", "controlled-move-to");
  const saveTicket = flow.beginOperation("save"), preparedSave = await saves.prepareSave(saved, 0);
  assert.equal(saveTicket.isCurrent(), true); preparedSave.commit(); assert.equal(saveTicket.finish(), true);
  const savedBytes = new Map(store.bytes), decoded = await saves.load();
  assert.ok(decoded);
  const result = await entries.begin("load").prepare(() => ({ session: f.restore(decoded.checkpoint),
    presentation: null, options: { paused: true } }));
  assert.equal(result.status, "committed"); assert.deepEqual(store.bytes, savedBytes);
  const restored = flow.session;
  assert.notEqual(restored, game); assert.notEqual(restored.state, owner);
  assert.deepEqual(restored.checkpoint(), saved); assert.equal(flow.paused, true);
  assert.equal(commands.menuReady, false);
  assert.equal(commands.menu({ kind: "set-preferences", preferences: { mode: "active", speedIndex: 2 } }), false);
  assert.deepEqual(game.checkpoint(), saved); assert.deepEqual(discarded, []);
  const restoredParty = restored.field.actors[f.actors.party.id]!, restoredNpc = restored.field.actors[f.actors.npc.id]!;
  assert.notEqual(restoredParty, party); assert.notEqual(restoredNpc, npc);
  assert.deepEqual(cell(restoredNpc), { x: 5, y: 7 });
  const oldCheckpoint = game.checkpoint();
  flow.observeHost(host); assert.equal(flow.pause(false), true);
  assert.equal(flow.move("down"), true);
  tickUntil(flow, () => restoredParty.motion !== null && restoredNpc.motion !== null, "post-restore entity targets");
  assert.equal(restoredParty.motion!.route!.direction, "left");
  assert.equal(restoredNpc.motion!.route!.direction, "down");
  assert.deepEqual(restoredParty.motion!.route!.points.at(-1), { x: 6, y: 6 });
  assert.deepEqual(restoredNpc.motion!.route!.points.at(-1), { x: 5, y: 8 });
  tickUntil(flow, () => restored.field.dialogue !== null, "post-restore join");
  assert.deepEqual(cell(restoredParty), { x: 6, y: 6 }); assert.deepEqual(cell(restoredNpc), { x: 5, y: 8 });
  assert.equal(restored.field.eventState.read(f.counters.completed), 1);
  assert.equal(restored.field.eventState.read(f.counters.continued), 1);
  assert.equal(flow.confirm(), true); tickUntil(flow, () => restored.checkpointReady, "post-restore stable field");
  assert.deepEqual(game.checkpoint(), oldCheckpoint, "New input cannot redirect to the retired session owner");
  flow.advance(500, host);
  assert.equal(restored.field.eventState.read(f.counters.completed), 1);
  assert.equal(restored.field.eventState.read(f.counters.continued), 1);
  assert.equal(restored.state.snapshot().completedBattles.length, 0);
  assert.equal(restored.field.actors[restoredParty.id], restoredParty);
  assert.equal(restored.field.actors[restoredNpc.id], restoredNpc);
});
