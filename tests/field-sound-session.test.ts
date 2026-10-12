import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { FieldGame } from "../src/core/field.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../src/core/game-session.js";
import type { ScriptLocals } from "../src/core/event-state.js";
import type { AudioMedia } from "../src/core/static-audio.js";
import type { Op, Site } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const source = { file: "controlled", assetPath: "field-sound-session" },
  site: Site = { script: "audio", index: 0, source },
  flag = { category: "ScenarioFlag1" as const, index: 12 },
  local = (index = 0) => ({ category: "ScriptLocalVariable" as const, index });
const media: AudioMedia = { sourceSetHash: "controlled-se-source", tracks: Object.fromEntries(
  [[1, 100, null], [2, 1000, { start: 0, end: 1000 }], [3, 5, null]].map(([id, frames, loop]) => [id, {
    file: `/controlled/se-${id}.flac`, sha256: `controlled-se-${id}`, sampleRate: 1000, frames,
    channels: 1, loop, source, tableSource: source,
  }]),
) as AudioMedia["tracks"] };
const decode = (mnemonic: string, ints: number[] = [], reals: number[] = []): Op => decodeFieldOp({
  type: 1, mnemonic, operands: { iValues: [...ints, ...Array<number>(8 - ints.length).fill(0)],
    rValues: [...reals, ...Array<number>(8 - reals.length).fill(0)], sValues: Array<string>(8).fill("") },
}, site, {});
const play = (id = 1, asynchronous = true, slot = 0, fade = 0, seek = 0, pan = 0) =>
  decode("PlaySE", [id, Number(asynchronous), slot], [fade, seek, pan]);
const stop = (slot = 0, fade = 0) => decode("StopSE", [slot], [fade]);
const sync = (slot = 0) => decode("SyncSE", [slot]);
const ready = (id = 1) => decode("ReadySE", [id]);
const exit: Op = { ...site, kind: "exit" },
  mark: Op = { ...site, kind: "flag", ref: flag, operation: "set" },
  wait: Op = { ...site, kind: "wait", seconds: 0 };
const instructions = (ops: readonly Op[], name = "audio") => ops.map((op, index) => ({ ...op, script: name, index }));
const locals = (): ScriptLocals => ({ labels: ["first", "second"], values: [0, 0] });
const audioHost = (isReady: () => boolean = () => true, isPresented: () => boolean = () => true): GameSessionRuntime =>
  ({ audioReadiness: { isReady }, soundPresentation: { isPresented } });

/** Real session/world owners and decoder, with synthetic content and a
 * controlled readiness port. These checks do not execute the original game. */
function fixture(ops: readonly Op[], options: { locals?: ScriptLocals | null; runtime?: GameSessionRuntime } = {}) {
  const f = checkpointFixture(), runtime = options.runtime ?? audioHost();
  f.field.se = structuredClone(media); f.world.se = structuredClone(media);
  f.field.scripts.audio = instructions(ops);
  f.field.scriptLocals = { audio: options.locals === undefined ? locals() : options.locals };
  const game = new GameSession(f.field, f.battle, 314, runtime);
  game.field.eventState.write(flag, 0);
  const start = () => { assert.equal(game.field.startEvent("audio"), true); };
  const target = (targetOps: readonly Op[], targetLocals: ScriptLocals | null = locals()) => {
    f.target.scripts.audio = instructions(targetOps);
    f.target.scriptLocals.audio = targetLocals;
    f.target.initializer = "audio";
    return f.target;
  };
  const restore = (saved: GameCheckpoint, destination = false, host = runtime) => GameSession.restore(saved,
    f.field, f.battle, destination ? { catalog: f.world, map: f.target } : undefined, host);
  return { ...f, game, runtime, start, target, restore };
}

function owners(game: GameSession) {
  return { sound: game.field.se.snapshot(), events: game.field.eventState.snapshot(), owned: game.state.snapshot(),
    player: { x: game.field.player.x, y: game.field.player.y }, bgm: game.field.bgm.snapshot(),
    time: game.field.time };
}

