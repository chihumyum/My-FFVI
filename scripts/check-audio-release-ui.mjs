// Actual AudioOutput with controlled fetch/WebAudio and real Flow/entry owners.
// Synthetic bytes exercise identity and lifecycle, not a browser FLAC decoder.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await readFile(resolve(root, "apps/game/audio.js"), "utf8");
const script = source.replace('"/runtime/core/static-audio.js"',
  JSON.stringify(pathToFileURL(resolve(compiled, "src/core/static-audio.js")).href));
assert.notEqual(script, source, "Bind the actual audio module's runtime import");
const { AudioOutput } = await import("data:text/javascript;base64," + Buffer.from(script).toString("base64"));
const module = async path => import(pathToFileURL(resolve(compiled, path)).href);
const [{ selectGameContentRelease, resolveGameContentReleaseMedia }, { GameFlow }, { GameEntryLoader },
  { checkpointFixture }] = await Promise.all([
  module("src/core/game-content-release.js"), module("src/core/game-flow.js"),
  module("src/core/game-entry-loader.js"), module("tests/fixtures/checkpoint-game.js"),
]);
const reportPath = resolve(root, "build/reports/audio-release-ui-check.json"), tests = [];
await mkdir(resolve(root, "build/reports"), { recursive: true }); await rm(reportPath, { force: true });
const originalFetch = globalThis.fetch;
const h = value => value.repeat(64), file = "/audio/map.flac";
function asset(name) {
  const bytes = Buffer.from(JSON.stringify({ name, channels: 2, frames: 1000, sampleRate: 1000 }));
  return { bytes, track: { file, sha256: sha(bytes), frames: 1000, sampleRate: 1000, channels: 2, loop: null,
    source: { file: "controlled", assetPath: name }, tableSource: { file: "controlled", assetPath: "bgm" } } };
}
function selected(track, id) {
  const refs = { kind: "game-content-refs-v1", profile: "framework",
    world: { url: "/synthetic/world.json", contentHash: h("1") }, source: null,
    development: { entry: { url: "/synthetic/entry.json", contentHash: h("2") },
      battle: { url: "/synthetic/battle.json", contentHash: h("3") } } };
  return selectGameContentRelease({ kind: "game-content-release-index-v1", contentHash: h("4"),
    packageId: "controlled-audio", profile: "framework", currentReleaseId: h(id), objectRoot: "/content-releases",
    releases: [{ id: h(id), sourceSetHash: h("a"), refs, bindings: { [refs.world.url]: h("1"),
      [refs.development.entry.url]: h("2"), [refs.development.battle.url]: h("3") },
      mediaBindings: { [track.file]: { sha256: track.sha256, extension: "flac" } } }] }, { kind: "current" });
}
function resolver(release) {
  return track => {
    const ref = resolveGameContentReleaseMedia(release, track.file);
    if (ref.sha256 !== track.sha256) throw new Error("Controlled release media/track SHA mismatch");
    return ref.url;
  };
}
function response(bytes) { return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer }; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function parameter() {
  return { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime() {} };
}
function output(resolveFile) {
  const records = { decodes: [], sources: [] };
  const context = {
    currentTime: 0,
    async decodeAudioData(raw) {
      const digest = sha(Buffer.from(raw)), value = JSON.parse(Buffer.from(raw).toString());
      records.decodes.push(digest);
      return { numberOfChannels: value.channels, duration: value.frames / value.sampleRate,
        sampleRate: value.sampleRate, sourceSha256: digest };
    },
    createBufferSource() {
      const source = { starts: [], stops: 0, connect() {}, disconnect() {},
        start(...args) { this.starts.push(args); }, stop() { this.stops++; } };
      records.sources.push(source); return source;
    },
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; },
    async resume() {}, async suspend() {},
  };
  const audio = new AudioOutput(resolveFile); audio.context = context; audio.master = context.createGain();
  return { audio, context, records };
}
function projection(track) {
  return { id: "bgm:1", track, voice: { id: 1, track: 1, started: 0, seek: 0,
    fadeIn: 0, stop: null, pan: 0 }, time: 0 };
}
async function check(name, body) {
  try { await body(); tests.push({ name, pass: true }); }
  catch (error) { tests.push({ name, pass: false, reason: String(error) }); throw error; }
}
let failure;
try {
  await check("default source URLs remain compatible and a non-function resolver is rejected", async () => {
    for (const invalid of [null, false, {}, "url"]) assert.throws(() => new AudioOutput(invalid), /resolver/);
    const current = asset("default"), { audio } = output(), requests = [], before = structuredClone(current.track);
    globalThis.fetch = async url => { requests.push(url); return response(current.bytes); };
    await audio.prepare([], [current.track]);
    assert.deepEqual(requests, [file]); assert.equal(audio.isReady(current.track), true);
    assert.deepEqual(current.track, before); assert.equal(audio.nodes.size, 0);
    assert.throws(() => audio.load(current.track, null), /resolver/);
  });
  await check("two releases sharing one logical URL retain separate SHA decodes and voice identities", async () => {
    const current = asset("current"), historical = asset("historical"), active = selected(current.track, "8"),
      archived = selected(historical.track, "9"), activeResolver = resolver(active), archivedResolver = resolver(archived);
    const currentUrl = activeResolver(current.track), archivedUrl = archivedResolver(historical.track);
    const files = new Map([[currentUrl, current.bytes], [archivedUrl, historical.bytes]]), requests = [];
    const { audio, records } = output(activeResolver), oldProjection = projection(historical.track),
      currentProjection = projection(current.track), before = structuredClone([current.track, historical.track]);
    globalThis.fetch = async url => { requests.push(url); assert.ok(files.has(url)); return response(files.get(url)); };
    assert.equal(audio.ready([currentProjection]), false);
    await audio.pending.get(current.track.sha256);
    assert.equal(audio.ready([currentProjection]), true);
    audio.project([currentProjection], true); const currentNode = audio.nodes.get("bgm:1");
    await audio.prepare([oldProjection], [], archivedResolver);
    assert.equal(audio.nodes.get("bgm:1"), currentNode, "Private preparation cannot publish a voice");
    assert.deepEqual(requests, [currentUrl, archivedUrl]);
    assert.deepEqual(records.decodes, [current.track.sha256, historical.track.sha256]);
    assert.notEqual(audio.buffers.get(current.track.sha256), audio.buffers.get(historical.track.sha256));
    audio.project([oldProjection], true);
    assert.equal(currentNode.source.stops, 1); assert.equal(records.sources.length, 2);
    assert.equal(audio.nodes.get("bgm:1").source.buffer.sourceSha256, historical.track.sha256);
    assert.deepEqual([current.track, historical.track], before);
  });
  await check("an explicit candidate resolver is captured before await and survives later active resolver changes", async () => {
    const archived = asset("candidate"), release = selected(archived.track, "8"), candidateResolver = resolver(release);
    const gate = deferred(), requests = []; let activeReads = 0;
    const { audio } = output(() => { activeReads++; throw new Error("Active context cannot choose candidate media"); });
    globalThis.fetch = url => { requests.push(url); return gate.promise; };
    const pending = audio.prepare([], [archived.track], candidateResolver);
    assert.deepEqual(requests, [candidateResolver(archived.track)]);
    audio.resolveFile = () => { activeReads++; throw new Error("Later active resolver must not run"); };
    gate.resolve(response(archived.bytes)); await pending;
    assert.equal(activeReads, 0); assert.equal(audio.ready([], [archived.track], candidateResolver), true);
    assert.equal(audio.nodes.size, 0); assert.equal(audio.running, false);
  });
  await check("pending and decoded resources share only their SHA and do not invoke an unrelated file resolver", async () => {
    const a = asset("shared-bytes"), gate = deferred(), requests = [], { audio, records } = output();
    globalThis.fetch = url => { requests.push(url); return gate.promise; };
    const first = audio.load(a.track), alias = { ...a.track, file: "/aliases/map.flac" };
    let aliasReads = 0;
    const aliasResolver = () => { aliasReads++; throw new Error("Same SHA is already loading"); };
    assert.equal(audio.load(alias, aliasResolver), first);
    gate.resolve(response(a.bytes)); await first;
    await audio.prepare([projection(alias)], [], aliasResolver);
    assert.deepEqual(requests, [file]); assert.equal(aliasReads, 0); assert.equal(records.decodes.length, 1);
    assert.equal(audio.buffers.size, 1); assert.equal(audio.isReady(alias), true);
  });
  await check("wrong archived bytes stay failed by SHA, leave current audio usable and retry through reset", async () => {
    const current = asset("good-current"), historical = asset("bad-history"), currentResolver = resolver(selected(current.track, "8")),
      oldResolver = resolver(selected(historical.track, "9")), currentUrl = currentResolver(current.track),
      oldUrl = oldResolver(historical.track), { audio, records } = output(currentResolver), requests = [];
    let repaired = false;
    globalThis.fetch = async url => {
      requests.push(url);
      return response(url === currentUrl || !repaired ? current.bytes : historical.bytes);
    };
    await audio.prepare([projection(current.track)]); audio.project([projection(current.track)], true);
    const voice = audio.nodes.get("bgm:1");
    await assert.rejects(audio.prepare([], [historical.track], oldResolver), /摘要不匹配/);
    assert.throws(() => audio.isReady(historical.track), /摘要不匹配/);
    assert.equal(audio.buffers.has(historical.track.sha256), false);
    assert.equal(audio.ready([projection(current.track)]), true); audio.project([projection(current.track)], true);
    assert.equal(audio.nodes.get("bgm:1"), voice); assert.equal(voice.source.stops, 0);
    assert.deepEqual(records.decodes, [current.track.sha256], "Wrong bytes never reach decoding");
    repaired = true; audio.reset(); await audio.prepare([], [historical.track], oldResolver);
    assert.equal(audio.isReady(historical.track), true);
    assert.equal(requests.filter(url => url === oldUrl).length, 2);
    assert.deepEqual(records.decodes, [current.track.sha256, historical.track.sha256]);
    assert.equal(audio.nodes.size, 0);
  });
  await check("cancelled private decode completion cannot replace a newer real session owner or start playback", async () => {
    const oldOwner = checkpointFixture().game, candidate = checkpointFixture().game, replacement = checkpointFixture().game;
    const flow = new GameFlow(), discarded = [], entries = new GameEntryLoader(flow, { discard: value => discarded.push(value) });
    flow.start(oldOwner);
    const archived = asset("cancelled-candidate"), candidateResolver = resolver(selected(archived.track, "8")),
      { audio, context, records } = output(() => { throw new Error("Private load cannot use active content"); }),
      began = deferred(), decoded = deferred(), snapshots = [oldOwner, candidate, replacement].map(owner => owner.state.snapshot());
    globalThis.fetch = async url => { assert.equal(url, candidateResolver(archived.track)); return response(archived.bytes); };
    const actualDecode = context.decodeAudioData;
    context.decodeAudioData = async raw => { began.resolve(); await decoded.promise; return actualDecode(raw); };
    const attempt = entries.begin("load"), view = { trackSha: archived.track.sha256 };
    const pending = attempt.prepare(async () => {
      await audio.prepare([], [archived.track], candidateResolver);
      return { session: candidate, presentation: view };
    });
    await began.promise; attempt.cancel(); audio.reset(); flow.start(replacement);
    const activeSnapshot = replacement.state.snapshot(), activeFieldTime = replacement.field.time;
    audio.resolveFile = track => track.file;
    decoded.resolve(); assert.equal((await pending).status, "cancelled");
    assert.equal(flow.currentSession, replacement); assert.equal(flow.busy, false);
    assert.deepEqual(replacement.state.snapshot(), activeSnapshot); assert.equal(replacement.field.time, activeFieldTime);
    [oldOwner, candidate, replacement].forEach((owner, index) => assert.deepEqual(owner.state.snapshot(), snapshots[index]));
    assert.deepEqual(discarded, [view]); assert.equal(audio.nodes.size, 0);
    assert.equal(records.sources.length, 0); assert.equal(audio.isReady(archived.track), true);
  });
} catch (error) { failure = error; }
finally { globalThis.fetch = originalFetch; }
const report = {
  formatVersion: 1, kind: "controlled-audio-release-ui-check", result: failure ? "failed" : "pass",
  audioModuleSha256: sha(source), staticAudioModuleSha256: sha(await readFile(resolve(compiled, "src/core/static-audio.js"))),
  releaseModuleSha256: sha(await readFile(resolve(compiled, "src/core/game-content-release.js"))), tests,
  limitations: [
    "Actual AudioOutput and release media resolver; controlled fetch/WebAudio with redistributable synthetic bytes",
    "Real GameFlow/GameEntryLoader/GameSession cancellation; audio owns only asset cache and presentation nodes",
    "No browser FLAC decoder, sound-device, autoplay or original-game parity acceptance",
    "Host candidate/active resolver selection is controlled here; full app/archive integration is a separate check",
  ],
};
const reportBytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(reportPath, reportBytes);
console.log(JSON.stringify({ result: report.result, tests: tests.length, reportPath, reportSha256: sha(reportBytes) }));
if (failure) throw failure;
