import test from "node:test";
import assert from "node:assert/strict";
import { captureVerifiedContent, verifiedContentValue } from "../src/core/verified-content.js";
import { compileFrameworkNewGame, compileFrameworkNewGameFromVerified } from "../src/compiler/framework-new-game.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { FieldFadeState, DEVELOPMENT_TRANSPARENT_FADE } from "../src/core/field-fade.js";
import { IMMUTABLE_OWNED_FIELD_SOURCE } from "../src/core/field-source-snapshot.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { hash } from "../src/compiler/content.js";
const simpleSeal = <T extends object>(value: T): T & { contentHash: string } => ({ ...value, contentHash: hash(value) });

const mode = { sourceSnapshot: IMMUTABLE_OWNED_FIELD_SOURCE };
const ready = { visible: true, mediaReady: true, overlayOpen: false };
type Fixture = Awaited<ReturnType<typeof frameworkNewGameFixture>>;
async function caps(f: Fixture) {
  return { content: await captureVerifiedContent(f.content), world: await captureVerifiedContent(f.world),
    map: await captureVerifiedContent(f.map), battle: await captureVerifiedContent(f.battle) };
}
async function sources(f: Fixture) {
  return { sourceEntry: await captureVerifiedContent(f.sourceEntry), sourceBattle: await captureVerifiedContent(f.sourceBattle),
    sourceMap: await captureVerifiedContent(f.sourceMap), world: await captureVerifiedContent(f.world),
    map: await captureVerifiedContent(f.map), battle: await captureVerifiedContent(f.battle), entrance: f.content.entry.entrance };
}
function prepare(c: Awaited<ReturnType<typeof caps>>, runtime = mode) {
  return GameSession.prepareFrameworkNewGameFromVerified(c.content, c.world, c.map, c.battle, runtime);
}

test("verified document capture hashes a pre-await private snapshot and never freezes the caller", async () => {
  const source = simpleSeal({ nested: { count: 1 } }), pending = captureVerifiedContent(source);
  source.nested.count = 2; const cap = await pending, value = verifiedContentValue(cap);
  assert.equal(value.nested.count, 1); assert.equal(Object.isFrozen(source), false);
  assert.throws(() => { value.nested.count = 3; }, TypeError);
  await assert.rejects(captureVerifiedContent(source), /payload changed/);
  await assert.rejects(captureVerifiedContent(simpleSeal({ n: 1 }), "a".repeat(64)), /identity mismatch/);
});

test("a constructor, prototype, JSON, Proxy or foreign-module document cannot forge the private brand", async () => {
  const cap = await captureVerifiedContent(simpleSeal({ n: 1 }));
  const Constructor = cap.constructor as new (...args: unknown[]) => unknown;
  assert.throws(() => new Constructor({ n: 9 }, Symbol()), /full capture and verification/);
  assert.equal(Reflect.set(Constructor, "value", () => ({ contentHash: "a".repeat(64) })), false);
  assert.equal(Reflect.set(Object.getPrototypeOf(cap), "constructor", function Fake() {}), false);
  for (const fake of [Object.create(Object.getPrototypeOf(cap)), JSON.parse(JSON.stringify(cap)), new Proxy(cap, {})])
    assert.throws(() => verifiedContentValue(fake), /genuine verified/);
  const other = await import(new URL("../src/core/verified-content.js?independent-module=1", import.meta.url).href);
  const foreign = await other.captureVerifiedContent(simpleSeal({ n: 1 }));
  assert.throws(() => verifiedContentValue(foreign), /genuine verified/);
  assert.throws(() => other.verifiedContentValue(cap), /genuine verified/);
});

test("verified snapshots reject mutable internal slots and accessors, including disguised prototypes", async () => {
  for (const item of [new Map(), new Set(), new Date(), new ArrayBuffer(8), new Uint8Array(2)]) {
    await assert.rejects(captureVerifiedContent({ contentHash: "a".repeat(64), item }), /plain records/);
    Object.setPrototypeOf(item, null);
    await assert.rejects(captureVerifiedContent({ contentHash: "a".repeat(64), item }), /plain records/);
  }
  let reads = 0; const value = { contentHash: "a".repeat(64) };
  Object.defineProperty(value, "bad", { enumerable: true, get() { reads++; return 1; } });
  await assert.rejects(captureVerifiedContent(value), /accessors/); assert.equal(reads, 0);
});

