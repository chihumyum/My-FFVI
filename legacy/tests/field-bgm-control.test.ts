import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldBgmControlInstruction } from "../src/compiler/field-bgm-control.js";
import { StaticAudioState, audioGain, audioPosition, audioVoicePlaying,
  type AudioMedia } from "../src/core/static-audio.js";

const source = { file: "synthetic", assetPath: "bgm-control" };
const track = { file: "synthetic.flac", sha256: "synthetic", sampleRate: 1000, frames: 10000,
  channels: 2, loop: null, source, tableSource: source };
const media: AudioMedia = { sourceSetHash: "synthetic", tracks: {
  1: track, 2: { ...track, loop: { start: 2000, end: 8000 } },
} };
const raw = (mnemonic: string, ints: number[] = [], reals: number[] = []) => ({ mnemonic, type: 1,
  operands: { iValues: Array.from({ length: 8 }, (_, i) => ints[i] ?? 0),
    rValues: Array.from({ length: 8 }, (_, i) => reals[i] ?? 0), sValues: Array(8).fill("") } });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("PauseBGM decodes its suspend bool and ReplayBgm fixes primary rather than guessing asynchronous semantics", () => {
  for (const fade of [0, 0.35, 0.7]) for (const paused of [false, true]) {
    assert.deepEqual(compileFieldBgmControlInstruction(raw("PauseBGM", [0, Number(paused)], [fade])),
      { kind: "bgm-pause", channel: 0, paused, fade: Math.fround(fade), policy: "web-static-audio-control-v1" });
  }
  assert.deepEqual(compileFieldBgmControlInstruction(raw("ReplayBgm")),
    { kind: "bgm-replay", channel: 0, fade: 0, policy: "web-static-audio-control-v1" });
  for (const instruction of [raw("PauseBGM", [2, 1]), raw("PauseBGM", [0, -1]),
    raw("PauseBGM", [0, 1, 9]), raw("ReplayBgm", [1]), raw("ReplayBgm", [], [-1]),
    raw("PauseBGM", [0, 1], [1e50]), { ...raw("PauseBGM", [0, 1]), type: 2 }])
    assert.throws(() => compileFieldBgmControlInstruction(instruction));
});

test("pausing fades then freezes sample position while field time and the other channel continue", () => {
  const state = new StaticAudioState(), id = state.play(2, 0, 0, 0, media);
  state.play(1, 1, 0, 0, media); state.advance(3000, media);
  state.pause(0, true, 0.35, media); state.advance(175, media);
  near(audioGain(state.voices[0]!, state.time, media.tracks[2]!), 0.5);
  assert.equal(audioVoicePlaying(state.voices[0]!, state.time), true);
  state.advance(175, media);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 3.35);
  assert.equal(audioGain(state.voices[0]!, state.time, media.tracks[2]!), 0);
  assert.equal(audioVoicePlaying(state.voices[0]!, state.time), false);
  state.advance(12000, media);
  assert.equal(state.voices.length, 1); assert.equal(state.voices[0]!.id, id);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 3.35);
  state.pause(0, false, 0.35, media);
  assert.equal(audioVoicePlaying(state.voices[0]!, state.time), true);
  state.advance(350, media);
  near(audioGain(state.voices[0]!, state.time, media.tracks[2]!), 1);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 3.7);
});

test("a paused looping track resumes its original samples without replaying the introduction", () => {
  const state = new StaticAudioState(); state.play(2, 0, 0, 7.75, media); state.advance(500, media);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 2.25);
  state.pause(0, true, 0, media); state.advance(100000, media);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 2.25);
  state.pause(0, false, 0, media); state.advance(1000, media);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 3.25);
});

test("failed play, resume or replay media never modifies an existing paused track", () => {
  const state = new StaticAudioState(); state.play(2, 0, 0, 0, media); state.pause(0, true, 0, media);
  const before = state.snapshot();
  for (const call of [() => state.play(999, 0, 0, 0, media), () => state.pause(0, false, 0),
    () => state.beginReplay(0, 0), () => state.play(1, 0, -1, 0, media)]) {
    assert.throws(call); assert.deepEqual(state.snapshot(), before);
  }
});

