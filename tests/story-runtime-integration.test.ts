import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { DEVELOPMENT_TRANSPARENT_FADE } from "../src/core/field-fade.js";
import { audioPosition } from "../src/core/static-audio.js";
import { compileFieldTimerInstruction } from "../src/compiler/field-timer.js";
import { hash, canonical } from "../src/compiler/content.js";
import { WEB_FIELD_STORY_RUNTIME } from "../src/core/field-story-runtime.js";
import type { FieldTimerOp } from "../src/core/field-timer.js";
import type { FieldScreenEffectOp } from "../src/core/field-screen-effects.js";
import type { FieldBgmControlOp } from "../src/core/field-bgm-control.js";
import type { Op, Site, FieldContent } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { choiceDefinition } from "./fixtures/field-choice.js";

type Body<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
type Instruction = Body | FieldTimerOp | FieldScreenEffectOp | FieldBgmControlOp;
const sourceSet = hash("synthetic story-runtime source set");
const source = (script: string) => ({ file: "synthetic-story-runtime.bundle", sha256: sourceSet,
  assetPath: `synthetic/scripts/${script}.json`, objectId: script === "expired" ? "9007199254740995" : "9007199254740993" });
const exit: Instruction = { kind: "exit" };
const setFlag = (index: number): Instruction => ({ kind: "flag", ref: { category: "ScenarioFlag1", index }, operation: "set" });
const timer = (seconds = 20, callback = "expired"): FieldTimerOp => compileFieldTimerInstruction({ type: 1, mnemonic: "SetTimer",
  operands: { iValues: [0, 0, 0, 1, 0, 0, 0, 0], rValues: [seconds, 0, 0, 0, 0, 0, 0, 0],
    sValues: [callback, "", "", "", "", "", "", ""] } });
const finishTimer: FieldTimerOp = { kind: "field-timer", command: { kind: "finish" } };
const color = (seconds: number, blue = false): FieldScreenEffectOp => ({ kind: "field-color-fade", seconds,
  color: { r: blue ? 0 : 1, g: 0, b: blue ? 1 : 0, a: 1 }, policy: "web-field-screen-effects-v1" });
const flash: FieldScreenEffectOp = { kind: "field-flash", seconds: Math.fround(0.02), color: { r: 1, g: 1, b: 1, a: 1 },
  policy: "web-field-screen-effects-v1" };
const pause: FieldBgmControlOp = { kind: "bgm-pause", channel: 0, paused: true, fade: 0, policy: "web-static-audio-control-v1" };
const replay: FieldBgmControlOp = { kind: "bgm-replay", channel: 0, fade: 0, policy: "web-static-audio-control-v1" };
function seal(content: FieldContent): void { const { contentHash: _old, ...body } = content; content.contentHash = hash(body); }
function fixture(program: Instruction[], marker = true) {
  const content = structuredClone(checkpointFixture().field);
  content.parentSourceSetHash = sourceSet; content.sourceSetHash = hash("synthetic story field set");
  content.map.identity = { mapId: 1, areaId: 7 };
  content.entry.fade = structuredClone(DEVELOPMENT_TRANSPARENT_FADE);
  content.developmentProfile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: hash("original synthetic content"), omissions: [],
    ...(marker ? { storyRuntime: WEB_FIELD_STORY_RUNTIME } : {}) };
  const bind = (name: string, body: Instruction[]) => body.map((op, index) => ({ ...op, script: name, index,
    source: source(name) } as Op));
  content.scripts.story = bind("story", program);
  content.scriptLocals = { ...content.scriptLocals, story: null, expired: null };
  content.scriptTransitionMetadata = { ...content.scriptTransitionMetadata,
    story: { customAnimations: "none" }, expired: { customAnimations: "none" } };
  content.scripts.expired = bind("expired", [{ kind: "calc", left: { category: "ScenarioVariable", index: 7 },
    operator: "＋", right: { kind: "immediate", value: 1 } }, setFlag(20), exit]);
  content.bgm = { sourceSetHash: hash("synthetic audio source"), tracks: {
    1: { file: "/synthetic/loop.flac", sha256: hash("synthetic decoded audio"), sampleRate: 1000, frames: 10000,
      channels: 2, loop: { start: 2000, end: 8000 }, source: source("audio"), tableSource: source("audio-table") },
  } };
  seal(content);
  const state = EventState.initialized(), field = new FieldGame(content, state);
  field.bgm.play(1, 0, 0, 0, content.bgm);
  return { content, state, field };
}
const flag = (field: FieldGame, index: number) => field.eventState.read({ category: "ScenarioFlag1", index });
function runUntil(field: FieldGame, predicate: () => boolean, maximum = 2000): void {
  for (let i = 0; i < maximum && !predicate(); i++) {
    assert.equal(field.stop, null, field.stop?.message);
    field.advance(10);
  }
  assert.equal(field.stop, null, field.stop?.message);
  assert.ok(predicate(), "The public field VM did not reach the expected lifecycle boundary");
}

