import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameSession } from "../src/core/game-session.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { Op, Site } from "../src/field/types.js";
import { fieldMoveToSessionFixture, launchFieldMoveToSession } from "./fixtures/field-move-to-session.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const host = { visible: true, mediaReady: true, overlayOpen: false };
const completed = { category: "MapLocalVariable" as const, index: 0 };
const source = { file: "tests/field-actor-control-session.test.ts", assetPath: "authored/actor-control" };
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...body } = structuredClone(value);
  return { ...body, contentHash: await contentDigest(body) } as T;
}

/** Authored mechanism content on the existing synthetic initializer and native
 * factory. All changes are declared before launch; no live actor, story flag,
 * motion, ownership or source content package is patched. */
async function fixture(reference = -1001, skipEntry = false) {
  const f = await fieldMoveToSessionFixture(), map = structuredClone(f.map);
  const emit = (script: string, instructions: Instruction<Op>[]): Op[] =>
    instructions.map((op, index) => ({ ...op, script, index, source }) as Op);
  const decode = (mnemonic: "Show" | "Hide" | "SetPos", integers: number[] = [], animation = ""): Instruction<Op> => {
    const raw = { type: 2, mnemonic, operands: {
      iValues: [...integers, ...Array(8 - integers.length).fill(0)],
      rValues: Array(8).fill(0), sValues: [animation, ...Array(7).fill("")],
    } };
    const op = decodeFieldOp(raw, { script: "actor-control-decoder", index: 0, source }, {});
    if (op.kind === "blocked") throw new Error("Actor control failed to decode: " + op.reason);
    assert.equal(op.kind, mnemonic === "SetPos" ? "position" : "actor-visibility");
    const { script: _, index: __, source: ___, ...instruction } = op;
    return instruction as Instruction<Op>;
  };
  const npc = map.map!.groups!.entity_default!.entities.find(entity => entity.id === f.actors.npc.id)!;
  const points = map.map!.groups!.entity_default!.entities.filter(entity => entity.kind === 0);
  const trigger = (id: string, y: number, script: string) => ({
    id, kind: 2, x: 3, y, width: 1, height: 1, layer: 0, direction: "up" as const,
    asset: null, script, collision: null, destinationLayer: null, source,
  });
  const entities = [...points, npc, trigger("actor-control-trigger", 5, "actor-control"),
    trigger("actor-control-exit", 6, "actor-control-leave")];
  map.map!.groups = { entity_default: { ...map.map!.groups!.entity_default!, entities } };
  map.map!.entities = structuredClone(entities);
  const context = structuredClone(map.scriptPuppetContexts!.reserved!);
  map.scripts["actor-control"] = emit("actor-control", [
    { kind: "puppet", slot: 0, actor: String(f.actors.npc.selector), target: 6 },
    { kind: "exec-puppets", asynchronous: true }, { kind: "finish-puppets" },
    { kind: "calc", left: completed, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "message", key: "AUTHORED_ACTOR_CONTROL", text: "Actor control completed.", speaker: "" },
    { kind: "exit" }, { kind: "nop" },
    decode("Hide"), { kind: "wait", seconds: .03 },
    decode("SetPos", [1, 0, 0, 1, reference]), { kind: "wait", seconds: .04 },
    decode("Show"), { kind: "wait", seconds: .04 },
    decode("Hide"), { kind: "wait", seconds: .03 }, { kind: "exit" },
  ]);
  if (skipEntry) map.scripts["actor-control"] = emit("actor-control", [
    { kind: "puppet", slot: 0, actor: "-1001", target: 8 },
    // The same sleeping slot is immediately reused. A mistakenly allocated
    // player Hide core would make this actual VM entry fail as occupied.
    { kind: "puppet", slot: 0, actor: String(f.actors.npc.selector), target: 11 },
    { kind: "exec-puppets", asynchronous: false }, { kind: "finish-puppets" },
    { kind: "calc", left: completed, operator: "＋", right: { kind: "immediate", value: 1 } },
    { kind: "message", key: "AUTHORED_HIDE_ENTRY", text: "The real NPC slot completed.", speaker: "" },
    { kind: "exit" }, { kind: "nop" }, { kind: "nop" }, decode("Hide"), { kind: "exit" },
    { kind: "nop" }, decode("Show"), { kind: "wait", seconds: .02 }, { kind: "exit" },
  ]);
  map.scriptPuppetContexts!["actor-control"] = { ...context, scriptHash: "7".repeat(64) };
  map.scriptLocals!["actor-control"] = null;
  const target = structuredClone(map), targetId = map.mapId + 1;
  target.mapId = targetId; target.name = "Authored actor retirement destination";
  target.map!.identity!.mapId = targetId; target.map!.entryContext!.mapId = targetId;
  target.partyEntry!.mapId = targetId;
  target.map!.groups = { entity_default: { ...target.map!.groups!.entity_default!, entities: structuredClone(points) } };
  target.map!.entities = structuredClone(points);
  target.scripts = { "actor-control-arrived": emit("actor-control-arrived", [{ kind: "exit" }]) };
  target.scriptLocals = { "actor-control-arrived": null };
  target.scriptPuppetContexts = { "actor-control-arrived": { ...context, scriptHash: "8".repeat(64) } };
  target.initializer = "actor-control-arrived";
  map.scripts["actor-control-leave"] = emit("actor-control-leave", [{ kind: "change-map", request: {
    mapId: targetId, entrance: target.partyEntry!.pointIns[0]!.id, continuation: null, birdview: false,
    skipFade: true, skipBgm: true, origin: "script",
  } }]);
  map.scriptPuppetContexts!["actor-control-leave"] = { ...context, scriptHash: "9".repeat(64) };
  map.scriptLocals!["actor-control-leave"] = null;
  const sealedMap = await seal(map), sealedTarget = await seal(target), world = structuredClone(f.world);
  // The original motion fixture never changes maps. Bind its real initializer
  // transport definitions for this declared map-entry lifecycle as well.
  world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  world.maps[String(sealedMap.mapId)]!.contentHash = sealedMap.contentHash;
  const targetUrl = "/authored/actor-control-target.json";
  world.maps[String(targetId)] = { ...world.maps[String(sealedMap.mapId)]!,
    contentHash: sealedTarget.contentHash, url: targetUrl, name: sealedTarget.name };
  const catalog = await seal(world), content = await seal({ ...f.content,
    worldCatalogHash: catalog.contentHash, mapContentHash: sealedMap.contentHash });
  const dependencies = { catalog, map: sealedMap, source: { content, initialMap: sealedMap } };
  const prepared = { ...f, map: sealedMap, world: catalog, content, dependencies };
  const files = new Map<string, unknown>([["/world/catalog.json", catalog], [targetUrl, sealedTarget]]);
  const repository = new GameContentRepository(async url => {
    if (!files.has(url)) throw new Error("Missing authored actor-control file: " + url);
    return files.get(url);
  });
  return { ...prepared, target: sealedTarget, targetId, repository,
    restore: (checkpoint: Parameters<typeof GameSession.restore>[0]) =>
      GameSession.restore(checkpoint, undefined, f.battle, dependencies) };
}