test("decoded synchronous Play waits its first clock, owns its handle and never writes the i2 local slot", () => {
  const t = fixture([play(3, false, 0x7fffffff), mark, exit], { locals: null });
  assert.equal(t.field.scripts.audio![0]!.kind, "field-sound");
  t.start();
  assert.equal(t.game.field.stop, null);
  assert.equal(t.game.field.time, 0);
  assert.equal(t.game.field.busy, true);
  assert.equal(t.game.field.eventState.read(flag), 0);
  assert.equal(t.game.field.eventState.snapshot().script, null);
  assert.equal(t.game.field.se.voices.length, 1);
  assert.equal(t.game.checkpointReady, false);
  t.game.advance(10);
  assert.equal(t.game.field.stop, null);
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.field.eventState.snapshot().script, null);
  assert.equal(t.game.checkpointReady, true);
});

test("async Play overwrites the current local handle but keeps overlapping prior instances alive", () => {
  const t = fixture([play(2), play(2), mark, exit]); t.start();
  assert.equal(t.game.field.stop, null);
  assert.equal(t.game.field.eventState.read(local()), 2);
  assert.deepEqual(t.game.field.se.voices.map(voice => voice.id), [1, 2]);
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.checkpointReady, true);
  const original = t.game.field.se.snapshot();
  t.game.field.content.scripts.stop = instructions([stop(), exit], "stop");
  t.game.field.content.scriptLocals!.stop = null;
  assert.equal(t.game.field.startEvent("stop"), true);
  assert.equal(t.game.field.se.isPlaying(1), true);
  assert.equal(t.game.field.se.isPlaying(2), false);
  assert.equal(t.game.field.eventState.read(local()), 2, "Stop must not clear a ScriptLocalVariable");
  assert.equal(t.game.field.se.voices[0]!.started, original.voices[0]!.started);
});

test("Sync re-reads the current local slot at every poll instead of pinning its original handle", () => {
  const t = fixture([play(1, true, 0), play(2, true, 1), sync(), mark, exit]); t.start();
  assert.equal(t.game.field.eventState.read(local()), 1);
  t.game.advance(20);
  // The same EventState is also the owner used by concurrent script Calc.
  t.game.field.eventState.write(local(), t.game.field.eventState.read(local(1)));
  t.game.advance(100);
  assert.equal(t.game.field.se.isPlaying(1), false);
  assert.equal(t.game.field.se.isPlaying(2), true);
  assert.equal(t.game.field.eventState.read(flag), 0);
  t.game.field.eventState.write(local(), 0);
  t.game.advance(10);
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.field.se.isPlaying(2), true);
});

test("StopSE keeps Sync waiting through the dynamic fade and never clears the saved handle slot", () => {
  const t = fixture([play(2), stop(0, 0.05), sync(), mark, exit]); t.start();
  assert.equal(t.game.field.stop, null);
  assert.equal(t.game.field.eventState.read(flag), 0);
  t.game.advance(40);
  assert.equal(t.game.field.eventState.read(flag), 0);
  assert.equal(t.game.field.se.isPlaying(1), true);
  t.game.advance(20); // source Single .05 can be just above exactly 50 milliseconds
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.field.se.isPlaying(1), false);
  assert.equal(t.game.field.eventState.read(local()), 1);
});

test("ReadySE publishes an isolated pending dependency and neither plays a voice nor writes a handle", () => {
  let loaded = false;
  const t = fixture([ready(2), mark, exit], { runtime: audioHost(() => loaded) }); t.start();
  assert.equal(t.game.field.stop, null);
  assert.equal(t.game.field.eventState.read(flag), 0);
  assert.deepEqual(t.game.field.pendingAudioTracks, [media.tracks[2]]);
  t.game.field.pendingAudioTracks[0]!.file = "changed";
  assert.equal(t.game.field.pendingAudioTracks[0]!.file, media.tracks[2]!.file);
  t.game.advance(40);
  assert.equal(t.game.field.se.voices.length, 0);
  assert.equal(t.game.field.eventState.read(local()), 0);
  loaded = true; t.game.advance(10);
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.deepEqual(t.game.field.pendingAudioTracks, []);
  assert.equal(t.game.field.se.voices.length, 0);
});