test("six verified documents compile the identical framework content and still enforce per-tuple source and profile bindings", async () => {
  const f = await frameworkNewGameFixture(), input = await sources(f);
  assert.deepEqual(await compileFrameworkNewGameFromVerified(input), f.content);
  const wrong = await captureVerifiedContent(sealBatchContent({ ...f.battle, gameState: { ...f.battle.gameState,
    initialGil: f.battle.gameState.initialGil + 1 } }));
  await assert.rejects(compileFrameworkNewGameFromVerified({ ...input, battle: wrong }), /initializer or owned catalogs/);
  const missingProfile = structuredClone(f.map); delete missingProfile.developmentProfile;
  const unbound = sealBatchContent(missingProfile);
  await assert.rejects(compileFrameworkNewGameFromVerified({ ...input, map: await captureVerifiedContent(unbound) }), /profile|binding|identity/);
  await assert.rejects(compileFrameworkNewGameFromVerified({ ...input, map: f.map as never }), /genuine verified/);
});

test("legacy mutable compiler and Session still capture before digest awaits", async () => {
  const f = await frameworkNewGameFixture(), data = { sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap: f.sourceMap, world: f.world, map: f.map, battle: f.battle, entrance: f.content.entry.entrance };
  const pending = compileFrameworkNewGame(data); data.map.name = "later caller mutation";
  assert.deepEqual(await pending, f.content);
  const fresh = await frameworkNewGameFixture(), session = GameSession.prepareFrameworkNewGame(fresh.content, fresh.world, fresh.map, fresh.battle);
  fresh.content.entry.mapId++; fresh.world.maps = {}; fresh.battle.gameState.sourceNewGame!.gil++;
  const game = await session; game.advance(10); assert.equal(game.gil, fresh.plan.owned.gil);
  assert.equal(Object.isFrozen(fresh.battle), false);
});

test("two simultaneous admitted Sessions have distinct live identities and execute initialization independently", async () => {
  const f = await frameworkNewGameFixture(), c = await caps(f), [a, b] = await Promise.all([prepare(c), prepare(c)]);
  for (const game of [a, b]) { game.advance(10); assert(game.checkpointReady); assert.equal(game.field.eventState.read(f.initializerFlag), 1); }
  assert.notEqual(a.state, b.state); assert.notEqual(a.field, b.field); assert.notEqual(a.world, b.world);
  assert.notEqual(a.field.content, b.field.content); assert.notEqual(a.field.player, b.field.player); assert.notEqual(a.field.eventState, b.field.eventState);
  assert.equal(a.battleCatalog, b.battleCatalog, "Only the deeply readonly source definition is shared");
  const before = b.checkpoint(); a.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  a.field.eventState.write(f.initializerFlag, 9); a.advance(50);
  assert.deepEqual(b.checkpoint(), before); assert.throws(() => { a.battleCatalog.gameState.initialGil++; }, TypeError);
  assert.equal(Object.isFrozen(f.battle), false);
});

test("verified Session rejects a false initializer, missing ownership mode and checkpoint-injected capabilities", async () => {
  const f = await frameworkNewGameFixture(), c = await caps(f), wrong = await captureVerifiedContent(sealBatchContent({ ...f.content, initializerHash: "a".repeat(64) }));
  await assert.rejects(GameSession.prepareFrameworkNewGameFromVerified(wrong, c.world, c.map, c.battle, mode), /payload changed/);
  await assert.rejects(GameSession.prepareFrameworkNewGameFromVerified(c.content, c.world, c.map, c.battle), /immutable owned Field/);
  const game = await prepare(c); game.advance(10); const saved = game.checkpoint();
  Reflect.set(saved, "verifiedContent", c.content);
  assert.throws(() => GameSession.restore(saved, undefined, f.battle,
    { catalog: f.world, map: f.map, initialized: { content: f.content, initialMap: f.map } }, mode), /checkpoint fields/);
});

test("fade and runtime capture precede awaits, failed admission cannot consume the caller, and late Session publication is cancelled", async () => {
  const f = await frameworkNewGameFixture(), c = await caps(f), fade = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE), snapshot = fade.snapshot(), runtime = { ...mode };
  const pending = GameSession.prepareFrameworkNewGameFromVerified(c.content, c.world, c.map, c.battle, runtime, 17, fade);
  fade.start({ kind: "field-fade", direction: "out", seconds: 0, color: { r: 1, g: 0, b: 0, a: 1 } });
  const game = await pending; assert.deepEqual(game.field.fader.snapshot(), snapshot); assert.notEqual(game.field.fader, fade);
  const flow = new GameFlow(), disposed: number[] = [], loader = new GameEntryLoader(flow, { discard: p => { disposed.push(p as number); } });
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  const attempt = loader.begin("new-game"), late = attempt.prepare(async () => { await held; return { session: await prepare(c), presentation: 7 }; });
  flow.start(game); release(); assert.equal((await late).status, "cancelled"); assert.equal(flow.currentSession, game); assert.deepEqual(disposed, [7]);
});

