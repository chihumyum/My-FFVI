import { build } from "vite";
import { prepareWeb } from "../export/web.mjs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
await prepareWeb();
await build({ configFile: path.join(root, "vite.config.mjs") });
const files = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = prefix + entry.name,
      full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, file + "/");
    else files.push({ file, bytes: (await stat(full)).size });
  }
}
await walk(path.join(root, "dist/web"));
const manifest = JSON.parse(await readFile(path.join(root, "dist/web/.vite/manifest.json")));
const initial = new Set(["index.html"]);
function moduleAssets(key) {
  const value = manifest[key];
  if (!value) return;
  initial.add(value.file);
  for (const css of value.css || []) initial.add(css);
  for (const child of value.imports || []) moduleAssets(child);
}
moduleAssets("index.html");
// Pixi initializes the renderer using dynamic imports. Count all emitted client
// code (including unused renderer/lab chunks) as a conservative title upper bound.
const initialFiles = files.filter((f) => f.file === "index.html" || /\.(js|css)$/.test(f.file));
const report = {
  totalBytes: files.reduce((s, f) => s + f.bytes, 0),
  initialBytes: initialFiles.reduce((s, f) => s + f.bytes, 0),
  initialStaticBytes: files.filter((f) => initial.has(f.file)).reduce((s, f) => s + f.bytes, 0),
  initialFiles,
  fileCount: files.length,
  largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
  note: "Initial bytes conservatively include index.html and every emitted JS/CSS file, including dynamic Pixi renderer and unused lab chunks. Game data is fetched after New Game; automatic regression explicitly preloads remote scripts. No raw Unity files or evidence are shipped.",
};
await writeFile(
  path.join(root, "build/play/foundation-static-sizes.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
