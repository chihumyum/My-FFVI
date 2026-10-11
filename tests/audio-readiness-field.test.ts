import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { EventState } from "../src/core/event-state.js";
import { FieldGame } from "../src/core/field.js";
import { GameSession } from "../src/core/game-session.js";
import type { AudioReadinessPort } from "../src/core/audio-readiness.js";
import type { Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const source = { file: "controlled", assetPath: "audio-readiness-field" },
  site = { script: "audio", index: 0, source },
  ref = { category: "ScenarioFlag1" as const, index: 12 };
function decode(mnemonic: string, id: number): Op {
  return decodeFieldOp(
    {
      type: 1,
      mnemonic,
      operands: {
        iValues: [id, 0, 0, 0, 0, 0, 0, 0],
        rValues: Array<number>(8).fill(0),
        sValues: Array<string>(8).fill(""),
      },
    },
    site,
    {},
  );
}
const ready = () => decode("ReadyBGM", 1),
  sync = (channel = 0) => decode("SyncBGM", channel);
function fixture(op: Op, port?: AudioReadinessPort) {
  const f = checkpointFixture();
  f.field.scripts.audio = [
    op,
    { ...site, index: 1, kind: "flag", ref, operation: "set" },
    { ...site, index: 2, kind: "exit" },
  ];
  f.field.bgm!.tracks[2] = {
    ...structuredClone(f.field.bgm!.tracks[1]!),
    sha256: "controlled-nonloop",
    file: "controlled-nonloop.flac",
    frames: 100,
    loop: null,
  };
  const state = EventState.initialized(),
    field = new FieldGame(
      f.field,
      state,
      undefined,
      undefined,
      port ? { audioReadiness: port } : {},
    );
  return { ...f, host: field };
}

test("real field decoder retains Ready task and dependency until an explicit completion observation", () => {
  let loaded = false;
  const f = fixture(ready(), { isReady: () => loaded }),
    field = f.host;
  assert.equal(ready().kind, "bgm-ready");
  assert.equal(field.startEvent("audio"), true);
  assert.equal(field.stop, null);
  assert.equal(field.busy, true);
  assert.equal(field.eventState.read(ref), 0);
  assert.equal(field.checkpointReady, false);
  assert.throws(() => field.checkpoint(), /Cannot save/);
  assert.deepEqual(field.pendingBgmTracks, [f.field.bgm!.tracks[1]]);
  field.pendingBgmTracks[0]!.file = "changed";
  assert.notEqual(field.pendingBgmTracks[0]!.file, "changed");
  field.advance(30);
  assert.equal(field.eventState.read(ref), 0);
  loaded = true;
  field.advance(10);
  assert.equal(field.busy, false);
  assert.equal(field.eventState.read(ref), 1);
  assert.equal(field.bgm.voices.length, 0);
  assert.deepEqual(field.pendingBgmTracks, []);
  assert.equal(field.checkpointReady, true);
});

test("an already ready resource and an empty Sync complete synchronously with no invented frame", () => {
  for (const [op, port] of [
    [ready(), { isReady: () => true }],
    [sync(), undefined],
  ] as const) {
    const field = fixture(op, port).host;
    field.startEvent("audio");
    assert.equal(field.time, 0);
    assert.equal(field.stop, null);
    assert.equal(field.busy, false);
    assert.equal(field.eventState.read(ref), 1);
    assert.equal(field.bgm.voices.length, 0);
  }
});

test("field Sync remains on the live channel across replacement and ends before its detached fade tail", () => {
  const f = fixture(sync()),
    field = f.host,
    media = f.field.bgm!;
  field.bgm.play(2, 0, 0, 0, media);
  field.startEvent("audio");
  field.advance(20);
  assert.equal(field.eventState.read(ref), 0);
  field.bgm.play(1, 0, 0, 0, media);
  field.advance(1000);
  assert.equal(field.busy, true);
  assert.equal(field.eventState.read(ref), 0);
  field.bgm.stop(0, 1);
  field.advance(10);
  assert.equal(field.busy, false);
  assert.equal(field.eventState.read(ref), 1);
  assert.equal(field.bgm.voices.length, 1);
  assert.ok(field.bgm.voices[0]!.stop);
});

test("Sync1 neither waits for channel0 nor completes because channel0 stopped", () => {
  const f = fixture(sync(1)),
    field = f.host;
  field.bgm.play(1, 0, 0, 0, f.field.bgm);
  field.bgm.play(2, 1, 0, 0, f.field.bgm);
  field.startEvent("audio");
  field.bgm.stop(0, 0);
  field.advance(90);
  assert.equal(field.eventState.read(ref), 0);
  field.advance(10);
  assert.equal(field.eventState.read(ref), 1);
  assert.equal(field.stop, null);
});

test("missing or failed resource providers stop before successor side effects", () => {
  const missing = fixture(ready()).host;
  missing.startEvent("audio");
  assert.equal(missing.stop?.kind, "unsupported");
  assert.match(missing.stop!.message, /provider/);
  assert.equal(missing.eventState.read(ref), 0);
  let failed = false;
  const field = fixture(ready(), {
    isReady: () => {
      if (failed) throw new Error("Controlled decoder rejected the asset");
      return false;
    },
  }).host;
  field.startEvent("audio");
  assert.equal(field.stop, null);
  failed = true;
  field.advance(10);
  const stopped = (field as FieldGame).stop;
  assert.equal(stopped?.kind, "unsupported");
  assert.match(stopped!.message, /decoder rejected/);
  assert.equal(field.eventState.read(ref), 0);
  assert.equal(field.checkpointReady, false);
});

test("GameSession restoration requires a new trusted readiness port rather than saved completion", () => {
  const f = fixture(ready()),
    game = new GameSession(f.field, f.battle, 314, {
      audioReadiness: { isReady: () => true },
    });
  game.field.eventState.write(ref, 0);
  const checkpoint = game.checkpoint();
  assert.doesNotMatch(
    JSON.stringify(checkpoint),
    /audioReadiness|pendingBgmTracks/,
  );
  const missing = GameSession.restore(checkpoint, f.field, f.battle);
  missing.field.startEvent("audio");
  assert.match(missing.field.stop!.message, /provider/);
  assert.equal(missing.field.eventState.read(ref), 0);
  let loaded = false;
  const port = { isReady: () => loaded },
    restored = GameSession.restore(checkpoint, f.field, f.battle, undefined, {
      audioReadiness: port,
    });
  assert.equal(restored.field.options.audioReadiness, port);
  restored.field.startEvent("audio");
  assert.equal(restored.checkpointReady, false);
  loaded = true;
  restored.advance(10);
  assert.equal(restored.field.eventState.read(ref), 1);
  assert.equal(restored.checkpointReady, true);
  assert.equal(game.field.eventState.read(ref), 0);
});

test("World candidate and restored map share the trusted port while loading leaves the current map unchanged", () => {
  let loaded = false;
  const port = { isReady: () => loaded },
    f = fixture(ready()),
    game = new GameSession(f.field, f.battle, 314, { audioReadiness: port });
  game.field.eventState.write(ref, 0);
  f.target.scripts.audio = f.field.scripts.audio!;
  f.target.initializer = "audio";
  game.field.previewMap(2, 1);
  const previous = game.field,
    before = previous.bgm.snapshot(),
    prepared = game.world.prepare(f.world, f.target);
  assert.equal(prepared.field.options.audioReadiness, port);
  assert.equal(prepared.field.busy, true);
  assert.equal(prepared.field.checkpointReady, false);
  assert.equal(prepared.field.pendingBgmTracks.length, 1);
  assert.equal(game.field, previous);
  assert.deepEqual(previous.bgm.snapshot(), before);
  assert.equal(previous.eventState.read(ref), 0);
  assert.equal(game.world.commit(prepared), true);
  assert.equal(game.field.options.audioReadiness, port);
  game.advance(10);
  assert.equal(game.field.eventState.read(ref), 0);
  loaded = true;
  game.advance(10);
  assert.equal(game.field.eventState.read(ref), 1);
  const saved = game.checkpoint(),
    restored = GameSession.restore(
      saved,
      f.field,
      f.battle,
      { catalog: f.world, map: f.target },
      { audioReadiness: port },
    );
  assert.equal(restored.field.options.audioReadiness, port);
  assert.deepEqual(restored.checkpoint(), saved);
});

test("failed candidate readiness cannot alter the current map audio or owned state", () => {
  const f = fixture(ready()),
    game = new GameSession(f.field, f.battle, 314, {
      audioReadiness: {
        isReady: () => {
          throw new Error("Controlled candidate load error");
        },
      },
    });
  f.target.scripts.audio = f.field.scripts.audio!;
  f.target.initializer = "audio";
  game.field.bgm.play(1, 0, 0, 0, f.field.bgm);
  game.field.previewMap(2, 1);
  const field = game.field,
    audio = field.bgm.snapshot(),
    owned = game.state.snapshot(),
    events = field.eventState.snapshot();
  assert.throws(
    () => game.world.prepare(f.world, f.target),
    /candidate load error/,
  );
  assert.equal(game.field, field);
  assert.deepEqual(field.bgm.snapshot(), audio);
  assert.deepEqual(field.eventState.snapshot(), events);
  assert.deepEqual(game.state.snapshot(), owned);
});
