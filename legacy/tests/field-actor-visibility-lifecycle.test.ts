import test from "node:test";
import assert from "node:assert/strict";
import { startFieldActorVisibility, tickFieldActorVisibility, sourceVisibilityDelayDue,
  cloneFieldActorFade, type FieldActorVisibilityState } from "../src/core/field-actor-visibility.js";
import { compileFieldActorVisibilityInstruction } from "../src/compiler/field-actor-visibility.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { GameSession } from "../src/core/game-session.js";
import { fieldMoveToSessionFixture, launchFieldMoveToSession } from "./fixtures/field-move-to-session.js";
import type { Op, Site } from "../src/field/types.js";

const raw = (duration: number, delay: number, mnemonic = "Hide") => ({ type: 2, mnemonic,
  operands: { iValues: Array(8).fill(0), rValues: [duration, delay, ...Array(6).fill(0)], sValues: Array(8).fill("") } });
const initial: FieldActorVisibilityState = { visible: true, fadeAlpha: 1 };

test("native float32 duration and original double signed delay retain distinct source ABI", () => {
  const input = raw(.7, -.1666), before = structuredClone(input), decoded = compileFieldActorVisibilityInstruction(input);
  assert.deepEqual(decoded, { kind: "actor-visibility", visible: false,
    timing: { durationSeconds: Math.fround(.7), delaySeconds: -.1666 } });
  assert.deepEqual(input, before);
  assert.deepEqual(compileFieldActorVisibilityInstruction(raw(0, 0)), { kind: "actor-visibility", visible: false });
  for (const value of [-1, Infinity, NaN, Number.MAX_VALUE]) assert.throws(() => compileFieldActorVisibilityInstruction(raw(value, 0)));
  const reserved = raw(.7, 0); reserved.operands.rValues[7] = 1;
  assert.throws(() => compileFieldActorVisibilityInstruction(reserved), /reserved/);
});

test("source fade endpoint is not completion: old rate must be strictly greater than one", () => {
  const input = structuredClone(initial), start = startFieldActorVisibility(input, false, .5, 0);
  assert.deepEqual(input, initial); assert.equal(start.visible, true); assert.equal(start.fadeAlpha, 1);
  const endpoint = tickFieldActorVisibility(start, .5);
  assert.equal(endpoint.fadeAlpha, 0); assert.equal(endpoint.visible, true); assert.ok(endpoint.visibilityFade);
  const over = tickFieldActorVisibility(endpoint, .75);
  assert.equal(over.visible, true); assert.ok(over.visibilityFade); assert.equal(over.visibilityFade.rate, 1.5);
  const finished = tickFieldActorVisibility(over, 1);
  assert.equal(finished.visible, false); assert.equal(finished.fadeAlpha, 0); assert.equal(finished.visibilityFade, null);
  assert.equal(start.visibilityFade!.rate, 0, "Pure tick does not alias the owner state");
});

test("show restarts at zero, hide restarts at one, immediate interruption retires the previous fade", () => {
  let state = startFieldActorVisibility(initial, false, 1, 10);
  state = tickFieldActorVisibility(state, 10.5); assert.equal(state.fadeAlpha, .5);
  state = startFieldActorVisibility(state, true, 1, 10.5);
  assert.equal(state.fadeAlpha, 0); assert.equal(state.visible, true);
  state = tickFieldActorVisibility(state, 11); assert.equal(state.fadeAlpha, .5);
  state = startFieldActorVisibility(state, false, 0, 11);
  assert.equal(state.visible, false); assert.equal(state.fadeAlpha, 0); assert.equal(state.visibilityFade, null);
  assert.deepEqual(tickFieldActorVisibility(state, 100), state);
});

test("a masked actor samples the still advancing absolute clock when it updates again", () => {
  const state = startFieldActorVisibility(initial, false, .5, 0);
  assert.equal(state.fadeAlpha, 1);
  const resumed = tickFieldActorVisibility(state, 4);
  assert.equal(resumed.fadeAlpha, 0); assert.equal(resumed.visible, true);
  assert.ok(resumed.visibilityFade); assert.equal(resumed.visibilityFade.rate, 8);
  assert.equal(tickFieldActorVisibility(resumed, 4.01).visible, false);
});