test("old saves retain their exact shape and paused saves require the explicit new policy", () => {
  const state = new StaticAudioState(); state.play(2, 0, 0, 0, media); state.advance(2000, media);
  const old = state.snapshot(); assert.deepEqual(Object.keys(old).sort(), ["channels", "nextId", "time", "voices"]);
  assert.deepEqual(StaticAudioState.restore(old, media).snapshot(), old);
  state.pause(0, true, 0, media); state.advance(20000, media);
  const saved = state.snapshot(), restored = StaticAudioState.restore(saved, media);
  assert.equal(saved.formatVersion, 2); assert.equal(saved.policy, "web-static-audio-control-v1");
  assert.deepEqual(restored.snapshot(), saved);
  restored.advance(100000, media);
  near(audioPosition(restored.voices[0]!, restored.time, media.tracks[2]!), 2);
  const undeclared = structuredClone(saved); delete undeclared.formatVersion; delete undeclared.policy;
  assert.throws(() => StaticAudioState.restore(undeclared, media), /Undeclared/);
  assert.throws(() => StaticAudioState.restore({ ...saved, policy: "invented" } as never, media), /policy/);
});

test("ReplayBgm stops first, starts from zero on the next clock and consumes its request once", () => {
  const state = new StaticAudioState(), old = state.play(2, 0, 0, 0, media);
  state.advance(5000, media);
  const replay = state.beginReplay(0, 0.7, media)!;
  assert.equal(replay.track, 2); assert.equal(state.snapshot().channels[0], null); assert.equal(state.voices.length, 0);
  const stopped = state.snapshot();
  assert.throws(() => state.finishReplay(replay, media), /following logical clock/);
  assert.deepEqual(state.snapshot(), stopped);
  state.advance(10, media); const id = state.finishReplay(replay, media);
  assert.equal(id, old + 1); near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 0);
  const restarted = state.snapshot();
  assert.throws(() => state.finishReplay(replay, media), /consumed/);
  assert.deepEqual(state.snapshot(), restarted);
});

test("a replay is owner-bound, retryable on missing media and stale after a new same-channel operation", () => {
  for (const interrupt of ["stop", "play", "pause"] as const) {
    const state = new StaticAudioState(); state.play(2, 0, 0, 0, media);
    const replay = state.beginReplay(0, 0, media)!; state.advance(10, media);
    assert.throws(() => new StaticAudioState(state.snapshot()).finishReplay(replay, media), /Stale/);
    assert.throws(() => state.finishReplay({ ...replay }, media), /Stale/);
    if (interrupt === "stop") state.stop(0, 0);
    if (interrupt === "play") state.play(1, 0, 0, 0, media);
    if (interrupt === "pause") state.pause(0, true, 0, media);
    const before = state.snapshot(); assert.throws(() => state.finishReplay(replay, media), /Stale/);
    assert.deepEqual(state.snapshot(), before);
  }
  const state = new StaticAudioState(); state.play(2, 0, 0, 0, media);
  const replay = state.beginReplay(0, 0, media)!; state.advance(10, media);
  const before = state.snapshot(); assert.throws(() => state.finishReplay(replay), /Missing audio/);
  assert.deepEqual(state.snapshot(), before);
  state.play(1, 1, 0, 0, media); // Other channels do not invalidate the request.
  assert.equal(state.finishReplay(replay, media), 3);
});

test("same-track play resumes the current paused identity and stop never resurrects it", () => {
  const state = new StaticAudioState(), first = state.play(2, 0, 0, 0, media);
  state.advance(2500, media); state.pause(0, true, 0, media); state.advance(50000, media);
  assert.equal(state.play(2, 0, 0, 0, media), first);
  near(audioPosition(state.voices[0]!, state.time, media.tracks[2]!), 2.5);
  state.pause(0, true, 0, media); state.stop(0, 0.5); state.advance(500, media);
  assert.equal(state.voices.length, 0);
  assert.equal(state.beginReplay(0, 0, media), null);
  assert.equal(state.play(2, 0, 0, 0, media), first + 1);
});
