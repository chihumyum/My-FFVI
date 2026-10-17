import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const read = async (file) => JSON.parse(await readFile(file));
const identity = (asset) => `${asset.source.file}::${asset.source.assetPath}`.toLowerCase();

// PR scripts carry their own animation definitions alongside Mnemonics. Export
// those exact frames/offsets/colors instead of guessing aliases from their names.
export async function compileFieldAnimations(out) {
  const [index, media, data] = await Promise.all([
    read(path.join(out, "raw/index.json")),
    read(path.join(out, "raw/media.json")),
    read(path.join(out, "data.json")),
  ]);
  const assets = (
    await Promise.all(
      index.files.filter((f) => f.bundleOutput).map((f) => read(path.join(out, f.bundleOutput))),
    )
  ).flat();
  let clips = 0,
    frames = 0,
    spriteCount = 0;
  const programs = assets
    .filter((a) => Array.isArray(a.data.Mnemonics))
    .sort((a, b) => identity(a).localeCompare(identity(b)));
  for (const [id, source] of programs.entries()) {
    const program = data.programs[id];
    if (program?.name !== path.posix.basename(source.source.assetPath, ".json"))
      throw Error(`Script identity mismatch while exporting animation metadata: ${id}`);
    program.animations = source.data.Animations || [];
    clips += program.animations.length;
    frames += program.animations.reduce((n, clip) => n + (clip.frames?.length || 0), 0);
  }
  const byBundle = new Map();
  for (const sprite of media.sprites) {
    if (!byBundle.has(sprite.source.file)) byBundle.set(sprite.source.file, []);
    byBundle.get(sprite.source.file).push(sprite);
  }
  for (const asset of assets.filter((a) =>
    a.source.assetPath?.toLowerCase().endsWith("/anim_info.json"),
  )) {
    const key = path.basename(asset.source.file).split("_assets_all_")[0];
    const character = data.characters[key];
    if (!character) continue;
    for (const sprite of byBundle.get(asset.source.file) || []) {
      if (character.sprites[sprite.name]) continue;
      character.sprites[sprite.name] = {
        file: "/web-data/" + sprite.url,
        width: sprite.width,
        height: sprite.height,
        pivot: sprite.pivot,
      };
      spriteCount++;
    }
  }
  const file = path.join(out, "data.json"),
    bytes = Buffer.from(JSON.stringify(data) + "\n");
  if (!(await readFile(file)).equals(bytes)) await writeFile(file, bytes);
  const result = { programs: programs.length, clips, frames, addedSprites: spriteCount };
  console.log("PR script animations", JSON.stringify(result));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  await compileFieldAnimations(path.resolve(process.argv[2] || "build/web-data"));