test("one public VM joins timer, dialogue/choice, audio controls and two screen owners then restores without initialization", () => {
  const f = fixture([timer(), { kind: "message", key: "SYNTHETIC", speaker: "Guide", text: "Pick one." },
    choiceDefinition(), pause, color(Math.fround(0.03)), setFlag(10), color(Math.fround(-0.5), true), flash,
    replay, finishTimer, setFlag(11), exit]);
  const { field } = f;
  field.startEvent("story");
  assert.ok(field.dialogue); assert.ok(field.storyRuntimeSnapshot!.timer.active);
  assert.equal(field.timerProjection!.visible, true);
  const held = field.storyRuntimeSnapshot!.timer.active!.elapsedMs;
  field.advance(1000);
  assert.equal(field.storyRuntimeSnapshot!.timer.active!.elapsedMs, held, "Excluded dialogue time cannot consume the timer");
  field.confirm(); assert.ok(field.choice);
  const choiceHeld = field.storyRuntimeSnapshot!.timer.active!.elapsedMs;
  field.advance(1000); assert.equal(field.storyRuntimeSnapshot!.timer.active!.elapsedMs, choiceHeld);
  assert.equal(field.choose(field.choice!.id, 0), true);
  const screenStartedAt = field.time;
  field.advance(10); assert.equal(flag(field, 10), 0, "A positive ColorFade must retain the actual VM task until completion");
  runUntil(field, () => flag(field, 10) === 1);
  assert.ok(field.time - screenStartedAt >= 30);
  assert.ok(field.bgm.voices[0]!.pause, "The VM must execute the real static-channel pause");
  runUntil(field, () => flag(field, 11) === 1);
  assert.ok(field.storyRuntimeSnapshot!.colorFilter!.tween,
    "The negative ColorFade continues on its field owner after the VM passes it");
  assert.equal(field.storyRuntimeSnapshot!.timer.active, null, "FinishTimer must cancel its existing timer owner");
  assert.equal(flag(field, 20), 0, "The cancelled callback must not run");
  assert.equal(field.eventState.read({ category: "ScenarioVariable", index: 7 }), 0);
  assert.equal(field.bgm.voices.length, 1); assert.equal(field.bgm.voices[0]!.id, 2);
  assert.ok(audioPosition(field.bgm.voices[0]!, field.bgm.time, f.content.bgm!.tracks[1]!) < 0.1,
    "Replay must start the primary track once from zero");
  field.advance(1000);
  const checkpoint = field.checkpoint(), runtime = field.storyRuntimeSnapshot;
  const restored = FieldGame.restore(f.content, JSON.parse(JSON.stringify(checkpoint)));
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.deepEqual(restored.storyRuntimeSnapshot, runtime);
  const restoredVoiceId = restored.bgm.voices[0]!.id;
  restored.advance(1000);
  assert.equal(restored.bgm.voices[0]!.id, restoredVoiceId);
  assert.equal(flag(restored, 20), 0); assert.equal(restored.storyRuntimeSnapshot!.timer.active, null);
});

