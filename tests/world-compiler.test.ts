import test from "node:test";
import assert from "node:assert/strict";
import { compileMapGeometry } from "../src/compiler/map-geometry.js";
import { compileWorldCharacter } from "../src/compiler/world.js";
import { missingFieldPoses } from "../src/core/character-media.js";
const source = {
  file: "synthetic",
  assetPath: "package/tilemap.json",
  objectId: "9007199254740993",
};
function geometry() {
  return {
    tile: {
      source,
      data: {
        width: 2,
        height: 2,
        tilewidth: 16,
        tileheight: 16,
        orientation: "orthogonal",
        layers: [
          {
            type: "tilelayer",
            name: "GroundLayer",
            width: 2,
            height: 2,
            data: [1, 0, 1, 0],
          },
        ],
        tilesets: [
          {
            firstgid: 1,
            tilewidth: 16,
            tileheight: 16,
            columns: 1,
            tilecount: 1,
            image: "atlas.png",
            imagewidth: 16,
            imageheight: 16,
          },
        ],
      },
    },
    collision: {
      source,
      data: {
        layers: [
          {
            name: "GroundCollision",
            visible: false,
            width: 2,
            height: 2,
            data: [0, 1, 0, 0],
          },
        ],
      },
    },
    textures: {
      "atlas.png": { url: "/synthetic.png", width: 16, height: 16, source },
    },
  };
}
test("all-map geometry preserves tile flags and collision editor visibility but rejects missing/foreign atlases", () => {
  const f = geometry();
  f.tile.data.layers[0]!.data[0] = 0x80000001;
  const good = compileMapGeometry(f.tile, f.collision, f.textures);
  assert.deepEqual(good.blockers, []);
  assert.equal(good.layers[0]!.data[0], 0x80000001);
  assert.equal(good.source.objectId, "9007199254740993");
  assert.ok(
    compileMapGeometry(f.tile, f.collision, {}).blockers.some((x) =>
      x.reason.startsWith("Missing package texture"),
    ),
  );
  f.textures["atlas.png"].width = 15;
  assert.ok(
    compileMapGeometry(f.tile, f.collision, f.textures).blockers.some(
      (x) => x.reason === "Atlas dimensions differ from tileset",
    ),
  );
});
test("unsupported collision, transforms and atlas cells remain batch diagnostics", () => {
  const f = geometry();
  f.tile.data.layers[0]!.data[1] = 2;
  f.collision.data.layers[0]!.data[0] = 11;
  Object.assign(f.tile.data.layers[0]!, { offsetx: 16 });
  const result = compileMapGeometry(f.tile, f.collision, f.textures);
  for (const reason of [
    "Unsupported tile layer transform",
    "Unsupported collision value",
    "Tile references absent atlas cell",
  ])
    assert.ok(result.blockers.some((x) => x.reason === reason));
  f.collision.data.layers[0]!.name = "constructor";
  assert.ok(
    compileMapGeometry(f.tile, f.collision, f.textures).blockers.some(
      (x) => x.reason === "Unknown or duplicate collision layer",
    ),
  );
});
function actor() {
  return {
    animation: {
      source,
      data: {
        shader_type: 0,
        animation: [
          {
            name: "Default",
            play_speed: 1,
            play_mode: 0,
            is_reverse: false,
            next_anim_name: "WalkB",
            frames: [
              {
                sprite_name: "pose",
                offsetx: 0,
                offsety: 0,
                flip: false,
                alpha: 1,
                rgb: { r: 1, g: 1, b: 1 },
              },
            ],
          },
        ],
      },
    },
    sprites: {
      pose: {
        file: "sprites/pose.png",
        sha256: "synthetic",
        width: 16,
        height: 24,
        pivot: [0.5, 0],
        source,
      },
    },
  };
}
test("character packages fail ambiguous poses, missing next frames and unsupported shaders explicitly", () => {
  const raw = actor(),
    verified: string[] = [];
  let result = compileWorldCharacter(raw, (file) => {
    verified.push(file);
  });
  assert.deepEqual(verified, ["sprites/pose.png"]);
  assert.ok(missingFieldPoses(result.character).includes("WalkB"));
  raw.animation.data.animation.push(
    structuredClone(raw.animation.data.animation[0]!),
  );
  result = compileWorldCharacter(raw, () => {});
  assert.equal(result.character.animations.Default, undefined);
  assert.ok(
    result.issues.some((x) => x.reason.startsWith("Duplicate animation")),
  );
  raw.animation.data.shader_type = 1;
  result = compileWorldCharacter(raw, () => {});
  assert.deepEqual(result.character.animations, {});
  assert.equal(result.issues[0]!.reason, "Unsupported character shader");
});