test("admitted Sessions retain actual battle failure/cancel/late, consumed action cost, unique return and Storage", async () => {
  const f = await frameworkNewGameFixture(); f.battle.common.abilities[10]!.cost = 1;
  f.battle = sealBatchContent(f.battle); f.content = sealBatchContent({ ...f.content, battleCatalogHash: f.battle.contentHash });
  const c = await caps(f), runtime = { ...mode, battleHandoff: "prepared" as const }, game = await GameSession.prepareFrameworkNewGameFromVerified(c.content,c.world,c.map,c.battle,runtime),
    flow = new GameFlow(game); flow.start(); flow.observeHost(ready); flow.advance(10,ready);
  assert(game.field.startEvent("stone-battle")); flow.advance(10,ready); const initial = game.state.snapshot();
  let phase = "fail", reached!: () => void, release!: () => void;
  const waiting = new Promise<void>(r=>{reached=r;}), held = new Promise<void>(r=>{release=r;}),
    handoff = new GameBattleHandoff(flow,{prepareStart:async()=>{if(phase==="fail")throw Error("verified host media failure");if(phase==="mutate-source"){Reflect.set(game.field.content,"opaqueHostDrift",true);throw Error("immutable source write rejected");}if(phase==="hold"){reached();await held;}return null;},prepareReturn:async()=>{if(phase==="return-fail")throw Error("verified return host failure");return null;},discard(){}});
  assert.equal((await handoff.start()).status,"failed"); assert.equal(game.battle,null); assert.deepEqual(game.state.snapshot(),initial);
  phase="mutate-source";assert.equal((await handoff.start()).status,"failed");assert.equal(Object.hasOwn(game.field.content,"opaqueHostDrift"),false);assert.deepEqual(game.state.snapshot(),initial);
  phase="hold";const cancelled=handoff.start();await waiting;handoff.cancel();release();assert.equal((await cancelled).status,"cancelled");assert.equal(game.battle,null);assert.deepEqual(game.state.snapshot(),initial);
  phase="ok";assert.equal((await handoff.start()).status,"committed");const battle=game.battle!;let spentId:string|null=null,mpBefore=0;
  for(let n=0;n<5000&&battle.phase==="active";n++){
    for(const actor of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target&&spentId===null){mpBefore=actor.mp;assert(battle.command(actor.id,10,target.id,100));spentId=actor.id;}}
    flow.advance(10,ready);
  }
  assert.equal(battle.phase,"victory");assert.notEqual(spentId,null);const actual=battle.players.find(p=>p.id===spentId)!;assert.equal(actual.mp,mpBefore-1);
  phase="return-fail";assert.equal((await handoff.return()).status,"failed");assert.equal(actual.mp,mpBefore-1,"Confirmed action costs are not rolled back by return media failure");
  phase="ok";assert.equal((await handoff.return()).status,"committed");assert.throws(()=>battle.advance(10),/Retired/);
  for(let i=0;i<100&&!game.checkpointReady;i++){flow.advance(10,ready);if(game.field.messageWindow||game.field.sourceMessage.projection?.acceptsInput)flow.confirm();}
  assert(game.checkpointReady);assert.equal(game.state.snapshot().roster.find(p=>p.id===spentId)!.mp,mpBefore-1);
  const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
  await storage.save(game.checkpoint(),0);const saved=(await storage.load())!.checkpoint, restored=GameSession.restore(saved,undefined,f.battle,{catalog:f.world,map:f.map,initialized:{content:f.content,initialMap:f.map}},runtime);
  assert.deepEqual(restored.checkpoint(),saved);await assert.rejects(handoff.return(),/pending encounter or terminal battle/);
});


test("post-verification Session construction is a real private method, while both supported factories retain initialization and Storage", async () => {
  assert.equal(Object.hasOwn(GameSession, "instantiateFrameworkNewGame"), false);
  assert.equal(Reflect.get(GameSession, "instantiateFrameworkNewGame"), undefined);
  assert.equal(Reflect.ownKeys(GameSession).includes("instantiateFrameworkNewGame"), false);
  assert.equal(Reflect.get(GameSession, "#instantiateFrameworkNewGame"), undefined);
  const f = await frameworkNewGameFixture(), c = await caps(f);
  const [legacy, verified] = await Promise.all([
    GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, mode), prepare(c),
  ]);
  for (const game of [legacy, verified]) {
    game.advance(10); assert(game.checkpointReady); assert.equal(game.field.eventState.read(f.initializerFlag), 1);
    const values = new Map<string, string>(), storage = new CheckpointStorage({
      getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    });
    const checkpoint = game.checkpoint(); await storage.save(checkpoint, 0);
    const saved = (await storage.load())!.checkpoint;
    const restored = GameSession.restore(saved, undefined, f.battle,
      { catalog: f.world, map: f.map, initialized: { content: f.content, initialMap: f.map } }, mode);
    assert.deepEqual(restored.checkpoint(), checkpoint);
  }
  assert.notEqual(legacy.state, verified.state); assert.notEqual(legacy.field, verified.field);
});
