import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { build, preview } from "vite";
import { createAktoContent } from "../../apps/play/akto-content.js";
import { createAktoCityContent } from "../../apps/play/akto-city-content.js";

const root = path.resolve(import.meta.dirname, "../..");
const city = process.argv.includes("--city");
const createContent = city ? createAktoCityContent : createAktoContent;
const output = path.join(root, "build/play/deployment", city ? "akto-city" : "akto-art-test");
const destination = path.join(root, city ? "dist/akto-city" : "dist/akto");
const dataRoot = path.join(root, "build/web-data");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const python = path.join(root, ".venv/bin/python");
const packed = spawnSync(
  python,
  [path.join(import.meta.dirname, city ? "prepare-akto-city-assets.py" : "prepare-akto-assets.py")],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (packed.status !== 0)
  throw Error(
    "Akto asset export failed; preserve the individually generated raw PNGs in the trial's raw directory.",
  );
const manifest = await read(path.join(output, "asset-manifest.json"));
const source = await read(path.join(dataRoot, "data.json"));
const battleData = await read(path.join(dataRoot, "battle.json"));
const characters = {};
let reusedFrames = 0;
for (const name of ["mo_ff6_p001", "mo_ff6_n002_c00", "mo_ff6_n003_c00", "mo_ff6_n008_c00"]) {
  const character = structuredClone(source.characters[name]);
  for (const [frame, sprite] of Object.entries(character.sprites)) {
    const relative = `assets/reused/${name}/${frame}.png`;
    await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await cp(
      path.join(dataRoot, sprite.file.replace(/^\/web-data\//, "")),
      path.join(output, relative),
    );
    sprite.file = relative;
    reusedFrames++;
  }
  characters[name] = character;
}
await writeFile(
  path.join(output, "art-data.json"),
  JSON.stringify({ characters, battleData, modules: manifest.modules, city }),
);
// A portable authored map/event export accompanies the PNG pack. PR player
// and passerby character definitions remain dependencies of the existing game.
const scene = createContent({
  characters,
  battleData,
  modules: manifest.modules,
  root: "https://akto.invalid/",
});
const sceneData = { ...scene.data, characters: { akto_guard: scene.data.characters.akto_guard } };
await writeFile(
  path.join(output, "scene.json"),
  JSON.stringify(
    {
      data: sceneData,
      maps: scene.maps,
      city: scene.city,
      reusedCharacters: Object.keys(characters),
    },
    (_key, value) =>
      typeof value === "string" && value.startsWith("https://akto.invalid/")
        ? value.slice("https://akto.invalid/".length)
        : value,
  ),
);
await build({
  configFile: false,
  root: path.join(root, "apps/play"),
  base: "./",
  publicDir: false,
  build: {
    outDir: destination,
    emptyOutDir: true,
    target: "es2022",
    rolldownOptions: { input: path.join(root, "apps/play/akto.html") },
  },
});
await mkdir(path.join(destination, "trial"), { recursive: true });
await cp(path.join(output, "assets"), path.join(destination, "trial/assets"), { recursive: true });
for (const name of ["art-data.json", "asset-manifest.json"])
  await cp(path.join(output, name), path.join(destination, "trial", name));
console.log(
  JSON.stringify({
    output: destination,
    modules: Object.keys(manifest.modules).length,
    guardFrames: 12,
    reusedFrames,
  }),
);
if (process.argv.includes("--serve")) {
  const server = await preview({
    configFile: false,
    build: { outDir: destination },
    preview: { host: "127.0.0.1", port: city ? 4176 : 4175, strictPort: true },
  });
  console.log(`阿克托试玩：http://127.0.0.1:${city ? 4176 : 4175}/akto.html`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await server.httpServer.close();
      process.exit();
    });
}
