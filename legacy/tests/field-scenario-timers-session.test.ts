import test from "node:test";
import assert from "node:assert/strict";
import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { GameSession, type GameCheckpoint } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameCommands } from "../src/core/game-commands.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { WEB_FIELD_STORY_RUNTIME } from "../src/core/field-story-runtime.js";
import { WEB_SOURCE_FIELD_UI } from "../src/core/field-ui.js";
import { compileFieldTimerInstruction } from "../src/compiler/field-timer.js";
import { fieldTimerRemainingSeconds, type FieldScenarioTimerCommand } from "../src/core/field-timer.js";
import { fieldCameraWorldToCell } from "../src/core/field-camera.js";
import { canonical } from "../src/core/canonical.js";
import type { Op, Site } from "../src/field/types.js";
import type { GameContentRefs } from "../src/core/game-content-refs.js";
type Body<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
const host = {visible: true, mediaReady: true, overlayOpen: false};
const variable = (index: number) => ({category: "ScenarioVariable" as const, index});
const scenario = (command: FieldScenarioTimerCommand): Body => ({kind: "field-scenario-timer", command});
const set = (index: number, value: number): Body => ({kind: "calc", left: variable(index), operator: "←", right: {kind: "immediate", value}});
const timer = (seconds: number) => compileFieldTimerInstruction({type: 1, mnemonic: "SetTimer", operands: {
  iValues: [0,0,0,1,0,0,0,0], rValues: [seconds,0,0,0,0,0,0,0], sValues: ["timer-timeout", "", "", "", "", "", "", ""]}});