test("an undecoded short SE freezes the entire field clock and cannot expire while downloading", () => {
  let loaded = false;
  const t = fixture([play(3, false), mark, exit], { runtime: audioHost(() => loaded) });
  t.game.field.bgm.play(1, 0, 0, 0, t.field.bgm); t.start();
  const before = owners(t.game);
  t.game.advance(1000);
  assert.deepEqual(owners(t.game), before);
  assert.equal(t.game.field.se.isPlaying(1), true);
  assert.equal(t.game.field.eventState.read(flag), 0);
  loaded = true; t.game.advance(10);
  assert.equal(t.game.field.time, 10);
  assert.equal(t.game.field.se.time, 10);
  assert.equal(t.game.field.bgm.time, 10);
  assert.equal(t.game.field.eventState.read(flag), 1);
});

test("missing host, local bank, local slot or media blocks before a voice or local write is published", () => {
  for (const mode of ["host", "presentation", "bank", "slot", "media"] as const) {
    const t = fixture([wait, play(1, true, mode === "slot" ? 9 : 0), mark, exit], {
      ...(mode === "host" ? { runtime: {} } : {}),
      ...(mode === "presentation" ? { runtime: { audioReadiness: { isReady: () => true } } } : {}),
      ...(mode === "bank" ? { locals: null } : {}),
    });
    if (mode === "media") delete t.field.se!.tracks[1];
    t.start(); const events = t.game.field.eventState.snapshot(), owned = t.game.state.snapshot();
    t.game.advance(10);
    assert.equal(t.game.field.stop?.kind, "unsupported", mode);
    assert.match(t.game.field.stop!.message, /provider|host|bank|media/, mode);
    assert.equal(t.game.field.se.voices.length, 0, mode);
    assert.equal(t.game.field.se.snapshot().nextId, 1, mode);
    assert.deepEqual(t.game.field.eventState.snapshot(), events, mode);
    assert.deepEqual(t.game.state.snapshot(), owned, mode);
  }
});

test("a failed readiness observation cannot advance a short sound or execute its waiting successor", () => {
  const t = fixture([play(3, false), mark, exit], { runtime: audioHost(() => {
    throw new Error("Controlled SE decode rejected");
  }) }); t.start();
  const before = owners(t.game);
  t.game.advance(10);
  assert.equal(t.game.field.stop?.kind, "unsupported");
  assert.match(t.game.field.stop!.message, /decode rejected/);
  assert.deepEqual(owners(t.game), before);
});

test("active SE and its local handle survive a stable GameSession JSON checkpoint without replaying Play", () => {
  const t = fixture([play(2, true, 0, 0.2, 0.1, -0.5), exit]); t.start(); t.game.advance(30);
  assert.equal(t.game.checkpointReady, true);
  const saved = JSON.parse(JSON.stringify(t.game.checkpoint())) as GameCheckpoint;
  assert.equal(saved.formatVersion, 5); assert.equal(saved.owned.formatVersion, 12);
  assert.equal(saved.world.kind, "idle-world-v10"); assert.equal(saved.world.field.kind, "idle-field-v10");
  const restored = t.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.field.eventState.read(local()), 1);
  assert.equal(restored.field.se.isPlaying(1), true);
  assert.equal(restored.field.soundExecutions.length, 0, "restoration is not script replay");
  assert.notEqual(restored.field.se, t.game.field.se);
  for (const game of [t.game, restored]) game.advance(30);
  assert.deepEqual(restored.checkpoint(), t.game.checkpoint());
  delete t.field.se!.tracks[2];
  assert.throws(() => t.restore(saved), /Missing field sound media/);
  assert.equal(restored.field.se.isPlaying(1), true, "failed restore must not alter an existing session");
});

