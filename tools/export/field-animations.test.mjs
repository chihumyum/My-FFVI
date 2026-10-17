import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileFieldAnimations } from "./field-animations.mjs";

test("script animations and their extra sprites survive export without changing instructions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ffvi-animations-"));
  try {
    await mkdir(path.join(root, "raw/bundles"), { recursive: true });
    const sourceFile = "mo_ff6_b121_c00_assets_all_test.bundle";
    const clip = { name: "Tent_Yoffset", frames: [{ sprite_name: "Default_00", offsety: 16 }] };
    const source = [
      {
        source: { file: "map.bundle", assetPath: "sc_map_test.json" },
        data: { Mnemonics: [], Animations: [clip] },
      },
      { source: { file: sourceFile, assetPath: "assets/anim_info.json" }, data: { animation: [] } },
    ];
    const files = {
      "raw/index.json": { files: [{ bundleOutput: "raw/bundles/test.json" }] },
      "raw/bundles/test.json": source,
      "raw/media.json": {
        sprites: [
          {
            name: "Default_00",
            source: { file: sourceFile },
            url: "media/extra.png",
            width: 16,
            height: 32,
            pivot: { x: 0.5, y: 0 },
          },
        ],
      },
      "data.json": {
        programs: { 0: { name: "sc_map_test", ops: [["CueAnim", [], [], ["Tent_Yoffset"]]] } },
        characters: { mo_ff6_b121_c00: { sprites: { Keep: { file: "keep.png" } } } },
      },
    };
    for (const [file, data] of Object.entries(files))
      await writeFile(path.join(root, file), JSON.stringify(data));
    const originalSource = await readFile(path.join(root, "raw/bundles/test.json"));
    const result = await compileFieldAnimations(root);
    assert.deepEqual(result, { programs: 1, clips: 1, frames: 1, addedSprites: 1 });
    const data = JSON.parse(await readFile(path.join(root, "data.json")));
    assert.deepEqual(data.programs[0].ops, files["data.json"].programs[0].ops);
    assert.deepEqual(data.programs[0].animations, [clip]);
    assert.equal(
      data.characters.mo_ff6_b121_c00.sprites.Default_00.file,
      "/web-data/media/extra.png",
    );
    assert.deepEqual(data.characters.mo_ff6_b121_c00.sprites.Keep, { file: "keep.png" });
    const modified = (await stat(path.join(root, "data.json"))).mtimeMs;
    assert.equal((await compileFieldAnimations(root)).addedSprites, 0);
    assert.equal((await stat(path.join(root, "data.json"))).mtimeMs, modified);
    assert.deepEqual(await readFile(path.join(root, "raw/bundles/test.json")), originalSource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