function tickUntil(flow: GameFlow, ready: () => boolean, label: string, allowStop = false) {
  for (let i = 0; i < 1000; i++) {
    if (!allowStop) assert.equal(flow.session.field.stop, null, flow.session.field.stop?.message ?? label);
    if (ready()) return;
    flow.advance(10, host);
  }
  assert.fail("Timed out: " + label);
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const game = launchFieldMoveToSession(f), flow = new GameFlow();
  const entry = new GameEntryLoader(flow, { discard: (_: null) => {} });
  assert.equal(entry.begin("new-game").commit({ session: game, presentation: null }).status, "committed");
  flow.advance(0, host); tickUntil(flow, () => game.checkpointReady, "native entry");
  return { game, flow, entry };
}
const cell = (actor: { x: number; y: number }) => ({ x: actor.x, y: actor.y });

test("actor hide/relative position/show shares its native owner, persists, and retires only after a committed map", async () => {
  const f = await fixture(), { game, flow, entry } = await start(f), field = game.field;
  const owned = game.state, baselineOwned = owned.snapshot(), actors = field.actors,
    npc = actors[f.actors.npc.id]!, native = npc.native!.entity, player = field.player;
  assert.notEqual(npc, player); assert.deepEqual(cell(npc), { x: 5, y: 5 });
  assert.equal(flow.move("down"), true);
  tickUntil(flow, () => !field.isEntityVisible(npc.id), "native Hide");
  assert.deepEqual(cell(npc), { x: 5, y: 5 }); assert.equal(native.fadeAlpha, 0);
  assert.equal(field.hiddenEntities.has(npc.id), false, "Native visibility has only its entity owner");
  tickUntil(flow, () => npc.x === 4 && npc.y === 5, "relative SetPos");
  assert.equal(field.isEntityVisible(npc.id), false, "Positioning cannot implicitly Show a hidden actor");
  assert.equal(field.actors, actors); assert.equal(field.actors[npc.id], npc); assert.equal(npc.native!.entity, native);
  assert.equal(game.state, owned); assert.deepEqual(owned.snapshot(), baselineOwned);
  tickUntil(flow, () => field.isEntityVisible(npc.id), "native Show");
  assert.equal(native.fadeAlpha, 1); assert.deepEqual(cell(npc), { x: 4, y: 5 });
  tickUntil(flow, () => field.dialogue !== null, "event continuation after actor commands");
  assert.equal(field.isEntityVisible(npc.id), false); assert.equal(field.eventState.read(completed), 1);
  assert.equal(flow.confirm(), true); tickUntil(flow, () => game.checkpointReady, "stable save boundary");
  assert.equal(flow.pause(true), true);
  const commands = new GameCommands(flow, game); assert.equal(commands.menuReady, true);
  const bytes = new Map<string, string>(), store = new CheckpointStorage({
    getItem: key => bytes.get(key) ?? null, setItem: (key, value) => { bytes.set(key, value); },
  }, "source", "authored-actor-control");
  const saved = game.checkpoint(), ticket = flow.beginOperation("save"), preparedSave = await store.prepareSave(saved, 0);
  assert.equal(ticket.isCurrent(), true); preparedSave.commit(); ticket.finish();
  const loaded = await store.load(); assert.ok(loaded);
  assert.equal((await entry.begin("load").prepare(() => ({ session: f.restore(loaded.checkpoint),
    presentation: null, options: { paused: true } }))).status, "committed");
  const restored = flow.session, current = restored.field, restoredNpc = current.actors[npc.id]!;
  assert.notEqual(restored, game); assert.notEqual(restored.state, owned); assert.notEqual(restoredNpc, npc);
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(cell(restoredNpc), { x: 4, y: 5 });
  assert.equal(current.isEntityVisible(npc.id), false); assert.equal(current.hiddenEntities.has(npc.id), false);
  assert.equal(commands.menuReady, false); assert.equal(current.eventState.read(completed), 1);
  flow.observeHost(host); assert.equal(flow.pause(false), true); assert.equal(flow.move("down"), true);
  tickUntil(flow, () => current.stop?.kind === "map-transition", "restored input reaches the map exit", true);
  const request = current.stop, before = restored.state.snapshot(), actorStamp = current.nativeActorStateFingerprint;
  let mediaMode: "fail" | "cancel" | "commit" = "fail";
  let presentationReady!: (field: typeof current) => void, privatePrepared!: (field: typeof current) => void;
  const prepared = new Promise<typeof current>(resolve => { privatePrepared = resolve; });
  const loader = new GameMapLoader(flow, f.repository, { prepare: async next => {
    assert.equal(next.actors[npc.id], undefined, "Destination factory retires map-local NPCs");
    if (mediaMode === "fail") throw new Error("Controlled target media failure");
    if (mediaMode === "cancel") {
      privatePrepared(next);
      return new Promise<typeof current>(resolve => { presentationReady = resolve; });
    }
    return next;
  }, discard: () => {} });
  const failed = await loader.load();
  assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected controlled media failure");
  assert.match(String(failed.error), /Controlled target media failure/);
  assert.equal(restored.field, current); assert.equal(current.stop, request);
  assert.equal(current.actors[npc.id], restoredNpc); assert.equal(current.nativeActorStateFingerprint, actorStamp);
  assert.deepEqual(restored.state.snapshot(), before);
  mediaMode = "cancel";
  const pending = loader.load(), abandoned = await prepared;
  loader.cancel();
  assert.equal(restored.field, current); assert.equal(current.stop, request);
  assert.equal(current.actors[npc.id], restoredNpc); assert.equal(current.isEntityVisible(npc.id), false);
  assert.equal(current.nativeActorStateFingerprint, actorStamp); assert.deepEqual(restored.state.snapshot(), before);
  presentationReady(abandoned); assert.equal((await pending).status, "cancelled");
  assert.equal(restored.field, current); assert.equal(current.actors[npc.id], restoredNpc);
  mediaMode = "commit";
  const committed = await loader.load();
  assert.equal(committed.status, "committed", committed.status === "failed" ? String(committed.error) : undefined);
  assert.equal(restored.field.content.map.identity!.mapId, f.targetId);
  assert.equal(restored.field.actors[npc.id], undefined); assert.equal(current.actors[npc.id], restoredNpc);
  tickUntil(flow, () => restored.checkpointReady, "destination stays playable");
  assert.equal(restored.field.player.native !== undefined, true);
  assert.deepEqual(game.checkpoint(), saved, "New owners cannot resume or change the retired session");
});