test("map candidate SE and local writes stay private until commit, then persist through world restore", () => {
  const t = fixture([play(2), exit]); t.start();
  const target = t.target([play(2), mark, exit]);
  t.game.field.eventState.write(flag, 0); t.game.field.previewMap(2, 1);
  const current = t.game.field, before = owners(t.game), pending = t.game.world.prepare(t.world, target);
  assert.notEqual(pending.field.se, current.se);
  assert.equal(pending.field.se.voices.length, 2);
  assert.equal(pending.field.eventState.read(local()), 2);
  assert.equal(pending.field.eventState.read(flag), 1);
  assert.deepEqual(owners(t.game), before);
  assert.equal(t.game.world.commit(pending), true);
  assert.equal(t.game.field, pending.field);
  assert.deepEqual(current.se.snapshot(), before.sound);
  t.game.advance(10);
  assert.equal(t.game.checkpointReady, true);
  const saved = t.game.checkpoint();
  assert.deepEqual(t.restore(saved, true).checkpoint(), saved);
});

test("discarded, failed and stale map candidates cannot leak sound handles or locals into the current session", () => {
  for (const mode of ["discarded", "failed", "stale"] as const) {
    const t = fixture([play(2), exit]); t.start();
    const target = t.target([play(2), mode === "failed"
      ? { ...site, kind: "blocked", mnemonic: "ControlledFailure", reason: "Controlled SE entry failure" }
      : exit]);
    t.game.field.previewMap(2, 1);
    const current = t.game.field;
    let before = owners(t.game);
    if (mode === "failed") assert.throws(() => t.game.world.prepare(t.world, target), /SE entry failure/);
    else {
      const pending = t.game.world.prepare(t.world, target);
      assert.deepEqual(owners(t.game), before);
      if (mode === "discarded") t.game.world.discard(pending);
      else { current.se.stop(1, 0.5); before = owners(t.game); }
      assert.equal(t.game.world.commit(pending), false, mode);
    }
    assert.equal(t.game.field, current, mode);
    assert.deepEqual(owners(t.game), before, mode);
    assert.equal(current.eventState.read(local()), 1, mode);
  }
});

test("changed or missing carried SE media rejects map preparation without publishing candidate state", () => {
  for (const mode of ["changed", "missing"] as const) {
    const t = fixture([play(2), exit]); t.start();
    const target = t.target([exit]); t.game.field.previewMap(2, 1);
    if (mode === "changed") t.world.se!.sourceSetHash = "different-se-source";
    else delete t.world.se!.tracks[2];
    const current = t.game.field, before = owners(t.game);
    assert.throws(() => t.game.world.prepare(t.world, target), /SE media changed|Missing field sound media/);
    assert.equal(t.game.field, current);
    assert.deepEqual(owners(t.game), before);
  }
});

test("a committed map keeps its pending SE readiness and cannot consume a short voice before decoding", () => {
  let loaded = false;
  const t = fixture([exit], { runtime: audioHost(() => loaded) });
  const target = t.target([play(3, false), mark, exit]); t.game.field.previewMap(2, 1);
  const pending = t.game.world.prepare(t.world, target);
  assert.equal(pending.field.busy, true);
  assert.equal(pending.field.se.isPlaying(1), true);
  assert.equal(t.game.world.commit(pending), true);
  const before = owners(t.game); t.game.advance(1000);
  assert.deepEqual(owners(t.game), before);
  loaded = true; t.game.advance(10);
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.field.se.voices.length, 0);
  assert.equal(t.game.checkpointReady, true);
});

test("decoded SE waits for presentation ACK even inside a multi-tick frame, then expires normally", () => {
  let presented = false;
  const t = fixture([wait, play(3, false), mark, exit], { runtime: audioHost(() => true, () => presented) });
  t.start(); t.game.advance(50);
  assert.equal(t.game.field.time, 10, "the first tick may start a sound; later ticks wait for its first output");
  assert.equal(t.game.field.se.time, 10);
  assert.equal(t.game.field.se.isPlaying(1), true);
  assert.equal(t.game.field.eventState.read(flag), 0);
  const before = owners(t.game); t.game.advance(1000);
  assert.deepEqual(owners(t.game), before);
  presented = true; t.game.advance(10);
  assert.equal(t.game.field.eventState.read(flag), 1);
  assert.equal(t.game.field.se.isPlaying(1), false);
  assert.equal(t.game.field.time, 20);
});