test("instant timer uses float32 recorded time and double delay with >= deadline", () => {
  assert.equal(sourceVisibilityDelayDue(1, .5, 1.5), true);
  assert.equal(sourceVisibilityDelayDue(1, .500000000001, 1.5), false);
  assert.equal(sourceVisibilityDelayDue(1, -.2, 1), true);
  assert.throws(() => sourceVisibilityDelayDue(.1, .5, 1));
  assert.throws(() => cloneFieldActorFade({ kind: "source-field-actor-fade-v1", status: 2,
    startedAtSeconds: 0, durationSeconds: 1, rate: Infinity }));
});

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
async function fixture(duration: number, delay: number, following: Instruction<Op>[] = [], mainTail: Instruction<Op>[] = [{kind:"exit"}], sourceIndex?: number) {
  const f = await fieldMoveToSessionFixture(), name = "visibility-life", source = { file: "controlled-visibility-life", assetPath: "authored/visibility" };
  const emit = (ops: Instruction<Op>[]) => ops.map((op, index) => ({ ...op, script: name, index, source }) as Op);
  f.map.scripts[name] = emit([
    { kind: "puppet", slot: 0, actor: "601", target: 3 + mainTail.length },
    { kind: "exec-puppets", asynchronous: true }, { kind: "finish-puppets" }, ...mainTail,
    compileFieldActorVisibilityInstruction(raw(duration, delay)), ...following, { kind: "exit" },
  ]);
  if (sourceIndex !== undefined) f.map.scripts[name]![3+mainTail.length]!.index=sourceIndex;
  f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "c".repeat(64) };
  f.map.scriptLocals![name] = null;
  async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
    const { contentHash: _, ...payload } = value; return { ...payload, contentHash: await contentDigest(payload) } as T;
  }
  f.map = await seal(f.map); f.world.maps[String(f.map.mapId)]!.contentHash = f.map.contentHash;
  f.world = await seal(f.world); f.content.mapContentHash = f.map.contentHash; f.content.worldCatalogHash = f.world.contentHash;
  f.content = await seal(f.content);
  f.dependencies = { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } };
  const game = launchFieldMoveToSession(f);
  for (let i = 0; i < 1000 && !game.checkpointReady && !game.field.stop; i++) game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true, "Source initializer must finish before the test event");
  return { f, game, name, actor: game.field.actors["601"]! };
}

test("real FieldGame delays a negative timer to its next Update and applies its captured actor once", async () => {
  const t = await fixture(0, -.2), entity = t.actor.native!.entity;
  assert.equal(entity.visible, true); assert.equal(t.game.field.startEvent(t.name), true);
  for (let i = 0; i < 5 && !t.game.field.actorVisibilityExecutions.length; i++) t.game.advance(10);
  const queued = t.game.field.actorVisibilityExecutions.find(row => row.phase === "queued");
  assert.ok(queued); assert.equal(entity.visible, true); assert.equal(t.game.field.actorVisibilityBusy, true);
  assert.throws(() => t.game.checkpoint());
  t.game.advance(10);
  assert.equal(t.actor.native!.entity, entity); assert.equal(entity.visible, false);
  const applied = t.game.field.actorVisibilityExecutions.filter(row => row.phase === "applied");
  assert.equal(applied.length, 1); assert.equal(applied[0]!.ticket, queued.ticket);
  assert.equal(applied[0]!.atMilliseconds, queued.atMilliseconds + 10);
  t.game.advance(100); assert.equal(t.game.field.actorVisibilityExecutions.filter(row => row.phase === "applied").length, 1);
});

