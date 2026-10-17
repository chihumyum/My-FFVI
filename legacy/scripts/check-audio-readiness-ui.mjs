// Controlled fetch/WebAudio adapter checks for the actual AudioOutput module.
// This is not a browser, audio-device, autoplay or audible acceptance result.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist"),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  source = await readFile(root + "apps/game/audio.js", "utf8"),
  script = source.replace(
    '"/runtime/core/static-audio.js"',
    JSON.stringify(
      pathToFileURL(resolve(compiled, "src/core/static-audio.js")).href,
    ),
  );
assert.notEqual(
  script,
  source,
  "Bind the actual audio module's one runtime import",
);
const { AudioOutput } = await import(
  "data:text/javascript;base64," + Buffer.from(script).toString("base64")
);
const reportPath = root + "build/reports/audio-readiness-ui-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
const originalFetch = globalThis.fetch,
  checks = [];
const buffer = { numberOfChannels: 2, duration: 1, sampleRate: 1000 };
const asset = (text) => {
  const bytes = Buffer.from(text);
  return {
    bytes,
    track: {
      file: "/controlled/" + text + ".flac",
      sha256: sha(bytes),
      frames: 1000,
      sampleRate: 1000,
      channels: 2,
      loop: null,
      source: { file: "controlled", assetPath: text },
      tableSource: { file: "controlled", assetPath: "bgm-table" },
    },
  };
};
function response(bytes) {
  return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}