test("saved active timer keeps its exact origin callback and can publish it only once after restore", () => {
  const f = fixture([timer(Math.fround(0.05)), exit]);
  f.field.startEvent("story");
  const checkpoint = f.field.checkpoint(), before = canonical(checkpoint);
  const restored = FieldGame.restore(f.content, JSON.parse(JSON.stringify(checkpoint)));
  runUntil(restored, () => flag(restored, 20) === 1);
  const settled = restored.storyRuntimeSnapshot!.timer.active!;
  assert.equal(settled.dispatched, true);
  const revision = restored.storyRuntimeSnapshot!.timer.revision;
  restored.advance(1000);
  assert.equal(flag(restored, 20), 1); assert.equal(restored.storyRuntimeSnapshot!.timer.revision, revision);
  assert.equal(restored.eventState.read({ category: "ScenarioVariable", index: 7 }), 1,
    "The restored timeout callback must execute once, including its actual state mutation");
  assert.equal(canonical(f.field.checkpoint()), before, "Restoring and continuing cannot mutate the former field owner");
});

test("missing story marker cannot grant timer or screen execution and a save cannot add its own permission", () => {
  for (const op of [timer(), color(0), flash]) {
    const f = fixture([op, setFlag(11), exit], false), before = f.field.bgm.snapshot();
    f.field.startEvent("story");
    assert.equal(f.field.stop?.kind, "unsupported"); assert.equal(flag(f.field, 11), 0);
    assert.deepEqual(f.field.bgm.snapshot(), before);
    assert.equal(f.field.storyRuntimeSnapshot, null);
  }
  const f = fixture([timer(), exit]); f.field.startEvent("story");
  const checkpoint = f.field.checkpoint(), forbidden = structuredClone(f.content);
  delete forbidden.developmentProfile!.storyRuntime;
  // This is deliberately an inconsistent trusted content tree. The save's
  // self-declared runtime does not authorize a profile marker even if pinned.
  assert.throws(() => FieldGame.restore(forbidden, checkpoint));
});

test("a forged timer callback source fails restoration without changing the current owner", () => {
  const f = fixture([timer(), exit]); f.field.startEvent("story");
  const checkpoint = f.field.checkpoint(), before = canonical(checkpoint), forged = structuredClone(checkpoint);
  const saved = forged as typeof forged & { storyRuntime: NonNullable<FieldGame["storyRuntimeSnapshot"]> };
  saved.storyRuntime.timer.active!.binding.callback.source.objectId = "9007199254740997";
  assert.throws(() => FieldGame.restore(f.content, forged), /binding|source|mismatch/i);
  assert.equal(canonical(f.field.checkpoint()), before);
});

test("opaque replay blocks stable saves and reaches its event-save barrier only after the next logical clock", () => {
  const f = fixture([replay, { kind: "event-save" }, setFlag(11), exit]); f.field.startEvent("story");
  assert.equal(flag(f.field, 11), 0); assert.equal(f.field.bgm.voices.length, 0);
  assert.equal(f.field.eventSaveRequest, null);
  assert.throws(() => f.field.checkpoint());
  const stopped = f.field.bgm.snapshot(); f.field.advance(10);
  assert.ok(f.field.eventSaveRequest);
  const request = f.field.eventSaveRequest;
  const saved = f.field.eventCheckpoint(request);
  assert.equal(saved.bgm.voices[0]!.id, stopped.nextId);
  assert.equal(flag(f.field, 11), 0); assert.equal(f.field.bgm.voices.length, 1);
  assert.equal(f.field.bgm.voices[0]!.id, stopped.nextId);
  f.field.acknowledgeEventSave(request);
  f.field.advance(10); assert.equal(flag(f.field, 11), 1); assert.equal(f.field.bgm.voices[0]!.id, stopped.nextId);
});