test("a missing relative reference blocks without changing position, visibility history or the shared owner", async () => {
  const f = await fixture(999), { game, flow } = await start(f), field = game.field;
  const owned = game.state, before = owned.snapshot(), npc = field.actors[f.actors.npc.id]!, entity = npc.native!.entity;
  assert.equal(flow.move("down"), true);
  tickUntil(flow, () => !field.isEntityVisible(npc.id), "completed Hide before the invalid reference");
  const position = { ...entity.position }, layer = entity.layer, hidden = [...field.hiddenEntities];
  tickUntil(flow, () => field.stop?.kind === "unsupported", "missing source reference", true);
  assert.match(field.stop!.message, /relative SetPos reference entity is unavailable/);
  assert.equal(game.field, field); assert.equal(game.state, owned); assert.equal(field.actors[npc.id], npc);
  assert.equal(npc.native!.entity, entity); assert.deepEqual(entity.position, position); assert.equal(entity.layer, layer);
  assert.equal(entity.visible, false); assert.equal(entity.fadeAlpha, 0); assert.deepEqual([...field.hiddenEntities], hidden);
  assert.deepEqual(owned.snapshot(), before); assert.equal(field.eventState.read(completed), 0);
  assert.equal(game.checkpointReady, false);
});

test("decoded immediate player Hide skips allocation before a real NPC reuses the same global puppet slot", async () => {
  const f = await fixture(-1001, true), { game, flow } = await start(f), field = game.field;
  const owned = game.state, before = owned.snapshot(), nextTask = game.checkpoint().world.field.nextTask,
    player = field.player, puppet = field.actors[f.actors.party.id]!, npc = field.actors[f.actors.npc.id]!;
  assert.equal(field.content.scriptPuppetContexts!["actor-control"]!.characteristics, true);
  assert.equal(field.content.scriptPuppetContexts!["actor-control"]!.keepPlayerPuppet, false);
  assert.equal(field.content.scripts["actor-control"]![9]!.kind, "actor-visibility");
  assert.equal(flow.move("down"), true);
  tickUntil(flow, () => !field.isEntityVisible(player.id), "Hide optimization targets the actual player");
  assert.equal(field.isEntityVisible(puppet.id), false, "The skipped core never readies or Shows a party puppet");
  tickUntil(flow, () => field.dialogue !== null, "same-slot NPC finishes without an occupied-track error");
  assert.equal(field.stop, null); assert.equal(field.eventState.read(completed), 1);
  assert.equal(field.actors[npc.id], npc); assert.equal(field.actors[player.id], player);
  assert.equal(field.isEntityVisible(npc.id), true);
  assert.equal(flow.confirm(), true); tickUntil(flow, () => game.checkpointReady, "stable completion after skipEntry");
  assert.equal(game.checkpoint().world.field.nextTask, nextTask + 2,
    "Only the actual main and NPC cores allocate task identities");
  assert.equal(game.state, owned); assert.deepEqual(owned.snapshot(), before);
});
