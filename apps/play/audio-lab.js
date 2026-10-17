import { WebData, webIndexURL } from "./data.js";
import { WebAudioPlayer, loopSeconds } from "./audio.js";
const $ = (id) => document.getElementById(id),
  player = new WebAudioPlayer({ volume: 0.5 }),
  report = [];
const repository = new WebData(webIndexURL());
const index = await repository.json(webIndexURL().href);
const catalog = (await repository.json(index.core)).audio;
player.setAssets(index.assets.audio, repository.baseURL);
player.setCatalog(catalog);
const entries = Object.entries(catalog.bgm.tracks),
  looped = entries.filter(([, t]) => t.loop);
const preferred = [3, 8, 12, 15, 22, 27, 32, 44, 57, 69];
const chosen = [
  ...preferred.map((id) => [String(id), catalog.bgm.tracks[id]]).filter(([, t]) => t?.loop),
  ...looped,
]
  .filter(([id], index, list) => list.findIndex(([key]) => key === id) === index)
  .slice(0, 10);
for (const [id, track] of entries) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = `${id} · ${track.assetName}`;
  option.selected = id === chosen[0]?.[0];
  $("tracks").append(option);
}
const seconds = loopSeconds;
let lastResults = null;
async function play(id, near = false) {
  await player.unlock();
  const track = player.track("bgm", id);
  await player.playMusic(id, {
    offset: near && track.loop ? Math.max(0, seconds(track, "end") - 5) : 0,
    restart: true,
    fade: 0.01,
  });
}
function action(id, fn) {
  $(id).onclick = () => {
    try {
      Promise.resolve(fn()).catch((error) => {
        report.push(error.stack || error.message);
        $("results").textContent = report.join("\n");
      });
    } catch (error) {
      report.push(error.message);
      $("results").textContent = report.join("\n");
    }
  };
}
action("unlock", () => player.unlock());
action("pause", () => player.pauseMusic(0.1));
action("resume", () => player.resumeMusic(0.1));
action("stop", () => player.playMusic(0, { fade: 0.5 }));
action("play", () => play($("tracks").value));
action("near-loop", () => play($("tracks").value, true));
$("volume").oninput = (e) => player.setVolume(e.target.value);
for (const [id, track] of chosen) {
  const tr = document.createElement("tr");
  for (const value of [
    `${id} · ${track.assetName}`,
    String(track.sourceSampleRate || track.sampleRate),
    `${track.loop.start} → ${track.loop.end}`,
    `${seconds(track, "start").toFixed(6)} → ${seconds(track, "end").toFixed(6)}`,
  ]) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  const td = document.createElement("td"),
    button = document.createElement("button");
  button.textContent = `试听 ${id}`;
  button.onclick = () => play(id, true);
  td.append(button);
  tr.append(td);
  $("examples").append(tr);
}
async function verify(id, track) {
  await player.unlock();
  await player.playMusic(id, { restart: true });
  const buffer = player.current.buffer;
  const rate = buffer.sampleRate,
    start = seconds(track, "start"),
    end = seconds(track, "end"),
    offsetFrame = Math.max(0, Math.round(end * rate) - 5 * rate),
    offset = offsetFrame / rate,
    length = Math.ceil(10 * rate);
  const offline = new OfflineAudioContext(buffer.numberOfChannels, length, rate),
    source = offline.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = start;
  source.loopEnd = Math.round(end * rate) >= buffer.length ? buffer.duration + 1 / rate : end;
  source.connect(offline.destination);
  source.start(0, offset);
  const rendered = await offline.startRendering();
  let maxError = 0,
    zerosInserted = 0;
  // Sample every 37 frames across the entire output and every frame around
  // the boundary. Compare with the actual decoded PCM, including Opus pre-skip.
  const boundary = Math.round((end - offset) * rate),
    indices = new Set();
  for (let n = 0; n < length; n += 37) indices.add(n);
  for (let n = boundary - 512; n < boundary + 512; n++) if (n >= 0 && n < length) indices.add(n);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const input = buffer.getChannelData(channel),
      output = rendered.getChannelData(channel);
    for (const n of indices) {
      const startFrame = Math.round(start * rate),
        endFrame = Math.round(end * rate);
      let index = offsetFrame + n;
      if (index >= endFrame) index = startFrame + ((index - endFrame) % (endFrame - startFrame));
      const expected = input[index] || 0;
      maxError = Math.max(maxError, Math.abs(output[n] - expected));
      if (output[n] === 0 && Math.abs(expected) > 0.001) zerosInserted++;
    }
  }
  // Delivery loop positions are quantized once to Opus's 48 kHz grid.
  // Exact decoded samples on both sides must match: no timing gap or extra frame.
  return {
    id,
    codec: player.lastCodec,
    sampleRate: rate,
    sourceRate: track.sourceSampleRate || track.sampleRate,
    loopStart: start,
    loopEnd: end,
    zerosInserted,
    maxError,
    passed: zerosInserted === 0 && maxError < 0.00001,
  };
}
action("test", async () => {
  $("test").disabled = true;
  const results = [];
  try {
    for (const [id, track] of chosen) {
      $("results").textContent = `验证 ${id}…\n` + JSON.stringify(results, null, 2);
      results.push(await verify(id, track));
    }
    lastResults = {
      passed: results.every((r) => r.passed),
      userAgent: navigator.userAgent,
      tracks: results,
    };
    $("results").textContent =
      `通过 ${results.filter((r) => r.passed).length}/${results.length}; 插入静音 ${results.reduce((sum, r) => sum + r.zerosInserted, 0)}; 最大误差 ${Math.max(...results.map((r) => r.maxError))}\n` +
      results
        .map((r) => `${r.id}: ${r.passed ? "PASS" : "FAIL"} / 误差 ${r.maxError.toExponential(4)}`)
        .join("\n");
    player.playMusic(0);
  } finally {
    $("test").disabled = false;
  }
});
action("environment", () => {
  const entry = Object.entries(catalog.environment.tracks).find(
    ([, track]) => track.loop || track.looping,
  );
  return entry ? player.playEffect("environment", Number(entry[0]), { slot: 0 }) : null;
});
action("stop-env", () => player.stopEffects("environment", null, 0.3));
setInterval(() => {
  $("status").textContent = JSON.stringify(
    { tracks: entries.length, ...player.snapshot() },
    null,
    2,
  );
}, 200);

action("download", () => {
  if (!lastResults) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(lastResults, null, 2)], { type: "application/json" }),
  );
  a.download = `ffvi-audio-${navigator.userAgent.includes("Chrome/") ? "chrome" : "safari"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