test("the real UI audioProjection removes paused voices and resumes through the actual AudioOutput node lifecycle", async () => {
  const sourceJS = await readFile(resolve(process.cwd(), "apps/game/audio.js"), "utf8");
  const localCore = pathToFileURL(fileURLToPath(new URL("../src/core/static-audio.js", import.meta.url))).href;
  const boundJS = sourceJS.replace('"/runtime/core/static-audio.js"', JSON.stringify(localCore));
  assert.notEqual(boundJS, sourceJS);
  const { audioProjection, AudioOutput } = await import("data:text/javascript;base64," + Buffer.from(boundJS).toString("base64"));
  const f = fixture([pause, exit]);
  const starts: number[][] = [], sources: { stopped: number; start(...args: number[]): void; stop(): void;
    connect(): void; disconnect(): void }[] = [];
  const gain = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(value: number) { this.value = value; },
    linearRampToValueAtTime() {} });
  const output = new AudioOutput();
  output.context = { currentTime: 0, resume: async () => {}, suspend: async () => {},
    createGain: () => ({ gain: gain(), connect() {}, disconnect() {} }), createBufferSource: () => {
      const node = { stopped: 0, start(...args: number[]) { starts.push(args); }, stop() { this.stopped++; }, connect() {}, disconnect() {} };
      sources.push(node); return node;
    } };
  output.master = output.context.createGain();
  output.buffers.set(f.content.bgm!.tracks[1]!.sha256, { duration: 10, numberOfChannels: 2 });
  output.project(audioProjection(f.field), true); assert.equal(sources.length, 1);
  f.field.startEvent("story");
  assert.deepEqual(audioProjection(f.field), []);
  output.project(audioProjection(f.field), true); assert.equal(sources[0]!.stopped, 1);
  f.field.bgm.advance(5000, f.content.bgm); f.field.bgm.pause(0, false, 0, f.content.bgm);
  output.project(audioProjection(f.field), true);
  assert.equal(sources.length, 2); assert.equal(starts.length, 2);
  assert.equal(starts[1]![1], 0, "The paused logical sample position reaches the actual output start");
});

test("an active color filter can fork a private candidate but cannot be forged into a stable save", () => {
  const active = fixture([color(-1), exit]); active.field.startEvent("story");
  const seed = active.field.storyRuntimeSnapshot!;
  assert.ok(seed.colorFilter!.tween); assert.throws(() => active.field.checkpoint());
  const fork = new FieldGame(active.content, EventState.initialized(), undefined, undefined, { storyRuntimeSeed: seed });
  assert.deepEqual(fork.storyRuntimeSnapshot, seed);
  const before = canonical(active.field.storyRuntimeSnapshot); fork.advance(10);
  assert.equal(canonical(active.field.storyRuntimeSnapshot), before);
  const stable = fixture([exit]), saved = stable.field.checkpoint();
  if (!("storyRuntime" in saved)) throw new Error("Expected declared story checkpoint");
  saved.storyRuntime.colorFilter = structuredClone(seed.colorFilter);
  const oldOwner = canonical(stable.field.checkpoint());
  assert.throws(() => FieldGame.restore(stable.content, saved), /active|color|filter/i);
  assert.equal(canonical(stable.field.checkpoint()), oldOwner);
});

test("runtime projections and trusted timer origin inspection cannot mutate their field owner", () => {
  const f = fixture([timer(), exit]); f.field.startEvent("story");
  const before = canonical(f.field.storyRuntimeSnapshot), origin = canonical(f.field.storyTimerOrigin);
  const exposed = f.field.storyTimerOrigin!;
  exposed.scripts.expired![0]!.source.objectId = "9007199254740999";
  const snapshot = f.field.storyRuntimeSnapshot!; snapshot.timer.active!.elapsedMs = 999;
  snapshot.colorFilter!.color.r = 1;
  const projection = f.field.timerProjection!; projection.remainingMs = 0;
  const overlay = f.field.colorFilter!; overlay.a = 1;
  assert.equal(canonical(f.field.storyTimerOrigin), origin);
  assert.equal(canonical(f.field.storyRuntimeSnapshot), before);
  assert.notEqual(f.field.timerProjection!.remainingMs, 0); assert.equal(f.field.colorFilter!.a, 0);
});
