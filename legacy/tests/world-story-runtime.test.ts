import assert from "node:assert/strict";
import test from "node:test";
import { GameSession } from "../src/core/game-session.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { hash, canonical } from "../src/compiler/content.js";
import { compileFieldTimerInstruction } from "../src/compiler/field-timer.js";
import { WEB_FIELD_STORY_RUNTIME } from "../src/core/field-story-runtime.js";
import type { Op, Site } from "../src/field/types.js";
import type { GameContentRefs } from "../src/core/game-content-refs.js";
import type { WorldMapContent } from "../src/field/world.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const sourceSet = hash("synthetic world story source"), corpus = hash("synthetic world story corpus"), media = hash("synthetic world media");
type Body<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
const source = (name: string) => ({ file: "synthetic-world-story.bundle", assetPath: `synthetic/${name}.json`,
  sha256: sourceSet, objectId: "9007199254740993" });
function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _old, ...body } = value; return { ...body, contentHash: hash(body) } as T;
}
function fixture(battleClock = true) {
  const f = checkpointFixture(), content = structuredClone(f.field), battle = structuredClone(f.battle);
  const profile = { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: hash("original synthetic maps"), omissions: [], storyRuntime: WEB_FIELD_STORY_RUNTIME };
  const bind = (name: string, values: Body[], scope = name): Op[] => values.map((value, index) =>
    ({ ...value, script: name, index, source: source(scope) } as Op));
  const start = compileFieldTimerInstruction({ type: 1, mnemonic: "SetTimer", operands: {
    iValues: [0, battleClock ? 0 : 1, 0, 1, 0, 0, 0, 0], rValues: [5, 0, 0, 0, 0, 0, 0, 0],
    sValues: ["timeout", "", "", "", "", "", "", ""] } });
  content.parentSourceSetHash = sourceSet; content.sourceSetHash = hash("synthetic initial field source");
  content.developmentProfile = structuredClone(profile);
  content.entry.initialEventValues = [{ ref: { category: "ScenarioVariable", index: 7 }, value: 0 }];
  content.scripts["start-timer"] = bind("start-timer", [start, { kind: "exit" }]);
  content.scripts.timeout = bind("timeout", [{ kind: "calc", left: { category: "ScenarioVariable", index: 7 }, operator: "＋",
    right: { kind: "immediate", value: 1 } }, { kind: "exit" }], "Resident/timeout");
  content.scriptLocals = { ...content.scriptLocals, "start-timer": null, timeout: null };
  const initial = seal(content);
  battle.common.fieldSourceSetHash = initial.sourceSetHash;
  const sealedBattle = seal(battle), target = structuredClone(f.target);
  target.parentSourceSetHash = sourceSet; target.sourceSetHash = corpus; target.mediaSourceSetHash = media;
  target.developmentProfile = structuredClone(profile);
  target.scripts = { ...structuredClone(initial.scripts), init: bind("init", [{ kind: "flag",
    ref: { category: "ScenarioFlag1", index: 8 }, operation: "set" }, { kind: "exit" }]) };
  target.scriptLocals = { ...initial.scriptLocals, init: null };
  const second = seal(target), thirdDraft = structuredClone(second);
  thirdDraft.mapId = 3; thirdDraft.map!.identity!.mapId = 3; thirdDraft.name = "Third synthetic map";
  const third = seal(thirdDraft), world = structuredClone(f.world);
  world.sourceSetHash = corpus; world.parentSourceSetHash = sourceSet; world.mediaSourceSetHash = media;
  world.developmentProfile = structuredClone(profile);
  world.maps = Object.fromEntries([second, third].map(map => [map.mapId, { url: `/world/story/${map.mapId}.json`,
    contentHash: map.contentHash, name: map.name, areaId: map.areaId, geometryReady: true, defaultGroupReady: true, blockers: [] }]));
  const catalog = seal(world), game = new GameSession(initial, sealedBattle, 314);
  const refs: GameContentRefs = { kind: "game-content-refs-v1", profile: "framework",
    world: { url: "/world/story/catalog.json", contentHash: catalog.contentHash }, source: null,
    development: { entry: { url: "/world/story/initial.json", contentHash: initial.contentHash },
      battle: { url: "/world/story/battle.json", contentHash: sealedBattle.contentHash } } };
  const files = new Map<string, unknown>([[refs.world.url, catalog], [refs.development!.entry.url, initial],
    [refs.development!.battle.url, sealedBattle], [catalog.maps[2]!.url, second], [catalog.maps[3]!.url, third]]);
  const reads: string[] = [];
  const repository = () => new GameContentRepository(async url => { reads.push(url);
    if (!files.has(url)) throw new Error("Missing synthetic map " + url); return files.get(url); }, "framework", refs);
  const enter = (map: WorldMapContent) => {
    game.field.previewMap(map.mapId, 1);
    const candidate = game.world.prepare(catalog, map); assert.equal(game.world.commit(candidate), true); game.advance(10);
  };
  return { initial, battle: sealedBattle, second, third, catalog, game, files, reads, repository, enter };
}
const counter = (game: GameSession) => game.field.eventState.read({ category: "ScenarioVariable", index: 7 });

