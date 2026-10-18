import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "../../src/play/game.js";
import { compileMapAudio } from "../../tools/export/map-audio.mjs";
import { mapAudioCommands, legacySceneAudio } from "./scene-audio.js";
import { WebAudioPlayer } from "./audio.js";
import { withPresentation, observingAudioInstruction } from "./presentation-events.js";
const read = async (name) =>
  JSON.parse(await readFile(new URL(`../../build/web-data/${name}`, import.meta.url)));
const [data, battleData, tables] = await Promise.all(
  ["data.json", "battle.json", "raw/tables.json"].map(read),
);
test("all 649 source map audio bindings survive export, with every BGM/environment referencing a real PR track", () => {
  const mappings = compileMapAudio(tables["map.csv"]);
  assert.equal(Object.keys(mappings).length, 649);
  assert.equal(Object.values(mappings).filter((m) => m.bgmId > 0).length, 342);
  for (const [id, m] of Object.entries(mappings)) {
    assert.equal(data.maps[id].bgmId, m.bgmId, `map${id}`);
    assert.equal(data.maps[id].environmentId, m.environmentId, `map${id}`);
    if (m.bgmId) assert(data.audio.bgm.tracks[m.bgmId], `map${id} BGM${m.bgmId}`);
    if (m.environmentId)
      assert(data.audio.environment.tracks[m.environmentId], `map${id} env${m.environmentId}`);
  }
  assert.equal(mapAudioCommands(mappings[84]).find((c) => c.name === "PlayBGM").i[0], 21);
  assert(
    !mapAudioCommands(mappings[3]).some((c) => c.name === "PlayBGM"),
    "zero does not erase the initializer/previous scene music",
  );
});
test("BGM IDs retain the original PR bank names and every formation's configured battle song", () => {
  for (const row of tables["bgm_asset.csv"])
    assert.equal(data.audio.bgm.tracks[row.id]?.assetName, row.asset_name.trim(), `BGM${row.id}`);
  for (const row of tables["monster_party.csv"]) {
    const id = Number(row.battle_bgm_asset_id) || 0;
    assert.equal(battleData.parties[row.id]?.bgmId, id, `formation${row.id}`);
    if (id) assert(data.audio.bgm.tracks[id], `formation${row.id} BGM${id}`);
  }
});
test("old Narshe/Figaro saves recover actual flag-dependent initializer music without changing the saved game", async () => {
  for (const [mapId, cases] of [
    [
      3,
      [
        [{}, 0],
        [{ 11: 1 }, 3],
        [{ 11: 1, ruin: 1 }, 83],
      ],
    ],
    [
      21,
      [
        [{}, 8],
        [{ 17: 1 }, 9],
        [{ 23: 1 }, 44],
      ],
    ],
  ]) {
    const map = await read(`maps/${mapId}.json`);
    const host = new PlayGame({
      data,
      battleData,
      random: () => 0.5,
      loadMap: async () => structuredClone(map),
    });
    await host.enter(mapId, 1);
    for (const [flags, expected] of cases) {
      const saved = structuredClone(host.snapshot());
      saved.banks.ScenarioFlag1 = { ...saved.banks.ScenarioFlag1, ...flags };
      saved.banks.ScenarioFlag2 = { ...saved.banks.ScenarioFlag2, 41: flags.ruin || 0 };
      const before = structuredClone(saved),
        commands = await legacySceneAudio(saved, { data, battleData, map, warn: () => {} });
      const cue = commands.filter((c) => ["PlayBGM", "StopBGM"].includes(c.name)).at(-1);
      assert.equal(
        cue?.name === "StopBGM" ? 0 : cue?.i[0],
        expected,
        `map${mapId} flags${JSON.stringify(flags)}`,
      );
      assert.deepEqual(saved, before);
    }
  }
});
test("an environment stop cancels a request still waiting for audio unlock", async () => {
  let unlock;
  const player = new WebAudioPlayer();
  player.catalog = { environment: { tracks: { 1: { file: "test.opus" } } } };
  player.unlock = () =>
    new Promise((r) => {
      unlock = r;
    });
  player.effectBuffer = () => {
    throw Error("cancelled environment must not decode/play");
  };
  const pending = player.playEffect("environment", 1, { slot: 0 });
  player.stopEffects("environment");
  unlock();
  await pending;
  assert.equal(player.environments.size, 0);
});
test("music snapshot retains requested next music instead of the previous decoded voice", () => {
  const player = new WebAudioPlayer();
  player.current = { id: 7 };
  player.requestedMusic = { id: 8, offset: 21 };
  assert.deepEqual(player.musicState(), { id: 8, offset: 21 });
  player.requestedMusic = null;
  assert.equal(player.musicState(), null);
});
test("playable saves retain the selected BGM and ambience cursors, separate from audio diagnostics", async () => {
  const player = new WebAudioPlayer();
  player.requestedMusic = { id: 19, offset: 17.25 };
  player.savedMusic = { id: 8, offset: 3 };
  player.environments.set(0, { id: 1, paused: true, savedOffset: 2.5 });
  const saved = player.saveState();
  assert.deepEqual(saved, {
    version: 1,
    music: { id: 19, offset: 17.25 },
    savedMusic: { id: 8, offset: 3 },
    environments: [{ slot: 0, id: 1, paused: true, offset: 2.5 }],
  });
  assert(!("version" in player.snapshot()), "diagnostic snapshots are not playable audio state");
  const restored = new WebAudioPlayer(),
    calls = [];
  restored.playMusic = async (id, options) => calls.push(["music", id, options]);
  restored.playEffect = async (kind, id, options) => calls.push([kind, id, options]);
  restored.command = (command) => calls.push(command);
  await restored.restore(saved);
  assert.deepEqual(restored.savedMusic, saved.savedMusic);
  assert.deepEqual(calls, [
    ["music", 19, { offset: 17.25, restart: true }],
    ["environment", 1, { slot: 0, offset: 2.5 }],
    { name: "PauseEnvSe", i: [0, 1] },
  ]);
});
test("PlayBGM respects the PR playback offset and explicit restart flag", () => {
  const player = new WebAudioPlayer();
  player.playMusic = (id, options) => ({ id, ...options });
  assert.deepEqual(player.command({ name: "PlayBGM", i: [105, 1, 1], r: [0.7, 72.8] }), {
    id: 105,
    fade: 0.7,
    restart: true,
    offset: 72.8,
  });
});
test("SyncBGM holds one-shot music until its end, but never waits for a looping song to end", async () => {
  for (const [loop, skipTrackEnd] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const player = new WebAudioPlayer({ onDiagnostic: () => {} });
    player.warn = () => {};
    player.context = { currentTime: 2 };
    player.current = { node: { loop }, ended: false, buffer: { duration: 10 } };
    player.position = () => 2;
    let done = false;
    const pending = player.command({ name: "SyncBGM", skipTrackEnd }).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(done, loop || skipTrackEnd);
    if (!done) player.current.ended = true;
    await pending;
    assert.equal(player.syncPending, false);
  }
  const player = new WebAudioPlayer();
  player.warn = () => {};
  player.context = { currentTime: 1 };
  player.transitionUntil = 2;
  const pending = player.command({ name: "SyncBGM" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(player.syncPending, true, "fade completion is also a barrier");
  player.context.currentTime = 2;
  await pending;
  assert.equal(player.syncPending, false);
});
test("a naturally completed one-shot is silent in saves and can play again without a forced restart", async () => {
  const player = new WebAudioPlayer();
  const gain = { value: 1, setValueAtTime() {}, cancelScheduledValues() {} };
  player.context = {
    currentTime: 0,
    createGain: () => ({ gain, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }),
  };
  player.unlock = async () => player.context;
  player.musicBuffer = async () => ({ duration: 1, length: 48000, sampleRate: 48000 });
  player.track = () => ({});
  await player.playMusic(1);
  const first = player.current;
  first.node.onended();
  assert.equal(player.musicState(), null);
  await player.playMusic(1);
  assert.notEqual(player.current, first);
  assert.equal(player.current.ended, false);
});
test("a browser SyncBGM barrier stops before the next source command without adding VM waits or changing headless playback", () => {
  const savedProgram = {
    name: "audio-boundary",
    ops: [
      ["SyncBGM", [], [], []],
      ["PlayBGM", [8], [], []],
    ],
  };
  class Source {
    constructor() {
      this.data = { programs: { 1: savedProgram } };
      this.task = { program: 1, pc: 0, wait: 0, waitFor: null };
    }
    step(task) {
      task.pc++;
    }
    tick() {
      while (this.task.pc < 2) this.step(this.task);
    }
  }
  let blocked = false;
  const commands = [],
    Host = withPresentation(Source),
    game = new Host({
      onPresentation: (event) => {
        commands.push(event.name);
        if (event.name === "SyncBGM") blocked = true;
      },
      yieldPresentation: () => blocked,
    });
  game.tick();
  assert.deepEqual(commands, ["SyncBGM"]);
  assert.deepEqual(game.task, { program: 1, pc: 1, wait: 0, waitFor: null });
  blocked = false;
  game.tick();
  assert.deepEqual(commands, ["SyncBGM", "PlayBGM"]);
  const headless = new Host({});
  headless.tick();
  assert.equal(headless.task.pc, 2);
});
test("slow BGM loads keep the host barrier until the requested song has actually started", async () => {
  const player = new WebAudioPlayer();
  player.context = { currentTime: 0 };
  player.unlock = async () => player.context;
  let finishDecode;
  player.musicBuffer = () =>
    new Promise((resolve) => {
      finishDecode = resolve;
    });
  player.track = () => ({});
  player.source = () => ({ started: true });
  player.end = () => {};
  const pending = player.playMusic(2);
  assert.equal(player.musicPending, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(player.current, undefined);
  assert.equal(player.musicPending, true);
  finishDecode({});
  await pending;
  assert.equal(player.current.id, 2);
  assert.equal(player.musicPending, false);
});

test("observing a PR boarding SysCall keeps its BGM, while direct PlayBGM is consumed exactly once", () => {
  class Source {
    constructor({ onEvent } = {}) {
      this.onEvent = onEvent;
      this.state = { steps: 0 };
      this.data = {
        programs: {
          1: {
            name: "flight-audio",
            ops: [
              ["SysCall", [], [], ["乗り物に乗る：ブラックジャック号"]],
              ["PlayBGM", [58], [], []],
            ],
          },
        },
      };
    }
    step(task) {
      const op = this.data.programs[task.program].ops[task.pc++];
      this.state.steps++;
      this.onEvent?.({ kind: "bgm", id: op[0] === "SysCall" ? 46 : 58 });
    }
  }
  const heard = [],
    suppressed = [],
    g = new (withPresentation(Source))({
      onEvent: (e) => {
        suppressed.push(observingAudioInstruction(g));
        if (!observingAudioInstruction(g)) heard.push(e.id);
      },
      onPresentation: (e) => {
        if (e.kind === "audio-command") heard.push(e.i[0]);
      },
    }),
    plain = new Source(),
    task = { program: 1, pc: 0, wait: 0 },
    plainTask = { ...task };
  g.step(task);
  plain.step(plainTask);
  g.step(task);
  plain.step(plainTask);
  assert.deepEqual(heard, [46, 58]);
  assert.deepEqual(suppressed, [false, true]);
  assert.deepEqual(task, plainTask);
  assert.deepEqual(g.state, plain.state);
  assert.equal(observingAudioInstruction(g), false);
});