test("finished event leaves asynchronous actor fade active; stable restore does not replay it", async () => {
  const t = await fixture(.5, 0), entity = t.actor.native!.entity;
  assert.equal(t.game.field.startEvent(t.name), true);
  for (let i = 0; i < 20 && t.game.field.busy; i++) t.game.advance(10);
  assert.equal(t.game.field.stop, null); assert.equal(t.game.field.busy, false);
  assert.equal(t.game.field.actorVisibilityBusy, true); assert.ok(entity.visibilityFade);
  assert.throws(() => t.game.checkpoint());
  t.game.advance(700); assert.equal(t.game.field.actorVisibilityBusy, false); assert.equal(entity.visible, false);
  const saved = t.game.checkpoint(), restored = GameSession.restore(saved, undefined, t.f.battle, t.f.dependencies);
  assert.equal(restored.field.actors["601"]!.native!.entity.visible, false);
  assert.equal(restored.field.actorVisibilityExecutions.length, 0);
  restored.advance(100); assert.equal(restored.field.actors["601"]!.native!.entity.visible, false);
  assert.deepEqual(restored.state.snapshot(), t.game.state.snapshot());
});


test("same-deadline timers retain oldest-first order without repeating a reused actor request", async () => {
  const t = await fixture(0, .1, [compileFieldActorVisibilityInstruction(raw(0, .1, "Show"))]);
  assert.equal(t.game.field.startEvent(t.name), true);
  for(let i=0;i<10 && t.game.field.actorVisibilityExecutions.filter(row=>row.phase==="queued").length<2;i++)t.game.advance(10);
  const queued=t.game.field.actorVisibilityExecutions.filter(row=>row.phase==="queued");assert.equal(queued.length,2);
  for(let i=0;i<50 && t.game.field.actorVisibilityBusy;i++)t.game.advance(10);
  const applied=t.game.field.actorVisibilityExecutions.filter(row=>row.phase==="applied");
  assert.deepEqual(applied.map(row=>row.ticket),queued.map(row=>row.ticket));
  assert.deepEqual(applied.map(row=>row.visible),[false,true]);assert.equal(t.actor.native!.entity.visible,true);
  t.game.advance(100);assert.equal(t.game.field.actorVisibilityExecutions.filter(row=>row.phase==="applied").length,2);
});

test("changed captured source rejects a deferred callback before mutating its actor", async () => {
  const t=await fixture(0,.1);assert.equal(t.game.field.startEvent(t.name),true);
  for(let i=0;i<10 && !t.game.field.actorVisibilityExecutions.length;i++)t.game.advance(10);
  const original=t.game.field.content.scripts[t.name]![4]!;
  t.game.field.content.scripts[t.name]![4]={...original,index:99};
  t.game.advance(200);assert.equal(t.game.field.stop?.kind,"unsupported");
  assert.equal(t.actor.native!.entity.visible,true);assert.equal(t.actor.native!.entity.fadeAlpha,1);
  assert.equal(t.game.field.actorVisibilityExecutions.filter(row=>row.phase==="applied").length,0);
});

test("pending actor fade rejects map preparation without retiring its captured owner", async () => {
  const t=await fixture(1,0);assert.equal(t.game.field.startEvent(t.name),true);
  for(let i=0;i<20 && (t.game.field.busy || !t.game.field.actorVisibilityBusy);i++)t.game.advance(10);
  assert.equal(t.game.field.busy,false);assert.equal(t.game.field.actorVisibilityBusy,true);
  const entity=t.actor.native!.entity,before=structuredClone(entity.visibilityFade);
  t.game.field.previewMap(t.f.map.mapId,1);
  assert.throws(()=>t.game.world.prepare(t.f.world,t.f.map),/cross-map actor lifetime/);
  assert.equal(t.game.field.actors[t.actor.id],t.actor);assert.equal(t.actor.native!.entity,entity);
  assert.deepEqual(entity.visibilityFade,before);assert.throws(()=>t.game.checkpoint());
});


