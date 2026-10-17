import { prepareWeb } from "./web.mjs";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, stat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { compileRuntime } from "./runtime.mjs";
import { compilePresentation } from "./presentation.mjs";
import { compileBattlePresentation } from "./battle-presentation.mjs";
import { compileParticles } from "./particles.mjs";
import { compileFieldPresentation } from "./field-presentation.mjs";
import { compileShaders } from "./shaders.mjs";
import { compileOpera } from "./opera.mjs";
import { compileExtras } from "./extras.mjs";
import { compileFieldAnimations } from "./field-animations.mjs";
const root = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2),
  option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
const game = option("--game"),
  out = path.resolve(option("--out") || path.join(root, "build/web-data"));
if (!game)
  throw Error(
    'Usage: npm run export -- --game "<PR game directory>" [--out "<empty/export directory>"]',
  );
const source = path.resolve(game);
await access(path.join(source, "GameAssembly.dll"));
const python = process.env.PYTHON || path.join(root, ".venv/bin/python");
const run = (file, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, "tools/export", file), ...options], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(Error(`${file} exited ${code}`))));
  });
for (const tool of ["vgmstream-cli", "ffmpeg"]) {
  const check = spawnSync(tool, [tool === "ffmpeg" ? "-version" : "-V"], { encoding: "utf8" });
  if (check.error) throw Error(`Missing ${tool}; see README export prerequisites.`);
}
const encoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
if (!/\blibopus\b/.test(encoders.stdout || ""))
  throw Error("FFmpeg lacks libopus; install an Opus-enabled FFmpeg (see README).");
const pythonCheck = spawnSync(python, ["-c", "import UnityPy, PIL, capstone"], {
  encoding: "utf8",
});
if (pythonCheck.status !== 0)
  throw Error(
    `Missing Python export dependencies; install tools/export/requirements.txt. ${pythonCheck.stderr}`,
  );
const start = Date.now();
await run("unity.py", ["--game", source, "--out", out]);
await run("native.py", ["--game", source, "--out", path.join(out, "raw/magic-stones.json")]);
await run("colosseum.py", ["--game", source, "--out", path.join(out, "raw/colosseum.json")]);
await run("audio.py", ["--out", out, ...(args.includes("--aac") ? ["--aac"] : [])]);
const counts = await compileRuntime(out);
const fieldAnimationCounts = await compileFieldAnimations(out);
await compilePresentation(out, { game: source });
const battlePresentationCounts = await compileBattlePresentation(out);
const { summary: particleCounts } = await compileParticles(out);
const fieldCounts = await compileFieldPresentation(out);
const { summary: shaderCounts } = await compileShaders(out, { game: source });
const { summary: operaCounts } = await compileOpera(out, { game: source, python });
const { summary: extrasCounts } = await compileExtras(out);
await prepareWeb({ dataRoot: out });
const categories = {};
async function scan(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".cache" || (!prefix && entry.name === "manifest.json")) continue;
    const relative = prefix + entry.name,
      file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file, relative + "/");
    else {
      const category = relative.includes("/") ? relative.split("/")[0] : "runtime";
      const summary = (categories[category] ??= { files: 0, bytes: 0 });
      summary.files++;
      summary.bytes += (await stat(file)).size;
    }
  }
}
await scan(out);
const media = JSON.parse(await readFile(path.join(out, "raw/media.json"), "utf8"));
const mediaClasses = {};
for (const [kind, rows] of Object.entries(media)) {
  const urls = [
    ...new Set(
      rows.flatMap((row) => [row.url, ...(row.urls || []), row.displayUrl]).filter(Boolean),
    ),
  ];
  const sizes = await Promise.all(
    urls.map((url) => stat(path.join(out, url)).then((info) => info.size)),
  );
  mediaClasses[kind] = {
    count: rows.length,
    files: urls.length,
    bytes: sizes.reduce((a, b) => a + b, 0),
  };
}
const audio = JSON.parse(await readFile(path.join(out, "audio.json"), "utf8"));
const audioClasses = {};
for (const [kind, catalog] of Object.entries(audio)) {
  const files = [
    ...new Set(
      Object.values(catalog.tracks).map((track) => track.file.replace(/^\/web-data\//, "")),
    ),
  ];
  audioClasses[kind] = {
    tracks: Object.keys(catalog.tracks).length,
    bytes: (
      await Promise.all(files.map((file) => stat(path.join(out, file)).then((info) => info.size)))
    ).reduce((a, b) => a + b, 0),
  };
}
const manifest = {
  version: 1,
  counts,
  categories,
  mediaClasses,
  audioClasses,
  visualClasses: {
    fieldAnimations: fieldAnimationCounts,
    battle: {
      ...battlePresentationCounts,
      bytes: (await stat(path.join(out, "battle-presentation.json"))).size,
    },
    particles: { ...particleCounts, bytes: (await stat(path.join(out, "particles.json"))).size },
    field: { ...fieldCounts, bytes: (await stat(path.join(out, "field-presentation.json"))).size },
    shaders: { ...shaderCounts, bytes: (await stat(path.join(out, "shaders.json"))).size },
    opera: { ...operaCounts, bytes: (await stat(path.join(out, "opera.json"))).size },
    extras: { ...extrasCounts, bytes: (await stat(path.join(out, "extras.json"))).size },
  },
  totalBytes: Object.values(categories).reduce((sum, row) => sum + row.bytes, 0),
  seconds: (Date.now() - start) / 1000,
};
await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
