import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { sourceEncounterSessionFixture } from "./fixtures/source-encounter-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { WEB_PUPPET_ROUTE_POLICY } from "../src/core/field-puppet-route.js";
import type { FieldPuppetRouteCommand } from "../src/core/field-puppet-route.js";
import type { Op, Site } from "../src/field/types.js";
import { fieldMoveToSessionFixture } from "./fixtures/field-move-to-session.js";
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "controlled-puppet-route", assetPath: "authored/route-lifecycle", objectId: "9223372036854775807" };
const host = { visible: true, mediaReady: true, overlayOpen: false };
const counter = { category: "MapLocalVariable" as const, index: 1 };
async function seal<T extends { contentHash: string }>(x: T): Promise<T> {
  const { contentHash: _, ...payload } = structuredClone(x); return { ...payload, contentHash: await contentDigest(payload) } as T;
}
async function fixture(commands: FieldPuppetRouteCommand[] = [{ x: 7, y: 7, layer: 0, speedId: 2, animation: "" }], policy = true, options: { wall?: number; target?: boolean; battle?: boolean; camera?: boolean } = {}) {
  const original = await fieldMoveToSessionFixture(), f = options.battle ? { ...original, ...sourceEncounterSessionFixture() } : original,
    map = structuredClone(f.map), script = "route-root";
  if (options.battle) {
    const npc = original.map.map!.groups!.entity_default!.entities.find(e => e.id === "601")!;
    const group = map.map!.groups!.entity_default!.entities;
    if (!group.some(e => e.id === "601")) group.push(structuredClone(npc));
    if (map.map!.entities !== group && !map.map!.entities.some(e => e.id === "601")) map.map!.entities.push(structuredClone(npc));
  }
  if (options.wall !== undefined) map.map!.collisions[0]![5 * map.map!.width + 7] = options.wall;
  const points = map.map!.groups!.entity_default!.entities.filter(e => e.kind === 0 || e.id === "601");
  const trigger = { id: "route-contact", kind: 2, x: 3, y: 5, width: 1, height: 1, layer: 0,
    direction: "up" as const, asset: null, script, collision: null, destinationLayer: null, source };
  map.map!.groups!.entity_default!.entities = [...points, trigger]; map.map!.entities = structuredClone([...points, trigger]);
  const emit = (ops: Instruction<Op>[]) => ops.map((op, index) => ({ ...op, script, index, source }) as Op);
  const routes = commands.map(command => {
    const raw = { type: 2, mnemonic: "Route", operands: { iValues: [command.x, command.y, command.layer, command.speedId ?? -1, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: [command.animation, ...Array(7).fill("")] } };
    const decoded = decodeFieldOp(raw, { script, index: 99, source }, {});
    assert.equal(decoded.kind, "field-puppet-route"); return decoded;
  });
  map.scripts[script] = emit([{ kind: "puppet", slot: 0, actor: options.camera ? "0" : "601", target: 6 },
    { kind: "exec-puppets", asynchronous: true }, { kind: "finish-puppets" },
    { kind: "calc", left: counter, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "message", key: "CONTROLLED_ROUTE_DONE", text: "Route drained exactly once.", speaker: "" },
    { kind: "exit" }, { kind: "nop" }, ...routes, { kind: "exit" }]);
  // Exact source Site is evidence, and is deliberately different from Web PC.
  routes.forEach((op, i) => { map.scripts[script]![7 + i] = { ...op, script: "physical-source-alias" }; });
  map.scriptPuppetContexts![script] = { ...map.scriptPuppetContexts!.reserved!, scriptHash: "8".repeat(64) };
  map.scriptLocals[script] = null;
  const world = structuredClone(f.world); let target: typeof map | undefined;
  if (options.target) {
    target = structuredClone(map); const targetId = map.mapId + 1;
    target.mapId = targetId; target.map!.identity!.mapId = targetId; target.map!.entryContext!.mapId = targetId; target.partyEntry!.mapId = targetId;
    target.map!.groups!.entity_default!.entities = target.map!.groups!.entity_default!.entities.filter(e => e.kind === 0 || e.id === "601");
    target.map!.entities = structuredClone(target.map!.groups!.entity_default!.entities);
    target.scripts.arrived = [{ script: "arrived", index: 0, source, kind: "exit" }]; target.scriptLocals.arrived = null;
    target.scriptPuppetContexts!.arrived = { ...target.scriptPuppetContexts!.reserved!, scriptHash: "7".repeat(64) }; target.initializer = "arrived";
    target = await seal(target); world.maps[String(targetId)] = { ...world.maps[String(map.mapId)]!, contentHash: target.contentHash, url: "/route-target.json", name: target.name };
    world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
    map.scripts.leave = [{ script: "leave", index: 0, source, kind: "change-map", request: { mapId: targetId,
      entrance: target.partyEntry!.pointIns[0]!.id, continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script" } }];
    map.scriptLocals.leave = null; map.scriptPuppetContexts!.leave = { ...map.scriptPuppetContexts!.reserved!, scriptHash: "6".repeat(64) };
  }
  const sealedMap = await seal(map); world.maps[String(map.mapId)]!.contentHash = sealedMap.contentHash;
  const catalog = await seal(world), content = await seal({ ...f.content, mapContentHash: sealedMap.contentHash, worldCatalogHash: catalog.contentHash });
  const runtime = { ...(policy ? { puppetRoutes: WEB_PUPPET_ROUTE_POLICY } : {}), ...(options.battle ? { battleHandoff: "prepared" as const } : {}) };
  const sequence = new NewGameFieldEntry(content.entry, f.presentation), start = sequence.prepareStart(f.fade, { active: true, callbacks: "absent" });
  start.commit(); let fade = start.fade; fade.advance(.5);
  for (let i = 0; i < 3; i++) { const next = sequence.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
  const game = GameSession.prepareNewGame(content, catalog, sealedMap, f.battle, fade, f.presentation, runtime);
  const launch = sequence.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
  const flow = new GameFlow(); new GameEntryLoader(flow, { discard: () => {} }).begin("new-game").commit({ session: game, presentation: null });
  const restore = (saved: ReturnType<GameSession["checkpoint"]>) => GameSession.restore(saved, undefined, f.battle,
    { catalog, map: sealedMap, source: { content, initialMap: sealedMap } }, runtime);
  const repository = new GameContentRepository(async url => {
    if (url === "/world/catalog.json") return catalog; if (url === "/route-target.json" && target) return target; throw new Error("Undeclared controlled Route dependency " + url);
  });
  return { game, flow, map: sealedMap, world: catalog, content, restore, script, target, repository, battle: f.battle };
}
function until(f: Awaited<ReturnType<typeof fixture>>, done: () => boolean, max = 2000): void {
  for (let i = 0; i < max; i++) { assert.equal(f.game.field.stop, null, f.game.field.stop?.message); if (done()) return; f.flow.advance(10, host); }
  assert.fail("Puppet Route logical clock budget");
}
const cell = (a: { x: number; y: number }) => ({ x: a.x, y: a.y });
test("real Session contact starts a bent path on the same native actor, pauses, joins once and legally saves/restores", async () => {
  const f = await fixture(); until(f, () => f.game.checkpointReady);
  const field = f.game.field, actor = field.actors["601"]!, entity = actor.native!.entity, owner = f.game.state, owned = owner.snapshot();
  assert.equal(f.flow.move("down"), true); until(f, () => actor.motion !== null);
  assert.equal(actor.motion!.route!.search, WEB_PUPPET_ROUTE_POLICY);
  assert.deepEqual(actor.motion!.route!.points.at(-1), { x: 7, y: 7 });
  const moving = { time: field.time, motion: structuredClone(actor.motion), animation: actor.animation!.snapshot() };
  assert.equal(f.flow.pause(true), true); f.flow.advance(1000, host);
  assert.deepEqual({ time: field.time, motion: actor.motion, animation: actor.animation!.snapshot() }, moving);
  assert.equal(f.game.checkpointReady, false); assert.throws(() => f.game.checkpoint()); assert.equal(f.flow.pause(false), true);
  until(f, () => actor.motion?.route?.direction === "down"); assert.equal(actor.direction, "down");
  until(f, () => field.dialogue !== null); assert.equal(actor.motion, null); assert.deepEqual(cell(actor), { x: 7, y: 7 });
  assert.equal(actor.native!.entity, entity); assert.equal(f.game.state, owner); assert.deepEqual(owner.snapshot(), owned);
  assert.equal(field.eventState.read(counter), 1);
  assert.deepEqual(field.puppetRouteExecutions.map(row => row.phase), ["started", "task-completed"]);
  assert.equal(f.flow.confirm(), true); until(f, () => f.game.checkpointReady);
  const saved = f.game.checkpoint(), values = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } }, "source", "controlled-puppet-route");
  (await storage.prepareSave(saved, 0)).commit(); const loaded = await storage.load(); assert.ok(loaded);
  const restored = f.restore(loaded.checkpoint); assert.deepEqual(restored.checkpoint(), saved); restored.advance(1000);
  assert.deepEqual(restored.field.puppetRouteExecutions, []); assert.equal(restored.field.eventState.read(counter), 1); assert.deepEqual(cell(restored.field.actors["601"]!), { x: 7, y: 7 });
  assert.deepEqual(f.game.checkpoint(), saved, "Restored input has no access to the retired actor owner");
});
test("same-cell Route skips before animation and following Route owns exactly one subsequent path", async () => {
  const f = await fixture([{ x: 5, y: 5, layer: 0, speedId: null, animation: "UnknownButNotStarted" }, { x: 6, y: 5, layer: 0, speedId: 0, animation: "" }]);
  until(f, () => f.game.checkpointReady); f.flow.move("down"); until(f, () => f.game.field.dialogue !== null);
  const a = f.game.field.actors["601"]!; assert.deepEqual(cell(a), { x: 6, y: 5 }); assert.equal(a.steps, 1); assert.equal(f.game.field.eventState.read(counter), 1);
});
test("missing policy and unknown animation fail without publishing movement or silently continuing", async () => {
  for (const [policy, animation, reason] of [[false, "", /explicit Web (grid|pathfinding) policy/], [true, "UnboundRouteAnimation", /Missing actor animation/]] as const) {
    const f = await fixture([{ x: 7, y: 7, layer: 0, speedId: 0, animation }], policy); until(f, () => f.game.checkpointReady);
    const a = f.game.field.actors["601"]!, before = { cell: cell(a), animation: a.animation!.snapshot(), entity: a.native!.entity };
    f.flow.move("down"); for (let i = 0; i < 100 && !f.game.field.stop; i++) f.flow.advance(10, host);
    assert.match(f.game.field.stop!.message, reason); assert.deepEqual(cell(a), before.cell); assert.equal(a.motion, null);
    assert.deepEqual(a.animation!.snapshot(), before.animation); assert.equal(a.native!.entity, before.entity); assert.equal(f.game.field.eventState.read(counter), 0);
  }
});

test("a known later obstruction retains the settled waypoint and unknown collision publishes no next segment", async () => {
  for (const wall of [1, 99]) {
    const f = await fixture(undefined, true, { wall }); until(f, () => f.game.checkpointReady); f.flow.move("down");
    const field = f.game.field, actor = field.actors["601"]!; until(f, () => actor.motion !== null);
    // This explicitly controlled host toggles the existing three-switch source
    // port after Exec; no actor, geometry, route cursor or story flag is edited.
    field.options.puppetActors!.prepareCollision(true)();
    until(f, () => actor.motion?.route?.pendingSegment === true);
    const state = { cell: cell(actor), motion: structuredClone(actor.motion), animation: actor.animation!.snapshot() };
    f.flow.advance(50, host);
    assert.deepEqual({ cell: cell(actor), motion: actor.motion, animation: actor.animation!.snapshot() }, state);
    assert.equal(field.eventState.read(counter), 0);
    if (wall === 99) { assert.match(field.stop!.message, /collision value/); assert.equal(field.stop!.site?.script, "physical-source-alias"); assert.equal(field.stop!.site?.index, 99); }
    else { assert.equal(field.stop, null); field.options.puppetActors!.prepareCollision(false)(); until(f, () => field.dialogue !== null); assert.deepEqual(cell(actor), { x: 7, y: 7 }); }
  }
});
test("completed Route map media failure/cancel/retry keeps old owners and passes the explicit policy to the new field", async () => {
  const f = await fixture(undefined, true, { target: true }); until(f, () => f.game.checkpointReady); f.flow.move("down");
  until(f, () => f.game.field.dialogue !== null); f.flow.confirm(); until(f, () => f.game.checkpointReady);
  const field = f.game.field, actor = field.actors["601"]!, entity = actor.native!.entity; assert.equal(field.startEvent("leave"), true);
  assert.equal(field.stop?.kind, "map-transition"); const state = { time: field.time, cell: cell(actor), animation: actor.animation!.snapshot() };
  let mode = "fail", release!: (value: null) => void, entered!: () => void; const hold = new Promise<void>(r => entered = r);
  const loader = new GameMapLoader(f.flow, f.repository, { prepare: async () => {
    if (mode === "fail") throw new Error("Route map media failure"); if (mode === "hold") { entered(); return new Promise<null>(r => release = r); } return null;
  }, discard() {} });
  assert.equal((await loader.load()).status, "failed"); assert.equal(f.game.field, field);
  mode = "hold"; const pending = loader.load(); await Promise.race([hold, pending.then(r => assert.fail("No media hold " + JSON.stringify(r)))]);
  f.flow.advance(5000, host); loader.cancel(); release(null); assert.equal((await pending).status, "cancelled");
  assert.deepEqual({ time: field.time, cell: cell(actor), animation: actor.animation!.snapshot() }, state);
  mode = "ok"; assert.equal((await loader.load()).status, "committed"); until(f, () => f.game.checkpointReady);
  assert.notEqual(f.game.field, field); assert.equal(f.game.field.puppetRoutePolicy, WEB_PUPPET_ROUTE_POLICY);
  assert.notEqual(f.game.field.actors["601"]!.native!.entity, entity); assert.equal(actor.native!.entity, entity);
});
test("the same Session completes Route, survives prepared battle failure/cancel and returns without replaying actor movement", async () => {
  const f = await fixture(undefined, true, { battle: true }); until(f, () => f.game.checkpointReady); f.flow.move("down");
  until(f, () => f.game.field.dialogue !== null); f.flow.confirm(); until(f, () => f.game.checkpointReady);
  const field = f.game.field, actor = field.actors["601"]!, entity = actor.native!.entity, steps = actor.steps;
  assert.equal(field.startEvent("legacy-fight"), true); assert.equal(field.stop?.kind, "encounter");
  const before = { time: field.time, cell: cell(actor), motion: actor.motion, steps };
  let mode = "fail", release!: (value: null) => void;
  const handoff = new GameBattleHandoff(f.flow, { prepareStart: async () => {
    if (mode === "fail") throw new Error("Route battle media failure"); if (mode === "hold") return new Promise<null>(r => release = r); return null;
  }, prepareReturn: async () => null, discard() {} });
  assert.equal((await handoff.start()).status, "failed"); mode = "hold"; const pending = handoff.start(); await new Promise<void>(r => setImmediate(r));
  f.flow.advance(5000, host); handoff.cancel(); release(null); assert.equal((await pending).status, "cancelled");
  mode = "ok"; assert.equal((await handoff.start()).status, "committed"); const battle = f.game.battle!, commands = new GameCommands(f.flow, f.game);
  for (let i = 0; i < 3000 && battle.phase === "active"; i++) { for (const player of battle.ready) { const enemy = battle.enemies.find(e => e.hp > 0); if (enemy) commands.command(battle, player.id, 10, { kind: "single", id: enemy.id }, 100); } f.flow.advance(20, host); }
  assert.equal(battle.phase, "victory"); assert.deepEqual({ time: field.time, cell: cell(actor), motion: actor.motion, steps: actor.steps }, before);
  assert.equal((await handoff.return()).status, "committed"); until(f, () => f.game.checkpointReady);
  assert.equal(field.actors["601"], actor); assert.equal(actor.native!.entity, entity); assert.equal(actor.steps, steps);
  assert.deepEqual(f.restore(f.game.checkpoint()).checkpoint(), f.game.checkpoint());
});

test("camera source Route executes on the existing dummy through a real puppet task, honors Flow and restores without a second actor", async () => {
  const f = await fixture(undefined, true, { camera: true }); until(f, () => f.game.checkpointReady);
  const field = f.game.field, actors = field.actors, player = field.player, npc = field.actors["601"]!;
  f.flow.move("down"); until(f, () => field.puppetRouteExecutions.length > 0);
  assert.equal(field.puppetRouteExecutions[0]!.actorId, field.cameraActorId); assert.equal(field.actors[field.cameraActorId], undefined);
  assert.equal(npc.motion, null); assert.equal(field.actors, actors); assert.equal(field.player, player);
  const before = { camera: field.cameraSnapshot, time: field.time }; f.flow.pause(true); f.flow.advance(1000, host);
  assert.deepEqual({ camera: field.cameraSnapshot, time: field.time }, before); f.flow.pause(false);
  assert.equal(f.game.checkpointReady, false); assert.throws(() => f.game.checkpoint());
  until(f, () => field.dialogue !== null); assert.deepEqual(field.puppetRouteExecutions.map(r => r.phase), ["started", "task-completed"]);
  const range = f.map.cameraHost!.mapRange, p = field.cameraSnapshot!.dummy.position;
  assert.equal(p.x, (7 - range.width / 2 + .5) * 16); assert.equal(p.y, (range.height / 2 - 7 - .5) * 16);
  assert.equal(field.cameraSnapshot!.dummy.direction, "down"); assert.equal(npc.steps, 0);
  f.flow.confirm(); until(f, () => f.game.checkpointReady); const saved = f.game.checkpoint(), restored = f.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(restored.field.puppetRouteExecutions, []); restored.advance(1000);
  assert.deepEqual(restored.field.cameraSnapshot, field.cameraSnapshot);
});
test("caller mutation or a saved checkpoint cannot grant the explicit Route runtime policy", async () => {
  const absent = await fixture(undefined, false); until(absent, () => absent.game.checkpointReady);
  Object.assign(absent.game.field.options, { puppetRoutes: WEB_PUPPET_ROUTE_POLICY });
  absent.flow.move("down"); for (let i = 0; i < 50 && !absent.game.field.stop; i++) absent.flow.advance(10, host);
  assert.equal(absent.game.field.puppetRoutePolicy, undefined); assert.match(absent.game.field.stop!.message, /explicit Web/);
  const f = await fixture(); until(f, () => f.game.checkpointReady); const saved = f.game.checkpoint();
  const restored = GameSession.restore(saved, undefined, f.battle, { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  const flow = new GameFlow(restored); flow.start(); flow.observeHost(host); flow.move("down"); for (let i = 0; i < 50 && !restored.field.stop; i++) flow.advance(10, host);
  assert.equal(restored.field.puppetRoutePolicy, undefined); assert.match(restored.field.stop!.message, /explicit Web/); assert.equal(restored.field.actors["601"]!.motion, null);
});