test("source battle handoff rejects pending visibility without opening a lease or draining its actor", async () => {
 const t=await fixture(1,0,[],[{kind:"encounter",party:123,continuation:"reserved"},{kind:"exit"}]);
 const owned=structuredClone(t.game.state.snapshot());assert.equal(t.game.field.startEvent(t.name),true);
 for(let i=0;i<20 && !t.game.field.stop;i++)t.game.advance(10);
 assert.equal(t.game.field.stop?.kind,"unsupported");assert.match(t.game.field.stop!.message,/field activity/);
 assert.equal(t.game.battle,null);assert.equal(t.game.state.inBattle,false);assert.deepEqual(t.game.state.snapshot(),owned);
 assert.equal(t.game.field.actorVisibilityBusy,true);assert.ok(t.actor.native!.entity.visibilityFade);
 const fade=structuredClone(t.actor.native!.entity.visibilityFade);t.game.advance(1000);
 assert.deepEqual(t.actor.native!.entity.visibilityFade,fade,"Unsupported handoff cannot secretly drain timers");
});

test("an unavailable actor host fails before alpha publication and a trusted stable restore can retry", async () => {
 const t=await fixture(.1,0),saved=t.game.checkpoint(),owned=structuredClone(t.game.state.snapshot());
 t.actor.native!.entity.childEntityObject="unknown";t.game.field.startEvent(t.name);
 for(let i=0;i<20 && !t.game.field.stop;i++)t.game.advance(10);
 assert.equal(t.game.field.stop?.kind,"unsupported");assert.equal(t.actor.native!.entity.fadeAlpha,1);
 assert.equal(t.game.field.actorVisibilityExecutions.length,0);assert.deepEqual(t.game.state.snapshot(),owned);
 const restored=GameSession.restore(saved,undefined,t.f.battle,t.f.dependencies);assert.equal(restored.field.startEvent(t.name),true);
 for(let i=0;i<100 && !restored.checkpointReady && !restored.field.stop;i++)restored.advance(10);
 assert.equal(restored.field.stop,null);assert.equal(restored.checkpointReady,true);
 assert.equal(restored.field.actors["601"]!.native!.entity.visible,false);
 assert.equal(restored.field.actorVisibilityExecutions.filter(row=>row.phase==="applied").length,1);
});

test("actual ordinary message mask pauses actor updates while the shared field clock keeps advancing", async () => {
 const t=await fixture(.5,0,[],[{kind:"message",key:"CONTROLLED_VISIBILITY_MESSAGE",speaker:"",text:"wait",
  manual:{after:"close",anchor:"bottom",window:"frame",pages:["wait"]}},{kind:"exit"}]);
 assert.equal(t.game.field.startEvent(t.name),true);
 for(let i=0;i<20 && !t.game.field.dialogue && !t.game.field.stop;i++)t.game.advance(10);
 assert.equal(t.game.field.stop,null);assert.ok(t.game.field.dialogue);assert.equal(t.game.field.actorVisibilityBusy,true);
 const alpha=t.actor.native!.entity.fadeAlpha,before=t.game.field.time;
 t.game.advance(300);assert.equal(t.game.field.time,before+300);assert.equal(t.actor.native!.entity.fadeAlpha,alpha);
 t.game.field.confirm();t.game.advance(10);
 assert.equal(t.game.field.dialogue,null);assert.ok(t.actor.native!.entity.fadeAlpha<alpha);
 t.game.advance(300);assert.equal(t.actor.native!.entity.visible,false);assert.equal(t.game.field.actorVisibilityBusy,false);
});


test("a legal source Site.index distinct from Web PC is evidence, not a timer array address", async () => {
 const t=await fixture(0,-.2,[],[{kind:"exit"}],99);assert.equal(t.game.field.startEvent(t.name),true);
 for(let i=0;i<10&&!t.game.field.actorVisibilityExecutions.length;i++)t.game.advance(10);
 assert.equal(t.game.field.actorVisibilityExecutions[0]!.site.index,99);assert.equal(t.actor.native!.entity.visible,true);
 t.game.advance(10);assert.equal(t.game.field.stop,null);assert.equal(t.actor.native!.entity.visible,false);
 assert.equal(t.game.field.actorVisibilityExecutions.filter(row=>row.phase==="applied").length,1);
});