test("map cancellation and both changed story owners fence the candidate before publication", () => {
  const f = fixture(); f.game.field.startEvent("start-timer");
  const previous = f.game.field, before = canonical(previous.storyRuntimeSnapshot);
  previous.previewMap(2, 1);
  const cancelled = f.game.world.prepare(f.catalog, f.second);
  assert.deepEqual(cancelled.field.storyRuntimeSnapshot, previous.storyRuntimeSnapshot);
  f.game.world.discard(cancelled); assert.equal(f.game.world.commit(cancelled), false);
  assert.equal(f.game.field, previous); assert.equal(canonical(previous.storyRuntimeSnapshot), before);
  const changedCandidate = f.game.world.prepare(f.catalog, f.second);
  changedCandidate.field.advanceStoryTimer(10, "battle");
  assert.equal(f.game.world.commit(changedCandidate), false); assert.equal(f.game.field, previous);
  const changedCurrent = f.game.world.prepare(f.catalog, f.second);
  previous.advanceStoryTimer(10, "battle");
  assert.equal(f.game.world.commit(changedCurrent), false); assert.equal(f.game.field, previous);
  const accepted = f.game.world.prepare(f.catalog, f.second);
  assert.equal(f.game.world.commit(accepted), true);
  assert.equal(f.game.field.storyRuntimeSnapshot!.timer.active!.binding.mapContentHash, f.initial.contentHash);
});

test("a timer from the independently pinned initial wrapper survives cross-map save/load without callback replay", async () => {
  const f = fixture(); f.game.field.startEvent("start-timer"); f.enter(f.second);
  const checkpoint = f.game.checkpoint(), before = canonical(checkpoint);
  const packages = await f.repository().restoreSessionContent(checkpoint);
  assert.equal(packages.world!.timerOrigin!.mapContentHash, f.initial.contentHash);
  assert.deepEqual(packages.world!.timerOrigin!.scripts, f.initial.scripts);
  const restored = GameSession.restore(checkpoint, packages.initial, packages.battle, packages.world);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.field.storyRuntimeSnapshot!.timer.active!.binding.mapId, 1);
  for (let i = 0; i < 600 && counter(restored) === 0; i++) restored.advance(10);
  assert.equal(counter(restored), 1); restored.advance(1000); assert.equal(counter(restored), 1);
  assert.equal(canonical(f.game.checkpoint()), before, "The old field/session owner remains unchanged");
});

test("indexed origin map is fetched through the same trusted catalog and missing or changed origin cannot restore", async () => {
  const f = fixture(); f.enter(f.second); f.game.field.startEvent("start-timer"); f.enter(f.third);
  const checkpoint = f.game.checkpoint(), before = canonical(checkpoint);
  f.reads.length = 0;
  const loaded = await f.repository().restoreSessionContent(checkpoint);
  assert.ok(f.reads.includes(f.catalog.maps[2]!.url), "The old source map is a real restore dependency");
  assert.ok(f.reads.includes(f.catalog.maps[3]!.url));
  assert.equal(loaded.world!.timerOrigin!.mapContentHash, f.second.contentHash);
  const restored = GameSession.restore(checkpoint, loaded.initial, loaded.battle, loaded.world);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  for (let i = 0; i < 600 && counter(restored) === 0; i++) restored.advance(10);
  assert.equal(counter(restored), 1); restored.advance(1000); assert.equal(counter(restored), 1);
  const originURL = f.catalog.maps[2]!.url, origin = f.files.get(originURL)!;
  f.files.delete(originURL); await assert.rejects(() => f.repository().restoreSessionContent(checkpoint), /Missing synthetic map/);
  const altered = structuredClone(origin) as WorldMapContent; altered.scripts.timeout![0]!.source.objectId = "9007199254740999";
  f.files.set(originURL, altered); await assert.rejects(() => f.repository().restoreSessionContent(checkpoint), /hash|identity|payload changed/i);
  f.files.set(originURL, origin);
  const forged = structuredClone(checkpoint);
  if (!("storyRuntime" in forged.world.field)) throw new Error("Expected declared story checkpoint");
  forged.world.field.storyRuntime.timer.active!.binding.callback.source.objectId = "9007199254740999";
  const trusted = await f.repository().restoreSessionContent(forged);
  assert.throws(() => GameSession.restore(forged, trusted.initial, trusted.battle, trusted.world), /binding|mismatch/i);
  assert.equal(canonical(f.game.checkpoint()), before);
});

test("a destination without the story policy cannot silently discard the active source timer", () => {
  const f = fixture(); f.game.field.startEvent("start-timer");
  const before = canonical(f.game.field.storyRuntimeSnapshot), old = f.game.field;
  const target = structuredClone(f.second); delete target.developmentProfile!.storyRuntime;
  const changed = seal(target), catalog = structuredClone(f.catalog);
  catalog.maps[2]!.contentHash = changed.contentHash;
  const currentCatalog = seal(catalog); old.previewMap(2, 1);
  assert.throws(() => f.game.world.prepare(currentCatalog, changed), /profile|policy/i);
  assert.equal(f.game.field, old); assert.equal(canonical(old.storyRuntimeSnapshot), before);
});

test("an actual battle clocks the same field timer according to its independently preserved source selector", () => {
  for (const battleClock of [true, false]) {
    const f = fixture(battleClock); f.game.field.startEvent("start-timer");
    const owner = f.game.field;
    f.game.field.startEvent("fight"); f.game.advance(10);
    assert.ok(f.game.battle, "The test enters the real existing battle lifecycle");
    const before = owner.storyRuntimeSnapshot!.timer.active!.elapsedMs;
    f.game.advance(1000);
    assert.equal(f.game.field, owner);
    assert.equal(owner.storyRuntimeSnapshot!.timer.active!.elapsedMs - before, battleClock ? 1000 : 0);
    assert.equal(counter(f.game), 0, "A battle clock cannot publish a field callback while its field is suspended");
  }
});
