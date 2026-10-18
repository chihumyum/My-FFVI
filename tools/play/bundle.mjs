import { build } from "vite";
import { prepareWeb } from "../export/web.mjs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(process.env.PLAY_BUNDLE_OUT || path.join(root, "dist/web"));
await prepareWeb();
await build({ configFile: path.join(root, "vite.config.mjs"), build: { outDir: output } });
const files = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = prefix + entry.name,
      full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, file + "/");
    else files.push({ file, bytes: (await stat(full)).size });
  }
}
await walk(output);
const manifest = JSON.parse(await readFile(path.join(output, ".vite/manifest.json")));
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
const initialAssets = new Set(
  files.filter((f) => f.file === "index.html" || /\.(js|css)$/.test(f.file)).map((f) => f.file),
);
const index = JSON.parse(await readFile(path.join(output, "data/index.json")));
if (index.presentation) {
  initialAssets.add("data/index.json");
  initialAssets.add(index.presentation);
  const ui = JSON.parse(await readFile(path.join(output, index.presentation)));
  const font = ui.fonts.find((f) => f.primary) || ui.fonts[0];
  if (font) initialAssets.add(index.assets.fonts[font.url]);
  // All UI image pages form a conservative upper bound, even though only the
  // title logo/window/cursor are requested before starting a game.
  const visit = (value) => {
    if (typeof value === "string" && index.assets.images[value])
      initialAssets.add(index.assets.images[value].file);
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) visit(child);
  };
  visit(ui);
}
const initialFiles = files.filter((f) => initialAssets.has(f.file));
const report = {
  output,
  totalBytes: files.reduce((s, f) => s + f.bytes, 0),
  initialBytes: initialFiles.reduce((s, f) => s + f.bytes, 0),
  initialStaticBytes: files.filter((f) => initial.has(f.file)).reduce((s, f) => s + f.bytes, 0),
  initialFiles,
  fileCount: files.length,
  largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
  note: "Initial bytes conservatively include all emitted JS/CSS, the bootstrap/presentation indexes, primary CJK font and every UI image page (including menus not open at the title). Maps, story and battle data are fetched after New Game. Automatic regression explicitly preloads remote scripts. No raw Unity files or evidence are shipped.",
};
await writeFile(
  path.join(root, "build/play/foundation-static-sizes.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