function output(decode = async () => buffer) {
  const audio = new AudioOutput();
  audio.context = { decodeAudioData: decode };
  return audio;
}
async function check(name, body) {
  await body();
  checks.push({ name, pass: true });
}
try {
  await check(
    "isReady is a read-only observation and does not start fetch or decode",
    async () => {
      const a = asset("query"),
        audio = output();
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return response(a.bytes);
      };
      assert.equal(audio.isReady(a.track), false);
      assert.equal(calls, 0);
      assert.equal(audio.pending.size, 0);
      assert.equal(audio.buffers.size, 0);
      assert.equal(audio.nodes.size, 0);
    },
  );
  await check(
    "explicit pending dependencies load without a playback voice and become ready only after decode",
    async () => {
      const a = asset("pending"),
        audio = output();
      let calls = 0,
        finish,
        decodeStarted;
      const began = new Promise((resolve) => {
        decodeStarted = resolve;
      });
      audio.context.decodeAudioData = () =>
        new Promise((resolve) => {
          finish = resolve;
          decodeStarted();
        });
      globalThis.fetch = async () => {
        calls++;
        return response(a.bytes);
      };
      assert.equal(audio.ready([], [a.track]), false);
      assert.equal(audio.ready([], [a.track]), false);
      await Promise.race([
        began,
        audio.pending.get(a.track.sha256).then(() => {
          assert.ok(
            finish,
            "Loading failed before the controlled decode began",
          );
        }),
      ]);
      assert.equal(calls, 1);
      assert.equal(audio.isReady(a.track), false);
      assert.equal(audio.nodes.size, 0);
      finish(buffer);
      await audio.pending.get(a.track.sha256);
      assert.equal(audio.isReady(a.track), true);
      assert.equal(audio.ready([], [a.track]), true);
      assert.equal(audio.nodes.size, 0);
    },
  );
  await check(
    "candidate prepare includes readiness dependencies even with no active voices",
    async () => {
      const a = asset("candidate"),
        audio = output();
      globalThis.fetch = async () => response(a.bytes);
      await audio.prepare([], [a.track]);
      assert.equal(audio.isReady(a.track), true);
      assert.equal(audio.nodes.size, 0);
      assert.equal(audio.running, false);
    },
  );
  await check(
    "a digest mismatch is a failed dependency, never a ready asset",
    async () => {
      const a = asset("expected"),
        audio = output();
      globalThis.fetch = async () => response(Buffer.from("wrong-bytes"));
      await assert.rejects(audio.prepare([], [a.track]), /摘要不匹配/);
      assert.equal(audio.buffers.size, 0);
      assert.throws(() => audio.isReady(a.track), /摘要不匹配/);
    },
  );
  await check(
    "invalid decoded sample geometry cannot satisfy readiness",
    async () => {
      const a = asset("geometry"),
        audio = output(async () => ({ ...buffer, duration: 2 }));
      globalThis.fetch = async () => response(a.bytes);
      await assert.rejects(audio.prepare([], [a.track]), /长度不匹配/);
      assert.equal(audio.buffers.size, 0);
      assert.throws(() => audio.isReady(a.track), /长度不匹配/);
    },
  );
  await check(
    "an old asset completion cannot satisfy a new identity sharing its logical track slot",
    async () => {
      const old = asset("old"),
        next = asset("new"),
        audio = output();
      globalThis.fetch = async () => response(old.bytes);
      await audio.prepare([], [old.track]);
      assert.equal(audio.isReady(old.track), true);
      assert.equal(audio.isReady(next.track), false);
      globalThis.fetch = async () => response(next.bytes);
      await audio.prepare([], [next.track]);
      assert.equal(audio.isReady(next.track), true);
      assert.equal(audio.nodes.size, 0);
    },
  );
  await check(
    "an unrelated stale load error cannot stop a verified current asset",
    async () => {
      const old = asset("stale"),
        current = asset("current"),
        audio = output();
      globalThis.fetch = async (url) =>
        response(url === old.track.file ? Buffer.from("wrong") : current.bytes);
      await audio.load(old.track);
      await audio.prepare([], [current.track]);
      assert.equal(audio.isReady(current.track), true);
      assert.equal(audio.ready([], [current.track]), true);
      assert.throws(() => audio.isReady(old.track), /摘要不匹配/);
    },
  );
  await check(
    "three loaded pending dependencies remain ready through projection without new fetches",
    async () => {
      const assets = ["pending-a", "pending-b", "pending-c"].map(asset),
        tracks = assets.map(({ track }) => track),
        audio = output();
      let calls = 0;
      globalThis.fetch = async (url) => {
        calls++;
        const requested = assets.find(({ track }) => track.file === url);
        assert.ok(requested, "Only declared dependencies may be fetched");
        return response(requested.bytes);
      };
      await audio.prepare([], tracks);
      assert.equal(calls, 3);
      assert.equal(audio.ready([], tracks), true);
      audio.running = true;
      for (let frame = 0; frame < 3; frame++) {
        audio.project([], true, tracks);
        assert.equal(audio.ready([], tracks), true);
        assert.equal(audio.buffers.size, 3);
        assert.equal(audio.pending.size, 3);
        assert.equal(calls, 3);
      }
      assert.equal(audio.nodes.size, 0);
    },
  );
  await check(
    "released dependencies return to the two-inactive-decode cache limit",
    async () => {
      const assets = ["released-a", "released-b", "released-c"].map(asset),
        tracks = assets.map(({ track }) => track),
        audio = output();
      let calls = 0;
      globalThis.fetch = async (url) => {
        calls++;
        const requested = assets.find(({ track }) => track.file === url);
        assert.ok(requested, "Only declared dependencies may be fetched");
        return response(requested.bytes);
      };
      await audio.prepare([], tracks);
      audio.running = true;
      audio.project([], true, tracks);
      assert.equal(audio.buffers.size, 3);
      const loaded = [...audio.buffers.keys()];
      audio.project([], true, []);
      assert.deepEqual([...audio.buffers.keys()], loaded.slice(-2));
      assert.deepEqual(
        [...audio.pending.keys()].sort(),
        loaded.slice(-2).sort(),
      );
      assert.equal(audio.ready([], []), true);
      assert.equal(calls, 3);
      assert.equal(audio.nodes.size, 0);
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}
const report = {
  formatVersion: 1,
  kind: "controlled-audio-readiness-ui-check",
  audioModuleSha256: sha(source),
  staticAudioModuleSha256: sha(
    await readFile(resolve(compiled, "src/core/static-audio.js")),
  ),
  checks,
  limitations: [
    "Actual AudioOutput JavaScript with controlled fetch and decoded-buffer adapters; no real browser or audio device.",
    "Autoplay, browser decoder compatibility, audible alignment and native parity require separate evidence.",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, bytes);
console.log(
  JSON.stringify(
    { checks: checks.length, reportSha256: sha(bytes), reportPath },
    null,
    2,
  ),
);