async function fixture() {
  const f = await worldLoopSessionFixture(), maps = [structuredClone(f.map), structuredClone(f.worldMap)],
    callbackSource = {file: "synthetic-timer-Resident.bundle", assetPath: "Resident/sc_secede_shadow.json", objectId: "9007199254741009"};
  const parent = "a".repeat(64), sourceMap = sealBatchContent({...structuredClone(f.sourceMap),parentSourceSetHash: parent}),
    sourceEntry = sealBatchContent({...structuredClone(f.sourceEntry),parentSourceSetHash: parent,mapContentHash: sourceMap.contentHash});
  for (const map of maps) {
    map.parentSourceSetHash = parent;
    map.developmentProfile!.storyRuntime = WEB_FIELD_STORY_RUNTIME; delete map.walkEncounters;
    const range = map.cameraHost!.mapRange, template = structuredClone(Object.values(map.scriptPuppetContexts!)[0]!);
    const programs: Record<string, Body[]> = {
      "cid-start": [set(2,40), scenario("cid-resume"), {kind: "exit"}],
      "cid-short": [set(2,6), scenario("cid-resume"), {kind: "exit"}],
      "cid-check-start": [set(2,60), scenario("cid-check"), {kind: "exit"}],
      "cid-read": [scenario("cid-hp"), {kind: "exit"}], "cid-suspend": [scenario("cid-suspend"), {kind: "exit"}],
      "cid-resume": [scenario("cid-resume"), {kind: "exit"}],
      "global-long": [timer(40), {kind: "exit"}], "global-short": [timer(5.05), {kind: "exit"}],
      "global-stop": [{kind: "field-timer", command: {kind: "finish"}}, {kind: "exit"}],
      "shadow-start": [scenario("shadow-setup"), {kind: "exit"}], "shadow-reset": [scenario("shadow-reset"), {kind: "exit"}],
      "shadow-reset-setup": [scenario("shadow-reset"), scenario("shadow-setup"), {kind: "exit"}],
      "shadow-pose": [{kind: "position", x: 112 + range.x, y: 23 + range.y, animation: "",
        nativeCommand: {x: 112 + range.x, y: 23 + range.y, layer: 0, animation: ""}}, {kind: "flag", ref: {category: "ScenarioFlag1", index: 40}, operation: "set"}, {kind: "exit"}],
      "shadow-miss": [{kind: "flag", ref: {category: "ScenarioFlag1", index: 40}, operation: "reset"}, {kind: "exit"}],
      "timer-ui": [{kind: "source-field-ui", command: {kind: "timer-only"}}, {kind: "exit"}],
      "sc_secede_shadow": [{kind: "calc", left: variable(7), operator: "＋", right: {kind: "immediate", value: 1}}, {kind: "exit"}],
      "timer-timeout": [{kind: "calc", left: variable(6), operator: "＋", right: {kind: "immediate", value: 1}}, {kind: "exit"}],
      "battle": [{kind: "encounter", party: f.map.scripts["stone-battle"]![0]!.kind === "encounter" ? f.map.scripts["stone-battle"]![0]!.party : 1,
        continuation: "timer-battle-return"}], "timer-battle-return": [{kind: "exit"}],
    };
    for (const [name, ops] of Object.entries(programs)) {
      const source = ["sc_secede_shadow", "timer-timeout"].includes(name) ? callbackSource : f.source;
      map.scripts[name] = ops.map((op,index) => ({...op, script: name, index, source}) as Op);
      map.scriptPuppetContexts![name] = {...template, skipInitialize: true, keepPlayerPuppet: true, scriptHash: "7".repeat(64)};
      (map.scriptLocals ??= {})[name] = null; (map.scriptSystemFlags ??= {})[name] = {keepBadStatusVisual: false};
      (map.scriptTransitionMetadata ??= {})[name] = {customAnimations: "none"};
    }
  }
  const [initial, worldMap] = maps.map(sealBatchContent), worldDraft = structuredClone(f.world);
  worldDraft.parentSourceSetHash = parent;
  worldDraft.developmentProfile!.storyRuntime = WEB_FIELD_STORY_RUNTIME;
  for (const map of [initial!, worldMap!]) worldDraft.maps[map.mapId]!.contentHash = map.contentHash;
  const world = sealBatchContent(worldDraft), content = await compileFrameworkNewGame({sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap, world, map: initial!, battle: f.battle, entrance: initial!.partyEntry!.pointIns[0]!.id});
  const runtime = {battleHandoff: "prepared" as const, sourceFieldUi: WEB_SOURCE_FIELD_UI};
  const game = await GameSession.prepareFrameworkNewGame(content, world, initial!, f.battle, runtime), flow = new GameFlow(game);
  flow.start(game); flow.observeHost(host); flow.advance(10, host);
  const refs: GameContentRefs = {kind: "game-content-refs-v2", profile: "framework", world: {url: "/synthetic-timers/catalog.json", contentHash: world.contentHash},
    source: null, development: null, initialized: {entry: {url: "/synthetic-timers/entry.json", contentHash: content.contentHash}, battle: {url: "/synthetic-timers/battle.json", contentHash: f.battle.contentHash}}};
  const files = new Map<string,unknown>([[refs.world.url,world], [refs.initialized!.entry.url,content], [refs.initialized!.battle.url,f.battle],
    ...[initial!,worldMap!].map(map => [world.maps[map.mapId]!.url,map] as [string,unknown])]);
  const reads: string[] = [], repository = () => new GameContentRepository(async url => {reads.push(url); if (!files.has(url)) throw new Error("Missing synthetic timer origin " + url); return files.get(url);}, "framework", refs);
  const restore = async (saved: GameCheckpoint) => {const packages = await repository().restoreSessionContent(saved);
    return GameSession.restore(saved, packages.initial, packages.battle, packages.world, runtime);};
  return {...f, initial: initial!, worldMap: worldMap!, world, content, runtime, game, flow, files, reads, repository, restore};
}
type Live = Awaited<ReturnType<typeof fixture>>;
function run(h: Live, name: string, game = h.game) {
  assert.equal(game.field.startEvent(name), true);
  for (let i=0;i<100 && game.field.busy && !game.field.stop;i++) game.advance(10);
  assert.equal(game.field.stop, null, game.field.stop?.message);
}
function state(game: GameSession) {const timer = game.field.storyRuntimeSnapshot!.timer; assert.equal(timer.kind,"web-field-timer-v2");return timer.kind === "web-field-timer-v2" ? timer.scenario : assert.fail();}
function requestTravel(h: Live, world = true) {
  assert.equal(h.game.field.startEvent(world ? "go-world" : "world-return"), true);
  assert.equal(h.game.field.stop?.kind, "map-transition");
}
function commitTravel(h: Live, world = true) {
  requestTravel(h,world); const candidate = h.game.world.prepare(h.world,world ? h.worldMap : h.initial);
  assert.equal(h.game.world.commit(candidate),true); h.flow.advance(10,host); assert.equal(h.game.checkpointReady,true);
}
async function stored(h: Live) {
  const memory = new Map<string,string>(), storage = new CheckpointStorage({getItem: key => memory.get(key) ?? null,setItem: (key,value) => {memory.set(key,value);}}, "framework", "scenario-timer");
  const saved = h.game.checkpoint(); await storage.save(saved,42); return (await storage.load())!.checkpoint;
}
test("same global Cid counter survives Field to cyclic World, cancellation/stale candidates, Storage and resume", async () => {
  const h = await fixture(); run(h,"cid-start"); h.flow.advance(1200,host); run(h,"cid-read");
  const value = h.game.field.eventState.read(variable(2)); assert.ok(value >= 38 && value <= 39);
  run(h,"timer-ui"); assert.equal(h.game.field.timerProjection!.visible,true); assert.equal(h.game.field.sourceFieldUiSnapshot!.view,"timer");
  requestTravel(h); const owner = h.game.field, before = canonical(owner.storyRuntimeSnapshot), cancelled = h.game.world.prepare(h.world,h.worldMap);
  h.game.world.discard(cancelled); assert.equal(h.game.world.commit(cancelled),false); assert.equal(h.game.field,owner); assert.equal(canonical(owner.storyRuntimeSnapshot),before);
  const stale = h.game.world.prepare(h.world,h.worldMap); stale.field.advanceStoryTimer(10,"player"); assert.equal(h.game.world.commit(stale),false);
  const accepted = h.game.world.prepare(h.world,h.worldMap); assert.equal(h.game.world.commit(accepted),true); h.flow.advance(10,host);
  assert.throws(() => owner.advanceStoryTimer(10,"player"),/Retired Field/);
  assert.equal(h.game.field.content.entry.viewPlan!.isWorld,true); assert.equal(h.game.field.storyRuntimeSnapshot!.timer.active,null);
  const saved = await stored(h), loaded = await h.restore(saved); assert.deepEqual(loaded.checkpoint(),saved);
  assert.equal(loaded.field.storyTimerOrigins![0]!.mapId,h.initial.mapId);
  const remaining = fieldTimerRemainingSeconds(loaded.field.storyRuntimeSnapshot!.timer)!; loaded.advance(1000);
  assert.ok(fieldTimerRemainingSeconds(loaded.field.storyRuntimeSnapshot!.timer)! < remaining);
  run(h,"cid-suspend",loaded); assert.equal(fieldTimerRemainingSeconds(loaded.field.storyRuntimeSnapshot!.timer),null);
  run(h,"cid-resume",loaded); assert.ok(state(loaded).counter); assert.equal(loaded.field.storyRuntimeSnapshot!.timer.active,null);
});
test("Shadow same-frame reset/setup retires at tick end and a missed deadline cannot become a later callback", async () => {
  const h = await fixture(); run(h,"global-short"); run(h,"shadow-start");
  const old = state(h.game).shadow!; run(h,"shadow-reset-setup");
  assert.equal(state(h.game).shadow!.sequence,old.sequence); assert.equal(state(h.game).removeShadow,true);
  h.flow.advance(10,host); assert.equal(state(h.game).shadow,null);
  run(h,"global-short"); run(h,"shadow-start"); h.flow.advance(100,host);
  assert.equal(state(h.game).shadow,null); assert.equal(state(h.game).callbacks.length,0);
  run(h,"shadow-pose"); h.flow.advance(100,host); assert.equal(h.game.field.eventState.read(variable(7)),0);
});
test("callback and counter origins from different maps reload through one trusted catalog, rejecting missing/forged origins", async () => {
  const h = await fixture(); run(h,"global-long"); run(h,"shadow-start"); commitTravel(h);
  run(h,"cid-start"); assert.equal(h.game.field.storyTimerOrigins!.length,2);
  const saved = await stored(h), loaded = await h.restore(saved); assert.deepEqual(loaded.checkpoint(),saved);
  const url = h.world.maps[h.initial.mapId]!.url, origin = h.files.get(url)!; h.files.delete(url);
  await assert.rejects(() => h.restore(saved),/Missing synthetic timer origin/); h.files.set(url,origin);
  const forged = structuredClone(saved); assert.ok("storyRuntime" in forged.world.field);
  if (!("storyRuntime" in forged.world.field) || forged.world.field.storyRuntime.timer.kind !== "web-field-timer-v2") return assert.fail();
  forged.world.field.storyRuntime.timer.scenario.shadow!.binding.callback.source.objectId = "9007199254741999";
  await assert.rejects(() => h.restore(forged),/binding|source/i);
  const old = h.game.field.storyRuntimeSnapshot; assert.equal(h.flow.pause(true),true); h.flow.advance(1000,host);
  assert.deepEqual(h.game.field.storyRuntimeSnapshot,old); assert.equal(h.flow.pause(false),true);
});
test("deadline samples the actual native player cell during Battle, then Storage publishes exactly one safe Field callback", async () => {
  const h = await fixture(), commands = new GameCommands(h.flow,h.game); run(h,"shadow-pose");
  assert.deepEqual(fieldCameraWorldToCell(h.game.field.content.cameraHost!.mapRange,{x:h.game.field.player.native!.entity.position.x,y:h.game.field.player.native!.entity.position.y}),{x:112,y:23});
  run(h,"cid-short"); run(h,"shadow-start"); assert.equal(h.game.field.startEvent("battle"),true);
  const handoff = new GameBattleHandoff(h.flow,{prepareStart: async () => ({}),prepareReturn: async () => ({}),discard() {}});
  assert.equal((await handoff.start()).status,"committed"); const battle = h.game.battle!;
  const counterBeforeBattle = fieldTimerRemainingSeconds(h.game.field.storyRuntimeSnapshot!.timer);
  h.flow.advance(1100,host); assert.equal(state(h.game).shadow,null); assert.equal(state(h.game).callbacks.length,1);
  assert.equal(fieldTimerRemainingSeconds(h.game.field.storyRuntimeSnapshot!.timer),counterBeforeBattle,"the same Cid global excludes Battle while its Shadow named lane keeps ticking");
  assert.equal(h.game.field.eventState.read(variable(7)),0);
  for(let i=0;i<2500 && battle.phase === "active";i++) {
    for(const actor of battle.ready) {const target = battle.enemies.find(unit => unit.hp>0);if(target) commands.command(battle,actor.id,10,{kind:"single",id:target.id},100);}
    h.flow.advance(20,host);
  }
  assert.equal(battle.phase,"victory"); assert.equal((await handoff.return()).status,"committed");
  // The accepted request is already sampled; returning and restoring never re-evaluate the old location/flag.
  for(let i=0;i<100 && !h.game.checkpointReady;i++) h.flow.advance(10,host);
  const saved = await stored(h), loaded = await h.restore(saved); loaded.advance(1000);
  assert.equal(loaded.field.eventState.read(variable(7)),1); assert.equal(state(loaded).callbacks.length,0);
  loaded.advance(1000); assert.equal(loaded.field.eventState.read(variable(7)),1); assert.equal(loaded.state.completedEncounters.length,1);
});
test("a current namespace failure retains the accepted request and never publishes its script effect", async () => {
  const h = await fixture(); run(h,"shadow-pose"); run(h,"global-short"); run(h,"shadow-start");
  // Model loss of the current trusted callback consumer, after exact source binding.
  h.game.field.content.scripts.sc_secede_shadow![0]!.source.objectId = "9007199254741999";
  h.flow.advance(100,host);
  assert.equal(h.game.field.stop?.kind,"unsupported"); assert.match(h.game.field.stop!.message,/current trusted script namespace/);
  assert.equal(state(h.game).callbacks.length,1); assert.equal(h.game.field.eventState.read(variable(7)),0);
  const pending = canonical(state(h.game).callbacks); h.flow.advance(1000,host); assert.equal(canonical(state(h.game).callbacks),pending);
});
test("missing actual player-cell provider fails the clock transaction without consuming a due Shadow condition", async () => {
  const h = await fixture(); run(h,"shadow-pose"); run(h,"global-short"); run(h,"shadow-start");
  const timer = canonical(h.game.field.storyRuntimeSnapshot);
  delete h.game.field.content.cameraHost;
  h.flow.advance(100,host); assert.equal(h.game.field.stop?.kind,"unsupported");
  assert.match(h.game.field.stop!.message,/actual player transform.*map-cell provider/);
  assert.ok(state(h.game).shadow!.elapsedMs < state(h.game).shadow!.durationMs);
  assert.ok(state(h.game).shadow!.durationMs - state(h.game).shadow!.elapsedMs <= 10, "the failing deadline tick remains unconsumed");
  assert.equal(state(h.game).callbacks.length,0); assert.notEqual(canonical(h.game.field.storyRuntimeSnapshot),timer);
});
